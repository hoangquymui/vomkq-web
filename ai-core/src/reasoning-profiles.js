export const REASONING_MODE_KEY = "vector.ai.reasoning-mode.v2";
export const REASONING_PROFILES = Object.freeze({
  FAST: { id: "FAST", label: "Trả lời nhanh", think: false, context: 8192, output: 2048 },
  NORMAL: { id: "NORMAL", label: "Cân bằng", think: false, context: 8192, output: 4096 },
  DEEP: { id: "DEEP", label: "Suy luận sâu", think: true, context: 16384, output: 8192 },
});
export function normalizeReasoningMode(mode, fallback = "FAST") { return Object.hasOwn(REASONING_PROFILES, mode) ? mode : fallback; }
export function readReasoningMode(storage) {
  const saved = storage.getItem(REASONING_MODE_KEY);
  if (saved) return normalizeReasoningMode(saved);
  const legacy = storage.getItem("vector.ai.reasoning.v1");
  return legacy === "true" ? "DEEP" : "FAST";
}
