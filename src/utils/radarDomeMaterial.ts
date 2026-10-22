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
import type { RadarCoverageVolume } from '../types/radarVolume';
import { buildRadarTerrainMaskData, createRadarTerrainMaskCanvas } from './radarTerrainMask';
import type { RadarTerrainMaskData } from './radarTerrainMask';

const terrainMaskImages = new WeakMap<RadarCoverageVolume, { data: RadarTerrainMaskData; image: HTMLCanvasElement }>();
const terrainMaterialFrames = new WeakMap<Cesium.Material, Cesium.Matrix4>();

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
        u_terrainMask: Cesium.Material.DefaultImageId,
        u_maskMode: 0.0,
        u_maskSize: new Cesium.Cartesian2(1, 1),
        u_maskAzimuthCount: 1.0,
        u_maskRadialStepM: 250.0,
        u_maskHeightOffsetM: -1024.0,
        u_maskHeightScaleM: 1.0,
        u_eyeToRadar: Cesium.Matrix4.toArray(Cesium.Matrix4.IDENTITY),
        u_radarToWorld: Cesium.Matrix4.toArray(Cesium.Matrix4.IDENTITY),
        u_radarCartographic: new Cesium.Cartesian2(0, 0),
        u_verticalExaggeration: 1.0,
        u_exaggerationRelativeHeight: 0.0,
      },
      source: `
        float radarMaskHeight(float radialIndex, float azimuthIndex, float rowOffset)
        {
            float row = mod(azimuthIndex, u_maskAzimuthCount) + rowOffset;
            // Canvas rows start at the top; Cesium uploads canvas textures with flipY.
            vec2 uv = vec2((radialIndex + 0.5) / u_maskSize.x,
                           1.0 - (row + 0.5) / u_maskSize.y);
            vec2 bytes = floor(texture(u_terrainMask, uv).rg * 255.0 + 0.5);
            return u_maskHeightOffsetM + (bytes.x * 256.0 + bytes.y) * u_maskHeightScaleM;
        }

        float radarConservativeMaskHeight(float radialIndex, float azimuthIndex, float rowOffset)
        {
            float r0 = floor(radialIndex);
            float r1 = min(r0 + 1.0, u_maskSize.x - 1.0);
            float a0 = floor(azimuthIndex);
            float a1 = a0 + 1.0;
            return max(max(radarMaskHeight(r0, a0, rowOffset), radarMaskHeight(r1, a0, rowOffset)),
                       max(radarMaskHeight(r0, a1, rowOffset), radarMaskHeight(r1, a1, rowOffset)));
        }

        void radarClipTerrain(czm_materialInput materialInput)
        {
            if (u_maskMode < 0.5) return;
            // Work near the radar before reconstructing WGS84, keeping camera motion stable.
            vec3 local = (u_eyeToRadar * vec4(-materialInput.positionToEyeEC, 1.0)).xyz;
            vec3 world = (u_radarToWorld * vec4(local, 1.0)).xyz;
            float p = length(world.xy);
            float theta = atan(world.z * 6378137.0, p * 6356752.314245);
            float s = sin(theta);
            float c = cos(theta);
            float lat = atan(world.z + 0.006739496742276434 * 6356752.314245 * s * s * s,
                             p - 0.0066943799901413165 * 6378137.0 * c * c * c);
            float lon = atan(world.y, world.x);
            float sinLat = sin(lat);
            float n = 6378137.0 / sqrt(1.0 - 0.0066943799901413165 * sinLat * sinLat);
            float displayHeight = abs(cos(lat)) > 0.001 ? p / cos(lat) - n
                : abs(world.z) / abs(sinLat) - n * (1.0 - 0.0066943799901413165);
            float height = u_exaggerationRelativeHeight
                + (displayHeight - u_exaggerationRelativeHeight) / max(u_verticalExaggeration, 0.001);

            float deltaLon = lon - u_radarCartographic.x;
            float deltaLat = lat - u_radarCartographic.y;
            float halfLat = sin(deltaLat * 0.5);
            float halfLon = sin(deltaLon * 0.5);
            float hav = clamp(halfLat * halfLat + cos(lat) * cos(u_radarCartographic.y) * halfLon * halfLon, 0.0, 1.0);
            float range = 12742000.0 * atan(sqrt(hav), sqrt(max(0.0, 1.0 - hav)));
            float bearing = atan(sin(deltaLon) * cos(lat),
                cos(u_radarCartographic.y) * sin(lat) - sin(u_radarCartographic.y) * cos(lat) * cos(deltaLon));
            float azimuthIndex = mod(bearing / czm_twoPi + 1.0, 1.0) * u_maskAzimuthCount;
            float radialIndex = clamp(range / u_maskRadialStepM, 0.0, u_maskSize.x - 1.0);
            float groundHeight = radarConservativeMaskHeight(radialIndex, azimuthIndex, u_maskAzimuthCount);
            if (height < groundHeight + 2.0) discard;
            float visibleHeight = radarConservativeMaskHeight(radialIndex, azimuthIndex, 0.0);
            if (u_maskMode < 1.5 && height + 1.0 < visibleHeight) discard;
            if (u_maskMode > 1.5 && height >= visibleHeight) discard;
        }

        czm_material czm_getMaterial(czm_materialInput materialInput)
        {
            radarClipTerrain(materialInput);
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
  terrainMask?: RadarDomeTerrainMaskParams;
}

export interface RadarDomeTerrainMaskParams {
  volume: RadarCoverageVolume;
  modelMatrix: Cesium.Matrix4;
  verticalExaggeration: number;
  verticalExaggerationRelativeHeight?: number;
  shadow?: boolean;
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

  const uniforms: Record<string, unknown> = {
    u_baseColor: params.baseColor,
    u_rimColor: params.rimColor,
    u_rimPower: params.rimPower,
    u_scanLineCount: params.scanLineCount,
    u_scanLineSpeed: params.scanLineSpeed,
    u_time: 0.0,
  };
  const terrain = params.terrainMask;
  if (terrain) {
    let mask = terrainMaskImages.get(terrain.volume);
    if (!mask) {
      const data = buildRadarTerrainMaskData(terrain.volume);
      if (data) {
        mask = { data, image: createRadarTerrainMaskCanvas(data) };
        terrainMaskImages.set(terrain.volume, mask);
      }
    }
    if (mask) {
      Object.assign(uniforms, {
        u_terrainMask: mask.image,
        u_maskMode: terrain.shadow ? 2 : 1,
        u_maskSize: new Cesium.Cartesian2(mask.data.width, mask.data.height),
        u_maskAzimuthCount: mask.data.azimuthCount,
        u_maskRadialStepM: mask.data.radialStepM,
        u_maskHeightOffsetM: mask.data.heightOffsetM,
        u_maskHeightScaleM: mask.data.heightScaleM,
        u_radarToWorld: Cesium.Matrix4.toArray(terrain.modelMatrix),
        u_radarCartographic: new Cesium.Cartesian2(
          Cesium.Math.toRadians(terrain.volume.radarLon), Cesium.Math.toRadians(terrain.volume.radarLat)),
        u_verticalExaggeration: terrain.verticalExaggeration,
        u_exaggerationRelativeHeight: terrain.verticalExaggerationRelativeHeight ?? 0,
      });
    }
  }
  const material = new Cesium.Material({
    // Fabric's recursive template merge turns overridden matrix arrays into
    // plain objects. Infer types from the registered defaults first, then set
    // instance values as Material.fromType does.
    fabric: { type: RADAR_DOME_MATERIAL_TYPE },
    minificationFilter: Cesium.TextureMinificationFilter.NEAREST,
    magnificationFilter: Cesium.TextureMagnificationFilter.NEAREST,
  });
  Object.assign(material.uniforms, uniforms);
  if (terrain && Number(material.uniforms.u_maskMode) > 0) {
    terrainMaterialFrames.set(material, Cesium.Matrix4.inverseTransformation(terrain.modelMatrix, new Cesium.Matrix4()));
  }

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
export function updateRadarDomeMaterials(elapsedSeconds: number, inverseViewMatrix?: Cesium.Matrix4): void {
  if (liveMaterials.size === 0) return;
  for (const material of liveMaterials) {
    material.uniforms.u_time = elapsedSeconds;
    const worldToRadar = terrainMaterialFrames.get(material);
    if (worldToRadar && inverseViewMatrix) {
      const eyeToRadar = Cesium.Matrix4.multiply(worldToRadar, inverseViewMatrix, new Cesium.Matrix4());
      Cesium.Matrix4.toArray(eyeToRadar, material.uniforms.u_eyeToRadar);
    }
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

/**
 * Vật liệu riêng cho Khối bóng râm che khuất địa hình (Occluded / Shadow Volume)
 * Bán trong suốt màu cam đỏ (#ef4444) với viền phát quang (#fb7185) để không che khuất địa hình
 */
export function createRadarOccludedMaterial(alpha: number = 0.22, terrainMask?: RadarDomeTerrainMaskParams): Cesium.Material {
  return createRadarDomeMaterial({
    baseColor: Cesium.Color.fromCssColorString('#ef4444').withAlpha(alpha),
    rimColor: Cesium.Color.fromCssColorString('#fb7185'),
    rimPower: 2.2,
    scanLineCount: 0,
    scanLineSpeed: 0,
    terrainMask: terrainMask ? { ...terrainMask, shadow: true } : undefined,
  });
}

