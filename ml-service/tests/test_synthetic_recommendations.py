from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.synthetic_recommendations import (
    SyntheticWorkerRequest,
    assess_retrieved_workers,
)


@pytest.fixture
def payload():
    return {
        "job": {
            "job_id": "synthetic-job-cafe",
            "required_skills": ["synthetic-skill-service"],
            "minimum_experience_months": 6,
            "starts_at": "2026-12-01T09:00:00+05:30",
            "ends_at": "2026-12-01T17:00:00+05:30",
            "remote": False,
            "location_id": "synthetic-location-colombo",
        },
        "job_source_revision": 3,
        "embedding_model_version": "synthetic-embedding-test-v1",
        "candidates": [
            {
                "worker": {
                    "worker_id": "synthetic-worker-a",
                    "skills": ["synthetic-skill-service"],
                    "relevant_experience_months": 12,
                    "available_from": "2026-12-01T08:00:00+05:30",
                    "available_until": "2026-12-01T18:00:00+05:30",
                    "location_id": "synthetic-location-colombo",
                },
                "worker_source_revision": 7,
                "semantic_similarity": 0.8,
            }
        ],
    }


def assess(payload):
    request = SyntheticWorkerRequest.model_validate(payload)
    return assess_retrieved_workers(request)


def test_complete_assessment_preserves_separate_scores_and_versions(payload):
    result = assess(payload)
    item = result.items[0]

    assert item.rank == 1
    assert item.worker_id == "synthetic-worker-a"
    assert item.worker_source_revision == 7
    assert item.semantic_similarity == 0.8

    assert item.assessment.overall_score == 100
    assert item.assessment.assessment_status == "COMPLETE"
    assert item.assessment.scoring_version == "rules-v1"
    assert item.assessment.factors.skills.reason_code == "SKILL_OVERLAP"

    assert result.job_id == "synthetic-job-cafe"
    assert result.job_source_revision == 3
    assert result.embedding_model_version == "synthetic-embedding-test-v1"
    assert result.ranking_version == "semantic-order-v1"
    assert "DOMAIN_ELIGIBILITY_NOT_CHECKED" in result.warnings
    assert "CANDIDATE_VISIBILITY_NOT_CHECKED" in result.warnings
    assert "SOURCE_FRESHNESS_NOT_VERIFIED" in result.warnings


def test_high_similarity_does_not_fill_missing_information(payload):
    candidate = payload["candidates"][0]
    candidate["semantic_similarity"] = 0.99
    candidate["worker"]["skills"] = None
    candidate["worker"]["relevant_experience_months"] = None

    item = assess(payload).items[0]

    assert item.semantic_similarity == 0.99
    assert item.assessment.assessment_status == "INCOMPLETE"
    assert item.assessment.overall_score is None
    assert item.assessment.factors.skills.score is None
    assert item.assessment.factors.experience.score is None
    assert item.assessment.factors.availability.score == 100
    assert set(item.assessment.missing_fields) == {
        "worker.skills",
        "worker.relevant_experience_months",
    }


def test_known_empty_skills_remain_zero_instead_of_unknown(payload):
    payload["candidates"][0]["worker"]["skills"] = []

    assessment = assess(payload).items[0].assessment

    assert assessment.assessment_status == "COMPLETE"
    assert assessment.factors.skills.score == 0
    assert assessment.overall_score == 50
    assert assessment.missing_fields == []


def test_high_similarity_keeps_known_mismatch_warnings(payload):
    candidate = payload["candidates"][0]
    candidate["semantic_similarity"] = 0.99
    candidate["worker"]["available_from"] = "2026-12-01T10:00:00+05:30"
    candidate["worker"]["location_id"] = "synthetic-location-kandy"

    assessment = assess(payload).items[0].assessment

    assert assessment.overall_score == 70
    assert "AVAILABILITY_MISMATCH" in assessment.warnings
    assert "LOCATION_MISMATCH" in assessment.warnings


