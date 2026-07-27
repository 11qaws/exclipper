import {
  AI_QUOTA_ENDPOINT_PATH,
  AI_QUOTA_PROXY_ENDPOINT,
  AI_QUOTA_SCHEMA_VERSION,
  aiQuotaLeaseHeaders,
  isAiQuotaLeaseToken,
  isAiQuotaOpaqueId,
  isAiQuotaParticipantId,
  isAiQuotaPayloadDigest,
  type AiQuotaLeaseHeaders,
  type AiQuotaOperationIdentity,
  type AiQuotaPool,
  type AiQuotaPublicResponse,
} from "./aiQuotaProtocol";

const PARTICIPANT_STORAGE_KEY = "exclipper.ai-quota.participant.v1";
const MAX_RATE_LIMIT_RETRIES = 5;
const MAX_POLL_DELAY_MS = 5_000;
const MIN_POLL_DELAY_MS = 75;
let fallbackParticipantId: string | null = null;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface AiQuotaClientIdentity {
  readonly participantId: string;
  readonly runId: string;
  readonly operationId: string;
  readonly pool: AiQuotaPool;
}

export interface AiQuotaWaitProgress {
  readonly reason: "pool" | "capacity";
  readonly retryAfterMs: number;
  readonly activeParticipantCount: number;
  readonly poolInFlightCount: number;
}

export interface FetchWithAiQuotaOptions extends AiQuotaClientIdentity {
  readonly signal?: AbortSignal;
  readonly fetchImplementation?: FetchImplementation;
  readonly onWait?: (progress: AiQuotaWaitProgress) => void;
}

export type PreparedAiQuotaFetch = (
  lease: AiQuotaLeaseHeaders,
  attempt: number,
) => Promise<Response>;

export class AiQuotaClientError extends Error {
  public constructor(
    public readonly code:
      | "INVALID_IDENTITY"
      | "UNSUPPORTED_BODY"
      | "COORDINATOR_UNAVAILABLE"
      | "COORDINATOR_REJECTED"
      | "ABORTED",
    message: string,
    public readonly coordinatorStatus: AiQuotaPublicResponse["status"] | null = null,
  ) {
    super(message);
    this.name = "AiQuotaClientError";
  }
}

