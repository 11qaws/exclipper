import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBroadcastParticipantGrounding } from "../../src/analysis/broadcastParticipantGrounding.ts";
import { BROADCAST_CONTEXT_SCHEMA_VERSION } from "../../src/analysis/broadcastContextProtocol.ts";
import {
  candidatePassBContextFingerprint,
  createCandidatePassBContextPacket,
  createCandidatePassBVerificationReceipt,
} from "../../src/analysis/candidateFinalVerification.ts";
import {
  CANDIDATE_PASS_B_DISPATCH_INTENT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
  CANDIDATE_PASS_B_MEDIA_RECEIPT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
} from "../../src/analysis/candidatePassBWorkerProtocol.ts";
import {
  CHANNEL_PREANALYSIS_PARTICIPANT_PROVENANCE_SCHEMA_VERSION,
  CHANNEL_PREANALYSIS_REVIEW_BUNDLE_SCHEMA_VERSION,
  CHANNEL_PREANALYSIS_REVIEW_CERTIFICATE_SCHEMA_VERSION,
  channelPreanalysisReviewBundleArtifactId,
} from "../../src/analysis/channelPreanalysisReviewBundle.ts";
import { AMORETTO_CHANNEL_PREANALYSIS_SOURCE } from "../../src/analysis/channelPreanalysisSources.ts";
import { createChannelPreanalysisVisualCoverageReceipt } from "../../src/analysis/channelPreanalysisVisualCoverage.ts";
import {
  CHANNEL_PREANALYSIS_REVIEW_CHECKPOINT_MAX_BYTES,
  CHANNEL_PREANALYSIS_REVIEW_CHECKPOINT_MAX_ENTRIES,
  ChannelPreanalysisReviewCheckpointError,
  createChannelPreanalysisReviewCheckpointStore,
} from "./channel-preanalysis-review-checkpoint.mjs";
import {
  CHANNEL_PREANALYSIS_REVIEW_RUNNER_SCHEMA_VERSION,
} from "./channel-preanalysis-review-runner.mjs";

const VIDEO_ID = "KzAW3yow80Q";
const DURATION_MS = 120_000;
const PIPELINE_REVISION = "scheduled-review-checkpoint-test-v1";
const CREATED_AT = "2026-08-02T07:00:00.000Z";

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function contentDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function checkpointKeyFor(record) {
  return contentDigest(Buffer.from(JSON.stringify([
    CHANNEL_PREANALYSIS_REVIEW_RUNNER_SCHEMA_VERSION,
    record.candidateId,
    record.sourceStartMs,
    record.sourceEndMs,
    record.context,
  ])));
}

