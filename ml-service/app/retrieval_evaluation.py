"""Ranking metrics for explicitly judged retrieval examples.

Relevance grades:
0 = unrelated
1 = weakly related
2 = relevant
3 = strongly relevant

These grades describe retrieval relevance, not eligibility or suitability.
"""

from math import log2


def evaluate_ranking(
    ranked_ids: list[str],
    relevance: dict[str, int],
    *,
    k: int,
) -> dict[str, float | None]:
    """Evaluate a ranking against an explicitly judged candidate universe.

    Every returned ID must have a relevance judgment.
    Missing judgments are rejected rather than interpreted as irrelevant.

    Precision uses K as its denominator, including when fewer than K
    results are returned. Grades of 2 or 3 count as relevant.

    Recall and NDCG are undefined when their respective ideal denominators
    are zero; those values are returned as None.
    """

    if type(k) is not int or not 1 <= k <= 100:
        raise ValueError("K must be an integer between 1 and 100.")

    if not isinstance(relevance, dict) or not relevance:
        raise ValueError("Provide a non-empty relevance judgment dictionary.")

    for candidate_id, grade in relevance.items():
        if not isinstance(candidate_id, str) or not candidate_id.strip():
            raise ValueError("Judged candidate IDs must be non-empty strings.")

        if type(grade) is not int or not 0 <= grade <= 3:
            raise ValueError("Relevance grades must be integers from 0 to 3.")

    if not isinstance(ranked_ids, list):
        raise ValueError("Ranked IDs must be a list.")

    seen = set()

    for candidate_id in ranked_ids:
        if not isinstance(candidate_id, str) or not candidate_id.strip():
            raise ValueError("Ranked candidate IDs must be non-empty strings.")

        if candidate_id in seen:
            raise ValueError("Duplicate ranked candidate IDs are not supported.")

        if candidate_id not in relevance:
            raise ValueError("A ranked candidate has no relevance judgment.")

        seen.add(candidate_id)

    top_grades = [
        relevance[candidate_id] for candidate_id in ranked_ids[:k]
    ]

    relevant_returned = sum(grade >= 2 for grade in top_grades)
    relevant_total = sum(grade >= 2 for grade in relevance.values())

    precision = relevant_returned / k
    recall = (
        relevant_returned / relevant_total
        if relevant_total
        else None
    )

    def discounted_gain(grades):
        return sum(
            (2**grade - 1) / log2(position + 2)
            for position, grade in enumerate(grades)
        )

    actual_gain = discounted_gain(top_grades)
    ideal_grades = sorted(relevance.values(), reverse=True)[:k]
    ideal_gain = discounted_gain(ideal_grades)

    ndcg = actual_gain / ideal_gain if ideal_gain else None

    return {
        "precision_at_k": precision,
        "recall_at_k": recall,
        "ndcg_at_k": ndcg,
    }