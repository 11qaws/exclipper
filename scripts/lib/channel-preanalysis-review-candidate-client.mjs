import { createHash } from "node:crypto";

import {
  MAX_CANDIDATE_PASS_B_RESPONSE_BYTES,
  extractCandidatePassBGeminiResponse,
} from "../../src/analysis/candidatePassBGemini.ts";
import {
  CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
  CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
  createCandidateInsightMediaSemanticPayloadDigest,
  createCandidateInsightMediaResolveRequest,
  parseCandidateInsightMediaStagedResponse,
} from "../../src/analysis/candidateInsightMediaProtocol.ts";
import { CANDIDATE_INSIGHT_MEDIA_MAX_BUNDLE_BYTES } from "../../src/cloudflare/candidateInsightMedia.ts";
import { summarizeCandidatePassBAudioGate } from "../../src/analysis/candidatePassBAudioGate.ts";
import {
  candidatePassBContextFingerprint,
  candidatePassBReceiptMatchesContext,
  createCandidatePassBVerificationReceipt,
  isCandidatePassBContextPacket,
  isCandidatePassBVerificationReceipt,
} from "../../src/analysis/candidateFinalVerification.ts";
import {
  CANDIDATE_PASS_B_AUDIO_GATE_REVISION,
  CANDIDATE_PASS_B_DISPATCH_INTENT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
  CANDIDATE_PASS_B_GEMINI_MODEL_ID,
  CANDIDATE_PASS_B_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_MEDIA_RECEIPT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER,
  CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
  MAX_CANDIDATE_PASS_B_SOURCE_DURATION_MS,
} from "../../src/analysis/candidatePassBWorkerProtocol.ts";
import { isFinalBroadcastContextResult } from "../../src/analysis/broadcastContextProtocol.ts";
import {
  channelPreanalysisSourceById,
} from "../../src/analysis/channelPreanalysisSources.ts";
import { candidatePassBCastRosterIdForYouTubeChannelId } from "../../src/analysis/participantRoster.ts";
import { CHANNEL_PREANALYSIS_REVIEW_FRAME_MAX_BYTES } from "../../src/analysis/channelPreanalysisReviewBundle.ts";
import { YOUTUBE_VIDEO_ID_PATTERN } from "../../src/analysis/youtubeCaptionTrack.ts";
import {
  PREANALYSIS_CANDIDATE_ENDPOINT_PATH,
  PREANALYSIS_CANDIDATE_MEDIA_DIGEST_HEADER,
  PREANALYSIS_CANDIDATE_MEDIA_ENDPOINT_PATH,
  PREANALYSIS_CANDIDATE_EXPECTED_MODEL_ID,
  PREANALYSIS_CANDIDATE_EXPECTED_MODEL_REVISION,
  PREANALYSIS_CONTEXT_ATTEMPT_HEADER,
  PREANALYSIS_CONTEXT_CACHE_HEADER,
  PREANALYSIS_CONTEXT_CONTRACT_HEADER,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_OPERATION_HEADER,
  PREANALYSIS_CONTEXT_ORIGIN,
  PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER,
  PREANALYSIS_CONTEXT_PROXY_VERSION,
  PREANALYSIS_CONTEXT_RETRY_RISK_HEADER,
  PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER,
  PREANALYSIS_CONTEXT_TRANSPORT_DIGEST_HEADER,
  createPreanalysisCandidateOperationId,
} from "../../src/cloudflare/preanalysisContextProxy.worker.ts";

export const CHANNEL_PREANALYSIS_REVIEW_CANDIDATE_CLIENT_SCHEMA_VERSION =
  "1.1.0";

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MIN_CANDIDATE_DURATION_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 3 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_MAX_ELAPSED_MS = 15 * 60_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 2 * 60_000;
const MAX_ERROR_RESPONSE_BYTES = 16 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{24,512}$/u;
const PIPELINE_REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RETRY_GRANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/u;
const MAX_SEMANTIC_ATTEMPT_ORDINAL = 2;

export class ChannelPreanalysisReviewCandidateClientError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ChannelPreanalysisReviewCandidateClientError";
    this.code = code;
    this.retryable = options.retryable === true;
    this.attempts = options.attempts ?? 0;
  }
}

