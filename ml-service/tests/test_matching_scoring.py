import pytest

from app.matching_schemas import JobSnapshot, WorkerSnapshot
from app.matching_scoring import (
    score_availability,
    score_experience,
    score_location,
    score_skills,
)


@pytest.fixture
def job():
    return JobSnapshot(
        job_id="job-test-1",
        required_skills=["Photography", "Editing"],
        minimum_experience_months=6,
        starts_at="2026-11-01T09:00:00+05:30",
        ends_at="2026-11-01T17:00:00+05:30",
        remote=True,
    )


@pytest.mark.parametrize(
    ("skills", "expected"),
    [
        (["photography", "editing"], 100),
        (["photography"], 50),
        ([], 0),
        (["cooking"], 0),
        (None, None),
    ],
)
def test_skill_scores(job, skills, expected):
    worker = WorkerSnapshot(
        worker_id="worker-test-1",
        skills=skills,
    )

    result = score_skills(job, worker)

    assert result.score == expected
    assert result.weight == 0.5

    if skills is None:
        assert result.reason_code == "SKILLS_UNKNOWN"


def test_skill_normalization_and_duplicates(job):
    job = job.model_copy(
        update={
            "required_skills": [
                "Photography",
                " photography ",
                "Editing",
            ]
        }
    )
    worker = WorkerSnapshot(
        worker_id="worker-test-1",
        skills=[" PHOTOGRAPHY ", "photography"],
    )

    result = score_skills(job, worker)

    assert result.score == 50
    assert result.explanation == "Matched 1 of 2 unique required skills."


@pytest.mark.parametrize(
    ("months", "expected"),
    [
        (0, 0),
        (3, 50),
        (6, 100),
        (12, 100),
        (None, None),
    ],
)
def test_experience_scores(job, months, expected):
    worker = WorkerSnapshot(
        worker_id="worker-test-1",
        relevant_experience_months=months,
    )

    result = score_experience(job, worker)

    assert result.score == expected
    assert result.weight == 0.2

    if months is None:
        assert result.reason_code == "EXPERIENCE_UNKNOWN"


def test_zero_requirement_accepts_unknown_experience(job):
    job = job.model_copy(
        update={"minimum_experience_months": 0}
    )
    worker = WorkerSnapshot(worker_id="worker-test-1")

    result = score_experience(job, worker)

    assert result.score == 100
    assert result.reason_code == "NO_EXPERIENCE_REQUIRED"


def test_fractional_skill_score_is_not_rounded(job):
    job = job.model_copy(
        update={
            "required_skills": [
                "photography",
                "editing",
                "lighting",
            ]
        }
    )
    worker = WorkerSnapshot(
        worker_id="worker-test-1",
        skills=["photography"],
    )

    result = score_skills(job, worker)

    assert result.score == pytest.approx(100 / 3)
    assert result.score != round(100 / 3, 2)


@pytest.mark.parametrize(
    ("start", "end", "expected", "reason"),
    [
        (
            "2026-11-01T08:00:00+05:30",
            "2026-11-01T18:00:00+05:30",
            100,
            "AVAILABILITY_COVERS_JOB",
        ),
        (
            "2026-11-01T09:00:00+05:30",
            "2026-11-01T17:00:00+05:30",
            100,
            "AVAILABILITY_COVERS_JOB",
        ),
        (
            "2026-11-01T03:30:00+00:00",
            "2026-11-01T11:30:00+00:00",
            100,
            "AVAILABILITY_COVERS_JOB",
        ),
        (
            "2026-11-01T09:01:00+05:30",
            "2026-11-01T18:00:00+05:30",
            0,
            "AVAILABILITY_MISMATCH",
        ),
        (
            "2026-11-01T08:00:00+05:30",
            "2026-11-01T16:59:00+05:30",
            0,
            "AVAILABILITY_MISMATCH",
        ),
        (
            None,
            None,
            None,
            "AVAILABILITY_UNKNOWN",
        ),
    ],
)
def test_availability_scores(job, start, end, expected, reason):
    worker = WorkerSnapshot(
        worker_id="worker-test-1",
        available_from=start,
        available_until=end,
    )

    result = score_availability(job, worker)

    assert result.score == expected
    assert result.weight == 0.2
    assert result.reason_code == reason


@pytest.mark.parametrize(
    ("remote", "location", "expected", "reason"),
    [
        (True, None, 100, "REMOTE_JOB"),
        (True, "kandy", 100, "REMOTE_JOB"),
        (False, "colombo", 100, "LOCATION_MATCH"),
        (False, " COLOMBO ", 100, "LOCATION_MATCH"),
        (False, "kandy", 0, "LOCATION_MISMATCH"),
        (False, None, None, "LOCATION_UNKNOWN"),
    ],
)
def test_location_scores(job, remote, location, expected, reason):
    matching_job = job.model_copy(
        update={
            "remote": remote,
            "location_id": "Colombo",
        }
    )
    worker = WorkerSnapshot(
        worker_id="worker-test-1",
        location_id=location,
    )

    result = score_location(matching_job, worker)

    assert result.score == expected
    assert result.weight == 0.1
    assert result.reason_code == reason