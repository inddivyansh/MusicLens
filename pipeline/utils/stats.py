"""
Statistical Utilities for MusicLens
==================================
Provides descriptive statistics, distribution diagnostics, hypothesis testing,
and correlation analysis for Spotify audio features and popularity metrics.
"""

from typing import Dict, List, Tuple, Any
import numpy as np
import pandas as pd
from scipy import stats


def compute_distribution_metrics(series: pd.Series) -> Dict[str, Any]:
    """
    Compute comprehensive summary statistics for a numeric series.

    Returns:
        Dict containing parametric and non-parametric metrics including
        mean, median, std, IQR, skewness, kurtosis, and outlier bounds.
    """
    clean_s = series.dropna()
    n = len(clean_s)
    if n == 0:
        return {}

    mean_val = float(clean_s.mean())
    std_val = float(clean_s.std(ddof=1))
    median_val = float(clean_s.median())
    q25 = float(clean_s.quantile(0.25))
    q75 = float(clean_s.quantile(0.75))
    iqr = q75 - q25
    min_val = float(clean_s.min())
    max_val = float(clean_s.max())

    skew_val = float(stats.skew(clean_s, bias=False))
    kurt_val = float(stats.kurtosis(clean_s, bias=False))  # Excess kurtosis (normal = 0)

    # Outlier thresholds (Tukey's fences)
    lower_fence_mild = q25 - 1.5 * iqr
    upper_fence_mild = q75 + 1.5 * iqr
    lower_fence_extreme = q25 - 3.0 * iqr
    upper_fence_extreme = q75 + 3.0 * iqr

    outliers_mild_count = int(((clean_s < lower_fence_mild) | (clean_s > upper_fence_mild)).sum())
    outliers_extreme_count = int(((clean_s < lower_fence_extreme) | (clean_s > upper_fence_extreme)).sum())

    # Standard error & 95% CI
    sem = std_val / np.sqrt(n) if n > 1 else 0.0
    ci_95_lower = mean_val - 1.96 * sem
    ci_95_upper = mean_val + 1.96 * sem

    # Distribution classification heuristic
    if abs(skew_val) < 0.5:
        skew_desc = "approximately symmetric"
    elif abs(skew_val) <= 1.0:
        skew_desc = "moderately skewed (" + ("positive" if skew_val > 0 else "negative") + ")"
    else:
        skew_desc = "highly skewed (" + ("positive/right" if skew_val > 0 else "negative/left") + ")"

    return {
        "count": n,
        "mean": round(mean_val, 4),
        "std": round(std_val, 4),
        "median": round(median_val, 4),
        "q25": round(q25, 4),
        "q75": round(q75, 4),
        "iqr": round(iqr, 4),
        "min": round(min_val, 4),
        "max": round(max_val, 4),
        "skewness": round(skew_val, 4),
        "kurtosis": round(kurt_val, 4),
        "skew_description": skew_desc,
        "ci_95": [round(ci_95_lower, 4), round(ci_95_upper, 4)],
        "outliers_mild_count": outliers_mild_count,
        "outliers_mild_pct": round((outliers_mild_count / n) * 100, 2),
        "outliers_extreme_count": outliers_extreme_count,
        "outliers_extreme_pct": round((outliers_extreme_count / n) * 100, 2),
        "iqr_lower_fence": round(lower_fence_mild, 4),
        "iqr_upper_fence": round(upper_fence_mild, 4),
    }


def compute_correlations_with_target(
    df: pd.DataFrame,
    feature_cols: List[str],
    target_col: str = "track_popularity"
) -> pd.DataFrame:
    """
    Compute Pearson (linear) and Spearman (monotonic rank) correlations
    along with p-values between feature columns and a target column.
    """
    records = []
    clean_df = df.dropna(subset=feature_cols + [target_col])
    target = clean_df[target_col]

    for col in feature_cols:
        feature = clean_df[col]

        pearson_r, pearson_p = stats.pearsonr(feature, target)
        spearman_r, spearman_p = stats.spearmanr(feature, target)

        # Interpretation of effect size (|r| < 0.1: negligible, 0.1-0.3: weak, 0.3-0.5: moderate, >0.5: strong)
        abs_r = abs(pearson_r)
        if abs_r < 0.1:
            strength = "negligible"
        elif abs_r < 0.3:
            strength = "weak"
        elif abs_r < 0.5:
            strength = "moderate"
        else:
            strength = "strong"

        records.append({
            "feature": col,
            "pearson_r": round(float(pearson_r), 4),
            "pearson_p_value": float(pearson_p),
            "pearson_significant": bool(pearson_p < 0.05),
            "spearman_rho": round(float(spearman_r), 4),
            "spearman_p_value": float(spearman_p),
            "spearman_significant": bool(spearman_p < 0.05),
            "correlation_strength": strength,
            "direction": "positive" if pearson_r > 0 else "negative",
        })

    corr_df = pd.DataFrame(records)
    return corr_df.sort_values(by="pearson_r", key=abs, ascending=False).reset_index(drop=True)


def test_genre_differences(
    df: pd.DataFrame,
    feature_cols: List[str],
    genre_col: str = "playlist_genre"
) -> Dict[str, Any]:
    """
    Perform One-Way ANOVA (parametric) and Kruskal-Wallis (non-parametric)
    tests to assess whether audio features differ significantly across genres.
    """
    results = {}
    genres = df[genre_col].unique()

    for col in feature_cols:
        genre_groups = [df[df[genre_col] == g][col].dropna().values for g in genres]

        # One-way ANOVA
        f_stat, anova_p = stats.f_oneway(*genre_groups)

        # Kruskal-Wallis H-test (robust to non-normality)
        h_stat, kw_p = stats.kruskal(*genre_groups)

        # Calculate eta-squared (effect size for ANOVA: SS_between / SS_total)
        overall_mean = df[col].mean()
        ss_between = sum(len(g) * ((g.mean() - overall_mean) ** 2) for g in genre_groups)
        ss_total = ((df[col] - overall_mean) ** 2).sum()
        eta_squared = ss_between / ss_total if ss_total > 0 else 0.0

        results[col] = {
            "anova_f_stat": round(float(f_stat), 2),
            "anova_p_value": float(anova_p),
            "anova_significant": bool(anova_p < 0.05),
            "kruskal_h_stat": round(float(h_stat), 2),
            "kruskal_p_value": float(kw_p),
            "kruskal_significant": bool(kw_p < 0.05),
            "eta_squared": round(float(eta_squared), 4),
            "effect_size": "large" if eta_squared > 0.14 else ("medium" if eta_squared > 0.06 else "small"),
        }

    return results
