import "./workflow-graph-editor.css";

const GRAPH_WIDTH = 1000;
const GRAPH_HEIGHT = 570;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clone = (value) => structuredClone(value);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

const TYPE_LABELS = {
  start: "Điểm bắt đầu",
  process: "Bước xử lý",
  decision: "Điều kiện",
  end: "Điểm kết thúc",
};

const editableSnapshot = (diagram) => JSON.stringify(diagram.nodes.map(({ id, label, description, x, y }) => ({
  id, label, description, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10,
})));

function boundaryPoint(from, to) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  if (!deltaX && !deltaY) return { x: from.x, y: from.y };
  const halfWidth = from.kind === "decision" ? 58 : from.kind === "start" || from.kind === "end" ? 68 : 76;
  const halfHeight = from.kind === "decision" ? 47 : 33;
  const factor = Math.min(0.48, 1 / Math.max(Math.abs(deltaX) / halfWidth, Math.abs(deltaY) / halfHeight));
  return { x: from.x + deltaX * factor, y: from.y + deltaY * factor };
}

function edgePath(source, target) {
  const start = boundaryPoint(source, target);
  const end = boundaryPoint(target, source);
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    const bend = deltaX * 0.48;
    return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
  }
  const bend = deltaY * 0.48;
  return `M ${start.x} ${start.y} C ${start.x} ${start.y + bend}, ${end.x} ${end.y - bend}, ${end.x} ${end.y}`;
}

