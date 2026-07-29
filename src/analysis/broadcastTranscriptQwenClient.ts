import {
  BROADCAST_TRANSCRIPT_BASE64_CONTENT_TYPE,
  BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
  MAX_BROADCAST_TRANSCRIPT_QWEN_BASE64_LENGTH,
  MAX_BROADCAST_TRANSCRIPT_DIRECT_DURATION_MS,
  MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS,
  MAX_BROADCAST_TRANSCRIPT_QWEN_RESPONSE_BYTES,
  MAX_BROADCAST_TRANSCRIPT_QWEN_TEXT_LENGTH,
  isBroadcastTranscriptModelId,
  type BroadcastTranscriptQwenResult,
} from "./broadcastTranscriptQwen";
export { BROADCAST_TRANSCRIPT_BASE64_CONTENT_TYPE } from "./broadcastTranscriptQwen";
import {
  AiQuotaClientError,
  fetchWithAiQuota,
  fetchWithPreparedAiQuota,
  type AiQuotaClientIdentity,
} from "./aiQuotaClient";
import { aiQuotaLeaseHeaders, type AiQuotaLeaseHeaders } from "./aiQuotaProtocol";
import {
  CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER,
  CANDIDATE_PASS_B_RESPONSE_MODEL_ID_HEADER,
  CANDIDATE_PASS_B_RESPONSE_MODEL_REVISION_HEADER,
} from "./candidatePassBWorkerProtocol";
import {
  createBroadcastTranscriptProviderReceipt,
  verifyBroadcastTranscriptRouteSelection,
  type BroadcastTranscriptRouteSelection,
  type BroadcastTranscriptVerifiedResult,
} from "./broadcastTranscriptRouteManifest";
import {
  BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE,
  createBroadcastTranscriptMediaResolveRequest,
  parseBroadcastTranscriptMediaStagedResponse,
} from "./broadcastTranscriptMediaProtocol";

export const BROADCAST_TRANSCRIPT_PROXY_ENDPOINT =
  "https://rettohighlight-gemini.11qaws.workers.dev/v1/broadcast-transcript" as const;

export class BroadcastTranscriptQwenClientError extends Error {
  public constructor(
    public readonly code:
      | "INVALID_INPUT"
      | "PROXY_UNAVAILABLE"
      | "PROXY_REJECTED"
      | "RATE_LIMITED"
      | "OUTCOME_UNKNOWN"
      | "PROXY_INVALID_RESPONSE",
    message: string,
  ) {
    super(message);
    this.name = "BroadcastTranscriptQwenClientError";
  }
}

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalLabel(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length > 0 &&
      value.length <= 40 &&
      !/[\p{Cc}\p{Cf}]/u.test(value))
  );
}

function parseResult(
  value: unknown,
  sourceStartMs: number,
  durationMs: number,
): BroadcastTranscriptQwenResult | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION ||
    !isBroadcastTranscriptModelId(value.modelId) ||
    value.sourceStartMs !== sourceStartMs ||
    value.sourceEndMs !== sourceStartMs + durationMs ||
    typeof value.textKo !== "string" ||
    value.textKo.trim() !== value.textKo ||
    value.textKo.length === 0 ||
    value.textKo.length > MAX_BROADCAST_TRANSCRIPT_QWEN_TEXT_LENGTH ||
    !optionalLabel(value.detectedLanguage) ||
    !optionalLabel(value.emotion) ||
    !(
      value.billedSeconds === null ||
      (typeof value.billedSeconds === "number" &&
        Number.isFinite(value.billedSeconds) &&
        value.billedSeconds >= 0)
    )
  ) {
    return null;
  }
  return {
    schemaVersion: BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
    modelId: value.modelId,
    sourceStartMs,
    sourceEndMs: sourceStartMs + durationMs,
    textKo: value.textKo,
    detectedLanguage: value.detectedLanguage,
    emotion: value.emotion,
    billedSeconds: value.billedSeconds,
  };
}

