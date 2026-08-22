# ML data contract

Training consumes a catalog-level CSV or Parquet file containing the nine fields in `ml.config.RECOMMENDATION_FEATURES`. The default input is `data/exports/enriched_tracks.parquet`, created by the existing feature-engineering pipeline.

This phase does not create user-event training labels. Spotify and manual interactions are used at inference time to build a source-aware profile; catalog audio features are used only to fit the canonical scaler and unsupervised PCA transform.

