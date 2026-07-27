export const BROADCAST_CONTEXT_SAMPLING_PLAN_VERSION = "1.2.0" as const;
export const QWEN_ASR_FILETRANS_USD_PER_SECOND = 0.000035;
export const BROADCAST_CONTEXT_ASR_BUDGET_USD = 0.42;
export const BROADCAST_CONTEXT_TOTAL_BUDGET_USD = 1;
/**
 * 한 요청에 담는 오디오 길이.
 *
 * 0.8.5의 30초는 Base64 전체를 Free Worker JavaScript가 검사·복사하던 구조의
 * 임시 완화였다. 0.8.6은 브라우저가 raw WAV를 보내고 Free 모드가 R2 native
 * checksum/stream put을 사용하므로 검증된 Qwen 3.5 Omni 상한인 90초로 복원한다.
 * paid-direct도 같은 raw WAV 계약을 사용해 요금제 전환이 chunk 계획을 바꾸지 않는다.
 */
export const QWEN_ASR_SAFE_CHUNK_DURATION_MS = 90_000;

const MAX_SOURCE_DURATION_MS = 12 * 60 * 60_000;
const CHAPTER_CELL_MS = 10 * 60_000;
const EVENT_CONTEXT_MS = 2 * 60_000;
const MAX_EVENT_PEAKS = 12;

export interface BroadcastContextSamplingWindow {
  readonly startMs: number;
  readonly endMs: number;
  readonly kind: "uniform" | "event" | "uniform-and-event";
}

export interface BroadcastContextTranscriptionChunk {
  readonly chunkId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly kind: BroadcastContextSamplingWindow["kind"];
}

