import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import {
  CANDIDATE_PASS_B_MAX_DURATION_MS,
  CANDIDATE_PASS_B_MIN_DURATION_MS,
} from "../../src/analysis/candidatePassB.ts";
import {
  candidatePassBReceiptMatchesContext,
  isCandidatePassBContextPacket,
  isCandidatePassBVerificationReceipt,
} from "../../src/analysis/candidateFinalVerification.ts";
import {
  CHANNEL_PREANALYSIS_REVIEW_FRAME_MAX_BYTES,
  validateChannelPreanalysisReviewBundle,
} from "../../src/analysis/channelPreanalysisReviewBundle.ts";
import {
  channelPreanalysisSourceById,
} from "../../src/analysis/channelPreanalysisSources.ts";
import { YOUTUBE_VIDEO_ID_PATTERN } from "../../src/analysis/youtubeCaptionTrack.ts";
import {
  CHANNEL_PREANALYSIS_REVIEW_RUNNER_SCHEMA_VERSION,
} from "./channel-preanalysis-review-runner.mjs";

export const CHANNEL_PREANALYSIS_REVIEW_CHECKPOINT_SCHEMA_VERSION = "1.2.0";
export const CHANNEL_PREANALYSIS_REVIEW_CHECKPOINT_MAX_BYTES = 4 * 1024 * 1024;
export const CHANNEL_PREANALYSIS_REVIEW_CHECKPOINT_MAX_ENTRIES = 12;

const CHECKPOINT_DIRECTORY = ".review-checkpoints";
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SAFE_REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SAFE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const SAFE_RETRY_GRANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/u;
const MAX_SEMANTIC_ATTEMPT_ORDINAL = 2;
const ANALYZED_RESOLUTIONS = new Set([
  "publish",
  "terminal-excluded",
  "editor-review",
]);
const FORBIDDEN_RAW_AUDIO_KEYS = new Set([
  "audioBase64",
  "wavBase64",
  "pcmBase64",
  "rawAudio",
  "audioBytes",
  "wavBytes",
]);

export class ChannelPreanalysisReviewCheckpointError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ChannelPreanalysisReviewCheckpointError";
    this.code = code;
  }
}

function checkpointError(code, message, cause) {
  return new ChannelPreanalysisReviewCheckpointError(code, message, cause);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isBoundedText(value, maximum = 8_000) {
  return typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\p{Cc}\p{Cf}]/u.test(value);
}

function hasForbiddenRawAudio(value) {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!isRecord(current)) continue;
    for (const [key, child] of Object.entries(current)) {
      if (FORBIDDEN_RAW_AUDIO_KEYS.has(key)) return true;
      pending.push(child);
    }
  }
  return false;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function normalizeRunIdentity(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "sourceId",
      "channelId",
      "videoId",
      "contextArtifactDigest",
      "broadcastContextDigest",
      "artifactRevision",
      "pipelineRevision",
    ])
  ) {
    throw checkpointError("INVALID_IDENTITY", "The checkpoint run identity is invalid.");
  }
  const source = typeof value.sourceId === "string"
    ? channelPreanalysisSourceById(value.sourceId)
    : null;
  if (
    source === null ||
    value.channelId !== source.channelId ||
    typeof value.videoId !== "string" ||
    !YOUTUBE_VIDEO_ID_PATTERN.test(value.videoId) ||
    typeof value.contextArtifactDigest !== "string" ||
    !SHA256_PATTERN.test(value.contextArtifactDigest) ||
    typeof value.broadcastContextDigest !== "string" ||
    !SHA256_PATTERN.test(value.broadcastContextDigest) ||
    !Number.isSafeInteger(value.artifactRevision) ||
    value.artifactRevision < 1 ||
    typeof value.pipelineRevision !== "string" ||
    !SAFE_REVISION_PATTERN.test(value.pipelineRevision)
  ) {
    throw checkpointError("INVALID_IDENTITY", "The checkpoint run identity is invalid.");
  }
  return Object.freeze({
    sourceId: value.sourceId,
    channelId: value.channelId,
    videoId: value.videoId,
    contextArtifactDigest: value.contextArtifactDigest,
    broadcastContextDigest: value.broadcastContextDigest,
    artifactRevision: value.artifactRevision,
    pipelineRevision: value.pipelineRevision,
  });
}

