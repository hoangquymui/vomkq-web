import "./styles.css";
import "./attachments.css";
import katex from "katex";
import "katex/dist/katex.min.css";
import "./math.css";
import "./commands.css";
import "./typography.css";
import "./workspaces.css";
import "./visuals.css";
import "./artifacts.css";
import "./ui-polish.css";
import "./backup.css";
import "./knowledge-manager.css";
import { renderKnowledge } from "./knowledge-content.js";
import { prepareChatTables } from "./chat-tables.js";
import "./chat-tables.css";
import { openKnowledgeContent } from "./knowledge-content-editor.js";
import "./startup.css";
import "./results.css";
import "./answer-draft.css";
import {
  builtinReferenceContext,
  getBuiltinKnowledgePreferences,
  listBuiltinKnowledgeDocuments,
  loadBuiltinKnowledge,
  replaceBuiltinKnowledgePreferences,
  restoreBuiltinKnowledgeChunk,
  restoreBuiltinKnowledgeDocument,
  updateBuiltinKnowledgeChunk,
  updateBuiltinKnowledgeDocument,
} from "./builtin-knowledge.js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createVisualRenderer, lazyResource } from "./visual-resources.js";
import { createWorkspaceStorage } from "./workspace-storage.js";
import { backendApi } from "./backend-api.js";
import { REASONING_MODE_KEY, REASONING_PROFILES, normalizeReasoningMode, readReasoningMode } from "./reasoning-profiles.js";
import { createWorkflowManager, selectedEmbeddingProfile } from "./workflow-manager.js";
import { receiveLegacyMigration } from "./legacy-migration.js";
import { createBackupRestore } from "./backup-restore.js";
import { createConversationPersistence } from "./conversation-persistence.js";
import { isExplicitUserStop } from "./generation-status.js";
import { onlyDocumentSources, DOCUMENT_SOURCE_INSTRUCTION, MODEL_SOURCE_INSTRUCTION } from "./source-policy.js";
import "./design-system.css";

const QUICK_MODEL = "hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M";
const MODEL = QUICK_MODEL;
const STORAGE_KEY = "vector.ai.chats.v1";
const WORKSPACE_KEY = "vector.ai.workspaces.v1";
const ACTIVE_WORKSPACE_KEY = "vector.ai.active-workspace.v1";
const GENERAL_CHAT_KEY = "vector.ai.general-chats.v1";
const REASONING_KEY = "vector.ai.reasoning.v1";
const ACTIVE_MODEL_KEY = "vector.ai.active-model.v1";
const QUICK_MODEL_KEY = "vector.ai.quick-model.v1";
const DEEP_MODEL_KEY = "vector.ai.deep-model.v1";
const WORKSPACE_DB = "vector-ai-workspace-files";
const QUICK_CONTEXT = 8192;
const DEEP_CONTEXT = 16384;
const INITIAL_MODE = readReasoningMode(localStorage);
const INITIAL_REASONING = REASONING_PROFILES[INITIAL_MODE].think;
// Các khóa quick/deep được đọc để tương thích dữ liệu cũ; từ đây chỉ có một model chat.
const INITIAL_MODEL = localStorage.getItem(ACTIVE_MODEL_KEY)
  || localStorage.getItem(QUICK_MODEL_KEY)
  || localStorage.getItem(DEEP_MODEL_KEY)
  || QUICK_MODEL;
const DRAFT_PAINT_INTERVAL = 110;
const ANSWER_STREAM_PAINT_INTERVAL = 280;
const ANSWER_STREAM_MIN_CHARS = 32;
const LATEX_CACHE_LIMIT = 400;
const draftRenderStates = new WeakMap();
const latexRenderCache = new Map();
const RESULT_INSTRUCTION = " Với đề có nhiều yêu cầu đánh số, phải giải đủ từng yêu cầu và tự kiểm đếm lại trước khi kết luận. Chỉ sau khi hoàn tất toàn bộ yêu cầu mới tạo đúng một khối :::result duy nhất ở cuối phản hồi; mỗi yêu cầu có ít nhất một dòng và bắt buộc theo dạng Tên đại lượng | Giá trị và đơn vị; đóng khối bằng :::. Cột tên phải dùng tên ngắn gọn, cụ thể mà người dùng cần xem, ví dụ Gạo, Thịt, Cá, Rau hoặc Vận tốc, Thời gian; không dùng nhãn chung như Câu 1, Mục 1, Kết quả. Không chèn dòng 'Tên đại lượng | Giá trị' hay bảng kết quả tạm giữa các bước, không tạo khối kết quả sau từng câu, không đưa bước biến đổi vào khối và không viết thêm nội dung sau dấu đóng.";
const OUTPUT_SAFETY_INSTRUCTION = " Trước khi trả lời dài, hãy ước lượng dung lượng: dành ít nhất 15% phần cuối để hoàn tất công thức đang viết, đóng mọi delimiter LaTeX/khối mã, nêu kết luận ngắn và bảng kết quả. Khi không đủ chỗ, dừng sau một câu hoặc công thức hoàn chỉnh và ghi ‘Còn tiếp’; tuyệt đối không bắt đầu công thức mới ở sát giới hạn.";
const inTauri = Boolean(window.__TAURI_INTERNALS__);
let statusRefreshVersion = 0;
let restoreBlocked = false;
let persistenceReady = false;
let zipApi;
let mammothApi;
let docxApi;
const getMermaid = lazyResource(async () => {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({startOnLoad:false,theme:"dark",securityLevel:"strict",fontFamily:"Segoe UI, sans-serif",flowchart:{htmlLabels:false,curve:"basis"}});
  return mermaid;
});
const getChart = lazyResource(async () => (await import("chart.js/auto")).default);
const visualRenderer = createVisualRenderer({ loadChart: getChart, loadMermaid: getMermaid });
let artifactPreviewVersion = 0;
async function getZip(){if(!zipApi)zipApi=(await import("jszip")).default;return zipApi;}
async function getMammoth(){if(!mammothApi){const module=await import("mammoth/mammoth.browser");mammothApi=module.default||module;}return mammothApi;}
async function getDocx(){if(!docxApi)docxApi=await import("docx");return docxApi;}

const BRAND_MARK = `<svg class="brand-mark" viewBox="0 0 48 48" aria-hidden="true">
  <path class="brand-mark-ring" d="M24 3.5 41.8 13.7v20.6L24 44.5 6.2 34.3V13.7L24 3.5Z"/>
  <path class="brand-mark-v" d="m13.5 15.5 8.7 20.2c.7 1.6 2.9 1.6 3.6 0l8.7-20.2M17.5 15.5 24 30.7l6.5-15.2"/>
  <path class="brand-mark-beam" d="M24 8.5v7M9.8 31.8l6.2-3.6m22.2 3.6L32 28.2"/>
  <circle cx="24" cy="8.5" r="2.2"/><circle cx="9.8" cy="31.8" r="2.2"/><circle cx="38.2" cy="31.8" r="2.2"/>
</svg>`;

document.querySelector("#app").innerHTML = `
  <div class="app-intro" id="appIntro"><div class="intro-emblem brand-logo">${BRAND_MARK}</div><b>VECTOR AI</b><small>LOCAL INTELLIGENCE</small><i></i></div>
  <div class="ambient"></div>
  <div class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><div class="logo brand-logo">${BRAND_MARK}</div><div><b>VECTOR</b><small>LOCAL INTELLIGENCE</small></div><button class="ghost mobile" id="closeSide">×</button></div>
      <div class="workspace-switcher"><button id="workspaceButton"><span class="workspace-icon">C</span><span><small id="workspaceType">CHẾ ĐỘ CHAT</small><b id="workspaceName">Chat thường</b></span><em>⌄</em></button><div class="workspace-menu" id="workspaceMenu"><div id="workspaceList"></div><div class="workspace-actions"><button id="createWorkspace">＋ Tạo workspace</button><button id="renameWorkspace">✎ Đổi tên</button><button id="deleteWorkspace">⌫ Xóa</button></div></div></div>
      <button class="new-chat" id="newChat"><span>＋</span> Cuộc trò chuyện mới <kbd>Ctrl K</kbd></button>
      <label class="search"><svg viewBox="0 0 24 24"><path d="m21 21-4.4-4.4m2.4-5.6a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"/></svg><input id="search" placeholder="Tìm cuộc trò chuyện"></label>
      <section class="workspace-files" id="workspaceFiles" hidden><div class="workspace-files-head"><span>TÀI LIỆU THAM CHIẾU</span><button id="addWorkspaceFiles" title="Thêm tài liệu">＋</button></div><label class="strict-reference"><span><b>Chỉ theo tài liệu</b><small>Không suy đoán ngoài nguồn</small></span><input id="strictReference" type="checkbox"><i></i></label><input id="workspaceFileInput" type="file" hidden multiple accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp,.txt,.md,.json,.jsonl,.csv,.js,.ts,.py,.rs,.html,.css,.yaml,.yml,.xml,.log"><div id="workspaceFileList"></div></section>
      <div class="section-title">GẦN ĐÂY</div><nav id="chatList" class="chat-list"></nav>
      <div class="side-footer">
        <button class="engine" id="engineButton"><i id="engineDot"></i><span><b id="engineTitle">Đang kiểm tra Ollama</b><small id="engineSub">Mô hình chạy trên thiết bị</small></span><em>›</em></button>
        <div class="model-mini"><div class="mini-logo brand-logo">${BRAND_MARK}</div><span><b id="sidebarModelName">Qwen3.5 9B</b><small id="sidebarModelMeta">Q4_K_M · Offline</small></span><button class="ghost icon-button" id="about" aria-label="Giới thiệu VECTOR AI" title="Giới thiệu VECTOR AI"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></button></div>
      </div>
    </aside>
    <div class="scrim" id="scrim"></div>
    <main class="main">
      <header class="topbar">
        <button class="ghost menu" id="openSide"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
        <button class="model-head" id="modelHead"><div class="model-icon brand-logo">${BRAND_MARK}</div><span><small>MÔ HÌNH SUY LUẬN</small><b id="activeModelName">Qwen3.5 9B</b></span><svg viewBox="0 0 24 24"><path d="m8 10 4 4 4-4"/></svg></button>
        <div class="top-right"><span class="offline"><i></i>100% OFFLINE</span><button class="ghost" id="dataManager" title="Quản lý dữ liệu"><svg viewBox="0 0 24 24"><path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg></button><button class="ghost" id="deleteChat" title="Xóa hội thoại"><svg viewBox="0 0 24 24"><path d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m3 0-1 14H7L6 7"/></svg></button></div>
      </header>
      <section class="conversation" id="conversation">
        <div class="welcome" id="welcome">
          <div class="orbit"><div class="core brand-logo">${BRAND_MARK}</div><i></i><i></i></div>
          <div class="eyebrow">VECTOR AI · TRỢ LÝ OFFLINE</div>
          <h1>Hôm nay bạn muốn<br><em>khám phá điều gì?</em></h1>
          <p>Suy luận mạnh mẽ ngay trên máy của bạn.<br>Dữ liệu riêng tư, phản hồi trực tiếp, không qua đám mây.</p>
          <div class="cards">
            <button data-prompt="Giải thích khái niệm sau theo cách thật dễ hiểu: "><b>⌁</b><span><strong>Giải thích kiến thức</strong><small>Biến vấn đề khó thành dễ hiểu</small></span></button>
            <button data-prompt="Hãy giải bài toán sau từng bước và kiểm tra kết quả: "><b>∑</b><span><strong>Giải toán từng bước</strong><small>Công thức rõ ràng, đáp số chính xác</small></span></button>
            <button data-prompt="Hãy phân tích và cải thiện nội dung sau: "><b>✦</b><span><strong>Phân tích nội dung</strong><small>Tóm tắt, đánh giá và cải thiện</small></span></button>
          </div>
        </div>
        <div class="messages" id="messages"></div>
        <button class="scroll-latest" id="scrollLatest" aria-label="Cuộn tới tin nhắn mới nhất" title="Tin nhắn mới nhất"><svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg></button>
      </section>
      <footer class="composer-area">
        <div class="composer"><div class="slash-menu" id="slashMenu"></div><div class="attachment-preview" id="attachmentPreview"></div><textarea id="prompt" rows="1" placeholder="Nhắn tin cho VECTOR AI..."></textarea><div class="composer-row"><div><button class="attach" id="attachButton" aria-label="Đính kèm tệp" title="Gửi ảnh, DOCX hoặc tệp">＋</button><input id="fileInput" type="file" hidden multiple accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp,image/gif,.txt,.md,.json,.jsonl,.csv,.js,.ts,.jsx,.tsx,.py,.rs,.html,.css,.yaml,.yml,.xml,.log"><button class="reason" id="reasoningToggle" type="button" title="Bật cho bài toán hoặc câu hỏi phức tạp"><i></i><span>Trả lời nhanh</span></button></div><button id="send" class="send" aria-label="Gửi tin nhắn"><svg viewBox="0 0 24 24"><path d="m5 12 14-8-4 16-3-6-7-2Zm7 2 7-10"/></svg><span></span></button></div></div>
        <div class="context-status" id="contextStatus"><div class="context-track"><i id="contextFill"></i></div><span id="contextText">Ngữ cảnh 0%</span><button id="carryChat" type="button">Chat mới + tóm tắt</button></div>
        <p class="disclaimer">VECTOR AI có thể mắc lỗi. Hãy kiểm tra thông tin quan trọng. <span>Toàn bộ xử lý diễn ra trên thiết bị.</span></p>
      </footer>
    </main>
    <aside class="artifact-panel" id="artifactPanel" aria-hidden="true"><header><span><small>VECTOR ARTIFACT</small><b id="artifactTitle">Nội dung</b></span><button id="closeArtifact" aria-label="Đóng Artifact">×</button></header><nav><button class="active" data-artifact-tab="preview">Xem trước</button><button data-artifact-tab="source">Mã nguồn</button></nav><div class="artifact-body"><div class="artifact-preview" id="artifactPreview"></div><textarea class="artifact-source" id="artifactSource" spellcheck="false" hidden></textarea></div><footer><button id="copyArtifact">Sao chép</button><button id="downloadArtifact">Tải xuống</button></footer></aside>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite" aria-atomic="true"></div>
  <div class="modal-layer" id="setupModal"><div class="setup-box" role="dialog" aria-modal="true" aria-labelledby="setupTitle">
    <div class="setup-logo logo brand-logo">${BRAND_MARK}</div><div class="setup-step">THIẾT LẬP VECTOR AI</div><h2 id="setupTitle">Chuẩn bị bộ máy suy luận</h2><p id="setupText">Đang kiểm tra Ollama và Qwen3.5 trên thiết bị...</p>
    <div class="progress-wrap" id="progressWrap"><div class="progress"><span id="progressBar"></span></div><div class="progress-meta"><span id="progressStatus">Đang kiểm tra</span><b id="progressPercent">0%</b></div></div>
    <button class="primary" id="setupAction" hidden>Tiếp tục</button><button class="text-button" id="setupLater">Để sau</button>
  </div></div>
  <div class="modal-layer" id="aboutModal"><div class="about-box" role="dialog" aria-modal="true" aria-labelledby="aboutTitle"><button class="modal-close" id="closeAbout" aria-label="Đóng">×</button><div class="logo large brand-logo">${BRAND_MARK}</div><h2 id="aboutTitle">VECTOR AI</h2><p>Trợ lý suy luận offline, riêng tư và mạnh mẽ với model bạn lựa chọn.</p><div class="specs"><span>Mô hình<b id="aboutModelName">Qwen3.5 9B</b></span><span>Lượng tử hóa<b id="aboutModelQuant">Q4_K_M</b></span><span>Chuỗi suy luận<b>Theo chế độ</b></span><span>Kết nối<b>Localhost</b></span></div></div></div>
<div class="modal-layer" id="modelModal"><div class="model-manager" role="dialog" aria-modal="true" aria-labelledby="modelManagerTitle"><button class="modal-close" id="closeModels" aria-label="Đóng">×</button><div class="model-manager-title"><div class="model-icon brand-logo">${BRAND_MARK}</div><span><small>BỘ MÁY SUY LUẬN</small><h2 id="modelManagerTitle">Quản lý model</h2></span></div><p>Chọn một model dùng chung cho cả ba chế độ phản hồi. Embedding được quản lý độc lập trong workflow RAG.</p><div class="installed-models" id="installedModels"><div class="model-loading">Đang đọc thư viện Ollama…</div></div><div class="model-download"><label for="modelInput">TẢI MODEL TỪ OLLAMA</label><div><input id="modelInput" placeholder="Ví dụ: qwen3:4b"><button id="downloadModel">Tải xuống</button></div><section id="modelDownloadProgress" role="status" aria-live="polite" hidden><i><span></span></i><small>Đang chuẩn bị…</small></section></div><div class="model-backup-installer"><label for="backupModelName">CÀI MODEL FINE-TUNE TỪ BACKUP.ZIP</label><p>Hỗ trợ gói được tạo bởi notebook Qwen3.5: GGUF + Modelfile + adapter. VECTOR AI sẽ tự lấy file GGUF hoàn chỉnh.</p><div><input id="backupModelName" value="vector-ai-finetuned" maxlength="120" spellcheck="false"><button id="installModelBackup">Chọn backup.zip</button></div><section id="modelBackupProgress" role="status" aria-live="polite" hidden><i><span></span></i><small>Đang chuẩn bị…</small></section></div></div></div>
  <div class="modal-layer" id="dataModal"><div class="data-manager knowledge-data-manager" role="dialog" aria-modal="true" aria-labelledby="dataManagerTitle"><button class="modal-close" id="closeDataManager" aria-label="Đóng">×</button><div class="data-title"><div class="data-icon"><svg viewBox="0 0 24 24"><path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg></div><span><small>DỮ LIỆU CỤC BỘ</small><h2 id="dataManagerTitle">Quản lý dữ liệu</h2></span></div><p class="data-description">Kiểm soát nguồn kiến thức được VECTOR AI sử dụng và sao lưu dữ liệu cá nhân của bạn.</p><nav class="data-tabs"><button class="active" data-data-tab="knowledge">Dữ liệu mặc định <span id="knowledgeTabCount">3</span></button><button data-data-tab="backup">Sao lưu & khôi phục</button></nav><section class="data-pane knowledge-pane" id="knowledgePane"><div id="knowledgeOverview"><div class="knowledge-summary" id="knowledgeSummary"><span>Đang đọc kho kiến thức…</span></div><div class="knowledge-list" id="knowledgeList"><div class="knowledge-loading">Đang tải danh sách tài liệu…</div></div><div class="data-note knowledge-note">Tắt hoặc xóa một nguồn chỉ ảnh hưởng các câu trả lời mới. Tài liệu gốc vẫn được giữ an toàn trong gói ứng dụng để bạn có thể khôi phục.</div></div><div class="knowledge-editor" id="knowledgeEditor" hidden><header><button type="button" id="closeKnowledgeEditor" aria-label="Quay lại">←</button><span><small>ĐIỀU CHỈNH NGUỒN</small><b id="knowledgeEditorHeading">Tài liệu</b></span></header><label class="knowledge-field"><span>Tên hiển thị</span><input id="knowledgeTitleInput" maxlength="120"></label><div class="knowledge-chunk-toolbar"><label><span>Đoạn dữ liệu</span><select id="knowledgeChunkSelect"></select></label><em id="knowledgeChunkState">Bản gốc</em></div><label class="knowledge-field knowledge-content-field"><span>Nội dung dùng để truy xuất</span><textarea id="knowledgeChunkText" spellcheck="false"></textarea></label><div class="knowledge-editor-actions"><button type="button" id="restoreKnowledgeChunk">Khôi phục đoạn</button><button type="button" id="resetKnowledgeDocument">Khôi phục toàn bộ</button><button type="button" class="primary" id="saveKnowledgeDocument">Lưu thay đổi</button></div><p>Chỉ sửa khi cần hiệu chỉnh dữ kiện hoặc công thức. Thay đổi được lưu riêng, không ghi đè file DOCX gốc.</p></div></section><section class="data-pane backup-pane" id="backupPane" hidden><p>Đóng gói hội thoại, workspace, tài liệu tham chiếu, các điều chỉnh dữ liệu mặc định và thiết lập vào một file duy nhất.</p><div class="data-options"><button id="exportBackup"><b>Xuất bản sao lưu</b><small>Lưu toàn bộ dữ liệu VECTOR AI ra file ZIP</small></button><button id="importBackup"><b>Nhập bản sao lưu</b><small>Khôi phục dữ liệu từ một file đã xuất trước đó</small></button></div><input id="backupFileInput" type="file" hidden accept=".zip,application/zip"><div class="backup-status" id="backupStatus" hidden><div><i id="backupProgress"></i></div><span id="backupStatusText">Đang chuẩn bị…</span></div><div class="data-note">Model Ollama không nằm trong backup để tránh file nặng nhiều GB. VECTOR AI lưu model dùng chung và chế độ Nhanh/Cân bằng/Sâu hiện tại.</div></section></div></div>
  <div class="modal-layer" id="confirmModal"><div class="confirm-box" id="confirmBox" role="alertdialog" aria-modal="true" aria-labelledby="confirmTitle" aria-describedby="confirmMessage"><div class="confirm-symbol"><svg viewBox="0 0 24 24"><path d="M12 8v5m0 3h.01M10.3 4.5 2.7 18a2 2 0 0 0 1.75 3h15.1a2 2 0 0 0 1.75-3L13.7 4.5a2 2 0 0 0-3.4 0Z"/></svg></div><small id="confirmEyebrow">XÁC NHẬN THAO TÁC</small><h2 id="confirmTitle">Bạn có chắc không?</h2><p id="confirmMessage"></p><div class="confirm-actions"><button id="confirmCancel">Hủy</button><button id="confirmAccept">Xác nhận</button></div></div></div>
  <div class="modal-layer" id="inputModal"><form class="input-box" id="inputBox" role="dialog" aria-modal="true" aria-labelledby="inputTitle" aria-describedby="inputMessage"><div class="input-symbol"><svg viewBox="0 0 24 24"><path d="M4 6h6l2 2h8v10H4V6Z"/><path d="M8 13h8M12 9v8"/></svg></div><small id="inputEyebrow">WORKSPACE</small><h2 id="inputTitle">Đặt tên workspace</h2><p id="inputMessage">Tên giúp bạn phân biệt các nhóm tài liệu và hội thoại.</p><label class="input-field"><span>Tên workspace</span><input id="inputValue" maxlength="40" autocomplete="off"></label><div class="confirm-actions"><button type="button" id="inputCancel">Hủy</button><button type="submit" id="inputAccept">Xác nhận</button></div></form></div>
`;

