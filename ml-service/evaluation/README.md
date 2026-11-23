# Synthetic retrieval evaluation

## Purpose

Compare keyword retrieval with the pinned multilingual-e5-small model
using identical candidate pools and explicit relevance judgments.

This evaluates text retrieval relevance, not suitability, eligibility,
availability, visibility, payment or assignment decisions.

## Dataset

File: synthetic-relevance-v1.json

- 12 synthetic candidates: six jobs and six workers.
- Eight English queries: four per retrieval direction.
- Each query searches the six candidates of its own entity kind.
- Every candidate in each query pool has an explicit judgment.
- Judgment status: DRAFT_UNREVIEWED.
- Examples and judgments were authored for development.
- No real worker records, job records or personal data are included.

Grades:
- 0: unrelated.
- 1: weakly related.
- 2: relevant.
- 3: strongly relevant.

Grades 2 and 3 count as relevant for Precision and Recall.
NDCG uses all grades with gain equal to 2^grade - 1.

## Methods

Keyword baseline:
- Jaccard overlap of casefolded Unicode word/number tokens.
- No stemming, synonyms or stop-word removal.

Embedding retrieval:
- Pinned model and preprocessing from ../vector-model.json.
- Explicit query: and passage: prefixes.
- Normalized 384-dimensional embeddings.
- Exact cosine ranking in memory.
- CPU execution using cached model files.

Both methods rank by score descending and break ties by candidate ID.
No model training or parameter tuning is performed.

## Metrics

- Precision@K: relevant returned candidates divided by K.
- Recall@K: relevant returned candidates divided by all relevant candidates.
- NDCG@K: discounted graded relevance compared with ideal ordering.
- Undefined metrics remain null and are excluded from their macro mean.
- Reports include the defined-query count for each metric.

Missing judgments are rejected rather than interpreted as grade zero.

## Recorded initial results

Report: reports/synthetic-relevance-v1-run-01.json

| Metric | Keyword Jaccard | Embedding cosine |
|---|---:|---:|
| Precision@3 | 0.2917 | 0.3333 |
| Recall@3 | 0.8750 | 1.0000 |
| NDCG@3 | 0.8120 | 1.0000 |

All eight queries have defined values for these metrics.

Each query has one candidate graded 2 or higher. Therefore the maximum
Precision@3 for this dataset is 1/3. Precision is not model accuracy.

Embedding retrieval achieved ideal graded ordering within the evaluated
top three for these draft examples. Keyword retrieval missed the relevant
cafe worker in its top three and produced weaker photography ordering.

These observations are limited to this dataset and its draft judgments.

## Running locally

From the repository root in PowerShell:

    $vectorPython = ".\ml-service\.venv-vector\Scripts\python.exe"

    & $vectorPython .\ml-service\scripts\evaluate-vector-retrieval.py `
        --k 3 `
        --output .\ml-service\evaluation\reports\new-run.json

Use a new output filename for each run. Existing reports are not overwritten.
The pinned model must already be cached locally.

Reports record dataset/model-manifest hashes, model configuration,
package versions, per-query results, aggregate metrics and limitations.

## Limitations and next work

- Obtain independent review of the relevance judgments.
- Expand queries, candidate pools and difficult related alternatives.
- Include multiple relevant candidates and no-relevant-candidate cases.
- Add Sinhala and other language examples only with appropriate review.
- Keep development examples separate from future held-out evaluation.
- Do not adjust labels merely to improve model results.
- Compare stronger baselines before selecting a ranking policy.
- Measure model latency and resource usage separately.
- PostgreSQL integration is covered by separate database checks.
- Do not use these results as a production acceptance threshold.

This evaluation does not approve combined suitability ranking,
recommendation HTTP APIs or live integration.