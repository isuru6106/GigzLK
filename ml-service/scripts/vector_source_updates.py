"""Versioned source updates for the synthetic vector prototype."""

import re

import psycopg


class SourceRevisionConflict(ValueError):
    """The same source revision arrived with different contents."""


class DeletedEntityConflict(ValueError):
    """An update attempted to restore a deleted synthetic entity."""


def apply_source_update(
    connection: psycopg.Connection,
    *,
    entity_kind: str,
    entity_id: str,
    source_revision: int,
    visibility: str,
    searchable_text: str | None,
) -> str:
    """Apply one synthetic update within a transaction.

    Returns CREATED, UPDATED, DUPLICATE or STALE.
    Deleted identities cannot become visible again.
    """

    if not isinstance(entity_kind, str) or entity_kind not in {
        "job", "worker"
    }:
        raise ValueError("Unsupported entity kind.")

    if not isinstance(entity_id, str) or re.fullmatch(
        rf"synthetic-{entity_kind}-[a-z0-9-]+", entity_id
    ) is None:
        raise ValueError("Invalid synthetic entity ID.")

    if (
        type(source_revision) is not int
        or not 1 <= source_revision <= 9_223_372_036_854_775_807
    ):
        raise ValueError("Invalid source revision.")

    if not isinstance(visibility, str) or visibility not in {
        "visible", "hidden", "unknown", "deleted"
    }:
        raise ValueError("Unsupported visibility.")

    if visibility == "visible":
        if (
            not isinstance(searchable_text, str)
            or not 1 <= len(searchable_text.strip(" ")) <= 10000
        ):
            raise ValueError("Visible sources require valid searchable text.")
    elif searchable_text is not None:
        raise ValueError("Non-visible sources must not retain searchable text.")

    with connection.transaction():
        # A first delivery may itself be a deletion tombstone.
        inserted = connection.execute(
            """
            INSERT INTO ml.synthetic_entities (
                entity_kind, entity_id, source_revision,
                visibility, searchable_text
            )
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT DO NOTHING
            RETURNING entity_id
            """,
            (
                entity_kind, entity_id, source_revision,
                visibility, searchable_text,
            ),
        ).fetchone()

        if inserted is not None:
            return "CREATED"

        current = connection.execute(
            """
            SELECT source_revision, visibility, searchable_text
            FROM ml.synthetic_entities
            WHERE entity_kind = %s AND entity_id = %s
            FOR UPDATE
            """,
            (entity_kind, entity_id),
        ).fetchone()

        if current is None:
            raise RuntimeError("Source disappeared during update.")

        old_revision, old_visibility, old_text = current

        if source_revision < old_revision:
            return "STALE"

        if source_revision == old_revision:
            if (visibility, searchable_text) != (old_visibility, old_text):
                raise SourceRevisionConflict(
                    "Source revision has conflicting contents."
                )
            return "DUPLICATE"

        if old_visibility == "deleted" and visibility != "deleted":
            raise DeletedEntityConflict(
                "Deleted synthetic identities cannot be restored."
            )

        # Remove every model's vector before changing the referenced revision.
        # Both changes commit together or roll back together.
        connection.execute(
            """
            DELETE FROM ml.synthetic_embeddings
            WHERE entity_kind = %s AND entity_id = %s
            """,
            (entity_kind, entity_id),
        )

        connection.execute(
            """
            UPDATE ml.synthetic_entities
            SET source_revision = %s,
                visibility = %s,
                searchable_text = %s,
                updated_at = CURRENT_TIMESTAMP
            WHERE entity_kind = %s AND entity_id = %s
            """,
            (
                source_revision, visibility, searchable_text,
                entity_kind, entity_id,
            ),
        )

        return "UPDATED"