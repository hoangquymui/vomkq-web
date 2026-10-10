/**
 * @fileoverview Defines the Plan, which is a specific versioned proposal
 * of equipment placements within a Scenario.
 */
export type PlanStatus = 'draft' | 'proposed' | 'approved' | 'withdrawn' | 'trashed' | 'archived';

export interface Plan {
  id: string;
  scenarioId: string;
  version: number;
  name: string;
  status: PlanStatus;
  /** Identity grouping all revisions of the same alternative candidate */
  alternativeId?: string;
  /** Monotonic revision number within that alternative (r1, r2, ...) */
  revisionNumber?: number;
  /** ID of previous submitted revision if created via withdrawal or amendment */
  baseRevisionPlanId?: string | null;
  withdrawnAt?: number;
  withdrawnReason?: string;
  trashedAt?: number;
  archivedAt?: number;
  archivedFromStatus?: PlanStatus;
}

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  draft: 'Bản nháp',
  proposed: 'Đã đề xuất',
  approved: 'Đã phê duyệt',
  withdrawn: 'Đã thu hồi',
  archived: 'Đã lưu trữ',
  trashed: 'Trong thùng rác',
};
