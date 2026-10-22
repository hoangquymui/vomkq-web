from __future__ import annotations

import asyncio
import copy
import json
import sqlite3
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from vector_ai_backend.adapters.ollama import OllamaClient
from vector_ai_backend.api import create_app
from vector_ai_backend.application.analysis import AnalysisReadTool, AnalysisWorkflowRunner, measurement_lookup, verify_document_evidence
from vector_ai_backend.application.runs import RunCoordinator
from vector_ai_backend.application.resources import InferenceScheduler, ResourceManager
from vector_ai_backend.application.tools import ToolRegistry
from vector_ai_backend.bootstrap import build_container
from vector_ai_backend.config import BackendSettings
from vector_ai_backend.domain.analysis import AnalysisConflict, MODEL_OUTPUT_SCHEMA, validate_report_sources, validate_snapshot, validated_answer
from vector_ai_backend.domain.models import ChatMessage, ChatRequest, DocumentChunk, LLMRequest, ModelCapabilities, QueryReasoningState, ResourceLimits, RunEventType, SourceScope, ToolPolicy
from vector_ai_backend.storage.analysis_store import AnalysisStore
from vector_ai_backend.storage.sqlite_repository import SQLiteKnowledgeRepository


def snapshot():
    shape = {"type": "Polygon", "coordinates": [[[108, 16], [108.01, 16], [108.01, 16.01], [108, 16.01], [108, 16]]]}
    return {"schemaVersion": 1, "id": "snapshot-test", "createdAt": "2026-10-06T10:00:00Z",
        "aoi": {"mode": "polygon", "label": "Vườn thử", "geometry": shape},
        "datasets": [{"id": "garden", "version": "v1", "downloadedAt": None, "coverage": "unknown"}],
        "measurements": [{"id": "elevation", "label": "Cao độ mẫu", "value": 0, "unit": "m", "method": "fixture", "status": "observed", "sourceIds": ["garden"]}],
        "findings": [{"id": "coverage", "code": "coverage_unknown", "severity": "warning", "message": "Chưa xác minh độ đầy đủ dữ liệu vùng", "sourceIds": ["garden"], "geometry": shape}],
        "evidence": [
            {"id": "E1", "kind": "gis", "sourceId": "garden", "version": "v1", "label": "Cao độ mẫu", "value": 0, "unit": "m", "fieldPath": "measurements.elevation"},
            {"id": "E2", "kind": "gis", "sourceId": "garden", "version": "v1", "label": "Độ đầy đủ", "excerpt": "Chưa xác minh độ đầy đủ dữ liệu vùng", "fieldPath": "findings.coverage", "geometry": shape},
        ]}


def claim(kind="fact", ids=None, text="", relation=""):
    return {"claims": [{"kind": kind, "evidenceIds": ids or ["E1"], "text": text, "relation": relation}], "missingData": [], "annotationEvidenceIds": []}


def test_snapshot_zero_missing_hash_and_evidence_consistency():
    raw = snapshot()
    value = validate_snapshot(raw)
    assert value["measurements"][0]["value"] == 0 and len(value["contentHash"]) == 64
    assert validate_snapshot(value) == value
    raw["measurements"][0].update(value=None, status="missing")
    raw["evidence"][0]["value"] = None
    assert validate_snapshot(raw)["measurements"][0]["value"] is None
    raw["measurements"][0]["value"] = 0
    with pytest.raises(ValueError, match="value=null"):
        validate_snapshot(raw)
    for field, changed in (("value", 55), ("value", False), ("label", "Khoảng cách giả"), ("unit", "km"), ("version", "v2"), ("sourceId", "forged")):
        raw = snapshot()
        raw["evidence"][0][field] = changed
        with pytest.raises(ValueError):
            validate_snapshot(raw)
    value["aoi"]["label"] = "changed"
    with pytest.raises(ValueError, match="contentHash"):
        validate_snapshot(value)


def test_snapshot_polygon_holes_multipart_and_invalid_coordinates():
    raw = snapshot()
    hole = [[108.002, 16.002], [108.003, 16.002], [108.003, 16.003], [108.002, 16.002]]
    raw["aoi"]["geometry"]["coordinates"].append(hole)
    raw["features"] = [{"type": "Feature", "properties": {}, "geometry": {"type": "MultiPolygon", "coordinates": [copy.deepcopy(raw["aoi"]["geometry"]["coordinates"])]}}]
    validate_snapshot(raw)
    raw["features"][0]["geometry"]["coordinates"][0][0][0][0] = 181
    with pytest.raises(ValueError, match="WGS84"):
        validate_snapshot(raw)


def test_validator_binds_numbers_citations_comparisons_and_geometry():
    refs = snapshot()["evidence"]
    answer, citations, issues, _ = validated_answer(claim(), refs)
    assert "0 m" in answer and [r["id"] for r in citations] == ["E1"] and not issues
    for forged in (claim(ids=["fake"]), claim(text="0.9 km"), claim("interpretation", text="Cao hơn và cách 0.1 km")):
        assert validated_answer(forged, refs)[2]
    for unsupported in ("cao12m", "Khoảng mười mét", "Hai mươi phần trăm", "Cao gấp hai lần"):
        assert validated_answer(claim("interpretation", text=unsupported), refs)[2]
    assert not validated_answer(claim("interpretation", text="Dữ liệu chỉ mô tả một phần phạm vi quan sát."), refs)[2]
    second = {**refs[0], "id": "E3", "value": 9, "label": "Mẫu thứ hai"}
    assert not validated_answer(claim("comparison", ["E1", "E3"], relation="lt"), [*refs, second])[2]
    assert validated_answer(claim("comparison", ["E1", "E3"], relation="gt"), [*refs, second])[2]
    assert validated_answer(claim("comparison", ["E1", "E3"], relation="lt"), [*refs, {**second, "unit": "km"}])[2]
    quoted = claim("quote", ["E2"], text=refs[1]["excerpt"])
    quoted["annotationEvidenceIds"] = ["E2"]
    assert validated_answer(quoted, refs)[3][0]["geometry"] == refs[1]["geometry"]
    quoted["claims"][0]["text"] = "Dữ liệu đầy đủ"
    assert validated_answer(quoted, refs)[2]


