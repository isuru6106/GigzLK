"""Check synthetic embedding publication against concurrent source changes."""

from concurrent.futures import ThreadPoolExecutor
from getpass import getpass
from time import monotonic, sleep
from uuid import uuid4

import numpy as np
import psycopg

from vector_publication import SourceSnapshotChanged, publish_embeddings
from vector_source_updates import apply_source_update


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    password = getpass("Local vector client password: ")
    run_id = uuid4().hex
    prefix = f"synthetic-worker-publication-{run_id}"
    model_version = f"publication-race-test-{run_id}"
    batch_model_version = f"publication-batch-test-{run_id}"
    probe_ids = []

    # Explicitly synthetic numerical vectors, not model-generated embeddings.
    vector = np.zeros(384, dtype=np.float32)
    vector[0] = 1.0

    def connect():
        return psycopg.connect(
            host="127.0.0.1",
            port=5544,
            dbname="gigzlk_vector_dev",
            user="gigzlk_vector_client",
            password=password,
            connect_timeout=5,
            options="-c statement_timeout=15000 -c lock_timeout=12000",
            autocommit=True,
        )

    def update(connection, entity_id, revision, visibility, text):
        return apply_source_update(
            connection,
            entity_kind="worker",
            entity_id=entity_id,
            source_revision=revision,
            visibility=visibility,
            searchable_text=text,
        )

    def publish(connection, rows, version=model_version):
        return publish_embeddings(
            connection,
            rows=rows,
            embeddings=np.stack([vector for _ in rows]),
            model_version=version,
            model_name="TEST_ONLY_NOT_A_REAL_MODEL",
            model_revision="0" * 40,
            preprocessing_version="synthetic-unit-vector-v1",
        )

    def snapshot(entity_id):
        return ("worker", entity_id, 1, "Synthetic publication probe.")

    with connect() as inspection, connect() as leader, connect() as follower:
        for connection in (inspection, leader, follower):
            identity = connection.execute(
                "SELECT current_user, current_database()"
            ).fetchone()
            require(
                identity == ("gigzlk_vector_client", "gigzlk_vector_dev"),
                "Unexpected database identity.",
            )

        leader_pid = leader.info.backend_pid
        follower_pid = follower.info.backend_pid

        def create_source(suffix):
            entity_id = f"{prefix}-{suffix}"
            probe_ids.append(entity_id)
            outcome = update(
                inspection,
                entity_id,
                1,
                "visible",
                "Synthetic publication probe.",
            )
            require(outcome == "CREATED", "Probe creation failed.")
            return entity_id

        def read_source(entity_id):
            return inspection.execute(
                """
                SELECT source_revision, visibility, searchable_text
                FROM ml.synthetic_entities
                WHERE entity_kind = 'worker' AND entity_id = %s
                """,
                (entity_id,),
            ).fetchone()

        def embedding_count(entity_id):
            return inspection.execute(
                """
                SELECT count(*)
                FROM ml.synthetic_embeddings
                WHERE entity_kind = 'worker' AND entity_id = %s
                """,
                (entity_id,),
            ).fetchone()[0]

        def wait_for_block(future):
            deadline = monotonic() + 5

            while monotonic() < deadline:
                if future.done():
                    # Surface an unexpected database error immediately.
                    future.result()
                    raise RuntimeError(
                        "Concurrent operation completed without blocking."
                    )

                blocked = inspection.execute(
                    "SELECT %s = ANY(pg_blocking_pids(%s))",
                    (leader_pid, follower_pid),
                ).fetchone()[0]

                if blocked:
                    return

                sleep(0.02)

            raise RuntimeError("Expected database blocking was not observed.")

        try:
            # Register the shared test model before starting the races.
            seed_id = create_source("seed")
            require(
                publish(inspection, [snapshot(seed_id)]) == 1,
                "Test-model setup failed.",
            )

            with ThreadPoolExecutor(max_workers=1) as executor:
                for visibility in ("hidden", "unknown", "deleted"):
                    # Withdrawal owns the source lock first.
                    entity_id = create_source(f"{visibility}-withdrawal-first")

                    with leader.transaction():
                        require(
                            update(
                                leader, entity_id, 2, visibility, None
                            ) == "UPDATED",
                            "Withdrawal failed.",
                        )
                        future = executor.submit(
                            publish, follower, [snapshot(entity_id)]
                        )
                        wait_for_block(future)

                    # Withdrawal is now committed. The old snapshot must fail.
                    try:
                        future.result(timeout=20)
                    except SourceSnapshotChanged:
                        pass
                    else:
                        raise RuntimeError(
                            "Publication accepted a withdrawn source."
                        )

                    require(
                        read_source(entity_id) == (2, visibility, None),
                        "Withdrawal state changed unexpectedly.",
                    )
                    require(
                        embedding_count(entity_id) == 0,
                        "Withdrawal-first race retained an embedding.",
                    )
                    print(
                        f"PASS: {visibility} commits first; "
                        "old publication is rejected."
                    )

                    # Publication owns the source lock first.
                    entity_id = create_source(f"{visibility}-publication-first")

                    with leader.transaction():
                        require(
                            publish(leader, [snapshot(entity_id)]) == 1,
                            "Publication failed.",
                        )
                        future = executor.submit(
                            update,
                            follower,
                            entity_id,
                            2,
                            visibility,
                            None,
                        )
                        wait_for_block(future)

                    require(
                        future.result(timeout=20) == "UPDATED",
                        "Waiting withdrawal did not complete.",
                    )
                    require(
                        read_source(entity_id) == (2, visibility, None),
                        "Final withdrawal state is incorrect.",
                    )
                    require(
                        embedding_count(entity_id) == 0,
                        "Withdrawal did not remove the published embedding.",
                    )
                    print(
                        f"PASS: publication commits first; "
                        f"{visibility} removes its embedding."
                    )

                # A newer visible revision also invalidates the old snapshot.
                entity_id = create_source("newer-revision-first")

                with leader.transaction():
                    update(
                        leader, entity_id, 2, "visible", "New source revision."
                    )
                    future = executor.submit(
                        publish, follower, [snapshot(entity_id)]
                    )
                    wait_for_block(future)

                try:
                    future.result(timeout=20)
                except SourceSnapshotChanged:
                    pass
                else:
                    raise RuntimeError(
                        "Publication accepted an outdated source revision."
                    )

                require(
                    read_source(entity_id)
                    == (2, "visible", "New source revision."),
                    "Newer source revision was not preserved.",
                )
                require(
                    embedding_count(entity_id) == 0,
                    "Old snapshot produced an embedding.",
                )
                print("PASS: newer revision prevents stale publication.")

            # The first row sorts before the changed second row, so publication
            # writes one embedding before discovering the invalid snapshot.
            first_id = create_source("batch-a")
            second_id = create_source("batch-b")
            old_batch = [snapshot(first_id), snapshot(second_id)]

            update(inspection, second_id, 2, "hidden", None)

            try:
                publish(inspection, old_batch, batch_model_version)
            except SourceSnapshotChanged:
                pass
            else:
                raise RuntimeError("Changed batch was unexpectedly published.")

            require(
                embedding_count(first_id) == 0
                and embedding_count(second_id) == 0,
                "Failed batch left a partially published embedding.",
            )
            registered = inspection.execute(
                """
                SELECT count(*)
                FROM ml.embedding_models
                WHERE model_version = %s
                """,
                (batch_model_version,),
            ).fetchone()[0]
            require(
                registered == 0,
                "Failed batch retained its new model registration.",
            )
            print("PASS: failed batch rolls back embeddings and registration.")

        finally:
            # Unique IDs isolate cleanup from the existing seven fixtures.
            with inspection.transaction():
                for entity_id in probe_ids:
                    inspection.execute(
                        """
                        DELETE FROM ml.synthetic_embeddings
                        WHERE entity_kind = 'worker' AND entity_id = %s
                        """,
                        (entity_id,),
                    )
                    inspection.execute(
                        """
                        DELETE FROM ml.synthetic_entities
                        WHERE entity_kind = 'worker' AND entity_id = %s
                        """,
                        (entity_id,),
                    )

                inspection.execute(
                    """
                    DELETE FROM ml.embedding_models
                    WHERE model_version IN (%s, %s)
                    """,
                    (model_version, batch_model_version),
                )

        for entity_id in probe_ids:
            require(
                read_source(entity_id) is None,
                "Temporary source cleanup failed.",
            )
            require(
                embedding_count(entity_id) == 0,
                "Temporary embedding cleanup failed.",
            )

    print("All publication race checks passed; temporary records removed.")


if __name__ == "__main__":
    try:
        main()
    except psycopg.Error as error:
        print("Database error type:", type(error).__name__)
        print("SQLSTATE:", error.sqlstate or "not available")
        print("Constraint:", error.diag.constraint_name or "not available")
        print("Table:", error.diag.table_name or "not available")
        raise SystemExit("Publication race checks failed.") from None