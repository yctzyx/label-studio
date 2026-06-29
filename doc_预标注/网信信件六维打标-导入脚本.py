#!/usr/bin/env python3
"""
将 mydoc/100条网信件打标.xlsx 转为 Label Studio 可导入的 JSON。

用法（在项目根目录）：
  python doc_预标注/网信信件六维打标-导入脚本.py
  python doc_预标注/网信信件六维打标-导入脚本.py --input mydoc/100条网信件打标.xlsx --output mydoc/网信信件_tasks.json

导入：Label Studio 项目 → 数据管理 → 导入 → 上传生成的 JSON 文件
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


def row_to_task(row: pd.Series) -> dict:
    def _str(v) -> str:
        if pd.isna(v):
            return ""
        if hasattr(v, "isoformat"):
            return v.isoformat(sep=" ", timespec="seconds")
        return str(v).strip()

    return {
        "data": {
            "xfjbh": _str(row.get("xfjbh")),
            "wtsd": _str(row.get("wtsd")),
            "tsnr": _str(row.get("tsnr")),
            "create_time": _str(row.get("create_time")),
        }
    }


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Excel 网信件 → Label Studio JSON")
    parser.add_argument(
        "--input",
        type=Path,
        default=root / "mydoc" / "100条网信件打标.xlsx",
        help="源 Excel 路径",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=root / "mydoc" / "网信信件_tasks.json",
        help="输出 JSON 路径",
    )
    args = parser.parse_args()

    df = pd.read_excel(args.input)
    required = {"xfjbh", "wtsd", "tsnr"}
    missing = required - set(df.columns)
    if missing:
        raise SystemExit(f"Excel 缺少列: {sorted(missing)}，当前列: {list(df.columns)}")

    tasks = [row_to_task(row) for _, row in df.iterrows()]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(tasks, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已生成 {len(tasks)} 条任务 → {args.output}")


if __name__ == "__main__":
    main()