function sameRunIdentity(left, right) {
  return left.sourceId === right.sourceId &&
    left.channelId === right.channelId &&
    left.videoId === right.videoId &&
    left.contextArtifactDigest === right.contextArtifactDigest &&
    left.broadcastContextDigest === right.broadcastContextDigest &&
    left.artifactRevision === right.artifactRevision &&
    left.pipelineRevision === right.pipelineRevision;
}

function validateCommonCheckpoint(value) {
  if (
    typeof value.checkpointKey !== "string" ||
    !SHA256_PATTERN.test(value.checkpointKey) ||
    typeof value.candidateId !== "string" ||
    !SAFE_ID_PATTERN.test(value.candidateId) ||
    !Number.isSafeInteger(value.sourceStartMs) ||
    !Number.isSafeInteger(value.sourceEndMs) ||
    value.sourceStartMs < 0 ||
    value.sourceEndMs <= value.sourceStartMs ||
    value.sourceEndMs - value.sourceStartMs < CANDIDATE_PASS_B_MIN_DURATION_MS ||
    value.sourceEndMs - value.sourceStartMs > CANDIDATE_PASS_B_MAX_DURATION_MS
  ) {
    throw checkpointError("INVALID_ENTRY", "A candidate checkpoint fence is invalid.");
  }
}

function validateAttemptIdentity(value) {
  if (
    !Number.isSafeInteger(value.attemptOrdinal) ||
    value.attemptOrdinal < 0 ||
    value.attemptOrdinal > MAX_SEMANTIC_ATTEMPT_ORDINAL ||
    (value.attemptOrdinal === 0
      ? value.retryGrantId !== null
      : typeof value.retryGrantId !== "string" ||
        !SAFE_RETRY_GRANT_ID_PATTERN.test(value.retryGrantId))
  ) {
    throw checkpointError(
      "INVALID_ENTRY",
      "A candidate semantic attempt identity is invalid.",
    );
  }
}

function validateEvidence(value, candidateId) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "candidateId",
      "cues",
      "overlay",
      "quality",
      "status",
      "fallbackReason",
    ]) ||
    value.candidateId !== candidateId ||
    !Array.isArray(value.cues) ||
    !isRecord(value.overlay) ||
    !isRecord(value.quality) ||
    !["grounded-transcript", "provisional-transcript", "fast-pass-fallback"].includes(
      String(value.status),
    )
  ) {
    throw checkpointError("INVALID_ENTRY", "Candidate evidence is invalid.");
  }
}

function validateInsight(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "eventSummaryKo",
      "reactionSummaryKo",
      "whyGoodClipKo",
      "uncertaintiesKo",
      "participantPresence",
      "participantSummaryKo",
      "identifiedParticipants",
      "clipDecision",
      "contextConsistency",
      "programMaterial",
    ]) ||
    !isBoundedText(value.eventSummaryKo) ||
    !isBoundedText(value.reactionSummaryKo) ||
    !isBoundedText(value.whyGoodClipKo) ||
    !isBoundedText(value.participantSummaryKo) ||
    !Array.isArray(value.uncertaintiesKo) ||
    !Array.isArray(value.identifiedParticipants) ||
    !["identified", "present-unidentified", "none-present", "insufficient-evidence"].includes(
      String(value.participantPresence),
    ) ||
    !["recommend", "reject", "uncertain"].includes(String(value.clipDecision)) ||
    !["consistent", "conflict", "insufficient"].includes(
      String(value.contextConsistency),
    ) ||
    !["streamer-event", "music-or-intermission", "routine-or-unclear"].includes(
      String(value.programMaterial),
    )
  ) {
    throw checkpointError("INVALID_ENTRY", "Candidate insight is invalid.");
  }
}

