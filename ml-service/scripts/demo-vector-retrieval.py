"""Synthetic-only embedding storage and semantic retrieval demonstration."""

import json
import re
from getpass import getpass
from pathlib import Path

import psycopg
from sentence_transformers import SentenceTransformer

from vector_publication import publish_embeddings, vector_literal


ROOT = Path(__file__).resolve().parents[1]
MODEL_NAME = "intfloat/multilingual-e5-small"
PREPROCESSING = "e5-prefix-normalized-v1"


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

        # Autocommit keeps model execution outside a database transaction.
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

        # The helper revalidates and locks sources before publication.
        # Any changed snapshot causes the entire publication to roll back.
        published = publish_embeddings(
            connection,
            rows=rows,
            embeddings=embeddings,
            model_version=model_version,
            model_name=MODEL_NAME,
            model_revision=revision,
            preprocessing_version=PREPROCESSING,
        )

        print(
            f"Stored embeddings for {published} visible synthetic records."
        )

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