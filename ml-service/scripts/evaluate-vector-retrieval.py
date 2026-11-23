"""Compare keyword and embedding retrieval on synthetic draft judgments."""

import argparse
import hashlib
import json
import re
import runpy
import sys
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path
from statistics import fmean

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.retrieval_evaluation import evaluate_ranking


MODEL_NAME = "intfloat/multilingual-e5-small"
PREPROCESSING = "e5-prefix-normalized-v1"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    raw = path.read_bytes()
    return json.loads(raw.decode("utf-8-sig")), hashlib.sha256(raw).hexdigest()


def validate_dataset(dataset):
    require(isinstance(dataset, dict), "Dataset must be an object.")
    require(
        type(dataset.get("schema_version")) is int
        and dataset["schema_version"] == 1,
        "Unsupported dataset schema.",
    )
    require(
        dataset.get("judgment_status") == "DRAFT_UNREVIEWED",
        "This runner expects explicitly unreviewed development judgments.",
    )
    require(
        dataset.get("languages") == ["en"],
        "This initial runner supports the English development set only.",
    )
    require(
        isinstance(dataset.get("dataset_id"), str)
        and bool(dataset["dataset_id"].strip()),
        "Dataset ID is required.",
    )
    require(
        isinstance(dataset.get("provenance"), str)
        and bool(dataset["provenance"].strip()),
        "Dataset provenance is required.",
    )

    candidates = dataset.get("candidates")
    queries = dataset.get("queries")

    require(
        isinstance(candidates, list) and 1 <= len(candidates) <= 1000,
        "Expected between 1 and 1000 candidates.",
    )
    require(
        isinstance(queries, list) and 1 <= len(queries) <= 200,
        "Expected between 1 and 200 queries.",
    )

    candidate_ids = set()
    pools = {"job": [], "worker": []}

    for candidate in candidates:
        require(isinstance(candidate, dict), "Invalid candidate.")
        kind = candidate.get("kind")
        candidate_id = candidate.get("id")
        text = candidate.get("text")

        require(kind in pools, "Unsupported candidate kind.")
        require(
            isinstance(candidate_id, str)
            and re.fullmatch(
                rf"synthetic-{kind}-[a-z0-9-]+", candidate_id
            ) is not None,
            "Candidate IDs must be explicitly synthetic.",
        )
        require(candidate_id not in candidate_ids, "Duplicate candidate ID.")
        require(
            isinstance(text, str) and 1 <= len(text.strip()) <= 10000,
            "Invalid candidate text.",
        )

        candidate_ids.add(candidate_id)
        pools[kind].append(candidate)

    query_ids = set()

    for query in queries:
        require(isinstance(query, dict), "Invalid query.")
        query_id = query.get("id")
        kind = query.get("kind")
        text = query.get("text")
        judgments = query.get("relevance")

        require(
            isinstance(query_id, str)
            and re.fullmatch(
                r"synthetic-query-[a-z0-9-]+", query_id
            ) is not None,
            "Query IDs must be explicitly synthetic.",
        )
        require(query_id not in query_ids, "Duplicate query ID.")
        require(kind in pools and bool(pools[kind]), "Invalid query pool.")
        require(query.get("language") == "en", "Unsupported query language.")
        require(
            isinstance(text, str) and 1 <= len(text.strip()) <= 10000,
            "Invalid query text.",
        )
        require(isinstance(judgments, dict), "Missing relevance judgments.")

        expected_ids = {candidate["id"] for candidate in pools[kind]}
        require(
            set(judgments) == expected_ids,
            "Every candidate in the query pool needs an explicit judgment.",
        )

        for grade in judgments.values():
            require(
                type(grade) is int and 0 <= grade <= 3,
                "Judgments must be integer grades from 0 to 3.",
            )

        query_ids.add(query_id)

    return pools


def tokens(text):
    # Unicode-aware words/numbers; no stemming, synonyms or stop-word removal.
    return set(re.findall(r"[^\W_]+", text.casefold()))


def keyword_score(query, passage):
    query_tokens = tokens(query)
    passage_tokens = tokens(passage)
    union = query_tokens | passage_tokens

    return (
        len(query_tokens & passage_tokens) / len(union)
        if union
        else 0.0
    )


def validate_embeddings(embeddings, count):
    require(
        embeddings.shape == (count, 384),
        "Unexpected embedding dimensions.",
    )
    require(np.isfinite(embeddings).all(), "Non-finite embeddings.")
    require(
        np.allclose(
            np.linalg.norm(embeddings, axis=1),
            1.0,
            atol=1e-5,
        ),
        "Embeddings are not normalized.",
    )