const $ = (q) => document.querySelector(q);
const ui = {
  sidebar: $("#sidebar"),
  scrim: $("#scrim"),
  list: $("#chatList"),
  search: $("#search"),
  welcome: $("#welcome"),
  messages: $("#messages"),
  conversation: $("#conversation"),
  prompt: $("#prompt"),
  send: $("#send"),
  slashMenu: $("#slashMenu"),
  fileInput: $("#fileInput"),
  attachmentPreview: $("#attachmentPreview"),
  toast: $("#toast"),
  setup: $("#setupModal"),
  setupTitle: $("#setupTitle"),
  setupText: $("#setupText"),
  setupAction: $("#setupAction"),
  setupLater: $("#setupLater"),
  progressWrap: $("#progressWrap"),
  progressBar: $("#progressBar"),
  progressStatus: $("#progressStatus"),
  progressPercent: $("#progressPercent"),
  engineDot: $("#engineDot"),
  engineTitle: $("#engineTitle"),
  engineSub: $("#engineSub"),
  workspaceButton: $("#workspaceButton"),
  workspaceName: $("#workspaceName"),
  workspaceType: $("#workspaceType"),
  workspaceMenu: $("#workspaceMenu"),
  workspaceList: $("#workspaceList"),
  scrollLatest: $("#scrollLatest"),
  reasoningToggle: $("#reasoningToggle"),
  contextStatus: $("#contextStatus"),
  contextFill: $("#contextFill"),
  contextText: $("#contextText"),
  carryChat: $("#carryChat"),
  workspaceFiles: $("#workspaceFiles"),
  workspaceFileInput: $("#workspaceFileInput"),
  workspaceFileList: $("#workspaceFileList"),
  strictReference: $("#strictReference"),
  modelModal: $("#modelModal"),
  installedModels: $("#installedModels"),
  modelInput: $("#modelInput"),
  modelDownloadProgress: $("#modelDownloadProgress"),
  backupModelName: $("#backupModelName"),
  modelBackupProgress: $("#modelBackupProgress"),
  activeModelName: $("#activeModelName"),
  artifactPanel: $("#artifactPanel"),
  artifactPreview: $("#artifactPreview"),
  artifactSource: $("#artifactSource"),
  artifactTitle: $("#artifactTitle"),
  dataModal: $("#dataModal"),
  knowledgePane: $("#knowledgePane"),
  backupPane: $("#backupPane"),
  knowledgeOverview: $("#knowledgeOverview"),
  knowledgeSummary: $("#knowledgeSummary"),
  knowledgeList: $("#knowledgeList"),
  knowledgeTabCount: $("#knowledgeTabCount"),
  knowledgeEditor: $("#knowledgeEditor"),
  knowledgeEditorHeading: $("#knowledgeEditorHeading"),
  knowledgeTitleInput: $("#knowledgeTitleInput"),
  knowledgeChunkSelect: $("#knowledgeChunkSelect"),
  knowledgeChunkState: $("#knowledgeChunkState"),
  knowledgeChunkText: $("#knowledgeChunkText"),
  sidebarModelName: $("#sidebarModelName"),
  sidebarModelMeta: $("#sidebarModelMeta"),
  aboutModelName: $("#aboutModelName"),
  aboutModelQuant: $("#aboutModelQuant"),
  backupFileInput: $("#backupFileInput"),
  backupStatus: $("#backupStatus"),
  backupProgress: $("#backupProgress"),
  backupStatusText: $("#backupStatusText"),
  confirmModal: $("#confirmModal"),
  confirmTitle: $("#confirmTitle"),
  confirmMessage: $("#confirmMessage"),
  confirmAccept: $("#confirmAccept"),
  confirmBox: $("#confirmBox"),
  inputModal: $("#inputModal"),
  inputBox: $("#inputBox"),
  inputTitle: $("#inputTitle"),
  inputMessage: $("#inputMessage"),
  inputValue: $("#inputValue"),
  inputAccept: $("#inputAccept"),
};
const state = {
  workspaces: [],
  generalChats: [],
  activeWorkspaceId: null,
  chats: [],
  activeId: null,
  generating: false,
  requestId: null,
  unlisten: null,
  abortController: null,
  stopRequestedId: null,
  status: null,
  setupDismissed: false,
  attachments: [],
  reasoning: INITIAL_REASONING,
  mode: INITIAL_MODE,
  backend: null,
  backendRunId: null,
  editingMessageId: null,
  selectedModel: INITIAL_MODEL,
  installedModels: [],
  modelOperation: null,
  artifact: null,
  slashIndex: 0,
  knowledgeDocuments: [],
  knowledgeEditorDocumentId: null,
  knowledgeEditorChunkId: null,
};

const ACTION_ICONS = {
  copy: `<svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>`,
  edit: `<svg viewBox="0 0 24 24"><path d="M13.5 6.5 17.5 10.5M4 20l4.2-1 10.6-10.6a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z"/></svg>`,
  retry: `<svg viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.5-2L20 9M4 15l2.4 2a7 7 0 0 0 11.5-2"/></svg>`,
  verify: `<svg viewBox="0 0 24 24"><path d="M12 3 20 6v5c0 5.2-3.3 8.4-8 10-4.7-1.6-8-4.8-8-10V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>`,
  docx: `<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v5h4M9 12l1.5 5 1.5-3 1.5 3 1.5-5"/></svg>`,
};
function actionButton(action, label, icon) {
  return `<button class="action-icon" data-${action} aria-label="${label}" data-tooltip="${label}">${icon}</button>`;
}

let confirmResolver = null;
let confirmReturnFocus = null;
function confirmAction({ title = "Bạn có chắc không?", message, acceptLabel = "Xóa", danger = true }) {
  if (confirmResolver) confirmResolver(false);
  confirmReturnFocus = document.activeElement;
  ui.confirmTitle.textContent = title;
  ui.confirmMessage.textContent = message;
  ui.confirmAccept.textContent = acceptLabel;
  ui.confirmAccept.classList.toggle("danger", danger);
  ui.confirmBox.classList.toggle("danger-tone", danger);
  ui.confirmBox.classList.toggle("info-tone", !danger);
  ui.confirmModal.classList.add("open");
  setTimeout(() => (danger ? $("#confirmCancel") : ui.confirmAccept).focus(), 0);
  return new Promise((resolve) => { confirmResolver = resolve; });
}
function closeConfirm(result = false) {
  ui.confirmModal.classList.remove("open");
  const resolve = confirmResolver;
  confirmResolver = null;
  resolve?.(result);
  confirmReturnFocus?.focus?.({ preventScroll: true });
  confirmReturnFocus = null;
}

let inputResolver = null;
let inputReturnFocus = null;
function inputAction({ title, message, value = "", acceptLabel = "Xác nhận" }) {
  if (inputResolver) inputResolver(null);
  inputReturnFocus = document.activeElement;
  ui.inputTitle.textContent = title;
  ui.inputMessage.textContent = message;
  ui.inputValue.value = value;
  ui.inputValue.removeAttribute("aria-invalid");
  ui.inputAccept.textContent = acceptLabel;
  ui.inputModal.classList.add("open");
  setTimeout(() => { ui.inputValue.focus(); ui.inputValue.select(); }, 0);
  return new Promise((resolve) => { inputResolver = resolve; });
}
function closeInput(result = null) {
  ui.inputModal.classList.remove("open");
  const resolve = inputResolver;
  inputResolver = null;
  resolve?.(result);
  inputReturnFocus?.focus?.({ preventScroll: true });
  inputReturnFocus = null;
}

function trapModalFocus(event) {
  const openModals = Array.from(document.querySelectorAll(".modal-layer.open"));
  const modal = [ui.confirmModal, ui.inputModal].find((candidate) => candidate?.classList.contains("open")) || openModals.at(-1);
  if (!modal || event.key !== "Tab") return false;
  const focusable = Array.from(modal.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])'))
    .filter((element) => !element.hidden && element.getClientRects().length);
  if (!focusable.length) { event.preventDefault(); return true; }
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!modal.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
  return true;
}

const workspaceStorage = createWorkspaceStorage(WORKSPACE_DB);
const backupRestore = createBackupRestore({ journal: createWorkspaceStorage("vector-ai-restore-journal-v2"), storage: localStorage, files: workspaceStorage });
const conversationPersistence = createConversationPersistence({ api: backendApi, journal: createWorkspaceStorage("vector-ai-conversation-outbox-v1") });
const workspaceDbPut = workspaceStorage.put;
const workspaceDbDelete = workspaceStorage.delete;
const workspaceDbGetMany = workspaceStorage.getMany;
const workspaceDbGetAll = workspaceStorage.getAll;
const workspaceDbReplaceAll = workspaceStorage.replaceAll;

function backendScope() {
  return { builtin: true, workspace_ids: state.activeWorkspaceId ? [state.activeWorkspaceId] : [], chat_ids: state.activeId ? [state.activeId] : [] };
}
const workflowManager = createWorkflowManager({ getScope: backendScope, getMode: () => state.mode, setMode: selectReasoningMode, notify, confirmAction, openBackupManager: async () => { await openDataManager(); setDataManagerTab("backup"); } });
const workflowButton = document.createElement("button");
workflowButton.className = "ghost workflow-open icon-button";
workflowButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="5" r="2.2"/><circle cx="19" cy="12" r="2.2"/><path d="m6.8 10.7 3.4-4.3m3.6 0 3.4 4.3M7.2 13.1l3.2 4.1h3.2l3.2-4.1"/></svg>';
workflowButton.title = "Quản lý workflow RAG và tài liệu Python Core";
workflowButton.setAttribute("aria-label", workflowButton.title);
workflowButton.onclick = () => workflowManager.open();
$("#dataManager").before(workflowButton);
const modeSelect = document.createElement("select");
modeSelect.className = "reasoning-select";
modeSelect.setAttribute("aria-label", "Chế độ phản hồi");
modeSelect.innerHTML = Object.values(REASONING_PROFILES).map((profile) => `<option value="${profile.id}">${profile.label}</option>`).join("");
modeSelect.onchange = () => selectReasoningMode(modeSelect.value);
ui.reasoningToggle.before(modeSelect);
ui.reasoningToggle.hidden = true;
ui.modelModal.querySelector(".model-manager > p").textContent = "Chọn một model dùng chung cho cả ba chế độ: FAST và NORMAL tắt Thinking để phản hồi gọn, DEEP bật Thinking cho bài khó. Embedding được quản lý riêng trong workflow RAG.";
$("#aboutModal .specs").children[2].querySelector("b").textContent = "Theo chế độ";

function modelForMode() {
  return state.selectedModel || INITIAL_MODEL;
}
function modeLabel(mode = state.mode) {
  return REASONING_PROFILES[normalizeReasoningMode(mode)].label;
}
function syncActiveModel() {
  state.selectedModel = modelForMode();
  localStorage.setItem(ACTIVE_MODEL_KEY, state.selectedModel);
  return state.selectedModel;
}
function selectChatModel(model, { announce = true } = {}) {
  state.selectedModel = model;
  // Ghi cả hai khóa cũ để backup/phiên bản cũ không khôi phục lại cách gán hai model.
  localStorage.setItem(QUICK_MODEL_KEY, model);
  localStorage.setItem(DEEP_MODEL_KEY, model);
  localStorage.setItem(ACTIVE_MODEL_KEY, model);
  semanticSearchUnavailable = false;
  if (announce) notify(`Đã chọn ${compactModelName(model)} để chat`);
}
function embeddingModel() {
  // Dùng một model cố định để chỉ mục Workspace không bị tạo lại khi đổi chế độ.
  return state.selectedModel;
}
function renderReasoningMode() {
  syncActiveModel();
  const profile = REASONING_PROFILES[state.mode];
  const selectedDetails = state.installedModels.find((item) => sameModelName(item.name, state.selectedModel));
  const inferredQuant = String(state.selectedModel).match(/Q\d(?:_[A-Z0-9]+)+/i)?.[0]?.toUpperCase();
  const quantization = selectedDetails?.quantization || inferredQuant || "Ollama";
  const displayName = compactModelName(state.selectedModel);
  modeSelect.value = state.mode;
  modeSelect.disabled = state.generating || Boolean(state.modelOperation);
  modeSelect.title = `${profile.label} · Thinking ${profile.think ? "bật" : "tắt"} · ${profile.context / 1024}K ngữ cảnh`;
  ui.activeModelName.textContent = displayName;
  ui.activeModelName.title = `${modeLabel()}: ${state.selectedModel}`;
  ui.sidebarModelName.textContent = displayName;
  ui.sidebarModelName.title = state.selectedModel;
  ui.sidebarModelMeta.textContent = `${quantization} · Offline`;
  ui.aboutModelName.textContent = displayName;
  ui.aboutModelName.title = state.selectedModel;
  ui.aboutModelQuant.textContent = quantization;
  updateContextStatus();
}

function selectReasoningMode(mode) {
  if (state.generating || state.modelOperation) {
    notify(state.generating ? "Hãy dừng phản hồi hiện tại trước khi đổi chế độ" : "Hãy chờ thao tác model hoàn tất");
    return;
  }
  state.mode = normalizeReasoningMode(mode);
  state.reasoning = REASONING_PROFILES[state.mode].think;
  if (activeChat()) activeChat().mode = state.mode;
  localStorage.setItem(REASONING_MODE_KEY, state.mode);
  localStorage.setItem(REASONING_KEY, String(state.reasoning));
  saveChats();
  renderModelManager();
  refreshStatus(false).catch(() => notify("Đã đổi chế độ; chưa kiểm tra được kết nối Ollama"));
  notify(`${modeLabel()} · Thinking ${REASONING_PROFILES[state.mode].think ? "bật" : "tắt"} · ${compactModelName(state.selectedModel)}`);
}

function estimateTokens(message) {
  // Tài liệu truy xuất chỉ được đưa vào request hiện tại, không chiếm bộ nhớ
  // hội thoại lâu dài và không được cộng lặp vào thanh ngữ cảnh chat.
  const text = `${message.content || ""} ${message.displayContent || ""}`;
  const imageCost = (message.images?.length || 0) * 900;
  return Math.ceil(text.length / 3) + imageCost + 8;
}
function contextUsage() {
  const messages = activeChat()?.messages || [];
  const limit = REASONING_PROFILES[state.mode].context;
  const used = 500 + messages.reduce((total, message) => total + estimateTokens(message), 0);
  const selected = contextMessages(messages, limit);
  return { used, limit, percent: Math.min(100, Math.round((used / limit) * 100)), omitted: Math.max(0, messages.length - selected.length) };
}
function contextMessages(messages, limit = REASONING_PROFILES[state.mode].context) {
  const budget = Math.floor(limit * .72) - 500;
  const selected = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const cost = estimateTokens(messages[index]);
    if (selected.length && used + cost > budget) break;
    selected.unshift(messages[index]);
    used += cost;
  }
  return selected;
}
function updateContextStatus() {
  if (!ui.contextStatus) return;
  const usage = contextUsage();
  ui.contextFill.style.width = `${usage.percent}%`;
  ui.contextStatus.classList.toggle("warning", usage.percent >= 80 || usage.omitted > 0);
  ui.contextStatus.classList.toggle("danger", usage.percent >= 95);
  ui.contextText.textContent = usage.omitted
    ? `Ngữ cảnh ${usage.percent}% · ${usage.omitted} tin cũ đã được lược bỏ`
    : `Ngữ cảnh khoảng ${usage.percent}%`;
  ui.carryChat.hidden = usage.percent < 80 && usage.omitted === 0;
}

function id() {
  return crypto.randomUUID();
}
function loadChats() {
  try {
    state.workspaces = JSON.parse(localStorage.getItem(WORKSPACE_KEY)) || [];
  } catch {
    state.workspaces = [];
  }
  const hasGeneralStore = localStorage.getItem(GENERAL_CHAT_KEY) !== null;
  try { state.generalChats = JSON.parse(localStorage.getItem(GENERAL_CHAT_KEY)) || []; } catch { state.generalChats = []; }
  const formerDefault = state.workspaces.findIndex((item) => item.name === "Không gian của tôi");
  if (formerDefault >= 0) {
    state.generalChats = [...(state.workspaces[formerDefault].chats || []), ...state.generalChats];
    state.workspaces.splice(formerDefault, 1);
  } else if (!hasGeneralStore) {
    try { state.generalChats = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { state.generalChats = []; }
  }
  const remembered = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  const workspace = state.workspaces.find((item) => item.id === remembered);
  state.activeWorkspaceId = workspace?.id || null;
  state.chats = workspace ? workspace.chats || [] : state.generalChats;
  state.chats.sort((a, b) => b.updatedAt - a.updatedAt);
}
function sanitizedChats(chats) {
  return chats.map((chat) => ({
      ...chat,
      messages: chat.messages.map((message) => ({
        ...message,
        images: undefined,
        runtimeContent: undefined,
      attachments: message.attachments?.map(({ name, kind, type }) => ({ name, kind, type })),
    })),
  }));
}
function saveChats() {
  if (restoreBlocked) return;
  try {
    const current = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
    if (current) current.chats = state.chats;
    else state.generalChats = state.chats;
    const safe = state.workspaces.map((workspace) => ({
      ...workspace,
      chats: sanitizedChats(workspace.chats || []),
    }));
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(safe));
    localStorage.setItem(GENERAL_CHAT_KEY, JSON.stringify(sanitizedChats(state.generalChats)));
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, state.activeWorkspaceId || "general");
  } catch (error) {
    console.warn("Không thể lưu toàn bộ lịch sử", error);
  }
  if (persistenceReady) {
    try { void conversationPersistence.save(conversationSnapshot()).catch(showConversationPersistenceError); }
    catch (error) { showConversationPersistenceError(error); }
  }
  updateContextStatus();
}
function conversationSnapshot() {
  return {
    generalChats: sanitizedChats(state.generalChats),
    workspaces: state.workspaces.map(workspace => ({ ...workspace, chats: sanitizedChats(workspace.chats || []) })),
    activeWorkspaceId: state.activeWorkspaceId || null,
  };
}

