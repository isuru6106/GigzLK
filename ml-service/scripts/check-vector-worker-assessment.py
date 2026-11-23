"""Check PostgreSQL worker retrieval, assessment and optional filtering."""

import runpy
import sys
from pathlib import Path
from uuid import uuid4

import numpy as np
import psycopg


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.synthetic_recommendations import (
    SyntheticWorkerRequest,
    assess_retrieved_workers,
)
from app.synthetic_suitability_filters import (
    SyntheticFilterOptions,
    filter_assessed_workers,
)
from vector_db_credentials import read_vector_password
from vector_publication import publish_embeddings
from vector_source_updates import apply_source_update


demo = runpy.run_path(str(ROOT / "scripts/demo-vector-retrieval.py"))
search_candidates = demo["search_candidates"]


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def check_filtering(response, mismatch_id):
    """Check filters using the assessed PostgreSQL retrieval results."""
    original = response.model_dump(mode="json")

    disabled_options = SyntheticFilterOptions()
    disabled = filter_assessed_workers(response, disabled_options)

    require(
        disabled.result.model_dump(mode="json") == original,
        "Disabled filters changed the assessment response.",
    )
    require(
        disabled.summary.model_dump()
        == {
            "input_count": 3,
            "returned_count": 3,
            "excluded_count": 0,
            "excluded_availability_mismatch_count": 0,
            "excluded_location_mismatch_count": 0,
        },
        "Disabled-filter counts are incorrect.",
    )
    require(
        disabled.filters.model_dump() == disabled_options.model_dump(),
        "Disabled filter options changed.",
    )
    print("PASS: disabled filters preserve all retrieved worker assessments.")

    expected_items = [
        item for item in response.items if item.worker_id != mismatch_id
    ]
    require(len(expected_items) == 2, "Unexpected worker filtering fixtures.")

    for availability, location in (
        (True, False),
        (False, True),
        (True, True),
    ):
        options = SyntheticFilterOptions(
            exclude_availability_mismatch=availability,
            exclude_location_mismatch=location,
        )
        options_before = options.model_dump()
        filtered = filter_assessed_workers(response, options)

        require(
            filtered.policy_version == "synthetic-known-mismatches-v1",
            "Unexpected filtering policy.",
        )
        require(
            filtered.filters.model_dump() == options_before
            and options.model_dump() == options_before,
            "Filtering changed the supplied options.",
        )
        require(
            filtered.summary.model_dump()
            == {
                "input_count": 3,
                "returned_count": 2,
                "excluded_count": 1,
                "excluded_availability_mismatch_count": int(availability),
                "excluded_location_mismatch_count": int(location),
            },
            "Worker exclusion counts are incorrect.",
        )
        require(
            [item.rank for item in filtered.result.items] == [1, 2],
            "Filtered worker ranks are not consecutive.",
        )

        for rank, (actual, expected) in enumerate(
            zip(filtered.result.items, expected_items, strict=True),
            start=1,
        ):
            expected_data = expected.model_dump(mode="json")
            expected_data["rank"] = rank

            require(
                actual.model_dump(mode="json") == expected_data,
                "Filtering changed worker order, metadata or assessments.",
            )

        require(
            filtered.result.model_dump(
                mode="json", exclude={"items", "warnings"}
            )
            == response.model_dump(
                mode="json", exclude={"items", "warnings"}
            ),
            "Filtering changed worker response metadata.",
        )
        require(
            set(response.warnings).issubset(filtered.result.warnings)
            and "SYNTHETIC_FILTERS_NOT_DOMAIN_ELIGIBILITY"
            in filtered.result.warnings
            and "FILTERED_RETRIEVED_POOL_NOT_EXHAUSTIVE"
            in filtered.result.warnings,
            "Required filtering warnings are missing.",
        )

        incomplete = filtered.result.items[-1].assessment
        require(
            incomplete.assessment_status == "INCOMPLETE"
            and incomplete.overall_score is None
            and incomplete.factors.availability.score is None
            and incomplete.factors.location.score is None,
            "Unknown worker information was treated as a mismatch.",
        )

        type(filtered).model_validate_json(filtered.model_dump_json())

    require(
        response.model_dump(mode="json") == original,
        "Filtering mutated the original worker response.",
    )
    print("PASS: worker filters preserve semantic order, metadata and unknowns.")
    print("PASS: worker exclusion counts, ranks and serialization are correct.")

    mismatch = next(
        item for item in response.items if item.worker_id == mismatch_id
    )
    mismatch_only = response.model_copy(
        update={
            "items": [mismatch.model_copy(update={"rank": 1}, deep=True)]
        },
        deep=True,
    )
    empty = filter_assessed_workers(
        mismatch_only,
        SyntheticFilterOptions(
            exclude_availability_mismatch=True,
            exclude_location_mismatch=True,
        ),
    )

    require(
        empty.result.items == []
        and empty.summary.model_dump()
        == {
            "input_count": 1,
            "returned_count": 0,
            "excluded_count": 1,
            "excluded_availability_mismatch_count": 1,
            "excluded_location_mismatch_count": 1,
        },
        "Filtering all workers did not produce the expected empty result.",
    )
    type(empty).model_validate_json(empty.model_dump_json())

    require(
        response.model_dump(mode="json") == original,
        "Empty-result filtering mutated the original worker response.",
    )
    print("PASS: filtering all retrieved workers returns an empty pool.")


