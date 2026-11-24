"""Import private GigZLK survey exports for data-quality review.

Uses only Python's standard library.

- Maps questions by their identifiers, not column positions.
- Excludes responses without confirmed eligibility and consent.
- Keeps agreed and received payment separate.
- Preserves unknown numeric values as null.
- Omits timestamps and free-text descriptions from normalized output.
- Does not approve records for training.
- Writes only beneath ml-service/data/.
"""

import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from decimal import Decimal, InvalidOperation
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PRIVATE_ROOT = (ROOT / "data").resolve()

QUESTION_FIELDS = {
    "1": "adult",
    "2": "qualifying_work",
    "3": "consent",
    "4": "work_type",
    "5": "work_month",
    "6": "job_title",
    "7": "category",
    "8": "tasks",
    "9": "district",
    "10": "work_mode",
    "11": "experience_required",
    "11a": "experience_months",
    "12": "pay_basis",
    "13": "hours",
    "14": "days",
    "15": "work_conditions",
    "16": "own_payment",
    "17": "agreed",
    "18": "payment_status",
    "18a": "received",
    "19": "deductions_status",
    "20": "deductions",
    "21": "benefits",
    "21a": "reimbursements",
    "22": "unreimbursed_costs",
}

YES_NO = {
    "yes": "YES",
    "yes, i agree": "YES",
    "no": "NO",
    "not sure": "UNKNOWN",
}

ENUMS = {
    "work_type": {
        "one shift or day": "SINGLE_SHIFT_OR_DAY",
        "several shifts or days": "MULTIPLE_SHIFTS_OR_DAYS",
        "a fixed project or deliverable": "PROJECT",
        "ongoing part-time work": "ONGOING_PART_TIME",
        "other": "OTHER",
    },
    "category": {
        "events and promotions": "EVENTS_PROMOTIONS",
        "food, catering and hospitality": "FOOD_HOSPITALITY",
        "retail and sales": "RETAIL_SALES",
        "delivery and transport": "DELIVERY_TRANSPORT",
        "tutoring and education": "EDUCATION",
        "photography and videography": "PHOTO_VIDEO",
        "graphic design and digital content": "DESIGN_CONTENT",
        "it and software": "IT_SOFTWARE",
        "administration and data entry": "ADMIN_DATA_ENTRY",
        "other": "OTHER",
    },
    "work_mode": {
        "fully onsite": "ONSITE",
        "fully remote": "REMOTE",
        "both onsite and remote": "HYBRID",
        "other": "OTHER",
    },
    "experience_required": {
        "no previous experience required": "NO",
        "yes": "YES",
        "not sure": "UNKNOWN",
    },
    "pay_basis": {
        "one hour": "HOUR",
        "one shift or day": "SHIFT_OR_DAY",
        "one week": "WEEK",
        "one month": "MONTH",
        "whole project or engagement": "PROJECT",
        "other": "OTHER",
    },
    "own_payment": {
        "yes": "YES",
        "no, i only know the team total": "TEAM_ONLY",
        "not sure": "UNKNOWN",
    },
    "payment_status": {
        "paid in full": "PAID_IN_FULL",
        "partially paid": "PARTIALLY_PAID",
        "not paid yet": "NOT_PAID",
        "not sure": "UNKNOWN",
    },
    "deductions_status": YES_NO,
}

DISTRICTS = {
    name.casefold(): name.upper().replace(" ", "_")
    for name in (
        "Ampara",
        "Anuradhapura",
        "Badulla",
        "Batticaloa",
        "Colombo",
        "Galle",
        "Gampaha",
        "Hambantota",
        "Jaffna",
        "Kalutara",
        "Kandy",
        "Kegalle",
        "Kilinochchi",
        "Kurunegala",
        "Mannar",
        "Matale",
        "Matara",
        "Monaragala",
        "Mullaitivu",
        "Nuwara Eliya",
        "Polonnaruwa",
        "Puttalam",
        "Ratnapura",
        "Trincomalee",
        "Vavuniya",
        "Multiple districts",
        "Fully remote",
    )
}