def test_incomplete_candidate_keeps_its_semantic_position(payload):
    complete = payload["candidates"][0]
    incomplete = deepcopy(complete)
    incomplete["worker"]["worker_id"] = "synthetic-worker-b"
    incomplete["worker"]["skills"] = None
    incomplete["semantic_similarity"] = 0.95
    payload["candidates"].append(incomplete)

    result = assess(payload)

    assert [item.worker_id for item in result.items] == [
        "synthetic-worker-b",
        "synthetic-worker-a",
    ]
    assert [item.rank for item in result.items] == [1, 2]
    assert result.items[0].assessment.overall_score is None
    assert result.items[1].assessment.overall_score == 100


def test_equal_similarity_has_stable_id_order_without_mutating_input(payload):
    candidate_b = deepcopy(payload["candidates"][0])
    candidate_b["worker"]["worker_id"] = "synthetic-worker-b"
    payload["candidates"].insert(0, candidate_b)

    request = SyntheticWorkerRequest.model_validate(payload)
    before = request.model_dump()

    result = assess_retrieved_workers(request)

    assert [item.worker_id for item in result.items] == [
        "synthetic-worker-a",
        "synthetic-worker-b",
    ]
    assert request.model_dump() == before


def test_empty_candidate_set_returns_explicit_empty_items(payload):
    payload["candidates"] = []

    result = assess(payload)

    assert result.items == []
    assert "SYNTHETIC_DEVELOPMENT_ONLY" in result.warnings


def test_duplicate_candidates_are_rejected(payload):
    payload["candidates"].append(deepcopy(payload["candidates"][0]))

    with pytest.raises(ValidationError, match="Duplicate worker"):
        SyntheticWorkerRequest.model_validate(payload)


@pytest.mark.parametrize(
    "similarity",
    [float("nan"), float("inf"), -float("inf"), -1.01, 1.01, "0.8", True],
)
def test_invalid_similarity_is_rejected(payload, similarity):
    payload["candidates"][0]["semantic_similarity"] = similarity

    with pytest.raises(ValidationError):
        SyntheticWorkerRequest.model_validate(payload)


@pytest.mark.parametrize("revision", [0, -1, True, "1", 2**63])
@pytest.mark.parametrize("target", ["job", "worker"])
def test_invalid_source_revisions_are_rejected(payload, revision, target):
    if target == "job":
        payload["job_source_revision"] = revision
    else:
        payload["candidates"][0]["worker_source_revision"] = revision

    with pytest.raises(ValidationError):
        SyntheticWorkerRequest.model_validate(payload)


@pytest.mark.parametrize("target", ["job", "worker"])
def test_live_entity_ids_are_rejected(payload, target):
    if target == "job":
        payload["job"]["job_id"] = "job-live-1"
    else:
        payload["candidates"][0]["worker"]["worker_id"] = "worker-live-1"

    with pytest.raises(ValidationError):
        SyntheticWorkerRequest.model_validate(payload)


@pytest.mark.parametrize("version", ["", " ", " model-v1", "model-v1 ", "a" * 201])
def test_invalid_model_version_is_rejected(payload, version):
    payload["embedding_model_version"] = version

    with pytest.raises(ValidationError):
        SyntheticWorkerRequest.model_validate(payload)


def test_candidate_limit_is_enforced(payload):
    original = payload["candidates"][0]
    payload["candidates"] = []

    for index in range(101):
        candidate = deepcopy(original)
        candidate["worker"]["worker_id"] = f"synthetic-worker-{index}"
        payload["candidates"].append(candidate)

    with pytest.raises(ValidationError):
        SyntheticWorkerRequest.model_validate(payload)


def test_unknown_input_fields_are_rejected(payload):
    payload["eligibility_confirmed"] = True

    with pytest.raises(ValidationError):
        SyntheticWorkerRequest.model_validate(payload)