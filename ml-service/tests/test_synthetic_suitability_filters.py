from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.synthetic_job_recommendations import (
    SyntheticJobRequest,
    assess_retrieved_jobs,
)
from app.synthetic_recommendations import (
    SyntheticWorkerRequest,
    assess_retrieved_workers,
)
from app.synthetic_suitability_filters import (
    SyntheticFilterOptions,
    filter_assessed_jobs,
    filter_assessed_workers,
)


@pytest.fixture(params=["workers", "jobs"])
def direction(request):
    return request.param


def make_response(direction, cases, *, unknown_worker=False, remote=False):
    job = {
        "job_id": "synthetic-job-anchor",
        "required_skills": ["synthetic-skill-service"],
        "minimum_experience_months": 6,
        "starts_at": "2026-12-01T09:00:00+05:30",
        "ends_at": "2026-12-01T17:00:00+05:30",
        "remote": remote,
        "location_id": None if remote else "synthetic-location-colombo",
    }
    worker = {
        "worker_id": "synthetic-worker-anchor",
        "skills": ["synthetic-skill-service"],
        "available_from": "2026-12-01T08:00:00+05:30",
        "available_until": "2026-12-01T18:00:00+05:30",
        "location_id": "synthetic-location-colombo",
    }

    if unknown_worker:
        worker = {"worker_id": "synthetic-worker-anchor"}

    candidates = []

    for index, case in enumerate(cases):
        candidate_job = deepcopy(job)
        candidate_worker = deepcopy(worker)

        experience = (
            None
            if unknown_worker or case.startswith("incomplete")
            else 12
        )

        if direction == "workers":
            candidate_worker["worker_id"] = f"synthetic-worker-{case}"
            candidate_worker["relevant_experience_months"] = experience

            if case in {"availability", "both"}:
                candidate_worker["available_from"] = (
                    "2026-12-01T10:00:00+05:30"
                )

            if case in {"location", "both", "incomplete-location"}:
                candidate_worker["location_id"] = "synthetic-location-kandy"

            candidates.append(
                {
                    "worker": candidate_worker,
                    "worker_source_revision": index + 1,
                    "semantic_similarity": 0.95 - index * 0.05,
                }
            )
        else:
            candidate_job["job_id"] = f"synthetic-job-{case}"

            if case in {"availability", "both"}:
                candidate_job["starts_at"] = (
                    "2026-12-01T07:00:00+05:30"
                )

            if (
                not remote
                and case in {"location", "both", "incomplete-location"}
            ):
                candidate_job["location_id"] = "synthetic-location-kandy"

            candidates.append(
                {
                    "job": candidate_job,
                    "job_source_revision": index + 1,
                    "semantic_similarity": 0.95 - index * 0.05,
                    "relevant_experience_months": experience,
                }
            )

    if direction == "workers":
        return assess_retrieved_workers(
            SyntheticWorkerRequest.model_validate(
                {
                    "job": job,
                    "job_source_revision": 4,
                    "embedding_model_version": "synthetic-test-model",
                    "candidates": candidates,
                }
            )
        )

    return assess_retrieved_jobs(
        SyntheticJobRequest.model_validate(
            {
                "worker": worker,
                "worker_source_revision": 4,
                "embedding_model_version": "synthetic-test-model",
                "candidates": candidates,
            }
        )
    )


def apply_filters(direction, response, options):
    if direction == "workers":
        return filter_assessed_workers(response, options)
    return filter_assessed_jobs(response, options)


def candidate_id(item, direction):
    return item.worker_id if direction == "workers" else item.job_id


def test_default_filters_preserve_every_assessment(direction):
    response = make_response(
        direction, ["good", "availability", "location", "incomplete"]
    )

    result = apply_filters(direction, response, SyntheticFilterOptions())

    assert result.result.model_dump() == response.model_dump()
    assert result.summary.input_count == 4
    assert result.summary.returned_count == 4
    assert result.summary.excluded_count == 0
    assert result.summary.excluded_availability_mismatch_count == 0
    assert result.summary.excluded_location_mismatch_count == 0


@pytest.mark.parametrize(
    "options,expected_returned,expected_availability,expected_location",
    [
        (
            {"exclude_availability_mismatch": True},
            4,
            2,
            0,
        ),
        (
            {"exclude_location_mismatch": True},
            3,
            0,
            3,
        ),
        (
            {
                "exclude_availability_mismatch": True,
                "exclude_location_mismatch": True,
            },
            2,
            2,
            3,
        ),
    ],
)
def test_enabled_filters_and_overlapping_counts(
    direction,
    options,
    expected_returned,
    expected_availability,
    expected_location,
):
    response = make_response(
        direction,
        [
            "good",
            "availability",
            "location",
            "both",
            "incomplete",
            "incomplete-location",
        ],
    )

    result = apply_filters(
        direction,
        response,
        SyntheticFilterOptions(**options),
    )

    assert result.summary.input_count == 6
    assert result.summary.returned_count == expected_returned
    assert result.summary.excluded_count == 6 - expected_returned
    assert (
        result.summary.excluded_availability_mismatch_count
        == expected_availability
    )
    assert (
        result.summary.excluded_location_mismatch_count
        == expected_location
    )
    assert len(result.result.items) == expected_returned


