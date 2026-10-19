import pytest

from app.matching_schemas import MatchRequest
from app.matching_service import assess_match


@pytest.fixture
def payload():
    return {
        "job": {
            "job_id": "job-test-1",
            "required_skills": ["photography", "editing"],
            "minimum_experience_months": 6,
            "starts_at": "2026-11-01T09:00:00+05:30",
            "ends_at": "2026-11-01T17:00:00+05:30",
            "remote": False,
            "location_id": "colombo",
        },
        "worker": {
            "worker_id": "worker-test-1",
            "skills": ["photography", "editing"],
            "relevant_experience_months": 12,
            "available_from": "2026-11-01T08:00:00+05:30",
            "available_until": "2026-11-01T18:00:00+05:30",
            "location_id": "colombo",
        },
    }


def assess(payload):
    return assess_match(MatchRequest.model_validate(payload))


def test_full_match(payload):
    result = assess(payload)

    assert result.overall_score == 100
    assert result.assessment_status == "COMPLETE"
    assert result.missing_fields == []
    assert result.job_id == "job-test-1"
    assert result.worker_id == "worker-test-1"
    assert result.scoring_version == "rules-v1"
    assert result.method == "RULE_BASED"
    assert set(result.warnings) == {
        "RULE_BASED_SCORE_NOT_HIRING_PROBABILITY",
        "DOMAIN_ELIGIBILITY_NOT_CHECKED",
    }


def test_partial_match_uses_weights(payload):
    payload["worker"]["skills"] = ["photography"]
    payload["worker"]["relevant_experience_months"] = 3

    result = assess(payload)

    # Skills: 25, experience: 10, availability: 20, location: 10.
    assert result.overall_score == 65
    assert result.assessment_status == "COMPLETE"


def test_unknown_information_retains_known_scores(payload):
    payload["worker"]["skills"] = None

    result = assess(payload)

    assert result.assessment_status == "INCOMPLETE"
    assert result.overall_score is None
    assert result.factors.skills.score is None
    assert result.factors.experience.score == 100
    assert result.missing_fields == ["worker.skills"]


def test_all_unknown_worker_information(payload):
    payload["worker"] = {"worker_id": "worker-test-1"}

    result = assess(payload)

    assert result.assessment_status == "INCOMPLETE"
    assert result.overall_score is None
    assert set(result.missing_fields) == {
        "worker.skills",
        "worker.relevant_experience_months",
        "worker.available_from",
        "worker.available_until",
        "worker.location_id",
    }


def test_empty_skills_are_known_zero(payload):
    payload["worker"]["skills"] = []

    result = assess(payload)

    assert result.factors.skills.score == 0
    assert result.overall_score == 50
    assert result.assessment_status == "COMPLETE"
    assert result.missing_fields == []


def test_remote_and_zero_experience_do_not_need_worker_fields(payload):
    payload["job"]["remote"] = True
    payload["job"]["location_id"] = None
    payload["job"]["minimum_experience_months"] = 0
    payload["worker"]["location_id"] = None
    payload["worker"]["relevant_experience_months"] = None

    result = assess(payload)

    assert result.overall_score == 100
    assert result.assessment_status == "COMPLETE"
    assert result.missing_fields == []


def test_mismatches_remain_visible(payload):
    payload["worker"]["available_from"] = "2026-11-01T10:00:00+05:30"
    payload["worker"]["location_id"] = "kandy"

    result = assess(payload)

    assert result.overall_score == 70
    assert result.assessment_status == "COMPLETE"
    assert "AVAILABILITY_MISMATCH" in result.warnings
    assert "LOCATION_MISMATCH" in result.warnings


def test_incomplete_result_still_warns_about_known_mismatch(payload):
    payload["worker"]["skills"] = None
    payload["worker"]["location_id"] = "kandy"

    result = assess(payload)

    assert result.overall_score is None
    assert result.assessment_status == "INCOMPLETE"
    assert "LOCATION_MISMATCH" in result.warnings


def test_overall_uses_unrounded_factors(payload):
    payload["job"]["required_skills"] = [
        "photography",
        "editing",
        "lighting",
    ]
    payload["worker"]["skills"] = ["photography"]

    result = assess(payload)

    assert result.factors.skills.score == 33.33
    # Unrounded: (100 / 3) * 0.5 + 50 = 66.666...
    # Using the rounded factor instead would produce 66.665.
    assert result.overall_score == 66.67