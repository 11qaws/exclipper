import {
  BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
  MAX_BROADCAST_TRANSCRIPT_QWEN_BASE64_LENGTH,
  MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS,
  MAX_BROADCAST_TRANSCRIPT_QWEN_RESPONSE_BYTES,
  MAX_BROADCAST_TRANSCRIPT_QWEN_TEXT_LENGTH,
  isBroadcastTranscriptModelId,
  type BroadcastTranscriptQwenResult,
} from "./broadcastTranscriptQwen";

export const BROADCAST_TRANSCRIPT_PROXY_ENDPOINT =
  "https://rettohighlight-gemini.11qaws.workers.dev/v1/broadcast-transcript" as const;

export class BroadcastTranscriptQwenClientError extends Error {
  public constructor(
    public readonly code:
      | "INVALID_INPUT"
      | "PROXY_UNAVAILABLE"
      | "PROXY_REJECTED"
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
): Promise<BroadcastTranscriptQwenResult> {
  let response: Response;
  try {
    response = await responsePromise;
  } catch {
    throw new BroadcastTranscriptQwenClientError(
      "PROXY_UNAVAILABLE",
      "방송 대사 분석 서버에 연결하지 못했어요.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
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
  return result;
}

export async function requestBroadcastTranscriptQwenChunk(
  audioBase64: string,
  sourceStartMs: number,
  durationMs: number,
  options: {
    readonly signal?: AbortSignal;
    readonly fetchImplementation?: FetchImplementation;
  } = {},
): Promise<BroadcastTranscriptQwenResult> {
  if (
    typeof audioBase64 !== "string" ||
    audioBase64.length === 0 ||
    audioBase64.length > MAX_BROADCAST_TRANSCRIPT_QWEN_BASE64_LENGTH ||
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

  const requestInit: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioBase64, sourceStartMs, durationMs }),
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  return resolveBroadcastTranscriptProxyResponse(
    (options.fetchImplementation ?? fetch)(
      BROADCAST_TRANSCRIPT_PROXY_ENDPOINT,
      requestInit,
    ),
    sourceStartMs,
    durationMs,
  );
}

/** WAV byte ceiling implied by the base64 contract the proxy already enforces. */
const MAX_BROADCAST_TRANSCRIPT_WAV_BYTES =
  (MAX_BROADCAST_TRANSCRIPT_QWEN_BASE64_LENGTH / 4) * 3;

/**
 * Sends the chunk as raw WAV bytes instead of base64 wrapped in JSON.
 *
 * The old transport inflated every chunk by a third and forced the relay to
 * materialise megabyte strings, which is what capped transcription at one
 * request in flight. Raw bytes keep the relay memory flat, so chunks can
 * finally overlap.
 */
export async function requestBroadcastTranscriptChunkBinary(
  wavBytes: Uint8Array,
  sourceStartMs: number,
  durationMs: number,
  options: {
    readonly signal?: AbortSignal;
    readonly fetchImplementation?: FetchImplementation;
  } = {},
): Promise<BroadcastTranscriptQwenResult> {
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
  const requestInit: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: wavBytes as Uint8Array<ArrayBuffer>,
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  return resolveBroadcastTranscriptProxyResponse(
    (options.fetchImplementation ?? fetch)(
      `${BROADCAST_TRANSCRIPT_PROXY_ENDPOINT}?startMs=${sourceStartMs}&durationMs=${durationMs}`,
      requestInit,
    ),
    sourceStartMs,
    durationMs,
  );
}
