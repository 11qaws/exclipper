export const BROADCAST_CONTEXT_PHASE_LEDGER_SCHEMA_VERSION = "3.0.0";

export const BROADCAST_CONTEXT_PHASE_LEDGER_PHASES = [
  "discovery",
  "jury",
  "refinement",
] as const;

export const BROADCAST_CONTEXT_PHASE_LEDGER_STATUSES = [
  "pending",
  "in-flight",
  "reconciling",
  "succeeded",
  "retryable-gap",
  "outcome-unknown",
  "failed",
] as const;

const MAX_LEDGER_UNITS = 4_096;
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 100_000;
const MAX_JSON_STRING_LENGTH = 1_000_000;

export type BroadcastContextPhaseLedgerPhase =
  (typeof BROADCAST_CONTEXT_PHASE_LEDGER_PHASES)[number];

export type BroadcastContextPhaseLedgerStatus =
  (typeof BROADCAST_CONTEXT_PHASE_LEDGER_STATUSES)[number];

export type BroadcastContextPhaseLedgerJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly BroadcastContextPhaseLedgerJsonValue[]
  | {
      readonly [key: string]: BroadcastContextPhaseLedgerJsonValue;
    };

export type BroadcastContextPhaseLedgerModelReceipt = Readonly<
  Record<string, BroadcastContextPhaseLedgerJsonValue>
>;

export interface BroadcastContextPhaseLedgerFence {
  readonly parentContextSignature: string;
  readonly transcriptSignature: string;
  readonly groundingSignature: string;
}

interface BroadcastContextPhaseLedgerUnitBase {
  readonly phase: BroadcastContextPhaseLedgerPhase;
  readonly unitId: string;
  readonly inputDigest: string;
  readonly operationId: string;
  readonly attemptOrdinal: number;
  readonly required: boolean;
}

export type BroadcastContextPhaseLedgerUnit =
  | (BroadcastContextPhaseLedgerUnitBase & {
      readonly status: "pending" | "in-flight" | "reconciling";
    })
  | (BroadcastContextPhaseLedgerUnitBase & {
      readonly status: "succeeded";
      readonly result?: BroadcastContextPhaseLedgerJsonValue;
      readonly modelReceipt?: BroadcastContextPhaseLedgerModelReceipt;
    })
  | (BroadcastContextPhaseLedgerUnitBase & {
      readonly status: "retryable-gap";
      readonly reasonCode: string;
      readonly modelReceipt?: BroadcastContextPhaseLedgerModelReceipt;
    })
  | (BroadcastContextPhaseLedgerUnitBase & {
      readonly status: "outcome-unknown";
      readonly reasonCode: string;
      readonly modelReceipt?: BroadcastContextPhaseLedgerModelReceipt;
    })
  | (BroadcastContextPhaseLedgerUnitBase & {
      readonly status: "failed";
      readonly reasonCode: string;
      readonly modelReceipt?: BroadcastContextPhaseLedgerModelReceipt;
    });

export type BroadcastContextPhaseLedgerRetryableUnit = Extract<
  BroadcastContextPhaseLedgerUnit,
  { readonly status: "retryable-gap" }
>;

export interface BroadcastContextPhaseLedger {
  readonly schemaVersion: typeof BROADCAST_CONTEXT_PHASE_LEDGER_SCHEMA_VERSION;
  readonly fence: BroadcastContextPhaseLedgerFence;
  readonly units: readonly BroadcastContextPhaseLedgerUnit[];
  /**
   * The exact operation identity currently assigned to every unit.
   *
   * Retired IDs are deliberately not accumulated. Internal callers create IDs
   * from monotonically increasing attempt + generation fences, so a retired
   * identity cannot be regenerated and ledger storage stays O(unit count).
   */
  readonly usedOperationIds: readonly string[];
}

export interface BroadcastContextPhaseLedgerPlannedUnit {
  readonly phase: BroadcastContextPhaseLedgerPhase;
  readonly unitId: string;
  readonly inputDigest: string;
  readonly operationId: string;
  readonly attemptOrdinal: number;
  readonly required: boolean;
}

export interface CreateBroadcastContextPhaseLedgerInput {
  readonly fence: BroadcastContextPhaseLedgerFence;
  readonly units: readonly BroadcastContextPhaseLedgerPlannedUnit[];
}

