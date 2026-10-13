import type { Plan } from '../types/plan';
import type { Scenario } from '../types/scenario';
import type { SimulationRun } from '../types/simulation';
import type { EquipmentPlacement } from '../types/equipment';

/**
 * Narrow context interface containing strictly the fields required
 * to evaluate whether a Plan is eligible for permanent purge.
 */
export interface PlanPurgeContext {
  plans: Record<string, Plan>;
  scenarios: Record<string, Scenario>;
  simulationRuns: Record<string, SimulationRun>;
  placements: Record<string, EquipmentPlacement>;
}

export function isPlanEligibleForPurge(
  state: PlanPurgeContext,
  planId: string
): { eligible: boolean; reason?: string } {
  const plan = state.plans[planId];
  if (!plan) return { eligible: false, reason: 'Phương án không tồn tại' };
  if (plan.status !== 'trashed') {
    return { eligible: false, reason: 'Chỉ có thể xóa vĩnh viễn phương án đang trong Thùng rác' };
  }
  if (plan.withdrawnAt || plan.withdrawnReason) {
    return { eligible: false, reason: 'Phương án đã từng được đề xuất hoặc thu hồi trong lịch sử, không thể xóa' };
  }
  if (
    plan.archivedFromStatus === 'proposed' ||
    plan.archivedFromStatus === 'approved' ||
    plan.archivedFromStatus === 'withdrawn'
  ) {
    return { eligible: false, reason: 'Phương án có nguồn gốc trạng thái đã trình xét duyệt, không thể xóa' };
  }
  if (plan.baseRevisionPlanId) {
    return { eligible: false, reason: 'Phương án là bản sửa đổi phụ thuộc vào phương án khác' };
  }
  const hasDependentRevisions = Object.values(state.plans).some((p) => p.baseRevisionPlanId === planId);
  if (hasDependentRevisions) {
    return { eligible: false, reason: 'Phương án đang là gốc của các bản sửa đổi khác' };
  }
  const hasRuns = Object.values(state.simulationRuns).some((r) => r.planId === planId);
  if (hasRuns) {
    return { eligible: false, reason: 'Phương án đang được liên kết với kết quả mô phỏng (SimulationRun)' };
  }
  const planPlacementIds = new Set(
    Object.values(state.placements)
      .filter((p) => p.planId === planId)
      .map((p) => p.id)
  );
  const referencedByOtherPlan = Object.values(state.placements).some(
    (p) => p.planId !== planId && p.network?.commandedBy && planPlacementIds.has(p.network.commandedBy)
  );
  if (referencedByOtherPlan) {
    return { eligible: false, reason: 'Khí tài trong phương án đang được liên kết chỉ huy bởi phương án khác' };
  }
  return { eligible: true };
}
