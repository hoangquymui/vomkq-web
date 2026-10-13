import type { StoreSet, StoreGet, TacticalState } from '../types';
import type { EquipmentTemplate } from '../../types/equipment';
import { EQUIPMENT_TEMPLATES } from '../../data/equipmentTemplates';
import { checkVectorAiHealth, askVectorAi } from '../../services/vectorAiClient';
import {
  buildPlacementMessages,
  deriveAdvisorRadiusKm,
  getAdvisorViewport,
  parsePlacementAdvice,
  type AiPlacementContext,
} from '../../utils/aiPlacementAdvisor';
import { createEquipmentFromTemplate } from '../../utils/equipmentFactory';
import { selectActiveEquipment } from '../selectors/equipmentSelectors';

/**
 * Chọn template khí tài cho cố vấn AI theo thứ tự ưu tiên:
 * aiAdvisorTemplateId -> template của khí tài đang chọn -> template đang chờ đặt -> template đầu tiên.
 */
export function resolveAdvisorTemplate(state: TacticalState): EquipmentTemplate {
  const byId = state.aiAdvisorTemplateId
    ? EQUIPMENT_TEMPLATES.find((t) => t.id === state.aiAdvisorTemplateId)
    : undefined;
  if (byId) return byId;

  const activeInstances = selectActiveEquipment(state);
  const selected = activeInstances.find((i) => i.instanceId === state.selectedInstanceId);
  const fromSelected = selected
    ? EQUIPMENT_TEMPLATES.find((t) => t.id === selected.templateId)
    : undefined;
  if (fromSelected) return fromSelected;

  if (state.pendingTemplate) return state.pendingTemplate;
  return EQUIPMENT_TEMPLATES[0];
}

export interface AiAdvisorSlice {
  setAiAdvisorPanelOpen: (open: boolean) => void;
  toggleAiAdvisorPanel: () => void;
  setAiAdvisorTemplateId: (templateId: string | null) => void;
  clearAiPlacementSuggestions: () => void;
  runAiPlacementAnalysis: (model: string) => Promise<void>;
  placeEquipmentAtSuggestion: (index: number) => void;
}

export const createAiAdvisorSlice = (
  set: StoreSet,
  get: StoreGet
): AiAdvisorSlice => ({
  setAiAdvisorPanelOpen: (open) => set({ aiAdvisorPanelOpen: open }),
  toggleAiAdvisorPanel: () =>
    set((state) => ({ aiAdvisorPanelOpen: !state.aiAdvisorPanelOpen })),
  setAiAdvisorTemplateId: (templateId) => set({ aiAdvisorTemplateId: templateId }),

  clearAiPlacementSuggestions: () =>
    set({
      aiAdvisorSuggestions: [],
      aiAdvisorRoute: [],
      aiAdvisorSummary: '',
      aiAdvisorError: null,
      aiAdvisorStatus: 'idle',
    }),

  runAiPlacementAnalysis: async (model) => {
    const state = get();
    const reqScenarioId = state.activeScenarioId;
    const reqPlanId = state.activePlanId;
    const reqGen = state.workspaceContextGeneration;
    const isStale = () => {
      const now = get();
      return (
        now.workspaceContextGeneration !== reqGen ||
        now.activePlanId !== reqPlanId ||
        now.activeScenarioId !== reqScenarioId
      );
    };
    const template = resolveAdvisorTemplate(state);

    set({ aiAdvisorTemplateId: template.id, aiAdvisorStatus: 'checking', aiAdvisorError: null });

    const health = await checkVectorAiHealth();
    if (isStale()) return;
    if (!health.ok) {
      const isOffline = health.error.kind === 'offline' || health.error.kind === 'timeout';
      set({
        aiAdvisorStatus: isOffline ? 'offline' : 'error',
        aiAdvisorError: health.error.message,
      });
      return;
    }

    const viewport = getAdvisorViewport();
    const context: AiPlacementContext = {
      equipment: {
        templateId: template.id,
        name: template.name,
        category: template.categoryNameVi || template.category,
        rangeKm: template.defaultRangeKm,
        minElevationDeg: template.minElevationDeg,
        maxElevationDeg: template.maxElevationDeg,
        coverageHeightKm: template.coverageHeightKm,
        antennaHeightAGL: template.antennaHeightAGL,
      },
      placed: selectActiveEquipment(state).map((item) => ({
        shortId: item.shortId,
        name: item.name,
        category: item.category,
        latitude: item.latitude,
        longitude: item.longitude,
        altitude: item.altitude,
        rangeKm: item.rangeKm,
        status: item.status,
      })),
      viewport,
      areaRadiusKm: deriveAdvisorRadiusKm(viewport.heightM),
    };

    set({ aiAdvisorStatus: 'thinking' });

    const answer = await askVectorAi({
      model,
      messages: buildPlacementMessages(context),
    });
    if (isStale()) return;
    if (!answer.ok) {
      set({
        aiAdvisorStatus:
          answer.error.kind === 'offline' || answer.error.kind === 'timeout' ? 'offline' : 'error',
        aiAdvisorError: answer.error.message,
      });
      return;
    }

    const parsed = parsePlacementAdvice(answer.value.text);
    if (!parsed.ok) {
      set({ aiAdvisorStatus: 'error', aiAdvisorError: parsed.message });
      return;
    }

    if (isStale()) return;
    set({
      aiAdvisorStatus: 'ready',
      aiAdvisorError: null,
      aiAdvisorSummary: parsed.value.summary,
      aiAdvisorSuggestions: parsed.value.suggestions,
      aiAdvisorRoute: parsed.value.route,
    });
  },

  placeEquipmentAtSuggestion: (index) => {
    const state = get();
    const suggestion = state.aiAdvisorSuggestions[index];
    if (!suggestion) return;
    if (!Number.isFinite(suggestion.latitude) || !Number.isFinite(suggestion.longitude)) return;

    const template = resolveAdvisorTemplate(state);
    const latitude = Math.min(90, Math.max(-90, suggestion.latitude));
    const longitude = Math.min(180, Math.max(-180, suggestion.longitude));

    const instance = createEquipmentFromTemplate(template, {
      latitude: Number(latitude.toFixed(5)),
      longitude: Number(longitude.toFixed(5)),
      altitude: 0,
      nameIndex: selectActiveEquipment(state).length + 1,
    });

    get().addEquipment(instance);
  },
});