export interface BroadcastContextPhaseLedgerUnitIdentity {
  readonly fence: BroadcastContextPhaseLedgerFence;
  readonly phase: BroadcastContextPhaseLedgerPhase;
  readonly unitId: string;
  readonly inputDigest: string;
  readonly operationId: string;
  readonly attemptOrdinal: number;
}

export type BroadcastContextPhaseLedgerEvent =
  | (BroadcastContextPhaseLedgerUnitIdentity & {
      readonly type: "UNIT_STARTED";
    })
  | (BroadcastContextPhaseLedgerUnitIdentity & {
      /**
       * A recovery query/replay is safe only for the exact existing operation.
       * Persist this state before contacting the coordinator so a second crash
       * can never allocate a replacement billing identity.
       */
      readonly type: "UNIT_RECONCILIATION_STARTED";
    })
  | (BroadcastContextPhaseLedgerUnitIdentity & {
      readonly type: "UNIT_SUCCEEDED" | "UNIT_RECONCILIATION_SUCCEEDED";
      readonly result?: unknown;
      readonly modelReceipt?: unknown;
    })
  | (BroadcastContextPhaseLedgerUnitIdentity & {
      readonly type:
        | "UNIT_RETRYABLE_GAP"
        | "UNIT_OUTCOME_UNKNOWN"
        | "UNIT_FAILED"
        | "UNIT_RECONCILIATION_NOT_DISPATCHED"
        | "UNIT_RECONCILIATION_UNRESOLVED";
      readonly reasonCode: string;
      readonly modelReceipt?: unknown;
    })
  | (BroadcastContextPhaseLedgerUnitIdentity & {
      readonly type: "UNIT_RETRY_PLANNED";
      readonly nextOperationId: string;
    })
  | (BroadcastContextPhaseLedgerUnitIdentity & {
      /**
       * This event may only be emitted after an editor explicitly requests a
       * retry. It is deliberately separate from automatic repair because the
       * previous provider operation may already have been billed.
       */
      readonly type: "UNIT_OUTCOME_UNKNOWN_RETRY_CONFIRMED";
      readonly nextOperationId: string;
      readonly confirmationId: string;
    });

export type BroadcastContextPhaseLedgerRejectionReason =
  | "parent_context_signature_mismatch"
  | "transcript_signature_mismatch"
  | "grounding_signature_mismatch"
  | "unit_not_found"
  | "input_digest_mismatch"
  | "operation_id_mismatch"
  | "attempt_ordinal_mismatch"
  | "undefined_transition"
  | "invalid_result"
  | "invalid_model_receipt"
  | "invalid_reason_code"
  | "invalid_operation_id"
  | "invalid_confirmation_id"
  | "operation_id_reused"
  | "attempt_ordinal_overflow";

export type BroadcastContextPhaseLedgerTransitionOutcome =
  | {
      readonly accepted: true;
      readonly ledger: BroadcastContextPhaseLedger;
    }
  | {
      readonly accepted: false;
      readonly ledger: BroadcastContextPhaseLedger;
      readonly reason: BroadcastContextPhaseLedgerRejectionReason;
    };

export interface BroadcastContextPhaseLedgerSummary {
  readonly totalCount: number;
  readonly requiredCount: number;
  readonly requiredSucceededCount: number;
  readonly pendingCount: number;
  readonly inFlightCount: number;
  readonly reconcilingCount: number;
  readonly succeededCount: number;
  readonly retryableGapCount: number;
  readonly outcomeUnknownCount: number;
  readonly failedCount: number;
  readonly complete: boolean;
}

export interface ReplanBroadcastContextPhaseLedgerAfterEditorRetryInput {
  readonly confirmationId: string;
  readonly nextOperationId: (
    unit: BroadcastContextPhaseLedgerUnit,
  ) => string;
}

const INVALID_JSON = Symbol("invalid-ledger-json");
type InvalidJson = typeof INVALID_JSON;

