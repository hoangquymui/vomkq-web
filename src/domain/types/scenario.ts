/**
 * @fileoverview Defines the Scenario context for the simulation.
 * A Scenario is the overarching context under which multiple Plans (alternatives) can exist.
 * This file is part of the Canonical Domain Model (Single Source of Truth).
 */

export type ScenarioStatus = 'draft' | 'active' | 'archived' | 'trashed';

export interface Scenario {
  id: string;
  name: string;
  terrainVersion: string;
  createdAt: number;
  status: ScenarioStatus;
  archivedAt?: number;
  trashedAt?: number;
}

export const SCENARIO_STATUS_LABELS: Record<ScenarioStatus, string> = {
  draft: 'Bản nháp',
  active: 'Đang hoạt động',
  archived: 'Đã lưu trữ',
  trashed: 'Trong thùng rác',
};
