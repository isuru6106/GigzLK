"""Transactional embedding publication for synthetic source snapshots."""

import re

import numpy as np
import psycopg


class SourceSnapshotChanged(RuntimeError):
    """A source no longer matches the snapshot used for embedding."""


def vector_literal(vector: np.ndarray) -> str:
    vector = np.asarray(vector)

    if vector.shape != (384,) or not np.isfinite(vector).all():
        raise ValueError("Invalid embedding.")

    if not np.isclose(np.linalg.norm(vector), 1.0, atol=1e-5):
        raise ValueError("Embedding is not normalized.")

    return "[" + ",".join(str(float(value)) for value in vector) + "]"


def publish_embeddings(
    connection: psycopg.Connection,
    *,
    rows,
    embeddings,
    model_version: str,
    model_name: str,
    model_revision: str,
    preprocessing_version: str,
) -> int:
    """Publish a complete batch or roll back the complete batch.

    Each source row contains:
    entity_kind, entity_id, source_revision, searchable_text.

    Model execution must happen before calling this function.
    """

    for value, maximum in (
        (model_version, 200),
        (model_name, 200),
        (preprocessing_version, 100),
    ):
        if not isinstance(value, str) or not 1 <= len(value.strip()) <= maximum:
            raise ValueError("Invalid model metadata.")

    if (
        not isinstance(model_revision, str)
        or re.fullmatch(r"[0-9a-f]{40}", model_revision) is None
    ):
        raise ValueError("Invalid model revision.")

    rows = list(rows)
    embeddings = np.asarray(embeddings)

    if not 1 <= len(rows) <= 100:
        raise ValueError("Expected between 1 and 100 source snapshots.")

    if embeddings.shape != (len(rows), 384):
        raise ValueError("Unexpected embedding batch shape.")

    prepared = []
    identities = set()

    for row, embedding in zip(rows, embeddings, strict=True):
        if len(row) != 4:
            raise ValueError("Invalid source snapshot.")

        kind, entity_id, revision, text = row

        if not isinstance(kind, str) or kind not in {"job", "worker"}:
            raise ValueError("Invalid entity kind.")

        if (
            not isinstance(entity_id, str)
            or re.fullmatch(
                rf"synthetic-{kind}-[a-z0-9-]+", entity_id
            ) is None
        ):
            raise ValueError("Invalid synthetic entity ID.")

        if (
            type(revision) is not int
            or not 1 <= revision <= 9_223_372_036_854_775_807
        ):
            raise ValueError("Invalid source revision.")

        if not isinstance(text, str) or not 1 <= len(text.strip(" ")) <= 10000:
            raise ValueError("Invalid source text.")

        identity = (kind, entity_id)
        if identity in identities:
            raise ValueError("Duplicate source snapshot in batch.")
        identities.add(identity)

        prepared.append(
            (kind, entity_id, revision, text, vector_literal(embedding))
        )

    # Consistent source-lock ordering across publication batches.
    prepared.sort(key=lambda item: (item[0], item[1]))

    with connection.transaction():
        connection.execute(
            """
            INSERT INTO ml.embedding_models (
                model_version, model_name, model_revision,
                dimensions, preprocessing_version
            )
            VALUES (%s, %s, %s, 384, %s)
            ON CONFLICT (model_version) DO NOTHING
            """,
            (
                model_version, model_name,
                model_revision, preprocessing_version,
            ),
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

        if registered != (
            model_name, model_revision, 384, preprocessing_version
        ):
            raise ValueError("Existing model registration differs.")

        for kind, entity_id, revision, text, literal in prepared:
            current = connection.execute(
                """
                SELECT source_revision, searchable_text, visibility
                FROM ml.synthetic_entities
                WHERE entity_kind = %s AND entity_id = %s
                FOR UPDATE
                """,
                (kind, entity_id),
            ).fetchone()

            if current != (revision, text, "visible"):
                raise SourceSnapshotChanged(
                    "Source changed; embedding publication rolled back."
                )

            connection.execute(
                """
                INSERT INTO ml.synthetic_embeddings (
                    entity_kind, entity_id, source_revision,
                    model_version, embedding
                )
                VALUES (%s, %s, %s, %s, %s::public.vector)
                ON CONFLICT (entity_kind, entity_id, model_version)
                DO UPDATE SET
                    source_revision = EXCLUDED.source_revision,
                    embedding = EXCLUDED.embedding,
                    embedded_at = CURRENT_TIMESTAMP
                """,
                (kind, entity_id, revision, model_version, literal),
            )

    return len(prepared)