function clientError(code, message, options) {
  return new ChannelPreanalysisReviewCandidateClientError(code, message, options);
}

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256Text(text) {
  return sha256Bytes(Buffer.from(text, "utf8"));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw clientError("INVALID_CONFIGURATION", "The scheduled candidate endpoint is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== PREANALYSIS_CANDIDATE_ENDPOINT_PATH
  ) {
    throw clientError(
      "INVALID_CONFIGURATION",
      "The scheduled candidate endpoint must be the exact HTTPS candidate route.",
    );
  }
  return url.toString();
}

function normalizeOptions(options) {
  if (!isRecord(options)) {
    throw clientError("INVALID_CONFIGURATION", "Candidate client options are required.");
  }
  const source = channelPreanalysisSourceById(options.sourceId);
  const expectedCastRosterId = source === null
    ? null
    : candidatePassBCastRosterIdForYouTubeChannelId(source.channelId);
  if (
    source === null ||
    source.channelId !== options.channelId ||
    typeof options.videoId !== "string" ||
    !YOUTUBE_VIDEO_ID_PATTERN.test(options.videoId) ||
    !Number.isSafeInteger(options.sourceDurationMs) ||
    options.sourceDurationMs < MIN_CANDIDATE_DURATION_MS ||
    options.sourceDurationMs > MAX_CANDIDATE_PASS_B_SOURCE_DURATION_MS ||
    !Number.isSafeInteger(options.artifactRevision) ||
    options.artifactRevision < 1 ||
    typeof options.pipelineRevision !== "string" ||
    !PIPELINE_REVISION_PATTERN.test(options.pipelineRevision) ||
    typeof options.authorizationToken !== "string" ||
    !TOKEN_PATTERN.test(options.authorizationToken) ||
    (options.castRosterId !== undefined && options.castRosterId !== expectedCastRosterId)
  ) {
    throw clientError("INVALID_CONFIGURATION", "Candidate client identity or authorization is invalid.");
  }
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxElapsedMs = options.maxElapsedMs ?? DEFAULT_MAX_ELAPSED_MS;
  if (
    !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1_000 || requestTimeoutMs > 10 * 60_000 ||
    !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 12 ||
    !Number.isSafeInteger(maxElapsedMs) || maxElapsedMs < requestTimeoutMs || maxElapsedMs > 60 * 60_000 ||
    (options.fetchImplementation !== undefined && typeof options.fetchImplementation !== "function") ||
    (options.sleepImplementation !== undefined && typeof options.sleepImplementation !== "function") ||
    (options.nowImplementation !== undefined && typeof options.nowImplementation !== "function")
  ) {
    throw clientError("INVALID_CONFIGURATION", "Candidate client retry settings are invalid.");
  }
  const identitySeed = JSON.stringify([
    CHANNEL_PREANALYSIS_REVIEW_CANDIDATE_CLIENT_SCHEMA_VERSION,
    source.sourceId,
    source.channelId,
    options.videoId,
    options.sourceDurationMs,
    options.artifactRevision,
    options.pipelineRevision,
  ]);
  const identityDigest = sha256Text(identitySeed);
  return Object.freeze({
    endpoint: normalizeEndpoint(options.endpointUrl),
    mediaEndpoint: new URL(
      PREANALYSIS_CANDIDATE_MEDIA_ENDPOINT_PATH,
      normalizeEndpoint(options.endpointUrl),
    ).toString(),
    authorizationToken: options.authorizationToken,
    source,
    videoId: options.videoId,
    sourceDurationMs: options.sourceDurationMs,
    artifactRevision: options.artifactRevision,
    pipelineRevision: options.pipelineRevision,
    analysisRunId: `channel-review.${identityDigest.slice("sha256:".length, 64)}`,
    sourceFingerprint: identityDigest,
    castRosterId: expectedCastRosterId,
    requestTimeoutMs,
    maxAttempts,
    maxElapsedMs,
    fetchImplementation: options.fetchImplementation ?? globalThis.fetch,
    sleepImplementation: options.sleepImplementation ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))),
    nowImplementation: options.nowImplementation ?? Date.now,
  });
}

function strictBase64Bytes(value, code) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(value) ||
    value.slice(0, -2).includes("=")
  ) {
    throw clientError(code, "Candidate media is not canonical base64.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) {
    throw clientError(code, "Candidate media base64 does not round-trip exactly.");
  }
  return bytes;
}

