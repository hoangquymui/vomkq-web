/**
 * ZUSTAND STORE: SA BÀN TÁC CHIẾN MÔ PHỎNG (TACTICAL RADAR SANDBOX)
 * ================================================================
 * 
 * Quản lý vòng đời và trạng thái độc lập của chế độ Sa bàn Tác chiến:
 * - Kích hoạt / Thoát sa bàn
 * - Chủ đề thị giác (Monochrome SAR / CRT Green / Amber HUD)
 * - Danh sách lực lượng chiến thuật đã bố trí (MANPADS, Pháo 23mm, Đài quan sát...)
 * - Trạng thái chế độ kéo thả / cắm chốt (Placement mode)
 * - Quỹ đạo mô phỏng xâm nhập UAV luồn khe núi & tiến độ bay
 * - Danh sách gợi ý điểm cao chốt chặn từ AI Co-pilot
 * 
 * Tuân thủ Project Development Rules:
 * Mọi thông số quan trọng đều có kiểu dữ liệu tường minh, giá trị mặc định và mô tả rõ ràng.
 */

import { create } from 'zustand';
import type { RadarCoverageField } from '../types/radarCoverage';
import {
  TACTICAL_UNIT_PRESETS,
  type InfiltrationSimulationRoute,
  type InterceptionSuggestion,
  type SandboxVisualTheme,
  type TacticalSandboxUnit,
  type TacticalUnitRole,
} from '../types/tacticalSandbox';
import {
  evaluateRouteInterception,
  generateDefaultNapOfTheEarthRoute,
  generateInfiltrationRoute,
  generateTacticalAiSuggestions,
} from '../utils/tacticalInfiltrationEngine';

export interface TacticalSandboxState {
  /** Sa bàn tác chiến đang bật hay tắt */
  isSandboxActive: boolean;

  /** Chủ đề màu sắc hiển thị 3D */
  theme: SandboxVisualTheme;

  /** ID của đài radar làm trung tâm sa bàn */
  activeRadarId: string | null;

  /** Danh sách các đơn vị chiến thuật đã bố trí trên bản đồ */
  deployedUnits: TacticalSandboxUnit[];

  /** Đơn vị đang được người dùng bấm chọn */
  selectedUnitId: string | null;

  /** Loại đơn vị đang được chuẩn bị cắm xuống bản đồ (null nếu không trong chế độ cắm) */
  activePlacementRole: TacticalUnitRole | null;

  /** Tuyến bay luồn lách đang được mô phỏng */
  activeInfiltrationRoute: InfiltrationSimulationRoute | null;

  /** UAV đang bay mô phỏng (Play/Pause) */
  isSimulating: boolean;

  /**
   * Hệ số nhân tốc độ bay mô phỏng
   * - Tên biến: simulationSpeedMultiplier
   * - Type: number
   * - Mặc định: 1 (1x)
   * - Phạm vi: 0.5x - 5x
   */
  simulationSpeedMultiplier: number;

  /** Danh sách các điểm cao do AI gợi ý */
  aiSuggestions: InterceptionSuggestion[];

  /** Bật/tắt hiển thị vòm bán kính hỏa lực (WEZ Dome) */
  showWEZDomes: boolean;

  // --- ACTIONS ---
  enterSandbox: (radarId?: string) => void;
  exitSandbox: () => void;
  setTheme: (theme: SandboxVisualTheme) => void;
  setActivePlacementRole: (role: TacticalUnitRole | null) => void;
  deployUnit: (data: {
    role: TacticalUnitRole;
    latitude: number;
    longitude: number;
    altitudeM: number;
    name?: string;
  }) => TacticalSandboxUnit;
  removeUnit: (unitId: string) => void;
  selectUnit: (unitId: string | null) => void;
  clearAllDeployedUnits: () => void;

  generateRouteForField: (
    field: RadarCoverageField,
    corridorAzimuthDeg?: number
  ) => InfiltrationSimulationRoute | null;
  setSimulationProgress: (progress: number) => void;
  stepSimulationProgress: (deltaProgress: number) => void;
  setIsSimulating: (isSimulating: boolean) => void;
  toggleSimulation: () => void;
  setSimulationSpeed: (speed: number) => void;

  fetchAiSuggestions: (field: RadarCoverageField) => void;
  applyAiSuggestion: (suggestionId: string) => TacticalSandboxUnit | null;
  setShowWEZDomes: (show: boolean) => void;
  resetSandbox: () => void;
}