function showConversationPersistenceError(error) {
  showRestoreGate(`Chưa lưu được hội thoại vào SQLite: ${error.message}. Các thay đổi chưa gửi được vẫn được giữ trên máy. Bấm Kiểm tra lại để thử nối lại.`, "Lưu hội thoại");
  const panel = document.querySelector("#restoreGate section");
  if (!panel || panel.querySelector("[data-conversation-recovery]")) return;
  const download = document.createElement("button");
  download.dataset.conversationRecovery = "true";
  download.textContent = "Xuất dữ liệu dự phòng";
  download.onclick = async () => {
    const payload = { current: conversationSnapshot(), queue: await conversationPersistence.recoveryRecords() };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), "VECTOR_AI_unsynced_recovery.json");
  };
  panel.append(download);
  if (error.status === 409) {
    const useServer = document.createElement("button");
    useServer.textContent = "Giữ bản SQLite, lưu riêng bản chưa đồng bộ";
    useServer.onclick = async () => {
      useServer.disabled = true;
      try { await conversationPersistence.keepServerVersion(); window.location.reload(); }
      catch (failure) { useServer.disabled = false; notify(failure.message); }
    };
    panel.append(useServer);
  }
}
function activeChat() {
  return state.chats.find((chat) => chat.id === state.activeId);
}
function activeWorkspace() {
  return state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
}
function renderWorkspaces() {
  const current = activeWorkspace();
  ui.workspaceName.textContent = current?.name || "Chat thường";
  ui.workspaceType.textContent = current ? "WORKSPACE" : "CHẾ ĐỘ CHAT";
  document.querySelector(".workspace-icon").textContent = current ? current.name.slice(0,1).toUpperCase() : "C";
  const general = `<button data-workspace="general" class="${state.activeWorkspaceId === null ? "active general" : "general"}"><i>C</i><span>Chat thường<small>${state.generalChats.length} cuộc trò chuyện độc lập</small></span><em>✓</em></button>`;
  const projects = state.workspaces.length ? `<div class="workspace-label">WORKSPACES</div>${state.workspaces.map((workspace) => `<button data-workspace="${workspace.id}" class="${workspace.id === state.activeWorkspaceId ? "active" : ""}"><i>${esc(workspace.name.slice(0,1).toUpperCase())}</i><span>${esc(workspace.name)}<small>${(workspace.chats || []).length} cuộc trò chuyện</small></span><em>✓</em></button>`).join("")}` : `<div class="workspace-empty">Chưa có workspace nào</div>`;
  ui.workspaceList.innerHTML = general + projects;
  ui.workspaceList.querySelectorAll("[data-workspace]").forEach((button) => button.onclick = () => switchWorkspace(button.dataset.workspace));
  $("#renameWorkspace").disabled = !current;
  $("#deleteWorkspace").disabled = !current;
  renderWorkspaceFiles();
}
function renderWorkspaceFiles() {
  const workspace = activeWorkspace();
  ui.workspaceFiles.hidden = !workspace;
  if (!workspace) { ui.workspaceFileList.innerHTML = ""; return; }
  ui.strictReference.checked = onlyDocumentSources(workspace);
  const files = workspace.files || [];
  ui.workspaceFileList.innerHTML = files.length
    ? files.map((file) => `<div class="workspace-file" title="${esc(file.name)}"><i>${file.kind === "image" ? "IMG" : "DOC"}</i><span>${esc(file.name)}</span><button data-workspace-file="${file.id}" title="Xóa tài liệu">×</button></div>`).join("")
    : `<div class="workspace-files-empty">Thêm tài liệu để AI tham chiếu</div>`;
  ui.workspaceFileList.querySelectorAll("[data-workspace-file]").forEach((button) => {
    button.onclick = async () => {
      if (!await confirmAction({ title: "Xóa tài liệu tham chiếu?", message: "Tài liệu này sẽ bị xóa khỏi workspace và không còn được dùng làm nguồn tham chiếu." })) return;
      await workspaceDbDelete(button.dataset.workspaceFile);
      workspace.files = files.filter((file) => file.id !== button.dataset.workspaceFile);
      saveChats(); renderWorkspaceFiles(); notify("Đã xóa tài liệu"); ui.prompt.focus();
    };
  });
}
async function addWorkspaceFiles(files) {
  const workspace = activeWorkspace();
  if (!workspace) return;
  workspace.files ||= [];
  const available = Math.max(0, 30 - workspace.files.length);
  for (const file of [...files].slice(0, available)) {
    try {
      const isImage = file.type.startsWith("image/");
      const isDocx = file.name.toLowerCase().endsWith(".docx") || file.type.includes("wordprocessingml");
      if (isImage && file.size > 10 * 1024 * 1024) throw new Error("ảnh vượt quá 10 MB");
      if (isDocx && file.size > 25 * 1024 * 1024) throw new Error("DOCX vượt quá 25 MB");
      if (!isImage && !isDocx && file.size > 2 * 1024 * 1024) throw new Error("tệp vượt quá 2 MB");
      const fileId = id();
      const parsedDocx = isDocx ? await parseDocx(file) : null;
      const record = {
        id: fileId, workspaceId: workspace.id, name: file.name,
        type: file.type || "text/plain", kind: isImage ? "image" : isDocx ? "document" : "text",
        size: file.size, createdAt: Date.now(),
        ...(isImage ? { data: (await asDataUrl(file)).split(",")[1] } : isDocx ? parsedDocx : { text: await file.text() }),
      };
      await workspaceDbPut(record);
      workspace.files.push({ id: fileId, name: file.name, type: record.type, kind: record.kind, size: file.size, createdAt: record.createdAt });
    } catch (error) { notify(`${file.name}: ${error.message || error}`); }
  }
  ui.workspaceFileInput.value = "";
  saveChats(); renderWorkspaceFiles();
  if (files.length > available) notify("Mỗi workspace lưu tối đa 30 tài liệu");
  else notify("Đã thêm tài liệu vào workspace");
}
function switchWorkspace(workspaceId) {
  const targetId = workspaceId === "general" ? null : workspaceId;
  if (state.generating || targetId === state.activeWorkspaceId) { ui.workspaceMenu.classList.remove("open"); return; }
  saveChats();
  const workspace = targetId ? state.workspaces.find((item) => item.id === targetId) : null;
  if (targetId && !workspace) return;
  state.activeWorkspaceId = workspace?.id || null;
  state.editingMessageId = null;
  state.chats = workspace ? workspace.chats || [] : state.generalChats;
  state.activeId = state.chats[0]?.id || null;
  state.attachments = [];
  saveChats();renderWorkspaces();renderList({ resetScroll: true });renderMessages();renderAttachments();
  ui.workspaceMenu.classList.remove("open");closeSidebar();notify(workspace ? `Đã mở ${workspace.name}` : "Đã về Chat thường");
}
async function createWorkspace() {
  const name = (await inputAction({
    title: "Tạo workspace mới",
    message: "Nhóm hội thoại và tài liệu tham chiếu theo một chủ đề riêng.",
    value: "Workspace mới",
    acceptLabel: "Tạo workspace",
  }))?.trim();
  if (!name) return;
  saveChats();
  const workspace = { id: id(), name: name.slice(0,40), createdAt: Date.now(), chats: [], files: [], strictReferences: false };
  state.workspaces.unshift(workspace);state.activeWorkspaceId=workspace.id;state.chats=workspace.chats;state.activeId=null;
  saveChats();renderWorkspaces();renderList({ resetScroll: true });renderMessages();ui.workspaceMenu.classList.remove("open");notify("Đã tạo workspace");
}
async function renameWorkspace() {
  const workspace=activeWorkspace();if(!workspace)return;
  const name=(await inputAction({
    title: "Đổi tên workspace",
    message: "Tên mới chỉ thay đổi cách hiển thị, không ảnh hưởng dữ liệu bên trong.",
    value: workspace.name,
    acceptLabel: "Lưu tên mới",
  }))?.trim();if(!name)return;
  workspace.name=name.slice(0,40);saveChats();renderWorkspaces();ui.workspaceMenu.classList.remove("open");notify("Đã đổi tên workspace");
}
async function deleteWorkspace() {
  const workspace=activeWorkspace();if(!workspace)return;
  if(!await confirmAction({ title: `Xóa workspace “${workspace.name}”?`, message: "Toàn bộ hội thoại và tài liệu tham chiếu trong workspace này sẽ bị xóa vĩnh viễn." }))return;
  await Promise.all((workspace.files || []).map((file) => workspaceDbDelete(file.id).catch(() => {})));
  state.workspaces=state.workspaces.filter((item)=>item.id!==workspace.id);
  state.activeWorkspaceId=null;state.chats=state.generalChats;state.activeId=state.chats[0]?.id||null;
  saveChats();renderWorkspaces();renderList({ resetScroll: true });renderMessages();ui.workspaceMenu.classList.remove("open");notify("Đã xóa workspace");ui.prompt.focus();
}
function newChat() {
  if (state.generating) return;
  const chat = {
    id: id(),
    mode: "FAST",
    title: "Cuộc trò chuyện mới",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  state.chats.unshift(chat);
  state.activeId = chat.id;
  state.mode = "FAST";
  state.reasoning = false;
  state.editingMessageId = null;
  saveChats();
  renderList({ resetScroll: true });
  renderMessages();
  closeSidebar();
  renderReasoningMode();
  ui.prompt.focus();
}
function selectChat(chatId) {
  if (state.generating) return;
  state.activeId = chatId;
  state.mode = normalizeReasoningMode(activeChat()?.mode, INITIAL_MODE);
  state.reasoning = REASONING_PROFILES[state.mode].think;
  renderReasoningMode();
  state.editingMessageId = null;
  renderList();
  renderMessages();
  closeSidebar();
}
async function removeChat(chatId = state.activeId) {
  if (!chatId || state.generating) return;
  if (!await confirmAction({ title: "Xóa cuộc trò chuyện?", message: "Nội dung cuộc trò chuyện này sẽ bị xóa khỏi VECTOR AI." })) return;
  const removedChat = state.chats.find((chat) => chat.id === chatId);
  await Promise.all((removedChat?.files || []).map((file) => workspaceDbDelete(file.id).catch(() => {})));
  state.chats = state.chats.filter((chat) => chat.id !== chatId);
  state.editingMessageId = null;
  if (state.activeId === chatId) state.activeId = state.chats[0]?.id || null;
  saveChats();
  renderList();
  renderMessages();
  notify("Đã xóa hội thoại");
  ui.prompt.focus();
}

function esc(text) {
  return String(text).replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
}
function renderLatex(source, displayMode = false) {
  const latex = source
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
  const cacheKey = `${displayMode ? "display" : "inline"}\u0000${latex}`;
  if (latexRenderCache.has(cacheKey)) return latexRenderCache.get(cacheKey);
  try {
    const rendered = katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      trust: false,
      output: "html",
    });
    if (latexRenderCache.size >= LATEX_CACHE_LIMIT)
      latexRenderCache.delete(latexRenderCache.keys().next().value);
    latexRenderCache.set(cacheKey, rendered);
    return rendered;
  } catch {
    return `<code>${esc(latex)}</code>`;
  }
}
function decodeEntities(source) {
  const node = document.createElement("textarea");
  node.innerHTML = source;
  return node.value;
}
function markdown(source, { renderMath = true } = {}) {
  const blocks = [];
  let text = prepareChatTables(source || "", blocks);
  text = text.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const key = `@@B${blocks.length}@@`;
    const language = (lang || "").toLowerCase();
    const raw = decodeEntities(code.trim());
    if (language === "mermaid")
      blocks.push(`<div class="visual-card artifact-block" data-artifact="mermaid" data-artifact-source="${encodeURIComponent(raw)}"><div class="visual-head"><span>SƠ ĐỒ</span><b>Mermaid</b><button type="button" data-open-artifact title="Mở trong Artifact">↗</button></div><div class="mermaid-pending" data-source="${encodeURIComponent(raw)}"><div class="visual-loading">Đang dựng sơ đồ...</div></div></div>`);
    else if (["chart", "chartjs"].includes(language))
      blocks.push(`<div class="visual-card artifact-block" data-artifact="chart" data-artifact-source="${encodeURIComponent(raw)}"><div class="visual-head"><span>BIỂU ĐỒ</span><b>Chart.js</b><button type="button" data-open-artifact title="Mở trong Artifact">↗</button></div><div class="chart-pending" data-source="${encodeURIComponent(raw)}"><canvas></canvas></div></div>`);
    else blocks.push(`<div class="artifact-code artifact-block" data-artifact="${esc(language || "code")}" data-artifact-source="${encodeURIComponent(raw)}"><div class="visual-head"><span>MÃ NGUỒN</span><b>${esc(lang || "code")}</b><button type="button" data-open-artifact title="Mở trong Artifact">↗</button></div><pre><code>${code.trim()}</code></pre></div>`);
    return `\n${key}\n`;
  });
  text = text.replace(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g, (_, a, b) => {
    const key = `@@B${blocks.length}@@`;
    blocks.push(renderMath
      ? `<div class="math">${renderLatex(a || b, true)}</div>`
      : `<div class="math stream-math">\\[${a || b}\\]</div>`);
    return `\n${key}\n`;
  });
  text = text.replace(
    /\\\((.*?)\\\)|\$([^$\n]+)\$/g,
    (_, a, b) => renderMath
      ? `<span class="inline-math">${renderLatex(a || b, false)}</span>`
      : `<span class="inline-math stream-math">\\(${a || b}\\)</span>`,
  );
  text = text
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>");
  text = text
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    .replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");
  text = text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text
    .split(/\n{2,}/)
    .map((part) => {
      part = part.trim();
      if (!part) return "";
      if (/^(@@B\d+@@|<(h\d|ul|pre|div))/.test(part)) return part;
      return `<p>${part.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
  blocks.forEach((block, i) => (text = text.replace(`@@B${i}@@`, block)));
  return text;
}

function isEscapedAt(source, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}
function isLikelyCurrencyDollar(source, index) {
  const tail = String(source || "").slice(index + 1);
  if (!/^\d/.test(tail) || /[=+*/^_\\{}]/.test(tail)) return false;
  return /^\d+(?:[.,]\d+)?(?:\s*(?:usd|vnd|vnđ|đ|đồng|dollars?))?(?:\s|$)/i.test(tail);
}
function incompleteMathStart(source) {
  const text = String(source || "");
  let fenceOpen = false;
  let inlineCodeOpen = false;
  let mode = null;
  let openIndex = -1;
  for (let index = 0; index < text.length; index += 1) {
    if (!mode && text.startsWith("```", index)) {
      fenceOpen = !fenceOpen;
      index += 2;
      continue;
    }
    if (fenceOpen) continue;
    if (!mode && text[index] === "`" && !isEscapedAt(text, index)) {
      inlineCodeOpen = !inlineCodeOpen;
      continue;
    }
    if (inlineCodeOpen) continue;
    if (!mode) {
      if (text.startsWith("\\[", index)) { mode = "bracket"; openIndex = index; index += 1; }
      else if (text.startsWith("\\(", index)) { mode = "paren"; openIndex = index; index += 1; }
      else if (text.startsWith("$$", index) && !isEscapedAt(text, index)) { mode = "double-dollar"; openIndex = index; index += 1; }
      else if (text[index] === "$" && !isEscapedAt(text, index) && !/\s/.test(text[index + 1] || " ") && !isLikelyCurrencyDollar(text, index)) {
        mode = "dollar";
        openIndex = index;
      }
      continue;
    }
    const closes = mode === "bracket" && text.startsWith("\\]", index)
      || mode === "paren" && text.startsWith("\\)", index)
      || mode === "double-dollar" && text.startsWith("$$", index) && !isEscapedAt(text, index)
      || mode === "dollar" && text[index] === "$" && !isEscapedAt(text, index);
    if (closes) {
      if (mode === "bracket" || mode === "paren" || mode === "double-dollar") index += 1;
      mode = null;
      openIndex = -1;
    }
  }
  const trailingSlash = text.length - 1;
  if (!mode && !fenceOpen && !inlineCodeOpen && text[trailingSlash] === "\\" && !isEscapedAt(text, trailingSlash))
    return trailingSlash;
  return mode ? openIndex : -1;
}
function streamingMarkdown(source) {
  const text = String(source || "").trimEnd();
  let pendingAt = incompleteMathStart(text);
  const fences = [...text.matchAll(/(^|\n)[ \t]*```/g)];
  if (fences.length % 2) {
    const openFence = fences.at(-1)?.index ?? -1;
    pendingAt = pendingAt < 0 ? openFence : Math.min(pendingAt, openFence);
  }
  if (pendingAt < 0) return markdown(text);
  const stable = text.slice(0, pendingAt).trimEnd();
  const stableHtml = stable ? markdown(stable) : "";
  return `${stableHtml}<span class="math-pending" role="status"><i></i><span>Đang hoàn thiện công thức…</span></span>`;
}

function resultParts(line) {
  let clean = String(line || "").trim().replace(/^[-*]\s+/, "");
  if (clean.startsWith("|") && clean.endsWith("|")) clean = clean.slice(1, -1).trim();
  const separator = clean.indexOf("|");
  if (separator < 0) return null;
  const label = clean.slice(0, separator).trim();
  const value = clean.slice(separator + 1).trim();
  return label && value ? { label, value } : null;
}
function isResultHeader(parts) {
  if (!parts) return false;
  const normalize = (value) => String(value || "")
    .trim()
    .replace(/^(\*\*|__|`)([\s\S]+)\1$/, "$2")
    .replace(/\s*[:：]\s*$/u, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("vi");
  const label = normalize(parts.label);
  const value = normalize(parts.value);
  return /^(đại lượng|tên|tên đại lượng|nội dung|kết quả)$/.test(label)
    && /^(giá trị|giá trị và đơn vị|giá trị\s*\/\s*đơn vị|đơn vị|kết quả|đáp số)$/.test(value);
}
function unwrapResultMath(value) {
  const text = String(value || "").trim();
  const wrappers = [
    ["\\(", "\\)"],
    ["\\[", "\\]"],
    ["$$", "$$"],
    ["$", "$"],
  ];
  for (const [open, close] of wrappers) {
    if (text.startsWith(open) && text.endsWith(close) && text.length > open.length + close.length)
      return { text: text.slice(open.length, -close.length).trim(), open, close };
  }
  return { text, open: "", close: "" };
}
function tidyResultLabel(value) {
  return String(value || "")
    .trim()
    .replace(/^(\*\*|__)([\s\S]+)\1$/, "$2")
    .replace(/\s*[:：=–—-]\s*$/u, "")
    .trim();
}
function semanticResultParts(value) {
  const wrapped = unwrapResultMath(value);
  const wrap = (part) => wrapped.open ? `${wrapped.open}${part.trim()}${wrapped.close}` : part.trim();
  const emphasizedColon = wrapped.text.match(/^(\*\*|__)(.{1,70}?)(?::|：)\1\s*(.+)$/u);
  if (emphasizedColon && /\p{L}/u.test(emphasizedColon[2]))
    return { label: wrap(emphasizedColon[2]), value: wrap(emphasizedColon[3]) };
  const separated = wrapped.text.match(/^(.{1,70}?)\s*(=|≈|:|：|→|[–—])\s*(.+)$/u);
  if (separated && /[\p{L}\\]/u.test(separated[1])) {
    const label = wrap(tidyResultLabel(separated[1]));
    const right = `${separated[2] === "≈" ? "≈ " : ""}${separated[3]}`;
    return { label, value: wrap(right) };
  }
  const measured = wrapped.text.match(/^(.{1,70}?)\s+((?:≈|~)?\s*[-+]?\d[\d.,]*(?:\s+.+)?)$/u);
  if (measured && /[\p{L}\\]/u.test(measured[1]))
    return { label: wrap(tidyResultLabel(measured[1])), value: wrap(measured[2]) };
  return null;
}
function resultLine(line) {
  const clean = String(line || "").trim().replace(/^[-*]\s+/, "");
  if (!clean || /^\|?\s*[-:]+(?:\s*\|\s*[-:]+)+\s*\|?$/.test(clean)) return null;
  const numbered = clean.match(/^(\d+)[.)]\s*(.+)$/);
  const content = numbered ? numbered[2].trim() : clean;
  const parts = resultParts(content);
  if (parts) return isResultHeader(parts) ? null : parts;
  // Qwen đôi lúc trả đúng nội dung nhưng quên dấu phân cách `|`. Khi đó ưu
  // tiên tách tên thật của đại lượng thay vì đưa nhãn chung "Câu 1" lên bảng.
  const semantic = semanticResultParts(content);
  if (semantic) return semantic;
  if (numbered) return { label: `Câu ${numbered[1]}`, value: content };
  if (content.length <= 180 && /(?:=|≈|\d\s*(?:m(?:\/s(?:²)?)?|s|cm|km|%|lần)\b)/i.test(content))
    return { label: "Kết quả", value: content };
  return null;
}
function isResultDecoration(line) {
  const clean = String(line || "").trim().replace(/^[-*]\s+/, "");
  if (!clean || /^\|?\s*[-:]+(?:\s*\|\s*[-:]+)+\s*\|?$/.test(clean)) return true;
  return isResultHeader(resultParts(line));
}
function resultStart(line) {
  const trimmed = String(line || "").trim();
  const marked = trimmed.match(/^:::\s*result\b\s*:?\s*(.*)$/i);
  if (marked) return { matched: true, remainder: marked[1] || "" };
  if (/^result\s*:?\s*$/i.test(trimmed)) return { matched: true, remainder: "" };
  const plain = trimmed.match(/^result\s*:?\s+(.+\|.+)$/i);
  return plain ? { matched: true, remainder: plain[1] } : { matched: false, remainder: "" };
}
function parseResultDocument(source, { streaming = false } = {}) {
  const text = String(source || "");
  const lines = text.split(/\r?\n/);
  const endsWithLineBreak = /\r?\n$/.test(text);
  const body = [];
  const rows = [];
  let resultOpen = false;
  let sawResult = false;
  let acceptTrailingRows = false;
  let codeFenceOpen = false;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const completeLine = index < lines.length - 1 || endsWithLineBreak;
    if (/^```/.test(trimmed)) {
      codeFenceOpen = !codeFenceOpen;
      body.push(line);
      return;
    }
    const start = !codeFenceOpen ? resultStart(trimmed) : { matched: false, remainder: "" };
    if (start.matched) {
      resultOpen = true;
      sawResult = true;
      if (start.remainder && (!streaming || completeLine)) {
        const row = resultLine(start.remainder);
        if (row) rows.push(row);
        else if (!isResultDecoration(start.remainder)) body.push(start.remainder);
      }
      return;
    }
    if (!codeFenceOpen && resultOpen && /^:::\s*$/.test(trimmed)) {
      resultOpen = false;
      acceptTrailingRows = true;
      return;
    }
    if (!codeFenceOpen && !resultOpen && sawResult && /^:::\s*$/.test(trimmed)) {
      acceptTrailingRows = false;
      return;
    }
    if (resultOpen) {
      if (streaming && !completeLine) return;
      const row = resultLine(line);
      if (row) rows.push(row);
      else if (!isResultDecoration(line)) body.push(line);
      return;
    }
    // Nếu model đóng khối ngay sau dòng tiêu đề, vẫn thu các hàng kết quả
    // liền sau đó cho tới dấu đóng kế tiếp hoặc một đoạn văn mới.
    if (!codeFenceOpen && sawResult && !resultOpen && acceptTrailingRows) {
      if (streaming && !completeLine) return;
      const trailingRow = resultLine(line);
      if (trailingRow) {
        rows.push(trailingRow);
        return;
      }
      if (trimmed && isResultDecoration(line)) return;
      if (trimmed) acceptTrailingRows = false;
    }
    body.push(line);
  });

  const uniqueRows = [];
  const rowPositions = new Map();
  rows.forEach((row) => {
    const key = row.label.toLocaleLowerCase("vi").replace(/[\s*_`:$]+/g, "").trim();
    const generic = /^(kếtquả|đápsố)$/.test(key);
    if (!generic && rowPositions.has(key)) uniqueRows[rowPositions.get(key)] = row;
    else {
      if (!generic) rowPositions.set(key, uniqueRows.length);
      uniqueRows.push(row);
    }
  });
  return { body: body.join("\n").trim(), rows: uniqueRows, sawResult, resultOpen };
}
function resultRows(source) {
  const text = String(source || "");
  const parsed = parseResultDocument(text);
  if (parsed.sawResult) return { rows: parsed.rows, body: parsed.body };
  const rows = [];
  const matches = [...text.matchAll(/^(?:\*\*)?(Đáp số|Kết quả|Kết luận)(?:\*\*)?\s*:\s*(.+)$/gim)];
  const finalLine = matches.at(-1)?.[2];
  if (finalLine) {
    finalLine.split(/\s*;\s*/).filter(Boolean).forEach((part) => {
      const equation = part.match(/^(.{1,45}?)\s*=\s*(.+)$/);
      rows.push(equation ? { label: equation[1].trim(), value: equation[2].trim() } : { label: "Kết quả", value: part.trim() });
    });
  }
  return { rows, body: text };
}
function resultCard(rows, { renderMath = true } = {}) {
  if (!rows.length) return "";
  return `<section class="result-card"><header><span><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></span><div><small>KẾT QUẢ CUỐI CÙNG</small><b>Tóm tắt đáp số</b></div></header><div class="result-table">${rows.map((row) => `<div><span>${markdown(row.label, { renderMath })}</span><strong>${markdown(row.value, { renderMath })}</strong></div>`).join("")}</div></section>`;
}
function renderAnswer(source) {
  const parsed = resultRows(source);
  return markdown(parsed.body) + resultCard(parsed.rows);
}
function renderRevealingAnswer(source) {
  const parsed = parseResultDocument(source, { streaming: true });
  return streamingMarkdown(parsed.body) + resultCard(parsed.rows);
}
function answerDraftMarkup() {
  return `<div class="answer-draft-host"><details class="answer-draft">
    <summary aria-label="Hiện hoặc ẩn bản nháp câu trả lời" aria-expanded="false">
      <span class="answer-draft-pulse" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="answer-draft-label">Đang hoàn thiện câu trả lời…</span>
      <svg class="answer-draft-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>
    </summary>
    <div class="answer-draft-viewport">
      <div class="answer-draft-content">Bản nháp sẽ xuất hiện ở đây và có thể thay đổi trước khi hoàn tất.</div>
    </div>
  </details></div>`;
}
function getDraftRenderState(node) {
  let tracker = draftRenderStates.get(node);
  if (!tracker) {
    tracker = {
      raw: "",
      timer: null,
      answerTimer: null,
      lastPaint: 0,
      lastAnswerPaint: 0,
      lastAnswerText: "",
      streamText: null,
      lastText: null,
      answer: node.querySelector(".answer"),
      label: node.querySelector(".answer-draft-label"),
      panel: node.querySelector(".answer-draft"),
      preview: node.querySelector(".answer-draft-content"),
      viewport: node.querySelector(".answer-draft-viewport"),
    };
    draftRenderStates.set(node, tracker);
  }
  return tracker;
}
function getBufferedAnswer(node) {
  return draftRenderStates.get(node)?.raw ?? node.dataset.raw ?? "";
}
function paintDraftPreview(node, { force = false } = {}) {
  const tracker = draftRenderStates.get(node);
  if (!tracker) return;
  if (tracker.timer !== null) clearTimeout(tracker.timer);
  tracker.timer = null;
  if (!node.isConnected) {
    draftRenderStates.delete(node);
    return;
  }
  const panel = tracker.panel;
  const preview = tracker.preview;
  if (!panel?.open || !preview) return;
  const text = tracker.raw || "Đang chờ nội dung từ mô hình…";
  if (!force && text === tracker.lastText) return;
  const viewport = tracker.viewport;
  const followDraft = viewport
    ? viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 48
    : true;
  preview.textContent = text;
  tracker.lastText = text;
  tracker.lastPaint = performance.now();
  if (viewport && followDraft) viewport.scrollTop = viewport.scrollHeight;
}
function scheduleDraftRender(node) {
  const tracker = getDraftRenderState(node);
  const panel = tracker.panel;
  if (!panel?.open) return;
  if (tracker.timer !== null) return;
  const delay = Math.max(0, DRAFT_PAINT_INTERVAL - (performance.now() - tracker.lastPaint));
  tracker.timer = setTimeout(() => paintDraftPreview(node), delay);
}

function stableStreamingText(source) {
  const text = String(source || "").trimEnd();
  let pendingAt = incompleteMathStart(text);
  const fences = [...text.matchAll(/(^|\n)[ \t]*```/g)];
  if (fences.length % 2) {
    const openFence = fences.at(-1)?.index ?? -1;
    pendingAt = pendingAt < 0 ? openFence : Math.min(pendingAt, openFence);
  }
  // The result card is only useful when all rows and its closing marker exist.
  // Keep the raw marker out of the lightweight streaming preview.
  const result = /(^|\n)[ \t]*:::\s*result\b/i.exec(text);
  if (result) {
    const resultAt = result.index + result[1].length;
    pendingAt = pendingAt < 0 ? resultAt : Math.min(pendingAt, resultAt);
  }
  return (pendingAt < 0 ? text : text.slice(0, pendingAt)).trimEnd();
}

function paintStreamingAnswer(node, { force = false } = {}) {
  const tracker = draftRenderStates.get(node);
  if (!tracker) return;
  if (tracker.answerTimer !== null) clearTimeout(tracker.answerTimer);
  tracker.answerTimer = null;
  if (!node.isConnected || !tracker.answer) return;
  const text = stableStreamingText(tracker.raw);
  if (!text || text === tracker.lastAnswerText) return;
  const addition = text.startsWith(tracker.lastAnswerText)
    ? text.slice(tracker.lastAnswerText.length)
    : text;
  if (!force && addition.length < ANSWER_STREAM_MIN_CHARS && !/[.!?;:]\s*$|\n$/u.test(addition)) return;
  preserveConversationPosition(() => {
    if (!tracker.streamText || !text.startsWith(tracker.lastAnswerText)) {
      tracker.streamText = document.createElement("div");
      tracker.streamText.className = "answer-stream-text";
      tracker.answer.replaceChildren(tracker.streamText);
      tracker.streamText.textContent = text;
    } else {
      tracker.streamText.append(document.createTextNode(addition));
    }
  });
  tracker.lastAnswerText = text;
  tracker.lastAnswerPaint = performance.now();
}

function scheduleStreamingAnswer(node) {
  const tracker = getDraftRenderState(node);
  if (tracker.answerTimer !== null) return;
  const delay = Math.max(
    0,
    ANSWER_STREAM_PAINT_INTERVAL - (performance.now() - tracker.lastAnswerPaint),
  );
  tracker.answerTimer = setTimeout(() => paintStreamingAnswer(node), delay);
}
function bindAnswerDraft(node) {
  const panel = node.querySelector(".answer-draft");
  if (!panel) return;
  getDraftRenderState(node);
  panel.addEventListener("toggle", () => {
    panel.querySelector("summary")?.setAttribute("aria-expanded", String(panel.open));
    if (panel.open) paintDraftPreview(node, { force: true });
  });
}
function discardDraftRender(node, { removePanel = true, commitRaw = true } = {}) {
  const tracker = draftRenderStates.get(node);
  if (tracker?.timer !== null) clearTimeout(tracker.timer);
  if (tracker?.answerTimer !== null) clearTimeout(tracker.answerTimer);
  if (commitRaw && tracker) node.dataset.raw = tracker.raw;
  draftRenderStates.delete(node);
  if (removePanel) node.querySelector(".answer-draft-host")?.remove();
}
function preserveConversationPosition(change) {
  const followLatest = isNearBottom();
  const scrollTop = ui.conversation.scrollTop;
  change();
  if (followLatest) ui.conversation.scrollTop = ui.conversation.scrollHeight;
  else ui.conversation.scrollTop = scrollTop;
  updateScrollLatest();
}
async function revealFinalAnswer(node, source, requestId = null) {
  const answer = node.querySelector(".answer");
  if (!answer) return;
  const text = String(source || "");
  const html = renderAnswer(text);
  discardDraftRender(node);
  node.classList.remove("is-drafting", "is-revealing");
  answer.removeAttribute("aria-busy");
  // The streaming renderer intentionally defers an incomplete result row or
  // formula. Commit the canonical final markup once generation is complete.
  preserveConversationPosition(() => { answer.innerHTML = html; });
}
function showFinalAnswerImmediately(node, source) {
  const answer = node.querySelector(".answer");
  discardDraftRender(node);
  node.classList.remove("is-drafting", "is-revealing");
  if (!answer) return;
  answer.removeAttribute("aria-busy");
  preserveConversationPosition(() => { answer.innerHTML = renderAnswer(String(source || "")); });
}
function safeTruncatedContent(source) {
  let safe = String(source || "").trimEnd();
  const parsedResult = parseResultDocument(safe, { streaming: true });
  if (parsedResult.resultOpen) {
    safe = parsedResult.body;
    if (parsedResult.rows.length) {
      const recoveredRows = parsedResult.rows.map((row) => `${row.label} | ${row.value}`).join("\n");
      safe = `${safe}\n\n:::result\n${recoveredRows}\n:::`.trim();
    }
  }
  const trimUnclosed = (openPattern, closePattern, openToken) => {
    const opens = (safe.match(openPattern) || []).length;
    const closes = (safe.match(closePattern) || []).length;
    if (opens > closes) safe = safe.slice(0, safe.lastIndexOf(openToken)).trimEnd();
  };
  const fences = (safe.match(/```/g) || []).length;
  if (fences % 2) safe = safe.slice(0, safe.lastIndexOf("```")).trimEnd();
  trimUnclosed(/\\\[/g, /\\\]/g, "\\[");
  trimUnclosed(/\\\(/g, /\\\)/g, "\\(");
  const dollars = [...safe.matchAll(/(?<!\\)\$/g)];
  if (dollars.length % 2) safe = safe.slice(0, dollars.at(-1).index).trimEnd();
  const lines = safe.split("\n");
  const tail = lines.at(-1)?.trim() || "";
  if (/^(?:\$|\\)|.*(?:=|\\frac\{[^}]*|\\[a-zA-Z]+\{[^}]*|[_^+\-*/])\s*$/.test(tail)) lines.pop();
  safe = lines.join("\n").trimEnd();
  return `${safe}\n\n> Bấm **Tiếp tục** để xem phần còn lại.`;
}

