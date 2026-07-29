import { describe, expect, it, vi } from "vitest";

import {
  BroadcastContextDeepseekClientError,
} from "../analysis/broadcastContextDeepseekClient";
import type { requestBroadcastContextDeepseek } from "../analysis/broadcastContextDeepseekClient";
import { parseBroadcastContextPhaseLedgerJson } from "../analysis/broadcastContextPhaseLedger";
import { createBroadcastParticipantGrounding } from "../analysis/broadcastParticipantGrounding";
import {
  BROADCAST_CONTEXT_SCHEMA_VERSION,
  calculateCoverage,
  type BroadcastContextRequestInput,
  type BroadcastContextResult,
} from "../analysis/broadcastContextProtocol";
import type { BroadcastContextSessionRecord } from "../storage/broadcastContextSessionStore";
import { BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION } from "../storage/broadcastContextSessionStore";
import { runDurableBroadcastContextPipeline } from "./durableBroadcastContextPipeline";

const chapter = {
  chapterId: "chapter-001",
  startMs: 0,
  endMs: 60_000,
  evidenceMode: "complete-transcript" as const,
  evidenceCoverageRatio: 1,
  summaryKo: "진행자가 오늘의 방송 주제를 설명했다.",
};

const grounding = createBroadcastParticipantGrounding({
  sourceDurationMs: 60_000,
  castRosterId: null,
  chapters: [chapter],
});

const contextInput: BroadcastContextRequestInput = {
  sourceDurationMs: 60_000,
  chapters: [chapter],
  candidates: [],
  participantGrounding: grounding,
  outputLanguage: "ko",
};

function initialSession(): BroadcastContextSessionRecord {
  return {
    kind: "broadcastContextSession",
    runId: "run-1",
    schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
    inputSignature: "source-input-signature",
    sourceDurationMs: 60_000,
    completeAudioCoverage: true,
    chapters: [chapter],
    gapChunkIds: [],
    fragmentGaps: [],
    transcriptEvidenceInputSignature: null,
    transcriptEvidenceCheckpointJson: null,
    transcriptProviderReceiptInputSignature: null,
    transcriptProviderReceiptCheckpointJson: null,
    modelRevision: "transcript-model-v1",
    sourceCastRosterId: null,
    transcriptSealOperationKey: "transcript-seal-v1",
    participantGroundingInputSignature: "grounding-signature-v1",
    participantGroundingPlanFingerprint: "grounding-plan-fingerprint-v1",
    participantGroundingCheckpointJson: JSON.stringify(grounding),
    contextInputSignature: null,
    contextInputCheckpointJson: null,
    contextPhaseLedgerJson: null,
    contextResultJson: null,
    refinementTranscriptInputSignature: null,
    refinementTranscriptCheckpointJson: null,
    refinementEvidenceLedgerJson: null,
    refinementInputSignature: null,
    refinementCandidatesJson: null,
    recordedAt: "2026-07-29T00:00:00.000Z",
  };
}

function resultFor(input: BroadcastContextRequestInput): BroadcastContextResult {
  return {
    schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
    broadcastSummaryKo: "오늘의 방송 주제를 차분히 설명한 구간이다.",
    hostStreamerProfile: null,
    recurringThemesKo: ["방송 소개"],
    annotations: [],
    semanticChaptersSupported: false,
    semanticChapters: [],
    discoveredLeadsSupported: true,
    discoveredLeads: [],
    coverage: calculateCoverage(input.chapters, input.sourceDurationMs),
  };
}

function deterministicFingerprint() {
  const values = new Map<string, string>();
  return (parts: readonly string[]): Promise<string> => {
    const key = JSON.stringify(parts);
    let value = values.get(key);
    if (value === undefined) {
      value = `fingerprint-${values.size + 1}`;
      values.set(key, value);
    }
    return Promise.resolve(value);
  };
}

function memoryStore(seed: BroadcastContextSessionRecord) {
  let current = seed;
  return {
    get current() {
      return current;
    },
    getBroadcastContextSession(runId: string) {
      return Promise.resolve(current.runId === runId ? current : null);
    },
    replaceBroadcastContextSessionIfUnchanged(
      expected: BroadcastContextSessionRecord,
      replacement: BroadcastContextSessionRecord,
    ) {
      if (current !== expected) return Promise.resolve(false);
      current = replacement;
      return Promise.resolve(true);
    },
  };
}

function pipelineOptions(
  store: ReturnType<typeof memoryStore>,
  session: BroadcastContextSessionRecord,
) {
  return {
    store,
    initialSession: session,
    runId: "run-1",
    contextInput,
    contextInputSignature: "context-signature-v1",
    contextInputCheckpointJson: JSON.stringify(contextInput),
    fence: {
      parentContextSignature: "context-signature-v1",
      transcriptSignature: "transcript-seal-v1",
      groundingSignature: "grounding-signature-v1",
    },
    quotaParticipantId: "participant-1",
    operationGeneration: 0,
    signal: new AbortController().signal,
    fingerprint: deterministicFingerprint(),
  } as const;
}