function normalizeFrame(frame, durationMs) {
  if (
    !isRecord(frame) ||
    !Number.isSafeInteger(frame.timestampMs) ||
    frame.timestampMs < 0 ||
    frame.timestampMs >= durationMs ||
    frame.mimeType !== "image/jpeg" ||
    !Number.isSafeInteger(frame.byteLength) ||
    frame.byteLength <= 0 ||
    frame.byteLength > CHANNEL_PREANALYSIS_REVIEW_FRAME_MAX_BYTES ||
    !SHA256_PATTERN.test(frame.contentDigest ?? "") ||
    frame.extractionRevision !== CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION
  ) {
    throw clientError("INVALID_MEDIA", "Candidate JPEG metadata is invalid.");
  }
  const bytes = strictBase64Bytes(frame.dataBase64, "INVALID_MEDIA");
  if (
    bytes.byteLength !== frame.byteLength ||
    bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9 ||
    sha256Bytes(bytes) !== frame.contentDigest
  ) {
    throw clientError("INVALID_MEDIA", "Candidate JPEG bytes do not match their receipt.");
  }
  return Object.freeze({
    bytes,
    request: Object.freeze({
      timestampMs: frame.timestampMs,
      mimeType: "image/jpeg",
      dataBase64: frame.dataBase64,
    }),
    receipt: Object.freeze({
      timestampMs: frame.timestampMs,
      mimeType: "image/jpeg",
      byteLength: frame.byteLength,
      contentDigest: frame.contentDigest,
      extractionRevision: CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
    }),
  });
}

function ascii(bytes, start, length) {
  return Buffer.from(bytes.buffer, bytes.byteOffset + start, length).toString("ascii");
}

function normalizeAudio(audio, durationMs) {
  if (
    !isRecord(audio) ||
    audio.mimeType !== "audio/wav" ||
    !(audio.bytes instanceof Uint8Array) ||
    !Number.isSafeInteger(audio.byteLength) ||
    !Number.isSafeInteger(audio.dataByteLength) ||
    !Number.isSafeInteger(audio.sampleCount) ||
    audio.sampleRateHz !== CANDIDATE_PASS_B_SAMPLE_RATE_HZ ||
    !SHA256_PATTERN.test(audio.contentDigest ?? "")
  ) {
    throw clientError("INVALID_MEDIA", "Candidate WAV metadata is invalid.");
  }
  const bytes = Buffer.from(audio.bytes.buffer, audio.bytes.byteOffset, audio.bytes.byteLength);
  const expectedSampleCount = Math.round(
    (durationMs * CANDIDATE_PASS_B_SAMPLE_RATE_HZ) / 1_000,
  );
  const expectedDataByteLength = expectedSampleCount * 2;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.byteLength !== 44 + expectedDataByteLength ||
    audio.byteLength !== bytes.byteLength ||
    audio.dataByteLength !== expectedDataByteLength ||
    audio.sampleCount !== expectedSampleCount ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    view.getUint32(4, true) !== bytes.byteLength - 8 ||
    ascii(bytes, 8, 4) !== "WAVE" ||
    ascii(bytes, 12, 4) !== "fmt " ||
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint32(24, true) !== CANDIDATE_PASS_B_SAMPLE_RATE_HZ ||
    view.getUint32(28, true) !== CANDIDATE_PASS_B_SAMPLE_RATE_HZ * 2 ||
    view.getUint16(32, true) !== 2 ||
    view.getUint16(34, true) !== 16 ||
    ascii(bytes, 36, 4) !== "data" ||
    view.getUint32(40, true) !== expectedDataByteLength ||
    sha256Bytes(bytes) !== audio.contentDigest
  ) {
    throw clientError("INVALID_MEDIA", "Candidate WAV bytes do not match the exact 16 kHz mono receipt.");
  }
  return { bytes, sampleCount: expectedSampleCount };
}

function normalizeSemanticAttempt(value) {
  const attempt = value;
  if (
    !isRecord(attempt) ||
    !Number.isSafeInteger(attempt.attemptOrdinal) ||
    attempt.attemptOrdinal < 0 ||
    attempt.attemptOrdinal > MAX_SEMANTIC_ATTEMPT_ORDINAL ||
    (attempt.attemptOrdinal === 0
      ? attempt.retryGrantId !== null
      : typeof attempt.retryGrantId !== "string" ||
        !RETRY_GRANT_ID_PATTERN.test(attempt.retryGrantId))
  ) {
    throw clientError(
      "INVALID_IDENTITY",
      "Candidate semantic attempt identity is invalid.",
    );
  }
  return Object.freeze({
    attemptOrdinal: attempt.attemptOrdinal,
    retryGrantId: attempt.retryGrantId,
  });
}