async function hydrateVisuals(root) {
  await visualRenderer.hydrate(root);
  if (root.isConnected) bindArtifacts(root);
}

function bindArtifacts(root) {
  root.querySelectorAll("[data-open-artifact]").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "true";
    button.onclick = () => {
      const block = button.closest(".artifact-block");
      openArtifact(block.dataset.artifact || "code", decodeURIComponent(block.dataset.artifactSource || ""));
    };
  });
}
function artifactLabel(type) {
  return ({ mermaid: "Sơ đồ Mermaid", chart: "Biểu đồ Chart.js", html: "Trang HTML", css: "CSS", javascript: "JavaScript", js: "JavaScript", python: "Python", json: "JSON", markdown: "Markdown" })[type] || `Mã nguồn · ${type}`;
}
async function renderArtifactPreview() {
  const artifact = state.artifact;
  if (!artifact) return;
  const version = ++artifactPreviewVersion;
  const source = artifact.source;
  const isCurrent = () => version === artifactPreviewVersion && state.artifact === artifact;
  visualRenderer.dispose(ui.artifactPreview);
  ui.artifactPreview.replaceChildren();
  try {
    if (artifact.type === "mermaid") {
      const target = document.createElement("div"); target.className = "artifact-mermaid mermaid"; ui.artifactPreview.append(target);
      await visualRenderer.renderDiagram(target, source, isCurrent);
    } else if (artifact.type === "chart") {
      const canvas = document.createElement("canvas"); ui.artifactPreview.append(canvas);
      await visualRenderer.renderChart(canvas, source, isCurrent);
    } else if (artifact.type === "html") {
      const frame = document.createElement("iframe"); frame.setAttribute("sandbox", ""); frame.srcdoc = source; ui.artifactPreview.append(frame);
    } else if (artifact.type === "markdown" || artifact.type === "md") {
      ui.artifactPreview.innerHTML = `<article class="artifact-markdown answer">${markdown(source)}</article>`; await hydrateVisuals(ui.artifactPreview);
    } else {
      ui.artifactPreview.innerHTML = `<pre><code>${esc(source)}</code></pre>`;
    }
  } catch (error) {
    if (isCurrent()) {
      visualRenderer.dispose(ui.artifactPreview);
      ui.artifactPreview.innerHTML = `<div class="artifact-error">Không thể dựng bản xem trước: ${esc(error.message || error)}</div>`;
    }
  }
}
async function openArtifact(type, source) {
  clearTimeout(ui.artifactSource.renderTimer);
  artifactPreviewVersion += 1;
  visualRenderer.dispose(ui.artifactPreview);
  state.artifact = { type: String(type || "code").toLowerCase(), source };
  ui.artifactTitle.textContent = artifactLabel(state.artifact.type);
  ui.artifactSource.value = source;
  document.querySelector(".shell").classList.add("artifact-open");
  ui.artifactPanel.classList.add("open"); ui.artifactPanel.setAttribute("aria-hidden", "false");
  setArtifactTab("preview"); await renderArtifactPreview();
}
function closeArtifact() {
  clearTimeout(ui.artifactSource.renderTimer);
  artifactPreviewVersion += 1;
  visualRenderer.dispose(ui.artifactPreview);
  ui.artifactPreview.replaceChildren();
  state.artifact = null;
  ui.artifactPanel.classList.remove("open"); ui.artifactPanel.setAttribute("aria-hidden", "true");
  document.querySelector(".shell").classList.remove("artifact-open");
}
function setArtifactTab(tab) {
  document.querySelectorAll("[data-artifact-tab]").forEach((button) => button.classList.toggle("active", button.dataset.artifactTab === tab));
  ui.artifactPreview.hidden = tab !== "preview"; ui.artifactSource.hidden = tab !== "source";
}
function artifactExtension(type) {
  return ({ mermaid: "mmd", chart: "json", javascript: "js", js: "js", typescript: "ts", python: "py", html: "html", css: "css", json: "json", markdown: "md", md: "md", rust: "rs" })[type] || "txt";
}
function downloadArtifact() {
  if (!state.artifact) return;
  const blob = new Blob([state.artifact.source], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `vector-artifact-${Date.now()}.${artifactExtension(state.artifact.type)}`; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function renderList(options = {}) {
  const resetScroll = options?.resetScroll === true;
  const previousScrollTop = resetScroll ? 0 : ui.list.scrollTop;
  const query = ui.search.value.trim().toLowerCase();
  const filtered = state.chats.filter((c) =>
    c.title.toLowerCase().includes(query),
  );
  const fragment = document.createDocumentFragment();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Chưa có cuộc trò chuyện";
    fragment.append(empty);
    ui.list.replaceChildren(fragment);
    ui.list.scrollTop = 0;
    return;
  }
  filtered.forEach((chat) => {
    const item = document.createElement("button");
    item.className = `chat-item ${chat.id === state.activeId ? "active" : ""}`;
    item.innerHTML = `<svg viewBox="0 0 24 24"><path d="M5 5h14v11H9l-4 3V5Z"/></svg><span>${esc(chat.title)}</span><i>×</i>`;
    item.onclick = (e) =>
      e.target.tagName === "I" ? removeChat(chat.id) : selectChat(chat.id);
    fragment.append(item);
  });
  // Thay cả danh sách trong một lần để tránh nhiều lượt layout/paint liên tiếp.
  ui.list.replaceChildren(fragment);
  ui.list.scrollTop = previousScrollTop;
}
function attachmentMarkup(items = []) {
  if (!items.length) return "";
  return `<div class="message-files">${items.map((item) => (item.kind === "image" && item.preview ? `<figure><img src="${item.preview}" alt="${esc(item.name)}"><figcaption>${esc(item.name)}</figcaption></figure>` : `<span>📄 ${esc(item.name)}</span>`)).join("")}</div>`;
}
function sourceMarkup(sources = []) {
  if (!sources.length) return "";
  return `<div class="answer-sources"><div><span>Nguồn tham chiếu</span>${sources.map((source) => `<button type="button" data-source-id="${esc(source.id)}" title="Mở đoạn trích từ ${esc(source.name)}"><b>${esc(source.id)}</b>${esc(source.name)}</button>`).join("")}</div><div class="source-preview" hidden></div></div>`;
}
function bindSources(node, sources = []) {
  const preview = node.querySelector(".source-preview");
  if (!preview) return;
  node.querySelectorAll("[data-source-id]").forEach((button) => {
    button.onclick = () => {
      const source = sources.find((item) => item.id === button.dataset.sourceId);
      if (!source) return;
      const same = preview.dataset.sourceId === source.id && !preview.hidden;
      preview.hidden = same;
      preview.dataset.sourceId = source.id;
      preview.innerHTML = `<header><b>${esc(source.id)} · ${esc(source.name)}</b><span>Đoạn ${source.chunkId || 1}</span></header><p>${esc(source.excerpt || "Không có đoạn trích.")}</p>`;
    };
  });
}
function createMessage(message, streaming = false) {
  const node = document.createElement("article");
  node.className = `message ${message.role}`;
  node.dataset.id = message.id || "";
  if (message.role === "user") {
    const editing = state.editingMessageId === message.id;
    node.classList.toggle("editing", editing);
    if (editing) {
      node.innerHTML = `<div class="user-main inline-edit-main"><div class="bubble inline-edit-bubble">${attachmentMarkup(message.attachments)}<textarea class="inline-edit-input" aria-label="Chỉnh sửa tin nhắn">${esc(message.displayContent ?? message.content ?? "")}</textarea><div class="inline-edit-actions"><button type="button" data-cancel-edit>Hủy</button><button type="button" data-submit-edit><span>Gửi</span><svg viewBox="0 0 24 24"><path d="m5 12 14-8-4 16-3-6-7-2Zm7 2 7-10"/></svg></button></div></div></div>`;
      const editor = node.querySelector(".inline-edit-input");
      const fitEditor = () => { editor.style.height = "0"; editor.style.height = `${Math.min(260, Math.max(68, editor.scrollHeight))}px`; };
      editor.oninput = fitEditor;
      editor.onkeydown = (event) => {
        if (event.key === "Escape") { event.preventDefault(); cancelInlineEdit(); }
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submitInlineEdit(message, editor.value); }
      };
      node.querySelector("[data-cancel-edit]").onclick = cancelInlineEdit;
      node.querySelector("[data-submit-edit]").onclick = () => submitInlineEdit(message, editor.value);
      requestAnimationFrame(() => {
        fitEditor();
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(editor.value.length, editor.value.length);
      });
    } else {
      node.innerHTML = `<div class="user-main"><div class="bubble">${attachmentMarkup(message.attachments)}${markdown(message.displayContent ?? message.content)}</div><div class="actions user-actions">${actionButton("copy", "Sao chép", ACTION_ICONS.copy)}${actionButton("edit", "Chỉnh sửa", ACTION_ICONS.edit)}</div></div>`;
      node.querySelector("[data-copy]").onclick = () => copyMessage(message.displayContent ?? message.content);
      node.querySelector("[data-edit]").onclick = () => editUserMessage(message);
    }
  } else {
    const answerMarkup = streaming
      ? ""
      : renderAnswer(message.truncated ? safeTruncatedContent(message.content) : message.content);
    if (streaming) node.classList.add("is-drafting");
    node.innerHTML = `<div class="ai-avatar brand-logo">${BRAND_MARK}</div><div class="ai-main"><div class="ai-name">VECTOR AI</div>${streaming ? answerDraftMarkup() : ""}<div class="answer">${answerMarkup}</div>${sourceMarkup(message.sources)}${message.truncated ? continuationMarkup() : ""}<div class="verification-slot"></div><div class="actions">${actionButton("copy", "Sao chép", ACTION_ICONS.copy)}${actionButton("docx", "Xuất DOCX", ACTION_ICONS.docx)}${actionButton("verify", "Kiểm chứng phép tính", ACTION_ICONS.verify)}${actionButton("retry", "Tạo lại phản hồi", ACTION_ICONS.retry)}</div></div>`;
    if (streaming) bindAnswerDraft(node);
    node.querySelector("[data-copy]").onclick = () => copyMessage(getBufferedAnswer(node) || message.content);
    node.querySelector("[data-docx]").onclick = () => exportMessageDocx(message, getBufferedAnswer(node) || message.content);
    node.querySelector("[data-verify]").onclick = () => verifyAnswer(node, getBufferedAnswer(node) || message.content);
    node.querySelector("[data-retry]").onclick = () => retryMessage(message.id);
    bindSources(node, message.sources);
  }
  bindContinuation(node);
  return node;
}
async function copyMessage(content) {
  await navigator.clipboard.writeText(content || "");
  notify("Đã sao chép");
}
function cleanDocxText(value) {
  return String(value || "")
    .replace(/^:::\s*result\b[^\S\r\n]*\r?\n?/gim, "")
    .replace(/^result\s*:?\s*$/gim, "")
    .replace(/^\s*:::\s*$/gm, "")
    .replace(/```(?:\w+)?/g, "")
    .replace(/\$\$?|\\\[|\\\]|\\\(|\\\)/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}
function base64Bytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
async function exportMessageDocx(message, rawContent) {
  try {
    notify("Đang tạo tài liệu DOCX…");
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, AlignmentType } = await getDocx();
    const lines = cleanDocxText(rawContent).split(/\r?\n/);
    const children = [
      new Paragraph({ text: "VECTOR AI", heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
      new Paragraph({ text: "Tài liệu tiếng Việt được tạo cục bộ", alignment: AlignmentType.CENTER }),
    ];
    for (const sourceLine of lines) {
      const line = sourceLine.trim();
      if (!line) { children.push(new Paragraph("")); continue; }
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][heading[1].length - 1];
        children.push(new Paragraph({ text: heading[2], heading: level }));
      } else if (/^[-*•]\s+/.test(line)) {
        children.push(new Paragraph({ text: line.replace(/^[-*•]\s+/, ""), bullet: { level: 0 } }));
      } else children.push(new Paragraph({ children: [new TextRun({ text: line, size: 24 })], spacing: { after: 120 } }));
    }
    const chat = activeChat();
    const assistantIndex = chat?.messages.findIndex((item) => item.id === message.id) ?? -1;
    const sourceUser = assistantIndex > 0 ? [...chat.messages.slice(0, assistantIndex)].reverse().find((item) => item.role === "user") : null;
    const originalImages = (sourceUser?.attachments || []).flatMap((item) => item.embeddedImages || []).slice(0, 12);
    if (originalImages.length) {
      children.push(new Paragraph({ text: "Hình ảnh gốc để đối chiếu", heading: HeadingLevel.HEADING_1 }));
      originalImages.forEach((image, index) => {
        const type = /jpe?g/i.test(image.type) ? "jpg" : /gif/i.test(image.type) ? "gif" : "png";
        children.push(new Paragraph({ text: `Hình ${index + 1}`, heading: HeadingLevel.HEADING_3 }));
        children.push(new Paragraph({ children: [new ImageRun({ data: base64Bytes(image.data), type, transformation: { width: 520, height: 320 } })], alignment: AlignmentType.CENTER }));
      });
    }
    const documentFile = new Document({ sections: [{ properties: {}, children }] });
    const blob = await Packer.toBlob(documentFile);
    const safeTitle = (chat?.title || "tai-lieu-vector-ai").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
    downloadBlob(blob, `${safeTitle}.docx`);
    notify("Đã xuất tài liệu DOCX");
  } catch (error) {
    console.error(error);
    notify(`Không thể tạo DOCX: ${error.message || error}`);
  }
}
function editUserMessage(message) {
  if (state.generating) return;
  const scrollTop = ui.conversation.scrollTop;
  state.editingMessageId = message.id;
  renderMessages({ preserveScroll: true, scrollTop });
}
function cancelInlineEdit() {
  state.editingMessageId = null;
  renderMessages();
  ui.prompt.focus();
}
function submitInlineEdit(message, value) {
  const text = value.trim();
  if (!text || state.generating) return;
  state.editingMessageId = message.id;
  send({ text });
}

let mathEngine;
async function getMathEngine() {
  if (!mathEngine) mathEngine = await import("mathjs");
  return mathEngine;
}
function normalizeMathSource(source) {
  let value = String(source || "")
    .replace(/\$|\\\(|\\\)|\\\[|\\\]/g, "")
    .replace(/\\(?:left|right|displaystyle)/g, "")
    .replace(/\\(?:times|cdot)|×|·/g, "*")
    .replace(/\\div|÷/g, "/")
    .replace(/−|–/g, "-")
    .replace(/π/g, "pi")
    .replace(/√\s*\(([^()]*)\)/g, "sqrt($1)")
    .replace(/√\s*([\d.]+)/g, "sqrt($1)")
    .replace(/\\sqrt\{([^{}]+)\}/g, "sqrt($1)")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "(($1)/($2))")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[≈≃~]/g, "")
    .replace(/\^\{([^{}]+)\}/g, "^($1)")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .trim();
  value = value.replace(/^[^:]{0,60}:\s*/, "");
  return value.replace(/[;,.]+$/g, "").trim();
}
function normalizeCheckExpression(source) {
  let value = normalizeMathSource(source);
  value = value.replace(/\s*(?:m\/s²|m\/s\^2|m\/s|km\/h|rad\/s|kg\/m³|g\/cm³|cm²|m²|cm³|m³|km|cm|mm|kg|Hz|rad|N|J|W|Pa|V|A|Ω|s|m|h|%)(?=\s|$)/gi, "");
  return value.replace(/[;,.]+$/g, "").trim();
}
function nearlyEqual(a, b) {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.max(1e-9, scale * 5e-4);
}
async function verifyAnswer(node, content) {
  const slot = node.querySelector(".verification-slot");
  const button = node.querySelector("[data-verify]");
  if (!slot || !content || button.disabled) return;
  button.disabled = true;
  slot.innerHTML = `<div class="verification-card loading"><i></i><span>Đang kiểm tra độc lập các phép tính…</span></div>`;
  try {
    const { evaluate, parse } = await getMathEngine();
    const checks = [], unitChecks = [], symbolicChecks = [];
    for (const rawLine of String(content).split(/\n+/)) {
      const line = rawLine.replace(/[*_`#]/g, "").trim();
      if (!line.includes("=") || /=>|<=|>=/.test(line)) continue;
      const sourceParts = line.split(/=+/).filter(Boolean);
      for (let index = 0; index < sourceParts.length - 1; index += 1) {
        const unitLeftSource = normalizeMathSource(sourceParts[index]);
        const unitRightSource = normalizeMathSource(sourceParts[index + 1]);
        let unitHandled = false;
        try {
          const leftUnit = evaluate(unitLeftSource), rightUnit = evaluate(unitRightSource);
          if (leftUnit?.isUnit && rightUnit?.isUnit) {
            const sameDimension = leftUnit.equalBase(rightUnit);
            unitChecks.push({
              source: `${unitLeftSource} = ${unitRightSource}`,
              ok: sameDimension && leftUnit.equals(rightUnit),
              detail: sameDimension ? `${leftUnit.toString()} ≠ ${rightUnit.toString()}` : "Hai vế khác thứ nguyên",
            });
            unitHandled = true;
          }
        } catch { /* Không phải biểu thức đơn vị hoàn chỉnh. */ }
        if (unitHandled) continue;
        const leftSource = normalizeCheckExpression(sourceParts[index]);
        const rightSource = normalizeCheckExpression(sourceParts[index + 1]);
        if (!leftSource || !rightSource) continue;
        try {
          const left = evaluate(leftSource);
          const right = evaluate(rightSource);
          if (typeof left !== "number" || typeof right !== "number" || !Number.isFinite(left) || !Number.isFinite(right)) continue;
          checks.push({ source: `${leftSource} = ${rightSource}`, left, right, ok: nearlyEqual(left, right) });
          continue;
        } catch { /* Có thể là một đồng nhất thức đại số. */ }
        try {
          const symbols = new Set();
          [parse(leftSource), parse(rightSource)].forEach((tree) => tree.traverse((child) => {
            if (child.isSymbolNode && !["pi", "e", "sqrt", "sin", "cos", "tan", "log", "ln", "abs"].includes(child.name)) symbols.add(child.name);
          }));
          if (!symbols.size || symbols.size > 5) continue;
          const values = [-2.3, .7, 2.1];
          let validSamples = 0, equivalent = true;
          for (let sample = 0; sample < values.length; sample += 1) {
            const scope = Object.fromEntries([...symbols].map((name, position) => [name, values[(sample + position) % values.length]]));
            try {
              const left = evaluate(leftSource, scope), right = evaluate(rightSource, scope);
              if (typeof left !== "number" || typeof right !== "number" || !Number.isFinite(left) || !Number.isFinite(right)) continue;
              validSamples += 1;
              if (!nearlyEqual(left, right)) { equivalent = false; break; }
            } catch { /* Điểm thử ngoài miền xác định. */ }
          }
          if (equivalent && validSamples >= 2) symbolicChecks.push({ source: `${leftSource} = ${rightSource}`, ok: true });
        } catch { /* Không đủ an toàn để kết luận. */ }
      }
    }
    const allChecks = [...checks, ...unitChecks, ...symbolicChecks];
    const failed = [...checks, ...unitChecks].filter((item) => !item.ok);
    const badges = [
      checks.length ? `<em>Số học ${checks.length}</em>` : "",
      symbolicChecks.length ? `<em>Đại số ${symbolicChecks.length}</em>` : "",
      unitChecks.length ? `<em>Đơn vị ${unitChecks.length}</em>` : "",
    ].join("");
    if (!allChecks.length) {
      slot.innerHTML = `<div class="verification-card neutral"><b>Chưa đủ dữ liệu để kiểm chứng tự động</b><span>Không phát hiện được đẳng thức số, đồng nhất thức đại số hoặc phép đổi đơn vị đủ rõ.</span></div>`;
    } else if (!failed.length) {
      slot.innerHTML = `<div class="verification-card passed"><b>Đã kiểm chứng ${allChecks.length} bước</b><div class="verification-badges">${badges}</div><span>Các bước máy đọc được đều nhất quán. Giả thiết và phương pháp giải vẫn nên được đối chiếu.</span></div>`;
    } else {
      slot.innerHTML = `<div class="verification-card failed"><b>Phát hiện ${failed.length} bước cần xem lại</b><div class="verification-badges">${badges}</div>${failed.slice(0, 3).map((item) => `<code>${esc(item.source)} → ${esc(item.detail || `${item.left} ≠ ${item.right}`)}</code>`).join("")}<span>Công cụ không tự sửa phản hồi để bạn vẫn nhìn thấy nội dung gốc.</span></div>`;
    }
  } catch (error) {
    slot.innerHTML = `<div class="verification-card failed"><b>Không thể chạy bộ kiểm chứng</b><span>${esc(error.message || error)}</span></div>`;
  } finally {
    button.disabled = false;
  }
}
function continuationMarkup() {
  return `<div class="continuation-notice"><span>Phản hồi đã chạm giới hạn độ dài.</span><button type="button" data-continue>Tiếp tục</button></div>`;
}
function bindContinuation(node) {
  const button = node.querySelector("[data-continue]");
  if (!button) return;
  button.onclick = () => continueMessage(node.dataset.id);
}
function renderMessages({ preserveScroll = false, scrollTop = ui.conversation.scrollTop } = {}) {
  const chat = activeChat();
  visualRenderer.dispose(ui.messages);
  const messages = chat?.messages || [];
  ui.welcome.classList.toggle("hidden", messages.length > 0);
  const fragment = document.createDocumentFragment();
  messages.forEach((m) => fragment.append(createMessage(m)));
  ui.messages.replaceChildren(fragment);
  hydrateVisuals(ui.messages);
  updateContextStatus();
  if (preserveScroll) {
    // Khôi phục ngay và thêm một nhịp sau layout để textarea tự co giãn
    // không kéo cuộc trò chuyện xuống cuối.
    ui.conversation.scrollTop = scrollTop;
    requestAnimationFrame(() => { ui.conversation.scrollTop = scrollTop; updateScrollLatest(); });
  } else bottom(true);
}
function isNearBottom() {
  return ui.conversation.scrollHeight - ui.conversation.scrollTop - ui.conversation.clientHeight < 150;
}
function updateScrollLatest() {
  ui.scrollLatest.classList.toggle("visible", !isNearBottom() && ui.messages.children.length > 0);
}
function bottom(force = true, smooth = true) {
  if (!force && !isNearBottom()) return;
  requestAnimationFrame(() => {
    ui.conversation.scrollTo({ top: ui.conversation.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    updateScrollLatest();
  });
}
function notify(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add("show");
  clearTimeout(notify.t);
  const visibleFor = Math.min(5200, Math.max(2600, String(text).length * 42));
  notify.t = setTimeout(() => ui.toast.classList.remove("show"), visibleFor);
}
function resize() {
  ui.prompt.style.height = "auto";
  ui.prompt.style.height = Math.min(ui.prompt.scrollHeight, 180) + "px";
  document.querySelector(".composer")?.classList.toggle("has-content", Boolean(ui.prompt.value.trim()) || state.attachments.length > 0);
}
function setGenerating(value) {
  state.generating = value;
  modeSelect.disabled = value || Boolean(state.modelOperation);
  ui.send.classList.toggle("running", value);
  ui.send.setAttribute("aria-label", value ? "Dừng phản hồi" : "Gửi tin nhắn");
  ui.prompt.disabled = value;
  if (!value) ui.prompt.focus({ preventScroll: true });
}

function normalizeQuickText(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function quickReply(text) {
  const value = normalizeQuickText(text);
  const exact = (...items) => items.includes(value);
  if (
    exact(
      "xin chao",
      "chao",
      "hello",
      "hi",
      "hey",
      "alo",
      "chao ban",
      "xin chao ban",
    )
  )
    return "Xin chào! Mình là **VECTOR AI**. Hôm nay bạn muốn mình giúp gì?";
  if (exact("cam on", "cam on ban", "thanks", "thank you"))
    return "Không có gì! Mình luôn sẵn sàng giúp bạn.";
  if (exact("tam biet", "bye", "goodbye", "hen gap lai"))
    return "Tạm biệt bạn! Hẹn gặp lại nhé.";
  if (exact("ban la ai", "ban ten gi", "ten ban la gi"))
    return "Mình là **VECTOR AI**, trợ lý AI chạy cục bộ trên thiết bị của bạn.";
  if (exact("ban khoe khong", "khoe khong", "hom nay ban the nao"))
    return "Mình hoạt động tốt và sẵn sàng hỗ trợ bạn. Còn bạn hôm nay thế nào?";
  if (exact("ok", "oke", "okay", "duoc", "tot", "hay lam"))
    return "Được rồi! Bạn cứ gửi yêu cầu tiếp theo nhé.";
  return null;
}

function finishImmediateReply(chat, content) {
  const assistant = {
    id: id(),
    role: "assistant",
    content,
    createdAt: Date.now(),
  };
  chat.messages.push(assistant);
  chat.updatedAt = Date.now();
  saveChats();
  renderList();
  const node = createMessage(assistant);
  ui.messages.append(node);
  bottom();
}

const slashCommands = [
  { command: "/new", icon: "＋", description: "Tạo cuộc trò chuyện mới" },
  {
    command: "/clear",
    icon: "⌫",
    description: "Xóa nội dung cuộc trò chuyện hiện tại",
  },
  {
    command: "/delete-all",
    icon: "♲",
    description: "Xóa toàn bộ chat trong workspace hiện tại",
  },
  {
    command: "/status",
    icon: "●",
    description: "Kiểm tra trạng thái Ollama và model",
  },
  { command: "/setup", icon: "⚙", description: "Mở thiết lập Ollama và Qwen" },
  { command: "/help", icon: "?", description: "Hiện danh sách lệnh tắt" },
];
function commandMatches() {
  if (!ui.prompt.value.trimStart().startsWith("/")) return [];
  const query = ui.prompt.value.trim().toLowerCase();
  return slashCommands.filter(
    (item) =>
      item.command.includes(query) ||
      item.description.toLowerCase().includes(query.slice(1)),
  );
}
function renderSlashMenu(force = false) {
  const items = force ? slashCommands : commandMatches();
  state.slashIndex = Math.max(0, Math.min(state.slashIndex, items.length - 1));
  ui.slashMenu.classList.toggle("open", items.length > 0);
  ui.slashMenu.innerHTML = items
    .map(
      (item, index) =>
        `<button data-command="${item.command}" class="${index === state.slashIndex ? "selected" : ""}"><i>${item.icon}</i><span><b>${item.command}</b><small>${item.description}</small></span><kbd>↵</kbd></button>`,
    )
    .join("");
  ui.slashMenu.querySelectorAll("[data-command]").forEach(
    (button) =>
      (button.onclick = () => executeSlashCommand(button.dataset.command)),
  );
}
function clearPrompt() {
  ui.prompt.value = "";
  state.attachments = [];
  renderAttachments();
  renderSlashMenu();
  resize();
}
async function executeSlashCommand(raw) {
  const aliases = {
    "/delect-all-chat": "/delete-all",
    "/delete-all-chat": "/delete-all",
    "/delete all chat": "/delete-all",
    "/xoa-tat-ca": "/delete-all",
    "/xoa": "/clear",
  };
  const command = aliases[raw.trim().toLowerCase()] || raw.trim().toLowerCase();
  if (!slashCommands.some((item) => item.command === command)) return false;
  clearPrompt();
  if (command === "/new") {
    newChat();
    notify("Đã tạo cuộc trò chuyện mới");
  }
  if (command === "/clear") {
    const chat = activeChat();
    if (chat && await confirmAction({ title: "Dọn cuộc trò chuyện?", message: "Toàn bộ tin nhắn trong cuộc trò chuyện hiện tại sẽ bị xóa.", acceptLabel: "Dọn sạch" })) {
      chat.messages = [];
      chat.updatedAt = Date.now();
      saveChats();
      renderMessages();
      renderList();
      notify("Đã dọn cuộc trò chuyện");
      ui.prompt.focus();
    }
  }
  if (
    command === "/delete-all" &&
    await confirmAction({ title: "Xóa toàn bộ lịch sử?", message: `Mọi cuộc trò chuyện trong ${activeWorkspace()?.name || "Chat thường"} sẽ bị xóa và không thể hoàn tác.`, acceptLabel: "Xóa tất cả" })
  ) {
    state.chats = [];
    state.activeId = null;
    saveChats();
    renderList();
    renderMessages();
    notify("Đã xóa toàn bộ lịch sử");
    ui.prompt.focus();
  }
  if (command === "/status") {
    const status = await refreshStatus(false);
    notify(
      status.modelReady
        ? `${compactModelName(state.selectedModel)} đang sẵn sàng`
        : status.running
          ? "Ollama đang chạy, model chưa sẵn sàng"
          : "Ollama chưa chạy",
    );
  }
  if (command === "/setup") {
    state.setupDismissed = false;
    await refreshStatus(true);
  }
  if (command === "/help") {
    ui.prompt.value = "/";
    renderSlashMenu(true);
    ui.prompt.focus();
  }
  return true;
}

function renderAttachments() {
  ui.attachmentPreview.innerHTML = state.attachments
    .map(
      (item, index) =>
        `<div class="pending-file">${item.kind === "image" ? `<img src="${item.preview}" alt="">` : `<b>📄</b>`}<span title="${esc(item.name)}">${esc(item.name)}</span><button data-remove="${index}" title="Bỏ tệp">×</button></div>`,
    )
    .join("");
  ui.attachmentPreview.classList.toggle(
    "visible",
    state.attachments.length > 0,
  );
  document.querySelector(".composer")?.classList.toggle(
    "has-content",
    Boolean(ui.prompt.value.trim()) || state.attachments.length > 0,
  );
  ui.attachmentPreview.querySelectorAll("[data-remove]").forEach(
    (button) =>
      (button.onclick = () => {
        state.attachments.splice(Number(button.dataset.remove), 1);
        renderAttachments();
      }),
  );
}
function asDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
function docxTextFromHtml(html) {
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  documentNode.querySelectorAll("img").forEach((image, index) => image.replaceWith(documentNode.createTextNode(`\n[HÌNH ${index + 1} TRONG TÀI LIỆU]\n`)));
  documentNode.querySelectorAll("h1,h2,h3,h4,p,li,tr,table").forEach((node) => node.append(documentNode.createTextNode("\n")));
  return (documentNode.body.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
async function parseDocx(file) {
  const mammoth = await getMammoth();
  const images = [];
  let unsupportedImages = 0;
  const result = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    { convertImage: mammoth.images.imgElement(async (image) => {
      const base64 = await image.read("base64");
      const contentType = (image.contentType || "").toLowerCase();
      // Ollama vision không giải mã được EMF/WMF thường gặp trong Word.
      // Chỉ gửi các định dạng raster mà backend hỗ trợ để tránh HTTP 400.
      if (/^image\/(png|jpe?g|webp)$/.test(contentType)) {
        if (images.length < 8) images.push({ data: base64, type: contentType });
      } else unsupportedImages += 1;
      return { src: `data:${image.contentType || "image/png"};base64,${base64}` };
    }) },
  );
  const text = docxTextFromHtml(result.value);
  if (!text && !images.length) throw new Error("không đọc được nội dung DOCX");
  return { text, embeddedImages: images, unsupportedImages, conversionWarnings: (result.messages || []).map((item) => item.message) };
}
async function addFiles(files) {
  const available = Math.max(0, 4 - state.attachments.length);
  const selected = [...files].slice(0, available);
  if (!available) {
    notify("Mỗi câu gửi tối đa 4 tệp");
    return;
  }
  for (const file of selected) {
    try {
      if (state.backend && !file.type.startsWith("image/")) {
        if (!state.activeId) newChat();
        const data = new FormData();
        data.append("file", file);
        data.append("scope", JSON.stringify(backendScope()));
        data.append("embedding_profile_id", selectedEmbeddingProfile() || "");
        await backendApi.request("/documents", { method: "POST", body: data, timeout: 60000 });
        notify(`${file.name}: đã nhập vào Python Core. Xem tiến độ / duyệt công thức ở RAG trước khi hỏi tài liệu.`);
        continue;
      }
      const isDocx = file.name.toLowerCase().endsWith(".docx") || file.type.includes("wordprocessingml");
      if (file.type.startsWith("image/")) {
        if (file.size > 10 * 1024 * 1024) throw new Error("Ảnh vượt quá 10 MB");
        const preview = await asDataUrl(file);
        state.attachments.push({
          kind: "image",
          name: file.name,
          type: file.type,
          preview,
          data: preview.split(",")[1],
        });
      } else if (isDocx) {
        if (file.size > 25 * 1024 * 1024) throw new Error("DOCX vượt quá 25 MB");
        const parsed = await parseDocx(file);
        state.attachments.push({
          kind: "document", name: file.name, type: file.type, size: file.size,
          text: parsed.text, embeddedImages: parsed.embeddedImages,
          unsupportedImages: parsed.unsupportedImages,
          conversionWarnings: parsed.conversionWarnings,
        });
        if (parsed.text.length > 45000) notify(`${file.name}: tài liệu dài, nên dịch theo từng phần`);
      } else {
        if (file.size > 500 * 1024)
          throw new Error("Tệp văn bản vượt quá 500 KB");
        state.attachments.push({
          kind: "text",
          name: file.name,
          type: file.type || "text/plain",
          text: await file.text(),
        });
      }
    } catch (error) {
      notify(`${file.name}: ${error.message || error}`);
    }
  }
  ui.fileInput.value = "";
  renderAttachments();
}
function prepareAttachedPrompt(text, attachments) {
  const documentImageLimit = state.mode === "DEEP" ? 6 : 2;
  const images = attachments
    .filter((item) => item.kind === "image")
    .map((item) => item.data)
    .concat(attachments.flatMap((item) => (item.embeddedImages || []).map((image) => image.data)).slice(0, documentImageLimit));
  const documents = attachments.filter((item) => item.kind === "text" || item.kind === "document");
  const base =
    text ||
    (images.length
      ? "Hãy phân tích nội dung trong hình ảnh này."
      : "Hãy đọc và phân tích tệp đính kèm.");
  let remainingChars = state.mode === "DEEP" ? 30000 : 9000;
  const content = documents.reduce((result, item) => {
    if (remainingChars <= 0) return `${result}\n\n[${item.name}: chưa đưa vào lượt này vì đã hết ngân sách tài liệu.]`;
    const original = item.text || "";
    const selected = selectAttachedDocumentText(original, text, remainingChars);
    remainingChars -= selected.text.length;
    const rangeNote = selected.omitted
      ? ` Chỉ ${selected.text.length.toLocaleString("vi-VN")}/${original.length.toLocaleString("vi-VN")} ký tự liên quan được đưa vào lượt này; tài liệu vẫn còn phần chưa xử lý.`
      : "";
    const documentNote = item.kind === "document"
      ? `[DOCX đã được tách văn bản và hình.${rangeNote} Với công thức trong hình: chép đúng ký hiệu trước khi dịch, không tự thay số; nếu không chắc phải đánh dấu [CẦN KIỂM TRA]. Khi dịch, giữ cấu trúc tiêu đề, danh sách, bảng và mã hình.${item.unsupportedImages ? ` Có ${item.unsupportedImages} hình vector EMF/WMF không thể gửi cho bộ vision; phải ghi rõ phần này chưa được đọc.` : ""}]\n\n`
      : rangeNote ? `[Tệp dài.${rangeNote}]\n\n` : "";
    return `${result}\n\n--- TỆP: ${item.name} ---\n${documentNote}${selected.text}\n\n--- HẾT PHẦN ĐƯỢC CHỌN ---`;
  }, base);
  return { content, images };
}
function selectAttachedDocumentText(source, question, limit) {
  if (source.length <= limit) return { text: source, omitted: false };
  const normalizedQuestion = normalizeQuickText(question || "");
  const wantsWholeDocument = /toan bo|dich|bien soan|tao lai|tom tat tai lieu/.test(normalizedQuestion);
  if (wantsWholeDocument) return { text: source.slice(0, limit), omitted: true };
  const terms = referenceTerms(question || "");
  const chunks = splitReferenceText(source, 42);
  const ranked = chunks
    .map((chunk) => ({ ...chunk, score: terms.reduce((score, term) => score + (normalizeQuickText(chunk.text).includes(term) ? 1 : 0), 0) }))
    .sort((left, right) => right.score - left.score || left.start - right.start);
  const selected = [];
  let used = 0;
  for (const chunk of ranked) {
    if (selected.length && used + chunk.text.length > limit) continue;
    selected.push(chunk); used += chunk.text.length;
    if (used >= limit * .88) break;
  }
  selected.sort((left, right) => left.start - right.start);
  return { text: selected.map((chunk) => chunk.text).join("\n\n[… phần không liên quan đã lược …]\n\n").slice(0, limit), omitted: true };
}
function referenceTerms(text) {
  const ignored = new Set(["cua","cho","voi","trong","theo","nay","kia","mot","nhung","cac","hay","va","la","duoc","toi","ban"]);
  return [...new Set(normalizeQuickText(text).split(" ").filter((term) => term.length > 2 && !ignored.has(term)))];
}
let semanticSearchUnavailable = false;
function splitReferenceText(text, maximum = 24) {
  const size = 1400, overlap = 220;
  const available = Math.max(1, Math.ceil(Math.max(0, text.length - overlap) / (size - overlap)));
  const count = Math.min(maximum, available);
  const chunks = [];
  for (let index = 0; index < count; index += 1) {
    const start = count === available ? index * (size - overlap) : Math.round(index * Math.max(0, text.length - size) / Math.max(1, count - 1));
    chunks.push({ id: index + 1, start, text: text.slice(start, start + size) });
  }
  return chunks;
}
async function embedTexts(inputs) {
  if (!inputs.length) return [];
  const model = embeddingModel();
  if (inTauri) return invoke("embed_texts", { request: { inputs, model } });
  const response = await fetch("/ollama/api/embed", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: inputs, truncate: true, keep_alive: "2m" }),
  });
  if (!response.ok) throw new Error(`Ollama embedding HTTP ${response.status}`);
  return (await response.json()).embeddings || [];
}
function cosineSimilarity(left, right) {
  if (!left?.length || left.length !== right?.length) return -1;
  let dot = 0, normLeft = 0, normRight = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]; normLeft += left[index] ** 2; normRight += right[index] ** 2;
  }
  return normLeft && normRight ? dot / Math.sqrt(normLeft * normRight) : -1;
}
async function ensureSemanticIndex(records) {
  // Chỉ Python Core được tạo embedding theo profile. Chế độ tương thích
  // chỉ tìm từ khóa; không dùng model chat làm embedding hoặc index khi hỏi.
  return false;
}
async function workspaceReferenceContext(question) {
  const workspace = activeWorkspace();
  const strict = Boolean(workspace?.strictReferences);
  if (!workspace?.files?.length) return { context: "", images: [], sources: [], strict };
  const records = (await workspaceDbGetMany(workspace.files.map((file) => file.id))).filter(Boolean);
  const terms = referenceTerms(question);
  const broadRequest = /tài liệu|tham chiếu|workspace|đã tải|đính kèm/i.test(question);
  const candidates = [];
  const semanticReady = await ensureSemanticIndex(records);
  let questionEmbedding;
  if (semanticReady) {
    try { [questionEmbedding] = await embedTexts([question]); }
    catch { semanticSearchUnavailable = true; }
  }
  for (const record of records.filter((item) => item.kind === "text" || item.kind === "document")) {
    const chunks = semanticReady && record.semanticChunks?.length
      ? record.semanticChunks
      : splitReferenceText(record.text || "", 64);
    for (const item of chunks) {
      const normalized = normalizeQuickText(item.text);
      const lexical = terms.reduce((sum, term) => sum + (normalized.includes(term) ? 1 : 0), 0);
      const semantic = questionEmbedding && item.embedding ? cosineSimilarity(questionEmbedding, item.embedding) : -1;
      const score = lexical * 0.22 + Math.max(0, semantic);
      if (lexical > 0 || semantic > .18 || broadRequest) candidates.push({ score, name: record.name, fileId: record.id, chunkId: item.id, start: item.start, chunk: item.text });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const maxChars = state.mode === "DEEP" ? 18000 : 7000;
  let used = 0;
  const selected = [];
  for (const item of candidates) {
    if (selected.length >= 8 || (selected.length && used + item.chunk.length > maxChars)) break;
    selected.push(item); used += item.chunk.length;
  }
  const wantsImages = /ảnh|hình|image|photo|xem/i.test(normalizeQuickText(question));
  const imageRecords = wantsImages
    ? records.filter((item) => item.kind === "image" && (broadRequest || terms.some((term) => normalizeQuickText(item.name).includes(term)))).slice(0, 2)
    : [];
  const documentImages = wantsImages
    ? records.filter((item) => item.kind === "document").flatMap((item) => item.embeddedImages || []).slice(0, 6)
    : [];
  const sources = selected.map((item, index) => ({ id: `D${index + 1}`, fileId: item.fileId, name: item.name, chunkId: item.chunkId, start: item.start, excerpt: item.chunk.slice(0, 520) }));
  let context = selected.length
    ? `\n\n[TÀI LIỆU THAM CHIẾU CỦA WORKSPACE — chỉ dùng nội dung phù hợp, không tự bịa phần còn thiếu. Sau thông tin lấy từ tài liệu, ghi mã nguồn dạng [D1], [D2]. Nếu tài liệu không đủ để trả lời, nói rõ.]\n${selected.map((item, index) => `\n--- [D${index + 1}] ${item.name}, đoạn ${item.chunkId} ---\n${item.chunk}`).join("\n")}\n[HẾT TÀI LIỆU THAM CHIẾU]`
    : "";
  return { context, images: [...imageRecords.map((item) => item.data), ...documentImages.map((item) => item.data)], sources, semantic: Boolean(questionEmbedding), strict };
}

async function archiveChatAttachments(chat, attachments) {
  const useful = attachments.filter((item) => item.kind === "document" || item.kind === "text" || item.kind === "image");
  if (!useful.length) return;
  chat.files ||= [];
  for (const item of useful) {
    const fileId = id();
    const record = {
      id: fileId, chatId: chat.id, name: item.name, type: item.type,
      kind: item.kind, createdAt: Date.now(), text: item.text,
      data: item.data, embeddedImages: item.embeddedImages,
      unsupportedImages: item.unsupportedImages,
    };
    await workspaceDbPut(record);
    chat.files.push({ id: fileId, name: item.name, type: item.type, kind: item.kind, createdAt: record.createdAt });
  }
}
async function chatFileReferenceContext(question, chat) {
  if (!chat?.files?.length) return { context: "", images: [], sources: [] };
  const records = (await workspaceDbGetMany(chat.files.map((file) => file.id))).filter(Boolean);
  const terms = referenceTerms(question || "");
  const normalizedQuestion = normalizeQuickText(question || "");
  const explicitlyUsesFiles = /tai lieu|tep|docx|dich|bien soan|cong thuc|hinh|anh|tiep tuc|phan tiep/.test(normalizedQuestion);
  let remaining = state.mode === "DEEP" ? 7000 : 2500;
  const sources = [];
  const excerpts = [];
  for (const record of records.filter((item) => item.text)) {
    if (remaining <= 0) break;
    const normalizedRecord = normalizeQuickText(record.text);
    if (!explicitlyUsesFiles && !terms.some((term) => normalizedRecord.includes(term))) continue;
    const selected = selectAttachedDocumentText(record.text, question, remaining);
    if (!selected.text) continue;
    const sourceId = `C${sources.length + 1}`;
    sources.push({ id: sourceId, fileId: record.id, name: record.name, chunkId: 1, start: 0, excerpt: selected.text.slice(0, 520) });
    excerpts.push(`--- [${sourceId}] ${record.name} ---\n${selected.text}`);
    remaining -= selected.text.length;
  }
  const wantsImages = /anh|hinh|cong thuc|so do|bang|image|formula/.test(normalizeQuickText(question));
  const imageLimit = state.mode === "DEEP" ? 3 : 1;
  const images = wantsImages
    ? records.flatMap((item) => item.kind === "image" ? [item.data] : (item.embeddedImages || []).map((image) => image.data)).filter(Boolean).slice(0, imageLimit)
    : [];
  const context = excerpts.length
    ? `\n\n[KHO TỆP RIÊNG CỦA CHAT — các đoạn sau được truy xuất tạm thời, không phải toàn bộ tài liệu. Trích dẫn bằng [C1], [C2].]\n${excerpts.join("\n\n")}\n[HẾT PHẦN TRUY XUẤT]`
    : "";
  return { context, images, sources };
}
async function combinedReferenceContext(question, chat) {
  if (state.backend) return { context: "", images: [], sources: [], strict: false, backend: true };
  const [builtin, workspace, chatFiles] = await Promise.all([
    builtinReferenceContext(question, { reasoning: state.reasoning }),
    workspaceReferenceContext(question),
    chatFileReferenceContext(question, chat),
  ]);
  const sources = [...(builtin.sources || []), ...(workspace.sources || []), ...(chatFiles.sources || [])];
  let context = `${builtin.context || ""}${workspace.context || ""}${chatFiles.context || ""}`;
  const strict = onlyDocumentSources(activeWorkspace());
  context += `\n\n[${strict ? DOCUMENT_SOURCE_INSTRUCTION : MODEL_SOURCE_INSTRUCTION}]`;
  return {
    context,
    images: [...(builtin.images || []), ...(workspace.images || []), ...(chatFiles.images || [])],
    sources,
    strict,
  };
}

async function getStatus() {
  const model = modelForMode();
  if (inTauri) return invoke("ollama_status", { model });
  try {
    const response = await fetch("/ollama/api/tags");
    const body = await response.json();
    const ready = (body.models || []).some(
      (m) => sameModelName(m.name || m.model, model),
    );
    return {
      running: true,
      installed: true,
      modelReady: ready,
      model,
      error: "",
    };
  } catch (error) {
    return {
      running: false,
      installed: false,
      modelReady: false,
      model,
      error: error.message,
    };
  }
}

async function ensureDesktopOllama() {
  if (!inTauri) return null;
  const model = modelForMode();
  let status = await invoke("ollama_status", { model });
  if (status.installed && !status.running) {
    await invoke("start_ollama");
    status = await invoke("ollama_status", { model });
  }
  return status;
}

function compactModelName(name) {
  const tail = String(name || MODEL).split("/").pop();
  return tail.length > 30 ? `${tail.slice(0, 27)}…` : tail;
}
function formatModelSize(bytes) {
  return bytes ? `${(bytes / 1024 ** 3).toFixed(bytes > 1024 ** 3 ? 1 : 2)} GB` : "Không rõ dung lượng";
}
function canonicalModelName(name) {
  const value = String(name || "").trim();
  if (!value) return "";
  const leaf = value.split("/").pop() || "";
  return leaf.includes(":") ? value : `${value}:latest`;
}
function sameModelName(left, right) {
  return canonicalModelName(left) === canonicalModelName(right);
}
async function getInstalledModels() {
  if (inTauri) return invoke("list_models");
  const response = await fetch("/ollama/api/tags");
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Ollama HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  const body = await response.json();
  return (body.models || []).map((item) => ({
    name: item.name || item.model, size: item.size || 0,
    parameterSize: item.details?.parameter_size || "", quantization: item.details?.quantization_level || "",
  }));
}
async function requestModelDeletion(model) {
  if (inTauri) return invoke("delete_model", { model });
  try {
    const runningResponse = await fetch("/ollama/api/ps");
    if (runningResponse.ok) {
      const running = await runningResponse.json();
      const isLoaded = (running.models || []).some((item) => sameModelName(item.name || item.model, model));
      if (isLoaded) {
        await fetch("/ollama/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, stream: false, keep_alive: 0 }),
        });
      }
    }
  } catch {
    // DELETE vẫn có thể thành công nếu Ollama không trả được danh sách model đang nạp.
  }
  const response = await fetch("/ollama/api/delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Ollama HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
}
async function deleteInstalledModel(modelName) {
  const model = state.installedModels.find((item) => item.name === modelName);
  if (!model) {
    notify("Model này không còn trong thư viện Ollama");
    return;
  }
  if (state.generating) {
    notify("Hãy dừng phản hồi hiện tại trước khi xóa model");
    return;
  }
  if (state.modelOperation) {
    notify("Một thao tác model khác đang được thực hiện");
    return;
  }
  state.modelOperation = "delete";
  try {
    const isAssigned = sameModelName(model.name, state.selectedModel);
    const accepted = await confirmAction({
      title: `Xóa model “${compactModelName(model.name)}”?`,
      message: `${isAssigned ? "Model này đang được VECTOR AI sử dụng. Ứng dụng sẽ tự chọn model còn lại. " : ""}Model ${model.name} (${formatModelSize(model.size)}) sẽ bị xóa vĩnh viễn khỏi Ollama. Hội thoại, Workspace và tài liệu của bạn vẫn được giữ nguyên.`,
      acceptLabel: "Xóa model",
    });
    if (!accepted) return;
    if (state.generating) {
      notify("Hãy dừng phản hồi hiện tại trước khi xóa model");
      return;
    }

    const deleteButton = Array.from(ui.installedModels.querySelectorAll("[data-model-delete]"))
      .find((button) => button.dataset.modelDelete === model.name);
    const row = deleteButton?.closest(".installed-model-row");
    if (deleteButton) deleteButton.disabled = true;
    row?.classList.add("deleting");

    await requestModelDeletion(model.name);
    let refreshWarning = false;
    try {
      state.installedModels = (await getInstalledModels())
        .filter((item) => !sameModelName(item.name, model.name));
    } catch {
      state.installedModels = state.installedModels.filter((item) => !sameModelName(item.name, model.name));
      refreshWarning = true;
    }
    const fallback = (preferred) => state.installedModels.find((item) => sameModelName(item.name, preferred))?.name
      || state.installedModels.find((item) => !sameModelName(item.name, model.name))?.name
      || state.installedModels[0]?.name
      || preferred;
    if (isAssigned) selectChatModel(fallback(QUICK_MODEL), { announce: false });
    syncActiveModel();
    renderModelManager();
    try {
      if (state.installedModels.length) {
        await refreshStatus(false);
      } else {
        state.setupDismissed = false;
        ui.modelModal.classList.remove("open");
        await refreshStatus(true);
      }
    } catch {
      refreshWarning = true;
    }
    notify(refreshWarning
      ? `Đã xóa ${compactModelName(model.name)}; danh sách sẽ được làm mới khi mở lại`
      : `Đã xóa ${compactModelName(model.name)}`);
  } catch (error) {
    renderModelManager();
    notify(`Không thể xóa model: ${error?.message || error}`);
  } finally {
    state.modelOperation = null;
  }
}
function renderModelManager() {
  renderReasoningMode();
  if (!state.installedModels.length) {
    ui.installedModels.innerHTML = '<div class="model-loading">Chưa tìm thấy model nào trong Ollama.</div>';
    return;
  }
  const thinkingLabel = REASONING_PROFILES[state.mode].think ? "Thinking bật" : "Thinking tắt";
  ui.installedModels.innerHTML = `<div class="model-mode-summary" role="status">Model chat: <b>${esc(compactModelName(state.selectedModel))}</b> · ${modeLabel()} · ${thinkingLabel}</div>` + state.installedModels.map((model) => {
    const active = sameModelName(model.name, state.selectedModel);
    return `
    <div class="installed-model-row${active ? " active" : ""}">
      <button type="button" class="installed-model ${active ? "active" : ""}" data-model-select="${esc(model.name)}" aria-pressed="${active}" title="Chọn ${esc(compactModelName(model.name))} để chat">
        <span class="model-radio"><i></i></span><span><b>${esc(compactModelName(model.name))}</b><small>${esc([model.parameterSize, model.quantization, formatModelSize(model.size)].filter(Boolean).join(" · "))}</small>${active ? `<small class="model-current-mode">Đang dùng · ${modeLabel()} · ${thinkingLabel}</small>` : ""}</span>
      </button>
      <button type="button" class="model-delete${active ? " active-model" : ""}" data-model-delete="${esc(model.name)}" aria-label="Xóa model ${esc(model.name)}" title="${active ? "Xóa model đang sử dụng" : "Xóa model"}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>
      </button>
    </div>`;
  }).join("");
  ui.installedModels.querySelectorAll("[data-model-select]").forEach((button) => button.onclick = () => {
    if (state.generating || state.modelOperation) {
      notify(state.generating ? "Hãy dừng phản hồi hiện tại trước khi đổi model" : "Hãy chờ thao tác model hiện tại hoàn tất");
      return;
    }
    selectChatModel(button.dataset.modelSelect);
    renderModelManager();
    refreshStatus(false).catch(() => notify("Đã chọn model; chưa kiểm tra được kết nối Ollama"));
  });
  ui.installedModels.querySelectorAll("[data-model-delete]").forEach((button) => {
    button.onclick = () => deleteInstalledModel(button.dataset.modelDelete);
  });
}
async function openModelManager() {
  if (!state.status?.running) { state.setupDismissed = false; await refreshStatus(true); return; }
  if (!state.modelOperation) {
    [ui.modelDownloadProgress, ui.modelBackupProgress].forEach((progress) => {
      progress.hidden = true;
      progress.dataset.kind = "";
      progress.querySelector("i span").style.width = "0%";
      progress.querySelector("small").textContent = "Đang chuẩn bị…";
    });
  }
  ui.modelModal.classList.add("open");
  setTimeout(() => $("#closeModels").focus(), 0);
  ui.installedModels.innerHTML = '<div class="model-loading">Đang đọc thư viện Ollama…</div>';
  try {
    state.installedModels = await getInstalledModels();
    const selected = state.installedModels.find((model) => sameModelName(model.name, state.selectedModel));
    if (selected) selectChatModel(selected.name, { announce: false });
    syncActiveModel();
    renderModelManager();
  } catch (error) { ui.installedModels.innerHTML = `<div class="model-loading error">${esc(error.message || error)}</div>`; }
}
async function downloadNamedModel() {
  const model = ui.modelInput.value.trim();
  if (!model || /\s/.test(model)) { notify("Tên model không hợp lệ"); return; }
  if (!inTauri) { notify(`Chạy: ollama pull ${model}`); return; }
  if (state.modelOperation) { notify("Một thao tác model khác đang được thực hiện"); return; }
  state.modelOperation = "download";
  const button = $("#downloadModel"), progress = ui.modelDownloadProgress;
  button.disabled = true; progress.hidden = false;
  const bar = progress.querySelector("span"), label = progress.querySelector("small");
  progress.dataset.kind = "working";
  bar.style.width = "0%";
  label.textContent = "Đang chuẩn bị tải model…";
  let unlisten;
  try {
    unlisten = await listen("model-pull", (event) => {
      const percent = event.payload.percent || 0; bar.style.width = `${percent}%`; label.textContent = `${event.payload.status || "Đang tải"} · ${percent}%`;
    });
    await invoke("pull_named_model", { model });
    state.installedModels = await getInstalledModels();
    const installedName = state.installedModels.find((item) => sameModelName(item.name, model))?.name || model;
    selectChatModel(installedName, { announce: false });
    ui.modelInput.value = "";
    renderModelManager();
    await refreshStatus(false);
    bar.style.width = "100%";
    progress.dataset.kind = "success";
    label.textContent = `Đã tải xong ${compactModelName(installedName)}`;
    notify(`Đã tải và chọn ${compactModelName(installedName)} để chat`);
  } catch (error) {
    bar.style.width = "100%";
    progress.dataset.kind = "error";
    label.textContent = `Không thể tải: ${error}`;
  }
  finally {
    if (unlisten) unlisten();
    button.disabled = false;
    state.modelOperation = null;
  }
}

async function installModelFromBackup() {
  const model = ui.backupModelName.value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:-]{0,119}$/.test(model)) {
    notify("Tên model không hợp lệ hoặc có khoảng trắng");
    ui.backupModelName.focus();
    return;
  }
  if (!inTauri) {
    notify("Tính năng này chỉ hoạt động trong ứng dụng VECTOR AI Desktop");
    return;
  }
  if (state.modelOperation) {
    notify("Một thao tác model khác đang được thực hiện");
    return;
  }
  state.modelOperation = "install";
  if (state.installedModels.some((item) => sameModelName(item.name, model))) {
    const replace = await confirmAction({
      title: "Cài đè model hiện có?",
      message: `Model “${model}” đã tồn tại trong Ollama. Bản trong backup.zip sẽ thay thế model này.`,
      acceptLabel: "Cài đè",
      danger: false,
    });
    if (!replace) {
      state.modelOperation = null;
      return;
    }
  }

  const button = $("#installModelBackup");
  const progress = ui.modelBackupProgress;
  const bar = progress.querySelector("i span");
  const label = progress.querySelector("small");
  button.disabled = true;
  ui.backupModelName.disabled = true;
  progress.hidden = false;
  progress.dataset.kind = "working";
  bar.style.width = "0%";
  label.textContent = "Chọn file backup.zip…";
  let unlisten;
  try {
    unlisten = await listen("model-backup-install", (event) => {
      const percent = Math.max(0, Math.min(100, Number(event.payload?.percent) || 0));
      bar.style.width = `${percent}%`;
      label.textContent = `${event.payload?.message || "Đang cài model…"} · ${percent}%`;
    });
    const result = await invoke("install_model_backup", { requestedName: model });
    if (!result) {
      progress.hidden = true;
      return;
    }
    bar.style.width = "100%";
    progress.dataset.kind = "success";
    label.textContent = `Cài thành công ${result.model} · ${formatModelSize(result.size)}`;
    semanticSearchUnavailable = false;
    state.installedModels = await getInstalledModels();
    const installedName = state.installedModels.find((item) => sameModelName(item.name, result.model))?.name || result.model;
    selectChatModel(installedName, { announce: false });
    renderModelManager();
    await refreshStatus(false);
    notify(`Đã cài và chọn ${compactModelName(result.model)} để chat`);
  } catch (error) {
    bar.style.width = "100%";
    progress.dataset.kind = "error";
    label.textContent = `Không thể cài model: ${error}`;
  } finally {
    if (unlisten) unlisten();
    button.disabled = false;
    ui.backupModelName.disabled = false;
    state.modelOperation = null;
  }
}
async function refreshStatus(showSetup = false) {
  syncActiveModel();
  const version = ++statusRefreshVersion;
  const checkedModel = state.selectedModel;
  const checkedReasoning = state.reasoning;
  const s = await getStatus();
  // A slower check for the previous selection must not overwrite the new mode.
  if (version !== statusRefreshVersion || checkedModel !== state.selectedModel || checkedReasoning !== state.reasoning) return s;
  state.status = s;
  ui.activeModelName.textContent = compactModelName(state.selectedModel);
  ui.engineDot.classList.toggle("on", s.running && s.modelReady);
  ui.engineTitle.textContent = s.running
    ? s.modelReady
      ? "Ollama đang sẵn sàng"
      : `Chưa tải ${compactModelName(state.selectedModel)}`
    : "Ollama chưa chạy";
  ui.engineSub.textContent = s.modelReady
    ? `${modeLabel()} · ${compactModelName(state.selectedModel)}`
    : `${modeLabel()} · nhấn để tải model`;
  if (showSetup || (!s.modelReady && !state.setupDismissed)) openSetup(s);
  return s;
}
function openSetup(status = state.status) {
  ui.setup.classList.add("open");
  ui.progressWrap.hidden = true;
  ui.setupAction.hidden = false;
  if (!status?.installed) {
    ui.setupTitle.textContent = "Cài đặt Ollama";
    ui.setupText.textContent =
      "VECTOR AI cần Ollama để chạy mô hình hoàn toàn trên máy. Bộ cài chính thức sẽ được tải tự động.";
    ui.setupAction.textContent = "Cài Ollama";
    ui.setupAction.onclick = installOllama;
  } else if (!status.running) {
    ui.setupTitle.textContent = "Khởi động Ollama";
    ui.setupText.textContent =
      "Ollama đã có trên máy nhưng dịch vụ chưa hoạt động.";
    ui.setupAction.textContent = "Khởi động Ollama";
    ui.setupAction.onclick = startOllama;
  } else if (!status.modelReady) {
    ui.setupTitle.textContent = "Tải model đã chọn";
    ui.setupText.textContent = `${compactModelName(state.selectedModel)} chưa có trong Ollama. Có thể tiếp tục tải nếu kết nối bị gián đoạn.`;
    ui.setupAction.textContent = "Tải model";
    ui.setupAction.onclick = pullModel;
  } else {
    ui.setup.classList.remove("open");
  }
}
async function installOllama() {
  if (!inTauri) {
    notify("Cài Ollama tại ollama.com/download");
    return;
  }
  ui.setupAction.disabled = true;
  ui.setupText.textContent = "Đang tải và mở bộ cài Ollama chính thức...";
  try {
    await invoke("install_ollama");
    await refreshStatus(true);
  } catch (e) {
    ui.setupText.textContent = `Không thể cài Ollama: ${e}`;
  } finally {
    ui.setupAction.disabled = false;
  }
}
async function startOllama() {
  if (!inTauri) {
    notify("Hãy mở ứng dụng Ollama");
    return;
  }
  ui.setupAction.disabled = true;
  try {
    await invoke("start_ollama");
    await refreshStatus(true);
  } catch (e) {
    ui.setupText.textContent = String(e);
  } finally {
    ui.setupAction.disabled = false;
  }
}
async function pullModel() {
  const model = modelForMode();
  if (!inTauri) {
    notify(`Chạy: ollama pull ${model}`);
    return;
  }
  ui.setupAction.hidden = true;
  ui.progressWrap.hidden = false;
  ui.progressBar.style.width = "0%";
  const unlisten = await listen("model-pull", (event) => {
    const p = event.payload.percent || 0;
    ui.progressBar.style.width = p + "%";
    ui.progressPercent.textContent = p + "%";
    ui.progressStatus.textContent = event.payload.status || "Đang tải";
  });
  try {
    await invoke("pull_named_model", { model });
    unlisten();
    await refreshStatus(true);
    notify(`${compactModelName(model)} đã sẵn sàng`);
  } catch (e) {
    unlisten();
    ui.setupText.textContent = `Tải model thất bại: ${e}`;
    ui.setupAction.hidden = false;
  }
}

