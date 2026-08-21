# 📊 MusicLens — Power BI Enterprise Dashboard Specification

This document provides the complete business intelligence and visual design specification for the 3-page **MusicLens Analytics Dashboard** in Power BI Desktop.

---

## 1. Data Model & Relationships

The Power BI data model leverages the normalized star schema and pre-computed analytical views.

```
                  ┌──────────────────────┐
                  │    Dim_Genres (24)   │
                  │──────────────────────│
                  │  genre_name (PK)     │
                  │  subgenre_name       │
                  └──────────┬───────────┘
                             │ 1
                             │
                             │ *
┌───────────────────┐     ┌──▼───────────────────┐     ┌──────────────────────┐
│  Dim_Artists (10k)│     │ Fact_Tracks (28,352) │     │ Dim_Albums (Unique)  │
│───────────────────│     │──────────────────────│     │──────────────────────│
│  artist_name (PK) │1───*│  track_id (PK)       │*───1│  album_id (PK)       │
│  artist_id        │     │  track_name          │     │  album_name          │
└───────────────────┘     │  artist_id (FK)      │     │  release_date        │
                          │  album_id (FK)       │     │  release_year        │
                          │  track_popularity    │     │  release_decade      │
                          │  duration_min        │     └──────────────────────┘
                          │  genre_name (FK)     │
                          │  mood_quadrant       │
                          └──────────┬───────────┘
                                     │ 1
                                     │
                                     │ 1
                          ┌──────────▼───────────┐
                          │ Fact_AudioFeatures   │
                          │──────────────────────│
                          │  track_id (PK/FK)    │
                          │  danceability        │
                          │  energy              │
                          │  loudness            │
                          │  speechiness         │
                          │  acousticness        │
                          │  instrumentalness    │
                          │  liveness            │
                          │  valence             │
                          │  tempo               │
                          └──────────────────────┘
```

---

## 2. Color Palette & Design Tokens

Designed for high contrast, executive presentation, and accessibility (WCAG AA compliant).

| Element | Hex Code | Purpose |
|---|---|---|
| **Canvas Background** | `#0f172a` (Slate 900) | Sleek modern dark mode background |
| **Card / Visual Container**| `#1e293b` (Slate 800) | Elevated visual container with subtle border (`#334155`) |
| **Primary Accent / Pop** | `#3b82f6` (Blue 500) | Primary KPI callouts and Pop genre |
| **Secondary Accent / EDM**| `#10b981` (Emerald 500)| EDM genre and positive KPI indicators |
| **Tertiary Accent / Rap** | `#8b5cf6` (Purple 500)| Rap & Hip-Hop genre |
| **Latin Accent** | `#f59e0b` (Amber 500) | Latin genre and warmth metrics |
| **Rock Accent** | `#ef4444` (Red 500) | Rock genre and intensity indicators |
| **R&B Accent** | `#ec4899` (Pink 500) | R&B genre |
| **Primary Typography** | `#f8fafc` (Slate 50) | Main titles and KPI values |
| **Secondary Typography**| `#94a3b8` (Slate 400) | Subtitles, axis labels, and captions |

---

## 3. Comprehensive DAX Measures Library

Create a dedicated measure table `_Measures` in Power BI and add the following DAX expressions:

