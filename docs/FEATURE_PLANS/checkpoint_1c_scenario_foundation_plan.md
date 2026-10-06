# FEATURE PLAN: CHECKPOINT 1C — SCENARIO FOUNDATION v3.1 REVISED

## 1. EXECUTIVE SUMMARY
Checkpoint 1C v3.1 establishes the foundation for Scenario and Plan lifecycle management. The goal is to move the application from an "Implicit Scenario" state to a "Scenario-Aware" state where `activePlanId` securely dictates the context of all equipment mutations. This checkpoint strictly adheres to the 1B Canonical Storage architecture (global normalized registries) and does not introduce nested storage.

## 2. CURRENT ARCHITECTURE FINDINGS (Verified from Code)
**What already exists in code (1B status):**
- Canonical maps (`placements`, `definitions`, `observations`, `visuals`) are global normalized records in `useTacticalStore.ts`.
- `instances[]` acts solely as a compatibility projection.
- `activeScenarioId` and `activePlanId` exist in the state type but are null/unused.
- Mutations (`addEquipment`, `updateEquipment`, `removeEquipment`, `clearAll`, `importFromLayout`, `loadSampleScenario`, `updateEquipmentSpxConfig`, `setSamEngagementMode`) manipulate the global maps directly without checking any `activePlanId`.
- `parseLegacyInstance` currently uses `instanceId` as the `definitionId`.
- `removeEquipment` currently deletes the `observations` and `visuals` records tied to the placement.

**What is missing:**
- No concept of multiple active plans or switching plans.
- No `planId` field on `EquipmentPlacement` or `EquipmentDefinition`.
- No `ensureActiveWorkspace` bootstrapper.
- No guards preventing mutation on specific Plan statuses.

**What v3.1 needs to change:**
- Add `planId` to `EquipmentPlacement` and `EquipmentDefinition`.
- Change `removeEquipment` and `clearAll` to preserve historical data (`observations` and `simulations`).
- `importFromLayout` and `loadSampleScenario` must replace the Active Plan ONLY, and generate entirely new canonical Placement/Definition IDs (to not collide with historical observations).
- All 8 equipment mutations, plus clone creation, must be wrapped in an `activePlan`/`activeScenario` filter/guard.

**What must explicitly NOT change:**
- `instances[]` remains a projection.
- Canonical state remains fully normalized at the root. No nested placement objects in `Plan`.
- No persistence, AI, or backend sync added.

## 3. CANONICAL STORAGE MODEL
- **Architecture**: Normalized global registries.
  ```text
  scenarios
  plans
  placements
  definitions
  observations
  visuals
  simulationRuns
  simulations
  instances[]
  ```
- **Constraint**: DO NOT create `activeWorkingPlacements` or duplicate registries. Mutations apply directly to the canonical registries, filtered by `activePlanId`.

## 4. OWNERSHIP MODEL
- **Official Placement Ownership**: `EquipmentPlacement.planId` = REQUIRED.
- **Definition Ownership**: `EquipmentDefinition.planId` = REQUIRED. 
  - **Invariant**: `placement.planId === definition.planId`. Every Placement must resolve to a Definition with the SAME `planId`.
- **Visual Ownership**: Derived via `visuals[placementId] -> Placement.planId -> Plan`. DO NOT add `visual.planId`. Visual ownership is derived through its Placement ID; Visual cleanup must be driven by active Plan-owned Placement IDs.
- **NO Bidirectional Arrays**: Do NOT add `Scenario.planIds` or `Plan.placementIds`. All lookups are via foreign keys (`planId`).

## 5. SCENARIO LIFECYCLE
Statuses: `draft`, `active`, `archived`.
- **draft**: Setup/editing context.
- **active**: Usable operational application context.
- **archived**: Read-only.
- **Archived Guard**: `validateActiveScenarioContext()` MUST block any Plan-owned mutations if the Scenario is `archived`.
- **Lifecycle Transition Scope (1C Scope Limitation)**: 1C establishes these semantics and guards but does NOT build new UI/API commands for transitioning between these states (e.g. `activateScenario()`, `archiveScenario()`) unless currently existing in the codebase. 1C does NOT build a new lifecycle-management UI/workflow.