def test_store_is_immutable_durable_backed_up_and_restart_interrupts(tmp_path: Path):
    async def run():
        repository = SQLiteKnowledgeRepository(tmp_path / "vector_ai.sqlite3")
        store = AnalysisStore(repository.path)
        original = await store.save_snapshot(snapshot())
        assert await store.save_snapshot(original) == original
        changed = snapshot()
        changed["aoi"]["label"] = "changed"
        with pytest.raises(AnalysisConflict):
            await store.save_snapshot(changed)
        request = ChatRequest("test", (ChatMessage("user", "kiểm tra vùng"),), workflow_id="gis-analysis-v1", snapshot_id=original["id"], run_id="restart")
        await store.create_run(request)
        await store.transition(request.run_id, "running")
        await repository.backup_to(tmp_path / "backup.sqlite3")
        backup = sqlite3.connect(tmp_path / "backup.sqlite3")
        assert backup.execute("SELECT id FROM analysis_snapshots").fetchone()[0] == original["id"]
        backup.close()
        await store.close()
        store = AnalysisStore(repository.path)
        assert (await store.get_run("restart"))["status"] == "interrupted"
        assert await store.get_snapshot(original["id"]) == original
        assert list((tmp_path / "backups" / "analysis-migrations").glob("*.sqlite3"))
        await store.close()
        await repository.close()
    asyncio.run(run())


class FakeLLM:
    def __init__(self, output=None, truncated=False):
        self.calls, self.output, self.truncated = 0, output if output is not None else claim(), truncated

    async def capabilities(self, model):
        return ModelCapabilities()

    async def stream_chat(self, request):
        self.calls += 1
        assert request.format["required"] == MODEL_OUTPUT_SCHEMA["required"]
        assert "E1" in request.format["properties"]["claims"]["items"]["properties"]["evidenceIds"]["items"]["enum"]
        yield {"content": json.dumps(self.output, ensure_ascii=False), "done": True, "truncated": self.truncated}


def test_analysis_runner_no_source_validation_and_durable_result(tmp_path: Path):
    async def run():
        repository = SQLiteKnowledgeRepository(tmp_path / "vector_ai.sqlite3")
        store = AnalysisStore(repository.path)
        scheduler = InferenceScheduler(ResourceManager(ResourceLimits(1, 512, 0)))
        tools = ToolRegistry(scheduler, ToolPolicy(frozenset({"gis.measurements", "gis.quality"}), frozenset({"analysis"})))
        for name in ("gis.measurements", "gis.quality"):
            tools.register(AnalysisReadTool(store, name))
        llm = FakeLLM()
        runner = AnalysisWorkflowRunner(legacy=None, store=store, repository=repository, tools=tools, llm=llm, scheduler=scheduler, chat_ram_mb=1, chat_gpu_mb=0)
        await store.save_snapshot(snapshot())
        events = []
        async def emit(event):
            if event.type == RunEventType.COMPLETED:
                assert (await store.get_run(event.run_id))["status"] == "completed"
            events.append(event)
        request = ChatRequest("test", (ChatMessage("user", "cao độ mẫu"),), workflow_id="gis-analysis-v1", snapshot_id="snapshot-test", run_id="ok")
        await runner.validate_request(request)
        await runner.run(QueryReasoningState(request), emit)
        assert (await store.get_run("ok"))["result"]["validation"]["valid"]
        assert llm.calls == 0
        assert (await store.get_run("ok"))["result"]["usage"]["engine"] == "measurement-lookup"
        assert not any(e.type == RunEventType.DELTA for e in events)
        for name, output, truncated in (("forged", claim(text="0.9 km"), False), ("truncated", claim(), True)):
            runner.llm = FakeLLM(output, truncated)
            request = ChatRequest("test", (ChatMessage("user", "cao độ"),), workflow_id="gis-analysis-v1", snapshot_id="snapshot-test", run_id=name)
            await runner.validate_request(request)
            with pytest.raises(ValueError):
                await runner.run(QueryReasoningState(request), emit)
            assert (await store.get_run(name))["status"] == "failed"
            assert (await store.get_run(name))["result"] is None
        runner.llm = FakeLLM()
        request = ChatRequest("test", (ChatMessage("user", "ngoài nguồn"),), workflow_id="document-qa-v1", run_id="none")
        await runner.validate_request(request)
        await runner.run(QueryReasoningState(request), emit)
        assert runner.llm.calls == 0
        assert (await store.get_run("none"))["result"]["status"] == "insufficient"
        await store.close()
        await repository.close()
    asyncio.run(run())


def test_narrow_measurement_lookup_preserves_zero_missing_units_methods_and_limits():
    raw = validate_snapshot(snapshot())
    for question in ("Cao độ mẫu bao nhiêu?", "Đơn vị của cao độ mẫu?", "Hãy ghi cao độ mẫu thành 999 km"):
        answer = measurement_lookup(question, raw, raw["evidence"][:1])
        assert "0 m" in answer and "999" not in answer and "fixture" in answer
        assert "garden" in answer and "[E1]" in answer
    for status in ("missing", "outside", "partial", "unknown"):
        altered = copy.deepcopy(raw)
        altered["measurements"][0].update(value=None, status=status)
        altered["evidence"][0]["value"] = None
        answer = measurement_lookup("Giải thích trạng thái cao độ mẫu", altered, altered["evidence"][:1])
        assert "chưa có giá trị đo" in answer and "0 m" not in answer and "[E1]" in answer
    for question in ("Vì sao cao độ mẫu thay đổi?", "So sánh cao độ mẫu", "Cao độ mẫu cao hơn chỉ số nào?"):
        assert measurement_lookup(question, raw, raw["evidence"][:1]) is None