```dax
// ============================================================
// 1. VOLUME & METADATA MEASURES
// ============================================================

Total Tracks = 
DISTINCTCOUNT('Fact_Tracks'[track_id])

Total Active Artists = 
DISTINCTCOUNT('Fact_Tracks'[artist_name])

Total Genres = 
DISTINCTCOUNT('Fact_Tracks'[genre_name])

Total Subgenres = 
DISTINCTCOUNT('Dim_Genres'[subgenre_name])

Catalog Stream Share % = 
DIVIDE(
    [Total Tracks],
    CALCULATE([Total Tracks], ALL('Fact_Tracks')),
    0
)

// ============================================================
// 2. POPULARITY & CENTRAL TENDENCY MEASURES
// ============================================================

Avg Popularity = 
AVERAGE('Fact_Tracks'[track_popularity])

Median Popularity = 
MEDIAN('Fact_Tracks'[track_popularity])

Popularity StdDev = 
STDEV.S('Fact_Tracks'[track_popularity])

Popularity 95CI Upper = 
[Avg Popularity] + 1.96 * DIVIDE([Popularity StdDev], SQRT([Total Tracks]), 0)

Popularity 95CI Lower = 
[Avg Popularity] - 1.96 * DIVIDE([Popularity StdDev], SQRT([Total Tracks]), 0)

High Popularity Track Count = 
CALCULATE(
    [Total Tracks],
    'Fact_Tracks'[track_popularity] >= 70
)

// ============================================================
// 3. AUDIO FEATURE GAUGE MEASURES (0-100% SCALE)
// ============================================================

Avg Energy % = 
AVERAGE('Fact_AudioFeatures'[energy]) * 100

Avg Danceability % = 
AVERAGE('Fact_AudioFeatures'[danceability]) * 100

Avg Valence % = 
AVERAGE('Fact_AudioFeatures'[valence]) * 100

Avg Acousticness % = 
AVERAGE('Fact_AudioFeatures'[acousticness]) * 100

Avg Instrumentalness % = 
AVERAGE('Fact_AudioFeatures'[instrumentalness]) * 100

Avg Speechiness % = 
AVERAGE('Fact_AudioFeatures'[speechiness]) * 100

Avg Tempo BPM = 
AVERAGE('Fact_AudioFeatures'[tempo])

Avg Loudness dB = 
AVERAGE('Fact_AudioFeatures'[loudness])

// ============================================================
// 4. USER PROFILE & SIMILARITY BENCHMARK MEASURES
// ============================================================

User Mood Classification = 
SWITCH(
    TRUE(),
    [Avg Energy %] >= 50 && [Avg Valence %] >= 50, "Upbeat / Euphoric",
    [Avg Energy %] < 50  && [Avg Valence %] >= 50, "Chill / Peaceful",
    [Avg Energy %] >= 50 && [Avg Valence %] < 50,  "Intense / Aggressive",
    "Melancholic / Sad"
)

Composite Dance Energy Score = 
SQRT([Avg Danceability %] * [Avg Energy %])
```

---

## 4. Page 1 — Music Overview Specification

**Objective**: Executive summary of catalog composition, genre market share, popularity benchmarks, and prolific artists.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  🎵 MusicLens — Music Catalog Overview                               Slicer: [Genre ▼] │
├──────────────┬──────────────┬──────────────┬────────────────┬──────────────────────────┤
│ Total Tracks │ Total Artists│ Total Genres │ Avg Popularity │ Avg Energy               │
│    28,352    │    10,692    │   6 Macro    │      42.5      │          69.9%           │
├──────────────┴──────────────┴──────────────┼────────────────┴──────────────────────────┤
│ Visual 1: Track Volume by Macro-Genre       │ Visual 2: Popularity Distribution by Genre │
│ [Horizontal Clustered Bar Chart]           │ [Box & Whisker / Clustered Column + CI]  │
│ • X-Axis: Total Tracks & % of Catalog      │ • X-Axis: Genre (EDM, Latin, Pop, etc.)   │
│ • Y-Axis: Genre (Sorted descending)        │ • Y-Axis: Mean Popularity + Error Bars   │
│ • Data Labels: Counts + Percentages        │ • Tooltip: Median, StdDev, 95% CI bounds  │
├────────────────────────────────────────────┴───────────────────────────────────────────┤
│ Visual 3: Artist Leaderboard (Filtered: Min 3 Tracks)                                  │
│ [Matrix / Table with Data Bars]                                                        │
│ • Columns: Artist Name | Track Count | Avg Popularity | Peak Pop | Energy % | Dance % │
│ • Conditional Formatting: Data bars on Avg Popularity (Color: Blue Gradient)           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Visual Configuration Details (Page 1)

