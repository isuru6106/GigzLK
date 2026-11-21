from app.matching_response import FactorResult
from app.matching_schemas import JobSnapshot, WorkerSnapshot


def normalize(value: str) -> str:
    return value.strip().casefold()


def score_skills(
    job: JobSnapshot,
    worker: WorkerSnapshot,
) -> FactorResult:
    if worker.skills is None:
        return FactorResult(
            score=None,
            weight=0.5,
            reason_code="SKILLS_UNKNOWN",
            explanation="Worker skills were not provided.",
        )

    required = {normalize(skill) for skill in job.required_skills}
    provided = {normalize(skill) for skill in worker.skills}
    matched = required & provided

    return FactorResult(
        score=100 * len(matched) / len(required),
        weight=0.5,
        reason_code="SKILL_OVERLAP",
        explanation=(
            f"Matched {len(matched)} of "
            f"{len(required)} unique required skills."
        ),
    )


def score_experience(
    job: JobSnapshot,
    worker: WorkerSnapshot,
) -> FactorResult:
    required = job.minimum_experience_months
    actual = worker.relevant_experience_months

    if required == 0:
        return FactorResult(
            score=100,
            weight=0.2,
            reason_code="NO_EXPERIENCE_REQUIRED",
            explanation="The job requires no previous experience.",
        )

    if actual is None:
        return FactorResult(
            score=None,
            weight=0.2,
            reason_code="EXPERIENCE_UNKNOWN",
            explanation="Relevant worker experience was not provided.",
        )

    return FactorResult(
        score=min(actual / required, 1) * 100,
        weight=0.2,
        reason_code="EXPERIENCE_RATIO",
        explanation=(
            f"Worker has {actual} months of relevant experience; "
            f"the job requires {required} months."
        ),
    )


def score_availability(
    job: JobSnapshot,
    worker: WorkerSnapshot,
) -> FactorResult:
    if worker.available_from is None or worker.available_until is None:
        return FactorResult(
            score=None,
            weight=0.2,
            reason_code="AVAILABILITY_UNKNOWN",
            explanation="Worker availability was not provided.",
        )

    covers_job = (
        worker.available_from <= job.starts_at
        and worker.available_until >= job.ends_at
    )

    return FactorResult(
        score=100 if covers_job else 0,
        weight=0.2,
        reason_code=(
            "AVAILABILITY_COVERS_JOB"
            if covers_job
            else "AVAILABILITY_MISMATCH"
        ),
        explanation=(
            "Worker availability covers the entire job interval."
            if covers_job
            else "Worker availability does not cover the entire job interval."
        ),
    )


def score_location(
    job: JobSnapshot,
    worker: WorkerSnapshot,
) -> FactorResult:
    if job.remote:
        return FactorResult(
            score=100,
            weight=0.1,
            reason_code="REMOTE_JOB",
            explanation="Remote jobs do not require a location match.",
        )

    if worker.location_id is None:
        return FactorResult(
            score=None,
            weight=0.1,
            reason_code="LOCATION_UNKNOWN",
            explanation="Worker location was not provided for an onsite job.",
        )

    if job.location_id is None:
        raise ValueError("Onsite jobs require location_id.")

    matches = normalize(job.location_id) == normalize(worker.location_id)

    return FactorResult(
        score=100 if matches else 0,
        weight=0.1,
        reason_code="LOCATION_MATCH" if matches else "LOCATION_MISMATCH",
        explanation=(
            "Worker and job location identifiers match."
            if matches
            else "Worker and job location identifiers do not match."
        ),
    )