import {
  MAX_BROADCAST_CONTEXT_DEEPSEEK_RESPONSE_BYTES,
  buildBroadcastContextDeepseekRequestBody,
  buildBroadcastContextQwenRequestBody,
  extractBroadcastContextDeepseekResponse,
  extractBroadcastContextQwenOverviewResponse,
  parseCurrentBroadcastContextResult,
} from "../analysis/broadcastContextDeepseek";
import {
  BroadcastContextInputError,
  createBroadcastContextRequest,
  type BroadcastContextRequest,
  type BroadcastContextRequestInput,
  type BroadcastContextResult,
} from "../analysis/broadcastContextProtocol";
import { AI_BROADCAST_CONTEXT_ROUTING_REVISION } from "../analysis/aiModelRoutingPolicy";
import { AMORETTO_CHANNEL_CAST_ROSTER_ID } from "../analysis/participantRoster";
import {
  QWEN_CONTEXT_MODEL_ID,
  QWEN_CONTEXT_MODEL_REVISION,
  resolveBroadcastContextConnection,
  type BroadcastContextConnection,
} from "./aiProviderConfiguration";

export const PREANALYSIS_CONTEXT_ENDPOINT_PATH =
  "/v1/broadcast-context" as const;
export const PREANALYSIS_CONTEXT_ORIGIN =
  "https://11qaws.github.io" as const;
export const PREANALYSIS_CONTEXT_OPERATION_HEADER =
  "X-ExClipper-Preanalysis-Operation" as const;
export const PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER =
  "X-ExClipper-Preanalysis-Payload-Digest" as const;
export const PREANALYSIS_CONTEXT_CACHE_HEADER =
  "X-ExClipper-Preanalysis-Cache" as const;
export const PREANALYSIS_CONTEXT_ATTEMPT_HEADER =
  "X-ExClipper-Preanalysis-Attempt" as const;
export const PREANALYSIS_CONTEXT_RETRY_RISK_HEADER =
  "X-ExClipper-Preanalysis-Retry-Risk" as const;
export const PREANALYSIS_CONTEXT_MODEL_ID_HEADER =
  "X-ExClipper-Model-Id" as const;
export const PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER =
  "X-ExClipper-Model-Revision" as const;
export const PREANALYSIS_CONTEXT_CONTRACT_HEADER =
  "X-ExClipper-Preanalysis-Contract" as const;
export const PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER =
  "X-ExClipper-Routing-Revision" as const;
export const PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER =
  "X-ExClipper-Expected-Model-Id" as const;
export const PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER =
  "X-ExClipper-Expected-Model-Revision" as const;
export const PREANALYSIS_CONTEXT_PROXY_VERSION = "2.0.0" as const;
export const PREANALYSIS_CONTEXT_OPERATION_GENERATION = 2 as const;
export const PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID =
  QWEN_CONTEXT_MODEL_ID;
export const PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION =
  QWEN_CONTEXT_MODEL_REVISION;

const OPERATION_STORAGE_KEY = "operation-state";
const OPERATION_QUARANTINE_STORAGE_KEY =
  `operation-state-quarantine-v${PREANALYSIS_CONTEXT_OPERATION_GENERATION}`;
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;
const MAX_TERMINAL_BODY_BYTES =
  MAX_BROADCAST_CONTEXT_DEEPSEEK_RESPONSE_BYTES;
const REQUEST_BODY_TIMEOUT_MS = 30_000;
const UPSTREAM_TIMEOUT_MS = 90_000;
const RUNNING_STALE_AFTER_MS = 2 * 60_000;
const RETRY_BACKOFF_BASE_MS = 30_000;
const RETRY_BACKOFF_MAX_MS = 3 * 60 * 60_000;
const OPERATION_ID_PATTERN = /^amoretto-context-[0-9a-f]{64}$/u;
const PAYLOAD_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const AUTHORIZATION_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{24,512}$/u;
const ALLOWED_REQUEST_KEYS = new Set([
  "sourceDurationMs",
  "chapters",
  "candidates",
  "castRosterId",
  "participantGrounding",
  "outputLanguage",
]);

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}

interface DurableObjectStateLike {
  readonly storage: DurableObjectStorageLike;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

interface DurableObjectStubLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}

interface PreanalysisRateLimitBinding {
  limit(options: {
    readonly key: string;
  }): Promise<{ readonly success: boolean }>;
}

export interface PreanalysisContextProxyEnvironment {
  readonly PREANALYSIS_CONTEXT_TOKEN?: string;
  readonly PREANALYSIS_CONTEXT_PROVIDER?: string;
  readonly PREANALYSIS_QWEN_API_KEY?: string;
  readonly PREANALYSIS_QWEN_WORKSPACE_ID?: string;
  readonly PREANALYSIS_QWEN_REGION?: string;
  readonly PREANALYSIS_DEEPSEEK_API_KEY?: string;
  readonly PREANALYSIS_CONTEXT_OPERATIONS: DurableObjectNamespaceLike;
  readonly PREANALYSIS_CONTEXT_RATE_LIMITER?: PreanalysisRateLimitBinding;
}

export interface PreanalysisContextProxyDependencies {
  readonly fetchImplementation?: FetchImplementation;
  readonly requestBodyTimeoutMs?: number;
  readonly upstreamTimeoutMs?: number;
  readonly now?: () => number;
}

