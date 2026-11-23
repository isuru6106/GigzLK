# Synthetic recommendation frontend mocks

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

    .\ml-service\.venv-vector\Scripts\python.exe \
        .\ml-service\scripts\generate-recommendation-mocks.py

The generator refuses to overwrite existing output files.
Use a clean checkout or deliberately manage existing generated fixtures
before regenerating them.

These examples do not approve live integration or the live ranking policy.
