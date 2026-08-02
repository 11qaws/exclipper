import { createHash } from "node:crypto";

import { selectAudioReactionHighlights } from "../../src/media/localAudioReactionAnalysisCore.ts";
import { captionTextForRange } from "../../src/analysis/captionCandidateEvidence.ts";
import {
  createCaptionDiscoveredLeadRefinementPlan,
  materializeRefinedDiscoveredLeadEvidence,
} from "../../src/analysis/discoveredLeadRefinement.ts";
import {
  createYouTubeCaptionRefinementTranscripts,
} from "../../src/analysis/youtubeCaptionTrack.ts";
import {
  validateChannelPreanalysisBundle,
  verifyChannelPreanalysisTranscriptDigest,
} from "../../src/analysis/channelPreanalysisBundle.ts";
import {
  createBroadcastParticipantGrounding,
  isBroadcastParticipantGroundingForInput,
} from "../../src/analysis/broadcastParticipantGrounding.ts";
import {
  candidatePassBCastReferenceForName,
} from "../../src/analysis/participantRoster.ts";
import {
  CHANNEL_PREANALYSIS_VISUAL_COVERAGE_MAX_SEEDS,
  validateChannelPreanalysisVisualCoverageReceipt,
} from "../../src/analysis/channelPreanalysisVisualCoverage.ts";
import {
  candidatePassBReceiptMatchesContext,
  createCandidatePassBContextPacket,
  finalizeFullyVerifiedCandidates,
  isCandidatePassBVerificationReceipt,
} from "../../src/analysis/candidateFinalVerification.ts";
import {
  CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
} from "../../src/analysis/candidatePassBWorkerProtocol.ts";
import {
  CHANNEL_PREANALYSIS_REVIEW_BUNDLE_SCHEMA_VERSION,
  CHANNEL_PREANALYSIS_REVIEW_CERTIFICATE_SCHEMA_VERSION,
  CHANNEL_PREANALYSIS_PARTICIPANT_PROVENANCE_SCHEMA_VERSION,
  CHANNEL_PREANALYSIS_REVIEW_FRAME_MAX_BYTES,
  channelPreanalysisReviewBundleArtifactId,
  createChannelPreanalysisReviewContentDigests,
  validateChannelPreanalysisReviewBundle,
  verifyChannelPreanalysisReviewBundleIntegrity,
} from "../../src/analysis/channelPreanalysisReviewBundle.ts";

export const CHANNEL_PREANALYSIS_REVIEW_RUNNER_SCHEMA_VERSION = "4.1.0";
export const CHANNEL_PREANALYSIS_REVIEW_MAX_CANDIDATES = 12;
export const CHANNEL_PREANALYSIS_REVIEW_DEFAULT_CONCURRENCY = 2;
export const CHANNEL_PREANALYSIS_REVIEW_MAX_SEMANTIC_RECOVERIES = 2;

const SCHEDULED_VISUAL_IDENTITY_REVISION =
  "scheduled-review-candidate-visual-identity-v1";
const SCHEDULED_VOICE_IDENTITY_REVISION =
  "scheduled-review-candidate-audio-identity-v1";

const MIN_CANDIDATE_DURATION_MS = 30_000;
const MAX_CANDIDATE_DURATION_MS = 60_000;
const DEFAULT_CANDIDATE_DURATION_MS = 45_000;
const MAX_CANDIDATE_CONTEXT_TEXT_LENGTH = 4_000;
const SOURCE_SELECTION_CYCLE = ["semantic", "semantic", "audio", "visual"];
// Only coherent, context-consistent negative judgements may close a candidate.
// Abstentions, contradictions and unclear material must be retried.
const TERMINAL_EXCLUSION_GAPS = new Set([
  "detail-not-recommended",
  "program-material-excluded",
]);
const CHECKPOINT_RESOLUTIONS = new Set([
  "publish",
  "terminal-excluded",
  "editor-review",
]);
const FRESH_SEMANTIC_ATTEMPT_ERROR_CODES = new Set([
  "RESPONSE_INVALID",
  "RESPONSE_RECEIPT_INVALID",
  "RECEIPT_INVALID",
]);

export class ChannelPreanalysisReviewRunnerError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ChannelPreanalysisReviewRunnerError";
    this.code = code;
  }
}

function runnerError(code, message, cause) {
  return new ChannelPreanalysisReviewRunnerError(code, message, cause);
}

function boundedText(value, fallback) {
  if (typeof value !== "string") return fallback;
  const text = value.normalize("NFKC").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/gu, " ").trim();
  return text.length === 0 ? fallback : Array.from(text).slice(0, 4_000).join("");
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function candidateCheckpointKey(candidate, context) {
  return `sha256:${sha256Text(JSON.stringify([
    CHANNEL_PREANALYSIS_REVIEW_RUNNER_SCHEMA_VERSION,
    candidate.candidateId,
    candidate.startMs,
    candidate.endMs,
    context,
  ]))}`;
}

function semanticAttemptIdentity(checkpointKey, attemptOrdinal) {
  if (
    !Number.isSafeInteger(attemptOrdinal) ||
    attemptOrdinal < 0 ||
    attemptOrdinal > CHANNEL_PREANALYSIS_REVIEW_MAX_SEMANTIC_RECOVERIES
  ) {
    throw runnerError(
      "SEMANTIC_ATTEMPT_INVALID",
      "Candidate semantic attempt is outside the bounded recovery policy.",
    );
  }
  return {
    attemptOrdinal,
    retryGrantId: attemptOrdinal === 0
      ? null
      : `scheduled-semantic-${attemptOrdinal}-${sha256Text(JSON.stringify([
          CHANNEL_PREANALYSIS_REVIEW_RUNNER_SCHEMA_VERSION,
          checkpointKey,
          attemptOrdinal,
        ])).slice(0, 40)}`,
  };
}

