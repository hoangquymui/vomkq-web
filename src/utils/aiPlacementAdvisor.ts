/**
 * CỐ VẤN VỊ TRÍ ĐẶT KHÍ TÀI BẰNG AI LOCAL (VECTOR AI)
 *
 * Vai trò: dựng prompt từ state tác chiến hiện tại và parse AN TOÀN câu trả lời JSON
 * của model thành dữ liệu có kiểu để render lên bản đồ.
 *
 * Hợp đồng JSON nghiêm ngặt yêu cầu model trả về:
 * {
 *   "summary": string,
 *   "suggestions": [{ "lat": number, "lon": number, "score": number, "reason": string }],
 *   "route": [{ "lat": number, "lon": number }]
 * }
 *
 * Không import store ở đây (giữ module thuần, tránh vòng lặp import); store truyền context vào.
 */
import type { VectorAiChatMessage } from '../services/vectorAiClient';

/** Một điểm gợi ý đặt khí tài đã được kiểm tra hợp lệ */
export interface AiPlacementSuggestion {
  latitude: number; // độ, kẹp [-90, 90]
  longitude: number; // độ, kẹp [-180, 180]
  score: number; // điểm tin cậy chuẩn hoá [0, 1]
  reason: string;
}

/** Một điểm trên "tuyến khả thi" */
export interface AiPlacementRoutePoint {
  latitude: number; // độ
  longitude: number; // độ
}

export interface AiPlacementAdvice {
  summary: string;
  suggestions: AiPlacementSuggestion[];
  route: AiPlacementRoutePoint[];
}

/** Kết quả parse có kiểu (không ném lỗi thô) */
export type AdvisorParseResult =
  | { ok: true; value: AiPlacementAdvice }
  | { ok: false; message: string };

/** Khu vực quan tâm = tâm camera hiện tại + bán kính */
export interface AdvisorViewport {
  lat: number;
  lon: number;
  heightM: number;
}

export interface AdvisorEquipmentContext {
  templateId: string;
  name: string;
  category: string;
  rangeKm: number;
  minElevationDeg: number;
  maxElevationDeg: number;
  coverageHeightKm: number;
  antennaHeightAGL: number;
}

export interface AdvisorPlacedEquipment {
  shortId?: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  altitude: number;
  rangeKm: number;
  status: string;
}

export interface AiPlacementContext {
  equipment: AdvisorEquipmentContext;
  placed: AdvisorPlacedEquipment[];
  viewport: AdvisorViewport;
  areaRadiusKm: number;
}

/**
 * Bán kính vùng quan tâm suy ra từ độ cao camera.
 * Đây là GIẢ ĐỊNH GIAO DIỆN (không có nguồn ngoài): bán kính = 0.8 × độ cao camera,
 * kẹp [15 km, 400 km] để prompt không quá nhỏ (thiếu phương án) hoặc quá lớn (loãng).
 */
export const ADVISOR_RADIUS_MIN_KM = 15;
export const ADVISOR_RADIUS_MAX_KM = 400;
export const ADVISOR_RADIUS_HEIGHT_FACTOR = 0.8;

export function deriveAdvisorRadiusKm(cameraHeightM: number): number {
  if (!Number.isFinite(cameraHeightM) || cameraHeightM <= 0) return ADVISOR_RADIUS_MIN_KM;
  const raw = (cameraHeightM / 1000) * ADVISOR_RADIUS_HEIGHT_FACTOR;
  return Math.min(ADVISOR_RADIUS_MAX_KM, Math.max(ADVISOR_RADIUS_MIN_KM, Math.round(raw)));
}

/**
 * Tâm vùng quan tâm mặc định khi camera chưa báo vị trí (toàn cảnh Việt Nam).
 * Đơn vị: độ (lat/lon), mét (heightM).
 */
const DEFAULT_VIEWPORT: AdvisorViewport = { lat: 16.0, lon: 107.5, heightM: 1500000 };

