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
import {
  MAX_CANDIDATE_PASS_B_RESPONSE_BYTES,
  buildCandidatePassBGeminiRequestBody,
  buildCandidatePassBProxyRequestBody,
  extractCandidatePassBGeminiResponse,
  type CandidatePassBProxyRequestBody,
} from "../analysis/candidatePassBGemini";
import {
  buildCandidatePassBQwenOmniUrlRequestBody,
  buildCandidatePassBQwenOmniRequestBody,
  extractCandidatePassBQwenOmniSseResponse,
  type CandidatePassBQwenOmniUrlFrame,
} from "../analysis/candidatePassBQwenOmni";
import {
  CANDIDATE_PASS_B_GEMINI_MODEL_ID,
  CANDIDATE_PASS_B_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAMES,
  CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER,
  CANDIDATE_PASS_B_ROUTING_MODEL_ID,
  CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
} from "../analysis/candidatePassBWorkerProtocol";
import {
  BROADCAST_TRANSCRIPT_GROQ_MODEL_ID,
  BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION,
  MAX_BROADCAST_TRANSCRIPT_GROQ_WAV_BYTES,
  MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS,
  MAX_BROADCAST_TRANSCRIPT_QWEN_RESPONSE_BYTES,
  buildBroadcastTranscriptGroqRequestBody,
  extractBroadcastTranscriptGroqResponse,
  type BroadcastTranscriptGroqAudioSource,
  type BroadcastTranscriptQwenResult,
} from "../analysis/broadcastTranscriptQwen";
import {
  BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE,
  BROADCAST_TRANSCRIPT_MEDIA_SCHEMA_VERSION,
  parseBroadcastTranscriptMediaResolveRequest,
  type BroadcastTranscriptMediaResolveRequest,
} from "../analysis/broadcastTranscriptMediaProtocol";
import { isCandidatePassBContextPacket } from "../analysis/candidateFinalVerification";
import { canonicalizeCandidatePassBContextPacket } from "../analysis/candidatePassBContextBudget";
import {
  CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
  CANDIDATE_INSIGHT_MEDIA_ENDPOINT_PATH,
  CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
  CANDIDATE_INSIGHT_MEDIA_SCHEMA_VERSION,
  createCandidateInsightMediaSemanticPayloadDigest,
  isCandidateInsightMediaTicket,
  type CandidateInsightMediaResolveRequest,
} from "../analysis/candidateInsightMediaProtocol";
import {
  CHANNEL_PREANALYSIS_SOURCE_IDS,
  channelPreanalysisSourceById,
  type ChannelPreanalysisSourceId,
  type ConfiguredChannelPreanalysisSource,
} from "../analysis/channelPreanalysisSources";
import {
  candidatePassBCastRosterIdForYouTubeChannelId,
  isCandidatePassBCastRosterId,
} from "../analysis/participantRoster";
import {
  QWEN_CONTEXT_MODEL_ID,
  QWEN_CONTEXT_MODEL_REVISION,
  QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_ID,
  QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_REVISION,
  resolveCandidateInsightConnection,
  resolveBroadcastContextConnection,
  resolveBroadcastTranscriptConnection,
  type CandidateInsightConnection,
  type BroadcastContextConnection,
  type BroadcastTranscriptConnection,
} from "./aiProviderConfiguration";
import {
  CANDIDATE_INSIGHT_MEDIA_AUDIO_HEADER_BYTES,
  CANDIDATE_INSIGHT_MEDIA_MAX_AUDIO_BYTES,
  CANDIDATE_INSIGHT_MEDIA_MAX_BUNDLE_BYTES,
  CANDIDATE_INSIGHT_MEDIA_MAX_FRAME_BYTES,
  CANDIDATE_INSIGHT_MEDIA_TICKET_MAX_TTL_MS,
  CandidateInsightMediaError,
  createCandidateInsightMediaCapabilityUrl,
  deleteCandidateInsightMediaBestEffort,
  resolveCandidateInsightMedia,
  serveCandidateInsightMediaRequest,
  stageCandidateInsightMedia,
  type CandidateInsightMediaBinding,
  type CandidateInsightMediaFrameBinding,
} from "./candidateInsightMedia";
import {
  BROADCAST_TRANSCRIPT_MEDIA_ENDPOINT_PATH,
  BROADCAST_TRANSCRIPT_MEDIA_HEADER_BYTES,
  BROADCAST_TRANSCRIPT_MEDIA_MAX_BYTES,
  BroadcastTranscriptMediaError,
  createBroadcastTranscriptMediaCapabilityUrl,
  deleteBroadcastTranscriptMediaBestEffort,
  resolveBroadcastTranscriptMedia,
  serveBroadcastTranscriptMediaRequest,
  stageBroadcastTranscriptMedia,
  type BroadcastTranscriptMediaBinding,
  type BroadcastTranscriptMediaBucket,
} from "./broadcastTranscriptMedia";

export const PREANALYSIS_CONTEXT_ENDPOINT_PATH =
  "/v1/broadcast-context" as const;
export const PREANALYSIS_CANDIDATE_ENDPOINT_PATH =
  "/v1/candidate-insights" as const;
export const PREANALYSIS_TRANSCRIPT_ENDPOINT_PATH =
  "/v1/broadcast-transcript" as const;
export const PREANALYSIS_TRANSCRIPT_MEDIA_ENDPOINT_PATH =
  BROADCAST_TRANSCRIPT_MEDIA_ENDPOINT_PATH;
export const PREANALYSIS_CANDIDATE_MEDIA_ENDPOINT_PATH =
  CANDIDATE_INSIGHT_MEDIA_ENDPOINT_PATH;
export const PREANALYSIS_CONTEXT_ORIGIN = "https://11qaws.github.io" as const;
export const PREANALYSIS_CONTEXT_OPERATION_HEADER =
  "X-ExClipper-Preanalysis-Operation" as const;
export const PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER =
  "X-ExClipper-Preanalysis-Payload-Digest" as const;
export const PREANALYSIS_CONTEXT_TRANSPORT_DIGEST_HEADER =
  "X-ExClipper-Preanalysis-Transport-Digest" as const;
export const PREANALYSIS_CANDIDATE_MEDIA_DIGEST_HEADER =
  "X-ExClipper-Preanalysis-Candidate-Media-Digest" as const;
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
export const PREANALYSIS_CONTEXT_PROXY_VERSION = "3.2.0" as const;
export const PREANALYSIS_CONTEXT_OPERATION_GENERATION = 5 as const;
export const PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID = QWEN_CONTEXT_MODEL_ID;
export const PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION =
  QWEN_CONTEXT_MODEL_REVISION;
export const PREANALYSIS_CANDIDATE_EXPECTED_MODEL_ID =
  CANDIDATE_PASS_B_ROUTING_MODEL_ID;
export const PREANALYSIS_CANDIDATE_EXPECTED_MODEL_REVISION =
  CANDIDATE_PASS_B_ROUTING_MODEL_REVISION;
export const PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_ID =
  BROADCAST_TRANSCRIPT_GROQ_MODEL_ID;
export const PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION =
  BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION;
export const PREANALYSIS_TRANSCRIPT_SOURCE_ID_HEADER =
  "X-ExClipper-Preanalysis-Source-Id" as const;
export const PREANALYSIS_TRANSCRIPT_VIDEO_ID_HEADER =
  "X-ExClipper-Preanalysis-Video-Id" as const;
export const PREANALYSIS_TRANSCRIPT_SOURCE_START_HEADER =
  "X-ExClipper-Preanalysis-Source-Start-Ms" as const;
export const PREANALYSIS_TRANSCRIPT_DURATION_HEADER =
  "X-ExClipper-Preanalysis-Duration-Ms" as const;

const OPERATION_STORAGE_KEY = "operation-state";
const OPERATION_QUARANTINE_STORAGE_KEY = `operation-state-quarantine-v${PREANALYSIS_CONTEXT_OPERATION_GENERATION}`;
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;
const MAX_TERMINAL_BODY_BYTES = Math.max(
  MAX_BROADCAST_CONTEXT_DEEPSEEK_RESPONSE_BYTES,
  MAX_CANDIDATE_PASS_B_RESPONSE_BYTES,
);
const REQUEST_BODY_TIMEOUT_MS = 30_000;
const UPSTREAM_TIMEOUT_MS = 90_000;
const CONTEXT_UPSTREAM_TIMEOUT_MS = 135_000;
const CONTEXT_FALLBACK_TIMEOUT_MS = 30_000;
const RUNNING_STALE_AFTER_MS = 4 * 60_000;
const RETRY_BACKOFF_BASE_MS = 30_000;
const RETRY_BACKOFF_MAX_MS = 3 * 60 * 60_000;
const CONTEXT_OPERATION_ID_PATTERN = new RegExp(
  `^channel-context-(?:${CHANNEL_PREANALYSIS_SOURCE_IDS.join("|")})-[0-9a-f]{64}$`,
  "u",
);
const CANDIDATE_OPERATION_ID_PATTERN = /^channel-candidate-[0-9a-f]{64}$/u;
const TRANSCRIPT_OPERATION_ID_PATTERN = /^channel-transcript-[0-9a-f]{64}$/u;
const OPERATION_ID_PATTERN = new RegExp(
  `(?:${CONTEXT_OPERATION_ID_PATTERN.source})|(?:${CANDIDATE_OPERATION_ID_PATTERN.source})|(?:${TRANSCRIPT_OPERATION_ID_PATTERN.source})`,
  "u",
);
const PAYLOAD_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const AUTHORIZATION_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{24,512}$/u;
const MIN_SCHEDULED_CANDIDATE_DURATION_MS = 30_000;
const WAV_HEADER_BYTES = 44;
const PCM_BYTES_PER_SAMPLE = 2;
const SCHEDULED_MEDIA_PARTICIPANT_ID = "scheduled_review_runner";
const SCHEDULED_TRANSCRIPT_PARTICIPANT_ID =
  "scheduled_transcript_runner";
const MAX_CANDIDATE_RESOLVE_BODY_BYTES = 128 * 1024;
const MAX_TRANSCRIPT_RESOLVE_BODY_BYTES = 2 * 1024;
const ALLOWED_REQUEST_KEYS = new Set([
  "sourceId",
  "sourceChannelId",
  "sourceDurationMs",
  "chapters",
  "candidates",
  "castRosterId",
  "participantGrounding",
  "outputLanguage",
]);

