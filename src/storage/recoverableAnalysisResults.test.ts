import { describe, expect, it } from "vitest";

import {
  InMemoryAnalysisResultStore,
  type AnalysisManifestRecord,
  type AnalysisTerminalOutcome,
  type AnalysisTerminalRecord,
  type FinalAnalysisResultRecord,
} from "./analysisResultStore";
import type { DurableFinalResultPayload } from "./durableAnalysisPayload";
import {
  CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
  type CandidatePassBInsightsRecord,
} from "./candidatePassBInsightStore";
import { auditRecoverableAnalysisResults } from "./recoverableAnalysisResults";

const INPUT_SIGNATURE = `sha256:${"c".repeat(64)}`;
const SOURCE_FINGERPRINT = `local-file-sampled-sha256-v1:${"d".repeat(64)}`;
const RECORDED_AT = "2026-07-19T12:34:56.000Z";

function makePayload(withChatGap = false): DurableFinalResultPayload {
  const chatGapReasonCode = withChatGap ? ("WORKER_UNAVAILABLE" as const) : null;
  return {
    input: {
      source: {
        sourceDefinitionId: "source-recovery-1",
        contentFingerprint: SOURCE_FINGERPRINT,
        sizeBytes: 8_000_000,
        durationMs: 120_000,
        kind: "video",
        container: "mp4",
      },
      chat: {
        timestampBasis: withChatGap ? "relative" : "unknown",
        importedRowCount: withChatGap ? 10 : 0,
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
      skippedChatMessageCount: withChatGap ? 10 : 0,
      chatGapReasonCode,
      candidateCount: 0,
    },
    coverage: {
      visualPlannedSampleCount: 4,
      visualCompletedSampleCount: 4,
      visualCoverageComplete: true,
      chatPlannedMessageCount: withChatGap ? 10 : 0,
      chatProcessedMessageCount: 0,
      chatCoverageComplete: !withChatGap,
      chatGapReasonCode,
      chatGapApproval: withChatGap
        ? {
            policyId: "local-chat-worker-degradation-v1",
            disclosedBeforeStart: true,
            approvals: [
              {
                gapId: "chat-signal-analysis",
                reason: "WORKER_UNAVAILABLE",
                approvedBy: "local-chat-worker-degradation-v1",
              },
            ],
          }
        : null,
      activeTaskCountAtCommit: 0,
    },
    candidates: [],
  };
}

function makeManifest(
  runId: string,
  payload: DurableFinalResultPayload,
): AnalysisManifestRecord {
  return {
    kind: "manifest",
    runId,
    artifactId: `manifest-${runId}`,
    schemaVersion: "0.2.0",
    inputSignature: INPUT_SIGNATURE,
    modelManifestHash: "visual-chat-fast-pass-v1",
    result: {
      input: payload.input,
      chatGapPolicy: {
        policyId: "local-chat-worker-degradation-v1",
        disclosedBeforeStart: true,
        behavior: "preserve-visual-result-and-complete-with-documented-chat-gap",
      },
    },
    recordedAt: RECORDED_AT,
  };
}

function makeFinal(
  runId: string,
  payload: DurableFinalResultPayload,
): FinalAnalysisResultRecord {
  return {
    kind: "finalResult",
    runId,
    artifactId: `result-${runId}`,
    schemaVersion: "0.2.0",
    inputSignature: INPUT_SIGNATURE,
    modelManifestHash: "visual-chat-fast-pass-v1",
    result: payload,
    recordedAt: RECORDED_AT,
  };
}

function makeTerminal(
  runId: string,
  outcome: AnalysisTerminalOutcome,
  recordedAt = RECORDED_AT,
): AnalysisTerminalRecord {
  return {
    kind: "terminalDisposition",
    runId,
    schemaVersion: "0.2.0",
    inputSignature: INPUT_SIGNATURE,
    modelManifestHash: "visual-chat-fast-pass-v1",
    outcome,
    resultRecordKind:
      outcome === "completed" || outcome === "completedWithGaps"
        ? "finalResult"
        : "failure",
    resultArtifactId:
      outcome === "completed" || outcome === "completedWithGaps"
        ? `result-${runId}`
        : `failure-${runId}`,
    recordedAt,
  };
}

async function putCompletedBundle(
  store: InMemoryAnalysisResultStore,
  runId: string,
  withChatGap = false,
  recordedAt = RECORDED_AT,
): Promise<void> {
  const payload = makePayload(withChatGap);
  await store.putManifest(makeManifest(runId, payload));
  await store.putFinalResult(makeFinal(runId, payload));
  await store.putTerminalRecord(
    makeTerminal(runId, withChatGap ? "completedWithGaps" : "completed", recordedAt),
  );
}

describe("recoverable analysis audit", () => {
  it("includes the latest Pass B snapshot when a completed run is reopened", async () => {
    const store = new InMemoryAnalysisResultStore();
    const runId = "run-with-pass-b";
    await putCompletedBundle(store, runId);
    const passB: CandidatePassBInsightsRecord = {
      kind: "candidatePassBInsights",
      runId,
      schemaVersion: CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
      inputSignature: INPUT_SIGNATURE,
      modelManifestHash: "gemini-3.1-pro-preview",
      evidenceById: {},
      insightById: {},
      recordedAt: RECORDED_AT,
    };
    await store.putCandidatePassBInsights(passB);

    const audit = await auditRecoverableAnalysisResults(store);

    expect(audit.results[0]?.candidatePassBInsights).toEqual(passB);
  });

  it.each([
    ["completed", false],
    ["completedWithGaps", true],
  ] as const)("reopens a verified %s bundle", async (_label, withChatGap) => {
    const store = new InMemoryAnalysisResultStore();
    await putCompletedBundle(store, "run-ready", withChatGap);

    const audit = await auditRecoverableAnalysisResults(store);

    expect(audit.results).toHaveLength(1);
    expect(audit.results[0]?.terminal.runId).toBe("run-ready");
    expect(audit.skippedCompletedResultCount).toBe(0);
  });

  it("treats an approved audio coverage gap as completedWithGaps on reload", async () => {
    const store = new InMemoryAnalysisResultStore();
    const runId = "run-audio-gap";
    const legacy = makePayload(false);
    const payload: DurableFinalResultPayload = {
      ...legacy,
      summary: {
        ...legacy.summary,
        plannedAudioWindowCount: 120,
        analyzedAudioWindowCount: 0,
        audioGapReasonCode: "NO_AUDIO_TRACK",
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
        audioProcessedWindowCount: 0,
        audioCoverageComplete: false,
        audioGapReasonCode: "NO_AUDIO_TRACK",
        signalGapApproval: {
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
    const manifest: AnalysisManifestRecord = {
      kind: "manifest",
      runId,
      artifactId: `manifest-${runId}`,
      schemaVersion: "0.3.0",
      inputSignature: INPUT_SIGNATURE,
      modelManifestHash: "streamer-reaction-fast-pass-v1",
      result: {
        input: payload.input,
        signalGapPolicy: {
          policyId: "local-available-signal-degradation-v2",
          disclosedBeforeStart: true,
          behavior: "complete-with-available-reaction-signals-and-documented-gaps",
        },
      },
      recordedAt: RECORDED_AT,
    };
    const final: FinalAnalysisResultRecord = {
      kind: "finalResult",
      runId,
      artifactId: `result-${runId}`,
      schemaVersion: "0.3.0",
      inputSignature: INPUT_SIGNATURE,
      modelManifestHash: "streamer-reaction-fast-pass-v1",
      result: payload,
      recordedAt: RECORDED_AT,
    };
    const terminal: AnalysisTerminalRecord = {
      kind: "terminalDisposition",
      runId,
      schemaVersion: "0.3.0",
      inputSignature: INPUT_SIGNATURE,
      modelManifestHash: "streamer-reaction-fast-pass-v1",
      outcome: "completedWithGaps",
      resultRecordKind: "finalResult",
      resultArtifactId: final.artifactId,
      recordedAt: RECORDED_AT,
    };

    await store.putManifest(manifest);
    await store.putFinalResult(final);
    await store.putTerminalRecord(terminal);

    const audit = await auditRecoverableAnalysisResults(store);
    expect(audit.results).toHaveLength(1);
    expect(audit.results[0]?.terminal.outcome).toBe("completedWithGaps");
  });

  it("never discovers an orphan final result without a terminal authority", async () => {
    const store = new InMemoryAnalysisResultStore();
    const payload = makePayload();
    await store.putManifest(makeManifest("run-orphan", payload));
    await store.putFinalResult(makeFinal("run-orphan", payload));

    await expect(auditRecoverableAnalysisResults(store)).resolves.toMatchObject({
      results: [],
      skippedCompletedResultCount: 0,
    });
  });

  it("quarantines a bundle when manifest/final and terminal schema versions disagree", async () => {
    const store = new InMemoryAnalysisResultStore();
    const payload = makePayload();
    await store.putManifest(makeManifest("run-schema-skew", payload));
    await store.putFinalResult(makeFinal("run-schema-skew", payload));
    await store.putTerminalRecord({
      ...makeTerminal("run-schema-skew", "completed"),
      schemaVersion: "0.3.0",
    });

    await expect(auditRecoverableAnalysisResults(store)).resolves.toMatchObject({
      results: [],
      skippedCompletedResultCount: 1,
    });
  });

  it.each(["missing-manifest", "artifact-mismatch", "outcome-mismatch"] as const)(
    "quarantines %s instead of showing a false completed result",
    async (scenario) => {
      const store = new InMemoryAnalysisResultStore();
      const payload = makePayload();
      if (scenario !== "missing-manifest") {
        await store.putManifest(makeManifest("run-bad", payload));
      }
      await store.putFinalResult(makeFinal("run-bad", payload));
      const terminal = makeTerminal(
        "run-bad",
        scenario === "outcome-mismatch" ? "completedWithGaps" : "completed",
      );
      await store.putTerminalRecord(
        scenario === "artifact-mismatch"
          ? { ...terminal, resultArtifactId: "result-different" }
          : terminal,
      );

      const audit = await auditRecoverableAnalysisResults(store);
      expect(audit.results).toEqual([]);
      expect(audit.skippedCompletedResultCount).toBe(1);
    },
  );

  it("continues past a broken newest pointer before applying the visible result limit", async () => {
    const store = new InMemoryAnalysisResultStore();
    await putCompletedBundle(
      store,
      "run-older-valid",
      false,
      "2026-07-18T12:34:56.000Z",
    );
    await store.putTerminalRecord(
      makeTerminal("run-newer-missing", "completed", "2026-07-20T12:34:56.000Z"),
    );

    const audit = await auditRecoverableAnalysisResults(store, 1);
    expect(audit.results.map(({ terminal }) => terminal.runId)).toEqual(["run-older-valid"]);
    expect(audit.skippedCompletedResultCount).toBe(1);
  });

  it("does not offer failed history as a recoverable completed result", async () => {
    const store = new InMemoryAnalysisResultStore();
    await store.putTerminalRecord(makeTerminal("run-failed", "failed"));

    await expect(auditRecoverableAnalysisResults(store)).resolves.toMatchObject({
      results: [],
      skippedCompletedResultCount: 0,
    });
  });
});
