import { describe, expect, it, vi } from "vitest";
import {
  createBroadcastContextSamplingPlan,
  createBroadcastContextTranscriptionChunks,
} from "./broadcastContextSamplingPlan";
import {
  BroadcastTranscriptWorkerClientError,
  runBroadcastTranscriptWorker,
} from "./broadcastTranscriptWorkerClient";
import type {
  BroadcastTranscriptWorkerRequest,
  BroadcastTranscriptWorkerResponse,
} from "./broadcastTranscriptWorkerProtocol";

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
}

describe("broadcastTranscriptWorkerClient", () => {
  it("accepts the complete 2h15m food-talk plan as 91 bounded chunks", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const sourceDurationMs = 8_114_817;
    const plan = createBroadcastContextSamplingPlan(sourceDurationMs, [1_212_000]);
    const chunks = createBroadcastContextTranscriptionChunks(plan.samplingWindows);
    const promise = runBroadcastTranscriptWorker(
      new File(["x"], "food-talk.mp4"),
      {
        sourceDurationMs,
        chunks,
        signal: controller.signal,
        workerFactory: () => worker,
      },
    );
    expect(chunks).toHaveLength(91);
    expect(worker.posted[0]).toMatchObject({
      type: "broadcast-transcript-analyze",
      sourceDurationMs,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("reports the precise invalid chunk instead of blaming API credentials", async () => {
    try {
      await runBroadcastTranscriptWorker(new File(["x"], "sample.mp4"), {
        sourceDurationMs: 2_000,
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
      modelId: "qwen3-asr-flash" as const,
      sourceStartMs: start,
      sourceEndMs: start + 1_000,
      textKo: `대사 ${start}`,
      detectedLanguage: "ko",
      emotion: null,
      billedSeconds: 1,
    });
    worker.emit({ type: "broadcast-transcript-partial", identity: analyze.identity, chunkId: "asr-002", result: result(1_000) });
    worker.emit({ type: "broadcast-transcript-partial", identity: analyze.identity, chunkId: "asr-001", result: result(0) });
    worker.emit({
      type: "broadcast-transcript-complete",
      identity: analyze.identity,
      requestedCount: 2,
      completedCount: 2,
      gapCount: 0,
    });
    await expect(promise).resolves.toMatchObject({
      requestedCount: 2,
      gapChunkIds: [],
      results: [{ sourceStartMs: 0 }, { sourceStartMs: 1_000 }],
    });
  });

  it("still rejects overlapping chunks when their request order is scattered", async () => {
    await expect(
      runBroadcastTranscriptWorker(new File(["x"], "sample.mp4"), {
        sourceDurationMs: 3_000,
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
      chunks: [
        { chunkId: "asr-001", sourceStartMs: 0, sourceEndMs: 1_000, kind: "uniform" },
      ],
      workerFactory: () => worker,
      onChunkGap,
    });
    const analyze = worker.posted[0];
    if (analyze?.type !== "broadcast-transcript-analyze") throw new Error("request");
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
      gapCount: 1,
    });
    await expect(promise).resolves.toMatchObject({
      requestedCount: 1,
      results: [],
      gapChunkIds: ["asr-001"],
    });
    expect(onChunkGap).toHaveBeenCalledWith(
      "asr-001",
      "transcription-failed",
    );
  });

  it("rejects a partial result outside its chunk fence", async () => {
    const worker = new FakeWorker();
    const promise = runBroadcastTranscriptWorker(new File(["x"], "sample.mp4"), {
      sourceDurationMs: 2_000,
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
        modelId: "qwen3-asr-flash",
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