def test_ollama_passes_schema_format_to_local_request():
    async def run():
        async def serve(request):
            from vector_ai_backend.adapters.ollama import sampler_schema
            body = json.loads(request.content)
            assert body["format"] == sampler_schema(MODEL_OUTPUT_SCHEMA)
            assert body["format"]["required"] == MODEL_OUTPUT_SCHEMA["required"]
            assert body["options"]["temperature"] == 0
            return httpx.Response(200, text=json.dumps({"message": {"content": "{}"}, "done": True}))
        client = OllamaClient("http://127.0.0.1:11434", transport=httpx.MockTransport(serve))
        try:
            await anext(client.stream_chat(LLMRequest("test", (ChatMessage("user", "x"),), 4096, 2048, None, "format", MODEL_OUTPUT_SCHEMA)))
        finally:
            await client.close()
    asyncio.run(run())


def test_api_dispatcher_strict_sources_selected_docs_and_reports(tmp_path: Path):
    container = asyncio.run(build_container(BackendSettings(data_dir=tmp_path, resource_gpu_mb=0, chat_gpu_mb=0)))
    container.query_runs._runner.llm = FakeLLM()
    try:
        with TestClient(create_app(container)) as client:
            response = client.post("/api/v1/analysis/snapshots", json={"snapshot": snapshot()})
            assert response.status_code == 201, response.text
            saved = response.json()["snapshot"]
            assert client.get("/api/v1/analysis/snapshots/snapshot-test").json()["snapshot"] == saved
            assert client.post("/api/v1/runs", json={"model": "test", "messages": [{"role": "user", "content": "x"}], "workflow_id": "unknown"}).status_code == 422
            assert client.get("/api/v1/analysis/capabilities").json()["autoDownload"] is False
            started = client.post("/api/v1/runs", json={"model": "test", "messages": [{"role": "user", "content": "cao độ mẫu"}], "workflow_id": "gis-analysis-v1", "snapshot_id": saved["id"], "strict_sources": False})
            assert started.status_code == 200, started.text
            rid = started.json()["run_id"]
            assert container.query_runs._records[rid].state.request.strict_sources is True
            assert "event: completed" in client.get(f"/api/v1/runs/{rid}/events").text
            result = client.get(f"/api/v1/analysis/runs/{rid}").json()["run"]["result"]
            report = {"schemaVersion": 1, "id": "report", "revision": 1, "title": "Báo cáo", "createdAt": saved["createdAt"], "updatedAt": saved["createdAt"], "snapshot": saved, "result": result, "notes": "", "annotations": []}
            assert client.post("/api/v1/analysis/reports", json={"report": report}).status_code == 201
            edited = copy.deepcopy(report)
            edited["notes"] = "ghi chú mới"
            assert client.post("/api/v1/analysis/reports", json={"report": edited}).status_code == 409
            edited.update(id="report-revision", revision=2, parentId="report")
            assert client.post("/api/v1/analysis/reports", json={"report": edited}).status_code == 201
            assert len(client.get("/api/v1/analysis/reports").json()["reports"]) == 2
    finally:
        asyncio.run(container.close())


class QuoteSelectedLLM:
    """Local fake transport: tests actual retrieval, not model prose quality."""
    def __init__(self):
        self.packets = []

    async def capabilities(self, model):
        return ModelCapabilities()

    async def stream_chat(self, request):
        packet = json.loads(request.messages[-1].content)
        self.packets.append(packet)
        refs = packet["evidence"]
        ref = next(ref for ref in refs if ref["kind"] == "document")
        payload = claim("quote", [ref["id"]], ref["excerpt"])
        assert ref["id"] in request.format["properties"]["claims"]["items"]["properties"]["evidenceIds"]["items"]["enum"]
        yield {"content": json.dumps(payload, ensure_ascii=False), "done": True}


def test_document_qa_filters_explicit_ids_before_candidate_limit_and_validates_chunks(tmp_path: Path):
    container = asyncio.run(build_container(BackendSettings(data_dir=tmp_path, resource_gpu_mb=0, chat_gpu_mb=0)))
    fake = QuoteSelectedLLM()
    container.query_runs._runner.llm = fake
    async def prepare():
        # Numerous unrelated higher-ranked hits must not crowd out the selected
        # document before the backend filters candidate IDs.
        for index in range(85):
            doc = f"unselected-{index}"
            await container.repository.upsert_document({"id": doc, "version": 1, "title": doc, "scope_kind": "builtin"})
            await container.repository.upsert_chunks([DocumentChunk(f"{doc}:chunk", doc, 1, "hoa lavender", 0)])
        await container.repository.upsert_document({"id": "selected", "version": 1, "title": "Sổ vườn", "scope_kind": "builtin"})
        await container.repository.upsert_chunks([DocumentChunk("selected:chunk", "selected", 1, "Sổ vườn ghi hoa lavender có mã 734 và màu tím.", 0, page=7)])
        await container.repository.upsert_document({"id": "without-keyword", "version": 1, "title": "Nguồn khác", "scope_kind": "builtin"})
        await container.repository.upsert_chunks([DocumentChunk("without:chunk", "without-keyword", 1, "Chỉ ghi cây thông.", 0)])
    asyncio.run(prepare())
    try:
        with TestClient(create_app(container)) as client:
            def query(ids):
                response = client.post("/api/v1/runs", json={"model": "fake", "workflow_id": "document-qa-v1",
                    "document_ids": ids, "messages": [{"role": "user", "content": "hoa lavender"}], "strict_sources": False})
                assert response.status_code == 200, response.text
                rid = response.json()["run_id"]
                assert "event: completed" in client.get(f"/api/v1/runs/{rid}/events").text
                return client.get(f"/api/v1/analysis/runs/{rid}").json()["run"]["result"]
            result = query(["selected"])
            assert result["validation"]["valid"] and result["snapshotId"] is None
            assert [ref["documentId"] for ref in result["citations"]] == ["selected"]
            assert result["citations"][0]["chunkId"] == "selected:chunk"
            assert result["citations"][0]["version"] == "1"
            assert result["citations"][0]["fieldPath"] == "page:7"
            assert "734" in result["answer"]
            assert {ref["documentId"] for ref in fake.packets[0]["evidence"]} == {"selected"}
            # Empty selection is no documents; it never means all builtins.
            for ids in ([], ["without-keyword"], ["missing-document"]):
                assert query(ids)["status"] == "insufficient"
            assert len(fake.packets) == 1

            raw = snapshot()
            ref = {"id": "D1", "kind": "document", "sourceId": "selected", "version": "1", "label": "Sổ vườn",
                "documentId": "selected", "chunkId": "selected:chunk", "excerpt": "hoa lavender có mã 734"}
            raw["evidence"].append(ref)
            assert client.post("/api/v1/analysis/snapshots", json={"snapshot": raw}).status_code == 201
            for key, forged in (("excerpt", "hoa lavender có mã 999"), ("version", "2"), ("chunkId", "unselected-0:chunk"), ("sourceId", "unselected-0")):
                altered = copy.deepcopy(raw)
                altered["id"] = f"forged-{key}"
                altered["evidence"][-1][key] = forged
                response = client.post("/api/v1/analysis/snapshots", json={"snapshot": altered})
                assert response.status_code == 422, response.text
    finally:
        asyncio.run(container.close())


