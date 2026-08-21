"""
MusicLens — User Music Profile Module
======================================
Builds analytical listening profiles and personality archetypes from
user-selected seed songs. Calculates statistical summaries of audio features,
dominant genres, preferred artists, and mood quadrant distribution.
"""

from typing import List, Dict, Any, Optional
import numpy as np
import pandas as pd

from pipeline.config import RECOMMENDATION_FEATURES


def determine_personality_archetype(features: Dict[str, float]) -> Dict[str, str]:
    """
    Determine a descriptive, data-backed music personality archetype based on
    calculated average audio feature values.

    Args:
        features: Dictionary containing average audio feature metrics.

    Returns:
        Dict with 'archetype', 'tagline', and 'description'.
    """
    energy = features.get("energy", 0.5)
    danceability = features.get("danceability", 0.5)
    valence = features.get("valence", 0.5)
    acousticness = features.get("acousticness", 0.5)
    instrumentalness = features.get("instrumentalness", 0.0)
    speechiness = features.get("speechiness", 0.0)

    if instrumentalness >= 0.35:
        return {
            "archetype": "Atmospheric & Instrumental Dreamer",
            "tagline": "Drawn to rich textures, ambient soundscapes, and non-vocal melodies.",
            "description": "Your listening patterns prioritize deep focus, hypnotic soundscapes, and instrumental arrangements over vocal hooks.",
        }
    elif acousticness >= 0.50 and energy < 0.55:
        return {
            "archetype": "Acoustic & Introspective Soul",
            "tagline": "Cherishes organic instruments, warm acoustics, and emotional depth.",
            "description": "You lean heavily toward stripped-down productions, natural acoustic textures, and reflective melodies.",
        }
    elif energy >= 0.75 and danceability >= 0.70:
        return {
            "archetype": "High-Energy Party Enthusiast",
            "tagline": "Thrives on driving rhythms, electrifying drops, and dancefloor anthems.",
            "description": "Your taste is optimized for high-bpm peak moments, heavy bass, and unstoppable dance grooves.",
        }
    elif valence >= 0.65 and danceability >= 0.60:
        return {
            "archetype": "Euphoric Groove Explorer",
            "tagline": "Radiates positive vibes, infectious hooks, and sun-drenched melodies.",
            "description": "You gravitate toward cheerful, uplifting musical keys that bring joy, bounce, and optimism.",
        }
    elif energy >= 0.72 and valence < 0.45:
        return {
            "archetype": "Nocturnal Adrenaline Seeker",
            "tagline": "Passionate about intense beats, minor keys, and dark electronic tension.",
            "description": "Your profile favors aggressive energy and brooding atmospheres that deliver dramatic emotional impact.",
        }
    elif speechiness >= 0.15 and danceability >= 0.60:
        return {
            "archetype": "Lyrical Flow & Rhythm Connoisseur",
            "tagline": "Attuned to intricate wordplay, rhythmic cadences, and urban beats.",
            "description": "You value rapid-fire vocal deliveries, sophisticated phrasing, and rhythmic storytelling.",
        }
    elif energy < 0.50 and valence >= 0.50:
        return {
            "archetype": "Chill Vibester & Sunday Lounger",
            "tagline": "Loves laid-back tempos, warm chords, and relaxed contentment.",
            "description": "Your playlist creates a soothing, comforting sanctuary with mid-to-low tempo gems.",
        }
    else:
        return {
            "archetype": "Eclectic Sonic Connoisseur",
            "tagline": "A well-rounded listener with dynamic, multi-dimensional musical tastes.",
            "description": "You refuse to be boxed into one lane, finding harmony across diverse energies, moods, and styles.",
        }


