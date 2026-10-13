import type { Scenario } from '../types/scenario';
import type { Plan } from '../types/plan';
import type { EquipmentDefinition, EquipmentPlacement, ObservationState } from '../types/equipment';
import type { LegacyPresentationState } from '../adapters/legacyEquipmentAdapter';

/**
 * Narrow context interface containing strictly the fields required
 * to validate mutations on active Plan and Scenario.
 */
export interface MutationGuardContext {
  activeScenarioId: string | null;
  activePlanId: string | null;
  scenarios: Record<string, Scenario>;
  plans: Record<string, Plan>;
}

/**
 * Narrow context interface containing strictly the fields required
 * to validate consistency of a Plan's entity graph.
 */
export interface PlanGraphValidationContext {
  scenarios: Record<string, Scenario>;
  plans: Record<string, Plan>;
  placements: Record<string, EquipmentPlacement>;
  definitions: Record<string, EquipmentDefinition>;
  observations: Record<string, ObservationState>;
  visuals: Record<string, LegacyPresentationState>;
}

export function validateMutationGuard(state: MutationGuardContext): void {
  if (!state.activeScenarioId) throw new Error('No active scenario');
  const scenario = state.scenarios[state.activeScenarioId];
  if (!scenario) throw new Error('Active scenario does not exist');
  if (scenario.status === 'archived') throw new Error('Scenario is archived');
  if (scenario.status === 'trashed') throw new Error('Scenario is trashed');

  if (!state.activePlanId) throw new Error('No active plan');
  const plan = state.plans[state.activePlanId];
  if (!plan) throw new Error('Active plan does not exist');

  if (plan.scenarioId !== state.activeScenarioId) throw new Error('Plan does not belong to active scenario');
  if (plan.status !== 'draft') throw new Error('Active plan is not draft');
}

export function validatePlanGraph(state: PlanGraphValidationContext, planId: string): void {
  const plan = state.plans[planId];
  if (!plan) throw new Error(`validatePlanGraph: Target plan does not exist`);

  // A/B: Plan/Scenario context
  const scenario = state.scenarios[plan.scenarioId];
  if (!scenario) throw new Error(`validatePlanGraph: Plan references missing scenario ${plan.scenarioId}`);

  // C: Placement ownership — also catch missing/undefined planId fields
  for (const p of Object.values(state.placements)) {
    if (p.planId === planId) {
      if (!p.definitionId) throw new Error(`validatePlanGraph: Placement ${p.id} missing definitionId`);
      const def = state.definitions[p.definitionId];
      if (!def) throw new Error(`validatePlanGraph: Placement ${p.id} references missing definition`);
      // Catch missing planId on definition or cross-plan reference
      if (!def.planId) throw new Error(`validatePlanGraph: Definition ${def.id} has no planId`);
      if (def.planId !== planId) throw new Error(`validatePlanGraph: Placement ${p.id} references cross-plan definition (def.planId=${def.planId})`);
      const obs = state.observations[p.id];
      if (!obs) throw new Error(`validatePlanGraph: Placement ${p.id} missing current Observation`);
      const vis = state.visuals[p.id];
      if (!vis) throw new Error(`validatePlanGraph: Placement ${p.id} references missing visual`);

      // F: Network reference integrity
      if (p.network?.commandedBy) {
        const commandedBy = p.network.commandedBy;
        const refPlacement = state.placements[commandedBy];
        if (!refPlacement) throw new Error(`validatePlanGraph: Placement ${p.id} commandedBy references missing Placement ${commandedBy}`);
        if (refPlacement.planId !== planId) throw new Error(`validatePlanGraph: Placement ${p.id} commandedBy cross-plan reference (target planId=${refPlacement.planId})`);
      }
    }
    // C: Also catch Placements with missing/undefined planId that reference definitions of this plan
    if (!p.planId) {
      if (p.definitionId && state.definitions[p.definitionId]?.planId === planId) {
        throw new Error(`validatePlanGraph: Placement ${p.id} has no planId but its Definition belongs to plan ${planId}`);
      }
    }
  }

  // D: Definition ownership — orphan check
  for (const d of Object.values(state.definitions)) {
    if (d.planId === planId) {
      const hasRef = Object.values(state.placements).some(p => p.planId === planId && p.definitionId === d.id);
      if (!hasRef) throw new Error(`validatePlanGraph: Orphan definition ${d.id} in plan ${planId}`);
    }
  }

  // E: Global Visual Orphan Check
  // We enforce the global invariant: every visuals key must correspond to an existing Placement
  for (const vId of Object.keys(state.visuals)) {
    if (!state.placements[vId]) {
      throw new Error(`validatePlanGraph: Orphan visual ${vId} (no corresponding Placement)`);
    }
  }
}