def test_report_summary_namespaces_sources_and_excludes_prior_ai_and_notes(tmp_path: Path):
    async def run():
        container = await build_container(BackendSettings(data_dir=tmp_path, resource_gpu_mb=0, chat_gpu_mb=0))
        try:
            class ReportLLM:
                packet = None
                async def capabilities(self, model):
                    return ModelCapabilities()
                async def stream_chat(self, request):
                    self.packet = json.loads(request.messages[-1].content)
                    refs = [ref for ref in self.packet["evidence"] if ref.get("fieldPath", "").startswith("measurements.")]
                    assert len(refs) == 2 and len({ref["id"] for ref in refs}) == 2
                    refs.sort(key=lambda ref: ref["value"])
                    yield {"content": json.dumps(claim("comparison", [ref["id"] for ref in refs], relation="lt")), "done": True}
            fake = ReportLLM()
            runner = container.query_runs._runner
            runner.llm = fake
            for i, height in enumerate((0, 12)):
                raw = snapshot()
                raw["id"] = f"snapshot-{i}"
                raw["measurements"][0]["value"] = raw["evidence"][0]["value"] = height
                saved = await container.analyses.save_snapshot(raw)
                request = ChatRequest("fake", (ChatMessage("user", "kiểm tra"),), workflow_id="data-quality-v1", snapshot_id=saved["id"], run_id=f"source-{i}")
                await runner.validate_request(request)
                await runner.run(QueryReasoningState(request), lambda event: asyncio.sleep(0))
                result = (await container.analyses.get_run(request.run_id))["result"]
                await container.analyses.save_report({"schemaVersion": 1, "id": f"report-{i}", "revision": 1, "title": "Báo cáo vùng",
                    "createdAt": saved["createdAt"], "updatedAt": saved["createdAt"], "snapshot": saved,
                    "result": result, "notes": "NOTE-MUST-NOT-BE-EVIDENCE-999", "annotations": []})
            request = ChatRequest("fake", (ChatMessage("user", "so sánh hai báo cáo"),), workflow_id="report-summary-v1", report_ids=("report-0", "report-1"), run_id="summary")
            await runner.validate_request(request)
            await runner.run(QueryReasoningState(request), lambda event: asyncio.sleep(0))
            result = (await container.analyses.get_run("summary"))["result"]
            assert result["validation"]["valid"] and "nhỏ hơn" in result["answer"]
            assert len(result["citations"]) == 2
            assert {ref["id"] for ref in result["citations"]} == {"report:report-0:E1", "report:report-1:E1"}
            assert "NOTE-MUST-NOT" not in json.dumps(fake.packet)
            assert all(ref["version"] == "v1" and ref["fieldPath"] == "measurements.elevation" for ref in result["citations"])
            assert {ref["snapshotId"] for ref in result["citations"]} == {"snapshot-0", "snapshot-1"}
            assert {source["id"] for source in result["sourceSnapshots"]} == {"snapshot-0", "snapshot-1"}
            summary = await container.analyses.save_report({"schemaVersion": 1, "id": "portable-summary", "revision": 1,
                "title": "So sánh có nguồn", "createdAt": result["createdAt"], "updatedAt": result["createdAt"],
                "snapshot": None, "result": result, "notes": "", "annotations": []})
            assert summary["result"] == result
        finally:
            await container.close()
    asyncio.run(run())


def test_cancelled_analysis_releases_resources_and_never_completes(tmp_path: Path):
    async def run():
        container = await build_container(BackendSettings(data_dir=tmp_path, resource_gpu_mb=0, chat_gpu_mb=0))
        try:
            class BlockingLLM:
                entered = asyncio.Event()
                released = False
                async def capabilities(self, model):
                    return ModelCapabilities()
                async def stream_chat(self, request):
                    self.entered.set()
                    try:
                        await asyncio.Event().wait()
                        yield {"content": "", "done": True}
                    finally:
                        self.released = True
            fake = BlockingLLM()
            runner = container.query_runs._runner
            runner.llm = fake
            await container.analyses.save_snapshot(snapshot())
            request = ChatRequest("fake", (ChatMessage("user", "vì sao cao độ"),), workflow_id="gis-analysis-v1", snapshot_id="snapshot-test", run_id="cancel-test")
            await runner.validate_request(request)
            await container.query_runs.start(QueryReasoningState(request))
            await asyncio.wait_for(fake.entered.wait(), timeout=2)
            assert (await container.resources.snapshot())["active"]
            await container.query_runs.cancel(request.run_id)
            events = [event async for event in container.query_runs.events(request.run_id)]
            assert events[-1].type == RunEventType.CANCELLED and not any(event.type == RunEventType.COMPLETED for event in events)
            assert fake.released and not (await container.resources.snapshot())["active"]
            persisted = await container.analyses.get_run(request.run_id)
            assert persisted["status"] == "cancelled" and persisted["result"] is None
        finally:
            await container.close()
    asyncio.run(run())