function gapErrorCode(gap) {
  return `CANDIDATE_${gap.replaceAll("-", "_").toUpperCase()}`;
}

function causeErrorCode(cause, fallback) {
  return typeof cause?.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(cause.code)
    ? cause.code
    : fallback;
}

function normalizeRange(startMs, endMs, sourceDurationMs) {
  const rawStart = Math.max(0, Math.min(sourceDurationMs - 1, Math.round(startMs)));
  const rawEnd = Math.max(rawStart + 1, Math.min(sourceDurationMs, Math.round(endMs)));
  const rawDuration = rawEnd - rawStart;
  const durationMs = Math.min(
    MAX_CANDIDATE_DURATION_MS,
    Math.max(MIN_CANDIDATE_DURATION_MS, rawDuration < MIN_CANDIDATE_DURATION_MS
      ? DEFAULT_CANDIDATE_DURATION_MS
      : rawDuration),
  );
  const centerMs = (rawStart + rawEnd) / 2;
  let start = Math.max(0, Math.round(centerMs - durationMs / 2));
  let end = Math.min(sourceDurationMs, start + durationMs);
  start = Math.max(0, end - durationMs);
  if (end - start < MIN_CANDIDATE_DURATION_MS) {
    throw runnerError("SOURCE_TOO_SHORT", "A review candidate requires at least 30 seconds.");
  }
  return { startMs: start, endMs: end, focusMs: Math.round(centerMs) };
}

function captionText(bundle, startMs, endMs) {
  return captionTextForRange(
    bundle.captionTrack.events,
    startMs,
    endMs,
    MAX_CANDIDATE_CONTEXT_TEXT_LENGTH,
  );
}

function semanticTopic(bundle, startMs, endMs) {
  const summaries = bundle.broadcastContext.semanticChapters
    .filter((chapter) => chapter.startMs < endMs && chapter.endMs > startMs)
    .map(({ titleKo, summaryKo }) => `${titleKo}: ${summaryKo}`);
  return boundedText(summaries.join(" "), "해당 방송 구간의 주제 맥락입니다.");
}

function normalizeVisualSeeds(seeds, bundle) {
  if (
    !Array.isArray(seeds) ||
    seeds.length > CHANNEL_PREANALYSIS_VISUAL_COVERAGE_MAX_SEEDS
  ) {
    throw runnerError(
      "VISUAL_COVERAGE_INCOMPLETE",
      "The visual candidate reservoir is invalid.",
    );
  }
  const ids = new Set();
  return seeds.map((seed) => {
    if (
      seed === null ||
      typeof seed !== "object" ||
      typeof seed.seedId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(seed.seedId) ||
      ids.has(seed.seedId) ||
      !Number.isSafeInteger(seed.startMs) ||
      !Number.isSafeInteger(seed.endMs) ||
      !Number.isSafeInteger(seed.focusMs) ||
      seed.startMs < 0 ||
      seed.endMs > bundle.durationMs ||
      seed.endMs <= seed.startMs ||
      seed.focusMs < seed.startMs ||
      seed.focusMs >= seed.endMs ||
      typeof seed.score !== "number" ||
      !Number.isFinite(seed.score) ||
      seed.score < 0 ||
      seed.score > 1
    ) {
      throw runnerError(
        "VISUAL_COVERAGE_INCOMPLETE",
        "A visual candidate seed is not fenced to the source timeline.",
      );
    }
    ids.add(seed.seedId);
    return {
      originIds: [seed.seedId],
      sourceKinds: ["visual"],
      ...normalizeRange(seed.startMs, seed.endMs, bundle.durationMs),
      score: seed.score,
      eventKo: boundedText(seed.eventKo, "화면에서 사건 변화가 감지된 구간"),
      whyKo: boundedText(
        seed.whyKo,
        "소리 크기와 무관한 화면 사건이나 스트리머 반응을 확인합니다.",
      ),
      evidenceKo: boundedText(seed.evidenceKo, "분산 화면 변화 신호"),
      category: "uncertain",
      contextDecision: "review",
    };
  });
}

function localizeSemanticLead(bundle, lead) {
  const plan = createCaptionDiscoveredLeadRefinementPlan(
    [lead],
    { preserveInputOrder: true },
  );
  const transcripts = createYouTubeCaptionRefinementTranscripts(
    bundle.captionTrack,
    plan,
  );
  const refined = materializeRefinedDiscoveredLeadEvidence(
    lead,
    transcripts,
    bundle.durationMs,
  );
  if (refined === null) {
    return normalizeRange(lead.startMs, lead.endMs, bundle.durationMs);
  }
  return {
    startMs: refined.range.startMs,
    endMs: refined.range.endMs,
    focusMs: refined.range.peakMs,
  };
}

function createRawCandidates(bundle, audioFeatures, visualSeeds) {
  const audio = selectAudioReactionHighlights(
    audioFeatures.windows,
    bundle.durationMs,
    {
      maxCandidates: CHANNEL_PREANALYSIS_REVIEW_MAX_CANDIDATES,
      plannedWindowCount: audioFeatures.plannedWindowCount,
    },
  ).candidates.map((candidate) => ({
    originIds: [candidate.id],
    sourceKinds: ["audio"],
    ...normalizeRange(candidate.startMs, candidate.endMs, bundle.durationMs),
    score: candidate.score,
    eventKo: candidate.reason,
    whyKo: "방송 오디오에서 주변보다 뚜렷한 스트리머 반응 신호가 확인됐습니다.",
    evidenceKo: candidate.reason,
    category: "uncertain",
    contextDecision: "review",
  }));
  const semantic = bundle.broadcastContext.discoveredLeads.map((lead) => ({
    originIds: [lead.leadId],
    sourceKinds: ["semantic"],
    ...localizeSemanticLead(bundle, lead),
    score: 0.55 + lead.confidence * 0.45,
    eventKo: lead.eventSummaryKo,
    whyKo: lead.whyThisMomentKo,
    evidenceKo: lead.evidenceCueKo,
    category: lead.category,
    contextDecision: "select",
  }));
  return [...audio, ...semantic, ...normalizeVisualSeeds(visualSeeds, bundle)];
}

