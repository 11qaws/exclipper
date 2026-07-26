import {
  AI_QUOTA_MAX_ACTIVE_PARTICIPANTS,
  AI_QUOTA_SCHEMA_VERSION,
  type AiQuotaOperationIdentity,
  type AiQuotaPool,
  type AiQuotaPublicResponse,
} from "../analysis/aiQuotaProtocol";

export const AI_QUOTA_COORDINATOR_STATE_VERSION = "1.4.0" as const;
export const AI_QUOTA_PARTICIPANT_IDLE_TTL_MS = 2 * 60_000;
export const AI_QUOTA_QUEUED_TTL_MS = 2 * 60_000;
export const AI_QUOTA_LEASE_TTL_MS = 2 * 60_000;
export const AI_QUOTA_EXECUTION_WAIT_TTL_MS = 3 * 60_000;
export const AI_QUOTA_IN_FLIGHT_TTL_MS = 3 * 60_000;
export const AI_QUOTA_TERMINAL_TOMBSTONE_TTL_MS = 6 * 60 * 60_000;
export const AI_QUOTA_CAPACITY_RETRY_MS = 15_000;
export const AI_QUOTA_MAX_PENDING_PER_PARTICIPANT = 12;
export const AI_QUOTA_MAX_OPERATIONS = 768;
export const AI_QUOTA_OPERATION_RETENTION_TARGET = 512;
export const AI_QUOTA_MAX_PROVIDER_BACKOFF_MS = 60_000;
export const AI_QUOTA_TOKEN_WINDOW_MS = 60_000;
export const AI_QUOTA_QWEN_OMNI_MAX_TOKENS_PER_MINUTE = 100_000;
export const AI_QUOTA_CONTEXT_MAX_TOKENS_PER_MINUTE = 5_000_000;
export const AI_QUOTA_MAX_TOKEN_RESERVATION =
  AI_QUOTA_CONTEXT_MAX_TOKENS_PER_MINUTE;

const ACTIVITY_WRITE_INTERVAL_MS = 5_000;
const EXECUTION_WAITER_ACTIVE_MS = 15_000;
const DEFAULT_EXECUTION_RETRY_MS = 250;
const PUBLIC_QUEUE_RETRY_MS = 2_000;

export interface AiQuotaPoolPolicy {
  readonly minimumStartIntervalMs: number;
  readonly maxPipeline: number;
  readonly maxInFlight: number;
}

export type AiQuotaProviderGate = "qwen-omni" | "context";

export interface AiQuotaProviderGatePolicy {
  readonly minimumStartIntervalMs: number;
  readonly maxPipeline: number;
  readonly maxInFlight: number;
  readonly maximumTokensPerMinute: number | null;
}

/**
 * `transcript` and `candidate` currently share the same Singapore
 * qwen3.5-omni-flash credential and its 60 RPM provider budget. Role pools
 * remain useful for UI accounting, but their paid starts must pass one shared
 * provider gate so their combined rate cannot exceed that model's quota.
 */
export const AI_QUOTA_POOL_PROVIDER_GATE: Readonly<
  Record<AiQuotaPool, AiQuotaProviderGate>
> = Object.freeze({
  transcript: "qwen-omni",
  candidate: "qwen-omni",
  context: "context",
});

export const AI_QUOTA_PROVIDER_GATE_POLICY: Readonly<
  Record<AiQuotaProviderGate, AiQuotaProviderGatePolicy>
> = Object.freeze({
  "qwen-omni": Object.freeze({
    minimumStartIntervalMs: 1_000,
    maxPipeline: 6,
    maxInFlight: 6,
    maximumTokensPerMinute: AI_QUOTA_QWEN_OMNI_MAX_TOKENS_PER_MINUTE,
  }),
  context: Object.freeze({
    minimumStartIntervalMs: 250,
    maxPipeline: 6,
    maxInFlight: 6,
    maximumTokensPerMinute: AI_QUOTA_CONTEXT_MAX_TOKENS_PER_MINUTE,
  }),
});

export const AI_QUOTA_POOL_POLICY: Readonly<
  Record<AiQuotaPool, AiQuotaPoolPolicy>
> = Object.freeze({
  transcript: Object.freeze({
    minimumStartIntervalMs:
      AI_QUOTA_PROVIDER_GATE_POLICY["qwen-omni"].minimumStartIntervalMs,
    maxPipeline: 6,
    maxInFlight: 6,
  }),
  candidate: Object.freeze({
    minimumStartIntervalMs:
      AI_QUOTA_PROVIDER_GATE_POLICY["qwen-omni"].minimumStartIntervalMs,
    maxPipeline: 6,
    maxInFlight: 4,
  }),
  context: Object.freeze({
    minimumStartIntervalMs:
      AI_QUOTA_PROVIDER_GATE_POLICY.context.minimumStartIntervalMs,
    maxPipeline: 6,
    maxInFlight: 6,
  }),
});