function audioGateReceipt(bytes, sampleCount) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pcm = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = view.getInt16(44 + index * 2, true);
    pcm[index] = sample < 0 ? sample / 32_768 : sample / 32_767;
  }
  const gate = summarizeCandidatePassBAudioGate(
    pcm,
    CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  );
  pcm.fill(0);
  const common = {
    wavByteLength: bytes.byteLength,
    wavContentDigest: sha256Bytes(bytes),
    sampleRateHz: CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
    sampleCount,
  };
  return gate.audible
    ? Object.freeze({ kind: "audible-audio", ...common })
    : Object.freeze({
        kind: "verified-no-speech",
        ...common,
        vadRevision: CANDIDATE_PASS_B_AUDIO_GATE_REVISION,
        frameCount: gate.frameCount,
        activeFrameCount: gate.activeFrameCount,
        activeFrameRatio: gate.activeFrameRatio,
        audible: false,
      });
}

function validateAnalysisPayload(identity, payload) {
  if (!isRecord(payload) || !isRecord(payload.candidate)) {
    throw clientError("INVALID_IDENTITY", "Candidate analysis payload is invalid.");
  }
  const {
    candidate,
    context,
    evidence,
    frames,
    audio,
    broadcastContext,
    participantGrounding,
  } = payload;
  const semanticAttempt = normalizeSemanticAttempt(payload.semanticAttempt);
  if (
    typeof candidate.candidateId !== "string" || candidate.candidateId.length === 0 || candidate.candidateId.length > 256 ||
    !Number.isSafeInteger(candidate.startMs) || candidate.startMs < 0 ||
    !Number.isSafeInteger(candidate.endMs) || candidate.endMs > identity.sourceDurationMs ||
    !Number.isSafeInteger(candidate.focusMs) || candidate.focusMs < candidate.startMs || candidate.focusMs >= candidate.endMs
  ) {
    throw clientError("INVALID_IDENTITY", "Candidate source fence is invalid.");
  }
  const durationMs = candidate.endMs - candidate.startMs;
  if (durationMs < MIN_CANDIDATE_DURATION_MS || durationMs > 60_000) {
    throw clientError("INVALID_IDENTITY", "Candidate duration must be between 30 and 60 seconds.");
  }
  if (
    !isCandidatePassBContextPacket(context) ||
    !isRecord(broadcastContext) ||
    !isFinalBroadcastContextResult(broadcastContext) ||
    context.broadcastSummaryKo !== broadcastContext.broadcastSummaryKo ||
    !isRecord(evidence) || evidence.candidateId !== candidate.candidateId ||
    !isRecord(participantGrounding) || participantGrounding.status !== "sealed" ||
    participantGrounding.sourceDurationMs !== identity.sourceDurationMs ||
    participantGrounding.castRosterId !== identity.castRosterId
  ) {
    throw clientError("INVALID_CONTEXT", "Candidate context is not sealed to the broadcast and roster.");
  }
  if (!Array.isArray(frames) || frames.length !== 4) {
    throw clientError("INVALID_MEDIA", "Exactly four candidate JPEG frames are required.");
  }
  const normalizedFrames = frames.map((frame) => normalizeFrame(frame, durationMs));
  if (new Set(normalizedFrames.map(({ receipt }) => receipt.timestampMs)).size !== 4) {
    throw clientError("INVALID_MEDIA", "Candidate JPEG frame timestamps must be distinct.");
  }
  const normalizedAudio = normalizeAudio(audio, durationMs);
  let refinementEvidenceProjectionFingerprint;
  try {
    refinementEvidenceProjectionFingerprint = sha256Text(JSON.stringify([
      "channel-preanalysis-broadcast-context-projection-v1",
      broadcastContext,
    ]));
  } catch (cause) {
    throw clientError("INVALID_CONTEXT", "Broadcast context cannot be sealed.", { cause });
  }
  return {
    candidate,
    context,
    durationMs,
    frames: normalizedFrames,
    audio: normalizedAudio,
    semanticAttempt,
    refinementEvidenceProjectionFingerprint,
  };
}