async function unloadOtherWebModels(selectedModel, signal) {
  try {
    const response = await fetch("/ollama/api/ps", { signal });
    if (!response.ok) return;
    const body = await response.json();
    const others = (body.models || [])
      .map((item) => item.name || item.model)
      .filter((name) => name && !sameModelName(name, selectedModel));
    await Promise.allSettled(others.map((model) => fetch("/ollama/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({ model, stream: false, keep_alive: 0 }),
    })));
  } catch {
    // Chat vẫn có thể tiếp tục nếu Ollama không cho đọc/dỡ model đang nạp.
  }
}
async function streamWeb(messages, node, reasoning, model, signal, mode = state.mode) {
  await unloadOtherWebModels(model, signal);
  const inheritedSystem = messages
    .filter((message) => String(message?.role || "").toLowerCase() === "system")
    .map((message) => String(message?.content || "").trim())
    .filter(Boolean);
  const conversationMessages = messages.filter(
    (message) => String(message?.role || "").toLowerCase() !== "system",
  );
  const response = await fetch("/ollama/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            [
              "Bạn là VECTOR AI. Trả lời tiếng Việt chính xác, rõ ràng. Với toán lý phải nêu công thức, thay số và kiểm tra đáp số. Với bài nhiều giai đoạn, giữ nhất quán mốc tọa độ, mốc thế năng, chiều dương; kiểm tra dấu lực, điều kiện biên và thay kết quả ngược vào công thức. Nếu hình học chưa rõ phải nêu giả thiết đang dùng. Không mở đầu xã giao, không chép lại đề và không giải thích nguồn không liên quan; mặc định bài toán thông thường không quá khoảng 700 token trừ khi người dùng yêu cầu rất chi tiết. Dùng \\( ... \\) cho công thức trong dòng và \\[ ... \\] cho công thức riêng; hệ phương trình phải dùng LaTeX cases hợp lệ. Khi được yêu cầu sơ đồ, dùng khối ```mermaid hợp lệ. Khi được yêu cầu biểu đồ hoặc đồ thị, dùng khối ```chart chứa JSON Chart.js hợp lệ với type, data và options." + RESULT_INSTRUCTION + OUTPUT_SAFETY_INSTRUCTION,
              ...inheritedSystem,
            ].join("\n\n"),
        },
        ...conversationMessages,
      ],
      stream: true,
      think: REASONING_PROFILES[mode].think,
      keep_alive: "30m",
      options: {
        temperature: 0.1,
        top_p: 0.9,
        // -1 yêu cầu Ollama offload nhiều lớp nhất có thể mà vẫn vừa VRAM.
        num_gpu: -1,
        main_gpu: 0,
        num_ctx: REASONING_PROFILES[mode].context,
        num_predict: REASONING_PROFILES[mode].output,
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Ollama HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  const consumeLine = (line) => {
    if (!line.trim()) return;
    const data = JSON.parse(line);
    const delta = data.message?.content || "";
    if (delta) appendDelta(node, delta);
    if (data.done) {
      if (data.done_reason === "length") node.dataset.truncated = "true";
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    lines.forEach(consumeLine);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeLine(buffer);
}
function appendDelta(node, delta) {
  const tracker = getDraftRenderState(node);
  tracker.raw += delta;
  const label = tracker.label;
  if (label?.textContent.startsWith("Đang chuẩn bị")) label.textContent = "Đang hoàn thiện câu trả lời…";
  scheduleDraftRender(node);
  scheduleStreamingAnswer(node);
}
function resetDraftForPass(node, labelText) {
  const tracker = draftRenderStates.get(node);
  if (tracker?.timer !== null) clearTimeout(tracker.timer);
  if (tracker?.answerTimer !== null) clearTimeout(tracker.answerTimer);
  draftRenderStates.delete(node);
  node.dataset.raw = "";
  delete node.dataset.truncated;
  delete node.dataset.cancelled;
  node.querySelector(".answer")?.replaceChildren();
  const preview = node.querySelector(".answer-draft-content");
  if (preview) preview.textContent = "Bản nháp sẽ xuất hiện ở đây và có thể thay đổi trước khi hoàn tất.";
  const label = node.querySelector(".answer-draft-label");
  if (label) label.textContent = labelText;
  getDraftRenderState(node);
}
async function refreshBackendStatus() {
  try {
    state.backend = await backendApi.health();
    workflowButton.title = "Python Core đã kết nối · Quản lý workflow RAG";
    workflowButton.setAttribute("aria-label", workflowButton.title);
    workflowButton.classList.add("connected");
  } catch {
    state.backend = null;
    workflowButton.title = "Python Core chưa kết nối · Chế độ tương thích Ollama, tìm từ khóa cũ";
    workflowButton.setAttribute("aria-label", workflowButton.title);
    workflowButton.classList.remove("connected");
  }
  return state.backend;
}
async function runBackendGeneration({ history, node, model, mode }) {
  const controller = new AbortController();
  state.abortController = controller;
  const result = await backendApi.request("/runs", {
    method: "POST", signal: controller.signal,
    body: { model, mode, messages: history, scope: backendScope(), strict_sources: onlyDocumentSources(activeWorkspace()), embedding_profile_id: selectedEmbeddingProfile(), workflow_id: "query_reasoning" },
  });
  const runId = result.run_id || result.id;
  if (!runId) throw new Error("Python Core không trả mã run; không tự chạy lại để tránh phản hồi trùng.");
  state.requestId = runId;
  state.backendRunId = runId;
  node.dataset.workflow = "QueryReasoningGraph";
  try {
    await backendApi.events(runId, (event) => {
      const data = event.data || {};
      if (event.type === "delta") appendDelta(node, data.content || data.delta || event.content || "");
      if (event.type === "sources") node.backendSources = data.sources || data.hits || [];
      if (["stage", "progress"].includes(event.type)) {
        const label = node.querySelector(".answer-draft-label");
        if (label) label.textContent = event.message || ({ retrieve: "Đang tìm nguồn…", retrieval: "Đang tìm nguồn…", thinking: "Đang suy luận…", generate: "Đang hoàn thiện câu trả lời…", queued: "Đang chờ tài nguyên…" })[event.stage] || `Đang xử lý · ${event.stage || "QueryReasoningGraph"}`;
      }
      if (event.type === "usage" && (data.truncated || data.done_reason === "length")) node.dataset.truncated = "true";
      if (event.type === "completed") {
        if (typeof data.final_content === "string") {
          const tracker = getDraftRenderState(node);
          if (tracker.raw !== data.final_content) tracker.raw = data.final_content;
        }
        if (data.truncated || data.done_reason === "length") node.dataset.truncated = "true";
      }
      if (event.type === "cancelled") node.dataset.cancelled = "true";
      if (event.type === "error") throw new Error(event.message || data.message || "Python Core không hoàn tất phản hồi.");
    }, { signal: controller.signal });
  } finally { state.backendRunId = null; }
}
async function runGenerationPass({ history, node, reasoning, model, label, mode = state.mode }) {
  resetDraftForPass(node, label);
  const requestId = id();
  state.requestId = requestId;
  state.stopRequestedId = null;
  if (!state.backend) history = [{ role: "system", content: onlyDocumentSources(activeWorkspace()) ? DOCUMENT_SOURCE_INSTRUCTION : MODEL_SOURCE_INSTRUCTION }, ...history];
  if (state.backend) {
    await runBackendGeneration({ history, node, model, mode });
  } else if (inTauri) {
    notify("Python Core chưa kết nối: đang dùng chế độ tương thích Ollama, chưa áp dụng workflow RAG mới.");
    let resolveDone;
    const streamDone = new Promise((resolve) => { resolveDone = resolve; });
    const unlisten = await listen("chat-stream", (event) => {
      const payload = event.payload;
      if (payload.requestId !== requestId) return;
      if (payload.kind === "delta") appendDelta(node, payload.content);
      if (payload.kind === "truncated") node.dataset.truncated = "true";
      if (payload.kind === "cancelled") node.dataset.cancelled = "true";
      if (payload.kind === "done" || payload.kind === "cancelled") resolveDone?.();
    });
    state.unlisten = unlisten;
    state.abortController = null;
    try {
      await invoke("chat", {
        request: { requestId, messages: history, reasoning, mode, model },
      });
      await Promise.race([streamDone, new Promise((resolve) => setTimeout(resolve, 120))]);
    } finally {
      unlisten();
      if (state.unlisten === unlisten) state.unlisten = null;
    }
  } else {
    const controller = new AbortController();
    state.abortController = controller;
    notify("Đang dùng Ollama trực tiếp; workflow RAG mới chưa sẵn sàng.");
    await streamWeb(history, node, reasoning, model, controller.signal, mode);
  }
  return {
    requestId: state.requestId,
    content: getBufferedAnswer(node),
    truncated: node.dataset.truncated === "true",
    cancelled: node.dataset.cancelled === "true",
  };
}
async function send({ text = ui.prompt.value.trim(), retry = false, continuationSources = null, continuationTargetId = null, referenceQuestion = null } = {}) {
  if ((!text && !state.attachments.length) || state.generating) return;
  if (!retry && text.startsWith("/") && (await executeSlashCommand(text))) return;
  const continuing = Array.isArray(continuationSources);
  let instant = retry || continuing || state.attachments.length || onlyDocumentSources(activeWorkspace()) ? null : quickReply(text);
  if (!instant && !state.backend && !state.status?.modelReady) {
    openSetup();
    return;
  }
  if (!state.activeId) newChat();
  const chat = activeChat();
  let responseSources = [];
  let transientUser = null;
  let continuationPrompt = text;
  let continuationImages = [];
  if (retry) {
    if (chat.messages.at(-1)?.role === "assistant") chat.messages.pop();
    const retryUser = [...chat.messages].reverse().find((message) => message.role === "user");
    const references = await combinedReferenceContext(referenceQuestion || retryUser?.content || text, chat);
    responseSources = references.sources || [];
    if (references.strict && !responseSources.length && !references.images?.length && !retryUser?.attachments?.length)
      instant = "Chưa đủ thông tin trong tài liệu để trả lời câu hỏi này.";
    if (retryUser) {
      retryUser.runtimeContent = `${retryUser.content || text}${references.context || ""}`;
      retryUser.images = references.images || [];
      retryUser.referenceSources = responseSources;
      transientUser = retryUser;
    }
  } else {
    if (state.editingMessageId) {
      const editIndex = chat.messages.findIndex((message) => message.id === state.editingMessageId);
      if (editIndex >= 0) chat.messages.splice(editIndex);
      state.editingMessageId = null;
      renderMessages();
    }
    const attachments = state.attachments.splice(0);
    const prepared = prepareAttachedPrompt(text, attachments);
    const references = await combinedReferenceContext(referenceQuestion || text, chat);
    responseSources = references.sources?.length ? references.sources : (continuing ? continuationSources : []);
    if (references.strict && !responseSources.length && !prepared.images.length && !attachments.length)
      instant = "Chưa đủ thông tin trong tài liệu để trả lời câu hỏi này.";
    prepared.images.push(...references.images);
    if (continuing) {
      continuationPrompt = `${text}${references.context || ""}`;
      continuationImages = references.images || [];
    }
    if (!continuing) {
      const user = {
        id: id(),
        role: "user",
        // Chỉ lưu câu hỏi và tên tệp trong lịch sử. Nội dung tệp đầy đủ nằm
        // trong IndexedDB và phần được chọn chỉ tồn tại trong runtimeContent.
        content: text || `Phân tích tệp: ${attachments.map((item) => item.name).join(", ")}`,
        runtimeContent: prepared.content + references.context,
        displayContent: text || "Phân tích tệp đính kèm",
        images: prepared.images,
        attachments,
        referenceSources: responseSources,
        createdAt: Date.now(),
      };
      transientUser = user;
      chat.messages.push(user);
      await archiveChatAttachments(chat, attachments);
      if (chat.title === "Cuộc trò chuyện mới")
        chat.title = (text || attachments[0]?.name || "Tệp đính kèm")
          .replace(/\s+/g, " ")
          .slice(0, 52);
      ui.welcome.classList.add("hidden");
      ui.messages.append(createMessage(user));
      ui.prompt.value = "";
      renderAttachments();
      resize();
    }
  }
  chat.updatedAt = Date.now();
  saveChats();
  renderList();
  if (instant) {
    if (transientUser) {
      transientUser.runtimeContent = undefined;
      transientUser.images = undefined;
    }
    finishImmediateReply(chat, instant);
    return;
  }
  const assistantMessageId = id();
  const requestMode = state.mode;
  const requestReasoning = state.reasoning;
  const requestModel = modelForMode(requestReasoning);
  const assistantNode = createMessage(
    { id: assistantMessageId, role: "assistant", content: "", sources: responseSources, reasoning: requestReasoning },
    true,
  );
  const draftLabel = assistantNode.querySelector(".answer-draft-label");
  if (draftLabel) draftLabel.textContent = `Đang chuẩn bị ${requestReasoning ? "model suy luận sâu" : "model trả lời nhanh"}…`;
  ui.messages.append(assistantNode);
  bottom();
  setGenerating(true);
  let activeRequestId = null;
  let generatedContent = "";
  let persistedAssistantMessage = null;
  try {
    const history = contextMessages(chat.messages, REASONING_PROFILES[requestMode].context)
      .map(({ role, content, runtimeContent, images }) => ({
        role,
        content: runtimeContent || content,
        ...(images?.length ? { images } : {}),
      }));
    // Lời nhắc nối tiếp chỉ tồn tại trong request. Không lưu nó thành câu hỏi
    // của người dùng, nếu không model sẽ coi đây là một bài mới.
    if (continuing) history.push({
      role: "user",
      content: continuationPrompt,
      ...(continuationImages.length ? { images: continuationImages } : {}),
    });
    const pass = await runGenerationPass({
      history,
      node: assistantNode,
      reasoning: requestReasoning,
      mode: requestMode,
      model: requestModel,
      label: `Đang chuẩn bị ${requestReasoning ? "model suy luận sâu" : "model trả lời nhanh"}…`,
    });
    activeRequestId = pass.requestId;
    if (assistantNode.backendSources?.length) responseSources = assistantNode.backendSources.map((source, index) => ({ id: source.id || `R${index + 1}`, name: source.name || source.source?.document_title || source.source?.title || source.document_title || source.title || "Tài liệu", chunkId: source.chunk_id || source.chunkId, excerpt: source.text || source.excerpt || "", ...source }));
    const content = pass.content;
    const truncated = pass.truncated || pass.cancelled;
    generatedContent = content;
    const displayContent = truncated
      ? safeTruncatedContent(content)
      : (content || "Không nhận được nội dung từ model.");
    await revealFinalAnswer(assistantNode, displayContent, activeRequestId);
    if (truncated) {
      assistantNode.querySelector(".ai-main").insertAdjacentHTML(
        "beforeend",
        continuationMarkup(),
      );
      bindContinuation(assistantNode);
    }
    await hydrateVisuals(assistantNode);
    if (content) {
      const continuationTarget = continuationTargetId
        ? chat.messages.find((message) => message.id === continuationTargetId && message.role === "assistant")
        : null;
      if (continuationTarget) {
        continuationTarget.content = `${continuationTarget.content.trimEnd()}\n\n${content.trimStart()}`;
        continuationTarget.sources = responseSources;
        continuationTarget.truncated = truncated;
        continuationTarget.updatedAt = Date.now();
        persistedAssistantMessage = continuationTarget;
      } else {
        persistedAssistantMessage = {
          id: assistantMessageId,
          role: "assistant",
          content,
          reasoning: requestReasoning,
          mode: requestMode,
          sources: responseSources,
          truncated,
          createdAt: Date.now(),
        };
        chat.messages.push(persistedAssistantMessage);
      }
      chat.updatedAt = Date.now();  
      // Sau khi model trả lời, giải phóng đoạn tài liệu và ảnh khỏi lịch sử
      // prompt. Các tệp vẫn còn trong kho riêng của chat để truy xuất lần sau.
      if (transientUser) {
        transientUser.runtimeContent = undefined;
        transientUser.images = undefined;
      }
      saveChats();
      renderList();
      if (continuationTarget) renderMessages({
        preserveScroll: true,
        scrollTop: ui.conversation.scrollTop,
      });
    }
  } catch (e) {
    if (isExplicitUserStop(state.stopRequestedId, activeRequestId, state.requestId)) {
      const content = getBufferedAnswer(assistantNode);
      showFinalAnswerImmediately(
        assistantNode,
        content ? safeTruncatedContent(content) : "Đã dừng phản hồi.",
      );
    } else {
      discardDraftRender(assistantNode);
      assistantNode.classList.remove("is-drafting", "is-revealing");
      assistantNode.querySelector(".answer").innerHTML =
        `<p class="error">Không thể nhận phản hồi: ${esc(e)}</p>`;
    }
  } finally {
    if (transientUser) {
      transientUser.runtimeContent = undefined;
      transientUser.images = undefined;
      saveChats();
    }
    state.unlisten = null;
    state.requestId = null;
    state.abortController = null;
    state.stopRequestedId = null;
    setGenerating(false);
    updateScrollLatest();
  }
  return generatedContent;
}

async function carryContextToNewChat() {
  const source = activeChat();
  if (!source || state.generating || !source.messages.length) return;
  const sourceTitle = source.title;
  const summary = await send({
    text: "Hãy tóm tắt cuộc trò chuyện này để chuyển sang một chat mới. Giữ lại mục tiêu, dữ kiện, công thức, kết quả đã xác nhận, giả thiết, quyết định và việc còn dang dở. Nêu rõ điều gì chưa chắc chắn hoặc từng bị sửa sai. Viết cô đọng, tối đa 1200 từ, không giải lại từ đầu.",
  });
  if (!summary) return;
  newChat();
  const target = activeChat();
  target.title = `${sourceTitle.replace(/\s*\(tiếp\)$/i, "")} (tiếp)`.slice(0, 52);
  target.messages.push({
    id: id(),
    role: "assistant",
    content: `### Bối cảnh được chuyển từ cuộc trò chuyện trước\n\n${summary}`,
    createdAt: Date.now(),
  });
  target.updatedAt = Date.now();
  saveChats();
  renderList();
  renderMessages();
  notify("Đã tạo chat mới và mang theo bản tóm tắt");
}
async function stop() {
  if (!state.generating) return;
  const requestId = state.requestId;
  if (!requestId) return;
  state.stopRequestedId = requestId;
  if (state.backendRunId) {
    try { await backendApi.cancel(state.backendRunId); }
    finally { state.abortController?.abort(); }
  } else if (state.backend && state.abortController) state.abortController.abort();
  else if (inTauri) await invoke("cancel_chat", { requestId });
  else state.abortController?.abort();
  notify("Đang dừng phản hồi…");
}
async function continueMessage(assistantId) {
  if (state.generating) return;
  const chat = activeChat();
  const assistantIndex = chat?.messages.findIndex((message) => message.id === assistantId) ?? -1;
  if (assistantIndex < 0 || chat.messages[assistantIndex].role !== "assistant") return;
  const assistant = chat.messages[assistantIndex];
  chat.messages.splice(assistantIndex + 1);
  const previousUser = [...chat.messages.slice(0, assistantIndex)].reverse().find((message) => message.role === "user");
  const sources = assistant.sources || previousUser?.referenceSources || [];
  saveChats();
  renderMessages();
  await send({
    text: "Tiếp tục chính xác phần đang dở của phản hồi ngay trước đó cho cùng bài toán gốc. Không bắt đầu một lời giải hay đáp án mới. Giữ nguyên dữ kiện, ký hiệu và các kết quả đã xác lập; chỉ sửa nếu phát hiện lỗi và phải nói rõ chỗ sửa. Hoàn thành câu hoặc công thức bị ngắt, không lặp lại phần đã có, rồi kết thúc tại một điểm hoàn chỉnh.",
    continuationSources: sources,
    continuationTargetId: assistantId,
    referenceQuestion: previousUser?.content || "",
  });
}
async function retryMessage(assistantId) {
  if (state.generating) return;
  const chat = activeChat();
  const assistantIndex = chat?.messages.findIndex((message) => message.id === assistantId) ?? -1;
  if (assistantIndex < 0 || chat.messages[assistantIndex].role !== "assistant") return;
  let userIndex = assistantIndex - 1;
  while (userIndex >= 0 && chat.messages[userIndex].role !== "user") userIndex -= 1;
  if (userIndex < 0) return;
  const user = chat.messages[userIndex];
  chat.messages.splice(assistantIndex);
  saveChats();
  renderMessages();
  await send({ text: user.content, retry: true, referenceQuestion: user.content });
}

const knowledgeNumber = new Intl.NumberFormat("vi-VN");
function currentKnowledgeDocument() {
  return state.knowledgeDocuments.find((document) => document.id === state.knowledgeEditorDocumentId) || null;
}
function currentKnowledgeChunk() {
  const document = currentKnowledgeDocument();
  return document?.chunks.find((chunk) => chunk.id === state.knowledgeEditorChunkId) || null;
}
function knowledgeEditorDirty() {
  if (ui.knowledgeEditor.hidden) return false;
  const document = currentKnowledgeDocument();
  const chunk = currentKnowledgeChunk();
  if (!document || !chunk) return false;
  return ui.knowledgeTitleInput.value.trim() !== document.title
    || ui.knowledgeChunkText.value !== chunk.text;
}
function setDataManagerTab(tab) {
  const selected = tab === "backup" ? "backup" : "knowledge";
  document.querySelectorAll("[data-data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.dataTab === selected);
  });
  ui.knowledgePane.hidden = selected !== "knowledge";
  ui.backupPane.hidden = selected !== "backup";
}
function knowledgeStatusMarkup(document) {
  if (document.removed) return '<span class="is-off">Đã xóa khỏi AI</span>';
  if (!document.enabled) return '<span class="is-off">Đang tạm tắt</span>';
  return '<span class="is-active">Đang sử dụng</span>';
}
function knowledgeSourceMarkup(document) {
  const stateClass = document.removed ? " is-removed" : document.enabled ? "" : " is-disabled";
  const edited = document.contentModified
    ? `<span class="is-edited">${document.modifiedChunks ? `${document.modifiedChunks} đoạn đã sửa` : "Đã điều chỉnh"}</span>`
    : "";
  const actions = document.removed
    ? `<button type="button" class="knowledge-restore" data-knowledge-restore="${document.id}">Khôi phục</button>`
    : `<button type="button" class="knowledge-toggle" data-knowledge-toggle="${document.id}" aria-pressed="${document.enabled}" title="${document.enabled ? "Tạm tắt nguồn" : "Bật nguồn"}"></button><button type="button" data-knowledge-edit="${document.id}">Chỉnh sửa</button><button type="button" class="knowledge-remove" data-knowledge-remove="${document.id}">Xóa</button>`;
  return `<article class="knowledge-source${stateClass}"><div class="knowledge-source-icon">DOCX</div><div class="knowledge-source-main"><b>${esc(document.title)}</b><small title="${esc(document.source_file)}">${esc(document.source_file)}</small><div class="knowledge-source-meta">${knowledgeStatusMarkup(document)}<span>${document.chunks.length} đoạn</span><span>${knowledgeNumber.format(document.characters || 0)} ký tự</span><span>${knowledgeNumber.format(document.math_objects || 0)} công thức</span>${edited}</div></div><div class="knowledge-source-actions">${actions}</div></article>`;
}
function renderKnowledgeEditor() {
  const document = currentKnowledgeDocument();
  if (!document || document.removed) {
    state.knowledgeEditorDocumentId = null;
    state.knowledgeEditorChunkId = null;
    ui.knowledgeEditor.hidden = true;
    ui.knowledgeOverview.hidden = false;
    return;
  }
  if (!document.chunks.some((chunk) => chunk.id === state.knowledgeEditorChunkId)) {
    state.knowledgeEditorChunkId = document.chunks[0]?.id || null;
  }
  const chunk = currentKnowledgeChunk();
  ui.knowledgeOverview.hidden = true;
  ui.knowledgeEditor.hidden = false;
  ui.knowledgeEditorHeading.textContent = document.title;
  ui.knowledgeTitleInput.value = document.title;
  ui.knowledgeChunkSelect.innerHTML = document.chunks.map((item) => (
    `<option value="${item.id}"${item.id === chunk?.id ? " selected" : ""}>Đoạn ${item.index}${item.modified ? " · đã chỉnh" : ""}</option>`
  )).join("");
  ui.knowledgeChunkText.value = chunk?.text || "";
  refreshKnowledgeContentPreview();
  ui.knowledgeChunkState.textContent = chunk?.modified ? "Đã chỉnh sửa" : "Bản gốc";
  ui.knowledgeChunkState.classList.toggle("is-edited", Boolean(chunk?.modified));
  $("#restoreKnowledgeChunk").disabled = !chunk?.modified;
}
function refreshKnowledgeContentPreview() {
  let preview = document.getElementById("knowledgeContentPreview");
  if (!preview) {
    const field = ui.knowledgeChunkText.closest("label");
    preview = document.createElement("div"); preview.id = "knowledgeContentPreview"; preview.className = "knowledge-rich-content knowledge-inline-editor-preview";
    const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "⤢ Soạn trực quan · công thức & bảng"; edit.id = "editKnowledgeVisually";
    edit.onclick = () => openKnowledgeContent({
      title: ui.knowledgeTitleInput.value, source: ui.knowledgeChunkText.value, editable: true, startEditing: true,
      saveLabel: "Áp dụng vào bản nháp",
      note: "Sửa nội dung và thêm các khối văn bản, công thức, bảng. Áp dụng xong, bấm Lưu thay đổi ở màn hình dữ liệu để lưu vào kho.",
      onSave: ({ title, source }) => { ui.knowledgeTitleInput.value = title; ui.knowledgeChunkText.value = source; refreshKnowledgeContentPreview(); ui.knowledgeChunkState.textContent = "Bản nháp · chưa lưu"; },
    });
    field.before(edit, preview);
    const details = document.createElement("details"), summary = document.createElement("summary"); summary.textContent = "Markdown / LaTeX (nâng cao)";
    field.before(details); details.append(summary, field);
    ui.knowledgeChunkText.addEventListener("input", refreshKnowledgeContentPreview);
  }
  preview.innerHTML = renderKnowledge(ui.knowledgeChunkText.value);
}
async function refreshKnowledgeManager({ keepEditor = true } = {}) {
  try {
    const documents = await listBuiltinKnowledgeDocuments();
    state.knowledgeDocuments = documents;
    const active = documents.filter((document) => document.enabled && !document.removed);
    const activeChunks = active.reduce((total, document) => total + document.chunks.length, 0);
    const formulas = active.reduce((total, document) => total + (document.math_objects || 0), 0);
    ui.knowledgeTabCount.textContent = `${active.length}/${documents.length}`;
    ui.knowledgeSummary.innerHTML = `<span><b>${active.length}/${documents.length}</b> nguồn đang dùng</span><em>${activeChunks} đoạn · ${knowledgeNumber.format(formulas)} công thức</em>`;
    ui.knowledgeList.innerHTML = documents.length
      ? documents.map(knowledgeSourceMarkup).join("")
      : '<div class="knowledge-loading">Không tìm thấy kho dữ liệu mặc định.</div>';
    ui.knowledgeList.querySelectorAll("[data-knowledge-toggle]").forEach((button) => {
      button.onclick = async () => {
        const document = state.knowledgeDocuments.find((item) => item.id === button.dataset.knowledgeToggle);
        if (!document) return;
        updateBuiltinKnowledgeDocument(document.id, { enabled: !document.enabled });
        await refreshKnowledgeManager();
        notify(document.enabled ? `Đã tạm tắt “${document.title}”` : `Đã bật “${document.title}”`);
      };
    });
    ui.knowledgeList.querySelectorAll("[data-knowledge-edit]").forEach((button) => {
      button.onclick = () => {
        state.knowledgeEditorDocumentId = button.dataset.knowledgeEdit;
        state.knowledgeEditorChunkId = state.knowledgeDocuments
          .find((item) => item.id === button.dataset.knowledgeEdit)?.chunks[0]?.id || null;
        renderKnowledgeEditor();
      };
    });
    ui.knowledgeList.querySelectorAll("[data-knowledge-remove]").forEach((button) => {
      button.onclick = async () => {
        const document = state.knowledgeDocuments.find((item) => item.id === button.dataset.knowledgeRemove);
        if (!document || !await confirmAction({
          title: "Xóa nguồn khỏi VECTOR AI?",
          message: `“${document.title}” sẽ không còn được truy xuất trong các câu trả lời mới. Bạn vẫn có thể khôi phục nguồn này sau đó.`,
          acceptLabel: "Xóa khỏi AI",
        })) return;
        updateBuiltinKnowledgeDocument(document.id, { removed: true });
        await refreshKnowledgeManager();
        notify(`Đã xóa “${document.title}” khỏi kho đang dùng`);
        ui.prompt.focus();
      };
    });
    ui.knowledgeList.querySelectorAll("[data-knowledge-restore]").forEach((button) => {
      button.onclick = async () => {
        const document = state.knowledgeDocuments.find((item) => item.id === button.dataset.knowledgeRestore);
        if (!document) return;
        updateBuiltinKnowledgeDocument(document.id, { removed: false });
        await refreshKnowledgeManager();
        notify(`Đã khôi phục “${document.title}”`);
      };
    });
    if (keepEditor && state.knowledgeEditorDocumentId) renderKnowledgeEditor();
    else if (!keepEditor) {
      state.knowledgeEditorDocumentId = null;
      state.knowledgeEditorChunkId = null;
      ui.knowledgeEditor.hidden = true;
      ui.knowledgeOverview.hidden = false;
    }
  } catch (error) {
    ui.knowledgeSummary.innerHTML = "<span>Không thể đọc kho kiến thức</span>";
    ui.knowledgeList.innerHTML = `<div class="knowledge-loading">${esc(error.message || error)}</div>`;
  }
}
async function closeKnowledgeEditor() {
  if (knowledgeEditorDirty() && !await confirmAction({
    title: "Bỏ thay đổi chưa lưu?",
    message: "Nội dung bạn vừa chỉnh chưa được lưu vào kho dữ liệu.",
    acceptLabel: "Bỏ thay đổi",
  })) return false;
  state.knowledgeEditorDocumentId = null;
  state.knowledgeEditorChunkId = null;
  ui.knowledgeEditor.hidden = true;
  ui.knowledgeOverview.hidden = false;
  return true;
}
async function saveKnowledgeEditor() {
  const document = currentKnowledgeDocument();
  const chunk = currentKnowledgeChunk();
  if (!document || !chunk) return;
  const title = ui.knowledgeTitleInput.value.trim();
  const text = ui.knowledgeChunkText.value.trim();
  if (!title) { notify("Tên tài liệu không được để trống"); ui.knowledgeTitleInput.focus(); return; }
  if (!text) { notify("Đoạn dữ liệu không được để trống"); ui.knowledgeChunkText.focus(); return; }
  updateBuiltinKnowledgeDocument(document.id, { title: title === document.originalTitle ? null : title });
  if (text === chunk.originalText) restoreBuiltinKnowledgeChunk(document.id, chunk.id);
  else updateBuiltinKnowledgeChunk(document.id, chunk.id, text);
  await refreshKnowledgeManager();
  notify("Đã lưu điều chỉnh dữ liệu");
}
async function closeDataManager() {
  if (state.knowledgeEditorDocumentId && !await closeKnowledgeEditor()) return;
  ui.dataModal.classList.remove("open");
  ui.prompt.focus();
}
async function openDataManager() {
  ui.backupStatus.hidden = true;
  setDataManagerTab("knowledge");
  ui.dataModal.classList.add("open");
  setTimeout(() => $("#closeDataManager").focus(), 0);
  await refreshKnowledgeManager({ keepEditor: false });
}
function openSidebar() {
  ui.sidebar.classList.add("open");
  ui.scrim.classList.add("open");
}
function closeSidebar() {
  ui.sidebar.classList.remove("open");
  ui.scrim.classList.remove("open");
}

$("#newChat").onclick = newChat;
ui.workspaceButton.onclick = (event) => {
  event.stopPropagation();
  ui.workspaceMenu.classList.toggle("open");
  renderWorkspaces();
};
$("#createWorkspace").onclick = createWorkspace;
$("#renameWorkspace").onclick = renameWorkspace;
$("#deleteWorkspace").onclick = deleteWorkspace;
$("#addWorkspaceFiles").onclick = () => ui.workspaceFileInput.click();
ui.workspaceFileInput.onchange = () => addWorkspaceFiles(ui.workspaceFileInput.files);
ui.strictReference.onchange = () => {
  const workspace = activeWorkspace();
  if (!workspace) return;
  workspace.strictReferences = ui.strictReference.checked;
  workspace.sourcePolicy = workspace.strictReferences ? "documents-only" : "allow-model";
  saveChats();
  notify(workspace.strictReferences ? "Đã bật chế độ chỉ theo tài liệu" : "Đã cho phép dùng kiến thức của model");
  ui.prompt.focus();
};
ui.search.oninput = () => renderList({ resetScroll: true });
$("#deleteChat").onclick = () => removeChat();
$("#openSide").onclick = openSidebar;
$("#closeSide").onclick = closeSidebar;
ui.scrim.onclick = closeSidebar;
ui.reasoningToggle.onclick = () => selectReasoningMode(({ FAST: "NORMAL", NORMAL: "DEEP", DEEP: "FAST" })[state.mode]);
ui.carryChat.onclick = carryContextToNewChat;
ui.conversation.addEventListener("scroll", updateScrollLatest, { passive: true });
ui.scrollLatest.onclick = () => bottom(true);
ui.prompt.oninput = () => {
  resize();
  state.slashIndex = 0;
  renderSlashMenu();
};
ui.prompt.onkeydown = (e) => {
  if (ui.slashMenu.classList.contains("open") && ["ArrowDown", "ArrowUp"].includes(e.key)) {
    e.preventDefault();
    const buttons = [...ui.slashMenu.querySelectorAll("[data-command]")];
    if (!buttons.length) return;
    state.slashIndex = (state.slashIndex + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons.forEach((button, index) => button.classList.toggle("selected", index === state.slashIndex));
    buttons[state.slashIndex]?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (e.key === "Escape" && ui.slashMenu.classList.contains("open")) {
    ui.slashMenu.classList.remove("open");
    e.stopPropagation();
    return;
  }
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (ui.slashMenu.classList.contains("open")) {
      const selected = ui.slashMenu.querySelectorAll("[data-command]")[state.slashIndex];
      if (selected) { executeSlashCommand(selected.dataset.command); return; }
    }
    send();
  }
};
ui.send.onclick = () => (state.generating ? stop() : send());
$("#attachButton").onclick = () => ui.fileInput.click();
ui.fileInput.onchange = () => addFiles(ui.fileInput.files);
$("#engineButton").onclick = () => {
  state.setupDismissed = false;
  refreshStatus(true);
};
ui.setupLater.onclick = () => {
  state.setupDismissed = true;
  ui.setup.classList.remove("open");
};
$("#about").onclick = () => { $("#aboutModal").classList.add("open"); setTimeout(() => $("#closeAbout").focus(), 0); };
$("#closeAbout").onclick = () => { $("#aboutModal").classList.remove("open"); $("#about").focus({ preventScroll: true }); };
$("#modelHead").onclick = openModelManager;
$("#closeModels").onclick = () => { ui.modelModal.classList.remove("open"); $("#modelHead").focus({ preventScroll: true }); };
$("#downloadModel").onclick = downloadNamedModel;
ui.modelInput.onkeydown = (event) => { if (event.key === "Enter") downloadNamedModel(); };
$("#installModelBackup").onclick = installModelFromBackup;
ui.backupModelName.onkeydown = (event) => { if (event.key === "Enter") installModelFromBackup(); };
$("#dataManager").onclick = openDataManager;
$("#closeDataManager").onclick = closeDataManager;
document.querySelectorAll("[data-data-tab]").forEach((button) => {
  button.onclick = () => setDataManagerTab(button.dataset.dataTab);
});
$("#closeKnowledgeEditor").onclick = closeKnowledgeEditor;
$("#saveKnowledgeDocument").onclick = saveKnowledgeEditor;
ui.knowledgeChunkSelect.onchange = async (event) => {
  const previous = state.knowledgeEditorChunkId;
  const next = event.target.value;
  event.target.value = previous || "";
  if (knowledgeEditorDirty() && !await confirmAction({
    title: "Chuyển sang đoạn khác?",
    message: "Các thay đổi chưa lưu trong đoạn hiện tại sẽ bị bỏ.",
    acceptLabel: "Chuyển đoạn",
  })) return;
  state.knowledgeEditorChunkId = next;
  renderKnowledgeEditor();
};
$("#restoreKnowledgeChunk").onclick = async () => {
  const document = currentKnowledgeDocument();
  const chunk = currentKnowledgeChunk();
  if (!document || !chunk?.modified || !await confirmAction({
    title: "Khôi phục đoạn gốc?",
    message: `Mọi điều chỉnh ở đoạn ${chunk?.index || "này"} sẽ bị xóa và nội dung từ DOCX gốc được dùng lại.`,
    acceptLabel: "Khôi phục",
    danger: false,
  })) return;
  restoreBuiltinKnowledgeChunk(document.id, chunk.id);
  await refreshKnowledgeManager();
  notify("Đã khôi phục đoạn dữ liệu gốc");
};
$("#resetKnowledgeDocument").onclick = async () => {
  const document = currentKnowledgeDocument();
  if (!document || !await confirmAction({
    title: "Khôi phục toàn bộ tài liệu?",
    message: `Tên, nội dung đã chỉnh và trạng thái của “${document.title}” sẽ trở về mặc định.`,
    acceptLabel: "Khôi phục toàn bộ",
    danger: false,
  })) return;
  restoreBuiltinKnowledgeDocument(document.id);
  await refreshKnowledgeManager();
  notify("Đã khôi phục toàn bộ tài liệu gốc");
};
$("#exportBackup").onclick = exportBackup;
$("#importBackup").onclick = () => ui.backupFileInput.click();
ui.backupFileInput.onchange = () => importBackupFile(ui.backupFileInput.files?.[0]);
ui.dataModal.onclick = (event) => { if (event.target === ui.dataModal) closeDataManager(); };
$("#aboutModal").onclick = (event) => { if (event.target === $("#aboutModal")) $("#closeAbout").click(); };
ui.modelModal.onclick = (event) => { if (event.target === ui.modelModal) $("#closeModels").click(); };
$("#confirmCancel").onclick = () => closeConfirm(false);
ui.confirmAccept.onclick = () => closeConfirm(true);
ui.confirmModal.onclick = (event) => { if (event.target === ui.confirmModal) closeConfirm(false); };
$("#inputCancel").onclick = () => closeInput(null);
ui.inputBox.onsubmit = (event) => {
  event.preventDefault();
  const value = ui.inputValue.value.trim();
  if (!value) {
    ui.inputValue.setAttribute("aria-invalid", "true");
    ui.inputValue.focus();
    return;
  }
  closeInput(value.slice(0, 40));
};
ui.inputModal.onclick = (event) => { if (event.target === ui.inputModal) closeInput(null); };
$("#closeArtifact").onclick = closeArtifact;
$("#copyArtifact").onclick = async () => { if (!state.artifact) return; await navigator.clipboard.writeText(state.artifact.source); notify("Đã sao chép Artifact"); };
$("#downloadArtifact").onclick = downloadArtifact;
document.querySelectorAll("[data-artifact-tab]").forEach((button) => button.onclick = () => setArtifactTab(button.dataset.artifactTab));
ui.artifactSource.oninput = () => {
  if (!state.artifact) return;
  artifactPreviewVersion += 1;
  visualRenderer.dispose(ui.artifactPreview);
  state.artifact.source = ui.artifactSource.value;
  clearTimeout(ui.artifactSource.renderTimer);
  ui.artifactSource.renderTimer = setTimeout(renderArtifactPreview, 450);
};
function setBackupStatus(message, percent = 0, kind = "working") {
  ui.backupStatus.hidden = false;
  ui.backupStatus.dataset.kind = kind;
  ui.backupStatusText.textContent = message;
  ui.backupProgress.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function validateBackupPayload(manifest, payload, records) {
  if (!manifest || manifest.format !== "VECTOR_AI_BACKUP") throw new Error("Đây không phải file backup của VECTOR AI.");
  if (!Number.isInteger(manifest.version) || manifest.version < 1 || manifest.version > 2) throw new Error(`Phiên bản backup ${manifest.version ?? "không rõ"} chưa được hỗ trợ.`);
  if (!payload || !Array.isArray(payload.generalChats) || !Array.isArray(payload.workspaces)) throw new Error("Dữ liệu hội thoại trong backup không hợp lệ.");
  if (!Array.isArray(records) || records.length > 1000) throw new Error("Kho tài liệu trong backup không hợp lệ hoặc vượt giới hạn.");
  if (payload.builtinKnowledgePreferences !== undefined
    && (!payload.builtinKnowledgePreferences || typeof payload.builtinKnowledgePreferences !== "object" || Array.isArray(payload.builtinKnowledgePreferences))) {
    throw new Error("Cấu hình dữ liệu mặc định trong backup không hợp lệ.");
  }
    const validRecords = records.every((record) => record && typeof record.id === "string" && (typeof record.workspaceId === "string" || typeof record.chatId === "string") && ["text", "image", "document"].includes(record.kind));
  if (!validRecords) throw new Error("Backup chứa bản ghi tài liệu không hợp lệ.");
  return true;
}

async function exportBackup() {
  if (state.generating) { notify("Hãy chờ phản hồi hoàn tất trước khi sao lưu."); return; }
  const exportButton = $("#exportBackup");
  try {
    document.querySelector("#app").inert = true;
    exportButton.disabled = true;
    setBackupStatus("Đang thu thập hội thoại và tài liệu…", 8);
    saveChats();
    await conversationPersistence.flush();
    const records = await workspaceDbGetAll();
    const payload = {
      generalChats: JSON.parse(localStorage.getItem(GENERAL_CHAT_KEY) || "[]"),
      workspaces: JSON.parse(localStorage.getItem(WORKSPACE_KEY) || "[]"),
      activeWorkspaceId: localStorage.getItem(ACTIVE_WORKSPACE_KEY) || null,
      settings: {
        mode: state.mode,
        reasoning: localStorage.getItem(REASONING_KEY) === "true",
        selectedModel: state.selectedModel || MODEL,
        // Giữ hai trường cũ với cùng giá trị để backup tương thích ngược.
        quickModel: state.selectedModel || QUICK_MODEL,
        deepModel: state.selectedModel || QUICK_MODEL,
      },
      builtinKnowledgePreferences: getBuiltinKnowledgePreferences(),
    };
    const manifest = {
      format: "VECTOR_AI_BACKUP",
      version: 2,
      createdAt: new Date().toISOString(),
      appVersion: "0.1.0",
      counts: {
        chats: payload.generalChats.length + payload.workspaces.reduce((sum, workspace) => sum + (workspace.chats?.length || 0), 0),
        workspaces: payload.workspaces.length,
        files: records.length,
      },
      selectedModel: payload.settings.selectedModel,
      quickModel: payload.settings.quickModel,
      deepModel: payload.settings.deepModel,
      coreBackup: "core/vector-ai-core.zip",
    };
    setBackupStatus("Đang snapshot Python Core và kho RAG…", 12);
    const coreBackup = await backendApi.download("/backups", { timeout: 120000 });
    const JSZip = await getZip();
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    zip.file("data/state.json", JSON.stringify(payload));
    zip.file("data/workspace-files.json", JSON.stringify(records));
    zip.file("core/vector-ai-core.zip", coreBackup.blob);
    zip.file("README.txt", "VECTOR AI backup v2\nKhôi phục file này trong mục Quản lý dữ liệu của VECTOR AI.\nBao gồm chat/workspace, tệp tham chiếu, Python Core, công thức, checkpoint và cấu hình.\nModel Ollama và Qdrant index không được đóng gói.\n");
    const blob = await zip.generateAsync(
      { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
      ({ percent }) => setBackupStatus(`Đang đóng gói dữ liệu… ${Math.round(percent)}%`, 15 + percent * 0.85),
    );
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
    downloadBlob(blob, `VECTOR_AI_backup_${stamp}.zip`);
    setBackupStatus(`Hoàn tất · ${manifest.counts.chats} chat · ${manifest.counts.files} tài liệu`, 100, "success");
    notify("Đã xuất bản sao lưu VECTOR AI");
  } catch (error) {
    setBackupStatus(error.message || String(error), 100, "error");
  } finally {
    exportButton.disabled = false;
    if (!restoreBlocked) document.querySelector("#app").inert = false;
  }
}

async function importBackupFile(file) {
  if (!file) return;
  if (state.generating) { notify("Hãy dừng hoặc chờ phản hồi hoàn tất trước khi khôi phục."); return; }
  const importButton = $("#importBackup");
  try {
    importButton.disabled = true;
    if (file.size > 500 * 1024 * 1024) throw new Error("File backup vượt giới hạn 500 MB.");
    setBackupStatus("Đang kiểm tra file backup…", 10);
    const JSZip = await getZip();
    const zip = await JSZip.loadAsync(file);
    const manifestEntry = zip.file("manifest.json");
    const stateEntry = zip.file("data/state.json");
    const recordsEntry = zip.file("data/workspace-files.json");
    if (!manifestEntry || !stateEntry || !recordsEntry) throw new Error("Backup thiếu manifest hoặc dữ liệu bắt buộc.");
    const [manifest, payload, records] = await Promise.all([
      manifestEntry.async("string").then(JSON.parse),
      stateEntry.async("string").then(JSON.parse),
      recordsEntry.async("string").then(JSON.parse),
    ]);
    validateBackupPayload(manifest, payload, records);
    setBackupStatus(`Đã kiểm tra · ${manifest.counts?.chats || 0} chat · ${records.length} tài liệu`, 45);
    const accepted = await confirmAction({ title: "Khôi phục bản sao lưu?", message: "Toàn bộ chat, workspace và tài liệu hiện tại sẽ được thay thế bằng dữ liệu trong backup.", acceptLabel: "Khôi phục", danger: false });
    if (!accepted) {
      setBackupStatus("Đã hủy khôi phục. Dữ liệu hiện tại được giữ nguyên.", 0);
      return;
    }
    if (state.generating) throw new Error("Hãy dừng phản hồi trước khi khôi phục dữ liệu.");
    document.querySelector("#app").inert = true;
    await conversationPersistence.flush();
    const restoreId = crypto.randomUUID();
    const sharedModel = payload.settings?.selectedModel || payload.settings?.quickModel || payload.settings?.deepModel || QUICK_MODEL;
    const restoredMode = normalizeReasoningMode(payload.settings?.mode, payload.settings?.reasoning ? "DEEP" : "FAST");
    const values = {
      "vector.ai.sqlite-restore-local.v1": restoreId,
      [GENERAL_CHAT_KEY]: JSON.stringify(payload.generalChats),
      [WORKSPACE_KEY]: JSON.stringify(payload.workspaces),
      [REASONING_KEY]: String(REASONING_PROFILES[restoredMode].think),
      [REASONING_MODE_KEY]: restoredMode,
      [QUICK_MODEL_KEY]: sharedModel, [DEEP_MODEL_KEY]: sharedModel, [ACTIVE_MODEL_KEY]: sharedModel,
      "vector.ai.builtin-knowledge.preferences.v1": JSON.stringify(payload.builtinKnowledgePreferences || {}),
    };
    if (payload.activeWorkspaceId) values[ACTIVE_WORKSPACE_KEY] = payload.activeWorkspaceId;
    const removeKeys = [STORAGE_KEY, ...(!payload.activeWorkspaceId ? [ACTIVE_WORKSPACE_KEY] : [])];
    // Stage both halves before applying either. Preserve all original frontend
    // data until startup confirms that the matching Core restore succeeded.
    if (manifest.version >= 2) {
      const coreEntry = zip.file(manifest.coreBackup || "core/vector-ai-core.zip");
      if (!coreEntry) throw new Error("Backup v2 thiếu snapshot Python Core.");
      setBackupStatus("Đang kiểm tra kho RAG và database…", 55);
      const coreBlob = await coreEntry.async("blob");
      const coreForm = new FormData();
      coreForm.append("file", coreBlob, "vector-ai-core.zip");
      coreForm.append("frontend_restore_id", restoreId);
      await backupRestore.stage({ id: restoreId, records, values, removeKeys });
      try {
        await backendApi.request("/backups/restore", { method: "POST", body: coreForm, timeout: 120000 });
      } catch (error) {
        if (error.status >= 400 && error.status < 500) await backupRestore.abandon(restoreId);
        else showRestoreGate("Chưa xác nhận được kết quả nhập backup. Dữ liệu hiện tại vẫn được giữ. Khởi động lại app để kiểm tra trạng thái.");
        throw error;
      }
      showRestoreGate("Backup đã được kiểm tra. Hãy đóng rồi mở lại VECTOR AI để áp dụng đồng thời chat, tệp và kho RAG. Dữ liệu hiện tại chưa bị thay thế.");
    } else {
      await backupRestore.stage({ id: restoreId, records, values, removeKeys, coreRequired: false });
      restoreBlocked = true;
      await backupRestore.resume();
      setBackupStatus("Khôi phục hoàn tất. VECTOR AI đang tải lại…", 100, "success");
      setTimeout(() => window.location.reload(), 650);
    }
  } catch (error) {
    setBackupStatus(error.message || String(error), 100, "error");
  } finally {
    importButton.disabled = false;
    ui.backupFileInput.value = "";
    if (!restoreBlocked) document.querySelector("#app").inert = false;
  }
}

function showRestoreGate(message, heading = "Khôi phục dữ liệu") {
  restoreBlocked = true;
  document.querySelector("#app").inert = true;
  if (document.querySelector("#restoreGate")) return;
  const layer = document.createElement("div");
  layer.id = "restoreGate";
  layer.className = "restore-gate";
  layer.setAttribute("role", "alertdialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", heading);
  const panel = document.createElement("section");
  const title = document.createElement("h2"); title.textContent = heading;
  const text = document.createElement("p"); text.textContent = message;
  const retry = document.createElement("button"); retry.textContent = "Kiểm tra lại";
  retry.onclick = () => window.location.reload();
  panel.append(title, text, retry); layer.append(panel); document.body.append(layer); retry.focus();
}

document.querySelectorAll("[data-prompt]").forEach(
  (button) =>
    (button.onclick = () => {
      ui.prompt.value = button.dataset.prompt;
      resize();
      ui.prompt.focus();
    }),
);
document.addEventListener("keydown", (e) => {
  if (restoreBlocked || !persistenceReady || document.querySelector("#app").inert) return;
  if (e.key === "Tab" && trapModalFocus(e)) return;
  if (e.ctrlKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    newChat();
  }
  if (e.key === "Escape") {
    if (ui.confirmModal.classList.contains("open")) closeConfirm(false);
    else if (ui.inputModal.classList.contains("open")) closeInput(null);
    else if (workflowManager.isOpen()) workflowManager.close();
    else if (ui.modelModal.classList.contains("open")) $("#closeModels").click();
    else if (ui.dataModal.classList.contains("open")) closeDataManager();
    else if ($("#aboutModal").classList.contains("open")) $("#closeAbout").click();
    else if (ui.artifactPanel.classList.contains("open")) closeArtifact();
    else state.generating ? stop() : closeSidebar();
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".workspace-switcher"))
    ui.workspaceMenu.classList.remove("open");
});

async function boot() {
  document.querySelector("#app").inert = true;
  const intro = $("#appIntro");
  setTimeout(() => {
    intro?.classList.add("leaving");
    setTimeout(() => intro?.remove(), 650);
  }, 1150);
  if (inTauri) {
    try {
      await ensureDesktopOllama();
    } catch (error) {
      // Không chặn giao diện: màn hình thiết lập vẫn cho phép thử lại hoặc cài Ollama.
      console.warn("Ollama chưa thể tự khởi động:", error);
    }
    try { await invoke("ensure_backend"); }
    catch (error) {
      console.error("Python Core chưa khởi động:", error);
      showRestoreGate(
        `Không thể khởi động Python Core: ${String(error)}. Hãy đóng các cửa sổ VECTOR AI cũ rồi bấm Kiểm tra lại.`,
        "Python Core chưa sẵn sàng",
      );
      return;
    }
  }
  try {
    const restored = await backupRestore.resume(() => backendApi.request("/backups/restore-status"));
    if (restored === "waiting") {
      showRestoreGate("Chat và tệp đang chờ Python Core khôi phục cùng bản backup. Hãy đóng rồi mở lại VECTOR AI; tải lại trang không khởi động lại backend.");
      return;
    }
    if (restored === "applied") {
      state.selectedModel = localStorage.getItem(ACTIVE_MODEL_KEY) || QUICK_MODEL;
      state.mode = readReasoningMode(localStorage);
      state.reasoning = REASONING_PROFILES[state.mode].think;
      notify("Đã khôi phục dữ liệu. Bản trước khôi phục vẫn được lưu dự phòng.");
    }
  } catch (error) {
    showRestoreGate(`Chưa thể hoàn tất khôi phục: ${error.message}. Bản dữ liệu dự phòng vẫn được giữ.`);
    return;
  }
  try {
    const migrated = await receiveLegacyMigration({ api: backendApi, storage: localStorage, files: workspaceStorage });
    if (migrated) {
      state.selectedModel = localStorage.getItem(ACTIVE_MODEL_KEY) || localStorage.getItem(QUICK_MODEL_KEY) || QUICK_MODEL;
      state.mode = readReasoningMode(localStorage);
      state.reasoning = REASONING_PROFILES[state.mode].think;
      notify("Đã nhận dữ liệu cũ. Bản gốc vẫn được giữ nguyên.");
    }
  } catch (error) { console.warn("Chưa nhập dữ liệu origin cũ:", error); }
  void loadBuiltinKnowledge();
  loadChats();
  try {
    const saved = await conversationPersistence.initialize(conversationSnapshot(), {
      restoreLocal: Boolean(localStorage.getItem("vector.ai.sqlite-restore-local.v1")),
    });
    localStorage.setItem(GENERAL_CHAT_KEY, JSON.stringify(saved.generalChats));
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(saved.workspaces));
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, saved.activeWorkspaceId || "general");
    localStorage.removeItem("vector.ai.sqlite-restore-local.v1");
    loadChats();
    persistenceReady = true;
    document.querySelector("#app").inert = false;
  } catch (error) {
    showConversationPersistenceError(error);
    return;
  }
  saveChats();
  // Di chuyển cấu hình hai model cũ sang một model chat dùng chung.
  selectChatModel(state.selectedModel, { announce: false });
  state.activeId = state.chats[0]?.id || null;
  state.mode = normalizeReasoningMode(activeChat()?.mode, readReasoningMode(localStorage));
  state.reasoning = REASONING_PROFILES[state.mode].think;
  renderWorkspaces();
  renderList();
  renderMessages();
  renderReasoningMode();
  renderModelManager();
  await Promise.all([refreshStatus(false), refreshBackendStatus()]);
  setInterval(() => { if (!state.generating) { void refreshStatus(false); void refreshBackendStatus(); } }, 15000);
  ui.prompt.focus();
}
boot();
