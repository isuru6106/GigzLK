# Payment baseline v1

Status: locally implemented and tested; PR review and CI pending.
Scope: offline exploratory analysis only.
Related planning issue: #51.

## Prediction target

Self-reported work payment actually received per actual hour, in LKR.

Target = actual_received_lkr / paid_hours.

The survey instruction excludes separately reimbursed expenses and
separate tips or bonuses. The target reflects payment after deductions,
before subtracting unreimbursed work costs.

This is not advertised salary, gross employer budget, commission,
payout calculation or a guaranteed payment recommendation.

Actual worked hours are used only to construct the historical target.
They are not available as a pre-job prediction feature.

## Implementation

Script: ml-service/scripts/train-payment-baseline.py

The script uses Python's standard library and accepts prepared
actual-pay candidate CSV files.

It requires:
- Source type SURVEY_SELF_REPORTED.
- pilot_actual_eligible set to true.
- Recency status WITHIN_WINDOW_BY_MONTH.
- Payment status PAID_IN_FULL.
- Individual payment basis PER_WORKER.
- Positive, finite received payment and actual hours.
- At least three records and unique record IDs.

Candidate markers are supplied preparation metadata. The trainer does
not independently verify consent, source evidence, dates, payment-period
consistency or the truth of respondents' answers.

Advertisements, market benchmarks and unresolved master records must
not be passed to this actual-pay trainer.

## Baselines

Primary baseline: global median hourly received pay.

Comparison: category median when at least three training observations
exist for that category; otherwise use the global training median.

Category is the comparison policy's only prediction feature.
Payment outcomes and actual hours are not prediction features.

## Evaluation

Leave-one-record-out diagnostics refit each baseline without the
held record. Results include mean and median absolute error in LKR/hour.

The local pilot used 13 prepared survey candidates:
- Global median MAE: 555.3388 LKR/hour.
- Category policy MAE: 576.1722 LKR/hour.

The category policy did not improve this diagnostic.

These results are exploratory. They are not accuracy percentages,
an independent test-set result or evidence of production readiness.

Respondent and employer grouping identifiers are unavailable.
Separate records do not guarantee independent people or employers.

## Outputs

- model.json
- evaluation.json
- diagnostic_predictions.csv

Outputs include the input file SHA-256 hash.
Existing output directories are rejected rather than overwritten.

## Local execution

Run from the repository root using a new output directory:

```powershell
$vectorPython = ".\ml-service\.venv-vector\Scripts\python.exe"
$pilotRoot = ".\ml-service\data\payment-pilot-20261128"
$baselineRun = Get-Date -Format "yyyyMMdd-HHmmss-fff"

& $vectorPython .\ml-service\scripts\train-payment-baseline.py `
    --input "$pilotRoot\data\actual_pay_candidates.csv" `
    --output "$pilotRoot\baseline-$baselineRun"

if ($LASTEXITCODE -ne 0) {
    throw "Offline payment baseline failed."
}
```

Keep datasets, row-level diagnostics and fitted models under the
ignored ml-service/data directory. This CLI does not enforce private
path placement; the operator must choose an appropriate output path.

Do not commit private CSV files, the pilot ZIP or fitted model outputs.

## Validation

- 26 synthetic baseline tests passed locally.
- Full ML suite: 256 tests passed locally.
- Python syntax and Git whitespace checks passed.
- Local pilot execution completed successfully.

Tests use invented records and temporary files, not private responses.

## Remaining work

- Confirm the user-facing prediction target with the team.
- Resolve source provenance and outstanding data-quality issues.
- Increase independent coverage for supported categories.
- Define pre-job features and insufficient-data behavior.
- Establish grouped or time-based evaluation where feasible.
- Compare regression models only when the data supports comparison.
- Evaluate payment ranges and their coverage separately.
- Define the inference contract, authorization and operational behavior.

No live prediction route, frontend integration or production deployment
is enabled by this baseline.