function buildDispatch(identity, normalized, operationId) {
  const contextFingerprint = candidatePassBContextFingerprint(normalized.context);
  const audio = audioGateReceipt(normalized.audio.bytes, normalized.audio.sampleCount);
  const frameReceipts = normalized.frames.map(({ receipt }) => receipt);
  const providerPayloadDigest = sha256Text(JSON.stringify([
    "candidate-pass-b-provider-payload-v1",
    normalized.candidate.candidateId,
    normalized.candidate.startMs,
    normalized.candidate.endMs,
    contextFingerprint,
    identity.castRosterId,
    "ko",
    audio.wavContentDigest,
    frameReceipts.map((frame) => [
      frame.timestampMs,
      frame.byteLength,
      frame.contentDigest,
      frame.extractionRevision,
    ]),
    CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
  ]));
  return Object.freeze({
    schemaVersion: CANDIDATE_PASS_B_DISPATCH_INTENT_SCHEMA_VERSION,
    operationId,
    analysisRunId: identity.analysisRunId,
    candidateId: normalized.candidate.candidateId,
    sourceFingerprint: identity.sourceFingerprint,
    sourceStartMs: normalized.candidate.startMs,
    sourceEndMs: normalized.candidate.endMs,
    contextFingerprint,
    outputLanguage: "ko",
    castRosterId: identity.castRosterId,
    routingModelRevision: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
    attemptOrdinal: normalized.semanticAttempt.attemptOrdinal,
    retryGrantId: normalized.semanticAttempt.retryGrantId,
    transportMode: "free-r2",
    mediaReceipt: Object.freeze({
      schemaVersion: CANDIDATE_PASS_B_MEDIA_RECEIPT_SCHEMA_VERSION,
      frameExtractionRevision: CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
      frames: Object.freeze(frameReceipts),
      audio,
      providerPayloadDigest,
    }),
  });
}

function responseModel(headers) {
  const id = headers.get(PREANALYSIS_CONTEXT_MODEL_ID_HEADER);
  const revision = headers.get(PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER);
  if (id === CANDIDATE_PASS_B_QWEN_MODEL_ID && revision === CANDIDATE_PASS_B_QWEN_MODEL_REVISION) {
    return Object.freeze({ id, revision });
  }
  if (id === CANDIDATE_PASS_B_GEMINI_MODEL_ID && revision === CANDIDATE_PASS_B_GEMINI_MODEL_REVISION) {
    return Object.freeze({ id, revision });
  }
  return null;
}

function responseReceiptIsCurrent(response) {
  return (
    response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json" &&
    response.headers.get(PREANALYSIS_CONTEXT_CONTRACT_HEADER) === PREANALYSIS_CONTEXT_PROXY_VERSION &&
    response.headers.get(PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER) === CANDIDATE_PASS_B_ROUTING_MODEL_REVISION &&
    ["hit", "miss"].includes(response.headers.get(PREANALYSIS_CONTEXT_CACHE_HEADER) ?? "") &&
    /^[1-9][0-9]{0,8}$/u.test(response.headers.get(PREANALYSIS_CONTEXT_ATTEMPT_HEADER) ?? "") &&
    response.headers.get(CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER) === "false" &&
    [null, "possible-duplicate-provider-charge"].includes(response.headers.get(PREANALYSIS_CONTEXT_RETRY_RISK_HEADER))
  );
}

async function readBoundedBytes(response, maximumBytes) {
  const declared = response.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) {
    throw clientError("RESPONSE_INVALID", "Candidate response exceeds its byte limit.");
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw clientError("RESPONSE_INVALID", "Candidate response exceeds its byte limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeUtf8(bytes, code) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw clientError(code, "Candidate response is not valid UTF-8.", { cause });
  }
}

async function safeProxyErrorCode(response) {
  try {
    const bytes = await readBoundedBytes(response, MAX_ERROR_RESPONSE_BYTES);
    const payload = JSON.parse(decodeUtf8(bytes, "HTTP_REJECTED"));
    return isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === "string"
      ? payload.error.code
      : null;
  } catch {
    return null;
  }
}

function retryAfterMs(response, attempt, nowMs) {
  const value = response?.headers.get("Retry-After")?.trim();
  if (value !== undefined && value !== "") {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, Math.ceil(seconds * 1_000)));
    }
    const atMs = Date.parse(value);
    if (Number.isFinite(atMs)) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, atMs - nowMs));
    }
  }
  return Math.min(MAX_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS * 2 ** Math.min(7, attempt - 1));
}

