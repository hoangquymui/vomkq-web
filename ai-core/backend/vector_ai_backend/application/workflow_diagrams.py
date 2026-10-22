from __future__ import annotations

import math
import re
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any, Mapping, Sequence

from ..domain.models import (
    WorkflowDiagram,
    WorkflowDiagramEdge,
    WorkflowDiagramNode,
    WorkflowNodeKind,
)
from ..domain.ports import WorkflowDiagramStore


_SAFE_WORKFLOW_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$")
_MAX_LABEL = 80
_MAX_DESCRIPTION = 320
_COORDINATE_LIMIT = 2000.0


class WorkflowDiagramNotFound(LookupError):
    pass


class WorkflowDiagramConflict(RuntimeError):
    pass


def _node(
    id: str,
    label: str,
    kind: WorkflowNodeKind,
    x: float,
    y: float,
    description: str,
    runtime_stage: str | None,
) -> WorkflowDiagramNode:
    return WorkflowDiagramNode(
        id=id,
        label=label,
        kind=kind,
        x=x,
        y=y,
        description=description,
        runtime_stage=runtime_stage,
        runtime_locked=True,
    )


def _edge(id: str, source: str, target: str, label: str = "") -> WorkflowDiagramEdge:
    return WorkflowDiagramEdge(id=id, source=source, target=target, label=label)


