export const BROADCAST_CONTEXT_SCHEMA_VERSION = "1.4.0" as const;
export const MAX_BROADCAST_CONTEXT_SOURCE_DURATION_MS = 12 * 60 * 60_000;
export const MAX_BROADCAST_CONTEXT_CHAPTERS = 144;
export const MAX_BROADCAST_CONTEXT_CANDIDATES = 24;
// A 210-second Korean ASR cell can legitimately exceed 1,200 characters.
// Keeping 3,000 avoids deleting a short apology or payoff near the end while
// still bounding a 12-hour sampled request well below the model context limit.
export const MAX_BROADCAST_CONTEXT_SUMMARY_LENGTH = 3_000;
export const MAX_BROADCAST_CONTEXT_TRANSCRIPT_LENGTH = 12_000;
export const MAX_SEMANTIC_CHAPTERS = 48;
export const MAX_BROADCAST_CONTEXT_DISCOVERED_LEADS = 24;

const MAX_IDENTIFIER_LENGTH = 256;

export interface BroadcastContextChapterInput {
  readonly chapterId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly evidenceMode:
    | "complete-transcript"
    | "sampled-audio-video"
    | "candidate-context-only";
  readonly evidenceCoverageRatio: number;
  readonly summaryKo: string;
}

export interface BroadcastContextCandidateInput {
  readonly candidateId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly transcriptKo: string;
  readonly eventSummaryKo: string;
  readonly reactionSummaryKo: string;
  readonly chatReactionSummaryKo: string | null;
}

export interface BroadcastContextRequestInput {
  readonly sourceDurationMs: number;
  readonly chapters: readonly BroadcastContextChapterInput[];
  readonly candidates: readonly BroadcastContextCandidateInput[];
}

export interface BroadcastContextRequest {
  readonly schemaVersion: typeof BROADCAST_CONTEXT_SCHEMA_VERSION;
  readonly sourceDurationMs: number;
  readonly chapters: readonly BroadcastContextChapterInput[];
  readonly candidates: readonly BroadcastContextCandidateInput[];
}

export type BroadcastContextCandidateCategory =
  | "reaction"
  | "quiet-achievement"
  | "setup-and-payoff"
  | "running-gag"
  | "context-dependent"
  | "apology-accountability"
  | "music-or-intermission"
  | "not-clip-worthy"
  | "uncertain";

export type BroadcastContextClipDecision = "select" | "review" | "reject";

export type BroadcastContextRejectionReason =
  | "music-or-song"
  | "opening-ending-or-break"
  | "no-distinct-event"
  | "reaction-without-context"
  | "insufficient-context"
  | "duplicate-episode"
  | "uncertain-evidence";

export interface BroadcastContextCandidateAnnotation {
  readonly candidateId: string;
  readonly category: BroadcastContextCandidateCategory;
  readonly clipDecision: BroadcastContextClipDecision;
  readonly confidence: number;
  readonly rejectionReasons: readonly BroadcastContextRejectionReason[];
  readonly contextSummaryKo: string;
  readonly whyThisMomentKo: string;
  readonly relatedCandidateIds: readonly string[];
  readonly uncertaintiesKo: readonly string[];
}

export type BroadcastContextSemanticChapterKind =
  | "main-event"
  | "story-progress"
  | "setup-and-payoff"
  | "running-gag"
  | "quiet-achievement"
  | "reaction"
  | "context-shift"
  | "other";

export type BroadcastContextSemanticChapterSalience =
  | "primary"
  | "secondary";

export interface BroadcastContextSemanticChapterReference {
  readonly startChapterId: string;
  readonly endChapterId: string;
  readonly titleKo: string;
  readonly summaryKo: string;
  readonly kind: BroadcastContextSemanticChapterKind;
  readonly salience: BroadcastContextSemanticChapterSalience;
  readonly relatedCandidateIds: readonly string[];
  readonly uncertaintiesKo: readonly string[];
}

export interface BroadcastContextSemanticChapter extends BroadcastContextSemanticChapterReference {
  readonly semanticChapterId: string;
  readonly startMs: number;
  readonly endMs: number;
}

