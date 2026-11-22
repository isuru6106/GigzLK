"""Check synthetic source-update races using independent connections."""

from concurrent.futures import ThreadPoolExecutor
from getpass import getpass
from threading import Barrier
from uuid import uuid4

import psycopg

from vector_source_updates import apply_source_update


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    password = getpass("Local vector client password: ")
    prefix = f"synthetic-worker-concurrency-{uuid4().hex}"
    probe_ids = [
        f"{prefix}-duplicate",
        f"{prefix}-revision",
        f"{prefix}-deletion",
    ]

    def connect():
        return psycopg.connect(
            host="127.0.0.1",
            port=5544,
            dbname="gigzlk_vector_dev",
            user="gigzlk_vector_client",
            password=password,
            connect_timeout=5,
            options="-c statement_timeout=5000 -c lock_timeout=3000",
            autocommit=True,
        )

    def race(entity_id, updates):
        barrier = Barrier(2)

        def submit(update):
            revision, visibility, text = update

            with connect() as connection:
                barrier.wait(timeout=10)

                return apply_source_update(
                    connection,
                    entity_kind="worker",
                    entity_id=entity_id,
                    source_revision=revision,
                    visibility=visibility,
                    searchable_text=text,
                )

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [
                executor.submit(submit, update)
                for update in updates
            ]
            return [
                future.result(timeout=20)
                for future in futures
            ]

    with connect() as inspection:

        def read(entity_id):
            return inspection.execute(
                """
                SELECT source_revision, visibility, searchable_text
                FROM ml.synthetic_entities
                WHERE entity_kind = 'worker' AND entity_id = %s
                """,
                (entity_id,),
            ).fetchone()

        try:
            # Concurrent first deliveries of the same revision.
            outcomes = race(
                probe_ids[0],
                [
                    (1, "visible", "Duplicate probe."),
                    (1, "visible", "Duplicate probe."),
                ],
            )

            require(
                sorted(outcomes) == ["CREATED", "DUPLICATE"],
                f"Unexpected duplicate outcomes: {outcomes}",
            )
            require(
                read(probe_ids[0]) == (
                    1,
                    "visible",
                    "Duplicate probe.",
                ),
                "Concurrent duplicate changed source contents.",
            )
            print("PASS: concurrent identical creation has one winner.")

            # Either ordering must leave the highest source revision.
            race(
                probe_ids[1],
                [
                    (2, "visible", "Revision two."),
                    (3, "visible", "Revision three."),
                ],
            )

            require(
                read(probe_ids[1]) == (
                    3,
                    "visible",
                    "Revision three.",
                ),
                "Concurrent delivery lost the newer revision.",
            )
            print("PASS: concurrent revisions preserve the newest state.")

            # An older visible delivery cannot undo a newer deletion.
            race(
                probe_ids[2],
                [
                    (5, "visible", "Older visible record."),
                    (6, "deleted", None),
                ],
            )

            require(
                read(probe_ids[2]) == (6, "deleted", None),
                "Concurrent delivery bypassed the deletion tombstone.",
            )
            print(
                "PASS: concurrent deletion defeats an older visible update."
            )

        finally:
            # Remove only the exact test identities from this invocation.
            inspection.execute(
                """
                DELETE FROM ml.synthetic_entities
                WHERE entity_kind = 'worker'
                  AND entity_id IN (%s, %s, %s)
                """,
                tuple(probe_ids),
            )

        remaining = inspection.execute(
            """
            SELECT count(*)
            FROM ml.synthetic_entities
            WHERE entity_id IN (%s, %s, %s)
            """,
            tuple(probe_ids),
        ).fetchone()[0]

        require(remaining == 0, "Concurrency probe cleanup failed.")

    print("All concurrency checks passed; probe records removed.")


if __name__ == "__main__":
    try:
        main()
    except psycopg.Error as error:
        print("Database error type:", type(error).__name__)
        print("SQLSTATE:", error.sqlstate or "not available")
        print("Constraint:", error.diag.constraint_name or "not available")
        print("Table:", error.diag.table_name or "not available")
        raise SystemExit("Database concurrency check failed.") from None