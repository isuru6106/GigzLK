"""Check PostgreSQL job retrieval, assessment and optional filtering."""

import runpy
import sys
from pathlib import Path
from uuid import uuid4

import numpy as np
import psycopg


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.synthetic_job_recommendations import (
    SyntheticJobRequest,
    assess_retrieved_jobs,
)
from app.synthetic_suitability_filters import (
    SyntheticFilterOptions,
    filter_assessed_jobs,
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
    disabled = filter_assessed_jobs(response, disabled_options)

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
    print("PASS: disabled filters preserve all retrieved job assessments.")

    expected_items = [
        item for item in response.items if item.job_id != mismatch_id
    ]
    require(len(expected_items) == 2, "Unexpected job filtering fixtures.")

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
        filtered = filter_assessed_jobs(response, options)

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
            "Job exclusion counts are incorrect.",
        )
        require(
            [item.rank for item in filtered.result.items] == [1, 2],
            "Filtered job ranks are not consecutive.",
        )

        for rank, (actual, expected) in enumerate(
            zip(filtered.result.items, expected_items, strict=True),
            start=1,
        ):
            expected_data = expected.model_dump(mode="json")
            expected_data["rank"] = rank

            require(
                actual.model_dump(mode="json") == expected_data,
                "Filtering changed job order, metadata or assessments.",
            )

        require(
            filtered.result.model_dump(
                mode="json", exclude={"items", "warnings"}
            )
            == response.model_dump(
                mode="json", exclude={"items", "warnings"}
            ),
            "Filtering changed job response metadata.",
        )
        require(
            set(response.warnings).issubset(filtered.result.warnings)
            and "SYNTHETIC_FILTERS_NOT_DOMAIN_ELIGIBILITY"
            in filtered.result.warnings
            and "FILTERED_RETRIEVED_POOL_NOT_EXHAUSTIVE"
            in filtered.result.warnings,
            "Required filtering warnings are missing.",
        )

        unknown = filtered.result.items[-1].assessment
        require(
            unknown.assessment_status == "INCOMPLETE"
            and unknown.overall_score is None
            and unknown.factors.experience.score is None
            and "worker.relevant_experience_months"
            in unknown.missing_fields,
            "Filtering lost unknown job-specific experience.",
        )

        type(filtered).model_validate_json(filtered.model_dump_json())

    require(
        response.model_dump(mode="json") == original,
        "Filtering mutated the original job response.",
    )
    print("PASS: job filters preserve semantic order, metadata and unknowns.")
    print("PASS: job exclusion counts, ranks and serialization are correct.")

    mismatch = next(
        item for item in response.items if item.job_id == mismatch_id
    )
    mismatch_only = response.model_copy(
        update={
            "items": [mismatch.model_copy(update={"rank": 1}, deep=True)]
        },
        deep=True,
    )
    empty = filter_assessed_jobs(
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
        "Filtering all jobs did not produce the expected empty result.",
    )
    type(empty).model_validate_json(empty.model_dump_json())

    require(
        response.model_dump(mode="json") == original,
        "Empty-result filtering mutated the original job response.",
    )
    print("PASS: filtering all retrieved jobs returns an empty pool.")


