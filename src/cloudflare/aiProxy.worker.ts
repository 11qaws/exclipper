import {
  MAX_CANDIDATE_PASS_B_RESPONSE_BYTES,
  buildCandidatePassBGeminiRequestBody,
  extractCandidatePassBGeminiResponse,
} from "../analysis/candidatePassBGemini";
import {
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAMES,
  type CandidatePassBVideoFrame,
} from "../analysis/candidatePassBWorkerProtocol";
import {
  MAX_BROADCAST_CONTEXT_DEEPSEEK_RESPONSE_BYTES,
  buildBroadcastContextDeepseekRequestBody,
  extractBroadcastContextDeepseekResponse,
} from "../analysis/broadcastContextDeepseek";
import {
  createBroadcastContextRequest,
  BroadcastContextInputError,
  type BroadcastContextRequestInput,
} from "../analysis/broadcastContextProtocol";

import {
  resolveCandidateInsightConnection,
  resolveBroadcastContextConnection,
  type AiProviderEnvironment,
} from "./aiProviderConfiguration";

const ENDPOINT_PATH = "/v1/candidate-insights";
const BROADCAST_CONTEXT_ENDPOINT_PATH = "/v1/broadcast-context";
const HEALTH_PATH = "/healthz";
const PRODUCTION_ORIGIN = "https://11qaws.github.io";
const WAV_HEADER_BYTES = 44;
const PCM_BYTES_PER_SAMPLE = 2;
const MAX_WAV_BYTES =
  WAV_HEADER_BYTES +
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ *
    PCM_BYTES_PER_SAMPLE *
    (MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS / 1_000);
const MAX_AUDIO_BASE64_LENGTH = 4 * Math.ceil(MAX_WAV_BYTES / 3);
const MAX_REQUEST_BODY_BYTES =
  MAX_AUDIO_BASE64_LENGTH +
  MAX_CANDIDATE_PASS_B_VIDEO_FRAMES * MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH +
  8_192;
const MAX_UPSTREAM_ERROR_BYTES = 16 * 1024;
const UPSTREAM_TIMEOUT_MS = 90_000;
const DEFAULT_UPSTREAM_RETRY_DELAYS_MS = Object.freeze([1_000, 2_000]);
const RATE_LIMIT_KEY = "candidate-insights";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

interface RateLimitBinding {
  readonly limit: (
    options: { readonly key: string },
  ) => Promise<{ readonly success: boolean }>;
}

export interface AiProxyEnvironment extends AiProviderEnvironment {
  readonly RATE_LIMITER: RateLimitBinding;
  readonly IP_RATE_LIMITER: RateLimitBinding;
}

interface CandidateInsightRequest {
  readonly audioBase64: string;
  readonly candidateDurationMs: number;
  readonly videoFrames: readonly CandidatePassBVideoFrame[];
}

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface AiProxyDependencies {
  readonly fetchImplementation?: FetchImplementation;
  readonly upstreamTimeoutMs?: number;
  readonly upstreamRetryDelaysMs?: readonly number[];
}

class BodyTooLargeError extends Error {}
class UpstreamTimeoutError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isAllowedOrigin(origin: string | null): origin is string {
  if (origin === PRODUCTION_ORIGIN) {
    return true;
  }
  if (origin === null) {
    return false;
  }
  try {
    const url = new URL(origin);
    return (
      url.origin === origin &&
      url.protocol === "http:" &&
      url.hostname === "localhost" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function corsHeaders(origin: string): Headers {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  return headers;
}

function jsonResponse(
  status: number,
  code: string,
  message: string,
  origin: string | null,
  additionalHeaders?: Readonly<Record<string, string>>,
): Response {
  const headers = isAllowedOrigin(origin) ? corsHeaders(origin) : new Headers();
  headers.set("Content-Type", JSON_CONTENT_TYPE);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  for (const [name, value] of Object.entries(additionalHeaders ?? {})) {
    headers.set(name, value);
  }
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers,
  });
}

function preflightResponse(origin: string): Response {
  const headers = corsHeaders(origin);
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "content-type");
  headers.set("Access-Control-Max-Age", "600");
  headers.set("Cache-Control", "no-store");
  return new Response(null, { status: 204, headers });
}