interface StoredTerminalResponse {
  readonly status: number;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

type StoredOperationPhase =
  | "running"
  | "retryable"
  | "succeeded";

interface StoredRetryCheckpoint {
  readonly code: string;
  readonly nextAttemptAtMs: number;
  readonly possibleDuplicateProviderCharge: boolean;
}

interface StoredPreanalysisContextOperation {
  readonly schemaVersion: typeof PREANALYSIS_CONTEXT_PROXY_VERSION;
  readonly generation: typeof PREANALYSIS_CONTEXT_OPERATION_GENERATION;
  readonly operationId: string;
  readonly payloadDigest: string;
  readonly phase: StoredOperationPhase;
  readonly attempt: number;
  readonly updatedAtMs: number;
  readonly terminal: StoredTerminalResponse | null;
  readonly retry: StoredRetryCheckpoint | null;
}

interface QuarantinedOperationCheckpoint {
  readonly schemaVersion: typeof PREANALYSIS_CONTEXT_PROXY_VERSION;
  readonly generation: typeof PREANALYSIS_CONTEXT_OPERATION_GENERATION;
  readonly quarantinedAtMs: number;
  readonly replacementOperationId: string;
  readonly replacementPayloadDigest: string;
  readonly observedOperationId: string | null;
  readonly observedPayloadDigest: string | null;
  readonly reason: "unsupported-or-malformed-checkpoint";
}

interface InvalidStoredOperationIdentity {
  readonly operationId: string | null;
  readonly payloadDigest: string | null;
  readonly attempt: number;
  readonly possibleDuplicateProviderCharge: boolean;
}

type ProviderAttempt =
  | {
      readonly kind: "success";
      readonly result: BroadcastContextResult;
      readonly modelId: string;
      readonly modelRevision: string;
    }
  | {
      readonly kind: "failure";
      readonly response: Response;
      readonly code: string;
      readonly possibleDuplicateProviderCharge: boolean;
    };

class BodyLimitError extends Error {}
class BodyTimeoutError extends Error {}
class UpstreamTimeoutError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function mediaType(request: Request): string {
  return (request.headers.get("Content-Type") ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase() ?? "";
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
      },
    },
    status,
    extraHeaders,
  );
}

function jsonResponse(
  payload: unknown,
  status = 200,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": JSON_CONTENT_TYPE,
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

async function readBodyWithLimit(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
  timeoutMs: number,
): Promise<Uint8Array> {
  if (body === null) throw new SyntaxError("Request body is missing.");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel("body deadline exceeded").catch(() => undefined);
  }, timeoutMs);
  try {
    while (true) {
      const result = await reader.read();
      if (timedOut) throw new BodyTimeoutError();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel("body too large").catch(() => undefined);
        throw new BodyLimitError();
      }
      chunks.push(result.value);
    }
  } catch (error) {
    if (timedOut) throw new BodyTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  if (timedOut) throw new BodyTimeoutError();

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const stableBytes = new Uint8Array(bytes.byteLength);
  stableBytes.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stableBytes);
  stableBytes.fill(0);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

export async function createPreanalysisContextOperationId(
  payloadDigest: string,
): Promise<string> {
  if (!PAYLOAD_DIGEST_PATTERN.test(payloadDigest)) {
    throw new TypeError("The preanalysis payload digest is invalid.");
  }
  const namespace = JSON.stringify([
    "exclipper-amoretto-preanalysis-context",
    PREANALYSIS_CONTEXT_PROXY_VERSION,
    PREANALYSIS_CONTEXT_OPERATION_GENERATION,
    AI_BROADCAST_CONTEXT_ROUTING_REVISION,
    PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID,
    PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION,
    payloadDigest,
  ]);
  const digest = await sha256Hex(new TextEncoder().encode(namespace));
  return `amoretto-context-${digest}`;
}

async function constantTimeTextMatches(
  supplied: string,
  expected: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [suppliedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const suppliedBytes = new Uint8Array(suppliedDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < suppliedBytes.byteLength; index += 1) {
    difference |= suppliedBytes[index]! ^ expectedBytes[index]!;
  }
  return difference === 0;
}

function hasExactScheduledRequestKeys(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === ALLOWED_REQUEST_KEYS.size &&
    keys.every((key) => ALLOWED_REQUEST_KEYS.has(key))
  );
}

function parseScheduledContextRequest(
  bytes: Uint8Array,
): BroadcastContextRequest | null {
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    return null;
  }
  if (!hasExactScheduledRequestKeys(value)) return null;
  try {
    const request = createBroadcastContextRequest(
      value as BroadcastContextRequestInput,
    );
    if (
      request.candidates.length !== 0 ||
      request.castRosterId !== AMORETTO_CHANNEL_CAST_ROSTER_ID ||
      request.outputLanguage !== "ko"
    ) {
      return null;
    }
    return request;
  } catch (error) {
    if (error instanceof BroadcastContextInputError) return null;
    throw error;
  }
}

function resolveDedicatedProvider(
  environment: PreanalysisContextProxyEnvironment,
): Exclude<BroadcastContextConnection, { readonly provider: "disabled" }> | null {
  const resolution = resolveBroadcastContextConnection({
    BROADCAST_CONTEXT_PROVIDER:
      environment.PREANALYSIS_CONTEXT_PROVIDER ?? "disabled",
    ...(environment.PREANALYSIS_QWEN_API_KEY === undefined
      ? {}
      : { QWEN_API_KEY: environment.PREANALYSIS_QWEN_API_KEY }),
    ...(environment.PREANALYSIS_QWEN_WORKSPACE_ID === undefined
      ? {}
      : { QWEN_WORKSPACE_ID: environment.PREANALYSIS_QWEN_WORKSPACE_ID }),
    ...(environment.PREANALYSIS_QWEN_REGION === undefined
      ? {}
      : { QWEN_REGION: environment.PREANALYSIS_QWEN_REGION }),
    ...(environment.PREANALYSIS_DEEPSEEK_API_KEY === undefined
      ? {}
      : { DEEPSEEK_API_KEY: environment.PREANALYSIS_DEEPSEEK_API_KEY }),
  });
  if (!resolution.ok || resolution.connection.provider === "disabled") {
    return null;
  }
  return resolution.connection;
}

