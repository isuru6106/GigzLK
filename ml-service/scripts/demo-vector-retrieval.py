"""Synthetic-only embedding storage and semantic retrieval demonstration."""

import json
import re
from getpass import getpass
from pathlib import Path

import numpy as np
import psycopg
from sentence_transformers import SentenceTransformer


ROOT = Path(__file__).resolve().parents[1]
MODEL_NAME = "intfloat/multilingual-e5-small"
PREPROCESSING = "e5-prefix-normalized-v1"


def vector_literal(vector: np.ndarray) -> str:
    if vector.shape != (384,) or not np.isfinite(vector).all():
        raise RuntimeError("Invalid embedding.")

    if not np.isclose(np.linalg.norm(vector), 1.0, atol=1e-5):
        raise RuntimeError("Embedding is not normalized.")

    return "[" + ",".join(str(float(value)) for value in vector) + "]"


def search_candidates(connection, kind, model_version, query):
    if kind not in {"job", "worker"}:
        raise ValueError("Unsupported candidate kind.")

    literal = vector_literal(query)

    return connection.execute(
        """
        SELECT e.entity_id, e.source_revision,
               1 - (
                   e.embedding OPERATOR(public.<=>) %s::public.vector
               ) AS similarity
        FROM ml.synthetic_embeddings AS e
        JOIN ml.synthetic_entities AS s
          ON s.entity_kind = e.entity_kind
         AND s.entity_id = e.entity_id
         AND s.source_revision = e.source_revision
        WHERE e.entity_kind = %s
          AND e.model_version = %s
          AND s.visibility = 'visible'
        ORDER BY
            e.embedding OPERATOR(public.<=>) %s::public.vector,
            e.entity_id
        LIMIT 5
        """,
        (literal, kind, model_version, literal),
    ).fetchall()


def main() -> None:
    manifest = json.loads(
        (ROOT / "vector-model.json").read_text(encoding="utf-8")
    )

    if not isinstance(manifest, dict):
        raise RuntimeError("Invalid model manifest.")

    revision = manifest.get("model_revision")

    if (
        manifest.get("model_name") != MODEL_NAME
        or manifest.get("dimensions") != 384
        or manifest.get("preprocessing_version") != PREPROCESSING
        or manifest.get("max_sequence_length") != 512
        or manifest.get("normalize_embeddings") is not True
        or not isinstance(revision, str)
        or re.fullmatch(r"[0-9a-f]{40}", revision) is None
    ):
        raise RuntimeError("Unexpected model configuration.")

    model_version = f"e5-small-{revision}-{PREPROCESSING}"
    password = getpass("Local vector client password: ")

    with psycopg.connect(
        host="127.0.0.1",
        port=5544,
        dbname="gigzlk_vector_dev",
        user="gigzlk_vector_client",
        password=password,
        connect_timeout=5,
        options="-c statement_timeout=5000 -c lock_timeout=3000",
        autocommit=True,
    ) as connection:
        identity = connection.execute(
            "SELECT current_user, current_database()"
        ).fetchone()

        if identity != ("gigzlk_vector_client", "gigzlk_vector_dev"):
            raise RuntimeError("Unexpected database identity.")

        # No database transaction remains open during model execution.
        rows = connection.execute(
            """
            SELECT entity_kind, entity_id, source_revision, searchable_text
            FROM ml.synthetic_entities
            WHERE visibility = 'visible'
            ORDER BY entity_kind, entity_id
            LIMIT 101
            """
        ).fetchall()

        if not rows or len(rows) > 100:
            raise RuntimeError("Expected between 1 and 100 visible fixtures.")

        model = SentenceTransformer(
            MODEL_NAME,
            revision=revision,
            device="cpu",
            trust_remote_code=False,
            token=False,
            local_files_only=True,
            model_kwargs={"use_safetensors": True},
        )
        model.max_seq_length = 512

        embeddings = model.encode(
            [f"passage: {row[3]}" for row in rows],
            prompt="",
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )

        if embeddings.shape != (len(rows), 384):
            raise RuntimeError("Unexpected embedding batch shape.")

        # Publish only if each source still matches its encoded snapshot.
        with connection.transaction():
            connection.execute(
                """
                INSERT INTO ml.embedding_models (
                    model_version,
                    model_name,
                    model_revision,
                    dimensions,
                    preprocessing_version
                )
                VALUES (%s, %s, %s, 384, %s)
                ON CONFLICT (model_version) DO NOTHING
                """,
                (model_version, MODEL_NAME, revision, PREPROCESSING),
            )

            registered = connection.execute(
                """
                SELECT model_name, model_revision,
                       dimensions, preprocessing_version
                FROM ml.embedding_models
                WHERE model_version = %s
                FOR SHARE
                """,
                (model_version,),
            ).fetchone()

            if registered != (MODEL_NAME, revision, 384, PREPROCESSING):
                raise RuntimeError("Existing model registration differs.")

            for row, embedding in zip(rows, embeddings, strict=True):
                kind, entity_id, source_revision, text = row

                current = connection.execute(
                    """
                    SELECT source_revision, searchable_text, visibility
                    FROM ml.synthetic_entities
                    WHERE entity_kind = %s AND entity_id = %s
                    FOR UPDATE
                    """,
                    (kind, entity_id),
                ).fetchone()

                if current != (source_revision, text, "visible"):
                    raise RuntimeError("Source changed; indexing rolled back.")

                connection.execute(
                    """
                    INSERT INTO ml.synthetic_embeddings (
                        entity_kind,
                        entity_id,
                        source_revision,
                        model_version,
                        embedding
                    )
                    VALUES (%s, %s, %s, %s, %s::public.vector)
                    ON CONFLICT (entity_kind, entity_id, model_version)
                    DO UPDATE SET
                        source_revision = EXCLUDED.source_revision,
                        embedding = EXCLUDED.embedding,
                        embedded_at = CURRENT_TIMESTAMP
                    """,
                    (
                        kind,
                        entity_id,
                        source_revision,
                        model_version,
                        vector_literal(embedding),
                    ),
                )

        print(f"Stored embeddings for {len(rows)} visible synthetic records.")

        examples = [
            ("worker", "Someone to prepare drinks and serve cafe customers"),
            ("worker", "Someone to automate CSV data cleaning using Python"),
            ("job", "I have experience serving customers and preparing drinks"),
            ("job", "I can write Python scripts and process CSV datasets"),
        ]

        queries = model.encode(
            [f"query: {text}" for _, text in examples],
            prompt="",
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )

        if queries.shape != (len(examples), 384):
            raise RuntimeError("Unexpected query embedding shape.")

        for (kind, text), query in zip(examples, queries, strict=True):
            results = search_candidates(
                connection, kind, model_version, query
            )

            print(f"\nSynthetic {kind} search: {text}")

            for rank, (entity_id, source_revision, similarity) in enumerate(
                results, start=1
            ):
                print(
                    f"  {rank}. {entity_id} "
                    f"revision={source_revision} similarity={similarity:.4f}"
                )

    print("\nDemo finished. Similarity is not suitability or eligibility.")
    print("Live ingestion, authorization and frontend integration remain pending.")


if __name__ == "__main__":
    try:
        main()
    except psycopg.Error:
        raise SystemExit(
            "Database operation failed; check connectivity and database state."
        ) from None