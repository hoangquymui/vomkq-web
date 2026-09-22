/**
 * VẬT LIỆU VÒM RADAR — port fragment shader `Defense/RadarDome.shader` của dự án Unity VomKQ_test.
 *
 * Được port nguyên trạng sang vpk từ `vomkq-web/src/utils/radarDomeMaterial.ts`
 * (spec: vomkq-web/docs/dome-video-match/README.md mục 3 & 5).
 *
 * Nguồn tham chiếu (chỉ đọc, KHÔNG sửa):
 *   Assets/Shaders/RadarDome.shader
 *
 * Shader gốc (Unity, HLSL):
 *   float3 n = normalize(i.worldPos - _RadarOrigin);      // normal GIẢ = hướng xuyên tâm
 *   float3 viewDir = normalize(_WorldSpaceCameraPos - i.worldPos);
 *   float facing = saturate(abs(dot(n, viewDir)));
 *   float rim = pow(1.0 - facing, _RimPower);
 *   float scanPhase = frac(i.worldPos.y * 0.002 * _ScanLineCount - _Time.y * _ScanLineSpeed);
 *   float scanLine = smoothstep(0.0, 0.05, scanPhase) * smoothstep(1.0, 0.95, scanPhase);
 *   col.rgb = lerp(col.rgb, _RimColor.rgb, saturate(rim * 0.9));
 *   col.rgb += _RimColor.rgb * (scanLine * 0.08);
 *   col.a   = saturate(max(_Color.a, 0.14) + rim * 0.42 + scanLine * 0.08);
 *
 * Ánh xạ sang Cesium (MaterialAppearance + TexturedMaterialAppearanceFS):
 *   - `i.worldPos - _RadarOrigin`      -> attribute `normal` của geometry (đã là hướng xuyên tâm
 *                                          đơn vị) -> `materialInput.normalEC`
 *   - `_WorldSpaceCameraPos - i.worldPos` -> `materialInput.positionToEyeEC`
 *   - `i.worldPos.y` (độ cao tuyệt đối trong world-space Unity) -> `materialInput.st.t`
 *     (heightFraction 0..1 của vòm). Xem ghi chú "KHÁC UNITY" trong docs/DEBUG_NOTES.md.
 *   - `_Time.y` -> uniform `u_time`, được cập nhật theo thời gian thực mỗi frame.
 *
 * LƯU Ý về smoothstep: GLSL ES quy định kết quả là UNDEFINED khi edge0 >= edge1, nên
 * `smoothstep(1.0, 0.95, x)` của HLSL được viết lại tương đương số học thành
 * `1.0 - smoothstep(0.95, 1.0, x)`.
 */
import * as Cesium from 'cesium';

/** Tên loại material đăng ký trong Material._materialCache */
export const RADAR_DOME_MATERIAL_TYPE = 'VomKQRadarDome';

/** Giá trị mặc định đúng theo Properties{} của Defense/RadarDome.shader */
export const RADAR_DOME_SHADER_DEFAULTS = {
  /** _RimColor = (1, 0.95, 0.2, 1) ~ #fff232 */
  rimColorHex: '#fff232',
  /** _RimPower = 2.0 */
  rimPower: 2.0,
  /** _ScanLineCount = 14 */
  scanLineCount: 14,
  /** _ScanLineSpeed = 0.6 */
  scanLineSpeed: 0.6,
} as const;

/** Đăng ký material type 1 lần duy nhất (tránh tạo shader trùng lặp cho nhiều radar) */
let materialTypeRegistered = false;

/**
 * `Material._materialCache` là API nội bộ của Cesium và KHÔNG được khai trong Cesium.d.ts
 * (bản 1.145 chưa có `Material.DefaultCache` công khai). Đây là cách duy nhất để đăng ký
 * thêm fabric type ngoài các built-in, giống hệt cách Cesium tự đăng ký `Material.ColorType`...
 * Nếu Cesium đổi API, chỉ cần sửa DUY NHẤT chỗ này.
 */
interface CesiumMaterialCache {
  addMaterial: (type: string, materialTemplate: unknown) => void;
  getMaterial: (type: string) => unknown;
}

function getMaterialCache(): CesiumMaterialCache {
  return (Cesium.Material as unknown as { _materialCache: CesiumMaterialCache })
    ._materialCache;
}

