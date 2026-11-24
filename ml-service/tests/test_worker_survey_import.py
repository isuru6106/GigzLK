"""Synthetic tests only. No real survey responses are read."""

import csv
import json
import runpy
from pathlib import Path

import pytest


SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "import-worker-survey.py"
)

MODULE = runpy.run_path(str(SCRIPT))
QUESTION_FIELDS = MODULE["QUESTION_FIELDS"]
map_headers = MODULE["map_headers"]
read_number = MODULE["read_number"]
normalize_record = MODULE["normalize_record"]
import_csv = MODULE["import_csv"]


def sample_values():
    values = {
        field: ""
        for field in QUESTION_FIELDS.values()
    }

    values.update({
        "adult": "Yes / ඔව්",
        "qualifying_work": "Yes / ඔව්",
        "consent": "Yes, I agree / ඔව්",
        "work_type": "One shift or day",
        "work_month": "2026-10",
        "job_title": "Synthetic event assistant",
        "category": "Events and promotions",
        "tasks": "Synthetic setup tasks",
        "district": "Colombo",
        "work_mode": "Fully onsite",
        "experience_required": "No previous experience required",
        "experience_months": "0",
        "pay_basis": "One shift or day",
        "hours": "7.5",
        "days": "1",
        "work_conditions": "Weekend or public-holiday work",
        "own_payment": "Yes",
        "agreed": "2500",
        "payment_status": "Paid in full",
        "received": "2300",
        "deductions_status": "Yes",
        "deductions": "200",
        "benefits": "Meals",
        "reimbursements": "0",
        "unreimbursed_costs": "100",
    })

    return values


def write_csv(tmp_path, rows):
    """Put Q18a last, matching the user's export."""
    questions = [
        question
        for question in QUESTION_FIELDS
        if question != "18a"
    ] + ["18a"]

    headers = ["Timestamp"] + [
        f"{question}. Synthetic question\nකෘත්‍රිම ප්‍රශ්නය"
        for question in questions
    ]

    path = tmp_path / "synthetic-responses.csv"

    with path.open(
        "w", encoding="utf-8-sig", newline=""
    ) as output:
        writer = csv.writer(output)
        writer.writerow(headers)

        for row in rows:
            writer.writerow(
                ["11/24/2026 00:00:00"] + [
                    row[QUESTION_FIELDS[question]]
                    for question in questions
                ]
            )

    return path


def test_headers_support_reordering_and_q18a_without_space():
    headers = [
        "Timestamp",
        *[
            f"{question}.Synthetic question"
            for question in reversed(QUESTION_FIELDS)
        ],
    ]

    mapping = map_headers(headers)

    assert set(mapping) == set(QUESTION_FIELDS.values())
    assert headers[mapping["received"]].startswith("18a.")


def test_duplicate_question_is_rejected():
    headers = [
        "Timestamp",
        *[f"{question}. Test" for question in QUESTION_FIELDS],
        "18a. Duplicate",
    ]

    with pytest.raises(ValueError, match="Duplicate"):
        map_headers(headers)


def test_missing_actual_payment_column_is_rejected():
    headers = [
        "Timestamp",
        *[
            f"{question}. Test"
            for question in QUESTION_FIELDS
            if question != "18a"
        ],
    ]

    with pytest.raises(ValueError, match="Missing"):
        map_headers(headers)


def test_unexpected_column_is_rejected():
    headers = [
        "Timestamp",
        *[f"{question}. Test" for question in QUESTION_FIELDS],
        "Email Address",
    ]

    with pytest.raises(ValueError, match="Unexpected"):
        map_headers(headers)


@pytest.mark.parametrize("raw", [
    "",
    "unknown",
    "Not sure",
    "නිශ්චිතව නොදනී",
])
def test_unknown_amount_stays_null(raw):
    flags = []

    assert read_number(raw, "received", flags) is None
    assert flags == []


@pytest.mark.parametrize("raw", [
    "-1",
    "NaN",
    "Infinity",
    "1,5",
    "LKR 2500",
    "True",
])
def test_invalid_amount_is_flagged(raw):
    flags = []

    assert read_number(raw, "received", flags) is None
    assert "INVALID_RECEIVED" in flags


def test_zero_and_grouped_amount_are_preserved():
    flags = []

    assert read_number("0", "received", flags) == "0"
    assert read_number("2,500.50", "received", flags) == "2500.50"
    assert flags == []