def main():
    suffix = uuid4().hex
    worker_id = f"synthetic-worker-job-assessment-{suffix}"
    model_version = f"job-assessment-test-{suffix}"

    job_ids = {
        name: f"synthetic-job-assessment-{name}-{suffix}"
        for name in ("experienced", "zero", "unknown", "hidden")
    }

    worker = {
        "worker_id": worker_id,
        "skills": ["synthetic-skill-service"],
        "available_from": "2026-12-01T08:00:00+05:30",
        "available_until": "2026-12-01T18:00:00+05:30",
        "location_id": "synthetic-location-colombo",
    }

    # Explicit synthetic facts, not facts inferred from descriptions.
    jobs = {
        job_ids[name]: {
            "job_id": job_ids[name],
            "required_skills": ["synthetic-skill-service"],
            "minimum_experience_months": 6,
            "starts_at": "2026-12-01T09:00:00+05:30",
            "ends_at": "2026-12-01T17:00:00+05:30",
            "remote": False,
            "location_id": "synthetic-location-colombo",
        }
        for name in ("experienced", "zero", "unknown")
    }

    # The zero-experience candidate also has known schedule/location
    # mismatches so the retrieved pool exercises both optional filters.
    jobs[job_ids["zero"]].update(
        {
            "starts_at": "2026-12-01T07:00:00+05:30",
            "location_id": "synthetic-location-kandy",
        }
    )

    experience_by_job = {
        job_ids["experienced"]: 12,
        job_ids["zero"]: 0,
        job_ids["unknown"]: None,
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

    source_ids = [worker_id, *job_ids.values()]
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
                entity_kind="worker",
                entity_id=worker_id,
                source_revision=1,
                visibility="visible",
                searchable_text="Synthetic job-assessment worker.",
            )

            snapshots = []

            for name, job_id in job_ids.items():
                text = f"Synthetic {name} job assessment probe."

                apply_source_update(
                    connection,
                    entity_kind="job",
                    entity_id=job_id,
                    source_revision=1,
                    visibility="visible",
                    searchable_text=text,
                )
                snapshots.append(("job", job_id, 1, text))

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
                WHERE entity_kind = 'job' AND entity_id = %s
                """,
                (job_ids["hidden"],),
            )
            retained = connection.execute(
                """
                SELECT count(*)
                FROM ml.synthetic_embeddings
                WHERE entity_kind = 'job'
                  AND entity_id = %s
                  AND model_version = %s
                """,
                (job_ids["hidden"], model_version),
            ).fetchone()[0]
            require(retained == 1, "Hidden job vector was not retained.")

            retrieved = search_candidates(
                connection, "job", model_version, query
            )
            expected_ids = [
                job_ids["experienced"],
                job_ids["zero"],
                job_ids["unknown"],
            ]
            require(
                [row[0] for row in retrieved] == expected_ids,
                "Unexpected retrieved jobs or order.",
            )
            print("PASS: actual retrieval excludes the hidden job.")

            candidates = []

            for job_id, revision, similarity in retrieved:
                require(
                    job_id in jobs
                    and job_id in experience_by_job
                    and revision == 1,
                    "No matching structured fixture for retrieved revision.",
                )
                candidates.append(
                    {
                        "job": jobs[job_id],
                        "job_source_revision": revision,
                        "semantic_similarity": similarity,
                        "relevant_experience_months": experience_by_job[job_id],
                    }
                )

            request = SyntheticJobRequest.model_validate(
                {
                    "worker": worker,
                    "worker_source_revision": 1,
                    "embedding_model_version": model_version,
                    "candidates": candidates,
                }
            )
            request_before = request.model_dump(mode="json")
            response = assess_retrieved_jobs(request)

            require(
                request.model_dump(mode="json") == request_before,
                "Assessment mutated the supplied job fixtures.",
            )
            require(
                [item.job_id for item in response.items] == expected_ids,
                "Assessment changed semantic job order.",
            )
            require(
                [item.rank for item in response.items] == [1, 2, 3],
                "Unexpected result ranks.",
            )
            require(
                response.worker_id == worker_id
                and response.worker_source_revision == 1
                and response.embedding_model_version == model_version,
                "Job response metadata changed.",
            )

            for item, retrieved_row in zip(
                response.items, retrieved, strict=True
            ):
                require(
                    item.job_source_revision == retrieved_row[1]
                    and item.semantic_similarity == retrieved_row[2],
                    "Retrieved metadata changed during assessment.",
                )
                require(
                    item.assessment.job_id == item.job_id
                    and item.assessment.worker_id == worker_id,
                    "Assessment was attached to the wrong entity.",
                )

            print("PASS: retrieval IDs, revisions and similarities are preserved.")

            experienced, zero, unknown = response.items

            require(
                experienced.assessment.factors.experience.score == 100
                and experienced.assessment.overall_score == 100,
                "Job-specific experience was not applied.",
            )
            require(
                zero.assessment.factors.experience.score == 0
                and zero.assessment.overall_score == 50
                and zero.assessment.assessment_status == "COMPLETE"
                and "AVAILABILITY_MISMATCH" in zero.assessment.warnings
                and "LOCATION_MISMATCH" in zero.assessment.warnings,
                "Known zero experience or mismatches were treated incorrectly.",
            )
            require(
                unknown.assessment.factors.experience.score is None
                and unknown.assessment.overall_score is None
                and unknown.assessment.assessment_status == "INCOMPLETE"
                and "worker.relevant_experience_months"
                in unknown.assessment.missing_fields,
                "Unknown experience was copied or replaced with zero.",
            )
            print("PASS: per-job experience remains distinct from zero and unknown.")

            response.model_dump_json()
            print("PASS: assessed job results serialize without mutating inputs.")

            check_filtering(response, job_ids["zero"])

            require(
                request.model_dump(mode="json") == request_before,
                "The filtering pipeline mutated the supplied job request.",
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
            "Temporary job-assessment records were not fully rolled back.",
        )

    print(
        "All job-assessment and filtering checks passed; "
        "temporary records rolled back."
    )


if __name__ == "__main__":
    try:
        main()
    except psycopg.Error as error:
        print("Database error type:", type(error).__name__)
        print("SQLSTATE:", error.sqlstate or "not available")
        print("Constraint:", error.diag.constraint_name or "not available")
        raise SystemExit("Job-assessment database check failed.") from None