async function fetchWithTimeout(
  fetchImplementation: FetchImplementation,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  consume: (
    response: Response,
    remainingMs: () => number,
  ) => Promise<ProviderAttempt>,
): Promise<ProviderAttempt> {
  const controller = new AbortController();
  const deadlineMs = Date.now() + timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImplementation(input, {
      ...init,
      signal: controller.signal,
    });
    if (controller.signal.aborted) throw new UpstreamTimeoutError();
    return await consume(response, () => {
      const remaining = deadlineMs - Date.now();
      if (remaining <= 0 || controller.signal.aborted) {
        throw new UpstreamTimeoutError();
      }
      return remaining;
    });
  } catch (error) {
    if (controller.signal.aborted) throw new UpstreamTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function attemptProvider(
  connection: Exclude<
    BroadcastContextConnection,
    { readonly provider: "disabled" }
  >,
  request: BroadcastContextRequest,
  fetchImplementation: FetchImplementation,
  upstreamTimeoutMs: number,
): Promise<ProviderAttempt> {
  const modelId =
    connection.provider === "qwen"
      ? QWEN_CONTEXT_MODEL_ID
      : connection.descriptor.modelId;
  const modelRevision =
    connection.provider === "qwen"
      ? QWEN_CONTEXT_MODEL_REVISION
      : connection.descriptor.modelRevision;
  let body: string;
  try {
    body = JSON.stringify(
      connection.provider === "qwen"
        ? buildBroadcastContextQwenRequestBody(
            request,
            modelId,
            "overview",
          )
        : buildBroadcastContextDeepseekRequestBody(request, modelId),
    );
  } catch {
    return {
      kind: "failure",
      response: errorResponse(
        400,
        "INVALID_PROVIDER_REQUEST",
        "The bounded context request could not be prepared.",
      ),
      code: "INVALID_PROVIDER_REQUEST",
      possibleDuplicateProviderCharge: false,
    };
  }

  try {
    return await fetchWithTimeout(
      fetchImplementation,
      connection.endpoint,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${connection.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      },
      upstreamTimeoutMs,
      async (response, remainingMs) => {
        if (!response.ok) {
          const status = response.status;
          await response.body?.cancel().catch(() => undefined);
          if (status === 429 || (status >= 500 && status <= 599)) {
            const code =
              status === 429
                ? "UPSTREAM_RATE_LIMITED"
                : "UPSTREAM_UNAVAILABLE";
            return {
              kind: "failure",
              response: errorResponse(
                status === 429 ? 429 : 503,
                code,
                "The dedicated provider is temporarily unavailable.",
                status === 429 ? { "Retry-After": "60" } : {},
              ),
              code,
              possibleDuplicateProviderCharge: status >= 500,
            };
          }
          const code =
            status === 401 || status === 403
              ? "UPSTREAM_AUTH_FAILED"
              : status === 404
                ? "UPSTREAM_MODEL_UNAVAILABLE"
                : "UPSTREAM_REJECTED";
          return {
            kind: "failure",
            response: errorResponse(
              502,
              code,
              "The dedicated provider rejected the bounded request.",
            ),
            code,
            possibleDuplicateProviderCharge: false,
          };
        }

        let payload: unknown;
        try {
          const bytes = await readBodyWithLimit(
            response.body,
            MAX_BROADCAST_CONTEXT_DEEPSEEK_RESPONSE_BYTES,
            remainingMs(),
          );
          try {
            payload = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            ) as unknown;
          } finally {
            bytes.fill(0);
          }
        } catch (error) {
          if (
            error instanceof BodyTimeoutError ||
            error instanceof UpstreamTimeoutError
          ) {
            throw new UpstreamTimeoutError();
          }
          return {
            kind: "failure",
            response: errorResponse(
              502,
              "UPSTREAM_INVALID_RESPONSE",
              "The provider response could not be verified.",
            ),
            code: "UPSTREAM_INVALID_RESPONSE",
            possibleDuplicateProviderCharge: true,
          };
        }

        const parsed =
          connection.provider === "qwen"
            ? extractBroadcastContextQwenOverviewResponse(payload, request)
            : extractBroadcastContextDeepseekResponse(payload, request);
        if (!parsed.ok) {
          return {
            kind: "failure",
            response: errorResponse(
              502,
              "UPSTREAM_INVALID_RESPONSE",
              "The provider response did not satisfy the current context schema.",
            ),
            code: "UPSTREAM_INVALID_RESPONSE",
            possibleDuplicateProviderCharge: true,
          };
        }
        return {
          kind: "success",
          result: parsed.result,
          modelId,
          modelRevision,
        };
      },
    );
  } catch {
    return {
      kind: "failure",
      response: errorResponse(
        502,
        "UPSTREAM_OUTCOME_UNKNOWN",
        "The provider outcome is unknown. A later bounded retry may repeat the provider charge.",
      ),
      code: "UPSTREAM_OUTCOME_UNKNOWN",
      possibleDuplicateProviderCharge: true,
    };
  }
}

function isStoredTerminalResponse(
  value: unknown,
): value is StoredTerminalResponse {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["status", "body", "headers"]) ||
    !Number.isSafeInteger(value.status) ||
    value.status !== 200 ||
    typeof value.body !== "string" ||
    new TextEncoder().encode(value.body).byteLength > MAX_TERMINAL_BODY_BYTES ||
    !isRecord(value.headers)
  ) {
    return false;
  }
  return Object.entries(value.headers).every(
    ([key, item]) =>
      key.length <= 80 &&
      typeof item === "string" &&
      item.length <= 512,
  );
}