function candidatesOverlap(left, right) {
  const overlap = Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
  const shorter = Math.min(left.endMs - left.startMs, right.endMs - right.startMs);
  return overlap / shorter >= 0.5 || Math.abs(left.focusMs - right.focusMs) <= 8_000;
}

function candidateOrder(left, right) {
  return right.score - left.score || left.startMs - right.startMs ||
    left.originIds.join("\0").localeCompare(right.originIds.join("\0"));
}

function sourceBalancedSelection(candidates) {
  const queues = Object.fromEntries(SOURCE_SELECTION_CYCLE.map((kind) => [
    kind,
    candidates.filter(({ sourceKinds }) => sourceKinds.includes(kind)).sort(candidateOrder),
  ]));
  const selected = [];
  const selectedCandidates = new Set();

  while (selected.length < CHANNEL_PREANALYSIS_REVIEW_MAX_CANDIDATES) {
    let addedThisCycle = 0;
    for (const kind of SOURCE_SELECTION_CYCLE) {
      const queue = queues[kind];
      let candidate;
      while ((candidate = queue.shift()) !== undefined && selectedCandidates.has(candidate)) {
        // A fused multi-source candidate can occur in more than one queue.
      }
      if (candidate === undefined) continue;
      selected.push(candidate);
      selectedCandidates.add(candidate);
      addedThisCycle += 1;
      if (selected.length >= CHANNEL_PREANALYSIS_REVIEW_MAX_CANDIDATES) break;
    }
    if (addedThisCycle === 0) break;
  }
  return selected;
}

function fuseCandidates(rawCandidates) {
  const ranked = [...rawCandidates].sort(
    (left, right) =>
      Number(right.sourceKinds.includes("semantic")) -
        Number(left.sourceKinds.includes("semantic")) || candidateOrder(left, right),
  );
  const fused = [];
  for (const candidate of ranked) {
    const duplicate = fused.find((current) =>
      !(current.sourceKinds.includes("semantic") && candidate.sourceKinds.includes("semantic")) &&
      candidatesOverlap(current, candidate),
    );
    if (duplicate === undefined) {
      fused.push({ ...candidate });
      continue;
    }
    const duplicateIsSemantic = duplicate.sourceKinds.includes("semantic");
    const candidateIsSemantic = candidate.sourceKinds.includes("semantic");
    duplicate.originIds = [...new Set([...duplicate.originIds, ...candidate.originIds])].sort();
    duplicate.sourceKinds = [...new Set([...duplicate.sourceKinds, ...candidate.sourceKinds])].sort();
    duplicate.score = Math.min(1, 1 - (1 - duplicate.score) * (1 - candidate.score));
    if (candidateIsSemantic && !duplicateIsSemantic) {
      duplicate.startMs = candidate.startMs;
      duplicate.endMs = candidate.endMs;
      duplicate.focusMs = candidate.focusMs;
      duplicate.contextDecision = "select";
      duplicate.category = candidate.category;
      duplicate.eventKo = candidate.eventKo;
      duplicate.whyKo = candidate.whyKo;
      duplicate.evidenceKo = candidate.evidenceKo;
    }
  }
  return sourceBalancedSelection(fused)
    .sort(candidateOrder)
    .map((candidate) => ({
      ...candidate,
      candidateId: `scheduled-${sha256Text(JSON.stringify([
        candidate.startMs,
        candidate.endMs,
        candidate.originIds,
      ])).slice(0, 20)}`,
    }));
}

function annotationForCandidate(bundle, candidate) {
  const originIds = new Set(candidate.originIds);
  return bundle.broadcastContext.annotations.find(({ candidateId }) => originIds.has(candidateId)) ?? null;
}

function candidateContext(bundle, candidate, annotation) {
  const transcriptKo = captionText(bundle, candidate.startMs, candidate.endMs) || "이 구간에는 확인 가능한 자막 대사가 없습니다.";
  const context = createCandidatePassBContextPacket({
    transcriptSource: "youtube-caption",
    transcriptKo,
    beforeContextKo: captionText(bundle, Math.max(0, candidate.startMs - 60_000), candidate.startMs) || "직전 자막 맥락이 없습니다.",
    afterContextKo: captionText(bundle, candidate.endMs, Math.min(bundle.durationMs, candidate.endMs + 60_000)) || "직후 자막 맥락이 없습니다.",
    broadcastSummaryKo: bundle.broadcastContext.broadcastSummaryKo,
    topicContextKo: semanticTopic(bundle, candidate.startMs, candidate.endMs),
    fastEvidenceKo: boundedText(candidate.evidenceKo, "빠른 탐색 근거가 있습니다."),
    contextDecision: annotation?.clipDecision ?? candidate.contextDecision,
    contextCategory: annotation?.category ?? candidate.category,
    contextVerdictKo: boundedText(annotation?.whyThisMomentKo ?? candidate.whyKo, "전체 방송 맥락에서 검토할 구간입니다."),
    chatReactionKo: null,
  });
  if (context === null) throw runnerError("CONTEXT_PACKET_INVALID", "Candidate context could not be bounded.");
  return context;
}