async function readBodyWithLimit(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (body === null) {
    return new Uint8Array();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("Unexpected request body chunk.");
      }
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function parseCandidateRequest(bytes: Uint8Array): CandidateInsightRequest | null {
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    (!hasExactKeys(value, ["audioBase64", "candidateDurationMs"]) &&
      !hasExactKeys(value, ["audioBase64", "candidateDurationMs", "videoFrames"])) ||
    typeof value.audioBase64 !== "string" ||
    value.audioBase64.length === 0 ||
    value.audioBase64.length > MAX_AUDIO_BASE64_LENGTH ||
    !Number.isSafeInteger(value.candidateDurationMs) ||
    (value.candidateDurationMs as number) <= 0 ||
    (value.candidateDurationMs as number) > MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS
  ) {
    return null;
  }
  const rawFrames = "videoFrames" in value ? value.videoFrames : [];
  if (!Array.isArray(rawFrames) || rawFrames.length > MAX_CANDIDATE_PASS_B_VIDEO_FRAMES) {
    return null;
  }
  const videoFrames: CandidatePassBVideoFrame[] = [];
  for (const frame of rawFrames) {
    if (
      !isRecord(frame) ||
      !hasExactKeys(frame, ["timestampMs", "mimeType", "dataBase64"]) ||
      !Number.isSafeInteger(frame.timestampMs) ||
      (frame.timestampMs as number) < 0 ||
      (frame.timestampMs as number) > MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS ||
      frame.mimeType !== "image/jpeg" ||
      typeof frame.dataBase64 !== "string" ||
      frame.dataBase64.length === 0 ||
      frame.dataBase64.length > MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH ||
      decodeStrictBase64(frame.dataBase64) === null
    ) {
      return null;
    }
    videoFrames.push({
      timestampMs: frame.timestampMs as number,
      mimeType: "image/jpeg",
      dataBase64: frame.dataBase64,
    });
  }
  return {
    audioBase64: value.audioBase64,
    candidateDurationMs: value.candidateDurationMs as number,
    videoFrames,
  };
}

function decodeStrictBase64(value: string): Uint8Array | null {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    return null;
  }
  try {
    const decoded = atob(value);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function matchesAscii(bytes: Uint8Array, offset: number, expected: string): boolean {
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

function isCanonicalCandidateWav(
  bytes: Uint8Array,
  candidateDurationMs: number,
): boolean {
  if (bytes.byteLength < WAV_HEADER_BYTES || bytes.byteLength > MAX_WAV_BYTES) {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataLength = view.getUint32(40, true);
  const sampleCount = dataLength / PCM_BYTES_PER_SAMPLE;
  const expectedSampleCount = Math.ceil(
    (candidateDurationMs / 1_000) * CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  );
  return (
    matchesAscii(bytes, 0, "RIFF") &&
    view.getUint32(4, true) + 8 === bytes.byteLength &&
    matchesAscii(bytes, 8, "WAVE") &&
    matchesAscii(bytes, 12, "fmt ") &&
    view.getUint32(16, true) === 16 &&
    view.getUint16(20, true) === 1 &&
    view.getUint16(22, true) === 1 &&
    view.getUint32(24, true) === CANDIDATE_PASS_B_SAMPLE_RATE_HZ &&
    view.getUint32(28, true) ===
      CANDIDATE_PASS_B_SAMPLE_RATE_HZ * PCM_BYTES_PER_SAMPLE &&
    view.getUint16(32, true) === PCM_BYTES_PER_SAMPLE &&
    view.getUint16(34, true) === 16 &&
    matchesAscii(bytes, 36, "data") &&
    dataLength > 0 &&
    dataLength % PCM_BYTES_PER_SAMPLE === 0 &&
    WAV_HEADER_BYTES + dataLength === bytes.byteLength &&
    sampleCount === expectedSampleCount &&
    sampleCount <=
      (MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS / 1_000) *
        CANDIDATE_PASS_B_SAMPLE_RATE_HZ
  );
}

function mediaType(request: Request): string | null {
  const header = request.headers.get("Content-Type");
  return header?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function clientRateLimitKey(request: Request): string {
  const clientIp = request.headers.get("CF-Connecting-IP")?.trim();
  if (
    clientIp === undefined ||
    clientIp.length === 0 ||
    clientIp.length > 64 ||
    /[\p{Cc}\p{Cf}\s]/u.test(clientIp)
  ) {
    return `${RATE_LIMIT_KEY}:unknown`;
  }
  return `${RATE_LIMIT_KEY}:${clientIp}`;
}

async function fetchWithTimeout(
  fetchImplementation: FetchImplementation,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImplementation(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new UpstreamTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isTransientUpstreamStatus(status: number): boolean {
  return status === 408 || (status >= 500 && status <= 599);
}

async function waitForRetry(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function fetchWithTransientRetries(
  fetchImplementation: FetchImplementation,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  retryDelaysMs: readonly number[],
): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let retryIndex = 0;
  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new UpstreamTimeoutError();
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(
        fetchImplementation,
        input,
        init,
        remainingMs,
      );
    } catch (error) {
      if (
        error instanceof UpstreamTimeoutError ||
        retryIndex >= retryDelaysMs.length
      ) {
        throw error;
      }
      const delayMs = retryDelaysMs[retryIndex] ?? 0;
      retryIndex += 1;
      await waitForRetry(Math.min(delayMs, Math.max(0, deadline - Date.now())));
      continue;
    }

    if (
      !isTransientUpstreamStatus(response.status) ||
      retryIndex >= retryDelaysMs.length
    ) {
      return response;
    }
    await response.body?.cancel().catch(() => undefined);
    const delayMs = retryDelaysMs[retryIndex] ?? 0;
    retryIndex += 1;
    await waitForRetry(Math.min(delayMs, Math.max(0, deadline - Date.now())));
  }
}

async function classifyUpstreamRejection(
  response: Response,
): Promise<"api-key" | "response-format" | "invalid-argument" | "other"> {
  let bytes: Uint8Array;
  try {
    bytes = await readBodyWithLimit(response.body, MAX_UPSTREAM_ERROR_BYTES);
  } catch {
    return "other";
  }

  let payload: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    bytes.fill(0);
    payload = JSON.parse(text);
  } catch {
    bytes.fill(0);
    return "other";
  }
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return "other";
  }

  const status = payload.error.status;
  const message = payload.error.message;
  if (typeof message === "string" && /api key/iu.test(message)) {
    return "api-key";
  }
  if (
    typeof message === "string" &&
    /response[_ ]?format|mime[_ ]?type|schema/iu.test(message)
  ) {
    return "response-format";
  }
  return status === "INVALID_ARGUMENT" ? "invalid-argument" : "other";
}

function successResponse(payload: unknown, origin: string): Response {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", JSON_CONTENT_TYPE);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(payload), { status: 200, headers });
}

function healthResponse(request: Request): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": JSON_CONTENT_TYPE,
    "X-Content-Type-Options": "nosniff",
  });
  const body = request.method === "HEAD"
    ? null
    : JSON.stringify({ ok: true, service: "rettohighlight-gemini", version: 1 });
  return new Response(body, { status: 200, headers });
}

