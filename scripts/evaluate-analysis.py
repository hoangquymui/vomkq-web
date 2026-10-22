"""Evaluate the Vietnamese source-grounding fixture against the LOCAL analysis API.

Default: validate the 100-case fixture without running inference.
Example: python scripts/evaluate-analysis.py --limit 3 --model qwen2.5:3b
Use --limit 100 for the full model run; semantic correctness still needs human review.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def request(base: str, path: str, payload: dict | None = None) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(base + path, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--model", default="qwen2.5:3b")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--timeout", type=int, default=240)
    parser.add_argument("--case-id", action="append", default=[])
    parser.add_argument("--fixture", default="docs/analysis-evaluation-v1.json")
    args = parser.parse_args()
    address = urllib.parse.urlsplit(args.base_url)
    if address.scheme != "http" or address.hostname not in {"127.0.0.1", "localhost", "::1"}:
        parser.error("Chỉ đánh giá trên backend loopback local.")
    if not 0 <= args.limit <= 100 or not 1 <= args.timeout <= 1800:
        parser.error("limit phải trong 0..100; timeout phải trong 1..1800 giây.")
    root = Path(__file__).resolve().parents[1]
    fixture = json.loads((root / args.fixture).read_text(encoding="utf-8"))
    cases = fixture["cases"]
    metrics = {item["id"]: item for item in fixture["snapshot"]["measurements"]}
    assert len(cases) == 100 and len({case["id"] for case in cases}) == 100
    for case in cases:
        metric = metrics[case["metricId"]]
        assert case["expected"]["value"] == metric["value"]
        assert case["expected"]["unit"] == metric["unit"]
        assert case["expected"]["status"] == metric["status"]
    print(f"Fixture: 100 câu, {len(metrics)} phép đo, giá trị/đơn vị/trạng thái khớp đáp án nguồn.")
    chosen = [case for case in cases if not args.case_id or case["id"] in args.case_id][:args.limit]
    if not chosen:
        return 0
    snapshot = request(args.base_url, "/api/v1/analysis/snapshots", {"snapshot": fixture["snapshot"]})["snapshot"]
    output_dir = root / "logs" / "analysis-evaluation"
    output_dir.mkdir(parents=True, exist_ok=True)
    destination = output_dir / (datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + ".jsonl")
    failed = 0
    with destination.open("w", encoding="utf-8") as output:
        for case in chosen:
            started = time.monotonic()
            run_id = request(args.base_url, "/api/v1/runs", {
                "model": args.model, "workflow_id": case["workflowId"], "snapshot_id": snapshot["id"],
                "document_ids": [], "strict_sources": True, "mode": "FAST",
                "messages": [{"role": "user", "content": case["question"]}],
            })["run_id"]
            while True:
                run = request(args.base_url, f"/api/v1/analysis/runs/{urllib.parse.quote(run_id, safe='')}")["run"]
                if run["status"] in {"completed", "failed", "cancelled", "interrupted"}:
                    break
                if time.monotonic() - started > args.timeout:
                    req = urllib.request.Request(args.base_url + f"/api/v1/runs/{run_id}", method="DELETE")
                    try:
                        urllib.request.urlopen(req, timeout=10).close()
                    except urllib.error.HTTPError:
                        pass
                    run = {"status": "timeout", "runId": run_id}
                    break
                time.sleep(0.25)
            result = run.get("result") or {}
            evidence_ids = {item["id"] for item in result.get("citations", [])}
            expected = case["expected"]
            cited = next((item for item in result.get("citations", []) if item["id"] == expected["evidenceId"]), {})
            answer = result.get("answer", "")
            checks = {
                "completed": run["status"] == "completed",
                "validated": result.get("validation", {}).get("valid") is True,
                "expected_source_present": case["expected"]["evidenceId"] in evidence_ids,
                "source_value_and_unit": cited.get("value") == expected["value"] and cited.get("unit") == expected["unit"],
                "missing_not_zero": expected["value"] is not None or ("chưa có giá trị đo" in answer and "0 " + expected["unit"] not in answer),
                "requested_fabrication_rejected": expected["check"] not in {"reject-fabricated-value", "assistant-history-not-source"} or "999" not in answer,
                "method_traceable": expected["check"] != "method" or metrics[case["metricId"]]["method"] in answer,
            }
            passed = all(checks.values())
            failed += not passed
            record = {"case": case, "model": args.model, "durationSeconds": round(time.monotonic() - started, 3),
                      "checks": checks, "run": run, "semanticReview": "pending-human-review"}
            output.write(json.dumps(record, ensure_ascii=False) + "\n")
            output.flush()
            print(f"{'PASS' if passed else 'REVIEW'} {case['id']} {record['durationSeconds']}s {checks}")
    print(f"Saved: {destination}; automated checks needing review: {failed}/{len(chosen)}.")
    print("Narrow measurement lookups use code; this is not a 100-question model accuracy score. Broad model interpretations still need semantic review.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
