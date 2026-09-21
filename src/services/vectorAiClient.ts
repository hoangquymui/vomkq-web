/**
 * CLIENT HTTP CHO BACKEND "VECTOR AI" LOCAL (FastAPI + Ollama, loopback-only 127.0.0.1:8000)
 *
 * Nguồn API (chỉ đọc, KHÔNG sửa):
 * - VECTOR AI/backend/README.md  -> host/port mặc định 127.0.0.1:8000
 * - VECTOR AI/backend/vector_ai_backend/api.py
 *     GET  /api/v1/health                     -> { status: "ready", ... }
 *     GET  /api/v1/models                     -> JSON tags của Ollama ({ models: [{ name }] })
 *     POST /api/v1/runs  {model, messages, mode, scope} -> { run_id }
 *     GET  /api/v1/runs/{run_id}/events       -> SSE (text/event-stream)
 * - VECTOR AI/backend/vector_ai_backend/domain/models.py -> RunEventType:
 *     started | stage | progress | sources | delta | usage | completed | cancelled | error
 *     DELTA     : data = { content: string }   (từng mẩu token)
 *     COMPLETED : data = { final_content: string } (bản hợp nhất chuẩn của backend)
 *
 * CORS: backend chỉ cho origin http://127.0.0.1:3000 và http://localhost:1420 (api.py dòng 119),
 * nên client KHÔNG gọi thẳng http://127.0.0.1:8000. Mặc định dùng đường dẫn tương đối
 * `/vector-ai` để đi qua Vite dev proxy (xem vite.config.ts). Có thể override bằng
 * biến môi trường `VITE_VECTOR_AI_URL` (ví dụ khi chạy bản đã build tĩnh).
 *
 * Mọi hàm đều trả về `VectorAiResult` có kiểu (typed) — KHÔNG ném lỗi thô ra UI.
 */

/** Nguyên nhân lỗi đã được phân loại để UI hiển thị/khôi phục */
export type VectorAiErrorKind =
  | 'offline' // không kết nối được backend (backend chưa chạy / sai cổng)
  | 'timeout' // quá hạn chờ
  | 'aborted' // người dùng/hệ thống chủ động huỷ
  | 'http' // backend trả mã lỗi HTTP
  | 'parse' // phản hồi không đúng JSON/định dạng mong đợi
  | 'stream'; // lỗi giữa luồng SSE

export interface VectorAiError {
  kind: VectorAiErrorKind;
  message: string;
  /** Mã HTTP khi kind === 'http' */
  status?: number;
}

export type VectorAiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: VectorAiError };

/**
 * Base URL của backend VECTOR AI.
 * - Mặc định: '/vector-ai' (tương đối, đi qua Vite dev proxy -> cùng origin, không CORS).
 * - Override: đặt VITE_VECTOR_AI_URL=http://127.0.0.1:8000 (chỉ dùng khi origin đã được backend cho phép).
 * Đơn vị: không có. Kiểu: string. Nơi dùng: mọi request bên dưới.
 */
export const VECTOR_AI_BASE_URL: string =
  (import.meta.env.VITE_VECTOR_AI_URL as string | undefined)?.replace(/\/+$/, '') ||
  '/vector-ai';

/** Timeout kiểm tra health (ms) — backend local nên rất nhanh, 3s là đủ để kết luận offline. */
export const VECTOR_AI_HEALTH_TIMEOUT_MS = 3000;
/** Timeout lấy danh sách model (ms) — endpoint này gọi tiếp Ollama nên rộng hơn health. */
export const VECTOR_AI_MODELS_TIMEOUT_MS = 5000;
/** Timeout toàn bộ một lượt hỏi model (ms) — model local chạy CPU/GPU có thể rất chậm. */
export const VECTOR_AI_ASK_TIMEOUT_MS = 120000;
/** Launcher chờ dịch vụ tối đa 60s; 75s dành thêm thời gian probe và HTTP. */
export const VECTOR_AI_START_TIMEOUT_MS = 75000;

/** Role hợp lệ theo backend ChatMessage (api.py dùng str(item["role"]) nên không bắt buộc, giữ đúng chuẩn). */
export type VectorAiRole = 'system' | 'user' | 'assistant';

export interface VectorAiChatMessage {
  role: VectorAiRole;
  content: string;
}

export interface VectorAiHealth {
  status: string;
  address?: string;
  offline?: boolean;
  [key: string]: unknown;
}

