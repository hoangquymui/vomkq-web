import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { Pin, PinOff, ArrowUp, ArrowDown } from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import {
  computeRadarCoverageField,
  computeRadarCoverage,
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
  createCategoryTacticalMarkerSvg,
  formatTacticalAssetInfoCard,
  STATUS_COLOR_MAP,
} from '../../utils/assetVisualization';

// Access token cấu hình từ dự án VomKQ (CesiumIonServer)
Cesium.Ion.defaultAccessToken =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIzYmIyMWFkMS1lYjc5LTQ0NzMtYThlNS1iNTEzMTA1NTY4MjQiLCJpZCI6NDYwODUzLCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3ODUxMjM1ODN9.gyB0vWTm1yJXS2pCkaVqyLdbg1RxFzjReo7jeDEMmQU';

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
    case 'offline':
      // Ảnh vệ tinh ngoại tuyến từ public/offline-satellite (hỗ trợ tới level 16)
      return new Cesium.UrlTemplateImageryProvider({
        url: './offline-satellite/{z}/{x}/{y}.jpg',
        minimumLevel: 0,
        maximumLevel: 16,
      });
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

export const CesiumGlobe: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);

  const [isPinned, setIsPinned] = useState<boolean>(true);
  const [cameraHeight, setCameraHeight] = useState<number>(95000);

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
    measurePoints,
    flyToTarget,
    selectEquipment,
    addEquipment,
    updateEquipment,
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
    categoryFilter,
  } = useTacticalStore();

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
    });

    viewerRef.current = viewer;

    // Nạp địa hình 3D trực tiếp từ thư mục public/offline-terrain
    Cesium.CesiumTerrainProvider.fromUrl('./offline-terrain')
      .then((provider) => {
        if (viewerRef.current && !viewerRef.current.isDestroyed()) {
          viewerRef.current.scene.terrainProvider = provider;
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

    // Lắng nghe thay đổi vị trí camera để cập nhật chỉ số chiều cao thực tế
    viewer.camera.changed.addEventListener(() => {
      if (viewerRef.current) {
        const h = Math.round(viewerRef.current.camera.positionCartographic.height);
        setCameraHeight(h);
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

    // Cleanup khi unmount
    return () => {
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, []);

  // 2. Chuyển đổi chế độ 3D (Địa hình lồi lõm) / 2D (Bản đồ phẳng)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    viewer.scene.verticalExaggeration = terrainExaggeration;

    // Đảm bảo terrainProvider offline được nạp (tránh tạo mới lặp lại nhiều lần)
    if (viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider) {
      Cesium.CesiumTerrainProvider.fromUrl('./offline-terrain')
        .then((provider) => {
          if (viewerRef.current && !viewerRef.current.isDestroyed()) {
            viewerRef.current.terrainProvider = provider;
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
      if (basemap === 'google-terrain' || basemap === 'topo') {
        const localTerrainLayer = new Cesium.ImageryLayer(
          new Cesium.UrlTemplateImageryProvider({
            url: './offline-terrain-map/{z}/{x}/{y}.png',
            minimumLevel: 0,
            maximumLevel: 16,
          })
        );
        viewer.imageryLayers.add(localTerrainLayer);
      }
    } catch (err) {
      console.error('Lỗi nạp Basemap:', err);
      const fallbackLayer = new Cesium.ImageryLayer(
        new Cesium.UrlTemplateImageryProvider({
          url: './offline-satellite/{z}/{x}/{y}.jpg',
          minimumLevel: 0,
          maximumLevel: 16,
        })
      );
      viewer.imageryLayers.add(fallbackLayer);
    }
  }, [basemap, viewMode]);

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

    // Giữ độ cao tối thiểu 85.000m để có tầm nhìn bao quát toàn bộ vòm radar và núi non
    const rawHeight = typeof flyToTarget.height === 'number' && !isNaN(flyToTarget.height) ? flyToTarget.height : 95000;
    const safeHeight = Math.max(85000, rawHeight);

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

  // 5. Quản lý sự kiện Click chuột (Chọn khí tài / Đặt khí tài / Đo đạc trên bề mặt địa hình)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
      const cartesian = pickGroundCartesian(viewer, movement.position);

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

        const newId = `eq_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        addEquipment({
          instanceId: newId,
          templateId: pendingTemplate.id,
          name: `${pendingTemplate.name} #${instances.length + 1}`,
          category: pendingTemplate.category,
          latitude: Number(rawLat.toFixed(5)),
          longitude: Number(rawLon.toFixed(5)),
          altitude: groundHeight,
          antennaHeightAGL: pendingTemplate.antennaHeightAGL || 15,
          rangeKm: pendingTemplate.defaultRangeKm || 50,
          scanSpeed: pendingTemplate.defaultScanSpeed || 0,
          minElevationDeg: pendingTemplate.minElevationDeg !== undefined ? pendingTemplate.minElevationDeg : -10,
          maxElevationDeg: pendingTemplate.maxElevationDeg !== undefined ? pendingTemplate.maxElevationDeg : 40,
          coverageHeightKm: pendingTemplate.coverageHeightKm || 25,
          status: 'Active',
          commandedByInstanceId: null,
          color: pendingTemplate.symbolColor || '#38bdf8',
          showDome: true,
          showSweep: (pendingTemplate.defaultScanSpeed || 0) > 0,
        });
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
          selectEquipment(instId);
          setIsPinned(true);

          // Nhấp vào điểm đặt: Không phóng to quá gần (ít thôi!), giữ tầm nhìn bao quát ~95km
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
          return;
        }
      }

      // Bấm ra ngoài khoảng trống: bỏ chọn và bỏ ghim
      selectEquipment(null);
      setIsPinned(false);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      handler.destroy();
    };
  }, [
    activeTool,
    pendingTemplate,
    instances,
    addEquipment,
    updateEquipment,
    setActiveTool,
    selectedInstanceId,
    addMeasurePoint,
    selectEquipment,
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
              // Cập nhật coverageResults để tương thích ngược cho Modal Đánh Giá Chỉ Số
              const legacyRes = await computeRadarCoverage(
                inst,
                viewer.scene.terrainProvider,
                params
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
      if (candidateRadars.length === 0) return;

      const state = useTacticalStore.getState();
      const currentResults = state.spxResults;

      for (const inst of candidateRadars) {
        if (isCancelled) break;
        const instConfig = {
          ...spxConfig,
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
    setSpxResult,
    setIsCalculatingSpx,
  ]);

  // 6. Render Entities trên bề mặt địa hình lồi lõm
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.entities.removeAll();

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
      const safeAntennaAGL = typeof inst.antennaHeightAGL === 'number' && !isNaN(inst.antennaHeightAGL) && isFinite(inst.antennaHeightAGL)
        ? Math.max(1, inst.antennaHeightAGL)
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

      // 1. Cờ cắm tác chiến & Nhãn thông tin bám địa hình thực (hoặc toạ độ phẳng trong 2D) khi không có SPx
      if (!isSpxActive) {
        const isPendingCalc = isCalculatingSpx && !spxRes && caps.hasRadarCoverage;
        const shortPrefix = inst.shortId ? `[${inst.shortId}] ` : '';
        const displayName = `${shortPrefix}${inst.name}`;
        const radarCartesian = Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, is2D ? 0 : safeAlt);

        if (showMarkersLayer) {
          const flagSvg = createCategoryTacticalMarkerSvg(
            inst.category,
            inst.shortId || 'EQ',
            inst.color || '#06b6d4',
            isSelected,
            inst.status
          );
          // Cờ cắm tác chiến chuẩn chuyên ngành quân sự
          viewer.entities.add({
            name: `Marker ${inst.shortId || ''} (${inst.category})`,
            position: radarCartesian,
            properties: { instanceId: inst.instanceId },
            billboard: {
              image: flagSvg,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
              pixelOffset: new Cesium.Cartesian2(-10, 4),
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
              pixelOffset: new Cesium.Cartesian2(46, -8),
              eyeOffset: new Cesium.Cartesian3(0, 0, -500),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, isSelected ? 800000 : 350000),
              heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.RELATIVE_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
        const envColorHex = isSAM ? '#ef4444' : '#10b981';
        const envColor = Cesium.Color.fromCssColorString(envColorHex);
        const envLabelText = isSAM
          ? `VÙNG HỎA LỰC TÊN LỬA [${inst.shortId || 'SAM'}: ${safeRangeKm}km]`
          : `HỎA LỰC PHÁO PK [${inst.shortId || 'AAA'}: ${safeRangeKm}km]`;

        if (viewMode === '2D') {
          viewer.entities.add({
            name: `Vùng Hỏa Lực ${inst.shortId || ''}`,
            position: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, 0),
            properties: { instanceId: inst.instanceId },
            ellipse: {
              semiMajorAxis: safeRangeKm * 1000,
              semiMinorAxis: safeRangeKm * 1000,
              height: 0,
              material: envColor.withAlpha(isSelected ? (isSAM ? 0.14 : 0.16) : 0.05),
              outline: true,
              outlineColor: envColor.withAlpha(isSelected ? 0.95 : 0.6),
              outlineWidth: isSelected ? 3 : 1.5,
            },
          });
        } else {
          viewer.entities.add({
            name: `Vùng Hỏa Lực ${inst.shortId || ''}`,
            position: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, 0),
            properties: { instanceId: inst.instanceId },
            ellipse: {
              semiMajorAxis: safeRangeKm * 1000,
              semiMinorAxis: safeRangeKm * 1000,
              height: 0,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              classificationType: Cesium.ClassificationType.TERRAIN,
              material: envColor.withAlpha(isSelected ? (isSAM ? 0.14 : 0.16) : 0.05),
              outline: true,
              outlineColor: envColor.withAlpha(isSelected ? 0.95 : 0.6),
              outlineWidth: isSelected ? 3 : 1.5,
            },
          });
        }

        // Nhãn biên giới cự ly hỏa lực (Hướng Bắc 0°)
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

      // 4. Cung Quan Sát Trinh Sát Thụ Động (Trạm Quan Sát OP)
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
        const spxEntities = buildSpxCoverageEntities(spxRes, instConfig, inst.name, {
          isSelected,
          hasAnySelected,
          showCoverage: showCoverageLayer,
          showRangeRings: showRangeRingsLayer,
          showLabels: showLabelsLayer,
          showMarkers: showMarkersLayer,
          shortId: inst.shortId,
          status: inst.status,
          category: inst.category,
          is2D: viewMode === '2D',
          antennaHeightAGL: safeAntennaAGL,
          rangeKm: safeRangeKm,
          color: inst.color,
        });
        spxEntities.forEach((e) => {
          e.properties = new Cesium.PropertyBag({ instanceId: inst.instanceId });
          viewer.entities.add(e);
        });
      } else if (viewMode === '3D' && showAllDomes && inst.showDome && safeRangeKm > 0 && showCoverageLayer && caps.hasRadarCoverage) {
        const field = coverageFields[inst.instanceId];
        if (field && field.rays && field.rays.length > 0) {
          const { visibleEntities, blindEntities, coneOfSilenceEntities } =
            buildRadarCoverageFieldEntities(
              field,
              showBlindZones,
              inst.color,
              isSelected,
              showConeOfSilence
            );

          visibleEntities.forEach((e) => viewer.entities.add(e));
          if (showBlindZones) {
            blindEntities.forEach((e) => viewer.entities.add(e));
          }
          if (showConeOfSilence) {
            coneOfSilenceEntities.forEach((e) => viewer.entities.add(e));
          }
        } else {
          // Fallback bán cầu 3D mờ trong khi đang nạp dữ liệu quang tuyến
          const radiusMeters = safeRangeKm * 1000;
          const heightMeters = Math.min(radiusMeters, ((inst.coverageHeightKm || 25) * 1000));

          viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(
              inst.longitude,
              inst.latitude,
              safeAlt
            ),
            ellipsoid: {
              radii: new Cesium.Cartesian3(radiusMeters, radiusMeters, heightMeters),
              maximumCone: Cesium.Math.PI_OVER_TWO,
              material: baseColor.withAlpha(isSelected ? 0.28 : 0.12),
              outline: true,
              outlineColor: baseColor.withAlpha(isSelected ? 0.8 : 0.3),
              outlineWidth: 1,
            },
          });
        }
      }

      // 4. Tia định hướng Mặt Cắt Ngang 2D trên quả địa cầu 3D
      if (showCrossSection && isSelected && safeRangeKm > 0) {
        const dest = destinationPoint(
          inst.latitude,
          inst.longitude,
          safeRangeKm * 1000,
          selectedAzimuthDeg
        );
        if (!isNaN(dest.lat) && !isNaN(dest.lon) && isFinite(dest.lat) && isFinite(dest.lon)) {
          viewer.entities.add({
            name: `Tia định hướng Mặt Cắt ${selectedAzimuthDeg}°`,
            polyline: {
              positions: [
                Cesium.Cartesian3.fromDegrees(
                  inst.longitude,
                  inst.latitude,
                  safeAlt + safeAntennaAGL + 10
                ),
                Cesium.Cartesian3.fromDegrees(
                  dest.lon,
                  dest.lat,
                  safeAlt + 500
                ),
              ],
              width: 3,
              material: new Cesium.PolylineGlowMaterialProperty({
                color: Cesium.Color.YELLOW,
                glowPower: 0.35,
              }),
              clampToGround: true,
            },
          });
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

    // D. Render đường bao ranh giới tác chiến Việt Nam khi bật chế độ Chỉ Vùng VN
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
  }, [
    instances,
    selectedInstanceId,
    showAllDomes,
    showCommandLinks,
    measurePoints,
    vietnamOnly,
    coverageResults,
    coverageFields,
    showBlindZones,
    showConeOfSilence,
    showCrossSection,
    selectedAzimuthDeg,
    viewMode,
    showSpxPanel,
    spxConfig,
    spxResults,
    isCalculatingSpx,
    showCoverageLayer,
    showRangeRingsLayer,
    showLabelsLayer,
    showMarkersLayer,
    categoryFilter,
  ]);

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

      {/* CỤM ĐIỀU KHIỂN GHIM VỊ TRÍ & NÂNG / HẠ BẢN ĐỒ THEO CHIỀU CAO */}
      <div className="absolute right-4 bottom-8 z-20 flex flex-col items-center bg-slate-950/90 backdrop-blur-md p-2 rounded-2xl border border-cyan-500/50 shadow-[0_0_24px_rgba(0,0,0,0.7)] select-none gap-2">
        {/* Nút Ghim / Bỏ ghim vị trí */}
        <button
          onClick={handleTogglePin}
          className={`px-3 py-2 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition-all ${
            isPinned
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
      </div>
    </div>
  );
};
