/**
 * RADAR 3D TERRAIN VISIBILITY ENGINE
 * Phân tích khả năng quan sát / che chắn địa hình (Terrain Masking, Horizon & LOS)
 * Tuân thủ Đặc tả Kỹ thuật Version 1.0 (2026-09-23)
 *
 * Tách biệt 4 lớp:
 * 1. CoverageProfile: Giới hạn hình học lý thuyết
 * 2. TerrainSampler: Adapter truy vấn cao độ địa hình (Cesium hoặc Synthetic)
 * 3. Horizon & LOS Analyzer: Tìm chân trời cực đại và kiểm tra đường ngắm LOS
 * 4. VisibilityResult: Cung cấp nguồn dữ liệu chuẩn cho 3D Volume Mesh, Top-down và Cross-section
 */

import * as Cesium from 'cesium';
import type { CoverageProfile } from '../types/radarCoverage';
import {
  calculateEarthBulgeMeters,
  DEFAULT_K_FACTOR,
  getProfileMaxRange,
} from './radarMath';
import { destinationPoint } from './radarLosEngine';

// ============================================================================
// 1. DATA CONTRACTS (Theo Mục 5 Đặc tả Kỹ thuật)
// ============================================================================

export interface TerrainSample {
  distanceMeters: number;
  elevationMeters: number;
}

export interface TerrainSamplePoint extends TerrainSample {
  longitude: number;
  latitude: number;
}

export interface TerrainProfile {
  azimuthRad: number;
  observerElevationMeters: number;
  samples: TerrainSamplePoint[];
  maxTerrainElevationMeters: number;
  maxTerrainDistanceMeters: number;
}

export const VisibilityState = {
  Visible: 'visible',
  Boundary: 'boundary',
  Occluded: 'occluded',
} as const;

export type VisibilityState = (typeof VisibilityState)[keyof typeof VisibilityState];

export interface VisibilitySample {
  azimuthRad: number;
  elevationRad: number;
  distanceMeters: number;
  state: VisibilityState;
  terrainElevationMeters: number;
  lineElevationMeters: number;
  clearanceMeters: number;
}

export interface HorizonPoint {
  azimuthRad: number;
  distanceMeters: number;
  terrainElevationMeters: number;
  elevationAngleRad: number;
}

export interface VisibilityResult {
  observer: {
    longitude: number;
    latitude: number;
    heightMeters: number;
  };
  horizon: HorizonPoint[];
  samples: VisibilitySample[];
  visibleVertices: Float64Array | number[];
  occludedVertices: Float64Array | number[];
  metadata: {
    azimuthSamples: number;
    elevationSamples: number;
    terrainSampleSpacingMeters: number;
    analysisDistanceMeters: number;
    calculationTimeMs: number;
    cacheHit?: boolean;
  };
}

export interface ObserverDefinition {
  longitude: number;
  latitude: number;
  heightMeters: number; // ASL + AGL
}

export interface TerrainDefinition {
  source: string;
  sampler?: TerrainSampler;
  provider?: Cesium.TerrainProvider | null;
}

export interface VisibilityAnalysisConfig {
  azimuthSamples: number;
  elevationSamples: number;
  terrainSampleSpacingMeters: number;
  analysisDistanceMeters: number;
  refineBoundary?: boolean;
  useEarthCurvature?: boolean;
  kFactor?: number;
}

export interface VisibilityAnalysisRequest {
  observer: ObserverDefinition;
  coverageProfile: CoverageProfile;
  terrain: TerrainDefinition;
  config: VisibilityAnalysisConfig;
}

// ============================================================================
// 2. TERRAIN SAMPLER ADAPTER (Theo Mục 8 Đặc tả Kỹ thuật)
// ============================================================================

export interface TerrainSampler {
  sampleHeights(positions: Cesium.Cartographic[]): Promise<(number | undefined)[]>;
}

/**
 * Adapter lấy mẫu từ Cesium TerrainProvider có phân tầng zoom và bộ đệm cache
 */
export class CesiumTerrainSampler implements TerrainSampler {
  private provider: Cesium.TerrainProvider | null;
  private cache = new Map<string, number>();
  private readonly maxRangeKm: number;

  constructor(provider: Cesium.TerrainProvider | null, maxRangeKm: number = 100) {
    this.provider = provider;
    this.maxRangeKm = maxRangeKm;
  }

