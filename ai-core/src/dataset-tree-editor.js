import "./dataset-tree-editor.css";
import { renderKnowledge } from "./knowledge-content.js";
import { openKnowledgeContent } from "./knowledge-content-editor.js";
import { openKnowledgeStorage } from "./knowledge-storage.js";
import { DATASET_KINDS, NODE_WIDTH, NODE_HEIGHT, childrenMap, descendants, canReparent, reparent, removeGrouping, treeLayout, knowledgeProjection, knowledgeNodeId, knowledgeFolderNodeId, catalogFolderDescendants, moveCatalogFolder, moveCatalogDocument, removeCatalogFolder } from "./dataset-tree-model.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clone = (value) => structuredClone(value);

export function createDatasetTreeEditor({ request, notify, confirmAction, onCreateDocument, onIngestionStarted }) {
  let host, el, tree, documents = [], selectedId = "root", savedNodes = "", busy = false, disposed = false;
  let undo = [], redo = [], zoom = 1, layout, sourceSequence = 0, loadSequence = 0, drag = null, suppressClick = false;
  let resizeObserver, toolsObserver, lastSize = null, lastEdit = null;
  let catalog = { revision: 0, folders: [], documents: [] }, savedCatalog = JSON.stringify({ folders: [], documents: [] }), catalogUndo = [], catalogRedo = [], lastCatalogEdit = null;
  let knowledgeSelected = true, selectedFolderId = null;
  let contextMenu = null, contextReturnFocus = null, fullscreen = false, storage = null;
  let historyTarget = "catalog";
  const controller = new AbortController();
  const call = (path, options = {}) => request(path, { ...options, signal: controller.signal });
  const $ = (s) => el?.querySelector(s);
  const current = () => knowledgeSelected || selectedFolderId ? null : tree?.nodes.find((n) => n.id === selectedId);
  const selectedFolder = () => catalog.folders.find((folder) => folder.id === selectedFolderId) || null;
  const catalogView = () => knowledgeSelected || !!selectedFolderId || !tree;
  const catalogHistory = () => catalogView() || historyTarget === "catalog";
  const selectedViewId = () => knowledgeSelected ? "root" : selectedFolderId ? knowledgeFolderNodeId(selectedFolderId) : !tree ? "root" : knowledgeNodeId(tree.document_id, tree.document_version, selectedId);
  const treeDirty = () => !!tree && JSON.stringify(tree.nodes) !== savedNodes;
  const catalogSnapshot = () => JSON.stringify({ folders: catalog.folders, documents: catalog.documents });
  const catalogDirty = () => catalogSnapshot() !== savedCatalog;
  const dirty = () => treeDirty() || catalogDirty();
  const address = () => `/documents/${encodeURIComponent(tree.document_id)}/tree`;
  const status = (text, error = false) => { if (!disposed && $("[data-tree-status]")) { $("[data-tree-status]").textContent = text; $("[data-tree-status]").classList.toggle("error", error); } };
  const safe = (fn) => async (...args) => { try { await fn(...args); } catch (e) { if (!disposed) status(e.message || String(e), true); } };

  async function confirmDiscard() {
    if (busy) { status("Đợi lưu hoặc tải cây xong trước khi rời màn hình."); return false; }
    return !dirty() || await confirmAction({ title: "Bỏ thay đổi sơ đồ dataset?", message: "Các mục chưa lưu sẽ bị bỏ. Nội dung tài liệu gốc không bị ảnh hưởng.", confirmLabel: "Bỏ thay đổi" });
  }

  async function confirmTreeDiscard() {
    if (!treeDirty()) return true;
    return await confirmAction({ title: "Bỏ thay đổi trong tài liệu?", message: "Các mục chưa lưu trong tài liệu sẽ bị bỏ. Thư mục của Kho Kiến Thức vẫn được giữ.", confirmLabel: "Bỏ thay đổi" });
  }

  function updateTools() {
    if (disposed) return;
    $("[data-save]").disabled = busy || !dirty();
    $("[data-undo]").disabled = busy || !(catalogHistory() ? catalogUndo.length : undo.length);
    $("[data-redo]").disabled = busy || !(catalogHistory() ? catalogRedo.length : redo.length);
    $("[data-revision]").textContent = catalogView()
      ? `${catalogDirty() ? "Chưa lưu · " : ""}KHO REV ${catalog.revision}`
      : `${treeDirty() ? "Chưa lưu · " : ""}REV ${tree?.revision ?? 0}`;
    $("[data-doc]").disabled = busy;
    $("[data-tree-body]").inert = busy;
    $("[data-focus-save]").disabled = busy || !dirty();
    $("[data-focus-undo]").disabled = $("[data-undo]").disabled;
    $("[data-focus-redo]").disabled = $("[data-redo]").disabled;
    el.setAttribute("aria-busy", String(busy));
  }

  function commit(fn) {
    if (!tree || busy) return;
    remember(); lastEdit = null; redo = [];
    fn(); draw(); inspector(); updateTools();
  }

  function rememberCatalog() {
    historyTarget = "catalog";
    catalogUndo.push(clone({ folders: catalog.folders, documents: catalog.documents, selectedFolderId, knowledgeSelected }));
    while (catalogUndo.length > 1 && (catalogUndo.length > 25 || JSON.stringify(catalogUndo).length > 2_000_000)) catalogUndo.shift();
  }

  function commitCatalog(fn) {
    if (busy) return;
    rememberCatalog(); lastCatalogEdit = null; catalogRedo = [];
    fn(); draw(); inspector(); updateTools();
  }

  function remember() {
    historyTarget = "tree";
    undo.push({nodes:clone(tree.nodes), selectedId});
    // Large datasets should not retain dozens of full snapshots per keystroke.
    while (undo.length > 1 && (undo.length > 25 || JSON.stringify(undo).length > 4_000_000)) undo.shift();
  }

  function centerSelected() {
    if (disposed || !layout) return;
    const n = layout.nodes.find((n) => n.id === selectedViewId()), view = $("[data-viewport]");
    if (n && view) view.scrollTo({ left: Math.max(0, (n.x + NODE_WIDTH / 2) * zoom - view.clientWidth / 2), top: Math.max(0, (n.y + NODE_HEIGHT / 2) * zoom - view.clientHeight / 2), behavior: "auto" });
  }

  function fitTree() {
    const view = $("[data-viewport]");
    zoom = Math.max(.4, Math.min(1, (view.clientWidth - 12) / layout.width, (view.clientHeight - 12) / layout.height));
    draw(); view.scrollTo({left:0, top:0, behavior:"auto"});
  }

  function draw() {
    if (disposed) return;
    layout = treeLayout(knowledgeProjection(documents, tree, catalog));
    $("[data-sizer]").style.width = `${layout.width * zoom}px`;
    $("[data-sizer]").style.height = `${layout.height * zoom}px`;
    const stage = $("[data-stage]");
    stage.style.width = `${layout.width}px`; stage.style.height = `${layout.height}px`; stage.style.transform = `scale(${zoom})`;
    stage.innerHTML = `<svg class="dataset-links" width="${layout.width}" height="${layout.height}" aria-hidden="true">${layout.edges.map(({ from, to }) => {
      const x = from.x + NODE_WIDTH, y = from.y + NODE_HEIGHT / 2, tx = to.x, ty = to.y + NODE_HEIGHT / 2;
      return `<path d="M${x} ${y} C${x + 36} ${y},${tx - 36} ${ty},${tx} ${ty}" fill="none" stroke="rgba(115,205,180,.38)" stroke-width="1.5"/><circle cx="${tx}" cy="${ty}" r="3" fill="#72d9b8"/>`;
    }).join("")}</svg>${layout.nodes.map((n) => `<article class="dataset-node ${n.id === selectedViewId() ? "selected" : ""}" data-node="${esc(n.id)}" ${n.localId ? `data-local-node="${esc(n.localId)}"` : ""} ${n.catalogFolderId ? `data-catalog-folder="${esc(n.catalogFolderId)}"` : ""} data-kind="${esc(n.kind)}" style="left:${n.x}px;top:${n.y}px" role="group" aria-label="${esc(n.title)}">
      <button class="dataset-node-select" ${n.kind === "knowledge" ? "data-knowledge" : n.catalogFolderId ? `data-folder="${esc(n.catalogFolderId)}"` : n.localId ? `data-select="${esc(n.localId)}"` : `data-open-doc="${n.documentIndex}"`} title="${esc(n.title)}" aria-pressed="${n.id === selectedViewId()}"><small>${esc(DATASET_KINDS[n.kind])}${n.chunk_id ? " · NGUỒN" : ""}${n.kind === "document" ? ` · v${n.documentVersion}${n.enabled ? "" : " · đang tắt"}` : ""}</small><strong>${esc(n.title)}</strong></button>
      ${n.catalogFolderId ? `<button class="dataset-drag" data-drag-folder="${esc(n.catalogFolderId)}" title="Kéo thư mục vào thư mục khác" aria-label="Kéo thư mục ${esc(n.title)}">⠿</button>` : n.kind === "document" ? `<button class="dataset-drag" data-drag-document="${n.documentIndex}" title="Kéo tài liệu vào thư mục" aria-label="Kéo tài liệu ${esc(n.title)}">⠿</button>` : n.localId && n.localId !== "root" ? `<button class="dataset-drag" data-drag="${esc(n.localId)}" title="Kéo thả vào mục khác trong tài liệu để đổi mục cha" aria-label="Kéo ${esc(n.title)}">⠿</button>` : ""}
      ${n.catalogFolderId && n.childCount ? `<button class="dataset-fold" data-fold-folder="${esc(n.catalogFolderId)}" aria-expanded="${!n.collapsed}" title="${n.collapsed ? "Mở" : "Thu gọn"} ${n.childCount} mục con">${n.collapsed ? "+" : "−"}<span>${n.childCount}</span></button>` : n.localId && n.childCount ? `<button class="dataset-fold" data-fold="${esc(n.localId)}" aria-expanded="${!n.collapsed}" title="${n.collapsed ? "Mở" : "Thu gọn"} ${n.childCount} mục con">${n.collapsed ? "+" : "−"}<span>${n.childCount}</span></button>` : n.unloaded ? `<button class="dataset-fold" data-open-doc="${n.documentIndex}" title="Mở cây tài liệu" aria-label="Mở ${esc(n.title)}">＋</button>` : ""}</article>`).join("")}`;
    $("[data-zoom-value]").textContent = `${Math.round(zoom * 100)}%`;
    $("[data-count]").textContent = `${catalog.folders.length} thư mục · ${documents.length} tài liệu · ${layout.nodes.length} nút đang hiển thị`;
  }

  function focusNode(id, center = true) {
    if (!tree) return;
    historyTarget = "tree";
    knowledgeSelected = false;
    selectedFolderId = null;
    selectedId = id;
    $("[data-doc]").value = String(documents.findIndex((d) => d.id === tree.document_id && d.version === tree.document_version));
    const byId = new Map(tree.nodes.map((n) => [n.id, n]));
    let parent = byId.get(id)?.parent_id, changed = false;
    while (parent) { const node = byId.get(parent); if (!node) break; if (node.collapsed) { node.collapsed = false; changed = true; } parent = node.parent_id; }
    draw(); inspector(); updateTools();
    if (center) centerSelected();
  }

  function focusFolder(id, center = true) {
    if (!catalog.folders.some((folder) => folder.id === id)) return;
    historyTarget = "catalog";
    knowledgeSelected = false; selectedFolderId = id;
    $("[data-doc]").value = "";
    draw(); inspector(); updateTools();
    if (center) centerSelected();
  }

  function addFolder(parentId = null) {
    const folder = { id: crypto.randomUUID(), parent_id: parentId, title: "Thư mục mới", collapsed: false };
    commitCatalog(() => { catalog.folders.push(folder); selectedFolderId = folder.id; knowledgeSelected = false; });
    showFocusInspector(true);
    $("[data-folder-title]")?.focus({ preventScroll: true }); $("[data-folder-title]")?.select();
  }

  function inspector() {
    const node = current(), panel = $("[data-inspector]"), token = ++sourceSequence;
    if (!panel) return;
    const folder = selectedFolder();
    if (folder) {
      const byId = new Map(catalog.folders.map((item) => [item.id, item])), path = [];
      let parent = folder; while (parent) { path.unshift(parent); parent = byId.get(parent.parent_id); }
      const blocked = catalogFolderDescendants(catalog.folders, folder.id);
      const childFolders = catalog.folders.filter((item) => item.parent_id === folder.id);
      const childDocuments = catalog.documents.map((item) => ({ ...item, index: documents.findIndex((doc) => doc.id === item.document_id && doc.version === item.document_version) })).filter((item) => item.parent_id === folder.id && item.index >= 0);
      panel.innerHTML = `<div class="dataset-breadcrumb"><button data-knowledge>Kho Kiến Thức</button><span>›</span>${path.map((item) => `<button data-folder="${esc(item.id)}">${esc(item.title)}</button>`).join('<span>›</span>')}</div><div class="dataset-inspector-heading"><small>THƯ MỤC TÀI LIỆU</small><h3>${esc(folder.title)}</h3><span>${childFolders.length} thư mục con · ${childDocuments.length} tài liệu</span></div><label>Tên thư mục<input data-folder-title maxlength="200" value="${esc(folder.title)}"></label><label>Thư mục cha<select data-folder-parent><option value="">Kho Kiến Thức</option>${catalog.folders.filter((item) => !blocked.has(item.id)).map((item) => `<option value="${esc(item.id)}" ${folder.parent_id === item.id ? "selected" : ""}>${esc(item.title)}</option>`).join("")}</select></label><div class="dataset-inspector-actions"><button data-add-folder="${esc(folder.id)}">＋ Thư mục con</button><button data-remove-folder>Xóa thư mục</button></div><p class="dataset-note">Thư mục chỉ sắp xếp tài liệu. Nó không đổi nội dung, ID, phạm vi hay kết quả truy xuất RAG.</p><section class="dataset-children"><small>BÊN TRONG THƯ MỤC</small>${childFolders.map((item) => `<button data-folder="${esc(item.id)}">📁 ${esc(item.title)} <span>›</span></button>`).join("")}${childDocuments.map((item) => `<button data-open-doc="${item.index}">▤ ${esc(documents[item.index].title)} <span>v${documents[item.index].version} ›</span></button>`).join("") || (!childFolders.length ? "<p>Kéo tài liệu hoặc thư mục vào đây bằng tay nắm ⠿.</p>" : "")}</section>`;
      panel.querySelector("[data-folder-title]").oninput = (event) => {
        const value = event.target.value;
        if (!value.trim()) return;
        if (folder.title === value) return;
        const editId = `${folder.id}:title`;
        if (lastCatalogEdit !== editId) rememberCatalog();
        lastCatalogEdit = editId; catalogRedo = []; folder.title = value; draw(); updateTools();
      };
      panel.querySelector("[data-folder-parent]").onchange = (event) => commitCatalog(() => {
        catalog = moveCatalogFolder(catalog, folder.id, event.target.value || null);
      });
      return;
    }
    if (knowledgeSelected || !tree) {
      const assigned = new Map(catalog.documents.map((item) => [`${item.document_id}\u0000${item.document_version}`, item.parent_id]));
      const rootFolders = catalog.folders.filter((item) => item.parent_id == null);
      const rootDocuments = documents.map((doc, index) => ({ doc, index })).filter(({ doc }) => !assigned.get(`${doc.id}\u0000${doc.version}`));
      panel.innerHTML = `<div class="dataset-inspector-heading"><small>GỐC CHUNG</small><h3>Kho Kiến Thức</h3><span>${catalog.folders.length} thư mục · ${documents.length} tài liệu · ${documents.filter((d) => d.enabled !== false).length} nguồn đang bật</span></div><div class="dataset-inspector-actions"><button data-add-folder>＋ Thư mục tài liệu</button></div><p class="dataset-note">Tạo thư mục như “SỔ TAY”, sau đó kéo tài liệu bằng tay nắm ⠿ vào thư mục. Cách sắp xếp không thay đổi dữ liệu RAG.</p><section class="dataset-children"><small>Ở GỐC KHO</small>${rootFolders.map((item) => `<button data-folder="${esc(item.id)}">📁 ${esc(item.title)} <span>›</span></button>`).join("")}${rootDocuments.map(({ doc, index }) => `<button data-open-doc="${index}">▤ ${esc(doc.title)}<span>v${doc.version}${doc.enabled === false ? " · tắt" : ""} ›</span></button>`).join("") || "<p>Chưa có tài liệu hoặc thư mục ở gốc kho.</p>"}</section><p class="dataset-note">Kho và thư mục chỉ là lớp tổ chức; không gộp file, thay ID hoặc thay đổi phạm vi truy xuất.</p>`;
      return;
    }
    if (!node) return;
    const byId = new Map(tree.nodes.map((n) => [n.id, n])), path = [];
    let p = node; while (p) { path.unshift(p); p = byId.get(p.parent_id); }
    const blocked = descendants(tree.nodes, node.id), children = childrenMap(tree.nodes).get(node.id);
    panel.innerHTML = `<div class="dataset-breadcrumb"><button data-knowledge>Kho Kiến Thức</button><span>›</span>${path.map((n) => `<button data-focus="${esc(n.id)}" title="${esc(n.title)}">${esc(n.title)}</button>`).join("<span>›</span>")}</div>
      <div class="dataset-inspector-heading"><small>THUỘC TÍNH MỤC</small><span>Cấp ${path.length} · ${children.length} mục con</span></div>
      <label>Tên mục<input data-title maxlength="200" value="${esc(node.title)}"></label>
      <label>Loại nội dung<select data-kind ${node.id === "root" ? "disabled" : ""}>${Object.entries(DATASET_KINDS).filter(([k]) => k === node.kind || !["knowledge", "folder", "document", ...(node.chunk_id ? [] : ["chunk"])].includes(k)).map(([k, v]) => `<option value="${k}" ${node.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select>${node.chunk_id ? '<span class="dataset-field-help">“Đoạn nguồn” là nguồn gốc, không phải loại. Hãy chọn Công thức, Bảng, Khái niệm… hoặc để Chưa phân loại.</span>' : ""}</label>
      ${node.id !== "root" ? `<label>Mục cha<select data-parent>${tree.nodes.filter((n) => !blocked.has(n.id)).map((n) => `<option value="${esc(n.id)}" ${node.parent_id === n.id ? "selected" : ""}>${esc(n.title)}</option>`).join("")}</select></label>` : ""}
      <label>Ghi chú quản lý<textarea data-description maxlength="4000" placeholder="Ghi chú nội bộ, không đưa vào RAG…">${esc(node.description)}</textarea></label>
      ${!node.chunk_id ? `<section class="dataset-node-content"><div class="dataset-section-heading"><small>NỘI DUNG DỮ LIỆU · DÙNG CHO RAG</small><button type="button" data-edit-node-content>⤢ Soạn trực quan</button></div><label>Viết ngay trên mục<textarea data-content maxlength="120000" spellcheck="false" placeholder="Nhập văn bản ngay tại mục; có thể dùng Markdown / LaTeX…">${esc(node.content || "")}</textarea></label><div class="knowledge-rich-content dataset-node-content-preview" data-content-preview>${renderKnowledge(node.content || "") || '<p>Chưa có dữ liệu trong mục này.</p>'}</div><p class="dataset-note">Nội dung này được lập chỉ mục như dữ liệu RAG. Dùng “Soạn trực quan” để chèn công thức, ký hiệu và bảng.</p></section>` : ""}
      <div class="dataset-inspector-actions"><button data-add>＋ Mục con</button><button data-template title="Thêm 5 mục con: khái niệm, tiêu chuẩn, công thức, bảng, ghi chú">＋ Nhóm 5 phần</button></div>
      <div class="dataset-inspector-actions"><button data-order="-1" ${node.id === "root" ? "disabled" : ""} title="Đưa lên trong cùng cấp">↑ Lên</button><button data-order="1" ${node.id === "root" ? "disabled" : ""} title="Đưa xuống trong cùng cấp">↓ Xuống</button><button data-remove ${node.id === "root" || node.chunk_id ? "disabled" : ""}>Xóa mục</button></div>
      <p class="dataset-note">Tên và ghi chú chỉ dùng để tổ chức. Chỉ phần “Nội dung dữ liệu” hoặc nội dung nguồn mới được đưa vào truy xuất.</p>
      ${node.chunk_id ? `<section class="dataset-source"><small>NỘI DUNG NGUỒN</small><p class="dataset-note">Đây là dữ liệu đã trích từ tài liệu gốc. Bạn vẫn có thể đổi “Loại nội dung” ở phía trên.</p><div data-source>Đang đọc đoạn nguồn…</div></section>` : `<section class="dataset-children"><small>CÁC MỤC CON</small>${children.slice(0, 100).map((n) => `<button data-focus="${esc(n.id)}">${esc(n.title)} <span>›</span></button>`).join("") || "<p>Thêm mục con hoặc kéo một đoạn nguồn vào đây.</p>"}${children.length > 100 ? "<p>Dùng ô tìm mục để đến các mục còn lại.</p>" : ""}</section>`}`;
    if (node.id === "root") {
      const position = catalog.documents.find((item) => item.document_id === tree.document_id && Number(item.document_version) === tree.document_version)?.parent_id;
      const controls = document.createElement("section"); controls.className = "dataset-document-actions";
      const file = storage?.documents?.find((item) => item.document_id === tree.document_id && item.version === tree.document_version);
      controls.innerHTML = `<label>Thư mục chứa<select data-document-parent><option value="">Kho Kiến Thức</option>${catalog.folders.map((folder) => `<option value="${esc(folder.id)}" ${position === folder.id ? "selected" : ""}>${esc(folder.title)}</option>`).join("")}</select></label><div class="dataset-inspector-actions"><button data-document-archive>Lưu trữ</button><button data-document-trash>Xóa tài liệu</button><button data-document-folder>Mở folder</button></div>${file ? `<small class="dataset-file-path">${esc(file.path)}</small>` : ""}`;
      panel.querySelector(".dataset-inspector-heading").after(controls);
      controls.querySelector("[data-document-parent]").onchange = (event) => commitCatalog(() => {
        catalog = moveCatalogDocument(catalog, tree.document_id, tree.document_version, event.target.value || null);
      });
    }
    const edit = (key, value) => {
      if (busy) return;
      if (key === "title" && !value.trim()) { status("Tên mục không được để trống.", true); panel.querySelector("[data-title]").value = node.title; return; }
      if (node[key] === value) return;
      const editId = `${node.id}:${key}`;
      if (lastEdit !== editId) remember();
      lastEdit = editId; redo = [];
      node[key] = value; draw(); updateTools();
    };
    panel.querySelector("[data-title]").oninput = (e) => edit("title", e.target.value);
    panel.querySelector("[data-description]").oninput = (e) => edit("description", e.target.value);
    panel.querySelector("[data-content]")?.addEventListener("input", (e) => {
      edit("content", e.target.value);
      const preview = panel.querySelector("[data-content-preview]");
      if (preview) preview.innerHTML = renderKnowledge(e.target.value) || "<p>Chưa có dữ liệu trong mục này.</p>";
    });
    panel.querySelector("[data-kind]").onchange = (e) => commit(() => { node.kind = e.target.value; });
    panel.querySelector("[data-parent]")?.addEventListener("change", (e) => commit(() => { tree.nodes = reparent(tree.nodes, node.id, e.target.value); }));
    if (node.chunk_id) safe(async () => {
      const result = await call(`${address()}/source/${encodeURIComponent(node.chunk_id)}?version=${tree.document_version}`);
      if (disposed || token !== sourceSequence) return;
      const chunk = result.chunk, source = $("[data-source]");
      source.innerHTML = `<span class="dataset-source-state">${chunk.metadata?.retrieval_eligible ? "Được phép truy xuất" : "Chưa đủ điều kiện / nguồn đang tắt"}${chunk.page ? ` · Trang ${esc(chunk.page)}` : ""}</span><button type="button" data-expand-source>⤢ Xem toàn bộ nội dung</button><div class="knowledge-rich-content dataset-source-preview">${renderKnowledge(chunk.text)}</div><details><summary>Văn bản gốc (Markdown / LaTeX)</summary><pre>${esc(chunk.text)}</pre></details>`;
      source.querySelector("[data-expand-source]").onclick = () => openKnowledgeContent({ title: node.title, source: chunk.text, note: "Đoạn nguồn chỉ đọc. Công thức và bảng được trình bày lại, không thay đổi nội dung hay trạng thái kiểm duyệt. Để nhập thêm, dùng nút Viết dữ liệu." });
    })();
  }

  function addChildren(template = false) {
    commit(() => {
      const node = current(); node.collapsed = false;
      const chapterParent = ["document", "part"].includes(node.kind);
      const specs = template ? [["concept", "Khái niệm"], ["standard", "Tiêu chuẩn"], ["formula", "Công thức"], ["table", "Bảng"], ["note", "Ghi chú"]] : [[chapterParent ? "chapter" : "section", chapterParent ? "Chương mới" : "Mục mới"]];
      for (const [kind, title] of specs) {
        const child = { id: crypto.randomUUID(), parent_id: node.id, title, kind, description: "", content: "", chunk_id: null, collapsed: false };
        tree.nodes.push(child); if (!template) selectedId = child.id;
      }
    });
    focusNode(selectedId); showFocusInspector(true); if (!template) { $("[data-title]").focus({ preventScroll: true }); $("[data-title]").select(); }
  }

  async function load(docIndex) {
    const doc = documents[docIndex]; if (!doc) return;
    const seq = ++loadSequence; busy = true; updateTools(); status("Đang đọc cấu trúc dataset…");
    try {
      const data = await call(`/documents/${encodeURIComponent(doc.id)}/tree?version=${doc.version}`);
      if (disposed || seq !== loadSequence) return;
      tree = data.tree; knowledgeSelected = false; selectedFolderId = null; selectedId = "root"; undo = []; redo = []; lastEdit = null; savedNodes = JSON.stringify(tree.nodes);
      $("[data-doc]").value = String(docIndex); draw(); inspector();
      status(`${data.source_count} đoạn nguồn · ${data.document.enabled ? "Nguồn đang bật" : "Nguồn đang tắt"}. Kéo tay nắm ⠿ vào một mục để đổi nhánh.`);
      requestAnimationFrame(() => { if (!disposed) focusNode("root"); });
    } finally { if (seq === loadSequence) { busy = false; updateTools(); } }
  }

  function showKnowledge() {
    historyTarget = "catalog";
    knowledgeSelected = true; selectedFolderId = null;
    $("[data-doc]").value = "";
    $("[data-search-results]").hidden = true;
    draw(); inspector(); updateTools(); centerSelected();
  }

  async function openDocument(index) {
    const doc = documents[index];
    if (!doc) return;
    if (tree?.document_id === doc.id && tree?.document_version === doc.version) { focusNode("root"); return; }
    if (await confirmTreeDiscard()) await load(index);
  }

  function updateDocumentSelect() {
    const select = $("[data-doc]");
    if (!select) return;
    select.innerHTML = `<option value="">Kho Kiến Thức · Tất cả tài liệu</option>${documents.map((d, i) => `<option value="${i}">${esc(d.title)} · v${d.version}${d.enabled !== false ? "" : " · đang tắt"}</option>`).join("")}`;
  }

  function addDocument(document) {
    if (disposed || !document?.id) return false;
    const normalized = { ...document, version: Number(document.version || 1) };
    const existing = documents.findIndex((item) => item.id === normalized.id && Number(item.version) === normalized.version);
    if (existing >= 0) documents[existing] = normalized;
    else documents.unshift(normalized);
    updateDocumentSelect(); showKnowledge();
    status(`Đã tạo tài liệu trống “${normalized.title}”. Chọn tài liệu để thêm mục hoặc nhập dữ liệu ngay trên nút gốc.`);
    return true;
  }

  async function refreshKnowledge() {
    if (!await confirmDiscard()) return;
    busy = true; updateTools();
    try {
      const [result, catalogResult] = await Promise.all([call("/documents"), call("/knowledge/catalog")]); if (disposed) return;
      documents = result.documents || [];
      catalog = catalogResult || { revision: 0, folders: [], documents: [] };
      savedCatalog = catalogSnapshot(); catalogUndo = []; catalogRedo = []; lastCatalogEdit = null;
      tree = null; savedNodes = ""; undo = []; redo = [];
      updateDocumentSelect();
      showKnowledge();
      status(`${documents.length} tài liệu nối vào Kho Kiến Thức. Chọn một nhánh tài liệu để mở nội dung.`);
    } finally { busy = false; updateTools(); }
  }

  async function refreshDocuments() {
    const result = await call("/documents");
    if (disposed) return;
    documents = result.documents || [];
    if (tree && !documents.some((doc) => doc.id === tree.document_id && doc.version === tree.document_version)) {
      tree = null; savedNodes = ""; undo = []; redo = []; knowledgeSelected = true; selectedFolderId = null;
    }
    updateDocumentSelect(); draw(); inspector(); updateTools();
    if (!catalogView()) $("[data-doc]").value = String(documents.findIndex((doc) => doc.id === tree.document_id && doc.version === tree.document_version));
  }

  async function storeDocument(state) {
    if (busy || !tree) return;
    const doc = documents.find((item) => item.id === tree.document_id && item.version === tree.document_version);
    if (!doc) return;
    const deleting = state === "trashed";
    if (!await confirmAction({title: `${deleting ? "Xóa" : "Lưu trữ"} tài liệu “${doc.title}”?`, message: deleting ? "Tài liệu sẽ vào Thùng rác và ngừng dùng làm nguồn trả lời. Có thể khôi phục trong Lưu trữ / Thùng rác." : "Tài liệu sẽ chuyển sang thư mục lưu trữ và ngừng dùng làm nguồn trả lời. Có thể khôi phục khi cần.", confirmLabel: deleting ? "Chuyển vào Thùng rác" : "Lưu trữ"})) return;
    if (dirty()) await save();
    if (dirty()) return;
    busy = true; updateTools();
    try {
      const result = await call(`/documents/${encodeURIComponent(doc.id)}/lifecycle`, {method:"POST", body:{state, version:doc.version}});
      storage = result.storage || storage;
      await refreshDocuments(); showKnowledge();
      status(result.storage?.warning || (deleting ? "Đã chuyển tài liệu vào Thùng rác. Có thể khôi phục trong Lưu trữ / Thùng rác." : "Đã chuyển tài liệu sang thư mục lưu trữ."));
    } finally { busy = false; updateTools(); }
  }

  async function openFolder(documentId = null) {
    if (dirty()) await save();
    if (dirty()) return;
    const result = await call("/knowledge/storage/open", {method:"POST", body:{document_id:documentId, version:tree?.document_version || 1}});
    status(`Thư mục trên máy: ${result.path}`);
  }

  function toggleFullscreen(force) {
    closeContext();
    fullscreen = typeof force === "boolean" ? force : !fullscreen;
    el.classList.toggle("dataset-fullscreen", fullscreen);
    el.closest(".workflow-manager")?.classList.toggle("dataset-focus-host", fullscreen);
    $("[data-fullscreen]").textContent = fullscreen ? "⤡ Thu gọn sơ đồ" : "⤢ Mở rộng sơ đồ";
    $("[data-fullscreen]").setAttribute("aria-pressed", String(fullscreen));
    showFocusInspector(false);
    $("[data-viewport]").focus({preventScroll:true});
    requestAnimationFrame(centerSelected);
  }

  function showFocusInspector(show) {
    show = fullscreen && show;
    el.classList.toggle("dataset-inspector-open", show);
    $("[data-focus-inspector]").textContent = show ? "Ẩn bảng chỉnh sửa" : "Chỉnh sửa mục";
    $("[data-focus-inspector]").setAttribute("aria-expanded", String(show));
  }

  function closeContext(focus = false) {
    contextMenu?.remove(); contextMenu = null;
    if (focus) (contextReturnFocus?.isConnected ? contextReturnFocus : $("[data-viewport]"))?.focus({preventScroll:true});
  }

  async function openContext(event) {
    if (busy || event.target.closest("input,textarea,select,[contenteditable]")) return;
    const target = event.target.closest("[data-node]");
    if (!target && !event.target.closest("[data-viewport]")) return;
    event.preventDefault(); closeContext();
    const x = event.clientX, y = event.clientY;
    if (target?.dataset.catalogFolder) focusFolder(target.dataset.catalogFolder, false);
    else if (target?.dataset.localNode) focusNode(target.dataset.localNode, false);
    else if (target?.dataset.kind === "document") {
      const index = Number(target.querySelector("[data-open-doc]")?.dataset.openDoc);
      await openDocument(index);
      if (tree?.document_id !== documents[index]?.id) return;
    } else showKnowledge();
    if (disposed) return;
    contextReturnFocus = $(".dataset-node.selected .dataset-node-select");
    const entries = [];
    if (fullscreen) entries.push(["edit-properties", "Chỉnh sửa mục", ""]);
    if (knowledgeSelected) entries.push(["new-document", "Tạo tài liệu", ""], ["add-folder", "Thêm thư mục", "Ctrl+Shift+N"]);
    else if (selectedFolderId) entries.push(["add-folder", "Thêm thư mục con", "Insert"], ["rename", "Đổi tên", "F2"], ["remove-folder", "Xóa thư mục", "Delete"]);
    else {
      entries.push(["add", "Thêm mục con", "Insert"], ["template", "Thêm nhóm 5 phần", ""], ["rename", "Đổi tên", "F2"]);
      if (current()?.id === "root") entries.push(["move-document", "Chuyển vào thư mục…", ""], ["document-folder", "Mở folder tài liệu", ""], ["document-archive", "Lưu trữ tài liệu", ""], ["document-trash", "Xóa tài liệu", "Delete"]);
      else if (!current()?.chunk_id) entries.push(["remove", "Xóa mục", "Delete"]);
    }
    entries.push(["save", "Lưu", "Ctrl+S"], ["undo", "Hoàn tác", "Ctrl+Z"], ["redo", "Làm lại", "Ctrl+Y"]);
    contextMenu = document.createElement("div"); contextMenu.className = "dataset-context-menu"; contextMenu.setAttribute("role", "menu");
    contextMenu.innerHTML = entries.map(([action, title, key]) => `<button type="button" role="menuitem" data-context-action="${action}" ${action === "save" && !dirty() || ["undo", "redo"].includes(action) && $(`[data-${action}]`).disabled ? "disabled" : ""}><span>${title}</span><kbd>${key}</kbd></button>`).join("");
    el.append(contextMenu);
    const rect = contextMenu.getBoundingClientRect();
    contextMenu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    contextMenu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
    contextMenu.querySelector("button:not(:disabled)")?.focus();
  }

  function contextAction(action) {
    closeContext(true);
    if (action === "rename") { showFocusInspector(true); const input = $("[data-folder-title]") || $("[data-title]"); input?.focus(); input?.select(); }
    else if (action === "edit-properties") showFocusInspector(true);
    else if (action === "move-document") { showFocusInspector(true); $("[data-document-parent]")?.focus(); }
    else if (action === "new-document") $("[data-write-document]")?.click();
    else $(`[data-${action}]`)?.click();
  }

  async function save() {
    if (busy || !dirty()) return;
    busy = true; updateTools(); status("Đang lưu sơ đồ…");
    try {
      let treeData = null;
      if (catalogDirty()) {
        catalog = await call("/knowledge/catalog", { method: "PUT", body: catalog });
        storage = catalog.storage || storage;
        savedCatalog = catalogSnapshot(); catalogUndo = []; catalogRedo = []; lastCatalogEdit = null;
      }
      if (treeDirty()) {
        treeData = await call(`${address()}?version=${tree.document_version}`, { method: "PUT", body: tree });
        tree = treeData.tree; lastEdit = null; savedNodes = JSON.stringify(tree.nodes);
        storage = treeData.storage || storage;
        const doc = documents.find((item) => item.id === tree.document_id && item.version === tree.document_version);
        if (doc) doc.title = tree.nodes.find((node) => node.id === "root").title;
        updateDocumentSelect();
        if (!catalogView()) $("[data-doc]").value = String(documents.indexOf(doc));
      }
      if (disposed) return;
      draw(); inspector();
      if (treeData?.content_changed) {
        status("Đã lưu nội dung mục. Đang xếp hàng kiểm tra công thức và cập nhật chỉ mục…");
        try {
          const run = await call(`/documents/${encodeURIComponent(tree.document_id)}/reindex`, { method: "POST", body: {} });
          if (run?.run_id) onIngestionStarted?.(run.run_id);
          status(`Đã lưu nội dung mục · đang cập nhật chỉ mục${run?.run_id ? ` · job ${run.run_id}` : ""}.`);
        } catch (error) {
          status(`Đã lưu nội dung mục, nhưng chưa thể tạo lại chỉ mục: ${error.message || error}`, true);
        }
      } else status("Đã lưu thư mục và sơ đồ dataset.");
      if (storage?.warning) status(storage.warning, true);
      notify?.("Đã lưu cách tổ chức Kho Kiến Thức");
    } finally { busy = false; updateTools(); }
  }

  function pointerDown(event) {
    if (event.button !== 0 || busy) return;
    const handle = event.target.closest("[data-drag],[data-drag-document],[data-drag-folder]"), view = $("[data-viewport]");
    if (!handle && (event.target.closest("button, input, textarea, select") || !view.contains(event.target))) return;
    const kind = handle?.hasAttribute("data-drag-document") ? "document" : handle?.hasAttribute("data-drag-folder") ? "folder" : handle ? "node" : "pan";
    const id = kind === "document" ? Number(handle.dataset.dragDocument) : kind === "folder" ? handle.dataset.dragFolder : handle?.dataset.drag;
    drag = { kind, id, x: event.clientX, y: event.clientY, left: view.scrollLeft, top: view.scrollTop, active: false, target: null };
    if (handle) event.preventDefault();
  }
  function pointerMove(event) {
    if (!drag || disposed) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.active && Math.hypot(dx, dy) < 6) return;
    drag.active = true; suppressClick = true;
    if (drag.kind === "pan") { const view = $("[data-viewport]"); view.scrollLeft = drag.left - dx; view.scrollTop = drag.top - dy; return; }
    event.preventDefault();
    let ghost = $(".dataset-drag-ghost");
    if (!ghost) {
      ghost = document.createElement("div"); ghost.className = "dataset-drag-ghost";
      ghost.textContent = drag.kind === "document" ? documents[drag.id]?.title : drag.kind === "folder" ? catalog.folders.find((item) => item.id === drag.id)?.title : tree?.nodes.find((n) => n.id === drag.id)?.title;
      el.append(ghost);
    }
    ghost.style.left = `${event.clientX + 12}px`; ghost.style.top = `${event.clientY + 12}px`;
    el.querySelectorAll(".drop-target").forEach((n) => n.classList.remove("drop-target"));
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-node]");
    if (drag.kind === "node") {
      drag.target = target && el.contains(target) && target.hasAttribute("data-local-node") && canReparent(tree.nodes, drag.id, target.dataset.localNode) ? { localId: target.dataset.localNode } : null;
    } else if (drag.kind === "document" || drag.kind === "folder") {
      const validSurface = target && el.contains(target) && (target.dataset.kind === "knowledge" || target.hasAttribute("data-catalog-folder"));
      const parentId = target?.dataset.catalogFolder || null;
      const validFolder = drag.kind !== "folder" || !catalogFolderDescendants(catalog.folders, drag.id).has(parentId);
      drag.target = validSurface && validFolder ? { parentId } : null;
    }
    if (drag.target) target.classList.add("drop-target");
    const view = $("[data-viewport]"), r = view.getBoundingClientRect();
    if (event.clientX > r.left && event.clientX < r.right && event.clientY > r.top && event.clientY < r.bottom) {
      if (event.clientX > r.right - 35) view.scrollLeft += 20;
      if (event.clientX < r.left + 35) view.scrollLeft -= 20;
      if (event.clientY > r.bottom - 35) view.scrollTop += 20;
      if (event.clientY < r.top + 35) view.scrollTop -= 20;
    }
  }
  function pointerUp(event) {
    if (!drag) return;
    const finished = drag; drag = null;
    $(".dataset-drag-ghost")?.remove(); el?.querySelectorAll(".drop-target").forEach((n) => n.classList.remove("drop-target"));
    if (event?.type !== "pointercancel" && finished.active && finished.target) {
      if (finished.kind === "node") {
        commit(() => { tree.nodes = reparent(tree.nodes, finished.id, finished.target.localId); knowledgeSelected = false; selectedFolderId = null; selectedId = finished.id; });
        status("Đã đổi mục cha. Bấm Lưu sơ đồ để giữ thay đổi.");
      } else if (finished.kind === "document") {
        const doc = documents[finished.id];
        if (doc) commitCatalog(() => {
          catalog = moveCatalogDocument(catalog, doc.id, doc.version, finished.target.parentId);
          selectedFolderId = finished.target.parentId; knowledgeSelected = !finished.target.parentId;
        });
        status("Đã chuyển tài liệu vào thư mục. Bấm Lưu sơ đồ để giữ thay đổi.");
      } else if (finished.kind === "folder") {
        commitCatalog(() => {
          catalog = moveCatalogFolder(catalog, finished.id, finished.target.parentId);
          selectedFolderId = finished.id; knowledgeSelected = false;
        });
        status("Đã chuyển thư mục. Bấm Lưu sơ đồ để giữ thay đổi.");
      }
    }
    setTimeout(() => { suppressClick = false; }, 0);
  }

  async function mount(target) {
    host = target;
    host.innerHTML = `<div class="dataset-editor"><div class="dataset-toolbar"><label>DATASET / TÀI LIỆU<select data-doc aria-label="Chọn dataset"></select></label><span data-revision></span><button data-undo title="Hoàn tác" aria-label="Hoàn tác">↶</button><button data-redo title="Làm lại" aria-label="Làm lại">↷</button><button data-reload title="Đọc lại cây từ dữ liệu đã lưu">Tải lại</button><button data-save class="dataset-save">Lưu sơ đồ</button></div>
      <div class="dataset-guide"><b>Cây nội dung dataset</b><span>Tài liệu → Chương → Mục → nhiều cấp con. Chọn một mục để chỉnh sửa.</span></div>
      <div class="dataset-tree-body" data-tree-body><div class="dataset-canvas-column"><div class="dataset-view-tools"><input data-search type="search" placeholder="Tìm mục trong cây…" aria-label="Tìm mục trong cây"><button data-find>Tìm</button><button data-zoom="-1" aria-label="Thu nhỏ">−</button><span data-zoom-value>100%</span><button data-zoom="1" aria-label="Phóng to">＋</button><button data-home title="Về gốc tài liệu">⌂ Gốc</button></div><div class="dataset-search-results" data-search-results hidden></div><div class="dataset-viewport" data-viewport tabindex="0" aria-label="Sơ đồ dataset. Kéo nền hoặc dùng thanh cuộn để di chuyển."><div data-sizer><div data-stage></div></div></div><footer><span data-count></span><span>Kéo nền để di chuyển · ⠿ để đổi nhánh</span></footer></div><aside class="dataset-inspector" data-inspector aria-label="Thuộc tính mục"></aside></div><div class="dataset-status" data-tree-status role="status" aria-live="polite"></div></div>`;
    el = host.firstElementChild;
    const tools = document.createElement("div"); tools.className = "dataset-secondary-tools";
    tools.innerHTML = `<button data-fullscreen aria-pressed="false" title="Mở rộng riêng sơ đồ (F11)">⤢ Mở rộng sơ đồ</button><button data-storage>Lưu trữ / Thùng rác</button><button data-open-folder>Mở folder kho</button><details><summary>Phím tắt</summary><span>Ctrl+S: lưu · Ctrl+Z: hoàn tác · Ctrl+Y / Ctrl+Shift+Z: làm lại · Insert: thêm con · F2: đổi tên · Delete: xóa · Ctrl+F: tìm mục · Ctrl+0: vừa cây · F11: mở rộng sơ đồ · Esc: đóng menu / thu gọn. Khi gõ trong ô, Ctrl+Z và Delete thao tác trên văn bản.</span></details>`;
    $(".dataset-guide").after(tools);
    const focusTools = document.createElement("div"); focusTools.className = "dataset-focus-tools";
    focusTools.innerHTML = `<button data-focus-undo aria-label="Hoàn tác" title="Hoàn tác (Ctrl+Z)">↶</button><button data-focus-redo aria-label="Làm lại" title="Làm lại (Ctrl+Y)">↷</button><button data-focus-save class="dataset-save" title="Lưu sơ đồ (Ctrl+S)">Lưu</button><button data-focus-inspector aria-expanded="false">Chỉnh sửa mục</button><button data-focus-exit title="Thu gọn sơ đồ (Esc hoặc F11)">⤡ Thu gọn</button>`;
    $(".dataset-view-tools").append(focusTools);
    if (onCreateDocument) {
      const write = document.createElement("button"); write.type = "button"; write.textContent = "＋ Tạo tài liệu"; write.dataset.writeDocument = "";
      write.title = "Tạo tài liệu trống hoặc nhập ngay văn bản, công thức và bảng";
      write.onclick = safe(() => onCreateDocument());
      $("[data-save]").after(write);
    }
    $(".dataset-guide span").textContent = "Kho Kiến Thức → Thư mục tài liệu → Tài liệu → Phần → Chương → Mục → các cấp con.";
    $("[data-home]").title = "Về Kho Kiến Thức";
    const fit = document.createElement("button"); fit.dataset.fit = ""; fit.textContent = "⊡"; fit.title = "Vừa toàn bộ cây vào khung"; fit.setAttribute("aria-label", fit.title);
    $("[data-home]").before(fit);
    resizeObserver = new ResizeObserver(([entry]) => {
      const size = { width:entry.contentRect.width, height:entry.contentRect.height };
      if (lastSize && (Math.abs(size.width - lastSize.width) > 50 || Math.abs(size.height - lastSize.height) > 50)) centerSelected();
      lastSize = size;
    });
    resizeObserver.observe($("[data-viewport]"));
    toolsObserver = new ResizeObserver(() => {
      if (!disposed) el.style.setProperty("--dataset-focus-top", `${$(".dataset-view-tools").getBoundingClientRect().height + 22}px`);
    });
    toolsObserver.observe($(".dataset-view-tools"));
    el.addEventListener("pointerdown", pointerDown, { signal: controller.signal });
    el.addEventListener("contextmenu", safe(openContext), {signal:controller.signal});
    el.addEventListener("dblclick", (event) => { if (fullscreen && event.target.closest(".dataset-node-select")) showFocusInspector(true); }, {signal:controller.signal});
    document.addEventListener("pointerdown", (event) => { if (contextMenu && !contextMenu.contains(event.target)) closeContext(); }, {signal:controller.signal});
    el.addEventListener("keydown", (event) => {
      if (event.defaultPrevented) return;
      const key = event.key.toLowerCase();
      const modified = event.ctrlKey || event.metaKey, typing = event.target.closest("input, textarea, select, [contenteditable]");
      const consume = () => { event.preventDefault(); event.stopPropagation(); };
      if (key === "escape" && contextMenu) { consume(); closeContext(true); return; }
      if (key === "escape" && fullscreen) { consume(); toggleFullscreen(false); return; }
      if (contextMenu && ["arrowdown", "arrowup", "home", "end"].includes(key)) {
        consume(); const buttons = [...contextMenu.querySelectorAll("button:not(:disabled)")];
        const index = buttons.indexOf(document.activeElement);
        buttons[key === "home" ? 0 : key === "end" ? buttons.length - 1 : (index + (key === "arrowdown" ? 1 : -1) + buttons.length) % buttons.length]?.focus(); return;
      }
      if (key === "f11") { consume(); toggleFullscreen(); return; }
      if (event.altKey) return;
      if (modified && key === "s") { consume(); safe(save)(); return; }
      if (modified && key === "f") { consume(); $("[data-search]").focus(); return; }
      if (modified && key === "0") { consume(); fitTree(); return; }
      if (!typing && !busy) {
        if (key === "f2") { consume(); contextAction("rename"); return; }
        if (key === "delete") { consume(); contextAction(selectedFolderId ? "remove-folder" : current()?.id === "root" ? "document-trash" : "remove"); return; }
        if (key === "insert" || modified && event.shiftKey && key === "n") { consume(); contextAction(catalogView() ? "add-folder" : "add"); return; }
      }
      if (modified && !typing) {
        const action = key === "z" ? (event.shiftKey ? "redo" : "undo") : key === "y" ? "redo" : null;
        if (action) { consume(); $(`[data-${action}]`)?.click(); }
      }
    }, { signal: controller.signal });
    document.addEventListener("pointermove", pointerMove, { signal: controller.signal, passive: false });
    document.addEventListener("pointerup", pointerUp, { signal: controller.signal });
    document.addEventListener("pointercancel", pointerUp, { signal: controller.signal });
    el.addEventListener("click", safe(async (event) => {
      if (suppressClick) { event.preventDefault(); return; }
      const b = event.target.closest("button"); if (!b || busy) return;
      if (b.dataset.contextAction) { contextAction(b.dataset.contextAction); return; }
      if (b.hasAttribute("data-fullscreen")) { toggleFullscreen(); return; }
      if (b.hasAttribute("data-focus-exit")) { toggleFullscreen(false); return; }
      if (b.hasAttribute("data-focus-inspector")) { showFocusInspector(!el.classList.contains("dataset-inspector-open")); return; }
      if (b.hasAttribute("data-focus-save")) { await save(); return; }
      if (b.hasAttribute("data-focus-undo")) { $("[data-undo]").click(); return; }
      if (b.hasAttribute("data-focus-redo")) { $("[data-redo]").click(); return; }
      if (b.hasAttribute("data-storage")) { openKnowledgeStorage({request:call, onChanged:refreshDocuments, notify}); return; }
      if (b.hasAttribute("data-open-folder")) { await openFolder(); return; }
      if (b.hasAttribute("data-document-folder")) { await openFolder(tree?.document_id); return; }
      if (b.hasAttribute("data-document-archive")) { await storeDocument("archived"); return; }
      if (b.hasAttribute("data-document-trash")) { await storeDocument("trashed"); return; }
      if (b.hasAttribute("data-knowledge") || b.hasAttribute("data-home")) { showKnowledge(); return; }
      if (b.dataset.folder) { $("[data-search-results]").hidden = true; focusFolder(b.dataset.folder); return; }
      if (b.hasAttribute("data-open-doc")) { await openDocument(Number(b.dataset.openDoc)); return; }
      if (b.hasAttribute("data-reload")) {
        if (catalogView()) await refreshKnowledge();
        else if (await confirmTreeDiscard()) await load(Number($("[data-doc]").value));
        return;
      }
      if (b.dataset.select) focusNode(b.dataset.select, false);
      if (b.dataset.focus) { $("[data-search-results]").hidden = true; focusNode(b.dataset.focus); }
      if (b.dataset.fold) commit(() => { const n = tree.nodes.find((n) => n.id === b.dataset.fold); n.collapsed = !n.collapsed; });
      if (b.dataset.foldFolder) commitCatalog(() => { const item = catalog.folders.find((folder) => folder.id === b.dataset.foldFolder); item.collapsed = !item.collapsed; });
      if (b.hasAttribute("data-add-folder")) addFolder(b.dataset.addFolder || null);
      if (b.hasAttribute("data-remove-folder")) {
        const removing = selectedFolder();
        if (removing && await confirmAction({ title: `Xóa thư mục “${removing.title}”?`, message: "Các tài liệu và thư mục con sẽ được chuyển lên thư mục cha. Không xóa tài liệu hay dữ liệu RAG.", confirmLabel: "Xóa thư mục" })) {
          commitCatalog(() => { catalog = removeCatalogFolder(catalog, removing.id); selectedFolderId = removing.parent_id; knowledgeSelected = !removing.parent_id; });
        }
      }
      if (b.hasAttribute("data-add")) addChildren();
      if (b.hasAttribute("data-template")) addChildren(true);
      if (b.hasAttribute("data-edit-node-content")) {
        const editing = current();
        if (!editing || editing.chunk_id) return;
        openKnowledgeContent({
          title: editing.title, source: editing.content || "", editable: true, startEditing: true,
          saveLabel: "Áp dụng vào mục",
          note: "Soạn dữ liệu của riêng mục này. Nội dung sẽ đi qua lập chỉ mục và duyệt công thức sau khi bạn bấm Lưu sơ đồ.",
          onSave: ({ title, source }) => {
            if (disposed || current()?.id !== editing.id) return;
            commit(() => { editing.title = title; editing.content = source; });
            inspector(); status("Đã áp dụng vào mục · bấm Lưu sơ đồ để cập nhật RAG.");
          },
        });
      }
      if (b.hasAttribute("data-save")) await save();
      if (b.hasAttribute("data-fit")) fitTree();
      if (b.hasAttribute("data-undo")) {
        if (catalogHistory() && catalogUndo.length) { catalogRedo.push(clone({ folders: catalog.folders, documents: catalog.documents, selectedFolderId, knowledgeSelected })); const previous = catalogUndo.pop(); Object.assign(catalog, {folders:previous.folders, documents:previous.documents}); selectedFolderId = previous.selectedFolderId; knowledgeSelected = previous.knowledgeSelected; lastCatalogEdit = null; }
        else if (!catalogHistory() && undo.length) { redo.push({nodes:clone(tree.nodes), selectedId}); const previous = undo.pop(); tree.nodes = previous.nodes; selectedId = previous.selectedId; lastEdit = null; if (!current()) selectedId = "root"; }
        draw(); inspector(); updateTools();
      }
      if (b.hasAttribute("data-redo")) {
        if (catalogHistory() && catalogRedo.length) { rememberCatalog(); const next = catalogRedo.pop(); Object.assign(catalog, {folders:next.folders, documents:next.documents}); selectedFolderId = next.selectedFolderId; knowledgeSelected = next.knowledgeSelected; lastCatalogEdit = null; }
        else if (!catalogHistory() && redo.length) { remember(); const next = redo.pop(); tree.nodes = next.nodes; selectedId = next.selectedId; lastEdit = null; if (!current()) selectedId = "root"; }
        draw(); inspector(); updateTools();
      }
      if (b.dataset.zoom) {
        const view = $("[data-viewport]"), old = zoom;
        zoom = Math.max(.4, Math.min(1.6, zoom + Number(b.dataset.zoom) * .1)); draw();
        view.scrollLeft = (view.scrollLeft + view.clientWidth / 2) * zoom / old - view.clientWidth / 2;
        view.scrollTop = (view.scrollTop + view.clientHeight / 2) * zoom / old - view.clientHeight / 2;
      }
      if (b.dataset.order) commit(() => {
        const node = current(), siblings = tree.nodes.filter((n) => n.parent_id === node.parent_id), other = siblings[siblings.indexOf(node) + Number(b.dataset.order)];
        if (other) { const a = tree.nodes.indexOf(node), c = tree.nodes.indexOf(other); [tree.nodes[a], tree.nodes[c]] = [tree.nodes[c], tree.nodes[a]]; }
      });
      if (b.hasAttribute("data-remove")) {
        const id = selectedId, node = current();
        if (node.id === "root" || node.chunk_id) return;
        if (await confirmAction({ title: `Xóa mục “${node.title}”?`, message: "Nội dung nhập trực tiếp của mục này sẽ được xóa khi lưu. Các mục con được chuyển lên mục cha. Có thể hoàn tác bằng Ctrl+Z.", confirmLabel: "Xóa mục" })) {
          if (!disposed && !busy && current()?.id === id) commit(() => { tree.nodes = removeGrouping(tree.nodes, id); selectedId = node.parent_id; });
        }
      }
    }), { signal: controller.signal });
    $("[data-doc]").onchange = safe(async (e) => {
      const next = e.target.value;
      e.target.value = catalogView() ? "" : String(documents.findIndex((d) => d.id === tree?.document_id && d.version === tree?.document_version));
      if (next === "") showKnowledge();
      else await openDocument(Number(next));
    });
    const find = () => {
      const query = $("[data-search]").value.trim().toLocaleLowerCase("vi"), results = $("[data-search-results]");
      const matches = query ? knowledgeProjection(documents, tree, catalog).filter((n) => `${n.title} ${n.description || ""}`.toLocaleLowerCase("vi").includes(query)) : [];
      results.hidden = !query;
      results.innerHTML = matches.slice(0, 40).map((n) => `<button ${n.kind === "knowledge" ? "data-knowledge" : n.catalogFolderId ? `data-folder="${esc(n.catalogFolderId)}"` : n.localId ? `data-focus="${esc(n.localId)}"` : `data-open-doc="${n.documentIndex}"`}>${esc(n.title)} <small>${esc(DATASET_KINDS[n.kind])}</small></button>`).join("") || "<p>Không tìm thấy mục.</p>";
    };
    $("[data-find]").onclick = find;
    $("[data-search]").addEventListener("input", find);
    $("[data-search]").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); find(); } });
    await refreshKnowledge();
    try { storage = await call("/knowledge/storage"); if (!disposed) { inspector(); if (storage?.warning) status(storage.warning, true); } } catch { /* Folder access can be retried from the toolbar. */ }
  }

  return { mount, addDocument, save, toggleFullscreen, isFullscreen: () => fullscreen, hasUnsaved: () => busy || dirty(), confirmDiscard, dispose() { closeContext(); if (fullscreen) toggleFullscreen(false); disposed = true; sourceSequence++; loadSequence++; drag = null; resizeObserver?.disconnect(); toolsObserver?.disconnect(); controller.abort(); $(".dataset-drag-ghost")?.remove(); } };
}