export type AiQuotaOperationStatus =
  | "queued"
  | "lease-issued"
  | "execution-waiting"
  | "in-flight"
  | "succeeded"
  | "rate-limited"
  | "failed"
  | "cancelled"
  | "outcome-unknown";

export interface AiQuotaParticipantRecord {
  readonly participantId: string;
  runId: string;
  readonly joinedSequence: number;
  lastSeenAtMs: number;
}

export interface AiQuotaOperationRecord extends AiQuotaOperationIdentity {
  status: AiQuotaOperationStatus;
  readonly enqueuedSequence: number;
  readonly createdAtMs: number;
  updatedAtMs: number;
  leaseToken: string | null;
  leaseExpiresAtMs: number | null;
  tokenReservation: number | null;
}

export interface AiQuotaProviderGateState {
  nextGrantAtMs: number;
  cursorParticipantId: string | null;
  tokenReservations: Array<{
    readonly startedAtMs: number;
    readonly tokens: number;
  }>;
}

export interface AiQuotaCoordinatorState {
  readonly schemaVersion: typeof AI_QUOTA_COORDINATOR_STATE_VERSION;
  revision: number;
  nextParticipantSequence: number;
  nextOperationSequence: number;
  readonly participants: Record<string, AiQuotaParticipantRecord>;
  readonly operations: Record<string, AiQuotaOperationRecord>;
  readonly providerGates: Record<
    AiQuotaProviderGate,
    AiQuotaProviderGateState
  >;
}

export type AiQuotaInternalRequest =
  | ({ readonly action: "inspect" } & AiQuotaOperationIdentity & {
      readonly leaseToken: string;
    })
  | ({ readonly action: "release-upload" } & AiQuotaOperationIdentity & {
      readonly leaseToken: string;
    })
  | ({ readonly action: "consume" } & AiQuotaOperationIdentity & {
      readonly leaseToken: string;
      /**
       * Worker-computed conservative input + maximum-output reservation.
       * Direct policy tests may omit it and use one token.
       */
      readonly tokenReservation?: number;
    })
  | ({ readonly action: "complete" } & AiQuotaOperationIdentity & {
      readonly leaseToken: string;
      readonly outcome:
        | "succeeded"
        | "rate-limited"
        | "retryable"
        | "failed"
        | "outcome-unknown";
      readonly retryAfterMs?: number;
    });

export type AiQuotaInternalResponse =
  | {
      readonly ok: true;
      readonly status: "valid" | "released" | "consumed" | "completed";
    }
  | {
      readonly ok: false;
      readonly status:
        | "missing"
        | "mismatch"
        | "expired"
        | "already-consumed"
        | "not-in-flight"
        | "not-ready";
      readonly retryAfterMs?: number;
    };

function markChanged(state: AiQuotaCoordinatorState): void {
  state.revision += 1;
}

function operationKey(identity: AiQuotaOperationIdentity): string {
  return `${identity.pool}\u001f${identity.participantId}\u001f${identity.runId}\u001f${identity.operationId}`;
}

function isOpenOperation(status: AiQuotaOperationStatus): boolean {
  return (
    status === "queued" ||
    status === "lease-issued" ||
    status === "execution-waiting" ||
    status === "in-flight"
  );
}

function isPipelineOccupied(status: AiQuotaOperationStatus): boolean {
  return (
    status === "lease-issued" ||
    status === "execution-waiting" ||
    status === "in-flight"
  );
}

function activeParticipantCount(state: AiQuotaCoordinatorState): number {
  return Object.keys(state.participants).length;
}

function poolInFlightCount(
  state: AiQuotaCoordinatorState,
  pool: AiQuotaPool,
): number {
  return Object.values(state.operations).filter(
    (operation) => operation.pool === pool && operation.status === "in-flight",
  ).length;
}

function providerGateForPool(pool: AiQuotaPool): AiQuotaProviderGate {
  return AI_QUOTA_POOL_PROVIDER_GATE[pool];
}

function operationUsesProviderGate(
  operation: AiQuotaOperationRecord,
  providerGate: AiQuotaProviderGate,
): boolean {
  return providerGateForPool(operation.pool) === providerGate;
}

function providerGateInFlightCount(
  state: AiQuotaCoordinatorState,
  providerGate: AiQuotaProviderGate,
): number {
  return Object.values(state.operations).filter(
    (operation) =>
      operationUsesProviderGate(operation, providerGate) &&
      operation.status === "in-flight",
  ).length;
}