function shouldRetry(status, proxyCode) {
  return (
    status === 408 ||
    status === 429 ||
    (status === 409 && proxyCode === "OPERATION_IN_PROGRESS") ||
    (status >= 500 && status <= 599)
  );
}

async function fetchOnce(identity, endpoint, requestBody, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), identity.requestTimeoutMs);
  try {
    return await identity.fetchImplementation(endpoint, {
      method: "POST",
      headers,
      body: requestBody,
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function requestCandidate(identity, requestBody, headers) {
  const startedAtMs = identity.nowImplementation();
  let lastCause = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= identity.maxAttempts; attempt += 1) {
    attempts = attempt;
    let response = null;
    try {
      response = await fetchOnce(identity, identity.endpoint, requestBody, headers);
      if (response.ok) return response;
      const proxyCode = await safeProxyErrorCode(response);
      if (!shouldRetry(response.status, proxyCode)) {
        throw clientError(
          "HTTP_REJECTED",
          `Scheduled candidate analysis was rejected with HTTP ${response.status}.`,
          { attempts: attempt },
        );
      }
      lastCause = clientError(
        proxyCode ?? `HTTP_${response.status}`,
        "Scheduled candidate analysis is temporarily unavailable.",
        { retryable: true, attempts: attempt },
      );
    } catch (cause) {
      if (cause instanceof ChannelPreanalysisReviewCandidateClientError && !cause.retryable) throw cause;
      lastCause = cause;
    }
    if (attempt >= identity.maxAttempts) break;
    const delayMs = retryAfterMs(response, attempt, identity.nowImplementation());
    if (identity.nowImplementation() - startedAtMs + delayMs > identity.maxElapsedMs) break;
    await identity.sleepImplementation(delayMs);
  }
  throw clientError(
    "RETRY_EXHAUSTED",
    "Scheduled candidate analysis did not reach a terminal response within its retry budget.",
    { cause: lastCause, retryable: true, attempts },
  );
}

function candidateMediaStageUrl(identity, candidateHash, normalized) {
  const url = new URL(identity.mediaEndpoint);
  url.searchParams.set("candidateHash", candidateHash);
  url.searchParams.set("durationMs", String(normalized.durationMs));
  url.searchParams.set("audioBytes", String(normalized.audio.bytes.byteLength));
  normalized.frames.forEach((frame, index) => {
    url.searchParams.set(`f${index}t`, String(frame.request.timestampMs));
    url.searchParams.set(`f${index}b`, String(frame.bytes.byteLength));
  });
  return url.toString();
}

async function stageCandidateMedia(
  identity,
  normalized,
  dispatchIntent,
  mediaBundle,
  mediaPayloadDigest,
  candidateHash,
) {
  const endpoint = candidateMediaStageUrl(identity, candidateHash, normalized);
  const headers = Object.freeze({
    "Content-Type": CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
    "Content-Length": String(mediaBundle.byteLength),
    Origin: PREANALYSIS_CONTEXT_ORIGIN,
    Authorization: `Bearer ${identity.authorizationToken}`,
    [PREANALYSIS_CONTEXT_CONTRACT_HEADER]: PREANALYSIS_CONTEXT_PROXY_VERSION,
    [PREANALYSIS_CONTEXT_OPERATION_HEADER]: dispatchIntent.operationId,
    [PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER]: mediaPayloadDigest,
  });
  const startedAtMs = identity.nowImplementation();
  let lastCause = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= identity.maxAttempts; attempt += 1) {
    attempts = attempt;
    let response = null;
    try {
      response = await fetchOnce(identity, endpoint, mediaBundle, headers);
      if (response.status === 202) {
        if (
          response.headers
            .get("Content-Type")
            ?.split(";", 1)[0]
            ?.trim()
            .toLowerCase() !== "application/json" ||
          response.headers.get(PREANALYSIS_CONTEXT_CONTRACT_HEADER) !==
          PREANALYSIS_CONTEXT_PROXY_VERSION
        ) {
          await response.body?.cancel().catch(() => undefined);
          throw clientError(
            "RESPONSE_RECEIPT_INVALID",
            "Candidate media staging returned a stale contract.",
          );
        }
        const bytes = await readBoundedBytes(response, MAX_ERROR_RESPONSE_BYTES);
        const value = JSON.parse(decodeUtf8(bytes, "RESPONSE_INVALID"));
        const staged = parseCandidateInsightMediaStagedResponse(
          value,
          candidateHash,
          normalized.durationMs,
        );
        if (staged === null) {
          throw clientError(
            "RESPONSE_RECEIPT_INVALID",
            "Candidate media staging receipt is invalid.",
          );
        }
        return staged;
      }
      const proxyCode = await safeProxyErrorCode(response);
      if (!shouldRetry(response.status, proxyCode)) {
        throw clientError(
          "MEDIA_STAGE_REJECTED",
          `Candidate media staging was rejected with HTTP ${response.status}.`,
          { attempts: attempt },
        );
      }
      lastCause = clientError(
        proxyCode ?? `HTTP_${response.status}`,
        "Candidate media staging is temporarily unavailable.",
        { retryable: true, attempts: attempt },
      );
    } catch (cause) {
      if (
        cause instanceof ChannelPreanalysisReviewCandidateClientError &&
        !cause.retryable
      ) {
        throw cause;
      }
      lastCause = cause;
    }
    if (attempt >= identity.maxAttempts) break;
    const delayMs = retryAfterMs(response, attempt, identity.nowImplementation());
    if (
      identity.nowImplementation() - startedAtMs + delayMs >
      identity.maxElapsedMs
    ) {
      break;
    }
    await identity.sleepImplementation(delayMs);
  }
  throw clientError(
    "MEDIA_STAGE_RETRY_EXHAUSTED",
    "Candidate media did not reach private storage within its retry budget.",
    { cause: lastCause, retryable: true, attempts },
  );
}

function selectImpactThumbnailIndex(candidate, frames) {
  const focusMs = candidate.focusMs - candidate.startMs;
  let selected = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const distance = Math.abs(frames[index].request.timestampMs - focusMs);
    const selectedDistance = Math.abs(frames[selected].request.timestampMs - focusMs);
    if (distance < selectedDistance) selected = index;
  }
  return selected;
}