function isStoredOperation(
  value: unknown,
): value is StoredPreanalysisContextOperation {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "schemaVersion",
      "generation",
      "operationId",
      "payloadDigest",
      "phase",
      "attempt",
      "updatedAtMs",
      "terminal",
      "retry",
    ]) &&
    value.schemaVersion === PREANALYSIS_CONTEXT_PROXY_VERSION &&
    value.generation === PREANALYSIS_CONTEXT_OPERATION_GENERATION &&
    typeof value.operationId === "string" &&
    OPERATION_ID_PATTERN.test(value.operationId) &&
    typeof value.payloadDigest === "string" &&
    PAYLOAD_DIGEST_PATTERN.test(value.payloadDigest) &&
    ["running", "retryable", "succeeded"].includes(
      typeof value.phase === "string" ? value.phase : "",
    ) &&
    Number.isSafeInteger(value.attempt) &&
    (value.attempt as number) >= 1 &&
    Number.isSafeInteger(value.updatedAtMs) &&
    (value.updatedAtMs as number) >= 0 &&
    ((value.phase === "succeeded" &&
      isStoredTerminalResponse(value.terminal)) ||
      (value.phase !== "succeeded" && value.terminal === null)) &&
    ((value.phase === "retryable" &&
      isStoredRetryCheckpoint(value.retry)) ||
      (value.phase !== "retryable" && value.retry === null))
  );
}

function isStoredRetryCheckpoint(
  value: unknown,
): value is StoredRetryCheckpoint {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "code",
      "nextAttemptAtMs",
      "possibleDuplicateProviderCharge",
    ]) &&
    typeof value.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/u.test(value.code) &&
    Number.isSafeInteger(value.nextAttemptAtMs) &&
    (value.nextAttemptAtMs as number) >= 0 &&
    typeof value.possibleDuplicateProviderCharge === "boolean"
  );
}

function invalidStoredOperationIdentity(
  value: unknown,
): InvalidStoredOperationIdentity {
  if (!isRecord(value)) {
    return {
      operationId: null,
      payloadDigest: null,
      attempt: 0,
      possibleDuplicateProviderCharge: false,
    };
  }
  const attempt =
    Number.isSafeInteger(value.attempt) && (value.attempt as number) >= 1
      ? (value.attempt as number)
      : 0;
  const retry = isRecord(value.retry) ? value.retry : null;
  return {
    operationId:
      typeof value.operationId === "string" &&
      OPERATION_ID_PATTERN.test(value.operationId)
        ? value.operationId
        : null,
    payloadDigest:
      typeof value.payloadDigest === "string" &&
      PAYLOAD_DIGEST_PATTERN.test(value.payloadDigest)
        ? value.payloadDigest
        : null,
    attempt,
    possibleDuplicateProviderCharge:
      value.phase === "succeeded" ||
      value.phase === "running" ||
      retry?.possibleDuplicateProviderCharge === true,
  };
}

function storedTerminalMatchesCurrentRequest(
  terminal: StoredTerminalResponse,
  request: BroadcastContextRequest,
): boolean {
  const headers = terminal.headers;
  if (
    terminal.status !== 200 ||
    mediaType(
      new Request("https://stored.invalid", {
        headers: {
          "Content-Type": headers["Content-Type"] ?? "",
        },
      }),
    ) !== "application/json" ||
    headers[PREANALYSIS_CONTEXT_CONTRACT_HEADER] !==
      PREANALYSIS_CONTEXT_PROXY_VERSION ||
    headers[PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER] !==
      AI_BROADCAST_CONTEXT_ROUTING_REVISION ||
    headers[PREANALYSIS_CONTEXT_MODEL_ID_HEADER] !==
      PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID ||
    headers[PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER] !==
      PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION ||
    !/^[1-9][0-9]{0,8}$/u.test(
      headers[PREANALYSIS_CONTEXT_ATTEMPT_HEADER] ?? "",
    ) ||
    !(
      headers[PREANALYSIS_CONTEXT_RETRY_RISK_HEADER] === undefined ||
      headers[PREANALYSIS_CONTEXT_RETRY_RISK_HEADER] ===
        "possible-duplicate-provider-charge"
    )
  ) {
    return false;
  }
  const bytes = new TextEncoder().encode(terminal.body);
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_TERMINAL_BODY_BYTES
  ) {
    return false;
  }
  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  } finally {
    bytes.fill(0);
  }
  if (body !== terminal.body) return false;
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }
  return parseCurrentBroadcastContextResult(payload, request) !== null;
}

async function responseToStoredTerminal(
  response: Response,
): Promise<StoredTerminalResponse> {
  const bytes = await readBodyWithLimit(
    response.body,
    MAX_TERMINAL_BODY_BYTES,
    REQUEST_BODY_TIMEOUT_MS,
  );
  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    bytes.fill(0);
  }
  const headers: Record<string, string> = {};
  for (const name of [
    "Content-Type",
    "Retry-After",
    PREANALYSIS_CONTEXT_CONTRACT_HEADER,
    PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER,
    PREANALYSIS_CONTEXT_MODEL_ID_HEADER,
    PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER,
    PREANALYSIS_CONTEXT_ATTEMPT_HEADER,
    PREANALYSIS_CONTEXT_RETRY_RISK_HEADER,
  ]) {
    const value = response.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return {
    status: response.status,
    body,
    headers,
  };
}

