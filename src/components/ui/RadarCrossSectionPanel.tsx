import React, { useMemo, useState, useCallback } from 'react';
import {
  X,
  Compass,
  Mountain,
  ChevronLeft,
  ChevronRight,
  Minus,
  ChevronUp,
  Crosshair,
  MapPin,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { useShallow } from 'zustand/react/shallow';
import { destinationPoint } from '../../utils/radarLosEngine';
import {
  calculateSamPearMaxRange,
  calculateSamDeadConeRadius,
  calculateSpyderDomeMaxRange,
  type SamEngagementMode,
} from '../../utils/missileVolumeEngine';
import { EQUIPMENT_TEMPLATES, SPYDER_SYSTEM_DEFAULT_CONFIG } from '../../data/equipmentTemplates';

interface BlindSegment {
  id: number;
  rBdKm: number;
  rKtKm: number;
  rBdM: number;
  rKtM: number;
  lengthKm: number;
  peakDistKm: number;
  peakAltM: number;
  maxShadowDepthM: number;
  polygonD: string;
  midDistM: number;
  midRayAltM: number;
  midTgtAltM: number;
}

export const RadarCrossSectionPanel: React.FC = () => {
  const {
    instances,
    selectedInstanceId,
    coverageFields,
    showCrossSection,
    setShowCrossSection,
    selectedAzimuthDeg,
    setSelectedAzimuthDeg,
    samVolumes,
    samEngagementModes,
    setSamEngagementMode,
    crossSectionProbePoint,
    setCrossSectionProbePoint,
    clearCrossSectionProbePoint,
    targetHeightMeters,
    setTargetHeightMeters,
    kFactor,
    coverageVolumes,
    isCalculatingVolume,
    isCalculatingLOS,
  } = useTacticalStore(useShallow((state) => ({
    instances: state.instances,
    selectedInstanceId: state.selectedInstanceId,
    coverageFields: state.coverageFields,
    coverageVolumes: state.coverageVolumes,
    isCalculatingVolume: state.isCalculatingVolume,
    isCalculatingLOS: state.isCalculatingLOS,
    showCrossSection: state.showCrossSection,
    setShowCrossSection: state.setShowCrossSection,
    selectedAzimuthDeg: state.selectedAzimuthDeg,
    setSelectedAzimuthDeg: state.setSelectedAzimuthDeg,
    samVolumes: state.samVolumes,
    samEngagementModes: state.samEngagementModes,
    setSamEngagementMode: state.setSamEngagementMode,
    crossSectionProbePoint: state.crossSectionProbePoint,
    setCrossSectionProbePoint: state.setCrossSectionProbePoint,
    clearCrossSectionProbePoint: state.clearCrossSectionProbePoint,
    targetHeightMeters: state.targetHeightMeters,
    setTargetHeightMeters: state.setTargetHeightMeters,
    kFactor: state.kFactor,
  })));

  const [isMinimized, setIsMinimized] = useState(false);
  const [hoverData, setHoverData] = useState<{
    distKm: number;
    altM: number;
    terrainM?: number;
    status?: string;
  } | null>(null);

  // Chế độ bay của mục tiêu: true = Bám địa hình (AGL như trong sách), false = Tuyệt đối (MSL)
  const [isTargetAgl, setIsTargetAgl] = useState<boolean>(true);

  // Quản lý khung nhìn Zoom & Pan (Viewport)
  const [viewDistMinM, setViewDistMinM] = useState<number>(0);
  const [viewDistMaxM, setViewDistMaxM] = useState<number | null>(null);
  const [viewAltMinM, setViewAltMinM] = useState<number>(0);
  const [viewAltMaxM, setViewAltMaxM] = useState<number | null>(null);

  // Kéo chuột để Pan khung nhìn
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{
    x: number;
    y: number;
    distMin: number;
    distMax: number;
    altMin: number;
    altMax: number;
  } | null>(null);

  const selectedInst = useMemo(
    () => instances.find((i) => i.instanceId === selectedInstanceId),
    [instances, selectedInstanceId]
  );

  const isSam = selectedInst?.category === 'TenLuaPhongKhong';

  const field = useMemo(
    () => (selectedInstanceId && !isSam ? coverageFields[selectedInstanceId] : null),
    [coverageFields, selectedInstanceId, isSam]
  );

  const [prevSelectedId, setPrevSelectedId] = useState(selectedInstanceId);
  const [prevSamMode, setPrevSamMode] = useState<SamEngagementMode | null>(null);

  if (prevSelectedId !== selectedInstanceId) {
    setPrevSelectedId(selectedInstanceId);
    setViewDistMinM(0);
    setViewDistMaxM(null);
    setViewAltMinM(0);
    setViewAltMaxM(null);
  }
  // === DỮ LIỆU ĐẶC THÙ CHO SAM ===
  const samVolume = useMemo(
    () => (selectedInst && isSam ? samVolumes[selectedInst.instanceId] : null),
    [samVolumes, selectedInst, isSam]
  );

  // Tìm góc Azimuth gần nhất có trong Coverage Field hoặc 3D Volume
  const availableAzimuths = useMemo(() => {
    if (isSam && samVolume) return samVolume.azimuthSamples || [];
    const radarVol = selectedInstanceId && !isSam ? coverageVolumes[selectedInstanceId] : null;
    if (radarVol && radarVol.terrainGrid) return radarVol.terrainGrid.azimuthSamples || [];
    if (!field || !field.azimuthRays) return [];
    return Object.keys(field.azimuthRays)
      .map(Number)
      .sort((a, b) => a - b);
  }, [field, isSam, samVolume, selectedInstanceId, coverageVolumes]);

  const currentAzimuth = useMemo(() => {
    if (availableAzimuths.length === 0) return selectedAzimuthDeg;
    let closest = availableAzimuths[0];
    let minDiff = 360;
    for (const az of availableAzimuths) {
      let diff = Math.abs(az - selectedAzimuthDeg);
      if (diff > 180) diff = 360 - diff;
      if (diff < minDiff) {
        minDiff = diff;
        closest = az;
      }
    }
    return closest;
  }, [availableAzimuths, selectedAzimuthDeg]);

  // Lấy danh sách Ray trên hướng phương vị đã chọn (đối với Radar)
  const raysOnAzimuth = useMemo(() => {
    if (!field || !field.azimuthRays) return [];
    return field.azimuthRays[currentAzimuth] || [];
  }, [field, currentAzimuth]);

  const activeSamMode: SamEngagementMode = useMemo(() => {
    if (!selectedInst) return 'head_on';
    return (
      selectedInst.samEngagementMode ||
      samEngagementModes[selectedInst.instanceId] ||
      'head_on'
    );
  }, [selectedInst, samEngagementModes]);

  if (isSam && prevSamMode !== activeSamMode) {
    setPrevSamMode(activeSamMode);
    setViewDistMinM(0);
    setViewDistMaxM(null);
    setViewAltMinM(0);
    setViewAltMaxM(null);
  }

  const samTmpl = useMemo(
    () => (selectedInst ? EQUIPMENT_TEMPLATES.find((t) => t.id === selectedInst.templateId) : null),
    [selectedInst]
  );

  const samProfile = useMemo(() => {
    if (!selectedInst || !isSam) return null;
    const profiles = selectedInst.samProfiles || samTmpl?.samProfiles;
    if (!profiles) return null;
    let prof = profiles[activeSamMode];
    if (!prof) {
      if (activeSamMode === 'jamming_passive' && profiles['passive_jamming']) prof = profiles['passive_jamming'];
      else if (activeSamMode === 'passive_jamming' && profiles['jamming_passive']) prof = profiles['jamming_passive'];
      else if (activeSamMode === 'jamming_active' && profiles['active_jamming']) prof = profiles['active_jamming'];
      else if (activeSamMode === 'active_jamming' && profiles['jamming_active']) prof = profiles['jamming_active'];
      else if (activeSamMode === 'tbk_optical' && profiles['tvk_optical']) prof = profiles['tvk_optical'];
      else if (activeSamMode === 'tvk_optical' && profiles['tbk_optical']) prof = profiles['tbk_optical'];
      else if (activeSamMode === 'jamming' && (profiles['active_jamming'] || profiles['jamming_active'])) prof = profiles['active_jamming'] || profiles['jamming_active'];
    }
    return prof || null;
  }, [selectedInst, isSam, samTmpl, activeSamMode]);

  // Danh sách các chế độ bắn thực tế theo cấu hình từng tổ hợp SAM
  const availableModes = useMemo(() => {
    if (!selectedInst || !isSam) return [];
    const profiles = selectedInst.samProfiles || samTmpl?.samProfiles;
    if (profiles && Object.keys(profiles).length > 0) {
      return Object.entries(profiles).map(([id, p]) => {
        let shortLabel = id;
        if (id === 'head_on') shortLabel = 'Đón';
        else if (id === 'tail_chase') shortLabel = 'Đuổi';
        else if (id === 'ballistic') shortLabel = 'Đạn đạo';
        else if (id === 'jamming') shortLabel = 'Nhiễu EW';
        else if (id === 'passive_jamming' || id === 'jamming_passive') shortLabel = 'Nhiễu-TC';
        else if (id === 'active_jamming' || id === 'jamming_active') shortLabel = 'Nhiễu-TK';
        else if (id === 'tvk_optical' || id === 'tbk_optical') shortLabel = 'Quang';
        else if (id === 'surface') shortLabel = 'Mặt đất';
        else if (id === 'sr_mode') shortLabel = 'SR-20km';
        else if (id === 'lobl_sr') shortLabel = 'LOBL';
        else if (id === 'toplite_optical') shortLabel = 'Toplite';
        else if (p.modeVi) {
          if (p.modeVi.includes('Đón')) shortLabel = 'Đón';
          else if (p.modeVi.includes('Đuổi')) shortLabel = 'Đuổi';
          else if (p.modeVi.toLowerCase().includes('đạn đạo')) shortLabel = 'Đạn đạo';
          else if (p.modeVi.includes('tiêu cực')) shortLabel = 'Nhiễu-TC';
          else if (p.modeVi.includes('tích cực')) shortLabel = 'Nhiễu-TK';
          else if (p.modeVi.includes('Toplite')) shortLabel = 'Toplite';
          else if (p.modeVi.includes('LOBL')) shortLabel = 'LOBL';
          else if (p.modeVi.includes('SR')) shortLabel = 'SR-20km';
          else if (p.modeVi.includes('Quang') || p.modeVi.includes('ТВК')) shortLabel = 'Quang';
          else if (p.modeVi.toLowerCase().includes('mặt đất')) shortLabel = 'Mặt đất';
        }
        return {
          id: id as SamEngagementMode,
          label: p.modeVi,
          shortLabel,
          dMaxKm: p.dMaxKm,
          hMaxM: p.hMaxM,
          dMinKm: p.dMinKm,
          hMinM: p.hMinM,
          vMaxMps: p.vMaxMps,
          pGhKm: p.pGhKm,
        };
      });
    }
    return [
      { id: 'head_on' as SamEngagementMode, label: 'Bắn đón (Không nhiễu)', shortLabel: 'Đón', dMaxKm: selectedInst.rangeKm || 35.4, hMaxM: selectedInst.maxEngagementAltitudeM || 25000 },
      { id: 'tail_chase' as SamEngagementMode, label: 'Bắn đuổi (Không nhiễu)', shortLabel: 'Đuổi', dMaxKm: (selectedInst.rangeKm || 35.4) * 0.7, hMaxM: (selectedInst.maxEngagementAltitudeM || 25000) * 0.75 },
    ];
  }, [selectedInst, isSam, samTmpl]);

  const isSpyder = useMemo(
    () => selectedInst?.templateId === 'sam_spyder' || !!selectedInst?.spyderConfig,
    [selectedInst]
  );

  const spyderCfg = useMemo(
    () =>
      selectedInst?.spyderConfig ||
      samTmpl?.spyderConfig ||
      (isSpyder ? SPYDER_SYSTEM_DEFAULT_CONFIG : undefined),
    [selectedInst, samTmpl, isSpyder]
  );

  const samDMaxKm = samProfile?.dMaxKm || selectedInst?.rangeKm || samTmpl?.defaultRangeKm || 35.4;
  const samDMinKm = samProfile?.dMinKm || selectedInst?.minEngagementRangeKm || samTmpl?.minEngagementRangeKm || 3.5;
  const samHMaxM = samProfile?.hMaxM || selectedInst?.maxEngagementAltitudeM || samTmpl?.maxEngagementAltitudeM || 25000;
  const samHMinM = samProfile?.hMinM || selectedInst?.minEngagementAltitudeM || samTmpl?.minEngagementAltitudeM || 20;
  const samHOptM = selectedInst?.optimalAltitudeM || samTmpl?.optimalAltitudeM || Math.round(samHMaxM * 0.35);
  const samVMps = samProfile?.vMaxMps || selectedInst?.maxTargetSpeedMps || samTmpl?.maxTargetSpeedMps || 900;
  const samPGhKm = samProfile?.pGhKm || selectedInst?.maxTargetParamKm || samTmpl?.maxTargetParamKm || 25.0;

  // Kích thước đồ thị chuẩn
  const width = 880;
  const height = 370;
  const padLeft = 68;
  const padRight = 36;
  const padTop = 32;
  const padBottom = 56;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  // Giới hạn cự ly và độ cao tối đa danh nghĩa của khí tài (tự động ôm sát chế độ tác chiến)
  const maxRangeM = useMemo(() => {
    if (isSam) {
      return Math.max(samDMaxKm * 1000 * 1.15, 20000);
    }
    return field ? field.maxRangeKm * 1000 : (selectedInst?.rangeKm || 150) * 1000;
  }, [isSam, samDMaxKm, field, selectedInst]);

  const maxAltM = useMemo(() => {
    if (isSam) {
      return Math.max(samHMaxM * 1.15, 12000);
    }
    return field ? Math.max(30000, field.maxHeightM + 2000) : 32000;
  }, [isSam, samHMaxM, field]);

  // Cửa sổ hiển thị hiện tại (áp dụng zoom)
  const curDistMinM = viewDistMinM;
  const curDistMaxM = viewDistMaxM ?? maxRangeM;
  const curAltMinM = viewAltMinM;
  const curAltMaxM = viewAltMaxM ?? maxAltM;

  // Hàm chuyển đổi toạ độ (Khoảng cách m, Cao độ m) -> (x, y trên SVG)
  const toX = useCallback(
    (distM: number) => {
      const span = curDistMaxM - curDistMinM;
      if (span <= 0) return padLeft;
      return padLeft + ((distM - curDistMinM) / span) * chartW;
    },
    [curDistMinM, curDistMaxM, chartW]
  );

  const toY = useCallback(
    (altM: number) => {
      const span = curAltMaxM - curAltMinM;
      if (span <= 0) return padTop + chartH;
      return padTop + chartH - ((altM - curAltMinM) / span) * chartH;
    },
    [curAltMinM, curAltMaxM, chartH]
  );

  // Hàm chuyển đổi ngược từ toạ độ pixel SVG -> (distM, altM)
  const fromX = useCallback(
    (svgX: number) => {
      const ratio = Math.max(0, Math.min(1, (svgX - padLeft) / chartW));
      return curDistMinM + ratio * (curDistMaxM - curDistMinM);
    },
    [curDistMinM, curDistMaxM, chartW]
  );

  const fromY = useCallback(
    (svgY: number) => {
      const ratio = Math.max(0, Math.min(1, 1 - (svgY - padTop) / chartH));
      return curAltMinM + ratio * (curAltMaxM - curAltMinM);
    },
    [curAltMinM, curAltMaxM, chartH]
  );

  // Đường cắt địa hình núi non (Terrain Profile) - SINGLE SOURCE OF TRUTH VỚI 3D GLOBE
  const terrainPoints = useMemo(() => {
    const groundAlt = selectedInst?.altitude || 0;

    // 1. Đối với Tên Lửa Phòng Không (SAM): Ưu tiên trích xuất từ terrainGrid của samVolume
    if (isSam && samVolume) {
      if (samVolume.terrainGrid) {
        let azIndex = samVolume.terrainGrid.azimuthSamples.indexOf(currentAzimuth);
        if (azIndex === -1 && samVolume.terrainGrid.azimuthSamples.length > 0) {
          let minDiff = Infinity;
          samVolume.terrainGrid.azimuthSamples.forEach((az, i) => {
            let diff = Math.abs(az - currentAzimuth);
            if (diff > 180) diff = 360 - diff;
            if (diff < minDiff) {
              minDiff = diff;
              azIndex = i;
            }
          });
        }
        const distances = samVolume.terrainGrid.sampleDistances;
        if (azIndex !== -1 && distances && distances.length > 0) {
          const points = distances.map((dist, dIdx) => {
            const idx = azIndex * distances.length + dIdx;
            const altM = samVolume.terrainGrid!.terrainHeights[idx] || 0;
            return { distM: dist, altM };
          });
          if (points.length === 0 || points[0].distM > 0) {
            points.unshift({ distM: 0, altM: groundAlt });
          }
          return points;
        }
      }

      // Fallback: terrainMap nếu có
      if (samVolume.terrainMap && samVolume.sampleDistances) {
        const points = samVolume.sampleDistances.map((dist) => {
          const altM = samVolume.terrainMap!.get(`${currentAzimuth}_${dist}`) || 0;
          return { distM: dist, altM };
        });
        if (points.length === 0 || points[0].distM > 0) {
          points.unshift({ distM: 0, altM: groundAlt });
        }
        return points;
      }
    }

    // 2. Đối với Radar Cảnh Giới: Ưu tiên trích xuất trực tiếp từ RadarTerrainGrid của 3D Volume
    const radarVol = selectedInstanceId && !isSam ? coverageVolumes[selectedInstanceId] : null;
    if (radarVol && radarVol.terrainGrid) {
      let azIndex = radarVol.terrainGrid.azimuthSamples.indexOf(currentAzimuth);
      if (azIndex === -1 && radarVol.terrainGrid.azimuthSamples.length > 0) {
        let minDiff = Infinity;
        radarVol.terrainGrid.azimuthSamples.forEach((az, i) => {
          let diff = Math.abs(az - currentAzimuth);
          if (diff > 180) diff = 360 - diff;
          if (diff < minDiff) {
            minDiff = diff;
            azIndex = i;
          }
        });
      }
      const distances = radarVol.terrainGrid.sampleDistances;
      if (azIndex !== -1 && distances && distances.length > 0) {
        const points = distances.map((dist, dIdx) => {
          const idx = azIndex * distances.length + dIdx;
          const altM = radarVol.terrainGrid!.terrainHeights[idx] || 0;
          return { distM: dist, altM };
        });
        if (points.length === 0 || points[0].distM > 0) {
          points.unshift({ distM: 0, altM: groundAlt });
        }
        return points;
      }
    }

    // 3. Fallback: Nếu 3D Volume đang tính hoặc chưa sẵn sàng, dùng raysOnAzimuth từ field
    if (raysOnAzimuth.length === 0) return [];
    const points = (raysOnAzimuth[0]?.samples || []).map((s) => ({
      distM: s.distanceM,
      altM: s.terrainAltM,
    }));
    if (points.length === 0 || points[0].distM > 0) {
      points.unshift({ distM: 0, altM: groundAlt });
    }
    return points;
  }, [raysOnAzimuth, isSam, samVolume, currentAzimuth, selectedInst, selectedInstanceId, coverageVolumes]);

  // Trạng thái nguồn dữ liệu DEM địa hình
  const currentTerrainStatus = useMemo<'loaded' | 'flat_fallback' | 'sampling_error'>(() => {
    if (isSam) return samVolume?.terrainGrid ? 'loaded' : 'flat_fallback';
    const radarVol = selectedInstanceId ? coverageVolumes[selectedInstanceId] : null;
    if (radarVol?.terrainGrid) return 'loaded';
    if (field) return 'loaded';
    return 'flat_fallback';
  }, [isSam, samVolume, selectedInstanceId, coverageVolumes, field]);

  // Cao độ địa hình cao nhất trên hướng quét này
  const maxTerrainAltM = useMemo(() => {
    if (terrainPoints.length === 0) return 500;
    return Math.max(...terrainPoints.map((p) => p.altM));
  }, [terrainPoints]);

  // Độ cao mục tiêu khảo sát H_mt (mặc định lấy từ store hoặc 100m chuẩn sách)
  const hMt = targetHeightMeters || 100;

  // === THUẬT TOÁN TÍNH TOÁN CÁC ĐOẠN KHÔNG NHÌN THẤY (BLIND SEGMENTS / SHADOW) ===
  const blindAnalysis = useMemo(() => {
    if (terrainPoints.length === 0 || !selectedInst) return null;

    const ha = selectedInst.antennaHeightAGL || (isSam ? 8.2 : 15);
    const radarGroundAltM = terrainPoints[0]?.altM || selectedInst.altitude || 0;
    const hRad = radarGroundAltM + ha;
    const k = kFactor || 4 / 3;
    const RePrime = k * 6371000;

    let maxTheta = -Infinity;
    let currentPeak = { distM: 0, altM: hRad };

    const segments: BlindSegment[] = [];
    let currentSegPoints: { distM: number; rayAltM: number; tgtAltM: number }[] = [];
    let segPeakDistM = 0;
    let segPeakAltM = 0;
    let inBlind = false;

    // Duyệt dọc theo dải địa hình
    for (let i = 1; i < terrainPoints.length; i++) {
      const pt = terrainPoints[i];
      const dist = pt.distM;
      const terrAlt = pt.altM;


      const hz = (dist * dist) / (2 * RePrime);
      const thetaTerrain = Math.atan2(terrAlt - hRad - hz, dist);

      // Cập nhật đỉnh núi chắn mới nếu góc chắn lớn hơn
      if (thetaTerrain > maxTheta) {
        maxTheta = thetaTerrain;
        currentPeak = { distM: dist, altM: terrAlt };
      }

      // Cao độ của tia sóng tiếp tuyến phát ra từ đỉnh núi chắn hiện tại
      const rayAltAtDist = hRad + dist * Math.tan(maxTheta) + hz;
      // Vùng bóng tối (shadow) là khi địa hình thấp hơn tia sóng maxTheta
      const isShadowed = thetaTerrain < maxTheta - 0.00005 && dist > currentPeak.distM;

      if (isShadowed) {
        if (!inBlind) {
          inBlind = true;
          segPeakDistM = currentPeak.distM;
          segPeakAltM = currentPeak.altM;
          currentSegPoints = [];
        }
        // Lưu terrAlt để vẽ polygon từ mặt đất lên đến tia sóng (Radar Shadow)
        currentSegPoints.push({ distM: dist, rayAltM: rayAltAtDist, tgtAltM: terrAlt });
      } else {
        if (inBlind && currentSegPoints.length > 1) {
          const rBdM = currentSegPoints[0].distM;
          const rKtM = currentSegPoints[currentSegPoints.length - 1].distM;
          const lengthKm = (rKtM - rBdM) / 1000;

          if (lengthKm >= 0.2) {
            let poly = `M ${toX(currentSegPoints[0].distM)} ${toY(currentSegPoints[0].tgtAltM)}`;
            for (let j = 0; j < currentSegPoints.length; j++) {
              poly += ` L ${toX(currentSegPoints[j].distM)} ${toY(currentSegPoints[j].rayAltM)}`;
            }
            for (let j = currentSegPoints.length - 1; j >= 0; j--) {
              poly += ` L ${toX(currentSegPoints[j].distM)} ${toY(currentSegPoints[j].tgtAltM)}`;
            }
            poly += ' Z';

            const midIdx = Math.floor(currentSegPoints.length / 2);
            const midPt = currentSegPoints[midIdx];

            segments.push({
              id: segments.length + 1,
              rBdKm: Number((rBdM / 1000).toFixed(1)),
              rKtKm: Number((rKtM / 1000).toFixed(1)),
              rBdM,
              rKtM,
              lengthKm: Number(lengthKm.toFixed(1)),
              peakDistKm: Number((segPeakDistM / 1000).toFixed(1)),
              peakAltM: Math.round(segPeakAltM),
              maxShadowDepthM: Math.max(...currentSegPoints.map((p) => p.rayAltM - p.tgtAltM)),
              polygonD: poly,
              midDistM: midPt.distM,
              midRayAltM: midPt.rayAltM,
              midTgtAltM: midPt.tgtAltM,
            });
          }
          currentSegPoints = [];
          inBlind = false;
        }
      }
    }

    if (inBlind && currentSegPoints.length > 1) {
      const rBdM = currentSegPoints[0].distM;
      const rKtM = currentSegPoints[currentSegPoints.length - 1].distM;
      const lengthKm = (rKtM - rBdM) / 1000;
      if (lengthKm >= 0.2) {
        let poly = `M ${toX(currentSegPoints[0].distM)} ${toY(currentSegPoints[0].tgtAltM)}`;
        for (let j = 0; j < currentSegPoints.length; j++) {
          poly += ` L ${toX(currentSegPoints[j].distM)} ${toY(currentSegPoints[j].rayAltM)}`;
        }
        for (let j = currentSegPoints.length - 1; j >= 0; j--) {
          poly += ` L ${toX(currentSegPoints[j].distM)} ${toY(currentSegPoints[j].tgtAltM)}`;
        }
        poly += ' Z';

        const midIdx = Math.floor(currentSegPoints.length / 2);
        const midPt = currentSegPoints[midIdx];

        segments.push({
          id: segments.length + 1,
          rBdKm: Number((rBdM / 1000).toFixed(1)),
          rKtKm: Number((rKtM / 1000).toFixed(1)),
          rBdM,
          rKtM,
          lengthKm: Number(lengthKm.toFixed(1)),
          peakDistKm: Number((segPeakDistM / 1000).toFixed(1)),
          peakAltM: Math.round(segPeakAltM),
          maxShadowDepthM: Math.max(...currentSegPoints.map((p) => p.rayAltM - p.tgtAltM)),
          polygonD: poly,
          midDistM: midPt.distM,
          midRayAltM: midPt.rayAltM,
          midTgtAltM: midPt.tgtAltM,
        });
      }
    }

    // Chân trời trinh sát tự nhiên: D_tn = 4.12 * (sqrt(ha) + sqrt(H_mt))
    const dTnKm = Number((4.12 * (Math.sqrt(ha) + Math.sqrt(hMt))).toFixed(1));
    const d0Km = selectedInst.rangeKm || 150;

    // Tìm đoạn mù dài nhất để gắn Callout nhãn chỉ dẫn nổi bật
    const longestSegment =
      segments.length > 0
        ? segments.reduce((prev, cur) => (cur.lengthKm > prev.lengthKm ? cur : prev), segments[0])
        : null;

    const totalBlindKm = Number(segments.reduce((sum, s) => sum + s.lengthKm, 0).toFixed(1));

    return {
      segments,
      longestSegment,
      ha,
      hRad: Math.round(hRad),
      radarGroundAltM: Math.round(radarGroundAltM),
      dTnKm,
      d0Km,
      totalBlindKm,
      hMt,
    };
  }, [terrainPoints, isSam, selectedInst, hMt, isTargetAgl, kFactor, toX, toY]);

  // Đường địa hình SVG
  let terrainPathD = '';
  let terrainLineD = '';
  if (terrainPoints.length > 0) {
    terrainPathD = `M ${toX(0)} ${toY(0)} L ${toX(0)} ${toY(terrainPoints[0].altM)}`;
    terrainLineD = `M ${toX(0)} ${toY(terrainPoints[0].altM)}`;
    terrainPoints.forEach((p) => {
      terrainPathD += ` L ${toX(p.distM)} ${toY(p.altM)}`;
      terrainLineD += ` L ${toX(p.distM)} ${toY(p.altM)}`;
    });
    const lastP = terrainPoints[terrainPoints.length - 1];
    terrainPathD += ` L ${toX(lastP.distM)} ${toY(0)} Z`;
  }

  // Đường bay mục tiêu H_mt (nét đứt vàng hổ phách)
  let targetLineD = '';
  if (terrainPoints.length > 0) {
    const getTgtAlt = (alt: number) => (isTargetAgl ? alt + hMt : hMt);
    targetLineD = `M ${toX(0)} ${toY(getTgtAlt(terrainPoints[0].altM))}`;
    terrainPoints.forEach((p) => {
      targetLineD += ` L ${toX(p.distM)} ${toY(getTgtAlt(p.altM))}`;
    });
  }

  // === DỰNG CÁC ĐƯỜNG CONG VÒM HỎA LỰC SAM (WEZ 2D) ===
  const numPearSteps = 40;
  const samPearPoints: {
    altM: number;
    dMinM: number;
    dOptM: number;
    dHighM: number;
    dMaxM: number;
    dEffM: number;
  }[] = [];

  const spyderMrPoints: { altM: number; dNomM: number; dEffM: number }[] = [];
  const spyderSrPoints: { altM: number; dNomM: number; dEffM: number }[] = [];

  let samOuterPathD = '';
  let samOuterEffectivePathD = '';
  let samDeadConePathD = '';
  let spyderMrPathD = '';
  let spyderMrEffectivePathD = '';
  let spyderSrPathD = '';
  let spyderSrEffectivePathD = '';
  let samLosVisibleClipD = '';

  // Panel vẫn giữ các hook/trạng thái khi đóng; chỉ dựng đường cong SVG lúc hiển thị.
  if (showCrossSection && isSam && selectedInst) {
    const centerAltM = (selectedInst.altitude || 0) + (selectedInst.antennaHeightAGL || 6);

    if (isSpyder && spyderCfg) {
      const mrDMaxM = (samProfile?.dMaxKm || spyderCfg.mr.dMaxKm) * 1000;
      const mrHMaxM = samProfile?.hMaxM || spyderCfg.mr.hMaxM;
      const ratio = samProfile?.dMaxKm ? samProfile.dMaxKm / (spyderCfg.mr.dMaxKm || 50.0) : 1;
      const srDMaxM = Math.round(spyderCfg.sr.dMaxKm * 1000 * Math.min(1, ratio));
      const srHMaxM = Math.round(spyderCfg.sr.hMaxM * (samProfile?.hMaxM ? Math.min(1, samProfile.hMaxM / 16000) : 1));

      const isVolumeMatchingMode = samVolume && (!samVolume.mode || samVolume.mode === activeSamMode);

      for (let s = 0; s <= numPearSteps; s++) {
        const deltaH = (s / numPearSteps) * mrHMaxM;
        const altM = centerAltM + deltaH;
        const dNom = calculateSpyderDomeMaxRange(deltaH, mrDMaxM, mrHMaxM);
        let dEff = dNom;
        if (isVolumeMatchingMode && samVolume?.effectiveRanges && deltaH > 0) {
          let bestB = 0;
          let minSpan = 999999;
          for (let b = 0; b < samVolume.altitudeBands.length; b++) {
            const span = Math.abs(samVolume.altitudeBands[b] - altM);
            if (span < minSpan) {
              minSpan = span;
              bestB = b;
            }
          }
          let bestAz = 0;
          let minAzSpan = 999;
          for (let j = 0; j < samVolume.azimuthSamples.length; j++) {
            let diff = Math.abs(samVolume.azimuthSamples[j] - currentAzimuth);
            if (diff > 180) diff = 360 - diff;
            if (diff < minAzSpan) {
              minAzSpan = diff;
              bestAz = j;
            }
          }
          dEff = samVolume.effectiveRanges[bestB]?.[bestAz] ?? dNom;
        }
        spyderMrPoints.push({ altM, dNomM: dNom, dEffM: Math.min(dNom, dEff) });
      }

      const srVol = samVolume?.spyderSrVolume;
      for (let s = 0; s <= numPearSteps; s++) {
        const deltaH = (s / numPearSteps) * srHMaxM;
        const altM = centerAltM + deltaH;
        const dNom = calculateSpyderDomeMaxRange(deltaH, srDMaxM, srHMaxM);
        let dEff = dNom;
        if (isVolumeMatchingMode && srVol?.effectiveRanges && deltaH > 0) {
          let bestB = 0;
          let minSpan = 999999;
          for (let b = 0; b < srVol.altitudeBands.length; b++) {
            const span = Math.abs(srVol.altitudeBands[b] - altM);
            if (span < minSpan) {
              minSpan = span;
              bestB = b;
            }
          }
          let bestAz = 0;
          let minAzSpan = 999;
          for (let j = 0; j < srVol.azimuthSamples.length; j++) {
            let diff = Math.abs(srVol.azimuthSamples[j] - currentAzimuth);
            if (diff > 180) diff = 360 - diff;
            if (diff < minAzSpan) {
              minAzSpan = diff;
              bestAz = j;
            }
          }
          dEff = srVol.effectiveRanges[bestB]?.[bestAz] ?? dNom;
        }
        spyderSrPoints.push({ altM, dNomM: dNom, dEffM: Math.min(dNom, dEff) });
      }

      if (spyderMrPoints.length > 0) {
        spyderMrPathD = `M ${toX(0)} ${toY(centerAltM)} L ${toX(spyderMrPoints[0].dNomM)} ${toY(spyderMrPoints[0].altM)}`;
        for (let i = 1; i < spyderMrPoints.length; i++) {
          spyderMrPathD += ` L ${toX(spyderMrPoints[i].dNomM)} ${toY(spyderMrPoints[i].altM)}`;
        }
        spyderMrPathD += ` L ${toX(0)} ${toY(centerAltM + mrHMaxM)} Z`;

        spyderMrEffectivePathD = `M ${toX(0)} ${toY(centerAltM)} L ${toX(spyderMrPoints[0].dEffM)} ${toY(spyderMrPoints[0].altM)}`;
        for (let i = 1; i < spyderMrPoints.length; i++) {
          spyderMrEffectivePathD += ` L ${toX(spyderMrPoints[i].dEffM)} ${toY(spyderMrPoints[i].altM)}`;
        }
        spyderMrEffectivePathD += ` L ${toX(0)} ${toY(centerAltM + mrHMaxM)} Z`;
      }

      if (spyderSrPoints.length > 0) {
        spyderSrPathD = `M ${toX(0)} ${toY(centerAltM)} L ${toX(spyderSrPoints[0].dNomM)} ${toY(spyderSrPoints[0].altM)}`;
        for (let i = 1; i < spyderSrPoints.length; i++) {
          spyderSrPathD += ` L ${toX(spyderSrPoints[i].dNomM)} ${toY(spyderSrPoints[i].altM)}`;
        }
        spyderSrPathD += ` L ${toX(0)} ${toY(centerAltM + srHMaxM)} Z`;

        spyderSrEffectivePathD = `M ${toX(0)} ${toY(centerAltM)} L ${toX(spyderSrPoints[0].dEffM)} ${toY(spyderSrPoints[0].altM)}`;
        for (let i = 1; i < spyderSrPoints.length; i++) {
          spyderSrEffectivePathD += ` L ${toX(spyderSrPoints[i].dEffM)} ${toY(spyderSrPoints[i].altM)}`;
        }
        spyderSrEffectivePathD += ` L ${toX(0)} ${toY(centerAltM + srHMaxM)} Z`;
      }
    } else {
      const dMaxM = samDMaxKm * 1000;
      const minElevDeg = selectedInst.minElevationDeg !== undefined ? selectedInst.minElevationDeg : 6.0;
      const maxElevDeg = selectedInst.maxElevationDeg !== undefined ? selectedInst.maxElevationDeg : 65.0;
      const cotMinElev = 1 / Math.tan((minElevDeg * Math.PI) / 180);

      for (let s = 0; s <= numPearSteps; s++) {
        const deltaH = (s / numPearSteps) * samHMaxM;
        const altM = centerAltM + deltaH;
        const dInner = calculateSamDeadConeRadius(altM, centerAltM, maxElevDeg);

        let dNom = 0;
        if (deltaH > 0) {
          const launchLimitM = Math.round(deltaH * cotMinElev);
          const aeroMaxM = calculateSamPearMaxRange(deltaH, dMaxM, 0, samHMaxM, samHOptM);
          dNom = Math.min(aeroMaxM, launchLimitM);
          dNom = Math.max(dInner, dNom);
        }

        let dEff = dNom;
        const isVolumeMatchingMode = samVolume && (!samVolume.mode || samVolume.mode === activeSamMode);
        if (isVolumeMatchingMode && samVolume && samVolume.effectiveRanges && deltaH > 0) {
          let bestB = 0;
          let minSpan = 999999;
          for (let b = 0; b < samVolume.altitudeBands.length; b++) {
            const span = Math.abs(samVolume.altitudeBands[b] - altM);
            if (span < minSpan) {
              minSpan = span;
              bestB = b;
            }
          }
          let bestAz = 0;
          let minAzSpan = 999;
          for (let j = 0; j < samVolume.azimuthSamples.length; j++) {
            let diff = Math.abs(samVolume.azimuthSamples[j] - currentAzimuth);
            if (diff > 180) diff = 360 - diff;
            if (diff < minAzSpan) {
              minAzSpan = diff;
              bestAz = j;
            }
          }
          dEff = samVolume.effectiveRanges[bestB]?.[bestAz] ?? dNom;
        }

        samPearPoints.push({
          altM,
          dMinM: dInner,
          dOptM: Math.max(dInner, Math.round(dNom * 0.7)),
          dHighM: Math.max(dInner, Math.round(dNom * 0.85)),
          dMaxM: dNom,
          dEffM: Math.min(dNom, dEff),
        });
      }

      if (samPearPoints.length > 0) {
        samOuterPathD = `M ${toX(samPearPoints[0].dMinM)} ${toY(samPearPoints[0].altM)}`;
        for (let i = 1; i < samPearPoints.length; i++) {
          samOuterPathD += ` L ${toX(samPearPoints[i].dMinM)} ${toY(samPearPoints[i].altM)}`;
        }
        const lastP = samPearPoints[samPearPoints.length - 1];
        samOuterPathD += ` L ${toX(lastP.dMaxM)} ${toY(lastP.altM)}`;
        for (let i = samPearPoints.length - 2; i >= 0; i--) {
          samOuterPathD += ` L ${toX(samPearPoints[i].dMaxM)} ${toY(samPearPoints[i].altM)}`;
        }
        samOuterPathD += ' Z';

        samOuterEffectivePathD = `M ${toX(samPearPoints[0].dMinM)} ${toY(samPearPoints[0].altM)}`;
        for (let i = 1; i < samPearPoints.length; i++) {
          samOuterEffectivePathD += ` L ${toX(samPearPoints[i].dMinM)} ${toY(samPearPoints[i].altM)}`;
        }
        samOuterEffectivePathD += ` L ${toX(lastP.dEffM)} ${toY(lastP.altM)}`;
        for (let i = samPearPoints.length - 2; i >= 0; i--) {
          samOuterEffectivePathD += ` L ${toX(samPearPoints[i].dEffM)} ${toY(samPearPoints[i].altM)}`;
        }
        samOuterEffectivePathD += ' Z';

        samDeadConePathD = `M ${toX(0)} ${toY(samPearPoints[0].altM)} L ${toX(0)} ${toY(lastP.altM)} L ${toX(lastP.dMinM)} ${toY(lastP.altM)}`;
        for (let i = samPearPoints.length - 2; i >= 0; i--) {
          samDeadConePathD += ` L ${toX(samPearPoints[i].dMinM)} ${toY(samPearPoints[i].altM)}`;
        }
        samDeadConePathD += ` L ${toX(0)} ${toY(samPearPoints[0].altM)} Z`;
      }
    }

    // Dựng đa giác vùng nhìn thấy được (phía trên bóng núi) để clip quả lê WEZ
    if (terrainPoints.length > 0) {
      const ha = selectedInst.antennaHeightAGL || 8.2;
      const radarGround = terrainPoints[0]?.altM || selectedInst.altitude || 0;
      const hRad = radarGround + ha;
      const k = kFactor || 4 / 3;
      const RePrime = k * 6371000;
      const minEl = selectedInst.minElevationDeg !== undefined ? selectedInst.minElevationDeg : 0.5;
      const tanMinEl = Math.tan((minEl * Math.PI) / 180);

      let maxTheta = tanMinEl;
      const clipPoints: { distM: number; minVisAltM: number }[] = [];

      // Điểm gốc tại anten
      clipPoints.push({ distM: 0, minVisAltM: Math.max(hRad, radarGround + samHMinM) });

      for (let i = 1; i < terrainPoints.length; i++) {
        const pt = terrainPoints[i];
        const dist = pt.distM;
        const terrAlt = pt.altM;
        const hz = (dist * dist) / (2 * RePrime);
        const thetaTerrain = Math.atan2(terrAlt - hRad - hz, dist);

        if (thetaTerrain > maxTheta) {
          maxTheta = thetaTerrain;
        }

        const shadowAlt = hRad + dist * Math.tan(maxTheta) + hz;
        const minVisAlt = Math.max(terrAlt, shadowAlt, radarGround + samHMinM);
        clipPoints.push({ distM: dist, minVisAltM: minVisAlt });
      }

      const lastDist = clipPoints[clipPoints.length - 1].distM;
      if (lastDist < curDistMaxM) {
        const dist = curDistMaxM;
        const hz = (dist * dist) / (2 * RePrime);
        const shadowAlt = hRad + dist * Math.tan(maxTheta) + hz;
        clipPoints.push({ distM: dist, minVisAltM: shadowAlt });
      }

      const topAlt = curAltMaxM + 10000;
      let dStr = `M ${toX(clipPoints[0].distM)} ${toY(clipPoints[0].minVisAltM)}`;
      for (let i = 1; i < clipPoints.length; i++) {
        dStr += ` L ${toX(clipPoints[i].distM)} ${toY(clipPoints[i].minVisAltM)}`;
      }
      dStr += ` L ${toX(clipPoints[clipPoints.length - 1].distM)} ${toY(topAlt)}`;
      dStr += ` L ${toX(0)} ${toY(topAlt)} Z`;
      samLosVisibleClipD = dStr;
    }
  }

  // Thống kê tia / vật cản
  const totalRaysOnAz = raysOnAzimuth.length;
  const occludedRaysOnAz = raysOnAzimuth.filter((r) => r.hasOcclusion).length;
  const firstOcclusion = raysOnAzimuth.find((r) => r.hasOcclusion)?.occlusionPoint;

  // Chùm tia quang tuyến radar của tổ hợp tên lửa (TAR / FCR)
  const samRays = useMemo(() => {
    if (!isSam || !selectedInst || terrainPoints.length === 0) return [];
    const radarGround = terrainPoints[0]?.altM || selectedInst.altitude || 0;
    const ha = selectedInst.antennaHeightAGL || 8.2;
    const hRad = radarGround + ha;
    const k = kFactor || 4 / 3;
    const RePrime = k * 6371000;
    const minEl = selectedInst.minElevationDeg !== undefined ? Math.max(0.5, selectedInst.minElevationDeg) : 0.5;
    const maxEl = Math.min(35, selectedInst.maxElevationDeg !== undefined ? selectedInst.maxElevationDeg : 45);
    const maxRange = Math.min(curDistMaxM, (selectedInst.batteryConfig?.tarRangeKm || selectedInst.rangeKm || 100) * 1000);

    const rays: { el: number; endDistM: number; endAltM: number }[] = [];
    for (let el = minEl; el <= maxEl; el += 2.5) {
      const elRad = (el * Math.PI) / 180;
      let endDistM = maxRange;
      let endAltM = hRad + maxRange * Math.tan(elRad) + (maxRange * maxRange) / (2 * RePrime);

      for (let i = 1; i < terrainPoints.length; i++) {
        const pt = terrainPoints[i];
        if (pt.distM > maxRange) break;
        const hz = (pt.distM * pt.distM) / (2 * RePrime);
        const rayAltAtP = hRad + pt.distM * Math.tan(elRad) + hz;
        if (pt.altM >= rayAltAtP) {
          endDistM = pt.distM;
          endAltM = pt.altM;
          break;
        }
      }
      rays.push({ el, endDistM, endAltM });
    }
    return rays;
  }, [isSam, selectedInst, terrainPoints, curDistMaxM, kFactor]);

  // Thang chia toạ độ động thích ứng theo tỷ lệ Zoom
  const yTicks = useMemo(() => {
    const span = curAltMaxM - curAltMinM;
    let step = 5000;
    if (span <= 1200) step = 100;
    else if (span <= 2500) step = 250;
    else if (span <= 5000) step = 500;
    else if (span <= 12000) step = 1000;
    else if (span <= 20000) step = 2000;
    else step = 5000;

    const ticks: number[] = [];
    const start = Math.ceil(curAltMinM / step) * step;
    for (let a = start; a <= curAltMaxM; a += step) {
      ticks.push(a);
    }
    return ticks;
  }, [curAltMinM, curAltMaxM]);

  const xTicks = useMemo(() => {
    const spanKm = (curDistMaxM - curDistMinM) / 1000;
    let stepKm = 25;
    if (spanKm <= 20) stepKm = 2;
    else if (spanKm <= 45) stepKm = 5;
    else if (spanKm <= 90) stepKm = 10;
    else if (spanKm <= 160) stepKm = 20;
    else stepKm = 50;

    const ticks: number[] = [];
    const startKm = Math.ceil(curDistMinM / 1000 / stepKm) * stepKm;
    const endKm = curDistMaxM / 1000;
    for (let d = startKm; d <= endKm; d += stepKm) {
      ticks.push(d);
    }
    return ticks;
  }, [curDistMinM, curDistMaxM]);

  // Nút Thao Tác Zoom Nhanh
  const handleFocusTerrain = () => {
    setViewDistMinM(0);
    setViewDistMaxM(Math.min(maxRangeM, 80000)); // 0 - 80 km như trong sách
    setViewAltMinM(0);
    setViewAltMaxM(Math.min(maxAltM, Math.max(1200, Math.round(maxTerrainAltM * 1.45))));
  };

  const handleResetZoom = () => {
    setViewDistMinM(0);
    setViewDistMaxM(maxRangeM);
    setViewAltMinM(0);
    setViewAltMaxM(maxAltM);
  };

  const handleZoomIn = () => {
    const dSpan = curDistMaxM - curDistMinM;
    const aSpan = curAltMaxM - curAltMinM;
    const newDSpan = Math.max(5000, dSpan * 0.7);
    const newASpan = Math.max(400, aSpan * 0.7);
    const midD = (curDistMinM + curDistMaxM) / 2;
    const midA = (curAltMinM + curAltMaxM) / 2;

    setViewDistMinM(Math.max(0, Math.round(midD - newDSpan / 2)));
    setViewDistMaxM(Math.min(maxRangeM, Math.round(midD + newDSpan / 2)));
    setViewAltMinM(Math.max(0, Math.round(midA - newASpan / 2)));
    setViewAltMaxM(Math.min(maxAltM, Math.round(midA + newASpan / 2)));
  };

  const handleZoomOut = () => {
    const dSpan = curDistMaxM - curDistMinM;
    const aSpan = curAltMaxM - curAltMinM;
    const newDSpan = Math.min(maxRangeM, dSpan * 1.4);
    const newASpan = Math.min(maxAltM, aSpan * 1.4);
    const midD = (curDistMinM + curDistMaxM) / 2;
    const midA = (curAltMinM + curAltMaxM) / 2;

    let minD = Math.round(midD - newDSpan / 2);
    let maxD = minD + newDSpan;
    if (minD < 0) {
      maxD += -minD;
      minD = 0;
    }
    if (maxD > maxRangeM) {
      minD = Math.max(0, maxRangeM - newDSpan);
      maxD = maxRangeM;
    }

    let minA = Math.round(midA - newASpan / 2);
    let maxA = minA + newASpan;
    if (minA < 0) {
      maxA += -minA;
      minA = 0;
    }
    if (maxA > maxAltM) {
      minA = Math.max(0, maxAltM - newASpan);
      maxA = maxAltM;
    }

    setViewDistMinM(minD);
    setViewDistMaxM(maxD);
    setViewAltMinM(minA);
    setViewAltMaxM(maxA);
  };

  // Cuộn chuột (Mouse Wheel) để phóng to/thu nhỏ
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (mouseX < padLeft || mouseX > padLeft + chartW || mouseY < padTop || mouseY > padTop + chartH) {
      return;
    }

    const mouseDistM = fromX(mouseX);
    const mouseAltM = fromY(mouseY);
    const factor = e.deltaY < 0 ? 0.78 : 1.28;

    const currentDistSpan = curDistMaxM - curDistMinM;
    const currentAltSpan = curAltMaxM - curAltMinM;

    let newDistSpan = Math.max(4000, Math.min(maxRangeM * 1.1, currentDistSpan * factor));
    let newAltSpan = Math.max(300, Math.min(maxAltM * 1.1, currentAltSpan * factor));

    const ratioX = (mouseX - padLeft) / chartW;
    const ratioY = 1 - (mouseY - padTop) / chartH;

    let newDistMin = mouseDistM - ratioX * newDistSpan;
    let newDistMax = newDistMin + newDistSpan;

    let newAltMin = mouseAltM - ratioY * newAltSpan;
    let newAltMax = newAltMin + newAltSpan;

    if (newDistMin < 0) {
      newDistMax += -newDistMin;
      newDistMin = 0;
    }
    if (newDistMax > maxRangeM) {
      newDistMin = Math.max(0, maxRangeM - newDistSpan);
      newDistMax = maxRangeM;
    }

    if (newAltMin < 0) {
      newAltMax += -newAltMin;
      newAltMin = 0;
    }
    if (newAltMax > maxAltM) {
      newAltMin = Math.max(0, maxAltM - newAltSpan);
      newAltMax = maxAltM;
    }

    setViewDistMinM(Math.round(newDistMin));
    setViewDistMaxM(Math.round(newDistMax));
    setViewAltMinM(Math.round(newAltMin));
    setViewAltMaxM(Math.round(newAltMax));
  };

  // Kéo chuột (Pan/Drag)
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (mouseX >= padLeft && mouseX <= padLeft + chartW && mouseY >= padTop && mouseY <= padTop + chartH) {
      setIsPanning(false);
      setPanStart({
        x: e.clientX,
        y: e.clientY,
        distMin: curDistMinM,
        distMax: curDistMaxM,
        altMin: curAltMinM,
        altMax: curAltMaxM,
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (panStart) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;

      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        setIsPanning(true);
      }

      const distSpan = panStart.distMax - panStart.distMin;
      const altSpan = panStart.altMax - panStart.altMin;

      const dDist = -(dx / chartW) * distSpan;
      const dAlt = (dy / chartH) * altSpan;

      let newMinDist = panStart.distMin + dDist;
      let newMaxDist = panStart.distMax + dDist;
      let newMinAlt = panStart.altMin + dAlt;
      let newMaxAlt = panStart.altMax + dAlt;

      if (newMinDist < 0) {
        newMaxDist = distSpan;
        newMinDist = 0;
      }
      if (newMaxDist > maxRangeM) {
        newMinDist = Math.max(0, maxRangeM - distSpan);
        newMaxDist = maxRangeM;
      }

      if (newMinAlt < 0) {
        newMaxAlt = altSpan;
        newMinAlt = 0;
      }
      if (newMaxAlt > maxAltM) {
        newMinAlt = Math.max(0, maxAltM - altSpan);
        newMaxAlt = maxAltM;
      }

      setViewDistMinM(Math.round(newMinDist));
      setViewDistMaxM(Math.round(newMaxDist));
      setViewAltMinM(Math.round(newMinAlt));
      setViewAltMaxM(Math.round(newMaxAlt));
      return;
    }

    if (mouseX >= padLeft && mouseX <= padLeft + chartW && mouseY >= padTop && mouseY <= padTop + chartH) {
      const distM = fromX(mouseX);
      const distKm = Number((distM / 1000).toFixed(1));
      const altM = Math.round(fromY(mouseY));

      const nearestTerrain = terrainPoints.find((p) => Math.abs(p.distM - distM) < 2500);
      const status = evaluatePointStatus(distKm, altM, nearestTerrain?.altM);

      setHoverData({
        distKm,
        altM,
        terrainM: nearestTerrain?.altM,
        status,
      });
    } else {
      setHoverData(null);
    }
  };

  const handleMouseUp = () => {
    setPanStart(null);
    setTimeout(() => setIsPanning(false), 50);
  };

  // Đánh giá trạng thái quân sự của điểm khảo sát
  const evaluatePointStatus = (distKm: number, altM: number, terrainM?: number): string => {
    const distM = distKm * 1000;
    if (terrainM !== undefined && altM <= terrainM) {
      return 'Dưới mặt đất / Địa hình';
    }

    if (isSam && selectedInst) {
      // 1. Kiểm tra che khuất địa hình (LOS) từ ăng-ten đài điều khiển/radar qua địa hình phía trước
      const radarGround = terrainPoints[0]?.altM || selectedInst.altitude || 0;
      const ha = selectedInst.antennaHeightAGL || 8.2;
      const hRad = radarGround + ha;
      const k = kFactor || 4 / 3;
      const RePrime = k * 6371000;
      const hzTarget = (distM * distM) / (2 * RePrime);
      const thetaTarget = Math.atan2(altM - hRad - hzTarget, distM);

      let isBlockedByTerrain = false;
      if (terrainPoints.length > 0) {
        for (const tp of terrainPoints) {
          if (tp.distM > 0 && tp.distM < distM) {
            const hzP = (tp.distM * tp.distM) / (2 * RePrime);
            const rayHAtP = hRad + tp.distM * Math.tan(thetaTarget) + hzP;
            if (tp.altM > rayHAtP) {
              isBlockedByTerrain = true;
              break;
            }
          }
        }
      }

      if (isBlockedByTerrain) {
        return 'Bị che khuất bởi địa hình (Nằm trong Vùng mù Radar/Tên lửa)';
      }

      // 2. Nếu không bị che khuất, kiểm tra giới hạn hình học WEZ
      if (isSpyder && spyderCfg) {
        const centerAltM = (selectedInst.altitude || 0) + (selectedInst.antennaHeightAGL || 6);
        const deltaH = Math.max(0, altM - centerAltM);
        if (deltaH < spyderCfg.sr.hMinM) {
          return `Dưới sàn hỏa lực Spyder (${spyderCfg.sr.hMinM}m)`;
        }
        const srMaxAtAlt = calculateSpyderDomeMaxRange(deltaH, spyderCfg.sr.dMaxKm * 1000, spyderCfg.sr.hMaxM);
        if (distM <= srMaxAtAlt && deltaH <= spyderCfg.sr.hMaxM) {
          if (distKm < spyderCfg.sr.dMinKm) {
            return `Trong nón chết SPYDER-SR (< ${spyderCfg.sr.dMinKm}km)`;
          }
          return 'Trong Vùng Hỏa Lực Tiêu Diệt Thực Tế (LOS Thông Suốt)';
        }
        const mrMaxAtAlt = calculateSpyderDomeMaxRange(deltaH, spyderCfg.mr.dMaxKm * 1000, spyderCfg.mr.hMaxM);
        if (distM <= mrMaxAtAlt && deltaH <= spyderCfg.mr.hMaxM) {
          if (distKm < spyderCfg.mr.dMinKm) {
            return `Trong nón chết SPYDER-MR (< ${spyderCfg.mr.dMinKm}km)`;
          }
          return 'Trong Vùng Hỏa Lực Tiêu Diệt Thực Tế (LOS Thông Suốt)';
        }
        if (deltaH > spyderCfg.mr.hMaxM) {
          return `Vượt trần hỏa lực SPYDER-MR (> ${(spyderCfg.mr.hMaxM / 1000).toFixed(0)}km)`;
        }
        const tarRangeKm = selectedInst.batteryConfig?.tarRangeKm || 100;
        if (distKm <= tarRangeKm) {
          return 'Ngoài tầm bắn WEZ - Trong vùng Radar Chỉ thị (TAR) phát hiện';
        }
        return `Vượt cự ly hỏa lực Spyder (> ${distKm.toFixed(1)}km)`;
      }

      const centerAltM = (selectedInst.altitude || 0) + (selectedInst.antennaHeightAGL || 6);
      const deltaH = Math.max(0, altM - centerAltM);
      const dMaxAtH = calculateSamPearMaxRange(deltaH, samDMaxKm * 1000, 0, samHMaxM, samHOptM);
      const maxEl = selectedInst.maxElevationDeg !== undefined ? selectedInst.maxElevationDeg : 65.0;
      const minEl = selectedInst.minElevationDeg !== undefined ? selectedInst.minElevationDeg : 6.0;
      const dMinAtH = calculateSamDeadConeRadius(altM, centerAltM, maxEl);
      const cotMinElev = 1 / Math.tan((minEl * Math.PI) / 180);
      const dLaunchLimitM = Math.round(deltaH * cotMinElev);

      if (altM < samHMinM) return `Dưới sàn hỏa lực H_min (${samHMinM}m)`;
      if (altM > samHMaxM) return `Vượt trần hỏa lực H_max (${(samHMaxM / 1000).toFixed(0)}km)`;
      if (distM < dMinAtH) return `Nằm trong nón mù đỉnh đầu (${maxEl}°)`;
      if (deltaH > 0 && distM > dLaunchLimitM) return `Dưới góc ngẩng bệ phóng (${minEl}°)`;
      if (distM <= dMaxAtH) return 'Trong Vùng Hỏa Lực Tiêu Diệt Thực Tế (LOS Thông Suốt)';

      const tarRangeKm = selectedInst.batteryConfig?.tarRangeKm || (selectedInst.rangeKm ? selectedInst.rangeKm * 1.5 : 150);
      if (distKm <= tarRangeKm) {
        return 'Ngoài tầm bắn WEZ - Trong vùng Radar Chỉ thị (TAR) phát hiện';
      }
      return 'Ngoài vùng hỏa lực';
    } else if (selectedInst) {
      const radarAltM = (selectedInst.altitude || 0) + (selectedInst.antennaHeightAGL || 15);
      const angleRad = Math.atan2(altM - radarAltM, distM);
      const angleDeg = (angleRad * 180) / Math.PI;
      const minEl = selectedInst.minElevationDeg !== undefined ? selectedInst.minElevationDeg : 0.5;
      const maxEl = selectedInst.maxElevationDeg !== undefined ? selectedInst.maxElevationDeg : 65.0;
      const maxRange = (selectedInst.rangeKm || 150) * 1000;

      if (angleDeg < minEl) return `Dưới góc tà tối thiểu (${minEl}°)`;
      if (angleDeg > maxEl) return `Trên góc tà tối đa (Nón mù ${maxEl}°)`;
      if (distM > maxRange) return `Vượt cự ly trinh sát (${(maxRange / 1000).toFixed(0)}km)`;

      let isBlocked = false;
      if (terrainPoints.length > 0) {
        for (const tp of terrainPoints) {
          if (tp.distM > 0 && tp.distM < distM) {
            const rayH = radarAltM + (altM - radarAltM) * (tp.distM / distM);
            if (rayH < tp.altM) {
              isBlocked = true;
              break;
            }
          }
        }
      }
      return isBlocked ? 'Bị che khuất bởi địa hình (Vùng mù)' : 'Trong Vùng Trinh Sát (LOS Rõ)';
    }
    return 'Khảo sát ngoài tầm';
  };

  if (!showCrossSection || !selectedInst) return null;

  // Thu nhỏ thành dock mini
  if (isMinimized) {
    return (
      <aside className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-950/95 backdrop-blur-xl border border-cyan-500/60 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.85)] flex items-center gap-3 px-3.5 py-2 select-none animate-in fade-in slide-in-from-bottom-3 duration-200">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center border shadow-sm shrink-0"
          style={{
            backgroundColor: `${selectedInst.color}22`,
            borderColor: `${selectedInst.color}66`,
            color: selectedInst.color,
          }}
        >
          {isSam ? <Crosshair className="w-3.5 h-3.5" /> : <Compass className="w-3.5 h-3.5" />}
        </div>

        <div className="flex items-center gap-2 pr-2 border-r border-slate-800">
          <span className="text-xs font-bold text-slate-200">{selectedInst.name}</span>
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold border ${
              isSam
                ? 'bg-rose-950/80 text-rose-300 border-rose-500/50'
                : 'bg-cyan-950 text-cyan-300 border-cyan-500/40'
            }`}
          >
            {isSam ? 'SAM WEZ 2D' : `LOS 2D (${currentAzimuth}°)`}
          </span>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800 text-xs">
          <Compass className="w-3 h-3 text-cyan-400" />
          <span className="text-[11px] text-slate-400 font-mono">Phương vị:</span>
          <button
            onClick={() => setSelectedAzimuthDeg((currentAzimuth - 5 + 360) % 360)}
            className="p-0.5 rounded hover:bg-slate-800 text-slate-300 hover:text-cyan-300 transition-colors"
            title="Quay trái (-5°)"
          >
            <ChevronLeft className="w-3 h-3" />
          </button>
          <span className="font-bold font-mono text-cyan-300 min-w-[36px] text-center">
            {currentAzimuth}°
          </span>
          <button
            onClick={() => setSelectedAzimuthDeg((currentAzimuth + 5) % 360)}
            className="p-0.5 rounded hover:bg-slate-800 text-slate-300 hover:text-cyan-300 transition-colors"
            title="Quay phải (+5°)"
          >
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>

        {crossSectionProbePoint && crossSectionProbePoint.instanceId === selectedInst.instanceId && (
          <div className="flex items-center gap-1.5 bg-amber-950/80 border border-amber-500/70 px-2.5 py-1 rounded-lg text-[11px] font-mono text-amber-300 shadow-sm">
            <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              Điểm 3D: <strong className="text-white">{crossSectionProbePoint.distKm}km</strong> •{' '}
              <strong className="text-white">{crossSectionProbePoint.altM.toLocaleString('vi-VN')}m</strong> (
              {crossSectionProbePoint.azimuthDeg}°)
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearCrossSectionProbePoint();
              }}
              className="p-0.5 hover:bg-amber-400/20 rounded text-amber-400 hover:text-white transition-colors ml-1"
              title="Bỏ ghim điểm 3D này"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-1 pl-1">
          <button
            onClick={() => setIsMinimized(false)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-bold bg-cyan-950 hover:bg-cyan-900/90 text-cyan-300 border border-cyan-500/50 rounded-lg transition-all shadow-sm"
            title="Mở lại biểu đồ mặt cắt đứng đầy đủ"
          >
            <ChevronUp className="w-3.5 h-3.5" />
            <span>Mở lại biểu đồ</span>
          </button>
          <button
            onClick={() => setShowCrossSection(false)}
            className="p-1.5 text-slate-400 hover:text-rose-300 rounded hover:bg-rose-950/60 transition-colors"
            title="Đóng bảng mặt cắt"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-950/95 backdrop-blur-xl border border-cyan-500/50 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.85)] flex flex-col select-none overflow-hidden animate-in fade-in slide-in-from-bottom-6 duration-200">
      {/* 1. Header Bảng Mặt Cắt */}
      <div className="p-3 border-b border-slate-800 bg-slate-900/75 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center border shadow-sm shrink-0"
            style={{
              backgroundColor: `${selectedInst.color}22`,
              borderColor: `${selectedInst.color}66`,
              color: selectedInst.color,
            }}
          >
            {isSam ? <Crosshair className="w-4 h-4" /> : <Compass className="w-4 h-4" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs md:text-sm font-bold text-slate-100 flex items-center gap-1.5">
                <span>{isSam ? 'Mặt Cắt Hỏa Lực SAM (WEZ 2D):' : 'Mặt Cắt Địa Hình & Quang Tuyến:'}</span>
                <span style={{ color: selectedInst.color }}>{selectedInst.name}</span>
              </h3>
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold border ${
                  isSam
                    ? isSpyder
                      ? 'bg-sky-950/90 text-sky-300 border-sky-500/50'
                      : 'bg-rose-950/80 text-rose-300 border-rose-500/50'
                    : 'bg-cyan-950 text-cyan-300 border-cyan-500/40'
                }`}
              >
                {isSam
                  ? samProfile?.modeVi
                    ? samProfile.modeVi.toUpperCase()
                    : isSpyder
                    ? 'SAM SPYDER (VÒM KÉP)'
                    : 'SAM HỎA LỰC WEZ'
                  : `MẶT CẮT β = ${currentAzimuth}°`}
              </span>
            </div>
            <p className="text-[10.5px] text-slate-400 font-sans">
              {isSam
                ? `Chế độ: ${samProfile?.modeVi || activeSamMode} • Xạ giới: ${samDMinKm}-${samDMaxKm}km • Trần: ${samHMaxM}m • V_max: ${samVMps}m/s`
                : `Khảo sát che khuất địa hình & búp sóng phát xạ theo hướng phương vị ${currentAzimuth}°.`}
            </p>
          </div>
        </div>

        {/* Thanh chọn chế độ bắn chuyên biệt cho SAM (Động theo từng loại khí tài) */}
        {isSam && availableModes.length > 0 && (
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800/80 flex-wrap">
            {availableModes.map((m) => {
              const isActive = activeSamMode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setSamEngagementMode(selectedInst.instanceId, m.id)}
                  title={`${m.label} • Tầm: ${m.dMaxKm}km • Trần: ${m.hMaxM / 1000}km`}
                  className={`px-2 py-0.5 text-[10.5px] font-mono rounded-lg transition-all ${
                    isActive
                      ? 'bg-rose-600 text-white font-bold shadow-md shadow-rose-950/60'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  {m.shortLabel}
                </button>
              );
            })}
          </div>
        )}

        {/* Cụm điều khiển phương vị Azimuth */}
        <div className="flex items-center gap-2 bg-slate-950 px-2.5 py-1 rounded-xl border border-slate-800 text-xs">
          <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
            <Compass className="w-3.5 h-3.5 text-cyan-400" />
            <span>Phương vị:</span>
          </span>

          <button
            onClick={() => setSelectedAzimuthDeg((currentAzimuth - 5 + 360) % 360)}
            className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-800 transition-colors"
            title="Quay sang trái (-5°)"
          >
            <ChevronLeft className="w-3 h-3" />
          </button>

          <span className="text-sm font-bold font-mono text-cyan-300 min-w-[42px] text-center">
            {currentAzimuth}°
          </span>

          <button
            onClick={() => setSelectedAzimuthDeg((currentAzimuth + 5) % 360)}
            className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-800 transition-colors"
            title="Quay sang phải (+5°)"
          >
            <ChevronRight className="w-3 h-3" />
          </button>

          <input
            type="range"
            min="0"
            max="355"
            step="5"
            value={currentAzimuth}
            onChange={(e) => setSelectedAzimuthDeg(parseInt(e.target.value))}
            className="w-20 accent-cyan-400 h-1 bg-slate-800 rounded-lg cursor-pointer"
            title="Kéo trượt góc phương vị quét"
          />
        </div>

        {/* Thanh công cụ Zoom & Phóng To Địa Hình */}
        <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-xl border border-slate-800">
          <button
            onClick={handleFocusTerrain}
            className="flex items-center gap-1 px-2 py-1 text-[10.5px] font-mono font-bold bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-500/50 rounded-lg transition-all shadow-sm"
            title="Tự động zoom cận cảnh địa hình (0-80km, độ cao thấp sát mặt đất) để thấy rõ nhấp nhô núi non và các đoạn mù như trong sách giáo trình"
          >
            <Mountain className="w-3 h-3 text-emerald-400" />
            <span>Cận Cảnh Địa Hình</span>
          </button>

          <button
            onClick={handleResetZoom}
            className="flex items-center gap-1 px-2 py-1 text-[10.5px] font-mono text-slate-300 hover:text-cyan-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg transition-all"
            title="Khôi phục toàn cảnh (100% tầm tối đa)"
          >
            <RotateCcw className="w-3 h-3 text-cyan-400" />
            <span>Toàn Cảnh</span>
          </button>

          <div className="h-4 w-px bg-slate-800 mx-0.5" />

          <button
            onClick={handleZoomIn}
            className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-800 transition-colors"
            title="Phóng to (+)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={handleZoomOut}
            className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-800 transition-colors"
            title="Thu nhỏ (-)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          {/* Badge tỉ lệ viewport hiện tại */}
          <span className="text-[9.5px] font-mono text-slate-400 pl-1 border-l border-slate-800">
            H: {(curAltMinM).toFixed(0)}-
            {curAltMaxM >= 1000 ? `${(curAltMaxM / 1000).toFixed(1)}k` : `${curAltMaxM}m`} | D:{' '}
            {(curDistMinM / 1000).toFixed(0)}-{(curDistMaxM / 1000).toFixed(0)}km
          </span>
        </div>

        {/* Nút Cực tiểu hóa & Đóng */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized(true)}
            className="flex items-center gap-1 px-2 py-1 text-xs font-mono font-medium text-slate-300 hover:text-cyan-300 bg-slate-900/90 hover:bg-slate-800 border border-slate-750 rounded-lg transition-all cursor-pointer"
            title="Cực tiểu hóa bảng mặt cắt"
          >
            <Minus className="w-3.5 h-3.5 text-cyan-400" />
            <span>Thu gọn</span>
          </button>
          <button
            onClick={() => setShowCrossSection(false)}
            className="p-1.5 text-slate-400 hover:text-rose-300 rounded-lg hover:bg-rose-950/60 transition-colors cursor-pointer"
            title="Đóng bảng mặt cắt"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 1b. Banner trạng thái DEM & Đồng bộ tính toán */}
      {currentTerrainStatus !== 'loaded' && (
        <div className="bg-amber-950/80 border-b border-amber-600/60 px-3.5 py-1.5 flex items-center justify-between text-[11px] text-amber-300">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Chế độ địa hình phẳng mô phỏng (Chưa nạp được dữ liệu DEM hoặc máy chủ địa hình không khả dụng)</span>
          </span>
          <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-amber-900/60 border border-amber-500/50">DEM FALLBACK</span>
        </div>
      )}
      {(isCalculatingVolume || isCalculatingLOS) && (
        <div className="bg-cyan-950/70 border-b border-cyan-600/50 px-3.5 py-1 flex items-center gap-2 text-[10.5px] text-cyan-300">
          <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
          <span>Đang tính toán đồng bộ bề mặt địa hình 3D...</span>
        </div>
      )}

      {/* 2. Thanh Tham Số Khảo Sát Quân Sự (H_mt & Trạng Thái Mù) */}
      <div className="px-3.5 py-1.5 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-between gap-3 text-xs flex-wrap">
        {/* Cụm chọn độ cao mục tiêu H_mt */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono font-bold text-amber-300 flex items-center gap-1.5">
            <span>Độ cao mục tiêu (H_mt):</span>
          </span>

          <div className="flex items-center gap-1">
            {[50, 100, 200, 300, 500, 1000].map((alt) => (
              <button
                key={alt}
                onClick={() => setTargetHeightMeters(alt)}
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all border ${
                  hMt === alt
                    ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                    : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-amber-500/40 hover:text-amber-200'
                }`}
                title={`Khảo sát vùng mù khi mục tiêu bay ở độ cao ${alt}m`}
              >
                {alt}m
              </button>
            ))}
          </div>

          {/* Công tắc chế độ AGL (bám đất) vs MSL (tuyệt đối) */}
          <button
            onClick={() => setIsTargetAgl(!isTargetAgl)}
            className={`ml-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition-colors ${
              isTargetAgl
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50'
                : 'bg-indigo-950/80 text-indigo-300 border-indigo-500/50'
            }`}
            title="Chuyển đổi: Bám theo địa hình (AGL như trong ảnh sách) hoặc Bay bằng so với mực nước biển (MSL)"
          >
            {isTargetAgl ? 'Bám đất (AGL)' : 'Mực biển (MSL)'}
          </button>
        </div>

        {/* Tóm tắt tình trạng che khuất & mốc chân trời */}
        <div className="flex items-center gap-3 font-mono text-[11px]">
          {blindAnalysis && blindAnalysis.segments.length > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-rose-400 font-bold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <span>{blindAnalysis.segments.length} đoạn mù:</span>
              </span>
              <span className="text-slate-300">
                {blindAnalysis.segments.map((s) => (
                  <span key={s.id} className="mr-2 text-rose-300/90 font-medium">
                    Đoạn {s.id}: <strong className="text-white">{s.rBdKm}</strong>-
                    <strong className="text-white">{s.rKtKm}km</strong> (dài {s.lengthKm}km)
                  </span>
                ))}
              </span>
              <span className="text-slate-400 border-l border-slate-800 pl-2">
                Tổng mù: <strong className="text-rose-400">{blindAnalysis.totalBlindKm}km</strong>
              </span>
            </div>
          ) : (
            <div className="text-emerald-400 font-semibold">
              ✓ Tầm nhìn thông thoáng đến chân trời D_tn (Không có đoạn mù do núi chắn)
            </div>
          )}

          {blindAnalysis && (
            <div className="border-l border-slate-800 pl-3 text-purple-300">
              Chân trời D_tn:{' '}
              <strong className="text-purple-200">{blindAnalysis.dTnKm}km</strong>
            </div>
          )}
        </div>
      </div>

      {/* 3. Thân Biểu Đồ SVG Mặt Cắt */}
      <div className="relative p-2 bg-slate-950/95 flex flex-col items-center">
        {!field && !isSam ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin mb-3" />
            <p className="text-xs">Đang lấy mẫu địa hình và phân tích trường Coverage Field...</p>
          </div>
        ) : (
          <div className="relative overflow-hidden">
            <svg
              width={width}
              height={height}
              className={`bg-slate-950 rounded-xl border border-slate-800/80 select-none ${
                isPanning ? 'cursor-grabbing' : 'cursor-crosshair'
              }`}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onClick={(e) => {
                if (isPanning || !selectedInst) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                if (
                  mouseX >= padLeft &&
                  mouseX <= padLeft + chartW &&
                  mouseY >= padTop &&
                  mouseY <= padTop + chartH
                ) {
                  const distM = Math.round(fromX(mouseX));
                  const distKm = Number((distM / 1000).toFixed(1));
                  const altM = Math.round(fromY(mouseY));

                  const nearestTerrain = terrainPoints.find(
                    (p) => Math.abs(p.distM - distM) < 2500
                  );

                  const status = evaluatePointStatus(distKm, altM, nearestTerrain?.altM);
                  const dest = destinationPoint(
                    selectedInst.latitude,
                    selectedInst.longitude,
                    distM,
                    currentAzimuth
                  );

                  setCrossSectionProbePoint({
                    instanceId: selectedInst.instanceId,
                    azimuthDeg: currentAzimuth,
                    distM,
                    distKm,
                    altM,
                    terrainAltM: nearestTerrain?.altM,
                    status,
                    lat: dest.lat,
                    lon: dest.lon,
                  });
                }
              }}
            >
              <defs>
                {/* Giới hạn vẽ bên trong khung biểu đồ để không tràn trục khi zoom */}
                <clipPath id="chartAreaClip">
                  <rect x={padLeft} y={padTop} width={chartW} height={chartH} />
                </clipPath>

                {/* Giới hạn vùng nhìn thấy phía trên bóng núi để cắt khuyết quả lê WEZ */}
                {samLosVisibleClipD && (
                  <clipPath id="samLosVisibleClip">
                    <path d={samLosVisibleClipD} />
                  </clipPath>
                )}

                {/* Gradient nền địa hình núi non */}
                <linearGradient id="terrainGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#334155" stopOpacity="0.9" />
                  <stop offset="60%" stopColor="#1e293b" stopOpacity="0.95" />
                  <stop offset="100%" stopColor="#0f172a" stopOpacity="0.98" />
                </linearGradient>

                {/* Pattern cho vùng mù Shadow / Bị chắn như trong sách */}
                <pattern
                  id="blindHatch"
                  width="8"
                  height="8"
                  patternTransform="rotate(45 0 0)"
                  patternUnits="userSpaceOnUse"
                >
                  <line
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="8"
                    stroke="#f43f5e"
                    strokeWidth="1.6"
                    strokeOpacity="0.8"
                  />
                </pattern>

                {/* Mũi tên chỉ thị */}
                <marker
                  id="arrowRose"
                  viewBox="0 0 10 10"
                  refX="5"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#f43f5e" />
                </marker>
                <marker
                  id="arrowBlue"
                  viewBox="0 0 10 10"
                  refX="5"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
                </marker>
                <marker
                  id="arrowGreen"
                  viewBox="0 0 10 10"
                  refX="5"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
                </marker>
              </defs>

              {/* LƯỚI TỌA ĐỘ Y (ĐỘ CAO MSL) */}
              {yTicks.map((alt) => {
                const y = toY(alt);
                if (y < padTop || y > padTop + chartH) return null;
                const isZero = alt === 0;
                const isLargeScale = curAltMaxM - curAltMinM > 3500;
                const labelText =
                  alt >= 1000 && isLargeScale
                    ? `${(alt / 1000).toLocaleString('vi-VN')} km`
                    : `${alt.toLocaleString('vi-VN')} m`;

                return (
                  <g key={`y-${alt}`}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={padLeft + chartW}
                      y2={y}
                      stroke={isZero ? '#475569' : '#1e293b'}
                      strokeDasharray={isZero ? undefined : '3 3'}
                      strokeWidth={isZero ? '1.2' : '1'}
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 3.5}
                      textAnchor="end"
                      fill={isZero ? '#94a3b8' : '#64748b'}
                      fontSize="10"
                      fontFamily="monospace"
                      fontWeight={isZero ? 'bold' : 'normal'}
                    >
                      {labelText}
                    </text>
                  </g>
                );
              })}

              {/* LƯỚI TỌA ĐỘ X (CỰ LY KM) */}
              {xTicks.map((distKm) => {
                const x = toX(distKm * 1000);
                if (x < padLeft || x > padLeft + chartW) return null;
                return (
                  <g key={`x-${distKm}`}>
                    <line
                      x1={x}
                      y1={padTop}
                      x2={x}
                      y2={padTop + chartH}
                      stroke="#1e293b"
                      strokeDasharray="3 3"
                      strokeWidth="1"
                    />
                    <text
                      x={x}
                      y={padTop + chartH + 16}
                      textAnchor="middle"
                      fill="#64748b"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {distKm} km
                    </text>
                  </g>
                );
              })}

              {/* KHUNG VÙNG VẼ ĐỒ THỊ (CÓ CLIP-PATH) */}
              <g clipPath="url(#chartAreaClip)">
                {/* 1. NẾU LÀ RADAR ĐỘC LẬP: VẼ CÁC TIA QUÉT QUANG TUYẾN LOS */}
                {!isSam &&
                  raysOnAzimuth.map((ray) => {
                    const el = ray.elevationDeg;
                    if (ray.maxRangeM <= 0) return null;
                    const originX = toX(0);
                    const originY = toY(field?.radarAltM || selectedInst.altitude || 0);

                    const sEndVis =
                      ray.samples.find((s) => s.distanceM >= ray.visibleEndM) ||
                      ray.samples[ray.samples.length - 1];

                    const visX = toX(ray.visibleEndM);
                    const visY = sEndVis ? toY(sEndVis.rayAltM) : originY;

                    return (
                      <g key={`ray-${el}`}>
                        <line
                          x1={originX}
                          y1={originY}
                          x2={visX}
                          y2={visY}
                          stroke={selectedInst.color}
                          strokeWidth="1.2"
                          strokeOpacity="0.45"
                        />
                      </g>
                    );
                  })}

                {/* 1b. NẾU LÀ SAM: VẼ CHÙM TIA QUANG TUYẾN RADAR (TAR / FCR) MÀU XANH DƯƠNG NHẠT */}
                {isSam &&
                  samRays.map((ray) => {
                    const originX = toX(0);
                    const radarGround = terrainPoints[0]?.altM || selectedInst.altitude || 0;
                    const ha = selectedInst.antennaHeightAGL || 8.2;
                    const originY = toY(radarGround + ha);
                    const visX = toX(ray.endDistM);
                    const visY = toY(ray.endAltM);

                    return (
                      <line
                        key={`sam-ray-${ray.el}`}
                        x1={originX}
                        y1={originY}
                        x2={visX}
                        y2={visY}
                        stroke="#38bdf8"
                        strokeWidth="1.2"
                        strokeOpacity="0.30"
                      />
                    );
                  })}

                {/* 2. NẾU LÀ SAM: VẼ VÒM HỎA LỰC SAM (LỚP LÝ THUYẾT & LỚP THỰC TẾ CẮT NÚI) */}
                {isSam && isSpyder && (
                  <g>
                    {/* Lớp Lý thuyết (Nominal) - Nét đứt mảnh, mờ */}
                    {spyderMrPathD && (
                      <path
                        d={spyderMrPathD}
                        fill="#0ea5e9"
                        fillOpacity="0.08"
                        stroke="#38bdf8"
                        strokeWidth="1.5"
                        strokeDasharray="4 3"
                      />
                    )}
                    {spyderSrPathD && (
                      <path
                        d={spyderSrPathD}
                        fill="#10b981"
                        fillOpacity="0.08"
                        stroke="#10b981"
                        strokeWidth="1.5"
                        strokeDasharray="4 3"
                      />
                    )}

                    {/* Lớp Thực tế (Effective) - Cắt khuyết bóng núi qua samLosVisibleClip */}
                    <g clipPath={samLosVisibleClipD ? 'url(#samLosVisibleClip)' : undefined}>
                      {(spyderMrEffectivePathD || spyderMrPathD) && (
                        <path
                          d={spyderMrEffectivePathD || spyderMrPathD}
                          fill="#0ea5e9"
                          fillOpacity="0.35"
                          stroke="#38bdf8"
                          strokeWidth="2.2"
                        />
                      )}
                      {(spyderSrEffectivePathD || spyderSrPathD) && (
                        <path
                          d={spyderSrEffectivePathD || spyderSrPathD}
                          fill="#10b981"
                          fillOpacity="0.38"
                          stroke="#10b981"
                          strokeWidth="2.2"
                        />
                      )}
                    </g>
                  </g>
                )}

                {isSam && !isSpyder && (
                  <g>
                    {/* Lớp Lý thuyết (Nominal) - Nét đứt mảnh, mờ */}
                    {samOuterPathD && (
                      <path
                        d={samOuterPathD}
                        fill={selectedInst.color || '#f43f5e'}
                        fillOpacity="0.08"
                        stroke={selectedInst.color || '#f43f5e'}
                        strokeWidth="1.5"
                        strokeDasharray="4 3"
                      />
                    )}

                    {/* Lớp Thực tế (Effective) - Cắt khuyết bóng núi qua samLosVisibleClip */}
                    <g clipPath={samLosVisibleClipD ? 'url(#samLosVisibleClip)' : undefined}>
                      {(samOuterEffectivePathD || samOuterPathD) && (
                        <path
                          d={samOuterEffectivePathD || samOuterPathD}
                          fill={selectedInst.color || '#f43f5e'}
                          fillOpacity="0.35"
                          stroke={selectedInst.color || '#f43f5e'}
                          strokeWidth="2.2"
                        />
                      )}
                      {samDeadConePathD && (
                        <path
                          d={samDeadConePathD}
                          fill="#020617"
                          fillOpacity="0.8"
                          stroke="#f43f5e"
                          strokeWidth="1.6"
                          strokeDasharray="4 3"
                        />
                      )}
                    </g>
                  </g>
                )}

                {/* 3. CÁC ĐOẠN KHÔNG NHÌN THẤY (BLIND SEGMENTS / SHADOW POLYGONS NHƯ TRONG SÁCH) */}
                {blindAnalysis &&
                  blindAnalysis.segments.map((seg) => (
                    <g key={`blind-poly-${seg.id}`}>
                      {/* Vùng sọc chéo biểu thị đoạn không nhìn thấy */}
                      <path
                        d={seg.polygonD}
                        fill="url(#blindHatch)"
                        stroke="#f43f5e"
                        strokeWidth="1.2"
                        strokeOpacity="0.9"
                      />
                    </g>
                  ))}

                {/* 4. ĐƯỜNG BAY CỦA MỤC TIÊU H_mt (NÉT ĐỨT VÀNG HỔ PHÁCH) */}
                {targetLineD && (
                  <path
                    d={targetLineD}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="1.8"
                    strokeDasharray="5 3"
                    strokeOpacity="0.95"
                  />
                )}

                {/* 5. MẶT CẮT ĐỊA HÌNH NÚI NON THỰC TẾ */}
                {terrainPathD && (
                  <path
                    d={terrainPathD}
                    fill="url(#terrainGradient)"
                    stroke="#475569"
                    strokeWidth="1.5"
                  />
                )}
                {terrainLineD && (
                  <path d={terrainLineD} fill="none" stroke="#94a3b8" strokeWidth="1.5" />
                )}

                {/* 6. VỊ TRÍ ĐÀI / ANTEN TẠI X = 0 (ha = 15m/50m NHƯ TRONG SÁCH) */}
                {(() => {
                  const radarGround = terrainPoints[0]?.altM || selectedInst.altitude || 0;
                  const ha = selectedInst.antennaHeightAGL || 15;
                  const radarAntAlt = radarGround + ha;

                  return (
                    <g>
                      {/* Cột anten */}
                      <line
                        x1={toX(0)}
                        y1={toY(radarGround)}
                        x2={toX(0)}
                        y2={toY(radarAntAlt)}
                        stroke={selectedInst.color}
                        strokeWidth="3.5"
                      />
                      {/* Cục phát anten / chảo */}
                      <circle
                        cx={toX(0)}
                        cy={toY(radarAntAlt)}
                        r="6"
                        fill={selectedInst.color}
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      />
                      <circle cx={toX(0)} cy={toY(radarAntAlt)} r="12" fill="none" stroke={selectedInst.color} strokeWidth="1" strokeDasharray="2 2" strokeOpacity="0.6" />
                      <text
                        x={toX(0) + 12}
                        y={toY(radarAntAlt) - 4}
                        fill={selectedInst.color}
                        fontSize="11"
                        fontWeight="bold"
                        fontFamily="sans-serif"
                      >
                        {selectedInst.shortId || selectedInst.name} [ha={ha}m]
                      </text>
                    </g>
                  );
                })()}
                {/* Điểm Chạm Núi Che Khuất đầu tiên (nếu có) */}
                {firstOcclusion && (
                  <g>
                    <circle
                      cx={toX(firstOcclusion.distanceM)}
                      cy={toY(firstOcclusion.terrainAltM)}
                      r="5"
                      fill="#f43f5e"
                      stroke="#ffffff"
                      strokeWidth="1.5"
                    />
                    <text
                      x={toX(firstOcclusion.distanceM) + 8}
                      y={toY(firstOcclusion.terrainAltM) - 6}
                      fill="#fda4af"
                      fontSize="10"
                      fontWeight="bold"
                      fontFamily="sans-serif"
                    >
                      Điểm núi chắn [{Number((firstOcclusion.distanceM / 1000).toFixed(1))}km, {firstOcclusion.terrainAltM}m]
                    </text>
                  </g>
                )}

                {/* 7. NHÃN CALLOUT "Đoạn không nhìn thấy khi Hmt = ...m" KÈM MŨI TÊN (CHUẨN ẢNH SÁCH) */}
                {blindAnalysis?.longestSegment && (
                  <g className="callout-blind pointer-events-none">
                    {/* Đường dóng mũi tên */}
                    <line
                      x1={toX(blindAnalysis.longestSegment.midDistM)}
                      y1={Math.max(
                        padTop + 24,
                        toY(blindAnalysis.longestSegment.midRayAltM) - 20
                      )}
                      x2={toX(blindAnalysis.longestSegment.midDistM)}
                      y2={toY(blindAnalysis.longestSegment.midRayAltM)}
                      stroke="#fda4af"
                      strokeWidth="1.5"
                      markerEnd="url(#arrowRose)"
                    />
                    {/* Hộp nhãn giáo trình */}
                    <g
                      transform={`translate(${Math.max(
                        padLeft + 10,
                        Math.min(
                          width - padRight - 225,
                          toX(blindAnalysis.longestSegment.midDistM) - 105
                        )
                      )}, ${Math.max(
                        padTop + 8,
                        toY(blindAnalysis.longestSegment.midRayAltM) - 44
                      )})`}
                    >
                      <rect
                        x="0"
                        y="0"
                        width="215"
                        height="22"
                        rx="4"
                        fill="#020617"
                        fillOpacity="0.9"
                        stroke="#f43f5e"
                        strokeWidth="1.2"
                      />
                      <text
                        x="107"
                        y="15"
                        textAnchor="middle"
                        fill="#fecdd3"
                        fontSize="10"
                        fontFamily="sans-serif"
                        fontWeight="bold"
                      >
                        Vùng mù địa hình (Radar Shadow)
                      </text>
                    </g>
                  </g>
                )}

                {/* 8. ĐIỂM CHẤM KHẢO SÁT 3D ĐÃ GHIM (PROBE POINT) */}
                {crossSectionProbePoint &&
                  crossSectionProbePoint.instanceId === selectedInst.instanceId &&
                  crossSectionProbePoint.azimuthDeg === currentAzimuth && (
                    <g className="probe-point-marker">
                      <line
                        x1={toX(crossSectionProbePoint.distM)}
                        y1={toY(crossSectionProbePoint.altM)}
                        x2={toX(crossSectionProbePoint.distM)}
                        y2={padTop + chartH}
                        stroke="#fde047"
                        strokeWidth="1.5"
                        strokeDasharray="3 3"
                      />
                      <line
                        x1={padLeft}
                        y1={toY(crossSectionProbePoint.altM)}
                        x2={toX(crossSectionProbePoint.distM)}
                        y2={toY(crossSectionProbePoint.altM)}
                        stroke="#fde047"
                        strokeWidth="1.5"
                        strokeDasharray="3 3"
                      />
                      <circle
                        cx={toX(crossSectionProbePoint.distM)}
                        cy={toY(crossSectionProbePoint.altM)}
                        r="10"
                        fill="#fde047"
                        fillOpacity="0.25"
                        stroke="#fde047"
                        strokeWidth="1.5"
                      />
                      <circle
                        cx={toX(crossSectionProbePoint.distM)}
                        cy={toY(crossSectionProbePoint.altM)}
                        r="4"
                        fill="#fde047"
                        stroke="#020617"
                        strokeWidth="2"
                      />
                      <g
                        transform={`translate(${Math.min(
                          width - 150,
                          Math.max(padLeft + 10, toX(crossSectionProbePoint.distM) + 8)
                        )}, ${Math.max(padTop + 20, toY(crossSectionProbePoint.altM) - 10)})`}
                      >
                        <rect
                          x="0"
                          y="-14"
                          width="132"
                          height="20"
                          rx="4"
                          fill="#020617"
                          fillOpacity="0.9"
                          stroke="#fde047"
                          strokeWidth="1"
                        />
                        <text
                          x="6"
                          y="0"
                          fill="#fde047"
                          fontSize="10"
                          fontWeight="bold"
                          fontFamily="monospace"
                        >
                          📍 {crossSectionProbePoint.distKm}km •{' '}
                          {crossSectionProbePoint.altM.toLocaleString('vi-VN')}m
                        </text>
                      </g>
                    </g>
                  )}

                {/* 9. ĐƯỜNG DÓNG CHỮ THẬP KHI RÊ CHUỘT (HOVER) */}
                {hoverData && (
                  <g>
                    <line
                      x1={toX(hoverData.distKm * 1000)}
                      y1={padTop}
                      x2={toX(hoverData.distKm * 1000)}
                      y2={padTop + chartH}
                      stroke="#06b6d4"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                      strokeOpacity="0.8"
                    />
                    <line
                      x1={padLeft}
                      y1={toY(hoverData.altM)}
                      x2={padLeft + chartW}
                      y2={toY(hoverData.altM)}
                      stroke="#06b6d4"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                      strokeOpacity="0.8"
                    />
                  </g>
                )}
              </g>

              {/* KHUNG BAO NGOÀI BIỂU ĐỒ */}
              <rect
                x={padLeft}
                y={padTop}
                width={chartW}
                height={chartH}
                fill="none"
                stroke="#334155"
                strokeWidth="1.2"
              />

              {/* 10. CÁC MỐC QUÂN SỰ PHÍA DƯỚI TRỤC HOÀNH (R_bd1, R_kt1, R_bd2, R_kt2, D_tn, D_0) */}
              {blindAnalysis &&
                blindAnalysis.segments.map((seg) => {
                  const xBd = toX(seg.rBdM);
                  const xKt = toX(seg.rKtM);

                  return (
                    <g key={`markers-${seg.id}`}>
                      {/* Vạch mốc R_bđ */}
                      {seg.rBdM >= curDistMinM && seg.rBdM <= curDistMaxM && (
                        <g>
                          <line
                            x1={xBd}
                            y1={padTop + chartH}
                            x2={xBd}
                            y2={padTop + chartH + 24}
                            stroke="#f43f5e"
                            strokeWidth="1.2"
                            strokeDasharray="2 2"
                          />
                          <path
                            d={`M ${xBd - 3} ${padTop + chartH + 6} L ${xBd} ${padTop + chartH} L ${xBd + 3} ${padTop + chartH + 6}`}
                            fill="none"
                            stroke="#f43f5e"
                            strokeWidth="1.2"
                          />
                          <text
                            x={xBd}
                            y={padTop + chartH + 34}
                            textAnchor="middle"
                            fill="#f43f5e"
                            fontSize="10"
                            fontFamily="sans-serif"
                            fontWeight="bold"
                          >
                            R<tspan fontSize="8" dy="2">bđ{seg.id}</tspan>
                          </text>
                          <text
                            x={xBd}
                            y={padTop + chartH + 45}
                            textAnchor="middle"
                            fill="#fda4af"
                            fontSize="8.5"
                            fontFamily="monospace"
                          >
                            {seg.rBdKm}k
                          </text>
                        </g>
                      )}

                      {/* Vạch mốc R_kt */}
                      {seg.rKtM >= curDistMinM && seg.rKtM <= curDistMaxM && (
                        <g>
                          <line
                            x1={xKt}
                            y1={padTop + chartH}
                            x2={xKt}
                            y2={padTop + chartH + 24}
                            stroke="#38bdf8"
                            strokeWidth="1.2"
                            strokeDasharray="2 2"
                          />
                          <path
                            d={`M ${xKt - 3} ${padTop + chartH + 6} L ${xKt} ${padTop + chartH} L ${xKt + 3} ${padTop + chartH + 6}`}
                            fill="none"
                            stroke="#38bdf8"
                            strokeWidth="1.2"
                          />
                          <text
                            x={xKt}
                            y={padTop + chartH + 34}
                            textAnchor="middle"
                            fill="#38bdf8"
                            fontSize="10"
                            fontFamily="sans-serif"
                            fontWeight="bold"
                          >
                            R<tspan fontSize="8" dy="2">kt{seg.id}</tspan>
                          </text>
                          <text
                            x={xKt}
                            y={padTop + chartH + 45}
                            textAnchor="middle"
                            fill="#7dd3fc"
                            fontSize="8.5"
                            fontFamily="monospace"
                          >
                            {seg.rKtKm}k
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

              {/* Mốc Chân Trời Tự Nhiên D_tn */}
              {blindAnalysis &&
                blindAnalysis.dTnKm * 1000 >= curDistMinM &&
                blindAnalysis.dTnKm * 1000 <= curDistMaxM && (
                  <g>
                    <line
                      x1={toX(blindAnalysis.dTnKm * 1000)}
                      y1={padTop + chartH}
                      x2={toX(blindAnalysis.dTnKm * 1000)}
                      y2={padTop + chartH + 24}
                      stroke="#c084fc"
                      strokeWidth="1.2"
                      strokeDasharray="2 2"
                    />
                    <path
                      d={`M ${toX(blindAnalysis.dTnKm * 1000) - 3} ${padTop + chartH + 6} L ${toX(blindAnalysis.dTnKm * 1000)} ${padTop + chartH} L ${toX(blindAnalysis.dTnKm * 1000) + 3} ${padTop + chartH + 6}`}
                      fill="none"
                      stroke="#c084fc"
                      strokeWidth="1.2"
                    />
                    <text
                      x={toX(blindAnalysis.dTnKm * 1000)}
                      y={padTop + chartH + 34}
                      textAnchor="middle"
                      fill="#c084fc"
                      fontSize="10"
                      fontFamily="sans-serif"
                      fontWeight="bold"
                    >
                      D<tspan fontSize="8" dy="2">tn</tspan>
                    </text>
                    <text
                      x={toX(blindAnalysis.dTnKm * 1000)}
                      y={padTop + chartH + 45}
                      textAnchor="middle"
                      fill="#e9d5ff"
                      fontSize="8.5"
                      fontFamily="monospace"
                    >
                      {blindAnalysis.dTnKm}k
                    </text>
                  </g>
                )}

              {/* Mốc Cự Ly Cực Đại D_0 */}
              {blindAnalysis &&
                blindAnalysis.d0Km * 1000 >= curDistMinM &&
                blindAnalysis.d0Km * 1000 <= curDistMaxM && (
                  <g>
                    <line
                      x1={toX(blindAnalysis.d0Km * 1000)}
                      y1={padTop + chartH}
                      x2={toX(blindAnalysis.d0Km * 1000)}
                      y2={padTop + chartH + 24}
                      stroke="#10b981"
                      strokeWidth="1.2"
                      strokeDasharray="2 2"
                    />
                    <path
                      d={`M ${toX(blindAnalysis.d0Km * 1000) - 3} ${padTop + chartH + 6} L ${toX(blindAnalysis.d0Km * 1000)} ${padTop + chartH} L ${toX(blindAnalysis.d0Km * 1000) + 3} ${padTop + chartH + 6}`}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="1.2"
                    />
                    <text
                      x={toX(blindAnalysis.d0Km * 1000)}
                      y={padTop + chartH + 34}
                      textAnchor="middle"
                      fill="#10b981"
                      fontSize="10"
                      fontFamily="sans-serif"
                      fontWeight="bold"
                    >
                      D<tspan fontSize="8" dy="2">0</tspan>
                    </text>
                    <text
                      x={toX(blindAnalysis.d0Km * 1000)}
                      y={padTop + chartH + 45}
                      textAnchor="middle"
                      fill="#a7f3d0"
                      fontSize="8.5"
                      fontFamily="monospace"
                    >
                      {blindAnalysis.d0Km}k
                    </text>
                  </g>
                )}
            </svg>

            {/* Tooltip nổi khi Hover trên đồ thị */}
            {hoverData && (
              <div
                className="absolute pointer-events-none bg-slate-900/95 border border-cyan-500/60 rounded-lg p-2.5 text-[11px] font-mono shadow-xl text-slate-200 z-10 space-y-1"
                style={{
                  left: `${Math.min(
                    width - 230,
                    Math.max(padLeft, toX(hoverData.distKm * 1000) + 12)
                  )}px`,
                  top: `${Math.min(height - 95, Math.max(padTop, toY(hoverData.altM) - 55))}px`,
                }}
              >
                <div className="text-cyan-300 font-bold">Cự ly: {hoverData.distKm} km</div>
                <div className="text-slate-300">
                  Độ cao khảo sát: {hoverData.altM.toLocaleString()} m (MSL)
                </div>
                {hoverData.terrainM !== undefined && (
                  <div className="text-emerald-400">Độ cao đất: {hoverData.terrainM} m</div>
                )}
                {hoverData.terrainM !== undefined && (
                  <div className="text-amber-300">
                    Cách mặt đất: {Math.max(0, hoverData.altM - hoverData.terrainM)} m (AGL)
                  </div>
                )}
                {hoverData.status && (
                  <div className="text-rose-400 font-bold border-t border-slate-800 pt-0.5">
                    {hoverData.status}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. Footer Thống Kê & Chú Thích Quân Sự */}
      <div className="p-3 border-t border-slate-800 bg-slate-900/85 flex items-center justify-between text-xs text-slate-300 flex-wrap gap-2">
        <div className="flex items-center gap-3.5 flex-wrap">
          {isSam ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded bg-rose-500/80 border border-rose-400" />
                <span className="text-slate-300">Vòm Hỏa Lực Tiêu Diệt (100% D_max)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded bg-slate-950 border border-dashed border-rose-400" />
                <span className="text-slate-400">Nón Mù Đỉnh Đầu</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-1 rounded" style={{ backgroundColor: selectedInst.color }} />
                <span className="text-slate-400">Tia Nhìn Thấy (Visible)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded bg-rose-950/80 border border-rose-500/80" />
                <span className="text-rose-300 font-medium">Đoạn Không Nhìn Thấy (Shadow)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-0.5 border-t-2 border-dashed border-amber-400" />
                <span className="text-amber-300 font-mono">Đường bay H_mt ({hMt}m)</span>
              </div>
            </>
          )}

          <div className="flex items-center gap-1.5">
            <Mountain className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-400">Địa hình 3D (MSL)</span>
          </div>

          <div className="flex items-center gap-1 text-[11px] text-cyan-400/80 font-mono">
            <span>💡 Cuộn chuột: Zoom | Kéo chuột: Rê biểu đồ</span>
          </div>
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px]">
          {isSam ? (
            <>
              <div>
                Xạ giới:{' '}
                <strong className="text-cyan-300">
                  {samDMinKm} - {samDMaxKm} km
                </strong>
              </div>
              <div className="border-l border-slate-800 pl-3">
                Độ cao:{' '}
                <strong className="text-emerald-400">
                  {samHMinM}m - {(samHMaxM / 1000).toFixed(0)}km
                </strong>
              </div>
              <div className="border-l border-slate-800 pl-3">
                V_max: <strong className="text-amber-300">{samVMps} m/s</strong>
              </div>
              <div className="border-l border-slate-800 pl-3">
                P_gh: <strong className="text-rose-400">{samPGhKm} km</strong>
              </div>
            </>
          ) : (
            <>
              <div>
                Số tia trên hướng {currentAzimuth}°:{' '}
                <strong className="text-cyan-300">{totalRaysOnAz} tia</strong>
              </div>
              <div className="border-l border-slate-800 pl-3">
                Bị núi chắn:{' '}
                <strong className={occludedRaysOnAz > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                  {occludedRaysOnAz} tia
                </strong>
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
};
