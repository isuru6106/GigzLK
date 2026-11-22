"""Transactional PostgreSQL checks for synthetic source updates."""

from getpass import getpass
from uuid import uuid4

import psycopg

from vector_source_updates import (
    DeletedEntityConflict,
    SourceRevisionConflict,
    apply_source_update,
)


class DeliberateRollback(Exception):
    pass


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    password = getpass("Local vector client password: ")
    suffix = uuid4().hex
    entity_id = f"synthetic-worker-update-probe-{suffix}"
    deleted_id = f"synthetic-worker-deletion-first-{suffix}"

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
        seed = connection.execute(
            """
            SELECT model_version, embedding::text
            FROM ml.synthetic_embeddings
            ORDER BY entity_kind, entity_id, model_version
            LIMIT 1
            """
        ).fetchone()
        require(seed is not None, "Run the vector retrieval demo first.")
        model_version, embedding = seed

        def update(revision, state="visible", text="Synthetic probe.", id_=None):
            return apply_source_update(
                connection,
                entity_kind="worker",
                entity_id=id_ or entity_id,
                source_revision=revision,
                visibility=state,
                searchable_text=text,
            )

        def state():
            return connection.execute(
                """
                SELECT source_revision, visibility, searchable_text
                FROM ml.synthetic_entities
                WHERE entity_kind = 'worker' AND entity_id = %s
                """,
                (entity_id,),
            ).fetchone()

        def vector_count():
            return connection.execute(
                """
                SELECT count(*)
                FROM ml.synthetic_embeddings
                WHERE entity_kind = 'worker' AND entity_id = %s
                """,
                (entity_id,),
            ).fetchone()[0]

        def attach_vector(revision):
            # Reuse a stored vector to test persistence, not model quality.
            connection.execute(
                """
                INSERT INTO ml.synthetic_embeddings (
                    entity_kind, entity_id, source_revision,
                    model_version, embedding
                )
                VALUES ('worker', %s, %s, %s, %s::public.vector)
                """,
                (entity_id, revision, model_version, embedding),
            )

        with connection.transaction(force_rollback=True):
            require(update(1) == "CREATED", "Initial creation failed.")
            attach_vector(1)

            require(update(1) == "DUPLICATE", "Duplicate not recognized.")
            require(vector_count() == 1, "Duplicate removed the vector.")

            try:
                update(1, text="Conflicting content.")
            except SourceRevisionConflict:
                pass
            else:
                raise RuntimeError("Conflicting equal revision was accepted.")

            require(state() == (1, "visible", "Synthetic probe."),
                    "Conflict changed source state.")
            require(vector_count() == 1, "Conflict changed embeddings.")
            print("PASS: exact duplicate and conflicting revision handling.")

            require(update(2, text="Updated probe.") == "UPDATED",
                    "Newer visible update failed.")
            require(vector_count() == 0,
                    "Newer update retained an obsolete vector.")
            attach_vector(2)

            require(update(1) == "STALE", "Older update was not ignored.")
            require(state() == (2, "visible", "Updated probe."),
                    "Older update changed the source.")
            require(vector_count() == 1, "Older update changed embeddings.")
            print("PASS: newer revisions invalidate vectors; stale updates do not.")

            # A caller transaction failure must restore source and vector.
            try:
                with connection.transaction():
                    require(update(3, "hidden", None) == "UPDATED",
                            "Rollback probe update failed.")
                    require(vector_count() == 0,
                            "Rollback probe did not delete the vector.")
                    raise DeliberateRollback()
            except DeliberateRollback:
                pass

            require(state() == (2, "visible", "Updated probe."),
                    "Rollback did not restore the source.")
            require(vector_count() == 1,
                    "Rollback did not restore the embedding.")
            print("PASS: source and embedding deletion roll back together.")

            for revision, visibility in ((3, "hidden"), (5, "unknown")):
                require(update(revision, visibility, None) == "UPDATED",
                        f"{visibility} withdrawal failed.")
                require(vector_count() == 0,
                        f"{visibility} withdrawal retained embeddings.")
                require(state() == (revision, visibility, None),
                        f"{visibility} withdrawal retained text.")

                if visibility == "hidden":
                    require(update(4, text="Visible again.") == "UPDATED",
                            "Newer visibility restoration failed.")
                    attach_vector(4)

            print("PASS: hidden and unknown withdrawals remove text and vectors.")

            require(update(6, "deleted", None) == "UPDATED",
                    "Deletion failed.")
            require(update(5, "visible", "Old content.") == "STALE",
                    "Old content bypassed the tombstone.")

            try:
                update(7, "visible", "Attempted resurrection.")
            except DeletedEntityConflict:
                pass
            else:
                raise RuntimeError("Deleted identity was resurrected.")

            require(state() == (6, "deleted", None),
                    "Deletion tombstone changed unexpectedly.")
            print("PASS: deletion tombstone prevents resurrection.")

            require(update(10, "deleted", None, deleted_id) == "CREATED",
                    "Deletion-first delivery failed.")
            require(update(9, "visible", "Late creation.", deleted_id) == "STALE",
                    "Late creation bypassed deletion-first tombstone.")

            try:
                update(11, "visible", "New creation.", deleted_id)
            except DeletedEntityConflict:
                pass
            else:
                raise RuntimeError("Deletion-first identity was resurrected.")

            print("PASS: deletion arriving before creation remains authoritative.")

        remaining = connection.execute(
            """
            SELECT count(*)
            FROM ml.synthetic_entities
            WHERE entity_id IN (%s, %s)
            """,
            (entity_id, deleted_id),
        ).fetchone()[0]
        require(remaining == 0, "Temporary probe records remain.")

    print("All source-update checks passed; temporary changes rolled back.")


if __name__ == "__main__":
    try:
        main()
    except psycopg.Error:
        raise SystemExit(
            "Database source-update check failed."
        ) from None