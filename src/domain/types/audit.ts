/**
 * @fileoverview Defines the core domain entities for Audit and Revision.
 * Part of the Canonical Domain Model.
 */

export type RevisionScope =
  | { type: 'PLAN'; id: string }
  | { type: 'SCENARIO'; id: string }
  | { type: 'WORKSPACE'; id: 'canonical-root' };

export type AuditActorType = 'HUMAN' | 'SYSTEM' | 'UNKNOWN';
export type AuditSourceType = 'USER_ACTION' | 'SYSTEM' | 'IMPORT' | 'LEGACY_MIGRATION' | 'AI_ASSISTED';

export interface AuditActor {
  type: AuditActorType;
  id?: string;
  name?: string;
}

export interface RevisionMetadata {
  revisionId: string;
  scope: RevisionScope;
  parentRevisionId: string | null;
  derivedFromRevisionId?: string | null; // For Plan Alternatives branching
  sequence: number;
  createdAt: number;
  actor: AuditActor;
  source: AuditSourceType;
  reason?: string;
  canonicalFingerprint: string;
}

export type AuditAction =
  | 'ADD'
  | 'UPDATE'
  | 'REMOVE'
  | 'CLEAR_ALL'
  | 'IMPORT'
  | 'BRANCH'
  | 'OPERATIONAL_CHANGE'
  | 'WITHDRAW'
  | 'ARCHIVE'
  | 'RESTORE'
  | 'TRASH';
export type AuditTargetType = 'EQUIPMENT' | 'PLAN' | 'SCENARIO' | 'WORKSPACE';

export interface AuditEvent {
  eventId: string;
  revisionId: string;
  timestamp: number;
  actor: AuditActor;
  source: AuditSourceType;
  action: AuditAction;
  targetType: AuditTargetType;
  targetIds: string[];
  reason?: string;
  metadata?: Record<string, unknown>;
}
