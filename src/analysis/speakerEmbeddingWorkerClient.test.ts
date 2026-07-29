import { describe, expect, it, vi } from "vitest";

import {
  SPEAKER_EMBEDDING_DIMENSION,
  SPEAKER_EMBEDDING_MODEL_DESCRIPTOR,
  SPEAKER_EMBEDDING_PROTOCOL_VERSION,
  SpeakerEmbeddingWorkerClient,
  type RunSpeakerEmbeddingOptions,
  type SpeakerEmbeddingResult,
  type SpeakerEmbeddingRunIdentity,
  type SpeakerEmbeddingSourceInput,
  type SpeakerEmbeddingWorkerClientError,
  type SpeakerEmbeddingWorkerIdentity,
  type SpeakerEmbeddingWorkerLike,
} from "./speakerEmbeddingWorkerClient";
import type {
  SpeakerEmbeddingWorkerRequest,
  SpeakerEmbeddingWorkerResponse,
} from "./speakerEmbeddingWorkerProtocol";

type WorkerEventType = "message" | "messageerror" | "error";
type WorkerListener = (event: MessageEvent<unknown> | ErrorEvent) => void;
type SpeakerEmbeddingWorkerResponsePayload =
  SpeakerEmbeddingWorkerResponse extends infer Response
    ? Response extends {
        readonly identity: SpeakerEmbeddingWorkerIdentity;
        readonly eventId: string;
      }
      ? Omit<Response, "identity" | "eventId">
      : never
    : never;

const sourceFingerprint = `sha256:${"b".repeat(64)}`;
const identity: SpeakerEmbeddingRunIdentity = {
  protocolVersion: SPEAKER_EMBEDDING_PROTOCOL_VERSION,
  sessionId: "session-1",
  writerEpoch: 2,
  analysisRunId: "analysis-1",
  embeddingRunId: "speaker-run-1",
  workerEpoch: 3,
  workerInstanceId: "speaker-worker-1",
  taskId: "speaker-task-1",
};
const source: SpeakerEmbeddingSourceInput = {
  sourceFingerprint,
  sourceDurationMs: 60_000,
  sourceStartMs: 10_000,
  sourceEndMs: 13_000,
  sourceUnitId: "turn-1",
  audioBundleReuseKey:
    `participant-media-bundle-v1:${sourceFingerprint}:10000-13000:pcm16k-mono`,
  preparation: {
    speechActivity: "speech",
    speechActivityRevision: "vad-v1",
    overlapStatus: "verified-absent",
    musicStatus: "verified-absent",
    conditioningRevision: "conditioning-v1",
  },
};

function speechSamples(): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(48_000);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin(index / 17) * 0.15;
  }
  return samples;
}

function unitEmbedding(): Float32Array<ArrayBuffer> {
  const embedding = new Float32Array(SPEAKER_EMBEDDING_DIMENSION);
  embedding[0] = 1;
  return embedding;
}

class FakeWorker implements SpeakerEmbeddingWorkerLike {
  public readonly listeners = new Map<
    WorkerEventType,
    Set<WorkerListener>
  >();
  public readonly requests: SpeakerEmbeddingWorkerRequest[] = [];
  public readonly transfers: Transferable[][] = [];
  public terminateCount = 0;