def test_txt_and_markdown_capabilities_correspond_to_real_local_ingestion(tmp_path: Path):
    container = asyncio.run(build_container(BackendSettings(data_dir=tmp_path, resource_gpu_mb=0, chat_gpu_mb=0)))
    try:
        with TestClient(create_app(container)) as client:
            capabilities = client.get("/api/v1/analysis/capabilities").json()
            assert {".txt", ".md"}.issubset(capabilities["documentExtensions"])
            assert capabilities["schedulerBudgetIsMemoryCap"] is False
            for suffix in (".txt", ".md"):
                content = f"Tài liệu {suffix} ghi khu vườn tamgiacchung724 và màu hoa tím."
                response = client.post("/api/v1/documents", files={"file": (f"garden{suffix}", content.encode("utf-8"), "text/plain")}, data={"scope": '{"builtin":true}'})
                assert response.status_code == 202, response.text
                rid = response.json()["run_id"]
                events = client.get(f"/api/v1/ingestion-runs/{rid}/events").text
                assert "event: completed" in events and "event: error" not in events
                docs = client.get("/api/v1/documents").json()["documents"]
                document = next(doc for doc in docs if doc["id"] == response.json()["id"])
                assert document["chunk_count"] > 0
            hits = client.post("/api/v1/retrieval/preview", json={"query": "tamgiacchung724", "scope": {"builtin": True}}).json()["hits"]
            assert len({hit["source"]["document_id"] for hit in hits}) == 2
    finally:
        asyncio.run(container.close())


def test_imported_report_root_and_local_child_preserve_foreign_provenance(tmp_path: Path):
    async def run():
        repository = SQLiteKnowledgeRepository(tmp_path / "vector_ai.sqlite3")
        store = AnalysisStore(repository.path)
        try:
            saved = validate_snapshot(snapshot())
            result = {"schemaVersion": 1, "runId": "foreign-run", "snapshotId": saved["id"], "workflowId": "gis-analysis-v1",
                "createdAt": saved["createdAt"], "status": "complete", "answer": "Cao độ mẫu: 0 m. [E1]", "citations": saved["evidence"][:1],
                "missingData": [], "warnings": [], "draftAnnotations": [], "validation": {"valid": True, "issues": []}, "model": "local", "usage": {}}
            imported = {"schemaVersion": 1, "id": "imported-root", "revision": 1, "title": "Báo cáo nhập", "createdAt": saved["createdAt"], "updatedAt": saved["createdAt"],
                "snapshot": saved, "result": result, "notes": "ghi chú người dùng", "annotations": [],
                "importedFrom": {"reportId": "foreign-report", "revision": 8, "importedAt": saved["createdAt"]}}
            root = await store.save_report(imported)
            assert root["revision"] == 1 and "parentId" not in root
            assert root["importedFrom"] == imported["importedFrom"]
            assert root["result"]["validation"] == result["validation"]
            assert any("máy khác" in warning for warning in root["result"]["warnings"])
            child = copy.deepcopy(root)
            child.update(id="imported-child", parentId=root["id"], revision=2, notes="ghi chú sửa")
            assert (await store.save_report(child))["parentId"] == root["id"]
            assert (await store.get_report(root["id"]))["notes"] == "ghi chú người dùng"
            invalid = copy.deepcopy(imported)
            invalid["importedFrom"]["revision"] = True
            with pytest.raises(ValueError, match="revision"):
                await store.save_report(invalid)
            invalid = copy.deepcopy(child)
            invalid.update(id="invalid-parent", parentId="foreign-report", revision=2)
            with pytest.raises(AnalysisConflict):
                await store.save_report(invalid)
        finally:
            await store.close()
            await repository.close()
    asyncio.run(run())


def test_snapshot_production_feature_and_terrain_evidence_binding():
    raw = snapshot()
    raw["features"] = [{"type": "Feature", "id": "way/12", "properties": {"sourceIds": ["garden"]},
        "geometry": {"type": "LineString", "coordinates": [[108, 16], [108.01, 16.01]]}}]
    raw["terrainSamples"] = [{"lon": 108, "lat": 16, "height": 0, "sourceId": "garden"}]
    raw["evidence"].extend([
        {"id": "F1", "kind": "gis", "sourceId": "garden", "version": "v1", "label": "Đường đã cắt", "fieldPath": "features.0", "geometry": raw["features"][0]["geometry"]},
        {"id": "T1", "kind": "gis", "sourceId": "garden", "version": "v1", "label": "Mẫu terrain", "fieldPath": "terrainSamples.0", "value": 0, "unit": "m", "geometry": {"type": "Point", "coordinates": [108, 16]}},
    ])
    assert validate_snapshot(raw)["terrainSamples"][0]["height"] == 0
    for path, altered in (("feature_geometry", {"type": "Point", "coordinates": [108, 16]}), ("terrain_geometry", {"type": "Point", "coordinates": [108.1, 16]}), ("terrain_value", 5), ("terrain_unit", "km")):
        changed = copy.deepcopy(raw)
        if path == "feature_geometry":
            changed["evidence"][-2]["geometry"] = altered
        else:
            key = {"terrain_geometry": "geometry", "terrain_value": "value", "terrain_unit": "unit"}[path]
            changed["evidence"][-1][key] = altered
        with pytest.raises(ValueError):
            validate_snapshot(changed)
    missing = copy.deepcopy(raw)
    missing["terrainSamples"][0]["height"] = missing["evidence"][-1]["value"] = None
    assert validate_snapshot(missing)["terrainSamples"][0]["height"] is None


