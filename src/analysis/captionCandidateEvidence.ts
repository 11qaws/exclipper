import type {
  BroadcastContextChapterInput,
} from "./broadcastContextProtocol";
import type {
  YouTubeCaptionEvent,
} from "./youtubeCaptionTrack";

const MUSIC_CUE_PATTERN = /\[(?:음악|노래|music|bgm|브금)\]/giu;
const NON_SPEECH_CUE_PATTERN = /\[(?:박수|웃음|비명|환호|효과음|소음|무음)\]/giu;
const MAX_CANDIDATE_TRANSCRIPT_LENGTH = 12_000;

function boundedJoinedText(values: readonly string[], maximumLength: number): string {
  return Array.from(
    values
      .join(" ")
      .normalize("NFKC")
      .replace(/[\p{Cc}\p{Cf}]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim(),
  )
    .slice(0, maximumLength)
    .join("")
    .trim();
}

/**
 * Returns only source-fenced caption text for a candidate.  This is preferred
 * over a two-minute context chapter because neighboring dialogue must not make
 * an opening-music candidate look like speech.
 */
export function captionTextForRange(
  events: readonly YouTubeCaptionEvent[],
  startMs: number,
  endMs: number,
  maximumLength = MAX_CANDIDATE_TRANSCRIPT_LENGTH,
): string {
  if (
    !Number.isSafeInteger(startMs) ||
    !Number.isSafeInteger(endMs) ||
    startMs < 0 ||
    endMs <= startMs ||
    !Number.isSafeInteger(maximumLength) ||
    maximumLength <= 0
  ) {
    return "";
  }
  return boundedJoinedText(
    events
      .filter(
        (event) =>
          event.startMs < endMs &&
          event.startMs + Math.max(0, event.durationMs) >= startMs,
      )
      .sort((left, right) => left.startMs - right.startMs)
      .map((event) => event.text),
    maximumLength,
  );
}

/** Fallback when only the persisted coarse transcript map is available. */
export function chapterTextForRange(
  chapters: readonly BroadcastContextChapterInput[],
  startMs: number,
  endMs: number,
  maximumLength = MAX_CANDIDATE_TRANSCRIPT_LENGTH,
): string {
  if (
    !Number.isSafeInteger(startMs) ||
    !Number.isSafeInteger(endMs) ||
    startMs < 0 ||
    endMs <= startMs ||
    !Number.isSafeInteger(maximumLength) ||
    maximumLength <= 0
  ) {
    return "";
  }
  return boundedJoinedText(
    chapters
      .filter((chapter) => chapter.startMs < endMs && chapter.endMs > startMs)
      .sort((left, right) => left.startMs - right.startMs)
      .map((chapter) => chapter.summaryKo),
    maximumLength,
  );
}

/**
 * A deterministic, precision-first opening/song gate.  It only fires when the
 * caption provider explicitly marked music and no plausible Korean utterance
 * remains.  Ordinary foreign-language dialogue and unmarked audio are left to
 * the context model instead of being guessed away locally.
 */
export function isExplicitMusicOnlyCaption(text: string): boolean {
  const normalized = text.normalize("NFKC").trim();
  if (!MUSIC_CUE_PATTERN.test(normalized)) {
    MUSIC_CUE_PATTERN.lastIndex = 0;
    return false;
  }
  MUSIC_CUE_PATTERN.lastIndex = 0;
  const remainder = normalized
    .replace(MUSIC_CUE_PATTERN, " ")
    .replace(NON_SPEECH_CUE_PATTERN, " ")
    .replace(/[>♪♫♬♩~…·.,!?！？:;(){}"'`\-_/\\|]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  MUSIC_CUE_PATTERN.lastIndex = 0;
  NON_SPEECH_CUE_PATTERN.lastIndex = 0;
  const koreanSyllableCount = (remainder.match(/[가-힣]/gu) ?? []).length;
  return koreanSyllableCount < 2;
}