/**
 * Creates the analyzeCandidate callback consumed by runChannelPreanalysisReview.
 * Provider credentials remain exclusively inside the authenticated Worker.
 */
export function createChannelPreanalysisReviewCandidateAnalyzer(options) {
  const identity = normalizeOptions(options);
  const { castRosterId } = identity;

  return async function analyzeCandidate(payload) {
    const normalized = validateAnalysisPayload(identity, payload);
    const mediaBundle = Buffer.concat([
      normalized.audio.bytes,
      ...normalized.frames.map(({ bytes }) => bytes),
    ]);
    if (mediaBundle.byteLength > CANDIDATE_INSIGHT_MEDIA_MAX_BUNDLE_BYTES) {
      throw clientError(
        "REQUEST_TOO_LARGE",
        "Candidate media exceeds the private staging byte limit.",
      );
    }
    const mediaPayloadDigest = sha256Bytes(mediaBundle);
    const candidateHash = sha256Text(
      JSON.stringify([
        identity.source.sourceId,
        identity.videoId,
        normalized.candidate.candidateId,
        normalized.candidate.startMs,
        normalized.candidate.endMs,
        normalized.semanticAttempt.attemptOrdinal,
        normalized.semanticAttempt.retryGrantId,
      ]),
    ).slice("sha256:".length, "sha256:".length + 24);
    const semanticPayloadDigest =
      await createCandidateInsightMediaSemanticPayloadDigest({
        mediaPayloadDigest,
        candidateHash,
        candidateDurationMs: normalized.durationMs,
        audioByteLength: normalized.audio.bytes.byteLength,
        frames: normalized.frames.map(({ request, bytes }) => ({
          timestampMs: request.timestampMs,
          byteLength: bytes.byteLength,
        })),
        castRosterId,
        outputLanguage: "ko",
        context: normalized.context,
      });
    const operationId =
      await createPreanalysisCandidateOperationId(semanticPayloadDigest);
    const dispatchIntent = buildDispatch(identity, normalized, operationId);
    const staged = await stageCandidateMedia(
      identity,
      normalized,
      dispatchIntent,
      mediaBundle,
      mediaPayloadDigest,
      candidateHash,
    );
    const proxyRequest = createCandidateInsightMediaResolveRequest(
      staged.mediaTicket,
      normalized.durationMs,
      castRosterId,
      "ko",
      normalized.context,
    );
    const requestBody = JSON.stringify(proxyRequest);
    if (Buffer.byteLength(requestBody, "utf8") > MAX_REQUEST_BYTES) {
      throw clientError("REQUEST_TOO_LARGE", "Candidate request exceeds the scheduled proxy byte limit.");
    }
    const transportDigest = sha256Text(requestBody);
    const headers = Object.freeze({
      "Content-Type": CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
      Origin: PREANALYSIS_CONTEXT_ORIGIN,
      Authorization: `Bearer ${identity.authorizationToken}`,
      [PREANALYSIS_CONTEXT_CONTRACT_HEADER]: PREANALYSIS_CONTEXT_PROXY_VERSION,
      [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
      [PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER]: PREANALYSIS_CANDIDATE_EXPECTED_MODEL_ID,
      [PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER]: PREANALYSIS_CANDIDATE_EXPECTED_MODEL_REVISION,
      [PREANALYSIS_CONTEXT_OPERATION_HEADER]: operationId,
      [PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER]: semanticPayloadDigest,
      [PREANALYSIS_CONTEXT_TRANSPORT_DIGEST_HEADER]: transportDigest,
      [PREANALYSIS_CANDIDATE_MEDIA_DIGEST_HEADER]: mediaPayloadDigest,
    });
    const response = await requestCandidate(identity, requestBody, headers);
    if (!responseReceiptIsCurrent(response)) {
      await response.body?.cancel().catch(() => undefined);
      throw clientError("RESPONSE_RECEIPT_INVALID", "Candidate response receipt is incomplete or stale.");
    }
    const model = responseModel(response.headers);
    if (model === null) {
      await response.body?.cancel().catch(() => undefined);
      throw clientError("RESPONSE_RECEIPT_INVALID", "Candidate response model receipt is invalid.");
    }
    const responseBytes = await readBoundedBytes(response, MAX_CANDIDATE_PASS_B_RESPONSE_BYTES);
    const rawResponse = decodeUtf8(responseBytes, "RESPONSE_INVALID");
    let responsePayload;
    try {
      responsePayload = JSON.parse(rawResponse);
    } catch (cause) {
      throw clientError("RESPONSE_INVALID", "Candidate response is not valid JSON.", { cause });
    }
    const parsed = extractCandidatePassBGeminiResponse(
      responsePayload,
      normalized.durationMs,
      castRosterId,
      "ko",
    );
    if (!parsed.ok) {
      throw clientError("RESPONSE_INVALID", "Candidate response does not satisfy the current multimodal contract.");
    }
    const settlement = Object.freeze({
      schemaVersion: CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
      status: "completed",
      operationId: dispatchIntent.operationId,
      providerPayloadDigest: dispatchIntent.mediaReceipt.providerPayloadDigest,
      outputLanguage: "ko",
      castRosterId,
      responseDigest: sha256Text(rawResponse),
      providerModelId: model.id,
      providerModelRevision: model.revision,
    });
    const impactThumbnailIndex = selectImpactThumbnailIndex(normalized.candidate, normalized.frames);
    const sourceFence = Object.freeze({
      candidateId: normalized.candidate.candidateId,
      sourceStartMs: normalized.candidate.startMs,
      sourceEndMs: normalized.candidate.endMs,
      routingModelRevision: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
      refinementEvidenceProjectionFingerprint:
        normalized.refinementEvidenceProjectionFingerprint,
      outputLanguage: "ko",
      castRosterId,
    });
    const verificationReceipt = createCandidatePassBVerificationReceipt(
      normalized.context,
      normalized.frames[impactThumbnailIndex].request.timestampMs,
      sourceFence,
      dispatchIntent,
      settlement,
    );
    if (
      verificationReceipt === null ||
      !isCandidatePassBVerificationReceipt(verificationReceipt) ||
      !candidatePassBReceiptMatchesContext(verificationReceipt, normalized.context, sourceFence)
    ) {
      throw clientError("RECEIPT_INVALID", "Candidate result could not be sealed to its exact context and media.");
    }
    return Object.freeze({
      insight: parsed.analysis.insight,
      model,
      verificationReceipt,
      impactThumbnailIndex,
      segments: parsed.analysis.segments,
    });
  };
}
