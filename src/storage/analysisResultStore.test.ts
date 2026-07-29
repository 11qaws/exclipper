import { describe, expect, it } from "vitest";

import {
  ANALYSIS_JOB_RECORD_SCHEMA_VERSION,
  ANALYSIS_RESULT_DB_VERSION,
  ANALYSIS_RESULT_OBJECT_STORES,
  AnalysisResultStoreError,
  checkpointBroadcastContextSessionRefinementEvidenceLedgerWithReadback,
  checkpointBroadcastContextSessionTranscriptIfUnchanged,
  checkpointBroadcastContextSessionPhaseLedgerIfUnchanged,
  checkpointBroadcastContextSessionRefinementTranscriptIfUnchanged,
  commitBroadcastContextSessionContextIfUnchanged,
  DEFAULT_ANALYSIS_RESULT_DB_NAME,
  InMemoryAnalysisResultStore,
  IndexedDbAnalysisResultStore,
  invalidateBroadcastContextSessionContextIfUnchanged,
  type AnalysisCompletionDurableSnapshot,
  type AnalysisFailureRecord,
  type AnalysisJobRecord,
  type AnalysisManifestRecord,
  type AnalysisTerminalRecord,
  type FinalAnalysisResultRecord,
  type ProvisionalAnalysisResultRecord,
  type SourceCapabilitySnapshotRecord,
} from "./analysisResultStore";
import { createAnalysisJob } from "../domain/analysisJob";
import { createAnalysisPipelineHappyPathFixture } from "../testSupport/analysisPipelineHappyPathFixture";
import type {
  DurableFinalResultPayload,
  DurableHighlightCandidate,
} from "./durableAnalysisPayload";
import {
  BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
  createBroadcastParticipantGroundingInputSignature,
  serializeBroadcastParticipantPreContextCheckpoint,
  type BroadcastContextSessionRecord,
} from "./broadcastContextSessionStore";
import {
  CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
  type CandidatePassBInsightsRecord,
} from "./candidatePassBInsightStore";
import { orchestrateBroadcastParticipantPreContext } from "../analysis/broadcastParticipantPreContextOrchestration";
import {
  createBroadcastContextPhaseLedger,
  serializeBroadcastContextPhaseLedger,
} from "../analysis/broadcastContextPhaseLedger";
import {
  createBroadcastRefinementTranscriptCheckpoint,
  recordBroadcastRefinementTranscriptAbstention,
  serializeBroadcastRefinementTranscriptCheckpoint,
} from "../analysis/broadcastRefinementTranscriptCheckpoint";
import { createVerifiedNoSpeechRunReceiptForTest } from "../testSupport/broadcastSpeechActivityTestReceipt";
import {
  createBroadcastTranscriptResolvedEvidenceCheckpoint,
  recordBroadcastTranscriptResolvedEvidence,
  serializeBroadcastTranscriptResolvedEvidenceCheckpoint,
} from "../analysis/broadcastTranscriptResolvedEvidence";
import {
  createBroadcastRefinementEvidenceLedger,
  serializeBroadcastRefinementEvidenceLedger,
} from "../analysis/broadcastRefinementEvidenceLedger";
import { DISCOVERED_LEAD_REFINEMENT_VERSION } from "../analysis/discoveredLeadRefinement";

const RECORDED_AT = "2026-07-19T12:34:56.000Z";
const INPUT_SIGNATURE = `sha256:${"a".repeat(64)}`;
const SOURCE_FINGERPRINT = `local-file-sampled-sha256-v1:${"b".repeat(64)}`;

async function makeAnalysisCompletionSnapshot(): Promise<AnalysisCompletionDurableSnapshot> {
  const fixture = await createAnalysisPipelineHappyPathFixture();
  return {
    manifest: fixture.manifest,
    fastResult: fixture.fastResult,
    fastTerminal: fixture.fastTerminal,
    session: fixture.session,
    candidateRecord: fixture.candidateRecord,
  };
}

function makeCompletionJobRecord(
  snapshot: AnalysisCompletionDurableSnapshot,
): AnalysisJobRecord {
  const jobId = "job-analysis-completion";
  return {
    schemaVersion: ANALYSIS_JOB_RECORD_SCHEMA_VERSION,
    jobId,
    lastActivityAt: RECORDED_AT,
    bytes: 1024,
    job: {
      ...createAnalysisJob({
        jobId,
        identity: {
          scheme: "app-input-signature-v1",
          key: INPUT_SIGNATURE,
        },
      }),
      status: "running",
      lastCommittedStage: "publication",
      activeRunId: snapshot.manifest.runId,
      runIds: [snapshot.manifest.runId],
    },
  };
}

function makeCompletedJobRecord(
  original: AnalysisJobRecord,
): AnalysisJobRecord {
  return {
    ...original,
    lastActivityAt: "2026-07-29T00:00:01.000Z",
    job: {
      ...original.job,
      status: "completed",
      quality: "usable",
      activeRunId: null,
    },
  };
}

async function seedAnalysisCompletionSnapshot(
  store: InMemoryAnalysisResultStore,
  snapshot: AnalysisCompletionDurableSnapshot,
): Promise<void> {
  await store.putManifest(snapshot.manifest);
  await store.putFinalResult(snapshot.fastResult);
  await store.putTerminalRecord(snapshot.fastTerminal);
  await store.putBroadcastContextSession(snapshot.session);
  if (snapshot.candidateRecord !== null) {
    await store.putCandidatePassBInsights(snapshot.candidateRecord);
  }
}

type AnalysisCompletionRecordName =
  | "manifest"
  | "fastResult"
  | "fastTerminal"
  | "session"
  | "candidateRecord";

function changeAnalysisCompletionRecord(
  snapshot: AnalysisCompletionDurableSnapshot,
  recordName: AnalysisCompletionRecordName,
): AnalysisCompletionDurableSnapshot {
  const recordedAt = "2026-07-29T00:00:02.000Z";
  switch (recordName) {
    case "manifest":
      return {
        ...snapshot,
        manifest: { ...snapshot.manifest, recordedAt },
      };
    case "fastResult":
      return {
        ...snapshot,
        fastResult: { ...snapshot.fastResult, recordedAt },
      };
    case "fastTerminal":
      return {
        ...snapshot,
        fastTerminal: { ...snapshot.fastTerminal, recordedAt },
      };
    case "session":
      return {
        ...snapshot,
        session: { ...snapshot.session, recordedAt },
      };
    case "candidateRecord":
      if (snapshot.candidateRecord === null) {
        throw new Error("The completion fixture must include candidate detail.");
      }
      return {
        ...snapshot,
        candidateRecord: { ...snapshot.candidateRecord, recordedAt },
      };
  }
}

function makeCandidatePassBInsights(
  recordedAt = RECORDED_AT,
): CandidatePassBInsightsRecord {
  return {
    kind: "candidatePassBInsights",
    runId: "run-candidate-pass-b-cas",
    schemaVersion: CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
    inputSignature: INPUT_SIGNATURE,
    modelManifestHash: "candidate-pass-b-cas-model",
    planReceipt: {
      schemaVersion: "1.0.0",
      runId: "run-candidate-pass-b-cas",
      inputSignature: INPUT_SIGNATURE,
      contextInputSignature: "context-input-signature-cas",
      refinementEvidenceProjectionFingerprint: null,
      plannedCandidateIds: [],
      plannedContextFingerprints: [],
      planFingerprint: `sha256:${"a".repeat(64)}`,
    },
    contextByCandidateId: {},
    evidenceById: {},
    insightById: {},
    modelByCandidateId: {},
    thumbnailById: {},
    attemptLedgerByCandidateId: {},
    dispatchIntentByCandidateId: {},
    settlementByCandidateId: {},
    verificationReceiptById: {},
    recordedAt,
  };
}

function makeBroadcastContextSession(
  recordedAt = RECORDED_AT,
): BroadcastContextSessionRecord {
  return {
    kind: "broadcastContextSession",
    runId: "run-context-cas",
    schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
    inputSignature: INPUT_SIGNATURE,
    sourceDurationMs: 60_000,
    completeAudioCoverage: true,
    chapters: [
      {
        chapterId: "chapter-1",
        startMs: 0,
        endMs: 60_000,
        evidenceMode: "complete-transcript",
        evidenceCoverageRatio: 1,
        summaryKo: "방송 대사 지도",
      },
    ],
    gapChunkIds: [],
    fragmentGaps: [],
    transcriptEvidenceInputSignature: null,
    transcriptEvidenceCheckpointJson: null,
    transcriptVisualInspectionCheckpointJson: null,
    transcriptProviderReceiptInputSignature: null,
    transcriptProviderReceiptCheckpointJson: null,
    modelRevision: "qwen3-asr-test",
    sourceCastRosterId: null,
    transcriptSealOperationKey: "run-context-cas:source:event-boost:attempt-0",
    participantGroundingInputSignature: null,
    participantGroundingPlanFingerprint: null,
    participantGroundingCheckpointJson: null,
    contextInputSignature: null,
    contextInputCheckpointJson: null,
    contextPhaseLedgerJson: null,
    contextResultJson: null,
    refinementTranscriptInputSignature: null,
    refinementTranscriptCheckpointJson: null,
    refinementEvidenceLedgerJson: null,
    refinementInputSignature: null,
    refinementCandidatesJson: null,
    recordedAt,
  };
}

function makeRefinementTranscriptCheckpointJson(
  refinementInputSignature = "refinement-transcript-signature-v1",
): string {
  let checkpoint = createBroadcastRefinementTranscriptCheckpoint({
    refinementInputSignature,
    plannedChunks: [
      {
        chunkId: "refine-001",
        sourceStartMs: 0,
        sourceEndMs: 60_000,
        kind: "event",
      },
    ],
  });
  checkpoint = recordBroadcastRefinementTranscriptAbstention(
    checkpoint,
    "refine-001",
    "no-speech",
    createVerifiedNoSpeechRunReceiptForTest(60_000, 0, 60_000),
  );
  return serializeBroadcastRefinementTranscriptCheckpoint(checkpoint);
}

function makeTranscriptEvidenceCheckpointJson(
  transcriptInputSignature = "transcript-plan-signature-v1",
): string {
  let checkpoint =
    createBroadcastTranscriptResolvedEvidenceCheckpoint({
      sourceFingerprint: INPUT_SIGNATURE,
      sourceDurationMs: 60_000,
      transcriptInputSignature,
      modelRevision: "qwen3-asr-test",
      plannedCells: [
        {
          chunkId: "asr-001",
          sourceStartMs: 0,
          sourceEndMs: 60_000,
        },
      ],
    });
  checkpoint = recordBroadcastTranscriptResolvedEvidence(
    checkpoint,
    "asr-001",
    "no-speech",
    createVerifiedNoSpeechRunReceiptForTest(60_000, 0, 60_000),
  );
  return serializeBroadcastTranscriptResolvedEvidenceCheckpoint(checkpoint);
}

