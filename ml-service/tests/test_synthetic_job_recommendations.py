from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.synthetic_job_recommendations import (
    SyntheticJobRequest,
    assess_retrieved_jobs,
)


@pytest.fixture
def payload():
    return {
        "worker": {
            "worker_id": "synthetic-worker-a",
            "skills": ["synthetic-skill-service"],
            "available_from": "2026-12-01T08:00:00+05:30",
            "available_until": "2026-12-01T18:00:00+05:30",
            "location_id": "synthetic-location-colombo",
        },
        "worker_source_revision": 7,
        "embedding_model_version": "synthetic-embedding-test-v1",
        "candidates": [
            {
                "job": {
                    "job_id": "synthetic-job-a",
                    "required_skills": ["synthetic-skill-service"],
                    "minimum_experience_months": 6,
                    "starts_at": "2026-12-01T09:00:00+05:30",
                    "ends_at": "2026-12-01T17:00:00+05:30",
                    "remote": False,
                    "location_id": "synthetic-location-colombo",
                },
                "job_source_revision": 3,
                "semantic_similarity": 0.8,
                "relevant_experience_months": 12,
            }
        ],
    }


def assess(payload):
    request = SyntheticJobRequest.model_validate(payload)
    return assess_retrieved_jobs(request)


def test_complete_assessment_preserves_metadata(payload):
    result = assess(payload)
    item = result.items[0]

    assert result.worker_id == "synthetic-worker-a"
    assert result.worker_source_revision == 7
    assert result.embedding_model_version == "synthetic-embedding-test-v1"
    assert result.ranking_version == "semantic-order-v1"

    assert item.rank == 1
    assert item.job_id == "synthetic-job-a"
    assert item.job_source_revision == 3
    assert item.semantic_similarity == 0.8
    assert item.assessment.job_id == item.job_id
    assert item.assessment.worker_id == result.worker_id
    assert item.assessment.overall_score == 100
    assert item.assessment.assessment_status == "COMPLETE"
    assert item.assessment.scoring_version == "rules-v1"

    assert "JOB_SPECIFIC_EXPERIENCE_NOT_VERIFIED" in result.warnings
    assert "DOMAIN_ELIGIBILITY_NOT_CHECKED" in result.warnings


def test_each_job_uses_its_own_experience(payload):
    second = deepcopy(payload["candidates"][0])
    second["job"]["job_id"] = "synthetic-job-b"
    second["relevant_experience_months"] = 0
    second["semantic_similarity"] = 0.7
    payload["candidates"].append(second)

    result = assess(payload)
    first, second = result.items

    assert first.assessment.factors.experience.score == 100
    assert first.assessment.overall_score == 100
    assert second.assessment.factors.experience.score == 0
    assert second.assessment.overall_score == 80
    assert second.assessment.assessment_status == "COMPLETE"


def test_unknown_experience_is_not_zero_or_copied_from_another_job(payload):
    unknown = deepcopy(payload["candidates"][0])
    unknown["job"]["job_id"] = "synthetic-job-b"
    unknown.pop("relevant_experience_months")
    unknown["semantic_similarity"] = 0.95
    payload["candidates"].append(unknown)

    result = assess(payload)
    first, second = result.items

    assert first.job_id == "synthetic-job-b"
    assert first.assessment.assessment_status == "INCOMPLETE"
    assert first.assessment.overall_score is None
    assert first.assessment.factors.experience.score is None
    assert first.assessment.missing_fields == [
        "worker.relevant_experience_months"
    ]
    assert first.assessment.factors.skills.score == 100

    assert second.assessment.overall_score == 100


def test_zero_experience_requirement_does_not_need_experience(payload):
    candidate = payload["candidates"][0]
    candidate["job"]["minimum_experience_months"] = 0
    candidate["relevant_experience_months"] = None

    assessment = assess(payload).items[0].assessment

    assert assessment.assessment_status == "COMPLETE"
    assert assessment.overall_score == 100
    assert assessment.factors.experience.reason_code == "NO_EXPERIENCE_REQUIRED"


def test_shared_worker_experience_is_rejected(payload):
    payload["worker"]["relevant_experience_months"] = 12

    with pytest.raises(ValidationError, match="per candidate job"):
        SyntheticJobRequest.model_validate(payload)


def test_shared_worker_zero_experience_is_also_rejected(payload):
    payload["worker"]["relevant_experience_months"] = 0

    with pytest.raises(ValidationError, match="per candidate job"):
        SyntheticJobRequest.model_validate(payload)


