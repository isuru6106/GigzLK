"""Generate synthetic recommendation examples for frontend development.

No HTTP routes, real profiles, authorization or freshness verification.
Existing output files are never overwritten.
"""

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.synthetic_job_recommendations import (
    SyntheticJobRequest,
    assess_retrieved_jobs,
)
from app.synthetic_recommendations import (
    SyntheticWorkerRequest,
    assess_retrieved_workers,
)


OUTPUT = ROOT / "evaluation/frontend-mocks"
FIXTURE_TIME = "2026-11-23T00:00:00Z"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def camel_case(name):
    first, *remaining = name.split("_")
    return first + "".join(part.capitalize() for part in remaining)


def frontend_fields(value):
    """Convert object keys while preserving strings and reason codes."""
    if isinstance(value, dict):
        return {
            camel_case(key): frontend_fields(item)
            for key, item in value.items()
        }

    if isinstance(value, list):
        return [frontend_fields(item) for item in value]

    return value


def envelope(response, direction, subject_kind, subject_id):
    worker_direction = direction == "WORKERS_FOR_JOB"
    items = []

    for item in response.items:
        candidate_id = (
            item.worker_id if worker_direction else item.job_id
        )
        revision = (
            item.worker_source_revision
            if worker_direction
            else item.job_source_revision
        )

        items.append(
            {
                "rank": item.rank,
                "candidateId": candidate_id,
                # Proposed wire format, not a finalized live contract.
                "candidateSourceRevision": str(revision),
                "assessment": frontend_fields(
                    item.assessment.model_dump(mode="json")
                ),
            }
        )

    subject_revision = (
        response.job_source_revision
        if worker_direction
        else response.worker_source_revision
    )

    return {
        "contractVersion": "recommendations-v1",
        "direction": direction,
        "subject": {
            "entityKind": subject_kind,
            "id": subject_id,
            "sourceRevision": str(subject_revision),
        },
        "generatedAt": FIXTURE_TIME,
        "rankingVersion": response.ranking_version,
        "embeddingModelVersion": response.embedding_model_version,
        "filterPolicyVersion": "synthetic-known-mismatches-v1",
        "appliedFilters": {
            "excludeAvailabilityMismatch": False,
            "excludeLocationMismatch": False,
        },
        "freshness": {
            "status": "NOT_VERIFIED",
        },
        "items": items,
        "warnings": list(response.warnings),
    }


