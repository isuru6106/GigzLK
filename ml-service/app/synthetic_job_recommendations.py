"""Synthetic-only assessment of retrieved jobs for one worker.

No retrieval, HTTP endpoint, authorization or domain eligibility checks
are implemented here.
"""

import re
from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.matching_response import MatchResponse
from app.matching_schemas import (
    ExperienceMonths,
    JobSnapshot,
    MatchRequest,
    WorkerSnapshot,
)
from app.matching_service import assess_match
from app.synthetic_recommendations import (
    SemanticSimilarity,
    SourceRevision,
    SyntheticInput,
)


class RetrievedJob(SyntheticInput):
    job: JobSnapshot
    job_source_revision: SourceRevision
    semantic_similarity: SemanticSimilarity

    # This value applies only to this candidate job.
    # None means unknown; zero means known absence of relevant experience.
    relevant_experience_months: ExperienceMonths | None = None

    @model_validator(mode="after")
    def validate_synthetic_job(self):
        if re.fullmatch(
            r"synthetic-job-[a-z0-9-]+", self.job.job_id
        ) is None:
            raise ValueError("Only synthetic job IDs are supported.")
        return self


class SyntheticJobRequest(SyntheticInput):
    worker: WorkerSnapshot
    worker_source_revision: SourceRevision
    embedding_model_version: Annotated[
        str,
        Field(strict=True, min_length=1, max_length=200),
    ]
    candidates: Annotated[list[RetrievedJob], Field(max_length=100)]

    @model_validator(mode="after")
    def validate_request(self):
        if re.fullmatch(
            r"synthetic-worker-[a-z0-9-]+", self.worker.worker_id
        ) is None:
            raise ValueError("Only synthetic worker IDs are supported.")

        if self.worker.relevant_experience_months is not None:
            raise ValueError(
                "Provide relevant experience per candidate job, "
                "not on the shared worker snapshot."
            )

        if (
            self.embedding_model_version
            != self.embedding_model_version.strip()
        ):
            raise ValueError("Model version must not have outer whitespace.")

        candidate_ids = [
            candidate.job.job_id for candidate in self.candidates
        ]

        if len(candidate_ids) != len(set(candidate_ids)):
            raise ValueError("Duplicate job candidates are not supported.")

        return self


class AssessedJob(SyntheticInput):
    rank: int = Field(ge=1)
    job_id: str
    job_source_revision: SourceRevision
    semantic_similarity: SemanticSimilarity
    assessment: MatchResponse


class SyntheticJobResponse(SyntheticInput):
    method: Literal["SYNTHETIC_SEMANTIC_WITH_RULES"] = (
        "SYNTHETIC_SEMANTIC_WITH_RULES"
    )
    ranking_version: Literal["semantic-order-v1"] = "semantic-order-v1"
    worker_id: str
    worker_source_revision: SourceRevision
    embedding_model_version: str
    items: list[AssessedJob]
    warnings: list[str]


def assess_retrieved_jobs(
    request: SyntheticJobRequest,
) -> SyntheticJobResponse:
    """Assess each job using its explicitly supplied relevant experience.

    Ordering remains semantic similarity descending, then job ID.
    Experience derivation and source freshness are not verified here.
    """

    ordered = sorted(
        request.candidates,
        key=lambda candidate: (
            -candidate.semantic_similarity,
            candidate.job.job_id,
        ),
    )

    items = []

    for rank, candidate in enumerate(ordered, start=1):
        # The candidate field was validated before this copy.
        # Preserve the shared worker snapshot without mutating it.
        worker_for_job = request.worker.model_copy(
            update={
                "relevant_experience_months": (
                    candidate.relevant_experience_months
                )
            }
        )

        assessment = assess_match(
            MatchRequest(
                job=candidate.job,
                worker=worker_for_job,
            )
        )

        items.append(
            AssessedJob(
                rank=rank,
                job_id=candidate.job.job_id,
                job_source_revision=candidate.job_source_revision,
                semantic_similarity=candidate.semantic_similarity,
                assessment=assessment,
            )
        )

    return SyntheticJobResponse(
        worker_id=request.worker.worker_id,
        worker_source_revision=request.worker_source_revision,
        embedding_model_version=request.embedding_model_version,
        items=items,
        warnings=[
            "SYNTHETIC_DEVELOPMENT_ONLY",
            "SEMANTIC_SIMILARITY_NOT_SUITABILITY",
            "RANKING_POLICY_NOT_QUALITY_VALIDATED",
            "JOB_SPECIFIC_EXPERIENCE_NOT_VERIFIED",
            "SOURCE_FRESHNESS_NOT_VERIFIED",
            "CALLER_AUTHORIZATION_NOT_CHECKED",
            "CANDIDATE_VISIBILITY_NOT_CHECKED",
            "DOMAIN_ELIGIBILITY_NOT_CHECKED",
        ],
    )