async function createCompletedBroadcastContextSessionFixture(): Promise<BroadcastContextSessionRecord> {
  const session = makeBroadcastContextSession();
  const participantPreContext =
    await orchestrateBroadcastParticipantPreContext({
      sourceFingerprint: session.inputSignature,
      sourceDurationMs: session.sourceDurationMs,
      transcriptSeal: session.transcriptSealOperationKey!,
      castRosterId: session.sourceCastRosterId,
      dialogueChapters: session.chapters,
      transcriptModelRevision: session.modelRevision,
    });
  const participantGroundingCheckpointJson =
    await serializeBroadcastParticipantPreContextCheckpoint(
      participantPreContext,
      {
        sourceDurationMs: session.sourceDurationMs,
        sourceCastRosterId: session.sourceCastRosterId,
        transcriptSealOperationKey: session.transcriptSealOperationKey!,
        dialogueChapters: session.chapters,
        participantGroundingPlanFingerprint:
          participantPreContext.planFingerprint,
      },
    );
  const participantGroundingInputSignature =
    await createBroadcastParticipantGroundingInputSignature({
      inputSignature: session.inputSignature,
      transcriptSealOperationKey: session.transcriptSealOperationKey!,
      participantGroundingPlanFingerprint:
        participantPreContext.planFingerprint,
      participantGroundingCheckpointJson,
    });
  return {
    ...session,
    participantGroundingInputSignature,
    participantGroundingPlanFingerprint:
      participantPreContext.planFingerprint,
    participantGroundingCheckpointJson,
    contextInputSignature: "context-signature-v1",
    contextInputCheckpointJson: JSON.stringify({
      sourceDurationMs: session.sourceDurationMs,
      chapters: session.chapters,
      candidates: [],
      participantGrounding: participantPreContext.grounding,
      castRosterId: session.sourceCastRosterId,
      outputLanguage: "ko",
    }),
    contextResultJson: JSON.stringify({ schemaVersion: "1.7.0" }),
    refinementInputSignature: "refinement-signature-v1",
    refinementCandidatesJson: "[]",
  };
}

const completedBroadcastContextSessionFixture =
  await createCompletedBroadcastContextSessionFixture();

function makeCompletedBroadcastContextSession(): BroadcastContextSessionRecord {
  return structuredClone(completedBroadcastContextSessionFixture);
}

async function makeRefinementEvidenceLedgerJson(
  session: BroadcastContextSessionRecord,
): Promise<string> {
  const ledger = await createBroadcastRefinementEvidenceLedger({
    sourceFingerprint: session.inputSignature,
    sourceDurationMs: session.sourceDurationMs,
    selectedLeadPlan: {
      version: DISCOVERED_LEAD_REFINEMENT_VERSION,
      selectedLeadIds: [],
      segments: [],
      estimatedAsrCostUsd: 0,
    },
  });
  return serializeBroadcastRefinementEvidenceLedger(ledger);
}

function makeContextPhaseLedgerJson(
  session: BroadcastContextSessionRecord,
  contextInputSignature: string,
): string {
  if (
    session.transcriptSealOperationKey === null ||
    session.participantGroundingInputSignature === null
  ) {
    throw new TypeError("The test session must have complete ledger fences.");
  }
  return serializeBroadcastContextPhaseLedger(
    createBroadcastContextPhaseLedger({
      fence: {
        parentContextSignature: contextInputSignature,
        transcriptSignature: session.transcriptSealOperationKey,
        groundingSignature: session.participantGroundingInputSignature,
      },
      units: [
        {
          phase: "discovery",
          unitId: "chapter-1",
          inputDigest: "digest-1",
          operationId: `operation:${contextInputSignature}`,
          attemptOrdinal: 0,
          required: true,
        },
      ],
    }),
  );
}

const VISUAL_CANDIDATE: DurableHighlightCandidate = {
  id: "highlight-visual-1234abcd",
  peakMs: 30_000,
  startMs: 10_000,
  endMs: 55_000,
  score: 0.8,
  signalKinds: ["visual"],
  evidence: {
    normalization: "within-signal-rank-and-mad",
    visual: {
      rankPercentile: 1,
      robustPercentile: 0.75,
      normalizedScore: 0.9,
      sceneChangeStrength: 0.72,
    },
  },
};

const AUDIO_CANDIDATE: DurableHighlightCandidate = {
  id: "highlight-audio-chat-1234abcd",
  peakMs: 30_000,
  startMs: 2_000,
  endMs: 47_000,
  score: 0.94,
  signalKinds: ["audio", "chat"],
  evidence: {
    normalization: "within-signal-rank-and-mad",
    audio: {
      rankPercentile: 1,
      robustPercentile: 0.9,
      normalizedScore: 0.96,
      eventKind: "sustained-vocal-reaction",
      rmsLiftRatio: 3.2,
      sustainedWindowCount: 4,
      clickPenalty: 0,
      backgroundPenalty: 0.1,
    },
    chat: {
      rankPercentile: 0.9,
      robustPercentile: 0.85,
      normalizedScore: 0.88,
      bucketStartMs: 30_000,
      bucketEndMs: 35_000,
      messageCount: 40,
      uniqueAuthorCount: 25,
      reactionMessageCount: 18,
      baselineMessageCount: 8,
      baselineUniqueAuthorCount: 5,
      burstRatio: 4.8,
      robustBurstScore: 3,
      repetitionRatio: 0.1,
      singleAuthorRatio: 0.08,
      spamPenalty: 0,
    },
  },
};

function makeFinalPayload(
  candidates: readonly DurableHighlightCandidate[] = [VISUAL_CANDIDATE],
): DurableFinalResultPayload {
  return {
    input: {
      source: {
        sourceDefinitionId: "source-definition-1",
        contentFingerprint: SOURCE_FINGERPRINT,
        captionVideoId: null,
        sizeBytes: 4_000_000,
        durationMs: 120_000,
        kind: "video",
        container: "mp4",
      },
      chat: {
        timestampBasis: "unknown",
        importedRowCount: 0,
        offsetMs: 0,
      },
      candidateWindowMs: 45_000,
    },
    summary: {
      plannedFrameCount: 4,
      sampledFrameCount: 4,
      analyzedTransitionCount: 3,
      analyzedChatMessageCount: 0,
      outOfRangeChatMessageCount: 0,
      skippedChatMessageCount: 0,
      chatGapReasonCode: null,
      plannedAudioWindowCount: 120,
      analyzedAudioWindowCount: 120,
      audioGapReasonCode: null,
      candidateCount: candidates.length,
    },
    coverage: {
      visualPlannedSampleCount: 4,
      visualCompletedSampleCount: 4,
      visualCoverageComplete: true,
      chatPlannedMessageCount: 0,
      chatProcessedMessageCount: 0,
      chatCoverageComplete: true,
      chatGapReasonCode: null,
      audioPlannedWindowCount: 120,
      audioProcessedWindowCount: 120,
      audioCoverageComplete: true,
      audioGapReasonCode: null,
      signalGapApproval: null,
      activeTaskCountAtCommit: 0,
    },
    candidates,
  };
}

function makeManifest(runId = "run-1"): AnalysisManifestRecord {
  return {
    kind: "manifest",
    runId,
    artifactId: "manifest-artifact-1",
    schemaVersion: "0.3.0",
    inputSignature: INPUT_SIGNATURE,
    modelManifestHash: "streamer-reaction-fast-pass-v1",
    result: {
      input: makeFinalPayload().input,
      signalGapPolicy: {
        policyId: "local-available-signal-degradation-v2",
        disclosedBeforeStart: true,
        behavior:
          "complete-with-available-reaction-signals-and-documented-gaps",
      },
    },
    recordedAt: RECORDED_AT,
  };
}

function makeReactionPayload(
  audioGapReasonCode: "NO_AUDIO_TRACK" | null = null,
): DurableFinalResultPayload {
  const audioCoverageComplete = audioGapReasonCode === null;
  const candidates = audioCoverageComplete ? [AUDIO_CANDIDATE] : [];
  return {
    ...makeFinalPayload(candidates),
    summary: {
      ...makeFinalPayload(candidates).summary,
      plannedAudioWindowCount: 120,
      analyzedAudioWindowCount: audioCoverageComplete ? 120 : 0,
      audioGapReasonCode,
    },
    coverage: {
      visualPlannedSampleCount: 4,
      visualCompletedSampleCount: 4,
      visualCoverageComplete: true,
      chatPlannedMessageCount: 0,
      chatProcessedMessageCount: 0,
      chatCoverageComplete: true,
      chatGapReasonCode: null,
      audioPlannedWindowCount: 120,
      audioProcessedWindowCount: audioCoverageComplete ? 120 : 0,
      audioCoverageComplete,
      audioGapReasonCode,
      signalGapApproval: audioCoverageComplete
        ? null
        : {
            policyId: "local-available-signal-degradation-v2",
            disclosedBeforeStart: true,
            approvals: [
              {
                gapId: "audio-reaction-analysis",
                reason: "NO_AUDIO_TRACK",
                approvedBy: "local-available-signal-degradation-v2",
              },
            ],
          },
      activeTaskCountAtCommit: 0,
    },
  };
}

function makeReactionFinal(
  result: DurableFinalResultPayload = makeReactionPayload(),
): FinalAnalysisResultRecord {
  return {
    kind: "finalResult",
    runId: "run-reaction-1",
    artifactId: "result-reaction-1",
    schemaVersion: "0.3.0",
    inputSignature: INPUT_SIGNATURE,
    modelManifestHash: "streamer-reaction-fast-pass-v1",
    result,
    recordedAt: RECORDED_AT,
  };
}

function makeReactionManifest(): AnalysisManifestRecord {
  return {
    ...makeManifest("run-reaction-1"),
    artifactId: "manifest-reaction-1",
  };
}

function makeProvisional(runId = "run-1"): ProvisionalAnalysisResultRecord {
  return {
    ...makeManifest(runId),
    kind: "provisionalResult",
    artifactId: "provisional-artifact-1",
    result: makeFinalPayload(),
  };
}