export async function handleCandidateInsightRequest(
  request: Request,
  environment: AiProxyEnvironment,
  dependencies: AiProxyDependencies = {},
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);

  if (url.pathname === HEALTH_PATH && url.search === "") {
    if (request.method === "GET" || request.method === "HEAD") {
      return healthResponse(request);
    }
    return jsonResponse(
      405,
      "METHOD_NOT_ALLOWED",
      "지원하지 않는 요청 방식이에요.",
      origin,
      { Allow: "GET, HEAD" },
    );
  }

  if (url.pathname !== ENDPOINT_PATH || url.search !== "") {
    return jsonResponse(404, "NOT_FOUND", "요청한 기능을 찾지 못했어요.", origin);
  }
  if (!isAllowedOrigin(origin)) {
    return jsonResponse(
      403,
      "ORIGIN_NOT_ALLOWED",
      "이 페이지에서는 AI 분석을 시작할 수 없어요.",
      origin,
    );
  }
  if (request.method === "OPTIONS") {
    return preflightResponse(origin);
  }
  if (request.method !== "POST") {
    return jsonResponse(
      405,
      "METHOD_NOT_ALLOWED",
      "지원하지 않는 요청 방식이에요.",
      origin,
      { Allow: "POST, OPTIONS" },
    );
  }
  if (mediaType(request) !== "application/json") {
    return jsonResponse(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "JSON 형식으로 후보 오디오를 보내 주세요.",
      origin,
    );
  }

  const providerResolution = resolveCandidateInsightConnection(environment);
  if (
    !providerResolution.ok ||
    environment.RATE_LIMITER === undefined ||
    environment.IP_RATE_LIMITER === undefined
  ) {
    return jsonResponse(
      503,
      "PROXY_NOT_CONFIGURED",
      "AI 연결 준비가 아직 끝나지 않았어요.",
      origin,
    );
  }
  if (providerResolution.connection.provider !== "gemini") {
    return jsonResponse(
      503,
      "PROVIDER_NOT_ACTIVE",
      "선택한 후보 분석 공급자는 아직 운영 경로가 활성화되지 않았어요.",
      origin,
    );
  }
  const providerConnection = providerResolution.connection;

  const declaredLength = request.headers.get("Content-Length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) ||
      Number(declaredLength) > MAX_REQUEST_BODY_BYTES)
  ) {
    return jsonResponse(
      413,
      "PAYLOAD_TOO_LARGE",
      "후보 오디오 요청이 허용 크기를 넘었어요.",
      origin,
    );
  }

  let requestBytes: Uint8Array;
  try {
    requestBytes = await readBodyWithLimit(
      request.body,
      MAX_REQUEST_BODY_BYTES,
    );
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return jsonResponse(
        413,
        "PAYLOAD_TOO_LARGE",
        "후보 오디오 요청이 허용 크기를 넘었어요.",
        origin,
      );
    }
    return jsonResponse(
      400,
      "INVALID_REQUEST",
      "후보 오디오 요청을 읽지 못했어요.",
      origin,
    );
  }

  const candidateRequest = parseCandidateRequest(requestBytes);
  requestBytes.fill(0);
  if (candidateRequest === null) {
    return jsonResponse(
      400,
      "INVALID_REQUEST",
      "후보 오디오 요청 형식을 확인해 주세요.",
      origin,
    );
  }

  const wavBytes = decodeStrictBase64(candidateRequest.audioBase64);
  if (
    wavBytes === null ||
    !isCanonicalCandidateWav(wavBytes, candidateRequest.candidateDurationMs)
  ) {
    wavBytes?.fill(0);
    return jsonResponse(
      400,
      "INVALID_AUDIO",
      "16kHz 모노 WAV 후보 오디오를 확인해 주세요.",
      origin,
    );
  }

  let clientRateLimit: { readonly success: boolean };
  try {
    clientRateLimit = await environment.IP_RATE_LIMITER.limit({
      key: clientRateLimitKey(request),
    });
  } catch {
    wavBytes.fill(0);
    return jsonResponse(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "요청 보호 장치를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      origin,
    );
  }
  if (!clientRateLimit.success) {
    wavBytes.fill(0);
    return jsonResponse(
      429,
      "RATE_LIMITED",
      "잠시 요청이 많아요. 1분 뒤 다시 시도해 주세요.",
      origin,
      { "Retry-After": "60" },
    );
  }

  let globalRateLimit: { readonly success: boolean };
  try {
    globalRateLimit = await environment.RATE_LIMITER.limit({
      key: RATE_LIMIT_KEY,
    });
  } catch {
    wavBytes.fill(0);
    return jsonResponse(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "요청 보호 장치를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      origin,
    );
  }
  if (!globalRateLimit.success) {
    wavBytes.fill(0);
    return jsonResponse(
      429,
      "RATE_LIMITED",
      "잠시 요청이 많아요. 1분 뒤 다시 시도해 주세요.",
      origin,
      { "Retry-After": "60" },
    );
  }

  let upstreamRequestBody: string;
  try {
    upstreamRequestBody = JSON.stringify(
      buildCandidatePassBGeminiRequestBody(
        candidateRequest.audioBase64,
        candidateRequest.candidateDurationMs,
        candidateRequest.videoFrames,
      ),
    );
  } catch {
    wavBytes.fill(0);
    return jsonResponse(
      400,
      "INVALID_REQUEST",
      "후보 오디오 요청 형식을 확인해 주세요.",
      origin,
    );
  }
  wavBytes.fill(0);

  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  const timeoutMs = dependencies.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const retryDelaysMs =
    dependencies.upstreamRetryDelaysMs ?? DEFAULT_UPSTREAM_RETRY_DELAYS_MS;
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetchWithTransientRetries(
      fetchImplementation,
      providerConnection.endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": providerConnection.apiKey,
        },
        body: upstreamRequestBody,
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      },
      timeoutMs,
      retryDelaysMs,
    );
  } catch (error) {
    if (error instanceof UpstreamTimeoutError) {
      return jsonResponse(
        504,
        "UPSTREAM_TIMEOUT",
        "Gemini 응답 시간이 길어져 요청을 멈췄어요. 다시 시도해 주세요.",
        origin,
      );
    }
    return jsonResponse(
      502,
      "UPSTREAM_UNAVAILABLE",
      "AI에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      origin,
    );
  }
  if (!upstreamResponse.ok) {
    if (upstreamResponse.status === 429) {
      return jsonResponse(
        429,
        "UPSTREAM_RATE_LIMITED",
        "Gemini 사용 한도에 도달했어요. 잠시 뒤 다시 시도해 주세요.",
        origin,
        { "Retry-After": "60" },
      );
    }
    if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
      return jsonResponse(
        503,
        "PROXY_NOT_CONFIGURED",
        "AI 연결 설정을 확인해야 해요.",
        origin,
      );
    }
    if (upstreamResponse.status >= 500 && upstreamResponse.status <= 599) {
      return jsonResponse(
        502,
        "UPSTREAM_UNAVAILABLE",
        "AI에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
        origin,
      );
    }
    if (upstreamResponse.status === 400) {
      const rejection = await classifyUpstreamRejection(upstreamResponse);
      if (rejection === "api-key") {
        return jsonResponse(
          503,
          "PROXY_NOT_CONFIGURED",
          "AI 연결 설정을 확인해야 해요.",
          origin,
        );
      }
      if (rejection === "response-format") {
        return jsonResponse(
          502,
          "UPSTREAM_RESPONSE_FORMAT_REJECTED",
          "AI 응답 형식 설정을 확인해야 해요.",
          origin,
        );
      }
      if (rejection === "invalid-argument") {
        return jsonResponse(
          502,
          "UPSTREAM_INVALID_ARGUMENT",
          "AI가 후보 분석 요청을 받아들이지 않았어요.",
          origin,
        );
      }
    }
    return jsonResponse(
      502,
      "UPSTREAM_REJECTED",
      "AI가 후보 분석 요청을 처리하지 못했어요.",
      origin,
    );
  }

  const upstreamDeclaredLength = upstreamResponse.headers.get("Content-Length");
  if (
    upstreamDeclaredLength !== null &&
    (!/^\d+$/u.test(upstreamDeclaredLength) ||
      Number(upstreamDeclaredLength) > MAX_CANDIDATE_PASS_B_RESPONSE_BYTES)
  ) {
    return jsonResponse(
      502,
      "UPSTREAM_INVALID_RESPONSE",
      "AI 답변을 안전하게 확인하지 못했어요.",
      origin,
    );
  }

  let upstreamBytes: Uint8Array;
  try {
    upstreamBytes = await readBodyWithLimit(
      upstreamResponse.body,
      MAX_CANDIDATE_PASS_B_RESPONSE_BYTES,
    );
  } catch {
    return jsonResponse(
      502,
      "UPSTREAM_INVALID_RESPONSE",
      "AI 답변을 안전하게 확인하지 못했어요.",
      origin,
    );
  }

  let upstreamPayload: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(upstreamBytes);
    upstreamBytes.fill(0);
    upstreamPayload = JSON.parse(text);
  } catch {
    upstreamBytes.fill(0);
    return jsonResponse(
      502,
      "UPSTREAM_INVALID_RESPONSE",
      "AI 답변을 안전하게 확인하지 못했어요.",
      origin,
    );
  }
  const parsed = extractCandidatePassBGeminiResponse(
    upstreamPayload,
    candidateRequest.candidateDurationMs,
  );
  if (!parsed.ok) {
    return jsonResponse(
      502,
      "UPSTREAM_INVALID_RESPONSE",
      "AI 답변을 안전하게 확인하지 못했어요.",
      origin,
    );
  }
  return successResponse(upstreamPayload, origin);
}


