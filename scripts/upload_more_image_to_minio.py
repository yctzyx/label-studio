#!/usr/bin/env python3
"""
从 Hugging Face 镜像下载 COCO 检测数据集图片，上传到本地 MinIO。

数据源：detection-datasets/coco（val 分片，含 person/car/dog 等可框选目标）
镜像：https://hf-mirror.com（国内可访问）
"""

from __future__ import annotations

import argparse
import concurrent.futures
import io
import sys
import tempfile
import urllib.request
from pathlib import Path

import boto3
import pyarrow.parquet as pq
from botocore.client import Config

DEFAULT_ENDPOINT = "http://127.0.0.1:9018"
DEFAULT_ACCESS_KEY = "admin"
DEFAULT_SECRET_KEY = "12345678"
DEFAULT_BUCKET = "zjdx"
DEFAULT_PREFIX = "moreImage"
DEFAULT_COUNT = 1000
DEFAULT_WORKERS = 24

# COCO 2017 val 第一分片（约 2500 张，~385MB）
HF_MIRROR = "https://hf-mirror.com"
COCO_VAL_PARQUET = (
    f"{HF_MIRROR}/datasets/detection-datasets/coco/resolve/main/"
    "data/val-00000-of-00002-c4f2e391ee4aba11.parquet"
)


def get_s3_client(endpoint: str, access_key: str, secret_key: str):
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="us-east-1",
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def download_file(url: str, dest: Path, retries: int = 3) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    last_err: Exception | None = None

    for attempt in range(1, retries + 1):
        try:
            print(f"Downloading ({attempt}/{retries}): {url}", flush=True)
            req = urllib.request.Request(url, headers={"User-Agent": "label-studio-bulk-upload/2.0"})
            with urllib.request.urlopen(req, timeout=900) as resp, dest.open("wb") as out:
                total = int(resp.headers.get("content-length") or 0)
                done = 0
                while True:
                    chunk = resp.read(4 * 1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
                    done += len(chunk)
                    if total and done % (32 * 1024 * 1024) < len(chunk):
                        print(
                            f"  {done * 100 // total}% ({done // (1024 * 1024)} / {total // (1024 * 1024)} MiB)",
                            flush=True,
                        )
            size = dest.stat().st_size
            if total and size != total:
                raise OSError(f"incomplete download: got {size} bytes, expected {total}")
            print(f"Saved to {dest} ({size // (1024 * 1024)} MiB)", flush=True)
            return
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            if dest.is_file():
                dest.unlink(missing_ok=True)
            print(f"Download failed: {exc}", flush=True)

    raise RuntimeError(f"Failed to download after {retries} attempts: {last_err}")


def iter_coco_images(parquet_path: Path, limit: int):
    pf = pq.ParquetFile(parquet_path)
    seen = 0
    for batch in pf.iter_batches(batch_size=64, columns=["image", "image_id"]):
        images = batch.column("image")
        ids = batch.column("image_id")
        for i in range(batch.num_rows):
            cell = images[i].as_py()
            if not cell or not cell.get("bytes"):
                continue
            image_id = ids[i].as_py()
            yield image_id, cell["bytes"]
            seen += 1
            if seen >= limit:
                return


def upload_bytes(s3, bucket: str, key: str, body: bytes) -> tuple[bool, str]:
    try:
        s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType="image/jpeg")
        return True, key
    except Exception as exc:  # noqa: BLE001
        return False, f"{key}: {exc}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload COCO images from Hugging Face to MinIO")
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--access-key", default=DEFAULT_ACCESS_KEY)
    parser.add_argument("--secret-key", default=DEFAULT_SECRET_KEY)
    parser.add_argument("--bucket", default=DEFAULT_BUCKET)
    parser.add_argument("--prefix", default=DEFAULT_PREFIX)
    parser.add_argument("--count", type=int, default=DEFAULT_COUNT)
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    parser.add_argument("--parquet-url", default=COCO_VAL_PARQUET)
    parser.add_argument("--keep-parquet", action="store_true", help="Keep downloaded parquet cache")
    args = parser.parse_args()

    s3 = get_s3_client(args.endpoint, args.access_key, args.secret_key)
    buckets = [b["Name"] for b in s3.list_buckets()["Buckets"]]
    if args.bucket not in buckets:
        print(f"Bucket {args.bucket!r} not found. Available: {buckets}", file=sys.stderr)
        return 1

    cache_dir = Path(__file__).resolve().parent / ".cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    parquet_path = cache_dir / "coco_val_00000.parquet"

    expected_size = 403698375  # val-00000 shard on HF mirror
    if parquet_path.is_file():
        try:
            pq.ParquetFile(parquet_path)
            print(f"Using cached parquet: {parquet_path}", flush=True)
        except Exception:
            print("Cached parquet invalid, re-downloading ...", flush=True)
            parquet_path.unlink(missing_ok=True)

    if not parquet_path.is_file():
        download_file(args.parquet_url, parquet_path)
        if parquet_path.stat().st_size != expected_size:
            print(f"Warning: parquet size {parquet_path.stat().st_size} != expected {expected_size}", flush=True)

    print(f"Reading up to {args.count} images from parquet ...", flush=True)
    prefix = args.prefix.rstrip("/")
    jobs: list[tuple[str, bytes]] = []
    for idx, (image_id, body) in enumerate(iter_coco_images(parquet_path, args.count), 1):
        key = f"{prefix}/coco_val_{idx:04d}_id{image_id}.jpg"
        jobs.append((key, body))
        if idx % 200 == 0:
            print(f"  read {idx} images", flush=True)

    print(f"Uploading {len(jobs)} images to s3://{args.bucket}/{prefix}/ ...", flush=True)
    ok = fail = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(upload_bytes, s3, args.bucket, key, body) for key, body in jobs]
        total = len(futures)
        for n, fut in enumerate(concurrent.futures.as_completed(futures), 1):
            success, msg = fut.result()
            if success:
                ok += 1
            else:
                fail += 1
                print(f"FAIL {msg}", flush=True)
            if n % 100 == 0 or n == total:
                print(f"Progress {n}/{total} (ok={ok}, fail={fail})", flush=True)

    if not args.keep_parquet:
        pass  # keep cache for re-runs

    print(f"Done. Uploaded {ok}, failed {fail}.", flush=True)
    return 0 if fail == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