DEFAULT_WORKFLOW_DIAGRAMS: dict[str, WorkflowDiagram] = {
    "document-ingestion-v1": WorkflowDiagram(
        id="document-ingestion-v1",
        name="Nạp và lập chỉ mục tài liệu",
        description="DocumentIngestionGraph · state và checkpoint độc lập",
        revision=0,
        nodes=(
            _node("input", "Nhận tài liệu", WorkflowNodeKind.START, 80, 95, "Nhận PDF, DOCX, ảnh hoặc văn bản từ phạm vi đã chọn.", None),
            _node("extract", "Trích xuất", WorkflowNodeKind.PROCESS, 260, 95, "Đọc nội dung gốc, cấu trúc trang và công thức có sẵn.", "extract"),
            _node("ocr-gate", "Cần OCR?", WorkflowNodeKind.DECISION, 455, 95, "Xác định trang hoặc vùng ảnh cần OCR ngoại tuyến.", "ocr"),
            _node("ocr", "OCR cục bộ", WorkflowNodeKind.PROCESS, 455, 285, "Nhận dạng văn bản và công thức; chỉ nạp model OCR khi cần.", "ocr"),
            _node("validate", "Kiểm chứng", WorkflowNodeKind.PROCESS, 650, 285, "Tách kiểm tra cú pháp và kiểm tra toán học của FormulaRecord.", "validate"),
            _node("chunk", "Chia đoạn", WorkflowNodeKind.PROCESS, 840, 285, "Giữ công thức nguyên khối và tạo semantic representation.", "chunk"),
            _node("embed", "Embedding", WorkflowNodeKind.PROCESS, 840, 475, "Mã hóa theo EmbeddingProfile và fingerprint của generation.", "embed"),
            _node("index", "Commit chỉ mục", WorkflowNodeKind.PROCESS, 650, 475, "Ghi lexical index và vector generation rồi kích hoạt nguyên tử.", "index"),
            _node("complete", "Hoàn tất", WorkflowNodeKind.END, 455, 475, "Tài liệu sẵn sàng cho retrieval theo đúng scope.", None),
        ),
        edges=(
            _edge("input-extract", "input", "extract"),
            _edge("extract-ocr-gate", "extract", "ocr-gate"),
            _edge("ocr-gate-ocr", "ocr-gate", "ocr", "Có"),
            _edge("ocr-gate-validate", "ocr-gate", "validate", "Không"),
            _edge("ocr-validate", "ocr", "validate"),
            _edge("validate-chunk", "validate", "chunk"),
            _edge("chunk-embed", "chunk", "embed"),
            _edge("embed-index", "embed", "index"),
            _edge("index-complete", "index", "complete"),
        ),
    ),
    "query-reasoning-v1": WorkflowDiagram(
        id="query-reasoning-v1",
        name="Truy xuất và suy luận",
        description="QueryReasoningGraph · ưu tiên chat và có lifecycle riêng",
        revision=0,
        nodes=(
            _node("question", "Câu hỏi", WorkflowNodeKind.START, 80, 95, "Nhận message, model, reasoning profile và nhánh hội thoại.", None),
            _node("scope", "Phạm vi nguồn", WorkflowNodeKind.PROCESS, 255, 95, "Lọc builtin, workspace, chat và trạng thái xác minh.", "retrieve_and_fuse"),
            _node("retrieve", "Lexical + vector", WorkflowNodeKind.PROCESS, 440, 95, "BM25 và dense retrieval, sau đó fusion và dedup.", "retrieve_and_fuse"),
            _node("evidence-gate", "Đủ nguồn?", WorkflowNodeKind.DECISION, 630, 95, "Áp dụng strict-source policy và ngân sách bằng chứng.", "retrieve_and_fuse"),
            _node("missing", "Báo thiếu nguồn", WorkflowNodeKind.PROCESS, 835, 95, "Không tự suy đoán ngoài tài liệu khi chế độ chỉ dùng nguồn được bật.", "budget_and_generate"),
            _node("missing-end", "Kết thúc", WorkflowNodeKind.END, 835, 285, "Trả trạng thái thiếu dữ liệu có cấu trúc.", None),
            _node("budget", "Ghép ngữ cảnh", WorkflowNodeKind.PROCESS, 630, 285, "Phân bổ system, history, evidence, ảnh và phần dự phòng sinh.", "budget_and_generate"),
            _node("generate", "Model + tools", WorkflowNodeKind.PROCESS, 440, 285, "Sinh câu trả lời bằng reasoning profile và ToolPolicy phù hợp.", "budget_and_generate"),
            _node("answer", "Đáp án + nguồn", WorkflowNodeKind.PROCESS, 255, 285, "Chuẩn hóa kết quả, citations, usage và sự kiện hoàn tất.", "budget_and_generate"),
            _node("answer-end", "Hoàn tất", WorkflowNodeKind.END, 80, 285, "Lưu checkpoint và trả kết quả cho transport adapter.", None),
        ),
        edges=(
            _edge("question-scope", "question", "scope"),
            _edge("scope-retrieve", "scope", "retrieve"),
            _edge("retrieve-evidence", "retrieve", "evidence-gate"),
            _edge("evidence-missing", "evidence-gate", "missing", "Không"),
            _edge("missing-end", "missing", "missing-end"),
            _edge("evidence-budget", "evidence-gate", "budget", "Có"),
            _edge("budget-generate", "budget", "generate"),
            _edge("generate-answer", "generate", "answer"),
            _edge("answer-end", "answer", "answer-end"),
        ),
    ),
}