function decodeFrame(frame) {
  if (
    !isRecord(frame) ||
    !hasExactKeys(frame, [
      "timestampMs",
      "mimeType",
      "byteLength",
      "contentDigest",
      "extractionRevision",
      "dataBase64",
    ]) ||
    !Number.isSafeInteger(frame.timestampMs) ||
    frame.timestampMs < 0 ||
    frame.mimeType !== "image/jpeg" ||
    !Number.isSafeInteger(frame.byteLength) ||
    frame.byteLength < 4 ||
    frame.byteLength > CHANNEL_PREANALYSIS_REVIEW_FRAME_MAX_BYTES ||
    typeof frame.contentDigest !== "string" ||
    !SHA256_PATTERN.test(frame.contentDigest) ||
    typeof frame.dataBase64 !== "string" ||
    frame.dataBase64.length === 0 ||
    frame.dataBase64.length % 4 !== 0
  ) {
    throw checkpointError("INVALID_ENTRY", "A candidate review frame is invalid.");
  }
  const bytes = Buffer.from(frame.dataBase64, "base64");
  if (
    bytes.toString("base64") !== frame.dataBase64 ||
    bytes.byteLength !== frame.byteLength ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9 ||
    sha256(bytes) !== frame.contentDigest
  ) {
    throw checkpointError("INVALID_ENTRY", "A candidate frame receipt is invalid.");
  }
  return frame;
}

function expectedCheckpointKey(record) {
  return sha256(Buffer.from(JSON.stringify([
    CHANNEL_PREANALYSIS_REVIEW_RUNNER_SCHEMA_VERSION,
    record.candidateId,
    record.sourceStartMs,
    record.sourceEndMs,
    record.context,
  ])));
}

function validateAnalyzedCheckpoint(value) {
  if (
    !hasExactKeys(value, [
      "checkpointKey",
      "candidateId",
      "sourceStartMs",
      "sourceEndMs",
      "status",
      "attemptOrdinal",
      "retryGrantId",
      "resolution",
      "record",
    ]) ||
    !ANALYZED_RESOLUTIONS.has(value.resolution) ||
    !isRecord(value.record) ||
    !hasExactKeys(value.record, [
      "candidateId",
      "sourceStartMs",
      "sourceEndMs",
      "context",
      "evidence",
      "insight",
      "model",
      "verificationReceipt",
      "frames",
      "impactThumbnailFrameIndex",
    ])
  ) {
    throw checkpointError("INVALID_ENTRY", "An analyzed checkpoint is invalid.");
  }
  validateAttemptIdentity(value);
  const record = value.record;
  const receipt = record.verificationReceipt;
  if (
    record.candidateId !== value.candidateId ||
    record.sourceStartMs !== value.sourceStartMs ||
    record.sourceEndMs !== value.sourceEndMs ||
    value.checkpointKey !== expectedCheckpointKey(record) ||
    !isCandidatePassBContextPacket(record.context) ||
    !isCandidatePassBVerificationReceipt(receipt) ||
    !candidatePassBReceiptMatchesContext(receipt, record.context, {
      candidateId: value.candidateId,
      sourceStartMs: value.sourceStartMs,
      sourceEndMs: value.sourceEndMs,
      routingModelRevision: receipt?.routingModelRevision,
      refinementEvidenceProjectionFingerprint:
        receipt?.refinementEvidenceProjectionFingerprint,
      outputLanguage: receipt?.outputLanguage,
      castRosterId: receipt?.castRosterId,
    }) ||
    !isRecord(record.model) ||
    !hasExactKeys(record.model, ["id", "revision"]) ||
    record.model.id !== receipt.settlement.providerModelId ||
    record.model.revision !== receipt.settlement.providerModelRevision ||
    receipt.dispatchIntent.attemptOrdinal !== value.attemptOrdinal ||
    receipt.dispatchIntent.retryGrantId !== value.retryGrantId ||
    !Array.isArray(record.frames) ||
    record.frames.length !== 4 ||
    !Number.isSafeInteger(record.impactThumbnailFrameIndex) ||
    record.impactThumbnailFrameIndex < 0 ||
    record.impactThumbnailFrameIndex > 3
  ) {
    throw checkpointError("INVALID_ENTRY", "An analyzed checkpoint receipt is stale.");
  }
  validateEvidence(record.evidence, value.candidateId);
  validateInsight(record.insight);
  const frames = record.frames.map(decodeFrame);
  if (
    new Set(frames.map(({ timestampMs }) => timestampMs)).size !== 4 ||
    frames.some(({ timestampMs }) => timestampMs >= value.sourceEndMs - value.sourceStartMs) ||
    frames.some((frame, index) => {
      const receiptFrame = receipt.dispatchIntent.mediaReceipt.frames[index];
      return receiptFrame === undefined ||
        frame.timestampMs !== receiptFrame.timestampMs ||
        frame.mimeType !== receiptFrame.mimeType ||
        frame.byteLength !== receiptFrame.byteLength ||
        frame.contentDigest !== receiptFrame.contentDigest ||
        frame.extractionRevision !== receiptFrame.extractionRevision;
    }) ||
    frames[record.impactThumbnailFrameIndex].timestampMs !== receipt.thumbnailTimestampMs
  ) {
    throw checkpointError("INVALID_ENTRY", "Analyzed checkpoint frames are stale.");
  }
}

