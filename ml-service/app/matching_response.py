from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ResponseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FactorResult(ResponseModel):
    score: float | None = Field(ge=0, le=100)
    weight: float = Field(gt=0, le=1)
    reason_code: str
    explanation: str


class MatchingFactors(ResponseModel):
    skills: FactorResult
    experience: FactorResult
    availability: FactorResult
    location: FactorResult


class MatchResponse(ResponseModel):
    scoring_version: Literal["rules-v1"] = "rules-v1"
    method: Literal["RULE_BASED"] = "RULE_BASED"

    job_id: str
    worker_id: str
    assessment_status: Literal["COMPLETE", "INCOMPLETE"]
    overall_score: float | None = Field(ge=0, le=100)

    factors: MatchingFactors
    missing_fields: list[str]
    warnings: list[str]