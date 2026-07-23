import {
  MAX_CANDIDATE_PASS_B_RESPONSE_BYTES,
  buildCandidatePassBAudioOnlySafeResponse,
  buildCandidatePassBGeminiRequestBody,
  extractCandidatePassBGeminiResponse,
} from "../analysis/candidatePassBGemini";
import {
  buildCandidatePassBQwenOmniRequestBody,
  extractCandidatePassBQwenOmniSseResponse,
  inspectCandidatePassBQwenOmniSseResponse,
} from "../analysis/candidatePassBQwenOmni";
import {
  CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER,
  CANDIDATE_PASS_B_RESPONSE_MODEL_ID_HEADER,
  CANDIDATE_PASS_B_RESPONSE_MODEL_REVISION_HEADER,
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAMES,
  type CandidatePassBContextPacket,
  type CandidatePassBVideoFrame,
} from "../analysis/candidatePassBWorkerProtocol";
import { isCandidatePassBContextPacket } from "../analysis/candidateFinalVerification";
import {
  isCandidatePassBCastRosterId,
  type CandidatePassBCastRosterId,
} from "../analysis/participantRoster";
import {
  isAnalysisLanguage,
  type AnalysisLanguage,
} from "../domain/analysisLanguage";
import {
  MAX_BROADCAST_CONTEXT_DEEPSEEK_RESPONSE_BYTES,
  buildBroadcastContextDeepseekRequestBody,
  buildBroadcastContextQwenRequestBody,
  extractBroadcastContextDeepseekResponse,
  extractBroadcastContextQwenDiscoveryResponse,
  extractBroadcastContextQwenRefinementResponse,
  extractBroadcastContextQwenSelectionResponse,
  extractBroadcastContextQwenOverviewResponse,
} from "../analysis/broadcastContextDeepseek";
import {
  createBroadcastContextRequest,
  BroadcastContextInputError,
  type BroadcastContextRequest,
  type BroadcastContextRequestInput,
} from "../analysis/broadcastContextProtocol";
import {
  MAX_BROADCAST_TRANSCRIPT_QWEN_BASE64_LENGTH,
  MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS,
  MAX_BROADCAST_TRANSCRIPT_QWEN_RESPONSE_BYTES,
  buildBroadcastTranscriptGeminiRequestBody,
  buildBroadcastTranscriptQwenOmniRequestBody,
  extractBroadcastTranscriptGeminiResponse,
  extractBroadcastTranscriptQwenOmniSseResponse,
  parseBroadcastTranscriptQwenProxyRequest,
  type BroadcastTranscriptQwenResult,
} from "../analysis/broadcastTranscriptQwen";
import {
  YOUTUBE_VIDEO_ID_PATTERN,
  extractKoreanYouTubeCaptionTrackFromPlayerResponse,
  parseYouTubeCaptionJson3,
} from "../analysis/youtubeCaptionTrack";

import {
  AI_PROVIDER_ROUTING_POLICY_VERSION,
  QWEN_CONTEXT_MODEL_ID,
  QWEN_CONTEXT_MODEL_REVISION,
  QWEN_CONTEXT_DISCOVERY_MODEL_ID,
  QWEN_CONTEXT_DISCOVERY_MODEL_REVISION,
  QWEN_CONTEXT_REFINEMENT_MODEL_ID,
  QWEN_CONTEXT_REFINEMENT_MODEL_REVISION,
  QWEN_CONTEXT_QUALITY_REFINEMENT_MODEL_ID,
  QWEN_CONTEXT_QUALITY_REFINEMENT_MODEL_REVISION,
  createAiProviderReadinessManifest,
  isBoundedAiProviderFallbackEnabled,
  resolveCandidateInsightFallbackConnection,
  resolveCandidateInsightConnection,
  resolveBroadcastContextConnection,
  resolveBroadcastTranscriptFallbackConnection,
  resolveBroadcastTranscriptConnection,
  type AiProviderEnvironment,
  type BroadcastContextConnection,
  type BroadcastTranscriptConnection,
  type CandidateInsightConnection,
  type CandidateInsightProviderId,
} from "./aiProviderConfiguration";

const ENDPOINT_PATH = "/v1/candidate-insights";
const BROADCAST_CONTEXT_ENDPOINT_PATH = "/v1/broadcast-context";
const BROADCAST_TRANSCRIPT_ENDPOINT_PATH = "/v1/broadcast-transcript";
const YOUTUBE_CAPTIONS_ENDPOINT_PATH = "/v1/youtube-captions";
const CHZZK_VIDEO_CHANNEL_ENDPOINT_PATH = "/v1/chzzk-video-channel";
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
const MAX_BROADCAST_TRANSCRIPT_WAV_BYTES =
  WAV_HEADER_BYTES +
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ *
    PCM_BYTES_PER_SAMPLE *
    (MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS / 1_000);
const MAX_BROADCAST_TRANSCRIPT_REQUEST_BODY_BYTES =
  MAX_BROADCAST_TRANSCRIPT_QWEN_BASE64_LENGTH + 8_192;
const MAX_UPSTREAM_ERROR_BYTES = 16 * 1024;
const UPSTREAM_TIMEOUT_MS = 90_000;
const DEFAULT_UPSTREAM_RETRY_DELAYS_MS = Object.freeze([1_000, 2_000]);
const RATE_LIMIT_KEY = "candidate-insights";
const BROADCAST_CONTEXT_RATE_LIMIT_KEY = "broadcast-context";
const BROADCAST_TRANSCRIPT_RATE_LIMIT_KEY = "broadcast-transcript";
const YOUTUBE_CAPTIONS_RATE_LIMIT_KEY = "youtube-captions";
const CHZZK_VIDEO_CHANNEL_RATE_LIMIT_KEY = "chzzk-video-channel";
// YouTube embeds this public Android bootstrap key in its clients. It is not a
// user credential; it only selects the public Innertube surface.
const YOUTUBE_INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const YOUTUBE_ANDROID_CLIENT_VERSION = "20.10.38";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const EXCLIPPER_USAGE_PROMPT_TOKENS_HEADER =
  "X-ExClipper-Usage-Prompt-Tokens";
const EXCLIPPER_USAGE_COMPLETION_TOKENS_HEADER =
  "X-ExClipper-Usage-Completion-Tokens";
const EXCLIPPER_USAGE_TOTAL_TOKENS_HEADER =
  "X-ExClipper-Usage-Total-Tokens";
const EXCLIPPER_FALLBACK_REASON_HEADER = "X-ExClipper-Fallback-Reason";
const EXCLIPPER_PRIMARY_FAILURE_HEADER = "X-ExClipper-Primary-Failure";
const EXCLIPPER_FALLBACK_FAILURE_HEADER = "X-ExClipper-Fallback-Failure";
const MAX_YOUTUBE_WATCH_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_YOUTUBE_CAPTION_BYTES = 8 * 1024 * 1024;
const MAX_CHZZK_VIDEO_METADATA_BYTES = 256 * 1024;
const CHZZK_VIDEO_NO_PATTERN = /^\d{7,12}$/u;
const CHZZK_CHANNEL_ID_PATTERN = /^[0-9a-f]{32}$/u;

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
  readonly castRosterId: CandidatePassBCastRosterId | null;
  readonly outputLanguage: AnalysisLanguage;
  readonly context: CandidatePassBContextPacket | null;
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

interface ProviderTokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

function readProviderTokenUsage(payload: unknown): ProviderTokenUsage | null {
  if (!isRecord(payload) || !isRecord(payload.usage)) return null;
  const promptTokens = payload.usage.prompt_tokens;
  const completionTokens = payload.usage.completion_tokens;
  const totalTokens = payload.usage.total_tokens;
  if (
    !Number.isSafeInteger(promptTokens) ||
    (promptTokens as number) < 0 ||
    !Number.isSafeInteger(completionTokens) ||
    (completionTokens as number) < 0
  ) {
    return null;
  }
  const computedTotal = (promptTokens as number) + (completionTokens as number);
  return {
    promptTokens: promptTokens as number,
    completionTokens: completionTokens as number,
    totalTokens:
      Number.isSafeInteger(totalTokens) && (totalTokens as number) >= computedTotal
        ? totalTokens as number
        : computedTotal,
  };
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
  headers.set(
    "Access-Control-Expose-Headers",
    [
      CANDIDATE_PASS_B_RESPONSE_MODEL_ID_HEADER,
      CANDIDATE_PASS_B_RESPONSE_MODEL_REVISION_HEADER,
      CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER,
      EXCLIPPER_USAGE_PROMPT_TOKENS_HEADER,
      EXCLIPPER_USAGE_COMPLETION_TOKENS_HEADER,
      EXCLIPPER_USAGE_TOTAL_TOKENS_HEADER,
      EXCLIPPER_FALLBACK_REASON_HEADER,
      EXCLIPPER_PRIMARY_FAILURE_HEADER,
      EXCLIPPER_FALLBACK_FAILURE_HEADER,
    ].join(", "),
  );
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

function preflightResponse(origin: string, methods = "POST, OPTIONS"): Response {
  const headers = corsHeaders(origin);
  headers.set("Access-Control-Allow-Methods", methods);
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
    !["audioBase64", "candidateDurationMs"].every((key) => key in value) ||
    Object.keys(value).some((key) => ![
      "audioBase64",
      "candidateDurationMs",
      "videoFrames",
      "context",
      "castRosterId",
      "outputLanguage",
    ].includes(key)) ||
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
      !isStrictBase64(frame.dataBase64)
    ) {
      return null;
    }
    videoFrames.push({
      timestampMs: frame.timestampMs as number,
      mimeType: "image/jpeg",
      dataBase64: frame.dataBase64,
    });
  }
  const castRosterId = "castRosterId" in value ? value.castRosterId : null;
  if (castRosterId !== null && !isCandidatePassBCastRosterId(castRosterId)) {
    return null;
  }
  const context = "context" in value ? value.context : null;
  if (context !== null && !isCandidatePassBContextPacket(context)) return null;
  const outputLanguage = "outputLanguage" in value ? value.outputLanguage : "ko";
  if (!isAnalysisLanguage(outputLanguage)) return null;
  return {
    audioBase64: value.audioBase64,
    candidateDurationMs: value.candidateDurationMs as number,
    videoFrames,
    castRosterId,
    outputLanguage,
    context,
  };
}

