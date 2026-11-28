"""Synthetic payment-baseline tests. No private survey data is read."""

import csv
import json
import runpy
import subprocess
import sys
from pathlib import Path

import pytest


SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "train-payment-baseline.py"
)

module = runpy.run_path(str(SCRIPT))
load_candidates = module["load_candidates"]
predict = module["predict"]
fit_and_evaluate = module["fit_and_evaluate"]


def synthetic_rows():
    return [
        {
            "record_id": f"synthetic-{index}",
            "source_type": "SURVEY_SELF_REPORTED",
            "pilot_actual_eligible": "true",
            "recency_status": "WITHIN_WINDOW_BY_MONTH",
            "payment_status": "PAID_IN_FULL",
            "pay_recipient_basis": "PER_WORKER",
            "category": "EVENTS_PROMOTIONS",
            "actual_received_lkr": str(amount),
            "paid_hours": "2",
        }
        for index, amount in enumerate(
            [1000, 2000, 3000, 4000], start=1
        )
    ]


def write_csv(tmp_path, rows):
    path = tmp_path / "synthetic.csv"

    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    return path


def test_hourly_target_and_input_preservation(tmp_path):
    path = write_csv(tmp_path, synthetic_rows())
    original = path.read_bytes()

    records = load_candidates(path)

    assert [row["target"] for row in records] == [
        500.0, 1000.0, 1500.0, 2000.0
    ]
    assert path.read_bytes() == original


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("source_type", "WEB_ADVERTISEMENT"),
        ("source_type", "MARKET_BENCHMARK"),
        ("pilot_actual_eligible", "false"),
        ("recency_status", "OUTSIDE_SIX_MONTH_WINDOW"),
        ("recency_status", "BOUNDARY_MONTH_REQUIRES_DAY"),
        ("payment_status", "PARTIALLY_PAID"),
        ("payment_status", "NOT_PAID"),
        ("pay_recipient_basis", "TEAM"),
        ("pay_recipient_basis", "UNKNOWN"),
    ],
)
def test_nonqualifying_records_rejected(tmp_path, field, value):
    rows = synthetic_rows()
    rows[0][field] = value

    with pytest.raises(ValueError):
        load_candidates(write_csv(tmp_path, rows))


@pytest.mark.parametrize(
    "field", ["actual_received_lkr", "paid_hours"]
)
@pytest.mark.parametrize("value", ["", "NaN", "Infinity", "-1", "0"])
def test_invalid_amounts_and_hours_rejected(tmp_path, field, value):
    rows = synthetic_rows()
    rows[0][field] = value

    with pytest.raises(ValueError):
        load_candidates(write_csv(tmp_path, rows))


def test_duplicate_ids_rejected(tmp_path):
    rows = synthetic_rows()
    rows[1]["record_id"] = rows[0]["record_id"]

    with pytest.raises(ValueError, match="Duplicate"):
        load_candidates(write_csv(tmp_path, rows))


def test_insufficient_records_rejected(tmp_path):
    with pytest.raises(ValueError, match="At least three"):
        load_candidates(write_csv(tmp_path, synthetic_rows()[:2]))


def test_category_median_and_small_group_fallback():
    rows = [
        {"category": "A", "target": 100.0},
        {"category": "A", "target": 200.0},
        {"category": "A", "target": 300.0},
        {"category": "B", "target": 1000.0},
        {"category": "B", "target": 2000.0},
    ]

    assert predict(
        rows, "A", "category_with_global_fallback"
    ) == (200.0, "CATEGORY_MEDIAN")

    assert predict(
        rows, "B", "category_with_global_fallback"
    ) == (300.0, "GLOBAL_MEDIAN")


def test_held_out_label_does_not_enter_training():
    rows = [
        {"record_id": "one", "category": "A", "target": 100.0},
        {"record_id": "two", "category": "A", "target": 200.0},
        {"record_id": "held", "category": "A", "target": 10000.0},
    ]

    _, _, predictions = fit_and_evaluate(rows)

    held = next(
        row for row in predictions
        if row["record_id"] == "held"
        and row["policy"] == "global_median"
    )

    assert held["predicted_lkr_per_hour"] == 150.0
    assert held["absolute_error_lkr_per_hour"] == 9850.0


def test_model_remains_offline_without_outcome_features(tmp_path):
    rows = load_candidates(write_csv(tmp_path, synthetic_rows()))

    model, evaluation, predictions = fit_and_evaluate(rows)

    assert model["prediction_features"] == ["category"]
    assert model["label_denominator_not_a_feature"] == "actual hours"
    assert model["production_ready"] is False
    assert model["allowed_live_inference"] is False
    assert evaluation["independent_test_set"] is False

    json.dumps([model, evaluation, predictions], allow_nan=False)


def test_cli_creates_outputs_and_refuses_overwrite(tmp_path):
    source = write_csv(tmp_path, synthetic_rows())
    output = tmp_path / "model-output"

    command = [
        sys.executable,
        str(SCRIPT),
        "--input", str(source),
        "--output", str(output),
    ]

    first = subprocess.run(
        command, capture_output=True, text=True, check=False
    )
    assert first.returncode == 0, first.stderr

    for filename in (
        "model.json",
        "evaluation.json",
        "diagnostic_predictions.csv",
    ):
        assert (output / filename).is_file()

    original = (output / "model.json").read_bytes()

    second = subprocess.run(
        command, capture_output=True, text=True, check=False
    )

    assert second.returncode != 0
    assert (output / "model.json").read_bytes() == original