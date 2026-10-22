import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { Pin, PinOff, ArrowUp, ArrowDown, Mountain } from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { useAnalysisStore } from '../../store/useAnalysisStore';
import {
  computeRadarCoverageField,
  convertFieldToCoverageResult,
  destinationPoint,
  generateCoverageCacheKey,
} from '../../utils/radarLosEngine';
import {
  buildRadarCoverageFieldEntities,
} from '../../utils/radarGeometryBuilder';
import {
  computeSpxRadarCoverage,
  generateSpxCacheKey,
} from '../../utils/spxCoverageEngine';
import {
  buildSpxCoverageEntities,
  toDmsString,
} from '../../utils/spxGeometryBuilder';
import {
  getAssetCapabilities,
  formatTacticalAssetInfoCard,
  STATUS_COLOR_MAP,
} from '../../utils/assetVisualization';
import {
  buildRadarDomeGeometry,
  createRadarDomeGeometryInstance,
  DOME_FOOTPRINT_SEGMENTS,
} from '../../utils/radarDomeGeometry';
import {
  computeRadarCoverageVolume,
  generateVolumeCacheKey,
} from '../../utils/radarVolumeEngine';
import {
  buildRadarVolumeGeometry,
  buildRadarOccludedVolumeGeometry,
  createRadarVolumeGeometryInstance,
  createRadarOccludedGeometryInstance,
} from '../../utils/radarVolumeGeometry';
import {
  createRadarDomeMaterial,
  createRadarOccludedMaterial,
  releaseRadarDomeMaterial,
  resolveDomeColorHex,
  updateRadarDomeMaterials,
} from '../../utils/radarDomeMaterial';
import {
  computeSamEngagementVolume,
  buildSamLayerGeometry,
  createSamVolumeGeometryInstance,
  getSamVolumeCacheKey,
} from '../../utils/missileVolumeEngine';
import {
  computeSamCoverage,
  generateSamCoverageCacheKey,
} from '../../utils/samCoverageEngine';
import { EQUIPMENT_TEMPLATES, SPYDER_SYSTEM_DEFAULT_CONFIG } from '../../data/equipmentTemplates';
import {
  COMPOSITE_DOME_STYLES,
  checkLauncherLineOfSight,
} from '../../utils/compositeBatteryGeometry';
import { ENABLE_3D_MODELS, type EquipmentInstance } from '../../types/equipment';
import { createEquipmentFromTemplate } from '../../utils/equipmentFactory';
import { setAdvisorViewport } from '../../utils/aiPlacementAdvisor';
import { TerrainComparisonPanel } from '../ui/TerrainComparisonPanel';
import {
  getTacticalBadgeDataUrl,
  registerBadgeImageListener,
} from '../../utils/tacticalBadgeGenerator';
import { getCustomModelUrl } from '../../utils/model3dConverter';
import type { FlatPatch } from '../../utils/terrainFlatnessEngine';
import { getOfflineTerrainProvider } from '../../services/offlineTerrainProvider';
import { setTerrainProvider } from '../../utils/featureAwareness';
import { useTacticalSandboxCesium } from '../../utils/useTacticalSandboxCesium';
import { useTacticalSandboxStore } from '../../store/useTacticalSandboxStore';

/** Tra cứu template theo id để lấy `domeColor` (màu vỏ vòm riêng của từng loại đài) */
const TEMPLATE_BY_ID = new Map(EQUIPMENT_TEMPLATES.map((t) => [t.id, t]));

/**
 * Tạo pseudo-instance cho đài Radar Chỉ Thị (TAR) của Tổ hợp Tên Lửa
 * để dùng chung engine tính toán địa hình 2D/3D (SPx và 3D Coverage Volume)
 */
function getCompositeBatteryTarInstance(inst: EquipmentInstance): EquipmentInstance | null {
  if (
    inst.category !== 'TenLuaPhongKhong' ||
    !inst.compositeBattery ||
    !inst.batteryConfig ||
    !inst.showDome ||
    inst.compositeBattery.showLayers?.tarDome === false
  ) {
    return null;
  }
  const battCfg = inst.batteryConfig;
  const tarRadarId = battCfg.tarRadarId || battCfg.tarRadarTemplateId;
  const tarTmpl = TEMPLATE_BY_ID.get(tarRadarId || '') || EQUIPMENT_TEMPLATES.find((t) => t.id === tarRadarId);
  return {
    ...inst,
    instanceId: `${inst.instanceId}_tar`,
    name: `[TAR] ${battCfg.tarRadarName}`,
    shortId: `${inst.shortId || 'SAM'}-TAR`,
    templateId: tarRadarId || 'radar_96l6e',
    category: 'RadarCanhGioi',
    rangeKm: battCfg.tarRangeKm,
    coverageHeightKm: battCfg.tarHeightKm,
    antennaHeightAGL: inst.compositeBattery?.mastHeightOverrideM ?? inst.antennaHeightAGL ?? tarTmpl?.antennaHeightAGL ?? 15,
    minElevationDeg: tarTmpl?.minElevationDeg ?? 0.5,
    maxElevationDeg: tarTmpl?.maxElevationDeg ?? 55,
    altitudeDetectionTable: tarTmpl?.altitudeDetectionTable,
    coverageProfile: tarTmpl?.coverageProfile,
    showDome: true,
  };
}

/** Tài nguyên GPU của một vòm radar: cần destroy/remove tường minh để không rò rỉ */
interface DomeRenderResource {
  primitive: Cesium.Primitive;
  material: Cesium.Material;
}

// Access token cấu hình từ dự án VomKQ (CesiumIonServer)
Cesium.Ion.defaultAccessToken =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIzYmIyMWFkMS1lYjc5LTQ0NzMtYThlNS1iNTEzMTA1NTY4MjQiLCJpZCI6NDYwODUzLCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3ODUxMjM1ODN9.gyB0vWTm1yJXS2pCkaVqyLdbg1RxFzjReo7jeDEMmQU';

// Bảo vệ Ellipsoid.prototype.geodeticSurfaceNormal trước toạ độ (0,0,0) hoặc NaN khi tilt/pan camera trên địa hình
// Tránh lỗi "DeveloperError: normalized result is not a number" tại tilt3DOnTerrain làm dừng render loop của Cesium
const origGeodeticSurfaceNormal = Cesium.Ellipsoid.prototype.geodeticSurfaceNormal;
Cesium.Ellipsoid.prototype.geodeticSurfaceNormal = function (
  cartesian: Cesium.Cartesian3,
  result?: Cesium.Cartesian3
): Cesium.Cartesian3 {
  if (!cartesian || isNaN(cartesian.x) || isNaN(cartesian.y) || isNaN(cartesian.z)) {
    return Cesium.Cartesian3.clone(Cesium.Cartesian3.UNIT_Z, result);
  }
  const magSq = cartesian.x * cartesian.x + cartesian.y * cartesian.y + cartesian.z * cartesian.z;
  if (magSq < 1e-6) {
    return Cesium.Cartesian3.clone(Cesium.Cartesian3.UNIT_Z, result);
  }
  try {
    return origGeodeticSurfaceNormal.call(this, cartesian, result);
  } catch {
    return Cesium.Cartesian3.clone(Cesium.Cartesian3.UNIT_Z, result);
  }
};

// Helper tạo ImageryProvider linh hoạt cho Basemap
function createImageryProvider(basemap: 'google-terrain' | 'google-hybrid' | 'satellite' | 'offline' | 'topo' | 'dark' | 'osm') {
  switch (basemap) {
    case 'google-terrain':
      // Bản đồ Địa Hình Google Terrain (kèm ranh giới, địa danh & tuyến đường VN, không có POI cửa hàng)
      return new Cesium.UrlTemplateImageryProvider({
        url: 'https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}&hl=vi&gl=VN',
        subdomains: ['0', '1', '2', '3'],
        minimumLevel: 0,
        maximumLevel: 20,
        credit: new Cesium.Credit('© Google Maps (Terrain VN)'),
      });
    case 'google-hybrid':
      // Bản đồ Vệ Tinh Google Hybrid (kèm ranh giới, địa danh & đường sá VN)
      return new Cesium.UrlTemplateImageryProvider({
        url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=vi&gl=VN',
        subdomains: ['0', '1', '2', '3'],
        minimumLevel: 0,
        maximumLevel: 20,
        credit: new Cesium.Credit('© Google Maps (Hybrid VN)'),
      });
    case 'satellite':
      // Ảnh vệ tinh trực tuyến độ nét cao (zoom tới level 19 ~0.3m/pixel)
      return new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
        credit: new Cesium.Credit('© Esri, Maxar, Earthstar Geographics'),
      });
    case 'offline': {
      // Ảnh vệ tinh ngoại tuyến từ public/offline-satellite (hỗ trợ tới level 16)
      const offlineSatelliteProvider = new Cesium.UrlTemplateImageryProvider({
        url: './offline-satellite/{z}/{x}/{y}.jpg',
        minimumLevel: 0,
        maximumLevel: 16,
      });
      offlineSatelliteProvider.errorEvent.addEventListener((error: any) => {
        error.retry = false;
      });
      return offlineSatelliteProvider;
    }
    case 'topo':
      // Chuyển hướng topo an toàn sang Google Terrain (loại bỏ hoàn toàn OpenTopoMap với nhãn sai lệch)
      return new Cesium.UrlTemplateImageryProvider({
        url: 'https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}&hl=vi&gl=VN',
        subdomains: ['0', '1', '2', '3'],
        minimumLevel: 0,
        maximumLevel: 20,
        credit: new Cesium.Credit('© Google Maps (Terrain VN)'),
      });
    case 'dark':
      // Bản đồ tác chiến tối giản Dark Matter
      return new Cesium.UrlTemplateImageryProvider({
        url: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        maximumLevel: 18,
        credit: new Cesium.Credit('© CARTO'),
      });
    case 'osm':
      return new Cesium.OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/',
      });
    default:
      return new Cesium.UrlTemplateImageryProvider({
        url: 'https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}&hl=vi&gl=VN',
        subdomains: ['0', '1', '2', '3'],
        maximumLevel: 20,
      });
  }
}

/**
 * Lấy toạ độ Cartesian an toàn tuyệt đối từ vị trí nhấp chuột trên màn hình,
 * kiểm tra chặt chẽ không bao giờ trả về Cartesian có toạ độ NaN
 * (tương thích hoàn hảo cả SCENE2D, SCENE3D và Depth Testing)
 */
function pickGroundCartesian(viewer: Cesium.Viewer, screenPos: Cesium.Cartesian2): Cesium.Cartesian3 | undefined {
  const isValid = (c: Cesium.Cartesian3 | undefined | null): c is Cesium.Cartesian3 => {
    return Boolean(
      c &&
      typeof c.x === 'number' && typeof c.y === 'number' && typeof c.z === 'number' &&
      !isNaN(c.x) && !isNaN(c.y) && !isNaN(c.z) &&
      isFinite(c.x) && isFinite(c.y) && isFinite(c.z)
    );
  };

  // 1. Thử pickPosition nếu depthTest đang bật
  if (viewer.scene.globe.depthTestAgainstTerrain) {
    const picked = viewer.scene.pickPosition(screenPos);
    if (isValid(picked)) return picked;
  }

  // 2. Thử globe.pick(ray)
  const ray = viewer.camera.getPickRay(screenPos);
  if (ray) {
    const picked = viewer.scene.globe.pick(ray, viewer.scene);
    if (isValid(picked)) return picked;
  }

  // 3. Fallback chuẩn xác nhất cho chế độ 2D và viền mép địa cầu: camera.pickEllipsoid
  const pickedEllipsoid = viewer.camera.pickEllipsoid(screenPos, viewer.scene.globe.ellipsoid);
  if (isValid(pickedEllipsoid)) return pickedEllipsoid;

  return undefined;
}

/**
 * Tính khoảng cách đại vòng tròn (Haversine distance) giữa 2 toạ độ địa lý (km)
 */
function computeDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Bán kính Trái Đất (km)
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export const CesiumGlobe: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  // Tài nguyên vòm radar (Primitive + Material) — quản lý vòng đời thủ công
  const domeResourcesRef = useRef<DomeRenderResource[]>([]);
  // DataSource độc lập cho vòng tròn vùng phân tích 1km và marker tâm
  const analysisRegionDataSourceRef = useRef<Cesium.CustomDataSource | null>(null);

  // Kích hoạt DataSource, Shader và Hoạt cảnh 3D cho Sa bàn Tác chiến (Tactical Radar Sandbox)
  useTacticalSandboxCesium(viewerRef);
  const activePlacementRole = useTacticalSandboxStore((state) => state.activePlacementRole);

  const [isPinned, setIsPinned] = useState<boolean>(true);
  const [cameraHeight, setCameraHeight] = useState<number>(95000);
  const [customModelUrls, setCustomModelUrls] = useState<Record<string, string>>({});
  const [badgeRefreshTick, setBadgeRefreshTick] = useState<number>(0);
  const [movingLauncher, setMovingLauncher] = useState<{ instanceId: string; launcherId: string; launcherIndex?: number } | null>(null);
  const movingLauncherRef = useRef(movingLauncher);
  movingLauncherRef.current = movingLauncher;

  // Lắng nghe phím Escape để hủy di chuyển bệ phóng
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && movingLauncherRef.current) {
        setMovingLauncher(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Lắng nghe khi ảnh thực tế của khí tài tải xong để vẽ lại cờ tác chiến
  useEffect(() => {
    const unregister = registerBadgeImageListener(() => {
      setBadgeRefreshTick((prev) => prev + 1);
    });
    return unregister;
  }, []);

  const {
    instances,
    selectedInstanceId,
    activeTool,
    pendingTemplate,
    viewMode,
    terrainExaggeration,
    basemap,
    vietnamOnly,
    showAllDomes,
    showCommandLinks,
    showSensorNetwork,
    measurePoints,
    flyToTarget,
    selectEquipment,
    addEquipment,
    updateEquipment,
    updateBatteryLauncherPosition,
    setActiveTool,
    addMeasurePoint,
    clearFlyTo,
    targetHeightMeters,
    showBlindZones,
    showConeOfSilence,
    azimuthStepDeg,
    elevationStepDeg,
    kFactor,
    coverageResults,
    coverageFields,
    setCoverageResult,
    setCoverageField,
    setIsCalculatingLOS,
    showCrossSection,
    selectedAzimuthDeg,
    crossSectionProbePoint,
    showSpxPanel,
    spxConfig,
    spxResults,
    setSpxResult,
    isCalculatingSpx,
    setIsCalculatingSpx,
    showCoverageLayer,
    showRangeRingsLayer,
    showLabelsLayer,
    showMarkersLayer,
    showModelsLayer,
    categoryFilter,
    domeAlpha,
    domeAzimuthSegments,
    domeElevationRings,
    domeRimColor,
    domeRimPower,
    domeScanLineCount,
    domeScanLineSpeed,
    domeScanLineAnimated,
    showDomeFootprint,
    domeTerrainMasked,
    domeColorOverride,
    aiAdvisorSuggestions,
    aiAdvisorRoute,
    coverageVolumes,
    setCoverageVolume,
    samVolumes,
    setSamVolume,
    samEngagementModes,
    samCoverageResults,
    setSamCoverageResult,
    dome3DMode,
    showOccludedVolume,
    selectedAltitudeM,
    setIsCalculatingVolume,
    isSelectingFlatnessCenter,
    analysisRegion,
    flatnessAnalysisResult,
    hoveredPatchId,
    selectedPatchId,
    showTerrainZoneInspector,
    selectPatch,
    setHoveredPatch,
    showTerrainComparison,
    setShowTerrainComparison,
    terrainComparisonResult,
    terrainComparisonLayers,
  } = useTacticalStore();

  /**
   * Hủy toàn bộ Primitive + Material của vòm radar.
   * Phải gọi TRƯỚC khi dựng lại vòm hoặc trước khi destroy viewer để không rò rỉ GPU.
   */
  const releaseDomeResources = useCallback(() => {
    const viewer = viewerRef.current;
    const scene = viewer && !viewer.isDestroyed() ? viewer.scene : null;

    for (const resource of domeResourcesRef.current) {
      if (!resource.primitive.isDestroyed()) {
        if (scene && !scene.isDestroyed() && scene.primitives.contains(resource.primitive)) {
          // PrimitiveCollection.remove() tự destroy primitive
          scene.primitives.remove(resource.primitive);
        } else {
          resource.primitive.destroy();
        }
      }
      releaseRadarDomeMaterial(resource.material);
    }

    domeResourcesRef.current = [];
  }, []);

  // Tải các mô hình 3D tùy chỉnh của người dùng từ IndexedDB
  useEffect(() => {
    if (!ENABLE_3D_MODELS) return;
    let isMounted = true;
    const loadCustomModels = async () => {
      const urls: Record<string, string> = {};
      for (const inst of instances) {
        if (inst.customModelFileName) {
          const url = await getCustomModelUrl(inst.instanceId);
          if (url) {
            urls[inst.instanceId] = url;
          }
        }
      }
      if (isMounted) {
        setCustomModelUrls(urls);
      }
    };
    loadCustomModels();
    return () => {
      isMounted = false;
    };
  }, [instances]);

  // 1. Khởi tạo Cesium Viewer
  useEffect(() => {
    if (!containerRef.current) return;

    // Khởi tạo lớp bản đồ ban đầu theo basemap
    const initialBaseLayer = new Cesium.ImageryLayer(createImageryProvider(basemap));

    // Khởi tạo Viewer
    const viewer = new Cesium.Viewer(containerRef.current, {
      baseLayer: initialBaseLayer,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      navigationHelpButton: false,
      animation: false,
      fullscreenButton: false,
      scene3DOnly: false,
      showRenderLoopErrors: false,
    });

    viewerRef.current = viewer;

    // Bắt và cô lập lỗi render không mong muốn, tự động hồi phục tránh dừng vĩnh viễn vòng lặp Cesium
    viewer.scene.renderError.addEventListener((scene, error) => {
      console.warn('Cảnh báo lỗi render Cesium đã được cô lập:', error);
      if ((scene as any)._renderErrorOccurred) {
        (scene as any)._renderErrorOccurred = false;
        requestAnimationFrame(() => {
          if (viewerRef.current && !viewerRef.current.isDestroyed()) {
            viewerRef.current.scene.requestRender();
          }
        });
      }
    });

    // Nạp địa hình 3D trực tiếp từ thư mục public/offline-terrain qua singleton có guard
    getOfflineTerrainProvider()
      .then((provider) => {
        if (viewerRef.current && !viewerRef.current.isDestroyed()) {
          viewerRef.current.scene.terrainProvider = provider;
          viewerRef.current.terrainProvider = provider;
          setTerrainProvider(provider);
        }
      })
      .catch((err) => {
        console.warn('Lỗi nạp địa hình từ public/offline-terrain:', err);
      });

    // Vô hiệu hoá double click zoom quá gần mặc định của Cesium
    viewer.screenSpaceEventHandler.removeInputAction(
      Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
    );

    // Bật kiểm tra độ sâu với địa hình lồi lõm
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.verticalExaggeration = terrainExaggeration;
    viewer.scene.globe.enableLighting = false;

    // Chống camera đâm xuyên qua bề mặt địa hình vào khoảng không tối bên dưới lòng đất
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 25;

    // Lắng nghe thay đổi vị trí camera để cập nhật chỉ số chiều cao thực tế
    viewer.camera.changed.addEventListener(() => {
      if (viewerRef.current) {
        const carto = viewerRef.current.camera.positionCartographic;
        const h = Math.round(carto.height);
        setCameraHeight(h);

        // Ghi tâm camera cho cố vấn AI (module-level, KHÔNG qua store để tránh re-render mỗi frame).
        // Dùng toạ độ địa lý của vị trí camera làm tâm vùng quan tâm.
        if (carto && Number.isFinite(carto.latitude) && Number.isFinite(carto.longitude)) {
          setAdvisorViewport({
            lat: Cesium.Math.toDegrees(carto.latitude),
            lon: Cesium.Math.toDegrees(carto.longitude),
            heightM: Number.isFinite(h) && h > 0 ? h : 95000,
          });
        }
      }
    });

    // Đặt góc nhìn ban đầu nhìn nghiêng ngắm núi Tam Đảo ở độ cao vừa phải (95.000m)
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(105.645, 21.35, 95000),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-35),
        roll: 0,
      },
    });

    // Đồng hồ thời gian thực cho dải quét của vòm radar (uniform u_time của Defense/RadarDome port).
    // Custom uniform của Cesium được đọc lại tại thời điểm bind nên chỉ cần gán mỗi frame.
    const removeDomeTimeListener = viewer.scene.preRender.addEventListener(() => {
      const inverseViewMatrix = viewer.scene.camera?.inverseViewMatrix;
      updateRadarDomeMaterials(performance.now() / 1000, inverseViewMatrix);
    });

    // Cleanup khi unmount
    return () => {
      if (typeof removeDomeTimeListener === 'function') {
        removeDomeTimeListener();
      }
      // Giải phóng Primitive/Material của vòm TRƯỚC khi destroy viewer
      releaseDomeResources();
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
    // releaseDomeResources là useCallback([]) -> identity ổn định, effect vẫn chỉ chạy 1 lần
  }, [releaseDomeResources]);

  // 2. Chuyển đổi chế độ 3D (Địa hình lồi lõm) / 2D (Bản đồ phẳng)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    viewer.scene.verticalExaggeration = terrainExaggeration;

    // Đảm bảo terrainProvider offline được nạp (tránh tạo mới lặp lại nhiều lần)
    if (viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider) {
      getOfflineTerrainProvider()
        .then((provider) => {
          if (viewerRef.current && !viewerRef.current.isDestroyed()) {
            viewerRef.current.terrainProvider = provider;
            viewerRef.current.scene.terrainProvider = provider;
            setTerrainProvider(provider);
          }
        })
        .catch((err) => console.warn('Lỗi nạp địa hình offline 3D:', err));
    }

    if (viewMode === '2D') {
      if (viewer.scene.mode !== Cesium.SceneMode.SCENE2D) {
        viewer.scene.morphTo2D(1.0);
      }
      viewer.scene.globe.depthTestAgainstTerrain = false;
    } else {
      if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) {
        viewer.scene.morphTo3D(1.0);
      }
      viewer.scene.globe.depthTestAgainstTerrain = true;
    }
  }, [viewMode, terrainExaggeration]);

  // 3. Phản ứng khi thay đổi Lớp Bản đồ Nền (Basemap) hoặc Chuyển đổi 2D/3D
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    viewer.imageryLayers.removeAll();

    try {
      // Nạp ImageryProvider theo basemap được chọn (mặc định Google Terrain cho 2D)
      const provider = createImageryProvider(basemap);
      const layer = new Cesium.ImageryLayer(provider);
      viewer.imageryLayers.add(layer);

      // Nếu người dùng chọn google-terrain hoặc topo và có sẵn thư mục gạch offline cục bộ
      // Giới hạn đúng phạm vi toạ độ và zoom levels 8-13 của gói dữ liệu Duyên hải Miền Trung & Tây Nguyên
      if (basemap === 'google-terrain' || basemap === 'topo') {
        const localTerrainLayer = new Cesium.ImageryLayer(
          new Cesium.UrlTemplateImageryProvider({
            url: './offline-terrain-map/{z}/{x}/{y}.png',
            minimumLevel: 8,
            maximumLevel: 13,
            rectangle: Cesium.Rectangle.fromDegrees(105.0, 10.5, 109.5, 20.0),
          })
        );
        (localTerrainLayer.imageryProvider as any).errorEvent?.addEventListener((error: any) => {
          error.retry = false;
        });
        viewer.imageryLayers.add(localTerrainLayer);
      }
    } catch (err) {
      console.error('Lỗi nạp Basemap:', err);
      const fallbackProvider = new Cesium.UrlTemplateImageryProvider({
        url: './offline-satellite/{z}/{x}/{y}.jpg',
        minimumLevel: 0,
        maximumLevel: 16,
      });
      fallbackProvider.errorEvent.addEventListener((error: any) => {
        error.retry = false;
      });
      const fallbackLayer = new Cesium.ImageryLayer(fallbackProvider);
      viewer.imageryLayers.add(fallbackLayer);
    }
  }, [basemap]);

  // 4. Cắt gọn và giới hạn phạm vi hiển thị chỉ vùng Việt Nam
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    // Toạ độ bao trọn vẹn lãnh thổ, vùng trời và biển đảo Việt Nam
    // (Bao gồm đất liền, Vịnh Bắc Bộ, Vịnh Thái Lan, Hoàng Sa và Trường Sa)
    const vnRect = Cesium.Rectangle.fromDegrees(101.5, 6.0, 118.5, 24.0);

    if (vietnamOnly) {
      // Cắt gọn quả cầu: Chỉ render duy nhất bề mặt địa hình & bản đồ trong toạ độ Việt Nam
      viewer.scene.globe.cartographicLimitRectangle = vnRect;

      // Bay camera về vị trí quan sát toàn cảnh Việt Nam
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(108.2, 15.5, 1500000),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-68),
          roll: 0,
        },
        duration: 1.0,
      });
    } else {
      // Mở lại toàn bộ quả địa cầu thế giới
      viewer.scene.globe.cartographicLimitRectangle = Cesium.Rectangle.fromDegrees(-180, -90, 180, 90);
    }
  }, [vietnamOnly]);

  // 5. Xử lý Fly-To khu vực: Zoom vừa phải (ít thôi), giữ bao quát
  useEffect(() => {
    const viewer = viewerRef.current;
    if (
      !viewer ||
      !flyToTarget ||
      typeof flyToTarget.longitude !== 'number' ||
      typeof flyToTarget.latitude !== 'number' ||
      isNaN(flyToTarget.longitude) ||
      isNaN(flyToTarget.latitude) ||
      !isFinite(flyToTarget.longitude) ||
      !isFinite(flyToTarget.latitude)
    ) {
      return;
    }

    // Tôn trọng độ cao chiến thuật nếu preset chỉ định độ cao quan sát cụ thể (< 80.000m)
    const rawHeight = typeof flyToTarget.height === 'number' && !isNaN(flyToTarget.height) ? flyToTarget.height : 95000;
    const safeHeight = Math.max(100, rawHeight);

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        flyToTarget.longitude,
        flyToTarget.latitude,
        safeHeight
      ),
      orientation: {
        heading: Cesium.Math.toRadians(flyToTarget.heading || 0),
        pitch: Cesium.Math.toRadians(flyToTarget.pitch || -35),
        roll: 0,
      },
      duration: 1.2,
      complete: () => {
        clearFlyTo();
      },
    });
  }, [flyToTarget, clearFlyTo]);

  // Ref lưu camera và sceneMode trước khi vào chế độ Terrain Zone Inspector
  const savedInspectorCameraRef = useRef<{
    position: Cesium.Cartesian3;
    heading: number;
    pitch: number;
    roll: number;
    mode?: Cesium.SceneMode;
  } | null>(null);

  // Con trỏ chuột khi chọn tâm 1km hoặc khi cắm chốt Sa bàn 3D
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    if (isSelectingFlatnessCenter || activePlacementRole) {
      viewer.canvas.style.cursor = 'crosshair';
    } else {
      viewer.canvas.style.cursor = 'default';
    }
  }, [isSelectingFlatnessCenter, activePlacementRole]);

  // Quản lý chế độ khảo sát mảng địa hình 3D (Terrain Zone Inspector)
  // Bảo toàn 100% quả địa cầu xung quanh (KHÔNG dùng ClippingPolygon gây lỗi màn hình đen)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    if (showTerrainZoneInspector && selectedPatchId && flatnessAnalysisResult) {
      const patch = flatnessAnalysisResult.patches.find((p: FlatPatch) => p.id === selectedPatchId);
      if (patch && patch.polygon.length >= 3) {
        // 1. Lưu lại camera và sceneMode nếu chưa có
        if (!savedInspectorCameraRef.current) {
          savedInspectorCameraRef.current = {
            position: Cesium.Cartesian3.clone(viewer.camera.position),
            heading: viewer.camera.heading,
            pitch: viewer.camera.pitch,
            roll: viewer.camera.roll,
            mode: viewer.scene.mode,
          };
        }

        // Chuyển sang chế độ 3D an toàn bằng morphTo3D nếu đang ở 2D
        if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) {
          try {
            viewer.scene.morphTo3D(0.5);
          } catch {
            // Morph guard fallback
          }
        }

        // Bật chống đâm xuyên địa hình và đặt khoảng cách zoom tối thiểu an toàn
        viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
        viewer.scene.screenSpaceCameraController.minimumZoomDistance = 25;

        // Xóa sạch clippingPolygons nếu có từ phiên trước để đảm bảo không bị đen bản đồ
        if (viewer.scene.globe.clippingPolygons) {
          viewer.scene.globe.clippingPolygons = undefined as any;
        }

        // Phóng đại địa hình vừa phải để nhìn rõ gờ đất nhưng không làm gãy frustum
        viewer.scene.verticalExaggeration = Math.max(1.5, terrainExaggeration);

        // Fly to quan sát mảng với BoundingSphere bám độ cao thực tế
        const radiusM = Math.max(220, Math.sqrt(patch.areaM2 / Math.PI));
        const patchAlt = (patch.minElevM + patch.maxElevM) / 2;
        const centerPos = Cesium.Cartesian3.fromDegrees(patch.centerLon, patch.centerLat, patchAlt);
        const sphere = new Cesium.BoundingSphere(centerPos, radiusM);

        viewer.camera.flyToBoundingSphere(sphere, {
          offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(0),
            Cesium.Math.toRadians(-35),
            radiusM * 2.5
          ),
          duration: 1.2,
        });
      }
    } else {
      // Thoát chế độ Inspector: đảm bảo không còn clipping polygon sót lại
      if (viewer.scene.globe.clippingPolygons) {
        viewer.scene.globe.clippingPolygons = undefined as any;
      }
      viewer.scene.verticalExaggeration = terrainExaggeration;

      if (savedInspectorCameraRef.current) {
        const savedMode = savedInspectorCameraRef.current.mode;
        if (savedMode !== undefined && viewer.scene.mode !== savedMode) {
          if (savedMode === Cesium.SceneMode.SCENE2D) {
            viewer.scene.morphTo2D(0.5);
          } else if (savedMode === Cesium.SceneMode.COLUMBUS_VIEW) {
            viewer.scene.morphToColumbusView(0.5);
          } else {
            viewer.scene.morphTo3D(0.5);
          }
        }
        viewer.camera.flyTo({
          destination: savedInspectorCameraRef.current.position,
          orientation: {
            heading: savedInspectorCameraRef.current.heading,
            pitch: savedInspectorCameraRef.current.pitch,
            roll: savedInspectorCameraRef.current.roll,
          },
          duration: 1.2,
        });
        savedInspectorCameraRef.current = null;
      }
    }
  }, [showTerrainZoneInspector, selectedPatchId, flatnessAnalysisResult, terrainExaggeration]);

  // 5. Quản lý sự kiện Click chuột (Chọn khí tài / Đặt khí tài / Đo đạc trên bề mặt địa hình)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
      const cartesian = pickGroundCartesian(viewer, movement.position);

      // 0a. Chế độ di chuyển Bệ phóng của Cụm Tổ Hợp SAM
      if (movingLauncherRef.current) {
        let carto: Cesium.Cartographic | undefined;
        if (cartesian) {
          carto = Cesium.Cartographic.fromCartesian(cartesian);
        } else {
          const pickedEllipsoid = viewer.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid);
          if (pickedEllipsoid) carto = Cesium.Cartographic.fromCartesian(pickedEllipsoid);
        }

        if (
          carto &&
          !isNaN(carto.latitude) &&
          !isNaN(carto.longitude) &&
          isFinite(carto.latitude) &&
          isFinite(carto.longitude)
        ) {
          const rawLat = Cesium.Math.toDegrees(carto.latitude);
          const rawLon = Cesium.Math.toDegrees(carto.longitude);
          const groundHeight = carto.height !== undefined && !isNaN(carto.height) && isFinite(carto.height)
            ? Math.max(0, Math.round(carto.height))
            : 0;

          const target = movingLauncherRef.current;
          const currentInst = instances.find((i) => i.instanceId === target.instanceId);

          if (currentInst) {
            // Lấy mẫu 10 điểm địa hình trung gian giữa đài FCR và Bệ phóng mới để kiểm tra Line-of-Sight
            const intermediateHeights: number[] = [];
            const sampleCount = 10;
            for (let s = 1; s <= sampleCount; s++) {
              const t = s / (sampleCount + 1);
              const midLat = currentInst.latitude + t * (rawLat - currentInst.latitude);
              const midLon = currentInst.longitude + t * (rawLon - currentInst.longitude);
              const midCarto = Cesium.Cartographic.fromDegrees(midLon, midLat);
              const h = viewer.scene.globe.getHeight(midCarto) ?? 0;
              intermediateHeights.push(Math.max(0, Math.round(h)));
            }

            const antennaHeightAGL = currentInst.compositeBattery?.mastHeightOverrideM ?? currentInst.antennaHeightAGL ?? 6;
            const losResult = checkLauncherLineOfSight(
              currentInst.altitude || 0,
              antennaHeightAGL,
              groundHeight,
              intermediateHeights
            );

            updateBatteryLauncherPosition(
              target.instanceId,
              target.launcherId,
              Number(rawLat.toFixed(5)),
              Number(rawLon.toFixed(5)),
              groundHeight,
              losResult
            );
          }

          setMovingLauncher(null);
          return;
        }
        return;
      }

      // 0. Chế độ chọn tâm phân tích độ bằng phẳng địa hình (1km)
      if (isSelectingFlatnessCenter) {
        let carto: Cesium.Cartographic | undefined;
        if (cartesian) {
          carto = Cesium.Cartographic.fromCartesian(cartesian);
        } else {
          // Fallback: giao điểm với hình cầu ellipsoid WGS84
          const pickedEllipsoid = viewer.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid);
          if (pickedEllipsoid) carto = Cesium.Cartographic.fromCartesian(pickedEllipsoid);
        }

        if (
          carto &&
          !isNaN(carto.latitude) &&
          !isNaN(carto.longitude) &&
          isFinite(carto.latitude) &&
          isFinite(carto.longitude)
        ) {
          const lat = Cesium.Math.toDegrees(carto.latitude);
          const lon = Cesium.Math.toDegrees(carto.longitude);
          // 1. Lưu vùng chọn, vẽ vòng tròn cyan 1km và tự động khảo sát dữ liệu GIS (KHÔNG tự chạy tìm mảng)
          useTacticalStore.getState().selectAnalysisRegion(lat, lon);
          // 2. Tự động đóng bảng GIS AI để mở Bảng thuộc tính vùng 1km, tránh chồng lấn giao diện
          useAnalysisStore.getState().setPanelOpen(false);
          return;
        }
        return;
      }

      // 0b. Chế độ cắm chốt hỏa lực / quan sát của Sa bàn Tác chiến 3D (MANPADS, Pháo 23mm, Đài quan sát...)
      if (activePlacementRole) {
        let carto: Cesium.Cartographic | undefined;
        if (cartesian) {
          carto = Cesium.Cartographic.fromCartesian(cartesian);
        } else {
          const pickedEllipsoid = viewer.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid);
          if (pickedEllipsoid) carto = Cesium.Cartographic.fromCartesian(pickedEllipsoid);
        }

        if (
          carto &&
          !isNaN(carto.latitude) &&
          !isNaN(carto.longitude) &&
          isFinite(carto.latitude) &&
          isFinite(carto.longitude)
        ) {
          const rawLat = Cesium.Math.toDegrees(carto.latitude);
          const rawLon = Cesium.Math.toDegrees(carto.longitude);
          const groundHeight = carto.height !== undefined && !isNaN(carto.height) && isFinite(carto.height)
            ? Math.max(0, Math.round(carto.height))
            : 0;

          useTacticalSandboxStore.getState().deployUnit({
            role: activePlacementRole,
            latitude: Number(rawLat.toFixed(5)),
            longitude: Number(rawLon.toFixed(5)),
            altitudeM: groundHeight,
          });
          return;
        }
        return;
      }

      // Kiểm tra click vào mảng phẳng
      const pickedEntity = viewer.scene.pick(movement.position);
      if (Cesium.defined(pickedEntity) && pickedEntity.id && typeof pickedEntity.id.id === 'string') {
        const idStr = pickedEntity.id.id;
        if (idStr.startsWith('flatpatch_')) {
          const patchId = idStr.replace('flatpatch_', '');
          selectPatch(patchId);
          return;
        }
      }

      // A. Chế độ đo khoảng cách
      if (activeTool === 'measure') {
        if (cartesian) {
          const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
          if (cartographic && !isNaN(cartographic.latitude) && !isNaN(cartographic.longitude)) {
            const h = cartographic.height !== undefined && !isNaN(cartographic.height) && isFinite(cartographic.height)
              ? Math.max(0, cartographic.height)
              : 0;
            addMeasurePoint({
              lat: Cesium.Math.toDegrees(cartographic.latitude),
              lon: Cesium.Math.toDegrees(cartographic.longitude),
              height: h,
            });
          }
        }
        return;
      }

      // B. Chế độ đặt khí tài mới
      if (activeTool === 'place' && pendingTemplate) {
        if (!cartesian) return;
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        if (!cartographic || isNaN(cartographic.latitude) || isNaN(cartographic.longitude)) return;

        const rawLat = Cesium.Math.toDegrees(cartographic.latitude);
        const rawLon = Cesium.Math.toDegrees(cartographic.longitude);
        if (isNaN(rawLat) || isNaN(rawLon) || !isFinite(rawLat) || !isFinite(rawLon)) return;

        const groundHeight = cartographic.height !== undefined && !isNaN(cartographic.height) && isFinite(cartographic.height)
          ? Math.max(0, Math.round(cartographic.height))
          : 0;

        addEquipment(
          createEquipmentFromTemplate(pendingTemplate, {
            latitude: Number(rawLat.toFixed(5)),
            longitude: Number(rawLon.toFixed(5)),
            altitude: groundHeight,
            nameIndex: instances.length + 1,
            existingInstances: instances,
          })
        );
        return;
      }

      // B2. Chế độ di chuyển khí tài đã chọn sang vị trí mới (Move / Reposition Tool)
      if (activeTool === 'move' && selectedInstanceId) {
        if (!cartesian) return;
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        if (!cartographic || isNaN(cartographic.latitude) || isNaN(cartographic.longitude)) return;

        const rawLat = Cesium.Math.toDegrees(cartographic.latitude);
        const rawLon = Cesium.Math.toDegrees(cartographic.longitude);
        if (isNaN(rawLat) || isNaN(rawLon) || !isFinite(rawLat) || !isFinite(rawLon)) return;

        const groundHeight = cartographic.height !== undefined && !isNaN(cartographic.height) && isFinite(cartographic.height)
          ? Math.max(0, Math.round(cartographic.height))
          : 0;

        updateEquipment(selectedInstanceId, {
          latitude: Number(rawLat.toFixed(5)),
          longitude: Number(rawLon.toFixed(5)),
          altitude: groundHeight,
        });
        setActiveTool('select');
        return;
      }

      // C. Chế độ chọn khí tài (Selection)
      const pickedObject = viewer.scene.pick(movement.position);
      if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.properties) {
        const instId = pickedObject.id.properties.instanceId?.getValue();
        if (instId) {
          const isLauncher = pickedObject.id.properties.isLauncher?.getValue() === true;
          const launcherId = pickedObject.id.properties.launcherId?.getValue();
          const launcherIndex = pickedObject.id.properties.launcherIndex?.getValue();

          // 1. Nhấp vào Bệ phóng LN-1..4: Kích hoạt di chuyển bệ phóng & hạ camera quan sát
          if (isLauncher && launcherId) {
            selectEquipment(instId);
            setIsPinned(true);
            setMovingLauncher({ instanceId: instId, launcherId, launcherIndex });

            const currentH = viewer.camera.positionCartographic?.height ?? 95000;
            // Nếu camera đang ở xa (> 6km), bay nhẹ xuống 3500m để quan sát rõ trận địa; nếu đang ở gần (<= 6km) thì giữ nguyên góc nhìn
            if (currentH > 6000) {
              const inst = instances.find((i) => i.instanceId === instId);
              if (inst) {
                viewer.camera.flyTo({
                  destination: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, 3500),
                  orientation: {
                    heading: viewer.camera.heading,
                    pitch: Cesium.Math.toRadians(-45),
                    roll: 0,
                  },
                  duration: 0.8,
                });
              }
            }
            return;
          }

          // 2. Nhấp vào Tâm Khí Tài chính
          selectEquipment(instId);
          setIsPinned(true);

          // Nhấp vào điểm đặt: Giữ góc nhìn cận cảnh nếu đang zoom gần (< 15km)
          const inst = instances.find((i) => i.instanceId === instId);
          if (
            inst &&
            typeof inst.longitude === 'number' &&
            typeof inst.latitude === 'number' &&
            !isNaN(inst.longitude) &&
            !isNaN(inst.latitude) &&
            isFinite(inst.longitude) &&
            isFinite(inst.latitude)
          ) {
            const currentH = viewer.camera.positionCartographic?.height ?? 95000;
            // Chỉ khi đang ở góc nhìn tổng quan chiến lược (>= 15km) mới tự điều chỉnh ~90km
            if (currentH >= 15000) {
              const targetH = Math.max(90000, Math.min(currentH, 140000));
              viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(
                  inst.longitude,
                  inst.latitude,
                  targetH
                ),
                orientation: {
                  heading: viewer.camera.heading,
                  pitch: Cesium.Math.toRadians(-35),
                  roll: 0,
                },
                duration: 1.0,
              });
            }
          }
          return;
        }
      }

      // Bấm ra ngoài khoảng trống: bỏ chọn và bỏ ghim
      selectEquipment(null);
      setIsPinned(false);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Xử lý rê chuột (Hover) qua các mảng địa hình phẳng
    handler.setInputAction((movement: { endPosition: Cesium.Cartesian2 }) => {
      if (!flatnessAnalysisResult || flatnessAnalysisResult.patches.length === 0) return;
      const picked = viewer.scene.pick(movement.endPosition);
      if (
        Cesium.defined(picked) &&
        picked.id &&
        typeof picked.id.id === 'string' &&
        picked.id.id.startsWith('flatpatch_')
      ) {
        const patchId = picked.id.id.replace('flatpatch_', '');
        setHoveredPatch(patchId);
        viewer.canvas.style.cursor = 'pointer';
      } else {
        if (!isSelectingFlatnessCenter) {
          viewer.canvas.style.cursor = 'default';
        }
        setHoveredPatch(null);
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    return () => {
      handler.destroy();
    };
  }, [
    activeTool,
    pendingTemplate,
    instances,
    isSelectingFlatnessCenter,
    flatnessAnalysisResult,
    selectPatch,
    setHoveredPatch,
    addEquipment,
    updateEquipment,
    updateBatteryLauncherPosition,
    setActiveTool,
    selectedInstanceId,
    addMeasurePoint,
    selectEquipment,
    movingLauncher,
  ]);

  // 5b. Tính toán Quang tuyến LOS & Coverage Field cho tất cả các đài radar (Chỉ chạy ở chế độ 3D)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || instances.length === 0 || viewMode === '2D') return;

    let isCancelled = false;

    const calcAll = async () => {
      // 1. Kiểm tra xem có đài nào thực sự cần tính toán mới không
      const state = useTacticalStore.getState();
      const currentFields = state.coverageFields;
      const cache = state.coverageFieldCache;

      let hasPendingCalculation = false;
      for (const inst of instances) {
        const caps = getAssetCapabilities(inst.category);
        if (caps.hasRadarCoverage && inst.rangeKm > 0 && inst.showDome) {
          const params = {
            targetHeightMeters,
            azimuthStepDeg,
            elevationStepDeg,
            radialStepMeters: Math.max(1500, Math.round((inst.rangeKm * 1000) / 45)),
            kFactor,
            showBlindZones,
          };
          const cacheKey = generateCoverageCacheKey(inst, params);
          if (currentFields[inst.instanceId]?.cacheKey !== cacheKey && !cache[cacheKey]) {
            hasPendingCalculation = true;
            break;
          }
        }
      }

      if (hasPendingCalculation) {
        setIsCalculatingLOS(true);
      }

      for (const inst of instances) {
        if (isCancelled) break;
        const caps = getAssetCapabilities(inst.category);
        if (caps.hasRadarCoverage && inst.rangeKm > 0 && inst.showDome) {
          try {
            const params = {
              targetHeightMeters,
              azimuthStepDeg,
              elevationStepDeg,
              radialStepMeters: Math.max(1500, Math.round((inst.rangeKm * 1000) / 45)),
              kFactor,
              showBlindZones,
            };

            const cacheKey = generateCoverageCacheKey(inst, params);
            const latestState = useTacticalStore.getState();

            // Nếu đài này đã có field đúng với cacheKey hiện tại -> bỏ qua không set lại
            if (latestState.coverageFields[inst.instanceId]?.cacheKey === cacheKey) {
              continue;
            }

            // Nếu đã có trong cache -> áp dụng ngay từ cache
            if (latestState.coverageFieldCache[cacheKey]) {
              setCoverageField(inst.instanceId, latestState.coverageFieldCache[cacheKey]);
              continue;
            }

            // Tính toán mới qua engine địa hình
            const field = await computeRadarCoverageField(
              inst,
              viewer.scene.terrainProvider,
              params
            );

            if (!isCancelled) {
              setCoverageField(inst.instanceId, field);
              // Chuyển đổi trực tiếp kết quả sang coverageResults mà không lấy mẫu địa hình lại
              const legacyRes = convertFieldToCoverageResult(
                field,
                inst,
                targetHeightMeters
              );
              setCoverageResult(inst.instanceId, legacyRes);
            }
          } catch (e) {
            console.warn('Lỗi tính toán Coverage Field cho khí tài:', inst.name, e);
          }
        }
      }

      if (!isCancelled) {
        setIsCalculatingLOS(false);
      }
    };

    calcAll();

    return () => {
      isCancelled = true;
    };
  }, [
    instances,
    viewMode,
    targetHeightMeters,
    azimuthStepDeg,
    elevationStepDeg,
    kFactor,
    showBlindZones,
    setCoverageField,
    setCoverageResult,
    setIsCalculatingLOS,
  ]);

  // 5c. Tính toán SPx Radar Coverage (Vùng Phủ 2D Cambridge Pixel)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || instances.length === 0) return;

    // Chỉ tính toán khi ở chế độ 2D hoặc khi đang mở Panel SPx
    if (viewMode !== '2D' && !showSpxPanel) return;

    let isCancelled = false;

    const calcSpxAll = async () => {
      // Tìm các đài radar thực thụ có capability phát sóng cảnh giới
      const candidateRadars = instances.filter((i) => {
        const caps = getAssetCapabilities(i.category);
        return caps.hasRadarCoverage && i.rangeKm > 0;
      });

      // Bổ sung các đài Radar Chỉ Thị (TAR) của các Tổ hợp Tên Lửa Phòng Không
      const compositeTarRadars: EquipmentInstance[] = [];
      for (const inst of instances) {
        const tarInst = getCompositeBatteryTarInstance(inst);
        if (tarInst) compositeTarRadars.push(tarInst);
      }
      const allRadars = [...candidateRadars, ...compositeTarRadars];
      if (allRadars.length === 0) return;

      const state = useTacticalStore.getState();
      const currentResults = state.spxResults;

      for (const inst of allRadars) {
        if (isCancelled) break;
        const isSelected = inst.instanceId === selectedInstanceId || inst.instanceId.startsWith(`${selectedInstanceId}_`);
        const effectiveTargetAlt = inst.targetAltitudeM ?? (isSelected ? (selectedAltitudeM || targetHeightMeters || 1000) : (selectedAltitudeM || 1000));
        const instConfig = {
          ...spxConfig,
          targetAltitudeM: effectiveTargetAlt,
          radarHeightAGL: inst.antennaHeightAGL || spxConfig.radarHeightAGL,
          endRangeM: inst.rangeKm ? inst.rangeKm * 1000 : spxConfig.endRangeM,
          minElevationDeg: inst.minElevationDeg !== undefined ? inst.minElevationDeg : spxConfig.minElevationDeg,
          maxElevationDeg: inst.maxElevationDeg !== undefined ? inst.maxElevationDeg : spxConfig.maxElevationDeg,
          ...(inst.spxConfig || {}),
        };
        const cacheKey = generateSpxCacheKey(inst, instConfig);
        if (currentResults[inst.instanceId]?.cacheKey === cacheKey) {
          continue;
        }

        setIsCalculatingSpx(true);
        try {
          const res = await computeSpxRadarCoverage(
            inst,
            viewer.scene.terrainProvider,
            instConfig
          );
          if (!isCancelled) {
            setSpxResult(inst.instanceId, res);
          }
        } catch (err) {
          console.error('Lỗi tính toán SPx Coverage cho đài:', inst.name, err);
        }
      }

      if (!isCancelled) {
        setIsCalculatingSpx(false);
      }
    };

    calcSpxAll();

    return () => {
      isCancelled = true;
    };
  }, [
    viewMode,
    showSpxPanel,
    selectedInstanceId,
    instances,
    spxConfig,
    selectedAltitudeM,
    targetHeightMeters,
    setSpxResult,
    setIsCalculatingSpx,
  ]);

  // 5d. Tính toán 3D Radar Coverage Volume (Single Source of Truth cho Vòm 3D)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || instances.length === 0) return;

    if (viewMode !== '3D' || !showAllDomes) return;

    let isCancelled = false;

    const calcVolumeAll = async () => {
      const candidateRadars = instances.filter((i) => {
        const caps = getAssetCapabilities(i.category);
        return caps.hasRadarCoverage && i.rangeKm > 0 && i.showDome;
      });

      // Bổ sung các đài Radar Chỉ Thị (TAR) của Tổ hợp Tên Lửa
      const compositeTarRadars: EquipmentInstance[] = [];
      for (const inst of instances) {
        const tarInst = getCompositeBatteryTarInstance(inst);
        if (tarInst) compositeTarRadars.push(tarInst);
      }
      const allRadars = [...candidateRadars, ...compositeTarRadars];

      const candidateSams = instances.filter((i) => {
        const caps = getAssetCapabilities(i.category);
        return caps.hasEngagementEnvelope && i.rangeKm > 0 && i.showDome;
      });

      if (allRadars.length === 0 && candidateSams.length === 0) return;

      const latestState = useTacticalStore.getState();
      const currentVolumes = latestState.coverageVolumes;
      const currentSamVolumes = latestState.samVolumes;

      let hasPending = false;
      for (const inst of allRadars) {
        const params = {
          azimuthStepDeg,
          kFactor,
          radialStepMeters: Math.max(1500, Math.round((inst.rangeKm * 1000) / 45)),
        };
        const cacheKey = generateVolumeCacheKey(inst, params);
        if (currentVolumes[inst.instanceId]?.cacheKey !== cacheKey) {
          hasPending = true;
          break;
        }
      }

      if (!hasPending) {
        for (const inst of candidateSams) {
          const mode = inst.samEngagementMode || samEngagementModes[inst.instanceId] || 'head_on';
          const samCacheKey = getSamVolumeCacheKey(inst, { mode, azimuthStepDeg, kFactor });
          if (currentSamVolumes[inst.instanceId]?.cacheKey !== samCacheKey) {
            hasPending = true;
            break;
          }
        }
      }

      if (hasPending) {
        setIsCalculatingVolume(true);
      }

      // 1. Tính toán 3D Radar Coverage Volume
      for (const inst of allRadars) {
        if (isCancelled) break;
        try {
          const params = {
            azimuthStepDeg,
            kFactor,
            radialStepMeters: Math.max(1500, Math.round((inst.rangeKm * 1000) / 45)),
          };
          const cacheKey = generateVolumeCacheKey(inst, params);
          const stateNow = useTacticalStore.getState();
          if (stateNow.coverageVolumes[inst.instanceId]?.cacheKey === cacheKey) {
            continue;
          }

          const vol = await computeRadarCoverageVolume(
            inst,
            viewer.scene.terrainProvider,
            params
          );

          if (!isCancelled) {
            setCoverageVolume(inst.instanceId, vol);
          }
        } catch (e) {
          console.warn('Lỗi tính toán 3D Coverage Volume cho khí tài:', inst.name, e);
        }
      }

      // 2. Tính toán 3D SAM Engagement Volume cho các tổ hợp Tên Lửa Phòng Không
      for (const inst of candidateSams) {
        if (isCancelled) break;
        try {
          const mode = inst.samEngagementMode || samEngagementModes[inst.instanceId] || 'head_on';
          const samCacheKey = getSamVolumeCacheKey(inst, { mode, azimuthStepDeg, kFactor });
          const stateNow = useTacticalStore.getState();
          if (stateNow.samVolumes[inst.instanceId]?.cacheKey === samCacheKey) {
            continue;
          }

          const linkedRadarVol = inst.designatedRadarId
            ? (latestState.coverageVolumes[inst.designatedRadarId] || currentVolumes[inst.designatedRadarId])
            : (inst.batteryConfig ? (latestState.coverageVolumes[`${inst.instanceId}_tar`] || currentVolumes[`${inst.instanceId}_tar`]) : undefined);

          const vol = await computeSamEngagementVolume(
            inst,
            viewer.scene.terrainProvider,
            {
              mode,
              azimuthStepDeg,
              kFactor,
              linkedRadarVolume: linkedRadarVol,
              samTerrainMaskMode: inst.samTerrainMaskMode,
            }
          );
          if (!isCancelled) {
            setSamVolume(inst.instanceId, vol);
          }
        } catch (e) {
          console.warn('Lỗi tính toán 3D SAM Volume cho khí tài:', inst.name, e);
        }
      }

      if (!isCancelled) {
        setIsCalculatingVolume(false);
      }
    };

    calcVolumeAll();

    return () => {
      isCancelled = true;
    };
  }, [
    instances,
    viewMode,
    showAllDomes,
    azimuthStepDeg,
    kFactor,
    setCoverageVolume,
    setSamVolume,
    samEngagementModes,
    setIsCalculatingVolume,
  ]);

  // 5e. Tính toán Vùng Hỏa Lực SAM Cắt Địa Hình (Hiệp Đồng Radar & DEM Mặt Đất)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || instances.length === 0) return;

    const candidateSams = instances.filter((i) => {
      const caps = getAssetCapabilities(i.category);
      return caps.hasEngagementEnvelope && i.rangeKm > 0;
    });
    if (candidateSams.length === 0) return;

    let isCancelled = false;

    const calcSamCoverageAll = async () => {
      const state = useTacticalStore.getState();
      const currentCoverage = state.samCoverageResults;

      for (const inst of candidateSams) {
        if (isCancelled) break;
        const linkedRadar = inst.designatedRadarId
          ? state.instances.find((i) => i.instanceId === inst.designatedRadarId) || null
          : (inst.batteryConfig ? {
              ...inst,
              instanceId: `${inst.instanceId}_tar`,
              name: inst.batteryConfig.tarRadarName,
              rangeKm: inst.batteryConfig.tarRangeKm,
              coverageHeightKm: inst.batteryConfig.tarHeightKm,
              antennaHeightAGL: inst.batteryConfig.tarAglM || 15,
            } as EquipmentInstance : null);
        const linkedRadarVol = inst.designatedRadarId
          ? state.coverageVolumes[inst.designatedRadarId] || null
          : (inst.batteryConfig ? state.coverageVolumes[`${inst.instanceId}_tar`] || null : null);
        const linkedRadarSpx = inst.designatedRadarId
          ? state.spxResults[inst.designatedRadarId] || null
          : (inst.batteryConfig ? state.spxResults[`${inst.instanceId}_tar`] || null : null);

        const isSelected = inst.instanceId === selectedInstanceId;
        const targetAlt = inst.targetAltitudeM ?? (isSelected ? (selectedAltitudeM || targetHeightMeters || 500) : (selectedAltitudeM || targetHeightMeters || 500));
        const maskMode = inst.samTerrainMaskMode || (linkedRadar || inst.batteryConfig ? 'intersection' : 'organic');

        const cacheKey = generateSamCoverageCacheKey(
          inst,
          {
            launcherHeightAGL: inst.compositeBattery?.mastHeightOverrideM ?? inst.antennaHeightAGL ?? 6,
            dMaxM: (inst.rangeKm || 35.4) * 1000,
            dMinM: (inst.minEngagementRangeKm || 3.5) * 1000,
            hMaxM: inst.maxEngagementAltitudeM || 25000,
            hMinM: inst.minEngagementAltitudeM || 20,
            targetAltitudeM: targetAlt,
            minElevationDeg: inst.minElevationDeg !== undefined ? inst.minElevationDeg : 0.5,
            maxElevationDeg: inst.maxElevationDeg !== undefined ? inst.maxElevationDeg : 65.0,
            kFactor,
            earthCurvature: true,
            maskMode,
            designatedRadarId: inst.designatedRadarId,
          },
          linkedRadar
        );

        if (currentCoverage[inst.instanceId]?.cacheKey === cacheKey) {
          continue;
        }

        try {
          const res = await computeSamCoverage(
            inst,
            viewer.scene.terrainProvider,
            {
              config: { targetAltitudeM: targetAlt, maskMode },
              linkedRadar,
              linkedRadarVolume: linkedRadarVol,
              linkedRadarSpx: linkedRadarSpx,
            }
          );
          if (!isCancelled) {
            setSamCoverageResult(inst.instanceId, res);
          }
        } catch (e) {
          console.warn('Lỗi tính toán SAM Coverage cắt địa hình:', inst.name, e);
        }
      }
    };

    calcSamCoverageAll();

    return () => {
      isCancelled = true;
    };
  }, [
    instances,
    selectedInstanceId,
    coverageVolumes,
    spxResults,
    kFactor,
    selectedAltitudeM,
    targetHeightMeters,
    setSamCoverageResult,
  ]);

  // 6. Render Entities trên bề mặt địa hình lồi lõm
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.entities.removeAll();

    // Giải phóng toàn bộ vòm cũ trước khi dựng lại (tránh rò rỉ primitive khi field/tham số đổi)
    releaseDomeResources();

    const instanceMap = new Map(instances.map((i) => [i.instanceId, i]));

    const hasAnySelected = Boolean(selectedInstanceId && instances.some((i) => i.instanceId === selectedInstanceId));

    // Lọc khí tài theo bộ lọc chuyên mục tác chiến
    const visibleInstances = instances.filter((inst) => {
      if (categoryFilter === 'All') return true;
      return inst.category === categoryFilter;
    });

    // A. Render các khí tài
    visibleInstances.forEach((inst) => {
      // Bỏ qua khí tài nếu toạ độ không phải là số hợp lệ
      if (
        typeof inst.latitude !== 'number' || typeof inst.longitude !== 'number' ||
        isNaN(inst.latitude) || isNaN(inst.longitude) ||
        !isFinite(inst.latitude) || !isFinite(inst.longitude)
      ) {
        return;
      }

      const safeAlt = typeof inst.altitude === 'number' && !isNaN(inst.altitude) && isFinite(inst.altitude)
        ? Math.max(0, inst.altitude)
        : 0;
      const effectiveAntennaAGL = inst.compositeBattery?.mastHeightOverrideM ?? inst.antennaHeightAGL;
      const safeAntennaAGL = typeof effectiveAntennaAGL === 'number' && !isNaN(effectiveAntennaAGL) && isFinite(effectiveAntennaAGL)
        ? Math.max(1, effectiveAntennaAGL)
        : 15;
      const safeRangeKm = typeof inst.rangeKm === 'number' && !isNaN(inst.rangeKm) && isFinite(inst.rangeKm) && inst.rangeKm > 0
        ? inst.rangeKm
        : 50;

      const isSelected = selectedInstanceId === inst.instanceId;
      const is2D = viewMode === '2D';
      const baseColor = Cesium.Color.fromCssColorString(inst.color || '#38bdf8');
      const spxRes = spxResults[inst.instanceId];

      const caps = getAssetCapabilities(inst.category);
      const isSpxActive = (viewMode === '2D' || showSpxPanel) && !!spxRes && caps.hasRadarCoverage;

      // 1. Cờ cắm tác chiến & Nhãn thông tin bám địa hình thực (hoặc toạ độ phẳng trong 2D)
      // Luôn hiển thị độc lập với SPx để đảm bảo đồng bộ UI
        const isPendingCalc = isCalculatingSpx && !spxRes && caps.hasRadarCoverage;
        const shortPrefix = inst.shortId ? `[${inst.shortId}] ` : '';
        const displayName = `${shortPrefix}${inst.name}`;
        const radarCartesian = Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, is2D ? 0 : safeAlt);

        if (showMarkersLayer) {
          const badgeUrl = getTacticalBadgeDataUrl({
            instanceId: inst.instanceId,
            name: inst.name,
            shortId: inst.shortId,
            category: inst.category,
            rangeKm: safeRangeKm,
            antennaHeightAGL: safeAntennaAGL,
            status: inst.status,
            isSelected,
            realPhotoUrl: inst.realPhotoUrl || TEMPLATE_BY_ID.get(inst.templateId)?.realPhotoUrl || '',
            themeColor: inst.color || '#06b6d4',
          });

          // Cờ cắm tác chiến HUD kích thước lớn với ảnh thực tế sắc nét và tên đầy đủ
          viewer.entities.add({
            name: `Marker ${inst.shortId || ''} (${inst.category})`,
            position: radarCartesian,
            properties: { instanceId: inst.instanceId },
            billboard: {
              image: badgeUrl,
              width: 240,
              height: 46,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
              pixelOffset: new Cesium.Cartesian2(-12, 4),
              eyeOffset: new Cesium.Cartesian3(0, 0, -450),
              heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.RELATIVE_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
          // Tâm chữ thập
          viewer.entities.add({
            name: `Tâm Khí Tài ${inst.shortId || ''}`,
            position: radarCartesian,
            properties: { instanceId: inst.instanceId },
            point: {
              pixelSize: isSelected ? 10 : 8,
              color: isSelected ? Cesium.Color.fromCssColorString('#fde047') : Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.RELATIVE_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
        }

        if (showLabelsLayer) {
          const latDms = toDmsString(inst.latitude, true);
          const lonDms = toDmsString(inst.longitude, false);
          const groundMslText = `${Math.round(safeAlt)}m`;
          const antennaAglText = `${Math.round(safeAntennaAGL)}m`;
          const rangeKmText = `${safeRangeKm}km`;
          const statusVi = STATUS_COLOR_MAP[inst.status]?.vi || inst.status || 'Hoạt động';

          const parentInst = inst.commandedByInstanceId ? instanceMap.get(inst.commandedByInstanceId) : null;
          const commandedByName = parentInst ? `${parentInst.shortId ? `[${parentInst.shortId}] ` : ''}${parentInst.name}` : undefined;

          const infoCardText = isPendingCalc
            ? `▶ ${displayName} [Đang tính SPx...]\n  Tọa độ : ${latDms}, ${lonDms}\n  Cao độ : ${groundMslText} (MSL)  |  Anten: ${antennaAglText} (AGL)`
            : formatTacticalAssetInfoCard({
              category: inst.category,
              shortId: inst.shortId,
              name: inst.name,
              latDms,
              lonDms,
              groundMsl: groundMslText,
              antennaAgl: antennaAglText,
              rangeKm: rangeKmText,
              statusVi,
              commandedByName,
            });

          viewer.entities.add({
            name: `Nhãn Thông Tin ${inst.shortId || ''}`,
            position: radarCartesian,
            properties: { instanceId: inst.instanceId },
            label: {
              text: infoCardText,
              font: isSelected ? 'bold 12px "JetBrains Mono", monospace' : '11px "JetBrains Mono", monospace',
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              fillColor: isPendingCalc ? Cesium.Color.CYAN : (isSelected ? Cesium.Color.fromCssColorString('#fde047') : Cesium.Color.WHITE),
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 4,
              showBackground: true,
              backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.92),
              backgroundPadding: new Cesium.Cartesian2(10, 6),
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
              pixelOffset: new Cesium.Cartesian2(16, -58),
              eyeOffset: new Cesium.Cartesian3(0, 0, -500),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, isSelected ? 800000 : 350000),
              heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.RELATIVE_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
        }

        // 1c. Đội hình 4 Bệ Phóng & Cáp Điều Khiển / Datalink (Composite Battery Launchers)
        if (
          inst.compositeBattery &&
          inst.compositeBattery.showLayers?.launchers !== false &&
          inst.compositeBattery.launchers &&
          inst.compositeBattery.launchers.length > 0
        ) {
          inst.compositeBattery.launchers.forEach((launcher) => {
            const launcherPos = Cesium.Cartesian3.fromDegrees(
              launcher.longitude,
              launcher.latitude,
              is2D ? 0 : launcher.altitude || safeAlt
            );

            const isValid = launcher.isValid !== false;
            const cableColor = isValid
              ? Cesium.Color.fromCssColorString('#f59e0b') // Vàng cam hổ phách
              : Cesium.Color.fromCssColorString('#ef4444'); // Đỏ cảnh báo đứt cáp/che khuất

            // Đường cáp điều khiển / Datalink nối từ Tâm Chỉ Huy tới Bệ phóng (chỉ hiện khi zoom < 30km)
            viewer.entities.add({
              name: `Cáp Điều Khiển LN-${launcher.index} (${inst.shortId || ''})`,
              properties: { instanceId: inst.instanceId, isCable: true, launcherId: launcher.id },
              polyline: {
                positions: [radarCartesian, launcherPos],
                width: isValid ? 2.5 : 3.5,
                material: new Cesium.PolylineDashMaterialProperty({
                  color: cableColor,
                  dashLength: 8,
                }),
                clampToGround: true,
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 30000), // Zoom xa tự động ẩn để tránh đè chồng
              },
            });

            // Marker Bệ Phóng LN-1..4 (Tự động co nhỏ theo khoảng cách)
            viewer.entities.add({
              name: `Bệ Phóng LN-${launcher.index} (${inst.shortId || ''})`,
              position: launcherPos,
              properties: {
                instanceId: inst.instanceId,
                isLauncher: true,
                launcherId: launcher.id,
                launcherIndex: launcher.index,
              },
              point: {
                pixelSize: isSelected ? 9 : 7,
                color: isValid
                  ? (isSelected ? Cesium.Color.fromCssColorString('#fde047') : Cesium.Color.fromCssColorString('#f59e0b'))
                  : Cesium.Color.fromCssColorString('#ef4444'),
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                scaleByDistance: new Cesium.NearFarScalar(500, 1.2, 30000, 0.4),
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 30000),
                heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
              label: {
                text: `LN-${launcher.index} (${launcher.distanceToCenterM.toFixed(0)}m)${!isValid ? ' ⚠️' : ''}`,
                font: 'bold 10px "JetBrains Mono", monospace',
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                fillColor: isValid ? Cesium.Color.fromCssColorString('#fde047') : Cesium.Color.fromCssColorString('#f87171'),
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 3,
                showBackground: true,
                backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.85),
                backgroundPadding: new Cesium.Cartesian2(4, 2),
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                pixelOffset: new Cesium.Cartesian2(0, -14),
                eyeOffset: new Cesium.Cartesian3(0, 0, -400),
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8000), // Chỉ hiện nhãn khi zoom gần < 8km
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            });
          });
        }

      // 1b. Mô Hình 3D Khí Tài tại Tâm Toạ Độ trên Địa Hình 3D
      // TẠM THỜI TẮT THEO YÊU CẦU: Tạm thời không thêm mô hình 3D vào mà chỉ chấm điểm đặt (tâm đài & cờ tác chiến).
      // Sau này khi có đầy đủ bộ mô hình chuẩn sẽ kích hoạt lại qua hằng số ENABLE_3D_MODELS.
      if (ENABLE_3D_MODELS && viewMode === '3D' && showModelsLayer) {
        const effectiveModelUrl =
          customModelUrls[inst.instanceId] ||
          inst.model3dUrl ||
          TEMPLATE_BY_ID.get(inst.templateId)?.model3dUrl ||
          (inst.category === 'RadarCanhGioi'
            ? '/models/equipments/radar_3d.glb'
            : inst.category === 'TenLuaPhongKhong'
              ? '/models/equipments/sam_launcher.glb'
              : inst.category === 'SoChiHuy'
                ? '/models/equipments/command_post.glb'
                : inst.category === 'CamBienThuDong'
                  ? '/models/equipments/esm_station.glb'
                  : inst.category === 'PhaoPhongKhong'
                    ? '/models/equipments/aaa_gun.glb'
                    : undefined);

        if (effectiveModelUrl) {
          const baseScale = 25.0; // Tỉ lệ hiển thị chuẩn trên bản đồ địa hình 3D
          const modelScale = (inst.model3dScale || 1.0) * baseScale;
          const altOffset = inst.model3dAltitudeOffset || 0;
          const modelCartesian = Cesium.Cartesian3.fromDegrees(
            inst.longitude,
            inst.latitude,
            safeAlt + altOffset
          );

          const isRadar = inst.category === 'RadarCanhGioi';
          const scanSpeed = inst.scanSpeed || 36; // deg/sec
          const headingOffset = inst.model3dHeadingOffset || 0;

          // Hướng quay: Radar quay quét vòng liên tục theo tốc độ quét, các khí tài khác xoay theo heading offset
          const modelOrientation = isRadar
            ? new Cesium.CallbackProperty((time?: Cesium.JulianDate) => {
                const nowSec = time ? Cesium.JulianDate.toDate(time).getTime() / 1000 : Date.now() / 1000;
                const currentHeading = (headingOffset + nowSec * scanSpeed) % 360;
                const hpr = new Cesium.HeadingPitchRoll(
                  Cesium.Math.toRadians(currentHeading),
                  0,
                  0
                );
                return Cesium.Transforms.headingPitchRollQuaternion(modelCartesian, hpr);
              }, false)
            : Cesium.Transforms.headingPitchRollQuaternion(
                modelCartesian,
                new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(headingOffset), 0, 0)
              );

          viewer.entities.add({
            name: `Mô hình 3D ${inst.name}`,
            position: modelCartesian,
            properties: { instanceId: inst.instanceId, isModel3d: true },
            orientation: modelOrientation,
            model: {
              uri: effectiveModelUrl,
              scale: modelScale,
              minimumPixelSize: 52,
              maximumScale: 160,
              heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 150000),
            },
          });
        }
      }

      // 2. Vòng cự ly Radar (CHỈ vẽ cho khí tài có capability hasRangeRings và khi SPx không kích hoạt)
      if (caps.hasRangeRings && !isSpxActive && safeRangeKm > 0 && showRangeRingsLayer) {
        if (viewMode === '2D') {
          viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, 0),
            properties: { instanceId: inst.instanceId },
            ellipse: {
              semiMajorAxis: safeRangeKm * 1000,
              semiMinorAxis: safeRangeKm * 1000,
              height: 0,
              material: baseColor.withAlpha(isSelected ? 0.15 : 0.06),
              outline: true,
              outlineColor: baseColor.withAlpha(isSelected ? 0.8 : 0.4),
              outlineWidth: isSelected ? 2 : 1,
            },
          });
        } else {
          viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, 0),
            properties: { instanceId: inst.instanceId },
            ellipse: {
              semiMajorAxis: safeRangeKm * 1000,
              semiMinorAxis: safeRangeKm * 1000,
              height: 0,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              classificationType: Cesium.ClassificationType.TERRAIN,
              material: baseColor.withAlpha(isSelected ? 0.15 : 0.06),
              outline: true,
              outlineColor: baseColor.withAlpha(isSelected ? 0.9 : 0.4),
              outlineWidth: isSelected ? 2 : 1,
            },
          });
        }
      }

      // 3. Vùng Hỏa Lực Tiêu Diệt Mục Tiêu (Engagement Envelope cho Tên Lửa Phòng Không SAM và Pháo PK AAA)
      if (caps.hasEngagementEnvelope && safeRangeKm > 0 && showCoverageLayer) {
        const isSAM = inst.category === 'TenLuaPhongKhong';
        const isSpyder = inst.templateId === 'sam_spyder' || !!inst.spyderConfig;
        const spyderCfg = inst.spyderConfig || EQUIPMENT_TEMPLATES.find((t) => t.id === inst.templateId)?.spyderConfig || (isSpyder ? SPYDER_SYSTEM_DEFAULT_CONFIG : undefined);
        const effectiveAltitudeM = inst.targetAltitudeM ?? (isSelected ? (selectedAltitudeM || targetHeightMeters || 500) : (selectedAltitudeM || targetHeightMeters || 500));

        if (isSpyder && spyderCfg) {
          // =========================================================================
          // HIỂN THỊ CHUYÊN BIỆT CHO KHÍ TÀI SPYDER: 2 VÒM (SPYDER-SR VÀ SPYDER-MR)
          // Theo Bảng 1 và Mặt cắt đứng chuẩn (Ảnh 1 & 2):
          // - SPYDER-SR: Tầm ngắn 20km, trần 9km, R_min 1km, màu xanh lục nhạt #10b981
          // - SPYDER-MR: Tầm trung 50km, trần 16km, R_min 2km, màu xanh lam nhạt #0ea5e9
          // =========================================================================
          const mrColorHex = spyderCfg.mr.colorHex || '#0ea5e9';
          const mrColor = Cesium.Color.fromCssColorString(mrColorHex);
          const srColorHex = spyderCfg.sr.colorHex || '#10b981';
          const srColor = Cesium.Color.fromCssColorString(srColorHex);

          const mrRangeKm = spyderCfg.mr.dMaxKm; // 50km
          const mrMinRangeKm = spyderCfg.mr.dMinKm; // 2km
          const mrMaxAltM = spyderCfg.mr.hMaxM; // 16000m
          const srRangeKm = spyderCfg.sr.dMaxKm; // 20km
          const srMinRangeKm = spyderCfg.sr.dMinKm; // 1km
          const srMaxAltM = spyderCfg.sr.hMaxM; // 9000m
          const reactionTimeText = inst.reactionTimeSeconds ? ` | T_pư: ${inst.reactionTimeSeconds}s` : '';
          const isComposite = !!(inst.compositeBattery && inst.batteryConfig);

          // --- 0. LỚP VÒM CHỈ THỊ TAR VÀ ĐIỀU KHIỂN HỎA LỰC FCR CỦA ĐÀI EL/M-2084 MMR (CHO CỤM SPYDER) ---
          if (isComposite && inst.compositeBattery?.showLayers?.tarDome !== false && inst.batteryConfig) {
            const tarRangeKm = inst.batteryConfig.tarRangeKm;
            const tarColor = Cesium.Color.fromCssColorString(COMPOSITE_DOME_STYLES.tar.colorHex);
            const tarSpx = spxResults[`${inst.instanceId}_tar`];

            // 0a. Đa giác cắt địa hình thực tế (nếu đã tính toán qua SPx)
            if (tarSpx && tarSpx.contours && tarSpx.contours.length > 0) {
              const topContour = tarSpx.contours[tarSpx.contours.length - 1];
              if (topContour && topContour.polygonPositions.length > 2) {
                const polygonPositions = topContour.polygonPositions.map((p) =>
                  Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0)
                );
                viewer.entities.add({
                  name: `Vùng Quét TAR Cắt Địa Hình ${inst.shortId || ''}`,
                  properties: { instanceId: inst.instanceId, domeType: 'tar_dome' },
                  polygon: {
                    hierarchy: new Cesium.PolygonHierarchy(polygonPositions),
                    heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                    classificationType: is2D ? undefined : Cesium.ClassificationType.TERRAIN,
                    material: tarColor.withAlpha(0.12),
                    outline: true,
                    outlineColor: tarColor.withAlpha(0.75),
                    outlineWidth: 1.5,
                  },
                });
              }
            }

            // 0b. Vòng danh nghĩa tối đa lý thuyết (faint outline)
            viewer.entities.add({
              name: `Vòng Chỉ Thị TAR Danh Nghĩa ${inst.shortId || ''}`,
              position: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, 0),
              properties: { instanceId: inst.instanceId, domeType: 'tar_dome' },
              ellipse: {
                semiMajorAxis: tarRangeKm * 1000,
                semiMinorAxis: tarRangeKm * 1000,
                height: 0,
                heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                classificationType: is2D ? undefined : Cesium.ClassificationType.TERRAIN,
                material: tarColor.withAlpha(tarSpx ? 0.02 : 0.06),
                outline: true,
                outlineColor: tarColor.withAlpha(0.40),
                outlineWidth: 1.0,
              },
            });

            const tarLabelPos = destinationPoint(inst.latitude, inst.longitude, tarRangeKm * 1000, 330);
            viewer.entities.add({
              name: `Nhãn TAR ${inst.shortId || ''}`,
              position: Cesium.Cartesian3.fromDegrees(tarLabelPos.lon, tarLabelPos.lat, is2D ? 0 : safeAlt),
              properties: { instanceId: inst.instanceId },
              label: {
                text: `[TAR] ${inst.batteryConfig.tarRadarName} (${tarRangeKm}km)`,
                font: '10px "JetBrains Mono", monospace',
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                fillColor: tarColor,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 3,
                showBackground: true,
                backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.85),
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 500000),
                heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            });
          }



          // 1. VÙNG HỎA LỰC TẦM TRUNG SPYDER-MR (50KM) - 2D
          viewer.entities.add({
            name: `Vùng Hỏa Lực SPYDER-MR ${inst.shortId || ''}`,
            position: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, 0),
            properties: { instanceId: inst.instanceId, domeType: 'spyder_mr' },
            ellipse: {
              semiMajorAxis: mrRangeKm * 1000,
              semiMinorAxis: mrRangeKm * 1000,
              height: 0,
              heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
              classificationType: is2D ? undefined : Cesium.ClassificationType.TERRAIN,
              material: mrColor.withAlpha(isSelected ? 0.16 : 0.05),
              outline: true,
              outlineColor: mrColor.withAlpha(isSelected ? 0.95 : 0.65),
              outlineWidth: isSelected ? 3 : 1.5,
            },
          });

          if (is2D && mrMinRangeKm > 0) {
            viewer.entities.add({
              name: `Nón Mù SPYDER-MR R_min ${inst.shortId || ''}`,
              position: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, 0),
              properties: { instanceId: inst.instanceId },
              ellipse: {
                semiMajorAxis: mrMinRangeKm * 1000,
                semiMinorAxis: mrMinRangeKm * 1000,
                height: 0,
                heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                classificationType: is2D ? undefined : Cesium.ClassificationType.TERRAIN,
                material: Cesium.Color.BLACK.withAlpha(0.3),
                outline: true,
                outlineColor: mrColor.withAlpha(0.85),
                outlineWidth: 1.5,
              },
            });
          }

          const mrBoundaryPoint = destinationPoint(inst.latitude, inst.longitude, mrRangeKm * 1000, 0);
          viewer.entities.add({
            name: `Nhãn SPYDER-MR ${inst.shortId || ''}`,
            position: Cesium.Cartesian3.fromDegrees(mrBoundaryPoint.lon, mrBoundaryPoint.lat, is2D ? 0 : safeAlt),
            properties: { instanceId: inst.instanceId },
            label: {
              text: `VÙNG HỎA LỰC [SPYDER-MR: ${mrMinRangeKm}-${mrRangeKm}km | H_max: ${(mrMaxAltM / 1000).toFixed(0)}km${reactionTimeText}]`,
              font: isSelected ? 'bold 11px "JetBrains Mono", monospace' : '10px "JetBrains Mono", monospace',
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              fillColor: isSelected ? Cesium.Color.fromCssColorString('#fde047') : mrColor,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 3,
              showBackground: true,
              backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.85),
              backgroundPadding: new Cesium.Cartesian2(6, 3),
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, isSelected ? 600000 : 300000),
              heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });

          // 2. VÙNG HỎA LỰC TẦM NGẮN SPYDER-SR (20KM) - 2D
          viewer.entities.add({
            name: `Vùng Hỏa Lực SPYDER-SR ${inst.shortId || ''}`,
            position: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, 0),
            properties: { instanceId: inst.instanceId, domeType: 'spyder_sr' },
            ellipse: {
              semiMajorAxis: srRangeKm * 1000,
              semiMinorAxis: srRangeKm * 1000,
              height: 0,
              heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
              classificationType: is2D ? undefined : Cesium.ClassificationType.TERRAIN,
              material: srColor.withAlpha(isSelected ? 0.22 : 0.08),
              outline: true,
              outlineColor: srColor.withAlpha(isSelected ? 0.95 : 0.75),
              outlineWidth: isSelected ? 3 : 1.8,
            },
          });

          if (is2D && srMinRangeKm > 0) {
            viewer.entities.add({
              name: `Nón Mù SPYDER-SR R_min ${inst.shortId || ''}`,
              position: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, 0),
              properties: { instanceId: inst.instanceId },
              ellipse: {
                semiMajorAxis: srMinRangeKm * 1000,
                semiMinorAxis: srMinRangeKm * 1000,
                height: 0,
                heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                classificationType: is2D ? undefined : Cesium.ClassificationType.TERRAIN,
                material: Cesium.Color.BLACK.withAlpha(0.35),
                outline: true,
                outlineColor: srColor.withAlpha(0.9),
                outlineWidth: 1.5,
              },
            });
          }

          const srBoundaryPoint = destinationPoint(inst.latitude, inst.longitude, srRangeKm * 1000, 45);
          viewer.entities.add({
            name: `Nhãn SPYDER-SR ${inst.shortId || ''}`,
            position: Cesium.Cartesian3.fromDegrees(srBoundaryPoint.lon, srBoundaryPoint.lat, is2D ? 0 : safeAlt),
            properties: { instanceId: inst.instanceId },
            label: {
              text: `VÙNG HỎA LỰC [SPYDER-SR: ${srMinRangeKm}-${srRangeKm}km | H_max: ${(srMaxAltM / 1000).toFixed(0)}km]`,
              font: isSelected ? 'bold 11px "JetBrains Mono", monospace' : '10px "JetBrains Mono", monospace',
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              fillColor: isSelected ? Cesium.Color.fromCssColorString('#a7f3d0') : srColor,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 3,
              showBackground: true,
              backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.85),
              backgroundPadding: new Cesium.Cartesian2(6, 3),
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, isSelected ? 600000 : 300000),
              heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });

          // 3. HIỂN THỊ VÒM 3D (MR 50km & SR 20km)
          if (viewMode === '3D' && showAllDomes && inst.showDome) {
            // Vòng chân vòm MR 50km
            const mrRingPositions: Cesium.Cartesian3[] = [];
            for (let deg = 0; deg <= 360; deg += 10) {
              const dest = destinationPoint(inst.latitude, inst.longitude, mrRangeKm * 1000, deg);
              mrRingPositions.push(Cesium.Cartesian3.fromDegrees(dest.lon, dest.lat, safeAlt + 15));
            }
            viewer.entities.add({
              name: `Vòng Giới Hạn SPYDER-MR 3D ${inst.shortId || ''}`,
              properties: { instanceId: inst.instanceId },
              polyline: {
                positions: mrRingPositions,
                width: isSelected ? 3 : 2,
                material: new Cesium.PolylineGlowMaterialProperty({
                  color: mrColor,
                  glowPower: isSelected ? 0.35 : 0.15,
                }),
              },
            });

            // Vòng chân vòm SR 20km
            const srRingPositions: Cesium.Cartesian3[] = [];
            for (let deg = 0; deg <= 360; deg += 10) {
              const dest = destinationPoint(inst.latitude, inst.longitude, srRangeKm * 1000, deg);
              srRingPositions.push(Cesium.Cartesian3.fromDegrees(dest.lon, dest.lat, safeAlt + 15));
            }
            viewer.entities.add({
              name: `Vòng Giới Hạn SPYDER-SR 3D ${inst.shortId || ''}`,
              properties: { instanceId: inst.instanceId },
              polyline: {
                positions: srRingPositions,
                width: isSelected ? 3 : 2,
                material: new Cesium.PolylineGlowMaterialProperty({
                  color: srColor,
                  glowPower: isSelected ? 0.35 : 0.15,
                }),
              },
            });

            // Vòm thể tích 3D
            const samVol = samVolumes[inst.instanceId];
            if (samVol && samVol.isSpyderDualDome && samVol.spyderSrVolume) {
              // Vòm MR 50km (ngoài, xanh lam nhạt)
              const mrGeom = buildSamLayerGeometry(samVol, 'outer_boundary', {
                mode: dome3DMode,
                showInnerCone: false,
                showTopCap: true,
                showBottomCap: true,
                verticalExaggeration: terrainExaggeration,
              });
              if (mrGeom) {
                const mrTerrainMaskParams = (dome3DMode === 'terrain-aware' && samVol.terrainGrid) ? {
                  volume: samVol as any,
                  modelMatrix: mrGeom.modelMatrix,
                  verticalExaggeration: terrainExaggeration,
                } : undefined;

                const mrMat = createRadarDomeMaterial({
                  baseColor: mrColor.withAlpha(isSelected ? 0.30 : 0.18),
                  rimColor: Cesium.Color.fromCssColorString('#38bdf8'),
                  rimPower: 2.0,
                  scanLineCount: 16,
                  scanLineSpeed: 0,
                  terrainMask: mrTerrainMaskParams,
                });
                const mrPrim = new Cesium.Primitive({
                  geometryInstances: createSamVolumeGeometryInstance(mrGeom, `${inst.instanceId}_mr`, 'outer_boundary'),
                  appearance: new Cesium.MaterialAppearance({
                    material: mrMat,
                    flat: true,
                    faceForward: false,
                    closed: false,
                    translucent: true,
                    renderState: {
                      cull: { enabled: false },
                      depthTest: { enabled: true },
                      depthMask: false,
                      blending: Cesium.BlendingState.ALPHA_BLEND,
                    },
                  }),
                  asynchronous: false,
                  allowPicking: false,
                  compressVertices: false,
                });
                viewer.scene.primitives.add(mrPrim);
                domeResourcesRef.current.push({ primitive: mrPrim, material: mrMat });
              }

              // Vòm SR 20km (trong, xanh lục nhạt)
              const srGeom = buildSamLayerGeometry(samVol.spyderSrVolume, 'outer_boundary', {
                mode: dome3DMode,
                showInnerCone: false,
                showTopCap: true,
                showBottomCap: true,
                verticalExaggeration: terrainExaggeration,
              });
              if (srGeom) {
                const srTerrainMaskParams = (dome3DMode === 'terrain-aware' && samVol.spyderSrVolume?.terrainGrid) ? {
                  volume: samVol.spyderSrVolume as any,
                  modelMatrix: srGeom.modelMatrix,
                  verticalExaggeration: terrainExaggeration,
                } : undefined;

                const srMat = createRadarDomeMaterial({
                  baseColor: srColor.withAlpha(isSelected ? 0.38 : 0.25),
                  rimColor: Cesium.Color.fromCssColorString('#34d399'),
                  rimPower: 2.2,
                  scanLineCount: 16,
                  scanLineSpeed: 0,
                  terrainMask: srTerrainMaskParams,
                });
                const srPrim = new Cesium.Primitive({
                  geometryInstances: createSamVolumeGeometryInstance(srGeom, `${inst.instanceId}_sr`, 'outer_boundary'),
                  appearance: new Cesium.MaterialAppearance({
                    material: srMat,
                    flat: true,
                    faceForward: false,
                    closed: false,
                    translucent: true,
                    renderState: {
                      cull: { enabled: false },
                      depthTest: { enabled: true },
                      depthMask: false,
                      blending: Cesium.BlendingState.ALPHA_BLEND,
                    },
                  }),
                  asynchronous: false,
                  allowPicking: false,
                  compressVertices: false,
                });
                viewer.scene.primitives.add(srPrim);
                domeResourcesRef.current.push({ primitive: srPrim, material: srMat });
              }
            } else {
              // Fallback khi volume đang tính toán
              const centerPos = Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, safeAlt + safeAntennaAGL);
              const ribCount = 8;
              for (let r = 0; r < ribCount; r++) {
                const az = (r * 360) / ribCount;
                const destMR = destinationPoint(inst.latitude, inst.longitude, mrRangeKm * 1000, az);
                const midDestMR = destinationPoint(inst.latitude, inst.longitude, mrRangeKm * 1000 * 0.65, az);
                viewer.entities.add({
                  name: `Nan SPYDER-MR 3D ${az}° ${inst.shortId || ''}`,
                  properties: { instanceId: inst.instanceId },
                  polyline: {
                    positions: [
                      centerPos,
                      Cesium.Cartesian3.fromDegrees(midDestMR.lon, midDestMR.lat, safeAlt + mrMaxAltM * 0.85),
                      Cesium.Cartesian3.fromDegrees(destMR.lon, destMR.lat, safeAlt + 15),
                    ],
                    width: isSelected ? 1.8 : 1.2,
                    material: mrColor.withAlpha(0.5),
                  },
                });

                const destSR = destinationPoint(inst.latitude, inst.longitude, srRangeKm * 1000, az);
                const midDestSR = destinationPoint(inst.latitude, inst.longitude, srRangeKm * 1000 * 0.65, az);
                viewer.entities.add({
                  name: `Nan SPYDER-SR 3D ${az}° ${inst.shortId || ''}`,
                  properties: { instanceId: inst.instanceId },
                  polyline: {
                    positions: [
                      centerPos,
                      Cesium.Cartesian3.fromDegrees(midDestSR.lon, midDestSR.lat, safeAlt + srMaxAltM * 0.85),
                      Cesium.Cartesian3.fromDegrees(destSR.lon, destSR.lat, safeAlt + 15),
                    ],
                    width: isSelected ? 1.8 : 1.2,
                    material: srColor.withAlpha(0.6),
                  },
                });
              }
            }

            // Vòm Mesh 3D TAR & FCR (Đài EL/M-2084 MMR) nếu SPYDER là Tổ hợp Composite
            if (isComposite && inst.batteryConfig) {
              const spyderSamVol = samVolumes[inst.instanceId];
              // 1. Vòm 3D Mesh TAR (120km, Xanh dương nhẹ, alpha 0.10)
              if (inst.compositeBattery?.showLayers?.tarDome !== false) {
                const tarColor = Cesium.Color.fromCssColorString(COMPOSITE_DOME_STYLES.tar.colorHex);
                const tarFakeInstance: EquipmentInstance = {
                  ...inst,
                  instanceId: `${inst.instanceId}_tar`,
                  rangeKm: inst.batteryConfig.tarRangeKm,
                  coverageHeightKm: inst.batteryConfig.tarHeightKm,
                  antennaHeightAGL: safeAntennaAGL,
                  minElevationDeg: 0.5,
                  maxElevationDeg: 55,
                };
                const tarVol = coverageVolumes[`${inst.instanceId}_tar`];
                let tarGeom: any = null;
                let tarGeomInstance: Cesium.GeometryInstance | null = null;

                if (tarVol) {
                  tarGeom = buildRadarVolumeGeometry(tarVol, {
                    mode: dome3DMode,
                    showInnerCone: showConeOfSilence,
                    selectedAltitudeM: effectiveAltitudeM,
                  });
                  if (tarGeom) {
                    tarGeomInstance = createRadarVolumeGeometryInstance(tarGeom, `${inst.instanceId}_tar`);
                  }
                }

                if (!tarGeom) {
                  tarGeom = buildRadarDomeGeometry(tarFakeInstance, null, {
                    azimuthSegments: 36,
                    elevationRings: 12,
                  });
                  if (tarGeom) {
                    tarGeomInstance = createRadarDomeGeometryInstance(tarGeom);
                  }
                }

                if (tarGeom && tarGeomInstance) {
                  const tarTerrainMaskParams = (dome3DMode === 'terrain-aware' && (tarVol?.terrainGrid || spyderSamVol?.terrainGrid)) ? {
                    volume: (tarVol || spyderSamVol) as any,
                    modelMatrix: tarGeom.modelMatrix,
                    verticalExaggeration: terrainExaggeration,
                  } : undefined;

                  const tarMat = createRadarDomeMaterial({
                    baseColor: tarColor.withAlpha(COMPOSITE_DOME_STYLES.tar.alpha),
                    rimColor: Cesium.Color.fromCssColorString(COMPOSITE_DOME_STYLES.tar.outlineColorHex),
                    rimPower: 2.0,
                    scanLineCount: 16,
                    scanLineSpeed: 0,
                    terrainMask: tarTerrainMaskParams,
                  });
                  const tarPrim = new Cesium.Primitive({
                    geometryInstances: tarGeomInstance,
                    appearance: new Cesium.MaterialAppearance({
                      material: tarMat,
                      flat: true,
                      faceForward: false,
                      closed: false,
                      translucent: true,
                      renderState: {
                        cull: { enabled: false },
                        depthTest: { enabled: true },
                        depthMask: false,
                        blending: Cesium.BlendingState.ALPHA_BLEND,
                      },
                    }),
                    asynchronous: false,
                    allowPicking: false,
                    compressVertices: false,
                  });
                  viewer.scene.primitives.add(tarPrim);
                  domeResourcesRef.current.push({ primitive: tarPrim, material: tarMat });
                }
              }


            }
          }
        } else {
          // =========================================================================
          // CÁC TỔ HỢP SAM TIÊU CHUẨN (C-125 Pechora, S-300, Shilka...): VÒM ĐƠN ĐẶC THÙ & CỤM 3 LỚP
          // =========================================================================
          const isComposite = !!(inst.compositeBattery && inst.batteryConfig);
          const envColorHex = isSAM ? (inst.color || '#ef4444') : '#10b981';
          const envColor = Cesium.Color.fromCssColorString(envColorHex);
          const minRangeKm = typeof inst.minEngagementRangeKm === 'number' && inst.minEngagementRangeKm > 0
            ? inst.minEngagementRangeKm
            : (isSAM ? (safeRangeKm > 100 ? 3 : 1) : 0.2);
          const maxAltM = typeof inst.maxEngagementAltitudeM === 'number' && inst.maxEngagementAltitudeM > 0
            ? inst.maxEngagementAltitudeM
            : (inst.coverageHeightKm ? inst.coverageHeightKm * 1000 : (isSAM ? 25000 : 3000));
          const reactionTimeText = inst.reactionTimeSeconds ? ` | T_pư: ${inst.reactionTimeSeconds}s` : '';
          const samCov = isSAM ? samCoverageResults[inst.instanceId] : null;
          const radarInfo = samCov?.linkedRadarName ? ` | Hiệp đồng: ${samCov.linkedRadarName}` : '';
          const envLabelText = isSAM
            ? `VÙNG HỎA LỰC [${inst.shortId || 'SAM'}: ${minRangeKm}-${safeRangeKm}km | H_max: ${(maxAltM / 1000).toFixed(0)}km${reactionTimeText}${radarInfo}]`
            : `HỎA LỰC PHÁO PK [${inst.shortId || 'AAA'}: ${minRangeKm}-${safeRangeKm}km | H_max: ${(maxAltM / 1000).toFixed(1)}km]`;

          // --- 1. LỚP VÒM CHỈ THỊ TAR (MÀU XANH LỤC RADAR CẢNH GIỚI) 2D CHO CỤM TỔ HỢP ---
          if (isComposite && inst.compositeBattery?.showLayers?.tarDome !== false && inst.batteryConfig) {
            const tarRangeKm = inst.batteryConfig.tarRangeKm;
            const tarColor = Cesium.Color.fromCssColorString(COMPOSITE_DOME_STYLES.tar.colorHex);
            const tarSpx = spxResults[`${inst.instanceId}_tar`];

            // 1a. Đa giác cắt địa hình thực tế (nếu đã tính toán qua SPx)
            if (tarSpx && tarSpx.contours && tarSpx.contours.length > 0) {
              const topContour = tarSpx.contours[tarSpx.contours.length - 1];
              if (topContour && topContour.polygonPositions.length > 2) {
                const polygonPositions = topContour.polygonPositions.map((p) =>
                  Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0)
                );
                viewer.entities.add({
                  name: `Vùng Quét TAR Cắt Địa Hình ${inst.shortId || ''}`,
                  properties: { instanceId: inst.instanceId, domeType: 'tar_dome' },
                  polygon: {
                    hierarchy: new Cesium.PolygonHierarchy(polygonPositions),
                    heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                    classificationType: is2D ? undefined : Cesium.ClassificationType.TERRAIN,
                    material: tarColor.withAlpha(0.12),
                    outline: true,
                    outlineColor: tarColor.withAlpha(0.75),
                    outlineWidth: 1.5,
                  },
                });
              }
            }

            // 1b. Vòng danh nghĩa tối đa lý thuyết (faint outline)
            viewer.entities.add({
              name: `Vòng Chỉ Thị TAR Danh Nghĩa ${inst.shortId || ''}`,
              position: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, 0),
              properties: { instanceId: inst.instanceId, domeType: 'tar_dome' },
              ellipse: {
                semiMajorAxis: tarRangeKm * 1000,
                semiMinorAxis: tarRangeKm * 1000,
                height: 0,
                heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                classificationType: is2D ? undefined : Cesium.ClassificationType.TERRAIN,
                material: tarColor.withAlpha(tarSpx ? 0.02 : 0.06),
                outline: true,
                outlineColor: tarColor.withAlpha(0.40),
                outlineWidth: 1.0,
              },
            });

            const tarLabelPos = destinationPoint(inst.latitude, inst.longitude, tarRangeKm * 1000, 330);
            viewer.entities.add({
              name: `Nhãn TAR ${inst.shortId || ''}`,
              position: Cesium.Cartesian3.fromDegrees(tarLabelPos.lon, tarLabelPos.lat, is2D ? 0 : safeAlt),
              properties: { instanceId: inst.instanceId },
              label: {
                text: `[TAR] ${inst.batteryConfig.tarRadarName} (${tarRangeKm}km)`,
                font: '10px "JetBrains Mono", monospace',
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                fillColor: tarColor,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 3,
                showBackground: true,
                backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.85),
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 500000),
                heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            });
          }

          // --- 2. LỚP VÙNG HỎA LỰC WEZ (ĐỎ ĐẬM) 2D CHO CỤM TỔ HỢP ---
          const showWez = !isComposite || inst.compositeBattery?.showLayers?.wezDome !== false;
          if (showWez) {
            const wezMaxRadiusM = safeRangeKm * 1000;
            const isLowAltitude = Boolean(effectiveAltitudeM && effectiveAltitudeM <= 1000);

            // Trích xuất lát cắt cự ly 2D tại effectiveAltitudeM từ samVol (hoặc samCov)
            let wez2DPositions: Array<{ lon: number; lat: number }> | null = null;
            const currentSamVol = samVolumes[inst.instanceId];

            if (currentSamVol && currentSamVol.effectiveRanges && currentSamVol.effectiveRanges.length > 0) {
              const targetAltRelM = Math.max(0, effectiveAltitudeM);
              let closestBand = 0;
              let minDiff = Infinity;
              for (let b = 0; b < currentSamVol.altitudeBands.length; b++) {
                const bandAltRel = currentSamVol.altitudeBands[b] - (currentSamVol.centerAltM || 0);
                const diff = Math.abs(bandAltRel - targetAltRelM);
                if (diff < minDiff) {
                  minDiff = diff;
                  closestBand = b;
                }
              }
              const azCount = currentSamVol.azimuthSamples.length;
              const pts: Array<{ lon: number; lat: number }> = [];
              for (let j = 0; j < azCount; j++) {
                const az = currentSamVol.azimuthSamples[j];
                const r = currentSamVol.effectiveRanges[closestBand]?.[j] ?? wezMaxRadiusM;
                const dest = destinationPoint(inst.latitude, inst.longitude, r, az);
                pts.push(dest);
              }
              if (pts.length >= 3) {
                wez2DPositions = pts;
              }
            } else if (samCov && samCov.polygonPositions && samCov.polygonPositions.length >= 3) {
              wez2DPositions = samCov.polygonPositions;
            }

            // 1. Đa giác hỏa lực đã cắt địa hình & kìm hãm theo radar (ôm sát sườn núi mượt mà, không tia nhọn)
            if (wez2DPositions && wez2DPositions.length >= 3) {
              const polyCartesians = wez2DPositions.map((p) =>
                Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0)
              );

              viewer.entities.add({
                name: `Vùng Hỏa Lực Cắt Địa Hình ${inst.shortId || ''}`,
                properties: { instanceId: inst.instanceId, isSamCoverage: true },
                polygon: {
                  hierarchy: new Cesium.PolygonHierarchy(polyCartesians),
                  heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                  classificationType: is2D ? undefined : Cesium.ClassificationType.TERRAIN,
                  material: envColor.withAlpha(isSelected ? 0.38 : 0.24),
                  zIndex: 35,
                },
              });

              // Viền sắc nét ôm theo sườn núi
              viewer.entities.add({
                name: `Viền Hỏa Lực Cắt Địa Hình ${inst.shortId || ''}`,
                properties: { instanceId: inst.instanceId },
                polyline: {
                  positions: polyCartesians,
                  width: isSelected ? 3.0 : 2.0,
                  material: envColor.withAlpha(isSelected ? 0.95 : 0.85),
                  clampToGround: true,
                },
              });

              // Vòng danh nghĩa hỏa lực tối đa lý thuyết (chỉ hiển thị khi khảo sát ở độ cao lớn > 1000m)
              if (!isLowAltitude) {
                viewer.entities.add({
                  name: `Vòng Danh Nghĩa Hỏa Lực Tối Đa ${inst.shortId || ''}`,
                  position: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, 0),
                  properties: { instanceId: inst.instanceId },
                  ellipse: {
                    semiMajorAxis: wezMaxRadiusM,
                    semiMinorAxis: wezMaxRadiusM,
                    height: 0,
                    heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                    classificationType: is2D ? undefined : Cesium.ClassificationType.TERRAIN,
                    material: envColor.withAlpha(0.02),
                    outline: true,
                    outlineColor: envColor.withAlpha(0.30),
                    outlineWidth: 1.0,
                  },
                });
              }
            } else {
              // Vùng hỏa lực tiêu diệt ngoại vi (R_kill) - Fallback tròn 360°
              viewer.entities.add({
                name: `Vùng Hỏa Lực ${inst.shortId || ''}`,
                position: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, 0),
                properties: { instanceId: inst.instanceId },
                ellipse: {
                  semiMajorAxis: safeRangeKm * 1000,
                  semiMinorAxis: safeRangeKm * 1000,
                  height: 0,
                  heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                  classificationType: is2D ? undefined : Cesium.ClassificationType.TERRAIN,
                  material: envColor.withAlpha(isSelected ? 0.25 : 0.12),
                  outline: true,
                  outlineColor: envColor.withAlpha(isSelected ? 0.95 : 0.7),
                  outlineWidth: isSelected ? 3 : 1.8,
                },
              });
            }

            // Vòng đón hỏa lực cực đại R_launch_max (toàn phương 360°)
            const maxLaunchRange = inst.batteryConfig?.maxLaunchRangeKm || inst.maxLaunchRangeKm;
            if (maxLaunchRange && maxLaunchRange > safeRangeKm && !isLowAltitude) {
              viewer.entities.add({
                name: `Vòng Đón Hỏa Lực R_launch_max ${inst.shortId || ''}`,
                position: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, 0),
                properties: { instanceId: inst.instanceId },
                ellipse: {
                  semiMajorAxis: maxLaunchRange * 1000,
                  semiMinorAxis: maxLaunchRange * 1000,
                  height: 0,
                  heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                  classificationType: is2D ? undefined : Cesium.ClassificationType.TERRAIN,
                  material: Cesium.Color.TRANSPARENT,
                  outline: true,
                  outlineColor: Cesium.Color.fromCssColorString('#dc2626').withAlpha(0.85),
                  outlineWidth: 1.5,
                },
              });
            }

            // Nón chết cự ly cực cận (R_min)
            if (minRangeKm > 0 && minRangeKm < safeRangeKm) {
              viewer.entities.add({
                name: `Nón Mù Cực Cận R_min ${inst.shortId || ''}`,
                position: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, 0),
                properties: { instanceId: inst.instanceId },
                ellipse: {
                  semiMajorAxis: minRangeKm * 1000,
                  semiMinorAxis: minRangeKm * 1000,
                  height: 0,
                  heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                  classificationType: is2D ? undefined : Cesium.ClassificationType.TERRAIN,
                  material: Cesium.Color.BLACK.withAlpha(0.35),
                  outline: true,
                  outlineColor: Cesium.Color.fromCssColorString('#f43f5e').withAlpha(0.85),
                  outlineWidth: 1.8,
                },
              });
            }

            // Nhãn biên giới cự ly hỏa lực (Toàn phương 360°)
            const boundaryPoint = destinationPoint(inst.latitude, inst.longitude, safeRangeKm * 1000, 0);
            viewer.entities.add({
              name: `Nhãn Hỏa Lực ${inst.shortId || ''}`,
              position: Cesium.Cartesian3.fromDegrees(boundaryPoint.lon, boundaryPoint.lat, is2D ? 0 : safeAlt),
              properties: { instanceId: inst.instanceId },
              label: {
                text: envLabelText,
                font: isSelected ? 'bold 11px "JetBrains Mono", monospace' : '10px "JetBrains Mono", monospace',
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                fillColor: isSelected ? Cesium.Color.fromCssColorString('#fde047') : envColor,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 3,
                showBackground: true,
                backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.85),
                backgroundPadding: new Cesium.Cartesian2(6, 3),
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, isSelected ? 600000 : 300000),
                heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            });
          }

          // --- 4. HIỂN THỊ VÒM 3D (3-LAYER COMPOSITE & WEZ) ---
          if (viewMode === '3D' && showAllDomes && inst.showDome) {
            const centerPos = Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, safeAlt + safeAntennaAGL);
            const samVol = samVolumes[inst.instanceId];

            // A. Lớp 3D Vòm TAR (Xanh dương - Mesh 3D bán trong suốt alpha 0.10)
            if (isComposite && inst.compositeBattery?.showLayers?.tarDome !== false && inst.batteryConfig) {
              const tarRadiusM = inst.batteryConfig.tarRangeKm * 1000;
              const tarColor = Cesium.Color.fromCssColorString(COMPOSITE_DOME_STYLES.tar.colorHex);

              const tarRingPositions: Cesium.Cartesian3[] = [];
              for (let deg = 0; deg <= 360; deg += 12) {
                const dest = destinationPoint(inst.latitude, inst.longitude, tarRadiusM, deg);
                tarRingPositions.push(Cesium.Cartesian3.fromDegrees(dest.lon, dest.lat, safeAlt + 15));
              }
              viewer.entities.add({
                name: `Vòng Chân Vòm TAR 3D ${inst.shortId || ''}`,
                properties: { instanceId: inst.instanceId },
                polyline: {
                  positions: tarRingPositions,
                  width: 1.5,
                  material: new Cesium.PolylineGlowMaterialProperty({
                    color: tarColor,
                    glowPower: 0.15,
                  }),
                },
              });

              // Bề mặt Vòm 3D Mesh TAR (Xanh dương nhẹ nhất alpha 0.10)
              const tarFakeInstance: EquipmentInstance = {
                ...inst,
                instanceId: `${inst.instanceId}_tar`,
                rangeKm: inst.batteryConfig.tarRangeKm,
                coverageHeightKm: inst.batteryConfig.tarHeightKm,
                antennaHeightAGL: safeAntennaAGL,
                minElevationDeg: 0.5,
                maxElevationDeg: 55,
              };
              const tarVol = coverageVolumes[`${inst.instanceId}_tar`];
              let tarGeom: any = null;
              let tarGeomInstance: Cesium.GeometryInstance | null = null;

              if (tarVol) {
                tarGeom = buildRadarVolumeGeometry(tarVol, {
                  mode: dome3DMode,
                  showInnerCone: showConeOfSilence,
                  selectedAltitudeM: effectiveAltitudeM,
                });
                if (tarGeom) {
                  tarGeomInstance = createRadarVolumeGeometryInstance(tarGeom, `${inst.instanceId}_tar`);
                }
              }

              if (!tarGeom) {
                tarGeom = buildRadarDomeGeometry(tarFakeInstance, null, {
                  azimuthSegments: 36,
                  elevationRings: 12,
                });
                if (tarGeom) {
                  tarGeomInstance = createRadarDomeGeometryInstance(tarGeom);
                }
              }

              if (tarGeom && tarGeomInstance) {
                const tarTerrainMaskParams = (dome3DMode === 'terrain-aware' && (tarVol?.terrainGrid || samVol?.terrainGrid)) ? {
                  volume: (tarVol || samVol) as any,
                  modelMatrix: tarGeom.modelMatrix,
                  verticalExaggeration: terrainExaggeration,
                } : undefined;

                const tarMat = createRadarDomeMaterial({
                  baseColor: tarColor.withAlpha(COMPOSITE_DOME_STYLES.tar.alpha),
                  rimColor: Cesium.Color.fromCssColorString(COMPOSITE_DOME_STYLES.tar.outlineColorHex),
                  rimPower: 2.0,
                  scanLineCount: 16,
                  scanLineSpeed: 0,
                  terrainMask: tarTerrainMaskParams,
                });
                const tarPrim = new Cesium.Primitive({
                  geometryInstances: tarGeomInstance,
                  appearance: new Cesium.MaterialAppearance({
                    material: tarMat,
                    flat: true,
                    faceForward: false,
                    closed: false,
                    translucent: true,
                    renderState: {
                      cull: { enabled: false },
                      depthTest: { enabled: true },
                      depthMask: false,
                      blending: Cesium.BlendingState.ALPHA_BLEND,
                    },
                  }),
                  asynchronous: false,
                  allowPicking: false,
                  compressVertices: false,
                });
                viewer.scene.primitives.add(tarPrim);
                domeResourcesRef.current.push({ primitive: tarPrim, material: tarMat });
              }

              // Vòng tròn lát cắt ngang độ cao cho Vòm TAR 3D (Altitude Slice Ring)
              if (effectiveAltitudeM && effectiveAltitudeM > 0) {
                const tarSliceAlt = safeAlt + effectiveAltitudeM;
                const tarSlicePositions: Cesium.Cartesian3[] = [];
                for (let deg = 0; deg <= 360; deg += 4) {
                  const dest = destinationPoint(inst.latitude, inst.longitude, tarRadiusM, deg);
                  tarSlicePositions.push(Cesium.Cartesian3.fromDegrees(dest.lon, dest.lat, tarSliceAlt));
                }
                viewer.entities.add({
                  name: `Lát Cắt Độ Cao TAR 3D ${inst.shortId || ''}`,
                  properties: { instanceId: inst.instanceId },
                  polyline: {
                    positions: tarSlicePositions,
                    width: 2.0,
                    material: new Cesium.PolylineGlowMaterialProperty({
                      color: tarColor.withAlpha(0.85),
                      glowPower: 0.25,
                    }),
                  },
                });
              }
            }

            // B. Lớp 3D Vùng Hỏa Lực WEZ (Đỏ đậm nổi bật nhất alpha 0.38)
            if (showWez) {
              const radiusMeters = safeRangeKm * 1000;
              const domeColor = envColor.withAlpha(isSelected ? 0.45 : COMPOSITE_DOME_STYLES.wez.alpha);
              const ribCount = 8;
              const isLowAltitude = Boolean(effectiveAltitudeM && effectiveAltitudeM <= 1000);

              // Vòng chân vòm cự ly tối đa 3D toàn phương 360° (chỉ hiện khi khảo sát độ cao lớn > 1000m)
              if (!isLowAltitude) {
                const ringPositions: Cesium.Cartesian3[] = [];
                const ringStep = 4;
                for (let deg = 0; deg <= 360; deg += ringStep) {
                  const dest = destinationPoint(inst.latitude, inst.longitude, radiusMeters, deg);
                  ringPositions.push(Cesium.Cartesian3.fromDegrees(dest.lon, dest.lat, safeAlt + 15));
                }

                viewer.entities.add({
                  name: `Vòng Giới Hạn Hỏa Lực 3D ${inst.shortId || ''}`,
                  properties: { instanceId: inst.instanceId },
                  polyline: {
                    positions: ringPositions,
                    width: isSelected ? 2.5 : 1.5,
                    material: new Cesium.PolylineGlowMaterialProperty({
                      color: envColor,
                      glowPower: isSelected ? 0.35 : 0.15,
                    }),
                  },
                });

                // Vòng đón hỏa lực cực đại R_launch_max nét đứt trên 3D
                const maxLaunchRange = inst.batteryConfig?.maxLaunchRangeKm || inst.maxLaunchRangeKm;
                if (maxLaunchRange && maxLaunchRange > safeRangeKm) {
                  const launchPositions: Cesium.Cartesian3[] = [];
                  for (let deg = 0; deg <= 360; deg += ringStep) {
                    const dest = destinationPoint(inst.latitude, inst.longitude, maxLaunchRange * 1000, deg);
                    launchPositions.push(Cesium.Cartesian3.fromDegrees(dest.lon, dest.lat, safeAlt + 15));
                  }
                  viewer.entities.add({
                    name: `Vòng Đón Hỏa Lực 3D ${inst.shortId || ''}`,
                    properties: { instanceId: inst.instanceId },
                    polyline: {
                      positions: launchPositions,
                      width: 2.0,
                      material: new Cesium.PolylineDashMaterialProperty({
                        color: Cesium.Color.fromCssColorString('#dc2626'),
                        dashLength: 10,
                      }),
                    },
                  });
                }
              }

              // samVol already declared above for TAR/FCR/WEZ
              if (samVol) {
                const samGeom = buildSamLayerGeometry(samVol, 'outer_boundary', {
                  mode: dome3DMode,
                  showInnerCone: true,
                  showTopCap: true,
                  showBottomCap: true,
                  combatMode: 'omnidirectional',
                  verticalExaggeration: terrainExaggeration,
                  selectedAltitudeM: effectiveAltitudeM,
                });
                if (samGeom) {
                  const domeColorHex = inst.color || '#ef4444';
                  const samTerrainMaskParams = (dome3DMode === 'terrain-aware' && samVol.terrainGrid) ? {
                    volume: samVol as any,
                    modelMatrix: samGeom.modelMatrix,
                    verticalExaggeration: terrainExaggeration,
                  } : undefined;

                  const samMat = createRadarDomeMaterial({
                    baseColor: domeColor.withAlpha(isSelected ? 0.40 : COMPOSITE_DOME_STYLES.wez.alpha),
                    rimColor: Cesium.Color.fromCssColorString(domeColorHex),
                    rimPower: 2.2,
                    scanLineCount: 16,
                    scanLineSpeed: 0,
                    terrainMask: samTerrainMaskParams,
                  });
                  const samPrim = new Cesium.Primitive({
                    geometryInstances: createSamVolumeGeometryInstance(samGeom, inst.instanceId, 'outer_boundary'),
                    appearance: new Cesium.MaterialAppearance({
                      material: samMat,
                      flat: true,
                      faceForward: false,
                      closed: false,
                      translucent: true,
                      renderState: {
                        cull: { enabled: false },
                        depthTest: { enabled: true },
                        depthMask: false,
                        blending: Cesium.BlendingState.ALPHA_BLEND,
                      },
                    }),
                    asynchronous: false,
                    allowPicking: false,
                    compressVertices: false,
                  });
                  viewer.scene.primitives.add(samPrim);
                  domeResourcesRef.current.push({ primitive: samPrim, material: samMat });
                }

                // Vòng lát cắt hỏa lực tại độ cao khảo sát H_tgt
                if (effectiveAltitudeM && effectiveAltitudeM > 0) {
                  const wezSlicePositions: Cesium.Cartesian3[] = [];
                  const targetAltRelM = Math.max(0, effectiveAltitudeM);
                  let closestBand = -1;
                  if (samVol && samVol.altitudeBands && samVol.effectiveRanges) {
                    let minDiff = Infinity;
                    for (let b = 0; b < samVol.altitudeBands.length; b++) {
                      const bandAltRel = samVol.altitudeBands[b] - (samVol.centerAltM || 0);
                      const diff = Math.abs(bandAltRel - targetAltRelM);
                      if (diff < minDiff) {
                        minDiff = diff;
                        closestBand = b;
                      }
                    }
                  }

                  for (let deg = 0; deg <= 360; deg += 4) {
                    const az = (deg + 360) % 360;
                    let sliceR = radiusMeters;
                    if (closestBand >= 0 && samVol?.effectiveRanges[closestBand]) {
                      const azIdx = samVol.azimuthSamples ? samVol.azimuthSamples.indexOf(az) : -1;
                      const rAtAz = azIdx >= 0
                        ? samVol.effectiveRanges[closestBand][azIdx]
                        : samVol.effectiveRanges[closestBand][az % samVol.effectiveRanges[closestBand].length];
                      if (rAtAz !== undefined && rAtAz > 0) sliceR = rAtAz;
                    }
                    const dest = destinationPoint(inst.latitude, inst.longitude, sliceR, az);
                    wezSlicePositions.push(Cesium.Cartesian3.fromDegrees(dest.lon, dest.lat, safeAlt + effectiveAltitudeM));
                  }
                  viewer.entities.add({
                    name: `Lát Cắt Hỏa Lực WEZ 3D ${inst.shortId || ''}`,
                    properties: { instanceId: inst.instanceId },
                    polyline: {
                      positions: wezSlicePositions,
                      width: 2.5,
                      material: new Cesium.PolylineGlowMaterialProperty({
                        color: envColor.withAlpha(0.9),
                        glowPower: 0.35,
                      }),
                    },
                  });
                }
              } else {
                // Fallback khi volume SAM đang tính toán: nan quạt dây an toàn 360°
                for (let r = 0; r < ribCount; r++) {
                  const az = (r * 360) / ribCount;
                  const dest = destinationPoint(inst.latitude, inst.longitude, radiusMeters, az);
                  const midDist = radiusMeters * 0.65;
                  const midDest = destinationPoint(inst.latitude, inst.longitude, midDist, az);

                  const ribPositions = [
                    centerPos,
                    Cesium.Cartesian3.fromDegrees(midDest.lon, midDest.lat, safeAlt + maxAltM * 0.85),
                    Cesium.Cartesian3.fromDegrees(dest.lon, dest.lat, safeAlt + 15),
                  ];

                  viewer.entities.add({
                    name: `Nan Vòm Hỏa Lực 3D ${az}° ${inst.shortId || ''}`,
                    properties: { instanceId: inst.instanceId },
                    polyline: {
                      positions: ribPositions,
                      width: isSelected ? 2.0 : 1.4,
                      material: domeColor,
                    },
                  });
                }
              }
            }
          }
        }
      }

      // 4. Vùng Trinh Sát Thụ Động (Passive Sensor ESM cho Kolchuga-M)
      if (caps.hasSensorNetwork && safeRangeKm > 0 && showCoverageLayer) {
        const esmColorHex = inst.color || '#a855f7';
        const esmColor = Cesium.Color.fromCssColorString(esmColorHex);
        const freqInfo = inst.frequencyRangeGhz ? ` | ${inst.frequencyRangeGhz}` : '';
        const esmLabelText = `VÙNG THU ĐỘNG [${inst.shortId || 'ESM'}: ${safeRangeKm}km${freqInfo}]`;

        // Vùng phủ thụ động 2D/3D (Màu tím ESM)
        viewer.entities.add({
          name: `Vùng Trinh Sát Thụ Động ${inst.shortId || ''}`,
          position: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, 0),
          properties: { instanceId: inst.instanceId },
          ellipse: {
            semiMajorAxis: safeRangeKm * 1000,
            semiMinorAxis: safeRangeKm * 1000,
            height: 0,
            heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
            classificationType: is2D ? undefined : Cesium.ClassificationType.TERRAIN,
            material: esmColor.withAlpha(isSelected ? 0.12 : 0.04),
            outline: true,
            outlineColor: esmColor.withAlpha(isSelected ? 0.9 : 0.5),
            outlineWidth: isSelected ? 2.5 : 1.2,
          },
        });

        // Nhãn biên giới cự ly thụ động (Hướng Đông Bắc 45°)
        const boundaryPoint = destinationPoint(inst.latitude, inst.longitude, safeRangeKm * 1000, 45);
        viewer.entities.add({
          name: `Nhãn Vùng Thụ Động ${inst.shortId || ''}`,
          position: Cesium.Cartesian3.fromDegrees(boundaryPoint.lon, boundaryPoint.lat, is2D ? 0 : safeAlt),
          properties: { instanceId: inst.instanceId },
          label: {
            text: esmLabelText,
            font: isSelected ? 'bold 11px "JetBrains Mono", monospace' : '10px "JetBrains Mono", monospace',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: isSelected ? Cesium.Color.fromCssColorString('#fde047') : esmColor,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.85),
            backgroundPadding: new Cesium.Cartesian2(6, 3),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, isSelected ? 700000 : 400000),
            heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });

        // 3D Vòm Trinh Sát Thụ Động (3D Passive ESM Listening Sphere)
        if (viewMode === '3D' && showAllDomes && inst.showDome) {
          const radiusMeters = safeRangeKm * 1000;
          const domeColor = esmColor.withAlpha(isSelected ? 0.35 : 0.18);
          const ribCount = 8;
          const centerPos = Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, safeAlt + safeAntennaAGL);
          const maxAltM = (inst.coverageHeightKm || 40) * 1000;

          // Vòng biên giới hạn cự ly thụ động
          const ringPositions: Cesium.Cartesian3[] = [];
          for (let deg = 0; deg <= 360; deg += 10) {
            const dest = destinationPoint(inst.latitude, inst.longitude, radiusMeters, deg);
            ringPositions.push(Cesium.Cartesian3.fromDegrees(dest.lon, dest.lat, safeAlt + 15));
          }
          viewer.entities.add({
            name: `Vòng Thu Động 3D ${inst.shortId || ''}`,
            properties: { instanceId: inst.instanceId },
            polyline: {
              positions: ringPositions,
              width: isSelected ? 2.5 : 1.5,
              material: new Cesium.PolylineDashMaterialProperty({
                color: domeColor,
                dashLength: 16,
              }),
            },
          });

          // Các nan quạt tiếp nhận bức xạ vô tuyến 3D
          for (let r = 0; r < ribCount; r++) {
            const az = (r * 360) / ribCount;
            const dest = destinationPoint(inst.latitude, inst.longitude, radiusMeters, az);
            const midDist = radiusMeters * 0.7;
            const midDest = destinationPoint(inst.latitude, inst.longitude, midDist, az);

            const ribPositions = [
              centerPos,
              Cesium.Cartesian3.fromDegrees(midDest.lon, midDest.lat, safeAlt + Math.min(radiusMeters * 0.25, maxAltM * 0.8)),
              Cesium.Cartesian3.fromDegrees(dest.lon, dest.lat, safeAlt + 15),
            ];

            viewer.entities.add({
              name: `Nan Khung Thụ Động 3D ${az}° ${inst.shortId || ''}`,
              properties: { instanceId: inst.instanceId },
              polyline: {
                positions: ribPositions,
                width: 1,
                material: domeColor,
              },
            });
          }
        }
      }

      // 5. Cung Quan Sát Trinh Sát Thụ Động (Trạm Quan Sát OP)
      if (caps.hasObservationSector && safeRangeKm > 0 && showCoverageLayer) {
        const opColor = Cesium.Color.fromCssColorString('#8b5cf6');
        viewer.entities.add({
          name: `Cung Quan Sát ${inst.shortId || ''}`,
          position: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, 0),
          properties: { instanceId: inst.instanceId },
          ellipse: {
            semiMajorAxis: safeRangeKm * 1000,
            semiMinorAxis: safeRangeKm * 1000,
            height: 0,
            material: opColor.withAlpha(isSelected ? 0.12 : 0.04),
            outline: true,
            outlineColor: opColor.withAlpha(isSelected ? 0.9 : 0.5),
            outlineWidth: isSelected ? 2.5 : 1.2,
          },
        });
      }

      // 5. Vùng Phủ SPx 2D Cambridge Pixel HOẶC Vòm Radar 3D Dựng Từ Coverage Field (CHỈ DÀNH CHO RADAR)
      if (isSpxActive && caps.hasRadarCoverage) {
        const instConfig = {
          ...spxConfig,
          radarHeightAGL: safeAntennaAGL,
          endRangeM: safeRangeKm * 1000,
          minElevationDeg: inst.minElevationDeg !== undefined ? inst.minElevationDeg : spxConfig.minElevationDeg,
          maxElevationDeg: inst.maxElevationDeg !== undefined ? inst.maxElevationDeg : spxConfig.maxElevationDeg,
          ...(inst.spxConfig || {}),
        };
        // Render vùng phủ đa tầng màu SPx + vòng cự ly đồng tâm + cờ cắm tác chiến & nhãn thông số với Focus/Dimming
        const spxEntities = buildSpxCoverageEntities(spxRes, instConfig, {
          isSelected,
          hasAnySelected,
          showCoverage: showCoverageLayer,
          showRangeRings: showRangeRingsLayer,
          showLabels: showLabelsLayer, // Hiển thị nhãn số trên vòng cự ly nếu được bật
          shortId: inst.shortId,
          status: inst.status,
          category: inst.category,
          is2D: viewMode === '2D',
          antennaHeightAGL: safeAntennaAGL,
          rangeKm: safeRangeKm,
          color: inst.color,
          realPhotoUrl: inst.realPhotoUrl || TEMPLATE_BY_ID.get(inst.templateId)?.realPhotoUrl || '',
          instanceId: inst.instanceId,
        });
        spxEntities.forEach((e) => {
          e.properties = new Cesium.PropertyBag({ instanceId: inst.instanceId });
          viewer.entities.add(e);
        });
      } else if (caps.hasRadarCoverage && viewMode === '3D' && showAllDomes && inst.showDome && safeRangeKm > 0 && showCoverageLayer) {
        // 3a. VÒM PHỦ SÓNG 3D (Được nâng cấp thành Single Source of Truth Volume Mesh)
        const volume = coverageVolumes[inst.instanceId] ?? null;
        const field = coverageFields[inst.instanceId] ?? null;
        const template = TEMPLATE_BY_ID.get(inst.templateId);
        const domeColorHex = resolveDomeColorHex(
          inst.color,
          template?.domeColor,
          domeColorOverride
        );
        const domeColor = Cesium.Color.fromCssColorString(domeColorHex);

        const safeCoverageHeightKm =
          typeof inst.coverageHeightKm === 'number' &&
            Number.isFinite(inst.coverageHeightKm) &&
            inst.coverageHeightKm > 0
            ? inst.coverageHeightKm
            : 25;
        const domeInstance = {
          ...inst,
          altitude: safeAlt,
          antennaHeightAGL: safeAntennaAGL,
          rangeKm: safeRangeKm,
          coverageHeightKm: safeCoverageHeightKm,
        };

        const effectiveAltitudeM =
          inst.targetAltitudeM ??
          (isSelected
            ? (targetHeightMeters || selectedAltitudeM)
            : (selectedAltitudeM || targetHeightMeters));

        let domePrimitive: Cesium.Primitive | null = null;
        let baseRadiusM = safeRangeKm * 1000;
        let apexHeightM =
          effectiveAltitudeM && effectiveAltitudeM > 0
            ? Math.max(0, effectiveAltitudeM - safeAlt)
            : safeCoverageHeightKm * 1000;

        if (volume) {
          const volGeom = buildRadarVolumeGeometry(volume, {
            mode: dome3DMode,
            showInnerCone: showConeOfSilence,
            selectedAltitudeM: effectiveAltitudeM,
          });

          if (volGeom) {
            baseRadiusM = volGeom.maxEffectiveRadiusM;
            apexHeightM = volGeom.apexHeightM;

            const terrainMaskParams = (dome3DMode === 'terrain-aware' && volume.terrainGrid) ? {
              volume,
              modelMatrix: volGeom.modelMatrix,
              verticalExaggeration: terrainExaggeration,
            } : undefined;

            const material = createRadarDomeMaterial({
              baseColor: domeColor.withAlpha(domeAlpha),
              rimColor: Cesium.Color.fromCssColorString(domeRimColor),
              rimPower: domeRimPower,
              scanLineCount: domeScanLineCount,
              scanLineSpeed: domeScanLineAnimated ? domeScanLineSpeed : 0,
              terrainMask: terrainMaskParams,
            });

            domePrimitive = new Cesium.Primitive({
              geometryInstances: createRadarVolumeGeometryInstance(volGeom, inst.instanceId),
              appearance: new Cesium.MaterialAppearance({
                material,
                flat: true,
                faceForward: false,
                closed: false,
                translucent: true,
                renderState: {
                  cull: { enabled: false },
                  depthTest: { enabled: true },
                  depthMask: false,
                  blending: Cesium.BlendingState.ALPHA_BLEND,
                },
              }),
              asynchronous: false,
              allowPicking: false,
              compressVertices: false,
            });

            viewer.scene.primitives.add(domePrimitive);
            domeResourcesRef.current.push({ primitive: domePrimitive, material });
          }

          // Dựng khối bóng râm che khuất sau núi (Occluded / Shadow Volume) khi ở chế độ terrain-aware
          if (dome3DMode === 'terrain-aware' && showOccludedVolume) {
            const occGeom = buildRadarOccludedVolumeGeometry(volume, {
              mode: 'terrain-aware',
              selectedAltitudeM: effectiveAltitudeM,
            });
            if (occGeom) {
              const shadowTerrainMaskParams = (dome3DMode === 'terrain-aware' && volume.terrainGrid) ? {
                volume,
                modelMatrix: occGeom.modelMatrix,
                verticalExaggeration: terrainExaggeration,
              } : undefined;
              const shadowMaterial = createRadarOccludedMaterial(0.2, shadowTerrainMaskParams);
              const shadowPrimitive = new Cesium.Primitive({
                geometryInstances: createRadarOccludedGeometryInstance(occGeom, inst.instanceId),
                appearance: new Cesium.MaterialAppearance({
                  material: shadowMaterial,
                  flat: true,
                  faceForward: false,
                  closed: false,
                  translucent: true,
                  renderState: {
                    cull: { enabled: false },
                    depthTest: { enabled: true },
                    depthMask: false,
                    blending: Cesium.BlendingState.ALPHA_BLEND,
                  },
                }),
                asynchronous: false,
                allowPicking: false,
                compressVertices: false,
              });

              viewer.scene.primitives.add(shadowPrimitive);
              domeResourcesRef.current.push({ primitive: shadowPrimitive, material: shadowMaterial });
            }
          }
        } else {
          // Fallback dựng vòm danh nghĩa khi volume đang tính toán
          const fallbackCoverageHeightKm =
            effectiveAltitudeM && effectiveAltitudeM > 0
              ? effectiveAltitudeM / 1000
              : safeCoverageHeightKm;

          const fallbackDomeInstance = {
            ...domeInstance,
            coverageHeightKm: fallbackCoverageHeightKm,
          };

          const domeGeometry = buildRadarDomeGeometry(fallbackDomeInstance, field, {
            azimuthSegments: domeAzimuthSegments,
            elevationRings: domeElevationRings,
            terrainMasked: domeTerrainMasked,
          });

          if (domeGeometry) {
            baseRadiusM = domeGeometry.baseRadiusM;
            apexHeightM = domeGeometry.apexHeightM;

            const material = createRadarDomeMaterial({
              baseColor: domeColor.withAlpha(domeAlpha),
              rimColor: Cesium.Color.fromCssColorString(domeRimColor),
              rimPower: domeRimPower,
              scanLineCount: domeScanLineCount,
              scanLineSpeed: domeScanLineAnimated ? domeScanLineSpeed : 0,
            });

            domePrimitive = new Cesium.Primitive({
              geometryInstances: createRadarDomeGeometryInstance(domeGeometry),
              appearance: new Cesium.MaterialAppearance({
                material,
                flat: true,
                faceForward: false,
                closed: false,
                translucent: true,
                renderState: {
                  cull: { enabled: false },
                  depthTest: { enabled: true },
                  depthMask: false,
                  blending: Cesium.BlendingState.ALPHA_BLEND,
                },
              }),
              asynchronous: false,
              allowPicking: false,
              compressVertices: false,
            });

            viewer.scene.primitives.add(domePrimitive);
            domeResourcesRef.current.push({ primitive: domePrimitive, material });
          }
        }

        // 3b. Vòng chân đế mặt đất — bám sát địa hình
        if (showDomeFootprint && baseRadiusM > 0) {
          const footprintPositions: Cesium.Cartesian3[] = [];
          const numSegments = DOME_FOOTPRINT_SEGMENTS;
          for (let i = 0; i < numSegments; i++) {
            const azimuthDeg = (i / numSegments) * 360;
            let segRadiusM = baseRadiusM;
            if (volume && volume.effectiveRanges && volume.effectiveRanges.length > 0) {
              const baseBand = dome3DMode === 'nominal' ? volume.nominalRanges[0] : volume.effectiveRanges[0];
              if (baseBand && baseBand.length > 0) {
                const azIdx = Math.min(
                  baseBand.length - 1,
                  Math.max(0, Math.floor((azimuthDeg / 360) * baseBand.length))
                );
                if (typeof baseBand[azIdx] === 'number') {
                  segRadiusM = baseBand[azIdx];
                }
              }
            }

            const destination = destinationPoint(
              inst.latitude,
              inst.longitude,
              segRadiusM,
              azimuthDeg
            );
            if (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lon)) continue;
            footprintPositions.push(
              Cesium.Cartesian3.fromDegrees(destination.lon, destination.lat, 0)
            );
          }
          if (footprintPositions.length >= 2) {
            footprintPositions.push(footprintPositions[0]);

            viewer.entities.add({
              name: `Vòng chân đế vòm - ${inst.name}`,
              polyline: {
                positions: footprintPositions,
                width: 2,
                clampToGround: true,
                arcType: Cesium.ArcType.GEODESIC,
                material: domeColor.withAlpha(0.85),
              },
            });
          }
        }

        // 3c. Vòng "nón mù đỉnh đầu": 1 vòng nét đứt mảnh màu vàng ở cao độ trần phủ sóng
        if (showConeOfSilence) {
          const coverageHeightM = Math.max(1, apexHeightM);
          const maxElevationDeg = inst.maxElevationDeg;
          if (
            typeof maxElevationDeg === 'number' &&
            Number.isFinite(maxElevationDeg) &&
            maxElevationDeg > 0.5 &&
            maxElevationDeg < 89.5
          ) {
            const coneRadiusM =
              coverageHeightM / Math.tan((maxElevationDeg * Math.PI) / 180);
            const coneAltitudeM = safeAlt + safeAntennaAGL + coverageHeightM;

            const conePositions: Cesium.Cartesian3[] = [];
            for (let i = 0; i < DOME_FOOTPRINT_SEGMENTS; i++) {
              const azimuthDeg = (i / DOME_FOOTPRINT_SEGMENTS) * 360;
              const destination = destinationPoint(
                inst.latitude,
                inst.longitude,
                coneRadiusM,
                azimuthDeg
              );
              if (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lon)) continue;
              conePositions.push(
                Cesium.Cartesian3.fromDegrees(destination.lon, destination.lat, coneAltitudeM)
              );
            }
            if (conePositions.length >= 2) {
              conePositions.push(conePositions[0]);

              viewer.entities.add({
                name: `Vòng nón mù đỉnh đầu - ${inst.name}`,
                polyline: {
                  positions: conePositions,
                  width: 1.5,
                  material: new Cesium.PolylineDashMaterialProperty({
                    color: Cesium.Color.fromCssColorString('#facc15'),
                    dashLength: 12,
                  }),
                },
              });
            }
          }
        }

        // 3d. Vùng mù địa hình (mặc định TẮT) — dùng lại blindEntities sẵn có, không vẽ
        //     các lớp canopy/vòng glow đã bỏ.
        if (showBlindZones && field && field.rays && field.rays.length > 0) {
          const { blindEntities } = buildRadarCoverageFieldEntities(
            field,
            true,
            domeColorHex,
            isSelected,
            false, // không dựng lại phễu nón mù / vành khuyết của bản cũ
            safeRangeKm * 1000 // Tầm cự ly của vòm (m)
          );
          blindEntities.forEach((entity) => viewer.entities.add(entity));
        }
      }


      // 5. Điểm khảo sát mặt cắt đứng 2D được chấm bởi chỉ huy (Cross Section 3D Probe Point)
      // Vẫn hiển thị trọn vẹn trên 3D khi panel được cực tiểu hoá hoặc đóng lại để quan sát địa hình
      if (
        crossSectionProbePoint &&
        crossSectionProbePoint.instanceId === inst.instanceId
      ) {
        const pPt = crossSectionProbePoint;
        if (
          !isNaN(pPt.lat) &&
          !isNaN(pPt.lon) &&
          isFinite(pPt.lat) &&
          isFinite(pPt.lon)
        ) {
          const is2D = viewMode === '2D';
          const ptAltitude = is2D ? 0 : pPt.altM;
          const groundAltitude = is2D
            ? 0
            : pPt.terrainAltM !== undefined
            ? pPt.terrainAltM
            : safeAlt || 0;

          // a. Nút chấm hiển thị tại toạ độ không gian 3D (hoặc mặt phẳng 2D)
          viewer.entities.add({
            name: `Điểm Khảo Sát [Az ${pPt.azimuthDeg}° - ${pPt.distKm}km - ${pPt.altM}m]`,
            position: Cesium.Cartesian3.fromDegrees(pPt.lon, pPt.lat, ptAltitude),
            point: {
              pixelSize: 13,
              color: Cesium.Color.fromCssColorString('#fde047'), // Vàng tươi quân sự
              outlineColor: Cesium.Color.fromCssColorString('#020617'),
              outlineWidth: 3,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              heightReference: is2D ? Cesium.HeightReference.NONE : undefined,
            },
            label: {
              text: `🎯 ĐIỂM KHẢO SÁT MẶT CẮT (Phương vị ${pPt.azimuthDeg}°)\n• Cự ly: ${pPt.distKm} km\n• Độ cao khảo sát: ${pPt.altM.toLocaleString('vi-VN')} m${
                pPt.terrainAltM !== undefined ? ` (Đất: ${pPt.terrainAltM.toLocaleString('vi-VN')} m)` : ''
              }\n• ${pPt.status}`,
              font: 'bold 12px "JetBrains Mono", monospace',
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              fillColor: Cesium.Color.fromCssColorString('#fde047'),
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 3.5,
              showBackground: true,
              backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.92),
              backgroundPadding: new Cesium.Cartesian2(8, 5),
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
              pixelOffset: new Cesium.Cartesian2(0, -18),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              heightReference: is2D ? Cesium.HeightReference.NONE : undefined,
            },
          });

          // Trong chế độ 3D: Dựng trụ gióng độ cao thẳng đứng & chân tiếp đất
          if (!is2D) {
            // b. Đường dóng độ cao thẳng đứng xuống mặt đất (Vertical Drop Line)
            viewer.entities.add({
              name: `Đường dóng độ cao Điểm Khảo Sát`,
              polyline: {
                positions: [
                  Cesium.Cartesian3.fromDegrees(
                    pPt.lon,
                    pPt.lat,
                    Math.min(groundAltitude, ptAltitude)
                  ),
                  Cesium.Cartesian3.fromDegrees(pPt.lon, pPt.lat, ptAltitude),
                ],
                width: 2,
                material: new Cesium.PolylineDashMaterialProperty({
                  color: Cesium.Color.fromCssColorString('#fde047'),
                  dashLength: 8,
                }),
              },
            });

            // c. Điểm tiếp đất chân đường dóng (Ground Footprint Pin)
            viewer.entities.add({
              name: `Chân đường dóng Điểm Khảo Sát`,
              position: Cesium.Cartesian3.fromDegrees(pPt.lon, pPt.lat, groundAltitude),
              point: {
                pixelSize: 6,
                color: Cesium.Color.fromCssColorString('#f59e0b'),
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            });

            // d. Đường định vị từ tâm khí tài tới điểm khảo sát (LOS Vector)
            viewer.entities.add({
              name: `Đường định vị từ khí tài tới điểm khảo sát`,
              polyline: {
                positions: [
                  Cesium.Cartesian3.fromDegrees(
                    inst.longitude,
                    inst.latitude,
                    safeAlt + safeAntennaAGL
                  ),
                  Cesium.Cartesian3.fromDegrees(pPt.lon, pPt.lat, ptAltitude),
                ],
                width: 1.5,
                material: new Cesium.PolylineDashMaterialProperty({
                  color: Cesium.Color.CYAN.withAlpha(0.7),
                  dashLength: 12,
                }),
              },
            });
          }
        }
      }
    });

    // B. Render đường liên kết chỉ huy (Command Links)
    if (showCommandLinks) {
      const is2D = viewMode === '2D';
      instances.forEach((sub) => {
        if (sub.commandedByInstanceId) {
          const parent = instanceMap.get(sub.commandedByInstanceId);
          if (
            parent &&
            typeof parent.latitude === 'number' && !isNaN(parent.latitude) && isFinite(parent.latitude) &&
            typeof parent.longitude === 'number' && !isNaN(parent.longitude) && isFinite(parent.longitude) &&
            typeof sub.latitude === 'number' && !isNaN(sub.latitude) && isFinite(sub.latitude) &&
            typeof sub.longitude === 'number' && !isNaN(sub.longitude) && isFinite(sub.longitude)
          ) {
            const isLinkHighlighted = selectedInstanceId === parent.instanceId || selectedInstanceId === sub.instanceId;

            const parentAlt = typeof parent.altitude === 'number' && !isNaN(parent.altitude) && isFinite(parent.altitude) ? parent.altitude : 0;
            const parentAGL = typeof parent.antennaHeightAGL === 'number' && !isNaN(parent.antennaHeightAGL) && isFinite(parent.antennaHeightAGL) ? parent.antennaHeightAGL : 15;
            const subAlt = typeof sub.altitude === 'number' && !isNaN(sub.altitude) && isFinite(sub.altitude) ? sub.altitude : 0;
            const subAGL = typeof sub.antennaHeightAGL === 'number' && !isNaN(sub.antennaHeightAGL) && isFinite(sub.antennaHeightAGL) ? sub.antennaHeightAGL : 15;

            const parentPos = Cesium.Cartesian3.fromDegrees(
              parent.longitude,
              parent.latitude,
              is2D ? 0 : parentAlt + parentAGL + 60
            );
            const subPos = Cesium.Cartesian3.fromDegrees(
              sub.longitude,
              sub.latitude,
              is2D ? 0 : subAlt + subAGL + 30
            );

            viewer.entities.add({
              name: `Liên kết chỉ huy: ${parent.shortId || 'C2'} ➜ ${sub.shortId || 'Sub'}`,
              polyline: {
                positions: [parentPos, subPos],
                width: isLinkHighlighted ? 4 : 2,
                material: isLinkHighlighted
                  ? new Cesium.PolylineGlowMaterialProperty({
                    color: Cesium.Color.fromCssColorString('#fde047'),
                    glowPower: 0.45,
                  })
                  : new Cesium.PolylineGlowMaterialProperty({
                    color: Cesium.Color.fromCssColorString('#06b6d4'),
                    glowPower: 0.20,
                  }),
              },
            });
          }
        }
      });
    }

    // B2. Render mạng lưới đường cơ sở trinh sát thụ động TDoA (Passive ESM Sensor Network Baselines)
    if (showSensorNetwork) {
      const is2D = viewMode === '2D';
      const esmNodes = instances.filter(
        (it) => it.category === 'CamBienThuDong' || getAssetCapabilities(it.category).hasSensorNetwork
      );

      if (esmNodes.length >= 2) {
        for (let i = 0; i < esmNodes.length; i++) {
          for (let j = i + 1; j < esmNodes.length; j++) {
            const n1 = esmNodes[i];
            const n2 = esmNodes[j];
            if (
              typeof n1.latitude === 'number' && !isNaN(n1.latitude) && isFinite(n1.latitude) &&
              typeof n1.longitude === 'number' && !isNaN(n1.longitude) && isFinite(n1.longitude) &&
              typeof n2.latitude === 'number' && !isNaN(n2.latitude) && isFinite(n2.latitude) &&
              typeof n2.longitude === 'number' && !isNaN(n2.longitude) && isFinite(n2.longitude)
            ) {
              const isBaselineHighlighted =
                selectedInstanceId === n1.instanceId || selectedInstanceId === n2.instanceId;

              const n1Alt = typeof n1.altitude === 'number' && !isNaN(n1.altitude) && isFinite(n1.altitude) ? n1.altitude : 0;
              const n1AGL = typeof n1.antennaHeightAGL === 'number' && !isNaN(n1.antennaHeightAGL) && isFinite(n1.antennaHeightAGL) ? n1.antennaHeightAGL : 20;
              const n2Alt = typeof n2.altitude === 'number' && !isNaN(n2.altitude) && isFinite(n2.altitude) ? n2.altitude : 0;
              const n2AGL = typeof n2.antennaHeightAGL === 'number' && !isNaN(n2.antennaHeightAGL) && isFinite(n2.antennaHeightAGL) ? n2.antennaHeightAGL : 20;

              const pos1 = Cesium.Cartesian3.fromDegrees(n1.longitude, n1.latitude, is2D ? 0 : n1Alt + n1AGL + 35);
              const pos2 = Cesium.Cartesian3.fromDegrees(n2.longitude, n2.latitude, is2D ? 0 : n2Alt + n2AGL + 35);

              // Tính khoảng cách đường cơ sở giữa 2 đài Kolchuga
              const baseDistKm = computeDistanceKm(n1.latitude, n1.longitude, n2.latitude, n2.longitude);

              // Đường liên kết đường cơ sở TDoA (nét đứt tím/vàng neon)
              viewer.entities.add({
                name: `Đường Cơ Sở TDoA: ${n1.shortId || 'ESM'} ⟷ ${n2.shortId || 'ESM'} (${baseDistKm.toFixed(1)} km)`,
                polyline: {
                  positions: [pos1, pos2],
                  width: isBaselineHighlighted ? 3.5 : 2,
                  material: new Cesium.PolylineDashMaterialProperty({
                    color: isBaselineHighlighted
                      ? Cesium.Color.fromCssColorString('#fde047')
                      : Cesium.Color.fromCssColorString('#c084fc'),
                    dashLength: 14,
                  }),
                },
              });

              // Nhãn cự ly đường cơ sở tại trung điểm
              const midLat = (n1.latitude + n2.latitude) / 2;
              const midLon = (n1.longitude + n2.longitude) / 2;
              const midAlt = is2D ? 0 : ((n1Alt + n2Alt) / 2) + 120;
              viewer.entities.add({
                name: `Nhãn Đường Cơ Sở ${n1.shortId}-${n2.shortId}`,
                position: Cesium.Cartesian3.fromDegrees(midLon, midLat, midAlt),
                label: {
                  text: `⚡ ĐƯỜNG CƠ SỞ TDoA: ${baseDistKm.toFixed(1)} km`,
                  font: 'bold 10px "JetBrains Mono", monospace',
                  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                  fillColor: isBaselineHighlighted
                    ? Cesium.Color.fromCssColorString('#fde047')
                    : Cesium.Color.fromCssColorString('#e879f9'),
                  outlineColor: Cesium.Color.BLACK,
                  outlineWidth: 3,
                  showBackground: true,
                  backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.92),
                  backgroundPadding: new Cesium.Cartesian2(6, 3),
                  verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                  horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                  distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 750000),
                  disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
              });
            }
          }
        }
      }
    }

    // C. Render công cụ đo khoảng cách
    const validMeasurePoints = measurePoints.filter(
      (p) =>
        typeof p.lon === 'number' &&
        typeof p.lat === 'number' &&
        !isNaN(p.lon) &&
        !isNaN(p.lat) &&
        isFinite(p.lon) &&
        isFinite(p.lat)
    );

    if (validMeasurePoints.length > 0) {
      validMeasurePoints.forEach((p, idx) => {
        const safeH = typeof p.height === 'number' && !isNaN(p.height) && isFinite(p.height) ? p.height : 0;
        viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0),
          point: {
            pixelSize: 10,
            color: Cesium.Color.CHARTREUSE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: `Mốc ${idx + 1} (${Math.round(safeH)}m)`,
            font: '11px monospace',
            fillColor: Cesium.Color.CHARTREUSE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            pixelOffset: new Cesium.Cartesian2(0, -18),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      });

      if (validMeasurePoints.length >= 2) {
        const positions = validMeasurePoints.map((p) => {
          const safeH = typeof p.height === 'number' && !isNaN(p.height) && isFinite(p.height) ? p.height : 0;
          return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, safeH + 15);
        });
        viewer.entities.add({
          polyline: {
            positions: positions,
            width: 3,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.CHARTREUSE,
              dashLength: 16,
            }),
            clampToGround: true,
          },
        });
      }
    }

    // D. Render gợi ý vị trí đặt khí tài + tuyến khả thi của cố vấn AI (VECTOR AI local).
    //    Chỉ vẽ khi dữ liệu là số hữu hạn — tuyệt đối không để toạ độ NaN lọt vào pipeline Cesium.
    if (aiAdvisorSuggestions.length > 0) {
      const validSuggestions = aiAdvisorSuggestions.filter(
        (s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude)
      );
      validSuggestions.forEach((suggestion, idx) => {
        const altitudeM = 0;
        viewer.entities.add({
          name: `Gợi ý đặt khí tài #${idx + 1}`,
          position: Cesium.Cartesian3.fromDegrees(suggestion.longitude, suggestion.latitude, altitudeM),
          point: {
            pixelSize: 12,
            color: Cesium.Color.CYAN,
            outlineColor: Cesium.Color.fromCssColorString('#020617'),
            outlineWidth: 2,
            heightReference:
              viewMode === '2D' ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: `#${idx + 1} · ${Math.round(suggestion.score * 100)}%`,
            font: 'bold 11px "JetBrains Mono", monospace',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: Cesium.Color.CYAN,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.85),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -16),
            heightReference:
              viewMode === '2D' ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      });
    }

    if (aiAdvisorRoute.length >= 2) {
      const routePositions = aiAdvisorRoute
        .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
        .map((p) => Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, 0));

      if (routePositions.length >= 2) {
        viewer.entities.add({
          name: 'Tuyến khả thi (AI gợi ý)',
          polyline: {
            positions: routePositions,
            width: 3,
            // Ở chế độ 2D không dùng clampToGround (tránh lỗi NaN đã ghi trong DEBUG_NOTES)
            clampToGround: viewMode !== '2D',
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.CYAN,
              dashLength: 14,
            }),
          },
        });
      }
    }

    // E. Render đường bao ranh giới tác chiến Việt Nam khi bật chế độ Chỉ Vùng VN
    if (vietnamOnly) {
      viewer.entities.add({
        name: 'Ranh Giới Vùng Tác Chiến Việt Nam',
        polyline: {
          positions: [
            Cesium.Cartesian3.fromDegrees(101.5, 6.0, 50),
            Cesium.Cartesian3.fromDegrees(118.5, 6.0, 50),
            Cesium.Cartesian3.fromDegrees(118.5, 24.0, 50),
            Cesium.Cartesian3.fromDegrees(101.5, 24.0, 50),
            Cesium.Cartesian3.fromDegrees(101.5, 6.0, 50),
          ],
          width: 2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString('#f43f5e').withAlpha(0.7),
            dashLength: 20,
          }),
        },
      });
    }

    // E. Khẳng định chủ quyền biển đảo thiêng liêng của Việt Nam: Hoàng Sa & Trường Sa
    // Hiển thị nhãn vàng cờ đỏ trang trọng, sắc nét ở mọi chế độ 2D/3D
    viewer.entities.add({
      name: 'Quần đảo Hoàng Sa (Việt Nam)',
      position: Cesium.Cartesian3.fromDegrees(112.0, 16.5, 100),
      label: {
        text: '🇻🇳 QUẦN ĐẢO HOÀNG SA\n(VIỆT NAM)',
        font: 'bold 15px "Roboto", "Segoe UI", sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#fde047'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5000000),
      },
      point: {
        pixelSize: 8,
        color: Cesium.Color.fromCssColorString('#ef4444'),
        outlineColor: Cesium.Color.fromCssColorString('#fde047'),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5000000),
      },
    });

    viewer.entities.add({
      name: 'Quần đảo Trường Sa (Việt Nam)',
      position: Cesium.Cartesian3.fromDegrees(114.0, 10.0, 100),
      label: {
        text: '🇻🇳 QUẦN ĐẢO TRƯỜNG SA\n(VIỆT NAM)',
        font: 'bold 15px "Roboto", "Segoe UI", sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#fde047'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5000000),
      },
      point: {
        pixelSize: 8,
        color: Cesium.Color.fromCssColorString('#ef4444'),
        outlineColor: Cesium.Color.fromCssColorString('#fde047'),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5000000),
      },
    });

    // F. Render các mảng địa hình bằng phẳng (Terrain Flatness Analysis)
    // Thiết kế cao cấp: Fill bán trong suốt cực nhẹ nhìn thấu ảnh vệ tinh + Viền neon bám sát địa hình 3D
    if (flatnessAnalysisResult && flatnessAnalysisResult.patches.length > 0) {
      const { patches } = flatnessAnalysisResult;

      patches.forEach((patch, idx) => {
        const isSelected = selectedPatchId === patch.id;
        const baseColor = patch.isDeployable
          ? Cesium.Color.fromCssColorString('#10b981')
          : Cesium.Color.fromCssColorString('#f59e0b');

        // Nền mảng: Bán trong suốt siêu nhẹ để nhìn thấu hoàn toàn vân DEM và ảnh vệ tinh
        const fillAlpha = isSelected ? 0.22 : 0.12;
        const outlineColor = isSelected
          ? Cesium.Color.fromCssColorString('#fde047')
          : patch.isDeployable
          ? Cesium.Color.fromCssColorString('#34d399')
          : Cesium.Color.fromCssColorString('#fbbf24');

        const degreesArray: number[] = [];
        patch.polygon.forEach((p) => {
          degreesArray.push(p.lon, p.lat);
        });

        // Khép kín vòng đa giác cho polyline viền bám đất
        const closedDegreesArray = [...degreesArray];
        if (
          patch.polygon.length > 0 &&
          (patch.polygon[0].lon !== patch.polygon[patch.polygon.length - 1].lon ||
            patch.polygon[0].lat !== patch.polygon[patch.polygon.length - 1].lat)
        ) {
          closedDegreesArray.push(patch.polygon[0].lon, patch.polygon[0].lat);
        }

        const areaHa = (patch.areaM2 / 10000).toFixed(2);
        const warningBadge = patch.waterWarning ? ' ⚠️' : '';

        viewer.entities.add({
          id: `flatpatch_${patch.id}`,
          name: `Mảng phẳng #${idx + 1} (${areaHa} ha)`,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(degreesArray),
            material: new Cesium.ColorMaterialProperty(baseColor.withAlpha(fillAlpha)),
            heightReference:
              viewMode === '2D' ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(closedDegreesArray),
            width: isSelected ? 3.5 : 2.0,
            material: new Cesium.ColorMaterialProperty(outlineColor),
            clampToGround: true,
          },
          position: Cesium.Cartesian3.fromDegrees(patch.centerLon, patch.centerLat),
          point: {
            pixelSize: isSelected ? 12 : 8,
            color: isSelected ? Cesium.Color.fromCssColorString('#fde047') : baseColor,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            heightReference:
              viewMode === '2D' ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: `#${idx + 1} · ${areaHa}ha · ΔH ${patch.deltaElevM.toFixed(1)}m${warningBadge}`,
            font: 'bold 11px "JetBrains Mono", monospace',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: isSelected ? Cesium.Color.fromCssColorString('#fde047') : Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.85),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -14),
            heightReference:
              viewMode === '2D' ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      });
    }
  }, [
    instances,
    selectedInstanceId,
    showAllDomes,
    showCommandLinks,
    showSensorNetwork,
    measurePoints,
    vietnamOnly,
    coverageResults,
    coverageFields,
    showBlindZones,
    showConeOfSilence,
    showCrossSection,
    crossSectionProbePoint,
    viewMode,
    showSpxPanel,
    spxConfig,
    spxResults,
    isCalculatingSpx,
    showCoverageLayer,
    showRangeRingsLayer,
    showLabelsLayer,
    showMarkersLayer,
    showModelsLayer,
    customModelUrls,
    badgeRefreshTick,
    categoryFilter,
    domeAlpha,
    domeAzimuthSegments,
    domeElevationRings,
    domeRimColor,
    domeRimPower,
    domeScanLineCount,
    domeScanLineSpeed,
    domeScanLineAnimated,
    showDomeFootprint,
    domeTerrainMasked,
    domeColorOverride,
    aiAdvisorSuggestions,
    aiAdvisorRoute,
    coverageVolumes,
    samVolumes,
    samCoverageResults,
    dome3DMode,
    showOccludedVolume,
    selectedAltitudeM,
    releaseDomeResources,
    flatnessAnalysisResult,
    selectedPatchId,
    terrainExaggeration,
  ]);

  // 6b. Tia & Mặt Phẳng Định Hướng Mặt Cắt Đứng 2D (Độc lập, cập nhật tức thì 60 FPS mà KHÔNG reload toàn bộ scene)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const lineId = 'cross_section_azimuth_cut_line';
    const labelId = 'cross_section_azimuth_cut_label';

    const selectedInst = instances.find((i) => i.instanceId === selectedInstanceId);
    const shouldShow =
      (showCrossSection || (crossSectionProbePoint && crossSectionProbePoint.instanceId === selectedInstanceId)) &&
      !!selectedInst &&
      (selectedInst.rangeKm || 0) > 0;

    if (!shouldShow || !selectedInst) {
      viewer.entities.removeById(lineId);
      viewer.entities.removeById(labelId);
      return;
    }

    const safeRangeKm = Math.max(10, selectedInst.rangeKm || 50);
    const safeAlt = typeof selectedInst.altitude === 'number' && !isNaN(selectedInst.altitude) ? selectedInst.altitude : 0;
    const safeAntennaAGL = typeof selectedInst.antennaHeightAGL === 'number' && !isNaN(selectedInst.antennaHeightAGL) ? selectedInst.antennaHeightAGL : 15;

    const dest = destinationPoint(
      selectedInst.latitude,
      selectedInst.longitude,
      safeRangeKm * 1000,
      selectedAzimuthDeg
    );

    if (isNaN(dest.lat) || isNaN(dest.lon)) return;

    const positions = [
      Cesium.Cartesian3.fromDegrees(selectedInst.longitude, selectedInst.latitude, safeAlt + safeAntennaAGL + 5),
      Cesium.Cartesian3.fromDegrees(dest.lon, dest.lat, safeAlt + 100),
    ];

    const existingLine = viewer.entities.getById(lineId);
    if (existingLine && existingLine.polyline) {
      existingLine.polyline.positions = new Cesium.ConstantProperty(positions);
      existingLine.name = `Tia định hướng Mặt Cắt ${selectedAzimuthDeg}°`;
    } else {
      viewer.entities.add({
        id: lineId,
        name: `Tia định hướng Mặt Cắt ${selectedAzimuthDeg}°`,
        polyline: {
          positions: positions,
          width: 3.5,
          material: new Cesium.PolylineGlowMaterialProperty({
            color: Cesium.Color.fromCssColorString('#facc15'),
            glowPower: 0.4,
          }),
          clampToGround: true,
        },
      });
    }

    const labelPos = Cesium.Cartesian3.fromDegrees(dest.lon, dest.lat, safeAlt + 500);
    const existingLabel = viewer.entities.getById(labelId);
    if (existingLabel) {
      existingLabel.position = new Cesium.ConstantPositionProperty(labelPos);
      if (existingLabel.label) {
        existingLabel.label.text = new Cesium.ConstantProperty(`Mặt Cắt ${selectedAzimuthDeg}° (${safeRangeKm}km)`);
      }
    } else {
      viewer.entities.add({
        id: labelId,
        name: `Nhãn Mặt Cắt ${selectedAzimuthDeg}°`,
        position: labelPos,
        label: {
          text: `Mặt Cắt ${selectedAzimuthDeg}° (${safeRangeKm}km)`,
          font: 'bold 11px monospace',
          fillColor: Cesium.Color.fromCssColorString('#fef08a'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -14),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
  }, [selectedAzimuthDeg, selectedInstanceId, showCrossSection, crossSectionProbePoint, instances]);

  // Cập nhật màu highlight cho mảng phẳng khi hover / select mà KHÔNG hủy và vẽ lại toàn bộ entity khác
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !flatnessAnalysisResult) return;

    flatnessAnalysisResult.patches.forEach((patch) => {
      const entity = viewer.entities.getById(`flatpatch_${patch.id}`);
      if (entity) {
        const isHovered = hoveredPatchId === patch.id;
        const isSelected = selectedPatchId === patch.id;
        const fillCss = isSelected
          ? '#eab308'
          : isHovered
          ? '#22d3ee'
          : patch.isDeployable
          ? '#10b981'
          : '#f59e0b';
        // Luôn giữ fill bán trong suốt siêu nhẹ để ảnh vệ tinh và DEM không bị che khuất
        const fillAlpha = isSelected ? 0.22 : isHovered ? 0.18 : 0.12;

        if (entity.polygon) {
          entity.polygon.material = new Cesium.ColorMaterialProperty(
            Cesium.Color.fromCssColorString(fillCss).withAlpha(fillAlpha)
          );
        }

        // Cập nhật viền neon bám địa hình
        if (entity.polyline) {
          const outlineCss = isSelected
            ? '#fde047'
            : isHovered
            ? '#38bdf8'
            : patch.isDeployable
            ? '#34d399'
            : '#fbbf24';
          entity.polyline.material = new Cesium.ColorMaterialProperty(
            Cesium.Color.fromCssColorString(outlineCss)
          );
          entity.polyline.width = new Cesium.ConstantProperty(
            isSelected ? 3.5 : isHovered ? 2.5 : 2.0
          );
        }

        if (entity.label) {
          entity.label.fillColor = new Cesium.ConstantProperty(
            isHovered || isSelected ? Cesium.Color.fromCssColorString('#fde047') : Cesium.Color.WHITE
          );
        }
      }
    });
    viewer.scene.requestRender();
  }, [hoveredPatchId, selectedPatchId, flatnessAnalysisResult]);

  // 6c. Render 6 Lớp Trực Quan Hóa So Sánh Tầm Nhìn Địa Hình GIS (Observer A vs B)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const layerPrefix = 'terrain_comp_sample_';
    // Xóa các điểm mẫu cũ
    const existing = viewer.entities.values.filter((e) => e.id && e.id.startsWith(layerPrefix));
    existing.forEach((e) => viewer.entities.remove(e));

    if (!showTerrainComparison || !terrainComparisonResult) {
      viewer.scene.requestRender();
      return;
    }

    const { samples, terrainStatus } = terrainComparisonResult;
    const layers = terrainComparisonLayers;

    samples.forEach((pt, idx) => {
      let showPoint = false;
      let pointColor = '#38bdf8';
      let pointSize = 5;

      const isMissing = pt.isMissingDem || terrainStatus !== 'loaded';

      if (isMissing) {
        if (layers.missingDem) {
          showPoint = true;
          pointColor = '#64748b'; // Xám thiếu DEM
          pointSize = 4;
        }
      } else if (pt.visibleFromA && pt.visibleFromB) {
        if (layers.overlap) {
          showPoint = true;
          pointColor = '#10b981'; // Xanh lục: Chồng lấn cả 2 cùng thấy
          pointSize = 6;
        }
      } else if (!pt.visibleFromA && !pt.visibleFromB) {
        if (layers.maskA && layers.maskB) {
          showPoint = true;
          pointColor = '#f43f5e'; // Đỏ sẫm: Mù chung
          pointSize = 4;
        }
      } else if (pt.visibleFromA && !pt.visibleFromB) {
        if (layers.nonOverlap || layers.maskB) {
          showPoint = true;
          pointColor = '#06b6d4'; // Cyan: Chỉ A thấy
          pointSize = 5;
        }
      } else if (!pt.visibleFromA && pt.visibleFromB) {
        if (layers.nonOverlap || layers.maskA) {
          showPoint = true;
          pointColor = '#d946ef'; // Fuchsia: Chỉ B thấy
          pointSize = 5;
        }
      }

      if (showPoint) {
        viewer.entities.add({
          id: `${layerPrefix}${idx}`,
          position: Cesium.Cartesian3.fromDegrees(
            pt.longitude,
            pt.latitude,
            Math.max(0, pt.terrainAltM) + 5
          ),
          point: {
            pixelSize: pointSize,
            color: Cesium.Color.fromCssColorString(pointColor).withAlpha(0.65),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
        });
      }
    });

    viewer.scene.requestRender();
  }, [showTerrainComparison, terrainComparisonResult, terrainComparisonLayers]);

  // Render vùng phân tích 1km độc lập (vòng tròn cyan + marker tâm) qua CustomDataSource riêng
  // Giúp vòng tròn xuất hiện ngay lập tức khi chọn toạ độ và tồn tại độc lập với kết quả quét
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    let ds = analysisRegionDataSourceRef.current;
    if (!ds || !viewer.dataSources.contains(ds)) {
      ds = new Cesium.CustomDataSource('analysisRegionDS');
      viewer.dataSources.add(ds);
      analysisRegionDataSourceRef.current = ds;
    }
    ds.entities.removeAll();

    if (analysisRegion) {
      const { lat, lon, radiusKm } = analysisRegion;

      // 1. Vòng tròn bán kính 1km (cyan)
      ds.entities.add({
        id: 'analysis_region_circle',
        name: `Vùng phân tích bán kính ${radiusKm} km`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        ellipse: {
          semiMajorAxis: radiusKm * 1000,
          semiMinorAxis: radiusKm * 1000,
          material: Cesium.Color.fromCssColorString('#06b6d4').withAlpha(0.08),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#22d3ee').withAlpha(0.9),
          outlineWidth: 2,
          heightReference:
            viewMode === '2D' ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });

      // 2. Marker tâm vùng
      ds.entities.add({
        id: 'analysis_region_center',
        name: `Tâm vùng khảo sát (${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E)`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString('#22d3ee'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference:
            viewMode === '2D' ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: `Tâm vùng 1km\n${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E`,
          font: 'bold 11px "JetBrains Mono", monospace',
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          fillColor: Cesium.Color.fromCssColorString('#22d3ee'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.85),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -12),
          heightReference:
            viewMode === '2D' ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
    viewer.scene.requestRender();
  }, [analysisRegion, viewMode]);

  // 7. Thao tác Ghim vị trí điểm đặt & Kéo lên xuống theo chiều cao
  const handleTogglePin = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (isPinned) {
      // Đang ghim -> Bỏ ghim
      setIsPinned(false);
    } else {
      // Chưa ghim -> Ghim vào điểm đặt được chọn hoặc tâm màn hình
      setIsPinned(true);
      if (selectedInstanceId) {
        const inst = instances.find((i) => i.instanceId === selectedInstanceId);
        if (
          inst &&
          typeof inst.longitude === 'number' && !isNaN(inst.longitude) && isFinite(inst.longitude) &&
          typeof inst.latitude === 'number' && !isNaN(inst.latitude) && isFinite(inst.latitude)
        ) {
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
              inst.longitude,
              inst.latitude,
              Math.max(85000, cameraHeight)
            ),
            orientation: {
              heading: viewer.camera.heading,
              pitch: Cesium.Math.toRadians(-35),
              roll: 0,
            },
            duration: 0.8,
          });
          return;
        }
      }

      // Ghim tại tâm bản đồ
      const centerScreenPos = new Cesium.Cartesian2(
        viewer.canvas.clientWidth / 2,
        viewer.canvas.clientHeight / 2
      );
      const cartesian = pickGroundCartesian(viewer, centerScreenPos);
      if (cartesian) {
        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        if (
          carto &&
          typeof carto.longitude === 'number' && !isNaN(carto.longitude) &&
          typeof carto.latitude === 'number' && !isNaN(carto.latitude)
        ) {
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
              Cesium.Math.toDegrees(carto.longitude),
              Cesium.Math.toDegrees(carto.latitude),
              Math.max(85000, cameraHeight)
            ),
            orientation: {
              heading: viewer.camera.heading,
              pitch: Cesium.Math.toRadians(-35),
              roll: 0,
            },
            duration: 0.8,
          });
        }
      }
    }
  }, [isPinned, selectedInstanceId, instances, cameraHeight]);

  // Điều chỉnh chiều cao camera thẳng đứng theo trục Z (nâng lên / hạ xuống)
  const setTargetAltitude = useCallback((newAltitude: number) => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const clampedAlt = Math.max(5000, Math.min(newAltitude, 400000));
    setCameraHeight(clampedAlt);

    // Lấy toạ độ tâm điểm đang ghim (khí tài hoặc vị trí nhìn)
    const selectedInst = selectedInstanceId
      ? instances.find((i) => i.instanceId === selectedInstanceId)
      : null;

    const rawLon = selectedInst
      ? selectedInst.longitude
      : (viewer.camera.positionCartographic ? Cesium.Math.toDegrees(viewer.camera.positionCartographic.longitude) : 108.12081);
    const rawLat = selectedInst
      ? selectedInst.latitude
      : (viewer.camera.positionCartographic ? Cesium.Math.toDegrees(viewer.camera.positionCartographic.latitude) : 16.043);

    const lon = typeof rawLon === 'number' && !isNaN(rawLon) && isFinite(rawLon) ? rawLon : 108.12081;
    const lat = typeof rawLat === 'number' && !isNaN(rawLat) && isFinite(rawLat) ? rawLat : 16.043;

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, clampedAlt),
      orientation: {
        heading: viewer.camera.heading,
        pitch: viewer.camera.pitch,
        roll: 0,
      },
      duration: 0.3,
    });
  }, [selectedInstanceId, instances]);

  const stepAltitude = (delta: number) => {
    setTargetAltitude(cameraHeight + delta);
  };

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* BANNER HƯỚNG DẪN KHI ĐANG DI CHUYỂN BỆ PHÓNG */}
      {movingLauncher && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-amber-950/90 text-amber-200 border border-amber-500/70 shadow-[0_0_25px_rgba(245,158,11,0.5)] px-5 py-2.5 rounded-2xl backdrop-blur-md animate-pulse">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
          <span className="text-xs font-mono font-semibold">
            Đang di chuyển {movingLauncher.launcherId.toUpperCase()} (Tổ hợp {movingLauncher.instanceId.slice(0, 8)}). Nhấp chuột trái lên vị trí mới trên mặt đất để đặt bệ phóng.
          </span>
          <button
            onClick={() => setMovingLauncher(null)}
            className="ml-2 px-2.5 py-1 text-[11px] bg-amber-900/80 hover:bg-amber-800 text-amber-100 rounded-lg border border-amber-600 transition-colors cursor-pointer"
          >
            Hủy (Esc)
          </button>
        </div>
      )}

      {/* CỤM ĐIỀU KHIỂN GHIM VỊ TRÍ & NÂNG / HẠ BẢN ĐỒ THEO CHIỀU CAO */}
      <div className="absolute right-4 bottom-8 z-20 flex flex-col items-center bg-slate-950/90 backdrop-blur-md p-2 rounded-2xl border border-cyan-500/50 shadow-[0_0_24px_rgba(0,0,0,0.7)] select-none gap-2">
        {/* Nút Ghim / Bỏ ghim vị trí */}
        <button
          onClick={handleTogglePin}
          className={`px-3 py-2 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition-all ${isPinned
            ? 'bg-cyan-600 hover:bg-cyan-500 text-slate-950 border-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.6)]'
            : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
            }`}
          title={isPinned ? 'Đang ghim vị trí tâm - Nhấn để bỏ ghim' : 'Ghim điểm đặt để nâng/hạ chiều cao bản đồ'}
        >
          {isPinned ? <Pin className="w-3.5 h-3.5 fill-current" /> : <PinOff className="w-3.5 h-3.5" />}
          <span>{isPinned ? 'Đang Ghim' : 'Ghim Điểm'}</span>
        </button>

        {/* Nhãn hiển thị độ cao thực tế */}
        <div className="text-center bg-slate-900/80 px-2 py-1 rounded-lg border border-slate-800 w-full">
          <span className="block text-[9px] text-slate-400 font-mono uppercase tracking-wider">Độ Cao</span>
          <span className="block text-xs font-mono font-extrabold text-cyan-300">
            {(cameraHeight / 1000).toFixed(1)} km
          </span>
        </div>

        {/* Nút Nâng lên cao */}
        <button
          onClick={() => stepAltitude(20000)}
          className="p-2 rounded-xl bg-slate-900 hover:bg-cyan-950 text-slate-300 hover:text-cyan-300 border border-slate-800 hover:border-cyan-500/50 transition-colors"
          title="Kéo bản đồ lên cao (+20 km)"
        >
          <ArrowUp className="w-4 h-4" />
        </button>

        {/* Thanh trượt kéo độ cao lên / xuống mượt mà */}
        <div className="py-2 flex items-center justify-center">
          <input
            type="range"
            min="8000"
            max="300000"
            step="4000"
            value={cameraHeight}
            onChange={(e) => setTargetAltitude(parseFloat(e.target.value))}
            className="w-24 h-1.5 accent-cyan-400 bg-slate-800 rounded-lg cursor-pointer -rotate-90 my-8"
            title="Kéo thanh trượt lên/xuống theo chiều cao"
          />
        </div>

        {/* Nút Hạ xuống thấp */}
        <button
          onClick={() => stepAltitude(-20000)}
          className="p-2 rounded-xl bg-slate-900 hover:bg-cyan-950 text-slate-300 hover:text-cyan-300 border border-slate-800 hover:border-cyan-500/50 transition-colors"
          title="Hạ bản đồ xuống thấp (-20 km)"
        >
          <ArrowDown className="w-4 h-4" />
        </button>

        {/* Nút Bật/Tắt So Sánh Địa Hình GIS A vs B */}
        <button
          onClick={() => setShowTerrainComparison(!showTerrainComparison)}
          className={`px-3 py-2 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
            showTerrainComparison
              ? 'bg-fuchsia-600 hover:bg-fuchsia-500 text-slate-950 border-fuchsia-300 shadow-[0_0_12px_rgba(217,70,239,0.6)]'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
          }`}
          title="So sánh ảnh hưởng địa hình của 2 vị trí quan sát (A vs B)"
        >
          <Mountain className="w-3.5 h-3.5" />
          <span>So Sánh Địa Hình</span>
        </button>
      </div>

      {/* Bảng điều khiển So Sánh Địa Hình GIS */}
      <TerrainComparisonPanel
        terrainProvider={viewerRef.current && !viewerRef.current.isDestroyed() ? viewerRef.current.scene.terrainProvider : null}
      />
    </div>
  );
};