  public async sampleHeights(positions: Cesium.Cartographic[]): Promise<(number | undefined)[]> {
    if (!this.provider) {
      return positions.map(() => 0);
    }

    const results: (number | undefined)[] = new Array(positions.length);
    const unhitPositions: Cesium.Cartographic[] = [];
    const unhitIndices: number[] = [];

    // 1. Kiểm tra Cache theo tọa độ làm tròn đến 4 chữ số thập phân (~11m)
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const key = `${p.longitude.toFixed(5)}_${p.latitude.toFixed(5)}`;
      if (this.cache.has(key)) {
        results[i] = this.cache.get(key);
      } else {
        unhitPositions.push(p);
        unhitIndices.push(i);
      }
    }

    if (unhitPositions.length === 0) {
      return results;
    }

    // 2. Lấy mẫu từ Cesium theo lô để không nghẽn luồng GPU / Network
    const targetLevel = this.maxRangeKm <= 60 ? 11 : this.maxRangeKm <= 160 ? 10 : 9;
    const batchSize = 350;

    for (let b = 0; b < unhitPositions.length; b += batchSize) {
      const chunk = unhitPositions.slice(b, b + batchSize);
      try {
        await Cesium.sampleTerrain(this.provider, targetLevel, chunk, false);
      } catch {
        try {
          await Cesium.sampleTerrain(this.provider, Math.max(8, targetLevel - 1), chunk, false);
        } catch {
          // Bỏ qua lỗi cục bộ nếu thiếu tile
        }
      }

      for (let j = 0; j < chunk.length; j++) {
        const origIdx = unhitIndices[b + j];
        const h = chunk[j].height;
        const validH = h !== undefined && !isNaN(h) && isFinite(h) ? Math.max(0, h) : 0;
        results[origIdx] = validH;

        const p = chunk[j];
        const key = `${p.longitude.toFixed(5)}_${p.latitude.toFixed(5)}`;
        this.cache.set(key, validH);
      }

      if (b + batchSize < unhitPositions.length) {
        await new Promise((resolve) => setTimeout(resolve, 6));
      }
    }

    return results;
  }
}

/**
 * Adapter địa hình giả lập độc lập (Synthetic Terrain) phục vụ Unit Test & Debug
 * (Theo Mục 20 & 21 Đặc tả Kỹ thuật)
 */
export interface SyntheticObstacle {
  distanceMeters: number;
  azimuthDeg: number;
  peakElevationMeters: number;
  radiusMeters: number;
}

export class SyntheticTerrainSampler implements TerrainSampler {
  private baseElevationMeters: number;
  private obstacles: SyntheticObstacle[] = [];
  private observerLat: number;
  private observerLon: number;

  constructor(observerLat: number, observerLon: number, baseElevationMeters: number = 0) {
    this.observerLat = observerLat;
    this.observerLon = observerLon;
    this.baseElevationMeters = baseElevationMeters;
  }

  public addObstacle(obstacle: SyntheticObstacle): this {
    this.obstacles.push(obstacle);
    return this;
  }

  public async sampleHeights(positions: Cesium.Cartographic[]): Promise<(number | undefined)[]> {
    const results: number[] = [];

    for (const p of positions) {
      const latDeg = (p.latitude * 180) / Math.PI;
      const lonDeg = (p.longitude * 180) / Math.PI;

      // Tính khoảng cách và góc phương vị từ observer đến vị trí này
      const dLat = ((latDeg - this.observerLat) * Math.PI) / 180;
      const dLon = ((lonDeg - this.observerLon) * Math.PI) / 180;
      const meanLat = ((latDeg + this.observerLat) * Math.PI) / 360;

      // Khoảng cách cục bộ x (Đông), y (Bắc)
      const xM = dLon * 6371000 * Math.cos(meanLat);
      const yM = dLat * 6371000;

      let elevation = this.baseElevationMeters;

      // Kiểm tra sự chồng lấn của các chướng ngại vật hình nón/Gaussian
      for (const obs of this.obstacles) {
        const obsAzRad = (obs.azimuthDeg * Math.PI) / 180;
        const obsXM = obs.distanceMeters * Math.sin(obsAzRad);
        const obsYM = obs.distanceMeters * Math.cos(obsAzRad);

        const distToObstacleCenter = Math.hypot(xM - obsXM, yM - obsYM);
        if (distToObstacleCenter < obs.radiusMeters) {
          // Dáng núi hình Cosine Bell êm dịu
          const factor = (1 + Math.cos((Math.PI * distToObstacleCenter) / obs.radiusMeters)) / 2;
          const mountainH = obs.peakElevationMeters * factor;
          elevation = Math.max(elevation, this.baseElevationMeters + mountainH);
        }
      }

      results.push(Math.round(elevation));
    }

    return results;
  }
}