## 6. PLAN LIFECYCLE
Statuses: `draft`, `proposed`, `approved`.
- **draft**: Editable.
- **proposed**: Read-only / submitted for review.
- **approved**: Immutable.
To edit a proposed/approved plan, user must invoke `createPlanAlternative()` to create a new draft Plan.
- **Lifecycle Transition Scope (1C Scope Limitation)**: As with Scenarios, 1C establishes the `draft`/`proposed`/`approved` semantics and guards, but does NOT invent new lifecycle transition commands like `proposePlan()` or `approvePlan()` unless they already exist.

## 7. ACTIVE CONTEXT MODEL
- The active context is derived by filtering the canonical registries where `planId === activePlanId`.
- Mutations MUST only operate on records where `record.planId === activePlanId`.
- **Deterministic Cross-Plan Mutation Behavior**:
  - If a mutation targets a record that exists but belongs to another Plan: BLOCK, throw a deterministic ownership/context error, and do not mutate either Plan.
  - If a mutation targets a record that does not exist: throw a deterministic not-found error, and do not silently no-op.

## 8. BOOTSTRAP STRATEGY
- **`ensureActiveWorkspace()`**: Separate from 1B cutover. Idempotent bootstrap that preserves valid existing state.
- **Deterministic Rules**:
  - **CASE A — Workspace is missing**: If required Scenario/Plan does not exist, create the deterministic default Scenario/Plan.
  - **CASE B — Workspace is valid**: Preserve it exactly. Do not replace or recreate valid Scenario/Plan records.
  - **CASE C — Active IDs are missing/empty**: Resolve to the deterministic valid default workspace according to the bootstrap rules.
  - **CASE D — Active IDs point to records that do not exist**: Throw a deterministic validation/error result. Do NOT silently invent replacement IDs.
  - **CASE E — activePlanId exists but `plans[activePlanId].scenarioId !== activeScenarioId`**: Throw a deterministic validation error. Do NOT silently repair the relationship.
  - **CASE F — Existing equipment has no `planId`**: Assign it to the resolved valid default/active Plan as part of migration/bootstrap, but ONLY when the equipment is genuinely unowned and there is no conflicting ownership information.
  - **CASE G — Existing equipment already has a valid `planId`**: Preserve it. Do NOT overwrite ownership.
- *Important*: `ensureActiveWorkspace()` may bootstrap missing workspace data, but it must NOT silently auto-repair existing contradictory/corrupted references.

## 9. CLONE STRATEGY + ID REMAPPING
- **`createPlanAlternative(sourcePlanId?)`**:
  - Clones Plan, Placements, and Definitions.
  - Generates completely NEW IDs for all of them.
  - Generates new Visual configuration entries mapped to the new Placement IDs.
  - **Does NOT clone**: `ObservationState`, `SimulationState`, `SimulationRun`. (Historical data must not be duplicated into a new design proposal).
  - Explicit ID mapping: `oldId -> newId` must be maintained during the clone process to correctly hook up `Placement -> Definition` and `Visual -> Placement`.
  - **Explicit Same-Scenario Rule**: For Checkpoint 1C, clone stays within the same Scenario: `sourcePlan.scenarioId === activeScenarioId` and `newPlan.scenarioId = sourcePlan.scenarioId`. If the source Plan belongs to another Scenario, throw a deterministic error. If the source Plan does not exist, throw a deterministic not-found error.

## 10. IMPORT/LOAD IDENTITY STRATEGY
- **`importFromLayout()` / `loadSampleScenario()`**:
  - **Replace Active Plan Content**: They do NOT create a new Plan.
  - **Crucial Rule**: Imported data MUST NOT reuse historical Placement/Definition identities. Even if the imported JSON has ID `P001`, the system MUST explicitly generate a NEW canonical Placement ID (`P_new_xxx`) and Definition ID (`D_new_xxx`).
  - *Reason*: Reusing `P001` would accidentally hook the imported design to an existing historical Observation/Simulation tied to `P001`.