function replayStoredTerminal(
  terminal: StoredTerminalResponse,
  cacheStatus: "hit" | "miss" = "hit",
): Response {
  return new Response(terminal.body, {
    status: terminal.status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type":
        terminal.headers["Content-Type"] ?? JSON_CONTENT_TYPE,
      "X-Content-Type-Options": "nosniff",
      [PREANALYSIS_CONTEXT_CACHE_HEADER]: cacheStatus,
      ...(terminal.headers[PREANALYSIS_CONTEXT_CONTRACT_HEADER] === undefined
        ? {}
        : {
            [PREANALYSIS_CONTEXT_CONTRACT_HEADER]:
              terminal.headers[PREANALYSIS_CONTEXT_CONTRACT_HEADER],
          }),
      ...(terminal.headers[PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER] ===
      undefined
        ? {}
        : {
            [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]:
              terminal.headers[PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER],
          }),
      ...(terminal.headers["Retry-After"] === undefined
        ? {}
        : { "Retry-After": terminal.headers["Retry-After"] }),
      ...(terminal.headers[PREANALYSIS_CONTEXT_MODEL_ID_HEADER] === undefined
        ? {}
        : {
            [PREANALYSIS_CONTEXT_MODEL_ID_HEADER]:
              terminal.headers[PREANALYSIS_CONTEXT_MODEL_ID_HEADER],
          }),
      ...(terminal.headers[PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER] ===
      undefined
        ? {}
        : {
            [PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER]:
              terminal.headers[PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER],
          }),
      ...(terminal.headers[PREANALYSIS_CONTEXT_ATTEMPT_HEADER] === undefined
        ? {}
        : {
            [PREANALYSIS_CONTEXT_ATTEMPT_HEADER]:
              terminal.headers[PREANALYSIS_CONTEXT_ATTEMPT_HEADER],
          }),
      ...(terminal.headers[PREANALYSIS_CONTEXT_RETRY_RISK_HEADER] ===
      undefined
        ? {}
        : {
            [PREANALYSIS_CONTEXT_RETRY_RISK_HEADER]:
              terminal.headers[PREANALYSIS_CONTEXT_RETRY_RISK_HEADER],
          }),
    },
  });
}

function operationConflictResponse(): Response {
  return errorResponse(
    409,
    "OPERATION_PAYLOAD_CONFLICT",
    "The operation ID is already bound to different exact bytes.",
  );
}

function retryBackoffMs(attempt: number): number {
  const exponent = Math.min(12, Math.max(0, attempt - 1));
  return Math.min(
    RETRY_BACKOFF_MAX_MS,
    RETRY_BACKOFF_BASE_MS * 2 ** exponent,
  );
}

function withRetryCheckpointHeaders(
  response: Response,
  retryDelayMs: number,
  possibleDuplicateProviderCharge: boolean,
  attempt: number,
): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": response.headers.get("Content-Type") ?? JSON_CONTENT_TYPE,
    "Retry-After": String(Math.max(1, Math.ceil(retryDelayMs / 1_000))),
    "X-Content-Type-Options": "nosniff",
    [PREANALYSIS_CONTEXT_ATTEMPT_HEADER]: String(attempt),
  });
  if (possibleDuplicateProviderCharge) {
    headers.set(
      PREANALYSIS_CONTEXT_RETRY_RISK_HEADER,
      "possible-duplicate-provider-charge",
    );
  }
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

function internalOperationRequestIsValid(request: Request): boolean {
  return (
    request.method === "POST" &&
    new URL(request.url).pathname === "/execute" &&
    mediaType(request) === "application/json" &&
    request.headers.get(PREANALYSIS_CONTEXT_CONTRACT_HEADER) ===
      PREANALYSIS_CONTEXT_PROXY_VERSION &&
    request.headers.get(PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER) ===
      AI_BROADCAST_CONTEXT_ROUTING_REVISION &&
    request.headers.get(PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER) ===
      PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID &&
    request.headers.get(
      PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER,
    ) === PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION
  );
}

/**
 * One Durable Object instance owns one stable scheduled operation. It stores no
 * API secret or source video bytes: only the request digest and bounded terminal
 * JSON needed to make retries idempotent.
 */
export class PreanalysisContextOperation {
  private state: StoredPreanalysisContextOperation | null = null;
  private readonly ready: Promise<void>;
  private operationTail: Promise<void> = Promise.resolve();
  private invalidCheckpoint: InvalidStoredOperationIdentity | null = null;

  public constructor(
    private readonly durableState: DurableObjectStateLike,
    private readonly environment: PreanalysisContextProxyEnvironment,
    private readonly dependencies: PreanalysisContextProxyDependencies = {},
  ) {
    this.ready = durableState.blockConcurrencyWhile(async () => {
      const stored = await durableState.storage.get<unknown>(
        OPERATION_STORAGE_KEY,
      );
      if (stored === undefined) return;
      if (!isStoredOperation(stored)) {
        this.invalidCheckpoint = invalidStoredOperationIdentity(stored);
        return;
      }
      this.state = stored;
    });
  }

  public async fetch(request: Request): Promise<Response> {
    await this.ready;
    if (!internalOperationRequestIsValid(request)) {
      return errorResponse(404, "NOT_FOUND", "Not found.");
    }
    const operationId = request.headers.get(
      PREANALYSIS_CONTEXT_OPERATION_HEADER,
    );
    const payloadDigest = request.headers.get(
      PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER,
    );
    if (
      operationId === null ||
      !OPERATION_ID_PATTERN.test(operationId) ||
      payloadDigest === null ||
      !PAYLOAD_DIGEST_PATTERN.test(payloadDigest)
    ) {
      return errorResponse(400, "INVALID_OPERATION", "Invalid operation.");
    }

    let requestBytes: Uint8Array;
    try {
      requestBytes = await readBodyWithLimit(
        request.body,
        MAX_REQUEST_BODY_BYTES,
        this.dependencies.requestBodyTimeoutMs ?? REQUEST_BODY_TIMEOUT_MS,
      );
    } catch (error) {
      return errorResponse(
        error instanceof BodyLimitError ? 413 : 400,
        error instanceof BodyLimitError
          ? "PAYLOAD_TOO_LARGE"
          : "INVALID_REQUEST",
        "The bounded request could not be read.",
      );
    }
    return this.withOperationLock(async () => {
      try {
        return await this.execute(
          operationId,
          payloadDigest,
          requestBytes,
        );
      } finally {
        requestBytes.fill(0);
      }
    });
  }

