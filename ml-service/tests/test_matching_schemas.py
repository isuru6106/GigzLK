from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.matching_schemas import MatchRequest


@pytest.fixture
def valid_payload():
    """Synthetic input used only for validation tests."""
    return {
        "job": {
            "job_id": "job-test-1",
            "required_skills": ["photography"],
            "minimum_experience_months": 6,
            "starts_at": "2026-11-01T09:00:00+05:30",
            "ends_at": "2026-11-01T17:00:00+05:30",
            "remote": False,
            "location_id": "colombo",
        },
        "worker": {
            "worker_id": "worker-test-1",
            "skills": ["photography"],
            "relevant_experience_months": 12,
            "available_from": "2026-11-01T08:00:00+05:30",
            "available_until": "2026-11-01T18:00:00+05:30",
            "location_id": "colombo",
        },
    }


def test_valid_request(valid_payload):
    request = MatchRequest.model_validate(valid_payload)

    assert request.job.job_id == "job-test-1"
    assert request.worker.relevant_experience_months == 12
    assert request.job.starts_at.utcoffset().total_seconds() == 19800


def test_missing_worker_information_is_unknown(valid_payload):
    valid_payload["worker"] = {"worker_id": "worker-test-1"}

    request = MatchRequest.model_validate(valid_payload)

    assert request.worker.skills is None
    assert request.worker.relevant_experience_months is None
    assert request.worker.available_from is None


def test_empty_skills_are_distinct_from_unknown(valid_payload):
    valid_payload["worker"]["skills"] = []

    request = MatchRequest.model_validate(valid_payload)

    assert request.worker.skills == []


@pytest.mark.parametrize(
    ("section", "field", "value"),
    [
        ("job", "minimum_experience_months", -1),
        ("worker", "relevant_experience_months", True),
        ("worker", "relevant_experience_months", "12"),
        ("job", "required_skills", []),
        ("job", "required_skills", ["   "]),
        ("job", "starts_at", "2026-11-01T09:00:00"),
        ("job", "ends_at", "2026-11-01T08:00:00+05:30"),
        ("job", "location_id", None),
        ("job", "remote", "false"),
        ("worker", "available_until", None),
        ("worker", "available_until", "2026-11-01T07:00:00+05:30"),
        ("worker", "unexpected_field", "value"),
    ],
)
def test_invalid_input_is_rejected(valid_payload, section, field, value):
    payload = deepcopy(valid_payload)
    payload[section][field] = value

    with pytest.raises(ValidationError):
        MatchRequest.model_validate(payload)


def test_remote_job_does_not_require_location(valid_payload):
    valid_payload["job"]["remote"] = True
    valid_payload["job"]["location_id"] = None

    request = MatchRequest.model_validate(valid_payload)

    assert request.job.location_id is None