function operationMatches(
  operation: AiQuotaOperationRecord,
  identity: AiQuotaOperationIdentity,
): boolean {
  return (
    operation.participantId === identity.participantId &&
    operation.runId === identity.runId &&
    operation.operationId === identity.operationId &&
    operation.pool === identity.pool &&
    operation.payloadDigest === identity.payloadDigest
  );
}

function publicBase(
  state: AiQuotaCoordinatorState,
  pool: AiQuotaPool,
): {
  readonly activeParticipantCount: number;
  readonly poolInFlightCount: number;
} {
  return {
    activeParticipantCount: activeParticipantCount(state),
    poolInFlightCount: poolInFlightCount(state, pool),
  };
}

export function createAiQuotaCoordinatorState(): AiQuotaCoordinatorState {
  return {
    schemaVersion: AI_QUOTA_COORDINATOR_STATE_VERSION,
    revision: 0,
    nextParticipantSequence: 1,
    nextOperationSequence: 1,
    participants: {},
    operations: {},
    providerGates: {
      "qwen-omni": {
        nextGrantAtMs: 0,
        cursorParticipantId: null,
        tokenReservations: [],
      },
      context: {
        nextGrantAtMs: 0,
        cursorParticipantId: null,
        tokenReservations: [],
      },
    },
  };
}

function pruneProviderTokenReservations(
  state: AiQuotaCoordinatorState,
  nowMs: number,
): boolean {
  let changed = false;
  const cutoffMs = nowMs - AI_QUOTA_TOKEN_WINDOW_MS;
  for (const gateState of Object.values(state.providerGates)) {
    const retained = gateState.tokenReservations.filter(
      (reservation) => reservation.startedAtMs > cutoffMs,
    );
    if (retained.length !== gateState.tokenReservations.length) {
      gateState.tokenReservations = retained;
      changed = true;
    }
  }
  return changed;
}

function terminalizeOperation(
  operation: AiQuotaOperationRecord,
  status: Extract<
    AiQuotaOperationStatus,
    "cancelled" | "outcome-unknown"
  >,
  nowMs: number,
): void {
  operation.status = status;
  operation.updatedAtMs = nowMs;
  operation.leaseToken = null;
  operation.leaseExpiresAtMs = null;
}

function cleanupExpiredState(
  state: AiQuotaCoordinatorState,
  nowMs: number,
): void {
  let changed = pruneProviderTokenReservations(state, nowMs);
  for (const operation of Object.values(state.operations)) {
    if (
      operation.status === "queued" &&
      operation.updatedAtMs + AI_QUOTA_QUEUED_TTL_MS <= nowMs
    ) {
      terminalizeOperation(operation, "cancelled", nowMs);
      changed = true;
    } else if (
      operation.status === "lease-issued" &&
      operation.leaseExpiresAtMs !== null &&
      operation.leaseExpiresAtMs <= nowMs
    ) {
      terminalizeOperation(operation, "cancelled", nowMs);
      changed = true;
    } else if (
      operation.status === "execution-waiting" &&
      operation.updatedAtMs + AI_QUOTA_EXECUTION_WAIT_TTL_MS <= nowMs
    ) {
      terminalizeOperation(operation, "cancelled", nowMs);
      changed = true;
    } else if (
      operation.status === "in-flight" &&
      operation.updatedAtMs + AI_QUOTA_IN_FLIGHT_TTL_MS <= nowMs
    ) {
      terminalizeOperation(operation, "outcome-unknown", nowMs);
      changed = true;
    }
  }

  const terminalOperations = Object.entries(state.operations)
    .filter(([, operation]) => !isOpenOperation(operation.status))
    .sort(
      ([, left], [, right]) =>
        left.updatedAtMs - right.updatedAtMs ||
        left.enqueuedSequence - right.enqueuedSequence,
    );
  let operationCount = Object.keys(state.operations).length;
  for (const [key, operation] of terminalOperations) {
    const expired =
      operation.updatedAtMs + AI_QUOTA_TERMINAL_TOMBSTONE_TTL_MS <= nowMs;
    const overRetentionTarget =
      operationCount >= AI_QUOTA_MAX_OPERATIONS &&
      operationCount > AI_QUOTA_OPERATION_RETENTION_TARGET;
    if (!expired && !overRetentionTarget) continue;
    delete state.operations[key];
    operationCount -= 1;
    changed = true;
  }

  for (const participant of Object.values(state.participants)) {
    const hasOpenOperation = Object.values(state.operations).some(
      (operation) =>
        operation.participantId === participant.participantId &&
        isOpenOperation(operation.status),
    );
    if (
      !hasOpenOperation &&
      participant.lastSeenAtMs + AI_QUOTA_PARTICIPANT_IDLE_TTL_MS <= nowMs
    ) {
      delete state.participants[participant.participantId];
      changed = true;
    }
  }
  if (changed) markChanged(state);
}

