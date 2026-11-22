"""Check actual retrieval against transactional synthetic state changes."""

import json
import runpy
from getpass import getpass
from pathlib import Path

import numpy as np
import psycopg


ROOT = Path(__file__).resolve().parents[1]
demo = runpy.run_path(str(ROOT / "scripts/demo-vector-retrieval.py"))
search_candidates = demo["search_candidates"]


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    manifest = json.loads(
        (ROOT / "vector-model.json").read_text(encoding="utf-8")
    )
    model_version = (
        f"e5-small-{manifest['model_revision']}-"
        f"{manifest['preprocessing_version']}"
    )
    candidate_id = "synthetic-worker-hospitality"
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
        stored = connection.execute(
            """
            SELECT embedding::text
            FROM ml.synthetic_embeddings
            WHERE entity_kind = 'worker'
              AND entity_id = %s
              AND model_version = %s
            """,
            (candidate_id, model_version),
        ).fetchone()
        require(stored is not None, "Run the indexing demo first.")
        query = np.asarray(json.loads(stored[0]), dtype=np.float32)

        visible = search_candidates(
            connection, "worker", model_version, query
        )
        require(
            visible and visible[0][0] == candidate_id,
            "Visible candidate was not retrieved first.",
        )

        other_model = search_candidates(
            connection, "worker", "synthetic-unregistered-model", query
        )
        require(other_model == [], "Model versions were mixed.")

        for state in ("hidden", "unknown", "deleted"):
            # Restore the original fixture automatically after each check.
            with connection.transaction(force_rollback=True):
                connection.execute(
                    """
                    UPDATE ml.synthetic_entities
                    SET visibility = %s, searchable_text = NULL
                    WHERE entity_kind = 'worker' AND entity_id = %s
                    """,
                    (state, candidate_id),
                )

                retained = connection.execute(
                    """
                    SELECT count(*)
                    FROM ml.synthetic_embeddings
                    WHERE entity_kind = 'worker'
                      AND entity_id = %s
                      AND model_version = %s
                    """,
                    (candidate_id, model_version),
                ).fetchone()
                require(
                    retained == (1,),
                    "Expected an existing vector for withdrawal testing.",
                )

                results = search_candidates(
                    connection, "worker", model_version, query
                )
                require(
                    candidate_id not in [row[0] for row in results],
                    f"{state} candidate leaked into retrieval.",
                )

            print(f"PASS: {state} candidate excluded despite retained vector.")

        restored = search_candidates(
            connection, "worker", model_version, query
        )
        require(
            restored and restored[0][0] == candidate_id,
            "Fixture rollback failed.",
        )

    print("PASS: visible retrieval and model-version isolation.")
    print("All retrieval checks passed; fixture changes rolled back.")


if __name__ == "__main__":
    try:
        main()
    except psycopg.Error:
        raise SystemExit("Database retrieval check failed.") from None