function candidateEvidence(bundle, candidate) {
  const events = bundle.captionTrack.events.filter(
    (event) => event.startMs < candidate.endMs && event.startMs + event.durationMs > candidate.startMs,
  );
  const cues = [...events]
    .sort((left, right) => {
      const distance = (event) => {
        const endMs = event.startMs + event.durationMs;
        return candidate.focusMs < event.startMs
          ? event.startMs - candidate.focusMs
          : candidate.focusMs > endMs
            ? candidate.focusMs - endMs
            : 0;
      };
      return distance(left) - distance(right) || left.startMs - right.startMs ||
        left.text.localeCompare(right.text);
    })
    .slice(0, 3)
    .sort((left, right) => left.startMs - right.startMs)
    .map((event) => ({
    phase: event.startMs + event.durationMs < candidate.focusMs - 4_000
      ? "before-peak"
      : event.startMs > candidate.focusMs + 4_000
        ? "after-peak"
        : "near-peak",
    absoluteStartMs: event.startMs,
    absoluteEndMs: Math.min(candidate.endMs, event.startMs + event.durationMs),
    text: event.text.slice(0, 120),
    confidence: null,
  }));
  return {
    candidateId: candidate.candidateId,
    cues,
    overlay: {
      event: boundedText(candidate.eventKo, "검토할 방송 사건"),
      why: boundedText(candidate.whyKo, "전체 맥락과 함께 확인할 필요가 있습니다."),
      reviewHint: "대표 화면과 대사, 스트리머 반응을 함께 확인하세요.",
      basisLabel: cues.length > 0
        ? "AI 대사 단서 · 재생 확인 필요"
        : "명확한 대사 없음 · 빠른 근거 유지",
    },
    quality: {
      receivedChunkCount: events.length,
      mappedChunkCount: events.length,
      usableChunkCount: events.length,
      discardedChunkCount: 0,
      meanConfidence: null,
    },
    status: cues.length > 0 ? "grounded-transcript" : "fast-pass-fallback",
    fallbackReason: cues.length > 0 ? null : "empty-transcript",
  };
}

function normalizeFrame(frame, candidateDurationMs) {
  const timestampMs = frame.timestampMs ?? frame.relativeTimestampMs;
  const digest = frame.contentDigest ?? (typeof frame.sha256 === "string" ? `sha256:${frame.sha256}` : null);
  if (
    !Number.isSafeInteger(timestampMs) || timestampMs < 0 || timestampMs >= candidateDurationMs ||
    frame.mimeType !== "image/jpeg" || typeof frame.dataBase64 !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(digest ?? "") ||
    frame.extractionRevision !== CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION
  ) {
    throw runnerError("FRAME_BUNDLE_INCOMPLETE", "Candidate frame metadata is incomplete.");
  }
  const bytes = Buffer.from(frame.dataBase64, "base64");
  if (
    bytes.length === 0 || bytes.length > CHANNEL_PREANALYSIS_REVIEW_FRAME_MAX_BYTES ||
    bytes.toString("base64") !== frame.dataBase64 || frame.byteLength !== bytes.length ||
    bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9 ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== digest
  ) {
    throw runnerError("FRAME_BUNDLE_INCOMPLETE", "Candidate JPEG bytes do not match their receipt.");
  }
  return {
    timestampMs,
    mimeType: "image/jpeg",
    byteLength: bytes.length,
    contentDigest: digest,
    extractionRevision: CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
    dataBase64: frame.dataBase64,
  };
}

function normalizeMedia(media, candidate) {
  if (media === null || typeof media !== "object" || !Array.isArray(media.frames) || media.frames.length !== 4 || media.audio === undefined) {
    throw runnerError("FRAME_BUNDLE_INCOMPLETE", "Four complete frames and candidate audio are required before AI analysis.");
  }
  const durationMs = candidate.endMs - candidate.startMs;
  const frames = media.frames.map((frame) => normalizeFrame(frame, durationMs)).sort((left, right) => left.timestampMs - right.timestampMs);
  if (new Set(frames.map(({ timestampMs }) => timestampMs)).size !== 4) {
    throw runnerError("FRAME_BUNDLE_INCOMPLETE", "Candidate frame timestamps must be distinct.");
  }
  return { frames, audio: media.audio };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

function validateInputs(input) {
  const bundle = validateChannelPreanalysisBundle(input.bundle);
  if ((bundle.state !== "context-ready" && bundle.state !== "published") || bundle.broadcastContext === null) {
    throw runnerError("CONTEXT_NOT_READY", "Scheduled review requires a context-ready bundle.");
  }
  if (
    !input.audioFeatures || input.audioFeatures.sourceDurationMs !== bundle.durationMs ||
    input.audioFeatures.coverageComplete !== true || !Array.isArray(input.audioFeatures.windows) ||
    input.audioFeatures.plannedWindowCount !== input.audioFeatures.analyzedWindowCount
  ) {
    throw runnerError("AUDIO_FEATURES_INCOMPLETE", "Audio fast-pass windows must cover the complete source.");
  }
  let visualCoverage;
  try {
    visualCoverage = validateChannelPreanalysisVisualCoverageReceipt(
      input.visualCoverage,
      { sourceDurationMs: bundle.durationMs, videoId: bundle.videoId },
    );
  } catch (cause) {
    throw runnerError(
      "VISUAL_COVERAGE_INCOMPLETE",
      "Distributed visual coverage must be complete before review publication.",
      cause,
    );
  }
  if (
    !Array.isArray(input.visualCandidateSeeds) ||
    input.visualCandidateSeeds.length !== visualCoverage.visualSeedCount ||
    JSON.stringify(
      input.visualCandidateSeeds.map((seed) => seed?.focusMs),
    ) !== JSON.stringify(visualCoverage.visualSeedTimestampsMs)
  ) {
    throw runnerError(
      "VISUAL_COVERAGE_INCOMPLETE",
      "The visual coverage receipt does not match its candidate reservoir.",
    );
  }
  if (!isBroadcastParticipantGroundingForInput(input.participantGrounding, {
    sourceDurationMs: bundle.durationMs,
    castRosterId: input.participantGrounding?.castRosterId ?? null,
    chapters: bundle.chapters,
  })) {
    throw runnerError("PARTICIPANT_GROUNDING_INVALID", "Participant grounding is not sealed for this source map.");
  }
  if (!Number.isSafeInteger(input.artifactRevision) || input.artifactRevision < 1) {
    throw runnerError("INVALID_REVISION", "artifactRevision must be a positive integer.");
  }
  if (typeof input.extractCandidateMedia !== "function" || typeof input.analyzeCandidate !== "function") {
    throw runnerError("INVALID_ADAPTER", "Media extraction and candidate AI callbacks are required.");
  }
  if (typeof input.createdAt !== "string" || Number.isNaN(Date.parse(input.createdAt))) {
    throw runnerError("INVALID_CREATED_AT", "createdAt must be an ISO timestamp.");
  }
  if (typeof input.pipelineRevision !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(input.pipelineRevision)) {
    throw runnerError("INVALID_PIPELINE_REVISION", "pipelineRevision is invalid.");
  }
  const concurrency = input.candidateConcurrency ?? CHANNEL_PREANALYSIS_REVIEW_DEFAULT_CONCURRENCY;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw runnerError("INVALID_CONCURRENCY", "candidateConcurrency must be between 1 and 4.");
  }
  return { bundle, concurrency, visualCoverage };
}