export async function handleBroadcastContextRequest(
  request: Request,
  environment: AiProxyEnvironment,
  dependencies: AiProxyDependencies = {},
): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (!isAllowedOrigin(origin)) {
    return jsonResponse(403, "ORIGIN_NOT_ALLOWED", "이 페이지에서는 전체 맥락 분석을 시작할 수 없어요.", origin);
  }
  if (request.method === "OPTIONS") {
    return preflightResponse(origin);
  }
  if (request.method !== "POST") {
    return jsonResponse(405, "METHOD_NOT_ALLOWED", "지원하지 않는 요청 방식이에요.", origin, { Allow: "POST, OPTIONS" });
  }
  if (mediaType(request) !== "application/json") {
    return jsonResponse(415, "UNSUPPORTED_MEDIA_TYPE", "JSON 형식으로 요청해 주세요.", origin);
  }

  const providerResolution = resolveBroadcastContextConnection(environment);
  if (!providerResolution.ok || environment.RATE_LIMITER === undefined || environment.IP_RATE_LIMITER === undefined) {
    return jsonResponse(503, "PROXY_NOT_CONFIGURED", "전체 맥락 분석 연결 준비가 아직 끝나지 않았어요.", origin);
  }
  if (providerResolution.connection.provider !== "deepseek") {
    return jsonResponse(503, "PROVIDER_NOT_ACTIVE", "선택한 전체 맥락 분석 공급자는 아직 운영 경로가 활성화되지 않았어요.", origin);
  }
  const providerConnection = providerResolution.connection;

  let requestBytes: Uint8Array;
  try {
    requestBytes = await readBodyWithLimit(request.body, MAX_REQUEST_BODY_BYTES);
  } catch {
    return jsonResponse(413, "PAYLOAD_TOO_LARGE", "요청이 허용 크기를 넘었어요.", origin);
  }

  let inputValue: unknown;
  try {
    const requestText = new TextDecoder("utf-8", { fatal: true }).decode(requestBytes);
    inputValue = JSON.parse(requestText);
  } catch {
    return jsonResponse(400, "INVALID_REQUEST", "요청 형식을 확인해 주세요.", origin);
  }

  let broadcastContextRequest;
  try {
    broadcastContextRequest = createBroadcastContextRequest(inputValue as BroadcastContextRequestInput);
  } catch (error) {
    return jsonResponse(400, "INVALID_REQUEST", error instanceof BroadcastContextInputError ? error.message : "요청 형식을 확인해 주세요.", origin);
  }

  const clientRateLimit = await environment.IP_RATE_LIMITER.limit({ key: clientRateLimitKey(request) });
  if (!clientRateLimit.success) {
    return jsonResponse(429, "RATE_LIMITED", "잠시 요청이 많아요. 1분 뒤 다시 시도해 주세요.", origin, { "Retry-After": "60" });
  }

  const globalRateLimit = await environment.RATE_LIMITER.limit({ key: RATE_LIMIT_KEY });
  if (!globalRateLimit.success) {
    return jsonResponse(429, "RATE_LIMITED", "잠시 요청이 많아요. 1분 뒤 다시 시도해 주세요.", origin, { "Retry-After": "60" });
  }

  const upstreamRequestBody = JSON.stringify(
    buildBroadcastContextDeepseekRequestBody(broadcastContextRequest, providerConnection.descriptor.modelId)
  );

  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  const timeoutMs = dependencies.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const retryDelaysMs = dependencies.upstreamRetryDelaysMs ?? DEFAULT_UPSTREAM_RETRY_DELAYS_MS;
  
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetchWithTransientRetries(
      fetchImplementation,
      providerConnection.endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${providerConnection.apiKey}`,
        },
        body: upstreamRequestBody,
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      },
      timeoutMs,
      retryDelaysMs,
    );
  } catch {
    return jsonResponse(502, "UPSTREAM_UNAVAILABLE", "AI에 연결하지 못했어요.", origin);
  }

  if (!upstreamResponse.ok) {
    return jsonResponse(502, "UPSTREAM_REJECTED", "AI가 요청을 처리하지 못했어요.", origin);
  }

  let upstreamBytes: Uint8Array;
  try {
    upstreamBytes = await readBodyWithLimit(upstreamResponse.body, MAX_BROADCAST_CONTEXT_DEEPSEEK_RESPONSE_BYTES);
  } catch {
    return jsonResponse(502, "UPSTREAM_INVALID_RESPONSE", "답변을 안전하게 확인하지 못했어요.", origin);
  }

  let upstreamPayload: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(upstreamBytes);
    upstreamPayload = JSON.parse(text);
  } catch {
    return jsonResponse(502, "UPSTREAM_INVALID_RESPONSE", "답변을 안전하게 확인하지 못했어요.", origin);
  }

  const parsed = extractBroadcastContextDeepseekResponse(upstreamPayload, broadcastContextRequest);
  if (!parsed.ok) {
    return jsonResponse(502, "UPSTREAM_INVALID_RESPONSE", "답변 형식을 확인할 수 없어요.", origin);
  }

  return successResponse(parsed.result, origin);
}

export default {
  fetch(request: Request, environment: AiProxyEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === BROADCAST_CONTEXT_ENDPOINT_PATH) {
      return handleBroadcastContextRequest(request, environment);
    }
    return handleCandidateInsightRequest(request, environment);
  },
};