@pytest.mark.parametrize("raw", ["0", "1.5", "-1"])
def test_days_must_be_positive_whole_numbers(raw):
    flags = []

    result = read_number(
        raw, "days", flags, whole=True, positive=True
    )

    assert result is None
    assert "INVALID_DAYS" in flags


@pytest.mark.parametrize("field", [
    "adult",
    "qualifying_work",
    "consent",
])
def test_unconfirmed_gate_excludes_response(tmp_path, field):
    values = sample_values()
    values[field] = "No"

    records, summary = import_csv(
        write_csv(tmp_path, [values])
    )

    assert records == []
    assert summary["excluded_records"] == 1
    assert summary["eligible_consenting_records"] == 0


def test_import_preserves_distinct_payment_amounts(tmp_path):
    records, summary = import_csv(
        write_csv(tmp_path, [sample_values()])
    )

    record = records[0]

    assert record["agreed_lkr"] == "2500"
    assert record["received_lkr"] == "2300"
    assert record["deductions_lkr"] == "200"
    assert summary["actual_payment_known"] == 1
    assert record["training_eligible"] is False


def test_missing_received_amount_is_not_derived(tmp_path):
    values = sample_values()
    values["received"] = ""

    records, summary = import_csv(
        write_csv(tmp_path, [values])
    )

    assert records[0]["received_lkr"] is None
    assert summary["actual_payment_known"] == 0
    assert "ACTUAL_PAYMENT_UNKNOWN" in records[0]["quality_flags"]


def test_team_total_is_not_individual_payment():
    values = sample_values()
    values["own_payment"] = "No, I only know the team total"

    record = normalize_record(values, "synthetic-record")

    for field in (
        "agreed_lkr",
        "received_lkr",
        "deductions_lkr",
        "reimbursements_lkr",
        "unreimbursed_costs_lkr",
    ):
        assert record[field] is None

    assert "INDIVIDUAL_PAYMENT_NOT_IDENTIFIED" in record["quality_flags"]


def test_partial_payment_is_preserved_and_flagged():
    values = sample_values()
    values["payment_status"] = "Partially paid"
    values["received"] = "1000"

    record = normalize_record(values, "synthetic-record")

    assert record["received_lkr"] == "1000"
    assert "PAYMENT_NOT_SETTLED" in record["quality_flags"]
    assert record["training_eligible"] is False


def test_unpaid_response_does_not_invent_zero():
    values = sample_values()
    values["payment_status"] = "Not paid yet"
    values["received"] = ""

    record = normalize_record(values, "synthetic-record")

    assert record["received_lkr"] is None
    assert "PAYMENT_NOT_SETTLED" in record["quality_flags"]


def test_unpaid_with_positive_received_amount_is_flagged():
    values = sample_values()
    values["payment_status"] = "Not paid yet"

    record = normalize_record(values, "synthetic-record")

    assert "CONTRADICTORY_PAYMENT_STATUS" in record["quality_flags"]


def test_checkbox_contradiction_is_flagged():
    values = sample_values()
    values["work_conditions"] = "Night work, None"

    record = normalize_record(values, "synthetic-record")

    assert "CONTRADICTORY_WORK_CONDITIONS" in record["quality_flags"]


def test_impossible_hours_and_days_are_flagged():
    values = sample_values()
    values["hours"] = "25"
    values["days"] = "1"

    record = normalize_record(values, "synthetic-record")

    assert "HOURS_EXCEED_REPORTED_DAYS" in record["quality_flags"]


def test_free_text_and_timestamp_are_not_exported(tmp_path):
    values = sample_values()
    marker = "SYNTHETIC_PRIVATE_MARKER"
    values["job_title"] = marker
    values["tasks"] = marker
    values["benefits"] = marker

    records, summary = import_csv(
        write_csv(tmp_path, [values])
    )

    serialized = json.dumps([records, summary])

    assert marker not in serialized
    assert "11/24/2026 00:00:00" not in serialized
    assert records[0]["job_title_present"] is True
    assert records[0]["tasks_present"] is True


def test_possible_duplicates_are_retained_for_review(tmp_path):
    values = sample_values()

    records, summary = import_csv(
        write_csv(tmp_path, [values, values.copy()])
    )

    assert len(records) == 2
    assert summary["possible_duplicate_records"] == 1
    assert "POSSIBLE_DUPLICATE_ANSWERS" in records[1]["quality_flags"]
    assert records[0]["record_id"] != records[1]["record_id"]


def test_header_only_export_produces_empty_summary(tmp_path):
    records, summary = import_csv(write_csv(tmp_path, []))

    assert records == []
    assert summary["response_rows_read"] == 0
    assert summary["training_approved_records"] == 0