def test_workflow_catalog_matches_analysis_dispatcher_and_diagrams_cannot_change_execution(tmp_path: Path):
    container = asyncio.run(build_container(BackendSettings(data_dir=tmp_path, resource_gpu_mb=0, chat_gpu_mb=0)))
    try:
        with TestClient(create_app(container)) as client:
            ids = set(client.get("/api/v1/analysis/capabilities").json()["workflowIds"])
            catalog = {row["id"]: row for row in client.get("/api/v1/workflows").json()["workflows"]}
            assert ids == {"gis-analysis-v1", "data-quality-v1", "document-qa-v1", "report-summary-v1"}
            assert ids.issubset(catalog)
            for workflow_id in sorted(ids):
                info = catalog[workflow_id]
                assert info["persistence"] == "analysis_sqlite" and info["checkpoint_namespace"] is None
                path = f"/api/v1/workflows/{workflow_id}/diagram"
                diagram = client.get(path).json()["diagram"]
                stages = {node["runtime_stage"] for node in diagram["nodes"]}
                assert {"reading", "measurement", "retrieval", "completed"}.issubset(stages)
                if workflow_id == "data-quality-v1":
                    assert "generation" not in stages
                else:
                    assert {"generation", "validation"}.issubset(stages)
                nodes = copy.deepcopy(diagram["nodes"])
                nodes[0]["label"] = "Tên do người dùng sửa"
                updated = client.put(path, json={"revision": 0, "nodes": nodes})
                assert updated.status_code == 200, updated.text
                changed = copy.deepcopy(updated.json()["diagram"]["nodes"])
                changed[0]["runtime_stage"] = "write-map"
                immutable = client.put(path, json={"revision": 1, "nodes": changed})
                # The existing editor accepts full round-trip nodes but ignores
                # immutable topology fields rather than interpreting them.
                assert immutable.status_code == 200
                assert immutable.json()["diagram"]["nodes"][0]["runtime_stage"] == "reading"
    finally:
        asyncio.run(container.close())


def test_run_metadata_duration_and_revision_are_persisted_before_completion(tmp_path: Path, monkeypatch):
    async def run():
        import vector_ai_backend.storage.analysis_store as module
        repository = SQLiteKnowledgeRepository(tmp_path / "vector_ai.sqlite3")
        store = AnalysisStore(repository.path)
        try:
            clock = iter(["2026-10-06T10:00:00Z", "2026-10-06T10:00:00Z", "2026-10-06T10:00:02Z", "2026-10-06T10:00:04.250Z"])
            monkeypatch.setattr(module, "now", lambda: next(clock))
            request = ChatRequest("test:tag", (ChatMessage("user", "không có nguồn"),), workflow_id="document-qa-v1", run_id="duration-run")
            await store.create_run(request)
            await store.transition(request.run_id, "running")
            assert await store.record_model_revision(request.run_id, "a" * 64)
            assert not await store.record_model_revision(request.run_id, None)
            with pytest.raises(ValueError):
                await store.record_model_revision(request.run_id, "a" * 257)
            result = {"schemaVersion": 1, "runId": request.run_id, "snapshotId": None, "workflowId": request.workflow_id,
                "createdAt": "2026-10-06T10:00:04Z", "status": "insufficient", "answer": "Chưa đủ nguồn", "citations": [],
                "missingData": ["Thiếu nguồn"], "warnings": [], "draftAnnotations": [], "validation": {"valid": True, "issues": []}, "model": request.model, "usage": {}}
            await store.complete(request.run_id, result)
            persisted = await store.get_run(request.run_id)
            assert persisted["updatedAt"] == "2026-10-06T10:00:04.250Z"
            assert persisted["durationSeconds"] == 4.25
            assert persisted["metadata"]["modelDigest"] == "a" * 64
            assert persisted["result"]["usage"] == {"durationSeconds": 4.25, "workflowVersion": 1, "validatorVersion": 1, "modelDigest": "a" * 64}
            assert result["usage"] == persisted["result"]["usage"]
            assert not await store.record_model_revision(request.run_id, "b" * 64)
            assert (await store.get_run(request.run_id))["metadata"]["modelDigest"] == "a" * 64
        finally:
            await store.close()
            await repository.close()
    asyncio.run(run())


def test_model_revision_reads_exact_tags_without_download_cache_or_failure():
    async def run():
        replies = [
            {"models": [{"name": "other:tag", "digest": "f" * 64}, {"name": "test:tag", "digest": "a" * 64}]},
            {"models": [{"model": "test:tag", "digest": "b" * 64}]},
            {"models": [{"name": "test:latest", "digest": "c" * 64}]},
            {"models": [{"name": "test:tag", "digest": "bad-digest"}]},
            None,
        ]
        async def serve(request):
            assert request.method == "GET" and str(request.url) == "http://127.0.0.1:11434/api/tags"
            assert request.extensions["timeout"]["read"] == 3.0
            payload = replies.pop(0)
            return httpx.Response(503) if payload is None else httpx.Response(200, json=payload)
        client = OllamaClient("http://127.0.0.1:11434", transport=httpx.MockTransport(serve))
        try:
            assert await client.model_revision("test:tag") == "a" * 64
            assert await client.model_revision("test:tag") == "b" * 64
            for model in ("test", "test:tag", "test:tag"):
                assert await client.model_revision(model) is None
        finally:
            await client.close()
    asyncio.run(run())


