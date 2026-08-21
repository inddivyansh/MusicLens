"""
Step 1: Data Ingestion Pipeline for MusicLens
=============================================
Downloads the Spotify 30,000 Songs dataset using kagglehub with fallback
to local raw archive if offline or if kagglehub is unavailable.
"""

import sys
from pathlib import Path

# Add project root to sys.path if running directly
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import os
import shutil
import zipfile
import kagglehub
from pipeline.config import KAGGLE_DATASET, RAW_DATA_DIR, RAW_CSV_FILENAME


def download_dataset() -> Path:
    """
    Download the dataset from Kaggle or extract from local archive fallback.

    Returns:
        Path to the raw CSV file.
    """
    target_csv = RAW_DATA_DIR / RAW_CSV_FILENAME
    RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Check if raw CSV already exists and is non-empty
    if target_csv.exists() and target_csv.stat().st_size > 1000:
        print(f"[Ingest] Raw CSV already exists at: {target_csv} ({target_csv.stat().st_size:,} bytes)")
        return target_csv

    # 2. Try kagglehub download
    print(f"[Ingest] Downloading '{KAGGLE_DATASET}' using kagglehub...")
    try:
        download_path = kagglehub.dataset_download(KAGGLE_DATASET)
        download_dir = Path(download_path)
        print(f"[Ingest] kagglehub download directory: {download_dir}")

        for file in download_dir.glob("*.csv"):
            shutil.copy(file, target_csv)
            print(f"[Ingest] Copied {file.name} -> {target_csv}")
            return target_csv
    except Exception as e:
        print(f"[Ingest] kagglehub download encountered an issue: {e}")
        print("[Ingest] Falling back to local archive.zip or repository resources...")

    # 3. Fallback to local archive.zip in project root
    local_zip = PROJECT_ROOT / "archive.zip"
    if local_zip.exists():
        print(f"[Ingest] Extracting from local archive: {local_zip}")
        with zipfile.ZipFile(local_zip, "r") as z:
            z.extractall(RAW_DATA_DIR)
        if target_csv.exists():
            print(f"[Ingest] Successfully extracted {target_csv.name} ({target_csv.stat().st_size:,} bytes)")
            return target_csv

    raise FileNotFoundError(
        f"Unable to locate or download '{RAW_CSV_FILENAME}'. Please ensure internet connectivity, "
        "valid Kaggle credentials, or place 'archive.zip' in the project root."
    )


def verify_raw_dataset(csv_path: Path) -> dict:
    """
    Perform sanity checks on the raw dataset.

    Args:
        csv_path: Path to raw CSV file.

    Returns:
        dict with basic metadata.
    """
    import pandas as pd

    df = pd.read_csv(csv_path)
    meta = {
        "file_path": str(csv_path),
        "file_size_bytes": csv_path.stat().st_size,
        "rows": len(df),
        "columns": len(df.columns),
        "column_names": list(df.columns),
        "null_counts": df.isnull().sum().to_dict(),
        "unique_tracks": df["track_id"].nunique() if "track_id" in df.columns else None,
    }
    print(f"[Verify] Rows: {meta['rows']:,}, Columns: {meta['columns']}, Unique Track IDs: {meta['unique_tracks']:,}")
    return meta


if __name__ == "__main__":
    raw_path = download_dataset()
    meta = verify_raw_dataset(raw_path)
    print("[Ingest] Step 01 (Download & Ingest) completed successfully.")
