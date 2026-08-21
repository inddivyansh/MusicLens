# 📖 MusicLens — Data Dictionary

This document details all columns present in the raw, cleaned, and dimensional tables of the **MusicLens** platform, sourced from the Spotify API (Spotify 30,000 Songs Dataset).

---

## 1. Table Architecture & Relational Model

The cleaned data is organized into a **Star Schema** to optimize SQL analytical queries, Power BI integration, and recommendation vector lookups:

| Table | File(s) | Rows | Granularity / Entity |
|---|---|---|---|
| **`tracks`** (Dimension) | `data/cleaned/tracks.csv`, `.parquet` | 28,352 | 1 row per unique Spotify track |
| **`audio_features`** (Fact) | `data/cleaned/audio_features.csv`, `.parquet` | 28,352 | 1 row per unique track (1:1 with tracks) |
| **`playlist_tracks`** (Bridge) | `data/cleaned/playlist_tracks.csv`, `.parquet` | 32,828 | 1 row per track-playlist appearance |
| **`spotify_songs_cleaned`** (Flat) | `data/cleaned/spotify_songs_cleaned.csv`, `.parquet` | 32,828 | Full denormalized view |

---

## 2. Field Specifications

### A. Track Metadata & Identification (`tracks`)

| Field Name | Type | Nullable | Range / Format | Description |
|---|---|---|---|---|
| `track_id` | `VARCHAR(62)` | **No (PK)** | 22-char Spotify Base62 ID | Authoritative unique identifier for the track. |
| `track_name` | `TEXT` | **No** | Free text | Commercial title of the song (whitespace normalized). |
| `track_artist` | `TEXT` | **No** | Free text | Primary performing artist or group name. |
| `track_popularity`| `INTEGER` | **No** | `0` to `100` | Spotify popularity score based on total stream count and recent stream velocity. |
| `duration_ms` | `INTEGER` | **No** | `4,000` to `517,810` | Track duration in milliseconds. |
| `duration_min` | `FLOAT` | **No** | `0.07` to `8.63` | Derived track duration in decimal minutes. |
| `duration_category`| `VARCHAR(30)` | **No** | Categorical | Bucketed length: `Short (<2.5m)`, `Medium (2.5-3.5m)`, `Standard (3.5-5m)`, `Long (>5m)`. |
| `track_album_id` | `VARCHAR(62)` | **No** | 22-char Spotify Base62 ID | Unique identifier for the parent album or single. |
| `track_album_name` | `TEXT` | **No** | Free text | Name of the album or EP on which the song was released. |
| `standard_release_date` | `DATE / TEXT` | **No** | `YYYY-MM-DD` (ISO-8601) | Normalized release date. Incomplete raw years (`YYYY`) defaulted to `YYYY-01-01`. |
| `release_year` | `INTEGER` | **No** | `1957` to `2020` | Extracted calendar release year. |
| `release_month` | `INTEGER` | **No** | `1` to `12` | Extracted calendar release month. |
| `release_decade` | `VARCHAR(10)` | **No** | `1950s` to `2020s` | Extracted calendar release decade. |

---

### B. Acoustic & Musical Features (`audio_features`)

All audio features are extracted via Spotify's Echo Nest audio analysis engine:

| Field Name | Type | Range | Description | Musical Interpretation |
|---|---|---|---|---|
| `danceability` | `FLOAT` | `0.0` to `1.0` | Suitability for dancing based on tempo, rhythm stability, beat strength, and regularity. | `0.0` = least danceable (ambient/classical), `1.0` = most danceable (EDM/club). |
| `energy` | `FLOAT` | `0.0` to `1.0` | Perceptual measure of intensity, loudness, timbre, and entropy. | `0.0` = quiet & relaxing (Bach prelude), `1.0` = fast, loud, noisy (Death Metal/EDM). |
| `key` | `SMALLINT` | `0` to `11` | Estimated musical key using standard Pitch Class notation (`-1` = undetected). | `0`=C, `1`=C♯/D♭, `2`=D, `3`=D♯/E♭, `4`=E, `5`=F, `6`=F♯/G♭, `7`=G, `8`=G♯/A♭, `9`=A, `10`=A♯/B♭, `11`=B. |
| `loudness` | `FLOAT` | `-60.0` to `5.0` dB | Overall average loudness of the track in decibels (dB). | Typical range `-60 dB` (silent) to `0 dB` (maximum peak mastering). |
| `mode` | `SMALLINT` | `0` or `1` | Modality of scale from which melodic content is derived. | `1` = Major key (brighter, happier), `0` = Minor key (darker, melancholic). |
| `speechiness` | `FLOAT` | `0.0` to `1.0` | Presence of spoken words. | `<0.33` = music/singing, `0.33-0.66` = rap/spoken sections, `>0.66` = talk show/poetry/skits. |
| `acousticness` | `FLOAT` | `0.0` to `1.0` | Confidence measure whether the recording consists of acoustic instruments vs synthetic. | `1.0` = high acoustic confidence (unplugged/folk), `0.0` = synthetic/electric. |
| `instrumentalness` | `FLOAT` | `0.0` to `1.0` | Predicts absence of vocal content ("ooh" and "aah" sounds treated as instrumental). | `>0.5` intended to represent instrumental tracks; values approaching `1.0` indicate no vocals. |
| `liveness` | `FLOAT` | `0.0` to `1.0` | Detects audience presence and stadium acoustics. | `>0.8` provides strong probability that the track was performed live. |
| `valence` | `FLOAT` | `0.0` to `1.0` | Musical positiveness and mood conveyed by the track. | `1.0` = cheerful, happy, euphoric; `0.0` = sad, depressed, angry. |
| `tempo` | `FLOAT` | `0.0` to `300.0` BPM | Overall estimated tempo in beats per minute. | Derived directly from average beat duration. |

---

### C. Playlist & Genre Context (`playlist_tracks`)

| Field Name | Type | Nullable | Example Values | Description |
|---|---|---|---|---|
| `id` | `INTEGER` | **No (PK)** | `1`, `2`, `...` | Surrogate sequence primary key for the bridge table. |
| `track_id` | `VARCHAR(62)` | **No (FK)** | `6f807x0ima9a1j3VPbc7VN` | Foreign key referencing `tracks.track_id`. |
| `playlist_id` | `VARCHAR(62)` | **No** | `37i9dQZF1DXcZDD7cfEKhW` | Spotify playlist unique ID where track was cataloged. |
| `playlist_name` | `TEXT` | **Yes** | `Pop Remix`, `Today's Top Hits` | Curated title of the Spotify playlist. |
| `playlist_genre` | `VARCHAR(50)` | **No** | `pop`, `rap`, `rock`, `latin`, `r&b`, `edm` | One of the 6 macro musical genres. |
| `playlist_subgenre` | `VARCHAR(80)` | **Yes** | `dance pop`, `post-teen pop`, `electro house` | One of 24 specific subgenre classifications. |

---

## 3. Data Integrity & Domain Constraints

1. **Uniqueness**: `tracks.track_id` is unique across all 28,352 tracks.
2. **Referential Integrity**: Every `playlist_tracks.track_id` maps to a valid entry in `tracks` and `audio_features`.
3. **Completeness**: 0 missing values across all numeric audio features and primary identifiers.
4. **Range Adherence**: All bounded features (`danceability`, `energy`, `speechiness`, `acousticness`, `instrumentalness`, `liveness`, `valence`) strictly adhere to $[0.0, 1.0]$.