// ============================================================================
// 3. HORIZON & LOS ANALYZER (Theo Mục 11, 12, 13 Đặc tả Kỹ thuật)
// ============================================================================

export class HorizonAnalyzer {
  /**
   * Phân tích profile địa hình dọc theo một hướng để tìm các điểm Horizon và góc che khuất tích lũy
   */
  public static analyzeHorizonProfile(
    profile: TerrainProfile,
    useEarthCurvature: boolean = false,
    kFactor: number = DEFAULT_K_FACTOR
  ): {
    horizonPoints: HorizonPoint[];
    maxHorizonAngleRad: number;
    highestHorizonSample: TerrainSamplePoint | null;
  } {
    const horizonPoints: HorizonPoint[] = [];
    let maxHorizonAngleRad = -Infinity;
    let highestHorizonSample: TerrainSamplePoint | null = null;

    const H0 = profile.observerElevationMeters;

    for (const sample of profile.samples) {
      if (sample.distanceMeters <= 0) continue;

      const d = sample.distanceMeters;
      const hz = useEarthCurvature ? calculateEarthBulgeMeters(d, kFactor) : 0;
      // Góc tà của địa hình tới observer: theta_terrain = atan2((Ht + hz) - H0, d)
      const thetaTerrain = Math.atan2(sample.elevationMeters - H0 + hz, d);

      if (thetaTerrain > maxHorizonAngleRad) {
        maxHorizonAngleRad = thetaTerrain;
        highestHorizonSample = sample;
        horizonPoints.push({
          azimuthRad: profile.azimuthRad,
          distanceMeters: d,
          terrainElevationMeters: sample.elevationMeters,
          elevationAngleRad: thetaTerrain,
        });
      }
    }

    return {
      horizonPoints,
      maxHorizonAngleRad,
      highestHorizonSample,
    };
  }

  /**
   * Kiểm tra Line-of-Sight (LOS) tới một điểm mục tiêu (hoặc sample vòm)
   * Phân loại: Visible / Boundary / Occluded và tính clearance
   */
  public static testTargetLOS(
    observerElevationMeters: number,
    targetDistanceMeters: number,
    targetElevationMeters: number,
    maxHorizonAngleRad: number,
    useEarthCurvature: boolean = false,
    kFactor: number = DEFAULT_K_FACTOR,
    boundaryToleranceRad: number = 0.003 // ~0.17 độ
  ): {
    state: VisibilityState;
    targetAngleRad: number;
    lineElevationMeters: number;
    clearanceMeters: number;
  } {
    const H0 = observerElevationMeters;
    const D = targetDistanceMeters;
    const hz = useEarthCurvature ? calculateEarthBulgeMeters(D, kFactor) : 0;

    const targetAngleRad = Math.atan2(targetElevationMeters - H0 + hz, D);
    const lineElevationMeters = H0 + D * Math.tan(targetAngleRad) - hz;

    // So sánh góc nhìn tới mục tiêu với góc chân trời cực đại của địa hình phía trước
    const angleDiff = targetAngleRad - maxHorizonAngleRad;

    let state: VisibilityState;
    if (angleDiff < -boundaryToleranceRad) {
      state = VisibilityState.Occluded;
    } else if (Math.abs(angleDiff) <= boundaryToleranceRad) {
      state = VisibilityState.Boundary;
    } else {
      state = VisibilityState.Visible;
    }

    const clearanceMeters = targetElevationMeters - (H0 + D * Math.tan(maxHorizonAngleRad) - hz);

    return {
      state,
      targetAngleRad,
      lineElevationMeters,
      clearanceMeters,
    };
  }
}

// ============================================================================
// 4. RADAR VISIBILITY ENGINE & CACHE (Theo Mục 23, 24, 41 Đặc tả Kỹ thuật)
// ============================================================================