export interface AskVectorAiOptions {
  /** Tên model Ollama (lấy từ listVectorAiModels) */
  model: string;
  messages: VectorAiChatMessage[];
  /** Chế độ suy luận của backend, mặc định 'NORMAL' theo yêu cầu tích hợp */
  mode?: string;
  timeoutMs?: number;
  /** Tín hiệu huỷ từ bên ngoài (ví dụ: đóng panel) */
  signal?: AbortSignal;
  /** Callback nhận từng mẩu token để UI stream dần (tuỳ chọn) */
  onDelta?: (chunk: string) => void;
}

export interface AskVectorAiResult {
  runId: string;
  /** Toàn bộ nội dung trả lời đã ghép */
  text: string;
}

function makeError(kind: VectorAiErrorKind, message: string, status?: number): VectorAiError {
  return status === undefined ? { kind, message } : { kind, message, status };
}

/** Lỗi mạng của fetch (backend không chạy / sai cổng) được quy về 'offline'. */
function normalizeFetchError(error: unknown, timedOut: boolean, externalAborted: boolean): VectorAiError {
  if (externalAborted) {
    return makeError('aborted', 'Yêu cầu đã bị huỷ.');
  }
  if (timedOut) {
    return makeError('timeout', `Quá hạn chờ phản hồi từ VECTOR AI (${VECTOR_AI_BASE_URL}).`);
  }
  const message = error instanceof Error ? error.message : String(error);
  return makeError('offline', `Không kết nối được VECTOR AI (${VECTOR_AI_BASE_URL}): ${message}`);
}

/**
 * fetch có timeout + tín hiệu huỷ ngoài.
 * Trả về cả cờ `timedOut`/`aborted` để phân loại lỗi chính xác.
 */