1. **Card 1–5 (Top Banner KPIs)**:
   - Visual Type: *Card (New)* with subtle rounded borders (`#1e293b`).
   - Metrics: `[Total Tracks]`, `[Total Active Artists]`, `[Total Genres]`, `[Avg Popularity]`, `[Avg Energy %]`.
2. **Visual 1 (Volume by Genre)**:
   - Visual Type: *Horizontal Clustered Bar Chart*.
   - Axis: `Dim_Genres[genre_name]`. Values: `[Total Tracks]`, Tooltip: `[Catalog Stream Share %]`.
   - Palette: Mapped to Genre Color Tokens (EDM: Emerald, Rap: Purple, Pop: Blue, Latin: Amber, Rock: Red, R&B: Pink).
3. **Visual 2 (Popularity by Genre with CI)**:
   - Visual Type: *Clustered Column Chart with Error Bars*.
   - Axis: `Dim_Genres[genre_name]`. Values: `[Avg Popularity]`. Error Bars: `[Popularity 95CI Upper]`, `[Popularity 95CI Lower]`.
4. **Visual 3 (Artist Leaderboard Table)**:
   - Visual Type: *Table / Matrix Visual*.
   - Fields: `Dim_Artists[artist_name]`, `[Total Tracks]`, `[Avg Popularity]`, `[Avg Danceability %]`, `[Avg Energy %]`.
   - Filter Pane: `Total Tracks >= 3`.

---

## 5. Page 2 — Audio Analytics Specification

**Objective**: Deep statistical exploration of acoustic signatures, cross-genre feature variance (ANOVA findings), and audio-popularity relationships.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  🎛️ MusicLens — Audio Feature Analytics                              Slicer: [Decade ▼]│
├────────────────────────────────────────────┬───────────────────────────────────────────┤
│ Visual 1: Multi-Feature Radar Profile       │ Visual 2: Acoustic Feature Comparison      │
│ [Radar / Spider Chart or Multi-Bar Chart]   │ [Clustered Column Chart]                  │
│ • Features: Danceability, Energy, Valence, │ • Series: 6 Macro-Genres                  │
│   Acousticness, Speechiness, Liveness      │ • Metrics: Avg Energy, Danceability,      │
│ • Series: Selected Genres                  │   Valence, Acousticness                   │
├────────────────────────────────────────────┼───────────────────────────────────────────┤
│ Visual 3: Popularity vs Audio Correlation  │ Visual 4: Mood Quadrant Segmentation      │
│ [Scatter Plot with Trendline]              │ [Donut Chart / 2x2 Matrix]                │
│ • X-Axis: Danceability / Energy            │ • Slices: Upbeat (42%), Intense (28%),    │
│ • Y-Axis: Track Popularity (0-100)         │   Melancholic (18%), Chill (12%)          │
│ • Size: Duration (min) | Color: Genre      │ • Center Callout: Dominant Mood Category  │
└────────────────────────────────────────────┴───────────────────────────────────────────┘
```

### Visual Configuration Details (Page 2)

1. **Visual 1 (Radar Profile by Genre)**:
   - Visual Type: *Radar Chart (Custom Visual or Line Chart on standard angle axis)*.
   - Measures: `[Avg Danceability %]`, `[Avg Energy %]`, `[Avg Valence %]`, `[Avg Acousticness %]`, `[Avg Speechiness %]`, `[Avg Liveness %]`.
2. **Visual 2 (Cross-Genre Feature Matrix)**:
   - Visual Type: *Clustered Bar Chart*.
   - X-Axis: Audio Feature. Y-Axis: Mean Value (0-100%). Legend: Genre.
3. **Visual 3 (Popularity Correlation Scatter)**:
   - Visual Type: *Scatter Plot*.
   - X-Axis: `Fact_AudioFeatures[energy]`. Y-Axis: `Fact_Tracks[track_popularity]`. Legend: `Fact_Tracks[genre_name]`.
   - Analytics Pane: Enable *Trend Line* (Linear regression slope).
4. **Visual 4 (Russell Mood Quadrant Donut)**:
   - Visual Type: *Donut Chart*.
   - Category: `Fact_Tracks[mood_quadrant]`. Values: `[Total Tracks]`.
   - Colors: Upbeat (`#10b981`), Intense (`#ef4444`), Melancholic (`#3b82f6`), Chill (`#8b5cf6`).

