/**
 * HOOK KẾT NỐI CESIUM VỚI SA BÀN TÁC CHIẾN MÔ PHỎNG (TACTICAL RADAR SANDBOX)
 * =========================================================================
 * 
 * Quản lý trực tiếp trên Quả cầu Cesium:
 * 1. Chuyển đổi vật liệu địa hình sang Tương phản cao (Monochrome SAR / CRT Green / Amber HUD)
 * 2. Quản lý CustomDataSource hiển thị các thực thể sa bàn độc lập (không lẫn lộn với thực thể chính)
 * 3. Render các chốt hỏa lực đón lõng (MANPADS, Pháo ZU-23-2, Đài quan sát) kèm vòm hỏa lực WEZ
 * 4. Render vệt bay luồn khe núi (Polyline Glow) và UAV mô phỏng bay theo thời gian thực
 */

import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { useTacticalSandboxStore } from '../store/useTacticalSandboxStore';
import { useTacticalStore } from '../store/useTacticalStore';
import { applyTacticalSandboxShading, revertTacticalSandboxShading } from './tacticalSandboxShading';
import { getUavPositionAtProgress } from './tacticalInfiltrationEngine';

export function useTacticalSandboxCesium(
  viewerOrRef: React.RefObject<Cesium.Viewer | null> | Cesium.Viewer | null
): void {
  const dataSourceRef = useRef<Cesium.CustomDataSource | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(performance.now());
  const savedCameraRef = useRef<{
    position: Cesium.Cartesian3;
    heading: number;
    pitch: number;
    roll: number;
    mode: Cesium.SceneMode;
  } | null>(null);

  const getViewer = (): Cesium.Viewer | null => {
    if (!viewerOrRef) return null;
    if ('current' in viewerOrRef) return viewerOrRef.current;
    return viewerOrRef;
  };

  const {
    isSandboxActive,
    theme,
    activeRadarId,
    deployedUnits,
    activeInfiltrationRoute,
    isSimulating,
    simulationSpeedMultiplier,
    showWEZDomes,
    stepSimulationProgress,
  } = useTacticalSandboxStore();

  // 1. Quản lý khởi tạo DataSource riêng biệt cho Sa bàn
  useEffect(() => {
    const viewer = getViewer();
    if (!viewer || viewer.isDestroyed()) return;

    const ds = new Cesium.CustomDataSource('tactical-sandbox-ds');
    viewer.dataSources.add(ds);
    dataSourceRef.current = ds;

    return () => {
      const v = getViewer();
      if (v && !v.isDestroyed() && ds) {
        v.dataSources.remove(ds, true);
      }
      dataSourceRef.current = null;
    };
  }, [viewerOrRef]);

  // 1b. Quản lý Camera điện ảnh 3D khi vào / ra Sa bàn
  useEffect(() => {
    const viewer = getViewer();
    if (!viewer || viewer.isDestroyed()) return;

    if (isSandboxActive) {
      // 1. Lưu lại camera trước khi vào sa bàn
      if (!savedCameraRef.current) {
        savedCameraRef.current = {
          position: Cesium.Cartesian3.clone(viewer.camera.position),
          heading: viewer.camera.heading,
          pitch: viewer.camera.pitch,
          roll: viewer.camera.roll,
          mode: viewer.scene.mode,
        };
      }

      // 2. Chuyển sang 3D nếu đang ở 2D hoặc Columbus View
      if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) {
        try {
          viewer.scene.morphTo3D(0.5);
        } catch {
          // Morph guard
        }
      }

      viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
      viewer.scene.globe.depthTestAgainstTerrain = true;

      // 3. Xác định vị trí trọng tâm của sa bàn
      const state = useTacticalStore.getState();
      const targetRadar =
        (activeRadarId && state.instances.find((i) => i.instanceId === activeRadarId)) ||
        state.instances[0];

      let targetLon = 105.645;
      let targetLat = 21.458;
      let targetAlt = 950;

      if (targetRadar) {
        targetLon = targetRadar.longitude;
        targetLat = targetRadar.latitude;
        targetAlt = targetRadar.altitude || 950;
      } else if (activeInfiltrationRoute && activeInfiltrationRoute.waypoints.length > 0) {
        const midWp = activeInfiltrationRoute.waypoints[Math.floor(activeInfiltrationRoute.waypoints.length / 2)];
        targetLon = midWp.lon;
        targetLat = midWp.lat;
        targetAlt = midWp.altitudeM;
      }

      const centerPos = Cesium.Cartesian3.fromDegrees(targetLon, targetLat, targetAlt);
      const sphere = new Cesium.BoundingSphere(centerPos, 12000);

      viewer.camera.flyToBoundingSphere(sphere, {
        offset: new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(35),
          Cesium.Math.toRadians(-28),
          20000
        ),
        duration: 1.5,
      });
    } else {
      // Khôi phục lại góc nhìn ban đầu khi thoát sa bàn
      if (savedCameraRef.current) {
        const saved = savedCameraRef.current;
        if (saved.mode === Cesium.SceneMode.SCENE2D) {
          try {
            viewer.scene.morphTo2D(0.5);
          } catch {
            // Morph guard
          }
        }
        viewer.camera.flyTo({
          destination: saved.position,
          orientation: {
            heading: saved.heading,
            pitch: saved.pitch,
            roll: saved.roll,
          },
          duration: 1.2,
        });
        savedCameraRef.current = null;
      }
    }
  }, [viewerOrRef, isSandboxActive, activeRadarId]);

  // 2. Chuyển đổi Shader Vật liệu Địa hình (Tương phản cao SAR / CRT Green / Amber)
  useEffect(() => {
    const viewer = getViewer();
    if (!viewer || viewer.isDestroyed()) return;

    if (isSandboxActive) {
      applyTacticalSandboxShading(viewer, theme, 0, 1600);
    } else {
      revertTacticalSandboxShading(viewer);
    }

    return () => {
      const v = getViewer();
      if (v && !v.isDestroyed() && isSandboxActive) {
        revertTacticalSandboxShading(v);
      }
    };
  }, [viewerOrRef, isSandboxActive, theme]);

  // 3. Render các thực thể chiến thuật (Units, WEZ Domes, Infiltration Route, UAV)
  useEffect(() => {
    const viewer = getViewer();
    const ds = dataSourceRef.current;
    if (!viewer || viewer.isDestroyed() || !ds) return;

    ds.entities.removeAll();

    if (!isSandboxActive) {
      viewer.scene.requestRender();
      return;
    }

    // A. Render các đơn vị chiến thuật đã bố trí
    for (const unit of deployedUnits) {
      const unitPos = Cesium.Cartesian3.fromDegrees(
        unit.longitude,
        unit.latitude,
        unit.altitudeM + 5
      );
      const color = Cesium.Color.fromCssColorString(unit.colorHex);

      // Điểm mốc định vị trên đỉnh núi
      ds.entities.add({
        name: unit.name,
        position: unitPos,
        properties: { unitId: unit.id, isTacticalSandboxUnit: true },
        point: {
          pixelSize: 12,
          color: color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: `🎯 ${unit.name}\n[${unit.altitudeM}m | R=${(unit.rangeM / 1000).toFixed(1)}km]`,
          font: 'bold 10px "JetBrains Mono", sans-serif',
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          fillColor: color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.85),
          backgroundPadding: new Cesium.Cartesian2(6, 4),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -14),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });

      // Vòm hỏa lực / Bán kính đón lõng (WEZ Footprint)
      if (showWEZDomes && unit.rangeM > 0) {
        ds.entities.add({
          name: `Vòm hỏa lực ${unit.name}`,
          position: Cesium.Cartesian3.fromDegrees(unit.longitude, unit.latitude, 0),
          ellipse: {
            semiMajorAxis: unit.rangeM,
            semiMinorAxis: unit.rangeM,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            classificationType: Cesium.ClassificationType.TERRAIN,
            material: color.withAlpha(0.12),
            outline: true,
            outlineColor: color.withAlpha(0.75),
            outlineWidth: 2,
          },
        });
      }
    }

    // B. Render Tuyến bay luồn lách UAV (Infiltration Route)
    if (activeInfiltrationRoute && activeInfiltrationRoute.waypoints.length > 1) {
      const route = activeInfiltrationRoute;
      const positions = route.waypoints.map((wp) =>
        Cesium.Cartesian3.fromDegrees(wp.lon, wp.lat, wp.altitudeM)
      );

      // Xác định màu sắc chủ đạo của vệt bay
      const hasDetected = route.detectedRatioPercent > 30;
      const glowColor = hasDetected
        ? Cesium.Color.fromCssColorString('#ef4444') // Bị radar phát hiện nhiều -> Đỏ
        : Cesium.Color.fromCssColorString('#10b981'); // Ẩn náu trong khe núi -> Xanh

      ds.entities.add({
        name: route.name,
        polyline: {
          positions,
          width: 4,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.35,
            color: glowColor,
          }),
        },
      });

      // C. Render UAV trên quỹ đạo bay
      const uavPos = getUavPositionAtProgress(route, route.currentProgress);
      if (uavPos) {
        const uavCartesian = Cesium.Cartesian3.fromDegrees(
          uavPos.lon,
          uavPos.lat,
          uavPos.altM
        );

        let uavColor = Cesium.Color.fromCssColorString('#10b981'); // Stealth
        let statusBadge = `🛩️ ${route.targetType} [LẨN TRỐN KHE NÚI]`;

        if (uavPos.status === 'intercepted') {
          uavColor = Cesium.Color.fromCssColorString('#f97316'); // Intercepted
          statusBadge = `💥 ${route.targetType} [ĐÃ BỊ ĐÓN LÕNG TIÊU DIỆT]`;
        } else if (uavPos.status === 'detected') {
          uavColor = Cesium.Color.fromCssColorString('#ef4444'); // Detected
          statusBadge = `⚠️ ${route.targetType} [BỊ RADAR PHÁT HIỆN!]`;
        }

        ds.entities.add({
          name: 'UAV Đột Kích',
          position: uavCartesian,
          point: {
            pixelSize: 15,
            color: uavColor,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2.5,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: `${statusBadge}\nCao độ: ${Math.round(uavPos.altM)}m ASL (${Math.round(uavPos.altM - (route.waypoints[0]?.altitudeM ?? 0) + 60)}m AGL)`,
            font: 'bold 11px "JetBrains Mono", sans-serif',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: uavColor,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.9),
            backgroundPadding: new Cesium.Cartesian2(6, 4),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -16),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
    }

    viewer.scene.requestRender();
  }, [
    viewerOrRef,
    isSandboxActive,
    deployedUnits,
    activeInfiltrationRoute,
    activeInfiltrationRoute?.currentProgress,
    activeInfiltrationRoute?.status,
    showWEZDomes,
  ]);

  // 4. Vòng lặp mô phỏng bay theo thời gian thực (Animation Loop)
  useEffect(() => {
    const viewer = getViewer();
    if (!isSimulating || !activeInfiltrationRoute || !viewer || viewer.isDestroyed()) {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      return;
    }

    lastTimeRef.current = performance.now();

    const loop = (now: number) => {
      const dtSec = Math.max(0.001, Math.min(0.1, (now - lastTimeRef.current) / 1000));
      lastTimeRef.current = now;

      const totalDist = activeInfiltrationRoute.totalDistanceM || 10000;
      const speed = activeInfiltrationRoute.targetSpeedMps * simulationSpeedMultiplier;
      const deltaProgress = (dtSec * speed) / totalDist;

      stepSimulationProgress(deltaProgress);

      const v = getViewer();
      if (v && !v.isDestroyed()) {
        v.scene.requestRender();
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [
    viewerOrRef,
    isSimulating,
    activeInfiltrationRoute?.id,
    activeInfiltrationRoute?.totalDistanceM,
    activeInfiltrationRoute?.targetSpeedMps,
    simulationSpeedMultiplier,
    stepSimulationProgress,
  ]);
}