class UserMusicProfile:
    """
    Encapsulates a user's computed music profile derived from seed tracks.
    """

    def __init__(
        self,
        seed_track_ids: List[str],
        seed_tracks_df: pd.DataFrame,
        audio_features_df: pd.DataFrame,
        playlist_tracks_df: Optional[pd.DataFrame] = None,
    ):
        """
        Builds the user profile by joining seed track IDs with audio features and playlist metadata.

        Args:
            seed_track_ids: List of track IDs chosen by the user.
            seed_tracks_df: DataFrame with track metadata (track_id, track_name, track_artist, track_popularity).
            audio_features_df: DataFrame with audio features (track_id, danceability, energy, ...).
            playlist_tracks_df: Optional DataFrame with playlist/genre associations.
        """
        self.seed_track_ids = list(dict.fromkeys(seed_track_ids))  # preserve order, deduplicate
        if not self.seed_track_ids:
            raise ValueError("seed_track_ids cannot be empty.")

        # Filter seed tracks
        tracks_subset = seed_tracks_df[seed_tracks_df["track_id"].isin(self.seed_track_ids)].copy()
        if tracks_subset.empty:
            raise ValueError(f"None of the provided seed_track_ids were found in tracks dataset.")

        features_subset = audio_features_df[audio_features_df["track_id"].isin(self.seed_track_ids)].copy()
        if features_subset.empty:
            raise ValueError(f"None of the provided seed_track_ids have matching audio features.")

        self.tracks_subset = tracks_subset
        self.features_subset = features_subset
        self.playlist_subset = None
        if playlist_tracks_df is not None:
            self.playlist_subset = playlist_tracks_df[
                playlist_tracks_df["track_id"].isin(self.seed_track_ids)
            ].copy()

        self.profile = self._compute_profile()

    def _compute_profile(self) -> Dict[str, Any]:
        """Compute all analytical dimensions of the user profile."""
        feat_df = self.features_subset
        track_df = self.tracks_subset

        # 1. Average Audio Features
        avg_features: Dict[str, float] = {}
        features_percentage: Dict[str, float] = {}
        for col in RECOMMENDATION_FEATURES:
            if col in feat_df.columns:
                val = float(feat_df[col].mean())
                avg_features[col] = round(val, 4)
                # For bounded [0, 1] features, compute percentage
                if col in ["danceability", "energy", "speechiness", "acousticness", "instrumentalness", "liveness", "valence"]:
                    features_percentage[col] = round(val * 100.0, 1)

        # 2. Key audio stats
        avg_tempo = float(feat_df["tempo"].mean()) if "tempo" in feat_df.columns else 0.0
        avg_loudness = float(feat_df["loudness"].mean()) if "loudness" in feat_df.columns else 0.0
        avg_popularity = float(track_df["track_popularity"].mean()) if "track_popularity" in track_df.columns else 0.0

        # 3. Dominant Genres & Subgenres
        genre_distribution = {}
        subgenre_distribution = {}
        if self.playlist_subset is not None and not self.playlist_subset.empty:
            if "playlist_genre" in self.playlist_subset.columns:
                g_counts = self.playlist_subset["playlist_genre"].value_counts()
                g_total = len(self.playlist_subset)
                genre_distribution = {
                    k: round((v / g_total) * 100.0, 1) for k, v in g_counts.items()
                }
            if "playlist_subgenre" in self.playlist_subset.columns:
                sg_counts = self.playlist_subset["playlist_subgenre"].value_counts()
                sg_total = len(self.playlist_subset)
                subgenre_distribution = {
                    k: round((v / sg_total) * 100.0, 1) for k, v in sg_counts.head(5).items()
                }

        # 4. Top Preferred Artists
        preferred_artists = []
        if "track_artist" in track_df.columns:
            a_counts = track_df["track_artist"].value_counts().head(5)
            preferred_artists = [
                {"artist": artist, "track_count": int(count)}
                for artist, count in a_counts.items()
            ]

        # 5. Mood Quadrant Distribution
        mood_distribution = {"Upbeat / Euphoric": 0, "Chill / Peaceful": 0, "Intense / Aggressive": 0, "Melancholic / Sad": 0}
        for _, row in feat_df.iterrows():
            e = row.get("energy", 0.5)
            v = row.get("valence", 0.5)
            if e >= 0.5 and v >= 0.5:
                mood_distribution["Upbeat / Euphoric"] += 1
            elif e < 0.5 and v >= 0.5:
                mood_distribution["Chill / Peaceful"] += 1
            elif e >= 0.5 and v < 0.5:
                mood_distribution["Intense / Aggressive"] += 1
            else:
                mood_distribution["Melancholic / Sad"] += 1

        total_moods = max(len(feat_df), 1)
        mood_distribution_pct = {
            k: round((v / total_moods) * 100.0, 1) for k, v in mood_distribution.items()
        }

        # 6. Personality Archetype
        archetype_info = determine_personality_archetype(avg_features)

        # 7. Seed tracks summary list
        seed_tracks_info = []
        for _, r in track_df.iterrows():
            t_id = r["track_id"]
            feat_r = feat_df[feat_df["track_id"] == t_id].iloc[0] if not feat_df[feat_df["track_id"] == t_id].empty else None
            seed_tracks_info.append({
                "track_id": t_id,
                "track_name": r.get("track_name", "Unknown"),
                "track_artist": r.get("track_artist", "Unknown"),
                "track_popularity": int(r.get("track_popularity", 0)),
                "energy": float(feat_r["energy"]) if feat_r is not None else None,
                "danceability": float(feat_r["danceability"]) if feat_r is not None else None,
                "valence": float(feat_r["valence"]) if feat_r is not None else None,
            })

        return {
            "seed_count": len(self.seed_track_ids),
            "valid_tracks_analyzed": len(track_df),
            "archetype": archetype_info["archetype"],
            "tagline": archetype_info["tagline"],
            "description": archetype_info["description"],
            "audio_profile": {
                "energy_pct": features_percentage.get("energy", 0.0),
                "danceability_pct": features_percentage.get("danceability", 0.0),
                "valence_pct": features_percentage.get("valence", 0.0),
                "acousticness_pct": features_percentage.get("acousticness", 0.0),
                "instrumentalness_pct": features_percentage.get("instrumentalness", 0.0),
                "speechiness_pct": features_percentage.get("speechiness", 0.0),
                "liveness_pct": features_percentage.get("liveness", 0.0),
                "avg_tempo_bpm": round(avg_tempo, 1),
                "avg_loudness_db": round(avg_loudness, 2),
                "avg_popularity": round(avg_popularity, 1),
            },
            "raw_feature_means": avg_features,
            "dominant_genres_pct": genre_distribution,
            "dominant_subgenres_pct": subgenre_distribution,
            "preferred_artists": preferred_artists,
            "mood_quadrant_distribution_pct": mood_distribution_pct,
            "seed_tracks": seed_tracks_info,
        }

    def to_dict(self) -> Dict[str, Any]:
        """Export profile as dictionary."""
        return self.profile

    def get_summary_text(self) -> str:
        """Return a formatted text summary for display in console or UI."""
        p = self.profile
        ap = p["audio_profile"]
        genres_str = ", ".join([f"{k} ({v}%)" for k, v in list(p["dominant_genres_pct"].items())[:3]]) or "N/A"
        return (
            f"=== MusicLens User Profile ===\n"
            f"Archetype: {p['archetype']}\n"
            f"Tagline: {p['tagline']}\n"
            f"Analyzed: {p['valid_tracks_analyzed']} seed tracks\n"
            f"Energy: {ap['energy_pct']}% | Danceability: {ap['danceability_pct']}% | Valence: {ap['valence_pct']}%\n"
            f"Acousticness: {ap['acousticness_pct']}% | Instrumentalness: {ap['instrumentalness_pct']}%\n"
            f"Tempo: {ap['avg_tempo_bpm']} BPM | Loudness: {ap['avg_loudness_db']} dB | Avg Popularity: {ap['avg_popularity']}\n"
            f"Dominant Genres: {genres_str}\n"
        )