function normalizeCheckpointEntry(input) {
  let text;
  try {
    text = JSON.stringify(input);
  } catch (cause) {
    throw checkpointError("INVALID_ENTRY", "The checkpoint is not JSON-safe.", cause);
  }
  if (
    typeof text !== "string" ||
    Buffer.byteLength(text, "utf8") > CHANNEL_PREANALYSIS_REVIEW_CHECKPOINT_MAX_BYTES
  ) {
    throw checkpointError("INVALID_ENTRY", "The checkpoint is not bounded JSON.");
  }
  const value = JSON.parse(text);
  if (!isRecord(value) || hasForbiddenRawAudio(value)) {
    throw checkpointError("INVALID_ENTRY", "The checkpoint contains forbidden media data.");
  }
  validateCommonCheckpoint(value);
  if (value.status === "analyzed") {
    validateAnalyzedCheckpoint(value);
  } else if (value.status === "context-excluded") {
    if (
      !hasExactKeys(value, [
        "checkpointKey",
        "candidateId",
        "sourceStartMs",
        "sourceEndMs",
        "status",
        "reason",
      ]) ||
      value.reason !== "music-opening-ending-or-break"
    ) {
      throw checkpointError("INVALID_ENTRY", "A context exclusion checkpoint is invalid.");
    }
  } else if (value.status === "retryable") {
    if (
      !hasExactKeys(value, [
        "checkpointKey",
        "candidateId",
        "sourceStartMs",
        "sourceEndMs",
        "status",
        "errorCode",
        "attemptOrdinal",
        "retryGrantId",
        "lastRecord",
      ]) ||
      typeof value.errorCode !== "string" ||
      !SAFE_ERROR_CODE_PATTERN.test(value.errorCode) ||
      (value.lastRecord !== null && !isRecord(value.lastRecord))
    ) {
      throw checkpointError("INVALID_ENTRY", "A retryable checkpoint is invalid.");
    }
    validateAttemptIdentity(value);
    if (value.lastRecord !== null) {
      const previousAttempt = value.lastRecord.verificationReceipt
        ?.dispatchIntent;
      validateAnalyzedCheckpoint({
        checkpointKey: value.checkpointKey,
        candidateId: value.candidateId,
        sourceStartMs: value.sourceStartMs,
        sourceEndMs: value.sourceEndMs,
        status: "analyzed",
        attemptOrdinal: previousAttempt?.attemptOrdinal,
        retryGrantId: previousAttempt?.retryGrantId,
        resolution: "editor-review",
        record: value.lastRecord,
      });
      if (previousAttempt.attemptOrdinal >= value.attemptOrdinal) {
        throw checkpointError(
          "INVALID_ENTRY",
          "A retryable checkpoint must advance beyond its preserved result.",
        );
      }
    }
  } else {
    throw checkpointError("INVALID_ENTRY", "The checkpoint status is invalid.");
  }
  return value;
}

function normalizeSnapshot(value, expectedIdentity) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "runIdentity", "updatedAt", "entries"]) ||
    value.schemaVersion !== CHANNEL_PREANALYSIS_REVIEW_CHECKPOINT_SCHEMA_VERSION ||
    !isIsoDate(value.updatedAt) ||
    !Array.isArray(value.entries) ||
    value.entries.length > CHANNEL_PREANALYSIS_REVIEW_CHECKPOINT_MAX_ENTRIES
  ) {
    throw checkpointError("INVALID_FILE", "The review checkpoint file is invalid.");
  }
  const runIdentity = normalizeRunIdentity(value.runIdentity);
  if (!sameRunIdentity(runIdentity, expectedIdentity)) {
    throw checkpointError(
      "IDENTITY_MISMATCH",
      "The review checkpoint belongs to a different scheduled run.",
    );
  }
  const entries = value.entries.map(normalizeCheckpointEntry);
  if (new Set(entries.map(({ checkpointKey }) => checkpointKey)).size !== entries.length) {
    throw checkpointError("INVALID_FILE", "Checkpoint keys must be unique.");
  }
  if (new Set(entries.map(({ candidateId }) => candidateId)).size !== entries.length) {
    throw checkpointError("INVALID_FILE", "Checkpoint candidate IDs must be unique.");
  }
  return {
    schemaVersion: CHANNEL_PREANALYSIS_REVIEW_CHECKPOINT_SCHEMA_VERSION,
    runIdentity,
    updatedAt: value.updatedAt,
    entries,
  };
}