def summarize(results, method):
    summary = {}

    for metric in ("precision_at_k", "recall_at_k", "ndcg_at_k"):
        values = [
            result["methods"][method]["metrics"][metric]
            for result in results
            if result["methods"][method]["metrics"][metric] is not None
        ]
        summary[metric] = {
            "macro_mean": fmean(values) if values else None,
            "defined_query_count": len(values),
            "total_query_count": len(results),
        }

    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset",
        type=Path,
        default=ROOT / "evaluation/synthetic-relevance-v1.json",
    )
    parser.add_argument("--k", type=int, default=3)
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="New report path. Existing reports are never overwritten.",
    )
    args = parser.parse_args()

    require(1 <= args.k <= 100, "K must be between 1 and 100.")
    require(not args.output.exists(), "Output already exists; choose a new path.")

    dataset, dataset_hash = read_json(args.dataset)
    pools = validate_dataset(dataset)

    for query in dataset["queries"]:
        require(
            len(pools[query["kind"]]) >= args.k,
            "K exceeds a query's candidate-pool size.",
        )

    manifest, manifest_hash = read_json(ROOT / "vector-model.json")
    require(isinstance(manifest, dict), "Invalid model manifest.")

    revision = manifest.get("model_revision")
    require(
        manifest.get("model_name") == MODEL_NAME
        and manifest.get("dimensions") == 384
        and manifest.get("preprocessing_version") == PREPROCESSING
        and manifest.get("max_sequence_length") == 512
        and manifest.get("normalize_embeddings") is True
        and isinstance(revision, str)
        and re.fullmatch(r"[0-9a-f]{40}", revision) is not None,
        "Unexpected model manifest configuration.",
    )

    from sentence_transformers import SentenceTransformer

    print("Loading the pinned model from the local cache.")
    print("WARNING: relevance judgments are DRAFT_UNREVIEWED.")

    model = SentenceTransformer(
        MODEL_NAME,
        revision=revision,
        device="cpu",
        trust_remote_code=False,
        token=False,
        local_files_only=True,
        model_kwargs={"use_safetensors": True},
    )
    model.max_seq_length = 512

    candidates = dataset["candidates"]
    queries = dataset["queries"]

    passage_embeddings = model.encode(
        [f"passage: {candidate['text']}" for candidate in candidates],
        prompt="",
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    query_embeddings = model.encode(
        [f"query: {query['text']}" for query in queries],
        prompt="",
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )

    validate_embeddings(passage_embeddings, len(candidates))
    validate_embeddings(query_embeddings, len(queries))

    candidate_positions = {
        candidate["id"]: index
        for index, candidate in enumerate(candidates)
    }
    results = []

    for query_index, query in enumerate(queries):
        pool = pools[query["kind"]]
        keyword_scores = {}
        semantic_scores = {}

        for candidate in pool:
            candidate_id = candidate["id"]
            keyword_scores[candidate_id] = keyword_score(
                query["text"], candidate["text"]
            )
            similarity = np.dot(
                query_embeddings[query_index],
                passage_embeddings[candidate_positions[candidate_id]],
            )
            semantic_scores[candidate_id] = float(
                np.clip(similarity, -1.0, 1.0)
            )

        methods = {}

        for method, scores in (
            ("keyword_jaccard", keyword_scores),
            ("embedding_cosine", semantic_scores),
        ):
            ranked = sorted(
                scores,
                key=lambda candidate_id: (
                    -scores[candidate_id],
                    candidate_id,
                ),
            )

            metrics = evaluate_ranking(
                ranked,
                query["relevance"],
                k=args.k,
            )

            methods[method] = {
                "top_results": [
                    {
                        "candidate_id": candidate_id,
                        "retrieval_score": scores[candidate_id],
                        "draft_relevance_grade": query["relevance"][candidate_id],
                    }
                    for candidate_id in ranked[:args.k]
                ],
                "metrics": metrics,
            }

        results.append(
            {
                "query_id": query["id"],
                "kind": query["kind"],
                "language": query["language"],
                "candidate_count": len(pool),
                "methods": methods,
            }
        )

        print(f"\n{query['id']}")
        for method, result in methods.items():
            metrics = result["metrics"]
            print(
                f"  {method}: "
                f"P@{args.k}={metrics['precision_at_k']} "
                f"Recall@{args.k}={metrics['recall_at_k']} "
                f"NDCG@{args.k}={metrics['ndcg_at_k']}"
            )

    report = {
        "report_schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dataset_id": dataset["dataset_id"],
        "dataset_sha256": dataset_hash,
        "judgment_status": dataset["judgment_status"],
        "k": args.k,
        "relevant_grade_threshold": 2,
        "candidate_count": len(candidates),
        "query_count": len(queries),
        "model_manifest_sha256": manifest_hash,
        "model": manifest,
        "execution": {
            "device": "cpu",
            "local_files_only": True,
            "python": sys.version,
            "packages": {
                name: version(name)
                for name in (
                    "numpy",
                    "torch",
                    "sentence-transformers",
                    "transformers",
                )
            },
        },
        "ranking_policy": "Score descending; candidate ID breaks ties.",
        "keyword_policy": (
            "Jaccard overlap of casefolded Unicode word/number tokens; "
            "no stemming, synonyms or stop-word removal."
        ),
        "summary": {
            method: summarize(results, method)
            for method in ("keyword_jaccard", "embedding_cosine")
        },
        "results": results,
        "limitations": [
            "Synthetic English-only development examples.",
            "Draft relevance judgments have not been independently reviewed.",
            "Small candidate pools with limited hard-negative coverage.",
            "No training or hyperparameter tuning is performed.",
            "No suitability, eligibility, visibility or freshness evaluation.",
            "In-memory exact cosine ranking; PostgreSQL is not exercised.",
            "Model input length is capped at 512 tokens.",
            "Results do not establish real-world recommendation quality.",
        ],
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(
            report,
            output,
            ensure_ascii=False,
            indent=2,
            allow_nan=False,
        )
        output.write("\n")

    print(f"\nReport saved: {args.output}")
    print("Draft results are for inspection, not production acceptance.")


if __name__ == "__main__":
    main()