interface JsonBudget {
  remainingNodes: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

function normalizeIdentifier(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    value.trim() !== value ||
    containsControlCharacter(value)
  ) {
    return null;
  }
  return value;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

function normalizeJsonValue(
  value: unknown,
  depth: number,
  budget: JsonBudget,
): BroadcastContextPhaseLedgerJsonValue | InvalidJson {
  budget.remainingNodes -= 1;
  if (budget.remainingNodes < 0 || depth > MAX_JSON_DEPTH) {
    return INVALID_JSON;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return INVALID_JSON;
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "string") {
    return value.length <= MAX_JSON_STRING_LENGTH ? value : INVALID_JSON;
  }
  if (Array.isArray(value)) {
    const normalized: BroadcastContextPhaseLedgerJsonValue[] = [];
    for (const entry of value) {
      const normalizedEntry = normalizeJsonValue(entry, depth + 1, budget);
      if (normalizedEntry === INVALID_JSON) return INVALID_JSON;
      normalized.push(normalizedEntry);
    }
    return Object.freeze(normalized);
  }
  if (!isPlainObject(value)) return INVALID_JSON;

  const normalized: Record<string, BroadcastContextPhaseLedgerJsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    if (
      key.length === 0 ||
      key.length > MAX_IDENTIFIER_LENGTH ||
      containsControlCharacter(key) ||
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype"
    ) {
      return INVALID_JSON;
    }
    const normalizedEntry = normalizeJsonValue(
      value[key],
      depth + 1,
      budget,
    );
    if (normalizedEntry === INVALID_JSON) return INVALID_JSON;
    normalized[key] = normalizedEntry;
  }
  return Object.freeze(normalized);
}

function normalizeModelReceipt(
  value: unknown,
): BroadcastContextPhaseLedgerModelReceipt | null {
  if (!isPlainObject(value) || Object.keys(value).length === 0) return null;
  const normalized = normalizeJsonValue(value, 0, {
    remainingNodes: MAX_JSON_NODES,
  });
  if (normalized === INVALID_JSON || !isPlainObject(normalized)) {
    return null;
  }
  return normalized;
}

export function serializeBroadcastContextLedgerJsonValue(
  value: unknown,
): string {
  const normalized = normalizeJsonValue(value, 0, {
    remainingNodes: MAX_JSON_NODES,
  });
  if (normalized === INVALID_JSON) {
    throw new TypeError("Broadcast context ledger JSON value is invalid.");
  }
  return JSON.stringify(normalized);
}

function normalizeFence(
  value: unknown,
): BroadcastContextPhaseLedgerFence | null {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "parentContextSignature",
      "transcriptSignature",
      "groundingSignature",
    ])
  ) {
    return null;
  }
  const parentContextSignature = normalizeIdentifier(
    value.parentContextSignature,
  );
  const transcriptSignature = normalizeIdentifier(value.transcriptSignature);
  const groundingSignature = normalizeIdentifier(value.groundingSignature);
  if (
    parentContextSignature === null ||
    transcriptSignature === null ||
    groundingSignature === null
  ) {
    return null;
  }
  return Object.freeze({
    parentContextSignature,
    transcriptSignature,
    groundingSignature,
  });
}

function isPhase(value: unknown): value is BroadcastContextPhaseLedgerPhase {
  return (
    typeof value === "string" &&
    BROADCAST_CONTEXT_PHASE_LEDGER_PHASES.some((phase) => phase === value)
  );
}

function isStatus(value: unknown): value is BroadcastContextPhaseLedgerStatus {
  return (
    typeof value === "string" &&
    BROADCAST_CONTEXT_PHASE_LEDGER_STATUSES.some((status) => status === value)
  );
}

