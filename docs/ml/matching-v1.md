# Explainable Job-Worker Matching v1

Status: PROPOSED — pending review by integration owners.
Scoring version: rules-v1
Method: RULE_BASED

## Purpose

Compare a job with a worker and return an explainable suitability
score. This is not a trained model or a hiring probability.

Endpoint: POST /api/v1/ml/match

The caller supplies job and worker snapshots.
The matcher does not access other services' private databases.

## Proposed scoring

| Factor | Weight | Rule |
|---|---:|---|
| Skills | 50% | Matched required skills / total required skills |
| Experience | 20% | Relevant experience / minimum required, capped at 100% |
| Availability | 20% | 100% if worker availability covers the full job interval; otherwise 0% |
| Location | 10% | 100% for remote jobs or matching location identifiers; otherwise 0% |

Overall score = weighted sum of factor scores.

Weights are initial design assumptions, not learned values.
Calculate using unrounded factors; round displayed scores to two decimals.

## Job input

- job_id: non-empty string
- required_skills: non-empty list of non-empty skill identifiers
- minimum_experience_months: non-negative integer
- starts_at and ends_at: timezone-aware datetimes
- remote: boolean
- location_id: non-empty string required for onsite jobs

The job interval must end after it starts.

## Worker input

- worker_id: non-empty string
- skills: list of skill identifiers, or null when unknown
- relevant_experience_months: non-negative integer, or null
- available_from and available_until: timezone-aware datetimes, or null
- location_id: non-empty string, or null

Availability boundaries must both be supplied or both be null.
The availability interval must end after it starts.
Relevant experience must relate to this job.

## Validation and comparison

Reject unknown fields and invalid types.
Reject booleans as integer experience values.
Accept datetime strings with explicit timezone offsets.

Trim and compare skill/location identifiers case-insensitively.
Deduplicate skills after normalization.
Do not infer synonyms or geographic distance.

A zero experience requirement is satisfied without worker experience.
Remote jobs do not require worker location.
Compare schedule instants with timezone offsets accounted for.

Version 1 supports one job interval and one availability interval.

## Missing information

An empty worker skills list means known absence of skills.
Null means unknown information.

Return null for any factor that cannot be assessed.

If any factor is unknown:
- assessment_status: INCOMPLETE
- overall_score: null
- include missing_fields
- retain known factor scores
- do not redistribute weights

Otherwise:
- assessment_status: COMPLETE
- overall_score: 0–100

## Response

- scoring_version
- method
- job_id and worker_id
- assessment_status
- overall_score
- factors: skills, experience, availability, location
- each factor: score, weight, reason_code, explanation
- missing_fields
- warnings

Known schedule/location mismatches must remain visible in warnings,
even when the overall score is high.

## Boundaries

Member 2 retains authoritative eligibility, capacity and conflict checks.
Scores do not automatically accept or reject applications.

Payment compatibility, ratings, reliability, multiple shifts,
semantic search and trained models are deferred.

Use synthetic fixtures for development; do not claim predictive
accuracy from those fixtures.

Caller authorization is required before shared exposure.