// Ô nhớ cấp module: CesiumGlobe ghi tâm camera vào đây mỗi khi camera đổi (không qua store
// để tránh re-render toàn app theo từng frame). Store đọc lại khi người dùng bấm "Phân tích".
let currentViewport: AdvisorViewport = { ...DEFAULT_VIEWPORT };

export function setAdvisorViewport(viewport: AdvisorViewport): void {
  if (
    Number.isFinite(viewport.lat) &&
    Number.isFinite(viewport.lon) &&
    Number.isFinite(viewport.heightM)
  ) {
    currentViewport = { ...viewport };
  }
}

export function getAdvisorViewport(): AdvisorViewport {
  return { ...currentViewport };
}

/** Prompt hệ thống: ràng buộc model chỉ trả JSON, không thêm văn bản ngoài JSON */
const SYSTEM_PROMPT = [
  'Bạn là cố vấn bố trí khí tài phòng không trên bản đồ GIS.',
  'Nhiệm vụ: đề xuất các vị trí/tuyến khả thi để đặt một khí tài mới, dựa trên thông số khí tài,',
  'các khí tài đã bố trí và vùng quan tâm được cung cấp.',
  'CHỈ trả về DUY NHẤT một đối tượng JSON hợp lệ, không kèm giải thích, không bọc trong markdown,',
  'theo đúng lược đồ:',
  '{"summary": string, "suggestions": [{"lat": number, "lon": number, "score": number, "reason": string}], "route": [{"lat": number, "lon": number}]}',
  'Quy ước: lat/lon theo WGS-84 (độ thập phân); score trong khoảng 0..1 (càng cao càng tốt);',
  'reason ngắn gọn bằng tiếng Việt; route là dãy điểm nối thành tuyến khả thi (có thể rỗng);',
  'suggestions có thể rỗng nếu không có phương án phù hợp. Không bịa toạ độ nằm ngoài vùng quan tâm.',
].join(' ');

