from fastapi.testclient import TestClient

from app.main import create_app


def test_health_endpoints_after_startup():
    application = create_app()

    with TestClient(application) as client:
        live = client.get("/health/live")
        assert live.status_code == 200
        assert live.json() == {"status": "UP", "service": "ml-service"}

        ready = client.get("/health/ready")
        assert ready.status_code == 200
        assert ready.json() == {"status": "READY", "service": "ml-service"}

    assert application.state.ready is False


def test_not_ready_does_not_make_liveness_fail():
    application = create_app()

    with TestClient(application) as client:
        application.state.ready = False

        ready = client.get("/health/ready")
        assert ready.status_code == 503
        assert ready.json() == {
            "status": "NOT_READY",
            "service": "ml-service",
        }

        assert client.get("/health/live").status_code == 200