export function ensureRadarDomeMaterialType(): void {
  if (materialTypeRegistered) return;

  getMaterialCache().addMaterial(RADAR_DOME_MATERIAL_TYPE, {
    fabric: {
      type: RADAR_DOME_MATERIAL_TYPE,
      uniforms: {
        u_baseColor: Cesium.Color.fromCssColorString('#ffd900').withAlpha(0.3),
        u_rimColor: Cesium.Color.fromCssColorString(RADAR_DOME_SHADER_DEFAULTS.rimColorHex),
        u_rimPower: RADAR_DOME_SHADER_DEFAULTS.rimPower,
        u_scanLineCount: RADAR_DOME_SHADER_DEFAULTS.scanLineCount,
        u_scanLineSpeed: RADAR_DOME_SHADER_DEFAULTS.scanLineSpeed,
        u_time: 0.0,
      },
      source: `
        czm_material czm_getMaterial(czm_materialInput materialInput)
        {
            czm_material material = czm_getDefaultMaterial(materialInput);

            // Normal GIẢ: attribute normal đã được dựng sẵn bằng hướng xuyên tâm
            // từ tâm radar ra đỉnh (xem radarDomeGeometry.ts) nên ở đây chỉ cần chuẩn hoá.
            vec3 n = normalize(materialInput.normalEC);
            vec3 v = normalize(materialInput.positionToEyeEC);

            float facing = clamp(abs(dot(n, v)), 0.0, 1.0);
            float rim = pow(1.0 - facing, u_rimPower);

            // v = heightFraction của vòm (0 ở chân đế, 1 ở đỉnh)
            float phase = fract(materialInput.st.t * u_scanLineCount - u_time * u_scanLineSpeed);
            float scanLine = smoothstep(0.0, 0.05, phase) * (1.0 - smoothstep(0.95, 1.0, phase));

            vec3 rgb = mix(u_baseColor.rgb, u_rimColor.rgb, clamp(rim * 0.9, 0.0, 1.0));
            rgb += u_rimColor.rgb * (scanLine * 0.08);

            float alpha = clamp(max(u_baseColor.a, 0.14) + rim * 0.42 + scanLine * 0.08, 0.0, 1.0);

            material.diffuse = rgb;
            material.alpha = alpha;
            material.specular = 0.0;
            material.shininess = 1.0;

            return material;
        }
      `,
    },
    // Vòm luôn là vật liệu trong suốt (alpha do shader tính động) -> Primitive phải xếp vào
    // đường render trong suốt, nếu không Cesium coi là opaque và bỏ qua blending.
    translucent: function () {
      return true;
    },
  });

  materialTypeRegistered = true;
}

export interface RadarDomeMaterialParams {
  /** Màu nền vòm (đã gồm alpha = domeAlpha) — tương ứng _Color của Unity */
  baseColor: Cesium.Color;
  /** Màu viền sáng — tương ứng _RimColor */
  rimColor: Cesium.Color;
  /** Độ gắt viền sáng — tương ứng _RimPower */
  rimPower: number;
  /** Số đường quét ngang — tương ứng _ScanLineCount */
  scanLineCount: number;
  /** Tốc độ đường quét — tương ứng _ScanLineSpeed (0 = đứng yên) */
  scanLineSpeed: number;
}

/**
 * Danh sách material đang sống. Uniform `u_time` không phải uniform tự động của Cesium,
 * và giá trị uniform chỉ được đọc lại tại thời điểm bind (ShaderProgram._setUniforms gọi
 * `uniformMap[name]()` mỗi draw) nên chỉ cần gán lại `material.uniforms.u_time` mỗi frame.
 * Xem radarDomeMaterial time ticker bên dưới + listener scene.preRender trong CesiumGlobe.
 */
const liveMaterials = new Set<Cesium.Material>();

/** Tạo material cho 1 vòm radar (dùng chung shader đã đăng ký, chỉ khác uniform) */
export function createRadarDomeMaterial(
  params: RadarDomeMaterialParams
): Cesium.Material {
  ensureRadarDomeMaterialType();

  const material = Cesium.Material.fromType(RADAR_DOME_MATERIAL_TYPE, {
    u_baseColor: params.baseColor,
    u_rimColor: params.rimColor,
    u_rimPower: params.rimPower,
    u_scanLineCount: params.scanLineCount,
    u_scanLineSpeed: params.scanLineSpeed,
    u_time: 0.0,
  });

  liveMaterials.add(material);
  return material;
}

/** Giải phóng material khỏi danh sách tick + giải phóng texture nội bộ (nếu có) */
export function releaseRadarDomeMaterial(material: Cesium.Material): void {
  liveMaterials.delete(material);
  material.destroy();
}

/**
 * Cập nhật `u_time` cho toàn bộ material vòm đang sống.
 * Gọi từ listener `scene.preRender` trong CesiumGlobe -> dải quét trôi theo thời gian thực.
 */
export function updateRadarDomeMaterials(elapsedSeconds: number): void {
  if (liveMaterials.size === 0) return;
  for (const material of liveMaterials) {
    material.uniforms.u_time = elapsedSeconds;
  }
}

/**
 * Màu vòm hiệu dụng: domeColorOverride -> domeColor của template -> màu khí tài.
 * (Unity dùng EquipmentTemplate.symbolColor; web có thêm lớp override trong Inspector.)
 */
export function resolveDomeColorHex(
  instanceColor: string,
  templateDomeColor?: string,
  overrideColor?: string | null
): string {
  if (overrideColor) return overrideColor;
  if (templateDomeColor) return templateDomeColor;
  return instanceColor;
}