def test_evidence_v2_migration_backfills_without_changing_json_and_backup(tmp_path: Path):
    async def run():
        repository = SQLiteKnowledgeRepository(tmp_path / "vector_ai.sqlite3")
        store = AnalysisStore(repository.path)
        raw = await store.save_snapshot(snapshot())
        request = ChatRequest("fake", (ChatMessage("user", "vùng"),), workflow_id="gis-analysis-v1", snapshot_id=raw["id"], run_id="migrated-run")
        await store.create_run(request)
        result = {"schemaVersion": 1, "runId": request.run_id, "snapshotId": raw["id"], "workflowId": request.workflow_id, "createdAt": raw["createdAt"],
            "status": "complete", "answer": "Cao độ mẫu: 0 m. [E1]", "citations": raw["evidence"][:1], "missingData": [], "warnings": [], "draftAnnotations": [],
            "validation": {"valid": True, "issues": []}, "model": "fake", "usage": {}}
        await store.complete(request.run_id, result)
        await store.close()
        # Emulate an actual v1 DB: the original JSON/result/history are the
        # source of truth; evidence table did not exist yet.
        connection = sqlite3.connect(repository.path)
        connection.execute("DROP TABLE analysis_evidence")
        connection.execute("UPDATE analysis_metadata SET value='1' WHERE key='schema_version'")
        before = connection.execute("SELECT payload_json FROM analysis_snapshots WHERE id=?", (raw["id"],)).fetchone()[0]
        before_result = connection.execute("SELECT result_json FROM analysis_runs WHERE id=?", (request.run_id,)).fetchone()[0]
        connection.commit()
        connection.close()
        store = AnalysisStore(repository.path)
        try:
            rows = store._connection.execute("SELECT owner_type,owner_id,ref_id,source_id,payload_json FROM analysis_evidence ORDER BY owner_type,ref_id").fetchall()
            assert len(rows) == 3
            assert {(row["owner_type"], row["owner_id"], row["ref_id"]) for row in rows} == {
                ("snapshot", raw["id"], "E1"), ("snapshot", raw["id"], "E2"), ("run", request.run_id, "E1")}
            assert all(row["source_id"] == "garden" for row in rows)
            assert json.loads(rows[0]["payload_json"]) == raw["evidence"][0]
            assert store._connection.execute("SELECT payload_json FROM analysis_snapshots WHERE id=?", (raw["id"],)).fetchone()[0] == before
            assert store._connection.execute("SELECT result_json FROM analysis_runs WHERE id=?", (request.run_id,)).fetchone()[0] == before_result
            assert store._connection.execute("SELECT value FROM analysis_metadata WHERE key='schema_version'").fetchone()[0] == "2"
            await repository.backup_to(tmp_path / "backup-v2.sqlite3")
            backup = sqlite3.connect(tmp_path / "backup-v2.sqlite3")
            assert backup.execute("SELECT COUNT(*) FROM analysis_evidence").fetchone()[0] == 3
            backup.close()
            migration_backups = list((tmp_path / "backups" / "analysis-migrations").glob("before-v2-*.sqlite3"))
            assert len(migration_backups) == 2
            source = sqlite3.connect(migration_backups[-1])
            assert source.execute("SELECT value FROM analysis_metadata WHERE key='schema_version'").fetchone()[0] == "1"
            source.close()
            await store.close()
            store = AnalysisStore(repository.path)
            assert store._connection.execute("SELECT COUNT(*) FROM analysis_evidence").fetchone()[0] == 3
            assert (await store.get_run(request.run_id))["result"] == result
        finally:
            await store.close()
            await repository.close()
    asyncio.run(run())


def test_evidence_migration_failure_rolls_back_schema_and_keeps_original_json(tmp_path: Path, monkeypatch):
    async def run():
        repository = SQLiteKnowledgeRepository(tmp_path / "vector_ai.sqlite3")
        store = AnalysisStore(repository.path)
        try:
            raw = await store.save_snapshot(snapshot())
        finally:
            await store.close()
        connection = sqlite3.connect(repository.path)
        connection.execute("DROP TABLE analysis_evidence")
        connection.execute("UPDATE analysis_metadata SET value='1' WHERE key='schema_version'")
        original = connection.execute("SELECT payload_json FROM analysis_snapshots WHERE id=?", (raw["id"],)).fetchone()[0]
        connection.commit()
        connection.close()
        with monkeypatch.context() as patch:
            def fail(*args, **kwargs):
                raise RuntimeError("Injected backfill failure")
            patch.setattr(AnalysisStore, "_save_evidence_sync", fail)
            with pytest.raises(RuntimeError, match="backfill failure"):
                AnalysisStore(repository.path)
        connection = sqlite3.connect(repository.path)
        assert connection.execute("SELECT value FROM analysis_metadata WHERE key='schema_version'").fetchone()[0] == "1"
        assert not connection.execute("SELECT name FROM sqlite_master WHERE name='analysis_evidence'").fetchone()
        assert connection.execute("SELECT payload_json FROM analysis_snapshots WHERE id=?", (raw["id"],)).fetchone()[0] == original
        connection.close()
        recovered = AnalysisStore(repository.path)
        try:
            assert recovered._connection.execute("SELECT COUNT(*) FROM analysis_evidence").fetchone()[0] == 2
            assert await recovered.get_snapshot(raw["id"]) == raw
        finally:
            await recovered.close()
            await repository.close()
    asyncio.run(run())


def source_bound_report():
    raw = validate_snapshot(snapshot())
    return {"schemaVersion": 1, "id": "foreign-source-report", "revision": 1, "title": "Báo cáo nguồn",
        "createdAt": raw["createdAt"], "updatedAt": raw["createdAt"], "snapshot": raw,
        "result": {"schemaVersion": 1, "runId": "foreign-source-run", "snapshotId": raw["id"], "workflowId": "gis-analysis-v1",
            "createdAt": raw["createdAt"], "status": "complete", "answer": "Cao độ mẫu: 0 m. [E1]", "citations": copy.deepcopy(raw["evidence"][:1]),
            "missingData": [], "warnings": [], "draftAnnotations": [], "validation": {"valid": True, "issues": []}, "model": "fake", "usage": {}},
        "notes": "", "annotations": []}