describe("runDurableBroadcastContextPipeline", () => {
  it("persists discovery before adding a locally resolved empty jury", async () => {
    const seed = initialSession();
    const store = memoryStore(seed);
    const request = vi.fn((input: BroadcastContextRequestInput) =>
      Promise.resolve(resultFor(input)),
    );

    const completed = await runDurableBroadcastContextPipeline({
      ...pipelineOptions(store, seed),
      request,
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(completed.refinementLeadIds).toEqual([]);
    expect(completed.fastRefinementLeadIds).toEqual([]);
    expect(completed.ledger.units).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "discovery",
          unitId: "overview",
          status: "succeeded",
        }),
        expect.objectContaining({
          phase: "discovery",
          unitId: "slice-0",
          status: "succeeded",
        }),
        expect.objectContaining({
          phase: "jury",
          unitId: "selection",
          status: "succeeded",
        }),
      ]),
    );
    expect(store.current.contextPhaseLedgerJson).not.toBeNull();
  });

  it("resumes every successful paid unit without calling the provider again", async () => {
    const seed = initialSession();
    const store = memoryStore(seed);
    const request = vi.fn((input: BroadcastContextRequestInput) =>
      Promise.resolve(resultFor(input)),
    );
    const first = await runDurableBroadcastContextPipeline({
      ...pipelineOptions(store, seed),
      request,
    });
    request.mockClear();

    const resumed = await runDurableBroadcastContextPipeline({
      ...pipelineOptions(store, first.session),
      request,
    });

    expect(request).not.toHaveBeenCalled();
    expect(resumed.result).toEqual(first.result);
    expect(resumed.ledger).toEqual(first.ledger);
  });

  it("retries an explicit 429 with a fresh operation id and preserves both ids", async () => {
    const seed = initialSession();
    const store = memoryStore(seed);
    const overviewOperations: string[] = [];
    let rejected = false;
    type ContextRequestOptions = NonNullable<
      Parameters<typeof requestBroadcastContextDeepseek>[1]
    >;
    const request = vi.fn(
      (
        input: BroadcastContextRequestInput,
        options?: ContextRequestOptions,
      ) => {
        if (options?.analysisMode === "overview") {
          overviewOperations.push(options.quota!.operationId);
          if (!rejected) {
            rejected = true;
            return Promise.reject(
              new BroadcastContextDeepseekClientError(
                "PROXY_REJECTED",
                "rate limited",
                { status: 429, proxyErrorCode: "UPSTREAM_RATE_LIMITED" },
              ),
            );
          }
        }
        return Promise.resolve(resultFor(input));
      },
    );

    const completed = await runDurableBroadcastContextPipeline({
      ...pipelineOptions(store, seed),
      request,
    });

    expect(overviewOperations).toHaveLength(2);
    expect(new Set(overviewOperations).size).toBe(2);
    const storedLedger = parseBroadcastContextPhaseLedgerJson(
      store.current.contextPhaseLedgerJson!,
    );
    expect(storedLedger).not.toBeNull();
    expect(storedLedger!.usedOperationIds).toEqual(
      expect.arrayContaining(overviewOperations),
    );
    expect(completed.ledger.units.every(({ status }) => status === "succeeded"))
      .toBe(true);
  });

  it("seals an ambiguous post-dispatch failure and does not spend on reload", async () => {
    const seed = initialSession();
    const store = memoryStore(seed);
    const ambiguousRequest = vi.fn(
      (
        input: BroadcastContextRequestInput,
        options?: NonNullable<
          Parameters<typeof requestBroadcastContextDeepseek>[1]
        >,
      ) =>
        options?.analysisMode === "overview"
          ? Promise.reject(
              new BroadcastContextDeepseekClientError(
                "OUTCOME_UNKNOWN",
                "connection disappeared after dispatch",
                { proxyErrorCode: "UPSTREAM_OUTCOME_UNKNOWN" },
              ),
            )
          : Promise.resolve(resultFor(input)),
    );

    await expect(
      runDurableBroadcastContextPipeline({
        ...pipelineOptions(store, seed),
        request: ambiguousRequest,
      }),
    ).rejects.toThrow("자동 재결제를 멈췄어요");
    const failedLedger = parseBroadcastContextPhaseLedgerJson(
      store.current.contextPhaseLedgerJson!,
    );
    expect(failedLedger?.units).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          unitId: "overview",
          status: "outcome-unknown",
        }),
        expect.objectContaining({
          unitId: "slice-0",
          status: "succeeded",
        }),
      ]),
    );

    const reloadRequest = vi.fn((input: BroadcastContextRequestInput) =>
      Promise.resolve(resultFor(input)),
    );
    await expect(
      runDurableBroadcastContextPipeline({
        ...pipelineOptions(store, store.current),
        request: reloadRequest,
      }),
    ).rejects.toThrow("자동 재결제를 멈췄어요");
    expect(reloadRequest).not.toHaveBeenCalled();
  });
});
