import {
  MAX_BROADCAST_CONTEXT_SUMMARY_LENGTH,
  type BroadcastContextChapterInput,
} from "./broadcastContextProtocol";
import type { BroadcastTranscriptQwenResult } from "./broadcastTranscriptQwen";

function representativeCodePoints(value: string, maximumLength: number): string {
  const points = Array.from(value);
  if (points.length <= maximumLength) return value;
  const separator = " … ";
  const separatorLength = Array.from(separator).length;
  const sampleCount = 4;
  const sampleLength = Math.floor(
    (maximumLength - separatorLength * (sampleCount - 1)) / sampleCount,
  );
  const maximumStart = points.length - sampleLength;
  return Array.from({ length: sampleCount }, (_, index) => {
    const start = Math.round((maximumStart * index) / (sampleCount - 1));
    return points.slice(start, start + sampleLength).join("");
  }).join(separator);
}

/**
 * Turns source-fenced ASR cells into the exact chapter evidence accepted by the
 * whole-context model. No sentence timestamp is invented inside an ASR cell.
 */
export function createBroadcastTranscriptChapters(
  transcripts: readonly BroadcastTranscriptQwenResult[],
  sourceDurationMs: number,
  completeAudioCoverage: boolean,
): readonly BroadcastContextChapterInput[] {
  if (!Number.isSafeInteger(sourceDurationMs) || sourceDurationMs <= 0) {
    throw new RangeError("Broadcast transcript source duration is invalid.");
  }
  const ordered = [...transcripts].sort(
    (left, right) =>
      left.sourceStartMs - right.sourceStartMs ||
      left.sourceEndMs - right.sourceEndMs,
  );
  let previousEndMs = -1;
  return ordered.map((transcript, index) => {
    if (
      !Number.isSafeInteger(transcript.sourceStartMs) ||
      !Number.isSafeInteger(transcript.sourceEndMs) ||
      transcript.sourceStartMs < 0 ||
      transcript.sourceEndMs <= transcript.sourceStartMs ||
      transcript.sourceEndMs > sourceDurationMs ||
      transcript.sourceStartMs < previousEndMs ||
      transcript.textKo.trim().length === 0
    ) {
      throw new RangeError("Broadcast transcript cells must be ordered source ranges.");
    }
    previousEndMs = transcript.sourceEndMs;
    const emotionPrefix = transcript.emotion === null
      ? ""
      : `[감정 단서: ${transcript.emotion}] `;
    return {
      chapterId: `transcript-${String(index + 1).padStart(3, "0")}`,
      startMs: transcript.sourceStartMs,
      endMs: transcript.sourceEndMs,
      evidenceMode: completeAudioCoverage
        ? "complete-transcript"
        : "sampled-audio-video",
      evidenceCoverageRatio: 1,
      summaryKo: representativeCodePoints(
        `${emotionPrefix}${transcript.textKo}`,
        MAX_BROADCAST_CONTEXT_SUMMARY_LENGTH,
      ),
    };
  });
}

/**
 * Combines already-paid chapter checkpoints with newly recovered ASR cells.
 * Exact ranges are replaced by the newer cell; partial overlaps are rejected
 * because they would make the source evidence ambiguous.
 */
export function mergeBroadcastTranscriptChapters(
  existing: readonly BroadcastContextChapterInput[],
  recovered: readonly BroadcastContextChapterInput[],
  sourceDurationMs: number,
  completeAudioCoverage: boolean,
): readonly BroadcastContextChapterInput[] {
  if (!Number.isSafeInteger(sourceDurationMs) || sourceDurationMs <= 0) {
    throw new RangeError("Broadcast transcript source duration is invalid.");
  }
  const byRange = new Map<string, BroadcastContextChapterInput>();
  for (const chapter of [...existing, ...recovered]) {
    if (
      !Number.isSafeInteger(chapter.startMs) ||
      !Number.isSafeInteger(chapter.endMs) ||
      chapter.startMs < 0 ||
      chapter.endMs <= chapter.startMs ||
      chapter.endMs > sourceDurationMs ||
      typeof chapter.summaryKo !== "string" ||
      chapter.summaryKo.trim().length === 0
    ) {
      throw new RangeError("Broadcast transcript checkpoint range is invalid.");
    }
    byRange.set(`${chapter.startMs}:${chapter.endMs}`, chapter);
  }
  const ordered = [...byRange.values()].sort(
    (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
  );
  let previousEndMs = -1;
  return ordered.map((chapter, index) => {
    if (chapter.startMs < previousEndMs) {
      throw new RangeError("Broadcast transcript checkpoints must not overlap.");
    }
    previousEndMs = chapter.endMs;
    return {
      ...chapter,
      chapterId: `transcript-${String(index + 1).padStart(3, "0")}`,
      evidenceMode: completeAudioCoverage
        ? "complete-transcript"
        : "sampled-audio-video",
      evidenceCoverageRatio: 1,
    };
  });
}