UNKNOWN_NUMBERS = {
    "",
    "unknown",
    "not sure",
    "don't know",
    "do not know",
    "n/a",
    "නිශ්චිතව නොදනී",
    "නිශ්චිතව නොදන්නා",
    "නොදනී",
}

NUMBER_PATTERN = re.compile(
    r"^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?$"
)


def english_value(value):
    """Read the English part of an English / Sinhala choice."""
    return " ".join(value.split("/", 1)[0].split()).casefold()


def map_headers(headers):
    if not headers:
        raise ValueError("CSV has no header row.")

    mapping = {}
    timestamp_count = 0

    for index, header in enumerate(headers):
        cleaned = header.strip()

        if cleaned.casefold() == "timestamp":
            timestamp_count += 1
            continue

        match = re.match(r"^([0-9]+[a-z]?)\.", cleaned, re.IGNORECASE)

        if match is None:
            raise ValueError(
                f"Unexpected column at position {index + 1}."
            )

        question = match.group(1).casefold()

        if question not in QUESTION_FIELDS:
            raise ValueError(f"Unsupported question: {question}.")

        field = QUESTION_FIELDS[question]

        if field in mapping:
            raise ValueError(f"Duplicate question: {question}.")

        mapping[field] = index

    missing = set(QUESTION_FIELDS.values()) - set(mapping)

    if missing:
        raise ValueError(
            "Missing required question columns: "
            + ", ".join(sorted(missing))
        )

    if timestamp_count != 1:
        raise ValueError("Expected exactly one Timestamp column.")

    return mapping


def read_enum(value, choices, field, flags):
    key = english_value(value)

    if not key:
        return "UNKNOWN"

    result = choices.get(key)

    if result is None:
        flags.append(f"UNRECOGNIZED_{field.upper()}")
        return "UNKNOWN"

    return result


def read_number(value, field, flags, *, whole=False, positive=False):
    cleaned = value.strip()

    if cleaned.casefold() in UNKNOWN_NUMBERS:
        return None

    if NUMBER_PATTERN.fullmatch(cleaned) is None:
        flags.append(f"INVALID_{field.upper()}")
        return None

    try:
        number = Decimal(cleaned.replace(",", ""))
    except InvalidOperation:
        flags.append(f"INVALID_{field.upper()}")
        return None

    if (
        not number.is_finite()
        or number < 0
        or (positive and number == 0)
        or (whole and number != number.to_integral_value())
    ):
        flags.append(f"INVALID_{field.upper()}")
        return None

    if whole:
        return int(number)

    # Decimal strings preserve exact values in JSON.
    return format(number, "f")


def check_conditions(value, flags):
    """Check checkbox contradictions without copying free text."""
    pieces = [
        english_value(piece)
        for piece in value.split(",")
        if piece.strip()
    ]

    known = {
        "night work",
        "weekend or public-holiday work",
        "overtime",
        "none",
        "not sure",
    }

    if any(piece not in known for piece in pieces):
        flags.append("UNRECOGNIZED_WORK_CONDITIONS")

    if len(pieces) > 1 and (
        "none" in pieces or "not sure" in pieces
    ):
        flags.append("CONTRADICTORY_WORK_CONDITIONS")

    return sorted(set(piece for piece in pieces if piece in known))