export type BroadcastContextDiscoveredLeadCategory = Exclude<
  BroadcastContextCandidateCategory,
  "music-or-intermission" | "not-clip-worthy" | "uncertain"
>;

export interface BroadcastContextDiscoveredLeadReference {
  readonly leadId: string;
  readonly startChapterId: string;
  readonly endChapterId: string;
  readonly category: BroadcastContextDiscoveredLeadCategory;
  readonly confidence: number;
  readonly eventSummaryKo: string;
  readonly whyThisMomentKo: string;
  readonly evidenceCueKo: string;
  readonly uncertaintiesKo: readonly string[];
}

export interface BroadcastContextDiscoveredLead
  extends BroadcastContextDiscoveredLeadReference {
  readonly startMs: number;
  readonly endMs: number;
}

export interface BroadcastContextCoverageGap {
  readonly startMs: number;
  readonly endMs: number;
}

export interface BroadcastContextCoverage {
  readonly status: "complete" | "partial";
  readonly coveredMs: number;
  readonly coverageRatio: number;
  readonly gaps: readonly BroadcastContextCoverageGap[];
  readonly partialChapterIds: readonly string[];
}

export interface BroadcastContextResult {
  readonly schemaVersion:
    | typeof BROADCAST_CONTEXT_SCHEMA_VERSION
    | "1.2.0"
    | "1.1.0"
    | "1.0.0";
  readonly broadcastSummaryKo: string;
  readonly recurringThemesKo: readonly string[];
  readonly annotations: readonly BroadcastContextCandidateAnnotation[];
  readonly semanticChaptersSupported: boolean;
  readonly semanticChapters: readonly BroadcastContextSemanticChapter[];
  readonly discoveredLeadsSupported: boolean;
  readonly discoveredLeads: readonly BroadcastContextDiscoveredLead[];
  readonly coverage: BroadcastContextCoverage;
}

/**
 * Converts the whole-broadcast judgment into the semantic gate consumed by the
 * final selector. Rejected moments never become budget-filling fallbacks.
 */
export function buildBroadcastContextEligibilityById(
  annotations: readonly BroadcastContextCandidateAnnotation[],
): Readonly<Record<string, "eligible" | "exploration" | "ineligible">> {
  return Object.fromEntries(
    annotations.map((annotation) => [
      annotation.candidateId,
      annotation.clipDecision === "select"
        ? "eligible"
        : annotation.clipDecision === "review"
          ? "exploration"
          : "ineligible",
    ]),
  );
}

export type BroadcastContextInputErrorCode =
  | "INVALID_SOURCE_DURATION"
  | "INVALID_CHAPTER_COUNT"
  | "INVALID_CANDIDATE_COUNT"
  | "INVALID_IDENTIFIER"
  | "DUPLICATE_IDENTIFIER"
  | "INVALID_RANGE"
  | "OVERLAPPING_CHAPTERS"
  | "INVALID_TEXT"
  | "INVALID_SEMANTIC_CHAPTER";

export class BroadcastContextInputError extends Error {
  public readonly code: BroadcastContextInputErrorCode;
  public readonly itemId: string | null;

  public constructor(
    code: BroadcastContextInputErrorCode,
    message: string,
    itemId: string | null = null,
  ) {
    super(message);
    this.name = "BroadcastContextInputError";
    this.code = code;
    this.itemId = itemId;
  }
}