function randomParticipantId(): string {
  return `participant_${crypto.randomUUID().replaceAll("-", "")}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * One opaque browser installation ID makes tabs share one fairness weight.
 * It is not an account, credential, person name, or remote project identity.
 */
export function getOrCreateAiQuotaParticipantId(
  storage: StorageLike | null = defaultStorage(),
): string {
  try {
    const stored = storage?.getItem(PARTICIPANT_STORAGE_KEY);
    if (isAiQuotaParticipantId(stored)) return stored;
  } catch {
    // Storage can be blocked; the in-memory fallback still keeps this tab safe.
  }
  if (fallbackParticipantId === null) {
    fallbackParticipantId = randomParticipantId();
  }
  try {
    storage?.setItem(PARTICIPANT_STORAGE_KEY, fallbackParticipantId);
  } catch {
    // The participant ID is non-secret and can remain memory-only.
  }
  return fallbackParticipantId;
}

function abortError(): AiQuotaClientError {
  return new AiQuotaClientError("ABORTED", "AI 분석 대기 작업이 취소됐어요.");
}

async function waitWithSignal(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted === true) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timeout = globalThis.setTimeout(finish, delayMs);
    const onAbort = (): void => {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal !== undefined) {
      void Promise.resolve().then(() => {
        if (!signal.aborted) return;
        globalThis.clearTimeout(timeout);
        reject(abortError());
      });
    }
  });
}

async function bodyBytes(body: BodyInit | null | undefined): Promise<Uint8Array> {
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }
  throw new AiQuotaClientError(
    "UNSUPPORTED_BODY",
    "AI 분석 요청 본문 형식을 확인하지 못했어요.",
  );
}

export async function createAiQuotaPayloadDigest(
  body: BodyInit | null | undefined,
): Promise<string> {
  const bytes = await bodyBytes(body);
  const exactBytes = new Uint8Array(bytes.byteLength);
  exactBytes.set(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", exactBytes),
  );
  exactBytes.fill(0);
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  digest.fill(0);
  return `sha256:${hex}`;
}

function parsePublicResponse(value: unknown): AiQuotaPublicResponse | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== AI_QUOTA_SCHEMA_VERSION ||
    typeof record.status !== "string" ||
    !Number.isSafeInteger(record.retryAfterMs) ||
    (record.retryAfterMs as number) < 0 ||
    !Number.isSafeInteger(record.activeParticipantCount) ||
    (record.activeParticipantCount as number) < 0 ||
    !Number.isSafeInteger(record.poolInFlightCount) ||
    (record.poolInFlightCount as number) < 0
  ) {
    return null;
  }
  if (
    record.status === "granted" &&
    isAiQuotaLeaseToken(record.leaseToken) &&
    Number.isSafeInteger(record.leaseExpiresAtMs) &&
    (record.leaseExpiresAtMs as number) > 0
  ) {
    return value as AiQuotaPublicResponse;
  }
  return [
    "queued",
    "capacity-full",
    "conflict",
    "queue-full",
    "terminal",
    "cancelled",
  ].includes(record.status)
    ? (value as AiQuotaPublicResponse)
    : null;
}

function attemptOperationId(
  baseOperationId: string,
  payloadDigest: string,
  attempt: number,
): string {
  const suffix = `.${payloadDigest.slice("sha256:".length, 19)}.attempt-${attempt}`;
  return `${baseOperationId.slice(0, 160 - suffix.length)}${suffix}`;
}

function normalizeOperationId(value: string): string | null {
  const normalized = value
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._:-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 128);
  return normalized.length > 0 && isAiQuotaOpaqueId(normalized)
    ? normalized
    : null;
}

async function postQuotaRequest(
  fetchImplementation: FetchImplementation,
  body: unknown,
  signal: AbortSignal | undefined,
): Promise<AiQuotaPublicResponse> {
  let response: Response;
  try {
    response = await fetchImplementation(AI_QUOTA_PROXY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    if (signal?.aborted === true) throw abortError();
    throw new AiQuotaClientError(
      "COORDINATOR_UNAVAILABLE",
      "AI 분석 순서를 확인하지 못했어요.",
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new AiQuotaClientError(
      "COORDINATOR_UNAVAILABLE",
      "AI 분석 순서 응답을 확인하지 못했어요.",
    );
  }
  const parsed = parsePublicResponse(value);
  if (parsed === null) {
    throw new AiQuotaClientError(
      "COORDINATOR_UNAVAILABLE",
      "AI 분석 순서 응답 형식이 올바르지 않아요.",
    );
  }
  return parsed;
}

async function acquireLease(
  identity: AiQuotaOperationIdentity,
  options: FetchWithAiQuotaOptions,
): Promise<AiQuotaLeaseHeaders> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  try {
    while (true) {
      if (options.signal?.aborted === true) throw abortError();
      const response = await postQuotaRequest(
        fetchImplementation,
        {
          schemaVersion: AI_QUOTA_SCHEMA_VERSION,
          action: "lease",
          ...identity,
        },
        options.signal,
      );
      if (response.status === "granted") {
        return { ...identity, leaseToken: response.leaseToken };
      }
      if (response.status === "queued" || response.status === "capacity-full") {
        const retryAfterMs = Math.min(
          MAX_POLL_DELAY_MS,
          Math.max(MIN_POLL_DELAY_MS, response.retryAfterMs),
        );
        options.onWait?.({
          reason: response.status === "capacity-full" ? "capacity" : "pool",
          retryAfterMs,
          activeParticipantCount: response.activeParticipantCount,
          poolInFlightCount: response.poolInFlightCount,
        });
        await waitWithSignal(retryAfterMs, options.signal);
        continue;
      }
      throw new AiQuotaClientError(
        "COORDINATOR_REJECTED",
        response.status === "terminal"
          ? "이미 끝난 AI 분석 요청을 다시 실행하지 않았어요."
          : "현재 AI 분석 작업과 요청 순서가 일치하지 않아요.",
        response.status,
      );
    }
  } catch (error) {
    if (
      error instanceof AiQuotaClientError &&
      error.code === "ABORTED"
    ) {
      await cancelQuotaOperationBestEffort(fetchImplementation, identity);
    }
    throw error;
  }
}

async function cancelQuotaOperationBestEffort(
  fetchImplementation: FetchImplementation,
  identity: AiQuotaOperationIdentity,
): Promise<void> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 2_000);
  try {
    await postQuotaRequest(
      fetchImplementation,
      {
        schemaVersion: AI_QUOTA_SCHEMA_VERSION,
        action: "cancel",
        ...identity,
      },
      controller.signal,
    );
  } catch {
    // Queue TTL remains the last-resort cleanup if the coordinator is offline.
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function retryAfterMilliseconds(response: Response): number {
  const raw = response.headers.get("Retry-After");
  if (raw === null || !/^\d{1,3}$/u.test(raw)) return 1_000;
  return Math.min(60_000, Math.max(1_000, Number(raw) * 1_000));
}

async function isRetryableRateLimitResponse(response: Response): Promise<boolean> {
  if (response.status !== 429) return false;
  try {
    const payload = (await response.clone().json()) as {
      readonly error?: { readonly code?: unknown };
    };
    return (
      payload.error?.code === "RATE_LIMITED" ||
      payload.error?.code === "UPSTREAM_RATE_LIMITED"
    );
  } catch {
    return false;
  }
}

/**
 * Runs one logical paid operation with a lease bound to `payloadBody`.
 *
 * The callback may perform more than one HTTP exchange with that lease. This
 * is needed by the Free transcript transport, where the first request stages
 * raw WAV in R2 and the second small request starts the provider. The quota
 * digest always remains bound to the original media bytes.
 */
export async function fetchWithPreparedAiQuota(
  payloadBody: BodyInit | null | undefined,
  options: FetchWithAiQuotaOptions,
  preparedFetch: PreparedAiQuotaFetch,
): Promise<Response> {
  const normalizedOperationId = normalizeOperationId(options.operationId);
  if (
    !isAiQuotaParticipantId(options.participantId) ||
    !isAiQuotaOpaqueId(options.runId) ||
    normalizedOperationId === null
  ) {
    throw new AiQuotaClientError(
      "INVALID_IDENTITY",
      "AI 분석 작업 식별자를 준비하지 못했어요.",
    );
  }
  const payloadDigest = await createAiQuotaPayloadDigest(payloadBody);
  if (!isAiQuotaPayloadDigest(payloadDigest)) {
    throw new AiQuotaClientError(
      "UNSUPPORTED_BODY",
      "AI 분석 요청 지문을 만들지 못했어요.",
    );
  }
  const fetchImplementation = options.fetchImplementation ?? fetch;
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    const identity: AiQuotaOperationIdentity = {
      participantId: options.participantId,
      runId: options.runId,
      operationId: attemptOperationId(
        normalizedOperationId,
        payloadDigest,
        attempt,
      ),
      pool: options.pool,
      payloadDigest,
    };
    const lease = await acquireLease(identity, options);
    let response: Response;
    try {
      response = await preparedFetch(lease, attempt);
    } catch {
      if (options.signal?.aborted === true) {
        await cancelQuotaOperationBestEffort(fetchImplementation, identity);
        throw abortError();
      }
      throw new AiQuotaClientError(
        "COORDINATOR_UNAVAILABLE",
        "AI 분석 서버에 연결하지 못했어요.",
      );
    }
    const retryableRateLimit = await isRetryableRateLimitResponse(response);
    if (attempt >= MAX_RATE_LIMIT_RETRIES || !retryableRateLimit) {
      return response;
    }
    const delayMs = retryAfterMilliseconds(response);
    await response.body?.cancel().catch(() => undefined);
    await waitWithSignal(delayMs, options.signal);
  }
  throw new AiQuotaClientError(
    "COORDINATOR_REJECTED",
    "AI 분석 요청 순서를 다시 잡지 못했어요.",
  );
}

export async function fetchWithAiQuota(
  input: RequestInfo | URL,
  init: RequestInit,
  options: FetchWithAiQuotaOptions,
): Promise<Response> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  return fetchWithPreparedAiQuota(init.body, options, async (lease) => {
    const headers = new Headers(init.headers);
    for (const [name, value] of Object.entries(aiQuotaLeaseHeaders(lease))) {
      headers.set(name, value);
    }
    return fetchImplementation(input, {
      ...init,
      headers,
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  });
}

export function isAiQuotaEndpoint(url: string): boolean {
  try {
    return new URL(url).pathname === AI_QUOTA_ENDPOINT_PATH;
  } catch {
    return false;
  }
}
