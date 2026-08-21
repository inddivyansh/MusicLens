"""
Visualization Utilities for MusicLens
=====================================
Generates publication-quality charts and visualizations for exploratory data
analysis, statistical distributions, and genre feature comparisons.
"""

from pathlib import Path
from typing import List, Optional
import matplotlib
matplotlib.use("Agg")  # Non-interactive backend for headless execution
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np
import pandas as pd

# Design constants
PALETTE_NAME = "viridis"
GENRE_PALETTE = {
    "pop": "#3b82f6",     # Blue
    "rap": "#8b5cf6",     # Purple
    "rock": "#ef4444",    # Red
    "latin": "#f59e0b",   # Amber
    "r&b": "#ec4899",     # Pink
    "edm": "#10b981",     # Emerald
}

# Style configuration
plt.style.use("seaborn-v0_8-whitegrid" if "seaborn-v0_8-whitegrid" in plt.style.available else "default")
plt.rcParams["font.sans-serif"] = ["Helvetica", "Arial", "DejaVu Sans"]
plt.rcParams["axes.edgecolor"] = "#e2e8f0"
plt.rcParams["axes.linewidth"] = 0.8
plt.rcParams["grid.color"] = "#f1f5f9"
plt.rcParams["grid.linestyle"] = "--"


def plot_genre_distribution(
    df: pd.DataFrame,
    output_path: Path,
    genre_col: str = "playlist_genre"
) -> None:
    """Generate bar chart of tracks per genre with percentage labels."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    counts = df[genre_col].value_counts()
    total = len(df)

    fig, ax = plt.subplots(figsize=(10, 5), dpi=300)
    colors = [GENRE_PALETTE.get(g, "#64748b") for g in counts.index]

    bars = ax.bar(counts.index.str.upper(), counts.values, color=colors, edgecolor="#0f172a", alpha=0.9, width=0.6)

    # Annotate bars with exact counts and percentages
    for bar in bars:
        height = bar.get_height()
        pct = (height / total) * 100
        ax.text(
            bar.get_x() + bar.get_width() / 2.0,
            height + (total * 0.01),
            f"{height:,}\n({pct:.1f}%)",
            ha="center",
            va="bottom",
            fontsize=9,
            fontweight="bold",
            color="#1e293b"
        )

    ax.set_title("Track Distribution Across Spotify Genres", fontsize=14, fontweight="bold", pad=15)
    ax.set_xlabel("Playlist Genre", fontsize=11, fontweight="bold")
    ax.set_ylabel("Total Appearances", fontsize=11, fontweight="bold")
    ax.set_ylim(0, counts.max() * 1.18)
    sns.despine(top=True, right=True)
    plt.tight_layout()
    plt.savefig(output_path, dpi=300)
    plt.close(fig)


def plot_genre_popularity_comparison(
    df: pd.DataFrame,
    output_path: Path,
    genre_col: str = "playlist_genre",
    pop_col: str = "track_popularity"
) -> None:
    """Generate boxplot & violin plot comparing popularity distributions across genres."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6), dpi=300)

    # Order genres by median popularity
    order = df.groupby(genre_col)[pop_col].median().sort_values(ascending=False).index

    # 1. Violin Plot with inner quartiles
    sns.violinplot(
        data=df,
        x=genre_col,
        y=pop_col,
        hue=genre_col,
        legend=False,
        order=order,
        palette=GENRE_PALETTE,
        ax=ax1,
        inner="quartile",
        cut=0
    )
    ax1.set_title("Popularity Density by Genre (Violin)", fontsize=12, fontweight="bold")
    ax1.set_xlabel("Genre", fontsize=10, fontweight="bold")
    ax1.set_ylabel("Popularity (0-100)", fontsize=10, fontweight="bold")
    ax1.set_xticks(range(len(order)))
    ax1.set_xticklabels([g.upper() for g in order])

    # 2. Bar plot of Mean Popularity with 95% Confidence Intervals
    mean_stats = df.groupby(genre_col)[pop_col].agg(["mean", "std", "count"]).loc[order]
    mean_stats["sem"] = mean_stats["std"] / np.sqrt(mean_stats["count"])
    mean_stats["ci"] = 1.96 * mean_stats["sem"]

    colors = [GENRE_PALETTE.get(g, "#64748b") for g in order]
    bars = ax2.bar(
        [g.upper() for g in order],
        mean_stats["mean"],
        yerr=mean_stats["ci"],
        capsize=5,
        color=colors,
        alpha=0.85,
        edgecolor="#0f172a",
        width=0.55
    )

    for bar in bars:
        h = bar.get_height()
        ax2.text(bar.get_x() + bar.get_width() / 2.0, h / 2.0, f"{h:.1f}", ha="center", va="center", color="white", fontweight="bold", fontsize=11)

    ax2.set_title("Mean Popularity with 95% Confidence Intervals", fontsize=12, fontweight="bold")
    ax2.set_xlabel("Genre", fontsize=10, fontweight="bold")
    ax2.set_ylabel("Mean Popularity", fontsize=10, fontweight="bold")
    ax2.set_ylim(0, 70)

    sns.despine(top=True, right=True)
    plt.tight_layout()
    plt.savefig(output_path, dpi=300)
    plt.close(fig)