  private async execute(
    operationId: string,
    payloadDigest: string,
    requestBytes: Uint8Array,
  ): Promise<Response> {
    const actualDigest = `sha256:${await sha256Hex(requestBytes)}`;
    if (actualDigest !== payloadDigest) {
      return errorResponse(
        409,
        "PAYLOAD_DIGEST_MISMATCH",
        "The request bytes do not match the declared digest.",
      );
    }
    const expectedOperationId =
      await createPreanalysisContextOperationId(payloadDigest);
    if (operationId !== expectedOperationId) {
      return errorResponse(
        409,
        "OPERATION_NAMESPACE_MISMATCH",
        "The operation ID is not bound to the current contract and route.",
      );
    }
    const contextRequest = parseScheduledContextRequest(requestBytes);
    if (contextRequest === null) {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "Only the bounded Amoretto transcript-only overview contract is accepted.",
      );
    }
    const invalidCheckpoint = this.invalidCheckpoint;
    if (
      invalidCheckpoint !== null &&
      ((invalidCheckpoint.operationId !== null &&
        invalidCheckpoint.operationId !== operationId) ||
        (invalidCheckpoint.payloadDigest !== null &&
          invalidCheckpoint.payloadDigest !== payloadDigest))
    ) {
      return operationConflictResponse();
    }
    if (invalidCheckpoint !== null) {
      await this.quarantineInvalidCheckpoint(operationId, payloadDigest);
      if (invalidCheckpoint.possibleDuplicateProviderCharge) {
        this.state = {
          schemaVersion: PREANALYSIS_CONTEXT_PROXY_VERSION,
          generation: PREANALYSIS_CONTEXT_OPERATION_GENERATION,
          operationId,
          payloadDigest,
          phase: "retryable",
          attempt: invalidCheckpoint.attempt,
          updatedAtMs: this.now(),
          terminal: null,
          retry: {
            code: "STORED_CHECKPOINT_INVALID",
            nextAttemptAtMs: this.now(),
            possibleDuplicateProviderCharge: true,
          },
        };
        await this.persist();
      }
    }
    if (
      this.state !== null &&
      (this.state.operationId !== operationId ||
        this.state.payloadDigest !== payloadDigest)
    ) {
      return operationConflictResponse();
    }
    if (this.state?.phase === "succeeded" && this.state.terminal !== null) {
      if (
        storedTerminalMatchesCurrentRequest(
          this.state.terminal,
          contextRequest,
        )
      ) {
        return replayStoredTerminal(this.state.terminal);
      }
      const invalidSucceededAttempt = this.state.attempt;
      this.invalidCheckpoint = {
        operationId,
        payloadDigest,
        attempt: invalidSucceededAttempt,
        possibleDuplicateProviderCharge: true,
      };
      await this.quarantineInvalidCheckpoint(operationId, payloadDigest);
      this.state = {
        schemaVersion: PREANALYSIS_CONTEXT_PROXY_VERSION,
        generation: PREANALYSIS_CONTEXT_OPERATION_GENERATION,
        operationId,
        payloadDigest,
        phase: "retryable",
        attempt: invalidSucceededAttempt,
        updatedAtMs: this.now(),
        terminal: null,
        retry: {
          code: "STORED_TERMINAL_INVALID",
          nextAttemptAtMs: this.now(),
          possibleDuplicateProviderCharge: true,
        },
      };
      await this.persist();
    }
    if (this.state?.phase === "running") {
      const retryAtMs = this.state.updatedAtMs + RUNNING_STALE_AFTER_MS;
      if (this.now() < retryAtMs) {
        return errorResponse(
          409,
          "OPERATION_IN_PROGRESS",
          "The same operation is still running.",
          {
            "Retry-After": String(
              Math.max(1, Math.ceil((retryAtMs - this.now()) / 1_000)),
            ),
          },
        );
      }
    }
    if (
      this.state?.phase === "retryable" &&
      this.state.retry !== null &&
      this.now() < this.state.retry.nextAttemptAtMs
    ) {
      return errorResponse(
        503,
        "RETRY_BACKOFF",
        "The operation is checkpointed and will resume after its bounded backoff.",
        {
          "Retry-After": String(
            Math.max(
              1,
              Math.ceil(
                (this.state.retry.nextAttemptAtMs - this.now()) / 1_000,
              ),
            ),
          ),
        },
      );
    }

    const provider = resolveDedicatedProvider(this.environment);
    if (provider === null) {
      return errorResponse(
        503,
        "PROXY_NOT_CONFIGURED",
        "The dedicated provider connection is not configured.",
      );
    }
    if (
      provider.provider !== "qwen" ||
      provider.descriptor.modelId !== PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID ||
      provider.descriptor.modelRevision !==
        PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION
    ) {
      return errorResponse(
        503,
        "PROXY_ROUTE_NOT_CONFIGURED",
        "The dedicated provider does not match the current scheduled route.",
      );
    }
    if (this.environment.PREANALYSIS_CONTEXT_RATE_LIMITER !== undefined) {
      let rateLimit: { readonly success: boolean };
      try {
        rateLimit =
          await this.environment.PREANALYSIS_CONTEXT_RATE_LIMITER.limit({
            key: "scheduled-context",
          });
      } catch {
        return errorResponse(
          503,
          "RATE_LIMIT_UNAVAILABLE",
          "The scheduled request guard is unavailable.",
        );
      }
      if (!rateLimit.success) {
        return errorResponse(
          429,
          "RATE_LIMITED",
          "The scheduled request budget is temporarily full.",
          { "Retry-After": "60" },
        );
      }
    }