def test_known_mismatch_is_filtered_even_when_overall_is_incomplete(direction):
    response = make_response(direction, ["incomplete-location"])
    assert response.items[0].assessment.overall_score is None

    result = apply_filters(
        direction,
        response,
        SyntheticFilterOptions(exclude_location_mismatch=True),
    )

    assert result.result.items == []
    assert result.summary.excluded_count == 1


def test_unknown_availability_and_location_are_not_mismatches(direction):
    response = make_response(
        direction,
        ["incomplete"],
        unknown_worker=True,
    )

    result = apply_filters(
        direction,
        response,
        SyntheticFilterOptions(
            exclude_availability_mismatch=True,
            exclude_location_mismatch=True,
        ),
    )

    assert result.summary.excluded_count == 0
    assert len(result.result.items) == 1

    assessment = result.result.items[0].assessment
    assert assessment.overall_score is None
    assert assessment.factors.availability.score is None
    assert assessment.factors.location.score is None
    assert assessment.missing_fields == response.items[0].assessment.missing_fields


def test_remote_jobs_are_not_excluded_by_location_filter(direction):
    response = make_response(direction, ["location"], remote=True)

    result = apply_filters(
        direction,
        response,
        SyntheticFilterOptions(exclude_location_mismatch=True),
    )

    assert result.summary.returned_count == 1
    assert result.summary.excluded_count == 0
    assert result.result.items[0].assessment.factors.location.reason_code == (
        "REMOTE_JOB"
    )


def test_filtering_preserves_order_scores_and_metadata(direction):
    response = make_response(direction, ["location", "good", "incomplete"])
    expected = response.items[1:]

    result = apply_filters(
        direction,
        response,
        SyntheticFilterOptions(exclude_location_mismatch=True),
    )

    assert [
        candidate_id(item, direction) for item in result.result.items
    ] == [candidate_id(item, direction) for item in expected]

    assert [item.rank for item in result.result.items] == [1, 2]

    for actual, original in zip(result.result.items, expected, strict=True):
        assert actual.model_dump(exclude={"rank"}) == original.model_dump(
            exclude={"rank"}
        )

    assert (
        result.result.embedding_model_version
        == response.embedding_model_version
    )
    assert result.result.ranking_version == response.ranking_version


def test_filtering_does_not_mutate_or_share_nested_inputs(direction):
    response = make_response(direction, ["location", "good"])
    options = SyntheticFilterOptions(exclude_location_mismatch=True)
    before = response.model_dump()

    result = apply_filters(direction, response, options)

    assert response.model_dump() == before

    result.result.items[0].assessment.warnings.append("TEST_ONLY")
    result.filters.exclude_location_mismatch = False

    assert response.model_dump() == before
    assert options.exclude_location_mismatch is True


def test_enabled_filters_add_scope_warnings(direction):
    response = make_response(direction, ["good"])

    result = apply_filters(
        direction,
        response,
        SyntheticFilterOptions(exclude_location_mismatch=True),
    )

    assert set(response.warnings).issubset(result.result.warnings)
    assert "SYNTHETIC_FILTERS_NOT_DOMAIN_ELIGIBILITY" in result.result.warnings
    assert "FILTERED_RETRIEVED_POOL_NOT_EXHAUSTIVE" in result.result.warnings


def test_empty_input_remains_empty(direction):
    response = make_response(direction, [])

    result = apply_filters(
        direction,
        response,
        SyntheticFilterOptions(
            exclude_availability_mismatch=True,
            exclude_location_mismatch=True,
        ),
    )

    assert result.result.items == []
    assert result.summary.input_count == 0
    assert result.summary.returned_count == 0
    assert result.summary.excluded_count == 0


@pytest.mark.parametrize("value", ["true", "false", 0, 1, None])
@pytest.mark.parametrize(
    "field",
    ["exclude_availability_mismatch", "exclude_location_mismatch"],
)
def test_filter_options_require_actual_booleans(field, value):
    with pytest.raises(ValidationError):
        SyntheticFilterOptions.model_validate({field: value})


def test_unknown_filter_options_are_rejected():
    with pytest.raises(ValidationError):
        SyntheticFilterOptions.model_validate({"minimum_score": 80})