export class RadarVisibilityEngine {
  private cache = new Map<string, VisibilityResult>();

  public generateCacheKey(request: VisibilityAnalysisRequest): string {
    const { observer, coverageProfile, terrain, config } = request;
    const pts = coverageProfile.points.map((p) => `${p.elevationDeg}:${p.maxRangeKm}`).join(',');
    return `${observer.longitude.toFixed(5)}_${observer.latitude.toFixed(5)}_${observer.heightMeters}_` +
      `${coverageProfile.id}_${pts}_${terrain.source}_${config.azimuthSamples}_${config.elevationSamples}_` +
      `${config.terrainSampleSpacingMeters}_${config.analysisDistanceMeters}_${config.useEarthCurvature ? 1 : 0}`;
  }

  public invalidate(keyPrefix?: string): void {
    if (!keyPrefix) {
      this.cache.clear();
      return;
    }
    for (const k of this.cache.keys()) {
      if (k.startsWith(keyPrefix)) {
        this.cache.delete(k);
      }
    }
  }

  public async analyze(request: VisibilityAnalysisRequest): Promise<VisibilityResult> {
    const startTime = performance.now();
    const cacheKey = this.generateCacheKey(request);

    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      return {
        ...cached,
        metadata: {
          ...cached.metadata,
          cacheHit: true,
        },
      };
    }

    const { observer, coverageProfile, terrain, config } = request;
    const {
      azimuthSamples = 72,
      elevationSamples = 20,
      terrainSampleSpacingMeters = 2000,
      analysisDistanceMeters = 100000,
      useEarthCurvature = false,
      kFactor = DEFAULT_K_FACTOR,
    } = config;

    // 1. Khởi tạo sampler
    const sampler: TerrainSampler =
      terrain.sampler ?? new CesiumTerrainSampler(terrain.provider ?? null, analysisDistanceMeters / 1000);

    // 2. Sinh lưới lấy mẫu địa hình
    const azimuthStepDeg = 360 / azimuthSamples;
    const azimuthsDeg: number[] = [];
    for (let i = 0; i < azimuthSamples; i++) {
      azimuthsDeg.push(i * azimuthStepDeg);
    }

    const sampleDistances: number[] = [];
    const minSpacing = Math.max(500, terrainSampleSpacingMeters);
    for (let d = minSpacing; d <= analysisDistanceMeters; d += terrainSampleSpacingMeters) {
      sampleDistances.push(d);
    }
    if (sampleDistances.length === 0 || sampleDistances[sampleDistances.length - 1] < analysisDistanceMeters) {
      sampleDistances.push(analysisDistanceMeters);
    }

    // 3. Lấy mẫu tọa độ
    const cartographics: Cesium.Cartographic[] = [];
    const indexMeta: { azIndex: number; dist: number; lat: number; lon: number }[] = [];

    azimuthsDeg.forEach((azDeg, azIndex) => {
      sampleDistances.forEach((dist) => {
        const dest = destinationPoint(observer.latitude, observer.longitude, dist, azDeg);
        cartographics.push(Cesium.Cartographic.fromDegrees(dest.lon, dest.lat));
        indexMeta.push({ azIndex, dist, lat: dest.lat, lon: dest.lon });
      });
    });

    const heights = await sampler.sampleHeights(cartographics);

    // 4. Xây dựng Profile địa hình theo từng phương vị
    const profiles: TerrainProfile[] = azimuthsDeg.map((azDeg) => ({
      azimuthRad: (azDeg * Math.PI) / 180,
      observerElevationMeters: observer.heightMeters,
      samples: [],
      maxTerrainElevationMeters: -Infinity,
      maxTerrainDistanceMeters: analysisDistanceMeters,
    }));

    for (let i = 0; i < heights.length; i++) {
      const meta = indexMeta[i];
      const h = heights[i] ?? 0;
      const prof = profiles[meta.azIndex];
      prof.samples.push({
        distanceMeters: meta.dist,
        elevationMeters: h,
        latitude: meta.lat,
        longitude: meta.lon,
      });
      if (h > prof.maxTerrainElevationMeters) {
        prof.maxTerrainElevationMeters = h;
      }
    }

