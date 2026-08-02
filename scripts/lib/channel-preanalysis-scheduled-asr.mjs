import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import {
  BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE,
  createBroadcastTranscriptMediaResolveRequest,
  parseBroadcastTranscriptMediaStagedResponse,
} from "../../src/analysis/broadcastTranscriptMediaProtocol.ts";
import {
  BROADCAST_TRANSCRIPT_GROQ_MODEL_ID,
  BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
  isConfidentBroadcastTranscriptNoSpeechSegment,
} from "../../src/analysis/broadcastTranscriptQwen.ts";
import {
  PREANALYSIS_CONTEXT_CONTRACT_HEADER,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_OPERATION_HEADER,
  PREANALYSIS_CONTEXT_ORIGIN,
  PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER,
  PREANALYSIS_CONTEXT_PROXY_VERSION,
  PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER,
  PREANALYSIS_TRANSCRIPT_DURATION_HEADER,
  PREANALYSIS_TRANSCRIPT_ENDPOINT_PATH,
  PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_ID,
  PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION,
  PREANALYSIS_TRANSCRIPT_SOURCE_ID_HEADER,
  PREANALYSIS_TRANSCRIPT_SOURCE_START_HEADER,
  PREANALYSIS_TRANSCRIPT_VIDEO_ID_HEADER,
  createPreanalysisTranscriptOperationId,
} from "../../src/cloudflare/preanalysisContextProxy.worker.ts";
import { runBoundedMediaCommand } from "./channel-preanalysis-media.mjs";

export const SCHEDULED_ASR_CHUNK_DURATION_MS = 90_000;
export const SCHEDULED_ASR_CHECKPOINT_SCHEMA_VERSION = 2;

const SAMPLE_RATE_HZ = 16_000;
const PCM_BYTES_PER_SAMPLE = 2;
const WAV_HEADER_BYTES = 44;
const MAX_AUDIO_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_CHECKPOINT_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_ERROR_BYTES = 8 * 1024;
const MAX_EVENT_TEXT_LENGTH = 500;
const MEDIA_DOWNLOAD_TIMEOUT_MS = 45 * 60_000;
const CHUNK_EXTRACTION_TIMEOUT_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 2 * 60_000;
const MAX_RESOLVE_ATTEMPTS = 6;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;
const SOURCE_ID_PATTERN = /^[a-z0-9-]{3,64}$/u;

export class ChannelPreanalysisScheduledAsrError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ChannelPreanalysisScheduledAsrError";
    this.code = code;
  }
}

function asrError(code, message, cause) {
  return new ChannelPreanalysisScheduledAsrError(code, message, cause);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectedPcmBytes(durationMs) {
  return Math.round((durationMs * SAMPLE_RATE_HZ) / 1_000) * PCM_BYTES_PER_SAMPLE;
}

export function encodeScheduledAsrPcm16Wav(pcmInput, durationMs) {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > SCHEDULED_ASR_CHUNK_DURATION_MS) {
    throw asrError("ASR_DURATION_INVALID", "Scheduled ASR chunk duration is invalid.");
  }
  const expectedBytes = expectedPcmBytes(durationMs);
  const source = Buffer.isBuffer(pcmInput) ? pcmInput : Buffer.from(pcmInput);
  const pcm = Buffer.alloc(expectedBytes);
  source.copy(pcm, 0, 0, Math.min(source.byteLength, expectedBytes));
  const wav = Buffer.alloc(WAV_HEADER_BYTES + expectedBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + expectedBytes, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE_HZ, 24);
  wav.writeUInt32LE(SAMPLE_RATE_HZ * PCM_BYTES_PER_SAMPLE, 28);
  wav.writeUInt16LE(PCM_BYTES_PER_SAMPLE, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(expectedBytes, 40);
  pcm.copy(wav, WAV_HEADER_BYTES);
  pcm.fill(0);
  return wav;
}

export function scheduledAsrCheckpointPath(catalogDir, videoId) {
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw asrError("ASR_VIDEO_ID_INVALID", "Scheduled ASR video ID is invalid.");
  }
  return join(resolve(catalogDir), ".transcript-checkpoints", `${videoId}.asr.v2.json`);
}