function priorCheckpointByKey(checkpoints) {
  const map = new Map();
  for (const checkpoint of checkpoints ?? []) {
    if (
      checkpoint?.status === "analyzed" ||
      checkpoint?.status === "retryable"
    ) {
      map.set(checkpoint.checkpointKey, checkpoint);
    }
  }
  return map;
}

function candidateRecordGap(record, score, outputLanguage, castRosterId) {
  const candidateId = record.candidateId;
  const verification = finalizeFullyVerifiedCandidates({
    candidates: [{
      id: candidateId,
      startMs: record.sourceStartMs,
      endMs: record.sourceEndMs,
      peakMs:
        record.sourceStartMs + record.verificationReceipt.thumbnailTimestampMs,
      score,
    }],
    contextByCandidateId: { [candidateId]: record.context },
    insightByCandidateId: { [candidateId]: record.insight },
    receiptByCandidateId: { [candidateId]: record.verificationReceipt },
    completeEvidenceCandidateIds: new Set([candidateId]),
    refinementEvidenceProjectionFingerprint:
      record.verificationReceipt.refinementEvidenceProjectionFingerprint,
    outputLanguage,
    castRosterId,
  });
  return verification.gapByCandidateId[candidateId] ?? null;
}

function checkpointResolutionForGap(gap, attemptOrdinal) {
  if (gap === null) return "publish";
  if (TERMINAL_EXCLUSION_GAPS.has(gap)) return "terminal-excluded";
  return attemptOrdinal >= CHANNEL_PREANALYSIS_REVIEW_MAX_SEMANTIC_RECOVERIES
    ? "editor-review"
    : null;
}

function audioDigestFromMedia(audio) {
  if (typeof audio?.contentDigest === "string") return audio.contentDigest;
  if (audio?.bytes instanceof Uint8Array) {
    return `sha256:${createHash("sha256").update(audio.bytes).digest("hex")}`;
  }
  return null;
}

function resumeMedia(extracted, priorRecord) {
  if (priorRecord === null) return extracted;
  const priorMedia = priorRecord.verificationReceipt.dispatchIntent.mediaReceipt;
  const extractedAudioDigest = audioDigestFromMedia(extracted.audio);
  const framesMatch = extracted.frames.every((frame, index) => {
    const priorFrame = priorRecord.frames[index];
    return priorFrame !== undefined &&
      frame.timestampMs === priorFrame.timestampMs &&
      frame.byteLength === priorFrame.byteLength &&
      frame.contentDigest === priorFrame.contentDigest &&
      frame.extractionRevision === priorFrame.extractionRevision;
  });
  if (
    !framesMatch ||
    extractedAudioDigest === null ||
    extractedAudioDigest !== priorMedia.audio.wavContentDigest
  ) {
    throw runnerError(
      "MEDIA_RESUME_DIGEST_MISMATCH",
      "Re-extracted candidate media differs from the durable semantic attempt.",
    );
  }
  return {
    frames: priorRecord.frames,
    audio: extracted.audio,
  };
}