interface ScheduledContextRequest {
  readonly kind: "context";
  readonly source: ConfiguredChannelPreanalysisSource;
  readonly request: BroadcastContextRequest;
}

interface ScheduledCandidateRequest {
  readonly kind: "candidate";
  readonly transport: "paid-direct" | "free-r2";
  readonly request:
    | CandidatePassBProxyRequestBody
    | CandidateInsightMediaResolveRequest;
}

interface ScheduledCandidateUrlRequest {
  readonly audioUrl: string;
  readonly candidateDurationMs: number;
  readonly videoFrames: readonly CandidatePassBQwenOmniUrlFrame[];
  readonly castRosterId: CandidateInsightMediaResolveRequest["castRosterId"];
  readonly outputLanguage: CandidateInsightMediaResolveRequest["outputLanguage"];
  readonly context: CandidateInsightMediaResolveRequest["context"];
}

interface ScheduledTranscriptRequestBase {
  readonly kind: "transcript";
  readonly source: ConfiguredChannelPreanalysisSource;
  readonly videoId: string;
  readonly sourceStartMs: number;
  readonly durationMs: number;
}

type ScheduledTranscriptRequest =
  | (ScheduledTranscriptRequestBase & {
      readonly transport: "paid-direct";
      readonly wavBytes: Uint8Array;
    })
  | (ScheduledTranscriptRequestBase & {
      readonly transport: "free-r2";
      readonly request: BroadcastTranscriptMediaResolveRequest;
    });

type ScheduledOperationRequest =
  ScheduledContextRequest | ScheduledCandidateRequest | ScheduledTranscriptRequest;

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
  readonly PREANALYSIS_CANDIDATE_PROVIDER?: string;
  readonly GEMINI_API_KEY?: string;
  readonly PREANALYSIS_QWEN_API_KEY?: string;
  readonly PREANALYSIS_QWEN_WORKSPACE_ID?: string;
  readonly PREANALYSIS_QWEN_REGION?: string;
  readonly PREANALYSIS_DEEPSEEK_API_KEY?: string;
  readonly PREANALYSIS_GROQ_API_KEY?: string;
  readonly PREANALYSIS_CANDIDATE_TRANSPORT_MODE?: string;
  readonly PREANALYSIS_TRANSCRIPT_TRANSPORT_MODE?: string;
  readonly PREANALYSIS_MEDIA_PUBLIC_BASE_URL?: string;
  readonly PREANALYSIS_MEDIA_SIGNING_KEY?: string;
  readonly PREANALYSIS_MEDIA?: BroadcastTranscriptMediaBucket;
  readonly PREANALYSIS_CONTEXT_OPERATIONS: DurableObjectNamespaceLike;
  readonly PREANALYSIS_CONTEXT_RATE_LIMITER?: PreanalysisRateLimitBinding;
  readonly PREANALYSIS_TRANSCRIPT_RATE_LIMITER?: PreanalysisRateLimitBinding;
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

type StoredOperationPhase = "running" | "retryable" | "succeeded";

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

type CandidateProviderAttempt =
  | {
      readonly kind: "success";
      readonly payload: unknown;
      readonly modelId: string;
      readonly modelRevision: string;
    }
  | {
      readonly kind: "failure";
      readonly response: Response;
      readonly code: string;
      readonly possibleDuplicateProviderCharge: boolean;
    };

type TranscriptProviderAttempt =
  | {
      readonly kind: "success";
      readonly payload: BroadcastTranscriptQwenResult;
      readonly modelId: typeof BROADCAST_TRANSCRIPT_GROQ_MODEL_ID;
      readonly modelRevision: typeof BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION;
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
  return (
    (request.headers.get("Content-Type") ?? "")
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase() ?? ""
  );
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
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createPreanalysisContextOperationId(
  payloadDigest: string,
  sourceId: ChannelPreanalysisSourceId,
): Promise<string> {
  if (!PAYLOAD_DIGEST_PATTERN.test(payloadDigest)) {
    throw new TypeError("The preanalysis payload digest is invalid.");
  }
  const source = channelPreanalysisSourceById(sourceId);
  if (source === null) {
    throw new TypeError("The preanalysis source is not configured.");
  }
  const namespace = JSON.stringify([
    "exclipper-channel-preanalysis-context",
    PREANALYSIS_CONTEXT_PROXY_VERSION,
    PREANALYSIS_CONTEXT_OPERATION_GENERATION,
    source.sourceId,
    source.channelId,
    AI_BROADCAST_CONTEXT_ROUTING_REVISION,
    PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID,
    PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION,
    payloadDigest,
  ]);
  const digest = await sha256Hex(new TextEncoder().encode(namespace));
  return `channel-context-${source.sourceId}-${digest}`;
}

export async function createPreanalysisCandidateOperationId(
  payloadDigest: string,
): Promise<string> {
  if (!PAYLOAD_DIGEST_PATTERN.test(payloadDigest)) {
    throw new TypeError("The preanalysis payload digest is invalid.");
  }
  const namespace = JSON.stringify([
    "exclipper-channel-preanalysis-candidate",
    PREANALYSIS_CONTEXT_PROXY_VERSION,
    PREANALYSIS_CONTEXT_OPERATION_GENERATION,
    CANDIDATE_PASS_B_ROUTING_MODEL_ID,
    CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
    payloadDigest,
  ]);
  const digest = await sha256Hex(new TextEncoder().encode(namespace));
  return `channel-candidate-${digest}`;
}

export async function createPreanalysisTranscriptOperationId(
  payloadDigest: string,
  sourceId: ChannelPreanalysisSourceId,
  videoId: string,
  sourceStartMs: number,
  durationMs: number,
): Promise<string> {
  const source = channelPreanalysisSourceById(sourceId);
  if (
    !PAYLOAD_DIGEST_PATTERN.test(payloadDigest) ||
    source === null ||
    !/^[A-Za-z0-9_-]{11}$/u.test(videoId) ||
    !Number.isSafeInteger(sourceStartMs) ||
    sourceStartMs < 0 ||
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 ||
    durationMs > MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS ||
    sourceStartMs + durationMs > 12 * 60 * 60_000
  ) {
    throw new TypeError("The preanalysis transcript identity is invalid.");
  }
  const namespace = JSON.stringify([
    "exclipper-channel-preanalysis-transcript",
    PREANALYSIS_CONTEXT_PROXY_VERSION,
    PREANALYSIS_CONTEXT_OPERATION_GENERATION,
    source.sourceId,
    source.channelId,
    videoId,
    sourceStartMs,
    durationMs,
    PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_ID,
    PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION,
    payloadDigest,
  ]);
  const digest = await sha256Hex(new TextEncoder().encode(namespace));
  return `channel-transcript-${digest}`;
}

async function createScheduledTranscriptMediaBinding(
  request: ScheduledTranscriptRequestBase,
  operationId: string,
  payloadDigest: string,
): Promise<BroadcastTranscriptMediaBinding> {
  return {
    participantId: SCHEDULED_TRANSCRIPT_PARTICIPANT_ID,
    runId: request.videoId,
    operationId,
    pool: "transcript",
    payloadDigest,
    routeManifestFingerprint: await scheduledTranscriptRouteFingerprint(),
    sourceStartMs: request.sourceStartMs,
    durationMs: request.durationMs,
    expectedByteLength:
      WAV_HEADER_BYTES +
      Math.round(
        (request.durationMs * CANDIDATE_PASS_B_SAMPLE_RATE_HZ) / 1_000,
      ) *
        PCM_BYTES_PER_SAMPLE,
  };
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
): ScheduledContextRequest | null {
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    return null;
  }
  if (!hasExactScheduledRequestKeys(value)) return null;
  if (!isRecord(value)) return null;
  const source =
    typeof value.sourceId === "string"
      ? channelPreanalysisSourceById(value.sourceId)
      : null;
  if (source === null || value.sourceChannelId !== source.channelId) {
    return null;
  }
  const expectedRosterId = candidatePassBCastRosterIdForYouTubeChannelId(
    source.channelId,
  );
  if (expectedRosterId === null) return null;
  try {
    const request = createBroadcastContextRequest(
      value as unknown as BroadcastContextRequestInput,
    );
    if (
      request.castRosterId !== expectedRosterId ||
      request.outputLanguage !== "ko"
    ) {
      return null;
    }
    return { kind: "context", source, request };
  } catch (error) {
    if (error instanceof BroadcastContextInputError) return null;
    throw error;
  }
}

function isStrictBase64(value: string): boolean {
  return (
    value.length > 0 &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/u.test(value) &&
    !value.slice(0, -2).includes("=")
  );
}

function base64DecodedByteLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function parseScheduledCandidateRequest(
  bytes: Uint8Array,
): ScheduledCandidateRequest | null {
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    return null;
  }
  if (
    isRecord(value) &&
    hasExactKeys(value, [
      "schemaVersion",
      "mediaTicket",
      "candidateDurationMs",
      "castRosterId",
      "outputLanguage",
      "context",
    ]) &&
    value.schemaVersion === CANDIDATE_INSIGHT_MEDIA_SCHEMA_VERSION &&
    isCandidateInsightMediaTicket(value.mediaTicket) &&
    Number.isSafeInteger(value.candidateDurationMs) &&
    (value.candidateDurationMs as number) >=
      MIN_SCHEDULED_CANDIDATE_DURATION_MS &&
    (value.candidateDurationMs as number) <=
      MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS &&
    (value.castRosterId === null ||
      isCandidatePassBCastRosterId(value.castRosterId)) &&
    value.outputLanguage === "ko" &&
    isCandidatePassBContextPacket(value.context)
  ) {
    return {
      kind: "candidate",
      transport: "free-r2",
      request: value as unknown as CandidateInsightMediaResolveRequest,
    };
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "audioBase64",
      "candidateDurationMs",
      "videoFrames",
      "castRosterId",
      "outputLanguage",
      "context",
    ]) ||
    !Number.isSafeInteger(value.candidateDurationMs) ||
    (value.candidateDurationMs as number) <
      MIN_SCHEDULED_CANDIDATE_DURATION_MS ||
    (value.candidateDurationMs as number) >
      MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS ||
    typeof value.audioBase64 !== "string" ||
    !isStrictBase64(value.audioBase64) ||
    base64DecodedByteLength(value.audioBase64) !==
      WAV_HEADER_BYTES +
        Math.round(
          ((value.candidateDurationMs as number) *
            CANDIDATE_PASS_B_SAMPLE_RATE_HZ) /
            1_000,
        ) *
          PCM_BYTES_PER_SAMPLE ||
    !Array.isArray(value.videoFrames) ||
    value.videoFrames.length !== MAX_CANDIDATE_PASS_B_VIDEO_FRAMES ||
    value.videoFrames.some(
      (frame) =>
        !isRecord(frame) ||
        !hasExactKeys(frame, ["timestampMs", "mimeType", "dataBase64"]) ||
        typeof frame.dataBase64 !== "string" ||
        !isStrictBase64(frame.dataBase64) ||
        frame.dataBase64.length >
          MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH,
    )
  ) {
    return null;
  }
  try {
    const request = buildCandidatePassBProxyRequestBody(
      value.audioBase64,
      value.candidateDurationMs as number,
      value.videoFrames,
      value.castRosterId as CandidatePassBProxyRequestBody["castRosterId"],
      value.outputLanguage as CandidatePassBProxyRequestBody["outputLanguage"],
      value.context as CandidatePassBProxyRequestBody["context"],
    );
    return { kind: "candidate", transport: "paid-direct", request };
  } catch {
    return null;
  }
}