function validTranscriptSegments(value, durationMs) {
  if (!Array.isArray(value) || value.length > 512) return false;
  let previousStartMs = -1;
  for (const segment of value) {
    if (
      !isRecord(segment) ||
      !Number.isSafeInteger(segment.relativeStartMs) ||
      !Number.isSafeInteger(segment.relativeEndMs) ||
      segment.relativeStartMs < 0 ||
      segment.relativeStartMs < previousStartMs ||
      segment.relativeEndMs <= segment.relativeStartMs ||
      segment.relativeEndMs > durationMs ||
      typeof segment.textKo !== "string" ||
      segment.textKo.trim() !== segment.textKo ||
      segment.textKo.length === 0 ||
      segment.textKo.length > 20_000 ||
      (segment.noSpeechProbability !== null &&
        (typeof segment.noSpeechProbability !== "number" ||
          !Number.isFinite(segment.noSpeechProbability) ||
          segment.noSpeechProbability < 0 ||
          segment.noSpeechProbability > 1)) ||
      (segment.averageLogProbability !== null &&
        (typeof segment.averageLogProbability !== "number" ||
          !Number.isFinite(segment.averageLogProbability) ||
          segment.averageLogProbability < -100 ||
          segment.averageLogProbability > 0))
    ) {
      return false;
    }
    previousStartMs = segment.relativeStartMs;
  }
  return true;
}

function checkpointIdentity({ sourceId, channelId, videoId, durationMs }) {
  if (
    !SOURCE_ID_PATTERN.test(sourceId) ||
    typeof channelId !== "string" ||
    channelId.length < 8 ||
    channelId.length > 64 ||
    !VIDEO_ID_PATTERN.test(videoId) ||
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 ||
    durationMs > 12 * 60 * 60_000
  ) {
    throw asrError("ASR_IDENTITY_INVALID", "Scheduled ASR source identity is invalid.");
  }
  return { sourceId, channelId, videoId, durationMs };
}

function validTranscriptResult(value, startMs, durationMs) {
  return (
    isRecord(value) &&
    value.schemaVersion === BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION &&
    value.modelId === BROADCAST_TRANSCRIPT_GROQ_MODEL_ID &&
    value.modelRevision === BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION &&
    value.sourceStartMs === startMs &&
    value.sourceEndMs === startMs + durationMs &&
    typeof value.textKo === "string" &&
    value.textKo.trim() === value.textKo &&
    value.textKo.length > 0 &&
    value.textKo.length <= 20_000 &&
    validTranscriptSegments(value.segments, durationMs) &&
    (value.textKo === "[대사 없음]" || value.segments.length > 0) &&
    (value.detectedLanguage === null || typeof value.detectedLanguage === "string") &&
    (value.emotion === null || typeof value.emotion === "string") &&
    (value.billedSeconds === null ||
      (typeof value.billedSeconds === "number" && Number.isFinite(value.billedSeconds) && value.billedSeconds >= 0))
  );
}