function touchParticipant(
  state: AiQuotaCoordinatorState,
  participant: AiQuotaParticipantRecord,
  nowMs: number,
): void {
  if (participant.lastSeenAtMs + ACTIVITY_WRITE_INTERVAL_MS > nowMs) return;
  participant.lastSeenAtMs = nowMs;
  markChanged(state);
}

function touchWaitingOperation(
  state: AiQuotaCoordinatorState,
  operation: AiQuotaOperationRecord,
  nowMs: number,
): void {
  if (operation.updatedAtMs + ACTIVITY_WRITE_INTERVAL_MS > nowMs) return;
  operation.updatedAtMs = nowMs;
  markChanged(state);
}

function activeProviderGateParticipantIds(
  state: AiQuotaCoordinatorState,
  providerGate: AiQuotaProviderGate,
): readonly string[] {
  const ids = new Set(
    Object.values(state.operations)
      .filter(
        (operation) =>
          operationUsesProviderGate(operation, providerGate) &&
          isOpenOperation(operation.status),
      )
      .map((operation) => operation.participantId),
  );
  return [...ids].sort(
    (left, right) =>
      (state.participants[left]?.joinedSequence ?? Number.MAX_SAFE_INTEGER) -
        (state.participants[right]?.joinedSequence ??
          Number.MAX_SAFE_INTEGER) ||
      left.localeCompare(right),
  );
}

function participantProviderGateConcurrencyLimit(
  state: AiQuotaCoordinatorState,
  providerGate: AiQuotaProviderGate,
): number {
  const providerGateParticipantCount =
    activeProviderGateParticipantIds(state, providerGate).length;
  const fairShare =
    providerGateParticipantCount <= 1
      ? 6
      : providerGateParticipantCount === 2
        ? 3
        : 2;
  return Math.min(
    AI_QUOTA_PROVIDER_GATE_POLICY[providerGate].maxInFlight,
    fairShare,
  );
}

function participantProviderGatePipelineLimit(
  state: AiQuotaCoordinatorState,
  providerGate: AiQuotaProviderGate,
): number {
  const providerGateParticipantCount =
    activeProviderGateParticipantIds(state, providerGate).length;
  const fairShare =
    providerGateParticipantCount <= 1
      ? AI_QUOTA_PROVIDER_GATE_POLICY[providerGate].maxPipeline
      : providerGateParticipantCount === 2
        ? 3
        : 2;
  return Math.min(
    AI_QUOTA_PROVIDER_GATE_POLICY[providerGate].maxPipeline,
    fairShare,
  );
}

function participantProviderGatePipelineCount(
  state: AiQuotaCoordinatorState,
  participantId: string,
  providerGate: AiQuotaProviderGate,
): number {
  return Object.values(state.operations).filter(
    (operation) =>
      operation.participantId === participantId &&
      operationUsesProviderGate(operation, providerGate) &&
      isPipelineOccupied(operation.status),
  ).length;
}

function participantProviderGateInFlightCount(
  state: AiQuotaCoordinatorState,
  participantId: string,
  providerGate: AiQuotaProviderGate,
): number {
  return Object.values(state.operations).filter(
    (operation) =>
      operation.participantId === participantId &&
      operationUsesProviderGate(operation, providerGate) &&
      operation.status === "in-flight",
  ).length;
}

function poolPipelineCount(
  state: AiQuotaCoordinatorState,
  pool: AiQuotaPool,
): number {
  return Object.values(state.operations).filter(
    (operation) =>
      operation.pool === pool && isPipelineOccupied(operation.status),
  ).length;
}

function providerGatePipelineCount(
  state: AiQuotaCoordinatorState,
  providerGate: AiQuotaProviderGate,
): number {
  return Object.values(state.operations).filter(
    (operation) =>
      operationUsesProviderGate(operation, providerGate) &&
      isPipelineOccupied(operation.status),
  ).length;
}

/**
 * Public grants are bounded upload tickets. They deliberately do not advance
 * the provider start clock: a slow browser upload must not reserve a paid
 * start time that it cannot use.
 */
