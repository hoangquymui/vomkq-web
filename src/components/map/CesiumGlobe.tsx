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

// Access token cấu hình từ dự án VomKQ (CesiumIonServer)
Cesium.Ion.defaultAccessToken =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIzYmIyMWFkMS1lYjc5LTQ0NzMtYThlNS1iNTEzMTA1NTY4MjQiLCJpZCI6NDYwODUzLCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3ODUxMjM1ODN9.gyB0vWTm1yJXS2pCkaVqyLdbg1RxFzjReo7jeDEMmQU';

// Helper tạo ImageryProvider linh hoạt cho Basemap
function createImageryProvider(basemap: 'satellite' | 'offline' | 'topo' | 'dark' | 'osm') {
  switch (basemap) {
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
      // Bản đồ địa hình đường đồng mức OpenTopoMap
      return new Cesium.UrlTemplateImageryProvider({
        url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
        maximumLevel: 17,
        credit: new Cesium.Credit('© OpenTopoMap contributors'),
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
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
      });
  }
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
      Cesium.CesiumTerrainProvider.fromUrl('./offline-terrain')
        .then((provider) => {
          if (viewerRef.current && !viewerRef.current.isDestroyed()) {
            viewerRef.current.scene.terrainProvider = provider;
          }
        })
        .catch((err) => console.warn('Lỗi nạp địa hình offline 3D:', err));
    }
  }, [viewMode, terrainExaggeration]);

  // 3. Phản ứng khi thay đổi Lớp Bản đồ Nền (Basemap) hoặc Chuyển đổi 2D/3D
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    viewer.imageryLayers.removeAll();

    if (viewMode === '2D') {
      // CHẾ ĐỘ 2D: CHỈ LOAD DUY NHẤT BẢN ĐỒ TOPO ĐỘ CAO
      // Lớp nền dự phòng trực tuyến OpenTopoMap
      const onlineTopoLayer = new Cesium.ImageryLayer(
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
          maximumLevel: 17,
          credit: new Cesium.Credit('© OpenTopoMap contributors'),
        })
      );
      viewer.imageryLayers.add(onlineTopoLayer);

      // Lớp ngoại tuyến ưu tiên tải từ public/offline-topo/
      const offlineTopoLayer = new Cesium.ImageryLayer(
        new Cesium.UrlTemplateImageryProvider({
          url: './offline-topo/{z}/{x}/{y}.png',
          minimumLevel: 0,
          maximumLevel: 16,
        })
      );
      viewer.imageryLayers.add(offlineTopoLayer);
    } else {
      // CHẾ ĐỘ 3D: Nạp lớp bản đồ nền theo lựa chọn của người dùng (Vệ tinh, Ngoại tuyến, v.v.)
      try {
        const provider = createImageryProvider(basemap);
        const layer = new Cesium.ImageryLayer(provider);
        viewer.imageryLayers.add(layer);
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
    if (!viewer || !flyToTarget) return;

    // Giữ độ cao tối thiểu 85.000m để có tầm nhìn bao quát toàn bộ vòm radar và núi non
    const safeHeight = Math.max(85000, flyToTarget.height);

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
      let cartesian: Cesium.Cartesian3 | undefined;
      if (viewer.scene.globe.depthTestAgainstTerrain) {
        cartesian = viewer.scene.pickPosition(movement.position);
      }
      if (!cartesian) {
        const ray = viewer.camera.getPickRay(movement.position);
        if (ray) {
          cartesian = viewer.scene.globe.pick(ray, viewer.scene);
        }
      }

      // A. Chế độ đo khoảng cách
      if (activeTool === 'measure') {
        if (cartesian) {
          const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
          addMeasurePoint({
            lat: Cesium.Math.toDegrees(cartographic.latitude),
            lon: Cesium.Math.toDegrees(cartographic.longitude),
            height: Math.max(0, cartographic.height),
          });
        }
        return;
      }

      // B. Chế độ đặt khí tài mới
      if (activeTool === 'place' && pendingTemplate && cartesian) {
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        const lat = Cesium.Math.toDegrees(cartographic.latitude);
        const lon = Cesium.Math.toDegrees(cartographic.longitude);
        const groundHeight = Math.max(0, Math.round(cartographic.height));

        const newId = `eq_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        addEquipment({
          instanceId: newId,
          templateId: pendingTemplate.id,
          name: `${pendingTemplate.name} #${instances.length + 1}`,
          category: pendingTemplate.category,
          latitude: Number(lat.toFixed(5)),
          longitude: Number(lon.toFixed(5)),
          altitude: groundHeight,
          antennaHeightAGL: pendingTemplate.antennaHeightAGL,
          rangeKm: pendingTemplate.defaultRangeKm,
          scanSpeed: pendingTemplate.defaultScanSpeed,
          minElevationDeg: pendingTemplate.minElevationDeg,
          maxElevationDeg: pendingTemplate.maxElevationDeg,
          coverageHeightKm: pendingTemplate.coverageHeightKm,
          status: 'Active',
          commandedByInstanceId: null,
          color: pendingTemplate.symbolColor,
          showDome: true,
          showSweep: pendingTemplate.defaultScanSpeed > 0,
        });
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
          if (inst) {
            const currentH = viewer.camera.positionCartographic.height;
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
  }, [activeTool, pendingTemplate, instances, addEquipment, addMeasurePoint, selectEquipment]);

  // 5b. Tính toán Quang tuyến LOS & Coverage Field cho tất cả các đài radar
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || instances.length === 0) return;

    let isCancelled = false;

    const calcAll = async () => {
      // 1. Kiểm tra xem có đài nào thực sự cần tính toán mới không
      const state = useTacticalStore.getState();
      const currentFields = state.coverageFields;
      const cache = state.coverageFieldCache;

      let hasPendingCalculation = false;
      for (const inst of instances) {
        if (inst.rangeKm > 0 && inst.showDome) {
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
        if (inst.rangeKm > 0 && inst.showDome) {
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
    targetHeightMeters,
    azimuthStepDeg,
    elevationStepDeg,
    kFactor,
    showBlindZones,
    setCoverageField,
    setCoverageResult,
    setIsCalculatingLOS,
  ]);

  // 6. Render Entities trên bề mặt địa hình lồi lõm
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.entities.removeAll();

    const instanceMap = new Map(instances.map((i) => [i.instanceId, i]));

    // A. Render các khí tài
    instances.forEach((inst) => {
      const isSelected = selectedInstanceId === inst.instanceId;

      const position = Cesium.Cartesian3.fromDegrees(
        inst.longitude,
        inst.latitude,
        inst.antennaHeightAGL || 15
      );

      const baseColor = Cesium.Color.fromCssColorString(inst.color);
      const highlightColor = Cesium.Color.WHITE;

      // 1. Marker & Label bám địa hình thực
      viewer.entities.add({
        position: position,
        properties: { instanceId: inst.instanceId },
        point: {
          pixelSize: isSelected ? 16 : 11,
          color: isSelected ? highlightColor : baseColor,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: `${inst.name} [${inst.altitude}m]`,
          font: isSelected ? 'bold 13px Inter, sans-serif' : '11px Inter, sans-serif',
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          fillColor: isSelected ? Cesium.Color.YELLOW : Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });

      // 2. Vòng chân vòm 2D ôm theo nếp lồi lõm của sườn núi
      if (inst.rangeKm > 0) {
        viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, 0),
          ellipse: {
            semiMajorAxis: inst.rangeKm * 1000,
            semiMinorAxis: inst.rangeKm * 1000,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            classificationType: Cesium.ClassificationType.TERRAIN,
            material: baseColor.withAlpha(isSelected ? 0.15 : 0.06),
            outline: true,
            outlineColor: baseColor.withAlpha(isSelected ? 0.9 : 0.4),
            outlineWidth: isSelected ? 2 : 1,
          },
        });
      }

      // 3. Vòm Radar 3D Dựng Trực Tiếp Từ Coverage Field (Single Source of Truth)
      if (showAllDomes && inst.showDome && inst.rangeKm > 0) {
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
          const radiusMeters = inst.rangeKm * 1000;
          const heightMeters = Math.min(radiusMeters, inst.coverageHeightKm * 1000);

          viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(
              inst.longitude,
              inst.latitude,
              inst.altitude
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
      if (showCrossSection && isSelected && inst.rangeKm > 0) {
        const dest = destinationPoint(
          inst.latitude,
          inst.longitude,
          inst.rangeKm * 1000,
          selectedAzimuthDeg
        );
        viewer.entities.add({
          name: `Tia định hướng Mặt Cắt ${selectedAzimuthDeg}°`,
          polyline: {
            positions: [
              Cesium.Cartesian3.fromDegrees(
                inst.longitude,
                inst.latitude,
                inst.altitude + inst.antennaHeightAGL + 10
              ),
              Cesium.Cartesian3.fromDegrees(
                dest.lon,
                dest.lat,
                inst.altitude + 500
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
    });

    // B. Render đường liên kết chỉ huy (Command Links)
    if (showCommandLinks) {
      instances.forEach((sub) => {
        if (sub.commandedByInstanceId) {
          const parent = instanceMap.get(sub.commandedByInstanceId);
          if (parent) {
            const parentPos = Cesium.Cartesian3.fromDegrees(
              parent.longitude,
              parent.latitude,
              parent.altitude + parent.antennaHeightAGL + 60
            );
            const subPos = Cesium.Cartesian3.fromDegrees(
              sub.longitude,
              sub.latitude,
              sub.altitude + sub.antennaHeightAGL + 30
            );

            viewer.entities.add({
              polyline: {
                positions: [parentPos, subPos],
                width: 3,
                material: new Cesium.PolylineGlowMaterialProperty({
                  glowPower: 0.2,
                  taperPower: 0.5,
                  color: Cesium.Color.fromCssColorString('#eab308'),
                }),
              },
            });
          }
        }
      });
    }

    // C. Render công cụ đo khoảng cách
    if (measurePoints.length > 0) {
      measurePoints.forEach((p, idx) => {
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
            text: `Mốc ${idx + 1} (${Math.round(p.height)}m)`,
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

      if (measurePoints.length >= 2) {
        const positions = measurePoints.map((p) =>
          Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.height + 15)
        );
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
        if (inst) {
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
      const ray = viewer.camera.getPickRay(
        new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2)
      );
      if (ray) {
        const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
        if (cartesian) {
          const carto = Cesium.Cartographic.fromCartesian(cartesian);
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

    const lon = selectedInst
      ? selectedInst.longitude
      : Cesium.Math.toDegrees(viewer.camera.positionCartographic.longitude);
    const lat = selectedInst
      ? selectedInst.latitude
      : Cesium.Math.toDegrees(viewer.camera.positionCartographic.latitude);

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