    const staleRunningRetry = this.state?.phase === "running";
    const inheritedDuplicateChargeRisk =
      staleRunningRetry ||
      (this.state?.phase === "retryable" &&
        this.state.retry?.possibleDuplicateProviderCharge === true);
    const attempt = (this.state?.attempt ?? 0) + 1;
    this.state = {
      schemaVersion: PREANALYSIS_CONTEXT_PROXY_VERSION,
      generation: PREANALYSIS_CONTEXT_OPERATION_GENERATION,
      operationId,
      payloadDigest,
      phase: "running",
      attempt,
      updatedAtMs: this.now(),
      terminal: null,
      retry: null,
    };
    await this.persist();

    const result = await attemptProvider(
      provider,
      contextRequest,
      this.dependencies.fetchImplementation ?? fetch,
      this.dependencies.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS,
    );
    if (result.kind === "failure") {
      const retryDelayMs = retryBackoffMs(attempt);
      const possibleDuplicateProviderCharge =
        inheritedDuplicateChargeRisk ||
        result.possibleDuplicateProviderCharge;
      this.state = {
        ...this.state,
        phase: "retryable",
        updatedAtMs: this.now(),
        retry: {
          code: result.code,
          nextAttemptAtMs: this.now() + retryDelayMs,
          possibleDuplicateProviderCharge,
        },
      };
      await this.persist();
      return withRetryCheckpointHeaders(
        result.response,
        retryDelayMs,
        possibleDuplicateProviderCharge,
        attempt,
      );
    }

    const response = jsonResponse(result.result, 200, {
      [PREANALYSIS_CONTEXT_CACHE_HEADER]: "miss",
      [PREANALYSIS_CONTEXT_CONTRACT_HEADER]:
        PREANALYSIS_CONTEXT_PROXY_VERSION,
      [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]:
        AI_BROADCAST_CONTEXT_ROUTING_REVISION,
      [PREANALYSIS_CONTEXT_MODEL_ID_HEADER]: result.modelId,
      [PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER]:
        result.modelRevision,
      [PREANALYSIS_CONTEXT_ATTEMPT_HEADER]: String(attempt),
      ...(inheritedDuplicateChargeRisk
        ? {
            [PREANALYSIS_CONTEXT_RETRY_RISK_HEADER]:
              "possible-duplicate-provider-charge",
          }
        : {}),
    });
    const terminal = await responseToStoredTerminal(response);
    this.state = {
      ...this.state,
      phase: "succeeded",
      updatedAtMs: this.now(),
      terminal,
      retry: null,
    };
    await this.persist();
    return replayStoredTerminal(terminal, "miss");
  }

  private now(): number {
    return (this.dependencies.now ?? Date.now)();
  }

  private async persist(): Promise<void> {
    if (this.state === null) return;
    await this.durableState.storage.put(OPERATION_STORAGE_KEY, this.state);
  }

  private async quarantineInvalidCheckpoint(
    operationId: string,
    payloadDigest: string,
  ): Promise<void> {
    if (this.invalidCheckpoint === null) return;
    const quarantine: QuarantinedOperationCheckpoint = {
      schemaVersion: PREANALYSIS_CONTEXT_PROXY_VERSION,
      generation: PREANALYSIS_CONTEXT_OPERATION_GENERATION,
      quarantinedAtMs: this.now(),
      replacementOperationId: operationId,
      replacementPayloadDigest: payloadDigest,
      observedOperationId: this.invalidCheckpoint.operationId,
      observedPayloadDigest: this.invalidCheckpoint.payloadDigest,
      reason: "unsupported-or-malformed-checkpoint",
    };
    await this.durableState.storage.put(
      OPERATION_QUARANTINE_STORAGE_KEY,
      quarantine,
    );
    await this.durableState.storage.delete(OPERATION_STORAGE_KEY);
    this.invalidCheckpoint = null;
    this.state = null;
  }

  private async withOperationLock<T>(
    callback: () => Promise<T>,
  ): Promise<T> {
    const predecessor = this.operationTail;
    let release = (): void => undefined;
    this.operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      return await callback();
    } finally {
      release();
    }
  }
}

function forwardOperationResponse(response: Response): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": response.headers.get("Content-Type") ?? JSON_CONTENT_TYPE,
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of [
    "Retry-After",
    PREANALYSIS_CONTEXT_CACHE_HEADER,
    PREANALYSIS_CONTEXT_CONTRACT_HEADER,
    PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER,
    PREANALYSIS_CONTEXT_MODEL_ID_HEADER,
    PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER,
    PREANALYSIS_CONTEXT_ATTEMPT_HEADER,
    PREANALYSIS_CONTEXT_RETRY_RISK_HEADER,
  ]) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