export interface BroadcastContextChapterCell {
  readonly chapterId: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface BroadcastContextSamplingPlan {
  readonly schemaVersion: typeof BROADCAST_CONTEXT_SAMPLING_PLAN_VERSION;
  readonly sourceDurationMs: number;
  readonly transcriptMode: "external-complete" | "adaptive-qwen-asr";
  readonly chapterCells: readonly BroadcastContextChapterCell[];
  readonly samplingWindows: readonly BroadcastContextSamplingWindow[];
  readonly sampledAudioMs: number;
  readonly estimatedAudioCoverageRatio: number;
  readonly estimatedAsrCostUsd: number;
  readonly asrBudgetUsd: typeof BROADCAST_CONTEXT_ASR_BUDGET_USD;
  readonly totalAnalysisBudgetUsd: typeof BROADCAST_CONTEXT_TOTAL_BUDGET_USD;
}

interface MutableWindow {
  startMs: number;
  endMs: number;
  kinds: Set<"uniform" | "event">;
}

function createChapterCells(sourceDurationMs: number): BroadcastContextChapterCell[] {
  const count = Math.ceil(sourceDurationMs / CHAPTER_CELL_MS);
  return Array.from({ length: count }, (_, index) => ({
    chapterId: `chapter-${String(index + 1).padStart(3, "0")}`,
    startMs: index * CHAPTER_CELL_MS,
    endMs: Math.min(sourceDurationMs, (index + 1) * CHAPTER_CELL_MS),
  }));
}

function mergeWindows(windows: readonly MutableWindow[]): BroadcastContextSamplingWindow[] {
  const ordered = [...windows].sort(
    (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
  );
  const merged: MutableWindow[] = [];
  for (const window of ordered) {
    const previous = merged.at(-1);
    if (previous === undefined || window.startMs > previous.endMs) {
      merged.push({
        startMs: window.startMs,
        endMs: window.endMs,
        kinds: new Set(window.kinds),
      });
      continue;
    }
    previous.endMs = Math.max(previous.endMs, window.endMs);
    for (const kind of window.kinds) previous.kinds.add(kind);
  }
  return merged.map((window) => ({
    startMs: Math.round(window.startMs),
    endMs: Math.round(window.endMs),
    kind:
      window.kinds.size === 2
        ? "uniform-and-event"
        : window.kinds.has("event")
          ? "event"
          : "uniform",
  }));
}

function totalWindowDurationMs(
  windows: readonly Pick<BroadcastContextSamplingWindow, "startMs" | "endMs">[],
): number {
  return windows.reduce((sum, window) => sum + window.endMs - window.startMs, 0);
}

function trimWindowsToDurationBudget(
  windows: readonly BroadcastContextSamplingWindow[],
  maximumDurationMs: number,
): BroadcastContextSamplingWindow[] {
  const trimmed: BroadcastContextSamplingWindow[] = [];
  let remainingMs = maximumDurationMs;
  for (const window of windows) {
    if (remainingMs <= 0) break;
    const durationMs = window.endMs - window.startMs;
    const keptDurationMs = Math.min(durationMs, remainingMs);
    if (keptDurationMs > 0) {
      trimmed.push({
        ...window,
        endMs: window.startMs + keptDurationMs,
      });
      remainingMs -= keptDurationMs;
    }
  }
  return trimmed;
}

/**
 * Converts the cost plan into bounded requests for the synchronous browser to
 * Worker path. Source offsets stay explicit because this ASR interface returns
 * text but no word timestamps. The long-file Filetrans adapter can consume the
 * same sampling windows without using these transport chunks.
 */
export function createBroadcastContextTranscriptionChunks(
  samplingWindows: readonly BroadcastContextSamplingWindow[],
  maximumChunkDurationMs = QWEN_ASR_SAFE_CHUNK_DURATION_MS,
): BroadcastContextTranscriptionChunk[] {
  if (
    !Number.isSafeInteger(maximumChunkDurationMs) ||
    maximumChunkDurationMs <= 0 ||
    maximumChunkDurationMs > QWEN_ASR_SAFE_CHUNK_DURATION_MS
  ) {
    throw new RangeError("Qwen ASR chunks must use the safe request duration.");
  }

  const chunks: BroadcastContextTranscriptionChunk[] = [];
  for (const window of samplingWindows) {
    if (
      !Number.isSafeInteger(window.startMs) ||
      !Number.isSafeInteger(window.endMs) ||
      window.startMs < 0 ||
      window.endMs <= window.startMs
    ) {
      throw new RangeError("Broadcast context sampling window is invalid.");
    }
    let sourceStartMs = window.startMs;
    while (sourceStartMs < window.endMs) {
      const sourceEndMs = Math.min(
        window.endMs,
        sourceStartMs + maximumChunkDurationMs,
      );
      chunks.push({
        // The identity is source-fenced rather than array-position-fenced.
        // Rebuilding only uncovered windows after a reload must produce the
        // same key for the same paid audio range.
        chunkId: `asr-${sourceStartMs.toString(36)}-${sourceEndMs.toString(36)}`,
        sourceStartMs,
        sourceEndMs,
        kind: window.kind,
      });
      sourceStartMs = sourceEndMs;
    }
  }
  return chunks;
}

/** Returns only sampled source ranges not already represented by a checkpoint. */
export function subtractBroadcastContextCoveredRanges(
  samplingWindows: readonly BroadcastContextSamplingWindow[],
  coveredRanges: readonly { readonly startMs: number; readonly endMs: number }[],
): readonly BroadcastContextSamplingWindow[] {
  const orderedCoverage = [...coveredRanges].sort(
    (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
  );
  const uncovered: BroadcastContextSamplingWindow[] = [];
  for (const window of samplingWindows) {
    let cursorMs = window.startMs;
    for (const covered of orderedCoverage) {
      if (covered.endMs <= cursorMs) continue;
      if (covered.startMs >= window.endMs) break;
      if (covered.startMs > cursorMs) {
        uncovered.push({
          startMs: cursorMs,
          endMs: Math.min(window.endMs, covered.startMs),
          kind: window.kind,
        });
      }
      cursorMs = Math.max(cursorMs, Math.min(window.endMs, covered.endMs));
      if (cursorMs >= window.endMs) break;
    }
    if (cursorMs < window.endMs) {
      uncovered.push({
        startMs: cursorMs,
        endMs: window.endMs,
        kind: window.kind,
      });
    }
  }
  return uncovered;
}

function boundedEventPeaks(
  eventPeakMs: readonly number[],
  sourceDurationMs: number,
): number[] {
  return [...new Set(eventPeakMs)]
    .filter(
      (peakMs) =>
        Number.isSafeInteger(peakMs) && peakMs >= 0 && peakMs < sourceDurationMs,
    )
    .sort((left, right) => left - right)
    .slice(0, MAX_EVENT_PEAKS);
}

/**
 * Plans coverage only; decoding, ASR calls, retries, and persistence are separate
 * phases. Uniform samples span every ten-minute cell, while event neighborhoods
 * preserve likely setup/payoff context without consuming the whole budget.
 */
export function createBroadcastContextSamplingPlan(
  sourceDurationMs: number,
  eventPeakMs: readonly number[],
  hasCompleteExternalTranscript = false,
): BroadcastContextSamplingPlan {
  if (
    !Number.isSafeInteger(sourceDurationMs) ||
    sourceDurationMs <= 0 ||
    sourceDurationMs > MAX_SOURCE_DURATION_MS
  ) {
    throw new RangeError("Broadcast context sampling supports sources up to 12 hours.");
  }
  const chapterCells = createChapterCells(sourceDurationMs);
  if (hasCompleteExternalTranscript) {
    return {
      schemaVersion: BROADCAST_CONTEXT_SAMPLING_PLAN_VERSION,
      sourceDurationMs,
      transcriptMode: "external-complete",
      chapterCells,
      samplingWindows: [],
      sampledAudioMs: 0,
      estimatedAudioCoverageRatio: 1,
      estimatedAsrCostUsd: 0,
      asrBudgetUsd: BROADCAST_CONTEXT_ASR_BUDGET_USD,
      totalAnalysisBudgetUsd: BROADCAST_CONTEXT_TOTAL_BUDGET_USD,
    };
  }

  const maximumAsrMs = Math.floor(
    (BROADCAST_CONTEXT_ASR_BUDGET_USD / QWEN_ASR_FILETRANS_USD_PER_SECOND) * 1_000,
  );
  if (sourceDurationMs <= maximumAsrMs) {
    const estimatedAsrCostUsd =
      (sourceDurationMs / 1_000) * QWEN_ASR_FILETRANS_USD_PER_SECOND;
    return {
      schemaVersion: BROADCAST_CONTEXT_SAMPLING_PLAN_VERSION,
      sourceDurationMs,
      transcriptMode: "adaptive-qwen-asr",
      chapterCells,
      samplingWindows: [
        {
          startMs: 0,
          endMs: sourceDurationMs,
          kind: eventPeakMs.length > 0 ? "uniform-and-event" : "uniform",
        },
      ],
      sampledAudioMs: sourceDurationMs,
      estimatedAudioCoverageRatio: 1,
      estimatedAsrCostUsd,
      asrBudgetUsd: BROADCAST_CONTEXT_ASR_BUDGET_USD,
      totalAnalysisBudgetUsd: BROADCAST_CONTEXT_TOTAL_BUDGET_USD,
    };
  }
  const eventWindows = boundedEventPeaks(eventPeakMs, sourceDurationMs).map(
    (peakMs): MutableWindow => ({
      startMs: Math.max(0, peakMs - EVENT_CONTEXT_MS / 2),
      endMs: Math.min(sourceDurationMs, peakMs + EVENT_CONTEXT_MS / 2),
      kinds: new Set(["event"]),
    }),
  );
  const mergedEventWindows = mergeWindows(eventWindows);
  const eventAudioMs = totalWindowDurationMs(mergedEventWindows);
  const uniformBudgetMs = Math.max(
    0,
    Math.min(sourceDurationMs, maximumAsrMs - eventAudioMs),
  );
  const uniformPerCellMs = uniformBudgetMs / chapterCells.length;
  const uniformWindows: MutableWindow[] = [];

  for (const cell of chapterCells) {
    const cellDurationMs = cell.endMs - cell.startMs;
    const cellSampleMs = Math.min(cellDurationMs, uniformPerCellMs);
    if (cellSampleMs <= 0) continue;
    if (cellSampleMs >= cellDurationMs) {
      uniformWindows.push({
        startMs: cell.startMs,
        endMs: cell.endMs,
        kinds: new Set(["uniform"]),
      });
      continue;
    }
    const sampleCount = cellSampleMs >= 90_000 ? 3 : cellSampleMs >= 40_000 ? 2 : 1;
    const sampleDurationMs = cellSampleMs / sampleCount;
    for (let index = 0; index < sampleCount; index += 1) {
      const centerRatio = (index + 1) / (sampleCount + 1);
      const centerMs = cell.startMs + centerRatio * cellDurationMs;
      const startMs = Math.max(
        cell.startMs,
        Math.min(cell.endMs - sampleDurationMs, centerMs - sampleDurationMs / 2),
      );
      uniformWindows.push({
        startMs,
        endMs: startMs + sampleDurationMs,
        kinds: new Set(["uniform"]),
      });
    }
  }

  const samplingWindows = trimWindowsToDurationBudget(
    mergeWindows([...eventWindows, ...uniformWindows]),
    maximumAsrMs,
  );
  const sampledAudioMs = Math.min(
    sourceDurationMs,
    totalWindowDurationMs(samplingWindows),
  );
  const estimatedAsrCostUsd =
    (sampledAudioMs / 1_000) * QWEN_ASR_FILETRANS_USD_PER_SECOND;

  return {
    schemaVersion: BROADCAST_CONTEXT_SAMPLING_PLAN_VERSION,
    sourceDurationMs,
    transcriptMode: "adaptive-qwen-asr",
    chapterCells,
    samplingWindows,
    sampledAudioMs,
    estimatedAudioCoverageRatio: sampledAudioMs / sourceDurationMs,
    estimatedAsrCostUsd,
    asrBudgetUsd: BROADCAST_CONTEXT_ASR_BUDGET_USD,
    totalAnalysisBudgetUsd: BROADCAST_CONTEXT_TOTAL_BUDGET_USD,
  };
}
