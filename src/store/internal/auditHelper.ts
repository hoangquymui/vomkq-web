import type {
  RevisionScope,
  AuditAction,
  AuditTargetType,
  AuditActorType,
  AuditSourceType,
  AuditActor,
  RevisionMetadata,
  AuditEvent,
} from '../../domain/types/audit';
import { createAuditAppend, revisionScopeKey } from '../../domain/audit/auditEngine';
import type { TacticalState } from '../types';

export interface AuditAppendResult {
  revisions?: Record<string, RevisionMetadata>;
  revisionHeads?: Record<string, string>;
  auditEvents?: Record<string, AuditEvent>;
  auditEventOrder?: string[];
}

export function appendAuditToState(
  state: TacticalState | Record<string, any>,
  nextStateMap: Partial<TacticalState> | Record<string, any>,
  scope: RevisionScope,
  action: AuditAction,
  targetType: AuditTargetType,
  targetIds: string[],
  actorType: AuditActorType = 'HUMAN',
  sourceType: AuditSourceType = 'USER_ACTION',
  derivedFromRevisionId: string | null = null,
  reason?: string
): AuditAppendResult {
  const prevStateForFingerprint = {
    scenarios: state.scenarios,
    plans: state.plans,
    placements: state.placements,
    definitions: state.definitions,
    observations: state.observations,
    simulationRuns: state.simulationRuns,
    simulations: state.simulations,
  };

  const nextStateForFingerprint = {
    scenarios: nextStateMap.scenarios || state.scenarios,
    plans: nextStateMap.plans || state.plans,
    placements: nextStateMap.placements || state.placements,
    definitions: nextStateMap.definitions || state.definitions,
    observations: nextStateMap.observations || state.observations,
    simulationRuns: nextStateMap.simulationRuns || state.simulationRuns,
    simulations: nextStateMap.simulations || state.simulations,
  };

  const actor: AuditActor = { type: actorType };

  const result = createAuditAppend(
    scope,
    prevStateForFingerprint,
    nextStateForFingerprint,
    nextStateMap.revisions || state.revisions,
    nextStateMap.revisionHeads || state.revisionHeads,
    action,
    targetType,
    targetIds,
    actor,
    sourceType,
    derivedFromRevisionId,
    reason
  );

  if (!result) return {};

  const { revision, event } = result;

  return {
    revisions: { ...(nextStateMap.revisions || state.revisions), [revision.revisionId]: revision },
    revisionHeads: {
      ...(nextStateMap.revisionHeads || state.revisionHeads),
      [revisionScopeKey(scope)]: revision.revisionId,
    },
    auditEvents: { ...(nextStateMap.auditEvents || state.auditEvents), [event.eventId]: event },
    auditEventOrder: [...(nextStateMap.auditEventOrder || state.auditEventOrder), event.eventId],
  };
}
