"""Download a pinned model and check synthetic embedding generation."""

import json
import re
from pathlib import Path

import numpy as np
from huggingface_hub import HfApi
from sentence_transformers import SentenceTransformer


MODEL_NAME = "intfloat/multilingual-e5-small"
MANIFEST_PATH = Path(__file__).resolve().parents[1] / "vector-model.json"

EXPECTED_CONFIG = {
    "model_name": MODEL_NAME,
    "dimensions": 384,
    "preprocessing_version": "e5-prefix-normalized-v1",
    "max_sequence_length": 512,
    "normalize_embeddings": True,
}


def main() -> None:
    if MANIFEST_PATH.exists():
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    else:
        # Resolve once, then preserve the exact revision for later runs.
        revision = HfApi(token=False).model_info(MODEL_NAME).sha

        if not isinstance(revision, str) or not re.fullmatch(
            r"[0-9a-f]{40}", revision
        ):
            raise RuntimeError("Invalid model repository revision.")

        manifest = {**EXPECTED_CONFIG, "model_revision": revision}

        with MANIFEST_PATH.open("x", encoding="utf-8", newline="\n") as file:
            file.write(json.dumps(manifest, indent=2) + "\n")

    if not isinstance(manifest, dict):
        raise RuntimeError("Invalid model manifest.")

    for key, expected in EXPECTED_CONFIG.items():
        if manifest.get(key) != expected:
            raise RuntimeError(f"Unexpected manifest setting: {key}")

    revision = manifest.get("model_revision")
    if not isinstance(revision, str) or not re.fullmatch(
        r"[0-9a-f]{40}", revision
    ):
        raise RuntimeError("Invalid pinned model revision.")

    print("Model:", MODEL_NAME, flush=True)
    print("Pinned revision:", revision, flush=True)

    model = SentenceTransformer(
        MODEL_NAME,
        revision=revision,
        device="cpu",
        trust_remote_code=False,
        token=False,
        model_kwargs={"use_safetensors": True},
    )
    model.max_seq_length = manifest["max_sequence_length"]

    embeddings = model.encode(
        [
            "query: Part-time work serving customers in a cafe.",
            "passage: Cafe assistant preparing drinks and serving customers.",
            "passage: Python developer cleaning CSV files and writing scripts.",
        ],
        prompt="",
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )

    if embeddings.shape != (3, 384):
        raise RuntimeError(f"Unexpected embedding shape: {embeddings.shape}")

    if not np.isfinite(embeddings).all():
        raise RuntimeError("Embeddings contain non-finite values.")

    if not np.allclose(
        np.linalg.norm(embeddings, axis=1), 1.0, atol=1e-5
    ):
        raise RuntimeError("Embedding normalization check failed.")

    similarities = embeddings[1:] @ embeddings[0]

    print("Embedding shape:", embeddings.shape)
    print("Cafe passage similarity:", round(float(similarities[0]), 4))
    print("Python passage similarity:", round(float(similarities[1]), 4))
    print("Embedding generation and numerical checks passed.")
    print("These examples do not establish real-world recommendation quality.")


if __name__ == "__main__":
    main()