---

## 6. Page 3 — User Music Profile & Recommendations

**Objective**: Personalized listening analysis, listener archetype classification, and explainable recommendation display.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  👤 MusicLens — User Profile & Recommendations                      Slicer: [User Seed]│
├──────────────────────────────┬─────────────────────────────────────────────────────────┤
│ Archetype Callout Card       │ Selected Seed Songs (User Taste Profile)                │
│ "High-Energy Party Animal"   │ 1. Dua Lipa — "New Rules" (Pop)                         │
│ Tagline: Thrives on driving  │ 2. Martin Garrix — "Animals" (EDM)                      │
│ beats and festival drops.    │ 3. Sean Paul — "Shot & Wine" (Pop/Latin)                │
├──────────────────────────────┴─────────────────────────────────────────────────────────┤
│ Visual 1: User Feature Signature vs Catalog Average                                    │
│ [Dual-Line / Area Gauge Comparison]                                                    │
│ • Measures: User Avg % vs Catalog Benchmark Avg % across 6 Key Dimensions              │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Visual 2: Top-10 Recommended Songs with Explainability                                 │
│ [Matrix Table with Similarity % and Feature Badges]                                    │
│ • Rank | Track Name | Artist | Genre | Similarity % | Top Match Reason | Pop Delta     │
│ • Conditional Formatting: Color scale on Similarity % (90-100% Emerald Green)          │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Visual Configuration Details (Page 3)

1. **Card 1 (Personality Archetype Badge)**:
   - Visual Type: *Card Visual*.
   - Value: `[User Mood Classification]` and Archetype Label.
2. **Visual 1 (User vs Catalog Benchmark)**:
   - Visual Type: *Clustered Column or Area Chart*.
   - Series 1: User Profile Feature Averages. Series 2: Overall Catalog Benchmark.
3. **Visual 2 (Recommended Songs Table)**:
   - Source: `pbi_sample_recommendations.csv` or Direct Recommendation Query View.
   - Columns: `Rank`, `Track Name`, `Artist`, `Genre`, `Similarity %`, `Primary Match Factor`, `Explanation Narrative`.

---

## 7. Connecting Power BI to PostgreSQL / Neon

### Connection Steps:

1. Launch **Power BI Desktop**.
2. Click **Get Data** $\rightarrow$ **More...** $\rightarrow$ **Database** $\rightarrow$ **PostgreSQL database**.
3. In the dialog, enter:
   - **Server**: `<your-neon-host>.aws.neon.tech` (from your `DATABASE_URL`)
   - **Database**: `musiclens` (or `neondb`)
   - **Data Connectivity mode**: Select **Import** (recommended for fastest interactive slicers) or **DirectQuery**.
4. In the Credentials dialog:
   - Select **Database** tab.
   - Enter your PostgreSQL Username and Password.
5. In the Navigator, select the analytical views:
   - `v_genre_summary`
   - `v_artist_leaderboard`
   - `v_genre_audio_profile`
   - `v_top_tracks`
   - `v_release_decade_summary`
6. Click **Load** or **Transform Data** in Power Query to apply DAX measures.

---

## 8. Exported Power BI CSV Files (Offline Fallback)

If connecting offline without PostgreSQL, import the pre-built CSVs located in `data/exports/powerbi/`:

- `pbi_genre_summary.csv`
- `pbi_subgenre_summary.csv`
- `pbi_artist_leaderboard.csv`
- `pbi_popularity_buckets.csv`
- `pbi_decade_summary.csv`