function validateCheckpoint(value, identity) {
  if (
    !isRecord(value) ||
    value.schemaVersion !== SCHEDULED_ASR_CHECKPOINT_SCHEMA_VERSION ||
    value.sourceId !== identity.sourceId ||
    value.channelId !== identity.channelId ||
    value.videoId !== identity.videoId ||
    value.durationMs !== identity.durationMs ||
    value.modelId !== BROADCAST_TRANSCRIPT_GROQ_MODEL_ID ||
    value.modelRevision !== BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION ||
    !Array.isArray(value.chunks)
  ) {
    return null;
  }
  const chunks = [];
  const starts = new Set();
  for (const chunk of value.chunks) {
    if (
      !isRecord(chunk) ||
      !Number.isSafeInteger(chunk.sourceStartMs) ||
      chunk.sourceStartMs < 0 ||
      !Number.isSafeInteger(chunk.durationMs) ||
      chunk.durationMs <= 0 ||
      chunk.durationMs > SCHEDULED_ASR_CHUNK_DURATION_MS ||
      chunk.sourceStartMs + chunk.durationMs > identity.durationMs ||
      chunk.sourceStartMs % SCHEDULED_ASR_CHUNK_DURATION_MS !== 0 ||
      starts.has(chunk.sourceStartMs) ||
      !validTranscriptResult(chunk.result, chunk.sourceStartMs, chunk.durationMs)
    ) {
      return null;
    }
    starts.add(chunk.sourceStartMs);
    chunks.push({
      sourceStartMs: chunk.sourceStartMs,
      durationMs: chunk.durationMs,
      result: chunk.result,
    });
  }
  return {
    schemaVersion: SCHEDULED_ASR_CHECKPOINT_SCHEMA_VERSION,
    ...identity,
    modelId: BROADCAST_TRANSCRIPT_GROQ_MODEL_ID,
    modelRevision: BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION,
    chunks: chunks.sort((left, right) => left.sourceStartMs - right.sourceStartMs),
  };
}

async function readCheckpoint(path, identity) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    throw asrError("ASR_CHECKPOINT_READ_FAILED", "Scheduled ASR checkpoint could not be read.", cause);
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CHECKPOINT_BYTES) return null;
  try {
    return validateCheckpoint(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), identity);
  } catch {
    return null;
  } finally {
    bytes.fill(0);
  }
}