function createCandidateRecord(
  candidate,
  context,
  evidence,
  media,
  analysis,
  attempt,
  outputLanguage,
  castRosterId,
) {
  const receipt = analysis?.verificationReceipt;
  if (
    !isCandidatePassBVerificationReceipt(receipt) ||
    !candidatePassBReceiptMatchesContext(receipt, context, {
      candidateId: candidate.candidateId,
      sourceStartMs: candidate.startMs,
      sourceEndMs: candidate.endMs,
      routingModelRevision: receipt?.routingModelRevision,
      refinementEvidenceProjectionFingerprint:
        receipt?.refinementEvidenceProjectionFingerprint,
      outputLanguage,
      castRosterId,
    }) ||
    receipt.dispatchIntent.attemptOrdinal !== attempt.attemptOrdinal ||
    receipt.dispatchIntent.retryGrantId !== attempt.retryGrantId ||
    analysis?.model?.id !== receipt.settlement.providerModelId ||
    analysis?.model?.revision !== receipt.settlement.providerModelRevision ||
    analysis?.insight === null ||
    typeof analysis?.insight !== "object" ||
    receipt.dispatchIntent.mediaReceipt.frames.some((frame, index) => {
      const prepared = media.frames[index];
      return prepared === undefined ||
        frame.timestampMs !== prepared.timestampMs ||
        frame.byteLength !== prepared.byteLength ||
        frame.contentDigest !== prepared.contentDigest ||
        frame.extractionRevision !== prepared.extractionRevision;
    })
  ) {
    throw runnerError(
      "AI_RESULT_INVALID",
      "AI result is not fenced to this exact candidate media and context.",
    );
  }
  const thumbnailIndex = media.frames.findIndex(
    ({ timestampMs }) => timestampMs === receipt.thumbnailTimestampMs,
  );
  if (thumbnailIndex < 0) {
    throw runnerError(
      "AI_RESULT_INVALID",
      "AI receipt does not select one of the four frames.",
    );
  }
  return {
    candidateId: candidate.candidateId,
    sourceStartMs: candidate.startMs,
    sourceEndMs: candidate.endMs,
    context,
    evidence,
    insight: analysis.insight,
    model: analysis.model,
    verificationReceipt: receipt,
    frames: media.frames,
    impactThumbnailFrameIndex: thumbnailIndex,
  };
}

function retryableCheckpoint(
  checkpointKey,
  candidate,
  attempt,
  errorCode,
  lastRecord,
) {
  return {
    checkpointKey,
    candidateId: candidate.candidateId,
    sourceStartMs: candidate.startMs,
    sourceEndMs: candidate.endMs,
    status: "retryable",
    errorCode,
    attemptOrdinal: attempt.attemptOrdinal,
    retryGrantId: attempt.retryGrantId,
    lastRecord,
  };
}

function analyzedCheckpoint(
  checkpointKey,
  candidate,
  attempt,
  resolution,
  record,
) {
  if (!CHECKPOINT_RESOLUTIONS.has(resolution)) {
    throw runnerError(
      "FINAL_CLOSURE_INVALID",
      "Candidate checkpoint resolution is invalid.",
    );
  }
  return {
    checkpointKey,
    candidateId: candidate.candidateId,
    sourceStartMs: candidate.startMs,
    sourceEndMs: candidate.endMs,
    status: "analyzed",
    attemptOrdinal: attempt.attemptOrdinal,
    retryGrantId: attempt.retryGrantId,
    resolution,
    record,
  };
}

function mediaAdapterReceipt(adapter, revision, inputCount) {
  return {
    adapter,
    revision,
    status: "completed",
    inputCount,
    processedCount: inputCount,
    unavailableReason: null,
  };
}

function scheduledVisualParticipantEvidence(record, castRosterId) {
  const insight = record.insight;
  const identified = [];
  const seenParticipantIds = new Set();
  for (const attribution of insight.identifiedParticipants) {
    if (
      attribution.evidenceBasis !== "on-screen-name" ||
      attribution.observedFrameIndices.length === 0
    ) {
      continue;
    }
    const reference = candidatePassBCastReferenceForName(
      castRosterId,
      attribution.displayName,
    );
    if (reference === null || seenParticipantIds.has(reference.participantId)) {
      continue;
    }
    seenParticipantIds.add(reference.participantId);
    identified.push({
      evidenceId: `scheduled-visual:${record.candidateId}:${reference.participantId}`,
      participantId: reference.participantId,
      kind: "on-screen-name",
      supports: "visible-identity",
      adapter: "visual-identity",
      startMs: record.sourceStartMs,
      endMs: record.sourceEndMs,
      chapterId: null,
      confidence: attribution.confidence,
      evidenceKo: boundedText(
        attribution.evidenceKo,
        `${reference.displayName}의 이름이 후보 화면에서 확인되었습니다.`,
      ).slice(0, 400),
    });
  }
  if (identified.length > 0) return identified;
  if (insight.participantPresence === "none-present") {
    return [{
      evidenceId: `scheduled-visual:${record.candidateId}:none`,
      participantId: null,
      kind: "no-visible-participant",
      supports: "no-visible-participant",
      adapter: "visual-identity",
      startMs: record.sourceStartMs,
      endMs: record.sourceEndMs,
      chapterId: null,
      confidence: null,
      evidenceKo: "후보의 네 대표 화면에서 등장인물이 확인되지 않았습니다.",
    }];
  }
  if (
    insight.participantPresence === "identified" ||
    insight.participantPresence === "present-unidentified"
  ) {
    return [{
      evidenceId: `scheduled-visual:${record.candidateId}:unidentified`,
      participantId: null,
      kind: "visible-participant-unidentified",
      supports: "visible-unidentified",
      adapter: "visual-identity",
      startMs: record.sourceStartMs,
      endMs: record.sourceEndMs,
      chapterId: null,
      confidence: null,
      evidenceKo: boundedText(
        insight.participantSummaryKo,
        "후보 화면에 등장인물이 있지만 검증된 이름과 연결하지 못했습니다.",
      ).slice(0, 400),
    }];
  }
  return [];
}