- **Identity Parsing vs Generation**:
  - Legacy/Canonical migration (`parseLegacyInstance`, `applyEquipmentPatchToCanonical`): MUST preserve existing identity and MUST NOT generate new IDs.
  - Clone/import/new creation: explicitly generate new canonical IDs.

## 11. IMPORT REPLACEMENT / CLEANUP
- During replacement, cleanup semantics are driven by Placement IDs:
  1. Find all Placement IDs belonging to `activePlanId`.
  2. Remove those Placements.
  3. Remove Definitions associated with those Placements.
  4. Remove Visual records keyed by those Placement IDs.
  5. Preserve historical Observations / Simulations / SimulationRuns.
- Do NOT touch other Plans.

## 12. REMOVE / CLEAR SEMANTICS
- `clearAll()` and `removeEquipment()` MUST only remove records where `planId === activePlanId`.
- Preserve other plans.
- Preserve historical `observations` and `simulations` tied to the removed placements. (Note: Current 1B implementation deletes observations during remove; this MUST be changed).

## 13. HISTORICAL DATA SEMANTICS
- Maintain the distinction: PLANNED, OBSERVED / ACTUAL, SIMULATED, PRESENTATION.
- `ObservationState` = Observed / Actual state.
- `SimulationRun` = a historical simulation execution/run.
- `SimulationState` = Simulated state produced within a SimulationRun.
- They MUST survive `removeEquipment`, `clearAll`, `importFromLayout`, `loadSampleScenario`, and `switchActivePlan`.
- Historical references to removed placements are valid historical records, not current canonical integrity violations.

## 14. APPROVED/PROPOSED/ARCHIVED GUARDS
- **Mutation Surface**: 1. `addEquipment`, 2. `updateEquipment`, 3. `removeEquipment`, 4. `clearAll`, 5. `importFromLayout`, 6. `loadSampleScenario`, 7. `updateEquipmentSpxConfig`, 8. `setSamEngagementMode`.
- **Clone Alternative Surface**: `createPlanAlternative(sourcePlanId)`
- **Validation Order for Equipment Mutations**:
  1. Validate active Scenario exists and is NOT `archived`.
  2. Validate active Plan exists and belongs to active Scenario.
  3. Validate active Plan is `draft` (not `proposed` or `approved`).
  4. Perform mutation.
- **Validation Rules for `createPlanAlternative(sourcePlanId)`**:
  - Scenario `archived` -> BLOCK deterministically.
  - Scenario `draft`/`active` -> continue.
  - Source Plan `draft`, `proposed`, `approved` -> clone allowed (cloning read-only plans is the supported editing mechanism).
  - Also required: `sourcePlan.scenarioId === activeScenarioId`, source Plan exists, invalid source Plan -> deterministic not-found error, source Plan from another Scenario -> deterministic context error.

## 15. SWITCH SEMANTICS
- **`switchActivePlan(planId)`**:
  - Switching is a context/view operation, not a mutation.
  - Plan `draft` -> switch allowed.
  - Plan `proposed` -> switch allowed.
  - Plan `approved` -> switch allowed.
  - Scenario `archived` -> switching/viewing is allowed.
  - After switching into `proposed`/`approved`/`archived` context: inspection/projection is allowed, but Plan-owned mutation remains blocked.
- **Switch Flow**:
  1. Validate target Plan exists.
  2. Validate target Scenario relationship.
  3. Validate current canonical integrity.
  4. Set `activePlanId = targetId`.
  5. Rebuild `instances[]` for target Plan.
  6. Apply one atomic Zustand `set()`.

## 16. SAVE SEMANTICS
- **`saveActivePlan()`**:
  - Validation/checkpoint boundary ONLY.
  - Validates active Scenario, Plan, ownership, references, canonical integrity, and ensures no invalid CURRENT orphans.
  - 1C save performs validation/checkpoint only; no automatic version increment.
  - **MUST NOT**: persist to backend, serialize a Plan-owned object graph, copy placements/definitions into Plan, or automatically increment version (unless an explicit existing version rule already exists).
  - **Atomicity Clarification**: Atomicity applies to `saveActivePlan()` ONLY when save actually mutates Zustand state (e.g., updating a timestamp/metadata if explicitly required by current codebase). A validation-only save performs NO state write and requires NO Zustand `set()`.

