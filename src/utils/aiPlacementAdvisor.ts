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
import type { CriterionKey, PlacementCandidate, PlacementCandidateCriteria } from './placementCandidateEngine';

/**
 * Một điểm gợi ý đặt khí tài.
 *
 * LƯU Ý VỀ NGUỒN GỐC DỮ LIỆU (thay đổi quan trọng so với bản cũ):
 * - `latitude`, `longitude`, `score`, `breakdown`, `criteria` do ĐỘNG CƠ CLIENT tính từ
 *   dữ liệu thật (`placementCandidateEngine.ts`). AI KHÔNG được phép sửa các trường này.
 * - `reason` là lý do deterministic từ số liệu thật.
 * - `aiReason` là diễn giải chiến thuật do AI viết thêm (tuỳ chọn, có thể không có).
 */
export interface AiPlacementSuggestion {
  latitude: number; // độ, kẹp [-90, 90]
  longitude: number; // độ, kẹp [-180, 180]
  score: number; // điểm tin cậy chuẩn hoá [0, 1] - TÍNH TỪ DỮ LIỆU THẬT
  reason: string;
  /** Diễn giải chiến thuật của AI (nếu có). Không ảnh hưởng toạ độ/điểm. */
  aiReason?: string;
  /** Điểm từng tiêu chí của động cơ, dùng để UI giải thích. */
  breakdown?: Partial<Record<CriterionKey, number>>;
  /** Số liệu thật đo được tại điểm này. */
  criteria?: PlacementCandidateCriteria;
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
  /**
   * Đặc tính vùng phủ đã dựng sẵn bằng `buildSiteProfile()` (xem `featureAwareness.ts`).
   * Đây là phần làm cho AI có "mắt": biết trong tầm hoạt động của khí tài có bao nhiêu
   * nhà, sông/suối cách bao xa, địa hình dốc cỡ nào, rừng phủ bao nhiêu %.
   * Có thể bỏ trống (undefined) nếu chưa tải gói dữ liệu vectơ nào - khi đó AI chỉ
   * dựa trên thông số khí tài và vị trí đã bố trí.
   */
  siteProfileText?: string;
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
  'các khí tài đã bố trí, vùng quan tâm và ĐẶC TÍNH ĐỊA HÌNH VÙNG PHỦ được cung cấp.',
  'QUY TẮC VỀ DỮ LIỆU ĐỊA HÌNH: chỉ lập luận dựa trên các số liệu địa hình có thật trong phần',
  '"ĐẶC TÍNH ĐỊA HÌNH VÙNG PHỦ"; TUYỆT ĐỐI không bịa thêm đặc điểm không có trong dữ liệu',
  '(ví dụ không được tự nói "có nhà ở hướng đông" nếu dữ liệu không nêu nhà ở hướng đông).',
  'Nếu phần đặc tính ghi rõ dữ liệu mỏng hoặc không có dữ liệu, hãy nói rõ điều đó trong lý do',
  'thay vì suy đoán. Ưu tiên vị trí cao, thoáng, tầm nhìn tốt, xa khu dân cư và tuyến đường lớn.',
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
  const { equipment, placed, viewport, areaRadiusKm, siteProfileText } = context;

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
    // Khối đặc tính địa hình: đây là thứ biến AI từ "đoán mò" sang "lập luận có căn cứ"
    ...(siteProfileText ? ['ĐẶC TÍNH ĐỊA HÌNH VÙNG PHỦ (dữ liệu thật từ terrain + OSM):', siteProfileText, ''] : []),
    'Hãy đề xuất các vị trí khả thi (kèm lý do chiến thuật/địa hình) và một tuyến khả thi.',
    'Trả về đúng JSON theo lược đồ đã nêu.',
  ].join('\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}

// ---------------------------------------------------------------------------
// CHẾ ĐỘ XẾP HẠNG: AI chỉ XẾP HẠNG + DIỄN GIẢI, không tự bịa toạ độ
// ---------------------------------------------------------------------------

/** Một mục xếp hạng do AI trả về: `index` trỏ vào danh sách ứng viên đã gửi. */
export interface AiPlacementRankingEntry {
  index: number;
  reason: string;
}

export interface AiPlacementRanking {
  summary: string;
  ranking: AiPlacementRankingEntry[];
}

export type AdvisorRankingParseResult =
  | { ok: true; value: AiPlacementRanking }
  | { ok: false; message: string };

/**
 * Prompt hệ thống cho chế độ xếp hạng. Khác chế độ cũ ở chỗ: toạ độ/điểm ĐÃ có sẵn từ
 * động cơ client, nên cấm model bịa toạ độ. Đây là thay đổi cốt lõi khắc phục hiện tượng
 * "đặt đại cho có".
 */
const RANKING_SYSTEM_PROMPT = [
  'Bạn là cố vấn bố trí khí tài phòng không trên bản đồ GIS.',
  'DANH SÁCH ỨNG VIÊN dưới đây do hệ thống ĐÃ TÍNH TỪ DỮ LIỆU THẬT (cao độ DEM, cự ly thật',
  'tới nhà/đường/sông-suối-hồ). Nhiệm vụ của bạn CHỈ là: (1) xếp hạng lại các ứng viên theo',
  'mức phù hợp tác chiến, (2) viết lý do ngắn gọn bằng tiếng Việt cho từng ứng viên.',
  'TUYỆT ĐỐI KHÔNG bịa thêm toạ độ, KHÔNG tạo ứng viên mới, KHÔNG phản biện số liệu đã cho.',
  'Chỉ nhắc tới các sự kiện có trong dữ liệu ứng viên; nếu dữ liệu mỏng thì nói rõ là mỏng.',
  'CHỈ trả về DUY NHẤT một đối tượng JSON hợp lệ, không kèm giải thích, không bọc markdown,',
  'theo đúng lược đồ:',
  '{"summary": string, "ranking": [{"index": number, "reason": string}]}',
  'Quy ước: index là số thứ tự [n] của ứng viên trong danh sách đã cho; chỉ dùng index có thật;',
  'mỗi index xuất hiện tối đa 1 lần; có thể bỏ qua ứng viên bạn thấy không phù hợp.',
].join(' ');

/**
 * Dựng messages cho chế độ "AI xếp hạng": danh sách ứng viên đã được tính điểm sẵn và
 * model chỉ được chọn/giải thích, KHÔNG sinh toạ độ.
 */
export function buildRankingMessages(
  context: AiPlacementContext,
  candidates: readonly PlacementCandidate[]
): VectorAiChatMessage[] {
  const { equipment, placed, viewport, areaRadiusKm, siteProfileText } = context;

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

  const candidateLines =
    candidates.length === 0
      ? '(không có ứng viên)'
      : candidates
          .map(
            (candidate, index) =>
              `[${index}] ${round6(candidate.latitude)}, ${round6(candidate.longitude)} | điểm hệ thống ${Math.round(
                candidate.score * 100
              )}% | ${candidate.reason}`
          )
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
    ...(siteProfileText ? ['ĐẶC TÍNH ĐỊA HÌNH VÙNG PHỦ (dữ liệu thật từ terrain + OSM):', siteProfileText, ''] : []),
    'DANH SÁCH ỨNG VIÊN (toạ độ + điểm + căn cứ đã tính sẵn):',
    candidateLines,
    '',
    'Hãy xếp hạng lại các ứng viên kèm lý do ngắn gọn. Trả về đúng JSON theo lược đồ đã nêu.',
  ].join('\n');

  return [
    { role: 'system', content: RANKING_SYSTEM_PROMPT },
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

/**
 * Chuẩn hoá chỉ số gợi ý nhận từ nguồn ngoài (bấm marker trên bản đồ, dữ liệu cũ...).
 * Trả về `null` nếu không phải số nguyên nằm trong [0, count) — nhờ vậy index lỗi
 * không bao giờ trỏ sai vào gợi ý khác.
 */
export function resolveAdvisorSuggestionIndex(raw: unknown, count: number): number | null {
  if (!Number.isInteger(count) || count <= 0) return null;
  // VÌ SAO PHẢI KIỂM TRA CHUỖI RỖNG TRƯỚC KHI `Number()`:
  // `Number('')` = 0 và `Number('  ')` = 0, tức là chuỗi rỗng sẽ lọt qua như một
  // index hợp lệ và chọn nhầm gợi ý đầu tiên. Cùng lý do, `Number('1.0')` = 1
  // vẫn đúng nên không cần chặn; chỉ chặn giá trị không đại diện cho số nào.
  if (typeof raw === 'string' && raw.trim().length === 0) return null;

  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 0 || value >= count) return null;
  return value;
}

/**
 * Parse AN TOÀN câu trả lời xếp hạng của model:
 * - Trích khối JSON đầu tiên (chịu được markdown/giải thích bao quanh).
 * - Chỉ nhận `index` là số nguyên nằm trong [0, candidateCount).
 * - Loại index trùng; BỎ QUA index ngoài biên thay vì ném lỗi (model có thể lệch).
 * - Chấp nhận mảng rỗng (model không chọn ứng viên nào -> store giữ nguyên thứ hạng động cơ).
 */
export function parsePlacementRanking(
  rawText: string,
  candidateCount: number
): AdvisorRankingParseResult {
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

  const ranking: AiPlacementRankingEntry[] = [];
  const seen = new Set<number>();
  if (Array.isArray(record.ranking)) {
    for (const item of record.ranking) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const index = resolveAdvisorSuggestionIndex(entry.index ?? entry.i, candidateCount);
      if (index === null) continue;
      if (seen.has(index)) continue;
      seen.add(index);

      ranking.push({
        index,
        reason: typeof entry.reason === 'string' ? entry.reason.trim() : '',
      });
    }
  }

  return { ok: true, value: { summary, ranking } };
}
