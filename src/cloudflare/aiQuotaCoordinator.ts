import {
  AI_QUOTA_MAX_PUBLIC_REQUEST_BYTES,
  AI_QUOTA_SCHEMA_VERSION,
  isAiQuotaLeaseToken,
  isAiQuotaOperationIdentity,
  parseAiQuotaPublicRequest,
  type AiQuotaPublicRequest,
} from "../analysis/aiQuotaProtocol";
import {
  AI_QUOTA_COORDINATOR_STATE_VERSION,
  AI_QUOTA_MAX_TOKEN_RESERVATION,
  applyAiQuotaInternalRequest,
  cancelAiQuotaOperation,
  createAiQuotaCoordinatorState,
  requestAiQuotaLease,
  type AiQuotaCoordinatorState,
  type AiQuotaInternalRequest,
} from "./aiQuotaPolicy";

const STATE_STORAGE_KEY = "coordinator-state";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface DurableObjectStateLike {
  readonly storage: DurableObjectStorageLike;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredCoordinatorState(
  value: unknown,
): value is AiQuotaCoordinatorState {
  return (
    isRecord(value) &&
    value.schemaVersion === AI_QUOTA_COORDINATOR_STATE_VERSION &&
    Number.isSafeInteger(value.revision) &&
    (value.revision as number) >= 0 &&
    Number.isSafeInteger(value.nextParticipantSequence) &&
    (value.nextParticipantSequence as number) >= 1 &&
    Number.isSafeInteger(value.nextOperationSequence) &&
    (value.nextOperationSequence as number) >= 1 &&
    isRecord(value.participants) &&
    isRecord(value.operations) &&
    isRecord(value.providerGates) &&
    isRecord(value.providerGates["qwen-omni"]) &&
    Array.isArray(value.providerGates["qwen-omni"].tokenReservations) &&
    isRecord(value.providerGates.context) &&
    Array.isArray(value.providerGates.context.tokenReservations)
  );
}

function parseInternalRequest(value: unknown): AiQuotaInternalRequest | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== AI_QUOTA_SCHEMA_VERSION ||
    !isAiQuotaOperationIdentity(value) ||
    !isAiQuotaLeaseToken(value.leaseToken)
  ) {
    return null;
  }
  if (value.action === "inspect" || value.action === "release-upload") {
    return {
      action: value.action,
      participantId: value.participantId,
      runId: value.runId,
      operationId: value.operationId,
      pool: value.pool,
      payloadDigest: value.payloadDigest,
      leaseToken: value.leaseToken,
    };
  }
  if (
    value.action === "consume" &&
    Number.isSafeInteger(value.tokenReservation) &&
    (value.tokenReservation as number) > 0 &&
    (value.tokenReservation as number) <= AI_QUOTA_MAX_TOKEN_RESERVATION
  ) {
    return {
      action: "consume",
      participantId: value.participantId,
      runId: value.runId,
      operationId: value.operationId,
      pool: value.pool,
      payloadDigest: value.payloadDigest,
      leaseToken: value.leaseToken,
      tokenReservation: value.tokenReservation as number,
    };
  }
  if (
    value.action !== "complete" ||
    ![
      "succeeded",
      "rate-limited",
      "retryable",
      "failed",
      "outcome-unknown",
    ].includes(typeof value.outcome === "string" ? value.outcome : "")
  ) {
    return null;
  }
  const retryAfterMs =
    value.retryAfterMs === undefined
      ? undefined
      : Number.isSafeInteger(value.retryAfterMs) &&
          (value.retryAfterMs as number) >= 0
        ? (value.retryAfterMs as number)
        : null;
  if (retryAfterMs === null) return null;
  return {
    action: "complete",
    participantId: value.participantId,
    runId: value.runId,
    operationId: value.operationId,
    pool: value.pool,
    payloadDigest: value.payloadDigest,
    leaseToken: value.leaseToken,
    outcome: value.outcome as Extract<
      AiQuotaInternalRequest,
      { readonly action: "complete" }
    >["outcome"],
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

async function readJsonRequest(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("Content-Length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) ||
      Number(declaredLength) > AI_QUOTA_MAX_PUBLIC_REQUEST_BYTES)
  ) {
    throw new RangeError("quota request too large");
  }
  if (request.body === null) {
    throw new SyntaxError("quota request body is missing");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > AI_QUOTA_MAX_PUBLIC_REQUEST_BYTES) {
        await reader.cancel("quota request too large");
        throw new RangeError("quota request too large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } finally {
    bytes.fill(0);
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": JSON_CONTENT_TYPE,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function createLeaseToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let token = "";
  for (const byte of bytes) token += byte.toString(16).padStart(2, "0");
  bytes.fill(0);
  return token;
}

/**
 * One deployment-wide coordinator owns both the five participant slots and
 * every provider pool. Media and generated text never enter this object.
 */
export class AiQuotaCoordinator {
  private state = createAiQuotaCoordinatorState();
  private readonly ready: Promise<void>;
  private mutationTail: Promise<void> = Promise.resolve();

  public constructor(private readonly durableState: DurableObjectStateLike) {
    this.ready = durableState.blockConcurrencyWhile(async () => {
      const stored = await durableState.storage.get<unknown>(STATE_STORAGE_KEY);
      if (stored === undefined) return;
      if (!isStoredCoordinatorState(stored)) {
        throw new Error("Unsupported AI quota coordinator state.");
      }
      this.state = stored;
    });
  }

  public async fetch(request: Request): Promise<Response> {
    await this.ready;
    if (request.method !== "POST") {
      return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    }
    if (
      (request.headers.get("Content-Type") ?? "")
        .split(";", 1)[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    ) {
      return json({ error: "UNSUPPORTED_MEDIA_TYPE" }, 415);
    }

    let value: unknown;
    try {
      value = await readJsonRequest(request);
    } catch (error) {
      return json(
        { error: error instanceof RangeError ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST" },
        error instanceof RangeError ? 413 : 400,
      );
    }
    return this.withStateMutation(async () => {
      const revisionBefore = this.state.revision;
      const nowMs = Date.now();
      if (
        isRecord(value) &&
        value.schemaVersion === AI_QUOTA_SCHEMA_VERSION &&
        value.action === "health" &&
        Object.keys(value).length === 2
      ) {
        return json({
          ok: true,
          status: "healthy",
          schemaVersion: AI_QUOTA_SCHEMA_VERSION,
        });
      }
      const publicRequest: AiQuotaPublicRequest | null =
        parseAiQuotaPublicRequest(value);
      const response =
        publicRequest?.action === "lease"
          ? requestAiQuotaLease(
              this.state,
              publicRequest,
              nowMs,
              createLeaseToken,
            )
          : publicRequest?.action === "cancel"
            ? cancelAiQuotaOperation(this.state, publicRequest, nowMs)
            : (() => {
                const internalRequest = parseInternalRequest(value);
                return internalRequest === null
                  ? null
                  : applyAiQuotaInternalRequest(
                      this.state,
                      internalRequest,
                      nowMs,
                    );
              })();
      if (response === null) return json({ error: "INVALID_REQUEST" }, 400);
      if (this.state.revision !== revisionBefore) {
        await this.durableState.storage.put(STATE_STORAGE_KEY, this.state);
      }
      return json(response);
    });
  }

  private async withStateMutation<T>(callback: () => Promise<T>): Promise<T> {
    const predecessor = this.mutationTail;
    let release = (): void => undefined;
    this.mutationTail = new Promise<void>((resolve) => {
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
