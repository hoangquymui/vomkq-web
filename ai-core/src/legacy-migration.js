const MARKER = "vector.ai.origin-migration.v2";

export async function receiveLegacyMigration({ api, storage, files }) {
  if (storage.getItem(MARKER)) return false;
  const readList = (key) => {
    const value = JSON.parse(storage.getItem(key) || "[]");
    if (!Array.isArray(value)) throw new Error("Kho dữ liệu hiện tại không hợp lệ");
    return value;
  };
  if (readList("vector.ai.general-chats.v1").length || readList("vector.ai.chats.v1").length || readList("vector.ai.workspaces.v1").length) return false;
  const response = await api.request("/migration/legacy");
  const payload = response.payload;
  if (!payload) return false;
  if (!Array.isArray(payload.generalChats) || !Array.isArray(payload.workspaces) || !Array.isArray(payload.workspaceFiles)) throw new Error("Bản migration thiếu dữ liệu bắt buộc");
  if (!payload.storage || typeof payload.storage !== "object") throw new Error("Bản migration thiếu cấu hình cũ");
  const existingFiles = await files.getAll();
  if (existingFiles.length) return false;
  const incoming = Object.entries(payload.storage).filter(([key, value]) => key.startsWith("vector.ai.") && key !== MARKER && typeof value === "string");
  const previous = new Map(incoming.map(([key]) => [key, storage.getItem(key)]));
  try {
    await files.replaceAll(payload.workspaceFiles);
    for (const [key, value] of incoming) storage.setItem(key, value);
    storage.setItem(MARKER, response.payload_hash);
  } catch (error) {
    for (const [key, value] of previous) {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    }
    await files.replaceAll(existingFiles);
    throw error;
  }
  return true;
}