## 17. VALIDATION / INVARIANTS
- `activeScenarioId` and `activePlanId` exist.
- `plans[activePlanId].scenarioId === activeScenarioId`.
- Every current Placement has `planId`.
- Every current Definition has `planId`.
- Every Placement resolves to a valid Definition.
- `Placement.planId === Definition.planId`.
- Hydration, projection, and patching existing canonical records MUST preserve Placement/Definition identity.
- Visual ownership is derived through its Placement ID; Visual cleanup must be driven by active Plan-owned Placement IDs.
- No cross-plan Placement -> Definition reference.
- `instances[]` contains ONLY active Plan projection.

## 18. ATOMICITY REQUIREMENTS
- `switchActivePlan`, `createPlanAlternative`, `importFromLayout`, `loadSampleScenario` MUST calculate `nextState` entirely in memory and commit via a single `set()`.
- Atomicity applies to `saveActivePlan()` ONLY when save actually mutates Zustand state. A validation-only save performs NO state write.

## 19. TEST MATRIX
A. **Bootstrap**: Default Scenario/Plan created, existing equipment assigned valid `planId`.
B. **Clone Identity**: New Plan, Placement, Definition IDs; config preserved.
C. **Clone Reference Remapping**: New Placements reference new Definitions. No leakage.
D. **Clone Isolation**: Mutating Plan B does not mutate Plan A.
E. **Clone Visual Remapping**: Visual config cloned to new Placement ID.
F. **Switch**: A -> B -> A. No data loss. `instances[]` accurate.
G. **Save Semantics**: Validation runs, no object duplication.
H. **Approved Guard**: All 8 mutations blocked.
I. **Proposed Guard**: All 8 mutations blocked.
J. **Scenario Archived Guard**: All mutations blocked.
K. **Import Replacement**: Active Plan replaced, stale fragments removed, other Plans untouched.
L. **Import Identity Isolation**: Imported records get NEW identities. Historical Observations with old ID are unaffected.
M. **Remove/Clear Historical Preservation**: Deleting current placement preserves historical Observation/Simulation.
N. **Cross-Plan Isolation**: Mutations on Plan A do not delete/mutate Plan B.
O. **Ownership**: `Placement.planId` always valid.
P. **Invalid References**: Invalid `activePlanId` -> deterministic error.
Q. **Atomicity**: No intermediate state observable.
**--- NEW FOCUSED TESTS ---**
R. **Adapter identity stability**: `parseLegacyInstance()` / `hydrateLegacyInstance()` / `applyEquipmentPatchToCanonical()` do not change existing Placement/Definition IDs.
S. **Visual cleanup isolation**: Replacing Plan A removes visuals of Plan A only and preserves Plan B visuals.
T. **Cross-plan mutation rejection**: activePlan = A, target Placement belongs to B, mutation is rejected deterministically, Plan A and Plan B remain unchanged.
U. **Switch to read-only context**: Can switch to proposed/approved Plan and archived Scenario, `instances[]` projects correctly, all Plan mutations remain blocked.
V. **Same-Scenario clone enforcement**: Clone succeeds for same scenario; fails deterministically if source belongs to another scenario or is not found.
W. **Definition ownership**: `Placement.planId` must equal `Definition.planId`. Cross-plan Placement -> Definition references are rejected deterministically.
X. **Bootstrap preserves valid existing workspace**: Does not overwrite or recreate valid active Scenario/Plan.
Y. **Invalid workspace references error**: Invalid `activePlanId` / `activeScenarioId` produces deterministic validation error.
Z. **Workspace mismatch error**: Plan/Scenario mismatch produces deterministic validation error.
AA. **Legacy equipment bootstrap**: Unowned legacy equipment receives `planId` during bootstrap.
BB. **Owned equipment protection**: Already-owned equipment keeps its existing `planId` during bootstrap.
CC. **Clone from archived Scenario is blocked**: Attempting to clone when the active Scenario is archived fails deterministically.
DD. **Clone from proposed Plan in editable Scenario is allowed**: Cloning a read-only (proposed) source Plan is permitted.
EE. **Clone from approved Plan in editable Scenario is allowed**: Cloning a read-only (approved) source Plan is permitted.
FF. **Save validation-only semantics**: When no metadata mutation is required, save validates successfully without changing canonical state.

