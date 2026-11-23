from math import log2

import pytest

from app.retrieval_evaluation import evaluate_ranking


def test_perfect_ranking():
    result = evaluate_ranking(
        ["a", "b", "c"],
        {"a": 3, "b": 2, "c": 0},
        k=2,
    )

    assert result["precision_at_k"] == 1
    assert result["recall_at_k"] == 1
    assert result["ndcg_at_k"] == pytest.approx(1)


def test_relevant_candidate_in_second_position():
    result = evaluate_ranking(
        ["b", "a"],
        {"a": 3, "b": 0},
        k=2,
    )

    assert result["precision_at_k"] == 0.5
    assert result["recall_at_k"] == 1
    assert result["ndcg_at_k"] == pytest.approx(1 / log2(3))


def test_graded_relevance_rewards_better_order():
    result = evaluate_ranking(
        ["b", "a"],
        {"a": 3, "b": 1},
        k=2,
    )

    expected_ndcg = (1 + 7 / log2(3)) / (7 + 1 / log2(3))

    assert result["precision_at_k"] == 0.5
    assert result["recall_at_k"] == 1
    assert result["ndcg_at_k"] == pytest.approx(expected_ndcg)


def test_recall_includes_relevant_candidates_not_returned():
    result = evaluate_ranking(
        ["a"],
        {"a": 3, "b": 2, "c": 0},
        k=1,
    )

    assert result["precision_at_k"] == 1
    assert result["recall_at_k"] == 0.5


def test_short_ranking_uses_requested_k_for_precision():
    result = evaluate_ranking(["a"], {"a": 3}, k=3)

    assert result["precision_at_k"] == pytest.approx(1 / 3)
    assert result["recall_at_k"] == 1
    assert result["ndcg_at_k"] == pytest.approx(1)


def test_empty_results_with_relevant_candidates():
    result = evaluate_ranking([], {"a": 3}, k=3)

    assert result["precision_at_k"] == 0
    assert result["recall_at_k"] == 0
    assert result["ndcg_at_k"] == 0


def test_all_irrelevant_judgments_have_undefined_recall_and_ndcg():
    result = evaluate_ranking(["a"], {"a": 0}, k=1)

    assert result["precision_at_k"] == 0
    assert result["recall_at_k"] is None
    assert result["ndcg_at_k"] is None


@pytest.mark.parametrize("k", [0, -1, 101, True, 1.5, "3"])
def test_invalid_k_is_rejected(k):
    with pytest.raises(ValueError):
        evaluate_ranking(["a"], {"a": 3}, k=k)


@pytest.mark.parametrize("grade", [-1, 4, True, 1.5, "3"])
def test_invalid_grade_is_rejected(grade):
    with pytest.raises(ValueError):
        evaluate_ranking(["a"], {"a": grade}, k=1)


def test_unjudged_candidate_is_rejected():
    with pytest.raises(ValueError, match="no relevance judgment"):
        evaluate_ranking(["unknown"], {"a": 3}, k=1)


def test_duplicate_results_are_rejected():
    with pytest.raises(ValueError, match="Duplicate"):
        evaluate_ranking(["a", "a"], {"a": 3}, k=2)


def test_empty_judgment_dictionary_is_rejected():
    with pytest.raises(ValueError):
        evaluate_ranking([], {}, k=1)


def test_invalid_id_is_rejected():
    with pytest.raises(ValueError):
        evaluate_ranking([""], {"": 3}, k=1)