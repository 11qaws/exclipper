import { describe, expect, it } from "vitest";

import {
  ANALYSIS_RESULT_OBJECT_STORES,
  AnalysisResultStoreError,
  InMemoryAnalysisResultStore,
  IndexedDbAnalysisResultStore,
  type AnalysisFailureRecord,
  type AnalysisJobRecord,
  type AnalysisManifestRecord,
  type AnalysisTerminalRecord,
  type FinalAnalysisResultRecord,
  type ProvisionalAnalysisResultRecord,
  type SourceCapabilitySnapshotRecord,
} from "./analysisResultStore";
import { createAnalysisJob } from "../domain/analysisJob";
import type {
  DurableFinalResultPayload,
  DurableHighlightCandidate,
} from "./durableAnalysisPayload";

const RECORDED_AT = "2026-07-19T12:34:56.000Z";
const INPUT_SIGNATURE = `sha256:${"a".repeat(64)}`;
const SOURCE_FINGERPRINT = `local-file-sampled-sha256-v1:${"b".repeat(64)}`;

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
      chatGapApproval: null,
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
    schemaVersion: "0.2.0",
    inputSignature: INPUT_SIGNATURE,
    modelManifestHash: "visual-chat-fast-pass-v1",
    result: {
      input: makeFinalPayload().input,
      chatGapPolicy: {
        policyId: "local-chat-worker-degradation-v1",
        disclosedBeforeStart: true,
        behavior: "preserve-visual-result-and-complete-with-documented-chat-gap",
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
    kind: "manifest",
    runId: "run-reaction-1",
    artifactId: "manifest-reaction-1",
    schemaVersion: "0.3.0",
    inputSignature: INPUT_SIGNATURE,
    modelManifestHash: "streamer-reaction-fast-pass-v1",
    result: {
      input: makeReactionPayload().input,
      signalGapPolicy: {
        policyId: "local-available-signal-degradation-v2",
        disclosedBeforeStart: true,
        behavior: "complete-with-available-reaction-signals-and-documented-gaps",
      },
    },
    recordedAt: RECORDED_AT,
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
    schemaVersion: "0.2.0",
    inputSignature: INPUT_SIGNATURE,
    modelManifestHash: "visual-chat-fast-pass-v1",
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
    schemaVersion: "0.2.0",
    browserCapabilitySignature: "wasm:1:1:0:0:0",
    preflightMetadata: {
      sourceDefinitionId: "source-definition-1",
      contentFingerprint: SOURCE_FINGERPRINT,
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

function expectStoreError(error: unknown, code: AnalysisResultStoreError["code"]): void {
  expect(error).toBeInstanceOf(AnalysisResultStoreError);
  expect(error).toMatchObject({ code });
}

describe("InMemoryAnalysisResultStore contract", () => {
  it("keeps exact legacy 0.2.x records readable", async () => {
    const store = new InMemoryAnalysisResultStore();
    const manifest = { ...makeManifest("run-legacy-patch"), schemaVersion: "0.2.9" };
    const final = { ...makeFinal("run-legacy-patch"), schemaVersion: "0.2.9" };
    const terminal = { ...makeTerminal("run-legacy-patch"), schemaVersion: "0.2.9" };

    await expect(store.putManifest(manifest)).resolves.toBeUndefined();
    await expect(store.putFinalResult(final)).resolves.toBeUndefined();
    await expect(store.putTerminalRecord(terminal)).resolves.toBeUndefined();
    await expect(store.getFinalResult("run-legacy-patch")).resolves.toEqual(final);
  });

  it("accepts reaction-first audio evidence and documented audio unavailability", async () => {
    const store = new InMemoryAnalysisResultStore();

    await expect(store.putManifest(makeReactionManifest())).resolves.toBeUndefined();
    await expect(store.putFinalResult(makeReactionFinal())).resolves.toBeUndefined();
    await expect(
      store.putFinalResult(makeReactionFinal(makeReactionPayload("NO_AUDIO_TRACK"))),
    ).resolves.toBeUndefined();
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
          audio: { ...candidate.evidence.audio, transcript: "SECRET SPOKEN WORDS" },
        },
      })),
    } as unknown as DurableFinalResultPayload;

    await expect(store.putFinalResult(makeReactionFinal(unsafe))).rejects.toMatchObject({
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
      schemaVersion: "0.2.0",
      inputSignature: INPUT_SIGNATURE,
      modelManifestHash: "visual-chat-fast-pass-v1",
      result: { summary: { candidateCount: 1 } },
    });
    await expect(store.getTerminalRecord("run-1")).resolves.toEqual(makeTerminal());
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

  it("binds manifest and final payload shapes to their declared schema versions", async () => {
    const store = new InMemoryAnalysisResultStore();
    const legacyManifestWithReactionVersion = {
      ...makeManifest("run-manifest-legacy-as-reaction"),
      schemaVersion: "0.3.0",
    };
    const reactionManifestWithLegacyVersion = {
      ...makeReactionManifest(),
      runId: "run-manifest-reaction-as-legacy",
      schemaVersion: "0.2.1",
    };
    const legacyFinalWithReactionVersion = {
      ...makeFinal("run-final-legacy-as-reaction"),
      schemaVersion: "0.3.0",
    };
    const reactionFinalWithLegacyVersion = {
      ...makeReactionFinal(),
      runId: "run-final-reaction-as-legacy",
      schemaVersion: "0.2.1",
    };

    await expect(store.putManifest(legacyManifestWithReactionVersion)).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
    await expect(store.putManifest(reactionManifestWithLegacyVersion)).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
    await expect(store.putFinalResult(legacyFinalWithReactionVersion)).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
    await expect(store.putFinalResult(reactionFinalWithLegacyVersion)).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });

  it("rejects unsupported future schemas for manifests, finals, and terminals", async () => {
    const store = new InMemoryAnalysisResultStore();

    await expect(
      store.putManifest({ ...makeReactionManifest(), schemaVersion: "0.4.0" }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      store.putFinalResult({ ...makeReactionFinal(), schemaVersion: "0.4.0" }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      store.putTerminalRecord({ ...makeTerminal("run-future"), schemaVersion: "0.4.0" }),
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
    ["temporary Object URL", { previewUrl: "blob:https://example.test/temporary" }],
    ["raw chat", { rawChat: [{ text: "original chat line" }] }],
    ["nickname", { nickname: "viewer-name" }],
    ["message collection", { messages: ["original chat line"] }],
    ["blacklist bypass", { entries: [{ speaker: "nick", body: "raw line" }] }],
  ])("rejects %s in durable analysis payloads", async (_label, unsafeResult) => {
    const store = new InMemoryAnalysisResultStore();
    await expect(store.putFinalResult(makeFinal(
      "run-unsafe",
      unsafeResult as unknown as DurableFinalResultPayload,
    ))).rejects.toSatisfy(
      (error: unknown) => {
        expectStoreError(error, "INVALID_PAYLOAD");
        return true;
      },
    );
  });

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
          makeFinal(`run-hidden-${index}`, payload as unknown as DurableFinalResultPayload),
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
    await expect(store.putSourceSnapshot(sourceWithRawMime)).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });

    const terminalWithExtra = {
      ...makeTerminal("run-terminal-extra"),
      body: "raw line",
    } as unknown as AnalysisTerminalRecord;
    await expect(store.putTerminalRecord(terminalWithExtra)).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });

    const accessorPayload = makeFinalPayload() as unknown as Record<string, unknown>;
    Object.defineProperty(accessorPayload, "entries", {
      enumerable: true,
      get: () => [{ speaker: "nick", body: "raw line" }],
    });
    await expect(
      store.putFinalResult(
        makeFinal("run-accessor", accessorPayload as unknown as DurableFinalResultPayload),
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
        candidates: [{ ...candidate, endMs: valid.input.source.durationMs + 1 }],
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
        store.putFinalResult(
          makeFinal(`run-invariant-${index}`, payload),
        ),
      ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    }
  });

  it("rejects File/handle-like non-JSON objects from analysis and source snapshots", async () => {
    class FakeFileSystemHandle {}

    const store = new InMemoryAnalysisResultStore();
    const unsafeObject = new FakeFileSystemHandle();
    await expect(store.putFinalResult(makeFinal(
      "run-handle",
      unsafeObject as unknown as DurableFinalResultPayload,
    ))).rejects.toMatchObject({
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
    expect(catalog.records.map(({ runId }) => runId)).toEqual(["run-new", "run-old"]);
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

  public constructor(
    public readonly mode: IDBTransactionMode,
    private readonly storeName: string,
  ) {}

  public objectStore(requestedStoreName: string): IDBObjectStore {
    if (requestedStoreName !== this.storeName) {
      throw new DOMException("Unknown object store", "NotFoundError");
    }

    const objectStore = {
      keyPath:
        this.storeName === ANALYSIS_RESULT_OBJECT_STORES.sourceSnapshots
          ? "sourceCheckId"
          : "runId",
      put: (value: unknown) => {
        this.written = value;
        this.writeOperation = "put";
        this.request = new ControlledRequest();
        return this.request as unknown as IDBRequest<IDBValidKey>;
      },
      add: (value: unknown) => {
        this.written = value;
        this.writeOperation = "add";
        this.request = new ControlledRequest();
        return this.request as unknown as IDBRequest<IDBValidKey>;
      },
      get: () => {
        this.request = new ControlledRequest();
        return this.request as unknown as IDBRequest<unknown>;
      },
      getAll: () => {
        this.request = new ControlledRequest();
        return this.request as unknown as IDBRequest<unknown[]>;
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
  private readonly transactionWaiters: Array<(transaction: ControlledTransaction) => void> = [];

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
      transaction: (storeName: string, mode: IDBTransactionMode) => {
        if (!this.createdStores.has(storeName)) {
          throw new DOMException("Unknown object store", "NotFoundError");
        }
        const transaction = new ControlledTransaction(mode, storeName);
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
            ({ keyPath: this.keyPaths.get(storeName) ?? null }) as IDBObjectStore,
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
      await expect(operation).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });
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
    const conflictExpectation = expect(conflictOperation).rejects.toMatchObject({
      code: "TRANSACTION_FAILED",
    });
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
      jobId,
      lastActivityAt: RECORDED_AT,
      bytes: 1024,
      job: {
        ...createAnalysisJob({
          jobId,
          identity: { scheme: "local-file-sampled-sha256-v1", key: `key-${jobId}` },
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

  it("returns null for a job that was never stored", async () => {
    const store = new InMemoryAnalysisResultStore();
    expect(await store.getJob("job-1")).toBeNull();
  });

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
    await expect(store.putJob(mismatched)).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("refuses a job that does not say which runs it made", async () => {
    const store = new InMemoryAnalysisResultStore();
    const record = makeJobRecord();
    const broken = {
      ...record,
      job: { ...record.job, runIds: undefined as unknown as readonly string[] },
    };
    await expect(store.putJob(broken)).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("hands back a copy rather than the stored object", async () => {
    const store = new InMemoryAnalysisResultStore();
    await store.putJob(makeJobRecord());
    const first = await store.getJob("job-1");
    (first as { bytes: number }).bytes = 999;
    expect((await store.getJob("job-1"))?.bytes).toBe(1024);
  });
});
