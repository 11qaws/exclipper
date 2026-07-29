import type { BroadcastContextTranscriptionChunk } from "./broadcastContextSamplingPlan";
import {
  BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
  MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS,
} from "./broadcastTranscriptQwen";
import {
  createBroadcastTranscriptProviderReceipt,
  isBroadcastTranscriptRouteSelection,
  normalizeBroadcastTranscriptProviderReceipt,
  type BroadcastTranscriptRouteSelection,
  type BroadcastTranscriptVerifiedResult,
} from "./broadcastTranscriptRouteManifest";
import {
  MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS,
  isBroadcastTranscriptChunkId,
  type BroadcastTranscriptChunkAbstention,
  type BroadcastTranscriptChunkGap,
  type BroadcastTranscriptChunkGapReason,
  type BroadcastTranscriptQuotaIdentity,
  type BroadcastTranscriptWorkerProgress,
  type BroadcastTranscriptWorkerRequest,
  type BroadcastTranscriptWorkerResponse,
} from "./broadcastTranscriptWorkerProtocol";
import {
  broadcastSpeechActivityCanSkipAsr,
  normalizeBroadcastSpeechActivityRunReceipt,
} from "./broadcastSpeechActivity";

interface WorkerLike {
  postMessage(message: BroadcastTranscriptWorkerRequest): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: "error" | "messageerror", listener: () => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: () => void): void;
  terminate(): void;
}

export interface RunBroadcastTranscriptWorkerOptions {
  readonly sourceDurationMs: number;
  readonly chunks: readonly BroadcastContextTranscriptionChunk[];
  readonly route: BroadcastTranscriptRouteSelection;
  readonly quota?: BroadcastTranscriptQuotaIdentity;
  readonly signal?: AbortSignal;
  readonly workerFactory?: () => WorkerLike;
  readonly onProgress?: (progress: BroadcastTranscriptWorkerProgress) => void;
  readonly onPartialResult?: (
    chunkId: string,
    result: BroadcastTranscriptVerifiedResult,
  ) => void;
  readonly onChunkGap?: (
    chunkId: string,
    reason: BroadcastTranscriptChunkGapReason,
  ) => void;
  readonly onChunkAbstention?: (
    abstention: BroadcastTranscriptChunkAbstention,
  ) => void;
}

export interface BroadcastTranscriptWorkerFragment {
  readonly chunkId: string;
  readonly result: BroadcastTranscriptVerifiedResult;
}

export interface BroadcastTranscriptWorkerRunResult {
  readonly fragments: readonly BroadcastTranscriptWorkerFragment[];
  readonly results: readonly BroadcastTranscriptVerifiedResult[];
  readonly abstentions: readonly BroadcastTranscriptChunkAbstention[];
  readonly abstainedChunkIds: readonly string[];
  readonly gaps: readonly BroadcastTranscriptChunkGap[];
  readonly gapChunkIds: readonly string[];
  readonly requestedCount: number;
  /** 동시성이 어디서 멈췄나. 실측 표에 남긴다. */
  readonly concurrencyOutcome: string;
}

export class BroadcastTranscriptWorkerClientError extends Error {
  public constructor(
    public readonly code:
      | "INVALID_INPUT"
      | "ABORTED"
      | "WORKER_FAILED"
      | "WORKER_MESSAGE_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "BroadcastTranscriptWorkerClientError";
  }
}