function normalizeUnit(
  value: unknown,
): BroadcastContextPhaseLedgerUnit | null {
  if (!isPlainObject(value) || !isStatus(value.status)) return null;

  const baseKeys = [
    "phase",
    "unitId",
    "inputDigest",
    "operationId",
    "attemptOrdinal",
    "required",
    "status",
  ] as const;
  const status = value.status;
  if (
    (status === "pending" ||
      status === "in-flight" ||
      status === "reconciling") &&
    !hasExactKeys(value, baseKeys)
  ) {
    return null;
  }
  if (
    status === "succeeded" &&
    !hasExactKeys(value, baseKeys, ["result", "modelReceipt"])
  ) {
    return null;
  }
  if (
    (status === "retryable-gap" ||
      status === "outcome-unknown" ||
      status === "failed") &&
    !hasExactKeys(value, [...baseKeys, "reasonCode"], ["modelReceipt"])
  ) {
    return null;
  }

  const unitId = normalizeIdentifier(value.unitId);
  const inputDigest = normalizeIdentifier(value.inputDigest);
  const operationId = normalizeIdentifier(value.operationId);
  if (
    !isPhase(value.phase) ||
    unitId === null ||
    inputDigest === null ||
    operationId === null ||
    !Number.isSafeInteger(value.attemptOrdinal) ||
    (value.attemptOrdinal as number) < 0 ||
    typeof value.required !== "boolean"
  ) {
    return null;
  }

  const base: BroadcastContextPhaseLedgerUnitBase = {
    phase: value.phase,
    unitId,
    inputDigest,
    operationId,
    attemptOrdinal: value.attemptOrdinal as number,
    required: value.required,
  };
  if (
    status === "pending" ||
    status === "in-flight" ||
    status === "reconciling"
  ) {
    return Object.freeze({ ...base, status });
  }
  if (status === "succeeded") {
    let hasResult = false;
    let result: BroadcastContextPhaseLedgerJsonValue = null;
    if (Object.hasOwn(value, "result")) {
      const normalizedResult = normalizeJsonValue(value.result, 0, {
        remainingNodes: MAX_JSON_NODES,
      });
      if (normalizedResult === INVALID_JSON) return null;
      result = normalizedResult;
      hasResult = true;
    }
    let modelReceipt: BroadcastContextPhaseLedgerModelReceipt | null = null;
    if (Object.hasOwn(value, "modelReceipt")) {
      const normalizedReceipt = normalizeModelReceipt(value.modelReceipt);
      if (normalizedReceipt === null) return null;
      modelReceipt = normalizedReceipt;
    }
    return Object.freeze({
      ...base,
      status,
      ...(hasResult ? { result } : {}),
      ...(modelReceipt === null ? {} : { modelReceipt }),
    });
  }

  const reasonCode = normalizeIdentifier(value.reasonCode);
  if (reasonCode === null) return null;
  let modelReceipt: BroadcastContextPhaseLedgerModelReceipt | undefined;
  if (Object.hasOwn(value, "modelReceipt")) {
    const normalizedReceipt = normalizeModelReceipt(value.modelReceipt);
    if (normalizedReceipt === null) return null;
    modelReceipt = normalizedReceipt;
  }
  return Object.freeze({
    ...base,
    status,
    reasonCode,
    ...(modelReceipt === undefined ? {} : { modelReceipt }),
  });
}

const PHASE_ORDER = new Map<BroadcastContextPhaseLedgerPhase, number>(
  BROADCAST_CONTEXT_PHASE_LEDGER_PHASES.map((phase, index) => [phase, index]),
);

function compareUnits(
  left: BroadcastContextPhaseLedgerUnit,
  right: BroadcastContextPhaseLedgerUnit,
): number {
  const phaseDifference =
    (PHASE_ORDER.get(left.phase) ?? 0) - (PHASE_ORDER.get(right.phase) ?? 0);
  return phaseDifference || left.unitId.localeCompare(right.unitId);
}

export function normalizeBroadcastContextPhaseLedger(
  value: unknown,
): BroadcastContextPhaseLedger | null {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "fence",
      "units",
      "usedOperationIds",
    ]) ||
    value.schemaVersion !== BROADCAST_CONTEXT_PHASE_LEDGER_SCHEMA_VERSION ||
    !Array.isArray(value.units) ||
    value.units.length > MAX_LEDGER_UNITS ||
    !Array.isArray(value.usedOperationIds) ||
    value.usedOperationIds.length > MAX_LEDGER_UNITS
  ) {
    return null;
  }

  const fence = normalizeFence(value.fence);
  if (fence === null) return null;

  const units: BroadcastContextPhaseLedgerUnit[] = [];
  const logicalUnitKeys = new Set<string>();
  const currentOperationIds = new Set<string>();
  for (const candidate of value.units) {
    const unit = normalizeUnit(candidate);
    if (unit === null) return null;
    const logicalKey = `${unit.phase}\u0000${unit.unitId}`;
    if (
      logicalUnitKeys.has(logicalKey) ||
      currentOperationIds.has(unit.operationId)
    ) {
      return null;
    }
    logicalUnitKeys.add(logicalKey);
    currentOperationIds.add(unit.operationId);
    units.push(unit);
  }

  const usedOperationIds = new Set<string>();
  for (const candidate of value.usedOperationIds) {
    const operationId = normalizeIdentifier(candidate);
    if (operationId === null || usedOperationIds.has(operationId)) return null;
    usedOperationIds.add(operationId);
  }
  if (
    usedOperationIds.size !== currentOperationIds.size ||
    [...currentOperationIds].some(
      (operationId) => !usedOperationIds.has(operationId),
    )
  ) {
    return null;
  }

  units.sort(compareUnits);
  return Object.freeze({
    schemaVersion: BROADCAST_CONTEXT_PHASE_LEDGER_SCHEMA_VERSION,
    fence,
    units: Object.freeze(units),
    usedOperationIds: Object.freeze([...usedOperationIds].sort()),
  });
}