/**
 * Shape check only. The pattern is a single flat character class so it scans
 * the input once with no backtracking, which matters because these payloads
 * reach several megabytes.
 */
function isStrictBase64(value: string): boolean {
  return (
    value.length > 0 &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/u.test(value) &&
    !value.slice(0, -2).includes("=")
  );
}

/** Decoded byte length derived from the encoding, without decoding anything. */
function base64DecodedByteLength(value: string): number {
  if (value.length % 4 !== 0) {
    return 0;
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

/**
 * Upstream bodies for raw-WAV ingress are assembled as bytes end to end.
 *
 * The JSON ingress path decoded, parsed and re-stringified megabyte payloads,
 * holding roughly 30 MB of transient strings per request against a 128 MB
 * isolate; two concurrent chunks were enough to kill the Worker (measured
 * 2026-07-23). Byte assembly keeps the whole trip near 7 MB per request,
 * which is what makes overlapping chunks safe.
 *
 * The sentinel is valid base64 so the existing builders accept it, and the
 * exact 28-character token cannot occur in the fixed template text, so
 * splitting on it yields exactly the prefix and suffix around the audio.
 */
const TRANSCRIPT_AUDIO_SENTINEL = "ExclipperAudioSentinel000000";
const BASE64_BYTE_ALPHABET = new TextEncoder().encode(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
);
const BASE64_PAD_BYTE = 61;

function base64EncodeToBytes(input: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(4 * Math.ceil(input.byteLength / 3));
  const whole = input.byteLength - (input.byteLength % 3);
  let o = 0;
  for (let i = 0; i < whole; i += 3) {
    const x = (input[i]! << 16) | (input[i + 1]! << 8) | input[i + 2]!;
    out[o] = BASE64_BYTE_ALPHABET[(x >>> 18) & 63]!;
    out[o + 1] = BASE64_BYTE_ALPHABET[(x >>> 12) & 63]!;
    out[o + 2] = BASE64_BYTE_ALPHABET[(x >>> 6) & 63]!;
    out[o + 3] = BASE64_BYTE_ALPHABET[x & 63]!;
    o += 4;
  }
  const rest = input.byteLength - whole;
  if (rest === 1) {
    const x = input[whole]! << 16;
    out[o] = BASE64_BYTE_ALPHABET[(x >>> 18) & 63]!;
    out[o + 1] = BASE64_BYTE_ALPHABET[(x >>> 12) & 63]!;
    out[o + 2] = BASE64_PAD_BYTE;
    out[o + 3] = BASE64_PAD_BYTE;
  } else if (rest === 2) {
    const x = (input[whole]! << 16) | (input[whole + 1]! << 8);
    out[o] = BASE64_BYTE_ALPHABET[(x >>> 18) & 63]!;
    out[o + 1] = BASE64_BYTE_ALPHABET[(x >>> 12) & 63]!;
    out[o + 2] = BASE64_BYTE_ALPHABET[(x >>> 6) & 63]!;
    out[o + 3] = BASE64_PAD_BYTE;
  }
  return out;
}

type BroadcastTranscriptAudioPayload =
  | { readonly kind: "base64"; readonly audioBase64: string }
  | { readonly kind: "wav-bytes"; readonly wavBytes: Uint8Array };

function buildBroadcastTranscriptUpstreamBytes(
  provider: string,
  wavBytes: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const template = JSON.stringify(
    provider === "gemini"
      ? buildBroadcastTranscriptGeminiRequestBody(TRANSCRIPT_AUDIO_SENTINEL)
      : buildBroadcastTranscriptQwenOmniRequestBody(TRANSCRIPT_AUDIO_SENTINEL),
  );
  const parts = template.split(TRANSCRIPT_AUDIO_SENTINEL);
  if (parts.length !== 2) {
    throw new Error("The audio sentinel must split the template exactly once.");
  }
  const encoder = new TextEncoder();
  const prefix = encoder.encode(parts[0]);
  const suffix = encoder.encode(parts[1]);
  const audio = base64EncodeToBytes(wavBytes);
  const out = new Uint8Array(
    prefix.byteLength + audio.byteLength + suffix.byteLength,
  );
  out.set(prefix, 0);
  out.set(audio, prefix.byteLength);
  out.set(suffix, prefix.byteLength + audio.byteLength);
  audio.fill(0);
  return out;
}

/**
 * Decodes only the leading bytes of a base64 payload.
 *
 * Media validation here needs the container header and the total length, never
 * the samples themselves. Decoding a full 90-second WAV cost roughly three
 * million `charCodeAt` iterations per request and pushed the Worker past its
 * resource limits, which Cloudflare surfaced as an empty 503 with no CORS
 * headers — reported by browsers as a misleading CORS failure.
 */
function decodeStrictBase64Prefix(
  value: string,
  maximumBytes: number,
): Uint8Array | null {
  if (!isStrictBase64(value)) {
    return null;
  }
  const wholeGroups = Math.min(
    value.length / 4,
    Math.ceil(maximumBytes / 3),
  );
  const prefix = value.slice(0, wholeGroups * 4);
  try {
    // A whole number of 4-character groups always decodes on its own.
    const decoded = atob(prefix);
    const bytes = new Uint8Array(Math.min(decoded.length, maximumBytes));
    for (let index = 0; index < bytes.length; index += 1) {
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
  header: Uint8Array,
  totalByteLength: number,
  candidateDurationMs: number,
): boolean {
  if (
    header.byteLength < WAV_HEADER_BYTES ||
    totalByteLength < WAV_HEADER_BYTES ||
    totalByteLength > MAX_WAV_BYTES
  ) {
    return false;
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const dataLength = view.getUint32(40, true);
  const sampleCount = dataLength / PCM_BYTES_PER_SAMPLE;
  const expectedSampleCount = Math.ceil(
    (candidateDurationMs / 1_000) * CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  );
  return (
    matchesAscii(header, 0, "RIFF") &&
    view.getUint32(4, true) + 8 === totalByteLength &&
    matchesAscii(header, 8, "WAVE") &&
    matchesAscii(header, 12, "fmt ") &&
    view.getUint32(16, true) === 16 &&
    view.getUint16(20, true) === 1 &&
    view.getUint16(22, true) === 1 &&
    view.getUint32(24, true) === CANDIDATE_PASS_B_SAMPLE_RATE_HZ &&
    view.getUint32(28, true) ===
      CANDIDATE_PASS_B_SAMPLE_RATE_HZ * PCM_BYTES_PER_SAMPLE &&
    view.getUint16(32, true) === PCM_BYTES_PER_SAMPLE &&
    view.getUint16(34, true) === 16 &&
    matchesAscii(header, 36, "data") &&
    dataLength > 0 &&
    dataLength % PCM_BYTES_PER_SAMPLE === 0 &&
    WAV_HEADER_BYTES + dataLength === totalByteLength &&
    sampleCount === expectedSampleCount &&
    sampleCount <=
      (MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS / 1_000) *
        CANDIDATE_PASS_B_SAMPLE_RATE_HZ
  );
}

function isCanonicalBroadcastTranscriptWav(
  header: Uint8Array,
  totalByteLength: number,
  durationMs: number,
): boolean {
  if (
    header.byteLength < WAV_HEADER_BYTES ||
    totalByteLength < WAV_HEADER_BYTES ||
    totalByteLength > MAX_BROADCAST_TRANSCRIPT_WAV_BYTES
  ) {
    return false;
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const dataLength = view.getUint32(40, true);
  const sampleCount = dataLength / PCM_BYTES_PER_SAMPLE;
  const expectedSampleCount = Math.ceil(
    (durationMs / 1_000) * CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  );
  return (
    matchesAscii(header, 0, "RIFF") &&
    view.getUint32(4, true) + 8 === totalByteLength &&
    matchesAscii(header, 8, "WAVE") &&
    matchesAscii(header, 12, "fmt ") &&
    view.getUint32(16, true) === 16 &&
    view.getUint16(20, true) === 1 &&
    view.getUint16(22, true) === 1 &&
    view.getUint32(24, true) === CANDIDATE_PASS_B_SAMPLE_RATE_HZ &&
    view.getUint32(28, true) ===
      CANDIDATE_PASS_B_SAMPLE_RATE_HZ * PCM_BYTES_PER_SAMPLE &&
    view.getUint16(32, true) === PCM_BYTES_PER_SAMPLE &&
    view.getUint16(34, true) === 16 &&
    matchesAscii(header, 36, "data") &&
    dataLength > 0 &&
    dataLength % PCM_BYTES_PER_SAMPLE === 0 &&
    WAV_HEADER_BYTES + dataLength === totalByteLength &&
    sampleCount === expectedSampleCount
  );
}

function mediaType(request: Request): string | null {
  const header = request.headers.get("Content-Type");
  return header?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function scopedClientRateLimitKey(request: Request, scope: string): string {
  const clientIp = request.headers.get("CF-Connecting-IP")?.trim();
  if (
    clientIp === undefined ||
    clientIp.length === 0 ||
    clientIp.length > 64 ||
    /[\p{Cc}\p{Cf}\s]/u.test(clientIp)
  ) {
    return `${scope}:unknown`;
  }
  return `${scope}:${clientIp}`;
}

function clientRateLimitKey(request: Request): string {
  return scopedClientRateLimitKey(request, RATE_LIMIT_KEY);
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

async function readSafeProviderErrorCode(response: Response): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = await readBodyWithLimit(response.body, MAX_UPSTREAM_ERROR_BYTES);
  } catch {
    return "unreadable";
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    bytes.fill(0);
    return "invalid-json";
  }
  bytes.fill(0);
  if (!isRecord(payload)) return "missing";
  const nestedError = isRecord(payload.error) ? payload.error : null;
  const rawCode = payload.code ?? nestedError?.code ?? nestedError?.status;
  return typeof rawCode === "string" && /^[A-Za-z0-9_.:-]{1,80}$/u.test(rawCode)
    ? rawCode
    : "missing";
}

function successResponse(
  payload: unknown,
  origin: string,
  additionalHeaders?: Readonly<Record<string, string>>,
): Response {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", JSON_CONTENT_TYPE);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  for (const [name, value] of Object.entries(additionalHeaders ?? {})) {
    headers.set(name, value);
  }
  return new Response(JSON.stringify(payload), { status: 200, headers });
}

function healthResponse(
  request: Request,
  environment: AiProviderEnvironment,
): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": JSON_CONTENT_TYPE,
    "X-Content-Type-Options": "nosniff",
  });
  const body = request.method === "HEAD"
    ? null
    : JSON.stringify({
        ok: true,
        service: "rettohighlight-gemini",
        version: 2,
        routingPolicyVersion: AI_PROVIDER_ROUTING_POLICY_VERSION,
        contextModelRevision: QWEN_CONTEXT_MODEL_REVISION,
        providers: createAiProviderReadinessManifest(environment),
      });
  return new Response(body, { status: 200, headers });
}

type CandidateProviderFailureKind =
  | "timeout"
  | "unavailable"
  | "rate-limited"
  | "auth"
  | "model-unavailable"
  | "response-format"
  | "invalid-argument"
  | "rejected"
  | "invalid-response";

type CandidateProviderAttempt =
  | {
      readonly ok: true;
      readonly payload: unknown;
      readonly connection: CandidateInsightConnection;
    }
  | {
      readonly ok: false;
      readonly kind: CandidateProviderFailureKind;
      readonly diagnosticHeaders?: Readonly<Record<string, string>>;
    };

/**
 * Cross-provider retries are reserved for provider-specific or temporary
 * failures. A rejected request or invalid shared argument is deterministic;
 * sending it to another paid model would only hide a contract bug or repeat a
 * policy rejection.
 */
function shouldAttemptCandidateProviderFallback(
  kind: CandidateProviderFailureKind,
): boolean {
  return (
    kind === "timeout" ||
    kind === "unavailable" ||
    kind === "rate-limited" ||
    kind === "auth" ||
    kind === "model-unavailable" ||
    kind === "response-format" ||
    kind === "invalid-response"
  );
}

async function attemptCandidateProvider(
  connection: CandidateInsightConnection,
  candidateRequest: CandidateInsightRequest,
  fetchImplementation: FetchImplementation,
  timeoutMs: number,
  retryDelaysMs: readonly number[],
): Promise<CandidateProviderAttempt> {
  let upstreamRequestBody: string;
  try {
    upstreamRequestBody = JSON.stringify(
      connection.provider === "qwen"
        ? buildCandidatePassBQwenOmniRequestBody(
            candidateRequest.audioBase64,
            candidateRequest.candidateDurationMs,
            candidateRequest.videoFrames,
            candidateRequest.castRosterId,
            candidateRequest.outputLanguage,
            candidateRequest.context,
          )
        : buildCandidatePassBGeminiRequestBody(
            candidateRequest.audioBase64,
            candidateRequest.candidateDurationMs,
            candidateRequest.videoFrames,
            candidateRequest.castRosterId,
            candidateRequest.outputLanguage,
            candidateRequest.context,
          ),
    );
  } catch {
    return { ok: false, kind: "invalid-argument" };
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetchWithTransientRetries(
      fetchImplementation,
      connection.endpoint,
      {
        method: "POST",
        headers:
          connection.provider === "qwen"
            ? {
                "Content-Type": "application/json",
                Authorization: `Bearer ${connection.apiKey}`,
              }
            : {
                "Content-Type": "application/json",
                "x-goog-api-key": connection.apiKey,
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
    return {
      ok: false,
      kind: error instanceof UpstreamTimeoutError ? "timeout" : "unavailable",
    };
  }

  if (!upstreamResponse.ok) {
    if (upstreamResponse.status === 429) {
      await upstreamResponse.body?.cancel().catch(() => undefined);
      return { ok: false, kind: "rate-limited" };
    }
    if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
      await upstreamResponse.body?.cancel().catch(() => undefined);
      return { ok: false, kind: "auth" };
    }
    if (upstreamResponse.status === 404) {
      await upstreamResponse.body?.cancel().catch(() => undefined);
      return { ok: false, kind: "model-unavailable" };
    }
    if (upstreamResponse.status >= 500 && upstreamResponse.status <= 599) {
      await upstreamResponse.body?.cancel().catch(() => undefined);
      return { ok: false, kind: "unavailable" };
    }
    if (upstreamResponse.status === 400) {
      const rejection = await classifyUpstreamRejection(upstreamResponse);
      if (rejection === "api-key") return { ok: false, kind: "auth" };
      if (rejection === "response-format") {
        return { ok: false, kind: "response-format" };
      }
      if (rejection === "invalid-argument") {
        return { ok: false, kind: "invalid-argument" };
      }
      return { ok: false, kind: "rejected" };
    }
    await upstreamResponse.body?.cancel().catch(() => undefined);
    return { ok: false, kind: "rejected" };
  }

  const upstreamDeclaredLength = upstreamResponse.headers.get("Content-Length");
  if (
    upstreamDeclaredLength !== null &&
    (!/^\d+$/u.test(upstreamDeclaredLength) ||
      Number(upstreamDeclaredLength) > MAX_CANDIDATE_PASS_B_RESPONSE_BYTES)
  ) {
    await upstreamResponse.body?.cancel().catch(() => undefined);
    return { ok: false, kind: "invalid-response" };
  }

  let upstreamBytes: Uint8Array;
  try {
    upstreamBytes = await readBodyWithLimit(
      upstreamResponse.body,
      MAX_CANDIDATE_PASS_B_RESPONSE_BYTES,
    );
  } catch {
    return { ok: false, kind: "invalid-response" };
  }

  let upstreamPayload: unknown;
  let qwenDiagnostics: ReturnType<
    typeof inspectCandidatePassBQwenOmniSseResponse
  > | null = null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(upstreamBytes);
    upstreamBytes.fill(0);
    if (connection.provider === "qwen") {
      qwenDiagnostics = inspectCandidatePassBQwenOmniSseResponse(text);
      upstreamPayload = extractCandidatePassBQwenOmniSseResponse(
        text,
        candidateRequest.candidateDurationMs,
        candidateRequest.castRosterId,
        candidateRequest.outputLanguage,
      );
    } else {
      upstreamPayload = JSON.parse(text);
    }
  } catch {
    upstreamBytes.fill(0);
    return { ok: false, kind: "invalid-response" };
  }

  const parsed = extractCandidatePassBGeminiResponse(
    upstreamPayload,
    candidateRequest.candidateDurationMs,
    candidateRequest.castRosterId,
    candidateRequest.outputLanguage,
  );
  if (!parsed.ok) {
    return {
      ok: false,
      kind: "invalid-response",
      ...(qwenDiagnostics === null
        ? {}
        : {
            diagnosticHeaders: {
              "X-Qwen-Stop": qwenDiagnostics.sawStop ? "yes" : "no",
              "X-Qwen-Text-Length": String(qwenDiagnostics.textLength),
              "X-Qwen-Content-Type": qwenDiagnostics.contentWasString
                ? "string"
                : "other",
              "X-Qwen-Json": qwenDiagnostics.jsonObject ? "record" : "invalid",
              "X-Qwen-Keys": qwenDiagnostics.keys.join(",").slice(0, 160),
            },
          }),
    };
  }
  const validatedPayload = {
    candidates: [{
      finishReason: "STOP",
      content: {
        parts: [{
          text: JSON.stringify({
            segments: parsed.analysis.segments,
            ...parsed.analysis.insight,
          }),
        }],
      },
    }],
  };
  const safePayload = candidateRequest.videoFrames.length === 0
    ? buildCandidatePassBAudioOnlySafeResponse(
        validatedPayload,
        candidateRequest.candidateDurationMs,
      )
    : validatedPayload;
  if (safePayload === null) {
    return { ok: false, kind: "invalid-response" };
  }
  return { ok: true, payload: safePayload, connection };
}

function candidateProviderFailureResponse(
  failure: Extract<CandidateProviderAttempt, { readonly ok: false }>,
  origin: string,
): Response {
  switch (failure.kind) {
    case "timeout":
      return jsonResponse(
        504,
        "UPSTREAM_TIMEOUT",
        "AI 응답 시간이 길어져 요청을 멈췄어요. 다시 시도해 주세요.",
        origin,
      );
    case "unavailable":
      return jsonResponse(
        502,
        "UPSTREAM_UNAVAILABLE",
        "AI에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
        origin,
      );
    case "rate-limited":
      return jsonResponse(
        429,
        "UPSTREAM_RATE_LIMITED",
        "AI 사용 한도에 도달했어요. 잠시 뒤 다시 시도해 주세요.",
        origin,
        { "Retry-After": "60" },
      );
    case "auth":
      return jsonResponse(
        503,
        "PROXY_NOT_CONFIGURED",
        "AI 연결 설정을 확인해야 해요.",
        origin,
      );
    case "model-unavailable":
      return jsonResponse(
        502,
        "UPSTREAM_MODEL_UNAVAILABLE",
        "선택한 AI 모델을 사용할 수 없어 대체 경로를 확인해야 해요.",
        origin,
      );
    case "response-format":
      return jsonResponse(
        502,
        "UPSTREAM_RESPONSE_FORMAT_REJECTED",
        "AI 응답 형식 설정을 확인해야 해요.",
        origin,
      );
    case "invalid-argument":
      return jsonResponse(
        502,
        "UPSTREAM_INVALID_ARGUMENT",
        "AI가 후보 분석 요청을 받아들이지 않았어요.",
        origin,
      );
    case "rejected":
      return jsonResponse(
        502,
        "UPSTREAM_REJECTED",
        "AI가 후보 분석 요청을 처리하지 못했어요.",
        origin,
      );
    case "invalid-response":
      return jsonResponse(
        502,
        "UPSTREAM_INVALID_RESPONSE",
        "AI 답변을 안전하게 확인하지 못했어요.",
        origin,
        failure.diagnosticHeaders,
      );
  }
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
      return healthResponse(request, environment);
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

  if (
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
  const providerResolution = resolveCandidateInsightConnection(environment);
  const requestedProvider: CandidateInsightProviderId | null =
    environment.CANDIDATE_INSIGHT_PROVIDER === undefined ||
    environment.CANDIDATE_INSIGHT_PROVIDER === "gemini"
      ? "gemini"
      : environment.CANDIDATE_INSIGHT_PROVIDER === "qwen"
        ? "qwen"
        : null;
  let providerConnection: CandidateInsightConnection;
  let configurationFallbackUsed = false;
  if (providerResolution.ok) {
    providerConnection = providerResolution.connection;
  } else if (
    providerResolution.code === "MISSING_CREDENTIALS" &&
    requestedProvider !== null
  ) {
    const fallbackConnection = resolveCandidateInsightFallbackConnection(
      environment,
      requestedProvider,
    );
    if (fallbackConnection === null) {
      return jsonResponse(
        503,
        "PROXY_NOT_CONFIGURED",
        "AI 연결 준비가 아직 끝나지 않았어요.",
        origin,
      );
    }
    providerConnection = fallbackConnection;
    configurationFallbackUsed = true;
  } else {
    return jsonResponse(
      503,
      "PROXY_NOT_CONFIGURED",
      "AI 연결 준비가 아직 끝나지 않았어요.",
      origin,
    );
  }

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

  const wavHeader = decodeStrictBase64Prefix(
    candidateRequest.audioBase64,
    WAV_HEADER_BYTES,
  );
  if (
    wavHeader === null ||
    !isCanonicalCandidateWav(
      wavHeader,
      base64DecodedByteLength(candidateRequest.audioBase64),
      candidateRequest.candidateDurationMs,
    )
  ) {
    wavHeader?.fill(0);
    return jsonResponse(
      400,
      "INVALID_AUDIO",
      "16kHz 모노 WAV 후보 오디오를 확인해 주세요.",
      origin,
    );
  }
  wavHeader.fill(0);

  let clientRateLimit: { readonly success: boolean };
  try {
    clientRateLimit = await environment.IP_RATE_LIMITER.limit({
      key: clientRateLimitKey(request),
    });
  } catch {
    return jsonResponse(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "요청 보호 장치를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      origin,
    );
  }
  if (!clientRateLimit.success) {
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
    return jsonResponse(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "요청 보호 장치를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      origin,
    );
  }
  if (!globalRateLimit.success) {
    return jsonResponse(
      429,
      "RATE_LIMITED",
      "잠시 요청이 많아요. 1분 뒤 다시 시도해 주세요.",
      origin,
      { "Retry-After": "60" },
    );
  }

  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  const timeoutMs = dependencies.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const retryDelaysMs =
    dependencies.upstreamRetryDelaysMs ?? DEFAULT_UPSTREAM_RETRY_DELAYS_MS;
  const primaryAttempt = await attemptCandidateProvider(
    providerConnection,
    candidateRequest,
    fetchImplementation,
    timeoutMs,
    retryDelaysMs,
  );
  let finalAttempt = primaryAttempt;
  let fallbackUsed = configurationFallbackUsed;
  let primaryFailureKind: CandidateProviderFailureKind | null =
    configurationFallbackUsed ? "auth" : null;
  if (
    !configurationFallbackUsed &&
    !primaryAttempt.ok &&
    shouldAttemptCandidateProviderFallback(primaryAttempt.kind)
  ) {
    const fallbackConnection = resolveCandidateInsightFallbackConnection(
      environment,
      providerConnection.provider,
    );
    if (fallbackConnection !== null) {
      fallbackUsed = true;
      primaryFailureKind = primaryAttempt.kind;
      finalAttempt = await attemptCandidateProvider(
        fallbackConnection,
        candidateRequest,
        fetchImplementation,
        timeoutMs,
        retryDelaysMs,
      );
    }
  }
  if (!finalAttempt.ok) {
    const response = candidateProviderFailureResponse(finalAttempt, origin);
    if (primaryFailureKind !== null && fallbackUsed) {
      response.headers.set(EXCLIPPER_PRIMARY_FAILURE_HEADER, primaryFailureKind);
      response.headers.set(EXCLIPPER_FALLBACK_FAILURE_HEADER, finalAttempt.kind);
    }
    return response;
  }
  return successResponse(finalAttempt.payload, origin, {
    [CANDIDATE_PASS_B_RESPONSE_MODEL_ID_HEADER]:
      finalAttempt.connection.descriptor.modelId,
    [CANDIDATE_PASS_B_RESPONSE_MODEL_REVISION_HEADER]:
      finalAttempt.connection.descriptor.modelRevision,
    [CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER]: fallbackUsed ? "true" : "false",
    ...(primaryFailureKind !== null && fallbackUsed
      ? { [EXCLIPPER_FALLBACK_REASON_HEADER]: primaryFailureKind }
      : {}),
  });
}

type ActiveBroadcastTranscriptConnection = Exclude<
  BroadcastTranscriptConnection,
  { readonly provider: "disabled" }
>;

type BroadcastTranscriptProviderFailureKind =
  | "timeout"
  | "network"
  | "rate-limited"
  | "auth"
  | "model-unavailable"
  | "server-error"
  | "payload-too-large"
  | "response-format"
  | "invalid-argument"
  | "rejected"
  | "invalid-response";

type BroadcastTranscriptProviderAttempt =
  | {
      readonly ok: true;
      readonly result: BroadcastTranscriptQwenResult;
      readonly connection: ActiveBroadcastTranscriptConnection;
    }
  | {
      readonly ok: false;
      readonly kind: BroadcastTranscriptProviderFailureKind;
    };

function shouldAttemptBroadcastTranscriptProviderFallback(
  kind: BroadcastTranscriptProviderFailureKind,
): boolean {
  return (
    kind === "rate-limited" ||
    kind === "auth" ||
    kind === "model-unavailable" ||
    kind === "server-error"
  );
}

async function attemptBroadcastTranscriptProvider(
  connection: ActiveBroadcastTranscriptConnection,
  transcriptRequest: {
    readonly sourceStartMs: number;
    readonly durationMs: number;
  },
  audio: BroadcastTranscriptAudioPayload,
  fetchImplementation: FetchImplementation,
  timeoutMs: number,
): Promise<BroadcastTranscriptProviderAttempt> {
  let upstreamBody: string | Uint8Array<ArrayBuffer>;
  try {
    upstreamBody =
      audio.kind === "wav-bytes"
        ? buildBroadcastTranscriptUpstreamBytes(
            connection.provider,
            audio.wavBytes,
          )
        : JSON.stringify(
            connection.provider === "gemini"
              ? buildBroadcastTranscriptGeminiRequestBody(audio.audioBase64)
              : buildBroadcastTranscriptQwenOmniRequestBody(audio.audioBase64),
          );
  } catch {
    return { ok: false, kind: "invalid-argument" };
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetchWithTimeout(
      fetchImplementation,
      connection.endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(connection.provider === "gemini"
            ? { "x-goog-api-key": connection.apiKey }
            : { Authorization: `Bearer ${connection.apiKey}` }),
        },
        body: upstreamBody,
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      },
      timeoutMs,
    );
  } catch (error) {
    return {
      ok: false,
      kind: error instanceof UpstreamTimeoutError ? "timeout" : "network",
    };
  }

  if (!upstreamResponse.ok) {
    if (connection.provider === "qwen") {
      const providerCode = await readSafeProviderErrorCode(upstreamResponse);
      console.error("broadcast_transcript_upstream_rejected", {
        status: upstreamResponse.status,
        providerCode,
      });
    } else if (upstreamResponse.status === 400) {
      const rejection = await classifyUpstreamRejection(upstreamResponse);
      if (rejection === "api-key") return { ok: false, kind: "auth" };
      if (rejection === "response-format") {
        return { ok: false, kind: "response-format" };
      }
      if (rejection === "invalid-argument") {
        return { ok: false, kind: "invalid-argument" };
      }
      return { ok: false, kind: "rejected" };
    } else {
      await upstreamResponse.body?.cancel().catch(() => undefined);
    }
    if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
      return { ok: false, kind: "auth" };
    }
    if (upstreamResponse.status === 404) {
      return { ok: false, kind: "model-unavailable" };
    }
    if (upstreamResponse.status === 413) {
      return { ok: false, kind: "payload-too-large" };
    }
    if (upstreamResponse.status === 429) {
      return { ok: false, kind: "rate-limited" };
    }
    if (upstreamResponse.status >= 500 && upstreamResponse.status <= 599) {
      return { ok: false, kind: "server-error" };
    }
    return { ok: false, kind: "rejected" };
  }

  let result: BroadcastTranscriptQwenResult | null;
  try {
    const bytes = await readBodyWithLimit(
      upstreamResponse.body,
      MAX_BROADCAST_TRANSCRIPT_QWEN_RESPONSE_BYTES,
    );
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    bytes.fill(0);
    result = connection.provider === "gemini"
      ? extractBroadcastTranscriptGeminiResponse(JSON.parse(text), transcriptRequest)
      : extractBroadcastTranscriptQwenOmniSseResponse(text, transcriptRequest);
  } catch {
    return { ok: false, kind: "invalid-response" };
  }
  return result === null
    ? { ok: false, kind: "invalid-response" }
    : { ok: true, result, connection };
}

function broadcastTranscriptProviderFailureResponse(
  kind: BroadcastTranscriptProviderFailureKind,
  origin: string,
  additionalHeaders?: Readonly<Record<string, string>>,
): Response {
  switch (kind) {
    case "timeout":
      return jsonResponse(504, "UPSTREAM_TIMEOUT", "방송 대사 분석 응답을 받지 못했어요.", origin, additionalHeaders);
    case "network":
    case "server-error":
      return jsonResponse(502, "UPSTREAM_UNAVAILABLE", "방송 대사 분석 응답을 받지 못했어요.", origin, additionalHeaders);
    case "rate-limited":
      return jsonResponse(429, "UPSTREAM_RATE_LIMITED", "방송 대사 분석 요청을 처리하지 못했어요.", origin, {
        "Retry-After": "60",
        ...additionalHeaders,
      });
    case "auth":
      return jsonResponse(503, "PROXY_NOT_CONFIGURED", "방송 대사 분석 연결 설정을 확인해야 해요.", origin, additionalHeaders);
    case "model-unavailable":
      return jsonResponse(502, "UPSTREAM_MODEL_NOT_FOUND", "방송 대사 분석 모델을 찾지 못했어요.", origin, additionalHeaders);
    case "payload-too-large":
      return jsonResponse(502, "UPSTREAM_PAYLOAD_TOO_LARGE", "방송 대사 분석 조각이 모델의 허용 크기를 넘었어요.", origin, additionalHeaders);
    case "response-format":
      return jsonResponse(502, "UPSTREAM_RESPONSE_FORMAT_REJECTED", "방송 대사 응답 형식 설정을 확인해야 해요.", origin, additionalHeaders);
    case "invalid-argument":
      return jsonResponse(502, "UPSTREAM_INVALID_ARGUMENT", "AI가 방송 대사 분석 요청을 받아들이지 않았어요.", origin, additionalHeaders);
    case "rejected":
      return jsonResponse(502, "UPSTREAM_REJECTED", "방송 대사 분석 요청을 처리하지 못했어요.", origin, additionalHeaders);
    case "invalid-response":
      return jsonResponse(502, "UPSTREAM_INVALID_RESPONSE", "방송 대사 분석 응답을 안전하게 확인하지 못했어요.", origin, additionalHeaders);
  }
}


export async function handleBroadcastTranscriptRequest(
  request: Request,
  environment: AiProxyEnvironment,
  dependencies: AiProxyDependencies = {},
): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (!isAllowedOrigin(origin)) {
    return jsonResponse(
      403,
      "ORIGIN_NOT_ALLOWED",
      "이 페이지에서는 방송 대사 분석을 시작할 수 없어요.",
      origin,
    );
  }
  if (request.method === "OPTIONS") return preflightResponse(origin);
  if (request.method !== "POST") {
    return jsonResponse(
      405,
      "METHOD_NOT_ALLOWED",
      "지원하지 않는 요청 방식이에요.",
      origin,
      { Allow: "POST, OPTIONS" },
    );
  }
  const requestMediaType = mediaType(request);
  if (
    requestMediaType !== "application/json" &&
    requestMediaType !== "audio/wav"
  ) {
    return jsonResponse(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "JSON 또는 audio/wav 형식으로 방송 오디오를 보내 주세요.",
      origin,
    );
  }

  const providerResolution = resolveBroadcastTranscriptConnection(environment);
  const requestedProvider =
    environment.BROADCAST_TRANSCRIPT_PROVIDER === "gemini" ||
    environment.BROADCAST_TRANSCRIPT_PROVIDER === "qwen"
      ? environment.BROADCAST_TRANSCRIPT_PROVIDER
      : null;
  let providerConnection: ActiveBroadcastTranscriptConnection;
  let configurationFallbackUsed = false;
  if (providerResolution.ok && providerResolution.connection.provider !== "disabled") {
    providerConnection = providerResolution.connection;
  } else if (
    !providerResolution.ok &&
    providerResolution.code === "MISSING_CREDENTIALS" &&
    requestedProvider !== null
  ) {
    const fallbackConnection = resolveBroadcastTranscriptFallbackConnection(
      environment,
      requestedProvider,
    );
    if (fallbackConnection === null) {
      return jsonResponse(
        503,
        "PROXY_NOT_CONFIGURED",
        "방송 대사 분석 연결을 준비하지 못했어요.",
        origin,
      );
    }
    providerConnection = fallbackConnection;
    configurationFallbackUsed = true;
  } else {
    return jsonResponse(
      503,
      "PROXY_NOT_CONFIGURED",
      "방송 대사 분석 연결을 준비하지 못했어요.",
      origin,
    );
  }
  if (
    environment.RATE_LIMITER === undefined ||
    environment.IP_RATE_LIMITER === undefined
  ) {
    return jsonResponse(
      503,
      "PROXY_NOT_CONFIGURED",
      "방송 대사 분석 연결을 준비하지 못했어요.",
      origin,
    );
  }

  let transcriptTimes: {
    readonly sourceStartMs: number;
    readonly durationMs: number;
  };
  let transcriptAudio: BroadcastTranscriptAudioPayload;
  if (requestMediaType === "audio/wav") {
    const requestUrl = new URL(request.url);
    const startRaw = requestUrl.searchParams.get("startMs");
    const durationRaw = requestUrl.searchParams.get("durationMs");
    const sourceStartMs =
      startRaw !== null && /^\d{1,10}$/u.test(startRaw)
        ? Number(startRaw)
        : null;
    const durationMs =
      durationRaw !== null && /^\d{1,7}$/u.test(durationRaw)
        ? Number(durationRaw)
        : null;
    if (
      [...requestUrl.searchParams.keys()].some(
        (key) => key !== "startMs" && key !== "durationMs",
      ) ||
      sourceStartMs === null ||
      durationMs === null ||
      durationMs <= 0 ||
      durationMs > MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS
    ) {
      return jsonResponse(
        400,
        "INVALID_REQUEST",
        "방송 오디오 요청 형식을 확인해 주세요.",
        origin,
      );
    }
    const declaredLength = request.headers.get("Content-Length");
    if (
      declaredLength !== null &&
      (!/^\d+$/u.test(declaredLength) ||
        Number(declaredLength) > MAX_BROADCAST_TRANSCRIPT_WAV_BYTES)
    ) {
      return jsonResponse(
        413,
        "PAYLOAD_TOO_LARGE",
        "방송 오디오 조각의 크기가 허용 범위를 넘었어요.",
        origin,
      );
    }
    let wavBytes: Uint8Array;
    try {
      wavBytes = await readBodyWithLimit(
        request.body,
        MAX_BROADCAST_TRANSCRIPT_WAV_BYTES,
      );
    } catch {
      return jsonResponse(
        413,
        "PAYLOAD_TOO_LARGE",
        "방송 오디오 조각의 크기가 허용 범위를 넘었어요.",
        origin,
      );
    }
    if (
      wavBytes.byteLength < WAV_HEADER_BYTES ||
      !isCanonicalBroadcastTranscriptWav(
        wavBytes.subarray(0, WAV_HEADER_BYTES),
        wavBytes.byteLength,
        durationMs,
      )
    ) {
      wavBytes.fill(0);
      return jsonResponse(
        400,
        "INVALID_AUDIO",
        "16kHz 모노 WAV 방송 오디오를 확인해 주세요.",
        origin,
      );
    }
    transcriptTimes = { sourceStartMs, durationMs };
    transcriptAudio = { kind: "wav-bytes", wavBytes };
  } else {
    const declaredLength = request.headers.get("Content-Length");
    if (
      declaredLength !== null &&
      (!/^\d+$/u.test(declaredLength) ||
        Number(declaredLength) > MAX_BROADCAST_TRANSCRIPT_REQUEST_BODY_BYTES)
    ) {
      return jsonResponse(
        413,
        "PAYLOAD_TOO_LARGE",
        "방송 오디오 조각의 크기가 허용 범위를 넘었어요.",
        origin,
      );
    }

    let requestBytes: Uint8Array;
    try {
      requestBytes = await readBodyWithLimit(
        request.body,
        MAX_BROADCAST_TRANSCRIPT_REQUEST_BODY_BYTES,
      );
    } catch {
      return jsonResponse(
        413,
        "PAYLOAD_TOO_LARGE",
        "방송 오디오 조각의 크기가 허용 범위를 넘었어요.",
        origin,
      );
    }

    let inputValue: unknown;
    try {
      inputValue = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(requestBytes),
      );
    } catch {
      requestBytes.fill(0);
      return jsonResponse(
        400,
        "INVALID_REQUEST",
        "방송 오디오 요청 형식을 확인해 주세요.",
        origin,
      );
    }
    requestBytes.fill(0);

    const transcriptRequest = parseBroadcastTranscriptQwenProxyRequest(inputValue);
    if (transcriptRequest === null) {
      return jsonResponse(
        400,
        "INVALID_REQUEST",
        "방송 오디오 요청 형식을 확인해 주세요.",
        origin,
      );
    }
    const wavHeader = decodeStrictBase64Prefix(
      transcriptRequest.audioBase64,
      WAV_HEADER_BYTES,
    );
    if (
      wavHeader === null ||
      !isCanonicalBroadcastTranscriptWav(
        wavHeader,
        base64DecodedByteLength(transcriptRequest.audioBase64),
        transcriptRequest.durationMs,
      )
    ) {
      wavHeader?.fill(0);
      return jsonResponse(
        400,
        "INVALID_AUDIO",
        "16kHz 모노 WAV 방송 오디오를 확인해 주세요.",
        origin,
      );
    }
    wavHeader.fill(0);
    transcriptTimes = {
      sourceStartMs: transcriptRequest.sourceStartMs,
      durationMs: transcriptRequest.durationMs,
    };
    transcriptAudio = {
      kind: "base64",
      audioBase64: transcriptRequest.audioBase64,
    };
  }

  try {
    const clientLimit = await environment.IP_RATE_LIMITER.limit({
      key: scopedClientRateLimitKey(request, BROADCAST_TRANSCRIPT_RATE_LIMIT_KEY),
    });
    if (!clientLimit.success) {
      return jsonResponse(
        429,
        "RATE_LIMITED",
        "요청이 잠시 많아요. 1분 뒤 다시 시도해 주세요.",
        origin,
        { "Retry-After": "60" },
      );
    }
    const globalLimit = await environment.RATE_LIMITER.limit({
      key: BROADCAST_TRANSCRIPT_RATE_LIMIT_KEY,
    });
    if (!globalLimit.success) {
      return jsonResponse(
        429,
        "RATE_LIMITED",
        "요청이 잠시 많아요. 1분 뒤 다시 시도해 주세요.",
        origin,
        { "Retry-After": "60" },
      );
    }
  } catch {
    return jsonResponse(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "요청 보호 장치를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      origin,
    );
  }

  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  const timeoutMs = dependencies.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const primaryAttempt = await attemptBroadcastTranscriptProvider(
    providerConnection,
    transcriptTimes,
    transcriptAudio,
    fetchImplementation,
    timeoutMs,
  );
  let finalAttempt = primaryAttempt;
  let fallbackUsed = configurationFallbackUsed;
  let primaryFailureKind: BroadcastTranscriptProviderFailureKind | null =
    configurationFallbackUsed ? "auth" : null;
  if (
    !configurationFallbackUsed &&
    !primaryAttempt.ok &&
    shouldAttemptBroadcastTranscriptProviderFallback(primaryAttempt.kind)
  ) {
    const fallbackConnection = resolveBroadcastTranscriptFallbackConnection(
      environment,
      providerConnection.provider,
    );
    if (fallbackConnection !== null) {
      fallbackUsed = true;
      primaryFailureKind = primaryAttempt.kind;
      finalAttempt = await attemptBroadcastTranscriptProvider(
        fallbackConnection,
        transcriptTimes,
        transcriptAudio,
        fetchImplementation,
        timeoutMs,
      );
    }
  }
  if (transcriptAudio.kind === "wav-bytes") {
    transcriptAudio.wavBytes.fill(0);
  }
  if (!finalAttempt.ok) {
    return broadcastTranscriptProviderFailureResponse(
      finalAttempt.kind,
      origin,
      primaryFailureKind === null || !fallbackUsed
        ? undefined
        : {
            [EXCLIPPER_PRIMARY_FAILURE_HEADER]: primaryFailureKind,
            [EXCLIPPER_FALLBACK_FAILURE_HEADER]: finalAttempt.kind,
          },
    );
  }
  return successResponse(finalAttempt.result, origin, {
    [CANDIDATE_PASS_B_RESPONSE_MODEL_ID_HEADER]:
      finalAttempt.connection.descriptor.modelId,
    [CANDIDATE_PASS_B_RESPONSE_MODEL_REVISION_HEADER]:
      finalAttempt.connection.descriptor.modelRevision,
    [CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER]: fallbackUsed ? "true" : "false",
    ...(primaryFailureKind === null || !fallbackUsed
      ? {}
      : { [EXCLIPPER_FALLBACK_REASON_HEADER]: primaryFailureKind }),
  });
}

