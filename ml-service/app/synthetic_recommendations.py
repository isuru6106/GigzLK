"""Synthetic-only assessment of semantically retrieved worker candidates.

This module does not retrieve candidates, authorize disclosure, check domain
eligibility or expose an HTTP endpoint.
"""

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.matching_response import MatchResponse
from app.matching_schemas import JobSnapshot, WorkerSnapshot
from app.matching_service import assess_match
from app.matching_schemas import MatchRequest


SourceRevision = Annotated[
    int,
    Field(strict=True, ge=1, le=9_223_372_036_854_775_807),
]

SemanticSimilarity = Annotated[
    float,
    Field(strict=True, ge=-1, le=1, allow_inf_nan=False),
]


class SyntheticInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RetrievedWorker(SyntheticInput):
    worker: WorkerSnapshot
    worker_source_revision: SourceRevision
    semantic_similarity: SemanticSimilarity

    @model_validator(mode="after")
    def validate_synthetic_worker(self):
        if re.fullmatch(
            r"synthetic-worker-[a-z0-9-]+", self.worker.worker_id
        ) is None:
            raise ValueError("Only synthetic worker IDs are supported.")
        return self


class SyntheticWorkerRequest(SyntheticInput):
    job: JobSnapshot
    job_source_revision: SourceRevision
    embedding_model_version: Annotated[
        str,
        Field(strict=True, min_length=1, max_length=200),
    ]
    candidates: Annotated[list[RetrievedWorker], Field(max_length=100)]

    @model_validator(mode="after")
    def validate_request(self):
        if re.fullmatch(
            r"synthetic-job-[a-z0-9-]+", self.job.job_id
        ) is None:
            raise ValueError("Only synthetic job IDs are supported.")

        if (
            self.embedding_model_version
            != self.embedding_model_version.strip()
        ):
            raise ValueError("Model version must not have outer whitespace.")

        candidate_ids = [
            candidate.worker.worker_id for candidate in self.candidates
        ]

        if len(candidate_ids) != len(set(candidate_ids)):
            raise ValueError("Duplicate worker candidates are not supported.")

        return self


class AssessedWorker(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rank: int = Field(ge=1)
    worker_id: str
    worker_source_revision: SourceRevision
    semantic_similarity: SemanticSimilarity
    assessment: MatchResponse


class SyntheticWorkerResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    method: Literal["SYNTHETIC_SEMANTIC_WITH_RULES"] = (
        "SYNTHETIC_SEMANTIC_WITH_RULES"
    )
    ranking_version: Literal["semantic-order-v1"] = "semantic-order-v1"
    job_id: str
    job_source_revision: SourceRevision
    embedding_model_version: str
    items: list[AssessedWorker]
    warnings: list[str]


def assess_retrieved_workers(
    request: SyntheticWorkerRequest,
) -> SyntheticWorkerResponse:
    """Attach rules-v1 assessments without replacing missing values.

    Candidate experience must be relevant to the supplied job.
    Source revisions are supplied metadata, not verified freshness.
    """

    ordered = sorted(
        request.candidates,
        key=lambda candidate: (
            -candidate.semantic_similarity,
            candidate.worker.worker_id,
        ),
    )

    items = []

    for rank, candidate in enumerate(ordered, start=1):
        assessment = assess_match(
            MatchRequest(
                job=request.job,
                worker=candidate.worker,
            )
        )

        items.append(
            AssessedWorker(
                rank=rank,
                worker_id=candidate.worker.worker_id,
                worker_source_revision=candidate.worker_source_revision,
                semantic_similarity=candidate.semantic_similarity,
                assessment=assessment,
            )
        )

    return SyntheticWorkerResponse(
        job_id=request.job.job_id,
        job_source_revision=request.job_source_revision,
        embedding_model_version=request.embedding_model_version,
        items=items,
        warnings=[
            "SYNTHETIC_DEVELOPMENT_ONLY",
            "SEMANTIC_SIMILARITY_NOT_SUITABILITY",
            "RANKING_POLICY_NOT_QUALITY_VALIDATED",
            "SOURCE_FRESHNESS_NOT_VERIFIED",
            "CALLER_AUTHORIZATION_NOT_CHECKED",
            "CANDIDATE_VISIBILITY_NOT_CHECKED",
            "DOMAIN_ELIGIBILITY_NOT_CHECKED",
        ],
    )