def normalize_record(values, record_id):
    flags = [
        "SELF_REPORTED_NOT_INDEPENDENTLY_VERIFIED",
        "MANUAL_REVIEW_REQUIRED",
        "TRAINING_TARGET_NOT_APPROVED",
    ]

    record = {
        "schema_version": "worker-survey-review-v1",
        "record_id": record_id,
        "source": "WORKER_SURVEY",
        "currency": "LKR",
        "training_eligible": False,
        "review_status": "PENDING",
        "job_title_present": bool(values["job_title"]),
        "tasks_present": bool(values["tasks"]),
        "benefits_answer_present": bool(values["benefits"]),
    }

    for field, choices in ENUMS.items():
        record[field] = read_enum(
            values[field], choices, field, flags
        )

    record["district"] = read_enum(
        values["district"], DISTRICTS, "district", flags
    )

    month = values["work_month"]

    if re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", month):
        record["work_month"] = month
    else:
        record["work_month"] = None
        flags.append("INVALID_OR_MISSING_WORK_MONTH")

    record["experience_months"] = read_number(
        values["experience_months"],
        "experience_months",
        flags,
        whole=True,
    )

    record["hours"] = read_number(
        values["hours"], "hours", flags, positive=True
    )

    record["days"] = read_number(
        values["days"], "days", flags, whole=True, positive=True
    )

    for field in (
        "agreed",
        "received",
        "deductions",
        "reimbursements",
        "unreimbursed_costs",
    ):
        record[field + "_lkr"] = read_number(
            values[field], field, flags
        )

    if record["experience_required"] == "NO":
        if record["experience_months"] not in (None, 0):
            flags.append("CONTRADICTORY_EXPERIENCE_REQUIREMENT")

    if record["own_payment"] != "YES":
        flags.append("INDIVIDUAL_PAYMENT_NOT_IDENTIFIED")

        # Do not treat a team total as individual payment.
        for field in (
            "agreed_lkr",
            "received_lkr",
            "deductions_lkr",
            "reimbursements_lkr",
            "unreimbursed_costs_lkr",
        ):
            record[field] = None

    if record["agreed_lkr"] is None:
        flags.append("AGREED_PAYMENT_UNKNOWN")

    if record["received_lkr"] is None:
        flags.append("ACTUAL_PAYMENT_UNKNOWN")

    if record["payment_status"] == "PARTIALLY_PAID":
        flags.append("PAYMENT_NOT_SETTLED")

    if record["payment_status"] == "NOT_PAID":
        flags.append("PAYMENT_NOT_SETTLED")

        if record["received_lkr"] is not None:
            if Decimal(record["received_lkr"]) != 0:
                flags.append("CONTRADICTORY_PAYMENT_STATUS")

    if record["deductions_status"] == "NO":
        if record["deductions_lkr"] is not None:
            if Decimal(record["deductions_lkr"]) != 0:
                flags.append("CONTRADICTORY_DEDUCTIONS")

    if record["hours"] is not None and record["days"] is not None:
        if Decimal(record["hours"]) > Decimal(record["days"]) * 24:
            flags.append("HOURS_EXCEED_REPORTED_DAYS")

    record["work_conditions"] = check_conditions(
        values["work_conditions"], flags
    )

    # Benefits may contain arbitrary Other text.
    # The initial importer retains presence only.
    if values["benefits"]:
        flags.append("BENEFITS_REQUIRE_SEPARATE_REVIEW")

    if values["job_title"] or values["tasks"]:
        flags.append("FREE_TEXT_OMITTED_PENDING_PRIVACY_REVIEW")

    record["quality_flags"] = sorted(set(flags))
    return record