async function fetchWithTimeout(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<
  | { ok: true; response: Response }
  | { ok: false; error: VectorAiError }
> {
  const controller = new AbortController();
  let timedOut = false;
  let externalAborted = externalSignal?.aborted === true;

  const onExternalAbort = () => {
    externalAborted = true;
    controller.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      return { ok: false, error: makeError('aborted', 'Yêu cầu đã bị huỷ.') };
    }
    externalSignal.addEventListener('abort', onExternalAbort);
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1000, timeoutMs));

  try {
    const response = await fetch(`${VECTOR_AI_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
    });
    return { ok: true, response };
  } catch (error) {
    return { ok: false, error: normalizeFetchError(error, timedOut, externalAborted) };
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

/** GET JSON có kiểm tra mã trạng thái + parse an toàn */
async function requestJson<T>(
  path: string,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<VectorAiResult<T>> {
  const fetched = await fetchWithTimeout(
    path,
    { method: 'GET', headers: { Accept: 'application/json' } },
    timeoutMs,
    externalSignal
  );
  if (!fetched.ok) return fetched;

  if (!fetched.response.ok) {
    return {
      ok: false,
      error: makeError(
        'http',
        `VECTOR AI trả mã lỗi HTTP ${fetched.response.status} cho ${path}.`,
        fetched.response.status
      ),
    };
  }

  try {
    const value = (await fetched.response.json()) as T;
    return { ok: true, value };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: makeError('parse', `JSON không hợp lệ từ ${path}: ${message}`) };
  }
}

/** Kiểm tra backend đã sẵn sàng chưa (GET /api/v1/health) */
export async function checkVectorAiHealth(
  signal?: AbortSignal
): Promise<VectorAiResult<VectorAiHealth>> {
  const result = await requestJson<VectorAiHealth>('/api/v1/health', VECTOR_AI_HEALTH_TIMEOUT_MS, signal);
  if (!result.ok) return result;

  const health = result.value;
  if (!health || typeof health.status !== 'string') {
    return { ok: false, error: makeError('parse', 'Phản hồi health thiếu trường "status".') };
  }
  return { ok: true, value: health };
}

let startingVectorAi: Promise<VectorAiResult<void>> | undefined;

/** Bật dịch vụ local qua Vite, dùng chung lượt khởi động khi mở panel nhiều lần. */
export function ensureVectorAiReady(): Promise<VectorAiResult<void>> {
  if (startingVectorAi) return startingVectorAi;
  startingVectorAi = (async (): Promise<VectorAiResult<void>> => {
    // URL tuỳ chỉnh là backend do người dùng quản lý, không khởi động dịch vụ local cho nó.
    if (VECTOR_AI_BASE_URL !== '/vector-ai') {
      const health = await checkVectorAiHealth();
      if (!health.ok) return health;
      return health.value.status === 'ready'
        ? { ok: true, value: undefined }
        : { ok: false, error: makeError('offline', 'VECTOR AI chưa sẵn sàng.') };
    }
    try {
      const response = await fetch('/__vector-ai/start', {
        method: 'POST',
        headers: { Accept: 'application/json', 'X-Vector-AI-Start': '1' },
        signal: AbortSignal.timeout(VECTOR_AI_START_TIMEOUT_MS),
      });
      if (!response.headers.get('content-type')?.includes('application/json')) {
        return { ok: false, error: makeError('offline', 'Tự khởi động VECTOR AI cần chạy web bằng npm run dev hoặc npm run preview trên máy này.') };
      }
      const payload = await response.json() as { status?: string; message?: string };
      if (!response.ok || payload.status !== 'ready') {
        return { ok: false, error: makeError('offline', payload.message || 'Không khởi động được VECTOR AI.', response.status) };
      }
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, error: normalizeFetchError(error, error instanceof DOMException && error.name === 'TimeoutError', false) };
    }
  })().finally(() => { startingVectorAi = undefined; });
  return startingVectorAi;
}

/** Danh sách model Ollama khả dụng (GET /api/v1/models) */
export async function listVectorAiModels(
  signal?: AbortSignal
): Promise<VectorAiResult<string[]>> {
  const result = await requestJson<unknown>('/api/v1/models', VECTOR_AI_MODELS_TIMEOUT_MS, signal);
  if (!result.ok) return result;

  const payload = result.value as { models?: unknown } | null;
  const rawModels = payload && Array.isArray(payload.models) ? payload.models : [];
  const names: string[] = [];
  for (const item of rawModels) {
    if (typeof item === 'string') {
      names.push(item);
      continue;
    }
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const name = record.name ?? record.model;
      if (typeof name === 'string' && name.trim().length > 0) names.push(name.trim());
    }
  }
  return { ok: true, value: names };
}

/** Một khối SSE sau khi tách header `event:` và payload `data:` */
interface ParsedSseBlock {
  eventType: string;
  data: string;
}

/**
 * Tách một khối SSE (đã cắt theo dấu phân cách dòng trống).
 * Hỗ trợ nhiều dòng `data:` (nối bằng '\n') theo chuẩn text/event-stream.
 */
function parseSseBlock(block: string): ParsedSseBlock | null {
  const lines = block.split('\n');
  let eventType = 'message';
  const dataLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (line.length === 0 || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventType = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
    }
  }

  if (dataLines.length === 0) return null;
  return { eventType, data: dataLines.join('\n') };
}

/**
 * Trích `content` của event delta.
 * Backend trả `{ run_id, type, stage, data: { content } }` (RunEvent.to_dict), nhưng vẫn
 * chấp nhận dạng phẳng `{ content }` để bền vững nếu backend đổi cách đóng gói.
 */
function extractDeltaContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const direct = record.content ?? record.text;
  if (typeof direct === 'string') return direct;
  const nested = record.data;
  if (nested && typeof nested === 'object') {
    const data = nested as Record<string, unknown>;
    const value = data.content ?? data.text;
    if (typeof value === 'string') return value;
  }
  return '';
}

/** Trích nội dung cuối cùng của event completed (data.final_content của backend) */
function extractFinalContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const direct = record.final_content ?? record.content;
  if (typeof direct === 'string') return direct;
  const nested = record.data;
  if (nested && typeof nested === 'object') {
    const data = nested as Record<string, unknown>;
    const value = data.final_content ?? data.content;
    if (typeof value === 'string') return value;
  }
  return '';
}

/** Trích thông báo lỗi của event error (message ở cấp cao nhất hoặc trong data) */
function extractErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const direct = record.message ?? record.error;
    if (typeof direct === 'string' && direct.trim().length > 0) return direct;
    const nested = record.data;
    if (nested && typeof nested === 'object') {
      const data = nested as Record<string, unknown>;
      const value = data.message ?? data.error;
      if (typeof value === 'string' && value.trim().length > 0) return value;
    }
  }
  return fallback;
}

/**
 * Gửi câu hỏi tới VECTOR AI và ghép nội dung từ SSE thành chuỗi hoàn chỉnh.
 *
 * Luồng: POST /api/v1/runs -> { run_id } -> GET /api/v1/runs/{run_id}/events (SSE)
 * - Ghép dần `data.content` của các event `delta`.
 * - Khi nhận `completed`, ưu tiên `data.final_content` (bản chuẩn của backend) nếu không rỗng
 *   để không mất phần đuôi token.
 * - `error` / `cancelled` -> trả lỗi có kiểu.
 */
export async function askVectorAi(
  options: AskVectorAiOptions
): Promise<VectorAiResult<AskVectorAiResult>> {
  const { model, messages, mode = 'NORMAL', onDelta } = options;
  const timeoutMs = options.timeoutMs ?? VECTOR_AI_ASK_TIMEOUT_MS;

  if (!model || !model.trim()) {
    return { ok: false, error: makeError('parse', 'Chưa chọn model VECTOR AI.') };
  }
  if (!messages || messages.length === 0) {
    return { ok: false, error: makeError('parse', 'Cần ít nhất một message để hỏi VECTOR AI.') };
  }

  // 1. Khởi tạo run
  const startFetched = await fetchWithTimeout(
    '/api/v1/runs',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        mode,
        // scope builtin: chỉ dùng tri thức gốc, không phụ thuộc workspace/chat của app Tauri
        scope: { builtin: true },
      }),
    },
    Math.min(timeoutMs, VECTOR_AI_MODELS_TIMEOUT_MS),
    options.signal
  );
  if (!startFetched.ok) return startFetched;

  if (!startFetched.response.ok) {
    return {
      ok: false,
      error: makeError(
        'http',
        `Không tạo được run VECTOR AI (HTTP ${startFetched.response.status}).`,
        startFetched.response.status
      ),
    };
  }

  let runId = '';
  try {
    const payload = (await startFetched.response.json()) as { run_id?: unknown };
    if (typeof payload.run_id === 'string') runId = payload.run_id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: makeError('parse', `Phản hồi tạo run không hợp lệ: ${message}`) };
  }
  if (!runId) {
    return { ok: false, error: makeError('parse', 'Phản hồi tạo run thiếu "run_id".') };
  }

  // 2. Mở luồng SSE và ghép nội dung
  const controller = new AbortController();
  let timedOut = false;
  let externalAborted = options.signal?.aborted === true;
  const onExternalAbort = () => {
    externalAborted = true;
    controller.abort();
  };
  if (options.signal) options.signal.addEventListener('abort', onExternalAbort);
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1000, timeoutMs));

  let streamText = '';
  let finalText = '';
  let streamError: VectorAiError | null = null;

  try {
    const response = await fetch(`${VECTOR_AI_BASE_URL}/api/v1/runs/${encodeURIComponent(runId)}/events`, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        error: makeError(
          'http',
          `Không mở được luồng sự kiện VECTOR AI (HTTP ${response.status}).`,
          response.status
        ),
      };
    }
    if (!response.body) {
      return { ok: false, error: makeError('stream', 'Backend không trả về luồng SSE.') };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let completed = false;

    while (!completed) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let separatorIndex = buffer.indexOf('\n\n');
      while (separatorIndex !== -1) {
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        separatorIndex = buffer.indexOf('\n\n');

        const parsed = parseSseBlock(block);
        if (!parsed) continue;

        let payload: unknown = null;
        try {
          payload = parsed.data ? JSON.parse(parsed.data) : null;
        } catch {
          // Bỏ qua khối SSE không phải JSON (comment/keep-alive)
          continue;
        }

        // Trường `type` trong payload là nguồn chính; header `event:` là dự phòng.
        const type =
          payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).type === 'string'
            ? String((payload as Record<string, unknown>).type)
            : parsed.eventType;

        if (type === 'delta') {
          const chunk = extractDeltaContent(payload);
          if (chunk) {
            streamText += chunk;
            onDelta?.(chunk);
          }
        } else if (type === 'completed') {
          finalText = extractFinalContent(payload);
          completed = true;
        } else if (type === 'cancelled') {
          streamError = makeError('aborted', 'VECTOR AI đã huỷ lượt chạy.');
          completed = true;
        } else if (type === 'error') {
          streamError = makeError('stream', extractErrorMessage(payload, 'VECTOR AI báo lỗi khi sinh câu trả lời.'));
          completed = true;
        }
      }
    }

    if (streamError) return { ok: false, error: streamError };

    const text = finalText.trim().length > 0 ? finalText : streamText;
    if (text.trim().length === 0) {
      return { ok: false, error: makeError('stream', 'VECTOR AI không trả về nội dung nào.') };
    }
    return { ok: true, value: { runId, text } };
  } catch (error) {
    return { ok: false, error: normalizeFetchError(error, timedOut, externalAborted) };
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}
