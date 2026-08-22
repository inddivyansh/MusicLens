"""Fit and persist the MusicLens catalog scaler and PCA taste model."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from ml.config import ARTIFACT_DIR, DEFAULT_CATALOG_PATH, TasteModelConfig
from ml.models import TasteEmbeddingModel


def _load_catalog(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Catalog input not found: {path}")
    if path.suffix.lower() == ".parquet":
        return pd.read_parquet(path)
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path)
    raise ValueError("Catalog input must be a .parquet or .csv file.")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def train(input_path: Path, artifact_dir: Path) -> None:
    catalog = _load_catalog(input_path)
    config = TasteModelConfig()
    model = TasteEmbeddingModel(config).fit(catalog)
    artifact_dir.mkdir(parents=True, exist_ok=True)

    model.save(artifact_dir / "taste_model.joblib")
    with (artifact_dir / "preprocessing.json").open("w", encoding="utf-8") as file_handle:
        json.dump(model.portable_preprocessing(), file_handle, indent=2)
    with (artifact_dir / "model_config.json").open("w", encoding="utf-8") as file_handle:
        json.dump(config.to_dict(), file_handle, indent=2)
    metadata = {
        "trained_at_utc": datetime.now(timezone.utc).isoformat(),
        "input_path": str(input_path),
        "input_sha256": _sha256(input_path),
        "catalog_rows": int(len(catalog)),
        "complete_feature_rows": int(catalog[list(config.feature_columns)].dropna().shape[0]),
        "feature_columns": list(config.feature_columns),
        "embedding_dimension": int(model.pca.n_components_) if model.pca is not None else None,
        "model_type": "PCA",
    }
    with (artifact_dir / "feature_metadata.json").open("w", encoding="utf-8") as file_handle:
        json.dump(metadata, file_handle, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_CATALOG_PATH)
    parser.add_argument("--artifacts", type=Path, default=ARTIFACT_DIR)
    args = parser.parse_args()
    train(args.input, args.artifacts)


if __name__ == "__main__":
    main()

