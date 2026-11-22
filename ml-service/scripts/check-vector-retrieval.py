"""Check retrieval using temporary synthetic numerical vectors."""

import runpy
from pathlib import Path
from uuid import uuid4

import numpy as np
import psycopg

from vector_db_credentials import read_vector_password
from vector_publication import publish_embeddings


ROOT = Path(__file__).resolve().parents[1]
demo = runpy.run_path(str(ROOT / "scripts/demo-vector-retrieval.py"))
search_candidates = demo["search_candidates"]


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    run_id = uuid4().hex
    worker_id = f"synthetic-worker-retrieval-{run_id}"
    job_id = f"synthetic-job-retrieval-{run_id}"
    model_version = f"retrieval-test-{run_id}"
    other_model_version = f"retrieval-other-test-{run_id}"

    # Synthetic unit vectors test database behavior, not model quality.
    query = np.zeros(384, dtype=np.float32)
    query[0] = 1.0

    password = read_vector_password()

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
        require(
            identity == ("gigzlk_vector_client", "gigzlk_vector_dev"),
            "Unexpected database identity.",
        )

        with connection.transaction(force_rollback=True):
            snapshots = [
                ("worker", worker_id, 1, "Synthetic worker retrieval probe."),
                ("job", job_id, 1, "Synthetic job retrieval probe."),
            ]

            for kind, entity_id, revision, text in snapshots:
                connection.execute(
                    """
                    INSERT INTO ml.synthetic_entities (
                        entity_kind, entity_id, source_revision,
                        visibility, searchable_text
                    )
                    VALUES (%s, %s, %s, 'visible', %s)
                    """,
                    (kind, entity_id, revision, text),
                )

            publish_embeddings(
                connection,
                rows=snapshots,
                embeddings=np.stack([query, query]),
                model_version=model_version,
                model_name="TEST_ONLY_NOT_A_REAL_MODEL",
                model_revision="0" * 40,
                preprocessing_version="synthetic-unit-vector-v1",
            )

            # The same worker also has a vector under a different model.
            publish_embeddings(
                connection,
                rows=[snapshots[0]],
                embeddings=np.stack([query]),
                model_version=other_model_version,
                model_name="TEST_ONLY_NOT_A_REAL_MODEL",
                model_revision="1" * 40,
                preprocessing_version="synthetic-unit-vector-v1",
            )

            for kind, candidate_id in (
                ("worker", worker_id),
                ("job", job_id),
            ):
                results = search_candidates(
                    connection, kind, model_version, query
                )
                require(
                    len(results) == 1
                    and results[0][0] == candidate_id
                    and results[0][1] == 1,
                    "Retrieval mixed candidate kinds or model versions.",
                )
                require(
                    np.isclose(results[0][2], 1.0),
                    "Identical vectors did not have similarity one.",
                )

            print("PASS: visible job and worker retrieval stay separate.")
            print("PASS: model-version isolation with multiple stored models.")

            missing_model = search_candidates(
                connection,
                "worker",
                f"retrieval-missing-{run_id}",
                query,
            )
            require(
                missing_model == [],
                "An absent model returned candidates.",
            )
            print("PASS: an absent model returns no candidates.")

            for state in ("hidden", "unknown", "deleted"):
                with connection.transaction(force_rollback=True):
                    # Deliberately retain vectors to test retrieval filtering.
                    connection.execute(
                        """
                        UPDATE ml.synthetic_entities
                        SET visibility = %s, searchable_text = NULL
                        WHERE entity_kind = 'worker' AND entity_id = %s
                        """,
                        (state, worker_id),
                    )

                    retained = connection.execute(
                        """
                        SELECT count(*)
                        FROM ml.synthetic_embeddings
                        WHERE entity_kind = 'worker' AND entity_id = %s
                        """,
                        (worker_id,),
                    ).fetchone()[0]
                    require(
                        retained == 2,
                        "Expected both test-model vectors to remain.",
                    )

                    for version in (model_version, other_model_version):
                        results = search_candidates(
                            connection, "worker", version, query
                        )
                        require(
                            results == [],
                            f"{state} candidate leaked into retrieval.",
                        )

                restored = search_candidates(
                    connection, "worker", model_version, query
                )
                require(
                    len(restored) == 1 and restored[0][0] == worker_id,
                    "Visibility-check rollback failed.",
                )
                print(
                    f"PASS: {state} candidate excluded despite retained vectors."
                )

        # The outer transaction rolls back sources, vectors and registrations.
        remaining_sources = connection.execute(
            """
            SELECT count(*)
            FROM ml.synthetic_entities
            WHERE (entity_kind = 'worker' AND entity_id = %s)
               OR (entity_kind = 'job' AND entity_id = %s)
            """,
            (worker_id, job_id),
        ).fetchone()[0]

        remaining_vectors = connection.execute(
            """
            SELECT count(*)
            FROM ml.synthetic_embeddings
            WHERE model_version IN (%s, %s)
            """,
            (model_version, other_model_version),
        ).fetchone()[0]

        remaining_models = connection.execute(
            """
            SELECT count(*)
            FROM ml.embedding_models
            WHERE model_version IN (%s, %s)
            """,
            (model_version, other_model_version),
        ).fetchone()[0]

        require(
            (remaining_sources, remaining_vectors, remaining_models)
            == (0, 0, 0),
            "Temporary retrieval records were not fully rolled back.",
        )

    print("All retrieval checks passed; temporary records rolled back.")


if __name__ == "__main__":
    try:
        main()
    except psycopg.Error as error:
        print("Database error type:", type(error).__name__)
        print("SQLSTATE:", error.sqlstate or "not available")
        print("Constraint:", error.diag.constraint_name or "not available")
        raise SystemExit("Database retrieval check failed.") from None