export function assertBroadcastContextPhaseLedger(
  value: unknown,
): asserts value is BroadcastContextPhaseLedger {
  if (normalizeBroadcastContextPhaseLedger(value) === null) {
    throw new TypeError("Broadcast context phase ledger is invalid.");
  }
}

export function createBroadcastContextPhaseLedger(
  input: CreateBroadcastContextPhaseLedgerInput,
): BroadcastContextPhaseLedger {
  const candidate = {
    schemaVersion: BROADCAST_CONTEXT_PHASE_LEDGER_SCHEMA_VERSION,
    fence: input.fence,
    units: input.units.map((unit) => ({ ...unit, status: "pending" })),
    usedOperationIds: input.units.map(({ operationId }) => operationId),
  };
  const ledger = normalizeBroadcastContextPhaseLedger(candidate);
  if (ledger === null) {
    throw new TypeError("Broadcast context phase ledger plan is invalid.");
  }
  return ledger;
}

/**
 * Adds newly discovered work without rewriting any existing unit or billing
 * identity. Each extension must introduce a strictly later phase, so a sealed
 * phase can never receive more work after execution has passed its boundary.
 */
export function extendBroadcastContextPhaseLedgerPlan(
  ledger: BroadcastContextPhaseLedger,
  units: readonly BroadcastContextPhaseLedgerPlannedUnit[],
): BroadcastContextPhaseLedger {
  const normalized = normalizeBroadcastContextPhaseLedger(ledger);
  if (normalized === null) {
    throw new TypeError("Broadcast context phase ledger is invalid.");
  }
  const maximumExistingPhaseIndex = normalized.units.reduce(
    (maximum, unit) =>
      Math.max(maximum, PHASE_ORDER.get(unit.phase) ?? -1),
    -1,
  );
  for (const unit of units) {
    const phaseIndex = PHASE_ORDER.get(unit.phase) ?? -1;
    if (phaseIndex <= maximumExistingPhaseIndex) {
      throw new TypeError(
        "Broadcast context phase plan must append a later phase.",
      );
    }
  }

  const extended = normalizeBroadcastContextPhaseLedger({
    schemaVersion: BROADCAST_CONTEXT_PHASE_LEDGER_SCHEMA_VERSION,
    fence: normalized.fence,
    units: [
      ...normalized.units,
      ...units.map((unit) => ({ ...unit, status: "pending" })),
    ],
    usedOperationIds: [
      ...normalized.units.map(({ operationId }) => operationId),
      ...units.map(({ operationId }) => operationId),
    ],
  });
  if (extended === null) {
    throw new TypeError("Broadcast context phase plan extension is invalid.");
  }
  return extended;
}

/**
 * Replaces only the child refinement slice after its exact input or routing
 * manifest changes. Parent discovery/jury evidence stays immutable. Retired
 * operation IDs do not need storage because every replacement is fenced by a
 * monotonically increasing generation and attempt ordinal.
 */
export function replaceBroadcastContextRefinementPhaseLedgerPlan(
  ledger: BroadcastContextPhaseLedger,
  units: readonly BroadcastContextPhaseLedgerPlannedUnit[],
): BroadcastContextPhaseLedger {
  const normalized = normalizeBroadcastContextPhaseLedger(ledger);
  if (normalized === null) {
    throw new TypeError("Broadcast context phase ledger is invalid.");
  }
  if (units.some(({ phase }) => phase !== "refinement")) {
    throw new TypeError(
      "Only refinement units can replace the refinement phase plan.",
    );
  }
  const replaced = normalizeBroadcastContextPhaseLedger({
    schemaVersion: BROADCAST_CONTEXT_PHASE_LEDGER_SCHEMA_VERSION,
    fence: normalized.fence,
    units: [
      ...normalized.units.filter(({ phase }) => phase !== "refinement"),
      ...units.map((unit) => ({ ...unit, status: "pending" })),
    ],
    usedOperationIds: [
      ...normalized.units
        .filter(({ phase }) => phase !== "refinement")
        .map(({ operationId }) => operationId),
      ...units.map(({ operationId }) => operationId),
    ],
  });
  if (replaced === null) {
    throw new TypeError("Broadcast context refinement replacement is invalid.");
  }
  return replaced;
}

