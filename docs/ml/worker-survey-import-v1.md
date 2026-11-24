# Worker survey importer v1

Status: implemented locally; PR and CI verification pending.

## Purpose

Import the updated bilingual worker survey CSV for private data-quality
review. This importer does not train a model or approve training records.

## Behavior

- Maps columns by question identifier, including Q18a appearing last.
- Requires confirmed adult eligibility, qualifying work and consent.
- Keeps agreed payment and actual payment received separate.
- Preserves unknown numeric values as null and explicit zero as zero.
- Prevents team-only amounts from becoming individual payment labels.
- Flags partial payments, contradictions and possible duplicate answers.
- Retains possible duplicates for review rather than deleting them.
- Omits timestamps, job titles, task descriptions and benefit free text
  from normalized output.
- Keeps every record pending review and ineligible for training.

## Private files

Inputs and outputs belong beneath ml-service/data/, which is ignored
by Git. Do not commit real responses, normalized records or summaries.

Outputs:
- records.jsonl
- quality-summary.json

Use a new output directory for each import. Existing directories are
not overwritten.

## Validation

- 32 synthetic importer tests passed locally.
- Full ML suite: 230 tests passed locally.
- Python syntax and Git whitespace checks passed locally.

A local survey export was imported successfully. This establishes
import execution, not payment-label validity or model readiness.

## Limitations

Question identifiers must match the expected survey schema.
Older exports missing Q18a are rejected rather than silently adapted.

Choice normalization expects the configured English choice text,
optionally followed by its Sinhala translation.

Question numbers establish column mapping; full question wording and
form version are not independently verified.

Record IDs identify a row within a particular file export. They are
not stable respondent identities across exports.

Duplicate detection identifies repeated answers within one import.
It does not establish respondent identity or detect every duplicate.

Category and district counts are descriptive. They do not establish
representative coverage or sufficient training data.

Further review must define the payment target, qualifying records,
units, supported categories and evaluation split before training.
Advertised website pay remains separate from survey payment evidence.