export async function handleYouTubeCaptionsRequest(
  request: Request,
  environment: AiProxyEnvironment,
  dependencies: AiProxyDependencies = {},
): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (!isAllowedOrigin(origin)) {
    return jsonResponse(403, "ORIGIN_NOT_ALLOWED", "이 페이지에서는 YouTube 자막을 확인할 수 없어요.", origin);
  }
  if (request.method === "OPTIONS") {
    return preflightResponse(origin, "GET, OPTIONS");
  }
  if (request.method !== "GET") {
    return jsonResponse(405, "METHOD_NOT_ALLOWED", "지원하지 않는 요청 방식이에요.", origin, { Allow: "GET, OPTIONS" });
  }
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => key !== "v")) {
    return jsonResponse(400, "INVALID_REQUEST", "YouTube 영상 ID를 확인해 주세요.", origin);
  }
  const videoId = url.searchParams.get("v") ?? "";
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    return jsonResponse(400, "INVALID_REQUEST", "YouTube 영상 ID를 확인해 주세요.", origin);
  }
  if (environment.RATE_LIMITER === undefined || environment.IP_RATE_LIMITER === undefined) {
    return jsonResponse(503, "PROXY_NOT_CONFIGURED", "자막 확인 연결을 준비하지 못했어요.", origin);
  }
  try {
    const clientLimit = await environment.IP_RATE_LIMITER.limit({
      key: scopedClientRateLimitKey(request, YOUTUBE_CAPTIONS_RATE_LIMIT_KEY),
    });
    const globalLimit = await environment.RATE_LIMITER.limit({ key: YOUTUBE_CAPTIONS_RATE_LIMIT_KEY });
    if (!clientLimit.success || !globalLimit.success) {
      return jsonResponse(429, "RATE_LIMITED", "잠시 요청이 많아요. 1분 뒤 다시 시도해 주세요.", origin, { "Retry-After": "60" });
    }
  } catch {
    return jsonResponse(503, "RATE_LIMIT_UNAVAILABLE", "요청 보호 장치를 확인하지 못했어요.", origin);
  }

  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  let playerResponse: Response;
  try {
    playerResponse = await fetchWithTimeout(
      fetchImplementation,
      `https://www.youtube.com/youtubei/v1/player?key=${YOUTUBE_INNERTUBE_API_KEY}`,
      {
        method: "POST",
        headers: {
          "User-Agent":
            `com.google.android.youtube/${YOUTUBE_ANDROID_CLIENT_VERSION} (Linux; U; Android 12) gzip`,
          "Content-Type": "application/json",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
          "Origin": "https://www.youtube.com",
          "X-YouTube-Client-Name": "3",
          "X-YouTube-Client-Version": YOUTUBE_ANDROID_CLIENT_VERSION,
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: "ANDROID",
              clientVersion: YOUTUBE_ANDROID_CLIENT_VERSION,
              androidSdkVersion: 31,
              hl: "ko",
              gl: "KR",
            },
          },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      },
      dependencies.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS,
    );
  } catch {
    return jsonResponse(502, "UPSTREAM_UNAVAILABLE", "YouTube 영상 정보를 확인하지 못했어요.", origin);
  }
  if (!playerResponse.ok) {
    return jsonResponse(502, "UPSTREAM_REJECTED", "YouTube 영상 정보를 확인하지 못했어요.", origin, {
      "X-Upstream-Status": String(playerResponse.status),
    });
  }
  let track;
  try {
    const bytes = await readBodyWithLimit(playerResponse.body, MAX_YOUTUBE_WATCH_PAGE_BYTES);
    const payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
    bytes.fill(0);
    track = extractKoreanYouTubeCaptionTrackFromPlayerResponse(payload, videoId);
  } catch {
    track = null;
  }
  if (track === null) {
    return jsonResponse(404, "CAPTIONS_NOT_FOUND", "이 영상에서 한국어 자막을 찾지 못했어요.", origin);
  }

  let captionResponse: Response;
  try {
    captionResponse = await fetchWithTimeout(
      fetchImplementation,
      track.baseUrl,
      {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
          "Accept": "application/json,text/plain,*/*",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
        },
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      },
      dependencies.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS,
    );
  } catch {
    return jsonResponse(502, "UPSTREAM_UNAVAILABLE", "YouTube 자막을 불러오지 못했어요.", origin);
  }
  if (!captionResponse.ok) {
    return jsonResponse(502, "UPSTREAM_REJECTED", "YouTube 자막을 불러오지 못했어요.", origin, {
      "X-Upstream-Status": String(captionResponse.status),
    });
  }
  let result;
  try {
    const bytes = await readBodyWithLimit(captionResponse.body, MAX_YOUTUBE_CAPTION_BYTES);
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    bytes.fill(0);
    result = parseYouTubeCaptionJson3(payload, track);
  } catch {
    result = null;
  }
  if (result === null) {
    return jsonResponse(502, "UPSTREAM_INVALID_RESPONSE", "YouTube 자막 형식을 확인하지 못했어요.", origin);
  }
  return successResponse(result, origin);
}