function createWorker(): WorkerLike {
  return new Worker(new URL("./broadcastTranscript.worker.ts", import.meta.url), {
    type: "module",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validResult(
  value: unknown,
  chunk: BroadcastContextTranscriptionChunk,
  route: BroadcastTranscriptRouteSelection,
): value is BroadcastTranscriptVerifiedResult {
  if (
    !isRecord(value) ||
    value.schemaVersion !== BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION ||
    typeof value.modelRevision !== "string" ||
    value.sourceStartMs !== chunk.sourceStartMs ||
    value.sourceEndMs !== chunk.sourceEndMs ||
    typeof value.textKo !== "string" ||
    value.textKo.trim().length === 0 ||
    (value.detectedLanguage !== null &&
      typeof value.detectedLanguage !== "string") ||
    (value.emotion !== null && typeof value.emotion !== "string") ||
    !(
      value.billedSeconds === null ||
      (typeof value.billedSeconds === "number" &&
        Number.isFinite(value.billedSeconds) &&
        value.billedSeconds >= 0)
    )
  ) {
    return false;
  }
  try {
    const receipt = normalizeBroadcastTranscriptProviderReceipt(
      value.providerReceipt,
    );
    const expected = createBroadcastTranscriptProviderReceipt(
      route,
      value.modelId,
      value.modelRevision,
      receipt.fallbackUsed,
    );
    return (
      receipt.routeManifestFingerprint === route.fingerprint &&
      receipt.modelId === value.modelId &&
      receipt.modelRevision === value.modelRevision &&
      JSON.stringify(receipt) === JSON.stringify(expected)
    );
  } catch {
    return false;
  }
}

function inputIssue(
  file: File,
  sourceDurationMs: number,
  chunks: readonly BroadcastContextTranscriptionChunk[],
  route: BroadcastTranscriptRouteSelection,
): string | null {
  if (!isBroadcastTranscriptRouteSelection(route)) {
    return "방송 대사 분석 모델 경로가 고정되지 않았어요.";
  }
  if (
    typeof file.name !== "string" ||
    file.name.trim().length === 0 ||
    !Number.isFinite(file.size) ||
    file.size < 0 ||
    typeof file.slice !== "function"
  ) {
    return "원본 영상 파일 연결을 확인하지 못했어요.";
  }
  if (
    !Number.isSafeInteger(sourceDurationMs) ||
    sourceDurationMs <= 0 ||
    sourceDurationMs > 12 * 60 * 60_000
  ) {
    return "원본 영상 길이가 1ms~12시간 범위를 벗어났어요.";
  }
  if (chunks.length === 0) return "분석할 대사 구간이 비어 있어요.";
  if (chunks.length > MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS) {
    return `대사 분석 구간이 ${chunks.length}개라 현재 상한 ${MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS}개를 넘었어요.`;
  }
  const ids = new Set<string>();
  for (const [index, chunk] of chunks.entries()) {
    const ordinal = index + 1;
    if (!isBroadcastTranscriptChunkId(chunk.chunkId)) {
      return `${ordinal}번째 대사 구간 ID 형식을 확인할 수 없어요.`;
    }
    if (ids.has(chunk.chunkId)) return `${ordinal}번째 대사 구간 ID가 앞 구간과 겹쳐요.`;
    if (
      !Number.isSafeInteger(chunk.sourceStartMs) ||
      !Number.isSafeInteger(chunk.sourceEndMs)
    ) {
      return `${ordinal}번째 대사 구간 시간이 정수 밀리초가 아니에요.`;
    }
    if (chunk.sourceStartMs < 0 || chunk.sourceEndMs <= chunk.sourceStartMs) {
      return `${ordinal}번째 대사 구간의 시작·끝 순서가 올바르지 않아요.`;
    }
    if (chunk.sourceEndMs > sourceDurationMs) {
      return `${ordinal}번째 대사 구간이 원본 영상 끝을 넘어가요.`;
    }
    if (
      chunk.sourceEndMs - chunk.sourceStartMs >
      MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS
    ) {
      return `${ordinal}번째 대사 구간이 90초 안전 길이를 넘었어요.`;
    }
    ids.add(chunk.chunkId);
  }
  const chronological = [...chunks].sort(
    (left, right) =>
      left.sourceStartMs - right.sourceStartMs ||
      left.sourceEndMs - right.sourceEndMs ||
      left.chunkId.localeCompare(right.chunkId),
  );
  let previousEndMs = -1;
  for (const chunk of chronological) {
    if (chunk.sourceStartMs < previousEndMs) {
      return `대사 구간 ${chunk.chunkId}이 다른 구간과 시간상 겹쳐요.`;
    }
    previousEndMs = chunk.sourceEndMs;
  }
  return null;
}

function isResponse(value: unknown): value is BroadcastTranscriptWorkerResponse {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    isRecord(value.identity) &&
    typeof value.identity.taskId === "string" &&
    [
      "broadcast-transcript-progress",
      "broadcast-transcript-partial",
      "broadcast-transcript-abstention",
      "broadcast-transcript-gap",
      "broadcast-transcript-complete",
      "broadcast-transcript-cancelled",
      "broadcast-transcript-failed",
    ].includes(value.type)
  );
}

function normalizeWorkerAbstention(
  value: Extract<
    BroadcastTranscriptWorkerResponse,
    { readonly type: "broadcast-transcript-abstention" }
  >,
  chunk: BroadcastContextTranscriptionChunk,
  sourceDurationMs: number,
): BroadcastTranscriptChunkAbstention | null {
  if (value.reason === "no-audio") {
    return value.speechActivityReceipt === null
      ? {
          chunkId: chunk.chunkId,
          reason: "no-audio",
          speechActivityReceipt: null,
        }
      : null;
  }
  if (value.reason !== "no-speech") return null;
  const receipt = normalizeBroadcastSpeechActivityRunReceipt(
    value.speechActivityReceipt,
  );
  if (
    receipt === null ||
    receipt.sourceDurationMs !== sourceDurationMs ||
    receipt.sourceStartMs !== chunk.sourceStartMs ||
    receipt.sourceEndMs !== chunk.sourceEndMs ||
    !receipt.coverage.complete ||
    receipt.coverage.repairRequired ||
    receipt.coverage.asrRequiredDurationMs !== 0 ||
    receipt.cells.length !== receipt.coverage.plannedCellCount ||
    !receipt.cells.every(broadcastSpeechActivityCanSkipAsr)
  ) {
    return null;
  }
  return {
    chunkId: chunk.chunkId,
    reason: "no-speech",
    speechActivityReceipt: receipt,
  };
}

export function runBroadcastTranscriptWorker(
  file: File,
  options: RunBroadcastTranscriptWorkerOptions,
): Promise<BroadcastTranscriptWorkerRunResult> {
  const issue = inputIssue(
    file,
    options.sourceDurationMs,
    options.chunks,
    options.route,
  );
  if (issue !== null) {
    return Promise.reject(
      new BroadcastTranscriptWorkerClientError(
        "INVALID_INPUT",
        `방송 전체 대사 분석 범위를 준비하지 못했어요. ${issue}`,
      ),
    );
  }
  if (options.signal?.aborted === true) {
    return Promise.reject(
      new BroadcastTranscriptWorkerClientError(
        "ABORTED",
        "방송 전체 대사 분석이 취소됐어요.",
      ),
    );
  }
  const identity = { taskId: crypto.randomUUID() };
  const worker = (options.workerFactory ?? createWorker)();
  const chunkById = new Map(options.chunks.map((chunk) => [chunk.chunkId, chunk]));
  const chronologicalChunks = [...options.chunks].sort(
    (left, right) =>
      left.sourceStartMs - right.sourceStartMs ||
      left.sourceEndMs - right.sourceEndMs ||
      left.chunkId.localeCompare(right.chunkId),
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    const resultsByChunkId =
      new Map<string, BroadcastTranscriptVerifiedResult>();
    const abstentionByChunkId =
      new Map<string, BroadcastTranscriptChunkAbstention>();
    const gapReasonByChunkId = new Map<string, BroadcastTranscriptChunkGapReason>();

    const cleanup = (): void => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onWorkerError);
      worker.removeEventListener("messageerror", onWorkerError);
      options.signal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const fail = (error: BroadcastTranscriptWorkerClientError): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = (): void => {
      try {
        worker.postMessage({
          type: "broadcast-transcript-cancel",
          identity,
        });
      } finally {
        fail(
          new BroadcastTranscriptWorkerClientError(
            "ABORTED",
            "방송 전체 대사 분석이 취소됐어요.",
          ),
        );
      }
    };
    const onWorkerError = (): void => {
      fail(
        new BroadcastTranscriptWorkerClientError(
          "WORKER_FAILED",
          "방송 전체 대사 분석 작업이 멈췄어요.",
        ),
      );
    };
    const malformed = (): void => {
      fail(
        new BroadcastTranscriptWorkerClientError(
          "WORKER_MESSAGE_ERROR",
          "방송 전체 대사 분석 결과를 확인하지 못했어요.",
        ),
      );
    };
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (!isResponse(event.data) || event.data.identity.taskId !== identity.taskId) {
        malformed();
        return;
      }
      switch (event.data.type) {
        case "broadcast-transcript-progress": {
          const chunk = chunkById.get(event.data.progress.chunkId);
          if (
            chunk === undefined ||
            event.data.progress.totalCount !== options.chunks.length ||
            event.data.progress.completedCount < 0 ||
            event.data.progress.completedCount > options.chunks.length
          ) {
            malformed();
            return;
          }
          try {
            options.onProgress?.(event.data.progress);
          } catch {
            malformed();
          }
          return;
        }
        case "broadcast-transcript-partial": {
          const chunk = chunkById.get(event.data.chunkId);
          if (
            chunk === undefined ||
            resultsByChunkId.has(event.data.chunkId) ||
            abstentionByChunkId.has(event.data.chunkId) ||
            gapReasonByChunkId.has(event.data.chunkId) ||
            !validResult(event.data.result, chunk, options.route)
          ) {
            malformed();
            return;
          }
          resultsByChunkId.set(event.data.chunkId, event.data.result);
          try {
            options.onPartialResult?.(event.data.chunkId, event.data.result);
          } catch {
            malformed();
          }
          return;
        }
        case "broadcast-transcript-abstention": {
          const chunk = chunkById.get(event.data.chunkId);
          const abstention =
            chunk === undefined
              ? null
              : normalizeWorkerAbstention(
                  event.data,
                  chunk,
                  options.sourceDurationMs,
                );
          if (
            chunk === undefined ||
            abstention === null ||
            resultsByChunkId.has(event.data.chunkId) ||
            abstentionByChunkId.has(event.data.chunkId) ||
            gapReasonByChunkId.has(event.data.chunkId)
          ) {
            malformed();
            return;
          }
          abstentionByChunkId.set(
            event.data.chunkId,
            abstention,
          );
          try {
            options.onChunkAbstention?.(abstention);
          } catch {
            malformed();
          }
          return;
        }
        case "broadcast-transcript-gap":
          if (
            !chunkById.has(event.data.chunkId) ||
            resultsByChunkId.has(event.data.chunkId) ||
            abstentionByChunkId.has(event.data.chunkId) ||
            gapReasonByChunkId.has(event.data.chunkId) ||
            ![
              "decode-failed",
              "no-audio",
              "transcription-failed",
              "rate-limited",
              "outcome-unknown",
            ].includes(event.data.reason)
          ) {
            malformed();
            return;
          }
          gapReasonByChunkId.set(event.data.chunkId, event.data.reason);
          try {
            options.onChunkGap?.(event.data.chunkId, event.data.reason);
          } catch {
            malformed();
          }
          return;
        case "broadcast-transcript-complete": {
          if (
            event.data.requestedCount !== options.chunks.length ||
            event.data.completedCount !== resultsByChunkId.size ||
            event.data.abstentionCount !== abstentionByChunkId.size ||
            event.data.gapCount !== gapReasonByChunkId.size ||
            resultsByChunkId.size +
                abstentionByChunkId.size +
                gapReasonByChunkId.size !==
              options.chunks.length
          ) {
            malformed();
            return;
          }
          settled = true;
          cleanup();
          const fragments = chronologicalChunks.flatMap((chunk) => {
            const result = resultsByChunkId.get(chunk.chunkId);
            return result === undefined
              ? []
              : [{ chunkId: chunk.chunkId, result }];
          });
          const gaps = chronologicalChunks.flatMap((chunk) => {
            const reason = gapReasonByChunkId.get(chunk.chunkId);
            return reason === undefined
              ? []
              : [{ chunkId: chunk.chunkId, reason }];
          });
          const abstentions = chronologicalChunks.flatMap((chunk) => {
            const abstention = abstentionByChunkId.get(chunk.chunkId);
            return abstention === undefined
              ? []
              : [abstention];
          });
          resolve({
            fragments,
            results: fragments.map(({ result }) => result),
            abstentions,
            abstainedChunkIds: abstentions.map(({ chunkId }) => chunkId),
            gaps,
            gapChunkIds: gaps.map(({ chunkId }) => chunkId),
            requestedCount: options.chunks.length,
            concurrencyOutcome: event.data.concurrencyOutcome,
          });
          return;
        }
        case "broadcast-transcript-cancelled":
          onAbort();
          return;
        case "broadcast-transcript-failed":
          onWorkerError();
      }
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onWorkerError);
    worker.addEventListener("messageerror", onWorkerError);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    worker.postMessage({
      type: "broadcast-transcript-analyze",
      identity,
      ...(options.quota === undefined ? {} : { quota: options.quota }),
      route: options.route,
      file,
      sourceDurationMs: options.sourceDurationMs,
      chunks: options.chunks,
    });
  });
}
