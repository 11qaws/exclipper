import {
  MAX_BROADCAST_CONTEXT_SUMMARY_LENGTH,
  type BroadcastContextChapterInput,
} from "./broadcastContextProtocol";
import type { BroadcastTranscriptQwenResult } from "./broadcastTranscriptQwen";
import type { BroadcastContextTranscriptionChunk } from "./broadcastContextSamplingPlan";

const BROADCAST_NO_AUDIO_SUMMARY_KO =
  "이 구간에서는 정상 디코딩된 오디오에서 분석 가능한 발화나 소리를 감지하지 못했습니다.";
const BROADCAST_NO_SPEECH_SUMMARY_KO =
  "이 구간에서는 음성 활동 모델이 확신할 수 있는 사람 발화를 감지하지 못했습니다. 화면 사건 분석 대상은 그대로 유지됩니다.";

export type BroadcastResolvedAbstentionReason = "no-audio" | "no-speech";

/**
 * Recognizes only ExClipper's own legacy placeholder text. It exists solely to
 * migrate pre-ledger sessions; new checkpoints keep these ranges out of the
 * dialogue chapter array.
 */
export function broadcastResolvedAbstentionReasonForChapter(
  chapter: Pick<BroadcastContextChapterInput, "summaryKo">,
): BroadcastResolvedAbstentionReason | null {
  if (chapter.summaryKo === BROADCAST_NO_AUDIO_SUMMARY_KO) return "no-audio";
  if (chapter.summaryKo === BROADCAST_NO_SPEECH_SUMMARY_KO) return "no-speech";
  return null;
}

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
 * Records a successfully decoded range that contains no usable audio.
 *
 * This is resolved negative evidence, not a failed transcript gap. Keeping its
 * exact source fence in the checkpoint prevents reloads and later phases from
 * repeatedly paying to inspect the same silent range.
 */
export function createBroadcastNoAudioChapters(
  chunks: readonly BroadcastContextTranscriptionChunk[],
  sourceDurationMs: number,
): readonly BroadcastContextChapterInput[] {
  return createBroadcastResolvedAbstentionChapters(
    chunks,
    sourceDurationMs,
    "no-audio",
  );
}

/**
 * Records a source range whose every valid VAD frame confidently selected the
 * pinned model's NO_SPEAKER class.
 *
 * This only removes the range from dialogue transcription. It deliberately
 * says nothing about music, effects, or visually meaningful events, so the
 * video/context pipeline may continue to inspect the same source range.
 */
export function createBroadcastNoSpeechChapters(
  chunks: readonly BroadcastContextTranscriptionChunk[],
  sourceDurationMs: number,
): readonly BroadcastContextChapterInput[] {
  return createBroadcastResolvedAbstentionChapters(
    chunks,
    sourceDurationMs,
    "no-speech",
  );
}

function createBroadcastResolvedAbstentionChapters(
  chunks: readonly BroadcastContextTranscriptionChunk[],
  sourceDurationMs: number,
  reason: "no-audio" | "no-speech",
): readonly BroadcastContextChapterInput[] {
  if (!Number.isSafeInteger(sourceDurationMs) || sourceDurationMs <= 0) {
    throw new RangeError(
      "Broadcast transcript abstention source duration is invalid.",
    );
  }
  const ordered = [...chunks].sort(
    (left, right) =>
      left.sourceStartMs - right.sourceStartMs ||
      left.sourceEndMs - right.sourceEndMs ||
      left.chunkId.localeCompare(right.chunkId),
  );
  let previousEndMs = -1;
  return ordered.map((chunk, index) => {
    if (
      !Number.isSafeInteger(chunk.sourceStartMs) ||
      !Number.isSafeInteger(chunk.sourceEndMs) ||
      chunk.sourceStartMs < 0 ||
      chunk.sourceEndMs <= chunk.sourceStartMs ||
      chunk.sourceEndMs > sourceDurationMs ||
      chunk.sourceStartMs < previousEndMs
    ) {
      throw new RangeError(
        "Broadcast transcript abstention cells must be ordered source ranges.",
      );
    }
    previousEndMs = chunk.sourceEndMs;
    return {
      chapterId: `${reason}-${String(index + 1).padStart(3, "0")}`,
      startMs: chunk.sourceStartMs,
      endMs: chunk.sourceEndMs,
      evidenceMode: "sampled-audio-video",
      evidenceCoverageRatio: 1,
      summaryKo:
        reason === "no-audio"
          ? BROADCAST_NO_AUDIO_SUMMARY_KO
          : BROADCAST_NO_SPEECH_SUMMARY_KO,
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
