import { describe, expect, it, vi } from "vitest";
import {
  createBroadcastContextSamplingPlan,
  createBroadcastContextTranscriptionChunks,
} from "./broadcastContextSamplingPlan";
import {
  BroadcastTranscriptWorkerClientError,
  runBroadcastTranscriptWorker,
} from "./broadcastTranscriptWorkerClient";
import { MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS } from "./broadcastTranscriptWorkerProtocol";
import type {
  BroadcastTranscriptWorkerRequest,
  BroadcastTranscriptWorkerResponse,
} from "./broadcastTranscriptWorkerProtocol";
import {
  createBroadcastTranscriptProviderReceipt,
  type BroadcastTranscriptRouteSelection,
} from "./broadcastTranscriptRouteManifest";
import { BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION } from "./broadcastTranscriptQwen";
import { createVerifiedNoSpeechRunReceiptForTest } from "../testSupport/broadcastSpeechActivityTestReceipt";
import { transcriptFragmentQuotaOperationId } from "./broadcastTranscriptFragmentRecovery";

const ROUTE: BroadcastTranscriptRouteSelection = {
  manifest: {
    schemaVersion: "1.1.0",
    serviceVersion: 6,
    routingPolicyVersion: "1.11.0",
    providerConfigurationVersion: "1.3.0",
    transportVersion: 3,
    transportMode: "free-r2",
    maximumChunkDurationMs: 90_000,
    primaryMediaType: "audio/wav",
    provider: "qwen",
    modelId: "qwen3.5-omni-flash",
    modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
    effectiveFallback: { mode: "disabled" },
  },
  fingerprint: `sha256:${"1".repeat(64)}`,
};

const PRIMARY_RECEIPT = createBroadcastTranscriptProviderReceipt(
  ROUTE,
  "qwen3.5-omni-flash",
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
  false,
);

class FakeWorker {
  public readonly posted: BroadcastTranscriptWorkerRequest[] = [];
  private readonly listeners = new Map<string, Set<(event: MessageEvent<unknown>) => void>>();
  public postMessage(message: BroadcastTranscriptWorkerRequest): void {
    this.posted.push(message);
  }
  public addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void {
    const entries = this.listeners.get(type) ?? new Set();
    entries.add(listener);
    this.listeners.set(type, entries);
  }
  public removeEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  public terminate(): void {}
  public emit(message: BroadcastTranscriptWorkerResponse): void {
    for (const listener of this.listeners.get("message") ?? []) {
      listener(new MessageEvent("message", { data: message }));
    }
  }
  public emitError(): void {
    for (const listener of this.listeners.get("error") ?? []) {
      listener(new MessageEvent("error"));
    }
  }
}

function emitDispatchIntent(
  worker: FakeWorker,
  analyze: Extract<
    BroadcastTranscriptWorkerRequest,
    { readonly type: "broadcast-transcript-analyze" }
  >,
  chunkId: string,
): void {
  const chunk = analyze.chunks.find((candidate) => candidate.chunkId === chunkId);
  if (chunk === undefined) throw new Error("Dispatch fixture chunk is missing.");
  const operationNamespace = analyze.quota?.operationNamespace ?? "uniform";
  const attemptOrdinal = analyze.quota?.attemptOrdinal ?? 0;
  const operationScope = analyze.quota?.operationScope;
  worker.emit({
    type: "broadcast-transcript-dispatch-intent",
    identity: analyze.identity,
    intent: {
      operationId: transcriptFragmentQuotaOperationId(
        operationNamespace,
        attemptOrdinal,
        chunkId,
        operationScope,
      ),
      chunkId,
      sourceStartMs: chunk.sourceStartMs,
      sourceEndMs: chunk.sourceEndMs,
      attemptOrdinal,
      operationNamespace,
      operationScope: operationScope ?? null,
      routeManifestFingerprint: analyze.route.fingerprint,
    },
  });
}

