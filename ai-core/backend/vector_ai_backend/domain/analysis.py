"""Transport-free contracts for evidence-grounded, read-only GIS analysis."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from datetime import datetime
from typing import Any

SCHEMA_VERSION = 1
ANALYSIS_WORKFLOWS = frozenset({"gis-analysis-v1", "data-quality-v1", "document-qa-v1", "report-summary-v1"})
ALL_QUERY_WORKFLOWS = ANALYSIS_WORKFLOWS | {"query-reasoning-v1"}
# Same 100 MiB ceiling as document uploads; JSON is checked before persistence.
MAX_ANALYSIS_BYTES = 100 * 1024 * 1024
STATUSES = {"observed", "missing", "outside", "partial", "unknown"}


class AnalysisConflict(ValueError):
    pass


class AnalysisNotFound(KeyError):
    pass


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def text(value: Any, name: str, *, limit: int = 8000) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f"{name} phải là chuỗi không rỗng, tối đa {limit} ký tự")
    return value


def timestamp(value: Any, name: str) -> str:
    value = text(value, name, limit=100)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError
    except ValueError as exc:
        raise ValueError(f"{name} phải có ngày giờ ISO và múi giờ") from exc
    return value


def number(value: Any, name: str) -> float | int:
    if type(value) not in {int, float} or not math.isfinite(value):
        raise ValueError(f"{name} phải là số hữu hạn")
    return value


def geometry(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) - {"type", "coordinates", "bbox"}:
        raise ValueError("GeoJSON geometry không hợp lệ")
    kind = value.get("type")
    coordinates = value.get("coordinates")

    def point(row):
        if not isinstance(row, list) or not 2 <= len(row) <= 3:
            raise ValueError("Tọa độ phải có kinh độ, vĩ độ")
        lng, lat = number(row[0], "kinh độ"), number(row[1], "vĩ độ")
        if not -180 <= lng <= 180 or not -90 <= lat <= 90:
            raise ValueError("Tọa độ ngoài WGS84")
        if len(row) == 3:
            number(row[2], "cao độ")

    def line(rows, ring=False):
        if not isinstance(rows, list) or len(rows) < (4 if ring else 2):
            raise ValueError("Đường/vòng GeoJSON thiếu tọa độ")
        for row in rows:
            point(row)
        if ring and rows[0] != rows[-1]:
            raise ValueError("Vòng polygon phải khép kín")

    def polygon(rings):
        if not isinstance(rings, list) or not rings:
            raise ValueError("Polygon thiếu vòng biên")
        for ring in rings:
            line(ring, True)

    if kind == "Point":
        point(coordinates)
    elif kind == "LineString":
        line(coordinates)
    elif kind == "Polygon":
        polygon(coordinates)
    elif kind in {"MultiPoint", "MultiLineString", "MultiPolygon"}:
        if not isinstance(coordinates, list) or not coordinates:
            raise ValueError("Multi geometry thiếu thành phần")
        fn = {"MultiPoint": point, "MultiLineString": line, "MultiPolygon": polygon}[kind]
        for item in coordinates:
            fn(item)
    else:
        raise ValueError("Loại GeoJSON geometry chưa hỗ trợ")
    return value


def _rows(value: Any, name: str, *, max_items: int = 50_000) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) > max_items or any(not isinstance(row, dict) for row in value):
        raise ValueError(f"{name} phải là danh sách hợp lệ")
    ids = [text(row.get("id"), f"{name}.id", limit=256) for row in value]
    if len(set(ids)) != len(ids):
        raise ValueError(f"{name} chứa ID trùng")
    return value


def validate_snapshot(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or type(raw.get("schemaVersion")) is not int or raw["schemaVersion"] != SCHEMA_VERSION:
        raise ValueError("Snapshot schemaVersion chưa hỗ trợ")
    encoded = canonical_json(raw)
    if len(encoded.encode("utf-8")) > MAX_ANALYSIS_BYTES:
        raise ValueError("Snapshot vượt quá 100 MiB")
    value = copy.deepcopy(raw)
    text(value.get("id"), "snapshot.id", limit=256)
    timestamp(value.get("createdAt"), "createdAt")
    aoi = value.get("aoi")
    if not isinstance(aoi, dict) or aoi.get("mode") not in {"point", "circle", "polygon"}:
        raise ValueError("Snapshot thiếu vùng phân tích")
    text(aoi.get("label"), "aoi.label")
    if geometry(aoi.get("geometry"))["type"] != "Polygon":
        raise ValueError("AOI phải là Polygon")
    datasets = _rows(value.get("datasets"), "datasets")
    dataset_ids = {row["id"] for row in datasets}
    dataset_versions = {row["id"]: row.get("version") for row in datasets}
    for row in datasets:
        text(row.get("version"), "dataset.version", limit=512)
        if row.get("coverage") not in {"observed", "partial", "outside", "unknown"}:
            raise ValueError("dataset.coverage không hợp lệ")
        if row.get("downloadedAt") is not None:
            timestamp(row["downloadedAt"], "dataset.downloadedAt")
        if "bounds" in row:
            bounds = row["bounds"]
            if not isinstance(bounds, list) or len(bounds) != 4:
                raise ValueError("dataset.bounds phải có bốn tọa độ")
            for n in bounds:
                number(n, "bounds")
            if not (-180 <= bounds[0] <= bounds[2] <= 180 and -90 <= bounds[1] <= bounds[3] <= 90):
                raise ValueError("dataset.bounds không hợp lệ")
    measurements = _rows(value.get("measurements"), "measurements")
    by_measurement = {row["id"]: row for row in measurements}
    for row in measurements:
        for key in ("label", "method"):
            text(row.get(key), f"measurement.{key}")
        if not isinstance(row.get("unit"), str):
            raise ValueError("measurement.unit phải là chuỗi")
        if row.get("status") not in STATUSES:
            raise ValueError("measurement.status không hợp lệ")
        if row.get("value") is not None:
            number(row["value"], "measurement.value")
        if row["status"] in {"missing", "outside"} and row.get("value") is not None:
            raise ValueError("Phép đo thiếu/ngoài vùng phải có value=null")
        if row["status"] == "observed" and row.get("value") is None:
            raise ValueError("Phép đo observed cần giá trị")
        if not isinstance(row.get("sourceIds"), list) or any(s not in dataset_ids for s in row["sourceIds"]):
            raise ValueError("Phép đo trỏ dataset không có trong snapshot")
    findings = _rows(value.get("findings"), "findings")
    by_finding = {row["id"]: row for row in findings}
    for row in findings:
        text(row.get("message"), "finding.message")
        text(row.get("code"), "finding.code", limit=256)
        if row.get("severity") not in {"info", "warning", "error"}:
            raise ValueError("finding.severity không hợp lệ")
        if not isinstance(row.get("sourceIds"), list) or any(s not in dataset_ids for s in row["sourceIds"]):
            raise ValueError("Finding trỏ dataset không có trong snapshot")
        if "geometry" in row:
            geometry(row["geometry"])
    evidence = _rows(value.get("evidence"), "evidence")
    features = value.get("features", [])
    if not isinstance(features, list) or len(features) > 50_000:
        raise ValueError("Snapshot features không hợp lệ")
    for feature in features:
        if not isinstance(feature, dict) or feature.get("type") != "Feature" or not isinstance(feature.get("properties"), dict):
            raise ValueError("Snapshot feature không hợp lệ")
        geometry(feature.get("geometry"))
    terrain_samples = value.get("terrainSamples", [])
    if not isinstance(terrain_samples, list) or len(terrain_samples) > 50_000:
        raise ValueError("Snapshot terrainSamples không hợp lệ")
    for sample in terrain_samples:
        if not isinstance(sample, dict) or sample.get("sourceId") not in dataset_ids:
            raise ValueError("Terrain sample thiếu dataset nguồn")
        geometry({"type": "Point", "coordinates": [sample.get("lon"), sample.get("lat")]})
        if sample.get("height") is not None:
            number(sample["height"], "terrain.height")
    for row in evidence:
        for key in ("sourceId", "version", "label"):
            text(row.get(key), f"evidence.{key}")
        if row.get("kind") not in {"gis", "document"}:
            raise ValueError("evidence.kind không hợp lệ")
        if "value" in row and row["value"] is not None:
            number(row["value"], "evidence.value")
        if "geometry" in row:
            geometry(row["geometry"])
        if row["kind"] == "gis":
            if row["sourceId"] not in dataset_ids:
                raise ValueError("GIS evidence trỏ nguồn không có trong snapshot")
            if row["version"] != dataset_versions[row["sourceId"]]:
                raise ValueError("GIS evidence không khớp phiên bản dataset")
            path = str(row.get("fieldPath", ""))
            target = None
            if path.startswith("measurements."):
                part = path.split(".")[1]
                target = by_measurement.get(part)
                if target is None and part.isdigit() and int(part) < len(measurements):
                    target = measurements[int(part)]
                if target is None or row.get("value") != target.get("value") or row.get("unit", "") != target["unit"] or row["label"] != target["label"]:
                    raise ValueError("GIS evidence khác giá trị/đơn vị phép đo")
                if row["sourceId"] not in target["sourceIds"]:
                    raise ValueError("GIS evidence không thuộc nguồn phép đo")
            elif path.startswith("findings."):
                target = by_finding.get(path.split(".")[1])
                if target is None or row["sourceId"] not in target["sourceIds"]:
                    raise ValueError("GIS evidence không thuộc finding")
                if row.get("excerpt") != target["message"]:
                    raise ValueError("GIS evidence khác finding")
            elif path.startswith("features."):
                part = path.split(".")[1]
                if not part.isdigit() or int(part) >= len(features):
                    raise ValueError("GIS evidence trỏ feature không tồn tại")
                feature = features[int(part)]
                if row["sourceId"] not in feature["properties"].get("sourceIds", []) or row.get("geometry") != feature["geometry"] or "value" in row:
                    raise ValueError("GIS evidence không khớp hình học/nguồn feature")
            elif path.startswith("terrainSamples."):
                part = path.split(".")[1]
                if not part.isdigit() or int(part) >= len(terrain_samples):
                    raise ValueError("GIS evidence trỏ terrain sample không tồn tại")
                sample = terrain_samples[int(part)]
                expected_geometry = {"type": "Point", "coordinates": [sample["lon"], sample["lat"]]}
                if row["sourceId"] != sample["sourceId"] or row.get("value") != sample.get("height") or row.get("unit") != "m" or row.get("geometry") != expected_geometry:
                    raise ValueError("GIS evidence không khớp terrain sample")
            else:
                raise ValueError("GIS evidence cần fieldPath measurements/findings/features/terrainSamples")
        else:
            text(row.get("chunkId"), "evidence.chunkId", limit=512)
            text(row.get("documentId"), "evidence.documentId", limit=512)
            text(row.get("excerpt"), "evidence.excerpt", limit=100_000)
    supplied_hash = value.pop("contentHash", None)
    digest = hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()
    if supplied_hash is not None and supplied_hash != digest:
        raise ValueError("Snapshot contentHash không khớp")
    value["contentHash"] = digest
    return value


def validate_report_sources(report: dict[str, Any]) -> dict[str, Any]:
    """Bind portable GIS citations to immutable original evidence.

    Document excerpts remain archived source assertions on another machine;
    their IDs and excerpt are mandatory, while local-run canonical equality is
    enforced separately by the repository. Imported AI prose is never evidence.
    """
    if not isinstance(report, dict) or not isinstance(report.get("result"), dict):
        raise ValueError("Report thiếu kết quả để đối chiếu nguồn")
    if len(canonical_json(report).encode("utf-8")) > MAX_ANALYSIS_BYTES:
        raise ValueError("Report vượt quá 100 MiB")
    result = report["result"]
    main = report.get("snapshot")
    snapshots: dict[str, dict[str, Any]] = {}
    if main is not None:
        main = validate_snapshot(main)
        report["snapshot"] = main
        snapshots[main["id"]] = main
    related = result.get("sourceSnapshots", [])
    if not isinstance(related, list) or len(related) > 32:
        raise ValueError("Result sourceSnapshots phải là danh sách, tối đa 32 bản chụp")
    normalized = []
    for raw in related:
        snapshot = validate_snapshot(raw)
        previous = snapshots.get(snapshot["id"])
        if previous and previous["contentHash"] != snapshot["contentHash"]:
            raise ValueError("Các bản chụp nguồn cùng ID có nội dung khác nhau")
        snapshots[snapshot["id"]] = snapshot
        normalized.append(snapshot)
    if "sourceSnapshots" in result:
        result["sourceSnapshots"] = normalized
    if result.get("snapshotId") != (main["id"] if main else None):
        raise ValueError("Report snapshot không khớp kết quả")
    citations = result.get("citations")
    if not isinstance(citations, list) or len(citations) > 50_000 or any(not isinstance(ref, dict) for ref in citations):
        raise ValueError("Report citations không hợp lệ")
    ids = [text(ref.get("id"), "citation.id", limit=512) for ref in citations]
    if len(ids) != len(set(ids)):
        raise ValueError("Report chứa citation ID trùng")
    bound_fields = ("kind", "sourceId", "version", "label", "fieldPath", "value", "unit", "excerpt", "documentId", "chunkId", "geometry")
    absent = object()
    for ref in citations:
        for key in ("sourceId", "version", "label"):
            text(ref.get(key), f"citation.{key}")
        if "value" in ref and ref["value"] is not None:
            number(ref["value"], "citation.value")
        if "geometry" in ref:
            geometry(ref["geometry"])
        if ref.get("kind") == "document":
            text(ref.get("documentId"), "citation.documentId", limit=256)
            text(ref.get("chunkId"), "citation.chunkId", limit=512)
            text(ref.get("excerpt"), "citation.excerpt", limit=100_000)
            if ref["sourceId"] != ref["documentId"]:
                raise ValueError("Document citation không khớp sourceId/documentId")
        elif ref.get("kind") == "gis":
            namespaced = "snapshotId" in ref or "originEvidenceId" in ref
            if namespaced:
                snapshot_id = text(ref.get("snapshotId"), "citation.snapshotId", limit=256)
                origin_id = text(ref.get("originEvidenceId"), "citation.originEvidenceId", limit=256)
                snapshot = snapshots.get(snapshot_id)
            else:
                snapshot, origin_id = main, ref["id"]
            if snapshot is None:
                raise ValueError("GIS citation thiếu bản chụp nguồn gốc")
            original = next((row for row in snapshot["evidence"] if row["id"] == origin_id), None)
            if original is None:
                raise ValueError("GIS citation không thuộc evidence trong bản chụp")
            if any(ref.get(key, absent) != original.get(key, absent) for key in bound_fields):
                raise ValueError("GIS citation khác giá trị, đơn vị hoặc nguồn gốc đã chụp")
        else:
            raise ValueError("citation.kind không hợp lệ")
    return report


# Numerical and comparative claims are references, never arbitrary prose.
# The backend renders their values/units and decides the comparison itself.
MODEL_OUTPUT_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["claims", "missingData", "annotationEvidenceIds"],
    "properties": {
        "claims": {"type": "array", "maxItems": 24, "items": {
            "type": "object", "additionalProperties": False,
            "required": ["kind", "evidenceIds", "text", "relation"],
            "properties": {
                "kind": {"type": "string", "enum": ["fact", "quote", "interpretation", "comparison"]},
                "evidenceIds": {"type": "array", "minItems": 1, "maxItems": 8, "items": {"type": "string"}},
                "text": {"type": "string", "maxLength": 2000},
                "relation": {"type": "string", "enum": ["", "lt", "eq", "gt"]},
            },
        }},
        "missingData": {"type": "array", "maxItems": 16, "items": {"type": "string", "maxLength": 1000}},
        "annotationEvidenceIds": {"type": "array", "maxItems": 32, "items": {"type": "string"}},
    },
}

# Quantities must use controlled fact/comparison fields, even when a digit is
# attached to prose ("cao12m") or a common Vietnamese quantity is spelled out.
# This is a conservative lexical guard, not a semantic correctness classifier.
NUMERIC_PATTERN = re.compile(
    r"\d|\b(?:không|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười|trăm|nghìn|ngàn|triệu|tỷ|chục)"
    r"(?:\s+(?:mươi|mốt|lẻ|linh|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười|trăm|nghìn|ngàn|triệu|tỷ))*"
    r"\s*(?:km²|m²|km|m|ha|%|mét|kilômét|ki-lô-mét|phần trăm|đối tượng|công trình)\b",
    re.UNICODE | re.IGNORECASE,
)
COMPARATIVE_PATTERN = re.compile(r"cao hơn|thấp hơn|lớn hơn|nhỏ hơn|nhiều hơn|ít hơn|\bgấp\b|greater|less than|higher|lower", re.IGNORECASE)


def validated_answer(payload: Any, evidence: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]], list[str], list[dict[str, Any]]]:
    # Imported here to reuse the registry's dependency-free JSON validator.
    from ..application.tools import validate_json_schema
    validate_json_schema(payload, MODEL_OUTPUT_SCHEMA)
    by_id = {row["id"]: row for row in evidence}
    lines, issues, cited, annotations = [], [], {}, []
    for claim in payload["claims"]:
        ids = claim["evidenceIds"]
        if len(ids) != len(set(ids)) or any(i not in by_id for i in ids):
            issues.append("Trích dẫn không thuộc nguồn của run")
            continue
        refs = [by_id[i] for i in ids]
        suffix = " " + " ".join(f"[{i}]" for i in ids)
        kind, prose = claim["kind"], claim["text"].strip()
        if kind == "fact":
            if len(refs) != 1 or type(refs[0].get("value")) not in {int, float}:
                issues.append("Dữ kiện định lượng không có phép đo")
                continue
            ref = refs[0]
            if prose or claim["relation"]:
                issues.append("Dữ kiện phải dùng giá trị và nhãn nguồn, không tự viết số")
                continue
            lines.append(f"{ref['label']}: {ref['value']:g} {ref.get('unit', '')}." + suffix)
        elif kind == "comparison":
            if len(refs) != 2 or any(type(r.get("value")) not in {int, float} for r in refs) or refs[0].get("unit") != refs[1].get("unit"):
                issues.append("So sánh cần hai phép đo cùng đơn vị")
                continue
            a, b = refs[0]["value"], refs[1]["value"]
            relation = "lt" if a < b else "gt" if a > b else "eq"
            if claim["relation"] != relation or prose:
                issues.append("So sánh đảo chiều hoặc chứa diễn giải chưa kiểm tra")
                continue
            words = {"lt": "nhỏ hơn", "gt": "lớn hơn", "eq": "bằng"}[relation]
            lines.append(f"{refs[0]['label']} ({a:g} {refs[0].get('unit', '')}) {words} {refs[1]['label']} ({b:g} {refs[1].get('unit', '')})." + suffix)
        elif kind == "quote":
            if len(refs) != 1 or not prose or prose not in refs[0].get("excerpt", "") or claim["relation"]:
                issues.append("Trích đoạn không khớp nội dung nguồn")
                continue
            lines.append(prose + suffix)
        else:
            # Free interpretation is visibly a draft and cannot hide quantities
            # or directional numeric comparisons outside the controlled fields.
            if not prose or NUMERIC_PATTERN.search(prose) or COMPARATIVE_PATTERN.search(prose) or claim["relation"]:
                issues.append("Diễn giải chứa số/so sánh không được kiểm chứng")
                continue
            lines.append("Diễn giải nháp — cần xem lại: " + prose + suffix)
        cited.update({r["id"]: r for r in refs})
    for eid in payload["annotationEvidenceIds"]:
        ref = by_id.get(eid)
        if ref is None or not ref.get("geometry"):
            issues.append("Đánh dấu không có hình học nguồn")
            continue
        annotations.append({"id": f"draft-{eid}", "label": ref["label"], "geometry": ref["geometry"], "evidenceIds": [eid]})
        cited[ref["id"]] = ref
    if not lines:
        issues.append("Không có dữ kiện đủ điều kiện hiển thị")
    return "\n\n".join(lines), list(cited.values()), list(dict.fromkeys(issues)), annotations