async function resolveBroadcastTranscriptProxyResponse(
  responsePromise: Promise<Response>,
  sourceStartMs: number,
  durationMs: number,
  route: BroadcastTranscriptRouteSelection,
): Promise<BroadcastTranscriptVerifiedResult> {
  let response: Response;
  try {
    response = await responsePromise;
  } catch (error) {
    if (
      error instanceof AiQuotaClientError &&
      error.code === "OUTCOME_UNKNOWN"
    ) {
      throw new BroadcastTranscriptQwenClientError(
        "OUTCOME_UNKNOWN",
        "전사 요청이 처리됐는지 확인할 수 없어 자동으로 다시 결제하지 않았어요.",
      );
    }
    throw new BroadcastTranscriptQwenClientError(
      "PROXY_UNAVAILABLE",
      "방송 대사 분석 서버에 연결하지 못했어요.",
    );
  }
  if (!response.ok) {
    let errorCode: unknown;
    try {
      const text = await response.text();
      if (
        new TextEncoder().encode(text).byteLength <=
        MAX_BROADCAST_TRANSCRIPT_QWEN_RESPONSE_BYTES
      ) {
        const payload = JSON.parse(text) as {
          readonly error?: { readonly code?: unknown };
        };
        errorCode = payload.error?.code;
      }
    } catch {
      errorCode = undefined;
    }
    if (errorCode === "RATE_LIMITED" || errorCode === "UPSTREAM_RATE_LIMITED") {
      throw new BroadcastTranscriptQwenClientError(
        "RATE_LIMITED",
        "방송 대사 분석 요청이 잠시 많아요.",
      );
    }
    if (errorCode === "UPSTREAM_OUTCOME_UNKNOWN") {
      throw new BroadcastTranscriptQwenClientError(
        "OUTCOME_UNKNOWN",
        "방송 대사 요청의 처리 여부를 확인할 수 없어 자동 재요청하지 않았어요.",
      );
    }
    throw new BroadcastTranscriptQwenClientError(
      "PROXY_REJECTED",
      "방송 대사 분석 요청을 처리하지 못했어요.",
    );
  }
  const declaredLength = response.headers.get("Content-Length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) ||
      Number(declaredLength) > MAX_BROADCAST_TRANSCRIPT_QWEN_RESPONSE_BYTES)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new BroadcastTranscriptQwenClientError(
      "PROXY_INVALID_RESPONSE",
      "방송 대사 분석 응답을 확인하지 못했어요.",
    );
  }
  let value: unknown;
  try {
    const text = await response.text();
    if (
      new TextEncoder().encode(text).byteLength >
      MAX_BROADCAST_TRANSCRIPT_QWEN_RESPONSE_BYTES
    ) {
      throw new RangeError("response too large");
    }
    value = JSON.parse(text);
  } catch {
    throw new BroadcastTranscriptQwenClientError(
      "PROXY_INVALID_RESPONSE",
      "방송 대사 분석 응답을 확인하지 못했어요.",
    );
  }
  const result = parseResult(value, sourceStartMs, durationMs);
  if (result === null) {
    throw new BroadcastTranscriptQwenClientError(
      "PROXY_INVALID_RESPONSE",
      "방송 대사 분석 응답 형식을 확인하지 못했어요.",
    );
  }
  const responseModelId = response.headers.get(
    CANDIDATE_PASS_B_RESPONSE_MODEL_ID_HEADER,
  );
  const responseModelRevision = response.headers.get(
    CANDIDATE_PASS_B_RESPONSE_MODEL_REVISION_HEADER,
  );
  const responseFallbackUsed = response.headers.get(
    CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER,
  );
  if (
    responseModelId === null ||
    responseModelRevision === null ||
    (responseFallbackUsed !== "true" && responseFallbackUsed !== "false") ||
    responseModelId !== result.modelId
  ) {
    throw new BroadcastTranscriptQwenClientError(
      "PROXY_INVALID_RESPONSE",
      "방송 대사 분석 응답의 실제 모델 정보를 확인하지 못했어요.",
    );
  }
  let providerReceipt;
  try {
    providerReceipt = createBroadcastTranscriptProviderReceipt(
      route,
      responseModelId,
      responseModelRevision,
      responseFallbackUsed === "true",
    );
  } catch {
    throw new BroadcastTranscriptQwenClientError(
      "PROXY_INVALID_RESPONSE",
      "방송 대사 분석 응답의 실제 모델 경로가 시작 전에 고정한 경로와 달라요.",
    );
  }
  return {
    ...result,
    modelRevision: providerReceipt.modelRevision,
    providerReceipt,
  };
}