describe("broadcastTranscriptWorkerClient", () => {
  it("rejects a dispatch intent whose deterministic operation identity changed", async () => {
    const worker = new FakeWorker();
    const onDispatchIntent = vi.fn();
    const quota = {
      participantId: "participant_11111111111111111111111111111111",
      runId: "analysis-run-1",
      operationNamespace: "uniform" as const,
      attemptOrdinal: 2,
    };
    const promise = runBroadcastTranscriptWorker(
      new File(["x"], "invalid-dispatch.mp4"),
      {
        sourceDurationMs: 1_000,
        route: ROUTE,
        chunks: [
          {
            chunkId: "asr-001",
            sourceStartMs: 0,
            sourceEndMs: 1_000,
            kind: "uniform",
          },
        ],
        quota,
        workerFactory: () => worker,
        onDispatchIntent,
      },
    );
    const analyze = worker.posted[0];
    if (analyze?.type !== "broadcast-transcript-analyze") {
      throw new Error("Analyze request was not posted.");
    }
    worker.emit({
      type: "broadcast-transcript-dispatch-intent",
      identity: analyze.identity,
      intent: {
        operationId: "transcript-uniform-g1-asr-001",
        chunkId: "asr-001",
        sourceStartMs: 0,
        sourceEndMs: 1_000,
        attemptOrdinal: quota.attemptOrdinal,
        operationNamespace: quota.operationNamespace,
        operationScope: null,
        routeManifestFingerprint: ROUTE.fingerprint,
      },
    });

    await expect(promise).rejects.toMatchObject({
      code: "WORKER_MESSAGE_ERROR",
    });
    expect(onDispatchIntent).not.toHaveBeenCalled();
    expect(
      worker.posted.filter(
        ({ type }) => type === "broadcast-transcript-dispatch-ack",
      ),
    ).toHaveLength(0);
  });

  it("does not ACK a paid dispatch before durable readback completes", async () => {
    const worker = new FakeWorker();
    let releaseReadback!: () => void;
    const readback = new Promise<void>((resolve) => {
      releaseReadback = resolve;
    });
    const quota = {
      participantId: "participant_11111111111111111111111111111111",
      runId: "analysis-run-1",
      operationNamespace: "uniform" as const,
      operationScope: "scope_12345678",
      attemptOrdinal: 3,
    };
    const chunk = {
      chunkId: "asr-001",
      sourceStartMs: 0,
      sourceEndMs: 1_000,
      kind: "uniform" as const,
    };
    const promise = runBroadcastTranscriptWorker(
      new File(["x"], "dispatch-ack.mp4"),
      {
        sourceDurationMs: 1_000,
        route: ROUTE,
        chunks: [chunk],
        quota,
        workerFactory: () => worker,
        onDispatchIntent: () => readback,
      },
    );
    const analyze = worker.posted[0];
    if (analyze?.type !== "broadcast-transcript-analyze") {
      throw new Error("Analyze request was not posted.");
    }
    const operationId = transcriptFragmentQuotaOperationId(
      quota.operationNamespace,
      quota.attemptOrdinal,
      chunk.chunkId,
      quota.operationScope,
    );
    worker.emit({
      type: "broadcast-transcript-dispatch-intent",
      identity: analyze.identity,
      intent: {
        operationId,
        chunkId: chunk.chunkId,
        sourceStartMs: chunk.sourceStartMs,
        sourceEndMs: chunk.sourceEndMs,
        attemptOrdinal: quota.attemptOrdinal,
        operationNamespace: quota.operationNamespace,
        operationScope: quota.operationScope,
        routeManifestFingerprint: ROUTE.fingerprint,
      },
    });
    await Promise.resolve();
    expect(
      worker.posted.filter(
        ({ type }) => type === "broadcast-transcript-dispatch-ack",
      ),
    ).toHaveLength(0);

    releaseReadback();
    await vi.waitFor(() => {
      expect(worker.posted.at(-1)).toMatchObject({
        type: "broadcast-transcript-dispatch-ack",
        chunkId: chunk.chunkId,
        operationId,
      });
    });
    worker.emit({
      type: "broadcast-transcript-gap",
      identity: analyze.identity,
      chunkId: chunk.chunkId,
      reason: "outcome-unknown",
    });
    worker.emit({
      type: "broadcast-transcript-complete",
      identity: analyze.identity,
      requestedCount: 1,
      completedCount: 0,
      abstentionCount: 0,
      gapCount: 1,
      concurrencyOutcome: "test",
    });
    await expect(promise).resolves.toMatchObject({
      gapChunkIds: [chunk.chunkId],
    });
  });

  it("does not ACK a terminal settlement or finish before its readback barrier", async () => {
    const worker = new FakeWorker();
    let releaseReadback!: () => void;
    const readback = new Promise<void>((resolve) => {
      releaseReadback = resolve;
    });
    const promise = runBroadcastTranscriptWorker(
      new File(["x"], "terminal-ack.mp4"),
      {
        sourceDurationMs: 1_000,
        route: ROUTE,
        chunks: [
          {
            chunkId: "asr-001",
            sourceStartMs: 0,
            sourceEndMs: 1_000,
            kind: "uniform",
          },
        ],
        workerFactory: () => worker,
        onChunkGap: () => readback,
      },
    );
    const analyze = worker.posted[0];
    if (analyze?.type !== "broadcast-transcript-analyze") {
      throw new Error("Analyze request was not posted.");
    }
    emitDispatchIntent(worker, analyze, "asr-001");
    worker.emit({
      type: "broadcast-transcript-gap",
      identity: analyze.identity,
      chunkId: "asr-001",
      reason: "transcription-failed",
    });
    worker.emit({
      type: "broadcast-transcript-complete",
      identity: analyze.identity,
      requestedCount: 1,
      completedCount: 0,
      abstentionCount: 0,
      gapCount: 1,
      concurrencyOutcome: "test",
    });
    await Promise.resolve();
    expect(
      worker.posted.filter(
        ({ type }) => type === "broadcast-transcript-terminal-ack",
      ),
    ).toHaveLength(0);
    let finished = false;
    void promise.finally(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);

    releaseReadback();
    await expect(promise).resolves.toMatchObject({
      gapChunkIds: ["asr-001"],
    });
    expect(
      worker.posted.filter(
        ({ type }) => type === "broadcast-transcript-terminal-ack",
      ),
    ).toHaveLength(1);
  });

  it("does not leak a delayed dispatch ACK after the worker has failed", async () => {
    const worker = new FakeWorker();
    const onChunkGap = vi.fn();
    let releaseReadback!: () => void;
    const readback = new Promise<void>((resolve) => {
      releaseReadback = resolve;
    });
    const quota = {
      participantId: "participant_11111111111111111111111111111111",
      runId: "analysis-run-1",
      operationNamespace: "uniform" as const,
      attemptOrdinal: 0,
    };
    const promise = runBroadcastTranscriptWorker(
      new File(["x"], "failed-before-ack.mp4"),
      {
        sourceDurationMs: 1_000,
        route: ROUTE,
        chunks: [
          {
            chunkId: "asr-001",
            sourceStartMs: 0,
            sourceEndMs: 1_000,
            kind: "uniform",
          },
        ],
        quota,
        workerFactory: () => worker,
        onDispatchIntent: () => readback,
        onChunkGap,
      },
    );
    const analyze = worker.posted[0];
    if (analyze?.type !== "broadcast-transcript-analyze") {
      throw new Error("Analyze request was not posted.");
    }
    worker.emit({
      type: "broadcast-transcript-dispatch-intent",
      identity: analyze.identity,
      intent: {
        operationId: transcriptFragmentQuotaOperationId(
          quota.operationNamespace,
          quota.attemptOrdinal,
          "asr-001",
        ),
        chunkId: "asr-001",
        sourceStartMs: 0,
        sourceEndMs: 1_000,
        attemptOrdinal: quota.attemptOrdinal,
        operationNamespace: quota.operationNamespace,
        operationScope: null,
        routeManifestFingerprint: ROUTE.fingerprint,
      },
    });
    await Promise.resolve();
    worker.emit({
      type: "broadcast-transcript-gap",
      identity: analyze.identity,
      chunkId: "asr-001",
      reason: "transcription-failed",
    });
    worker.emitError();
    await expect(promise).rejects.toMatchObject({ code: "WORKER_FAILED" });
    releaseReadback();
    await Promise.resolve();
    await Promise.resolve();
    expect(
      worker.posted.filter(
        ({ type }) => type === "broadcast-transcript-dispatch-ack",
      ),
    ).toHaveLength(0);
    expect(onChunkGap).not.toHaveBeenCalled();
    expect(
      worker.posted.filter(
        ({ type }) => type === "broadcast-transcript-terminal-ack",
      ),
    ).toHaveLength(0);
  });

  it("accepts the complete 2h15m food-talk plan within the worker bound", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const sourceDurationMs = 8_114_817;
    const plan = createBroadcastContextSamplingPlan(sourceDurationMs, [1_212_000]);
    const chunks = createBroadcastContextTranscriptionChunks(plan.samplingWindows);
    const promise = runBroadcastTranscriptWorker(
      new File(["x"], "food-talk.mp4"),
      {
        sourceDurationMs,
        route: ROUTE,
        chunks,
        signal: controller.signal,
        workerFactory: () => worker,
      },
    );
    // 개수는 청크 길이에서 나온다. 박아 두면 릴레이 사정으로 길이를 바꿀 때마다
    // 이유 모를 실패가 된다.
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThanOrEqual(MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS);
    expect(worker.posted[0]).toMatchObject({
      type: "broadcast-transcript-analyze",
      sourceDurationMs,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("passes the explicit retry generation to the transcript worker", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const promise = runBroadcastTranscriptWorker(
      new File(["x"], "retry.mp4"),
      {
        sourceDurationMs: 1_000,
        route: ROUTE,
        chunks: [
          {
            chunkId: "asr-001",
            sourceStartMs: 0,
            sourceEndMs: 1_000,
            kind: "uniform",
          },
        ],
        quota: {
          participantId: "participant_11111111111111111111111111111111",
          runId: "analysis-run-1",
          operationNamespace: "event-boost",
          attemptOrdinal: 2,
        },
        signal: controller.signal,
        workerFactory: () => worker,
        onDispatchIntent: () => undefined,
      },
    );

    expect(worker.posted[0]).toMatchObject({
      quota: {
        operationNamespace: "event-boost",
        attemptOrdinal: 2,
      },
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("reports the precise invalid chunk instead of blaming API credentials", async () => {
    try {
      await runBroadcastTranscriptWorker(new File(["x"], "sample.mp4"), {
        sourceDurationMs: 2_000,
        route: ROUTE,
        chunks: [
          {
            chunkId: "asr-001",
            sourceStartMs: 0.5,
            sourceEndMs: 1_000,
            kind: "uniform",
          },
        ],
      });
      throw new Error("Expected invalid input to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(BroadcastTranscriptWorkerClientError);
      if (!(error instanceof BroadcastTranscriptWorkerClientError)) throw error;
      expect(error.code).toBe("INVALID_INPUT");
      expect(error.message).toContain("정수 밀리초");
    }
  });

  it("accepts scattered execution order but returns source-fenced results chronologically", async () => {
    const worker = new FakeWorker();
    const chunks = [
      { chunkId: "asr-002", sourceStartMs: 1_000, sourceEndMs: 2_000, kind: "event" as const },
      { chunkId: "asr-001", sourceStartMs: 0, sourceEndMs: 1_000, kind: "uniform" as const },
    ];
    const promise = runBroadcastTranscriptWorker(new File(["x"], "sample.mp4"), {
      sourceDurationMs: 2_000,
      route: ROUTE,
      chunks,
      workerFactory: () => worker,
    });
    const analyze = worker.posted[0];
    if (analyze?.type !== "broadcast-transcript-analyze") throw new Error("request");
    expect(analyze.chunks.map(({ chunkId }) => chunkId)).toEqual([
      "asr-002",
      "asr-001",
    ]);
    const result = (start: number) => ({
      schemaVersion: "1.0.0" as const,
      modelId: "qwen3.5-omni-flash" as const,
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      providerReceipt: PRIMARY_RECEIPT,
      sourceStartMs: start,
      sourceEndMs: start + 1_000,
      textKo: `대사 ${start}`,
      detectedLanguage: "ko",
      emotion: null,
      billedSeconds: 1,
    });
    emitDispatchIntent(worker, analyze, "asr-002");
    worker.emit({ type: "broadcast-transcript-partial", identity: analyze.identity, chunkId: "asr-002", result: result(1_000) });
    emitDispatchIntent(worker, analyze, "asr-001");
    worker.emit({ type: "broadcast-transcript-partial", identity: analyze.identity, chunkId: "asr-001", result: result(0) });
    worker.emit({
      type: "broadcast-transcript-complete",
      identity: analyze.identity,
      requestedCount: 2,
      completedCount: 2,
      abstentionCount: 0,
      gapCount: 0,
      concurrencyOutcome: "동시 4 (상한 미확인)",
    });
    await expect(promise).resolves.toMatchObject({
      requestedCount: 2,
      gapChunkIds: [],
      gaps: [],
      fragments: [
        { chunkId: "asr-001", result: { sourceStartMs: 0 } },
        { chunkId: "asr-002", result: { sourceStartMs: 1_000 } },
      ],
      results: [{ sourceStartMs: 0 }, { sourceStartMs: 1_000 }],
    });
  });

  it("still rejects overlapping chunks when their request order is scattered", async () => {
    await expect(
      runBroadcastTranscriptWorker(new File(["x"], "sample.mp4"), {
        sourceDurationMs: 3_000,
        route: ROUTE,
        chunks: [
          { chunkId: "late", sourceStartMs: 1_000, sourceEndMs: 2_000, kind: "event" },
          { chunkId: "overlap", sourceStartMs: 500, sourceEndMs: 1_500, kind: "uniform" },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("reports individual gaps to the live timeline", async () => {
    const worker = new FakeWorker();
    const onChunkGap = vi.fn();
    const promise = runBroadcastTranscriptWorker(new File(["x"], "sample.mp4"), {
      sourceDurationMs: 1_000,
      route: ROUTE,
      chunks: [
        { chunkId: "asr-001", sourceStartMs: 0, sourceEndMs: 1_000, kind: "uniform" },
      ],
      workerFactory: () => worker,
      onChunkGap,
    });
    const analyze = worker.posted[0];
    if (analyze?.type !== "broadcast-transcript-analyze") throw new Error("request");
    emitDispatchIntent(worker, analyze, "asr-001");
    worker.emit({
      type: "broadcast-transcript-gap",
      identity: analyze.identity,
      chunkId: "asr-001",
      reason: "transcription-failed",
    });
    worker.emit({
      type: "broadcast-transcript-complete",
      identity: analyze.identity,
      requestedCount: 1,
      completedCount: 0,
      abstentionCount: 0,
      gapCount: 1,
      concurrencyOutcome: "동시 1 (2 에서 실패)",
    });
    await expect(promise).resolves.toMatchObject({
      requestedCount: 1,
      results: [],
      gapChunkIds: ["asr-001"],
      gaps: [
        { chunkId: "asr-001", reason: "transcription-failed" },
      ],
    });
    expect(onChunkGap).toHaveBeenCalledWith(
      "asr-001",
      "transcription-failed",
    );
  });

  it("returns confirmed no-speech as a resolved abstention, not a retry gap", async () => {
    const worker = new FakeWorker();
    const onChunkAbstention = vi.fn();
    const promise = runBroadcastTranscriptWorker(
      new File(["x"], "sample.mp4"),
      {
        sourceDurationMs: 10_000,
        route: ROUTE,
        chunks: [
          {
            chunkId: "asr-001",
            sourceStartMs: 0,
            sourceEndMs: 10_000,
            kind: "uniform",
          },
        ],
        workerFactory: () => worker,
        onChunkAbstention,
      },
    );
    const analyze = worker.posted[0];
    if (analyze?.type !== "broadcast-transcript-analyze") {
      throw new Error("request");
    }
    worker.emit({
      type: "broadcast-transcript-abstention",
      identity: analyze.identity,
      chunkId: "asr-001",
      reason: "no-speech",
      speechActivityReceipt: createVerifiedNoSpeechRunReceiptForTest(
        10_000,
        0,
        10_000,
      ),
    });
    worker.emit({
      type: "broadcast-transcript-complete",
      identity: analyze.identity,
      requestedCount: 1,
      completedCount: 0,
      abstentionCount: 1,
      gapCount: 0,
      concurrencyOutcome: "동시 1",
    });

    await expect(promise).resolves.toMatchObject({
      requestedCount: 1,
      results: [],
      abstainedChunkIds: ["asr-001"],
      abstentions: [
        expect.objectContaining({
          chunkId: "asr-001",
          reason: "no-speech",
        }),
      ],
      gapChunkIds: [],
      gaps: [],
    });
    expect(onChunkAbstention).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkId: "asr-001",
        reason: "no-speech",
      }),
    );
  });

  it("rejects a no-speech claim without an exact VAD receipt", async () => {
    const worker = new FakeWorker();
    const promise = runBroadcastTranscriptWorker(
      new File(["x"], "sample.mp4"),
      {
        sourceDurationMs: 10_000,
        route: ROUTE,
        chunks: [
          {
            chunkId: "asr-001",
            sourceStartMs: 0,
            sourceEndMs: 10_000,
            kind: "uniform",
          },
        ],
        workerFactory: () => worker,
      },
    );
    const analyze = worker.posted[0];
    if (analyze?.type !== "broadcast-transcript-analyze") {
      throw new Error("request");
    }
    worker.emit({
      type: "broadcast-transcript-abstention",
      identity: analyze.identity,
      chunkId: "asr-001",
      reason: "no-speech",
      speechActivityReceipt: null,
    } as unknown as BroadcastTranscriptWorkerResponse);

    await expect(promise).rejects.toMatchObject({
      code: "WORKER_MESSAGE_ERROR",
    });
  });

  it("rejects a partial result outside its chunk fence", async () => {
    const worker = new FakeWorker();
    const promise = runBroadcastTranscriptWorker(new File(["x"], "sample.mp4"), {
      sourceDurationMs: 2_000,
      route: ROUTE,
      chunks: [{ chunkId: "asr-001", sourceStartMs: 0, sourceEndMs: 1_000, kind: "uniform" }],
      workerFactory: () => worker,
    });
    const analyze = worker.posted[0];
    if (analyze?.type !== "broadcast-transcript-analyze") throw new Error("request");
    worker.emit({
      type: "broadcast-transcript-partial",
      identity: analyze.identity,
      chunkId: "asr-001",
      result: {
        schemaVersion: "1.0.0",
        modelId: "qwen3.5-omni-flash",
        modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
        providerReceipt: PRIMARY_RECEIPT,
        sourceStartMs: 1_000,
        sourceEndMs: 2_000,
        textKo: "잘못된 구간",
        detectedLanguage: "ko",
        emotion: null,
        billedSeconds: 1,
      },
    });
    await expect(promise).rejects.toMatchObject({ code: "WORKER_MESSAGE_ERROR" });
  });

  it("sends a cancellation request and rejects once", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const promise = runBroadcastTranscriptWorker(new File(["x"], "sample.mp4"), {
      sourceDurationMs: 2_000,
      route: ROUTE,
      chunks: [{ chunkId: "asr-001", sourceStartMs: 0, sourceEndMs: 1_000, kind: "uniform" }],
      signal: controller.signal,
      workerFactory: () => worker,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: "ABORTED" });
    expect(worker.posted.at(-1)?.type).toBe("broadcast-transcript-cancel");
    expect(vi.fn()).not.toHaveBeenCalled();
  });
});