## 20. RISKS
- Forgetting `planId` filtering during cleanup, accidentally mutating another Plan.
- Stale orphan canonical fragments after import.
- Accidental identity reuse causing historical ambiguity.
- Clone reference leakage (e.g., P101 pointing to D1).
- Visual mapping leakage.
- Cleanup deleting historical records.
- `instances[]` accidentally exposing multiple Plans if filter fails.

## 21. STOP CONDITIONS
Stop planning/escalate if implementation requires:
- Large React/Cesium rewrite.
- Simulation Engine/AI rewrite.
- Assessment/Compare, Persistence, Backend Sync.
- Broad domain refactor outside Scenario Foundation.

## 22. NON-GOALS
- Implementing Simulation Engine, Target Model, Replay System, Backend Persistence, Large Scenario Editor UI.

## 23. EXACT FILES TO MODIFY
- `src/domain/types/scenario.ts`
- `src/domain/types/plan.ts`
- `src/domain/types/equipment.ts` (Add REQUIRED `planId` to Placement and Definition).
- `src/domain/adapters/legacyEquipmentAdapter.ts` (Update `parseLegacyInstance` / `applyEquipmentPatchToCanonical` to respect `planId`).
- `src/store/useTacticalStore.ts` (Core logic, Bootstrapper, 8 mutations update).

## 24. IMPLEMENTATION ORDER
1. Update Domain Types (`scenario.ts`, `plan.ts`, `equipment.ts`).
2. Update Adapter (`legacyEquipmentAdapter.ts`) to handle `planId` while strictly preserving identity during parsing.
3. Implement `ensureActiveWorkspace` & Bootstrapper in `useTacticalStore.ts`.
4. Build Core Helpers (`switchActivePlan`, `createPlanAlternative`, `saveActivePlan`, `validateActiveScenarioContext`).
5. Update all 8 Plan-owned Mutations (add guards and `planId` filters; fix `removeEquipment`/`clearAll` to preserve historical data; add cross-plan mutation blocks).
6. Fix `importFromLayout` & `loadSampleScenario` (Replace semantics + explicit ID generation for canonical identities + driven visual cleanup).
7. Update `_syncLegacyInstances` to project only Active Plan.
8. Verify Tests.

## 25. DEFINITION OF DONE
- All 8 equipment mutations, plus `createPlanAlternative`, are properly guarded by Scenario/Plan status.
- `activePlanId` dictates mutation context.
- `EquipmentPlacement.planId` and `EquipmentDefinition.planId` are both REQUIRED and strictly match.
- Clone creates 100% new IDs and enforces same-Scenario. Cloning from read-only Plans is explicitly allowed, but cloning in an archived Scenario is blocked.
- Import/Load replace active plan with explicitly generated 100% new IDs.
- Historical Observations/Simulations survive remove/clear/import/switch.
- `ensureActiveWorkspace` enforces strict deterministic validation cases without silent auto-repair of corrupt references.
- `saveActivePlan` is strictly a validation boundary unless pre-existing metadata changes demand an atomic update.
- No React/Cesium rewrites necessary.

---

### A. "Targeted changes made"
1. `createPlanAlternative()` archived Scenario guard implemented.
2. Lifecycle transition scope clarified (1C adds semantics, not new UI commands).
3. `saveActivePlan()` atomicity semantics clarified (no state write if validation only).

### B. "Remaining implementation blockers"
- None identified.

### C. "Ready for /implement-feature?"
- **YES**.