function issueUploadTicket(
  state: AiQuotaCoordinatorState,
  operation: AiQuotaOperationRecord,
  nowMs: number,
  createLeaseToken: () => string,
): void {
  if (operation.status !== "queued") return;
  const providerGate = providerGateForPool(operation.pool);
  if (
    poolPipelineCount(state, operation.pool) >=
      AI_QUOTA_POOL_POLICY[operation.pool].maxPipeline ||
    providerGatePipelineCount(state, providerGate) >=
      AI_QUOTA_PROVIDER_GATE_POLICY[providerGate].maxPipeline ||
    participantProviderGatePipelineCount(
      state,
      operation.participantId,
      providerGate,
    ) >= participantProviderGatePipelineLimit(state, providerGate)
  ) {
    return;
  }
  operation.status = "lease-issued";
  operation.leaseToken = createLeaseToken();
  operation.leaseExpiresAtMs = nowMs + AI_QUOTA_LEASE_TTL_MS;
  operation.updatedAtMs = nowMs;
  markChanged(state);
}

function responseForOperation(
  state: AiQuotaCoordinatorState,
  operation: AiQuotaOperationRecord,
): AiQuotaPublicResponse {
  const base = publicBase(state, operation.pool);
  if (
    operation.status === "lease-issued" &&
    operation.leaseToken !== null &&
    operation.leaseExpiresAtMs !== null
  ) {
    return {
      schemaVersion: AI_QUOTA_SCHEMA_VERSION,
      status: "granted",
      leaseToken: operation.leaseToken,
      leaseExpiresAtMs: operation.leaseExpiresAtMs,
      retryAfterMs: 0,
      ...base,
    };
  }
  if (
    operation.status === "queued" ||
    operation.status === "execution-waiting"
  ) {
    return {
      schemaVersion: AI_QUOTA_SCHEMA_VERSION,
      status: "queued",
      retryAfterMs: PUBLIC_QUEUE_RETRY_MS,
      ...base,
    };
  }
  if (operation.status === "cancelled") {
    return {
      schemaVersion: AI_QUOTA_SCHEMA_VERSION,
      status: "cancelled",
      retryAfterMs: 0,
      ...base,
    };
  }
  return {
    schemaVersion: AI_QUOTA_SCHEMA_VERSION,
    status: "terminal",
    reason: "OPERATION_ALREADY_FINISHED",
    retryAfterMs: 0,
    ...base,
  };
}

export function requestAiQuotaLease(
  state: AiQuotaCoordinatorState,
  identity: AiQuotaOperationIdentity,
  nowMs: number,
  createLeaseToken: () => string,
): AiQuotaPublicResponse {
  cleanupExpiredState(state, nowMs);
  const existingParticipant = state.participants[identity.participantId];
  if (existingParticipant === undefined) {
    if (activeParticipantCount(state) >= AI_QUOTA_MAX_ACTIVE_PARTICIPANTS) {
      return {
        schemaVersion: AI_QUOTA_SCHEMA_VERSION,
        status: "capacity-full",
        retryAfterMs: AI_QUOTA_CAPACITY_RETRY_MS,
        activeParticipantCount: AI_QUOTA_MAX_ACTIVE_PARTICIPANTS,
        poolInFlightCount: poolInFlightCount(state, identity.pool),
      };
    }
    state.participants[identity.participantId] = {
      participantId: identity.participantId,
      runId: identity.runId,
      joinedSequence: state.nextParticipantSequence,
      lastSeenAtMs: nowMs,
    };
    state.nextParticipantSequence += 1;
    markChanged(state);
  } else {
    const hasOpenOperation = Object.values(state.operations).some(
      (operation) =>
        operation.participantId === identity.participantId &&
        isOpenOperation(operation.status),
    );
    if (existingParticipant.runId !== identity.runId && hasOpenOperation) {
      return {
        schemaVersion: AI_QUOTA_SCHEMA_VERSION,
        status: "conflict",
        reason: "RUN_CONFLICT",
        retryAfterMs: 1_000,
        ...publicBase(state, identity.pool),
      };
    }
    if (existingParticipant.runId !== identity.runId) {
      existingParticipant.runId = identity.runId;
      markChanged(state);
    }
    touchParticipant(state, existingParticipant, nowMs);
  }

  const key = operationKey(identity);
  const existingOperation = state.operations[key];
  if (existingOperation !== undefined) {
    if (!operationMatches(existingOperation, identity)) {
      return {
        schemaVersion: AI_QUOTA_SCHEMA_VERSION,
        status: "conflict",
        reason: "OPERATION_CONFLICT",
        retryAfterMs: 0,
        ...publicBase(state, identity.pool),
      };
    }
    if (existingOperation.status === "queued") {
      touchWaitingOperation(state, existingOperation, nowMs);
      issueUploadTicket(state, existingOperation, nowMs, createLeaseToken);
    }
    return responseForOperation(state, existingOperation);
  }

  const participantPendingCount = Object.values(state.operations).filter(
    (operation) =>
      operation.participantId === identity.participantId &&
      isOpenOperation(operation.status),
  ).length;
  if (
    participantPendingCount >= AI_QUOTA_MAX_PENDING_PER_PARTICIPANT ||
    Object.keys(state.operations).length >= AI_QUOTA_MAX_OPERATIONS
  ) {
    return {
      schemaVersion: AI_QUOTA_SCHEMA_VERSION,
      status: "queue-full",
      reason: "PARTICIPANT_QUEUE_FULL",
      retryAfterMs: 1_000,
      ...publicBase(state, identity.pool),
    };
  }

  const operation: AiQuotaOperationRecord = {
    ...identity,
    status: "queued",
    enqueuedSequence: state.nextOperationSequence,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    leaseToken: null,
    leaseExpiresAtMs: null,
    tokenReservation: null,
  };
  state.nextOperationSequence += 1;
  state.operations[key] = operation;
  markChanged(state);
  issueUploadTicket(state, operation, nowMs, createLeaseToken);
  return responseForOperation(state, operation);
}

