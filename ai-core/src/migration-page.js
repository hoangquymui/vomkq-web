import { invoke } from "@tauri-apps/api/core";
import { backendApi } from "./backend-api.js";
import { createWorkspaceStorage } from "./workspace-storage.js";

const status = document.querySelector("#migration-status");
const start = document.querySelector("#migration-start");
const read = (key, fallback) => {
  const raw = localStorage.getItem(key);
  return raw === null ? fallback : JSON.parse(raw);
};
let payload;
try {
  if (location.origin !== "http://localhost:1420") throw new Error("Hãy mở trang này bằng MIGRATE_LEGACY_DATA.bat để đọc đúng kho dữ liệu cũ.");
  const keys = Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith("vector.ai.")).map(key => [key, localStorage.getItem(key)]));
  payload = {
    generalChats: read("vector.ai.general-chats.v1", read("vector.ai.chats.v1", [])),
    workspaces: read("vector.ai.workspaces.v1", []),
    workspaceFiles: await createWorkspaceStorage("vector-ai-workspace-files").getAll(),
    storage: keys,
    sourceOrigin: location.origin,
  };
  const chats = payload.generalChats.length + payload.workspaces.reduce((sum, ws) => sum + (ws.chats?.length || 0), 0);
  status.textContent = `Tìm thấy ${chats} cuộc trò chuyện, ${payload.workspaces.length} workspace và ${payload.workspaceFiles.length} tệp.`;
  start.disabled = false;
} catch (error) { status.textContent = error.message; }

start.onclick = async () => {
  start.disabled = true;
  try {
    if (window.__TAURI_INTERNALS__) await invoke("ensure_backend");
    const result = await backendApi.request("/migration/legacy", { method: "POST", body: payload, timeout: 120000 });
    status.textContent = `Đã sao chép và ghi nhận mã ${result.payload_hash.slice(0, 12)}. Đóng cửa sổ này, chạy RUN_VECTOR_AI.bat; bản mới sẽ nhận dữ liệu nếu kho chat đang trống.`;
  } catch (error) {
    status.textContent = error.message;
    start.disabled = false;
  }
};