def _analysis_diagram(workflow_id: str, name: str, description: str) -> WorkflowDiagram:
    """Presentation of the actual fixed dispatcher, not executable topology.

    The quality workflow completes deterministically without a model. The
    others can also finish at source retrieval (insufficient evidence) or use
    an exact-measurement lookup instead of generation.
    """
    quality = workflow_id == "data-quality-v1"
    stages = [
        ("reading", "Đọc bản chụp và nguồn", "Đọc đầu vào bất biến; báo cáo cũ chỉ cung cấp evidence gốc, không dùng câu trả lời AI cũ làm nguồn."),
        ("measurement", "Phép đo và trạng thái", "Đọc phép đo có đơn vị, phương pháp và trạng thái thiếu dữ liệu; không suy ra số không từ dữ liệu thiếu."),
        ("retrieval", "Nguồn đã chọn", "Công cụ chỉ đọc có allowlist; tài liệu lọc theo ID đã chọn. Không đủ nguồn thì hoàn tất với trạng thái insufficient, không gọi model."),
    ]
    if not quality:
        stages.extend([
            ("generation", "Diễn giải local có cấu trúc", "Một lượt suy luận foreground; đầu ra JSON theo schema. Tra cứu phép đo chính xác có thể bỏ qua model."),
            ("validation", "Kiểm tra evidence", "Kiểm tra số, đơn vị, chiều so sánh, trích đoạn, citation và hình học nguồn. Đầu ra bị cắt hoặc sai không trở thành kết quả hoàn tất."),
        ])
    stages.append(("completed", "Lưu kết quả và nguồn", "Ghi kết quả bền vững vào analysis_runs trước sự kiện hoàn tất; đọc lại qua API sau refresh, không replay token."))
    nodes = tuple(_node(stage, label,
        WorkflowNodeKind.START if index == 0 else WorkflowNodeKind.END if index == len(stages) - 1 else WorkflowNodeKind.PROCESS,
        80 + index * 220, 95, detail, stage)
        for index, (stage, label, detail) in enumerate(stages))
    edges = tuple(_edge(f"{left.id}-{right.id}", left.id, right.id) for left, right in zip(nodes, nodes[1:]))
    return WorkflowDiagram(id=workflow_id, name=name,
        description=description + " · chỉ đọc · strict sources luôn bật · sơ đồ chỉ chỉnh trình bày",
        revision=0, nodes=nodes, edges=edges)


for _id, _name, _description in (
    ("gis-analysis-v1", "Phân tích GIS có evidence", "Vùng được chọn, phép đo và bản chụp → diễn giải có kiểm chứng"),
    ("data-quality-v1", "Kiểm tra chất lượng dữ liệu", "Finding và manifest → báo cáo xác định bằng code, không gọi model"),
    ("document-qa-v1", "Hỏi đáp tài liệu đã chọn", "Retrieval theo ID tài liệu → trích đoạn nguồn và diễn giải nháp"),
    ("report-summary-v1", "Tóm tắt evidence báo cáo", "Bản chụp gốc theo phiên bản → so sánh có nguồn, không nâng cấp ghi chú thành evidence"),
):
    DEFAULT_WORKFLOW_DIAGRAMS[_id] = _analysis_diagram(_id, _name, _description)