export function cancelAiQuotaOperation(
  state: AiQuotaCoordinatorState,
  identity: AiQuotaOperationIdentity,
  nowMs: number,
): AiQuotaPublicResponse {
  cleanupExpiredState(state, nowMs);
  const operation = state.operations[operationKey(identity)];
  if (operation === undefined || !operationMatches(operation, identity)) {
    return {
      schemaVersion: AI_QUOTA_SCHEMA_VERSION,
      status: "conflict",
      reason: "OPERATION_CONFLICT",
      retryAfterMs: 0,
      ...publicBase(state, identity.pool),
    };
  }
  if (
    operation.status === "queued" ||
    operation.status === "lease-issued" ||
    operation.status === "execution-waiting"
  ) {
    terminalizeOperation(operation, "cancelled", nowMs);
    markChanged(state);
  }
  return responseForOperation(state, operation);
}

function executionWaitingOperations(
  state: AiQuotaCoordinatorState,
  providerGate: AiQuotaProviderGate,
  nowMs: number,
): readonly AiQuotaOperationRecord[] {
  return Object.values(state.operations).filter(
    (operation) =>
      operationUsesProviderGate(operation, providerGate) &&
      operation.status === "execution-waiting" &&
      operation.updatedAtMs + EXECUTION_WAITER_ACTIVE_MS > nowMs,
  );
}

function orderedReadyParticipantIds(
  state: AiQuotaCoordinatorState,
  providerGate: AiQuotaProviderGate,
  nowMs: number,
): readonly string[] {
  const participantIds = new Set(
    executionWaitingOperations(state, providerGate, nowMs).map(
      (operation) => operation.participantId,
    ),
  );
  const joined = [...participantIds].sort(
    (left, right) =>
      (state.participants[left]?.joinedSequence ?? Number.MAX_SAFE_INTEGER) -
        (state.participants[right]?.joinedSequence ??
          Number.MAX_SAFE_INTEGER) ||
      left.localeCompare(right),
  );
  const cursor =
    state.providerGates[providerGate].cursorParticipantId;
  if (cursor === null) return joined;
  const cursorIndex = joined.indexOf(cursor);
  if (cursorIndex < 0) return joined;
  return joined.map(
    (_, offset) => joined[(cursorIndex + 1 + offset) % joined.length]!,
  );
}

function providerGateReservedTokens(
  state: AiQuotaCoordinatorState,
  providerGate: AiQuotaProviderGate,
): number {
  return state.providerGates[providerGate].tokenReservations.reduce(
    (total, reservation) => total + reservation.tokens,
    0,
  );
}

function tokenReservationFits(
  state: AiQuotaCoordinatorState,
  providerGate: AiQuotaProviderGate,
  tokenReservation: number,
): boolean {
  const maximumTokensPerMinute =
    AI_QUOTA_PROVIDER_GATE_POLICY[providerGate].maximumTokensPerMinute;
  return (
    maximumTokensPerMinute === null ||
    providerGateReservedTokens(state, providerGate) + tokenReservation <=
      maximumTokensPerMinute
  );
}