function makeFinal(
  runId = "run-1",
  result: DurableFinalResultPayload = makeFinalPayload(),
): FinalAnalysisResultRecord {
  return {
    ...makeManifest(runId),
    kind: "finalResult",
    artifactId: "result-artifact-1",
    result,
  };
}

function makeFailure(runId = "run-1"): AnalysisFailureRecord {
  return {
    ...makeManifest(runId),
    kind: "failure",
    artifactId: "failure-artifact-1",
    result: { outcome: "failed", reasonCode: "LOCAL_ANALYSIS_FAILED" },
  };
}

function makeTerminal(
  runId = "run-1",
  outcome: AnalysisTerminalRecord["outcome"] = "completed",
): AnalysisTerminalRecord {
  const completed = outcome === "completed" || outcome === "completedWithGaps";
  return {
    kind: "terminalDisposition",
    runId,
    schemaVersion: "0.3.0",
    inputSignature: INPUT_SIGNATURE,
    modelManifestHash: "streamer-reaction-fast-pass-v1",
    outcome,
    resultRecordKind: completed ? "finalResult" : "failure",
    resultArtifactId: completed ? "result-artifact-1" : "failure-artifact-1",
    recordedAt: RECORDED_AT,
  };
}

function makeSourceSnapshot(
  sourceCheckId = "source-check-1",
): SourceCapabilitySnapshotRecord {
  return {
    kind: "sourceCapabilitySnapshot",
    sourceCheckId,
    sourceDefinitionId: "source-definition-1",
    bindingRevision: 3,
    schemaVersion: "0.3.0",
    browserCapabilitySignature: "wasm:1:1:0:0:0",
    preflightMetadata: {
      sourceDefinitionId: "source-definition-1",
      contentFingerprint: SOURCE_FINGERPRINT,
      captionVideoId: null,
      sizeBytes: 4_000_000,
      durationMs: 120_000,
      kind: "video",
      container: "mp4",
    },
    capabilities: {
      worker: true,
      webAssembly: true,
      webCodecsVideoDecoder: false,
      webGpu: false,
      crossOriginIsolated: false,
      preferredRuntimeTier: "wasm",
    },
    recordedAt: RECORDED_AT,
  };
}

function expectStoreError(
  error: unknown,
  code: AnalysisResultStoreError["code"],
): void {
  expect(error).toBeInstanceOf(AnalysisResultStoreError);
  expect(error).toMatchObject({ code });
}

describe("current ExClipper storage namespace", () => {
  it("opens a fresh namespace instead of the retired RettoHighlight database", () => {
    expect(DEFAULT_ANALYSIS_RESULT_DB_NAME).toBe(
      "exclipper-analysis-results-v1",
    );
    expect(ANALYSIS_RESULT_DB_VERSION).toBe(1);
  });
});

