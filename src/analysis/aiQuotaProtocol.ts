export const AI_QUOTA_SCHEMA_VERSION = "1.0.0" as const;
export const AI_QUOTA_ENDPOINT_PATH = "/v1/ai-quota" as const;
export const AI_QUOTA_PROXY_ENDPOINT =
  "https://rettohighlight-gemini.11qaws.workers.dev/v1/ai-quota" as const;

export const AI_QUOTA_PARTICIPANT_HEADER =
  "X-ExClipper-Quota-Participant" as const;
export const AI_QUOTA_RUN_HEADER = "X-ExClipper-Quota-Run" as const;
export const AI_QUOTA_OPERATION_HEADER =
  "X-ExClipper-Quota-Operation" as const;
export const AI_QUOTA_PAYLOAD_DIGEST_HEADER =
  "X-ExClipper-Quota-Payload-Digest" as const;
export const AI_QUOTA_LEASE_HEADER = "X-ExClipper-Quota-Lease" as const;

export const AI_QUOTA_MAX_ACTIVE_PARTICIPANTS = 5 as const;
export const AI_QUOTA_MAX_PUBLIC_REQUEST_BYTES = 2_048 as const;

export type AiQuotaPool = "transcript" | "candidate" | "context";

export interface AiQuotaOperationIdentity {
  readonly participantId: string;
  readonly runId: string;
  readonly operationId: string;
  readonly pool: AiQuotaPool;
  readonly payloadDigest: string;
}

export interface AiQuotaLeaseRequest extends AiQuotaOperationIdentity {
  readonly schemaVersion: typeof AI_QUOTA_SCHEMA_VERSION;
  readonly action: "lease";
}

export interface AiQuotaCancelRequest extends AiQuotaOperationIdentity {
  readonly schemaVersion: typeof AI_QUOTA_SCHEMA_VERSION;
  readonly action: "cancel";
}

export type AiQuotaPublicRequest = AiQuotaLeaseRequest | AiQuotaCancelRequest;

export interface AiQuotaGrantedResponse {
  readonly schemaVersion: typeof AI_QUOTA_SCHEMA_VERSION;
  readonly status: "granted";
  readonly leaseToken: string;
  readonly leaseExpiresAtMs: number;
  readonly retryAfterMs: 0;
  readonly activeParticipantCount: number;
  readonly poolInFlightCount: number;
}

export interface AiQuotaQueuedResponse {
  readonly schemaVersion: typeof AI_QUOTA_SCHEMA_VERSION;
  readonly status: "queued";
  readonly retryAfterMs: number;
  readonly activeParticipantCount: number;
  readonly poolInFlightCount: number;
}

export interface AiQuotaCapacityFullResponse {
  readonly schemaVersion: typeof AI_QUOTA_SCHEMA_VERSION;
  readonly status: "capacity-full";
  readonly retryAfterMs: number;
  readonly activeParticipantCount: typeof AI_QUOTA_MAX_ACTIVE_PARTICIPANTS;
  readonly poolInFlightCount: number;
}

export interface AiQuotaConflictResponse {
  readonly schemaVersion: typeof AI_QUOTA_SCHEMA_VERSION;
  readonly status: "conflict" | "queue-full" | "terminal";
  readonly reason:
    | "RUN_CONFLICT"
    | "OPERATION_CONFLICT"
    | "PARTICIPANT_QUEUE_FULL"
    | "OPERATION_ALREADY_FINISHED";
  readonly retryAfterMs: number;
  readonly activeParticipantCount: number;
  readonly poolInFlightCount: number;
}

export interface AiQuotaCancelledResponse {
  readonly schemaVersion: typeof AI_QUOTA_SCHEMA_VERSION;
  readonly status: "cancelled";
  readonly retryAfterMs: 0;
  readonly activeParticipantCount: number;
  readonly poolInFlightCount: number;
}

export type AiQuotaPublicResponse =
  | AiQuotaGrantedResponse
  | AiQuotaQueuedResponse
  | AiQuotaCapacityFullResponse
  | AiQuotaConflictResponse
  | AiQuotaCancelledResponse;

