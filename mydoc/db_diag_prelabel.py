#!/usr/bin/env python3
"""预标注 model_version 排查脚本 — 在内网可访问 DB 的机器上运行。

用法:
  pip install pymysql
  set DB_PASSWORD=你的密码
  python mydoc/db_diag_prelabel.py

可选环境变量:
  DB_HOST=192.168.9.168
  DB_PORT=13306
  DB_USER=multimodal
  DB_NAME=db_label_studio
  PROJECT_ID=20
  TASK_ID=392
"""
import json
import os
import sys

try:
    import pymysql
except ImportError:
    print("请先安装: pip install pymysql")
    sys.exit(1)

CONFIG = {
    "host": os.environ.get("DB_HOST", "192.168.9.168"),
    "port": int(os.environ.get("DB_PORT", "13306")),
    "user": os.environ.get("DB_USER", "multimodal"),
    "password": os.environ.get("DB_PASSWORD", ""),
    "database": os.environ.get("DB_NAME", "db_label_studio"),
    "charset": "utf8mb4",
    "connect_timeout": 15,
    "cursorclass": pymysql.cursors.DictCursor,
}

PROJECT_ID = int(os.environ.get("PROJECT_ID", "20"))
TASK_ID = int(os.environ.get("TASK_ID", "392"))


def run(cur, title, sql, params=None):
    print(f"\n{'=' * 60}\n{title}\n{'=' * 60}")
    cur.execute(sql, params or ())
    rows = cur.fetchall()
    if not rows:
        print("(no rows)")
        return rows
    for row in rows:
        print(json.dumps(row, ensure_ascii=False, default=str))
    return rows


def main():
    if not CONFIG["password"]:
        print("请设置环境变量 DB_PASSWORD")
        sys.exit(1)

    conn = pymysql.connect(**CONFIG)
    try:
        cur = conn.cursor()
        run(cur, "Connection", "SELECT DATABASE() AS db, VERSION() AS version")

        run(
            cur,
            "1. Project config",
            """
            SELECT id, title, show_collab_predictions, model_version AS project_model_version,
                   CHAR_LENGTH(model_version) AS project_mv_len,
                   reveal_preannotations_interactively, task_workflow_enabled
            FROM project WHERE id = %s
            """,
            (PROJECT_ID,),
        )

        run(
            cur,
            "2. ML backends",
            """
            SELECT id, title AS backend_title, model_version AS backend_setup_mv,
                   state, url, is_interactive, auto_update, error_message
            FROM ml_mlbackend WHERE project_id = %s ORDER BY id
            """,
            (PROJECT_ID,),
        )

        run(
            cur,
            "3. Task info",
            """
            SELECT id, project_id, total_predictions, total_annotations, is_labeled
            FROM task WHERE id = %s
            """,
            (TASK_ID,),
        )

        run(
            cur,
            "4. Predictions on task",
            """
            SELECT p.id, p.model_version AS prediction_mv, p.model_id,
                   mb.title AS linked_backend_title, mb.model_version AS linked_backend_mv,
                   JSON_LENGTH(COALESCE(p.result, JSON_ARRAY())) AS result_count,
                   LEFT(CAST(p.result AS CHAR), 120) AS result_preview
            FROM prediction p
            LEFT JOIN ml_mlbackend mb ON mb.id = p.model_id
            WHERE p.task_id = %s
            """,
            (TASK_ID,),
        )

        run(
            cur,
            "5. Prediction versions in project",
            """
            SELECT IFNULL(NULLIF(TRIM(model_version), ''), '<NULL_OR_EMPTY>') AS model_version,
                   COUNT(*) AS prediction_count, COUNT(DISTINCT task_id) AS task_count
            FROM prediction WHERE project_id = %s
            GROUP BY IFNULL(NULLIF(TRIM(model_version), ''), '<NULL_OR_EMPTY>')
            ORDER BY prediction_count DESC
            """,
            (PROJECT_ID,),
        )

        run(
            cur,
            "6. Version consistency diagnosis",
            """
            SELECT
                c.project_mv, c.backend_title, c.backend_setup_mv, c.backend_state,
                t.prediction_mv, t.result_count,
                (t.prediction_mv = c.project_mv) AS match_project_mv,
                (t.prediction_mv = c.backend_setup_mv) AS match_backend_setup_mv,
                CASE
                    WHEN t.prediction_id IS NULL THEN '任务无 prediction'
                    WHEN t.prediction_mv = c.project_mv AND (c.backend_setup_mv IS NULL OR c.backend_setup_mv = '')
                        THEN '确认 bug：prediction 与 project 一致，但 backend_setup_mv 为空'
                    WHEN t.prediction_mv = c.project_mv THEN '正常'
                    WHEN t.prediction_mv <> c.backend_setup_mv
                        THEN '确认 bug：prediction 与 backend_setup_mv 不一致'
                    ELSE '其它'
                END AS diagnosis
            FROM (
                SELECT p.model_version AS project_mv, mb.title AS backend_title,
                       mb.model_version AS backend_setup_mv, mb.state AS backend_state
                FROM project p
                LEFT JOIN ml_mlbackend mb ON mb.project_id = p.id
                WHERE p.id = %s LIMIT 1
            ) c
            LEFT JOIN (
                SELECT pr.id AS prediction_id, pr.model_version AS prediction_mv,
                       JSON_LENGTH(COALESCE(pr.result, JSON_ARRAY())) AS result_count
                FROM prediction pr WHERE pr.task_id = %s
            ) t ON TRUE
            """,
            (PROJECT_ID, TASK_ID),
        )

        run(
            cur,
            "7. Affected tasks count",
            """
            SELECT COUNT(*) AS affected_task_count
            FROM task t
            JOIN (
                SELECT p.model_version AS project_mv, mb.model_version AS backend_setup_mv
                FROM project p
                LEFT JOIN ml_mlbackend mb ON mb.project_id = p.id
                WHERE p.id = %s LIMIT 1
            ) cfg
            WHERE t.project_id = %s AND t.total_predictions > 0
              AND EXISTS (SELECT 1 FROM prediction pr WHERE pr.task_id = t.id)
              AND NOT EXISTS (
                SELECT 1 FROM prediction pr
                WHERE pr.task_id = t.id AND pr.model_version = cfg.backend_setup_mv
              )
            """,
            (PROJECT_ID, PROJECT_ID),
        )
    finally:
        conn.close()


if __name__ == "__main__":
    main()
