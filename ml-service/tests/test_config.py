import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.main import create_app


def test_settings_read_environment_variables(monkeypatch):
    monkeypatch.setenv("ML_ENVIRONMENT", "test")
    monkeypatch.setenv("ML_DOCS_ENABLED", "false")

    settings = Settings()

    assert settings.environment == "test"
    assert settings.docs_enabled is False


def test_invalid_environment_prevents_application_creation(monkeypatch):
    monkeypatch.setenv("ML_ENVIRONMENT", "unknown")

    with pytest.raises(ValidationError):
        create_app()


def test_documentation_can_be_disabled(monkeypatch):
    monkeypatch.setenv("ML_ENVIRONMENT", "test")
    monkeypatch.setenv("ML_DOCS_ENABLED", "false")

    with TestClient(create_app()) as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404
        assert client.get("/health/live").status_code == 200
        assert client.get("/health/ready").status_code == 200


def test_documentation_can_be_enabled(monkeypatch):
    monkeypatch.setenv("ML_ENVIRONMENT", "test")
    monkeypatch.setenv("ML_DOCS_ENABLED", "true")

    with TestClient(create_app()) as client:
        assert client.get("/docs").status_code == 200
        response = client.get("/openapi.json")
        assert response.status_code == 200
        assert "/health/live" in response.json()["paths"]