export async function handlePreanalysisContextProxyRequest(
  request: Request,
  environment: PreanalysisContextProxyEnvironment,
  dependencies: Pick<
    PreanalysisContextProxyDependencies,
    "requestBodyTimeoutMs"
  > = {},
): Promise<Response> {
  const url = new URL(request.url);
  if (
    url.pathname !== PREANALYSIS_CONTEXT_ENDPOINT_PATH ||
    url.search !== ""
  ) {
    return errorResponse(404, "NOT_FOUND", "Not found.");
  }
  if (request.method !== "POST") {
    return errorResponse(
      405,
      "METHOD_NOT_ALLOWED",
      "Only the scheduled POST contract is accepted.",
      { Allow: "POST" },
    );
  }
  if (request.headers.get("Origin") !== PREANALYSIS_CONTEXT_ORIGIN) {
    return errorResponse(
      403,
      "ORIGIN_NOT_ALLOWED",
      "This endpoint is reserved for the scheduled catalog runner.",
    );
  }
  const configuredToken = environment.PREANALYSIS_CONTEXT_TOKEN;
  if (
    configuredToken === undefined ||
    !AUTHORIZATION_TOKEN_PATTERN.test(configuredToken)
  ) {
    return errorResponse(
      503,
      "PROXY_NOT_CONFIGURED",
      "The scheduled authorization secret is not configured.",
    );
  }
  const authorized = await constantTimeTextMatches(
    request.headers.get("Authorization") ?? "",
    `Bearer ${configuredToken}`,
  );
  if (!authorized) {
    return errorResponse(
      401,
      "UNAUTHORIZED",
      "The scheduled authorization token was rejected.",
      { "WWW-Authenticate": "Bearer" },
    );
  }
  if (
    request.headers.get(PREANALYSIS_CONTEXT_CONTRACT_HEADER) !==
    PREANALYSIS_CONTEXT_PROXY_VERSION
  ) {
    return errorResponse(
      412,
      "PROXY_CONTRACT_MISMATCH",
      "The scheduled runner and proxy contract versions do not match.",
    );
  }
  if (
    request.headers.get(PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER) !==
      AI_BROADCAST_CONTEXT_ROUTING_REVISION ||
    request.headers.get(PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER) !==
      PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID ||
    request.headers.get(
      PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER,
    ) !== PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION
  ) {
    return errorResponse(
      409,
      "PROXY_ROUTE_MISMATCH",
      "The scheduled runner requested a different routing or model receipt.",
    );
  }
  if (mediaType(request) !== "application/json") {
    return errorResponse(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "JSON is required.",
    );
  }

  const operationId = request.headers.get(
    PREANALYSIS_CONTEXT_OPERATION_HEADER,
  );
  const payloadDigest = request.headers.get(
    PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER,
  );
  if (
    operationId === null ||
    !OPERATION_ID_PATTERN.test(operationId) ||
    payloadDigest === null ||
    !PAYLOAD_DIGEST_PATTERN.test(payloadDigest)
  ) {
    return errorResponse(
      400,
      "INVALID_OPERATION",
      "The operation identity or payload digest is invalid.",
    );
  }
  const declaredLength = request.headers.get("Content-Length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) ||
      Number(declaredLength) > MAX_REQUEST_BODY_BYTES)
  ) {
    return errorResponse(
      413,
      "PAYLOAD_TOO_LARGE",
      "The scheduled request exceeds its byte limit.",
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBodyWithLimit(
      request.body,
      MAX_REQUEST_BODY_BYTES,
      dependencies.requestBodyTimeoutMs ?? REQUEST_BODY_TIMEOUT_MS,
    );
  } catch (error) {
    return errorResponse(
      error instanceof BodyLimitError
        ? 413
        : error instanceof BodyTimeoutError
          ? 408
          : 400,
      error instanceof BodyLimitError
        ? "PAYLOAD_TOO_LARGE"
        : error instanceof BodyTimeoutError
          ? "REQUEST_BODY_TIMEOUT"
          : "INVALID_REQUEST",
      "The scheduled request body could not be read.",
    );
  }
  try {
    const actualDigest = `sha256:${await sha256Hex(bytes)}`;
    if (actualDigest !== payloadDigest) {
      return errorResponse(
        409,
        "PAYLOAD_DIGEST_MISMATCH",
        "The exact request bytes do not match the declared digest.",
      );
    }
    const expectedOperationId =
      await createPreanalysisContextOperationId(payloadDigest);
    if (operationId !== expectedOperationId) {
      return errorResponse(
        409,
        "OPERATION_NAMESPACE_MISMATCH",
        "The operation ID is not bound to the current contract and route.",
      );
    }
    if (parseScheduledContextRequest(bytes) === null) {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "Only the bounded Amoretto transcript-only overview contract is accepted.",
      );
    }
    const id =
      environment.PREANALYSIS_CONTEXT_OPERATIONS.idFromName(operationId);
    const stub = environment.PREANALYSIS_CONTEXT_OPERATIONS.get(id);
    let response: Response;
    try {
      const forwardedBody = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      response = await stub.fetch("https://preanalysis.internal/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [PREANALYSIS_CONTEXT_CONTRACT_HEADER]:
            PREANALYSIS_CONTEXT_PROXY_VERSION,
          [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]:
            AI_BROADCAST_CONTEXT_ROUTING_REVISION,
          [PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER]:
            PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID,
          [PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER]:
            PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION,
          [PREANALYSIS_CONTEXT_OPERATION_HEADER]: operationId,
          [PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER]: payloadDigest,
        },
        body: forwardedBody,
      });
    } catch {
      return errorResponse(
        503,
        "OPERATION_STORE_UNAVAILABLE",
        "The scheduled operation checkpoint is unavailable.",
      );
    }
    return forwardOperationResponse(response);
  } finally {
    bytes.fill(0);
  }
}

export default {
  async fetch(
    request: Request,
    environment: PreanalysisContextProxyEnvironment,
  ): Promise<Response> {
    try {
      return await handlePreanalysisContextProxyRequest(request, environment);
    } catch {
      return errorResponse(
        500,
        "PROXY_UNAVAILABLE",
        "The scheduled context proxy could not complete the request.",
      );
    }
  },
};
