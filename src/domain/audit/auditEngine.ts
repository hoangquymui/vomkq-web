import type {
  RevisionMetadata,
  AuditEvent,
  RevisionScope,
  AuditActor,
  AuditSourceType,
  AuditAction,
  AuditTargetType
} from '../types/audit';
import type { Scenario } from '../types/scenario';
import type { Plan } from '../types/plan';
import type { EquipmentDefinition, EquipmentPlacement, ObservationState } from '../types/equipment';
import type { SimulationRun, SimulationState } from '../types/simulation';

function deterministicStringify(obj: any): string {
  if (obj === null) return 'null';
  if (obj === undefined) return 'undefined';
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (typeof obj !== 'object') return String(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(deterministicStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => `${JSON.stringify(k)}:${deterministicStringify(obj[k])}`).join(',') + '}';
}

/**
 * Simple hash (djb2) to keep the fingerprint short and unique.
 * SECURITY WARNING: This is a non-cryptographic change-detection digest,
 * NOT a secure or tamper-proof integrity guarantee. It is used only for
 * fast UI checks and audit provenance metadata, not for cryptographic verification.
 */
export function computeHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export function revisionScopeKey(scope: RevisionScope): string {
  return `${scope.type}:${scope.id}`;
}

export function computePlanPayload(
  planId: string,
  state: {
    plans: Record<string, Plan>;
    placements: Record<string, EquipmentPlacement>;
    definitions: Record<string, EquipmentDefinition>;
    observations: Record<string, ObservationState>;
  }
): any {
  const plan = state.plans[planId];
  if (!plan) return 'empty';

  const placements = Object.values(state.placements)
    .filter(p => p.planId === planId)
    .sort((a, b) => a.id.localeCompare(b.id));

  const definitions = Object.values(state.definitions)
    .filter(d => d.planId === planId)
    .sort((a, b) => a.id.localeCompare(b.id));

  const placementIds = new Set(placements.map(p => p.id));
  const observations = Object.values(state.observations)
    .filter(o => placementIds.has(o.placementId))
    .sort((a, b) => a.placementId.localeCompare(b.placementId));

  const payload = {
    plan,
    placements,
    definitions,
    observations
  };

  return payload;
}

export function computeWorkspacePayload(
  state: {
    scenarios: Record<string, Scenario>;
    plans: Record<string, Plan>;
    placements: Record<string, EquipmentPlacement>;
    definitions: Record<string, EquipmentDefinition>;
    observations: Record<string, ObservationState>;
    simulationRuns: Record<string, SimulationRun>;
    simulations: Record<string, Record<string, SimulationState>>;
  }
): any {
  const sortById = (a: {id: string}, b: {id: string}) => a.id.localeCompare(b.id);
  const sortByPlacementId = (a: {placementId: string}, b: {placementId: string}) => a.placementId.localeCompare(b.placementId);

  const payload = {
    scenarios: Object.values(state.scenarios).sort(sortById),
    plans: Object.values(state.plans).sort(sortById),
    placements: Object.values(state.placements).sort(sortById),
    definitions: Object.values(state.definitions).sort(sortById),
    observations: Object.values(state.observations).sort(sortByPlacementId),
    simulationRuns: Object.values(state.simulationRuns).sort(sortById),
    simulations: Object.keys(state.simulations || {}).sort().map(runId => ({
      runId,
      states: Object.keys(state.simulations[runId]).sort().map(placementId => ({
        placementId,
        state: state.simulations[runId][placementId]
      }))
    }))
  };

  return payload;
}

export type AppendAuditResult = {
  revision: RevisionMetadata;
  event: AuditEvent;
} | null;

export function createAuditAppend(
  scope: RevisionScope,
  prevStateForFingerprint: any, // the store state before mutation
  nextStateForFingerprint: any, // the store state right after mutation
  revisions: Record<string, RevisionMetadata>,
  revisionHeads: Record<string, string>,
  action: AuditAction,
  targetType: AuditTargetType,
  targetIds: string[],
  actor: AuditActor,
  source: AuditSourceType,
  derivedFromRevisionId?: string | null
): AppendAuditResult {

  const scopeKey = revisionScopeKey(scope);
  const parentRevisionId = revisionHeads[scopeKey] || null;
  const parentRevision = parentRevisionId ? revisions[parentRevisionId] : null;
  const sequence = parentRevision ? parentRevision.sequence + 1 : 1;

  let prevFingerprintStr = '';
  let nextFingerprintStr = '';

  if (scope.type === 'PLAN') {
    prevFingerprintStr = deterministicStringify(computePlanPayload(scope.id, prevStateForFingerprint));
    nextFingerprintStr = deterministicStringify(computePlanPayload(scope.id, nextStateForFingerprint));
  } else if (scope.type === 'WORKSPACE') {
    prevFingerprintStr = deterministicStringify(computeWorkspacePayload(prevStateForFingerprint));
    nextFingerprintStr = deterministicStringify(computeWorkspacePayload(nextStateForFingerprint));
  } else if (scope.type === 'SCENARIO') {
    throw new Error('SCENARIO revision creation is unsupported in 1I');
  }

  // Pure data equality check based on full deterministic string representation, avoiding hash collisions.
  if (prevFingerprintStr === nextFingerprintStr && action !== 'IMPORT' && action !== 'BRANCH') {
    return null;
  }

  const fingerprint = computeHash(nextFingerprintStr);

  const revisionId = generateId('rev');
  const eventId = generateId('evt');
  const now = Date.now();

  const revision: RevisionMetadata = {
    revisionId,
    scope,
    parentRevisionId,
    derivedFromRevisionId: derivedFromRevisionId || null,
    sequence,
    createdAt: now,
    actor,
    source,
    canonicalFingerprint: fingerprint
  };

  const event: AuditEvent = {
    eventId,
    revisionId,
    timestamp: now,
    actor,
    source,
    action,
    targetType,
    targetIds
  };

  return { revision, event };
}
