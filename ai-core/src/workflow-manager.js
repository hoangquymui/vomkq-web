import "./workflow-manager.css";
import { backendApi } from "./backend-api.js";
import { REASONING_PROFILES } from "./reasoning-profiles.js";
import { createDatasetTreeEditor } from "./dataset-tree-editor.js";
import { openKnowledgeContent } from "./knowledge-content-editor.js";
import { renderFormula } from "./knowledge-content.js";
import { openKnowledgeStorage } from "./knowledge-storage.js";
import { SOURCE_POLICY_KEY } from "./source-policy.js";

const EMBEDDING_KEY = "vector.ai.embedding-profile.v1";
export const selectedEmbeddingProfile = () => localStorage.getItem(EMBEDDING_KEY) || null;
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const list = (value, name) => Array.isArray(value) ? value : value?.[name] || value?.items || [];
const serviceState = (value) => {
  if (value == null) return "Chưa có thông tin";
  if (typeof value !== "object") return String(value);
  return String(value.status || value.state || value.detail || value.error || "Chưa có thông tin");
};

export function createWorkflowManager({ getScope, getMode, setMode, notify, confirmAction, openBackupManager }) {
  const modal = document.createElement("div");
  modal.className = "modal-layer";
  modal.id = "workflowModal";
  modal.innerHTML = `<div class="workflow-manager" role="dialog" aria-modal="true" aria-labelledby="workflowTitle">
    <button class="modal-close" data-close aria-label="Đóng">×</button>
    <header class="workflow-title"><div class="workflow-title-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="5" r="2.2"/><circle cx="19" cy="12" r="2.2"/><path d="m6.8 10.7 3.4-4.3m3.6 0 3.4 4.3M7.2 13.1l3.2 4.1h3.2l3.2-4.1"/></svg></div><span><small>PYTHON CORE · LOCAL WORKFLOWS</small><h2 id="workflowTitle">Quản lý workflow RAG</h2></span></header>
    <p class="workflow-description">Tổ chức dataset theo tài liệu, chương, mục và nhiều lớp nội dung con. Luồng xử lý RAG nằm ở Tổng quan.</p>
    <nav class="workflow-nav" role="tablist" aria-label="Khu vực quản lý workflow">${[["diagram", "Sơ đồ dataset"], ["overview", "Tổng quan"], ["profiles", "Cấu hình"], ["documents", "Tài liệu"], ["formulas", "Duyệt công thức"], ["preview", "Thử truy xuất"], ["runs", "Lịch sử run"]].map(([id, title]) => `<button id="workflow-tab-${id}" role="tab" aria-controls="workflow-panel" aria-selected="false" data-tab="${id}">${title}</button>`).join("")}</nav>
    <div class="workflow-status" role="status" aria-live="polite" data-status hidden></div><section id="workflow-panel" role="tabpanel" data-content></section>
  </div>`;
  document.body.append(modal);
  const content = modal.querySelector("[data-content]");
  const status = modal.querySelector("[data-status]");
  let activeTab = "diagram", renderVersion = 0, controller = null, disposed = false, returnFocus = null, graphEditor = null;
  let switchingTab = false, closingPromise = null;
  const showStatus = (message, error = false) => { status.hidden = false; status.textContent = message; status.classList.toggle("error", error); };
  const safe = (task) => async (...args) => { try { await task(...args); } catch (error) { showStatus(error.message || String(error), true); } };
  const request = (path, options) => backendApi.request(path, { signal: controller?.signal, ...options });
  const pretty = (value) => escape(JSON.stringify(value, null, 2));
  const scopeText = () => JSON.stringify(getScope());
  // Adding knowledge here is independent of whichever conversation is open.
  const knowledgeScope = { builtin: true, workspace_ids: [], chat_ids: [] };
  const documentScopeLabel = (doc) => ({ builtin: "Dùng chung cho mọi chat", workspace: "Riêng Workspace", chat: "Riêng chat đã nhập" })[doc.scope_kind] || "Chưa rõ phạm vi";

  function writeDocument() {
    // Same ingestion/verification path as file uploads; no direct index writes.
    const scopeValue = knowledgeScope, scope = JSON.stringify(scopeValue), profile = selectedEmbeddingProfile();
    return openKnowledgeContent({
      title: "Tài liệu mới", source: "", editable: true, startEditing: true,
      saveLabel: "Lưu và nhập vào kho",
      emptySaveLabel: "Tạo tài liệu trống",
      allowEmpty: true,
      note: "Tài liệu trong kho được dùng chung cho mọi chat. Chỉ cần nhập tên để tạo tài liệu trống; nội dung có thể bổ sung sau trong sơ đồ dataset.",
      onSave: async ({ title, source }) => {
        if (!source.trim()) {
          const result = await request("/documents/blank", { method: "POST", body: { title, scope: scopeValue } });
          await graphEditor?.addDocument(result.document);
          if (!graphEditor && activeTab === "documents") await render("documents");
          showStatus(`Đã tạo tài liệu trống “${title}”. Mở tài liệu trong sơ đồ dataset để thêm mục và dữ liệu.`);
          notify("Đã tạo tài liệu trống");
          return;
        }
        const filename = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100) + ".md";
        const body = new FormData();
        body.append("file", new File([source], filename, { type: "text/markdown" }));
        body.append("scope", scope); body.append("embedding_profile_id", profile || "");
        const result = await request("/documents", { method: "POST", body, timeout: 60000 });
        // Keep unsaved dataset layout intact; refresh is an explicit user action.
        showStatus(`Đã nhận “${title}”. Tải lại danh sách sau khi nhập xong. Job: ${result.run_id || result.id || "đang chuẩn bị"}`);
        notify("Đã nhận tài liệu thủ công");
        if (result.run_id) monitorIngestion(result.run_id);
      },
    });
  }

  async function render(tab = activeTab) {
    graphEditor?.dispose();
    graphEditor = null;
    activeTab = tab;
    const version = ++renderVersion;
    controller?.abort(); controller = new AbortController();
    status.hidden = true;
    modal.querySelectorAll("[data-tab]").forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      if (active) content.setAttribute("aria-labelledby", button.id);
    });
    content.innerHTML = "<p>Đang đọc Python Core…</p>";
    try {
      if (tab === "diagram") {
        graphEditor = createDatasetTreeEditor({
          request: (path, options) => backendApi.request(path, options),
          notify,
          confirmAction,
          onCreateDocument: writeDocument,
          onIngestionStarted: monitorIngestion,
        });
        await graphEditor.mount(content);
      } else if (tab === "overview") {
        const health = await request("/health");
        if (version !== renderVersion) return;
        const services = health.services || {};
        content.innerHTML = `<div class="workflow-grid">${[["Python Core", "127.0.0.1:8000", health.status || "online"], ["Ollama", "127.0.0.1:11434", services.ollama || health.ollama], ["Qdrant", "127.0.0.1:6333", services.qdrant || health.qdrant], ["Frontend", "127.0.0.1:3000", "online"]].map(([name, address, state]) => `<div class="workflow-card"><b>${name}</b><small>${address}</small><small class="workflow-health">${escape(serviceState(state))}</small></div>`).join("")}</div>
        <h3>DocumentIngestionGraph</h3><div class="workflow-flow">${flow(["Nhận tệp", "Trích xuất / OCR", "Kiểm tra công thức", "Chia đoạn", "Embedding", "Commit chỉ mục"])}</div>
        <h3>QueryReasoningGraph</h3><div class="workflow-flow">${flow(["Câu hỏi", "Phạm vi nguồn", "Lexical + vector", "Ngân sách", "Model / tools", "Đáp án + nguồn"])}</div>
        <div class="workflow-item"><b>Tài nguyên & hàng đợi</b><pre>${pretty(health.scheduler || health.resources || health.resource_manager || { note: "Trạng thái scheduler chưa được backend cung cấp." })}</pre></div>
        <div class="workflow-item"><b>Sao lưu dữ liệu v2</b><p>Sao lưu chat, workspace, tệp và kho RAG vào một gói. Model Ollama được lưu riêng.</p><button data-backup>Mở sao lưu và khôi phục</button></div>
        <button data-refresh>Làm mới trạng thái</button>`;
        content.querySelector("[data-refresh]").onclick = safe(() => render());
        content.querySelector("[data-backup]").onclick = safe(async () => { if (await close()) await openBackupManager(); });
      } else if (tab === "profiles") {
        const result = await request("/profiles/embedding");
        if (version !== renderVersion) return;
        const profiles = list(result, "profiles");
        content.innerHTML = `<div class="workflow-row"><label><span>Chế độ phản hồi (cùng model đã chọn)</span><select data-mode>${Object.values(REASONING_PROFILES).map((p) => `<option value="${p.id}" ${getMode() === p.id ? "selected" : ""}>${p.id} · ${p.label} · Thinking ${p.think ? "bật" : "tắt"}</option>`).join("")}</select></label><label><span>Embedding profile độc lập model chat</span><select data-embedding><option value="">Mặc định của Python Core</option>${profiles.map((p) => `<option value="${escape(p.id)}" ${selectedEmbeddingProfile() === p.id ? "selected" : ""}>${escape(p.name || p.id)} · ${escape(p.model_path || p.model || p.model_id || "")}</option>`).join("")}</select></label></div><p>Đổi profile dùng index generation riêng. Không tái sử dụng vector từ model khác, kể cả cùng số chiều.</p><div class="workflow-list">${profiles.map((p) => `<details class="workflow-item"><summary>${escape(p.name || p.id)}</summary><pre>${pretty(p)}</pre><button data-clone-profile="${escape(p.id)}">Nhân bản profile</button></details>`).join("")}</div><details class="workflow-item"><summary>Thêm / cập nhật profile embedding</summary><p>Nhập cấu hình profile hợp lệ; backend kiểm tra model, revision và encoding.</p><textarea data-profile-json spellcheck="false" placeholder='{"id":"my-profile","model_path":"C:/Models/embedding","model_revision":"local-v1","dimension":384}'></textarea><button data-save-profile>Lưu profile</button></details>`;
        content.querySelector("[data-mode]").onchange = (event) => setMode(event.target.value);
        const sourcePolicy = document.createElement("label");
        sourcePolicy.innerHTML = `<span>Nguồn trả lời mặc định</span><select data-source-policy><option value="documents-only">Chỉ dùng tài liệu đã nhập</option><option value="allow-model">Cho phép kiến thức model, ghi rõ phần bổ sung</option></select>`;
        content.querySelector(".workflow-row").append(sourcePolicy);
        const policySelect = sourcePolicy.querySelector("select");
        policySelect.value = localStorage.getItem(SOURCE_POLICY_KEY) === "allow-model" ? "allow-model" : "documents-only";
        policySelect.onchange = () => { localStorage.setItem(SOURCE_POLICY_KEY, policySelect.value); notify("Đã cập nhật nguồn trả lời cho các lượt tiếp theo"); };
        content.querySelector("[data-embedding]").onchange = (event) => { localStorage.setItem(EMBEDDING_KEY, event.target.value); notify("Đã chọn embedding profile cho truy vấn mới"); };
        content.querySelector("[data-save-profile]").onclick = safe(async () => { const body = JSON.parse(content.querySelector("[data-profile-json]").value); await request("/profiles/embedding", { method: "POST", body }); await render(); showStatus("Đã lưu profile; chỉ mục cũ không bị ghi đè."); });
        content.querySelectorAll("[data-clone-profile]").forEach((button) => button.onclick = safe(async () => { const source = button.dataset.cloneProfile; const suffix = Date.now().toString(36); await request(`/profiles/embedding/${encodeURIComponent(source)}/duplicate`, { method: "POST", body: { id: `${source}-copy-${suffix}`, name: `${source} · bản sao` } }); await render(); showStatus("Đã nhân bản profile. Hãy chỉnh model/revision trước khi tạo generation mới."); }));
      } else if (tab === "documents") {
        const result = await request("/documents");
        if (version !== renderVersion) return;
        const documents = list(result, "documents");
        content.innerHTML = `<p>Tài liệu thêm tại đây được dùng chung cho mọi chat.</p><div class="workflow-row"><input type="file" data-file accept=".pdf,.docx,.txt,.md,.json,.jsonl,.csv,.png,.jpg,.jpeg,.webp"><button data-upload>Nhập tài liệu</button><button data-refresh>Làm mới</button></div><div class="workflow-list">${documents.map((d) => `<article class="workflow-item"><b>${escape(d.title || d.name || d.id)}</b><small>${escape(documentScopeLabel(d))}</small><div class="workflow-row">${d.scope_kind !== "builtin" ? `<button data-share="${escape(d.id)}" data-version="${d.version}">Dùng cho mọi chat</button>` : ""}<button data-reindex="${escape(d.id)}">Tạo lại chỉ mục</button><button data-toggle="${escape(d.id)}" data-enabled="${d.enabled !== false}">${d.enabled === false ? "Bật nguồn" : "Tắt nguồn"}</button><button data-delete="${escape(d.id)}">Xóa</button></div>${d.error ? `<p>${escape(d.error)}</p>` : ""}</article>`).join("") || "<p>Chưa có tài liệu trong Python Core.</p>"}</div>`;
        content.querySelector("[data-refresh]").onclick = safe(() => render());
        content.querySelector("[data-upload]").onclick = safe(async () => { const file = content.querySelector("[data-file]").files[0]; if (!file) throw new Error("Hãy chọn một tài liệu."); const data = new FormData(); data.append("file", file); data.append("scope", JSON.stringify(knowledgeScope)); data.append("embedding_profile_id", selectedEmbeddingProfile() || ""); const result = await request("/documents", { method: "POST", body: data, timeout: 60000 }); await render(); showStatus(`Đã nhận tài liệu. Job nhập liệu: ${result.run_id || result.id || "đang chuẩn bị"}`); if (result.run_id) monitorIngestion(result.run_id); });
        content.querySelectorAll("[data-share]").forEach((button) => button.onclick = safe(async () => {
          const result = await request(`/documents/${encodeURIComponent(button.dataset.share)}/share`, { method: "POST", body: { version: Number(button.dataset.version) } });
          await render(); showStatus(result.storage?.warning || "Tài liệu đã dùng chung cho mọi chat.", Boolean(result.storage?.warning));
        }));
        const write = document.createElement("button"); write.type = "button"; write.textContent = "＋ Tạo tài liệu"; write.dataset.writeDocument = ""; write.onclick = writeDocument;
        content.querySelector("[data-upload]").after(write);
        const storageButton = document.createElement("button"); storageButton.textContent = "Lưu trữ / Thùng rác";
        storageButton.onclick = () => openKnowledgeStorage({request, notify, onChanged:() => render("documents")});
        write.after(storageButton);
        content.querySelectorAll("[data-delete]").forEach((button) => {
          const archive = document.createElement("button"); archive.textContent = "Lưu trữ";
          archive.onclick = safe(async () => {
            const doc = documents.find((item) => item.id === button.dataset.delete);
            if (!await confirmAction({title:`Lưu trữ “${doc.title}”?`, message:"Tài liệu sẽ nằm trong thư mục lưu trữ và ngừng dùng làm nguồn trả lời. Có thể khôi phục khi cần."})) return;
            const result = await request(`/documents/${encodeURIComponent(doc.id)}/lifecycle`, {method:"POST", body:{state:"archived", version:doc.version}});
            await render(); if (result.storage?.warning) showStatus(result.storage.warning, true);
          });
          button.before(archive);
        });
        content.querySelectorAll("[data-reindex]").forEach((b) => b.onclick = safe(async () => { const result = await request(`/documents/${encodeURIComponent(b.dataset.reindex)}/reindex`, { method: "POST", body: { embedding_profile_id: selectedEmbeddingProfile() } }); showStatus(`Đã xếp hàng tạo lại chỉ mục: ${result?.run_id || ""}`); if (result?.run_id) monitorIngestion(result.run_id); }));
        content.querySelectorAll("[data-toggle]").forEach((b) => b.onclick = safe(async () => { await request(`/documents/${encodeURIComponent(b.dataset.toggle)}`, { method: "PATCH", body: { enabled: b.dataset.enabled !== "true" } }); await render(); }));
        content.querySelectorAll("[data-delete]").forEach((b) => b.onclick = safe(async () => { if (!await confirmAction({ title: "Xóa tài liệu?", message: "Tài liệu sẽ chuyển vào Thùng rác và ngừng dùng làm nguồn trả lời. Có thể khôi phục từ Lưu trữ / Thùng rác." })) return; const doc = documents.find((item) => item.id === b.dataset.delete); const result = await request(`/documents/${encodeURIComponent(doc.id)}/lifecycle`, { method: "POST", body:{state:"trashed", version:doc.version} }); await render(); if (result.storage?.warning) showStatus(result.storage.warning, true); }));
      } else if (tab === "formulas") {
        const result = await request("/formulas?status=NEEDS_REVIEW");
        if (version !== renderVersion) return;
        content.innerHTML = `<p>Công thức chờ duyệt hoặc đã loại bỏ không được dùng trong RAG thông thường, nhưng dữ liệu trong bảng (ví dụ tỉ lệ 10W87/570KT) không bị chặn; syntax hợp lệ không có nghĩa nội dung toán học đã được chứng minh đúng.</p><button data-refresh>Làm mới</button><div class="workflow-list">${list(result, "formulas").map((f) => `<article class="workflow-item" data-formula="${escape(f.id)}"><b>${escape(f.name || f.id)}</b><small>${escape(f.source?.document_title || f.source?.document_id || "")}</small><pre>${escape(f.raw_latex || "")}</pre><label>LaTeX đã chuẩn hóa<textarea data-latex spellcheck="false">${escape(f.normalized_latex || "")}</textarea></label><details><summary>Kết quả kiểm tra & nguồn</summary><pre>${pretty(f.verification || f.verification_metadata || f)}</pre></details><div class="workflow-row"><button data-review="VERIFIED">Xác nhận đã kiểm tra</button><button data-review="REJECTED">Loại bỏ</button></div></article>`).join("") || "<p>Không có công thức đang chờ duyệt.</p>"}</div>`;
        content.querySelector("[data-refresh]").onclick = safe(() => render());
        content.querySelectorAll("[data-formula]").forEach((item) => {
          const raw = item.querySelector("pre"), input = item.querySelector("[data-latex]");
          const preview = document.createElement("div"); preview.className = "knowledge-rich-content knowledge-display-math";
          const update = () => { preview.innerHTML = renderFormula(input.value || raw.textContent); };
          raw.before(preview); const details = document.createElement("details"), summary = document.createElement("summary"); summary.textContent = "LaTeX gốc"; details.append(summary, raw); preview.after(details);
          input.addEventListener("input", update); update();
        });
        content.querySelectorAll("[data-review]").forEach((b) => b.onclick = safe(async () => { const item = b.closest("[data-formula]"); await request(`/formulas/${encodeURIComponent(item.dataset.formula)}/review`, { method: "POST", body: { status: b.dataset.review, normalized_latex: item.querySelector("[data-latex]").value } }); await render(); }));
      } else if (tab === "preview") {
        content.innerHTML = `<p>Thử tìm nguồn mà không gọi model sinh câu trả lời. Phạm vi: <code>${escape(scopeText())}</code></p><textarea data-query placeholder="Nhập câu hỏi cần tìm tài liệu…"></textarea><div class="workflow-row"><button data-preview>Tìm nguồn</button></div><div data-hits class="workflow-list"></div>`;
        content.querySelector("[data-preview]").onclick = safe(async () => { const query = content.querySelector("[data-query]").value.trim(); if (!query) return; const result = await request("/retrieval/preview", { method: "POST", body: { query, scope: getScope(), mode: getMode(), embedding_profile_id: selectedEmbeddingProfile() } }); content.querySelector("[data-hits]").innerHTML = `<pre class="workflow-item">${pretty(result)}</pre>`; });
      } else {
        const result = await request("/runs");
        if (version !== renderVersion) return;
        const runs = list(result, "runs");
        content.innerHTML = `<div class="workflow-row"><p>DocumentIngestionGraph và QueryReasoningGraph có vòng đời, state và checkpoint riêng.</p><button data-refresh>Làm mới</button></div><div class="workflow-list">${runs.map((run) => `<article class="workflow-item"><b>${escape(run.kind)} · ${escape(run.stage)}</b><small>${escape(run.run_id)} · ${run.terminal ? "đã kết thúc" : "đang chạy"} · ${escape(run.events)} sự kiện</small>${run.terminal ? "" : `<button data-cancel="${escape(run.run_id)}">Dừng run</button>`}</article>`).join("") || "<p>Chưa có run trong phiên backend này.</p>"}</div>`;
        content.querySelector("[data-refresh]").onclick = safe(() => render());
        content.querySelectorAll("[data-cancel]").forEach((button) => button.onclick = safe(async () => { await backendApi.cancel(button.dataset.cancel); await render(); }));
      }
    } catch (error) {
      if (version !== renderVersion) return;
      content.innerHTML = "<p>Chưa đọc được chức năng này. Dữ liệu đang có trong ứng dụng vẫn được giữ nguyên.</p>";
      showStatus(error.message, true);
    }
  }
  const flow = (steps) => steps.map((step) => `<span>${step}</span>`).join("<i>→</i>");
  async function monitorIngestion(runId) {
    try { await backendApi.events(runId, (event) => { if (disposed || !modal.classList.contains("open")) return; showStatus(`DocumentIngestionGraph · ${event.stage || event.type}${event.progress == null ? "" : ` · ${Math.round(event.progress * (event.progress <= 1 ? 100 : 1))}%`}\n${event.message || ""}`, event.type === "error"); }); } catch (error) { if (!disposed) showStatus(error.message, true); }
  }
  async function switchTab(tab) {
    if (switchingTab || tab === activeTab) return;
    switchingTab = true;
    try {
      if (graphEditor?.hasUnsaved() && !await graphEditor.confirmDiscard()) return;
      await render(tab);
      modal.querySelector(`[data-tab="${CSS.escape(tab)}"]`)?.focus({ preventScroll: true });
    } finally {
      switchingTab = false;
    }
  }
  const close = ({ force = false } = {}) => {
    if (closingPromise) return closingPromise;
    closingPromise = (async () => {
      if (!modal.classList.contains("open")) return true;
      if (!force && graphEditor?.hasUnsaved() && !await graphEditor.confirmDiscard()) return false;
      graphEditor?.dispose();
      graphEditor = null;
      modal.classList.remove("open");
      controller?.abort();
      returnFocus?.focus?.({ preventScroll: true });
      returnFocus = null;
      return true;
    })().finally(() => { closingPromise = null; });
    return closingPromise;
  };
  modal.querySelector("[data-close]").onclick = () => void close();
  modal.onclick = (event) => { if (event.target === modal) void close(); };
  modal.onkeydown = (event) => {
    if (event.defaultPrevented) return;
    if (event.key === "F11" && graphEditor) { event.preventDefault(); event.stopPropagation(); graphEditor.toggleFullscreen(); return; }
    if (event.key === "Escape" && graphEditor?.isFullscreen()) { event.preventDefault(); event.stopPropagation(); graphEditor.toggleFullscreen(false); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && graphEditor) { event.preventDefault(); event.stopPropagation(); void safe(() => graphEditor.save())(); return; }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); void close(); }
  };
  const tabButtons = [...modal.querySelectorAll("[data-tab]")];
  tabButtons.forEach((button) => {
    button.onclick = safe(() => switchTab(button.dataset.tab));
    button.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let index = tabButtons.indexOf(button);
      if (event.key === "Home") index = 0;
      else if (event.key === "End") index = tabButtons.length - 1;
      else index = (index + (event.key === "ArrowRight" ? 1 : -1) + tabButtons.length) % tabButtons.length;
      void safe(() => switchTab(tabButtons[index].dataset.tab))();
    };
  });
  return {
    open: () => {
      if (modal.classList.contains("open")) {
        modal.querySelector("[role='tab'][aria-selected='true']")?.focus({ preventScroll: true });
        return Promise.resolve();
      }
      returnFocus = document.activeElement;
      modal.classList.add("open");
      setTimeout(() => modal.querySelector("[data-close]").focus(), 0);
      return render();
    },
    close,
    isOpen: () => modal.classList.contains("open"),
    dispose: () => { disposed = true; graphEditor?.dispose(); controller?.abort(); modal.remove(); },
  };
}
