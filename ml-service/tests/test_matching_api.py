import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.matching_response import MatchResponse


@pytest.fixture
def client():
    with TestClient(create_app()) as test_client:
        yield test_client


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


def test_complete_match(client, payload):
    response = client.post("/api/v1/ml/match", json=payload)

    assert response.status_code == 200

    result = MatchResponse.model_validate(response.json())

    assert result.overall_score == 100
    assert result.assessment_status == "COMPLETE"
    assert result.job_id == "job-test-1"
    assert result.worker_id == "worker-test-1"
    assert result.missing_fields == []


def test_incomplete_match(client, payload):
    payload["worker"] = {"worker_id": "worker-test-1"}

    response = client.post("/api/v1/ml/match", json=payload)

    assert response.status_code == 200
    body = response.json()

    assert body["assessment_status"] == "INCOMPLETE"
    assert body["overall_score"] is None
    assert "worker.skills" in body["missing_fields"]


def test_mismatch_warnings(client, payload):
    payload["worker"]["location_id"] = "kandy"
    payload["worker"]["available_from"] = "2026-11-01T10:00:00+05:30"

    response = client.post("/api/v1/ml/match", json=payload)

    assert response.status_code == 200
    body = response.json()

    assert body["overall_score"] == 70
    assert "AVAILABILITY_MISMATCH" in body["warnings"]
    assert "LOCATION_MISMATCH" in body["warnings"]


@pytest.mark.parametrize(
    ("section", "field", "value"),
    [
        ("job", "minimum_experience_months", -1),
        ("worker", "relevant_experience_months", True),
        ("job", "starts_at", "2026-11-01T09:00:00"),
        ("job", "ends_at", "2026-11-01T08:00:00+05:30"),
        ("worker", "unexpected_field", "value"),
    ],
)
def test_invalid_request_returns_422(client, payload, section, field, value):
    payload[section][field] = value

    response = client.post("/api/v1/ml/match", json=payload)

    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)


def test_unknown_top_level_field_returns_422(client, payload):
    payload["unexpected_field"] = "value"

    response = client.post("/api/v1/ml/match", json=payload)

    assert response.status_code == 422


def test_missing_body_returns_422(client):
    response = client.post("/api/v1/ml/match")

    assert response.status_code == 422


def test_get_method_is_not_allowed(client):
    response = client.get("/api/v1/ml/match")

    assert response.status_code == 405