function scheduledVoiceParticipantEvidence(record) {
  const audio = record.verificationReceipt.dispatchIntent.mediaReceipt.audio;
  return [{
    evidenceId: `scheduled-voice:${record.candidateId}:${audio.kind === "verified-no-speech" ? "no-speech" : "unidentified"}`,
    participantId: null,
    kind: audio.kind === "verified-no-speech" ? "no-speech" : "speaker-unidentified",
    supports: audio.kind === "verified-no-speech" ? "no-speech" : "speaker-unidentified",
    adapter: "voice-identity",
    startMs: record.sourceStartMs,
    endMs: record.sourceEndMs,
    chapterId: null,
    confidence: null,
    evidenceKo: audio.kind === "verified-no-speech"
      ? "후보 오디오의 음성 활동 검사에서 발화가 확인되지 않았습니다."
      : "후보 오디오에 소리가 있으나 검증된 음성 지문과 연결하지 않았습니다.",
  }];
}

function mediaConfirmedParticipantGrounding(bundle, initialGrounding, analyzed) {
  const records = analyzed.map(({ record }) => record);
  const visualEvidence = records.flatMap((record) =>
    scheduledVisualParticipantEvidence(record, initialGrounding.castRosterId),
  );
  const voiceEvidence = records.flatMap(scheduledVoiceParticipantEvidence);
  return createBroadcastParticipantGrounding(
    {
      sourceDurationMs: bundle.durationMs,
      castRosterId: initialGrounding.castRosterId,
      chapters: bundle.chapters,
    },
    {
      visualIdentity: {
        receipt: mediaAdapterReceipt(
          "visual-identity",
          SCHEDULED_VISUAL_IDENTITY_REVISION,
          records.length,
        ),
        evidence: visualEvidence,
      },
      voiceIdentity: {
        receipt: mediaAdapterReceipt(
          "voice-identity",
          SCHEDULED_VOICE_IDENTITY_REVISION,
          records.length,
        ),
        evidence: voiceEvidence,
      },
    },
  );
}