class WorkflowDiagramService:
    """Own editable diagram metadata without making UI topology executable.

    Runtime node identities and edges remain defined by the application. Users may
    safely edit presentation labels/descriptions and coordinates without changing
    the independently checkpointed ingestion/query lifecycles.
    """

    def __init__(self, store: WorkflowDiagramStore) -> None:
        self._store = store

    def _default(self, workflow_id: str) -> WorkflowDiagram:
        if not _SAFE_WORKFLOW_ID.fullmatch(workflow_id) or workflow_id not in DEFAULT_WORKFLOW_DIAGRAMS:
            raise WorkflowDiagramNotFound(workflow_id)
        return DEFAULT_WORKFLOW_DIAGRAMS[workflow_id]

    async def list(self) -> list[WorkflowDiagram]:
        return [await self.get(workflow_id) for workflow_id in DEFAULT_WORKFLOW_DIAGRAMS]

    async def get(self, workflow_id: str) -> WorkflowDiagram:
        default = self._default(workflow_id)
        try:
            saved = await self._store.read_workflow_diagram(workflow_id)
        except (KeyError, TypeError, ValueError):
            saved = None
        return self._reconcile(default, saved) if saved is not None else default

    async def update(
        self,
        workflow_id: str,
        payload: Mapping[str, Any],
        *,
        expected_revision: int,
    ) -> WorkflowDiagram:
        current = await self.get(workflow_id)
        if current.revision != expected_revision:
            raise WorkflowDiagramConflict(
                f"Workflow đã thay đổi (revision hiện tại {current.revision}, yêu cầu {expected_revision})"
            )
        raw_nodes = payload.get("nodes")
        if not isinstance(raw_nodes, Sequence) or isinstance(raw_nodes, (str, bytes)):
            raise ValueError("nodes phải là một danh sách")
        current_by_id = {node.id: node for node in current.nodes}
        raw_by_id: dict[str, Mapping[str, Any]] = {}
        for item in raw_nodes:
            if not isinstance(item, Mapping):
                raise ValueError("Mỗi node phải là object")
            node_id = str(item.get("id", ""))
            if node_id in raw_by_id:
                raise ValueError(f"Node bị lặp: {node_id}")
            raw_by_id[node_id] = item
        if set(raw_by_id) != set(current_by_id):
            raise ValueError("Không được thêm hoặc xóa bước hệ thống trong phiên bản này")

        nodes: list[WorkflowDiagramNode] = []
        for node in current.nodes:
            raw = raw_by_id[node.id]
            label_value = raw.get("label", node.label)
            description_value = raw.get("description", node.description)
            if not isinstance(label_value, str) or not isinstance(description_value, str):
                raise ValueError(f"Tên và mô tả node {node.id} phải là chuỗi")
            label = label_value.strip()
            description = description_value.strip()
            if not label or len(label) > _MAX_LABEL:
                raise ValueError(f"Tên node {node.id} phải dài 1–{_MAX_LABEL} ký tự")
            if len(description) > _MAX_DESCRIPTION:
                raise ValueError(f"Mô tả node {node.id} vượt {_MAX_DESCRIPTION} ký tự")
            try:
                x_value = raw.get("x", node.x)
                y_value = raw.get("y", node.y)
                if isinstance(x_value, bool) or isinstance(y_value, bool):
                    raise ValueError
                x = float(x_value)
                y = float(y_value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Tọa độ node {node.id} không hợp lệ") from exc
            if not math.isfinite(x) or not math.isfinite(y) or not (0 <= x <= _COORDINATE_LIMIT and 0 <= y <= _COORDINATE_LIMIT):
                raise ValueError(f"Tọa độ node {node.id} nằm ngoài phạm vi cho phép")
            nodes.append(replace(node, label=label, description=description, x=x, y=y))

        updated = replace(
            current,
            revision=current.revision + 1,
            nodes=tuple(nodes),
            updated_at=datetime.now(UTC),
        )
        if not await self._store.write_workflow_diagram(updated, expected_revision=expected_revision):
            raise WorkflowDiagramConflict("Workflow vừa được chỉnh sửa ở một cửa sổ khác")
        return updated

    async def reset(self, workflow_id: str, *, expected_revision: int | None = None) -> WorkflowDiagram:
        current = await self.get(workflow_id)
        if expected_revision is not None and current.revision != expected_revision:
            raise WorkflowDiagramConflict("Workflow vừa được chỉnh sửa ở một cửa sổ khác")
        reset = replace(
            self._default(workflow_id),
            revision=current.revision + 1,
            updated_at=datetime.now(UTC),
        )
        if not await self._store.write_workflow_diagram(
            reset,
            expected_revision=current.revision,
        ):
            raise WorkflowDiagramConflict("Không thể khôi phục vì revision đã thay đổi")
        return reset

    @staticmethod
    def _reconcile(default: WorkflowDiagram, saved: WorkflowDiagram) -> WorkflowDiagram:
        saved_by_id = {node.id: node for node in saved.nodes}
        def merge_node(node: WorkflowDiagramNode) -> WorkflowDiagramNode:
            candidate = saved_by_id.get(node.id)
            if candidate is None:
                return node
            label = candidate.label.strip()
            description = candidate.description.strip()
            coordinates_valid = (
                math.isfinite(candidate.x)
                and math.isfinite(candidate.y)
                and 0 <= candidate.x <= _COORDINATE_LIMIT
                and 0 <= candidate.y <= _COORDINATE_LIMIT
            )
            return replace(
                node,
                label=label if 0 < len(label) <= _MAX_LABEL else node.label,
                description=description if len(description) <= _MAX_DESCRIPTION else node.description,
                x=candidate.x if coordinates_valid else node.x,
                y=candidate.y if coordinates_valid else node.y,
            )
        nodes = tuple(
            merge_node(node)
            for node in default.nodes
        )
        return replace(
            default,
            revision=max(0, saved.revision),
            nodes=nodes,
            updated_at=saved.updated_at,
        )
