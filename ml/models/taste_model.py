"""Deterministic PCA taste-embedding model over canonical audio features."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

import joblib
import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

from ml.config import TasteModelConfig


@dataclass
class TasteEmbeddingModel:
    """A compact, unsupervised embedding fit only on catalog audio features.

    PCA is appropriate here because the available repository data contains
    track features but no labelled relevance events. It provides deterministic
    decorrelation and dimensionality reduction without claiming supervised
    recommendation quality.
    """

    config: TasteModelConfig
    scaler: StandardScaler | None = None
    pca: PCA | None = None

    def fit(self, catalog: pd.DataFrame) -> "TasteEmbeddingModel":
        columns = list(self.config.feature_columns)
        missing = [column for column in columns if column not in catalog.columns]
        if missing:
            raise ValueError(f"Catalog is missing required taste features: {missing}")
        matrix = catalog[columns].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=float)
        valid_rows = np.isfinite(matrix).all(axis=1)
        if valid_rows.sum() < 2:
            raise ValueError("At least two complete catalog rows are required to fit the taste model.")
        matrix = matrix[valid_rows]
        self.scaler = StandardScaler().fit(matrix)
        scaled = self.scaler.transform(matrix)
        self.pca = PCA(
            n_components=self.config.explained_variance_threshold,
            svd_solver="full",
            random_state=self.config.random_state,
        ).fit(scaled)
        return self

    def transform(self, raw_vectors: Sequence[Sequence[float]] | np.ndarray) -> np.ndarray:
        if self.scaler is None or self.pca is None:
            raise RuntimeError("TasteEmbeddingModel must be fitted or loaded before transform.")
        matrix = np.asarray(raw_vectors, dtype=float)
        if matrix.ndim == 1:
            matrix = matrix.reshape(1, -1)
        expected = len(self.config.feature_columns)
        if matrix.shape[1] != expected:
            raise ValueError(f"Expected {expected} features, received {matrix.shape[1]}.")
        if not np.isfinite(matrix).all():
            raise ValueError("Taste vectors must contain only finite numeric values.")
        return self.pca.transform(self.scaler.transform(matrix))

    def portable_preprocessing(self) -> dict[str, Any]:
        if self.scaler is None or self.pca is None:
            raise RuntimeError("TasteEmbeddingModel must be fitted before serializing preprocessing.")
        return {
            "feature_columns": list(self.config.feature_columns),
            "scaler": {
                "type": "standard",
                "mean": self.scaler.mean_.tolist(),
                "scale": self.scaler.scale_.tolist(),
            },
            "pca": {
                "components": self.pca.components_.tolist(),
                "explained_variance_ratio": self.pca.explained_variance_ratio_.tolist(),
                "embedding_dimension": int(self.pca.n_components_),
            },
        }

    def save(self, path: Path) -> None:
        if self.scaler is None or self.pca is None:
            raise RuntimeError("Cannot save an unfitted taste model.")
        joblib.dump(self, path)

    @classmethod
    def load(cls, path: Path) -> "TasteEmbeddingModel":
        model = joblib.load(path)
        if not isinstance(model, cls):
            raise TypeError(f"Artifact at {path} is not a TasteEmbeddingModel.")
        return model