export function createWorkflowGraphEditor({ request, notify, confirmAction }) {
  let host = null;
  let diagram = null;
  let catalog = [];
  let selectedId = null;
  let savedSnapshot = "";
  let undoStack = [];
  let redoStack = [];
  let drag = null;
  let fieldSnapshot = null;
  let busy = false;
  let loadVersion = 0;
  let discardPromise = null;
  let disposed = false;
  const refs = {};

  const currentNode = () => diagram?.nodes.find((node) => node.id === selectedId) || null;
  const isDirty = () => Boolean(diagram && editableSnapshot(diagram) !== savedSnapshot);
  const invalidNodes = () => diagram?.nodes.filter((node) => !String(node.label ?? "").trim()) || [];

  function setStatus(message = "", kind = "") {
    if (!refs.status) return;
    refs.status.textContent = message;
    refs.status.dataset.kind = kind;
  }

  function syncControls() {
    const dirty = isDirty();
    const invalid = invalidNodes().length > 0;
    if (refs.dirty) {
      refs.dirty.hidden = !dirty;
      refs.dirty.textContent = invalid ? "CẦN SỬA" : "CHƯA LƯU";
      refs.dirty.dataset.invalid = String(invalid);
    }
    if (refs.revision) refs.revision.textContent = diagram ? `REV ${diagram.revision}` : "";
    if (refs.save) {
      refs.save.disabled = busy || !dirty;
      refs.save.title = invalid ? "Mỗi node cần có tên hiển thị" : "Lưu sơ đồ (Ctrl+S)";
    }
    if (refs.undo) refs.undo.disabled = busy || !undoStack.length;
    if (refs.redo) refs.redo.disabled = busy || !redoStack.length;
    if (refs.auto) refs.auto.disabled = busy || !diagram;
    if (refs.reset) refs.reset.disabled = busy || !diagram;
    refs.picker?.querySelectorAll("[data-diagram-id]").forEach((button) => { button.disabled = busy; });
  }

  function remember(before) {
    const after = editableSnapshot(diagram);
    if (before === after) return;
    if (undoStack.at(-1) !== before) undoStack.push(before);
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
    syncControls();
  }

  function restoreSnapshot(raw) {
    const values = new Map(JSON.parse(raw).map((node) => [node.id, node]));
    diagram.nodes.forEach((node) => Object.assign(node, values.get(node.id) || {}));
    renderNodes();
    renderEdges();
    renderInspector();
    syncControls();
  }

  function undo() {
    const previous = undoStack.pop();
    if (!previous) return;
    redoStack.push(editableSnapshot(diagram));
    restoreSnapshot(previous);
    setStatus("Đã hoàn tác thay đổi gần nhất.");
  }

  function redo() {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(editableSnapshot(diagram));
    restoreSnapshot(next);
    setStatus("Đã làm lại thay đổi.");
  }

  function renderPicker() {
    refs.picker.innerHTML = catalog.map((item) => `
      <button type="button" data-diagram-id="${escapeHtml(item.id)}" class="${item.id === diagram?.id ? "active" : ""}" aria-pressed="${item.id === diagram?.id}">
        <span>${escapeHtml(item.name || item.id)}</span><small>${item.node_count || ""} nút</small>
      </button>`).join("");
    refs.picker.querySelectorAll("[data-diagram-id]").forEach((button) => {
      button.onclick = () => void selectWorkflow(button.dataset.diagramId);
    });
  }

  function renderEdges() {
    if (!diagram) return;
    const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
    refs.edges.innerHTML = diagram.edges.map((edge) => {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      if (!source || !target) return "";
      const labelX = (source.x + target.x) / 2;
      const labelY = (source.y + target.y) / 2 - 9;
      return `<g class="workflow-edge"><path d="${edgePath(source, target)}" marker-end="url(#workflow-arrow)"/>${edge.label ? `<text x="${labelX}" y="${labelY}">${escapeHtml(edge.label)}</text>` : ""}</g>`;
    }).join("");
  }

  function setSelected(nodeId, { focus = false } = {}) {
    selectedId = nodeId;
    refs.nodes.querySelectorAll("[data-node-id]").forEach((element) => {
      const selected = element.dataset.nodeId === nodeId;
      element.classList.toggle("selected", selected);
      element.setAttribute("aria-pressed", String(selected));
    });
    renderInspector();
    if (focus) refs.nodes.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`)?.focus();
  }

  function beginDrag(event, node, element) {
    if (busy || event.button !== 0) return;
    event.preventDefault();
    setSelected(node.id);
    drag = {
      pointerId: event.pointerId,
      node,
      element,
      before: editableSnapshot(diagram),
      startClientX: event.clientX,
      startClientY: event.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
      moved: false,
    };
    element.setPointerCapture(event.pointerId);
    element.classList.add("dragging");
  }

  function moveDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = refs.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = clamp(drag.startNodeX + ((event.clientX - drag.startClientX) / bounds.width) * GRAPH_WIDTH, 72, GRAPH_WIDTH - 72);
    const y = clamp(drag.startNodeY + ((event.clientY - drag.startClientY) / bounds.height) * GRAPH_HEIGHT, 48, GRAPH_HEIGHT - 48);
    if (Math.abs(x - drag.node.x) + Math.abs(y - drag.node.y) < 0.2) return;
    drag.node.x = x;
    drag.node.y = y;
    drag.moved = true;
    drag.element.style.left = `${(x / GRAPH_WIDTH) * 100}%`;
    drag.element.style.top = `${(y / GRAPH_HEIGHT) * 100}%`;
    renderEdges();
    syncControls();
  }

  function endDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.element.classList.remove("dragging");
    if (drag.element.hasPointerCapture(event.pointerId)) drag.element.releasePointerCapture(event.pointerId);
    if (drag.moved) {
      remember(drag.before);
      renderInspector();
      setStatus("Đã đổi vị trí. Bấm Lưu sơ đồ để ghi lại.", "dirty");
    }
    drag = null;
  }

  function moveSelectedByKeyboard(event, node) {
    const directions = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    if (busy || !directions[event.key]) return false;
    event.preventDefault();
    const before = editableSnapshot(diagram);
    const distance = event.shiftKey ? 30 : 10;
    node.x = clamp(node.x + directions[event.key][0] * distance, 72, GRAPH_WIDTH - 72);
    node.y = clamp(node.y + directions[event.key][1] * distance, 48, GRAPH_HEIGHT - 48);
    remember(before);
    renderNodes();
    renderEdges();
    setSelected(node.id, { focus: true });
    setStatus("Đã di chuyển node bằng bàn phím.", "dirty");
    return true;
  }

  function renderNodes() {
    if (!diagram) return;
    refs.nodes.innerHTML = diagram.nodes.map((node) => {
      const invalid = !String(node.label ?? "").trim();
      return `
      <button type="button" class="workflow-node workflow-node-${escapeHtml(node.kind)} ${node.id === selectedId ? "selected" : ""} ${invalid ? "invalid" : ""}"
        data-node-id="${escapeHtml(node.id)}" aria-pressed="${node.id === selectedId}"
        aria-label="${escapeHtml(invalid ? "Node chưa có tên" : node.label)}. ${escapeHtml(TYPE_LABELS[node.kind] || node.kind)}"
        style="left:${(node.x / GRAPH_WIDTH) * 100}%;top:${(node.y / GRAPH_HEIGHT) * 100}%">
        <span class="workflow-node-shape"><i></i><b class="workflow-node-label">${escapeHtml(invalid ? "Chưa đặt tên" : node.label)}</b><small>${escapeHtml(node.runtime_stage || TYPE_LABELS[node.kind] || node.kind)}</small></span>
      </button>`;
    }).join("");
    refs.nodes.querySelectorAll("[data-node-id]").forEach((element) => {
      const node = diagram.nodes.find((item) => item.id === element.dataset.nodeId);
      element.onpointerdown = (event) => beginDrag(event, node, element);
      element.onpointermove = moveDrag;
      element.onpointerup = endDrag;
      element.onpointercancel = endDrag;
      element.onclick = () => setSelected(node.id);
      element.onkeydown = (event) => moveSelectedByKeyboard(event, node);
    });
  }

  function finishFieldEdit() {
    if (fieldSnapshot) remember(fieldSnapshot);
    fieldSnapshot = null;
  }

  function renderInspector() {
    const node = currentNode();
    refs.inspector.hidden = !node;
    refs.canvas.classList.toggle("has-inspector", Boolean(node));
    if (!node) return;
    refs.inspector.innerHTML = `
      <header><span><small>THUỘC TÍNH NODE</small><b>${escapeHtml(TYPE_LABELS[node.kind] || node.kind)}</b></span><button type="button" data-inspector-close aria-label="Đóng bảng thuộc tính">×</button></header>
      <label><span>Tên hiển thị</span><input data-node-label maxlength="80" required aria-describedby="workflow-node-label-error" value="${escapeHtml(node.label)}"><small class="workflow-field-error" id="workflow-node-label-error" data-label-error hidden>Tên node không được để trống.</small></label>
      <label><span>Mô tả</span><textarea data-node-description maxlength="320" rows="5">${escapeHtml(node.description)}</textarea></label>
      <dl><div><dt>ID hệ thống</dt><dd>${escapeHtml(node.id)}</dd></div><div><dt>Runtime stage</dt><dd>${escapeHtml(node.runtime_stage || "Điểm điều hướng")}</dd></div><div><dt>Vị trí</dt><dd data-node-position>${Math.round(node.x)}, ${Math.round(node.y)}</dd></div></dl>
      <p class="workflow-node-lock"><span>⌾</span> Logic chạy và kết nối hệ thống đang được khóa an toàn.</p>`;
    refs.inspector.querySelector("[data-inspector-close]").onclick = () => setSelected(null);
    const label = refs.inspector.querySelector("[data-node-label]");
    const description = refs.inspector.querySelector("[data-node-description]");
    const labelError = refs.inspector.querySelector("[data-label-error]");
    const beginFieldEdit = () => { fieldSnapshot ||= editableSnapshot(diagram); };
    const syncLabelValidity = () => {
      const invalid = !label.value.trim();
      label.setCustomValidity(invalid ? "Tên node không được để trống." : "");
      label.setAttribute("aria-invalid", String(invalid));
      labelError.hidden = !invalid;
      return !invalid;
    };
    label.onfocus = beginFieldEdit;
    description.onfocus = beginFieldEdit;
    label.oninput = () => {
      node.label = label.value;
      const nodeElement = refs.nodes.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`);
      const valid = syncLabelValidity();
      nodeElement.querySelector(".workflow-node-label").textContent = valid ? label.value : "Chưa đặt tên";
      nodeElement.classList.toggle("invalid", !valid);
      nodeElement.setAttribute("aria-label", `${valid ? label.value : "Node chưa có tên"}. ${TYPE_LABELS[node.kind] || node.kind}`);
      syncControls();
      setStatus(valid ? "Có thay đổi chưa lưu." : "Tên node không được để trống.", valid ? "dirty" : "error");
    };
    description.oninput = () => { node.description = description.value; syncControls(); setStatus("Có thay đổi chưa lưu.", "dirty"); };
    label.onchange = finishFieldEdit;
    description.onchange = finishFieldEdit;
    label.onblur = finishFieldEdit;
    description.onblur = finishFieldEdit;
    syncLabelValidity();
  }

  function validateBeforeSave() {
    const invalid = invalidNodes()[0];
    if (!invalid) return true;
    setSelected(invalid.id);
    const input = refs.inspector.querySelector("[data-node-label]");
    input?.setCustomValidity("Tên node không được để trống.");
    input?.setAttribute("aria-invalid", "true");
    refs.inspector.querySelector("[data-label-error]")?.removeAttribute("hidden");
    setStatus("Không thể lưu: mỗi node cần có tên hiển thị.", "error");
    requestAnimationFrame(() => { input?.focus({ preventScroll: true }); input?.reportValidity(); });
    return false;
  }

  function applyAutoLayout() {
    if (busy || !diagram) return;
    const before = editableSnapshot(diagram);
    const nodeById = new Map(diagram.nodes.map((node) => [node.id, node]));
    const incoming = new Map(diagram.nodes.map((node) => [node.id, 0]));
    const outgoing = new Map(diagram.nodes.map((node) => [node.id, []]));
    diagram.edges.forEach((edge) => {
      if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return;
      incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
      outgoing.get(edge.source).push(edge.target);
    });
    const queue = diagram.nodes.filter((node) => !incoming.get(node.id)).map((node) => node.id);
    const ordered = [];
    while (queue.length) {
      const id = queue.shift();
      if (ordered.includes(id)) continue;
      ordered.push(id);
      outgoing.get(id).forEach((target) => {
        incoming.set(target, incoming.get(target) - 1);
        if (!incoming.get(target)) queue.push(target);
      });
    }
    diagram.nodes.forEach((node) => { if (!ordered.includes(node.id)) ordered.push(node.id); });
    const columns = 5;
    ordered.forEach((id, index) => {
      const row = Math.floor(index / columns);
      const columnInRow = index % columns;
      const column = row % 2 ? columns - 1 - columnInRow : columnInRow;
      const node = nodeById.get(id);
      node.x = 85 + column * 207.5;
      node.y = 105 + row * 205;
    });
    remember(before);
    renderNodes();
    renderEdges();
    renderInspector();
    setStatus("Đã tự sắp xếp. Bấm Lưu sơ đồ để ghi lại.", "dirty");
  }

  async function save() {
    if (busy || !diagram || !isDirty()) return;
    finishFieldEdit();
    if (!validateBeforeSave()) return;
    busy = true;
    syncControls();
    setStatus("Đang lưu sơ đồ…", "working");
    try {
      const result = await request(`/workflows/${encodeURIComponent(diagram.id)}/diagram`, {
        method: "PUT",
        body: {
          revision: diagram.revision,
          nodes: diagram.nodes.map(({ id, label, description, x, y }) => ({ id, label, description, x, y })),
        },
      });
      diagram = clone(result.diagram);
      savedSnapshot = editableSnapshot(diagram);
      undoStack = [];
      redoStack = [];
      renderPicker();
      renderNodes();
      renderEdges();
      renderInspector();
      syncControls();
      setStatus("Đã lưu bố cục và nội dung node.", "success");
      notify?.("Đã lưu sơ đồ workflow");
    } catch (error) {
      setStatus(error.status === 409 ? "Sơ đồ đã được sửa ở cửa sổ khác. Hãy tải lại bản mới." : error.message, "error");
      if (error.status === 409 && await confirmAction({
        title: "Sơ đồ đã thay đổi",
        message: "Một cửa sổ khác đã lưu workflow này. Tải bản mới sẽ bỏ các thay đổi chưa lưu tại đây.",
        acceptLabel: "Tải bản mới",
        danger: false,
      })) await loadDiagram(diagram.id);
    } finally {
      busy = false;
      syncControls();
    }
  }

  async function reset() {
    if (busy || !diagram || !await confirmAction({
      title: "Khôi phục sơ đồ mặc định?",
      message: "Tên, mô tả và vị trí node đã chỉnh sẽ trở về thiết kế mặc định. Logic chạy không bị thay đổi.",
      acceptLabel: "Khôi phục",
      danger: false,
    })) return;
    busy = true;
    syncControls();
    setStatus("Đang khôi phục…", "working");
    try {
      const result = await request(`/workflows/${encodeURIComponent(diagram.id)}/diagram`, {
        method: "DELETE",
        body: { revision: diagram.revision },
      });
      diagram = clone(result.diagram);
      selectedId = null;
      savedSnapshot = editableSnapshot(diagram);
      undoStack = [];
      redoStack = [];
      renderPicker();
      renderNodes();
      renderEdges();
      renderInspector();
      syncControls();
      setStatus("Đã khôi phục sơ đồ mặc định.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      busy = false;
      syncControls();
    }
  }

  function confirmDiscard() {
    if (!isDirty()) return true;
    if (discardPromise) return discardPromise;
    discardPromise = Promise.resolve(confirmAction({
      title: "Bỏ thay đổi chưa lưu?",
      message: "Vị trí hoặc nội dung node vừa chỉnh chưa được lưu vào VECTOR AI.",
      acceptLabel: "Bỏ thay đổi",
    })).finally(() => { discardPromise = null; });
    return discardPromise;
  }

  async function loadDiagram(workflowId) {
    const version = ++loadVersion;
    busy = true;
    syncControls();
    setStatus("Đang tải sơ đồ…", "working");
    try {
      const result = await request(`/workflows/${encodeURIComponent(workflowId)}/diagram`);
      if (disposed || version !== loadVersion) return false;
      diagram = clone(result.diagram);
      selectedId = null;
      fieldSnapshot = null;
      savedSnapshot = editableSnapshot(diagram);
      undoStack = [];
      redoStack = [];
      renderPicker();
      renderNodes();
      renderEdges();
      renderInspector();
      setStatus("Kéo node để đổi bố cục; chọn node để chỉnh tên và mô tả.");
      return true;
    } finally {
      if (version === loadVersion) {
        busy = false;
        syncControls();
      }
    }
  }

  async function selectWorkflow(workflowId) {
    if (busy || workflowId === diagram?.id) return;
    if (!await confirmDiscard()) return;
    if (busy || workflowId === diagram?.id) return;
    try {
      await loadDiagram(workflowId);
    } catch (error) {
      if (!disposed) setStatus(error.message || String(error), "error");
    }
  }

  async function mount(container) {
    host = container;
    host.innerHTML = `<div class="workflow-designer">
      <header class="workflow-designer-toolbar">
        <div class="workflow-diagram-picker" data-picker aria-label="Chọn workflow"></div>
        <div class="workflow-designer-actions">
          <span class="workflow-revision" data-revision></span><span class="workflow-unsaved" data-dirty hidden>CHƯA LƯU</span>
          <button type="button" data-undo title="Hoàn tác (Ctrl+Z)" aria-label="Hoàn tác">↶</button>
          <button type="button" data-redo title="Làm lại (Ctrl+Y)" aria-label="Làm lại">↷</button>
          <button type="button" data-auto>Tự sắp xếp</button>
          <button type="button" data-reset>Khôi phục</button>
          <button type="button" class="workflow-save" data-save>Lưu sơ đồ</button>
        </div>
      </header>
      <div class="workflow-designer-note"><span>⌾</span><p><b>Trình chỉnh sửa an toàn</b><small>Kéo để đổi bố cục; sửa tên và mô tả trong bảng thuộc tính. ID, bước chạy và kết nối hệ thống được khóa.</small></p></div>
      <div class="workflow-canvas-wrap">
        <div class="workflow-graph-canvas" data-canvas role="region" aria-label="Sơ đồ workflow có thể kéo thả" tabindex="0">
          <svg viewBox="0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}" preserveAspectRatio="none" aria-hidden="true">
            <defs><marker id="workflow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>
            <g data-edges></g>
          </svg>
          <div class="workflow-nodes" data-nodes></div>
          <aside class="workflow-node-inspector" data-inspector hidden></aside>
        </div>
      </div>
      <footer class="workflow-designer-status" role="status" aria-live="polite" data-status></footer>
    </div>`;
    Object.assign(refs, {
      picker: host.querySelector("[data-picker]"),
      revision: host.querySelector("[data-revision]"),
      dirty: host.querySelector("[data-dirty]"),
      undo: host.querySelector("[data-undo]"),
      redo: host.querySelector("[data-redo]"),
      auto: host.querySelector("[data-auto]"),
      reset: host.querySelector("[data-reset]"),
      save: host.querySelector("[data-save]"),
      canvas: host.querySelector("[data-canvas]"),
      edges: host.querySelector("[data-edges]"),
      nodes: host.querySelector("[data-nodes]"),
      inspector: host.querySelector("[data-inspector]"),
      status: host.querySelector("[data-status]"),
    });
    refs.undo.onclick = undo;
    refs.redo.onclick = redo;
    refs.auto.onclick = applyAutoLayout;
    refs.reset.onclick = () => void reset();
    refs.save.onclick = () => void save();
    host.onkeydown = (event) => {
      if (event.ctrlKey && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); }
      else if (!event.target.closest("input, textarea, [contenteditable='true']") && event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); }
      else if (!event.target.closest("input, textarea, [contenteditable='true']") && ((event.ctrlKey && event.key.toLowerCase() === "y") || (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "z"))) { event.preventDefault(); redo(); }
      else if (event.key === "Escape" && selectedId) { event.preventDefault(); event.stopPropagation(); setSelected(null); }
    };
    const result = await request("/workflows");
    if (disposed) return;
    catalog = Array.isArray(result.workflows) ? result.workflows : [];
    if (!catalog.length) throw new Error("Python Core chưa cung cấp workflow để hiển thị.");
    await loadDiagram(catalog[0].id);
  }

  return {
    mount,
    hasUnsaved: isDirty,
    confirmDiscard,
    dispose() {
      disposed = true;
      loadVersion++;
      busy = false;
      if (drag?.element?.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
      drag = null;
      if (host) host.onkeydown = null;
    },
  };
}