function resolveStorePaths(catalogDir, identity) {
  if (typeof catalogDir !== "string" || catalogDir.trim().length === 0) {
    throw checkpointError("INVALID_PATH", "A per-source catalog directory is required.");
  }
  const root = resolve(catalogDir);
  const directory = resolve(root, CHECKPOINT_DIRECTORY);
  const path = resolve(
    directory,
    `${identity.videoId}.review.v${String(identity.artifactRevision)}.${identity.pipelineRevision}.checkpoint.json`,
  );
  if (
    directory === root ||
    !directory.startsWith(`${root}${sep}`) ||
    !path.startsWith(`${directory}${sep}`)
  ) {
    throw checkpointError("INVALID_PATH", "The checkpoint path escapes its catalog directory.");
  }
  return { root, directory, path };
}

async function ensureSafeDirectory(root, directory) {
  const rootMetadata = await lstat(root).catch((error) => {
    throw checkpointError("INVALID_PATH", "The catalog directory is unavailable.", error);
  });
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw checkpointError("INVALID_PATH", "The catalog root must be a regular directory.");
  }
  await mkdir(directory, { recursive: true });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw checkpointError("INVALID_PATH", "The checkpoint directory is unsafe.");
  }
}

async function readSnapshot(path, identity) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    throw error;
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size <= 0 ||
    metadata.size > CHANNEL_PREANALYSIS_REVIEW_CHECKPOINT_MAX_BYTES
  ) {
    throw checkpointError("INVALID_FILE", "The review checkpoint file is unsafe or too large.");
  }
  const bytes = await readFile(path);
  if (bytes.byteLength !== metadata.size) {
    throw checkpointError("INVALID_FILE", "The review checkpoint changed while being read.");
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw checkpointError("INVALID_FILE", "The review checkpoint is not UTF-8.", cause);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw checkpointError("INVALID_FILE", "The review checkpoint is not valid JSON.", cause);
  }
  return normalizeSnapshot(value, identity);
}

function serializeSnapshot(snapshot) {
  const text = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (Buffer.byteLength(text, "utf8") > CHANNEL_PREANALYSIS_REVIEW_CHECKPOINT_MAX_BYTES) {
    throw checkpointError("FILE_TOO_LARGE", "The review checkpoint exceeds 4 MiB.");
  }
  return text;
}