describe("InMemoryAnalysisResultStore contract", () => {
  it("rejects every legacy 0.2.x record instead of migrating it", async () => {
    const store = new InMemoryAnalysisResultStore();
    const manifest = {
      ...makeManifest("run-legacy-patch"),
      schemaVersion: "0.2.9",
    } as unknown as AnalysisManifestRecord;
    const final = {
      ...makeFinal("run-legacy-patch"),
      schemaVersion: "0.2.9",
    } as unknown as FinalAnalysisResultRecord;
    const terminal = {
      ...makeTerminal("run-legacy-patch"),
      schemaVersion: "0.2.9",
    } as unknown as AnalysisTerminalRecord;

    await expect(store.putManifest(manifest)).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
    await expect(store.putFinalResult(final)).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
    await expect(store.putTerminalRecord(terminal)).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });

  it("accepts reaction-first audio evidence and documented audio unavailability", async () => {
    const store = new InMemoryAnalysisResultStore();

    await expect(
      store.putManifest(makeReactionManifest()),
    ).resolves.toBeUndefined();
    await expect(
      store.putFinalResult(makeReactionFinal()),
    ).resolves.toBeUndefined();
    await expect(
      store.putFinalResult(
        makeReactionFinal(makeReactionPayload("NO_AUDIO_TRACK")),
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["summary audio evidence", "summary", "plannedAudioWindowCount"],
    ["audio coverage state", "coverage", "audioCoverageComplete"],
  ] as const)(
    "fails closed when current %s is missing",
    async (_label, section, missingKey) => {
      const store = new InMemoryAnalysisResultStore();
      const payload = makeReactionPayload();
      const incompleteSection = { ...payload[section] } as Record<string, unknown>;
      delete incompleteSection[missingKey];
      const incomplete = {
        ...payload,
        [section]: incompleteSection,
      };

      await expect(
        store.putFinalResult(makeReactionFinal(incomplete)),
      ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    },
  );

  it("fails closed when an audio candidate omits its claimed reaction evidence", async () => {
    const store = new InMemoryAnalysisResultStore();
    const payload = makeReactionPayload();
    const candidate = payload.candidates[0];
    if (candidate === undefined) {
      throw new Error("Expected an audio candidate fixture.");
    }
    const evidence = { ...candidate.evidence } as Record<string, unknown>;
    delete evidence.audio;
    const incomplete = {
      ...payload,
      candidates: [{ ...candidate, evidence }],
    } as unknown as DurableFinalResultPayload;

    await expect(
      store.putFinalResult(makeReactionFinal(incomplete)),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("rejects raw transcript fields added to otherwise safe audio evidence", async () => {
    const store = new InMemoryAnalysisResultStore();
    const payload = makeReactionPayload();
    const unsafe = {
      ...payload,
      candidates: payload.candidates.map((candidate) => ({
        ...candidate,
        evidence: {
          ...candidate.evidence,
          audio: {
            ...candidate.evidence.audio,
            transcript: "SECRET SPOKEN WORDS",
          },
        },
      })),
    } as unknown as DurableFinalResultPayload;

    await expect(
      store.putFinalResult(makeReactionFinal(unsafe)),
    ).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });

  it("stores each run artifact independently and replaces a final result by runId", async () => {
    const store = new InMemoryAnalysisResultStore();
    await store.putManifest(makeManifest());
    await store.putProvisionalResult(makeProvisional());
    await store.putFailureRecord(makeFailure());
    await store.putFinalResult(makeFinal("run-1", makeFinalPayload([])));
    await store.putFinalResult(makeFinal("run-1", makeFinalPayload()));
    await store.putTerminalRecord(makeTerminal());

    await expect(store.getFinalResult("run-1")).resolves.toMatchObject({
      kind: "finalResult",
      runId: "run-1",
      schemaVersion: "0.3.0",
      inputSignature: INPUT_SIGNATURE,
      modelManifestHash: "streamer-reaction-fast-pass-v1",
      result: { summary: { candidateCount: 1 } },
    });
    await expect(store.getTerminalRecord("run-1")).resolves.toEqual(
      makeTerminal(),
    );
  });

  it("uses one terminal disposition as the recovery authority even when artifacts coexist", async () => {
    const store = new InMemoryAnalysisResultStore();
    await store.putFinalResult(makeFinal());
    await store.putFailureRecord(makeFailure());
    await store.putTerminalRecord(makeTerminal("run-1", "failed"));

    await expect(store.getFinalResult("run-1")).resolves.not.toBeNull();
    await expect(store.getTerminalRecord("run-1")).resolves.toMatchObject({
      outcome: "failed",
      resultRecordKind: "failure",
    });
  });

  it("keeps the first terminal disposition while allowing an identical retry", async () => {
    const store = new InMemoryAnalysisResultStore();
    const completed = makeTerminal("run-write-once", "completed");

    await store.putTerminalRecord(completed);
    await expect(
      store.putTerminalRecord({ ...completed }),
    ).resolves.toBeUndefined();
    await expect(
      store.putTerminalRecord(makeTerminal("run-write-once", "failed")),
    ).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });

    await expect(store.getTerminalRecord("run-write-once")).resolves.toEqual(
      completed,
    );
  });

  it("atomically fills an absent fast-pass bundle and never replaces a conflicting writer", async () => {
    const store = new InMemoryAnalysisResultStore();
    const first = {
      manifest: makeManifest("run-atomic-fast-pass"),
      finalResult: makeFinal("run-atomic-fast-pass"),
      terminal: makeTerminal("run-atomic-fast-pass"),
    };
    const conflictingFinal = {
      ...first.finalResult,
      artifactId: "conflicting-final",
    };
    const conflict = {
      manifest: first.manifest,
      finalResult: conflictingFinal,
      terminal: {
        ...first.terminal,
        resultArtifactId: conflictingFinal.artifactId,
      },
    };

    await expect(
      store.commitFastPassResultBundleIfAbsent(first),
    ).resolves.toBe(true);
    await expect(
      store.commitFastPassResultBundleIfAbsent(conflict),
    ).resolves.toBe(false);
    await expect(
      store.commitFastPassResultBundleIfAbsent(first),
    ).resolves.toBe(true);
    await expect(
      store.getFinalResult("run-atomic-fast-pass"),
    ).resolves.toEqual(first.finalResult);
    await expect(
      store.getTerminalRecord("run-atomic-fast-pass"),
    ).resolves.toEqual(first.terminal);
  });

  it("rejects legacy payload shapes even when relabeled with the current version", async () => {
    const store = new InMemoryAnalysisResultStore();
    const legacyManifestWithReactionVersion = {
      ...makeManifest("run-manifest-legacy-as-reaction"),
      result: {
        input: makeFinalPayload().input,
        chatGapPolicy: {
          policyId: "local-chat-worker-degradation-v1",
          disclosedBeforeStart: true,
          behavior:
            "preserve-visual-result-and-complete-with-documented-chat-gap",
        },
      },
    } as unknown as AnalysisManifestRecord;
    const legacyFinalWithReactionVersion = {
      ...makeFinal("run-final-legacy-as-reaction"),
      result: {
        ...makeFinalPayload(),
        summary: {
          plannedFrameCount: 4,
          sampledFrameCount: 4,
          analyzedTransitionCount: 3,
          analyzedChatMessageCount: 0,
          outOfRangeChatMessageCount: 0,
          skippedChatMessageCount: 0,
          chatGapReasonCode: null,
          candidateCount: 1,
        },
        coverage: {
          visualPlannedSampleCount: 4,
          visualCompletedSampleCount: 4,
          visualCoverageComplete: true,
          chatPlannedMessageCount: 0,
          chatProcessedMessageCount: 0,
          chatCoverageComplete: true,
          chatGapReasonCode: null,
          chatGapApproval: null,
          activeTaskCountAtCommit: 0,
        },
      },
    } as unknown as FinalAnalysisResultRecord;

    await expect(
      store.putManifest(legacyManifestWithReactionVersion),
    ).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
    await expect(
      store.putFinalResult(legacyFinalWithReactionVersion),
    ).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });

  it("rejects unsupported future schemas for manifests, finals, and terminals", async () => {
    const store = new InMemoryAnalysisResultStore();

    await expect(
      store.putManifest({
        ...makeReactionManifest(),
        schemaVersion: "0.4.0",
      }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      store.putFinalResult({
        ...makeReactionFinal(),
        schemaVersion: "0.4.0",
      }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      store.putTerminalRecord(
        {
          ...makeTerminal("run-future"),
          schemaVersion: "0.4.0",
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("clones writes and reads so callers cannot mutate a committed result", async () => {
    const store = new InMemoryAnalysisResultStore();
    const input = makeFinal();
    await store.putFinalResult(input);

    const firstRead = await store.getFinalResult(input.runId);
    expect(firstRead).not.toBeNull();
    if (firstRead === null) {
      throw new Error("Expected a stored final result.");
    }

    const mutable = firstRead as unknown as {
      result: { candidates: Array<{ id: string }> };
    };
    mutable.result.candidates[0]!.id = "mutated";

    const secondRead = await store.getFinalResult(input.runId);
    expect(secondRead).not.toBe(firstRead);
    expect(secondRead).toEqual(input);
  });

  it("commits and reads back a JSON-only SourceCheck capability snapshot", async () => {
    const store = new InMemoryAnalysisResultStore();
    const snapshot = makeSourceSnapshot();

    await store.putSourceSnapshot(snapshot);
    const readBack = await store.getSourceSnapshot(snapshot.sourceCheckId);

    expect(readBack).toEqual(snapshot);
    expect(readBack).not.toBe(snapshot);
  });

  it.each([
    [
      "temporary Object URL",
      { previewUrl: "blob:https://example.test/temporary" },
    ],
    ["raw chat", { rawChat: [{ text: "original chat line" }] }],
    ["nickname", { nickname: "viewer-name" }],
    ["message collection", { messages: ["original chat line"] }],
    ["blacklist bypass", { entries: [{ speaker: "nick", body: "raw line" }] }],
  ])(
    "rejects %s in durable analysis payloads",
    async (_label, unsafeResult) => {
      const store = new InMemoryAnalysisResultStore();
      await expect(
        store.putFinalResult(
          makeFinal(
            "run-unsafe",
            unsafeResult as unknown as DurableFinalResultPayload,
          ),
        ),
      ).rejects.toSatisfy((error: unknown) => {
        expectStoreError(error, "INVALID_PAYLOAD");
        return true;
      });
    },
  );

  it("rejects raw chat aliases hidden inside otherwise valid allowlisted payloads", async () => {
    const valid = makeFinalPayload();
    const candidate = valid.candidates[0];
    if (candidate === undefined) {
      throw new Error("Expected a candidate fixture.");
    }
    const hiddenPayloads = [
      {
        ...valid,
        entries: [{ speaker: "nick", body: "raw line" }],
      },
      {
        ...valid,
        candidates: [{ ...candidate, reason: "raw line" }],
      },
      {
        ...valid,
        candidates: [
          {
            ...candidate,
            evidence: {
              ...candidate.evidence,
              entries: [{ speaker: "nick", body: "raw line" }],
            },
          },
        ],
      },
    ];

    for (const [index, payload] of hiddenPayloads.entries()) {
      const store = new InMemoryAnalysisResultStore();
      await expect(
        store.putFinalResult(
          makeFinal(
            `run-hidden-${index}`,
            payload as unknown as DurableFinalResultPayload,
          ),
        ),
      ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    }
  });

  it("rejects arbitrary source strings, terminal extras, and accessor-backed data", async () => {
    const store = new InMemoryAnalysisResultStore();
    const sourceWithRawMime = {
      ...makeSourceSnapshot("source-check-extra"),
      preflightMetadata: {
        ...makeSourceSnapshot().preflightMetadata,
        mimeType: "raw line",
      },
    } as unknown as SourceCapabilitySnapshotRecord;
    await expect(
      store.putSourceSnapshot(sourceWithRawMime),
    ).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });

    const terminalWithExtra = {
      ...makeTerminal("run-terminal-extra"),
      body: "raw line",
    } as unknown as AnalysisTerminalRecord;
    await expect(
      store.putTerminalRecord(terminalWithExtra),
    ).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });

    const accessorPayload = makeFinalPayload() as unknown as Record<
      string,
      unknown
    >;
    Object.defineProperty(accessorPayload, "entries", {
      enumerable: true,
      get: () => [{ speaker: "nick", body: "raw line" }],
    });
    await expect(
      store.putFinalResult(
        makeFinal(
          "run-accessor",
          accessorPayload as unknown as DurableFinalResultPayload,
        ),
      ),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("rejects final results whose candidate and coverage invariants do not close", async () => {
    const valid = makeFinalPayload();
    const candidate = valid.candidates[0];
    if (candidate === undefined) {
      throw new Error("Expected a candidate fixture.");
    }
    const invalidPayloads = [
      {
        ...valid,
        summary: { ...valid.summary, candidateCount: 2 },
      },
      {
        ...valid,
        candidates: [candidate, candidate],
        summary: { ...valid.summary, candidateCount: 2 },
      },
      {
        ...valid,
        candidates: [
          { ...candidate, endMs: valid.input.source.durationMs + 1 },
        ],
      },
      {
        ...valid,
        coverage: {
          ...valid.coverage,
          chatPlannedMessageCount: 4,
          chatProcessedMessageCount: 0,
          chatCoverageComplete: false,
        },
      },
    ];

    for (const [index, payload] of invalidPayloads.entries()) {
      const store = new InMemoryAnalysisResultStore();
      await expect(
        store.putFinalResult(makeFinal(`run-invariant-${index}`, payload)),
      ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    }
  });

  it("rejects File/handle-like non-JSON objects from analysis and source snapshots", async () => {
    class FakeFileSystemHandle {}

    const store = new InMemoryAnalysisResultStore();
    const unsafeObject = new FakeFileSystemHandle();
    await expect(
      store.putFinalResult(
        makeFinal(
          "run-handle",
          unsafeObject as unknown as DurableFinalResultPayload,
        ),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });

    const unsafeSource = {
      ...makeSourceSnapshot("source-check-handle"),
      capabilities: { decoder: true, sourceHandle: unsafeObject },
    } as unknown as SourceCapabilitySnapshotRecord;
    await expect(store.putSourceSnapshot(unsafeSource)).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });

  it("returns null for missing records and rejects operations after close", async () => {
    const store = new InMemoryAnalysisResultStore();
    await expect(store.getManifest("missing-run")).resolves.toBeNull();
    await expect(store.getFinalResult("missing-run")).resolves.toBeNull();
    await expect(store.getTerminalRecord("missing-run")).resolves.toBeNull();
    await expect(store.getSourceSnapshot("missing-check")).resolves.toBeNull();

    store.close();
    await expect(store.putFinalResult(makeFinal())).rejects.toMatchObject({
      code: "STORE_CLOSED",
    });
    await expect(store.getFinalResult("run-1")).rejects.toMatchObject({
      code: "STORE_CLOSED",
    });
  });

  it("lists terminal records newest first without exposing mutable store state", async () => {
    const store = new InMemoryAnalysisResultStore();
    await store.putTerminalRecord({
      ...makeTerminal("run-old"),
      recordedAt: "2026-07-18T12:34:56.000Z",
    });
    await store.putTerminalRecord({
      ...makeTerminal("run-new"),
      recordedAt: "2026-07-20T12:34:56.000Z",
    });

    const catalog = await store.listTerminalRecords();
    expect(catalog.rejectedRecordCount).toBe(0);
    expect(catalog.records.map(({ runId }) => runId)).toEqual([
      "run-new",
      "run-old",
    ]);
  });

  it("atomically replaces a broadcast context session only from the exact snapshot", async () => {
    const store = new InMemoryAnalysisResultStore();
    const original = makeBroadcastContextSession();
    const replacement = {
      ...original,
      recordedAt: "2026-07-19T12:35:00.000Z",
    };
    await store.putBroadcastContextSession(original);

    await expect(
      store.replaceBroadcastContextSessionIfUnchanged(
        { ...original, modelRevision: "stale-revision" },
        replacement,
      ),
    ).resolves.toBe(false);
    await expect(
      store.replaceBroadcastContextSessionIfUnchanged(original, replacement),
    ).resolves.toBe(true);
    await expect(
      store.getBroadcastContextSession(original.runId),
    ).resolves.toEqual(replacement);
  });

  it("reloads a participant grounding fence with the exact persisted plan fingerprint", async () => {
    const store = new InMemoryAnalysisResultStore();
    const completed = makeCompletedBroadcastContextSession();
    if (
      completed.transcriptSealOperationKey === null ||
      completed.participantGroundingPlanFingerprint === null ||
      completed.participantGroundingCheckpointJson === null
    ) {
      throw new TypeError("The completed test session must be fully grounded.");
    }
    const participantGroundingInputSignature =
      await createBroadcastParticipantGroundingInputSignature(
        {
          inputSignature: completed.inputSignature,
          transcriptSealOperationKey:
            completed.transcriptSealOperationKey,
          participantGroundingPlanFingerprint:
            completed.participantGroundingPlanFingerprint,
          participantGroundingCheckpointJson:
            completed.participantGroundingCheckpointJson,
        },
        null,
      );
    await store.putBroadcastContextSession({
      ...completed,
      participantGroundingInputSignature,
    });

    const reopened = await store.getBroadcastContextSession(completed.runId);
    expect(reopened).not.toBeNull();
    if (
      reopened === null ||
      reopened.transcriptSealOperationKey === null ||
      reopened.participantGroundingPlanFingerprint === null ||
      reopened.participantGroundingCheckpointJson === null
    ) {
      throw new TypeError("The reloaded test session must be fully grounded.");
    }
    await expect(
      createBroadcastParticipantGroundingInputSignature(
        {
          inputSignature: reopened.inputSignature,
          transcriptSealOperationKey:
            reopened.transcriptSealOperationKey,
          participantGroundingPlanFingerprint:
            reopened.participantGroundingPlanFingerprint,
          participantGroundingCheckpointJson:
            reopened.participantGroundingCheckpointJson,
        },
        null,
      ),
    ).resolves.toBe(reopened.participantGroundingInputSignature);
  });

  it("atomically checkpoints transcript chapters and resolved abstention evidence together", async () => {
    const store = new InMemoryAnalysisResultStore();
    const original = makeBroadcastContextSession();
    const transcriptInputSignature = "transcript-plan-signature-v1";
    const checkpoint = {
      completeAudioCoverage: true,
      chapters: [],
      gapChunkIds: [],
      fragmentGaps: [],
      transcriptEvidenceInputSignature: transcriptInputSignature,
      transcriptEvidenceCheckpointJson:
        makeTranscriptEvidenceCheckpointJson(transcriptInputSignature),
      transcriptProviderReceiptInputSignature: null,
      transcriptProviderReceiptCheckpointJson: null,
      modelRevision: original.modelRevision,
      transcriptSealOperationKey: transcriptInputSignature,
      recordedAt: "2026-07-19T12:35:00.000Z",
    };
    await store.putBroadcastContextSession(original);

    await expect(
      checkpointBroadcastContextSessionTranscriptIfUnchanged(
        store,
        original,
        checkpoint,
      ),
    ).resolves.toBe(true);
    await expect(
      checkpointBroadcastContextSessionTranscriptIfUnchanged(
        store,
        original,
        checkpoint,
      ),
    ).resolves.toBe(false);
    await expect(
      store.getBroadcastContextSession(original.runId),
    ).resolves.toMatchObject({
      chapters: [],
      gapChunkIds: [],
      transcriptEvidenceInputSignature: transcriptInputSignature,
      transcriptEvidenceCheckpointJson:
        checkpoint.transcriptEvidenceCheckpointJson,
      transcriptProviderReceiptInputSignature: null,
      transcriptProviderReceiptCheckpointJson: null,
      transcriptSealOperationKey: transcriptInputSignature,
    });
  });

  it("atomically checkpoints an exact-fence phase ledger and rejects a stale writer", async () => {
    const store = new InMemoryAnalysisResultStore();
    const completed = makeCompletedBroadcastContextSession();
    const grounded = {
      ...completed,
      contextInputSignature: null,
      contextInputCheckpointJson: null,
      contextPhaseLedgerJson: null,
      contextResultJson: null,
      refinementInputSignature: null,
      refinementCandidatesJson: null,
    };
    const checkpoint = {
      contextInputSignature: "context-signature-v1",
      contextInputCheckpointJson:
        completed.contextInputCheckpointJson as string,
      contextPhaseLedgerJson: makeContextPhaseLedgerJson(
        grounded,
        "context-signature-v1",
      ),
      recordedAt: "2026-07-19T12:35:00.000Z",
    };
    await store.putBroadcastContextSession(grounded);

    await expect(
      checkpointBroadcastContextSessionPhaseLedgerIfUnchanged(
        store,
        grounded,
        checkpoint,
      ),
    ).resolves.toBe(true);
    await expect(
      checkpointBroadcastContextSessionPhaseLedgerIfUnchanged(
        store,
        grounded,
        checkpoint,
      ),
    ).resolves.toBe(false);
    await expect(
      store.getBroadcastContextSession(grounded.runId),
    ).resolves.toMatchObject({
      contextInputSignature: "context-signature-v1",
      contextPhaseLedgerJson: checkpoint.contextPhaseLedgerJson,
      contextResultJson: null,
    });
  });

  it("atomically checkpoints refinement transcript evidence and rejects a stale writer", async () => {
    const store = new InMemoryAnalysisResultStore();
    const original = makeCompletedBroadcastContextSession();
    const checkpoint = {
      refinementTranscriptInputSignature:
        "refinement-transcript-signature-v1",
      refinementTranscriptCheckpointJson:
        makeRefinementTranscriptCheckpointJson(),
      recordedAt: "2026-07-19T12:35:00.000Z",
    };
    await store.putBroadcastContextSession(original);

    await expect(
      checkpointBroadcastContextSessionRefinementTranscriptIfUnchanged(
        store,
        original,
        checkpoint,
      ),
    ).resolves.toBe(true);
    await expect(
      checkpointBroadcastContextSessionRefinementTranscriptIfUnchanged(
        store,
        original,
        checkpoint,
      ),
    ).resolves.toBe(false);
    await expect(
      store.getBroadcastContextSession(original.runId),
    ).resolves.toMatchObject({
      contextInputSignature: original.contextInputSignature,
      contextResultJson: original.contextResultJson,
      refinementTranscriptInputSignature:
        checkpoint.refinementTranscriptInputSignature,
      refinementTranscriptCheckpointJson:
        checkpoint.refinementTranscriptCheckpointJson,
      refinementInputSignature: null,
      refinementCandidatesJson: null,
    });
  });

  it("checkpoints a canonical refinement evidence ledger and returns its exact durable readback", async () => {
    const store = new InMemoryAnalysisResultStore();
    const original = makeCompletedBroadcastContextSession();
    const refinementEvidenceLedgerJson =
      await makeRefinementEvidenceLedgerJson(original);
    await store.putBroadcastContextSession(original);

    const readback =
      await checkpointBroadcastContextSessionRefinementEvidenceLedgerWithReadback(
        store,
        original,
        {
          refinementEvidenceLedgerJson,
          recordedAt: "2026-07-19T12:35:00.000Z",
        },
      );

    expect(readback).toMatchObject({
      refinementEvidenceLedgerJson,
      refinementInputSignature: null,
      refinementCandidatesJson: null,
      recordedAt: "2026-07-19T12:35:00.000Z",
    });
    expect(readback).not.toBe(original);
    await expect(
      store.getBroadcastContextSession(original.runId),
    ).resolves.toEqual(readback);
  });

  it("rejects a stale refinement evidence ledger writer before readback", async () => {
    const store = new InMemoryAnalysisResultStore();
    const original = makeCompletedBroadcastContextSession();
    await store.putBroadcastContextSession(original);
    const newer = {
      ...original,
      recordedAt: "2026-07-19T12:34:59.000Z",
    };
    await expect(
      store.replaceBroadcastContextSessionIfUnchanged(original, newer),
    ).resolves.toBe(true);

    await expect(
      checkpointBroadcastContextSessionRefinementEvidenceLedgerWithReadback(
        store,
        original,
        {
          refinementEvidenceLedgerJson:
            await makeRefinementEvidenceLedgerJson(original),
          recordedAt: "2026-07-19T12:35:00.000Z",
        },
      ),
    ).rejects.toThrow(/durable session changed/u);
    await expect(
      store.getBroadcastContextSession(original.runId),
    ).resolves.toEqual(newer);
  });

  it("rejects a committed refinement evidence checkpoint whose readback is missing", async () => {
    const original = makeCompletedBroadcastContextSession();
    await expect(
      checkpointBroadcastContextSessionRefinementEvidenceLedgerWithReadback(
        {
          replaceBroadcastContextSessionIfUnchanged() {
            return Promise.resolve(true);
          },
          getBroadcastContextSession() {
            return Promise.resolve(null);
          },
        },
        original,
        {
          refinementEvidenceLedgerJson:
            await makeRefinementEvidenceLedgerJson(original),
          recordedAt: "2026-07-19T12:35:00.000Z",
        },
      ),
    ).rejects.toThrow(/readback is missing/u);
  });

  it("rejects a committed refinement evidence checkpoint whose readback is non-canonical", async () => {
    const original = makeCompletedBroadcastContextSession();
    const refinementEvidenceLedgerJson =
      await makeRefinementEvidenceLedgerJson(original);
    let written: BroadcastContextSessionRecord | null = null;
    await expect(
      checkpointBroadcastContextSessionRefinementEvidenceLedgerWithReadback(
        {
          replaceBroadcastContextSessionIfUnchanged(_expected, replacement) {
            written = replacement;
            return Promise.resolve(true);
          },
          getBroadcastContextSession() {
            return Promise.resolve(
              written === null
                ? null
                : {
                    ...written,
                    refinementEvidenceLedgerJson: ` ${refinementEvidenceLedgerJson}`,
                  },
            );
          },
        },
        original,
        {
          refinementEvidenceLedgerJson,
          recordedAt: "2026-07-19T12:35:00.000Z",
        },
      ),
    ).rejects.toThrow(/readback is invalid/u);
  });

  it("rejects a stale safe writer without erasing the newer context", async () => {
    const store = new InMemoryAnalysisResultStore();
    const original = makeCompletedBroadcastContextSession();
    await store.putBroadcastContextSession(original);

    await expect(
      commitBroadcastContextSessionContextIfUnchanged(store, original, {
        contextInputSignature: "context-signature-v2",
        contextInputCheckpointJson:
          original.contextInputCheckpointJson as string,
        contextResultJson: JSON.stringify({
          schemaVersion: "1.7.0",
          broadcastSummaryKo: "new context",
        }),
        recordedAt: "2026-07-19T12:35:00.000Z",
      }),
    ).resolves.toBe(true);
    const committed = await store.getBroadcastContextSession(original.runId);
    expect(committed).toMatchObject({
      contextInputSignature: "context-signature-v2",
      refinementInputSignature: null,
      refinementCandidatesJson: null,
    });

    await expect(
      invalidateBroadcastContextSessionContextIfUnchanged(
        store,
        original,
        "2026-07-19T12:36:00.000Z",
      ),
    ).resolves.toBe(false);
    await expect(
      store.getBroadcastContextSession(original.runId),
    ).resolves.toEqual(committed);
  });

  it("atomically invalidates the context and refinement for retry", async () => {
    const store = new InMemoryAnalysisResultStore();
    const original = makeCompletedBroadcastContextSession();
    await store.putBroadcastContextSession(original);

    await expect(
      invalidateBroadcastContextSessionContextIfUnchanged(
        store,
        original,
        "2026-07-19T12:35:00.000Z",
      ),
    ).resolves.toBe(true);
    await expect(
      store.getBroadcastContextSession(original.runId),
    ).resolves.toMatchObject({
      contextInputSignature: null,
      contextInputCheckpointJson: null,
      contextPhaseLedgerJson: null,
      contextResultJson: null,
      refinementTranscriptInputSignature: null,
      refinementTranscriptCheckpointJson: null,
      refinementInputSignature: null,
      refinementCandidatesJson: null,
      recordedAt: "2026-07-19T12:35:00.000Z",
    });
  });
});

type FakeEventHandler = ((this: unknown, event: Event) => unknown) | null;

function fakeEvent(type: string): Event {
  return { type } as Event;
}

class ControlledRequest {
  public result: unknown = undefined;
  public error: DOMException | null = null;
  public onsuccess: FakeEventHandler = null;
  public onerror: FakeEventHandler = null;

  public succeed(result: unknown): void {
    this.result = result;
    this.onsuccess?.call(this, fakeEvent("success"));
  }

  public fail(): void {
    this.error = new DOMException("Request failed", "UnknownError");
    this.onerror?.call(this, fakeEvent("error"));
  }
}

class ControlledOpenRequest extends ControlledRequest {
  public onupgradeneeded: FakeEventHandler = null;
  public onblocked: FakeEventHandler = null;
  public transaction: IDBTransaction | null = null;

  public upgrade(): void {
    this.onupgradeneeded?.call(this, fakeEvent("upgradeneeded"));
  }

  public block(): void {
    this.onblocked?.call(this, fakeEvent("blocked"));
  }
}

type TransactionOutcome = "error" | "abort";

class ControlledTransaction {
  public error: DOMException | null = null;
  public oncomplete: FakeEventHandler = null;
  public onerror: FakeEventHandler = null;
  public onabort: FakeEventHandler = null;
  public request: ControlledRequest | null = null;
  public written: unknown = undefined;
  public writeOperation: "add" | "put" | null = null;
  public readonly storeNames: readonly string[];
  private readonly requestsByStore = new Map<
    string,
    ControlledRequest[]
  >();

  public constructor(
    public readonly mode: IDBTransactionMode,
    storeNames: string | readonly string[],
  ) {
    this.storeNames =
      typeof storeNames === "string" ? [storeNames] : [...storeNames];
  }

  public requestsFor(storeName: string): readonly ControlledRequest[] {
    return this.requestsByStore.get(storeName) ?? [];
  }

  private requestFor(storeName: string): ControlledRequest {
    const request = new ControlledRequest();
    const requests = this.requestsByStore.get(storeName) ?? [];
    requests.push(request);
    this.requestsByStore.set(storeName, requests);
    this.request = request;
    return request;
  }

  public objectStore(requestedStoreName: string): IDBObjectStore {
    if (!this.storeNames.includes(requestedStoreName)) {
      throw new DOMException("Unknown object store", "NotFoundError");
    }

    const objectStore = {
      keyPath:
        requestedStoreName === ANALYSIS_RESULT_OBJECT_STORES.sourceSnapshots
          ? "sourceCheckId"
          : requestedStoreName === ANALYSIS_RESULT_OBJECT_STORES.jobs
            ? "jobId"
            : "runId",
      put: (value: unknown) => {
        this.written = value;
        this.writeOperation = "put";
        return this.requestFor(
          requestedStoreName,
        ) as unknown as IDBRequest<IDBValidKey>;
      },
      add: (value: unknown) => {
        this.written = value;
        this.writeOperation = "add";
        return this.requestFor(
          requestedStoreName,
        ) as unknown as IDBRequest<IDBValidKey>;
      },
      get: () => {
        return this.requestFor(
          requestedStoreName,
        ) as unknown as IDBRequest<unknown>;
      },
      getAll: () => {
        return this.requestFor(
          requestedStoreName,
        ) as unknown as IDBRequest<unknown[]>;
      },
    };
    return objectStore as unknown as IDBObjectStore;
  }

  public complete(): void {
    this.oncomplete?.call(this, fakeEvent("complete"));
  }

  public fail(outcome: TransactionOutcome): void {
    this.error = new DOMException(`Transaction ${outcome}`, "UnknownError");
    if (outcome === "error") {
      this.onerror?.call(this, fakeEvent("error"));
      return;
    }
    this.onabort?.call(this, fakeEvent("abort"));
  }

  public abort(): void {
    this.fail("abort");
  }
}

class FakeIndexedDbHarness {
  public readonly createdStores: Set<string>;
  public readonly factory: IDBFactory;
  public closeCount = 0;
  private readonly keyPaths = new Map<string, string>();
  private readonly queuedTransactions: ControlledTransaction[] = [];
  private readonly transactionWaiters: Array<
    (transaction: ControlledTransaction) => void
  > = [];

  public constructor(initialKeyPaths: Readonly<Record<string, string>> = {}) {
    this.createdStores = new Set(Object.keys(initialKeyPaths));
    for (const [storeName, keyPath] of Object.entries(initialKeyPaths)) {
      this.keyPaths.set(storeName, keyPath);
    }

    const database = {
      objectStoreNames: {
        contains: (storeName: string) => this.createdStores.has(storeName),
      },
      createObjectStore: (storeName: string) => {
        this.createdStores.add(storeName);
        const keyPath =
          storeName === ANALYSIS_RESULT_OBJECT_STORES.sourceSnapshots
            ? "sourceCheckId"
            : "runId";
        this.keyPaths.set(storeName, keyPath);
        return { keyPath } as IDBObjectStore;
      },
      transaction: (
        storeNames: string | string[],
        mode: IDBTransactionMode,
      ) => {
        const names =
          typeof storeNames === "string" ? [storeNames] : storeNames;
        if (names.some((storeName) => !this.createdStores.has(storeName))) {
          throw new DOMException("Unknown object store", "NotFoundError");
        }
        const transaction = new ControlledTransaction(mode, names);
        this.enqueueTransaction(transaction);
        return transaction as unknown as IDBTransaction;
      },
      close: () => {
        this.closeCount += 1;
      },
      onversionchange: null,
    } as unknown as IDBDatabase;

    this.factory = {
      open: () => {
        const request = new ControlledOpenRequest();
        request.result = database;
        request.transaction = {
          objectStore: (storeName: string) =>
            ({
              keyPath: this.keyPaths.get(storeName) ?? null,
            }) as IDBObjectStore,
          abort: () => {
            request.fail();
          },
        } as unknown as IDBTransaction;
        queueMicrotask(() => {
          request.upgrade();
          queueMicrotask(() => {
            request.succeed(database);
          });
        });
        return request as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;
  }

  public takeTransaction(): Promise<ControlledTransaction> {
    const transaction = this.queuedTransactions.shift();
    if (transaction !== undefined) {
      return Promise.resolve(transaction);
    }
    return new Promise<ControlledTransaction>((resolve) => {
      this.transactionWaiters.push(resolve);
    });
  }

  private enqueueTransaction(transaction: ControlledTransaction): void {
    const waiter = this.transactionWaiters.shift();
    if (waiter !== undefined) {
      waiter(transaction);
      return;
    }
    this.queuedTransactions.push(transaction);
  }
}

describe("IndexedDbAnalysisResultStore transaction contract", () => {
  it("creates every versioned object store and resolves writes only on transaction complete", async () => {
    const harness = new FakeIndexedDbHarness();
    const store = new IndexedDbAnalysisResultStore({
      dbName: "transaction-complete-test",
      factory: harness.factory,
    });
    const record = makeFinal();
    const operation = store.putFinalResult(record);
    const transaction = await harness.takeTransaction();
    let resolved = false;
    void operation.then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(transaction.mode).toBe("readwrite");
    expect(transaction.written).toEqual(record);
    expect(harness.createdStores).toEqual(
      new Set(Object.values(ANALYSIS_RESULT_OBJECT_STORES)),
    );

    transaction.complete();
    await expect(operation).resolves.toBeUndefined();
    expect(resolved).toBe(true);
  });

  it.each<TransactionOutcome>(["error", "abort"])(
    "rejects a write transaction on %s",
    async (outcome) => {
      const harness = new FakeIndexedDbHarness();
      const store = new IndexedDbAnalysisResultStore({
        dbName: `transaction-${outcome}-test`,
        factory: harness.factory,
      });
      const operation = store.putFinalResult(makeFinal());
      const transaction = await harness.takeTransaction();

      transaction.fail(outcome);
      await expect(operation).rejects.toMatchObject({
        code: "TRANSACTION_FAILED",
      });
    },
  );

  it("uses one readwrite transaction to add the first terminal and makes identical retries idempotent", async () => {
    const harness = new FakeIndexedDbHarness();
    const store = new IndexedDbAnalysisResultStore({
      dbName: "terminal-write-once-test",
      factory: harness.factory,
    });
    const completed = makeTerminal("run-write-once", "completed");

    const firstOperation = store.putTerminalRecord(completed);
    const firstTransaction = await harness.takeTransaction();
    expect(firstTransaction.mode).toBe("readwrite");
    const firstGetRequest = firstTransaction.request;
    expect(firstGetRequest).not.toBeNull();
    firstGetRequest?.succeed(undefined);
    expect(firstTransaction.writeOperation).toBe("add");
    expect(firstTransaction.written).toEqual(completed);
    firstTransaction.request?.succeed(completed.runId);
    firstTransaction.complete();
    await expect(firstOperation).resolves.toBeUndefined();

    const retryOperation = store.putTerminalRecord({ ...completed });
    const retryTransaction = await harness.takeTransaction();
    const retryGetRequest = retryTransaction.request;
    retryGetRequest?.succeed({ ...completed });
    expect(retryTransaction.writeOperation).toBeNull();
    retryTransaction.complete();
    await expect(retryOperation).resolves.toBeUndefined();
  });

  it("commits a fast-pass bundle with insert-if-absent requests in one transaction", async () => {
    const harness = new FakeIndexedDbHarness();
    const store = new IndexedDbAnalysisResultStore({
      dbName: "fast-pass-atomic-bundle-test",
      factory: harness.factory,
    });
    const bundle = {
      manifest: makeManifest("run-fast-pass-atomic"),
      finalResult: makeFinal("run-fast-pass-atomic"),
      terminal: makeTerminal("run-fast-pass-atomic"),
    };

    const operation = store.commitFastPassResultBundleIfAbsent(bundle);
    const transaction = await harness.takeTransaction();
    expect(transaction.mode).toBe("readwrite");
    expect(new Set(transaction.storeNames)).toEqual(
      new Set([
        ANALYSIS_RESULT_OBJECT_STORES.manifests,
        ANALYSIS_RESULT_OBJECT_STORES.finalResults,
        ANALYSIS_RESULT_OBJECT_STORES.terminals,
      ]),
    );

    transaction.requestsFor(
      ANALYSIS_RESULT_OBJECT_STORES.manifests,
    )[0]?.succeed(undefined);
    transaction.requestsFor(
      ANALYSIS_RESULT_OBJECT_STORES.finalResults,
    )[0]?.succeed(undefined);
    transaction.requestsFor(
      ANALYSIS_RESULT_OBJECT_STORES.terminals,
    )[0]?.succeed(undefined);
    expect(transaction.writeOperation).toBe("add");
    transaction.requestsFor(
      ANALYSIS_RESULT_OBJECT_STORES.manifests,
    )[1]?.succeed(bundle.manifest.runId);
    transaction.requestsFor(
      ANALYSIS_RESULT_OBJECT_STORES.finalResults,
    )[1]?.succeed(bundle.finalResult.runId);
    transaction.requestsFor(
      ANALYSIS_RESULT_OBJECT_STORES.terminals,
    )[1]?.succeed(bundle.terminal.runId);
    transaction.complete();

    await expect(operation).resolves.toBe(true);
  });

  it("rejects a completed-to-failed terminal overwrite before issuing a write", async () => {
    const harness = new FakeIndexedDbHarness();
    const store = new IndexedDbAnalysisResultStore({
      dbName: "terminal-conflict-test",
      factory: harness.factory,
    });
    const completed = makeTerminal("run-terminal-conflict", "completed");
    const conflictOperation = store.putTerminalRecord(
      makeTerminal("run-terminal-conflict", "failed"),
    );
    const conflictExpectation = expect(conflictOperation).rejects.toMatchObject(
      {
        code: "TRANSACTION_FAILED",
      },
    );
    const transaction = await harness.takeTransaction();

    transaction.request?.succeed(completed);

    await conflictExpectation;
    expect(transaction.writeOperation).toBeNull();
    expect(transaction.written).toBeUndefined();
  });

  it("aborts an upgrade instead of replacing an object store with an incompatible key path", async () => {
    const harness = new FakeIndexedDbHarness({
      [ANALYSIS_RESULT_OBJECT_STORES.manifests]: "wrongKey",
    });
    const store = new IndexedDbAnalysisResultStore({
      dbName: "schema-mismatch-test",
      factory: harness.factory,
    });

    await expect(store.getFinalResult("run-1")).rejects.toMatchObject({
      code: "SCHEMA_MISMATCH",
    });
    await Promise.resolve();
    expect(harness.closeCount).toBe(1);
  });

  it("does not expose a SourceCheck snapshot until its write commits, then supports readback", async () => {
    const harness = new FakeIndexedDbHarness();
    const store = new IndexedDbAnalysisResultStore({
      dbName: "source-readback-test",
      factory: harness.factory,
    });
    const snapshot = makeSourceSnapshot();

    const putOperation = store.putSourceSnapshot(snapshot);
    const writeTransaction = await harness.takeTransaction();
    let putResolved = false;
    void putOperation.then(() => {
      putResolved = true;
    });
    await Promise.resolve();
    expect(putResolved).toBe(false);
    writeTransaction.complete();
    await expect(putOperation).resolves.toBeUndefined();

    const getOperation = store.getSourceSnapshot(snapshot.sourceCheckId);
    const readTransaction = await harness.takeTransaction();
    expect(readTransaction.request).not.toBeNull();
    readTransaction.request?.succeed(writeTransaction.written);

    let getResolved = false;
    void getOperation.then(() => {
      getResolved = true;
    });
    await Promise.resolve();
    expect(getResolved).toBe(false);

    readTransaction.complete();
    await expect(getOperation).resolves.toEqual(snapshot);
    expect(getResolved).toBe(true);
  });

  it("performs broadcast context compare-and-swap in one readwrite transaction", async () => {
    const harness = new FakeIndexedDbHarness();
    const store = new IndexedDbAnalysisResultStore({
      dbName: "broadcast-context-cas-test",
      factory: harness.factory,
    });
    const original = makeBroadcastContextSession();
    const replacement = {
      ...original,
      recordedAt: "2026-07-19T12:35:00.000Z",
    };
    const operation = store.replaceBroadcastContextSessionIfUnchanged(
      original,
      replacement,
    );
    const transaction = await harness.takeTransaction();
    expect(transaction.mode).toBe("readwrite");
    const readRequest = transaction.request;
    readRequest?.succeed(original);
    expect(transaction.writeOperation).toBe("put");
    expect(transaction.written).toEqual(replacement);
    transaction.request?.succeed(original.runId);
    transaction.complete();

    await expect(operation).resolves.toBe(true);
  });

  it("performs analysis job compare-and-swap in one readwrite transaction", async () => {
    const harness = new FakeIndexedDbHarness();
    const store = new IndexedDbAnalysisResultStore({
      dbName: "analysis-job-cas-test",
      factory: harness.factory,
    });
    const original: AnalysisJobRecord = {
      schemaVersion: ANALYSIS_JOB_RECORD_SCHEMA_VERSION,
      jobId: "job-cas-1",
      job: createAnalysisJob({
        jobId: "job-cas-1",
        identity: {
          scheme: "local-file-sampled-sha256-v1",
          key: "job-cas-key",
        },
      }),
      lastActivityAt: RECORDED_AT,
      bytes: 0,
    };
    const replacement = {
      ...original,
      lastActivityAt: "2026-07-19T12:35:00.000Z",
    };
    const operation = store.replaceJobIfUnchanged(original, replacement);
    const transaction = await harness.takeTransaction();
    expect(transaction.mode).toBe("readwrite");
    transaction.request?.succeed(original);
    expect(transaction.writeOperation).toBe("put");
    expect(transaction.written).toEqual(replacement);
    transaction.request?.succeed(original.jobId);
    transaction.complete();

    await expect(operation).resolves.toBe(true);
  });

  it("atomically compares all completion records and writes the job in one IndexedDB transaction", async () => {
    const harness = new FakeIndexedDbHarness();
    const store = new IndexedDbAnalysisResultStore({
      dbName: "analysis-completion-cas-test",
      factory: harness.factory,
    });
    const snapshot = await makeAnalysisCompletionSnapshot();
    const original = makeCompletionJobRecord(snapshot);
    const replacement = makeCompletedJobRecord(original);

    const operation = store.replaceJobIfAnalysisSnapshotUnchanged(
      original,
      replacement,
      snapshot,
    );
    const transaction = await harness.takeTransaction();
    expect(transaction.mode).toBe("readwrite");
    expect(new Set(transaction.storeNames)).toEqual(
      new Set([
        ANALYSIS_RESULT_OBJECT_STORES.jobs,
        ANALYSIS_RESULT_OBJECT_STORES.manifests,
        ANALYSIS_RESULT_OBJECT_STORES.finalResults,
        ANALYSIS_RESULT_OBJECT_STORES.terminals,
        ANALYSIS_RESULT_OBJECT_STORES.broadcastContextSessions,
        ANALYSIS_RESULT_OBJECT_STORES.candidatePassBInsights,
      ]),
    );

    transaction.requestsFor(ANALYSIS_RESULT_OBJECT_STORES.jobs)[0]?.succeed(
      original,
    );
    transaction.requestsFor(
      ANALYSIS_RESULT_OBJECT_STORES.manifests,
    )[0]?.succeed(snapshot.manifest);
    transaction.requestsFor(
      ANALYSIS_RESULT_OBJECT_STORES.finalResults,
    )[0]?.succeed(snapshot.fastResult);
    transaction.requestsFor(
      ANALYSIS_RESULT_OBJECT_STORES.terminals,
    )[0]?.succeed(snapshot.fastTerminal);
    transaction.requestsFor(
      ANALYSIS_RESULT_OBJECT_STORES.broadcastContextSessions,
    )[0]?.succeed(snapshot.session);
    transaction.requestsFor(
      ANALYSIS_RESULT_OBJECT_STORES.candidatePassBInsights,
    )[0]?.succeed(snapshot.candidateRecord);

    expect(transaction.writeOperation).toBe("put");
    expect(transaction.written).toEqual(replacement);
    transaction.requestsFor(ANALYSIS_RESULT_OBJECT_STORES.jobs)[1]?.succeed(
      original.jobId,
    );
    transaction.complete();

    await expect(operation).resolves.toBe(true);
  });

  it("performs Candidate Pass B compare-and-swap in one readwrite transaction", async () => {
    const harness = new FakeIndexedDbHarness();
    const store = new IndexedDbAnalysisResultStore({
      dbName: "candidate-pass-b-cas-test",
      factory: harness.factory,
    });
    const original = makeCandidatePassBInsights();
    const replacement = makeCandidatePassBInsights(
      "2026-07-19T12:35:00.000Z",
    );
    const operation = store.replaceCandidatePassBInsightsIfUnchanged(
      original,
      replacement,
    );
    const transaction = await harness.takeTransaction();
    expect(transaction.mode).toBe("readwrite");
    transaction.request?.succeed(original);
    expect(transaction.writeOperation).toBe("put");
    expect(transaction.written).toEqual(replacement);
    transaction.request?.succeed(original.runId);
    transaction.complete();

    await expect(operation).resolves.toBe(true);
  });

  it("does not let a stale Candidate Pass B writer replace a newer snapshot", async () => {
    const harness = new FakeIndexedDbHarness();
    const store = new IndexedDbAnalysisResultStore({
      dbName: "candidate-pass-b-cas-conflict-test",
      factory: harness.factory,
    });
    const original = makeCandidatePassBInsights();
    const operation = store.replaceCandidatePassBInsightsIfUnchanged(
      original,
      makeCandidatePassBInsights("2026-07-19T12:35:00.000Z"),
    );
    const transaction = await harness.takeTransaction();
    transaction.request?.succeed(
      makeCandidatePassBInsights("2026-07-19T12:34:59.000Z"),
    );
    expect(transaction.writeOperation).toBeNull();
    expect(transaction.written).toBeUndefined();
    transaction.complete();

    await expect(operation).resolves.toBe(false);
  });

  it("writes retry invalidation as one IndexedDB replacement", async () => {
    const harness = new FakeIndexedDbHarness();
    const store = new IndexedDbAnalysisResultStore({
      dbName: "broadcast-context-retry-invalidation-test",
      factory: harness.factory,
    });
    const original = makeCompletedBroadcastContextSession();
    const operation = invalidateBroadcastContextSessionContextIfUnchanged(
      store,
      original,
      "2026-07-19T12:35:00.000Z",
    );
    const transaction = await harness.takeTransaction();
    transaction.request?.succeed(original);

    expect(transaction.writeOperation).toBe("put");
    expect(transaction.written).toMatchObject({
      contextInputSignature: null,
      contextInputCheckpointJson: null,
      contextPhaseLedgerJson: null,
      contextResultJson: null,
      refinementInputSignature: null,
      refinementCandidatesJson: null,
      recordedAt: "2026-07-19T12:35:00.000Z",
    });
    transaction.request?.succeed(original.runId);
    transaction.complete();

    await expect(operation).resolves.toBe(true);
  });

  it("does not write when the durable broadcast context snapshot changed", async () => {
    const harness = new FakeIndexedDbHarness();
    const store = new IndexedDbAnalysisResultStore({
      dbName: "broadcast-context-cas-conflict-test",
      factory: harness.factory,
    });
    const original = makeBroadcastContextSession();
    const operation = store.replaceBroadcastContextSessionIfUnchanged(
      original,
      {
        ...original,
        recordedAt: "2026-07-19T12:35:00.000Z",
      },
    );
    const transaction = await harness.takeTransaction();
    transaction.request?.succeed({
      ...original,
      recordedAt: "2026-07-19T12:34:59.000Z",
    });
    expect(transaction.writeOperation).toBeNull();
    transaction.complete();

    await expect(operation).resolves.toBe(false);
  });

  it("waits for the read transaction to complete even when the request returned no record", async () => {
    const harness = new FakeIndexedDbHarness();
    const store = new IndexedDbAnalysisResultStore({
      dbName: "missing-read-test",
      factory: harness.factory,
    });
    const operation = store.getFinalResult("missing-run");
    const transaction = await harness.takeTransaction();
    transaction.request?.succeed(undefined);

    let resolved = false;
    void operation.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    transaction.complete();
    await expect(operation).resolves.toBeNull();
  });

  it("lists valid terminal pointers after transaction completion and quarantines corrupt rows", async () => {
    const harness = new FakeIndexedDbHarness();
    const store = new IndexedDbAnalysisResultStore({
      dbName: "terminal-catalog-test",
      factory: harness.factory,
    });
    const operation = store.listTerminalRecords();
    const transaction = await harness.takeTransaction();
    transaction.request?.succeed([
      { ...makeTerminal("run-old"), recordedAt: "2026-07-18T12:34:56.000Z" },
      { ...makeTerminal("run-new"), recordedAt: "2026-07-20T12:34:56.000Z" },
      { ...makeTerminal("run-corrupt"), body: "raw line" },
    ]);

    let resolved = false;
    void operation.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    transaction.complete();
    await expect(operation).resolves.toMatchObject({
      records: [{ runId: "run-new" }, { runId: "run-old" }],
      rejectedRecordCount: 1,
    });
  });

  it("closes the opened database and rejects later operations", async () => {
    const harness = new FakeIndexedDbHarness();
    const store = new IndexedDbAnalysisResultStore({
      dbName: "close-test",
      factory: harness.factory,
    });
    const operation = store.getFinalResult("missing-run");
    const transaction = await harness.takeTransaction();
    transaction.request?.succeed(undefined);
    transaction.complete();
    await operation;

    store.close();
    expect(harness.closeCount).toBe(1);
    await expect(store.getFinalResult("missing-run")).rejects.toMatchObject({
      code: "STORE_CLOSED",
    });
  });
});

describe("job records", () => {
  function makeJobRecord(
    jobId = "job-1",
    runIds: readonly string[] = ["run-1"],
  ): AnalysisJobRecord {
    return {
      schemaVersion: ANALYSIS_JOB_RECORD_SCHEMA_VERSION,
      jobId,
      lastActivityAt: RECORDED_AT,
      bytes: 1024,
      job: {
        ...createAnalysisJob({
          jobId,
          identity: {
            scheme: "local-file-sampled-sha256-v1",
            key: `key-${jobId}`,
          },
        }),
        runIds,
      },
    };
  }

  it("stores and reads a job back", async () => {
    const store = new InMemoryAnalysisResultStore();
    await store.putJob(makeJobRecord());
    expect((await store.getJob("job-1"))?.job.identity.key).toBe("key-job-1");
    expect(await store.listJobs()).toHaveLength(1);
  });

  it("rejects a job record without the exact current schema version", async () => {
    const store = new InMemoryAnalysisResultStore();
    const current = makeJobRecord();
    const legacy = {
      jobId: current.jobId,
      job: current.job,
      lastActivityAt: current.lastActivityAt,
      bytes: current.bytes,
    };

    await expect(
      store.putJob(legacy as unknown as AnalysisJobRecord),
    ).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
    await expect(
      store.putJob({
        ...current,
        schemaVersion: "0.9.0",
      } as unknown as AnalysisJobRecord),
    ).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
    await expect(
      store.putJob({
        ...current,
        legacyResumeToken: "old-token",
      } as unknown as AnalysisJobRecord),
    ).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });

  it.each([
    {
      name: "an unsupported nested field",
      mutate: (record: AnalysisJobRecord) => ({
        ...record,
        job: { ...record.job, legacyResumeToken: "old-token" },
      }),
    },
    {
      name: "an invalid lifecycle status",
      mutate: (record: AnalysisJobRecord) => ({
        ...record,
        job: { ...record.job, status: "interrupted" },
      }),
    },
    {
      name: "an invalid active run fence",
      mutate: (record: AnalysisJobRecord) => ({
        ...record,
        job: {
          ...record.job,
          status: "running",
          activeRunId: "run-not-latest",
        },
      }),
    },
  ])("rejects a job record with $name", async ({ mutate }) => {
    const store = new InMemoryAnalysisResultStore();
    await expect(
      store.putJob(
        mutate(makeJobRecord()) as unknown as AnalysisJobRecord,
      ),
    ).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });

  it("returns null for a job that was never stored", async () => {
    const store = new InMemoryAnalysisResultStore();
    expect(await store.getJob("job-1")).toBeNull();
  });

  it("compare-and-swaps a job only from the exact durable snapshot", async () => {
    const store = new InMemoryAnalysisResultStore();
    const original = makeJobRecord();
    const replacement = {
      ...original,
      lastActivityAt: "2026-07-19T12:35:00.000Z",
      bytes: 2048,
    };

    await expect(
      store.replaceJobIfUnchanged(null, original),
    ).resolves.toBe(true);
    await expect(
      store.replaceJobIfUnchanged(null, replacement),
    ).resolves.toBe(false);
    await expect(
      store.replaceJobIfUnchanged(original, replacement),
    ).resolves.toBe(true);
    await expect(
      store.replaceJobIfUnchanged(original, {
        ...replacement,
        bytes: 4096,
      }),
    ).resolves.toBe(false);
    expect(await store.getJob("job-1")).toEqual(replacement);
  });

  it("atomically completes a job when all five durable records are exact", async () => {
    const store = new InMemoryAnalysisResultStore();
    const snapshot = await makeAnalysisCompletionSnapshot();
    const original = makeCompletionJobRecord(snapshot);
    const replacement = makeCompletedJobRecord(original);
    await store.putJob(original);
    await seedAnalysisCompletionSnapshot(store, snapshot);

    await expect(
      store.replaceJobIfAnalysisSnapshotUnchanged(
        original,
        replacement,
        snapshot,
      ),
    ).resolves.toBe(true);
    await expect(store.getJob(original.jobId)).resolves.toEqual(replacement);
    await expect(
      store.getAnalysisCompletionReadback(
        original.jobId,
        snapshot.manifest.runId,
      ),
    ).resolves.toEqual({ job: replacement, snapshot });
  });

  it.each<AnalysisCompletionRecordName>([
    "manifest",
    "fastResult",
    "fastTerminal",
    "session",
    "candidateRecord",
  ])(
    "does not complete when the durable $name no longer matches",
    async (recordName) => {
      const store = new InMemoryAnalysisResultStore();
      const expectedSnapshot = await makeAnalysisCompletionSnapshot();
      const original = makeCompletionJobRecord(expectedSnapshot);
      const replacement = makeCompletedJobRecord(original);
      await store.putJob(original);
      await seedAnalysisCompletionSnapshot(
        store,
        changeAnalysisCompletionRecord(expectedSnapshot, recordName),
      );

      await expect(
        store.replaceJobIfAnalysisSnapshotUnchanged(
          original,
          replacement,
          expectedSnapshot,
        ),
      ).resolves.toBe(false);
      await expect(store.getJob(original.jobId)).resolves.toEqual(original);
    },
  );

  it("deletes the run results along with the job", async () => {
    // 결과만 남으면 어느 화면에도 나타나지 않으므로 사용자가 지울 수 없고,
    // 용량만 계속 차지한다.
    const store = new InMemoryAnalysisResultStore();
    await store.putManifest(makeManifest("run-1"));
    await store.putProvisionalResult(makeProvisional("run-1"));
    await store.putJob(makeJobRecord("job-1", ["run-1"]));

    await store.deleteJob("job-1");

    expect(await store.getJob("job-1")).toBeNull();
    expect(await store.getManifest("run-1")).toBeNull();
  });

  it("leaves another job's runs alone", async () => {
    const store = new InMemoryAnalysisResultStore();
    await store.putManifest(makeManifest("run-1"));
    await store.putManifest(makeManifest("run-2"));
    await store.putJob(makeJobRecord("job-1", ["run-1"]));
    await store.putJob(makeJobRecord("job-2", ["run-2"]));

    await store.deleteJob("job-1");

    expect(await store.getManifest("run-2")).not.toBeNull();
    expect(await store.getJob("job-2")).not.toBeNull();
  });

  it("deletes every run a job accumulated across restarts", async () => {
    // 재개할 때마다 새 Run 이 생긴다. 마지막 것만 지우면 나머지가 남는다.
    const store = new InMemoryAnalysisResultStore();
    await store.putManifest(makeManifest("run-1"));
    await store.putManifest(makeManifest("run-2"));
    await store.putJob(makeJobRecord("job-1", ["run-1", "run-2"]));

    await store.deleteJob("job-1");

    expect(await store.getManifest("run-1")).toBeNull();
    expect(await store.getManifest("run-2")).toBeNull();
  });

  it("treats deleting an absent job as a no-op", async () => {
    const store = new InMemoryAnalysisResultStore();
    await expect(store.deleteJob("never-existed")).resolves.toBeUndefined();
  });

  it("refuses a record whose key disagrees with the job inside it", async () => {
    // 조회는 되는데 잘못된 작업을 지우게 된다.
    const store = new InMemoryAnalysisResultStore();
    const mismatched = { ...makeJobRecord("job-1"), jobId: "job-2" };
    await expect(store.putJob(mismatched)).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });

  it("refuses a job that does not say which runs it made", async () => {
    const store = new InMemoryAnalysisResultStore();
    const record = makeJobRecord();
    const broken = {
      ...record,
      job: { ...record.job, runIds: undefined as unknown as readonly string[] },
    };
    await expect(store.putJob(broken)).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });

  it("hands back a copy rather than the stored object", async () => {
    const store = new InMemoryAnalysisResultStore();
    await store.putJob(makeJobRecord());
    const first = await store.getJob("job-1");
    (first as { bytes: number }).bytes = 999;
    expect((await store.getJob("job-1"))?.bytes).toBe(1024);
  });
});