export async function requestBroadcastTranscriptQwenChunk(
  audioBase64: string,
  sourceStartMs: number,
  durationMs: number,
  options: {
    readonly route: BroadcastTranscriptRouteSelection;
    readonly signal?: AbortSignal;
    readonly fetchImplementation?: FetchImplementation;
    readonly quota?: Omit<AiQuotaClientIdentity, "pool">;
  },
): Promise<BroadcastTranscriptVerifiedResult> {
  if (
    typeof audioBase64 !== "string" ||
    audioBase64.length === 0 ||
    audioBase64.length > MAX_BROADCAST_TRANSCRIPT_QWEN_BASE64_LENGTH ||
    !Number.isSafeInteger(sourceStartMs) ||
    sourceStartMs < 0 ||
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 ||
    durationMs > MAX_BROADCAST_TRANSCRIPT_DIRECT_DURATION_MS
  ) {
    throw new BroadcastTranscriptQwenClientError(
      "INVALID_INPUT",
      "방송 대사 분석 구간을 준비하지 못했어요.",
    );
  }
  let route: BroadcastTranscriptRouteSelection;
  try {
    route = await verifyBroadcastTranscriptRouteSelection(options.route);
  } catch {
    throw new BroadcastTranscriptQwenClientError(
      "INVALID_INPUT",
      "방송 대사 분석 모델 경로가 고정되지 않았어요.",
    );
  }

  const requestInit: RequestInit = {
    method: "POST",
    headers: { "Content-Type": BROADCAST_TRANSCRIPT_BASE64_CONTENT_TYPE },
    body: audioBase64,
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  return resolveBroadcastTranscriptProxyResponse(
    options.quota === undefined
      ? (options.fetchImplementation ?? fetch)(
          `${BROADCAST_TRANSCRIPT_PROXY_ENDPOINT}?startMs=${sourceStartMs}&durationMs=${durationMs}`,
          requestInit,
        )
      : fetchWithAiQuota(
          `${BROADCAST_TRANSCRIPT_PROXY_ENDPOINT}?startMs=${sourceStartMs}&durationMs=${durationMs}`,
          requestInit,
          {
            ...options.quota,
            pool: "transcript",
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            ...(options.fetchImplementation === undefined
              ? {}
              : { fetchImplementation: options.fetchImplementation }),
          },
    ),
    sourceStartMs,
    durationMs,
    route,
  );
}

/** WAV byte ceiling shared by both server-selected transcript transports. */
const MAX_BROADCAST_TRANSCRIPT_WAV_BYTES =
  (MAX_BROADCAST_TRANSCRIPT_QWEN_BASE64_LENGTH / 4) * 3;

/**
 * Sends one raw WAV contract and lets the server select its infrastructure.
 *
 * Workers Paid can answer this first request directly. Workers Free stages the
 * same stream in private R2 and returns a short-lived ticket, which this client
 * resolves without uploading the WAV again. A 429 acquires a fresh quota
 * operation while retaining that ticket.
 */
export async function requestBroadcastTranscriptChunkBinary(
  wavBytes: Uint8Array,
  sourceStartMs: number,
  durationMs: number,
  options: {
    readonly route: BroadcastTranscriptRouteSelection;
    readonly signal?: AbortSignal;
    readonly fetchImplementation?: FetchImplementation;
    readonly quota?: Omit<AiQuotaClientIdentity, "pool">;
  },
): Promise<BroadcastTranscriptVerifiedResult> {
  if (
    !(wavBytes instanceof Uint8Array) ||
    wavBytes.byteLength < 44 ||
    wavBytes.byteLength > MAX_BROADCAST_TRANSCRIPT_WAV_BYTES ||
    !Number.isSafeInteger(sourceStartMs) ||
    sourceStartMs < 0 ||
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 ||
    durationMs > MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS
  ) {
    throw new BroadcastTranscriptQwenClientError(
      "INVALID_INPUT",
      "방송 대사 분석 구간을 준비하지 못했어요.",
    );
  }
  let route: BroadcastTranscriptRouteSelection;
  try {
    route = await verifyBroadcastTranscriptRouteSelection(options.route);
  } catch {
    throw new BroadcastTranscriptQwenClientError(
      "INVALID_INPUT",
      "방송 대사 분석 모델 경로가 고정되지 않았어요.",
    );
  }
  const requestInit: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: wavBytes as Uint8Array<ArrayBuffer>,
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  const endpoint =
    `${BROADCAST_TRANSCRIPT_PROXY_ENDPOINT}?startMs=${sourceStartMs}&durationMs=${durationMs}`;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  let mediaTicket: string | null = null;
  const preparedFetch = async (
    lease: AiQuotaLeaseHeaders | null,
  ): Promise<Response> => {
    const leaseHeaders =
      lease === null ? {} : aiQuotaLeaseHeaders(lease);
    if (mediaTicket === null) {
      const stagedOrDirect = await fetchImplementation(endpoint, {
        ...requestInit,
        headers: {
          ...leaseHeaders,
          "Content-Type": "audio/wav",
        },
      });
      if (stagedOrDirect.status !== 202) return stagedOrDirect;
      const replayableStagedResponse = stagedOrDirect.clone();
      let value: unknown;
      try {
        value = await stagedOrDirect.json();
      } catch {
        return replayableStagedResponse;
      }
      const staged = parseBroadcastTranscriptMediaStagedResponse(
        value,
        sourceStartMs,
        durationMs,
      );
      if (staged === null) return replayableStagedResponse;
      mediaTicket = staged.mediaTicket;
    }
    return fetchImplementation(BROADCAST_TRANSCRIPT_PROXY_ENDPOINT, {
      method: "POST",
      headers: {
        ...leaseHeaders,
        "Content-Type": BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE,
      },
      body: JSON.stringify(
        createBroadcastTranscriptMediaResolveRequest(mediaTicket),
      ),
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  };
  return resolveBroadcastTranscriptProxyResponse(
    options.quota === undefined
      ? preparedFetch(null)
      : fetchWithPreparedAiQuota(wavBytes as Uint8Array<ArrayBuffer>, {
          ...options.quota,
          pool: "transcript",
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.fetchImplementation === undefined
            ? {}
            : { fetchImplementation: options.fetchImplementation }),
        }, (lease) => preparedFetch(lease)),
    sourceStartMs,
    durationMs,
    route,
  );
}