type BroadcastContextProviderFailureKind = CandidateProviderFailureKind;

type BroadcastContextProviderAttempt =
  | {
      readonly ok: true;
      readonly result: unknown;
      readonly modelId: string;
      readonly modelRevision: string;
      readonly usage: ProviderTokenUsage | null;
    }
  | {
      readonly ok: false;
      readonly kind: BroadcastContextProviderFailureKind;
      readonly diagnosticHeaders?: Readonly<Record<string, string>>;
    };

/**
 * The alternate context model is one bounded paid attempt. Only failures that
 * can plausibly differ by model or recover after a transient outage may use it.
 * Shared input mistakes, policy rejections, and a broken Qwen credential stop
 * immediately instead of paying for the same deterministic failure twice.
 */
function shouldAttemptBroadcastContextModelFallback(
  kind: BroadcastContextProviderFailureKind,
): boolean {
  return (
    kind === "timeout" ||
    kind === "unavailable" ||
    kind === "rate-limited" ||
    kind === "model-unavailable" ||
    kind === "response-format" ||
    kind === "invalid-response"
  );
}

async function attemptBroadcastContextProvider(
  connection: Exclude<BroadcastContextConnection, { readonly provider: "disabled" }>,
  broadcastContextRequest: BroadcastContextRequest,
  contextMode:
    | "overview"
    | "discovery"
    | "refinement"
    | "refinement-fast"
    | "selection",
  qwenModelId: string,
  qwenModelRevision: string,
  fetchImplementation: FetchImplementation,
  timeoutMs: number,
  retryDelaysMs: readonly number[],
): Promise<BroadcastContextProviderAttempt> {
  let upstreamRequestBody: string;
  try {
    upstreamRequestBody = JSON.stringify(
      connection.provider === "qwen"
        ? buildBroadcastContextQwenRequestBody(
            broadcastContextRequest,
            qwenModelId,
            contextMode,
          )
        : buildBroadcastContextDeepseekRequestBody(
            broadcastContextRequest,
            connection.descriptor.modelId,
          ),
    );
  } catch {
    return { ok: false, kind: "invalid-argument" };
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetchWithTransientRetries(
      fetchImplementation,
      connection.endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${connection.apiKey}`,
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
    return {
      ok: false,
      kind: error instanceof UpstreamTimeoutError ? "timeout" : "unavailable",
    };
  }
  if (!upstreamResponse.ok) {
    const upstreamStatus = upstreamResponse.status;
    if (upstreamStatus === 429) {
      await upstreamResponse.body?.cancel().catch(() => undefined);
      return { ok: false, kind: "rate-limited" };
    }
    if (upstreamStatus === 401 || upstreamStatus === 403) {
      await upstreamResponse.body?.cancel().catch(() => undefined);
      return { ok: false, kind: "auth" };
    }
    if (upstreamStatus === 404) {
      await upstreamResponse.body?.cancel().catch(() => undefined);
      return { ok: false, kind: "model-unavailable" };
    }
    if (upstreamStatus >= 500 && upstreamStatus <= 599) {
      await upstreamResponse.body?.cancel().catch(() => undefined);
      return { ok: false, kind: "unavailable" };
    }
    if (upstreamStatus === 400) {
      const rejection = await classifyUpstreamRejection(upstreamResponse);
      if (rejection === "api-key") return { ok: false, kind: "auth" };
      if (rejection === "response-format") {
        return { ok: false, kind: "response-format" };
      }
      if (rejection === "invalid-argument") {
        return { ok: false, kind: "invalid-argument" };
      }
      return { ok: false, kind: "rejected" };
    }
    await upstreamResponse.body?.cancel().catch(() => undefined);
    return {
      ok: false,
      kind: "rejected",
      diagnosticHeaders: { "X-Upstream-Status": String(upstreamStatus) },
    };
  }

  let upstreamPayload: unknown;
  try {
    const upstreamBytes = await readBodyWithLimit(
      upstreamResponse.body,
      MAX_BROADCAST_CONTEXT_DEEPSEEK_RESPONSE_BYTES,
    );
    const text = new TextDecoder("utf-8", { fatal: true }).decode(upstreamBytes);
    upstreamBytes.fill(0);
    upstreamPayload = JSON.parse(text);
  } catch {
    return { ok: false, kind: "invalid-response" };
  }

  const parsed =
    connection.provider === "qwen" && contextMode === "discovery"
      ? extractBroadcastContextQwenDiscoveryResponse(
          upstreamPayload,
          broadcastContextRequest,
        )
      : connection.provider === "qwen" &&
          (contextMode === "refinement" || contextMode === "refinement-fast")
      ? extractBroadcastContextQwenRefinementResponse(
          upstreamPayload,
          broadcastContextRequest,
        )
      : connection.provider === "qwen" && contextMode === "selection"
        ? extractBroadcastContextQwenSelectionResponse(
            upstreamPayload,
            broadcastContextRequest,
          )
        : connection.provider === "qwen"
          ? extractBroadcastContextQwenOverviewResponse(
              upstreamPayload,
              broadcastContextRequest,
            )
          : extractBroadcastContextDeepseekResponse(
              upstreamPayload,
              broadcastContextRequest,
              { recoverMalformedItems: true },
            );
  if (!parsed.ok) {
    const choices: readonly unknown[] =
      isRecord(upstreamPayload) && Array.isArray(upstreamPayload.choices)
        ? upstreamPayload.choices
        : [];
    const choice: unknown = choices[0] ?? null;
    const message = isRecord(choice) && isRecord(choice.message)
      ? choice.message
      : null;
    const content = message !== null && typeof message.content === "string"
      ? message.content
      : null;
    let generatedKeys: readonly string[] = [];
    let generatedJson = false;
    if (content !== null) {
      try {
        const generated = JSON.parse(content) as unknown;
        if (isRecord(generated)) {
          generatedJson = true;
          generatedKeys = Object.keys(generated).sort();
        }
      } catch {
        // Only shape metadata is logged; source captions and model text are not.
      }
    }
    console.warn("broadcast-context-invalid-response", {
      finishReason:
        isRecord(choice) && typeof choice.finish_reason === "string"
          ? choice.finish_reason
          : null,
      contentLength: content?.length ?? null,
      generatedJson,
      generatedKeys,
    });
    return {
      ok: false,
      kind: "invalid-response",
      diagnosticHeaders: {
        "X-Upstream-Finish":
          isRecord(choice) && typeof choice.finish_reason === "string"
            ? choice.finish_reason.slice(0, 40)
            : "unknown",
        "X-Upstream-Content-Length": String(content?.length ?? -1),
        "X-Upstream-Json": generatedJson ? "record" : "invalid",
        "X-Upstream-Keys": generatedKeys.join(",").slice(0, 160),
      },
    };
  }
  return {
    ok: true,
    result: parsed.result,
    modelId:
      connection.provider === "qwen"
        ? qwenModelId
        : connection.descriptor.modelId,
    modelRevision:
      connection.provider === "qwen"
        ? qwenModelRevision
        : connection.descriptor.modelRevision,
    usage: readProviderTokenUsage(upstreamPayload),
  };
}

/** Resolves only a public CHZZK replay number to its source channel ID. */
export async function handleChzzkVideoChannelRequest(
  request: Request,
  environment: AiProxyEnvironment,
  dependencies: AiProxyDependencies = {},
): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (!isAllowedOrigin(origin)) {
    return jsonResponse(
      403,
      "ORIGIN_NOT_ALLOWED",
      "이 페이지에서는 CHZZK 영상 채널을 확인할 수 없어요.",
      origin,
    );
  }
  if (request.method === "OPTIONS") {
    return preflightResponse(origin, "GET, OPTIONS");
  }
  if (request.method !== "GET") {
    return jsonResponse(
      405,
      "METHOD_NOT_ALLOWED",
      "지원하지 않는 요청 방식이에요.",
      origin,
      { Allow: "GET, OPTIONS" },
    );
  }
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => key !== "v")) {
    return jsonResponse(400, "INVALID_REQUEST", "CHZZK 영상 번호를 확인해 주세요.", origin);
  }
  const videoNo = url.searchParams.get("v") ?? "";
  if (!CHZZK_VIDEO_NO_PATTERN.test(videoNo)) {
    return jsonResponse(400, "INVALID_REQUEST", "CHZZK 영상 번호를 확인해 주세요.", origin);
  }
  if (environment.RATE_LIMITER === undefined || environment.IP_RATE_LIMITER === undefined) {
    return jsonResponse(
      503,
      "PROXY_NOT_CONFIGURED",
      "CHZZK 채널 확인 연결을 준비하지 못했어요.",
      origin,
    );
  }
  try {
    const clientLimit = await environment.IP_RATE_LIMITER.limit({
      key: scopedClientRateLimitKey(request, CHZZK_VIDEO_CHANNEL_RATE_LIMIT_KEY),
    });
    const globalLimit = await environment.RATE_LIMITER.limit({
      key: CHZZK_VIDEO_CHANNEL_RATE_LIMIT_KEY,
    });
    if (!clientLimit.success || !globalLimit.success) {
      return jsonResponse(
        429,
        "RATE_LIMITED",
        "잠시 요청이 많아요. 1분 뒤 다시 시도해 주세요.",
        origin,
        { "Retry-After": "60" },
      );
    }
  } catch {
    return jsonResponse(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "요청 보호 장치를 확인하지 못했어요.",
      origin,
    );
  }

  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  let upstream: Response;
  try {
    upstream = await fetchWithTimeout(
      fetchImplementation,
      `https://api.chzzk.naver.com/service/v2/videos/${videoNo}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Language": "ko-KR,ko;q=0.9",
          "User-Agent": "Mozilla/5.0 (compatible; ExClipper/0.3)",
        },
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      },
      Math.min(dependencies.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS, 15_000),
    );
  } catch {
    return jsonResponse(
      502,
      "UPSTREAM_UNAVAILABLE",
      "CHZZK 영상 정보를 확인하지 못했어요.",
      origin,
    );
  }
  if (!upstream.ok) {
    return jsonResponse(
      upstream.status === 404 ? 404 : 502,
      upstream.status === 404 ? "VIDEO_NOT_FOUND" : "UPSTREAM_REJECTED",
      "CHZZK 영상 정보를 확인하지 못했어요.",
      origin,
    );
  }

  let payload: unknown;
  try {
    const bytes = await readBodyWithLimit(
      upstream.body,
      MAX_CHZZK_VIDEO_METADATA_BYTES,
    );
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return jsonResponse(
      502,
      "UPSTREAM_INVALID_RESPONSE",
      "CHZZK 영상 정보를 확인하지 못했어요.",
      origin,
    );
  }
  const content = isRecord(payload) && isRecord(payload.content)
    ? payload.content
    : null;
  const channel = content !== null && isRecord(content.channel)
    ? content.channel
    : null;
  const channelId = channel?.channelId;
  if (typeof channelId !== "string" || !CHZZK_CHANNEL_ID_PATTERN.test(channelId)) {
    return jsonResponse(
      502,
      "UPSTREAM_INVALID_RESPONSE",
      "CHZZK 영상 채널을 확인하지 못했어요.",
      origin,
    );
  }
  const headers = corsHeaders(origin);
  headers.set("Content-Type", JSON_CONTENT_TYPE);
  headers.set("Cache-Control", "public, max-age=3600");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify({ videoNo, channelId }), {
    status: 200,
    headers,
  });
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
  if (
    providerResolution.connection.provider !== "deepseek" &&
    providerResolution.connection.provider !== "qwen"
  ) {
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

  const contextMode = isRecord(inputValue) && inputValue.analysisMode === "refinement-fast"
    ? "refinement-fast" as const
    : isRecord(inputValue) && inputValue.analysisMode === "refinement"
    ? "refinement" as const
    : isRecord(inputValue) && inputValue.analysisMode === "discovery"
      ? "discovery" as const
    : isRecord(inputValue) && inputValue.analysisMode === "selection"
      ? "selection" as const
      : "overview" as const;
  let broadcastContextRequest;
  try {
    broadcastContextRequest = createBroadcastContextRequest(inputValue as BroadcastContextRequestInput);
  } catch (error) {
    return jsonResponse(400, "INVALID_REQUEST", error instanceof BroadcastContextInputError ? error.message : "요청 형식을 확인해 주세요.", origin);
  }

  const clientRateLimit = await environment.IP_RATE_LIMITER.limit({
    key: scopedClientRateLimitKey(request, BROADCAST_CONTEXT_RATE_LIMIT_KEY),
  });
  if (!clientRateLimit.success) {
    return jsonResponse(429, "RATE_LIMITED", "잠시 요청이 많아요. 1분 뒤 다시 시도해 주세요.", origin, { "Retry-After": "60" });
  }

  const globalRateLimit = await environment.RATE_LIMITER.limit({
    key: BROADCAST_CONTEXT_RATE_LIMIT_KEY,
  });
  if (!globalRateLimit.success) {
    return jsonResponse(429, "RATE_LIMITED", "잠시 요청이 많아요. 1분 뒤 다시 시도해 주세요.", origin, { "Retry-After": "60" });
  }

  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  const timeoutMs = dependencies.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const retryDelaysMs = dependencies.upstreamRetryDelaysMs ?? DEFAULT_UPSTREAM_RETRY_DELAYS_MS;
  const usesFastQwenContextModel =
    providerConnection.provider === "qwen" &&
    (contextMode === "discovery" || contextMode === "refinement-fast");
  const primaryModelId =
    usesFastQwenContextModel
      ? contextMode === "refinement-fast"
        ? QWEN_CONTEXT_REFINEMENT_MODEL_ID
        : QWEN_CONTEXT_DISCOVERY_MODEL_ID
      : providerConnection.provider === "qwen"
        ? contextMode === "refinement"
          ? QWEN_CONTEXT_QUALITY_REFINEMENT_MODEL_ID
          : QWEN_CONTEXT_MODEL_ID
        : providerConnection.descriptor.modelId;
  const primaryModelRevision =
    usesFastQwenContextModel
      ? contextMode === "refinement-fast"
        ? QWEN_CONTEXT_REFINEMENT_MODEL_REVISION
        : QWEN_CONTEXT_DISCOVERY_MODEL_REVISION
      : providerConnection.provider === "qwen"
        ? contextMode === "refinement"
          ? QWEN_CONTEXT_QUALITY_REFINEMENT_MODEL_REVISION
          : QWEN_CONTEXT_MODEL_REVISION
        : providerConnection.descriptor.modelRevision;
  const primaryAttempt = await attemptBroadcastContextProvider(
    providerConnection,
    broadcastContextRequest,
    contextMode,
    primaryModelId,
    primaryModelRevision,
    fetchImplementation,
    timeoutMs,
    retryDelaysMs,
  );
  let finalAttempt = primaryAttempt;
  let fallbackUsed = false;
  let primaryFailureKind: BroadcastContextProviderFailureKind | null = null;
  if (
    !primaryAttempt.ok &&
    providerConnection.provider === "qwen" &&
    isBoundedAiProviderFallbackEnabled(environment) &&
    shouldAttemptBroadcastContextModelFallback(primaryAttempt.kind)
  ) {
    fallbackUsed = true;
    primaryFailureKind = primaryAttempt.kind;
    const fallbackModelId =
      usesFastQwenContextModel
        ? QWEN_CONTEXT_MODEL_ID
        : QWEN_CONTEXT_DISCOVERY_MODEL_ID;
    const fallbackModelRevision =
      usesFastQwenContextModel
        ? contextMode === "refinement-fast"
          ? QWEN_CONTEXT_QUALITY_REFINEMENT_MODEL_REVISION
          : QWEN_CONTEXT_MODEL_REVISION
        : contextMode === "refinement"
          ? QWEN_CONTEXT_REFINEMENT_MODEL_REVISION
          : QWEN_CONTEXT_DISCOVERY_MODEL_REVISION;
    finalAttempt = await attemptBroadcastContextProvider(
      providerConnection,
      broadcastContextRequest,
      contextMode,
      fallbackModelId,
      fallbackModelRevision,
      fetchImplementation,
      timeoutMs,
      retryDelaysMs,
    );
  }
  if (!finalAttempt.ok) {
    const deterministicRejection =
      finalAttempt.kind === "rejected" ||
      finalAttempt.kind === "invalid-argument" ||
      finalAttempt.kind === "auth";
    const invalidResponse =
      finalAttempt.kind === "invalid-response" ||
      finalAttempt.kind === "response-format";
    return jsonResponse(
      502,
      invalidResponse
        ? "UPSTREAM_INVALID_RESPONSE"
        : deterministicRejection
          ? "UPSTREAM_REJECTED"
          : "UPSTREAM_UNAVAILABLE",
      invalidResponse
        ? "답변 형식을 확인할 수 없어요."
        : deterministicRejection
          ? "AI가 요청을 처리하지 못했어요."
          : "AI에 연결하지 못했어요.",
      origin,
      {
        ...finalAttempt.diagnosticHeaders,
        ...(primaryFailureKind === null || !fallbackUsed
          ? {}
          : {
              [EXCLIPPER_PRIMARY_FAILURE_HEADER]: primaryFailureKind,
              [EXCLIPPER_FALLBACK_FAILURE_HEADER]: finalAttempt.kind,
            }),
      },
    );
  }

  return successResponse(finalAttempt.result, origin, {
    [CANDIDATE_PASS_B_RESPONSE_MODEL_ID_HEADER]: finalAttempt.modelId,
    [CANDIDATE_PASS_B_RESPONSE_MODEL_REVISION_HEADER]:
      finalAttempt.modelRevision,
    [CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER]: fallbackUsed ? "true" : "false",
    ...(primaryFailureKind === null || !fallbackUsed
      ? {}
      : { [EXCLIPPER_FALLBACK_REASON_HEADER]: primaryFailureKind }),
    ...(finalAttempt.usage === null
      ? {}
      : {
          [EXCLIPPER_USAGE_PROMPT_TOKENS_HEADER]: String(
            finalAttempt.usage.promptTokens,
          ),
          [EXCLIPPER_USAGE_COMPLETION_TOKENS_HEADER]: String(
            finalAttempt.usage.completionTokens,
          ),
          [EXCLIPPER_USAGE_TOTAL_TOKENS_HEADER]: String(
            finalAttempt.usage.totalTokens,
          ),
        }),
  });
}