def import_csv(path):
    if path.stat().st_size > 5_000_000:
        raise ValueError("CSV exceeds the 5 MB pilot limit.")

    input_hash = hashlib.sha256(path.read_bytes()).hexdigest()

    records = []
    exclusions = Counter()
    duplicate_count = 0
    seen = set()
    rows_read = 0

    with path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.reader(source, strict=True)
        headers = next(reader, None)
        mapping = map_headers(headers)

        for row_number, row in enumerate(reader, start=2):
            if not row or not any(cell.strip() for cell in row):
                continue

            rows_read += 1

            if rows_read > 5000:
                raise ValueError("CSV exceeds the 5,000-response limit.")

            if len(row) != len(headers):
                raise ValueError(
                    f"CSV record {row_number} has an unexpected column count."
                )

            if any(len(cell) > 10_000 for cell in row):
                raise ValueError(
                    f"CSV record {row_number} contains an oversized field."
                )

            values = {
                field: row[index].strip()
                for field, index in mapping.items()
            }

            gates = (
                ("adult", "AGE_NOT_CONFIRMED"),
                ("qualifying_work", "QUALIFYING_WORK_NOT_CONFIRMED"),
                ("consent", "CONSENT_NOT_CONFIRMED"),
            )

            excluded = False

            for field, reason in gates:
                if YES_NO.get(english_value(values[field])) != "YES":
                    exclusions[reason] += 1
                    excluded = True
                    break

            if excluded:
                continue

            # Potential duplicate answers, excluding Timestamp.
            # A match is a review flag, not proof of the same person.
            fingerprint = hashlib.sha256(
                json.dumps(
                    values,
                    sort_keys=True,
                    ensure_ascii=False,
                ).encode("utf-8")
            ).hexdigest()

            record_id = hashlib.sha256(
                f"{input_hash}:{row_number}".encode("utf-8")
            ).hexdigest()

            record = normalize_record(values, record_id)

            if fingerprint in seen:
                record["quality_flags"].append(
                    "POSSIBLE_DUPLICATE_ANSWERS"
                )
                duplicate_count += 1

            seen.add(fingerprint)
            records.append(record)

    flag_counts = Counter(
        flag
        for record in records
        for flag in record["quality_flags"]
    )

    summary = {
        "schema_version": "worker-survey-quality-v1",
        "input_sha256": input_hash,
        "response_rows_read": rows_read,
        "eligible_consenting_records": len(records),
        "excluded_records": sum(exclusions.values()),
        "exclusion_reasons": dict(exclusions),
        "possible_duplicate_records": duplicate_count,
        "actual_payment_known": sum(
            record["received_lkr"] is not None
            for record in records
        ),
        "category_counts": dict(
            Counter(record["category"] for record in records)
        ),
        "pay_basis_counts": dict(
            Counter(record["pay_basis"] for record in records)
        ),
        "payment_status_counts": dict(
            Counter(record["payment_status"] for record in records)
        ),
        "quality_flag_counts": dict(flag_counts),
        "training_approved_records": 0,
    }

    return records, summary


def private_path(value):
    path = Path(value).resolve()

    if path == PRIVATE_ROOT or PRIVATE_ROOT not in path.parents:
        raise ValueError(
            "Input and output must be beneath ml-service/data/."
        )

    return path


def main():
    parser = argparse.ArgumentParser(
        description="Import a private GigZLK worker-survey CSV."
    )
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    source = private_path(args.input)
    destination = private_path(args.output_dir)

    if destination.exists():
        raise ValueError(
            "Output directory already exists; choose a new directory."
        )

    records, summary = import_csv(source)

    destination.mkdir(parents=True, exist_ok=False)

    with (destination / "records.jsonl").open(
        "x", encoding="utf-8", newline="\n"
    ) as output:
        for record in records:
            output.write(
                json.dumps(
                    record,
                    ensure_ascii=False,
                    allow_nan=False,
                )
                + "\n"
            )

    with (destination / "quality-summary.json").open(
        "x", encoding="utf-8", newline="\n"
    ) as output:
        json.dump(
            summary,
            output,
            ensure_ascii=False,
            indent=2,
            allow_nan=False,
        )
        output.write("\n")

    # Print counts only, not individual answers.
    print(f"Response rows read: {summary['response_rows_read']}")
    print(
        "Eligible, consenting records: "
        f"{summary['eligible_consenting_records']}"
    )
    print(f"Excluded records: {summary['excluded_records']}")
    print(
        "Records with an actual individual payment amount: "
        f"{summary['actual_payment_known']}"
    )
    print("Training approval remains pending.")
    print("Private records and quality summary written.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, csv.Error) as error:
        raise SystemExit(
            f"Survey import failed: {error}"
        ) from None