export interface AiQuotaLeaseHeaders extends AiQuotaOperationIdentity {
  readonly leaseToken: string;
}

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/u;
const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9_-]{16,96}$/u;
const PAYLOAD_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const LEASE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAiQuotaPool(value: unknown): value is AiQuotaPool {
  return value === "transcript" || value === "candidate" || value === "context";
}

export function isAiQuotaParticipantId(value: unknown): value is string {
  return typeof value === "string" && PARTICIPANT_ID_PATTERN.test(value);
}

export function isAiQuotaOpaqueId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_ID_PATTERN.test(value);
}

export function isAiQuotaPayloadDigest(value: unknown): value is string {
  return typeof value === "string" && PAYLOAD_DIGEST_PATTERN.test(value);
}

export function isAiQuotaLeaseToken(value: unknown): value is string {
  return typeof value === "string" && LEASE_TOKEN_PATTERN.test(value);
}

export function isAiQuotaOperationIdentity(
  value: unknown,
): value is AiQuotaOperationIdentity {
  return (
    isRecord(value) &&
    isAiQuotaParticipantId(value.participantId) &&
    isAiQuotaOpaqueId(value.runId) &&
    isAiQuotaOpaqueId(value.operationId) &&
    isAiQuotaPool(value.pool) &&
    isAiQuotaPayloadDigest(value.payloadDigest)
  );
}

export function parseAiQuotaPublicRequest(
  value: unknown,
): AiQuotaPublicRequest | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== AI_QUOTA_SCHEMA_VERSION ||
    (value.action !== "lease" && value.action !== "cancel") ||
    !isAiQuotaOperationIdentity(value)
  ) {
    return null;
  }
  const exactKeys = [
    "schemaVersion",
    "action",
    "participantId",
    "runId",
    "operationId",
    "pool",
    "payloadDigest",
  ].sort();
  const actualKeys = Object.keys(value).sort();
  if (
    actualKeys.length !== exactKeys.length ||
    !actualKeys.every((key, index) => key === exactKeys[index])
  ) {
    return null;
  }
  return {
    schemaVersion: AI_QUOTA_SCHEMA_VERSION,
    action: value.action,
    participantId: value.participantId,
    runId: value.runId,
    operationId: value.operationId,
    pool: value.pool,
    payloadDigest: value.payloadDigest,
  };
}

export function readAiQuotaLeaseHeaders(
  headers: Headers,
  expectedPool: AiQuotaPool,
): AiQuotaLeaseHeaders | null {
  const value = {
    participantId: headers.get(AI_QUOTA_PARTICIPANT_HEADER),
    runId: headers.get(AI_QUOTA_RUN_HEADER),
    operationId: headers.get(AI_QUOTA_OPERATION_HEADER),
    pool: expectedPool,
    payloadDigest: headers.get(AI_QUOTA_PAYLOAD_DIGEST_HEADER),
    leaseToken: headers.get(AI_QUOTA_LEASE_HEADER),
  };
  if (
    !isAiQuotaOperationIdentity(value) ||
    !isAiQuotaLeaseToken(value.leaseToken)
  ) {
    return null;
  }
  return {
    participantId: value.participantId,
    runId: value.runId,
    operationId: value.operationId,
    pool: value.pool,
    payloadDigest: value.payloadDigest,
    leaseToken: value.leaseToken,
  };
}

export function aiQuotaLeaseHeaders(
  lease: AiQuotaLeaseHeaders,
): Readonly<Record<string, string>> {
  return {
    [AI_QUOTA_PARTICIPANT_HEADER]: lease.participantId,
    [AI_QUOTA_RUN_HEADER]: lease.runId,
    [AI_QUOTA_OPERATION_HEADER]: lease.operationId,
    [AI_QUOTA_PAYLOAD_DIGEST_HEADER]: lease.payloadDigest,
    [AI_QUOTA_LEASE_HEADER]: lease.leaseToken,
  };
}