export async function runChannelPreanalysisReview(input) {
  const { bundle, concurrency, visualCoverage } = validateInputs(input);
  await verifyChannelPreanalysisTranscriptDigest(bundle);
  const candidates = fuseCandidates(
    createRawCandidates(bundle, input.audioFeatures, input.visualCandidateSeeds),
  );
  const previous = priorCheckpointByKey(input.previousCandidateResults);
  const emitCheckpoint = input.onCandidateCheckpoint ?? (async () => {});

  const outputLanguage = input.outputLanguage ?? "ko";
  const castRosterId = input.participantGrounding.castRosterId;
  const candidateResults = await mapWithConcurrency(
    candidates,
    concurrency,
    async (candidate) => {
      const annotation = annotationForCandidate(bundle, candidate);
      const context = candidateContext(bundle, candidate, annotation);
      const checkpointKey = candidateCheckpointKey(candidate, context);
      const reused = previous.get(checkpointKey);
      if (reused?.status === "analyzed") return reused;

      const evidence = candidateEvidence(bundle, candidate);
      let attempt = reused?.status === "retryable"
        ? {
            attemptOrdinal: reused.attemptOrdinal,
            retryGrantId: reused.retryGrantId,
          }
        : semanticAttemptIdentity(checkpointKey, 0);
      let lastRecord = reused?.status === "retryable"
        ? reused.lastRecord
        : null;
      let media;
      try {
        const extracted = normalizeMedia(
          await input.extractCandidateMedia(candidate),
          candidate,
        );
        media = resumeMedia(extracted, lastRecord);
      } catch (cause) {
        const checkpoint = retryableCheckpoint(
          checkpointKey,
          candidate,
          attempt,
          causeErrorCode(cause, "CANDIDATE_MEDIA_FAILED"),
          lastRecord,
        );
        await emitCheckpoint(checkpoint);
        return checkpoint;
      }

      while (
        attempt.attemptOrdinal <=
        CHANNEL_PREANALYSIS_REVIEW_MAX_SEMANTIC_RECOVERIES
      ) {
        let record;
        try {
          const analysis = await input.analyzeCandidate({
            candidate,
            context,
            evidence,
            frames: media.frames,
            audio: media.audio,
            broadcastContext: bundle.broadcastContext,
            participantGrounding: input.participantGrounding,
            semanticAttempt: attempt,
          });
          record = createCandidateRecord(
            candidate,
            context,
            evidence,
            media,
            analysis,
            attempt,
            outputLanguage,
            castRosterId,
          );
        } catch (cause) {
          const errorCode = causeErrorCode(
            cause,
            "CANDIDATE_ANALYSIS_FAILED",
          );
          if (
            FRESH_SEMANTIC_ATTEMPT_ERROR_CODES.has(errorCode) &&
            attempt.attemptOrdinal <
              CHANNEL_PREANALYSIS_REVIEW_MAX_SEMANTIC_RECOVERIES
          ) {
            attempt = semanticAttemptIdentity(
              checkpointKey,
              attempt.attemptOrdinal + 1,
            );
            await emitCheckpoint(
              retryableCheckpoint(
                checkpointKey,
                candidate,
                attempt,
                errorCode,
                lastRecord,
              ),
            );
            continue;
          }
          if (
            FRESH_SEMANTIC_ATTEMPT_ERROR_CODES.has(errorCode) &&
            lastRecord !== null
          ) {
            const previousAttempt = {
              attemptOrdinal:
                lastRecord.verificationReceipt.dispatchIntent.attemptOrdinal,
              retryGrantId:
                lastRecord.verificationReceipt.dispatchIntent.retryGrantId,
            };
            const checkpoint = analyzedCheckpoint(
              checkpointKey,
              candidate,
              previousAttempt,
              "editor-review",
              lastRecord,
            );
            await emitCheckpoint(checkpoint);
            return checkpoint;
          }
          const checkpoint = retryableCheckpoint(
            checkpointKey,
            candidate,
            attempt,
            errorCode,
            lastRecord,
          );
          await emitCheckpoint(checkpoint);
          return checkpoint;
        }

        const gap = candidateRecordGap(
          record,
          candidate.score,
          outputLanguage,
          castRosterId,
        );
        const resolution = checkpointResolutionForGap(
          gap,
          attempt.attemptOrdinal,
        );
        if (resolution !== null) {
          const checkpoint = analyzedCheckpoint(
            checkpointKey,
            candidate,
            attempt,
            resolution,
            record,
          );
          await emitCheckpoint(checkpoint);
          return checkpoint;
        }

        lastRecord = record;
        attempt = semanticAttemptIdentity(
          checkpointKey,
          attempt.attemptOrdinal + 1,
        );
        await emitCheckpoint(
          retryableCheckpoint(
            checkpointKey,
            candidate,
            attempt,
            gapErrorCode(gap),
            lastRecord,
          ),
        );
      }

      throw runnerError(
        "SEMANTIC_ATTEMPT_INVALID",
        "Candidate semantic recovery escaped its bounded attempt loop.",
      );
    },
  );

  const retryCandidateIds = candidateResults
    .filter(({ status }) => status === "retryable")
    .map(({ candidateId }) => candidateId);
  if (retryCandidateIds.length > 0) {
    return {
      status: "incomplete",
      reviewBundle: null,
      selectedCandidateIds: candidates.map(({ candidateId }) => candidateId),
      retryCandidateIds,
      candidateResults,
    };
  }

  const analyzed = candidateResults.filter(({ status }) => status === "analyzed");
  const firstReceipt = analyzed[0]?.record.verificationReceipt ?? null;
  const refinementFingerprint = firstReceipt?.refinementEvidenceProjectionFingerprint ?? null;
  const refinementMismatch = analyzed.some(
    ({ record }) => record.verificationReceipt.refinementEvidenceProjectionFingerprint !== refinementFingerprint,
  );
  if (refinementMismatch) {
    throw runnerError("AI_RESULT_INVALID", "Candidate receipts disagree on refinement evidence.");
  }
  for (const checkpoint of analyzed) {
    const score = candidates.find(
      ({ candidateId }) => candidateId === checkpoint.candidateId,
    )?.score ?? 0;
    const gap = candidateRecordGap(
      checkpoint.record,
      score,
      outputLanguage,
      castRosterId,
    );
    const expectedResolution = gap === null
      ? "publish"
      : TERMINAL_EXCLUSION_GAPS.has(gap)
        ? "terminal-excluded"
        : "editor-review";
    if (checkpoint.resolution !== expectedResolution) {
      throw runnerError(
        "FINAL_CLOSURE_INVALID",
        "Candidate checkpoint resolution does not match its verified evidence.",
      );
    }
  }
  const finalRecords = analyzed
    .filter(({ resolution }) => resolution !== "terminal-excluded")
    .map(({ record }) => record);
  const participantGrounding = mediaConfirmedParticipantGrounding(
    bundle,
    input.participantGrounding,
    analyzed,
  );

  const source = {
    sourceId: input.sourceId,
    channelId: bundle.channelId,
    videoId: bundle.videoId,
  };
  const digestInput = {
    source,
    broadcastContext: bundle.broadcastContext,
    visualCoverage,
    participantGrounding,
    candidates: finalRecords,
  };
  const digests = await createChannelPreanalysisReviewContentDigests(digestInput);
  const publishedCandidateIds = finalRecords.map(({ candidateId }) => candidateId);
  const reviewBundle = validateChannelPreanalysisReviewBundle({
    schemaVersion: CHANNEL_PREANALYSIS_REVIEW_BUNDLE_SCHEMA_VERSION,
    artifactId: channelPreanalysisReviewBundleArtifactId(bundle.videoId, input.artifactRevision),
    artifactRevision: input.artifactRevision,
    createdAt: input.createdAt,
    source,
    sourceDurationMs: bundle.durationMs,
    transcriptDigest: bundle.transcriptDigest,
    broadcastContext: bundle.broadcastContext,
    broadcastContextDigest: digests.broadcastContextDigest,
    visualCoverage,
    participantGrounding,
    participantGroundingProvenance: {
      schemaVersion: CHANNEL_PREANALYSIS_PARTICIPANT_PROVENANCE_SCHEMA_VERSION,
      checkpointDigest: digests.participantGroundingDigest,
      generatedAt: input.createdAt,
      pipelineRevision: input.pipelineRevision,
    },
    candidates: finalRecords,
    certificate: {
      schemaVersion: CHANNEL_PREANALYSIS_REVIEW_CERTIFICATE_SCHEMA_VERSION,
      pipelineRevision: input.pipelineRevision,
      outcome: finalRecords.length === 0 ? "verified-empty" : "review-ready",
      sourceIdentityDigest: digests.sourceIdentityDigest,
      transcriptDigest: bundle.transcriptDigest,
      broadcastContextDigest: digests.broadcastContextDigest,
      participantGroundingDigest: digests.participantGroundingDigest,
      visualCoverageDigest: digests.visualCoverageDigest,
      candidateSetDigest: digests.candidateSetDigest,
      finalCandidateIds: publishedCandidateIds,
    },
  });
  await verifyChannelPreanalysisReviewBundleIntegrity(reviewBundle);
  return {
    status: "complete",
    reviewBundle,
    selectedCandidateIds: candidates.map(({ candidateId }) => candidateId),
    retryCandidateIds: [],
    candidateResults,
  };
}
