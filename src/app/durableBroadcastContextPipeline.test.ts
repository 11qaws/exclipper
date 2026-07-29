import { describe, expect, it, vi } from "vitest";

import {
  BroadcastContextDeepseekClientError,
} from "../analysis/broadcastContextDeepseekClient";
import type { requestBroadcastContextDeepseek } from "../analysis/broadcastContextDeepseekClient";
import {
  parseBroadcastContextPhaseLedgerJson,
  reduceBroadcastContextPhaseLedger,
  serializeBroadcastContextPhaseLedger,
  type BroadcastContextPhaseLedger,
  type BroadcastContextPhaseLedgerJsonValue,
  type BroadcastContextPhaseLedgerUnitIdentity,
} from "../analysis/broadcastContextPhaseLedger";
import { orchestrateBroadcastParticipantPreContext } from "../analysis/broadcastParticipantPreContextOrchestration";
import {
  BROADCAST_CONTEXT_SCHEMA_VERSION,
  calculateCoverage,
  type BroadcastContextRequestInput,
  type BroadcastContextResult,
} from "../analysis/broadcastContextProtocol";
import {
  BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
  createBroadcastParticipantGroundingInputSignature,
  serializeBroadcastParticipantPreContextCheckpoint,
  type BroadcastContextSessionRecord,
} from "../storage/broadcastContextSessionStore";
import { AnalysisResultStoreError } from "../storage/analysisResultStore";
import { runDurableBroadcastContextPipeline } from "./durableBroadcastContextPipeline";

const chapter = {
  chapterId: "chapter-001",
  startMs: 0,
  endMs: 60_000,
  evidenceMode: "complete-transcript" as const,
  evidenceCoverageRatio: 1,
  summaryKo: "진행자가 오늘의 방송 주제를 설명했다.",
};

const sourceInputSignature = `sha256:${"1".repeat(64)}`;
const transcriptSealOperationKey = "transcript-seal-v1";
const transcriptModelRevision = "transcript-model-v1";
const participantPreContext =
  await orchestrateBroadcastParticipantPreContext({
    sourceFingerprint: sourceInputSignature,
    sourceDurationMs: 60_000,
    transcriptSeal: transcriptSealOperationKey,
    castRosterId: null,
    dialogueChapters: [chapter],
    transcriptModelRevision,
  });
const grounding = participantPreContext.grounding;
const participantGroundingCheckpointJson =
  await serializeBroadcastParticipantPreContextCheckpoint(
    participantPreContext,
    {
      sourceDurationMs: 60_000,
      sourceCastRosterId: null,
      transcriptSealOperationKey,
      dialogueChapters: [chapter],
      participantGroundingPlanFingerprint:
        participantPreContext.planFingerprint,
    },
  );
const participantGroundingInputSignature =
  await createBroadcastParticipantGroundingInputSignature({
    inputSignature: sourceInputSignature,
    transcriptSealOperationKey,
    participantGroundingPlanFingerprint:
      participantPreContext.planFingerprint,
    participantGroundingCheckpointJson,
  });

const contextInput: BroadcastContextRequestInput = {
  sourceDurationMs: 60_000,
  castRosterId: null,
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
    inputSignature: sourceInputSignature,
    sourceDurationMs: 60_000,
    completeAudioCoverage: true,
    chapters: [chapter],
    gapChunkIds: [],
    fragmentGaps: [],
    transcriptEvidenceInputSignature: null,
    transcriptEvidenceCheckpointJson: null,
    transcriptVisualInspectionCheckpointJson: null,
    transcriptProviderReceiptInputSignature: null,
    transcriptProviderReceiptCheckpointJson: null,
    modelRevision: transcriptModelRevision,
    sourceCastRosterId: null,
    transcriptSealOperationKey,
    participantGroundingInputSignature,
    participantGroundingPlanFingerprint:
      participantPreContext.planFingerprint,
    participantGroundingCheckpointJson,
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
  const firstChapter = input.chapters[0]!;
  const lastChapter = input.chapters.at(-1)!;
  return {
    schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
    broadcastSummaryKo: "오늘의 방송 주제를 차분히 설명한 구간이다.",
    hostStreamerProfile: null,
    recurringThemesKo: ["방송 소개"],
    annotations: [],
    semanticChaptersSupported: true,
    semanticChapters: [{
      semanticChapterId:
        `sc-${firstChapter.chapterId}-${lastChapter.chapterId}-story-progress`,
      startChapterId: firstChapter.chapterId,
      endChapterId: lastChapter.chapterId,
      startMs: firstChapter.startMs,
      endMs: lastChapter.endMs,
      titleKo: "방송 소개",
      summaryKo: "방송의 현재 흐름을 설명한다.",
      kind: "story-progress",
      salience: "primary",
      relatedCandidateIds: [],
      uncertaintiesKo: [],
    }],
    discoveredLeadsSupported: true,
    discoveredLeads: [],
    coverage: calculateCoverage(input.chapters, input.sourceDurationMs),
  };
}