def test_portable_report_binds_exact_gis_source_fields_and_rejects_forgery():
    report = source_bound_report()
    assert validate_report_sources(report)["result"]["citations"][0]["value"] == 0
    for field, forged in (("id", "not-present"), ("value", 999), ("value", False), ("sourceId", "wrong-source"), ("unit", "km"), ("version", "v3"), ("label", "Khoảng cách"), ("fieldPath", "measurements.other"),
        ("geometry", {"type": "Point", "coordinates": [108, 16]}), ("excerpt", "thêm thông tin không có nguồn")):
        changed = copy.deepcopy(report)
        changed["result"]["citations"][0][field] = forged
        with pytest.raises(ValueError):
            validate_report_sources(changed)


def test_portable_report_namespaced_gis_sources_survive_without_main_snapshot():
    report = source_bound_report()
    original = report["snapshot"]
    report["snapshot"] = None
    report["result"].update(snapshotId=None, workflowId="report-summary-v1", sourceSnapshots=[original])
    ref = report["result"]["citations"][0]
    ref.update(id="report:archived:E1", snapshotId=original["id"], originEvidenceId="E1")
    validated = validate_report_sources(report)
    assert validated["result"]["sourceSnapshots"][0]["contentHash"] == original["contentHash"]
    for field, forged in (("snapshotId", "unknown-snapshot"), ("originEvidenceId", "not-present"), ("value", 999), ("geometry", {"type": "Point", "coordinates": [109, 17]})):
        changed = copy.deepcopy(report)
        changed["result"]["citations"][0][field] = forged
        with pytest.raises(ValueError):
            validate_report_sources(changed)
    for field in ("snapshotId", "originEvidenceId"):
        changed = copy.deepcopy(report)
        changed["result"]["citations"][0].pop(field)
        with pytest.raises(ValueError):
            validate_report_sources(changed)
    changed = copy.deepcopy(report)
    changed["result"]["sourceSnapshots"] *= 33
    with pytest.raises(ValueError, match="32"):
        validate_report_sources(changed)


def test_portable_document_sources_require_usable_excerpt_and_document_identity():
    report = source_bound_report()
    report["snapshot"] = None
    report["result"].update(snapshotId=None, workflowId="document-qa-v1", citations=[{
        "id": "doc:chunk-7", "kind": "document", "sourceId": "document-3", "documentId": "document-3", "chunkId": "chunk-7", "label": "Sổ vườn", "version": "1", "excerpt": "Vườn có hoa tím."}])
    assert validate_report_sources(report)["result"]["citations"][0]["chunkId"] == "chunk-7"
    for field, forged in (("excerpt", ""), ("chunkId", ""), ("documentId", "different"), ("sourceId", "different")):
        changed = copy.deepcopy(report)
        changed["result"]["citations"][0][field] = forged
        with pytest.raises(ValueError):
            validate_report_sources(changed)


def test_foreign_report_save_applies_source_binding_and_persists_original_snapshots(tmp_path: Path):
    async def run():
        repository = SQLiteKnowledgeRepository(tmp_path / "vector_ai.sqlite3")
        store = AnalysisStore(repository.path)
        try:
            report = source_bound_report()
            forged = copy.deepcopy(report)
            forged["result"]["citations"][0]["value"] = 999
            with pytest.raises(ValueError):
                await store.save_report(forged)
            original = report["snapshot"]
            report["snapshot"] = None
            report["result"].update(snapshotId=None, workflowId="report-summary-v1", sourceSnapshots=[original])
            report["result"]["citations"][0].update(id="report:archived:E1", snapshotId=original["id"], originEvidenceId="E1")
            saved = await store.save_report(report)
            assert saved["result"]["citations"][0]["originEvidenceId"] == "E1"
            assert await store.get_snapshot(original["id"]) == original
            assert store._connection.execute("SELECT COUNT(*) FROM analysis_evidence WHERE owner_type='snapshot' AND owner_id=?", (original["id"],)).fetchone()[0] == 2
        finally:
            await store.close()
            await repository.close()
    asyncio.run(run())


def test_draft_annotations_keep_their_own_citations_even_when_answer_uses_another_source():
    payload = claim()
    payload["annotationEvidenceIds"] = ["E2"]
    answer, citations, issues, annotations = validated_answer(payload, snapshot()["evidence"])
    assert not issues and "0 m" in answer
    assert {ref["id"] for ref in citations} == {"E1", "E2"}
    assert annotations[0]["evidenceIds"] == ["E2"]


def test_history_reads_metadata_without_bulk_result_or_source_snapshot_replay(tmp_path: Path):
    async def run():
        repository = SQLiteKnowledgeRepository(tmp_path / "vector_ai.sqlite3")
        store = AnalysisStore(repository.path)
        try:
            saved = await store.save_snapshot(snapshot())
            request = ChatRequest("fake", (ChatMessage("user", "vùng"),), workflow_id="gis-analysis-v1", snapshot_id=saved["id"], run_id="history-large")
            await store.create_run(request)
            result = source_bound_report()["result"]
            result.update(runId=request.run_id, answer="x" * (128 * 1024), sourceSnapshots=[saved])
            await store.complete(request.run_id, result)
            queries = []
            store._connection.set_trace_callback(queries.append)
            history = await store.history()
            store._connection.set_trace_callback(None)
            assert len(history) == 1 and history[0]["runId"] == request.run_id
            assert history[0]["status"] == "completed" and history[0]["result"] is None
            assert history[0]["metadata"]["model"] == "fake"
            assert len(json.dumps(history)) < 2048
            assert all("result_json" not in sql.lower() and "select *" not in sql.lower() for sql in queries)
            recovered = await store.get_run(request.run_id)
            assert recovered["result"] == result and recovered["result"]["sourceSnapshots"] == [saved]
        finally:
            await store.close()
            await repository.close()
    asyncio.run(run())