async function writeCheckpointAtomic(path, checkpoint) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const serialized = `${JSON.stringify(checkpoint, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_CHECKPOINT_BYTES) {
    throw asrError("ASR_CHECKPOINT_TOO_LARGE", "Scheduled ASR checkpoint exceeds its byte limit.");
  }
  try {
    await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
    const verified = await readCheckpoint(path, checkpointIdentity(checkpoint));
    if (verified === null || verified.chunks.length !== checkpoint.chunks.length) {
      throw asrError("ASR_CHECKPOINT_VERIFY_FAILED", "Scheduled ASR checkpoint readback failed.");
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function downloadAudio(video, options) {
  const directory = await mkdtemp(join(tmpdir(), "exclipper-scheduled-asr-"));
  const commandRunner = options.commandRunner ?? runBoundedMediaCommand;
  try {
    const result = await commandRunner(
      options.ytDlpPath ?? "yt-dlp",
      [
        "--no-config",
        "--no-playlist",
        "--no-progress",
        "--no-mtime",
        "--format",
        "bestaudio/best",
        "--max-filesize",
        String(MAX_AUDIO_DOWNLOAD_BYTES),
        "--print",
        "after_move:filepath",
        "--output",
        join(directory, `${video.videoId}.%(ext)s`),
        "--",
        video.watchUrl,
      ],
      {
        timeoutMs: MEDIA_DOWNLOAD_TIMEOUT_MS,
        maxStdoutBytes: 16 * 1024,
        maxStderrBytes: 64 * 1024,
        environment: options.environment,
      },
    );
    const paths = Buffer.from(result.stdout)
      .toString("utf8")
      .split(/\r?\n/gu)
      .map((line) => line.trim())
      .filter(Boolean);
    const entries = await readdir(directory);
    if (paths.length !== 1 || entries.length !== 1) {
      throw asrError("ASR_DOWNLOAD_OUTPUT_INVALID", "yt-dlp did not produce exactly one audio file.");
    }
    const sourcePath = resolve(paths[0]);
    if (relative(directory, sourcePath).startsWith("..") || resolve(directory, entries[0]) !== sourcePath) {
      throw asrError("ASR_DOWNLOAD_OUTPUT_INVALID", "yt-dlp returned audio outside its isolated directory.");
    }
    const metadata = await lstat(sourcePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > MAX_AUDIO_DOWNLOAD_BYTES) {
      throw asrError("ASR_DOWNLOAD_OUTPUT_INVALID", "Downloaded ASR audio is not a bounded regular file.");
    }
    return {
      sourcePath,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (cause) {
    await rm(directory, { recursive: true, force: true });
    if (cause instanceof ChannelPreanalysisScheduledAsrError) throw cause;
    throw asrError("ASR_DOWNLOAD_FAILED", "Scheduled ASR audio download failed.", cause);
  }
}

async function extractChunkWav(sourcePath, sourceStartMs, durationMs, options) {
  const commandRunner = options.commandRunner ?? runBoundedMediaCommand;
  const expectedBytes = expectedPcmBytes(durationMs);
  const result = await commandRunner(
    options.ffmpegPath ?? "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-ss",
      (sourceStartMs / 1_000).toFixed(3),
      "-i",
      sourcePath,
      "-t",
      (durationMs / 1_000).toFixed(3),
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE_HZ),
      "-c:a",
      "pcm_s16le",
      "-f",
      "s16le",
      "pipe:1",
    ],
    {
      timeoutMs: CHUNK_EXTRACTION_TIMEOUT_MS,
      maxStdoutBytes: expectedBytes + 64 * 1024,
      maxStderrBytes: 64 * 1024,
      environment: options.environment,
    },
  );
  return encodeScheduledAsrPcm16Wav(result.stdout, durationMs);
}

function endpointFor(proxyUrl) {
  const url = new URL(proxyUrl);
  url.pathname = PREANALYSIS_TRANSCRIPT_ENDPOINT_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function transcriptHeaders(identity, operationId, payloadDigest, startMs, durationMs, contentType) {
  return {
    Authorization: `Bearer ${identity.authorizationToken}`,
    "Content-Type": contentType,
    Origin: PREANALYSIS_CONTEXT_ORIGIN,
    [PREANALYSIS_CONTEXT_CONTRACT_HEADER]: PREANALYSIS_CONTEXT_PROXY_VERSION,
    [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]: PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION,
    [PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER]: PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_ID,
    [PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER]: PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION,
    [PREANALYSIS_CONTEXT_OPERATION_HEADER]: operationId,
    [PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER]: payloadDigest,
    [PREANALYSIS_TRANSCRIPT_SOURCE_ID_HEADER]: identity.sourceId,
    [PREANALYSIS_TRANSCRIPT_VIDEO_ID_HEADER]: identity.videoId,
    [PREANALYSIS_TRANSCRIPT_SOURCE_START_HEADER]: String(startMs),
    [PREANALYSIS_TRANSCRIPT_DURATION_HEADER]: String(durationMs),
  };
}

async function boundedJson(response, maximumBytes) {
  const declaredLength = response.headers.get("Content-Length");
  if (declaredLength !== null && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)) {
    throw asrError("ASR_RESPONSE_TOO_LARGE", "Scheduled ASR response exceeds its byte limit.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    bytes.fill(0);
    throw asrError("ASR_RESPONSE_TOO_LARGE", "Scheduled ASR response exceeds its byte limit.");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    throw asrError("ASR_RESPONSE_INVALID", "Scheduled ASR response is not valid UTF-8 JSON.", cause);
  } finally {
    bytes.fill(0);
  }
}

function retryDelayMs(response, attempt) {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter !== null && /^\d{1,4}$/u.test(retryAfter)) {
    return Math.min(120_000, Math.max(1_000, Number(retryAfter) * 1_000));
  }
  return Math.min(30_000, 1_000 * 2 ** attempt);
}

async function fetchBounded(fetchImplementation, input, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetchImplementation(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function requestTranscriptChunk(wav, identity, sourceStartMs, durationMs, options) {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
  const endpoint = endpointFor(identity.proxyUrl);
  const payloadDigest = `sha256:${createHash("sha256").update(wav).digest("hex")}`;
  const operationId = await createPreanalysisTranscriptOperationId(
    payloadDigest,
    identity.sourceId,
    identity.videoId,
    sourceStartMs,
    durationMs,
  );
  const headers = transcriptHeaders(identity, operationId, payloadDigest, sourceStartMs, durationMs, "audio/wav");
  headers["Content-Length"] = String(wav.byteLength);
  let staged;
  try {
    const response = await fetchBounded(
      fetchImplementation,
      endpoint,
      { method: "POST", headers, body: wav },
      options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
    );
    const payload = await boundedJson(response, response.ok ? MAX_RESPONSE_BYTES : MAX_ERROR_BYTES);
    if (!response.ok) {
      throw asrError(
        typeof payload?.error?.code === "string" ? payload.error.code : `ASR_STAGE_HTTP_${response.status}`,
        `Scheduled ASR media stage failed with HTTP ${response.status}.`,
      );
    }
    staged = parseBroadcastTranscriptMediaStagedResponse(payload, sourceStartMs, durationMs);
    if (response.status !== 202 || staged === null) {
      throw asrError("ASR_STAGE_RESPONSE_INVALID", "Scheduled ASR media stage response is invalid.");
    }
  } finally {
    wav.fill(0);
  }

  const resolveBody = JSON.stringify(createBroadcastTranscriptMediaResolveRequest(staged.mediaTicket));
  const resolveHeaders = transcriptHeaders(
    identity,
    operationId,
    payloadDigest,
    sourceStartMs,
    durationMs,
    BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE,
  );
  for (let attempt = 0; attempt < (options.maxResolveAttempts ?? MAX_RESOLVE_ATTEMPTS); attempt += 1) {
    const response = await fetchBounded(
      fetchImplementation,
      endpoint,
      { method: "POST", headers: resolveHeaders, body: resolveBody },
      options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
    );
    const payload = await boundedJson(response, response.ok ? MAX_RESPONSE_BYTES : MAX_ERROR_BYTES);
    if (response.ok) {
      if (
        response.headers.get(PREANALYSIS_CONTEXT_MODEL_ID_HEADER) !== BROADCAST_TRANSCRIPT_GROQ_MODEL_ID ||
        response.headers.get(PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER) !== BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION ||
        !validTranscriptResult(payload, sourceStartMs, durationMs)
      ) {
        throw asrError("ASR_RESULT_INVALID", "Scheduled ASR result receipt is invalid.");
      }
      return payload;
    }
    const code = typeof payload?.error?.code === "string" ? payload.error.code : `ASR_RESOLVE_HTTP_${response.status}`;
    if (![409, 429, 502, 503].includes(response.status) || attempt + 1 >= (options.maxResolveAttempts ?? MAX_RESOLVE_ATTEMPTS)) {
      throw asrError(code, `Scheduled ASR resolve failed with HTTP ${response.status}.`);
    }
    await sleep(retryDelayMs(response, attempt));
  }
  throw asrError("ASR_RESOLVE_EXHAUSTED", "Scheduled ASR resolve attempts were exhausted.");
}

function splitText(value, maximumLength) {
  const points = Array.from(value);
  if (points.length <= maximumLength) return [value];
  const parts = [];
  for (let offset = 0; offset < points.length; offset += maximumLength) {
    parts.push(points.slice(offset, offset + maximumLength).join("").trim());
  }
  return parts.filter(Boolean);
}

function captionEvents(chunks) {
  return chunks.flatMap((chunk) => {
    return chunk.result.segments.flatMap((segment) => {
      if (isConfidentBroadcastTranscriptNoSpeechSegment(segment)) return [];
      const parts = splitText(segment.textKo, MAX_EVENT_TEXT_LENGTH);
      const segmentDurationMs = segment.relativeEndMs - segment.relativeStartMs;
      return parts.map((text, index) => {
        const startMs =
          chunk.sourceStartMs +
          segment.relativeStartMs +
          Math.floor((segmentDurationMs * index) / parts.length);
        const endMs =
          chunk.sourceStartMs +
          segment.relativeStartMs +
          Math.floor((segmentDurationMs * (index + 1)) / parts.length);
        return { startMs, durationMs: endMs - startMs, text };
      });
    });
  });
}

export async function prepareScheduledAsrCaptionTrack(input, dependencies = {}) {
  const identity = checkpointIdentity(input);
  if (
    typeof input.watchUrl !== "string" ||
    input.watchUrl !== `https://www.youtube.com/watch?v=${identity.videoId}` ||
    typeof input.proxyUrl !== "string" ||
    typeof input.authorizationToken !== "string" ||
    input.authorizationToken.length < 24
  ) {
    throw asrError("ASR_CONFIGURATION_INVALID", "Scheduled ASR configuration is invalid.");
  }
  const checkpointPath = scheduledAsrCheckpointPath(input.catalogDir, identity.videoId);
  let checkpoint =
    (await readCheckpoint(checkpointPath, identity)) ?? {
      schemaVersion: SCHEDULED_ASR_CHECKPOINT_SCHEMA_VERSION,
      ...identity,
      modelId: BROADCAST_TRANSCRIPT_GROQ_MODEL_ID,
      modelRevision: BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION,
      chunks: [],
    };
  const completed = new Map(checkpoint.chunks.map((chunk) => [chunk.sourceStartMs, chunk]));
  const planned = [];
  for (let sourceStartMs = 0; sourceStartMs < identity.durationMs; sourceStartMs += SCHEDULED_ASR_CHUNK_DURATION_MS) {
    planned.push({
      sourceStartMs,
      durationMs: Math.min(SCHEDULED_ASR_CHUNK_DURATION_MS, identity.durationMs - sourceStartMs),
    });
  }
  const missing = planned.filter((chunk) => !completed.has(chunk.sourceStartMs));
  let media = null;
  try {
    if (missing.length > 0) {
      media = await (dependencies.prepareAudio ?? downloadAudio)(input, dependencies);
    }
    for (const chunk of missing) {
      const wav = await (dependencies.extractWav ?? extractChunkWav)(
        media.sourcePath,
        chunk.sourceStartMs,
        chunk.durationMs,
        dependencies,
      );
      let result;
      try {
        result = await (dependencies.requestChunk ?? requestTranscriptChunk)(
          wav,
          {
            ...identity,
            proxyUrl: input.proxyUrl,
            authorizationToken: input.authorizationToken,
          },
          chunk.sourceStartMs,
          chunk.durationMs,
          dependencies,
        );
      } finally {
        wav.fill(0);
      }
      completed.set(chunk.sourceStartMs, { ...chunk, result });
      checkpoint = {
        ...checkpoint,
        chunks: [...completed.values()].sort((left, right) => left.sourceStartMs - right.sourceStartMs),
      };
      await writeCheckpointAtomic(checkpointPath, checkpoint);
    }
  } finally {
    await media?.cleanup?.();
  }
  const chunks = planned.map((chunk) => completed.get(chunk.sourceStartMs));
  if (chunks.some((chunk) => chunk === undefined)) {
    throw asrError("ASR_CHECKPOINT_INCOMPLETE", "Scheduled ASR checkpoint is incomplete.");
  }
  return {
    checkpointPath,
    track: {
      videoId: identity.videoId,
      languageCode: "ko-asr",
      isAutoGenerated: true,
      events: captionEvents(chunks),
    },
  };
}

export async function removeScheduledAsrCheckpoint(checkpointPath) {
  await rm(checkpointPath, { force: true });
}