def main():
    manifest = json.loads(
        (ROOT / "vector-model.json").read_text(encoding="utf-8")
    )
    model_version = (
        f"e5-small-{manifest['model_revision']}-"
        f"{manifest['preprocessing_version']}"
    )

    job = {
        "job_id": "synthetic-job-mock-cafe",
        "required_skills": ["synthetic-skill-service"],
        "minimum_experience_months": 6,
        "starts_at": "2026-12-01T09:00:00+05:30",
        "ends_at": "2026-12-01T17:00:00+05:30",
        "remote": False,
        "location_id": "synthetic-location-colombo",
    }

    worker = {
        "worker_id": "synthetic-worker-mock-complete",
        "skills": ["synthetic-skill-service"],
        "relevant_experience_months": 12,
        "available_from": "2026-12-01T08:00:00+05:30",
        "available_until": "2026-12-01T18:00:00+05:30",
        "location_id": "synthetic-location-colombo",
    }

    mismatched_worker = {
        **worker,
        "worker_id": "synthetic-worker-mock-mismatch",
        "available_from": "2026-12-01T10:00:00+05:30",
        "location_id": "synthetic-location-kandy",
    }

    incomplete_worker = {
        "worker_id": "synthetic-worker-mock-incomplete",
    }

    worker_request = SyntheticWorkerRequest.model_validate(
        {
            "job": job,
            "job_source_revision": 1,
            "embedding_model_version": model_version,
            "candidates": [
                {
                    "worker": candidate,
                    "worker_source_revision": 1,
                    "semantic_similarity": similarity,
                }
                for candidate, similarity in (
                    (worker, 0.95),
                    (mismatched_worker, 0.85),
                    (incomplete_worker, 0.75),
                )
            ],
        }
    )
    worker_response = assess_retrieved_workers(worker_request)

    require(
        [item.assessment.overall_score for item in worker_response.items]
        == [100, 70, None],
        "Unexpected worker fixture assessments.",
    )

    shared_worker = {
        key: value
        for key, value in worker.items()
        if key != "relevant_experience_months"
    }

    mismatched_job = {
        **job,
        "job_id": "synthetic-job-mock-mismatch",
        "starts_at": "2026-12-01T07:00:00+05:30",
        "location_id": "synthetic-location-kandy",
    }

    incomplete_job = {
        **job,
        "job_id": "synthetic-job-mock-incomplete",
    }

    job_request = SyntheticJobRequest.model_validate(
        {
            "worker": shared_worker,
            "worker_source_revision": 1,
            "embedding_model_version": model_version,
            "candidates": [
                {
                    "job": candidate,
                    "job_source_revision": 1,
                    "semantic_similarity": similarity,
                    "relevant_experience_months": experience,
                }
                for candidate, similarity, experience in (
                    (job, 0.95, 12),
                    (mismatched_job, 0.85, 0),
                    (incomplete_job, 0.75, None),
                )
            ],
        }
    )
    job_response = assess_retrieved_jobs(job_request)

    require(
        [item.assessment.overall_score for item in job_response.items]
        == [100, 50, None],
        "Unexpected job fixture assessments.",
    )

    empty_worker_request = SyntheticWorkerRequest.model_validate(
        {
            **worker_request.model_dump(),
            "candidates": [],
        }
    )
    empty_job_request = SyntheticJobRequest.model_validate(
        {
            **job_request.model_dump(),
            "candidates": [],
        }
    )

    documents = {
        "workers-results.json": envelope(
            worker_response,
            "WORKERS_FOR_JOB",
            "job",
            job["job_id"],
        ),
        "jobs-results.json": envelope(
            job_response,
            "JOBS_FOR_WORKER",
            "worker",
            shared_worker["worker_id"],
        ),
        "workers-empty.json": envelope(
            assess_retrieved_workers(empty_worker_request),
            "WORKERS_FOR_JOB",
            "job",
            job["job_id"],
        ),
        "jobs-empty.json": envelope(
            assess_retrieved_jobs(empty_job_request),
            "JOBS_FOR_WORKER",
            "worker",
            shared_worker["worker_id"],
        ),
        "unavailable.json": {
            "error": {
                "code": "RECOMMENDATIONS_UNAVAILABLE",
                "message": "Recommendations are temporarily unavailable.",
                "requestId": "b215b26f-4765-461c-b141-663644a70215",
            }
        },
        "unauthorized.json": {
            "error": {
                "code": "AUTHENTICATION_REQUIRED",
                "message": "Authentication is required.",
                "requestId": "a13f977f-5229-4da5-9874-99aacbfa9337",
            }
        },
    }

    files = {
        name: json.dumps(
            document,
            indent=2,
            ensure_ascii=False,
            allow_nan=False,
        ) + "\n"
        for name, document in documents.items()
    }

    files["README.md"] = """# Synthetic recommendation frontend mocks

Status: development examples, not live API responses.

Related contract: docs/api/recommendations-v1.md.
Related planning issue: #51.

## Files

| File | Intended mock state |
|---|---|
| workers-results.json | Complete, mismatched and incomplete workers |
| jobs-results.json | Complete, mismatched and incomplete jobs |
| workers-empty.json | Successful empty worker list |
| jobs-empty.json | Successful empty job list |
| unavailable.json | Proposed HTTP 503 error body |
| unauthorized.json | Proposed HTTP 401 error body |

HTTP statuses are mock instructions. These files enable no endpoints.
Loading is a frontend state, not a response body.

## Usage

- Display a clear synthetic/demo label.
- Use bounded lists without pagination or total counts.
- Keep both optional filters off by default.
- Preserve null scores and known factor assessments.
- Show known mismatch warnings.
- Explain semantic ordering separately from suitability.
- Do not show names, photos, contact information or real job summaries.
- Do not enable real applications, offers or assignments.

Each results fixture contains three candidates.
This fixture size does not settle the final response limit.

The generator uses existing rules-v1 assessment functions.
Semantic similarities are invented ordering inputs, not model outputs.
The model-version field identifies configuration only; no model runs.

The generator does not retrieve or authorize these fixture identities.
NOT_VERIFIED is explicitly synthetic/mock freshness.
generatedAt is a fixed fixture timestamp, not evidence of freshness.

## Proposed formats

Source revisions are decimal strings in these examples.
The final live revision range and validation rules remain OPEN.
Current Python assessment helpers still use integer revisions.

Error requestId values are fixed, synthetic examples.
They are not live trace identifiers and grant no authority.
The requestId format, placement, propagation and error codes remain
proposals pending final specification.

Assessment object keys use camelCase.
missingFields values preserve existing scorer field identifiers, such as
worker.relevant_experience_months; they are not converted to camelCase.

## Headers and failure behavior

A future mock server should model Cache-Control: no-store.
Static JSON files cannot enforce HTTP response headers.

Unavailable and unauthorized responses contain no result items.
Do not convert infrastructure failures into successful empty lists.
No partial-success response is modeled.

## Reproduction

From the repository root:

    .\\ml-service\\.venv-vector\\Scripts\\python.exe \\
        .\\ml-service\\scripts\\generate-recommendation-mocks.py

The generator refuses to overwrite existing output files.
Use a clean checkout or deliberately manage existing generated fixtures
before regenerating them.

These examples do not approve live integration or the live ranking policy.
"""

    # Prepare and validate every document before writing output files.
    for name, text in files.items():
        if name.endswith(".json"):
            json.loads(text)

    conflicts = [
        str(OUTPUT / name)
        for name in files
        if (OUTPUT / name).exists()
    ]
    require(
        not conflicts,
        "Output already exists; refusing to overwrite: "
        + ", ".join(conflicts),
    )

    OUTPUT.mkdir(parents=True, exist_ok=True)

    for name, text in files.items():
        path = OUTPUT / name
        with path.open("x", encoding="utf-8", newline="\n") as output:
            output.write(text)
        print(f"Created: {path.relative_to(ROOT)}")

    print("Synthetic fixtures generated. No HTTP routes were enabled.")


if __name__ == "__main__":
    main()