const runIdentity = Object.freeze({
  sourceId: AMORETTO_CHANNEL_PREANALYSIS_SOURCE.sourceId,
  channelId: AMORETTO_CHANNEL_PREANALYSIS_SOURCE.channelId,
  videoId: VIDEO_ID,
  contextArtifactDigest: digest("f"),
  broadcastContextDigest: digest("c"),
  artifactRevision: 3,
  pipelineRevision: PIPELINE_REVISION,
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "exclipper-review-checkpoint-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const catalogDir = join(root, AMORETTO_CHANNEL_PREANALYSIS_SOURCE.sourceId);
  await mkdir(catalogDir);
  return catalogDir;
}

function frame(timestampMs) {
  const bytes = Buffer.from([0xff, 0xd8, timestampMs / 5_000, 0xff, 0xd9]);
  return {
    timestampMs,
    mimeType: "image/jpeg",
    byteLength: bytes.byteLength,
    contentDigest: contentDigest(bytes),
    extractionRevision: CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
    dataBase64: bytes.toString("base64"),
  };
}

function analyzedCheckpoint(options = {}) {
  const attemptOrdinal = options.attemptOrdinal ?? 0;
  const retryGrantId = options.retryGrantId ?? (
    attemptOrdinal === 0 ? null : `scheduled-semantic-${attemptOrdinal}-checkpoint`
  );
  const resolution = options.resolution ?? "publish";
  const candidateId = "scheduled-checkpoint-candidate";
  const sourceStartMs = 10_000;
  const sourceEndMs = 55_000;
  const context = createCandidatePassBContextPacket({
    transcriptSource: "youtube-caption",
    transcriptKo: "스트리머가 여러 번 시도한 뒤 목표를 달성했다고 말합니다.",
    beforeContextKo: "앞선 시도에서는 계속 실패하고 있었습니다.",
    afterContextKo: "성공을 확인한 뒤 안도하며 다음 장면으로 넘어갑니다.",
    broadcastSummaryKo: "방송 전체에서 반복 도전과 마지막 성공이 이어집니다.",
    topicContextKo: "반복 도전 끝의 조용한 성공 장면입니다.",
    fastEvidenceKo: "성공 직후 말투와 대사 흐름이 달라졌습니다.",
    contextDecision: "select",
    contextCategory: "quiet-achievement",
    contextVerdictKo: "전체 방송 흐름에서 앞선 실패가 보상되는 장면입니다.",
    chatReactionKo: null,
  });
  assert.ok(context);
  const frames = [5_000, 15_000, 25_000, 35_000].map(frame);
  const mediaFrames = frames.map((reviewFrame) => ({
    timestampMs: reviewFrame.timestampMs,
    mimeType: reviewFrame.mimeType,
    byteLength: reviewFrame.byteLength,
    contentDigest: reviewFrame.contentDigest,
    extractionRevision: reviewFrame.extractionRevision,
  }));
  const dispatch = {
    schemaVersion: CANDIDATE_PASS_B_DISPATCH_INTENT_SCHEMA_VERSION,
    operationId: `candidate-pass-b.${candidateId}.${attemptOrdinal}`,
    analysisRunId: "scheduled-review-checkpoint-test",
    candidateId,
    sourceFingerprint: "scheduled-source-checkpoint-test",
    sourceStartMs,
    sourceEndMs,
    contextFingerprint: candidatePassBContextFingerprint(context),
    outputLanguage: "ko",
    castRosterId: null,
    routingModelRevision: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
    attemptOrdinal,
    retryGrantId,
    transportMode: "paid-direct",
    mediaReceipt: {
      schemaVersion: CANDIDATE_PASS_B_MEDIA_RECEIPT_SCHEMA_VERSION,
      frameExtractionRevision: CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
      frames: mediaFrames,
      audio: {
        kind: "audible-audio",
        wavByteLength: 32_044,
        wavContentDigest: digest("5"),
        sampleRateHz: CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
        sampleCount: 16_000,
      },
      providerPayloadDigest: digest("6"),
    },
  };
  const settlement = {
    schemaVersion: CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
    status: "completed",
    operationId: dispatch.operationId,
    providerPayloadDigest: dispatch.mediaReceipt.providerPayloadDigest,
    outputLanguage: "ko",
    castRosterId: null,
    responseDigest: digest("7"),
    providerModelId: CANDIDATE_PASS_B_QWEN_MODEL_ID,
    providerModelRevision: CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  };
  const receipt = createCandidatePassBVerificationReceipt(
    context,
    25_000,
    {
      candidateId,
      sourceStartMs,
      sourceEndMs,
      routingModelRevision: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
      refinementEvidenceProjectionFingerprint: null,
      outputLanguage: "ko",
      castRosterId: null,
    },
    dispatch,
    settlement,
  );
  assert.ok(receipt);
  const record = {
    candidateId,
    sourceStartMs,
    sourceEndMs,
    context,
    evidence: {
      candidateId,
      cues: [],
      overlay: {
        event: "반복 도전 끝에 성공했습니다.",
        why: "방송 전체 흐름의 결말입니다.",
        reviewHint: "성공 직전과 직후 반응을 확인하세요.",
        basisLabel: "자막과 화면 근거",
      },
      quality: {
        receivedChunkCount: 1,
        mappedChunkCount: 1,
        usableChunkCount: 1,
        discardedChunkCount: 0,
        meanConfidence: null,
      },
      status: "grounded-transcript",
      fallbackReason: null,
    },
    insight: {
      eventSummaryKo: "여러 차례 실패한 목표를 마침내 달성했습니다.",
      reactionSummaryKo: "스트리머가 안도하며 기뻐했습니다.",
      whyGoodClipKo: "앞선 실패가 성공으로 보상되는 완결된 장면입니다.",
      uncertaintiesKo: [],
      participantPresence: "present-unidentified",
      participantSummaryKo: "진행자가 보이지만 이름을 확정할 근거는 없습니다.",
      identifiedParticipants: [],
      clipDecision: "recommend",
      contextConsistency: "consistent",
      programMaterial: "streamer-event",
      ...(options.insight ?? {}),
    },
    model: {
      id: CANDIDATE_PASS_B_QWEN_MODEL_ID,
      revision: CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
    },
    verificationReceipt: receipt,
    frames,
    impactThumbnailFrameIndex: 2,
  };
  return {
    checkpointKey: checkpointKeyFor(record),
    candidateId,
    sourceStartMs,
    sourceEndMs,
    status: "analyzed",
    attemptOrdinal,
    retryGrantId,
    resolution,
    record,
  };
}

function contextExcludedCheckpoint(index = 1) {
  return {
    checkpointKey: contentDigest(Buffer.from(`excluded-${index}`)),
    candidateId: `excluded-${index}`,
    sourceStartMs: 60_000,
    sourceEndMs: 105_000,
    status: "context-excluded",
    reason: "music-opening-ending-or-break",
  };
}

function retryableCheckpoint(index = 1, errorCode = "CANDIDATE_ANALYSIS_FAILED") {
  return {
    checkpointKey: contentDigest(Buffer.from(`retryable-${index}`)),
    candidateId: `retryable-${index}`,
    sourceStartMs: 60_000,
    sourceEndMs: 105_000,
    status: "retryable",
    errorCode,
    attemptOrdinal: 0,
    retryGrantId: null,
    lastRecord: null,
  };
}

function semanticRetryableCheckpoint() {
  const previous = analyzedCheckpoint({
    insight: {
      clipDecision: "uncertain",
      uncertaintiesKo: ["추가 확인이 필요합니다."],
    },
  });
  return {
    checkpointKey: previous.checkpointKey,
    candidateId: previous.candidateId,
    sourceStartMs: previous.sourceStartMs,
    sourceEndMs: previous.sourceEndMs,
    status: "retryable",
    errorCode: "CANDIDATE_DETAIL_UNCERTAIN",
    attemptOrdinal: 1,
    retryGrantId: "scheduled-semantic-1-checkpoint-recovery",
    lastRecord: previous.record,
  };
}

function publishedReview() {
  const chapters = [{
    chapterId: "chapter-1",
    startMs: 0,
    endMs: DURATION_MS,
    evidenceMode: "complete-transcript",
    evidenceCoverageRatio: 1,
    summaryKo: "방송 전체의 흐름을 확인한 완전한 맥락 구간입니다.",
  }];
  const participantGrounding = createBroadcastParticipantGrounding({
    sourceDurationMs: DURATION_MS,
    castRosterId: null,
    chapters,
  }, {
    visualIdentity: {
      receipt: { adapter: "visual-identity", revision: "test-visual-v1", status: "completed", inputCount: 0, processedCount: 0, unavailableReason: null },
      evidence: [],
    },
    voiceIdentity: {
      receipt: { adapter: "voice-identity", revision: "test-voice-v1", status: "completed", inputCount: 0, processedCount: 0, unavailableReason: null },
      evidence: [],
    },
  });
  const participantDigest = digest("d");
  const visualCoverage = createChannelPreanalysisVisualCoverageReceipt({
    sourceDurationMs: DURATION_MS,
    videoId: VIDEO_ID,
    sourceFingerprintDigest: digest("f"),
    visualSeedTimestampsMs: [],
  });
  return {
    schemaVersion: CHANNEL_PREANALYSIS_REVIEW_BUNDLE_SCHEMA_VERSION,
    artifactId: channelPreanalysisReviewBundleArtifactId(
      VIDEO_ID,
      runIdentity.artifactRevision,
    ),
    artifactRevision: runIdentity.artifactRevision,
    createdAt: CREATED_AT,
    source: {
      sourceId: runIdentity.sourceId,
      channelId: runIdentity.channelId,
      videoId: VIDEO_ID,
    },
    sourceDurationMs: DURATION_MS,
    transcriptDigest: digest("a"),
    broadcastContext: {
      schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
      broadcastSummaryKo: "방송 전체 내용을 확인했으며 검토할 후보가 없는 결과입니다.",
      hostStreamerProfile: null,
      recurringThemesKo: [],
      annotations: [],
      semanticChaptersSupported: true,
      semanticChapters: [],
      discoveredLeadsSupported: true,
      discoveredLeads: [],
      coverage: {
        status: "complete",
        coveredMs: DURATION_MS,
        coverageRatio: 1,
        gaps: [],
        partialChapterIds: [],
      },
    },
    broadcastContextDigest: runIdentity.broadcastContextDigest,
    visualCoverage,
    participantGrounding,
    participantGroundingProvenance: {
      schemaVersion: CHANNEL_PREANALYSIS_PARTICIPANT_PROVENANCE_SCHEMA_VERSION,
      checkpointDigest: participantDigest,
      generatedAt: CREATED_AT,
      pipelineRevision: PIPELINE_REVISION,
    },
    candidates: [],
    certificate: {
      schemaVersion: CHANNEL_PREANALYSIS_REVIEW_CERTIFICATE_SCHEMA_VERSION,
      pipelineRevision: PIPELINE_REVISION,
      outcome: "verified-empty",
      sourceIdentityDigest: digest("b"),
      transcriptDigest: digest("a"),
      broadcastContextDigest: runIdentity.broadcastContextDigest,
      participantGroundingDigest: participantDigest,
      visualCoverageDigest: digest("f"),
      candidateSetDigest: digest("e"),
      finalCandidateIds: [],
    },
  };
}

test("atomically recovers completed results while retaining retryable diagnostics only", async (t) => {
  const catalogDir = await fixture(t);
  const store = createChannelPreanalysisReviewCheckpointStore({
    catalogDir,
    runIdentity,
    nowIso: () => CREATED_AT,
  });
  assert.deepEqual(await store.load(), {
    previousCandidateResults: [],
    retryableDiagnostics: [],
    entryCount: 0,
  });

  await store.onCandidateCheckpoint(retryableCheckpoint(1));
  await store.onCandidateCheckpoint(retryableCheckpoint(1, "FRAME_BUNDLE_INCOMPLETE"));
  const retrySnapshot = await store.load();
  assert.equal(retrySnapshot.previousCandidateResults.length, 0);
  assert.equal(retrySnapshot.retryableDiagnostics.length, 1);
  assert.equal(retrySnapshot.retryableDiagnostics[0].errorCode, "FRAME_BUNDLE_INCOMPLETE");

  await Promise.all([
    store.onCandidateCheckpoint(analyzedCheckpoint()),
    store.onCandidateCheckpoint(contextExcludedCheckpoint()),
  ]);
  const restarted = createChannelPreanalysisReviewCheckpointStore({
    catalogDir,
    runIdentity,
  });
  const recovered = await restarted.load();
  assert.equal(recovered.entryCount, 3);
  assert.deepEqual(
    recovered.previousCandidateResults.map(({ status }) => status).sort(),
    ["analyzed", "context-excluded"],
  );
  assert.equal(recovered.retryableDiagnostics.length, 1);
  assert.ok((await stat(store.checkpointPath)).size <= CHANNEL_PREANALYSIS_REVIEW_CHECKPOINT_MAX_BYTES);

  const foreign = createChannelPreanalysisReviewCheckpointStore({
    catalogDir,
    runIdentity: { ...runIdentity, contextArtifactDigest: digest("e") },
  });
  await assert.rejects(
    foreign.load(),
    (error) =>
      error instanceof ChannelPreanalysisReviewCheckpointError &&
      error.code === "IDENTITY_MISMATCH",
  );
});

test("keeps checkpoints until a matching publisher success removes them", async (t) => {
  const catalogDir = await fixture(t);
  const store = createChannelPreanalysisReviewCheckpointStore({
    catalogDir,
    runIdentity,
  });
  await store.onCandidateCheckpoint(contextExcludedCheckpoint());

  await assert.rejects(
    store.finalizeAfterPublisherSuccess({
      state: "retryable",
      video: { videoId: VIDEO_ID, state: "retryable", revision: 3 },
      reviewBundle: null,
    }),
    (error) =>
      error instanceof ChannelPreanalysisReviewCheckpointError &&
      error.code === "PUBLICATION_NOT_CONFIRMED",
  );
  assert.equal((await stat(store.checkpointPath)).isFile(), true);

  const mismatchedContextReview = publishedReview();
  mismatchedContextReview.broadcastContextDigest = digest("9");
  mismatchedContextReview.certificate.broadcastContextDigest = digest("9");
  await assert.rejects(
    store.finalizeAfterPublisherSuccess({
      state: "review-ready",
      video: { videoId: VIDEO_ID, state: "review-ready", revision: 3 },
      reviewBundle: mismatchedContextReview,
    }),
    (error) =>
      error instanceof ChannelPreanalysisReviewCheckpointError &&
      error.code === "PUBLICATION_NOT_CONFIRMED",
  );
  assert.equal((await stat(store.checkpointPath)).isFile(), true);

  await store.finalizeAfterPublisherSuccess({
    state: "review-ready",
    video: { videoId: VIDEO_ID, state: "review-ready", revision: 3 },
    reviewBundle: publishedReview(),
  });
  assert.equal(await stat(store.checkpointPath).catch(() => null), null);
  await assert.rejects(
    store.onCandidateCheckpoint(retryableCheckpoint()),
    (error) =>
      error instanceof ChannelPreanalysisReviewCheckpointError &&
      error.code === "STORE_FINALIZED",
  );
});

test("enforces the twelve-entry and four-MiB recovery bounds", async (t) => {
  const catalogDir = await fixture(t);
  const store = createChannelPreanalysisReviewCheckpointStore({
    catalogDir,
    runIdentity,
  });
  for (let index = 0; index < CHANNEL_PREANALYSIS_REVIEW_CHECKPOINT_MAX_ENTRIES; index += 1) {
    await store.onCandidateCheckpoint(retryableCheckpoint(index));
  }
  const replacement = retryableCheckpoint(0, "FRAME_BUNDLE_INCOMPLETE");
  replacement.checkpointKey = contentDigest(Buffer.from("retryable-0-recovery"));
  await store.onCandidateCheckpoint(replacement);
  const replaced = await store.load();
  assert.equal(replaced.entryCount, CHANNEL_PREANALYSIS_REVIEW_CHECKPOINT_MAX_ENTRIES);
  assert.equal(
    replaced.retryableDiagnostics.filter(({ candidateId }) => candidateId === replacement.candidateId).length,
    1,
  );
  assert.equal(
    replaced.retryableDiagnostics.find(({ candidateId }) => candidateId === replacement.candidateId)
      ?.checkpointKey,
    replacement.checkpointKey,
  );
  assert.equal(
    replaced.retryableDiagnostics.find(({ candidateId }) => candidateId === replacement.candidateId)
      ?.errorCode,
    "FRAME_BUNDLE_INCOMPLETE",
  );
  await assert.rejects(
    store.onCandidateCheckpoint(
      retryableCheckpoint(CHANNEL_PREANALYSIS_REVIEW_CHECKPOINT_MAX_ENTRIES),
    ),
    (error) =>
      error instanceof ChannelPreanalysisReviewCheckpointError &&
      error.code === "ENTRY_LIMIT",
  );

  await writeFile(
    store.checkpointPath,
    Buffer.alloc(CHANNEL_PREANALYSIS_REVIEW_CHECKPOINT_MAX_BYTES + 1),
  );
  await assert.rejects(
    store.load(),
    (error) =>
      error instanceof ChannelPreanalysisReviewCheckpointError &&
      error.code === "INVALID_FILE",
  );
});

test("rejects persisted checkpoints with duplicate candidate IDs", async (t) => {
  const catalogDir = await fixture(t);
  const store = createChannelPreanalysisReviewCheckpointStore({
    catalogDir,
    runIdentity,
  });
  await store.onCandidateCheckpoint(retryableCheckpoint(1));
  const snapshot = JSON.parse(await readFile(store.checkpointPath, "utf8"));
  snapshot.entries.push({
    ...snapshot.entries[0],
    checkpointKey: contentDigest(Buffer.from("duplicate-candidate-id")),
  });
  await writeFile(store.checkpointPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  await assert.rejects(
    store.load(),
    (error) =>
      error instanceof ChannelPreanalysisReviewCheckpointError &&
      error.code === "INVALID_FILE",
  );
});

test("persists one exact semantic recovery identity and its completed evidence", async (t) => {
  const catalogDir = await fixture(t);
  const store = createChannelPreanalysisReviewCheckpointStore({
    catalogDir,
    runIdentity,
    nowIso: () => CREATED_AT,
  });
  const retryable = semanticRetryableCheckpoint();
  await store.onCandidateCheckpoint(retryable);

  const restarted = createChannelPreanalysisReviewCheckpointStore({
    catalogDir,
    runIdentity,
  });
  const loaded = await restarted.load();
  assert.deepEqual(loaded.retryableDiagnostics, [retryable]);
  assert.equal(loaded.retryableDiagnostics[0].lastRecord.frames.length, 4);
  assert.equal(
    loaded.retryableDiagnostics[0].lastRecord.verificationReceipt
      .dispatchIntent.attemptOrdinal,
    0,
  );
});

test("rejects retry identities that can fork or repeat a paid semantic attempt", async (t) => {
  const catalogDir = await fixture(t);
  const store = createChannelPreanalysisReviewCheckpointStore({
    catalogDir,
    runIdentity,
  });
  const retryable = semanticRetryableCheckpoint();
  for (const invalid of [
    { ...retryable, retryGrantId: null },
    { ...retryable, attemptOrdinal: 0 },
    {
      ...retryable,
      attemptOrdinal: 0,
      retryGrantId: null,
    },
  ]) {
    await assert.rejects(
      store.onCandidateCheckpoint(invalid),
      (error) =>
        error instanceof ChannelPreanalysisReviewCheckpointError &&
        error.code === "INVALID_ENTRY",
    );
  }
});

test("preserves a capped uncertain record as an analyzed editor-review checkpoint", async (t) => {
  const catalogDir = await fixture(t);
  const store = createChannelPreanalysisReviewCheckpointStore({
    catalogDir,
    runIdentity,
  });
  const checkpoint = analyzedCheckpoint({
    attemptOrdinal: 2,
    resolution: "editor-review",
    insight: {
      clipDecision: "uncertain",
      uncertaintiesKo: ["편집자가 원본을 확인해야 합니다."],
    },
  });
  await store.onCandidateCheckpoint(checkpoint);
  const loaded = await store.load();
  assert.deepEqual(loaded.previousCandidateResults, [checkpoint]);
});
