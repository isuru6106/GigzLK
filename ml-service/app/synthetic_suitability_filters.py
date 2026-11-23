"""Optional filters for already assessed synthetic recommendation results."""

from pydantic import Field, StrictBool

from app.synthetic_job_recommendations import SyntheticJobResponse
from app.synthetic_recommendations import (
    SyntheticInput,
    SyntheticWorkerResponse,
)


class SyntheticFilterOptions(SyntheticInput):
    exclude_availability_mismatch: StrictBool = False
    exclude_location_mismatch: StrictBool = False


class FilterSummary(SyntheticInput):
    input_count: int = Field(ge=0)
    returned_count: int = Field(ge=0)
    excluded_count: int = Field(ge=0)
    excluded_availability_mismatch_count: int = Field(ge=0)
    excluded_location_mismatch_count: int = Field(ge=0)


class FilteredWorkers(SyntheticInput):
    policy_version: str = "synthetic-known-mismatches-v1"
    filters: SyntheticFilterOptions
    summary: FilterSummary
    result: SyntheticWorkerResponse


class FilteredJobs(SyntheticInput):
    policy_version: str = "synthetic-known-mismatches-v1"
    filters: SyntheticFilterOptions
    summary: FilterSummary
    result: SyntheticJobResponse


def _filter_items(items, options):
    kept = []
    excluded_count = 0
    availability_count = 0
    location_count = 0

    for item in items:
        factors = item.assessment.factors

        exclude_availability = (
            options.exclude_availability_mismatch
            and factors.availability.reason_code == "AVAILABILITY_MISMATCH"
        )
        exclude_location = (
            options.exclude_location_mismatch
            and factors.location.reason_code == "LOCATION_MISMATCH"
        )

        if exclude_availability or exclude_location:
            excluded_count += 1
            availability_count += int(exclude_availability)
            location_count += int(exclude_location)
            continue

        kept.append(
            item.model_copy(
                update={"rank": len(kept) + 1},
                deep=True,
            )
        )

    return kept, FilterSummary(
        input_count=len(items),
        returned_count=len(kept),
        excluded_count=excluded_count,
        excluded_availability_mismatch_count=availability_count,
        excluded_location_mismatch_count=location_count,
    )


def _warnings(existing, options):
    warnings = list(existing)

    if (
        options.exclude_availability_mismatch
        or options.exclude_location_mismatch
    ):
        for code in (
            "SYNTHETIC_FILTERS_NOT_DOMAIN_ELIGIBILITY",
            "FILTERED_RETRIEVED_POOL_NOT_EXHAUSTIVE",
        ):
            if code not in warnings:
                warnings.append(code)

    return warnings


def filter_assessed_workers(
    response: SyntheticWorkerResponse,
    options: SyntheticFilterOptions,
) -> FilteredWorkers:
    """Filter known mismatches without changing assessments or unknowns."""

    items, summary = _filter_items(response.items, options)

    result = response.model_copy(
        update={
            "items": items,
            "warnings": _warnings(response.warnings, options),
        },
        deep=True,
    )

    return FilteredWorkers(
        filters=options.model_copy(deep=True),
        summary=summary,
        result=result,
    )


def filter_assessed_jobs(
    response: SyntheticJobResponse,
    options: SyntheticFilterOptions,
) -> FilteredJobs:
    """Apply the same optional policy to retrieved-job assessments."""

    items, summary = _filter_items(response.items, options)

    result = response.model_copy(
        update={
            "items": items,
            "warnings": _warnings(response.warnings, options),
        },
        deep=True,
    )

    return FilteredJobs(
        filters=options.model_copy(deep=True),
        summary=summary,
        result=result,
    )