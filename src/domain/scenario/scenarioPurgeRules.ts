import type { Scenario } from '../types/scenario';
import type { Plan } from '../types/plan';
import type { SimulationRun } from '../types/simulation';
import type { EquipmentPlacement } from '../types/equipment';

/**
 * Narrow context interface containing strictly the fields required
 * to evaluate whether a Scenario is eligible for permanent purge.
 */
export interface ScenarioPurgeContext {
  scenarios: Record<string, Scenario>;
  plans: Record<string, Plan>;
  simulationRuns: Record<string, SimulationRun>;
  placements: Record<string, EquipmentPlacement>;
}

export function isScenarioEligibleForPurge(
  state: ScenarioPurgeContext,
  scenarioId: string
): { eligible: boolean; reason?: string } {
  const scenario = state.scenarios[scenarioId];
  if (!scenario) return { eligible: false, reason: 'Kịch bản không tồn tại' };
  if (scenario.status !== 'trashed') {
    return { eligible: false, reason: 'Chỉ có thể xóa vĩnh viễn kịch bản đang trong Thùng rác' };
  }
  const hasRuns = Object.values(state.simulationRuns).some((r) => r.scenarioId === scenarioId);
  if (hasRuns) {
    return {
      eligible: false,
      reason: 'Kịch bản đang được liên kết với kết quả mô phỏng (SimulationRun). Vui lòng sử dụng Lưu trữ.',
    };
  }
  const childPlans = Object.values(state.plans).filter((p) => p.scenarioId === scenarioId);
  const childPlanIds = new Set(childPlans.map((p) => p.id));

  // Kiểm tra khí tài trong kịch bản có bị khí tài thuộc kịch bản khác tham chiếu chỉ huy hay không
  const scenarioPlacementIds = new Set(
    Object.values(state.placements)
      .filter((p) => childPlanIds.has(p.planId))
      .map((p) => p.id)
  );
  const referencedByOtherPlacement = Object.values(state.placements).some(
    (p) => !childPlanIds.has(p.planId) && p.network?.commandedBy && scenarioPlacementIds.has(p.network.commandedBy)
  );
  if (referencedByOtherPlacement) {
    return {
      eligible: false,
      reason: 'Khí tài trong kịch bản đang được liên kết chỉ huy bởi khí tài thuộc kịch bản khác',
    };
  }

  for (const childPlan of childPlans) {
    if (
      childPlan.status === 'proposed' ||
      childPlan.status === 'approved' ||
      childPlan.status === 'withdrawn' ||
      childPlan.status === 'archived'
    ) {
      return {
        eligible: false,
        reason: `Kịch bản chứa phương án "${childPlan.name}" ở trạng thái ${childPlan.status}. Vui lòng sử dụng Lưu trữ.`,
      };
    }
    if (childPlan.withdrawnAt || childPlan.withdrawnReason) {
      return {
        eligible: false,
        reason: `Kịch bản chứa phương án "${childPlan.name}" đã từng thu hồi trong lịch sử.`,
      };
    }
    if (childPlan.baseRevisionPlanId) {
      return {
        eligible: false,
        reason: `Kịch bản chứa phương án "${childPlan.name}" có liên kết bản sửa đổi.`,
      };
    }
    const hasExternalDependent = Object.values(state.plans).some(
      (p) => p.scenarioId !== scenarioId && p.baseRevisionPlanId === childPlan.id
    );
    if (hasExternalDependent) {
      return {
        eligible: false,
        reason: `Kịch bản chứa phương án "${childPlan.name}" là gốc của phương án thuộc kịch bản khác.`,
      };
    }
    const hasPlanRuns = Object.values(state.simulationRuns).some((r) => r.planId === childPlan.id);
    if (hasPlanRuns) {
      return {
        eligible: false,
        reason: `Kịch bản chứa phương án "${childPlan.name}" có kết quả mô phỏng.`,
      };
    }
  }
  return { eligible: true };
}