function isValidIdentifier(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH &&
    value.trim() === value &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function assertIdentifier(value: string): void {
  if (!isValidIdentifier(value)) {
    throw new BroadcastContextInputError(
      "INVALID_IDENTIFIER",
      "Broadcast context item IDs must be non-empty, trimmed, and bounded.",
      value,
    );
  }
}

function assertRange(
  startMs: number,
  endMs: number,
  sourceDurationMs: number,
  itemId: string,
): void {
  if (
    !Number.isSafeInteger(startMs) ||
    !Number.isSafeInteger(endMs) ||
    startMs < 0 ||
    endMs > sourceDurationMs ||
    startMs >= endMs
  ) {
    throw new BroadcastContextInputError(
      "INVALID_RANGE",
      "Broadcast context ranges must be integer ranges inside the source.",
      itemId,
    );
  }
}

function assertText(
  value: string,
  maxLength: number,
  itemId: string,
  allowEmpty = false,
): void {
  const length = Array.from(value).length;
  const controlCheckValue = value.replace(/[\n\r\t]/gu, "");
  if (
    value.trim() !== value ||
    (!allowEmpty && length === 0) ||
    length > maxLength ||
    /[\p{Cc}\p{Cf}]/u.test(controlCheckValue)
  ) {
    throw new BroadcastContextInputError(
      "INVALID_TEXT",
      "Broadcast context text must be trimmed and stay inside its size limit.",
      itemId,
    );
  }
}

function assertUniqueIdentifiers(
  identifiers: readonly string[],
): void {
  const seen = new Set<string>();
  for (const identifier of identifiers) {
    assertIdentifier(identifier);
    if (seen.has(identifier)) {
      throw new BroadcastContextInputError(
        "DUPLICATE_IDENTIFIER",
        "Broadcast context item IDs must be unique inside their collection.",
        identifier,
      );
    }
    seen.add(identifier);
  }
}

export function createBroadcastContextRequest(
  input: BroadcastContextRequestInput,
): BroadcastContextRequest {
  if (
    !Number.isSafeInteger(input.sourceDurationMs) ||
    input.sourceDurationMs <= 0 ||
    input.sourceDurationMs > MAX_BROADCAST_CONTEXT_SOURCE_DURATION_MS
  ) {
    throw new BroadcastContextInputError(
      "INVALID_SOURCE_DURATION",
      "Broadcast context source duration must be an integer from 1 ms to 12 hours.",
    );
  }
  if (
    input.chapters.length < 1 ||
    input.chapters.length > MAX_BROADCAST_CONTEXT_CHAPTERS
  ) {
    throw new BroadcastContextInputError(
      "INVALID_CHAPTER_COUNT",
      "Broadcast context requires between 1 and 144 bounded chapter summaries.",
    );
  }
  if (input.candidates.length > MAX_BROADCAST_CONTEXT_CANDIDATES) {
    throw new BroadcastContextInputError(
      "INVALID_CANDIDATE_COUNT",
      "Broadcast context accepts between 0 and 24 existing candidates.",
    );
  }

  assertUniqueIdentifiers(input.chapters.map((chapter) => chapter.chapterId));
  assertUniqueIdentifiers(input.candidates.map((candidate) => candidate.candidateId));

  let previousChapterEndMs = 0;
  const chapters = input.chapters.map((chapter, index) => {
    assertRange(
      chapter.startMs,
      chapter.endMs,
      input.sourceDurationMs,
      chapter.chapterId,
    );
    if (index > 0 && chapter.startMs < previousChapterEndMs) {
      throw new BroadcastContextInputError(
        "OVERLAPPING_CHAPTERS",
        "Broadcast context chapters must be ordered and non-overlapping.",
        chapter.chapterId,
      );
    }
    previousChapterEndMs = chapter.endMs;
    assertText(
      chapter.summaryKo,
      MAX_BROADCAST_CONTEXT_SUMMARY_LENGTH,
      chapter.chapterId,
    );
    if (
      ![
        "complete-transcript",
        "sampled-audio-video",
        "candidate-context-only",
      ].includes(chapter.evidenceMode) ||
      !Number.isFinite(chapter.evidenceCoverageRatio) ||
      chapter.evidenceCoverageRatio <= 0 ||
      chapter.evidenceCoverageRatio > 1
    ) {
      throw new BroadcastContextInputError(
        "INVALID_RANGE",
        "Broadcast context chapter evidence coverage must be within (0, 1].",
        chapter.chapterId,
      );
    }
    return {
      chapterId: chapter.chapterId,
      startMs: chapter.startMs,
      endMs: chapter.endMs,
      evidenceMode: chapter.evidenceMode,
      evidenceCoverageRatio: chapter.evidenceCoverageRatio,
      summaryKo: chapter.summaryKo,
    };
  });

  const candidates = input.candidates.map((candidate) => {
    assertRange(
      candidate.startMs,
      candidate.endMs,
      input.sourceDurationMs,
      candidate.candidateId,
    );
    assertText(
      candidate.transcriptKo,
      MAX_BROADCAST_CONTEXT_TRANSCRIPT_LENGTH,
      candidate.candidateId,
      true,
    );
    assertText(
      candidate.eventSummaryKo,
      MAX_BROADCAST_CONTEXT_SUMMARY_LENGTH,
      candidate.candidateId,
    );
    assertText(
      candidate.reactionSummaryKo,
      MAX_BROADCAST_CONTEXT_SUMMARY_LENGTH,
      candidate.candidateId,
    );
    if (candidate.chatReactionSummaryKo !== null) {
      assertText(
        candidate.chatReactionSummaryKo,
        MAX_BROADCAST_CONTEXT_SUMMARY_LENGTH,
        candidate.candidateId,
        true,
      );
    }
    return {
      candidateId: candidate.candidateId,
      startMs: candidate.startMs,
      endMs: candidate.endMs,
      transcriptKo: candidate.transcriptKo,
      eventSummaryKo: candidate.eventSummaryKo,
      reactionSummaryKo: candidate.reactionSummaryKo,
      chatReactionSummaryKo: candidate.chatReactionSummaryKo,
    };
  });

  return {
    schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
    sourceDurationMs: input.sourceDurationMs,
    chapters,
    candidates,
  };
}

/**
 * Grounds quiet, transcript-led discoveries to observed chapter ranges. These
 * are leads for a second audio/video pass, not final clips, so the model cannot
 * invent precise timestamps inside a coarse ASR chunk.
 */
export function normalizeDiscoveredLeads(
  rawLeads: readonly BroadcastContextDiscoveredLeadReference[],
  chapters: readonly BroadcastContextChapterInput[],
): readonly BroadcastContextDiscoveredLead[] {
  if (rawLeads.length > MAX_BROADCAST_CONTEXT_DISCOVERED_LEADS) {
    throw new BroadcastContextInputError(
      "INVALID_SEMANTIC_CHAPTER",
      `Too many discovered leads. Max allowed is ${MAX_BROADCAST_CONTEXT_DISCOVERED_LEADS}.`,
    );
  }
  const chapterMap = new Map(chapters.map((chapter) => [chapter.chapterId, chapter]));
  const seenLeadIds = new Set<string>();
  return rawLeads.map((lead) => {
    assertIdentifier(lead.leadId);
    if (seenLeadIds.has(lead.leadId)) {
      throw new BroadcastContextInputError(
        "DUPLICATE_IDENTIFIER",
        "Discovered lead IDs must be unique.",
        lead.leadId,
      );
    }
    seenLeadIds.add(lead.leadId);
    const startChapter = chapterMap.get(lead.startChapterId);
    const endChapter = chapterMap.get(lead.endChapterId);
    if (
      startChapter === undefined ||
      endChapter === undefined ||
      startChapter.startMs >= endChapter.endMs
    ) {
      throw new BroadcastContextInputError(
        "INVALID_SEMANTIC_CHAPTER",
        "Discovered leads must reference an ordered observed chapter range.",
        lead.leadId,
      );
    }
    if (
      ![
        "reaction",
        "quiet-achievement",
        "setup-and-payoff",
        "running-gag",
        "context-dependent",
        "apology-accountability",
      ].includes(lead.category) ||
      !Number.isFinite(lead.confidence) ||
      lead.confidence < 0 ||
      lead.confidence > 1
    ) {
      throw new BroadcastContextInputError(
        "INVALID_SEMANTIC_CHAPTER",
        "Discovered lead category or confidence is invalid.",
        lead.leadId,
      );
    }
    assertText(lead.eventSummaryKo, MAX_BROADCAST_CONTEXT_SUMMARY_LENGTH, lead.leadId);
    assertText(lead.whyThisMomentKo, MAX_BROADCAST_CONTEXT_SUMMARY_LENGTH, lead.leadId);
    assertText(lead.evidenceCueKo, 500, lead.leadId);
    for (const uncertainty of lead.uncertaintiesKo) {
      assertText(uncertainty, 500, lead.leadId);
    }
    return {
      ...lead,
      startMs: startChapter.startMs,
      endMs: endChapter.endMs,
    };
  });
}

export function calculateCoverage(
  chapters: readonly BroadcastContextChapterInput[],
  sourceDurationMs: number,
): BroadcastContextCoverage {
  const gaps: BroadcastContextCoverageGap[] = [];
  const partialChapterIds: string[] = [];
  let coveredMs = 0;
  let lastEnd = 0;

  for (const chapter of chapters) {
    if (chapter.startMs > lastEnd) {
      gaps.push({ startMs: lastEnd, endMs: chapter.startMs });
    }
    coveredMs +=
      (chapter.endMs - chapter.startMs) * chapter.evidenceCoverageRatio;
    if (
      chapter.evidenceMode !== "complete-transcript" ||
      chapter.evidenceCoverageRatio < 1
    ) {
      partialChapterIds.push(chapter.chapterId);
    }
    lastEnd = Math.max(lastEnd, chapter.endMs);
  }

  if (lastEnd < sourceDurationMs) {
    gaps.push({ startMs: lastEnd, endMs: sourceDurationMs });
  }

  return {
    status:
      gaps.length > 0 || partialChapterIds.length > 0 ? "partial" : "complete",
    coveredMs: Math.round(coveredMs),
    coverageRatio: sourceDurationMs > 0 ? coveredMs / sourceDurationMs : 0,
    gaps,
    partialChapterIds,
  };
}

export function normalizeSemanticChapters(
  rawSemanticChapters: readonly BroadcastContextSemanticChapterReference[],
  chapters: readonly BroadcastContextChapterInput[],
  coverageGaps: readonly BroadcastContextCoverageGap[]
): readonly BroadcastContextSemanticChapter[] {
  if (rawSemanticChapters.length > MAX_SEMANTIC_CHAPTERS) {
    throw new BroadcastContextInputError(
      "INVALID_SEMANTIC_CHAPTER",
      `Too many semantic chapters. Max allowed is ${MAX_SEMANTIC_CHAPTERS}.`
    );
  }

  const chapterMap = new Map<string, BroadcastContextChapterInput>();
  for (const ch of chapters) {
    chapterMap.set(ch.chapterId, ch);
  }

  let lastEndMs = -1;
  const normalized: BroadcastContextSemanticChapter[] = [];

  for (let i = 0; i < rawSemanticChapters.length; i++) {
    const raw = rawSemanticChapters[i]!;
    
    assertText(raw.titleKo, 64, `chapter-${i}`);
    assertText(raw.summaryKo, 1200, `chapter-${i}`);

    const startCh = chapterMap.get(raw.startChapterId);
    const endCh = chapterMap.get(raw.endChapterId);
    
    if (!startCh || !endCh) {
      throw new BroadcastContextInputError(
        "INVALID_SEMANTIC_CHAPTER",
        "Semantic chapter references missing chapter ID."
      );
    }
    
    if (startCh.startMs >= endCh.endMs) {
      throw new BroadcastContextInputError(
        "INVALID_SEMANTIC_CHAPTER",
        "startChapter must precede endChapter."
      );
    }
    
    if (startCh.startMs < lastEndMs) {
      throw new BroadcastContextInputError(
        "INVALID_SEMANTIC_CHAPTER",
        "Semantic chapters must be chronologically ordered and non-overlapping."
      );
    }
    
    // Check if it crosses a coverage gap
    for (const gap of coverageGaps) {
      if (gap.startMs < endCh.endMs && gap.endMs > startCh.startMs) {
        throw new BroadcastContextInputError(
          "INVALID_SEMANTIC_CHAPTER",
          "Semantic chapter cannot cross a coverage gap."
        );
      }
    }

    lastEndMs = endCh.endMs;
    
    const semanticChapterId = `sc-${raw.startChapterId}-${raw.endChapterId}-${raw.kind}`;
    
    normalized.push({
      ...raw,
      semanticChapterId,
      startMs: startCh.startMs,
      endMs: endCh.endMs,
    });
  }

  return normalized;
}