  public addEventListener(
    type: WorkerEventType,
    listener: WorkerListener,
  ): void {
    const listeners = this.listeners.get(type) ?? new Set<WorkerListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public removeEventListener(
    type: WorkerEventType,
    listener: WorkerListener,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  public postMessage(
    message: SpeakerEmbeddingWorkerRequest,
    transfer: readonly Transferable[],
  ): void {
    this.requests.push(message);
    this.transfers.push([...transfer]);
  }

  public terminate(): void {
    this.terminateCount += 1;
  }

  public emit(data: unknown): void {
    const event = new MessageEvent("message", { data });
    for (const listener of this.listeners.get("message") ?? []) {
      listener(event);
    }
  }
}

async function analyzeRequest(
  worker: FakeWorker,
): Promise<Extract<
  SpeakerEmbeddingWorkerRequest,
  { readonly type: "speaker-embedding-analyze" }
>> {
  await vi.waitFor(() => {
    expect(worker.requests.length).toBeGreaterThan(0);
  });
  const request = worker.requests[0];
  if (request?.type !== "speaker-embedding-analyze") {
    throw new Error("Expected the analyze request.");
  }
  return request;
}

function emit(
  worker: FakeWorker,
  requestIdentity: SpeakerEmbeddingWorkerIdentity,
  eventId: string,
  payload: SpeakerEmbeddingWorkerResponsePayload,
): void {
  worker.emit({
    ...payload,
    identity: requestIdentity,
    eventId,
  });
}

function completedResult(
  request: Extract<
    SpeakerEmbeddingWorkerRequest,
    { readonly type: "speaker-embedding-analyze" }
  >,
  embedding = unitEmbedding(),
): SpeakerEmbeddingResult {
  return {
    embedding,
    receipt: {
      source: request.source,
      model: SPEAKER_EMBEDDING_MODEL_DESCRIPTOR,
      embeddingDimension: SPEAKER_EMBEDDING_DIMENSION,
      normalization: "l2",
    },
  };
}

function start(
  client: SpeakerEmbeddingWorkerClient,
  overrides: Partial<RunSpeakerEmbeddingOptions> = {},
): Promise<SpeakerEmbeddingResult> {
  return client.embed(speechSamples(), {
    identity,
    source,
    ...overrides,
  });
}

describe("SpeakerEmbeddingWorkerClient", () => {
  it("transfers one bounded PCM buffer and accepts an exact complete result", async () => {
    const worker = new FakeWorker();
    const progress = vi.fn();
    const client = new SpeakerEmbeddingWorkerClient({
      workerFactory: () => worker,
      timeoutMs: 5_000,
    });
    const pending = start(client, { onProgress: progress });
    const request = await analyzeRequest(worker);

    expect(request.samples).toBeInstanceOf(Float32Array);
    expect(request.samples.byteLength).toBe(48_000 * 4);
    expect(worker.transfers[0]).toEqual([request.samples.buffer]);
    expect(request.identity.inputFingerprint).toBe(
      request.source.inputFingerprint,
    );
    emit(worker, request.identity, "event-1", {
      type: "speaker-embedding-progress",
      progress: {
        stage: "running-inference",
        ratio: 0.92,
        loadedBytes: null,
        totalBytes: null,
      },
    });
    emit(worker, request.identity, "event-2", {
      type: "speaker-embedding-progress",
      progress: {
        stage: "complete",
        ratio: 1,
        loadedBytes: null,
        totalBytes: null,
      },
    });
    emit(worker, request.identity, "event-3", {
      type: "speaker-embedding-completed",
      result: completedResult(request),
    });

    const result = await pending;
    expect(result.embedding[0]).toBe(1);
    expect(result.receipt.source).toEqual(request.source);
    expect(progress).toHaveBeenCalledTimes(2);
    expect(worker.terminateCount).toBe(0);
    client.dispose();
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects a stale exact-input identity", async () => {
    const worker = new FakeWorker();
    const client = new SpeakerEmbeddingWorkerClient({
      workerFactory: () => worker,
    });
    const pending = start(client);
    const request = await analyzeRequest(worker);

    emit(
      worker,
      { ...request.identity, inputFingerprint: `sha256:${"c".repeat(64)}` },
      "stale-event",
      {
        type: "speaker-embedding-completed",
        result: completedResult(request),
      },
    );

    await expect(pending).rejects.toEqual(
      expect.objectContaining<Partial<SpeakerEmbeddingWorkerClientError>>({
        code: "STALE_IDENTITY",
      }),
    );
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects a partial completion instead of accepting missing evidence", async () => {
    const worker = new FakeWorker();
    const client = new SpeakerEmbeddingWorkerClient({
      workerFactory: () => worker,
    });
    const pending = start(client);
    const request = await analyzeRequest(worker);

    emit(worker, request.identity, "partial-event", {
      type: "speaker-embedding-completed",
      result: {
        embedding: unitEmbedding(),
      } as unknown as SpeakerEmbeddingResult,
    });

    await expect(pending).rejects.toEqual(
      expect.objectContaining<Partial<SpeakerEmbeddingWorkerClientError>>({
        code: "MALFORMED_RESPONSE",
      }),
    );
  });

  it.each([
    ["NaN", (() => {
      const value = unitEmbedding();
      value[4] = Number.NaN;
      return value;
    })()],
    ["zero", new Float32Array(SPEAKER_EMBEDDING_DIMENSION)],
  ])("rejects a %s model embedding", async (_label, embedding) => {
    const worker = new FakeWorker();
    const client = new SpeakerEmbeddingWorkerClient({
      workerFactory: () => worker,
    });
    const pending = start(client);
    const request = await analyzeRequest(worker);

    emit(worker, request.identity, "invalid-vector", {
      type: "speaker-embedding-completed",
      result: completedResult(request, embedding),
    });

    await expect(pending).rejects.toEqual(
      expect.objectContaining<Partial<SpeakerEmbeddingWorkerClientError>>({
        code: "MALFORMED_RESPONSE",
      }),
    );
  });

  it("aborts by cancelling and terminating the owned Worker", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const client = new SpeakerEmbeddingWorkerClient({
      workerFactory: () => worker,
    });
    const pending = start(client, { signal: controller.signal });
    const request = await analyzeRequest(worker);

    controller.abort();

    await expect(pending).rejects.toEqual(
      expect.objectContaining<Partial<SpeakerEmbeddingWorkerClientError>>({
        code: "ABORTED",
      }),
    );
    expect(worker.requests.at(-1)).toEqual({
      type: "speaker-embedding-cancel",
      identity: request.identity,
    });
    expect(worker.terminateCount).toBe(1);
  });

  it("enforces one in-flight turn per warm Worker owner", async () => {
    const worker = new FakeWorker();
    const client = new SpeakerEmbeddingWorkerClient({
      workerFactory: () => worker,
    });
    const first = start(client);
    const request = await analyzeRequest(worker);

    await expect(start(client)).rejects.toEqual(
      expect.objectContaining<Partial<SpeakerEmbeddingWorkerClientError>>({
        code: "BUSY",
      }),
    );
    emit(worker, request.identity, "complete-after-busy", {
      type: "speaker-embedding-completed",
      result: completedResult(request),
    });
    const firstResult = await first;
    expect(firstResult.receipt.source.inputFingerprint).toBe(
      request.identity.inputFingerprint,
    );
    client.dispose();
  });
});