function deterministicFingerprint() {
  return (parts: readonly string[]): Promise<string> => {
    const key = JSON.stringify(parts);
    let hash = 2_166_136_261;
    for (let index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
    return Promise.resolve(`fingerprint-${(hash >>> 0).toString(16)}`);
  };
}

function memoryStore(seed: BroadcastContextSessionRecord) {
  let current = seed;
  const history: BroadcastContextSessionRecord[] = [seed];
  return {
    get current() {
      return current;
    },
    get history() {
      return [...history];
    },
    getBroadcastContextSession(runId: string) {
      return Promise.resolve(current.runId === runId ? current : null);
    },
    replaceBroadcastContextSessionIfUnchanged(
      expected: BroadcastContextSessionRecord,
      replacement: BroadcastContextSessionRecord,
    ) {
      if (JSON.stringify(current) !== JSON.stringify(expected)) {
        return Promise.resolve(false);
      }
      current = replacement;
      history.push(replacement);
      return Promise.resolve(true);
    },
  };
}

function cloneSession(
  value: BroadcastContextSessionRecord,
): BroadcastContextSessionRecord {
  return JSON.parse(JSON.stringify(value)) as BroadcastContextSessionRecord;
}

function asLedgerJsonValue(value: unknown): BroadcastContextPhaseLedgerJsonValue {
  return JSON.parse(
    JSON.stringify(value),
  ) as BroadcastContextPhaseLedgerJsonValue;
}

function advanceAnotherDiscoveryUnit(
  ledger: BroadcastContextPhaseLedger,
): BroadcastContextPhaseLedger | null {
  const unit = ledger.units.find(
    (candidate) =>
      candidate.phase === "discovery" &&
      candidate.status === "in-flight",
  );
  if (unit === undefined) return null;
  const outcome = reduceBroadcastContextPhaseLedger(ledger, {
    type: "UNIT_SUCCEEDED",
    fence: ledger.fence,
    phase: unit.phase,
    unitId: unit.unitId,
    inputDigest: unit.inputDigest,
    operationId: unit.operationId,
    attemptOrdinal: unit.attemptOrdinal,
    result: asLedgerJsonValue(resultFor(contextInput)),
  });
  return outcome.accepted ? outcome.ledger : null;
}

function pipelineOptions(
  store: Parameters<typeof runDurableBroadcastContextPipeline>[0]["store"],
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
      transcriptSignature: transcriptSealOperationKey,
      groundingSignature: participantGroundingInputSignature,
    },
    quotaParticipantId: "participant-1",
    operationGeneration: 0,
    retryMode: "editor-approved-paid",
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
    const overview = completed.ledger.units.find(
      (unit) => unit.phase === "discovery" && unit.unitId === "overview",
    );
    const discoverySlice = completed.ledger.units.find(
      (unit) => unit.phase === "discovery" && unit.unitId === "slice-0",
    );
    const selection = completed.ledger.units.find(
      (unit) => unit.phase === "jury" && unit.unitId === "selection",
    );
    expect(overview?.status).toBe("succeeded");
    expect(discoverySlice?.status).toBe("succeeded");
    expect(selection?.status).toBe("succeeded");
    if (overview?.status !== "succeeded" || selection?.status !== "succeeded") {
      throw new Error("Expected completed overview and selection units.");
    }
    expect(overview.modelReceipt?.analysisMode).toBe("overview");
    expect(overview.modelReceipt?.resultFingerprint).toMatch(
      /^fingerprint-/u,
    );
    expect(selection.modelReceipt?.analysisMode).toBe("selection");
    expect(selection.modelReceipt?.resultFingerprint).toMatch(
      /^fingerprint-/u,
    );
    expect(
      selection.modelReceipt?.parentContextResultFingerprint,
    ).toMatch(/^fingerprint-/u);
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

  it("recovers a committed provider result after a transient CAS rejection without calling the provider twice", async () => {
    const seed = initialSession();
    let current = seed;
    let injectedFailure = false;
    const store = {
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
        if (JSON.stringify(current) !== JSON.stringify(expected)) {
          return Promise.resolve(false);
        }
        current = cloneSession(replacement);
        const ledger =
          current.contextPhaseLedgerJson === null
            ? null
            : parseBroadcastContextPhaseLedgerJson(
                current.contextPhaseLedgerJson,
              );
        if (
          !injectedFailure &&
          ledger?.units.some(({ status }) => status === "succeeded")
        ) {
          injectedFailure = true;
          return Promise.reject(
            new AnalysisResultStoreError(
              "TRANSACTION_FAILED",
              "The transaction committed before its completion event failed.",
            ),
          );
        }
        return Promise.resolve(true);
      },
    };
    const request = vi.fn((input: BroadcastContextRequestInput) =>
      Promise.resolve(resultFor(input)),
    );

    const completed = await runDurableBroadcastContextPipeline({
      ...pipelineOptions(store, seed),
      request,
    });

    expect(injectedFailure).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(completed.ledger.units.every(({ status }) => status === "succeeded"))
      .toBe(true);
  });

  it("recovers a transient exact-readback failure after provider success without another provider call", async () => {
    const seed = initialSession();
    let current = seed;
    let failNextReadback = false;
    let injectedFailure = false;
    const store = {
      get current() {
        return current;
      },
      getBroadcastContextSession(runId: string) {
        if (failNextReadback) {
          failNextReadback = false;
          injectedFailure = true;
          return Promise.reject(
            new AnalysisResultStoreError(
              "TRANSACTION_FAILED",
              "The first exact readback was interrupted.",
            ),
          );
        }
        return Promise.resolve(current.runId === runId ? current : null);
      },
      replaceBroadcastContextSessionIfUnchanged(
        expected: BroadcastContextSessionRecord,
        replacement: BroadcastContextSessionRecord,
      ) {
        if (JSON.stringify(current) !== JSON.stringify(expected)) {
          return Promise.resolve(false);
        }
        current = cloneSession(replacement);
        const ledger =
          current.contextPhaseLedgerJson === null
            ? null
            : parseBroadcastContextPhaseLedgerJson(
                current.contextPhaseLedgerJson,
              );
        if (
          !injectedFailure &&
          ledger?.units.some(({ status }) => status === "succeeded")
        ) {
          failNextReadback = true;
        }
        return Promise.resolve(true);
      },
    };
    const request = vi.fn((input: BroadcastContextRequestInput) =>
      Promise.resolve(resultFor(input)),
    );

    const completed = await runDurableBroadcastContextPipeline({
      ...pipelineOptions(store, seed),
      request,
    });

    expect(injectedFailure).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(completed.ledger.units.every(({ status }) => status === "succeeded"))
      .toBe(true);
  });

  it("settles provider terminals once before honoring a late abort", async () => {
    const seed = initialSession();
    const store = memoryStore(seed);
    const controller = new AbortController();
    let requestCount = 0;
    const request = vi.fn((input: BroadcastContextRequestInput) => {
      requestCount += 1;
      if (requestCount === 2) controller.abort();
      return Promise.resolve(resultFor(input));
    });

    await expect(
      runDurableBroadcastContextPipeline({
        ...pipelineOptions(store, seed),
        signal: controller.signal,
        request,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    const storedLedger =
      store.current.contextPhaseLedgerJson === null
        ? null
        : parseBroadcastContextPhaseLedgerJson(
            store.current.contextPhaseLedgerJson,
          );
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      storedLedger?.units
        .filter(({ phase }) => phase === "discovery")
        .every(({ status }) => status === "succeeded"),
    ).toBe(true);
  });

  it("never overwrites a newer durable ledger after a CAS conflict", async () => {
    const seed = initialSession();
    let current = seed;
    let injectedNewerLedgerJson: string | null = null;
    const store = {
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
        if (JSON.stringify(current) !== JSON.stringify(expected)) {
          return Promise.resolve(false);
        }
        const attempted =
          replacement.contextPhaseLedgerJson === null
            ? null
            : parseBroadcastContextPhaseLedgerJson(
                replacement.contextPhaseLedgerJson,
              );
        const newer =
          attempted === null ? null : advanceAnotherDiscoveryUnit(attempted);
        if (
          injectedNewerLedgerJson === null &&
          attempted?.units.some(({ status }) => status === "succeeded") &&
          newer !== null
        ) {
          injectedNewerLedgerJson =
            serializeBroadcastContextPhaseLedger(newer);
          current = cloneSession({
            ...replacement,
            contextPhaseLedgerJson: injectedNewerLedgerJson,
            recordedAt: "2026-07-29T00:10:00.000Z",
          });
          return Promise.resolve(false);
        }
        current = cloneSession(replacement);
        return Promise.resolve(true);
      },
    };
    const request = vi.fn((input: BroadcastContextRequestInput) =>
      Promise.resolve(resultFor(input)),
    );

    await expect(
      runDurableBroadcastContextPipeline({
        ...pipelineOptions(store, seed),
        request,
      }),
    ).rejects.toThrow("could not be persisted");

    expect(injectedNewerLedgerJson).not.toBeNull();
    expect(store.current.contextPhaseLedgerJson).toBe(injectedNewerLedgerJson);
    expect(request).toHaveBeenCalledTimes(2);
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
    expect(storedLedger!.usedOperationIds).toContain(
      overviewOperations.at(-1),
    );
    expect(storedLedger!.usedOperationIds).not.toContain(
      overviewOperations[0],
    );
    expect(completed.ledger.units.every(({ status }) => status === "succeeded"))
      .toBe(true);
  });

  it("replays only the exact ambiguous operation on reload and preserves its completed sibling", async () => {
    const seed = initialSession();
    const store = memoryStore(seed);
    let ambiguousOperationId = "";
    const ambiguousRequest = vi.fn(
      (
        input: BroadcastContextRequestInput,
        options?: NonNullable<
          Parameters<typeof requestBroadcastContextDeepseek>[1]
        >,
      ) => {
        if (options?.analysisMode !== "overview") {
          return Promise.resolve(resultFor(input));
        }
        ambiguousOperationId = options.quota?.operationId ?? "";
        return Promise.reject(
          new BroadcastContextDeepseekClientError(
            "OUTCOME_UNKNOWN",
            "connection disappeared after dispatch",
            { proxyErrorCode: "UPSTREAM_OUTCOME_UNKNOWN" },
          ),
        );
      },
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

    const replayedOperationIds: string[] = [];
    const reloadRequest = vi.fn(
      (
        input: BroadcastContextRequestInput,
        options?: NonNullable<
          Parameters<typeof requestBroadcastContextDeepseek>[1]
        >,
      ) => {
        replayedOperationIds.push(options?.quota?.operationId ?? "");
        return Promise.resolve(resultFor(input));
      },
    );
    const resumed = await runDurableBroadcastContextPipeline({
      ...pipelineOptions(store, store.current),
      request: reloadRequest,
    });
    expect(replayedOperationIds).toEqual([ambiguousOperationId]);
    expect(resumed.ledger.units).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          unitId: "overview",
          operationId: ambiguousOperationId,
          status: "succeeded",
        }),
        expect.objectContaining({
          unitId: "slice-0",
          status: "succeeded",
        }),
      ]),
    );
  });

  it("surfaces an exact current-generation recovery action when reconciliation remains unresolved", async () => {
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
    ).rejects.toMatchObject({ code: "PIPELINE_BLOCKED" });

    const request = vi.fn();
    const reconcileOperation = vi.fn(
      (identity: BroadcastContextPhaseLedgerUnitIdentity) =>
      Promise.resolve({
        disposition: "unresolved" as const,
        operationId: identity.operationId,
        inputDigest: identity.inputDigest,
        reasonCode: "coordinator_terminal_result_unavailable",
      }),
    );
    await expect(
      runDurableBroadcastContextPipeline({
        ...pipelineOptions(store, store.current),
        request,
        reconcileOperation,
      }),
    ).rejects.toMatchObject({
      code: "PIPELINE_BLOCKED",
      recoveryActions: [
        expect.objectContaining({
          kind: "reconcile-current-operation",
          unitId: "overview",
        }),
      ],
    });
    expect(reconcileOperation).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
    expect(
      parseBroadcastContextPhaseLedgerJson(
        store.current.contextPhaseLedgerJson!,
      )?.units.find(({ unitId }) => unitId === "slice-0"),
    ).toMatchObject({ status: "succeeded" });
  });

  it("durably fails a deterministic contract error without retrying", async () => {
    const seed = initialSession();
    const store = memoryStore(seed);
    const request = vi.fn(() =>
      Promise.reject(
        new BroadcastContextDeepseekClientError(
          "INVALID_INPUT",
          "current request contract is invalid",
        ),
      ),
    );
    const waitForAutomaticRetry = vi.fn(() => Promise.resolve());

    await expect(
      runDurableBroadcastContextPipeline({
        ...pipelineOptions(store, seed),
        retryMode: "automatic-free-tier",
        request,
        waitForAutomaticRetry,
      }),
    ).rejects.toMatchObject({ code: "PIPELINE_BLOCKED" });

    expect(request).toHaveBeenCalled();
    expect(waitForAutomaticRetry).not.toHaveBeenCalled();
    const ledger = parseBroadcastContextPhaseLedgerJson(
      store.current.contextPhaseLedgerJson!,
    );
    const failedUnits =
      ledger?.units.filter(
        (
          unit,
        ): unit is Extract<
          BroadcastContextPhaseLedger["units"][number],
          { readonly status: "failed" }
        > => unit.status === "failed",
      ) ?? [];
    expect(failedUnits.length).toBeGreaterThan(0);
    expect(
      failedUnits.every(
        (unit) =>
          unit.reasonCode ===
          "provider_configuration_or_request_rejected",
      ),
    ).toBe(true);
  });

  it("durably closes the old ambiguous operation before a free-tier replacement", async () => {
    const seed = initialSession();
    const store = memoryStore(seed);
    const requestedOperationIds: string[] = [];
    const request = vi.fn(
      (
        input: BroadcastContextRequestInput,
        options?: NonNullable<
          Parameters<typeof requestBroadcastContextDeepseek>[1]
        >,
      ) => {
        const operationId = options?.quota?.operationId ?? "";
        requestedOperationIds.push(operationId);
        if (
          options?.analysisMode === "overview" &&
          !operationId.includes("-free-")
        ) {
          return Promise.reject(
            new BroadcastContextDeepseekClientError(
              "OUTCOME_UNKNOWN",
              "connection disappeared after dispatch",
              { proxyErrorCode: "UPSTREAM_OUTCOME_UNKNOWN" },
            ),
          );
        }
        return Promise.resolve(resultFor(input));
      },
    );
    const reconcileOperation = vi.fn(
      (identity: BroadcastContextPhaseLedgerUnitIdentity) =>
        Promise.resolve({
          disposition: "unresolved" as const,
          operationId: identity.operationId,
          inputDigest: identity.inputDigest,
          reasonCode: "coordinator_terminal_result_unavailable",
        }),
    );
    const waitForAutomaticRetry = vi.fn(() => Promise.resolve());

    const completed = await runDurableBroadcastContextPipeline({
      ...pipelineOptions(store, seed),
      retryMode: "automatic-free-tier",
      request,
      reconcileOperation,
      waitForAutomaticRetry,
    });

    const overviewRequests = requestedOperationIds.filter(
      (operationId) =>
        operationId === "context-discovery-0-g0" ||
        operationId.includes("context-discovery-overview-free-"),
    );
    expect(overviewRequests).toHaveLength(2);
    const [oldOperationId, replacementOperationId] = overviewRequests;
    expect(oldOperationId).toBe("context-discovery-0-g0");
    expect(replacementOperationId).toContain(
      "context-discovery-overview-free-g2-a1",
    );
    expect(replacementOperationId).not.toBe(oldOperationId);
    expect(reconcileOperation).toHaveBeenCalledTimes(1);
    expect(waitForAutomaticRetry).toHaveBeenCalledTimes(2);
    expect(completed.ledger.units.find(
      ({ phase, unitId }) =>
        phase === "discovery" && unitId === "overview",
    )).toMatchObject({
      status: "succeeded",
      operationId: replacementOperationId,
      attemptOrdinal: 1,
    });

    const overviewHistory = store.history.flatMap((session, historyIndex) => {
      const ledger =
        session.contextPhaseLedgerJson === null
          ? null
          : parseBroadcastContextPhaseLedgerJson(
              session.contextPhaseLedgerJson,
            );
      const unit = ledger?.units.find(
        ({ phase, unitId }) =>
          phase === "discovery" && unitId === "overview",
      );
      return unit === undefined ? [] : [{ historyIndex, unit, ledger }];
    });
    const oldTerminalIndex = overviewHistory.find(
      ({ unit }) =>
        unit.operationId === oldOperationId &&
        unit.status === "outcome-unknown",
    )?.historyIndex;
    const replacementPlannedIndex = overviewHistory.find(
      ({ unit }) =>
        unit.operationId === replacementOperationId &&
        unit.status === "pending" &&
        unit.attemptOrdinal === 1,
    )?.historyIndex;
    expect(oldTerminalIndex).toBeTypeOf("number");
    expect(replacementPlannedIndex).toBeTypeOf("number");
    expect(replacementPlannedIndex!).toBeGreaterThan(oldTerminalIndex!);
    expect(completed.ledger.usedOperationIds).toContain(
      replacementOperationId,
    );
    expect(completed.ledger.usedOperationIds).not.toContain(oldOperationId);
  });
});