def test_high_similarity_preserves_schedule_and_location_mismatches(payload):
    candidate = payload["candidates"][0]
    candidate["semantic_similarity"] = 0.99
    candidate["job"]["starts_at"] = "2026-12-01T07:00:00+05:30"
    candidate["job"]["location_id"] = "synthetic-location-kandy"

    assessment = assess(payload).items[0].assessment

    assert assessment.overall_score == 70
    assert "AVAILABILITY_MISMATCH" in assessment.warnings
    assert "LOCATION_MISMATCH" in assessment.warnings


def test_incomplete_assessment_keeps_known_mismatch_warning(payload):
    candidate = payload["candidates"][0]
    candidate["relevant_experience_months"] = None
    candidate["job"]["location_id"] = "synthetic-location-kandy"

    assessment = assess(payload).items[0].assessment

    assert assessment.overall_score is None
    assert assessment.factors.location.score == 0
    assert "LOCATION_MISMATCH" in assessment.warnings


def test_ties_use_job_id_without_mutating_request(payload):
    candidate_b = deepcopy(payload["candidates"][0])
    candidate_b["job"]["job_id"] = "synthetic-job-b"
    payload["candidates"].insert(0, candidate_b)

    request = SyntheticJobRequest.model_validate(payload)
    before = request.model_dump()

    result = assess_retrieved_jobs(request)

    assert [item.job_id for item in result.items] == [
        "synthetic-job-a",
        "synthetic-job-b",
    ]
    assert [item.rank for item in result.items] == [1, 2]
    assert request.model_dump() == before
    assert request.worker.relevant_experience_months is None


def test_empty_candidates_return_empty_items(payload):
    payload["candidates"] = []

    assert assess(payload).items == []


def test_duplicate_jobs_are_rejected(payload):
    payload["candidates"].append(deepcopy(payload["candidates"][0]))

    with pytest.raises(ValidationError, match="Duplicate job"):
        SyntheticJobRequest.model_validate(payload)


@pytest.mark.parametrize("experience", [-1, True, "6", 1.5])
def test_invalid_job_specific_experience_is_rejected(payload, experience):
    payload["candidates"][0]["relevant_experience_months"] = experience

    with pytest.raises(ValidationError):
        SyntheticJobRequest.model_validate(payload)


@pytest.mark.parametrize(
    "similarity",
    [float("nan"), float("inf"), -float("inf"), -1.01, 1.01, "0.8", True],
)
def test_invalid_similarity_is_rejected(payload, similarity):
    payload["candidates"][0]["semantic_similarity"] = similarity

    with pytest.raises(ValidationError):
        SyntheticJobRequest.model_validate(payload)


@pytest.mark.parametrize("revision", [0, -1, True, "1", 2**63])
@pytest.mark.parametrize("target", ["job", "worker"])
def test_invalid_source_revisions_are_rejected(payload, revision, target):
    if target == "worker":
        payload["worker_source_revision"] = revision
    else:
        payload["candidates"][0]["job_source_revision"] = revision

    with pytest.raises(ValidationError):
        SyntheticJobRequest.model_validate(payload)


@pytest.mark.parametrize("target", ["job", "worker"])
def test_live_entity_ids_are_rejected(payload, target):
    if target == "worker":
        payload["worker"]["worker_id"] = "worker-live-1"
    else:
        payload["candidates"][0]["job"]["job_id"] = "job-live-1"

    with pytest.raises(ValidationError):
        SyntheticJobRequest.model_validate(payload)


@pytest.mark.parametrize("version", ["", " ", " model-v1", "model-v1 ", "a" * 201])
def test_invalid_model_version_is_rejected(payload, version):
    payload["embedding_model_version"] = version

    with pytest.raises(ValidationError):
        SyntheticJobRequest.model_validate(payload)


def test_candidate_limit_is_enforced(payload):
    original = payload["candidates"][0]
    payload["candidates"] = []

    for index in range(101):
        candidate = deepcopy(original)
        candidate["job"]["job_id"] = f"synthetic-job-{index}"
        payload["candidates"].append(candidate)

    with pytest.raises(ValidationError):
        SyntheticJobRequest.model_validate(payload)


def test_unknown_fields_are_rejected(payload):
    payload["eligibility_confirmed"] = True

    with pytest.raises(ValidationError):
        SyntheticJobRequest.model_validate(payload)


def test_response_serializes_missing_score_as_null(payload):
    payload["candidates"][0]["relevant_experience_months"] = None

    result = assess(payload)
    serialized = result.model_dump(mode="json")

    assert serialized["items"][0]["assessment"]["overall_score"] is None
    assert isinstance(result.model_dump_json(), str)