export function parseBroadcastContextPhaseLedgerJson(
  json: string,
): BroadcastContextPhaseLedger | null {
  try {
    return normalizeBroadcastContextPhaseLedger(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}

export function serializeBroadcastContextPhaseLedger(
  ledger: BroadcastContextPhaseLedger,
): string {
  const normalized = normalizeBroadcastContextPhaseLedger(ledger);
  if (normalized === null) {
    throw new TypeError("Broadcast context phase ledger is invalid.");
  }
  return JSON.stringify(normalized);
}

export function broadcastContextPhaseLedgerMatchesFence(
  ledger: BroadcastContextPhaseLedger,
  fence: BroadcastContextPhaseLedgerFence,
): boolean {
  return (
    ledger.fence.parentContextSignature === fence.parentContextSignature &&
    ledger.fence.transcriptSignature === fence.transcriptSignature &&
    ledger.fence.groundingSignature === fence.groundingSignature
  );
}

export function summarizeBroadcastContextPhaseLedger(
  ledger: BroadcastContextPhaseLedger,
): BroadcastContextPhaseLedgerSummary {
  let requiredCount = 0;
  let requiredSucceededCount = 0;
  let pendingCount = 0;
  let inFlightCount = 0;
  let reconcilingCount = 0;
  let succeededCount = 0;
  let retryableGapCount = 0;
  let outcomeUnknownCount = 0;
  let failedCount = 0;

  for (const unit of ledger.units) {
    if (unit.required) {
      requiredCount += 1;
      if (unit.status === "succeeded") requiredSucceededCount += 1;
    }
    switch (unit.status) {
      case "pending":
        pendingCount += 1;
        break;
      case "in-flight":
        inFlightCount += 1;
        break;
      case "reconciling":
        reconcilingCount += 1;
        break;
      case "succeeded":
        succeededCount += 1;
        break;
      case "retryable-gap":
        retryableGapCount += 1;
        break;
      case "outcome-unknown":
        outcomeUnknownCount += 1;
        break;
      case "failed":
        failedCount += 1;
        break;
    }
  }

  return Object.freeze({
    totalCount: ledger.units.length,
    requiredCount,
    requiredSucceededCount,
    pendingCount,
    inFlightCount,
    reconcilingCount,
    succeededCount,
    retryableGapCount,
    outcomeUnknownCount,
    failedCount,
    complete: requiredSucceededCount === requiredCount,
  });
}

export function broadcastContextPhaseLedgerCanComplete(
  ledger: BroadcastContextPhaseLedger,
): boolean {
  return summarizeBroadcastContextPhaseLedger(ledger).complete;
}

export function selectBroadcastContextPhaseRetryableUnits(
  ledger: BroadcastContextPhaseLedger,
): readonly BroadcastContextPhaseLedgerRetryableUnit[] {
  return Object.freeze(
    ledger.units.filter(
      (unit): unit is BroadcastContextPhaseLedgerRetryableUnit =>
        unit.status === "retryable-gap",
    ),
  );
}

/**
 * Preserves every successful unit while preparing only unfinished work for an
 * editor-requested retry. Recovered `in-flight | outcome-unknown` work must
 * finish exact-operation reconciliation first; an unresolved result can then
 * receive a new operation only through the explicit confirmation transition.
 */
export function replanBroadcastContextPhaseLedgerAfterEditorRetry(
  ledger: BroadcastContextPhaseLedger,
  input: ReplanBroadcastContextPhaseLedgerAfterEditorRetryInput,
): BroadcastContextPhaseLedger {
  if (normalizeIdentifier(input.confirmationId) === null) {
    throw new TypeError("Broadcast context retry confirmation is invalid.");
  }
  let nextLedger = ledger;
  for (const initialUnit of ledger.units) {
    const unit = nextLedger.units.find(
      (candidate) =>
        candidate.phase === initialUnit.phase &&
        candidate.unitId === initialUnit.unitId,
    );
    if (unit === undefined) {
      throw new TypeError("Broadcast context retry unit is missing.");
    }
    const identity: BroadcastContextPhaseLedgerUnitIdentity = {
      fence: nextLedger.fence,
      phase: unit.phase,
      unitId: unit.unitId,
      inputDigest: unit.inputDigest,
      operationId: unit.operationId,
      attemptOrdinal: unit.attemptOrdinal,
    };
    if (unit.status === "in-flight" || unit.status === "reconciling") {
      throw new TypeError(
        "Broadcast context interrupted work must reconcile its exact operation before editor retry.",
      );
    }
    if (
      unit.status !== "retryable-gap" &&
      unit.status !== "outcome-unknown"
    ) {
      continue;
    }
    const nextOperationId = input.nextOperationId(unit);
    const replanned = reduceBroadcastContextPhaseLedger(
      nextLedger,
      unit.status === "retryable-gap"
        ? {
            type: "UNIT_RETRY_PLANNED",
            ...identity,
            nextOperationId,
          }
        : {
            type: "UNIT_OUTCOME_UNKNOWN_RETRY_CONFIRMED",
            ...identity,
            nextOperationId,
            confirmationId: input.confirmationId,
          },
    );
    if (!replanned.accepted) {
      throw new TypeError(
        `Broadcast context retry unit could not be replanned: ${replanned.reason}.`,
      );
    }
    nextLedger = replanned.ledger;
  }
  return nextLedger;
}

function reject(
  ledger: BroadcastContextPhaseLedger,
  reason: BroadcastContextPhaseLedgerRejectionReason,
): BroadcastContextPhaseLedgerTransitionOutcome {
  return { accepted: false, ledger, reason };
}

function accept(
  ledger: BroadcastContextPhaseLedger,
): BroadcastContextPhaseLedgerTransitionOutcome {
  return { accepted: true, ledger };
}

function replaceUnit(
  ledger: BroadcastContextPhaseLedger,
  index: number,
  unit: BroadcastContextPhaseLedgerUnit,
): BroadcastContextPhaseLedger {
  const units = [...ledger.units];
  units[index] = Object.freeze(unit);
  return Object.freeze({
    schemaVersion: BROADCAST_CONTEXT_PHASE_LEDGER_SCHEMA_VERSION,
    fence: ledger.fence,
    units: Object.freeze(units),
    usedOperationIds: Object.freeze(
      units.map(({ operationId }) => operationId).sort(),
    ),
  });
}

function findUnitIndex(
  ledger: BroadcastContextPhaseLedger,
  event: BroadcastContextPhaseLedgerUnitIdentity,
): number {
  return ledger.units.findIndex(
    (unit) => unit.phase === event.phase && unit.unitId === event.unitId,
  );
}

export function reduceBroadcastContextPhaseLedger(
  ledger: BroadcastContextPhaseLedger,
  event: BroadcastContextPhaseLedgerEvent,
): BroadcastContextPhaseLedgerTransitionOutcome {
  if (
    event.fence.parentContextSignature !==
    ledger.fence.parentContextSignature
  ) {
    return reject(ledger, "parent_context_signature_mismatch");
  }
  if (event.fence.transcriptSignature !== ledger.fence.transcriptSignature) {
    return reject(ledger, "transcript_signature_mismatch");
  }
  if (event.fence.groundingSignature !== ledger.fence.groundingSignature) {
    return reject(ledger, "grounding_signature_mismatch");
  }

  const unitIndex = findUnitIndex(ledger, event);
  if (unitIndex < 0) return reject(ledger, "unit_not_found");
  const unit = ledger.units[unitIndex];
  if (unit === undefined) return reject(ledger, "unit_not_found");
  if (event.inputDigest !== unit.inputDigest) {
    return reject(ledger, "input_digest_mismatch");
  }
  if (event.operationId !== unit.operationId) {
    return reject(ledger, "operation_id_mismatch");
  }
  if (event.attemptOrdinal !== unit.attemptOrdinal) {
    return reject(ledger, "attempt_ordinal_mismatch");
  }

  const base: BroadcastContextPhaseLedgerUnitBase = {
    phase: unit.phase,
    unitId: unit.unitId,
    inputDigest: unit.inputDigest,
    operationId: unit.operationId,
    attemptOrdinal: unit.attemptOrdinal,
    required: unit.required,
  };

  if (event.type === "UNIT_STARTED") {
    if (unit.status !== "pending") {
      return reject(ledger, "undefined_transition");
    }
    return accept(
      replaceUnit(ledger, unitIndex, { ...base, status: "in-flight" }),
    );
  }

  if (event.type === "UNIT_RECONCILIATION_STARTED") {
    if (
      unit.status !== "in-flight" &&
      unit.status !== "outcome-unknown"
    ) {
      return reject(ledger, "undefined_transition");
    }
    return accept(
      replaceUnit(ledger, unitIndex, { ...base, status: "reconciling" }),
    );
  }

  if (
    event.type === "UNIT_SUCCEEDED" ||
    event.type === "UNIT_RECONCILIATION_SUCCEEDED"
  ) {
    if (
      (event.type === "UNIT_SUCCEEDED" && unit.status !== "in-flight") ||
      (event.type === "UNIT_RECONCILIATION_SUCCEEDED" &&
        unit.status !== "reconciling")
    ) {
      return reject(ledger, "undefined_transition");
    }
    let hasResult = false;
    let result: BroadcastContextPhaseLedgerJsonValue = null;
    if (Object.hasOwn(event, "result")) {
      const normalizedResult = normalizeJsonValue(event.result, 0, {
        remainingNodes: MAX_JSON_NODES,
      });
      if (normalizedResult === INVALID_JSON) {
        return reject(ledger, "invalid_result");
      }
      result = normalizedResult;
      hasResult = true;
    }
    let modelReceipt: BroadcastContextPhaseLedgerModelReceipt | undefined;
    if (Object.hasOwn(event, "modelReceipt")) {
      const normalizedReceipt = normalizeModelReceipt(event.modelReceipt);
      if (normalizedReceipt === null) {
        return reject(ledger, "invalid_model_receipt");
      }
      modelReceipt = normalizedReceipt;
    }
    return accept(
      replaceUnit(ledger, unitIndex, {
        ...base,
        status: "succeeded",
        ...(hasResult ? { result } : {}),
        ...(modelReceipt === undefined ? {} : { modelReceipt }),
      }),
    );
  }

  if (
    event.type === "UNIT_RETRYABLE_GAP" ||
    event.type === "UNIT_OUTCOME_UNKNOWN" ||
    event.type === "UNIT_FAILED" ||
    event.type === "UNIT_RECONCILIATION_NOT_DISPATCHED" ||
    event.type === "UNIT_RECONCILIATION_UNRESOLVED"
  ) {
    const isExecutionSettlement =
      event.type === "UNIT_RETRYABLE_GAP" ||
      event.type === "UNIT_OUTCOME_UNKNOWN" ||
      event.type === "UNIT_FAILED";
    if (
      (isExecutionSettlement && unit.status !== "in-flight") ||
      (!isExecutionSettlement && unit.status !== "reconciling")
    ) {
      return reject(ledger, "undefined_transition");
    }
    const reasonCode = normalizeIdentifier(event.reasonCode);
    if (reasonCode === null) return reject(ledger, "invalid_reason_code");
    let modelReceipt: BroadcastContextPhaseLedgerModelReceipt | undefined;
    if (Object.hasOwn(event, "modelReceipt")) {
      const normalizedReceipt = normalizeModelReceipt(event.modelReceipt);
      if (normalizedReceipt === null) {
        return reject(ledger, "invalid_model_receipt");
      }
      modelReceipt = normalizedReceipt;
    }
    return accept(
      replaceUnit(ledger, unitIndex, {
        ...base,
        status:
          event.type === "UNIT_RETRYABLE_GAP" ||
          event.type === "UNIT_RECONCILIATION_NOT_DISPATCHED"
            ? "retryable-gap"
            : event.type === "UNIT_FAILED"
              ? "failed"
            : "outcome-unknown",
        reasonCode,
        ...(modelReceipt === undefined ? {} : { modelReceipt }),
      }),
    );
  }

  const isAutomaticRetry =
    event.type === "UNIT_RETRY_PLANNED" &&
    unit.status === "retryable-gap";
  const isConfirmedOutcomeRetry =
    event.type === "UNIT_OUTCOME_UNKNOWN_RETRY_CONFIRMED" &&
    unit.status === "outcome-unknown";
  if (!isAutomaticRetry && !isConfirmedOutcomeRetry) {
    return reject(ledger, "undefined_transition");
  }
  if (
    event.type === "UNIT_OUTCOME_UNKNOWN_RETRY_CONFIRMED" &&
    normalizeIdentifier(event.confirmationId) === null
  ) {
    return reject(ledger, "invalid_confirmation_id");
  }
  const nextOperationId = normalizeIdentifier(event.nextOperationId);
  if (nextOperationId === null) {
    return reject(ledger, "invalid_operation_id");
  }
  if (ledger.usedOperationIds.includes(nextOperationId)) {
    return reject(ledger, "operation_id_reused");
  }
  if (unit.attemptOrdinal === Number.MAX_SAFE_INTEGER) {
    return reject(ledger, "attempt_ordinal_overflow");
  }
  return accept(
    replaceUnit(ledger, unitIndex, {
      ...base,
      operationId: nextOperationId,
      attemptOrdinal: unit.attemptOrdinal + 1,
      status: "pending",
    }),
  );
}