export const useTacticalSandboxStore = create<TacticalSandboxState>((set, get) => ({
  isSandboxActive: false,
  theme: 'monochrome',
  activeRadarId: null,
  deployedUnits: [],
  selectedUnitId: null,
  activePlacementRole: null,
  activeInfiltrationRoute: null,
  isSimulating: false,
  simulationSpeedMultiplier: 1.0,
  aiSuggestions: [],
  showWEZDomes: true,

  enterSandbox: (radarId) => {
    let route = get().activeInfiltrationRoute;
    if (!route) {
      route = generateDefaultNapOfTheEarthRoute(21.458, 105.645, {
        deployedUnits: get().deployedUnits,
      });
    }
    set({
      isSandboxActive: true,
      activeRadarId: radarId ?? null,
      activeInfiltrationRoute: route,
      activePlacementRole: null,
      isSimulating: false,
    });
  },

  exitSandbox: () => {
    set({
      isSandboxActive: false,
      activePlacementRole: null,
      isSimulating: false,
    });
  },

  setTheme: (theme) => set({ theme }),

  setActivePlacementRole: (activePlacementRole) => set({ activePlacementRole }),

  deployUnit: ({ role, latitude, longitude, altitudeM, name }) => {
    const preset = TACTICAL_UNIT_PRESETS[role];
    const newUnit: TacticalSandboxUnit = {
      id: `unit_${role}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      role,
      name: name ?? `${preset.shortName} #${get().deployedUnits.length + 1}`,
      latitude,
      longitude,
      altitudeM,
      rangeM: preset.rangeM,
      maxHeightM: preset.maxHeightM,
      minHeightM: preset.minHeightM,
      colorHex: preset.colorHex,
      iconName: preset.iconName,
      deployedAt: Date.now(),
    };

    const nextUnits = [...get().deployedUnits, newUnit];
    let nextRoute = get().activeInfiltrationRoute;
    if (nextRoute) {
      nextRoute = evaluateRouteInterception(nextRoute, nextUnits);
    }

    set({
      deployedUnits: nextUnits,
      selectedUnitId: newUnit.id,
      activeInfiltrationRoute: nextRoute,
      activePlacementRole: null, // Thoát chế độ cắm sau khi cắm xong 1 đơn vị
    });

    return newUnit;
  },

  removeUnit: (unitId) => {
    const nextUnits = get().deployedUnits.filter((u) => u.id !== unitId);
    let nextRoute = get().activeInfiltrationRoute;
    if (nextRoute) {
      nextRoute = evaluateRouteInterception(nextRoute, nextUnits);
    }

    set({
      deployedUnits: nextUnits,
      selectedUnitId: get().selectedUnitId === unitId ? null : get().selectedUnitId,
      activeInfiltrationRoute: nextRoute,
    });
  },

  selectUnit: (selectedUnitId) => set({ selectedUnitId }),

  clearAllDeployedUnits: () => {
    let nextRoute = get().activeInfiltrationRoute;
    if (nextRoute) {
      nextRoute = evaluateRouteInterception(nextRoute, []);
    }
    set({
      deployedUnits: [],
      selectedUnitId: null,
      activeInfiltrationRoute: nextRoute,
    });
  },

  generateRouteForField: (field, corridorAzimuthDeg) => {
    const route = generateInfiltrationRoute(field, {
      corridorAzimuthDeg,
      deployedUnits: get().deployedUnits,
    });
    set({
      activeInfiltrationRoute: route,
      isSimulating: false,
    });
    return route;
  },

  setSimulationProgress: (progress) => {
    const route = get().activeInfiltrationRoute;
    if (!route) return;

    const clamped = Math.max(0, Math.min(1, progress));
    const totalWaypoints = route.waypoints.length;
    const currIndex = Math.min(
      Math.floor(clamped * (totalWaypoints - 1)),
      totalWaypoints - 1
    );
    const currWp = route.waypoints[currIndex];

    const status = currWp?.isCoveredByInterception
      ? 'intercepted'
      : currWp?.isCoveredByRadar
      ? 'detected'
      : 'stealth';

    set({
      activeInfiltrationRoute: {
        ...route,
        currentProgress: clamped,
        status,
        currentPosition: currWp
          ? { lat: currWp.lat, lon: currWp.lon, altM: currWp.altitudeM }
          : undefined,
      },
    });
  },

  stepSimulationProgress: (deltaProgress) => {
    const route = get().activeInfiltrationRoute;
    if (!route) return;

    let nextProgress = route.currentProgress + deltaProgress;
    if (nextProgress >= 1.0) {
      nextProgress = 0; // Loop lại từ đầu
    }

    get().setSimulationProgress(nextProgress);
  },

  setIsSimulating: (isSimulating) => set({ isSimulating }),

  toggleSimulation: () => set((state) => ({ isSimulating: !state.isSimulating })),

  setSimulationSpeed: (simulationSpeedMultiplier) => set({ simulationSpeedMultiplier }),

  fetchAiSuggestions: (field) => {
    const suggestions = generateTacticalAiSuggestions(field, get().deployedUnits);
    set({ aiSuggestions: suggestions });
  },

  applyAiSuggestion: (suggestionId) => {
    const suggestion = get().aiSuggestions.find((s) => s.id === suggestionId);
    if (!suggestion) return null;

    const newUnit = get().deployUnit({
      role: suggestion.role,
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
      altitudeM: suggestion.elevationM,
      name: `Chốt AI - ${TACTICAL_UNIT_PRESETS[suggestion.role].shortName} (${suggestion.elevationM}m)`,
    });

    // Bỏ suggestion này khỏi danh sách đề xuất
    set((state) => ({
      aiSuggestions: state.aiSuggestions.filter((s) => s.id !== suggestionId),
    }));

    return newUnit;
  },

  setShowWEZDomes: (showWEZDomes) => set({ showWEZDomes }),

  resetSandbox: () => {
    set({
      deployedUnits: [],
      selectedUnitId: null,
      activePlacementRole: null,
      activeInfiltrationRoute: null,
      isSimulating: false,
      aiSuggestions: [],
    });
  },
}));
