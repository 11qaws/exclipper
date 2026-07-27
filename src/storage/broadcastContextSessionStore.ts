import {
  createBroadcastContextRequest,
  MAX_BROADCAST_CONTEXT_CHAPTERS,
  MAX_BROADCAST_CONTEXT_SOURCE_DURATION_MS,
  type BroadcastContextChapterInput,
} from "../analysis/broadcastContextProtocol";

export const BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION = "1.3.0" as const;
const LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION = "1.2.0" as const;
const MAX_STORED_BROADCAST_CONTEXT_CHAPTERS = 4_096;

export type StoredBroadcastTranscriptGapReason =
  | "pending"
  | "in-flight"
  | "decode-failed"
  | "transcription-failed"
  | "rate-limited"
  | "outcome-unknown";

export interface StoredBroadcastTranscriptGap {
  readonly chunkId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly reason: StoredBroadcastTranscriptGapReason;
  readonly attemptCount: number;
}

export interface BroadcastContextSessionRecord {
  readonly kind: "broadcastContextSession";
  readonly runId: string;
  readonly schemaVersion: typeof BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION;
  readonly inputSignature: string;
  readonly sourceDurationMs: number;
  readonly completeAudioCoverage: boolean;
  readonly chapters: readonly BroadcastContextChapterInput[];
  readonly gapChunkIds: readonly string[];
  readonly fragmentGaps: readonly StoredBroadcastTranscriptGap[];
  readonly modelRevision: string;
  readonly contextInputSignature: string | null;
  readonly contextResultJson: string | null;
  readonly refinementInputSignature: string | null;
  readonly refinementCandidatesJson: string | null;
  readonly recordedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedString(value: unknown, maximumLength = 512): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

export function assertBroadcastContextSessionRecord(
  value: unknown,
): asserts value is BroadcastContextSessionRecord {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "kind",
      "runId",
      "schemaVersion",
      "inputSignature",
      "sourceDurationMs",
      "completeAudioCoverage",
      "chapters",
      "gapChunkIds",
      "fragmentGaps",
      "modelRevision",
      "contextInputSignature",
      "contextResultJson",
      "refinementInputSignature",
      "refinementCandidatesJson",
      "recordedAt",
    ]) ||
    value.kind !== "broadcastContextSession" ||
    value.schemaVersion !== BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION ||
    !boundedString(value.runId) ||
    !boundedString(value.inputSignature) ||
    !Number.isSafeInteger(value.sourceDurationMs) ||
    (value.sourceDurationMs as number) <= 0 ||
    (value.sourceDurationMs as number) >
      MAX_BROADCAST_CONTEXT_SOURCE_DURATION_MS ||
    typeof value.completeAudioCoverage !== "boolean" ||
    !Array.isArray(value.chapters) ||
    value.chapters.length > MAX_STORED_BROADCAST_CONTEXT_CHAPTERS ||
    !Array.isArray(value.gapChunkIds) ||
    !value.gapChunkIds.every((item) => boundedString(item, 256)) ||
    new Set(value.gapChunkIds).size !== value.gapChunkIds.length ||
    !Array.isArray(value.fragmentGaps) ||
    !boundedString(value.modelRevision) ||
    !(
      (value.contextInputSignature === null && value.contextResultJson === null) ||
      (boundedString(value.contextInputSignature) &&
        typeof value.contextResultJson === "string" &&
        value.contextResultJson.length > 0 &&
        value.contextResultJson.length <= 256 * 1024)
    ) ||
    !(
      (value.refinementInputSignature === null &&
        value.refinementCandidatesJson === null) ||
      (boundedString(value.refinementInputSignature) &&
        typeof value.refinementCandidatesJson === "string" &&
        value.refinementCandidatesJson.length > 0 &&
        value.refinementCandidatesJson.length <= 256 * 1024)
    ) ||
    typeof value.recordedAt !== "string" ||
    !Number.isFinite(Date.parse(value.recordedAt))
  ) {
    throw new TypeError("Broadcast context session record is invalid.");
  }
  const gapChunkIds = new Set(value.gapChunkIds as readonly string[]);
  const fragmentGapIds = new Set<string>();
  let previousGapEndMs = -1;
  for (const gap of value.fragmentGaps as readonly unknown[]) {
    if (
      !isRecord(gap) ||
      !hasExactKeys(gap, [
        "chunkId",
        "sourceStartMs",
        "sourceEndMs",
        "reason",
        "attemptCount",
      ]) ||
      !boundedString(gap.chunkId, 256) ||
      fragmentGapIds.has(gap.chunkId) ||
      !gapChunkIds.has(gap.chunkId) ||
      !Number.isSafeInteger(gap.sourceStartMs) ||
      !Number.isSafeInteger(gap.sourceEndMs) ||
      (gap.sourceStartMs as number) < 0 ||
      (gap.sourceEndMs as number) <= (gap.sourceStartMs as number) ||
      (gap.sourceEndMs as number) > (value.sourceDurationMs as number) ||
      (gap.sourceStartMs as number) < previousGapEndMs ||
      ![
        "pending",
        "in-flight",
        "decode-failed",
        "transcription-failed",
        "rate-limited",
        "outcome-unknown",
      ].includes(typeof gap.reason === "string" ? gap.reason : "") ||
      !Number.isSafeInteger(gap.attemptCount) ||
      (gap.attemptCount as number) < 0 ||
      (gap.attemptCount as number) > 1_000_000
    ) {
      throw new TypeError("Stored broadcast transcript fragment gap is invalid.");
    }
    fragmentGapIds.add(gap.chunkId);
    previousGapEndMs = gap.sourceEndMs as number;
  }
  if (typeof value.contextResultJson === "string") {
    try {
      const parsed: unknown = JSON.parse(value.contextResultJson);
      if (!isRecord(parsed)) throw new TypeError("Context result JSON must be an object.");
    } catch {
      throw new TypeError("Broadcast context result JSON is invalid.");
    }
  }
  if (typeof value.refinementCandidatesJson === "string") {
    try {
      const parsed: unknown = JSON.parse(value.refinementCandidatesJson);
      if (!Array.isArray(parsed)) {
        throw new TypeError("Refinement candidates JSON must be an array.");
      }
    } catch {
      throw new TypeError("Broadcast refinement candidates JSON is invalid.");
    }
  }
  const chapters = value.chapters as readonly BroadcastContextChapterInput[];
  if (chapters.length === 0) {
    if (value.completeAudioCoverage || value.gapChunkIds.length === 0) {
      throw new TypeError(
        "An empty broadcast transcript map must preserve its evidence gaps.",
      );
    }
    return;
  }
  const chapterIds = new Set<string>();
  let previousChapterEndMs = 0;
  for (const chapter of chapters) {
    if (
      chapterIds.has(chapter.chapterId) ||
      chapter.startMs < previousChapterEndMs
    ) {
      throw new TypeError(
        "Stored broadcast transcript chapters must be unique and ordered.",
      );
    }
    chapterIds.add(chapter.chapterId);
    previousChapterEndMs = chapter.endMs;
  }
  for (
    let startIndex = 0;
    startIndex < chapters.length;
    startIndex += MAX_BROADCAST_CONTEXT_CHAPTERS
  ) {
    createBroadcastContextRequest({
      sourceDurationMs: value.sourceDurationMs as number,
      chapters: chapters.slice(
        startIndex,
        startIndex + MAX_BROADCAST_CONTEXT_CHAPTERS,
      ),
      candidates: [],
    });
  }
}

function migrateLegacyBroadcastContextSessionRecord(
  value: unknown,
): unknown {
  if (
    isRecord(value) &&
    value.schemaVersion === LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION &&
    !Object.hasOwn(value, "fragmentGaps")
  ) {
    return {
      ...value,
      schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
      fragmentGaps: [],
    };
  }
  return value;
}

export function cloneBroadcastContextSessionRecord(
  value: unknown,
): BroadcastContextSessionRecord {
  const migrated = migrateLegacyBroadcastContextSessionRecord(value);
  assertBroadcastContextSessionRecord(migrated);
  return {
    ...migrated,
    chapters: migrated.chapters.map((chapter) => ({ ...chapter })),
    gapChunkIds: [...migrated.gapChunkIds],
    fragmentGaps: migrated.fragmentGaps.map((gap) => ({ ...gap })),
  };
}