function tokenReservationRetryAfterMs(
  state: AiQuotaCoordinatorState,
  providerGate: AiQuotaProviderGate,
  tokenReservation: number,
  nowMs: number,
): number {
  const maximumTokensPerMinute =
    AI_QUOTA_PROVIDER_GATE_POLICY[providerGate].maximumTokensPerMinute;
  if (maximumTokensPerMinute === null) return DEFAULT_EXECUTION_RETRY_MS;
  let tokensToExpire =
    providerGateReservedTokens(state, providerGate) +
    tokenReservation -
    maximumTokensPerMinute;
  for (const reservation of state.providerGates[providerGate]
    .tokenReservations) {
    tokensToExpire -= reservation.tokens;
    if (tokensToExpire <= 0) {
      return Math.max(
        75,
        reservation.startedAtMs + AI_QUOTA_TOKEN_WINDOW_MS - nowMs,
      );
    }
  }
  return AI_QUOTA_TOKEN_WINDOW_MS;
}

function selectedExecutionWaiter(
  state: AiQuotaCoordinatorState,
  providerGate: AiQuotaProviderGate,
  nowMs: number,
): AiQuotaOperationRecord | null {
  const waiting = executionWaitingOperations(state, providerGate, nowMs);
  const participantLimit = participantProviderGateConcurrencyLimit(
    state,
    providerGate,
  );
  for (const participantId of orderedReadyParticipantIds(
    state,
    providerGate,
    nowMs,
  )) {
    if (
      participantProviderGateInFlightCount(
        state,
        participantId,
        providerGate,
      ) >= participantLimit
    ) {
      continue;
    }
    const operation = waiting
      .filter(
        (candidate) =>
          candidate.participantId === participantId &&
          poolInFlightCount(state, candidate.pool) <
            AI_QUOTA_POOL_POLICY[candidate.pool].maxInFlight,
      )
      .sort(
        (left, right) =>
          left.enqueuedSequence - right.enqueuedSequence ||
          left.operationId.localeCompare(right.operationId),
      )[0];
    // Preserve participant FIFO. If this participant's head request cannot
    // fit the rolling token window yet, try the next participant instead of
    // leaving otherwise usable provider capacity idle.
    if (
      operation !== undefined &&
      operation.tokenReservation !== null &&
      tokenReservationFits(
        state,
        providerGate,
        operation.tokenReservation,
      )
    ) {
      return operation;
    }
  }
  return null;
}

/**
 * The execution gate runs only after Worker-side body validation. This is the
 * point that controls real paid starts, so slow uploads cannot collapse the
 * shared Qwen Omni 1,000 ms / context 250 ms spacing into a provider burst.
 */
function tryStartExecution(
  state: AiQuotaCoordinatorState,
  operation: AiQuotaOperationRecord,
  nowMs: number,
): AiQuotaInternalResponse {
  const providerGate = providerGateForPool(operation.pool);
  const providerGateState = state.providerGates[providerGate];
  const tokenReservation = operation.tokenReservation;
  if (tokenReservation === null) {
    return {
      ok: false,
      status: "not-ready",
      retryAfterMs: DEFAULT_EXECUTION_RETRY_MS,
    };
  }
  if (nowMs < providerGateState.nextGrantAtMs) {
    return {
      ok: false,
      status: "not-ready",
      retryAfterMs: Math.max(
        75,
        providerGateState.nextGrantAtMs - nowMs,
      ),
    };
  }
  if (
    providerGateInFlightCount(state, providerGate) >=
      AI_QUOTA_PROVIDER_GATE_POLICY[providerGate].maxInFlight ||
    poolInFlightCount(state, operation.pool) >=
    AI_QUOTA_POOL_POLICY[operation.pool].maxInFlight
  ) {
    return {
      ok: false,
      status: "not-ready",
      retryAfterMs: DEFAULT_EXECUTION_RETRY_MS,
    };
  }
  const selected = selectedExecutionWaiter(state, providerGate, nowMs);
  if (selected === null) {
    return {
      ok: false,
      status: "not-ready",
      retryAfterMs: tokenReservationRetryAfterMs(
        state,
        providerGate,
        tokenReservation,
        nowMs,
      ),
    };
  }
  if (operationKey(selected) !== operationKey(operation)) {
    return {
      ok: false,
      status: "not-ready",
      retryAfterMs: DEFAULT_EXECUTION_RETRY_MS,
    };
  }

  operation.status = "in-flight";
  operation.updatedAtMs = nowMs;
  operation.leaseExpiresAtMs = null;
  providerGateState.cursorParticipantId = operation.participantId;
  providerGateState.nextGrantAtMs =
    nowMs +
    AI_QUOTA_PROVIDER_GATE_POLICY[providerGate].minimumStartIntervalMs;
  if (
    AI_QUOTA_PROVIDER_GATE_POLICY[providerGate].maximumTokensPerMinute !== null
  ) {
    providerGateState.tokenReservations.push({
      startedAtMs: nowMs,
      tokens: tokenReservation,
    });
  }
  markChanged(state);
  return { ok: true, status: "consumed" };
}

