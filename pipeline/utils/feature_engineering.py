"""
MusicLens — Feature Engineering Module
========================================
Handles feature preparation, normalization, scaling, and derived audio
metrics (mood quadrants, tempo categorization, energy-valence indices)
for explainable content-based recommendation.
"""

from typing import List, Tuple, Optional, Dict, Any
import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler, StandardScaler
import joblib

from pipeline.config import RECOMMENDATION_FEATURES


def categorize_mood(valence: float, energy: float) -> str:
    """
    Classify a song into an energy-valence 2D mood quadrant (Russell's Circumplex Model).

    Quadrants:
      - High Energy, High Valence: 'Upbeat / Euphoric'
      - Low Energy, High Valence:  'Chill / Peaceful'
      - High Energy, Low Valence:  'Intense / Aggressive'
      - Low Energy, Low Valence:   'Melancholic / Sad'
    """
    if energy >= 0.5 and valence >= 0.5:
        return "Upbeat / Euphoric"
    elif energy < 0.5 and valence >= 0.5:
        return "Chill / Peaceful"
    elif energy >= 0.5 and valence < 0.5:
        return "Intense / Aggressive"
    else:
        return "Melancholic / Sad"


def categorize_tempo(tempo: float) -> str:
    """Classify track tempo into standard BPM brackets."""
    if tempo < 90:
        return "Slow (<90 BPM)"
    elif tempo <= 130:
        return "Mid-tempo (90-130 BPM)"
    else:
        return "Fast (>130 BPM)"


def engineer_audio_features(
    df: pd.DataFrame,
    feature_cols: Optional[List[str]] = None,
) -> pd.DataFrame:
    """
    Compute derived analytical features from raw audio feature columns.

    Derived Metrics:
      - mood_quadrant: Categorical mood bracket from valence & energy
      - tempo_bracket: Categorical tempo range
      - acoustic_electronic_ratio: Contrast between acousticness and energy+loudness
      - dance_energy_index: Geometric mean of danceability and energy
    """
    df = df.copy()
    features = feature_cols or RECOMMENDATION_FEATURES

    # Validate required columns exist
    missing = [c for c in features if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required audio feature columns: {missing}")

    # Derived mood & tempo
    if "valence" in df.columns and "energy" in df.columns:
        df["mood_quadrant"] = [
            categorize_mood(v, e) for v, e in zip(df["valence"], df["energy"])
        ]

    if "tempo" in df.columns:
        df["tempo_bracket"] = df["tempo"].apply(categorize_tempo)

    # Composite audio indices
    if "danceability" in df.columns and "energy" in df.columns:
        df["dance_energy_index"] = np.sqrt(df["danceability"] * df["energy"])

    if "acousticness" in df.columns and "energy" in df.columns:
        df["acoustic_energy_balance"] = df["acousticness"] - df["energy"]

    return df


class AudioFeatureScaler:
    """
    Configurable feature scaler supporting both MinMaxScaler and StandardScaler.
    Saves fitted parameters for reproducible inference and explainability.
    """

    def __init__(
        self,
        feature_cols: Optional[List[str]] = None,
        scaler_type: str = "standard",
    ):
        """
        Args:
            feature_cols: List of column names to scale.
            scaler_type: 'standard' for zero-mean unit-variance (Pearson correlation equivalent),
                         or 'minmax' for [0, 1] bounded scaling.
        """
        self.feature_cols = feature_cols or list(RECOMMENDATION_FEATURES)
        self.scaler_type = scaler_type.lower()
        if self.scaler_type == "standard":
            self.scaler = StandardScaler()
        elif self.scaler_type == "minmax":
            self.scaler = MinMaxScaler(feature_range=(0.0, 1.0))
        else:
            raise ValueError(f"Unsupported scaler_type '{scaler_type}'. Choose 'standard' or 'minmax'.")
        self.is_fitted = False

    def fit(self, df: pd.DataFrame) -> "AudioFeatureScaler":
        """Fit scaler on DataFrame containing feature_cols."""
        self._validate_cols(df)
        X = df[self.feature_cols].values
        self.scaler.fit(X)
        self.is_fitted = True
        return self

    def transform(self, df: pd.DataFrame) -> np.ndarray:
        """Transform DataFrame feature columns to normalized numpy array."""
        if not self.is_fitted:
            raise RuntimeError("AudioFeatureScaler must be fitted before transform.")
        self._validate_cols(df)
        X = df[self.feature_cols].values
        return self.scaler.transform(X)

    def fit_transform(self, df: pd.DataFrame) -> np.ndarray:
        """Fit and transform in a single pass."""
        return self.fit(df).transform(df)

    def inverse_transform(self, X: np.ndarray) -> np.ndarray:
        """Transform normalized array back to original feature scale."""
        if not self.is_fitted:
            raise RuntimeError("AudioFeatureScaler must be fitted before inverse_transform.")
        return self.scaler.inverse_transform(X)

    def _validate_cols(self, df: pd.DataFrame) -> None:
        missing = [c for c in self.feature_cols if c not in df.columns]
        if missing:
            raise ValueError(f"DataFrame is missing required feature columns: {missing}")

    def save(self, filepath: str) -> None:
        """Persist fitted scaler to disk."""
        joblib.dump(
            {
                "scaler": self.scaler,
                "feature_cols": self.feature_cols,
                "scaler_type": self.scaler_type,
                "is_fitted": self.is_fitted,
            },
            filepath,
        )

    @classmethod
    def load(cls, filepath: str) -> "AudioFeatureScaler":
        """Load fitted scaler from disk."""
        data = joblib.load(filepath)
        instance = cls(
            feature_cols=data["feature_cols"],
            scaler_type=data["scaler_type"],
        )
        instance.scaler = data["scaler"]
        instance.is_fitted = data["is_fitted"]
        return instance
