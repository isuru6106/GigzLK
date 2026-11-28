"""Fit and inspect an OFFLINE self-reported received-pay hourly baseline.

Standard library only. Never accepts advertised pay or benchmark labels.
Hourly target = actual work payment received / actual hours in same period.
Actual hours are a label denominator, NOT a prediction feature.
"""
import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path
from statistics import mean, median


def positive(value):
    try:
        x = Decimal(value)
    except (InvalidOperation, TypeError):
        raise ValueError("Invalid numeric label") from None
    if not x.is_finite() or x <= 0:
        raise ValueError("Labels and hours must be finite and positive")
    return x


def load_candidates(path):
    rows = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if r.get("source_type") != "SURVEY_SELF_REPORTED":
                raise ValueError("Only self-reported actual-pay records are accepted")
            if r.get("pilot_actual_eligible") != "true":
                raise ValueError("Input contains a record held for review")
            if r.get("recency_status") != "WITHIN_WINDOW_BY_MONTH":
                raise ValueError("Input contains an unresolved or out-of-window date")
            if r.get("payment_status") != "PAID_IN_FULL" or r.get("pay_recipient_basis") != "PER_WORKER":
                raise ValueError("Input payment is not individual and settled")
            y = positive(r["actual_received_lkr"]) / positive(r["paid_hours"])
            rows.append({"record_id": r["record_id"], "category": r["category"], "target": float(y)})
    if len(rows) < 3:
        raise ValueError("At least three pilot candidates are needed for this diagnostic")
    if len({r["record_id"] for r in rows}) != len(rows):
        raise ValueError("Duplicate record IDs")
    return rows


def predict(train, category, policy):
    if not train:
        raise ValueError("No training records")
    selected = [r["target"] for r in train if r["category"] == category]
    if policy == "category_with_global_fallback" and len(selected) >= 3:
        return median(selected), "CATEGORY_MEDIAN"
    return median(r["target"] for r in train), "GLOBAL_MEDIAN"


def fit_and_evaluate(rows):
    predictions = []
    scores = {}
    for policy in ("global_median", "category_with_global_fallback"):
        errors = []
        for i, held in enumerate(rows):
            # Fit again after excluding the held record: no label leakage.
            train = rows[:i] + rows[i+1:]
            predicted, route = predict(train, held["category"], policy)
            error = abs(predicted - held["target"])
            errors.append(error)
            predictions.append({"record_id": held["record_id"], "policy": policy,
                                "observed_lkr_per_hour": round(held["target"], 4),
                                "predicted_lkr_per_hour": round(predicted, 4),
                                "absolute_error_lkr_per_hour": round(error, 4), "route": route})
        scores[policy] = {"leave_one_record_out_mae_lkr_per_hour": round(mean(errors), 4),
                          "median_absolute_error_lkr_per_hour": round(median(errors), 4)}
    grouped = defaultdict(list)
    for r in rows:
        grouped[r["category"]].append(r["target"])
    model = {"model_version": "received-hourly-median-pilot-v1",
             "purpose": "OFFLINE_EXPLORATORY_ONLY", "production_ready": False,
             "target": "SELF_REPORTED_WORK_PAYMENT_RECEIVED_PER_ACTUAL_HOUR_LKR",
             "target_excludes": ["separate reimbursements", "separate tips/bonuses per survey instruction"],
             "target_is_not": ["advertised salary", "gross employer budget", "net earnings after unreimbursed costs"],
             "prediction_features": ["category"], "label_denominator_not_a_feature": "actual hours",
             "primary_policy": "global_median", "fitted_record_count": len(rows),
             "global_median_lkr_per_hour": round(median(r["target"] for r in rows), 4),
             "candidate_category_policy_minimum_records": 3,
             "category_medians": {k: {"count": len(v), "median_lkr_per_hour": round(median(v), 4)}
                                  for k, v in sorted(grouped.items())},
             "allowed_live_inference": False}
    evaluation = {"method": "LEAVE_ONE_RECORD_OUT_DIAGNOSTIC", "records": len(rows),
                  "metrics": scores, "independent_test_set": False,
                  "respondent_grouping_available": False,
                  "limitations": ["Tiny convenience sample; findings are not population accuracy.",
                                  "Record separation does not guarantee independent respondents or employers.",
                                  "Category policy is exploratory; no promotion selected from these scores.",
                                  "No calibrated prediction range, future-time test or live API is provided.",
                                  "Received pay after deductions differs from gross publisher budget.",
                                  "Actual hours must not enter pre-job prediction features."]}
    return model, evaluation, predictions


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    if a.output.exists():
        raise ValueError("Choose a new output directory; existing outputs are not overwritten")
    rows = load_candidates(a.input)
    model, evaluation, predictions = fit_and_evaluate(rows)
    model["input_sha256"] = hashlib.sha256(a.input.read_bytes()).hexdigest()
    evaluation["input_sha256"] = model["input_sha256"]
    a.output.mkdir(parents=True, exist_ok=False)
    for name, obj in (("model.json", model), ("evaluation.json", evaluation)):
        (a.output / name).write_text(json.dumps(obj, indent=2, allow_nan=False)+"\n", encoding="utf-8")
    with (a.output / "diagnostic_predictions.csv").open("x", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(predictions[0]))
        w.writeheader()
        w.writerows(predictions)
    print(f"Offline pilot fitted on {len(rows)} survey records.")
    print(json.dumps(evaluation["metrics"], indent=2))
    print("Production readiness: false. No live route enabled.")


if __name__ == "__main__":
    main()
