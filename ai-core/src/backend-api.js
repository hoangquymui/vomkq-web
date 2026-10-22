export const BACKEND_URL = "http://127.0.0.1:8000/api/v1";

export class BackendError extends Error {
  constructor(message, status = 0) { super(message); this.name = "BackendError"; this.status = status; }
}

export function createBackendClient({ baseUrl = BACKEND_URL, fetchImpl = globalThis.fetch } = {}) {
  async function request(path, { method = "GET", body, signal, timeout = 15000 } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timer = timeout ? setTimeout(() => controller.abort(), timeout) : null;
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method, signal: controller.signal,
        headers: body instanceof FormData ? {} : { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new BackendError(`Backend HTTP ${response.status}: ${detail.slice(0, 1200)}`, response.status);
      }
      if (response.status === 204) return null;
      return await response.json();
    } catch (error) {
      if (error instanceof BackendError || signal?.aborted) throw error;
      throw new BackendError(`Không kết nối được Python Core tại 127.0.0.1:8000: ${error.message}`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  async function events(runId, onEvent, { signal } = {}) {
    const response = await fetchImpl(`${baseUrl}/runs/${encodeURIComponent(runId)}/events`, { signal, headers: { Accept: "text/event-stream" } });
    if (!response.ok || !response.body) throw new BackendError(`Không mở được luồng sự kiện (${response.status})`, response.status);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", terminal = false;
    const consume = async (block) => {
      const lines = block.split("\n");
      const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (!data) return;
      const event = JSON.parse(data);
      event.type ||= lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
      await onEvent(event);
      if (["completed", "cancelled", "error"].includes(event.type)) terminal = true;
    };
    try {
      while (!terminal) {
        const { value, done } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          await consume(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
        }
        if (done) {
          if (buffer.trim()) await consume(buffer);
          if (!terminal) throw new BackendError("Luồng phản hồi bị ngắt trước khi hoàn tất; không tự gửi lại để tránh chạy trùng.");
          break;
        }
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async function download(path, { signal, timeout = 120000 } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timer = timeout ? setTimeout(() => controller.abort(), timeout) : null;
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, { method: "POST", signal: controller.signal });
      if (!response.ok) throw new BackendError(`Backend HTTP ${response.status}: ${(await response.text()).slice(0, 1200)}`, response.status);
      const disposition = response.headers.get("content-disposition") || "";
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
      return { blob: await response.blob(), filename: decodeURIComponent(encoded || plain || "vector-ai-backup.zip") };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  return { request, events, download, health: () => request("/health", { timeout: 2500 }), cancel: (id) => request(`/runs/${encodeURIComponent(id)}`, { method: "DELETE" }) };
}

export const backendApi = createBackendClient();
