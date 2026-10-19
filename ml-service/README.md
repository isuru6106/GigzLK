# GigZLK ML Service

## Current scope

Independent FastAPI service foundation:
- Liveness and readiness endpoints
- Validated environment configuration
- Optional interactive API documentation
- Automated health/configuration tests
- Non-root Docker image
- Optional Compose profile
- GitHub Actions test/build workflow

Matching, recommendations and trained models are not implemented yet.
There are no database, Redis or Kafka connections in this foundation.
Readiness currently indicates application startup only.

## Local Python setup

Run from the repository root. Python 3.13 is the tested runtime.

```powershell
py -3.13 -m venv ml-service/.venv
.\ml-service\.venv\Scripts\python.exe -m pip install -r ml-service/requirements-dev-lock.txt
```

Start the API:

```powershell
.\ml-service\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --app-dir ml-service --host 127.0.0.1 --port 8000
```

Endpoints:
- http://127.0.0.1:8000/health/live
- http://127.0.0.1:8000/health/ready
- http://127.0.0.1:8000/docs

Press Ctrl+C to stop the local server.

## Configuration

| Variable | Default | Allowed values |
|---|---|---|
| ML_ENVIRONMENT | development | development, test, staging, production |
| ML_DOCS_ENABLED | true | Boolean values such as true or false |

Settings read process environment variables.
.env.example is a template; .env files are not loaded automatically.

Example, before starting the local server:

```powershell
$env:ML_ENVIRONMENT = 'development'
$env:ML_DOCS_ENABLED = 'false'
```

Invalid settings prevent application creation.
Disabling docs removes /docs and /openapi.json.
It does not provide authentication.
The environment label does not automatically change other settings.

## Tests

```powershell
Push-Location ml-service
try {
    .\.venv\Scripts\python.exe -m pytest tests -q
} finally {
    Pop-Location
}
```

Tests cover startup/shutdown readiness, liveness independence,
configuration validation and documentation route controls.

## Docker Compose

First complete infrastructure setup in:
../docs/deployment/local-development.md

From the repository root:

```powershell
docker compose --env-file infrastructure/docker/.env -f infrastructure/docker/compose.yaml --profile ml up -d --build --wait ml-service
```

Containerized API:
- http://127.0.0.1:8001/health/live
- http://127.0.0.1:8001/health/ready
- http://127.0.0.1:8001/docs

The container listens internally on port 8000.
The published Windows port is 8001, bound to loopback.
The ML service has no declared infrastructure dependencies yet.

Compose currently sets ML_ENVIRONMENT and ML_DOCS_ENABLED explicitly.
Changing host environment variables alone does not override those values.

Stop only the ML container:

```powershell
docker compose --env-file infrastructure/docker/.env -f infrastructure/docker/compose.yaml stop ml-service
```

## Container behavior

- Python 3.13 slim base image
- Runtime dependencies only; no pytest or test HTTP client installed
- Runs as UID/GID 10001
- Readiness-based Docker health check
- No credentials or local virtual environment copied into the image

Runtime and test dependency versions are pinned in requirements-lock.txt
and requirements-dev-lock.txt for Python 3.13.

Docker installs the runtime lock. Local development and CI install the
development lock, which includes the runtime lock.

requirements.txt and requirements-dev.txt declare direct dependencies.
When updating dependencies, update those declarations and the affected
lock entries together, then verify installation, dependency consistency,
tests and the runtime image on Windows and Linux.

These files pin package versions without artifact hashes.
The Docker base image is still referenced by a mutable tag.

## CI

.github/workflows/ml-service.yml runs on relevant pull requests
and pushes to main. It installs dependencies, checks consistency,
runs tests and builds the image on Linux.

The workflow does not publish images or deploy.
Security scanning, application metrics and structured request logging
are not implemented in this foundation.

## Integration boundaries

Domain services retain their business data and authorization.
Future ML integrations use agreed APIs/events, not private tables.
Financial decisions remain owned by Payment Service.

Only health and documentation routes exist.
Authentication and gateway integration must precede exposure of
future sensitive ML endpoints outside local development.


## Job-worker matching

POST /api/v1/ml/match accepts job and worker snapshots and returns
an explainable rule-based suitability assessment.

Scoring version: rules-v1.

Weights:
- Skills: 50%
- Relevant experience: 20%
- Availability: 20%
- Location: 10%

Unknown required worker information produces an INCOMPLETE assessment
with a null overall score. Known schedule and location mismatches
remain visible in warnings.

This score is not a hiring probability. Domain services retain final
eligibility and assignment checks.

The matching endpoint currently has no caller authentication.
Use synthetic data on loopback only until authorization is implemented.

See ../docs/ml/matching-v1.md for the proposed contract and boundaries.