def plot_feature_distributions(
    df: pd.DataFrame,
    features: List[str],
    output_path: Path
) -> None:
    """Generate a grid of histograms with KDE for all key audio features."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    n_features = len(features)
    cols = 3
    rows = (n_features + cols - 1) // cols

    fig, axes = plt.subplots(rows, cols, figsize=(15, rows * 3.5), dpi=300)
    axes = axes.flatten()

    for idx, feat in enumerate(features):
        ax = axes[idx]
        data = df[feat].dropna()

        sns.histplot(data, kde=True, ax=ax, color="#3b82f6", bins=30, stat="density", edgecolor="none", alpha=0.6)
        mean_val = data.mean()
        median_val = data.median()

        ax.axvline(mean_val, color="#ef4444", linestyle="--", linewidth=1.5, label=f"Mean: {mean_val:.2f}")
        ax.axvline(median_val, color="#10b981", linestyle="-", linewidth=1.5, label=f"Median: {median_val:.2f}")

        ax.set_title(f"Distribution: {feat.capitalize()}", fontsize=11, fontweight="bold")
        ax.set_xlabel(feat, fontsize=9)
        ax.set_ylabel("Density", fontsize=9)
        ax.legend(fontsize=8, loc="upper right")

    # Hide unused subplots
    for j in range(idx + 1, len(axes)):
        fig.delaxes(axes[j])

    sns.despine(top=True, right=True)
    plt.suptitle("Audio Feature Distributions & Central Tendency", fontsize=14, fontweight="bold", y=1.01)
    plt.tight_layout()
    plt.savefig(output_path, dpi=300, bbox_inches="tight")
    plt.close(fig)


def plot_correlation_heatmap(
    df: pd.DataFrame,
    features: List[str],
    output_path: Path,
    method: str = "pearson"
) -> None:
    """Generate correlation heatmap for features and popularity."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    corr_matrix = df[features].corr(method=method)

    fig, ax = plt.subplots(figsize=(10, 8), dpi=300)
    mask = np.triu(np.ones_like(corr_matrix, dtype=bool), k=1)

    cmap = sns.diverging_palette(230, 20, as_cmap=True)
    sns.heatmap(
        corr_matrix,
        mask=mask,
        cmap=cmap,
        vmax=1.0,
        vmin=-1.0,
        center=0,
        annot=True,
        fmt=".2f",
        square=True,
        linewidths=0.5,
        cbar_kws={"shrink": 0.8, "label": f"{method.capitalize()} Correlation"},
        ax=ax,
        annot_kws={"size": 8, "weight": "bold"}
    )

    ax.set_title(f"Audio Features & Popularity: {method.capitalize()} Correlation Matrix", fontsize=13, fontweight="bold", pad=15)
    plt.tight_layout()
    plt.savefig(output_path, dpi=300)
    plt.close(fig)


def plot_genre_radar_profile(
    df: pd.DataFrame,
    features: List[str],
    genre_col: str,
    output_path: Path
) -> None:
    """Generate standardized radar chart profile comparing genres across normalized audio features."""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Normalize features to [0, 1] for radar comparability
    norm_df = df.copy()
    for col in features:
        min_v = norm_df[col].min()
        max_v = norm_df[col].max()
        norm_df[col] = (norm_df[col] - min_v) / (max_v - min_v) if max_v > min_v else 0

    genre_means = norm_df.groupby(genre_col)[features].mean()

    # Number of variables
    num_vars = len(features)
    angles = np.linspace(0, 2 * np.pi, num_vars, endpoint=False).tolist()
    angles += angles[:1]  # Complete circle

    fig, ax = plt.subplots(figsize=(8, 8), subplot_kw=dict(polar=True), dpi=300)

    for genre, row in genre_means.iterrows():
        values = row.tolist()
        values += values[:1]
        color = GENRE_PALETTE.get(genre, "#64748b")
        ax.plot(angles, values, label=genre.upper(), color=color, linewidth=2)
        ax.fill(angles, values, color=color, alpha=0.1)

    ax.set_xticks(angles[:-1])
    ax.set_xticklabels([f.capitalize() for f in features], fontsize=9, fontweight="bold")
    ax.set_ylim(0, 1.0)
    ax.set_title("Standardized Audio Profiles by Genre (Radar Chart)", fontsize=13, fontweight="bold", pad=20)
    ax.legend(loc="upper right", bbox_to_anchor=(1.25, 1.1), fontsize=9)

    plt.tight_layout()
    plt.savefig(output_path, dpi=300, bbox_inches="tight")
    plt.close(fig)