function routeRequest(
  request: Request,
  environment: AiProxyEnvironment,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === BROADCAST_TRANSCRIPT_ENDPOINT_PATH) {
    return handleBroadcastTranscriptRequest(request, environment);
  }
  if (url.pathname === BROADCAST_CONTEXT_ENDPOINT_PATH) {
    return handleBroadcastContextRequest(request, environment);
  }
  if (url.pathname === YOUTUBE_CAPTIONS_ENDPOINT_PATH) {
    return handleYouTubeCaptionsRequest(request, environment);
  }
  if (url.pathname === CHZZK_VIDEO_CHANNEL_ENDPOINT_PATH) {
    return handleChzzkVideoChannelRequest(request, environment);
  }
  return handleCandidateInsightRequest(request, environment);
}

export default {
  /**
   * Every response leaves through here so an unexpected failure still carries
   * CORS headers. Without this, a thrown handler produced a Cloudflare error
   * page with no `Access-Control-Allow-Origin`, and the browser reported a
   * misleading CORS violation instead of the real fault.
   *
   * A runtime that is killed for exceeding CPU or memory limits never reaches
   * this catch, so keeping request work small remains the actual defence.
   */
  async fetch(
    request: Request,
    environment: AiProxyEnvironment,
  ): Promise<Response> {
    const origin = request.headers.get("Origin");
    try {
      return await routeRequest(request, environment);
    } catch {
      return jsonResponse(
        500,
        "PROXY_UNAVAILABLE",
        "AI 중계에서 예상하지 못한 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.",
        origin,
      );
    }
  },
};

