from app.matching_response import MatchResponse, MatchingFactors
from app.matching_schemas import MatchRequest
from app.matching_scoring import (
    score_availability,
    score_experience,
    score_location,
    score_skills,
)


def assess_match(request: MatchRequest) -> MatchResponse:
    job = request.job
    worker = request.worker

    factors = {
        "skills": score_skills(job, worker),
        "experience": score_experience(job, worker),
        "availability": score_availability(job, worker),
        "location": score_location(job, worker),
    }

    missing_fields = []

    if factors["skills"].score is None:
        missing_fields.append("worker.skills")

    if factors["experience"].score is None:
        missing_fields.append("worker.relevant_experience_months")

    if factors["availability"].score is None:
        missing_fields.extend(
            [
                "worker.available_from",
                "worker.available_until",
            ]
        )

    if factors["location"].score is None:
        missing_fields.append("worker.location_id")

    warnings = [
        "RULE_BASED_SCORE_NOT_HIRING_PROBABILITY",
        "DOMAIN_ELIGIBILITY_NOT_CHECKED",
    ]

    if factors["availability"].reason_code == "AVAILABILITY_MISMATCH":
        warnings.append("AVAILABILITY_MISMATCH")

    if factors["location"].reason_code == "LOCATION_MISMATCH":
        warnings.append("LOCATION_MISMATCH")

    overall_score = None

    if not missing_fields:
        overall_score = round(
            sum(
                factor.score * factor.weight
                for factor in factors.values()
                if factor.score is not None
            ),
            2,
        )

    displayed_factors = {
        name: factor.model_copy(
            update={
                "score": (
                    round(factor.score, 2)
                    if factor.score is not None
                    else None
                )
            }
        )
        for name, factor in factors.items()
    }

    return MatchResponse(
        job_id=job.job_id,
        worker_id=worker.worker_id,
        assessment_status="INCOMPLETE" if missing_fields else "COMPLETE",
        overall_score=overall_score,
        factors=MatchingFactors(**displayed_factors),
        missing_fields=missing_fields,
        warnings=warnings,
    )