async function writeSnapshotAtomic(path, snapshot, identity) {
  const text = serializeSnapshot(snapshot);
  const temporaryPath = join(
    dirname(path),
    `.${path.split(/[\\/]/u).at(-1)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  const readback = await readSnapshot(path, identity);
  if (readback === null || JSON.stringify(readback) !== JSON.stringify(snapshot)) {
    throw checkpointError(
      "READBACK_MISMATCH",
      "The atomic checkpoint readback differs from the committed data.",
    );
  }
}

function projectSnapshot(snapshot) {
  const previousCandidateResults = snapshot?.entries.filter(
    ({ status }) => status === "analyzed" || status === "context-excluded",
  ) ?? [];
  const retryableDiagnostics = snapshot?.entries.filter(
    ({ status }) => status === "retryable",
  ) ?? [];
  return Object.freeze({
    previousCandidateResults: Object.freeze(previousCandidateResults),
    retryableDiagnostics: Object.freeze(retryableDiagnostics),
    entryCount: previousCandidateResults.length + retryableDiagnostics.length,
  });
}

function assertPublisherSuccess(publication, identity) {
  if (
    !isRecord(publication) ||
    publication.state !== "review-ready" ||
    !isRecord(publication.video) ||
    publication.video.videoId !== identity.videoId ||
    publication.video.state !== "review-ready" ||
    publication.video.revision !== identity.artifactRevision
  ) {
    throw checkpointError(
      "PUBLICATION_NOT_CONFIRMED",
      "Checkpoint removal requires a matching successful review publication.",
    );
  }
  let review;
  try {
    review = validateChannelPreanalysisReviewBundle(publication.reviewBundle);
  } catch (cause) {
    throw checkpointError(
      "PUBLICATION_NOT_CONFIRMED",
      "The publisher result has no valid review bundle.",
      cause,
    );
  }
  if (
    review.source.sourceId !== identity.sourceId ||
    review.source.channelId !== identity.channelId ||
    review.source.videoId !== identity.videoId ||
    review.broadcastContextDigest !== identity.broadcastContextDigest ||
    review.artifactRevision !== identity.artifactRevision ||
    review.certificate.pipelineRevision !== identity.pipelineRevision
  ) {
    throw checkpointError(
      "PUBLICATION_NOT_CONFIRMED",
      "The published review does not match the checkpoint run identity.",
    );
  }
}

/**
 * Durable candidate checkpoints for one exact scheduled review attempt.
 * Pass `onCandidateCheckpoint` directly to runChannelPreanalysisReview.
 */
export function createChannelPreanalysisReviewCheckpointStore(options) {
  if (!isRecord(options)) {
    throw checkpointError("INVALID_INPUT", "Checkpoint store options are required.");
  }
  const identity = normalizeRunIdentity(options.runIdentity);
  const paths = resolveStorePaths(options.catalogDir, identity);
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  if (typeof nowIso !== "function") {
    throw checkpointError("INVALID_INPUT", "nowIso must be a function.");
  }
  let queue = Promise.resolve();
  let finalized = false;
  const enqueue = (operation) => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  };

  const load = () => enqueue(async () => {
    await ensureSafeDirectory(paths.root, paths.directory);
    return projectSnapshot(await readSnapshot(paths.path, identity));
  });

  const onCandidateCheckpoint = (checkpoint) => enqueue(async () => {
    if (finalized) {
      throw checkpointError("STORE_FINALIZED", "A finalized checkpoint cannot be recreated.");
    }
    const entry = normalizeCheckpointEntry(checkpoint);
    await ensureSafeDirectory(paths.root, paths.directory);
    const current = await readSnapshot(paths.path, identity);
    const entries = current === null ? [] : [...current.entries];
    const index = entries.findIndex(
      ({ candidateId }) => candidateId === entry.candidateId,
    );
    if (index < 0) {
      if (entries.length >= CHANNEL_PREANALYSIS_REVIEW_CHECKPOINT_MAX_ENTRIES) {
        throw checkpointError("ENTRY_LIMIT", "A review run cannot checkpoint more than 12 candidates.");
      }
      entries.push(entry);
    } else {
      entries[index] = entry;
    }
    const updatedAt = nowIso();
    if (!isIsoDate(updatedAt)) {
      throw checkpointError("INVALID_INPUT", "nowIso returned an invalid timestamp.");
    }
    const snapshot = normalizeSnapshot({
      schemaVersion: CHANNEL_PREANALYSIS_REVIEW_CHECKPOINT_SCHEMA_VERSION,
      runIdentity: identity,
      updatedAt,
      entries,
    }, identity);
    await writeSnapshotAtomic(paths.path, snapshot, identity);
    return projectSnapshot(snapshot);
  });

  const finalizeAfterPublisherSuccess = (publication) => enqueue(async () => {
    assertPublisherSuccess(publication, identity);
    await ensureSafeDirectory(paths.root, paths.directory);
    let metadata;
    try {
      metadata = await lstat(paths.path);
    } catch (error) {
      if (!isRecord(error) || error.code !== "ENOENT") throw error;
    }
    if (metadata !== undefined) {
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw checkpointError("INVALID_FILE", "The review checkpoint path is unsafe.");
      }
      await rm(paths.path);
    }
    finalized = true;
  });

  return Object.freeze({
    checkpointPath: paths.path,
    runIdentity: identity,
    load,
    onCandidateCheckpoint,
    finalizeAfterPublisherSuccess,
  });
}