function canonicalScheduledTranscriptWavHeader(
  header: Uint8Array,
  totalByteLength: number,
  durationMs: number,
): boolean {
  const expectedDataBytes =
    Math.round((durationMs * CANDIDATE_PASS_B_SAMPLE_RATE_HZ) / 1_000) *
    PCM_BYTES_PER_SAMPLE;
  if (
    header.byteLength !== BROADCAST_TRANSCRIPT_MEDIA_HEADER_BYTES ||
    totalByteLength !== WAV_HEADER_BYTES + expectedDataBytes ||
    totalByteLength > MAX_BROADCAST_TRANSCRIPT_GROQ_WAV_BYTES
  ) {
    return false;
  }
  const ascii = (offset: number, length: number): string =>
    String.fromCharCode(...header.subarray(offset, offset + length));
  const view = new DataView(
    header.buffer,
    header.byteOffset,
    BROADCAST_TRANSCRIPT_MEDIA_HEADER_BYTES,
  );
  return (
    ascii(0, 4) === "RIFF" &&
    ascii(8, 4) === "WAVE" &&
    ascii(12, 4) === "fmt " &&
    ascii(36, 4) === "data" &&
    view.getUint32(4, true) === totalByteLength - 8 &&
    view.getUint32(16, true) === 16 &&
    view.getUint16(20, true) === 1 &&
    view.getUint16(22, true) === 1 &&
    view.getUint32(24, true) === CANDIDATE_PASS_B_SAMPLE_RATE_HZ &&
    view.getUint32(28, true) ===
      CANDIDATE_PASS_B_SAMPLE_RATE_HZ * PCM_BYTES_PER_SAMPLE &&
    view.getUint16(32, true) === PCM_BYTES_PER_SAMPLE &&
    view.getUint16(34, true) === 16 &&
    view.getUint32(40, true) === expectedDataBytes
  );
}

function canonicalScheduledTranscriptWav(
  bytes: Uint8Array,
  durationMs: number,
): boolean {
  return canonicalScheduledTranscriptWavHeader(
    bytes.subarray(0, WAV_HEADER_BYTES),
    bytes.byteLength,
    durationMs,
  );
}

function parseBoundedIntegerHeader(
  request: Request,
  name: string,
  maximum: number,
): number | null {
  const value = request.headers.get(name);
  if (value === null || !/^\d{1,12}$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}

function parseScheduledTranscriptMetadata(
  request: Request,
): ScheduledTranscriptRequestBase | null {
  const sourceId = request.headers.get(PREANALYSIS_TRANSCRIPT_SOURCE_ID_HEADER);
  const source =
    sourceId === null ? null : channelPreanalysisSourceById(sourceId);
  const videoId = request.headers.get(PREANALYSIS_TRANSCRIPT_VIDEO_ID_HEADER);
  const sourceStartMs = parseBoundedIntegerHeader(
    request,
    PREANALYSIS_TRANSCRIPT_SOURCE_START_HEADER,
    12 * 60 * 60_000,
  );
  const durationMs = parseBoundedIntegerHeader(
    request,
    PREANALYSIS_TRANSCRIPT_DURATION_HEADER,
    MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS,
  );
  if (
    source === null ||
    videoId === null ||
    !/^[A-Za-z0-9_-]{11}$/u.test(videoId) ||
    sourceStartMs === null ||
    durationMs === null ||
    durationMs <= 0 ||
    sourceStartMs + durationMs > 12 * 60 * 60_000
  ) {
    return null;
  }
  return {
    kind: "transcript",
    source,
    videoId,
    sourceStartMs,
    durationMs,
  };
}

function parseScheduledTranscriptRequest(
  bytes: Uint8Array,
  request: Request,
): ScheduledTranscriptRequest | null {
  const metadata = parseScheduledTranscriptMetadata(request);
  if (metadata === null) return null;
  const requestMediaType = mediaType(request);
  if (requestMediaType === "audio/wav") {
    return canonicalScheduledTranscriptWav(bytes, metadata.durationMs)
      ? {
          ...metadata,
          transport: "paid-direct",
          wavBytes: bytes,
        }
      : null;
  }
  if (
    requestMediaType !== BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE
  ) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    return null;
  }
  const resolveRequest = parseBroadcastTranscriptMediaResolveRequest(value);
  return resolveRequest === null
    ? null
    : {
        ...metadata,
        transport: "free-r2",
        request: resolveRequest,
      };
}

function resolveDedicatedProvider(
  environment: PreanalysisContextProxyEnvironment,
): Exclude<
  BroadcastContextConnection,
  { readonly provider: "disabled" }
> | null {
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

function resolveDedicatedCandidateProvider(
  environment: PreanalysisContextProxyEnvironment,
): CandidateInsightConnection | null {
  const resolution = resolveCandidateInsightConnection({
    CANDIDATE_INSIGHT_PROVIDER:
      environment.PREANALYSIS_CANDIDATE_PROVIDER ?? "qwen",
    ...(environment.GEMINI_API_KEY === undefined
      ? {}
      : { GEMINI_API_KEY: environment.GEMINI_API_KEY }),
    ...(environment.PREANALYSIS_QWEN_API_KEY === undefined
      ? {}
      : { QWEN_API_KEY: environment.PREANALYSIS_QWEN_API_KEY }),
    ...(environment.PREANALYSIS_QWEN_WORKSPACE_ID === undefined
      ? {}
      : { QWEN_WORKSPACE_ID: environment.PREANALYSIS_QWEN_WORKSPACE_ID }),
    ...(environment.PREANALYSIS_QWEN_REGION === undefined
      ? {}
      : { QWEN_REGION: environment.PREANALYSIS_QWEN_REGION }),
  });
  return resolution.ok ? resolution.connection : null;
}

function resolveDedicatedTranscriptProvider(
  environment: PreanalysisContextProxyEnvironment,
): Extract<BroadcastTranscriptConnection, { readonly provider: "groq" }> | null {
  const resolution = resolveBroadcastTranscriptConnection({
    BROADCAST_TRANSCRIPT_PROVIDER: "groq",
    ...(environment.PREANALYSIS_GROQ_API_KEY === undefined
      ? {}
      : { GROQ_API_KEY: environment.PREANALYSIS_GROQ_API_KEY }),
  });
  return resolution.ok && resolution.connection.provider === "groq"
    ? resolution.connection
    : null;
}

function configuredCandidateTransportMode(
  environment: PreanalysisContextProxyEnvironment,
): "paid-direct" | "free-r2" | null {
  return environment.PREANALYSIS_CANDIDATE_TRANSPORT_MODE === "paid-direct" ||
    environment.PREANALYSIS_CANDIDATE_TRANSPORT_MODE === "free-r2"
    ? environment.PREANALYSIS_CANDIDATE_TRANSPORT_MODE
    : null;
}

function configuredCandidateMediaTransport(
  environment: PreanalysisContextProxyEnvironment,
): {
  readonly bucket: BroadcastTranscriptMediaBucket;
  readonly signingKey: string;
  readonly publicBaseUrl: string;
} | null {
  if (
    configuredCandidateTransportMode(environment) !== "free-r2" ||
    environment.PREANALYSIS_MEDIA === undefined ||
    environment.PREANALYSIS_MEDIA_SIGNING_KEY === undefined ||
    environment.PREANALYSIS_MEDIA_PUBLIC_BASE_URL === undefined
  ) {
    return null;
  }
  try {
    const url = new URL(environment.PREANALYSIS_MEDIA_PUBLIC_BASE_URL);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null;
    }
    return {
      bucket: environment.PREANALYSIS_MEDIA,
      signingKey: environment.PREANALYSIS_MEDIA_SIGNING_KEY,
      publicBaseUrl: url.toString(),
    };
  } catch {
    return null;
  }
}

function configuredTranscriptTransportMode(
  environment: PreanalysisContextProxyEnvironment,
): "paid-direct" | "free-r2" | null {
  return environment.PREANALYSIS_TRANSCRIPT_TRANSPORT_MODE === "paid-direct" ||
    environment.PREANALYSIS_TRANSCRIPT_TRANSPORT_MODE === "free-r2"
    ? environment.PREANALYSIS_TRANSCRIPT_TRANSPORT_MODE
    : null;
}

function configuredTranscriptMediaTransport(
  environment: PreanalysisContextProxyEnvironment,
): {
  readonly bucket: BroadcastTranscriptMediaBucket;
  readonly signingKey: string;
  readonly publicBaseUrl: string;
} | null {
  if (
    configuredTranscriptTransportMode(environment) !== "free-r2" ||
    environment.PREANALYSIS_MEDIA === undefined ||
    environment.PREANALYSIS_MEDIA_SIGNING_KEY === undefined ||
    environment.PREANALYSIS_MEDIA_PUBLIC_BASE_URL === undefined
  ) {
    return null;
  }
  try {
    const url = new URL(environment.PREANALYSIS_MEDIA_PUBLIC_BASE_URL);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null;
    }
    return {
      bucket: environment.PREANALYSIS_MEDIA,
      signingKey: environment.PREANALYSIS_MEDIA_SIGNING_KEY,
      publicBaseUrl: url.toString(),
    };
  } catch {
    return null;
  }
}

async function scheduledTranscriptRouteFingerprint(): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      "exclipper-scheduled-transcript-route",
      PREANALYSIS_CONTEXT_PROXY_VERSION,
      PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_ID,
      PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION,
      "groq-url-or-paid-direct-v1",
    ]),
  );
  try {
    return `sha256:${await sha256Hex(bytes)}`;
  } finally {
    bytes.fill(0);
  }
}