def main():
    suffix = uuid4().hex
    job_id = f"synthetic-job-assessment-{suffix}"
    model_version = f"worker-assessment-test-{suffix}"

    worker_ids = {
        name: f"synthetic-worker-assessment-{name}-{suffix}"
        for name in ("complete", "mismatch", "incomplete", "hidden")
    }

    job = {
        "job_id": job_id,
        "required_skills": ["synthetic-skill-service"],
        "minimum_experience_months": 6,
        "starts_at": "2026-12-01T09:00:00+05:30",
        "ends_at": "2026-12-01T17:00:00+05:30",
        "remote": False,
        "location_id": "synthetic-location-colombo",
    }

    # Explicit synthetic facts, not facts inferred from descriptions.
    workers = {
        worker_ids["complete"]: {
            "worker_id": worker_ids["complete"],
            "skills": ["synthetic-skill-service"],
            "relevant_experience_months": 12,
            "available_from": "2026-12-01T08:00:00+05:30",
            "available_until": "2026-12-01T18:00:00+05:30",
            "location_id": "synthetic-location-colombo",
        },
        worker_ids["mismatch"]: {
            "worker_id": worker_ids["mismatch"],
            "skills": ["synthetic-skill-service"],
            "relevant_experience_months": 12,
            "available_from": "2026-12-01T10:00:00+05:30",
            "available_until": "2026-12-01T18:00:00+05:30",
            "location_id": "synthetic-location-kandy",
        },
        worker_ids["incomplete"]: {
            "worker_id": worker_ids["incomplete"],
        },
    }

    query = np.zeros(384, dtype=np.float32)
    query[0] = 1.0

    def unit_vector(first):
        vector = np.zeros(384, dtype=np.float32)
        vector[0] = first
        vector[1] = np.sqrt(1.0 - first * first)
        return vector

    vectors = [
        unit_vector(1.0),
        unit_vector(0.8),
        unit_vector(0.6),
        unit_vector(1.0),
    ]

    source_ids = [job_id, *worker_ids.values()]
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
            apply_source_update(
                connection,
                entity_kind="job",
                entity_id=job_id,
                source_revision=1,
                visibility="visible",
                searchable_text="Synthetic assessment job.",
            )

            snapshots = []

            for name, worker_id in worker_ids.items():
                text = f"Synthetic {name} worker assessment probe."

                apply_source_update(
                    connection,
                    entity_kind="worker",
                    entity_id=worker_id,
                    source_revision=1,
                    visibility="visible",
                    searchable_text=text,
                )
                snapshots.append(("worker", worker_id, 1, text))

            publish_embeddings(
                connection,
                rows=snapshots,
                embeddings=np.stack(vectors),
                model_version=model_version,
                model_name="TEST_ONLY_NOT_A_REAL_MODEL",
                model_revision="0" * 40,
                preprocessing_version="synthetic-unit-vector-v1",
            )

            # Retain this vector deliberately to exercise visibility filtering.
            connection.execute(
                """
                UPDATE ml.synthetic_entities
                SET visibility = 'hidden', searchable_text = NULL
                WHERE entity_kind = 'worker' AND entity_id = %s
                """,
                (worker_ids["hidden"],),
            )
            retained = connection.execute(
                """
                SELECT count(*)
                FROM ml.synthetic_embeddings
                WHERE entity_kind = 'worker'
                  AND entity_id = %s
                  AND model_version = %s
                """,
                (worker_ids["hidden"], model_version),
            ).fetchone()[0]
            require(retained == 1, "Hidden worker vector was not retained.")

            retrieved = search_candidates(
                connection, "worker", model_version, query
            )
            expected_ids = [
                worker_ids["complete"],
                worker_ids["mismatch"],
                worker_ids["incomplete"],
            ]
            require(
                [row[0] for row in retrieved] == expected_ids,
                "Unexpected retrieved candidates or order.",
            )
            print("PASS: actual retrieval excludes the hidden worker.")

            candidates = []

            for worker_id, revision, similarity in retrieved:
                require(
                    worker_id in workers and revision == 1,
                    "No matching structured fixture for retrieved revision.",
                )
                candidates.append(
                    {
                        "worker": workers[worker_id],
                        "worker_source_revision": revision,
                        "semantic_similarity": similarity,
                    }
                )

            request = SyntheticWorkerRequest.model_validate(
                {
                    "job": job,
                    "job_source_revision": 1,
                    "embedding_model_version": model_version,
                    "candidates": candidates,
                }
            )
            request_before = request.model_dump(mode="json")
            response = assess_retrieved_workers(request)

            require(
                request.model_dump(mode="json") == request_before,
                "Assessment mutated the supplied worker fixtures.",
            )
            require(
                [item.worker_id for item in response.items] == expected_ids,
                "Assessment changed semantic candidate order.",
            )
            require(
                [item.rank for item in response.items] == [1, 2, 3],
                "Unexpected result ranks.",
            )
            require(
                response.job_id == job_id
                and response.job_source_revision == 1
                and response.embedding_model_version == model_version,
                "Worker response metadata changed.",
            )

            for item, retrieved_row in zip(
                response.items, retrieved, strict=True
            ):
                require(
                    item.worker_source_revision == retrieved_row[1]
                    and item.semantic_similarity == retrieved_row[2],
                    "Retrieved metadata changed during assessment.",
                )
                require(
                    item.assessment.worker_id == item.worker_id
                    and item.assessment.job_id == job_id,
                    "Assessment was attached to the wrong entity.",
                )

            print("PASS: retrieval IDs, revisions and similarities are preserved.")

            complete, mismatch, incomplete = response.items

            require(
                complete.assessment.overall_score == 100,
                "Complete worker assessment is incorrect.",
            )
            require(
                mismatch.assessment.overall_score == 70
                and "AVAILABILITY_MISMATCH" in mismatch.assessment.warnings
                and "LOCATION_MISMATCH" in mismatch.assessment.warnings,
                "Known mismatches were lost.",
            )
            require(
                incomplete.assessment.overall_score is None
                and incomplete.assessment.assessment_status == "INCOMPLETE"
                and incomplete.assessment.missing_fields,
                "Unknown information was replaced with a score.",
            )
            print("PASS: complete, mismatched and incomplete assessments survive.")

            response.model_dump_json()
            print("PASS: assessed results serialize successfully.")

            check_filtering(response, worker_ids["mismatch"])

            require(
                request.model_dump(mode="json") == request_before,
                "The filtering pipeline mutated the supplied worker request.",
            )

        remaining_sources = connection.execute(
            """
            SELECT count(*)
            FROM ml.synthetic_entities
            WHERE entity_id = ANY(%s)
            """,
            (source_ids,),
        ).fetchone()[0]

        remaining_vectors = connection.execute(
            """
            SELECT count(*)
            FROM ml.synthetic_embeddings
            WHERE model_version = %s
            """,
            (model_version,),
        ).fetchone()[0]

        remaining_models = connection.execute(
            """
            SELECT count(*)
            FROM ml.embedding_models
            WHERE model_version = %s
            """,
            (model_version,),
        ).fetchone()[0]

        require(
            (remaining_sources, remaining_vectors, remaining_models)
            == (0, 0, 0),
            "Temporary worker-assessment records were not fully rolled back.",
        )

    print(
        "All worker-assessment and filtering checks passed; "
        "temporary records rolled back."
    )


if __name__ == "__main__":
    try:
        main()
    except psycopg.Error as error:
        print("Database error type:", type(error).__name__)
        print("SQLSTATE:", error.sqlstate or "not available")
        print("Constraint:", error.diag.constraint_name or "not available")
        raise SystemExit("Worker-assessment database check failed.") from None