    // 5. Phân tích Horizon cho từng phương vị
    const allHorizons: HorizonPoint[] = [];
    const maxHorizonByAz: number[] = [];

    for (let i = 0; i < profiles.length; i++) {
      const prof = profiles[i];
      const analysis = HorizonAnalyzer.analyzeHorizonProfile(prof, useEarthCurvature, kFactor);
      maxHorizonByAz.push(analysis.maxHorizonAngleRad);
      if (analysis.highestHorizonSample) {
        allHorizons.push({
          azimuthRad: prof.azimuthRad,
          distanceMeters: analysis.highestHorizonSample.distanceMeters,
          terrainElevationMeters: analysis.highestHorizonSample.elevationMeters,
          elevationAngleRad: analysis.maxHorizonAngleRad,
        });
      }
    }

    // 6. Phân tích Visibility trên lưới (Azimuth x Elevation)
    const minElev = coverageProfile.minElevationDeg;
    const maxElev = coverageProfile.maxElevationDeg;
    const elevSpan = maxElev - minElev;
    const elevStep = elevSpan / Math.max(1, elevationSamples - 1);

    const visibilitySamples: VisibilitySample[] = [];
    const visibleVerts: number[] = [];
    const occludedVerts: number[] = [];

    for (let azIdx = 0; azIdx < azimuthSamples; azIdx++) {
      const azDeg = azimuthsDeg[azIdx];
      const azRad = (azDeg * Math.PI) / 180;
      const maxHorizonRad = maxHorizonByAz[azIdx];

      for (let elIdx = 0; elIdx < elevationSamples; elIdx++) {
        const elDeg = minElev + elIdx * elevStep;
        const elRad = (elDeg * Math.PI) / 180;

        // Cự ly lý thuyết tại góc tà này từ CoverageProfile
        const maxProfileKm = Math.max(0, ...coverageProfile.points.map((p) => p.maxRangeKm));
        const theoreticalRangeKm = getProfileMaxRange(
          coverageProfile,
          elDeg,
          maxProfileKm > 0 ? maxProfileKm : analysisDistanceMeters / 1000
        );
        const maxRangeKm = Math.min(analysisDistanceMeters / 1000, theoreticalRangeKm);
        const maxRangeM = maxRangeKm * 1000;

        // Độ cao mục tiêu hình học tại cự ly maxRangeM
        const hz = useEarthCurvature ? calculateEarthBulgeMeters(maxRangeM, kFactor) : 0;
        const targetAltM = observer.heightMeters + maxRangeM * Math.tan(elRad) - hz;

        const los = HorizonAnalyzer.testTargetLOS(
          observer.heightMeters,
          maxRangeM,
          targetAltM,
          maxHorizonRad,
          useEarthCurvature,
          kFactor
        );

        visibilitySamples.push({
          azimuthRad: azRad,
          elevationRad: elRad,
          distanceMeters: maxRangeM,
          state: los.state,
          terrainElevationMeters: targetAltM - los.clearanceMeters,
          lineElevationMeters: los.lineElevationMeters,
          clearanceMeters: los.clearanceMeters,
        });

        // Chuyển sang toạ độ ENU cục bộ để render
        const cosEl = Math.cos(elRad);
        const sinEl = Math.sin(elRad);
        const x = maxRangeM * Math.sin(azRad) * cosEl;
        const y = maxRangeM * Math.cos(azRad) * cosEl;
        const z = maxRangeM * sinEl;

        if (los.state === VisibilityState.Visible || los.state === VisibilityState.Boundary) {
          visibleVerts.push(x, y, z);
        } else {
          occludedVerts.push(x, y, z);
        }
      }
    }

    const calcTime = performance.now() - startTime;
    const result: VisibilityResult = {
      observer,
      horizon: allHorizons,
      samples: visibilitySamples,
      visibleVertices: new Float64Array(visibleVerts),
      occludedVertices: new Float64Array(occludedVerts),
      metadata: {
        azimuthSamples,
        elevationSamples,
        terrainSampleSpacingMeters,
        analysisDistanceMeters,
        calculationTimeMs: Math.round(calcTime),
        cacheHit: false,
      },
    };

    this.cache.set(cacheKey, result);
    return result;
  }
}

// Instance singleton dùng chung
export const globalRadarVisibilityEngine = new RadarVisibilityEngine();
