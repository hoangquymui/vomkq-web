/**
 * @fileoverview Defines the Scenario context for the simulation.
 * A Scenario is the overarching context under which multiple Plans (alternatives) can exist.
 * This file is part of the Canonical Domain Model (Single Source of Truth).
 */

export interface Scenario {
  id: string;
  name: string;
  terrainVersion: string;
  createdAt: number;
  status: 'draft' | 'active' | 'archived';
}