export function applyAiQuotaInternalRequest(
  state: AiQuotaCoordinatorState,
  request: AiQuotaInternalRequest,
  nowMs: number,
): AiQuotaInternalResponse {
  cleanupExpiredState(state, nowMs);
  const operation = state.operations[operationKey(request)];
  if (operation === undefined) return { ok: false, status: "missing" };
  if (
    !operationMatches(operation, request) ||
    operation.leaseToken !== request.leaseToken
  ) {
    return { ok: false, status: "mismatch" };
  }
  const participant = state.participants[request.participantId];
  if (participant !== undefined) touchParticipant(state, participant, nowMs);

  if (request.action === "inspect") {
    if (
      operation.status === "lease-issued" ||
      operation.status === "execution-waiting"
    ) {
      return { ok: true, status: "valid" };
    }
    return {
      ok: false,
      status:
        operation.status === "in-flight" ? "already-consumed" : "expired",
    };
  }
  if (request.action === "release-upload") {
    if (operation.status === "lease-issued") {
      terminalizeOperation(operation, "cancelled", nowMs);
      markChanged(state);
      return { ok: true, status: "released" };
    }
    return {
      ok: false,
      status:
        operation.status === "execution-waiting" ||
        operation.status === "in-flight"
          ? "already-consumed"
          : "expired",
    };
  }
  if (request.action === "consume") {
    const tokenReservation = request.tokenReservation ?? 1;
    if (
      !Number.isSafeInteger(tokenReservation) ||
      tokenReservation <= 0 ||
      tokenReservation > AI_QUOTA_MAX_TOKEN_RESERVATION
    ) {
      return { ok: false, status: "not-ready", retryAfterMs: 60_000 };
    }
    if (operation.status === "in-flight") {
      return { ok: false, status: "already-consumed" };
    }
    if (
      operation.status !== "lease-issued" &&
      operation.status !== "execution-waiting"
    ) {
      return { ok: false, status: "expired" };
    }
    if (
      operation.tokenReservation !== null &&
      operation.tokenReservation !== tokenReservation
    ) {
      return { ok: false, status: "mismatch" };
    }
    if (operation.status === "lease-issued") {
      operation.status = "execution-waiting";
      operation.updatedAtMs = nowMs;
      operation.leaseExpiresAtMs = null;
      operation.tokenReservation = tokenReservation;
      markChanged(state);
    } else {
      touchWaitingOperation(state, operation, nowMs);
    }
    return tryStartExecution(state, operation, nowMs);
  }
  if (operation.status !== "in-flight") {
    return { ok: false, status: "not-in-flight" };
  }

  operation.status =
    request.outcome === "succeeded"
      ? "succeeded"
      : request.outcome === "rate-limited"
        ? "rate-limited"
        : request.outcome === "outcome-unknown"
          ? "outcome-unknown"
          : "failed";
  operation.updatedAtMs = nowMs;
  operation.leaseToken = null;
  operation.leaseExpiresAtMs = null;
  if (request.outcome === "rate-limited") {
    const providerGate = providerGateForPool(request.pool);
    const retryAfterMs = Math.min(
      AI_QUOTA_MAX_PROVIDER_BACKOFF_MS,
      Math.max(1_000, request.retryAfterMs ?? 1_000),
    );
    state.providerGates[providerGate].nextGrantAtMs = Math.max(
      state.providerGates[providerGate].nextGrantAtMs,
      nowMs + retryAfterMs,
    );
  }
  markChanged(state);
  return { ok: true, status: "completed" };
}

export function inspectAiQuotaState(
  state: AiQuotaCoordinatorState,
  nowMs: number,
): Readonly<{
  activeParticipantCount: number;
  pools: Readonly<
    Record<
      AiQuotaPool,
      {
        readonly inFlightCount: number;
        readonly queuedCount: number;
        readonly nextGrantAtMs: number;
      }
    >
  >;
}> {
  cleanupExpiredState(state, nowMs);
  const poolSummary = (pool: AiQuotaPool) => ({
    inFlightCount: poolInFlightCount(state, pool),
    queuedCount: Object.values(state.operations).filter(
      (operation) =>
        operation.pool === pool &&
        (operation.status === "queued" ||
          operation.status === "execution-waiting"),
    ).length,
    nextGrantAtMs:
      state.providerGates[providerGateForPool(pool)].nextGrantAtMs,
  });
  return {
    activeParticipantCount: activeParticipantCount(state),
    pools: {
      transcript: poolSummary("transcript"),
      candidate: poolSummary("candidate"),
      context: poolSummary("context"),
    },
  };
}
