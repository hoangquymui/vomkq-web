"""Remove only evaluation runs whose exact results exist in local test logs.

Default is a dry run. --apply makes a SQLite backup first. Reports and their
source snapshots protect referenced runs; legacy history/documents are untouched.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    path = root / "ai-core/data/vector_ai.sqlite3"
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    protected_runs, protected_snapshots = set(), set()
    for row in connection.execute("SELECT payload_json FROM analysis_reports"):
        report = json.loads(row[0])
        protected_runs.add(report["result"]["runId"])
        for snapshot in [report.get("snapshot"), *report["result"].get("sourceSnapshots", [])]:
            if snapshot:
                protected_snapshots.add(snapshot["id"])
    candidates = {}
    for log in (root / "logs/analysis-evaluation").glob("*.jsonl"):
        for line in log.read_text(encoding="utf-8").splitlines():
            record = json.loads(line)
            if not re.fullmatch(r"(?:real-)?vi-\d{3}", record.get("case", {}).get("id", "")):
                continue
            run = record.get("run", {})
            run_id, snapshot_id = run.get("runId"), run.get("snapshotId", "")
            if not run_id or run_id in protected_runs or not re.fullmatch(r"evaluation-(?:gis-v1|real-danang-(?:v1|[0-9a-f]{16}))", snapshot_id):
                continue
            row = connection.execute("SELECT snapshot_id,status,result_json,error FROM analysis_runs WHERE id=?", (run_id,)).fetchone()
            if not row or row["snapshot_id"] != snapshot_id or row["status"] != run.get("status"):
                continue
            stored = json.loads(row["result_json"]) if row["result_json"] else None
            if stored != run.get("result") or row["error"] != run.get("error"):
                continue
            candidates[run_id] = snapshot_id
    print(f"Exactly logged, unreferenced evaluation runs: {len(candidates)}; apply={args.apply}.")
    if args.apply and candidates:
        folder = root / "logs/analysis-verification"
        folder.mkdir(parents=True, exist_ok=True)
        backup_path = folder / f"before-test-cleanup-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.sqlite3"
        with sqlite3.connect(backup_path) as backup:
            connection.backup(backup)
        with connection:
            connection.execute("BEGIN IMMEDIATE")
            # Recheck report references under the writer lock; a report saved
            # between dry inspection and backup must protect its source too.
            for row in connection.execute("SELECT payload_json FROM analysis_reports"):
                report = json.loads(row[0])
                protected_runs.add(report["result"]["runId"])
                for snapshot in [report.get("snapshot"), *report["result"].get("sourceSnapshots", [])]:
                    if snapshot:
                        protected_snapshots.add(snapshot["id"])
            for run_id in candidates:
                if run_id in protected_runs:
                    continue
                connection.execute("DELETE FROM analysis_evidence WHERE owner_type='run' AND owner_id=?", (run_id,))
                connection.execute("DELETE FROM analysis_runs WHERE id=?", (run_id,))
            for snapshot_id in set(candidates.values()) - protected_snapshots:
                if not connection.execute("SELECT 1 FROM analysis_runs WHERE snapshot_id=? LIMIT 1", (snapshot_id,)).fetchone():
                    connection.execute("DELETE FROM analysis_evidence WHERE owner_type='snapshot' AND owner_id=?", (snapshot_id,))
                    connection.execute("DELETE FROM analysis_snapshots WHERE id=?", (snapshot_id,))
        print(f"Backup: {backup_path}")
    connection.close()


if __name__ == "__main__":
    main()