/** Làm tròn toạ độ trong prompt để prompt gọn và ổn định */
function round6(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * Dựng mảng messages gửi cho VECTOR AI từ context tác chiến hiện tại.
 * Chỉ gồm 1 system + 1 user để hợp với template chat nghiêm ngặt của backend.
 */
export function buildPlacementMessages(context: AiPlacementContext): VectorAiChatMessage[] {
  const { equipment, placed, viewport, areaRadiusKm } = context;

  const equipmentLines = [
    `- Loại khí tài: ${equipment.name} (templateId: ${equipment.templateId}, nhóm: ${equipment.category})`,
    `- Tầm hoạt động: ${equipment.rangeKm} km`,
    `- Góc tà: ${equipment.minElevationDeg}° đến ${equipment.maxElevationDeg}°`,
    `- Trần phủ sóng: ${equipment.coverageHeightKm} km`,
    `- Chiều cao ăng-ten (AGL): ${equipment.antennaHeightAGL} m`,
  ].join('\n');

  const placedLines =
    placed.length === 0
      ? '(chưa có khí tài nào được đặt)'
      : placed
          .map((item) => {
            const id = item.shortId ? `[${item.shortId}] ` : '';
            return `- ${id}${item.name} | nhóm: ${item.category} | ${round6(item.latitude)}, ${round6(
              item.longitude
            )} | cao độ ${Math.round(item.altitude)} m | tầm ${item.rangeKm} km | trạng thái ${item.status}`;
          })
          .join('\n');

  const userPrompt = [
    'THÔNG SỐ KHÍ TÀI CẦN ĐẶT:',
    equipmentLines,
    '',
    'KHÍ TÀI ĐÃ BỐ TRÍ TRÊN BẢN ĐỒ:',
    placedLines,
    '',
    'VÙNG QUAN TÂM (vùng cần đề xuất):',
    `- Tâm: ${round6(viewport.lat)}, ${round6(viewport.lon)}`,
    `- Bán kính: ${areaRadiusKm} km`,
    '',
    'Hãy đề xuất các vị trí khả thi (kèm lý do chiến thuật/địa hình) và một tuyến khả thi.',
    'Trả về đúng JSON theo lược đồ đã nêu.',
  ].join('\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}

/** Tìm khối JSON đầu tiên trong văn bản bằng cách đếm ngoặc (bỏ qua ngoặc trong chuỗi) */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

function clampLat(value: number): number {
  return Math.min(90, Math.max(-90, value));
}

function clampLon(value: number): number {
  return Math.min(180, Math.max(-180, value));
}

/**
 * Chuẩn hoá `score` về [0, 1].
 * GIẢ ĐỊNH: model có thể trả thang 0..1 hoặc 0..100 (không được quy định trong lược đồ),
 * nên giá trị > 1 và ≤ 100 được coi là thang phần trăm; ngoài ra kẹp về [0, 1].
 */
function normalizeScore(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  if (raw >= 0 && raw <= 1) return raw;
  if (raw > 1 && raw <= 100) return raw / 100;
  return Math.min(1, Math.max(0, raw));
}

function toFiniteNumber(raw: unknown): number | null {
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function dedupeKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

/**
 * Parse AN TOÀN câu trả lời của model thành `AiPlacementAdvice`:
 * - Trích khối JSON đầu tiên trong văn bản (chịu được markdown/giải thích bao quanh).
 * - Chỉ nhận toạ độ là số hữu hạn; kẹp lat/lon về miền hợp lệ.
 * - Loại trùng theo khoá làm tròn 4 chữ số thập phân.
 * - Chấp nhận mảng rỗng (không có gợi ý / không có tuyến).
 */
export function parsePlacementAdvice(rawText: string): AdvisorParseResult {
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    return { ok: false, message: 'VECTOR AI trả về nội dung rỗng.' };
  }

  const jsonText = extractFirstJsonObject(rawText);
  if (!jsonText) {
    return { ok: false, message: 'Không tìm thấy khối JSON trong câu trả lời của VECTOR AI.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `JSON của VECTOR AI không hợp lệ: ${message}` };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, message: 'JSON của VECTOR AI không phải đối tượng.' };
  }

  const record = parsed as Record<string, unknown>;

  const summary = typeof record.summary === 'string' ? record.summary.trim() : '';

  const suggestions: AiPlacementSuggestion[] = [];
  const seenSuggestions = new Set<string>();
  if (Array.isArray(record.suggestions)) {
    for (const item of record.suggestions) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const lat = toFiniteNumber(entry.lat ?? entry.latitude);
      const lon = toFiniteNumber(entry.lon ?? entry.longitude);
      if (lat === null || lon === null) continue;

      const latitude = clampLat(lat);
      const longitude = clampLon(lon);
      const key = dedupeKey(latitude, longitude);
      if (seenSuggestions.has(key)) continue;
      seenSuggestions.add(key);

      suggestions.push({
        latitude,
        longitude,
        score: normalizeScore(entry.score),
        reason: typeof entry.reason === 'string' ? entry.reason.trim() : '',
      });
    }
  }

  const route: AiPlacementRoutePoint[] = [];
  const seenRoute = new Set<string>();
  if (Array.isArray(record.route)) {
    for (const item of record.route) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const lat = toFiniteNumber(entry.lat ?? entry.latitude);
      const lon = toFiniteNumber(entry.lon ?? entry.longitude);
      if (lat === null || lon === null) continue;

      const latitude = clampLat(lat);
      const longitude = clampLon(lon);
      const key = dedupeKey(latitude, longitude);
      if (seenRoute.has(key)) continue;
      seenRoute.add(key);

      route.push({ latitude, longitude });
    }
  }

  return { ok: true, value: { summary, suggestions, route } };
}
