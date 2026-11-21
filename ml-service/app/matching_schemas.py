from typing import Annotated, Self

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StringConstraints,
    model_validator,
)


NonEmptyString = Annotated[
    str,
    StringConstraints(strict=True, strip_whitespace=True, min_length=1),
]

ExperienceMonths = Annotated[int, Field(strict=True, ge=0)]


class MatchingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class JobSnapshot(MatchingInput):
    job_id: NonEmptyString
    required_skills: Annotated[list[NonEmptyString], Field(min_length=1)]
    minimum_experience_months: ExperienceMonths
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    remote: StrictBool
    location_id: NonEmptyString | None = None

    @model_validator(mode="after")
    def validate_job(self) -> Self:
        if self.ends_at <= self.starts_at:
            raise ValueError("Job end must be after job start.")

        if not self.remote and self.location_id is None:
            raise ValueError("Onsite jobs require location_id.")

        return self


class WorkerSnapshot(MatchingInput):
    worker_id: NonEmptyString
    skills: list[NonEmptyString] | None = None
    relevant_experience_months: ExperienceMonths | None = None
    available_from: AwareDatetime | None = None
    available_until: AwareDatetime | None = None
    location_id: NonEmptyString | None = None

    @model_validator(mode="after")
    def validate_availability(self) -> Self:
        if (self.available_from is None) != (self.available_until is None):
            raise ValueError("Provide both availability boundaries or neither.")

        if (
            self.available_from is not None
            and self.available_until is not None
            and self.available_until <= self.available_from
        ):
            raise ValueError("Availability end must be after its start.")

        return self


class MatchRequest(MatchingInput):
    job: JobSnapshot
    worker: WorkerSnapshot