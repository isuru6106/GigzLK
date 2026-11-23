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

## Expanded development evaluation: v2

Dataset: synthetic-relevance-v2.json
Report: reports/synthetic-relevance-v2-run-01.json

The expanded dataset contains:
- 20 synthetic candidates: ten jobs and ten workers.
- Ten English queries.
- Five queries with multiple relevant candidates.
- Two queries with no relevant candidates.

The original v1 dataset and report remain unchanged.
Existing examples were reused, so v2 is a development set, not held-out
evaluation. All judgments remain DRAFT_UNREVIEWED.

### Queries with relevant candidates

The following macro means cover the eight queries with at least one
candidate graded 2 or higher:

| Metric | Keyword Jaccard | Embedding cosine |
|---|---:|---:|
| Precision@3 | 0.4167 | 0.5417 |
| Recall@3 | 0.8125 | 1.0000 |
| NDCG@3 | 0.7178 | 0.9792 |

Embedding retrieval returned all candidates graded relevant within the
top three for these eight queries.

The tutor query is a counterexample to uniformly better embedding
ordering: keyword NDCG@3 was 1.0000, while embedding NDCG@3 was 0.8340.
The grades and returned order require review before drawing conclusions.

### Queries without relevant candidates

Both methods returned three candidates for each no-match query.
All returned candidates had grade zero.

Precision@3 was zero. Recall and NDCG were undefined and recorded as null.
These results do not establish a successful no-match detection mechanism.

The runner's overall summary includes all ten queries in Precision,
while Recall and NDCG exclude undefined values. Those aggregates therefore
use different query populations. The table above uses only the eight
queries with relevant candidates for all three metrics.

### Interpretation

Compare methods within the same dataset and query population.
Do not interpret differences between v1 and v2 aggregate results as a
model improvement: the candidate pools and judgments changed.

Next work:
- Independently review judgments and the tutor-query ordering.
- Expand difficult related candidates and realistic query variations.
- Evaluate stronger lexical baselines.
- Define and evaluate no-match behavior on separate development and
  held-out examples before selecting thresholds.
- Keep no-match detection separate from infrastructure failures.
- Evaluate required languages with appropriately reviewed examples.

No production threshold, suitability-ranking policy or live integration
is approved by these draft results.