async function fetchWithTimeout<T>(
  fetchImplementation: FetchImplementation,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  consume: (response: Response, remainingMs: () => number) => Promise<T>,
): Promise<T> {
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

async function attemptProviderModel(
  connection: Exclude<
    BroadcastContextConnection,
    { readonly provider: "disabled" }
  >,
  request: BroadcastContextRequest,
  modelId: string,
  modelRevision: string,
  fetchImplementation: FetchImplementation,
  upstreamTimeoutMs: number,
): Promise<ProviderAttempt> {
  let body: string;
  try {
    body = JSON.stringify(
      connection.provider === "qwen"
        ? buildBroadcastContextQwenRequestBody(request, modelId, "overview")
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
              status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_UNAVAILABLE";
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
          const choices: readonly unknown[] =
            isRecord(payload) && Array.isArray(payload.choices)
            ? payload.choices
            : [];
          const choice: unknown = choices[0] ?? null;
          const message = isRecord(choice) && isRecord(choice.message)
            ? choice.message
            : null;
          const content = message !== null && typeof message.content === "string"
            ? message.content
            : null;
          let generatedJson = false;
          let generatedKeys: readonly string[] = [];
          if (content !== null) {
            try {
              const generated = JSON.parse(content) as unknown;
              if (isRecord(generated)) {
                generatedJson = true;
                generatedKeys = Object.keys(generated).sort();
              }
            } catch {
              // Log shape metadata only; captions and generated prose stay private.
            }
          }
          console.warn("scheduled-context-invalid-response", {
            modelId,
            finishReason:
              isRecord(choice) && typeof choice.finish_reason === "string"
                ? choice.finish_reason.slice(0, 40)
                : null,
            contentLength: content?.length ?? null,
            generatedJson,
            generatedKeys,
          });
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

function shouldUseScheduledContextFallback(attempt: ProviderAttempt): boolean {
  return attempt.kind === "failure" && [
    "UPSTREAM_INVALID_RESPONSE",
    "UPSTREAM_MODEL_UNAVAILABLE",
  ].includes(attempt.code);
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
  const primaryModelId = connection.provider === "qwen"
    ? QWEN_CONTEXT_MODEL_ID
    : connection.descriptor.modelId;
  const primaryModelRevision = connection.provider === "qwen"
    ? QWEN_CONTEXT_MODEL_REVISION
    : connection.descriptor.modelRevision;
  const primary = await attemptProviderModel(
    connection,
    request,
    primaryModelId,
    primaryModelRevision,
    fetchImplementation,
    upstreamTimeoutMs,
  );
  if (connection.provider !== "qwen" || !shouldUseScheduledContextFallback(primary)) {
    return primary;
  }
  console.warn("scheduled-context-primary-fallback", {
    primaryModelId,
    primaryFailureCode: primary.kind === "failure" ? primary.code : null,
    fallbackModelId: QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_ID,
  });
  const fallback = await attemptProviderModel(
    connection,
    request,
    QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_ID,
    QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_REVISION,
    fetchImplementation,
    Math.min(upstreamTimeoutMs, CONTEXT_FALLBACK_TIMEOUT_MS),
  );
  if (fallback.kind === "failure" && primary.kind === "failure") {
    return {
      ...fallback,
      possibleDuplicateProviderCharge:
        primary.possibleDuplicateProviderCharge ||
        fallback.possibleDuplicateProviderCharge,
    };
  }
  return fallback;
}

function normalizedCandidatePayload(
  parsed: ReturnType<typeof extractCandidatePassBGeminiResponse>,
): Record<string, unknown> | null {
  if (!parsed.ok) return null;
  return {
    candidates: [
      {
        finishReason: "STOP",
        content: {
          parts: [
            {
              text: JSON.stringify({
                segments: parsed.analysis.segments,
                ...parsed.analysis.insight,
              }),
            },
          ],
        },
      },
    ],
  };
}

async function attemptCandidateProvider(
  connection: CandidateInsightConnection,
  request: CandidatePassBProxyRequestBody | ScheduledCandidateUrlRequest,
  fetchImplementation: FetchImplementation,
  upstreamTimeoutMs: number,
): Promise<CandidateProviderAttempt> {
  let body: string;
  try {
    if ("audioUrl" in request && connection.provider !== "qwen") {
      return {
        kind: "failure",
        response: errorResponse(
          503,
          "CANDIDATE_MEDIA_PROVIDER_UNSUPPORTED",
          "The configured candidate provider cannot read private media URLs.",
        ),
        code: "CANDIDATE_MEDIA_PROVIDER_UNSUPPORTED",
        possibleDuplicateProviderCharge: false,
      };
    }
    const providerBody =
      connection.provider === "qwen"
        ? "audioUrl" in request
          ? buildCandidatePassBQwenOmniUrlRequestBody(
              request.audioUrl,
              request.candidateDurationMs,
              request.videoFrames,
              request.castRosterId,
              request.outputLanguage,
              request.context,
            )
          : buildCandidatePassBQwenOmniRequestBody(
              request.audioBase64,
              request.candidateDurationMs,
              request.videoFrames,
              request.castRosterId,
              request.outputLanguage,
              request.context,
            )
        : "audioBase64" in request
          ? buildCandidatePassBGeminiRequestBody(
              request.audioBase64,
              request.candidateDurationMs,
              request.videoFrames,
              request.castRosterId,
              request.outputLanguage,
              request.context,
            )
          : null;
    if (providerBody === null) throw new Error("Unsupported media transport.");
    body = JSON.stringify(providerBody);
  } catch {
    return {
      kind: "failure",
      response: errorResponse(
        400,
        "INVALID_PROVIDER_REQUEST",
        "The bounded candidate request could not be prepared.",
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
        headers:
          connection.provider === "qwen"
            ? {
                Authorization: `Bearer ${connection.apiKey}`,
                "Content-Type": "application/json",
              }
            : {
                "Content-Type": "application/json",
                "x-goog-api-key": connection.apiKey,
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
              status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_UNAVAILABLE";
            return {
              kind: "failure",
              response: errorResponse(
                status === 429 ? 429 : 503,
                code,
                "The dedicated candidate provider is temporarily unavailable.",
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
              "The dedicated candidate provider rejected the bounded request.",
            ),
            code,
            possibleDuplicateProviderCharge: false,
          };
        }

        let providerPayload: unknown;
        try {
          const bytes = await readBodyWithLimit(
            response.body,
            MAX_CANDIDATE_PASS_B_RESPONSE_BYTES,
            remainingMs(),
          );
          try {
            const text = new TextDecoder("utf-8", { fatal: true }).decode(
              bytes,
            );
            providerPayload =
              connection.provider === "qwen"
                ? extractCandidatePassBQwenOmniSseResponse(
                    text,
                    request.candidateDurationMs,
                    request.castRosterId,
                    request.outputLanguage,
                  )
                : JSON.parse(text);
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
              "The candidate provider response could not be verified.",
            ),
            code: "UPSTREAM_INVALID_RESPONSE",
            possibleDuplicateProviderCharge: true,
          };
        }

        const payload = normalizedCandidatePayload(
          extractCandidatePassBGeminiResponse(
            providerPayload,
            request.candidateDurationMs,
            request.castRosterId,
            request.outputLanguage,
          ),
        );
        if (payload === null) {
          return {
            kind: "failure",
            response: errorResponse(
              502,
              "UPSTREAM_INVALID_RESPONSE",
              "The provider response did not satisfy the current candidate schema.",
            ),
            code: "UPSTREAM_INVALID_RESPONSE",
            possibleDuplicateProviderCharge: true,
          };
        }
        return {
          kind: "success",
          payload,
          modelId: connection.descriptor.modelId,
          modelRevision: connection.descriptor.modelRevision,
        };
      },
    );
  } catch {
    return {
      kind: "failure",
      response: errorResponse(
        502,
        "UPSTREAM_OUTCOME_UNKNOWN",
        "The candidate provider outcome is unknown. A later bounded retry may repeat the provider charge.",
      ),
      code: "UPSTREAM_OUTCOME_UNKNOWN",
      possibleDuplicateProviderCharge: true,
    };
  }
}

async function attemptTranscriptProvider(
  connection: Extract<
    BroadcastTranscriptConnection,
    { readonly provider: "groq" }
  >,
  request: ScheduledTranscriptRequest,
  audio: BroadcastTranscriptGroqAudioSource,
  fetchImplementation: FetchImplementation,
  upstreamTimeoutMs: number,
): Promise<TranscriptProviderAttempt> {
  let body: FormData;
  try {
    body = buildBroadcastTranscriptGroqRequestBody(audio);
  } catch {
    return {
      kind: "failure",
      response: errorResponse(
        400,
        "INVALID_PROVIDER_REQUEST",
        "The bounded transcript request could not be prepared.",
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
        headers: { Authorization: `Bearer ${connection.apiKey}` },
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
          const code =
            status === 429
              ? "UPSTREAM_RATE_LIMITED"
              : status === 401 || status === 403
                ? "UPSTREAM_AUTH_FAILED"
                : status === 404
                  ? "UPSTREAM_MODEL_UNAVAILABLE"
                  : status >= 500
                    ? "UPSTREAM_UNAVAILABLE"
                    : "UPSTREAM_REJECTED";
          return {
            kind: "failure" as const,
            response: errorResponse(
              status === 429 ? 429 : status >= 500 ? 503 : 502,
              code,
              "The dedicated transcript provider rejected the bounded request.",
              status === 429 ? { "Retry-After": "60" } : {},
            ),
            code,
            possibleDuplicateProviderCharge: status >= 500,
          };
        }
        let payload: unknown;
        try {
          const bytes = await readBodyWithLimit(
            response.body,
            MAX_BROADCAST_TRANSCRIPT_QWEN_RESPONSE_BYTES,
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
            kind: "failure" as const,
            response: errorResponse(
              502,
              "UPSTREAM_INVALID_RESPONSE",
              "The transcript response could not be verified.",
            ),
            code: "UPSTREAM_INVALID_RESPONSE",
            possibleDuplicateProviderCharge: true,
          };
        }
        const result = extractBroadcastTranscriptGroqResponse(payload, {
          sourceStartMs: request.sourceStartMs,
          durationMs: request.durationMs,
        });
        return result === null
          ? {
              kind: "failure" as const,
              response: errorResponse(
                502,
                "UPSTREAM_INVALID_RESPONSE",
                "The transcript response did not satisfy the current schema.",
              ),
              code: "UPSTREAM_INVALID_RESPONSE",
              possibleDuplicateProviderCharge: true,
            }
          : {
              kind: "success" as const,
              payload: result,
              modelId: BROADCAST_TRANSCRIPT_GROQ_MODEL_ID,
              modelRevision: BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION,
            };
      },
    );
  } catch {
    return {
      kind: "failure",
      response: errorResponse(
        502,
        "UPSTREAM_OUTCOME_UNKNOWN",
        "The transcript provider outcome is unknown; the durable operation will resume with the same bytes.",
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
      key.length <= 80 && typeof item === "string" && item.length <= 512,
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
    ((value.phase === "retryable" && isStoredRetryCheckpoint(value.retry)) ||
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

function candidateModelReceiptIsCurrent(
  modelId: string | undefined,
  modelRevision: string | undefined,
): boolean {
  return (
    (modelId === CANDIDATE_PASS_B_QWEN_MODEL_ID &&
      modelRevision === CANDIDATE_PASS_B_QWEN_MODEL_REVISION) ||
    (modelId === CANDIDATE_PASS_B_GEMINI_MODEL_ID &&
      modelRevision === CANDIDATE_PASS_B_GEMINI_MODEL_REVISION)
  );
}

function storedTranscriptResultMatches(
  value: unknown,
  request: ScheduledTranscriptRequest,
): boolean {
  return (
    isRecord(value) &&
    value.modelId === PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_ID &&
    value.modelRevision === PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION &&
    value.sourceStartMs === request.sourceStartMs &&
    value.sourceEndMs === request.sourceStartMs + request.durationMs &&
    typeof value.textKo === "string" &&
    value.textKo.trim() === value.textKo &&
    value.textKo.length > 0
  );
}

function storedTerminalMatchesCurrentRequest(
  terminal: StoredTerminalResponse,
  scheduledRequest: ScheduledOperationRequest,
): boolean {
  const headers = terminal.headers;
  const expectedRoutingRevision =
    scheduledRequest.kind === "context"
      ? AI_BROADCAST_CONTEXT_ROUTING_REVISION
      : scheduledRequest.kind === "candidate"
        ? CANDIDATE_PASS_B_ROUTING_MODEL_REVISION
        : PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION;
  const modelReceiptIsCurrent =
    scheduledRequest.kind === "context"
      ? (
          headers[PREANALYSIS_CONTEXT_MODEL_ID_HEADER] ===
            PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID &&
          headers[PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER] ===
            PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION
        ) || (
          headers[PREANALYSIS_CONTEXT_MODEL_ID_HEADER] ===
            QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_ID &&
          headers[PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER] ===
            QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_REVISION
        )
      : scheduledRequest.kind === "candidate"
        ? candidateModelReceiptIsCurrent(
            headers[PREANALYSIS_CONTEXT_MODEL_ID_HEADER],
            headers[PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER],
          )
        : headers[PREANALYSIS_CONTEXT_MODEL_ID_HEADER] ===
            PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_ID &&
          headers[PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER] ===
            PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION;
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
      expectedRoutingRevision ||
    !modelReceiptIsCurrent ||
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
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_TERMINAL_BODY_BYTES) {
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
  if (scheduledRequest.kind === "context") {
    return (
      parseCurrentBroadcastContextResult(payload, scheduledRequest.request) !==
      null
    );
  }
  if (scheduledRequest.kind === "transcript") {
    return storedTranscriptResultMatches(payload, scheduledRequest);
  }
  return extractCandidatePassBGeminiResponse(
    payload,
    scheduledRequest.request.candidateDurationMs,
    scheduledRequest.request.castRosterId,
    scheduledRequest.request.outputLanguage,
  ).ok;
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
    CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER,
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
      "Content-Type": terminal.headers["Content-Type"] ?? JSON_CONTENT_TYPE,
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
      ...(terminal.headers[PREANALYSIS_CONTEXT_RETRY_RISK_HEADER] === undefined
        ? {}
        : {
            [PREANALYSIS_CONTEXT_RETRY_RISK_HEADER]:
              terminal.headers[PREANALYSIS_CONTEXT_RETRY_RISK_HEADER],
          }),
      ...(terminal.headers[CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER] ===
      undefined
        ? {}
        : {
            [CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER]:
              terminal.headers[CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER],
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
  return Math.min(RETRY_BACKOFF_MAX_MS, RETRY_BACKOFF_BASE_MS * 2 ** exponent);
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

function requestRouteMatches(
  request: Request,
  kind: ScheduledOperationRequest["kind"],
): boolean {
  const expectedRoutingRevision =
    kind === "context"
      ? AI_BROADCAST_CONTEXT_ROUTING_REVISION
      : kind === "candidate"
        ? CANDIDATE_PASS_B_ROUTING_MODEL_REVISION
        : PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION;
  const expectedModelId =
    kind === "context"
      ? PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID
      : kind === "candidate"
        ? PREANALYSIS_CANDIDATE_EXPECTED_MODEL_ID
        : PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_ID;
  const expectedModelRevision =
    kind === "context"
      ? PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION
      : kind === "candidate"
        ? PREANALYSIS_CANDIDATE_EXPECTED_MODEL_REVISION
        : PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION;
  return (
    request.headers.get(PREANALYSIS_CONTEXT_CONTRACT_HEADER) ===
      PREANALYSIS_CONTEXT_PROXY_VERSION &&
    request.headers.get(PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER) ===
      expectedRoutingRevision &&
    request.headers.get(PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER) ===
      expectedModelId &&
    request.headers.get(PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER) ===
      expectedModelRevision
  );
}

function internalOperationRequestKind(
  request: Request,
): ScheduledOperationRequest["kind"] | null {
  if (request.method !== "POST") return null;
  const pathname = new URL(request.url).pathname;
  const kind =
    pathname === "/execute/context"
      ? "context"
      : pathname === "/execute/candidate"
        ? "candidate"
        : pathname === "/execute/transcript"
          ? "transcript"
          : null;
  const expectedMediaType =
    kind === "transcript" &&
      mediaType(request) === BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE
      ? BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE
      : kind === "transcript"
        ? "audio/wav"
      : kind === "candidate" &&
          mediaType(request) === CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE
        ? CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE
        : "application/json";
  return kind !== null &&
    mediaType(request) === expectedMediaType &&
    requestRouteMatches(request, kind)
    ? kind
    : null;
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
    const operationKind = internalOperationRequestKind(request);
    if (operationKind === null) {
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
          operationKind,
          request,
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
    operationKind: ScheduledOperationRequest["kind"],
    request: Request,
  ): Promise<Response> {
    const isTranscriptMediaResolve =
      operationKind === "transcript" &&
      mediaType(request) === BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE;
    const isCandidateMediaResolve =
      operationKind === "candidate" &&
      mediaType(request) === CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE;
    const transportDigest = isCandidateMediaResolve
      ? request.headers.get(PREANALYSIS_CONTEXT_TRANSPORT_DIGEST_HEADER)
      : null;
    if (
      isCandidateMediaResolve &&
      (transportDigest === null ||
        !PAYLOAD_DIGEST_PATTERN.test(transportDigest))
    ) {
      return errorResponse(
        400,
        "INVALID_OPERATION",
        "The candidate transport digest is invalid.",
      );
    }
    const actualDigest = isTranscriptMediaResolve
      ? payloadDigest
      : `sha256:${await sha256Hex(requestBytes)}`;
    const expectedRequestDigest = isCandidateMediaResolve
      ? transportDigest
      : payloadDigest;
    if (actualDigest !== expectedRequestDigest) {
      return errorResponse(
        409,
        "PAYLOAD_DIGEST_MISMATCH",
        "The request bytes do not match the declared digest.",
      );
    }
    const scheduledRequest =
      operationKind === "context"
        ? parseScheduledContextRequest(requestBytes)
        : operationKind === "candidate"
          ? parseScheduledCandidateRequest(requestBytes)
          : parseScheduledTranscriptRequest(requestBytes, request);
    if (scheduledRequest === null) {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "The bounded scheduled analysis contract is invalid.",
      );
    }
    const expectedOperationId =
      scheduledRequest.kind === "context"
        ? await createPreanalysisContextOperationId(
            payloadDigest,
            scheduledRequest.source.sourceId,
          )
        : scheduledRequest.kind === "candidate"
          ? await createPreanalysisCandidateOperationId(payloadDigest)
          : await createPreanalysisTranscriptOperationId(
              payloadDigest,
              scheduledRequest.source.sourceId,
              scheduledRequest.videoId,
              scheduledRequest.sourceStartMs,
              scheduledRequest.durationMs,
            );
    if (operationId !== expectedOperationId) {
      return errorResponse(
        409,
        "OPERATION_NAMESPACE_MISMATCH",
        "The operation ID is not bound to the current contract and route.",
      );
    }
    let candidateProviderRequest:
      | CandidatePassBProxyRequestBody
      | ScheduledCandidateUrlRequest
      | null = null;
    let candidateMediaToDelete:
      | {
          readonly bucket: BroadcastTranscriptMediaBucket;
          readonly objectKey: string;
        }
      | null = null;
    if (scheduledRequest.kind === "candidate") {
      const configuredTransport = configuredCandidateTransportMode(
        this.environment,
      );
      if (configuredTransport !== scheduledRequest.transport) {
        return errorResponse(
          409,
          "CANDIDATE_TRANSPORT_MISMATCH",
          "The scheduled candidate transport does not match this deployment.",
        );
      }
      if (scheduledRequest.transport === "paid-direct") {
        candidateProviderRequest =
          scheduledRequest.request as CandidatePassBProxyRequestBody;
      } else {
        const mediaPayloadDigest = request.headers.get(
          PREANALYSIS_CANDIDATE_MEDIA_DIGEST_HEADER,
        );
        if (
          mediaPayloadDigest === null ||
          !PAYLOAD_DIGEST_PATTERN.test(mediaPayloadDigest)
        ) {
          return errorResponse(
            400,
            "INVALID_OPERATION",
            "The candidate media digest is invalid.",
          );
        }
        const transport = configuredCandidateMediaTransport(this.environment);
        if (transport === null) {
          return errorResponse(
            503,
            "CANDIDATE_MEDIA_NOT_CONFIGURED",
            "The private candidate media transport is not configured.",
          );
        }
        const mediaRequest =
          scheduledRequest.request as CandidateInsightMediaResolveRequest;
        const resolved = await resolveCandidateInsightMedia({
          bucket: transport.bucket,
          signingKey: transport.signingKey,
          mediaTicket: mediaRequest.mediaTicket,
          expectedIdentity: {
            participantId: SCHEDULED_MEDIA_PARTICIPANT_ID,
            runId: operationId,
            operationId,
            pool: "candidate",
            payloadDigest: mediaPayloadDigest,
          },
          nowMs: this.now(),
        });
        if (
          resolved === null ||
          resolved.candidateDurationMs !== mediaRequest.candidateDurationMs ||
          resolved.audioByteLength <= 0
        ) {
          return errorResponse(
            410,
            "CANDIDATE_MEDIA_UNAVAILABLE",
            "The private candidate media ticket is invalid or expired.",
          );
        }
        const canonicalContext = canonicalizeCandidatePassBContextPacket(
          mediaRequest.context,
        );
        const semanticPayloadDigest =
          await createCandidateInsightMediaSemanticPayloadDigest({
            mediaPayloadDigest,
            candidateHash: resolved.candidateHash,
            candidateDurationMs: resolved.candidateDurationMs,
            audioByteLength: resolved.audioByteLength,
            frames: resolved.frames,
            castRosterId: mediaRequest.castRosterId,
            outputLanguage: mediaRequest.outputLanguage,
            context: canonicalContext,
          });
        if (semanticPayloadDigest !== payloadDigest) {
          return errorResponse(
            409,
            "OPERATION_PAYLOAD_CONFLICT",
            "The candidate media capability does not match this operation.",
          );
        }
        candidateProviderRequest = {
          audioUrl: createCandidateInsightMediaCapabilityUrl(
            transport.publicBaseUrl,
            mediaRequest.mediaTicket,
            "audio",
          ),
          candidateDurationMs: mediaRequest.candidateDurationMs,
          videoFrames: resolved.frames.map((frame, index) => ({
            timestampMs: frame.timestampMs,
            url: createCandidateInsightMediaCapabilityUrl(
              transport.publicBaseUrl,
              mediaRequest.mediaTicket,
              String(index) as "0" | "1" | "2" | "3",
            ),
          })),
          castRosterId: mediaRequest.castRosterId,
          outputLanguage: mediaRequest.outputLanguage,
          context: canonicalContext,
        };
        candidateMediaToDelete = {
          bucket: transport.bucket,
          objectKey: resolved.objectKey,
        };
      }
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
          scheduledRequest,
        )
      ) {
        if (candidateMediaToDelete !== null) {
          await deleteCandidateInsightMediaBestEffort(
            candidateMediaToDelete.bucket,
            candidateMediaToDelete.objectKey,
          );
        }
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

    const provider =
      scheduledRequest.kind === "context"
        ? resolveDedicatedProvider(this.environment)
        : scheduledRequest.kind === "candidate"
          ? resolveDedicatedCandidateProvider(this.environment)
          : resolveDedicatedTranscriptProvider(this.environment);
    if (provider === null) {
      return errorResponse(
        503,
        "PROXY_NOT_CONFIGURED",
        "The dedicated provider connection is not configured.",
      );
    }
    if (
      scheduledRequest.kind === "context" &&
      (provider.provider !== "qwen" ||
        provider.descriptor.modelId !== PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID ||
        provider.descriptor.modelRevision !==
          PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION)
    ) {
      return errorResponse(
        503,
        "PROXY_ROUTE_NOT_CONFIGURED",
        "The dedicated provider does not match the current scheduled route.",
      );
    }
    let transcriptAudio: BroadcastTranscriptGroqAudioSource | null = null;
    let transcriptMediaToDelete:
      | {
          readonly bucket: BroadcastTranscriptMediaBucket;
          readonly objectKey: string;
        }
      | null = null;
    if (scheduledRequest.kind === "transcript") {
      const configuredTransport = configuredTranscriptTransportMode(
        this.environment,
      );
      if (configuredTransport !== scheduledRequest.transport) {
        return errorResponse(
          409,
          "TRANSCRIPT_TRANSPORT_MISMATCH",
          "The scheduled transcript transport does not match this deployment.",
        );
      }
      if (scheduledRequest.transport === "paid-direct") {
        transcriptAudio = {
          kind: "wav-bytes",
          wavBytes: scheduledRequest.wavBytes,
        };
      } else {
        const transport = configuredTranscriptMediaTransport(this.environment);
        if (transport === null) {
          return errorResponse(
            503,
            "TRANSCRIPT_MEDIA_NOT_CONFIGURED",
            "The private transcript media transport is not configured.",
          );
        }
        const expectedBinding = await createScheduledTranscriptMediaBinding(
          scheduledRequest,
          operationId,
          payloadDigest,
        );
        const resolved = await resolveBroadcastTranscriptMedia({
          bucket: transport.bucket,
          signingKey: transport.signingKey,
          mediaTicket: scheduledRequest.request.mediaTicket,
          expectedIdentity: expectedBinding,
          expectedRouteManifestFingerprint:
            expectedBinding.routeManifestFingerprint,
          expectedBinding,
          nowMs: this.now(),
        });
        if (
          resolved === null ||
          resolved.sourceStartMs !== scheduledRequest.sourceStartMs ||
          resolved.durationMs !== scheduledRequest.durationMs
        ) {
          return errorResponse(
            410,
            "TRANSCRIPT_MEDIA_UNAVAILABLE",
            "The private transcript media ticket is invalid or expired.",
          );
        }
        transcriptAudio = {
          kind: "audio-url",
          audioUrl: createBroadcastTranscriptMediaCapabilityUrl(
            transport.publicBaseUrl,
            scheduledRequest.request.mediaTicket,
          ),
        };
        transcriptMediaToDelete = {
          bucket: transport.bucket,
          objectKey: resolved.objectKey,
        };
      }
    }
    const rateLimiter =
      scheduledRequest.kind === "transcript"
        ? this.environment.PREANALYSIS_TRANSCRIPT_RATE_LIMITER
        : this.environment.PREANALYSIS_CONTEXT_RATE_LIMITER;
    if (rateLimiter !== undefined) {
      let rateLimit: { readonly success: boolean };
      try {
        rateLimit =
          await rateLimiter.limit({
            key:
              scheduledRequest.kind === "context"
                ? "scheduled-context"
                : scheduledRequest.kind === "candidate"
                  ? "scheduled-candidate"
                  : "scheduled-transcript",
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

    const result =
      scheduledRequest.kind === "context"
        ? await attemptProvider(
            provider as Exclude<
              BroadcastContextConnection,
              { readonly provider: "disabled" }
            >,
            scheduledRequest.request,
            this.dependencies.fetchImplementation ?? fetch,
            this.dependencies.upstreamTimeoutMs ?? CONTEXT_UPSTREAM_TIMEOUT_MS,
          )
        : scheduledRequest.kind === "candidate"
          ? await attemptCandidateProvider(
              provider as CandidateInsightConnection,
              candidateProviderRequest!,
              this.dependencies.fetchImplementation ?? fetch,
              this.dependencies.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS,
            )
          : await attemptTranscriptProvider(
              provider as Extract<
                BroadcastTranscriptConnection,
                { readonly provider: "groq" }
              >,
              scheduledRequest,
              transcriptAudio!,
              this.dependencies.fetchImplementation ?? fetch,
              this.dependencies.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS,
            );
    if (result.kind === "failure") {
      const retryDelayMs = retryBackoffMs(attempt);
      const possibleDuplicateProviderCharge =
        inheritedDuplicateChargeRisk || result.possibleDuplicateProviderCharge;
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

    const response = jsonResponse(
      "result" in result ? result.result : result.payload,
      200,
      {
        [PREANALYSIS_CONTEXT_CACHE_HEADER]: "miss",
        [PREANALYSIS_CONTEXT_CONTRACT_HEADER]:
          PREANALYSIS_CONTEXT_PROXY_VERSION,
        [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]:
          scheduledRequest.kind === "context"
            ? AI_BROADCAST_CONTEXT_ROUTING_REVISION
            : scheduledRequest.kind === "candidate"
              ? CANDIDATE_PASS_B_ROUTING_MODEL_REVISION
              : PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION,
        [PREANALYSIS_CONTEXT_MODEL_ID_HEADER]: result.modelId,
        [PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER]: result.modelRevision,
        [PREANALYSIS_CONTEXT_ATTEMPT_HEADER]: String(attempt),
        ...(scheduledRequest.kind === "candidate"
          ? { [CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER]: "false" }
          : {}),
        ...(inheritedDuplicateChargeRisk
          ? {
              [PREANALYSIS_CONTEXT_RETRY_RISK_HEADER]:
                "possible-duplicate-provider-charge",
            }
          : {}),
      },
    );
    const terminal = await responseToStoredTerminal(response);
    this.state = {
      ...this.state,
      phase: "succeeded",
      updatedAtMs: this.now(),
      terminal,
      retry: null,
    };
    await this.persist();
    // The durable terminal is the recovery point. Media cleanup must happen
    // only after it is committed; a crash before this line can then retry from
    // the still-present object, while a cleanup failure leaves only an
    // expiring private object and never loses the paid provider result.
    if (candidateMediaToDelete !== null) {
      await deleteCandidateInsightMediaBestEffort(
        candidateMediaToDelete.bucket,
        candidateMediaToDelete.objectKey,
      );
    }
    if (transcriptMediaToDelete !== null) {
      await deleteBroadcastTranscriptMediaBestEffort(
        transcriptMediaToDelete.bucket,
        transcriptMediaToDelete.objectKey,
      );
    }
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

  private async withOperationLock<T>(callback: () => Promise<T>): Promise<T> {
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
    CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER,
  ]) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

interface ScheduledCandidateMediaFence {
  readonly candidateHash: string;
  readonly candidateDurationMs: number;
  readonly audioByteLength: number;
  readonly frames: CandidateInsightMediaBinding["frames"];
  readonly expectedByteLength: number;
}

function boundedQueryInteger(
  value: string | null,
  maximum: number,
): number | null {
  if (value === null || !/^\d{1,10}$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum
    ? parsed
    : null;
}

function parseScheduledCandidateMediaFence(
  url: URL,
): ScheduledCandidateMediaFence | null {
  const expectedKeys = [
    "candidateHash",
    "durationMs",
    "audioBytes",
    "f0t",
    "f0b",
    "f1t",
    "f1b",
    "f2t",
    "f2b",
    "f3t",
    "f3b",
  ];
  if (
    [...url.searchParams.keys()].some((key) => !expectedKeys.includes(key)) ||
    expectedKeys.some((key) => url.searchParams.getAll(key).length !== 1)
  ) {
    return null;
  }
  const candidateHash = url.searchParams.get("candidateHash");
  const candidateDurationMs = boundedQueryInteger(
    url.searchParams.get("durationMs"),
    MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS,
  );
  const audioByteLength = boundedQueryInteger(
    url.searchParams.get("audioBytes"),
    CANDIDATE_INSIGHT_MEDIA_MAX_AUDIO_BYTES,
  );
  if (
    candidateHash === null ||
    !/^[a-f0-9]{24}$/u.test(candidateHash) ||
    candidateDurationMs === null ||
    candidateDurationMs < MIN_SCHEDULED_CANDIDATE_DURATION_MS ||
    audioByteLength === null ||
    audioByteLength !==
      WAV_HEADER_BYTES +
        Math.round(
          (candidateDurationMs * CANDIDATE_PASS_B_SAMPLE_RATE_HZ) / 1_000,
        ) *
          PCM_BYTES_PER_SAMPLE
  ) {
    return null;
  }
  const frames: CandidateInsightMediaFrameBinding[] = [];
  let previousTimestampMs = -1;
  let expectedByteLength = audioByteLength;
  for (let index = 0; index < MAX_CANDIDATE_PASS_B_VIDEO_FRAMES; index += 1) {
    const timestampMs = boundedQueryInteger(
      url.searchParams.get(`f${index}t`),
      candidateDurationMs - 1,
    );
    const byteLength = boundedQueryInteger(
      url.searchParams.get(`f${index}b`),
      CANDIDATE_INSIGHT_MEDIA_MAX_FRAME_BYTES,
    );
    if (
      timestampMs === null ||
      timestampMs <= previousTimestampMs ||
      byteLength === null ||
      byteLength < 4
    ) {
      return null;
    }
    frames.push({ timestampMs, byteLength });
    previousTimestampMs = timestampMs;
    expectedByteLength += byteLength;
  }
  if (expectedByteLength > CANDIDATE_INSIGHT_MEDIA_MAX_BUNDLE_BYTES) {
    return null;
  }
  return {
    candidateHash,
    candidateDurationMs,
    audioByteLength,
    frames: frames as unknown as CandidateInsightMediaBinding["frames"],
    expectedByteLength,
  };
}

function matchesAscii(
  bytes: Uint8Array,
  offset: number,
  expected: string,
): boolean {
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected.charCodeAt(index)) return false;
  }
  return true;
}

function isCanonicalScheduledCandidateWav(
  header: Uint8Array,
  totalByteLength: number,
  candidateDurationMs: number,
): boolean {
  if (header.byteLength !== CANDIDATE_INSIGHT_MEDIA_AUDIO_HEADER_BYTES) {
    return false;
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const dataLength = view.getUint32(40, true);
  const expectedSampleCount = Math.round(
    (candidateDurationMs * CANDIDATE_PASS_B_SAMPLE_RATE_HZ) / 1_000,
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
    dataLength === expectedSampleCount * PCM_BYTES_PER_SAMPLE &&
    WAV_HEADER_BYTES + dataLength === totalByteLength
  );
}

async function handlePreanalysisCandidateMediaRequest(
  request: Request,
  environment: PreanalysisContextProxyEnvironment,
): Promise<Response> {
  const transport = configuredCandidateMediaTransport(environment);
  if (transport === null) {
    return errorResponse(
      503,
      "CANDIDATE_MEDIA_NOT_CONFIGURED",
      "The private candidate media transport is not configured.",
    );
  }
  if (request.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Only POST is accepted.", {
      Allow: "POST",
    });
  }
  if (request.headers.get("Origin") !== PREANALYSIS_CONTEXT_ORIGIN) {
    return errorResponse(403, "ORIGIN_NOT_ALLOWED", "Origin is not allowed.");
  }
  const configuredToken = environment.PREANALYSIS_CONTEXT_TOKEN;
  if (
    configuredToken === undefined ||
    !AUTHORIZATION_TOKEN_PATTERN.test(configuredToken)
  ) {
    return errorResponse(503, "PROXY_NOT_CONFIGURED", "Authorization is unavailable.");
  }
  if (
    !(await constantTimeTextMatches(
      request.headers.get("Authorization") ?? "",
      `Bearer ${configuredToken}`,
    ))
  ) {
    return errorResponse(401, "UNAUTHORIZED", "Authorization was rejected.", {
      "WWW-Authenticate": "Bearer",
    });
  }
  if (
    request.headers.get(PREANALYSIS_CONTEXT_CONTRACT_HEADER) !==
      PREANALYSIS_CONTEXT_PROXY_VERSION ||
    mediaType(request) !== CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE
  ) {
    return errorResponse(
      412,
      "PROXY_CONTRACT_MISMATCH",
      "The candidate media contract does not match this deployment.",
    );
  }
  const operationId = request.headers.get(PREANALYSIS_CONTEXT_OPERATION_HEADER);
  const payloadDigest = request.headers.get(
    PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER,
  );
  const fence = parseScheduledCandidateMediaFence(new URL(request.url));
  if (
    operationId === null ||
    !CANDIDATE_OPERATION_ID_PATTERN.test(operationId) ||
    payloadDigest === null ||
    !PAYLOAD_DIGEST_PATTERN.test(payloadDigest) ||
    fence === null ||
    request.headers.get("Content-Length") !== String(fence.expectedByteLength)
  ) {
    return errorResponse(
      400,
      "INVALID_MEDIA",
      "The candidate media receipt or byte length is invalid.",
    );
  }
  const binding: CandidateInsightMediaBinding = {
    participantId: SCHEDULED_MEDIA_PARTICIPANT_ID,
    runId: operationId,
    operationId,
    pool: "candidate",
    payloadDigest,
    candidateHash: fence.candidateHash,
    candidateDurationMs: fence.candidateDurationMs,
    audioByteLength: fence.audioByteLength,
    frames: fence.frames,
    expectedByteLength: fence.expectedByteLength,
  };
  try {
    const staged = await stageCandidateInsightMedia({
      bucket: transport.bucket,
      signingKey: transport.signingKey,
      body: request.body,
      binding,
      ticketTtlMs: CANDIDATE_INSIGHT_MEDIA_TICKET_MAX_TTL_MS,
    });
    const validAudio = isCanonicalScheduledCandidateWav(
      staged.audioHeader,
      fence.audioByteLength,
      fence.candidateDurationMs,
    );
    staged.audioHeader.fill(0);
    if (!validAudio) {
      await deleteCandidateInsightMediaBestEffort(
        transport.bucket,
        staged.objectKey,
      );
      return errorResponse(
        400,
        "INVALID_AUDIO",
        "The candidate WAV header is invalid.",
      );
    }
    return jsonResponse(
      {
        schemaVersion: CANDIDATE_INSIGHT_MEDIA_SCHEMA_VERSION,
        status: "staged",
        mediaTicket: staged.mediaTicket,
        expiresAtMs: staged.expiresAtMs,
        candidateHash: fence.candidateHash,
        candidateDurationMs: fence.candidateDurationMs,
        frameCount: MAX_CANDIDATE_PASS_B_VIDEO_FRAMES,
      },
      202,
      { [PREANALYSIS_CONTEXT_CONTRACT_HEADER]: PREANALYSIS_CONTEXT_PROXY_VERSION },
    );
  } catch (error) {
    const status =
      error instanceof CandidateInsightMediaError &&
      ["INVALID_INPUT", "SIZE_MISMATCH", "MEDIA_INVALID"].includes(error.code)
        ? 400
        : error instanceof CandidateInsightMediaError &&
            error.code === "CHECKSUM_UNCONFIRMED"
          ? 409
          : 503;
    return errorResponse(
      status,
      status === 503 ? "CANDIDATE_MEDIA_UNAVAILABLE" : "INVALID_MEDIA",
      "The candidate media could not be staged safely.",
    );
  }
}

async function handlePreanalysisTranscriptMediaStage(
  request: Request,
  environment: PreanalysisContextProxyEnvironment,
): Promise<Response> {
  const transport = configuredTranscriptMediaTransport(environment);
  if (transport === null) {
    return errorResponse(
      503,
      "TRANSCRIPT_MEDIA_NOT_CONFIGURED",
      "The private transcript media transport is not configured.",
    );
  }
  const metadata = parseScheduledTranscriptMetadata(request);
  const operationId = request.headers.get(
    PREANALYSIS_CONTEXT_OPERATION_HEADER,
  );
  const payloadDigest = request.headers.get(
    PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER,
  );
  if (
    metadata === null ||
    operationId === null ||
    !TRANSCRIPT_OPERATION_ID_PATTERN.test(operationId) ||
    payloadDigest === null ||
    !PAYLOAD_DIGEST_PATTERN.test(payloadDigest)
  ) {
    return errorResponse(
      400,
      "INVALID_OPERATION",
      "The transcript media identity is invalid.",
    );
  }
  const expectedOperationId = await createPreanalysisTranscriptOperationId(
    payloadDigest,
    metadata.source.sourceId,
    metadata.videoId,
    metadata.sourceStartMs,
    metadata.durationMs,
  );
  if (operationId !== expectedOperationId) {
    return errorResponse(
      409,
      "OPERATION_NAMESPACE_MISMATCH",
      "The transcript operation is not bound to these source bytes.",
    );
  }
  const binding = await createScheduledTranscriptMediaBinding(
    metadata,
    operationId,
    payloadDigest,
  );
  const declaredLength = request.headers.get("Content-Length");
  if (
    declaredLength === null ||
    !/^\d+$/u.test(declaredLength) ||
    Number(declaredLength) !== binding.expectedByteLength ||
    binding.expectedByteLength > BROADCAST_TRANSCRIPT_MEDIA_MAX_BYTES
  ) {
    return errorResponse(
      400,
      "TRANSCRIPT_MEDIA_LENGTH_INVALID",
      "The canonical WAV length does not match the transcript source fence.",
    );
  }
  try {
    const staged = await stageBroadcastTranscriptMedia({
      bucket: transport.bucket,
      signingKey: transport.signingKey,
      body: request.body,
      binding,
    });
    const validHeader = canonicalScheduledTranscriptWavHeader(
      staged.header,
      staged.byteLength,
      metadata.durationMs,
    );
    staged.header.fill(0);
    if (!validHeader) {
      await deleteBroadcastTranscriptMediaBestEffort(
        transport.bucket,
        staged.objectKey,
      );
      return errorResponse(
        400,
        "INVALID_AUDIO",
        "The staged transcript audio is not a canonical 16 kHz mono WAV.",
      );
    }
    return jsonResponse(
      {
        schemaVersion: BROADCAST_TRANSCRIPT_MEDIA_SCHEMA_VERSION,
        status: "staged",
        mediaTicket: staged.mediaTicket,
        expiresAtMs: staged.expiresAtMs,
        sourceStartMs: metadata.sourceStartMs,
        sourceEndMs: metadata.sourceStartMs + metadata.durationMs,
      },
      202,
      {
        [PREANALYSIS_CONTEXT_CONTRACT_HEADER]:
          PREANALYSIS_CONTEXT_PROXY_VERSION,
        [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]:
          PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION,
        [PREANALYSIS_CONTEXT_MODEL_ID_HEADER]:
          PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_ID,
        [PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER]:
          PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION,
      },
    );
  } catch (error) {
    const code =
      error instanceof BroadcastTranscriptMediaError ? error.code : null;
    return errorResponse(
      code === "SIZE_MISMATCH" ||
        code === "CHECKSUM_UNCONFIRMED" ||
        code === "HEADER_UNAVAILABLE" ||
        code === "INVALID_INPUT"
        ? 400
        : 503,
      code === "CHECKSUM_UNCONFIRMED"
        ? "PAYLOAD_DIGEST_MISMATCH"
        : code === "SIZE_MISMATCH" ||
            code === "HEADER_UNAVAILABLE" ||
            code === "INVALID_INPUT"
          ? "INVALID_AUDIO"
          : "TRANSCRIPT_MEDIA_UNAVAILABLE",
      "The transcript media could not be staged safely.",
    );
  }
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
  if (url.pathname === PREANALYSIS_TRANSCRIPT_MEDIA_ENDPOINT_PATH) {
    if (request.method === "GET" || request.method === "HEAD") {
      const transport = configuredTranscriptMediaTransport(environment);
      return transport === null
        ? errorResponse(404, "NOT_FOUND", "Not found.")
        : serveBroadcastTranscriptMediaRequest(request, {
            bucket: transport.bucket,
            signingKey: transport.signingKey,
          });
    }
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Only GET and HEAD are accepted.", {
      Allow: "GET, HEAD",
    });
  }
  if (url.pathname === PREANALYSIS_CANDIDATE_MEDIA_ENDPOINT_PATH) {
    if (request.method === "GET" || request.method === "HEAD") {
      const transport = configuredCandidateMediaTransport(environment);
      return transport === null
        ? errorResponse(404, "NOT_FOUND", "Not found.")
        : serveCandidateInsightMediaRequest(request, {
            bucket: transport.bucket,
            signingKey: transport.signingKey,
          });
    }
    return handlePreanalysisCandidateMediaRequest(request, environment);
  }
  const operationKind =
    url.pathname === PREANALYSIS_CONTEXT_ENDPOINT_PATH
      ? "context"
      : url.pathname === PREANALYSIS_CANDIDATE_ENDPOINT_PATH
        ? "candidate"
        : url.pathname === PREANALYSIS_TRANSCRIPT_ENDPOINT_PATH
          ? "transcript"
          : null;
  if (operationKind === null || url.search !== "") {
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
  if (!requestRouteMatches(request, operationKind)) {
    return errorResponse(
      409,
      "PROXY_ROUTE_MISMATCH",
      "The scheduled runner requested a different routing or model receipt.",
    );
  }
  const requestMediaType = mediaType(request);
  if (
    operationKind === "transcript" &&
    configuredTranscriptTransportMode(environment) === "free-r2" &&
    requestMediaType === "audio/wav"
  ) {
    return handlePreanalysisTranscriptMediaStage(request, environment);
  }
  const expectedMediaType =
    operationKind === "context"
      ? "application/json"
      : operationKind === "transcript"
        ? configuredTranscriptTransportMode(environment) === "free-r2"
          ? BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE
          : configuredTranscriptTransportMode(environment) === "paid-direct"
            ? "audio/wav"
            : null
        : configuredCandidateTransportMode(environment) === "free-r2"
          ? CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE
          : configuredCandidateTransportMode(environment) === "paid-direct"
            ? "application/json"
            : null;
  if (expectedMediaType === null) {
    return errorResponse(
      503,
      "TRANSPORT_NOT_CONFIGURED",
      "The scheduled media transport is not configured.",
    );
  }
  if (requestMediaType !== expectedMediaType) {
    return errorResponse(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "The scheduled request media type does not match this deployment.",
    );
  }

  const operationId = request.headers.get(PREANALYSIS_CONTEXT_OPERATION_HEADER);
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
  const isCandidateMediaResolve =
    operationKind === "candidate" &&
    requestMediaType === CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE;
  const transportDigest = isCandidateMediaResolve
    ? request.headers.get(PREANALYSIS_CONTEXT_TRANSPORT_DIGEST_HEADER)
    : null;
  const candidateMediaDigest = isCandidateMediaResolve
    ? request.headers.get(PREANALYSIS_CANDIDATE_MEDIA_DIGEST_HEADER)
    : null;
  if (
    isCandidateMediaResolve &&
    (transportDigest === null ||
      !PAYLOAD_DIGEST_PATTERN.test(transportDigest) ||
      candidateMediaDigest === null ||
      !PAYLOAD_DIGEST_PATTERN.test(candidateMediaDigest))
  ) {
    return errorResponse(
      400,
      "INVALID_OPERATION",
      "The candidate transport identity is invalid.",
    );
  }
  const declaredLength = request.headers.get("Content-Length");
  const requestBodyLimit =
    operationKind === "transcript" &&
    requestMediaType === BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE
      ? MAX_TRANSCRIPT_RESOLVE_BODY_BYTES
      : isCandidateMediaResolve
        ? MAX_CANDIDATE_RESOLVE_BODY_BYTES
        : MAX_REQUEST_BODY_BYTES;
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) ||
      Number(declaredLength) > requestBodyLimit)
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
      requestBodyLimit,
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
    const actualDigest =
      operationKind === "transcript" &&
      requestMediaType === BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE
        ? payloadDigest
        : `sha256:${await sha256Hex(bytes)}`;
    const expectedRequestDigest = isCandidateMediaResolve
      ? transportDigest
      : payloadDigest;
    if (actualDigest !== expectedRequestDigest) {
      return errorResponse(
        409,
        "PAYLOAD_DIGEST_MISMATCH",
        "The exact request bytes do not match the declared digest.",
      );
    }
    const parsedRequest =
      operationKind === "context"
        ? parseScheduledContextRequest(bytes)
        : operationKind === "transcript"
          ? parseScheduledTranscriptRequest(bytes, request)
          : null;
    if (operationKind !== "candidate" && parsedRequest === null) {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "The bounded scheduled analysis contract is invalid.",
      );
    }
    const expectedOperationId =
      operationKind === "context"
        ? await createPreanalysisContextOperationId(
            payloadDigest,
            (parsedRequest as ScheduledContextRequest).source.sourceId,
          )
        : operationKind === "candidate"
          ? await createPreanalysisCandidateOperationId(payloadDigest)
          : await createPreanalysisTranscriptOperationId(
              payloadDigest,
              (parsedRequest as ScheduledTranscriptRequest).source.sourceId,
              (parsedRequest as ScheduledTranscriptRequest).videoId,
              (parsedRequest as ScheduledTranscriptRequest).sourceStartMs,
              (parsedRequest as ScheduledTranscriptRequest).durationMs,
            );
    if (operationId !== expectedOperationId) {
      return errorResponse(
        409,
        "OPERATION_NAMESPACE_MISMATCH",
        "The operation ID is not bound to the current contract and route.",
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
      response = await stub.fetch(
        `https://preanalysis.internal/execute/${operationKind}`,
        {
          method: "POST",
          headers: {
            "Content-Type": requestMediaType,
            [PREANALYSIS_CONTEXT_CONTRACT_HEADER]:
              PREANALYSIS_CONTEXT_PROXY_VERSION,
            [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]:
              operationKind === "context"
                ? AI_BROADCAST_CONTEXT_ROUTING_REVISION
                : operationKind === "candidate"
                  ? CANDIDATE_PASS_B_ROUTING_MODEL_REVISION
                  : PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION,
            [PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER]:
              operationKind === "context"
                ? PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID
                : operationKind === "candidate"
                  ? PREANALYSIS_CANDIDATE_EXPECTED_MODEL_ID
                  : PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_ID,
            [PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER]:
              operationKind === "context"
                ? PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION
                : operationKind === "candidate"
                  ? PREANALYSIS_CANDIDATE_EXPECTED_MODEL_REVISION
                  : PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION,
            [PREANALYSIS_CONTEXT_OPERATION_HEADER]: operationId,
            [PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER]: payloadDigest,
            ...(isCandidateMediaResolve
              ? {
                  [PREANALYSIS_CONTEXT_TRANSPORT_DIGEST_HEADER]:
                    transportDigest!,
                  [PREANALYSIS_CANDIDATE_MEDIA_DIGEST_HEADER]:
                    candidateMediaDigest!,
                }
              : {}),
            ...(operationKind === "transcript"
              ? {
                  [PREANALYSIS_TRANSCRIPT_SOURCE_ID_HEADER]:
                    request.headers.get(
                      PREANALYSIS_TRANSCRIPT_SOURCE_ID_HEADER,
                    )!,
                  [PREANALYSIS_TRANSCRIPT_VIDEO_ID_HEADER]:
                    request.headers.get(
                      PREANALYSIS_TRANSCRIPT_VIDEO_ID_HEADER,
                    )!,
                  [PREANALYSIS_TRANSCRIPT_SOURCE_START_HEADER]:
                    request.headers.get(
                      PREANALYSIS_TRANSCRIPT_SOURCE_START_HEADER,
                    )!,
                  [PREANALYSIS_TRANSCRIPT_DURATION_HEADER]:
                    request.headers.get(
                      PREANALYSIS_TRANSCRIPT_DURATION_HEADER,
                    )!,
                }
              : {}),
          },
          body: forwardedBody,
        },
      );
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
