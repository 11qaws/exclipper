import { MAX_BROADCAST_CONTEXT_SOURCE_DURATION_MS } from "./broadcastContextProtocol";
import {
  broadcastSpeechActivityCanSkipAsr,
  normalizeBroadcastSpeechActivityRunReceipt,
  type BroadcastSpeechActivityRunReceipt,
} from "./broadcastSpeechActivity";

export const BROADCAST_TRANSCRIPT_RESOLVED_EVIDENCE_SCHEMA_VERSION =
  "1.1.0" as const;
export const MAX_BROADCAST_TRANSCRIPT_EVIDENCE_CELLS = 4_096;
export const MAX_BROADCAST_TRANSCRIPT_RESOLVED_EVIDENCE_BYTES =
  16 * 1024 * 1024;

export type BroadcastTranscriptResolvedEvidenceReason =
  | "no-audio"
  | "no-speech";

export interface BroadcastTranscriptEvidencePlanCell {
  readonly chunkId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
}

export type BroadcastTranscriptResolvedEvidenceEntry =
  BroadcastTranscriptEvidencePlanCell &
    (
      | {
          readonly reason: "no-audio";
          readonly speechActivityReceipt: null;
        }
      | {
          readonly reason: "no-speech";
          readonly speechActivityReceipt: BroadcastSpeechActivityRunReceipt;
        }
    );

/**
 * Durable negative transcript evidence for one immutable source and ASR plan.
 *
 * `dialogueDisposition` and `visualDisposition` intentionally carry different
 * meanings. A resolved entry may skip dialogue transcription, but it never
 * proves that the corresponding video range lacks a meaningful visual event.
 */
export interface BroadcastTranscriptResolvedEvidenceCheckpoint {
  readonly schemaVersion:
    typeof BROADCAST_TRANSCRIPT_RESOLVED_EVIDENCE_SCHEMA_VERSION;
  readonly sourceFingerprint: string;
  readonly sourceDurationMs: number;
  readonly transcriptInputSignature: string;
  readonly modelRevision: string;
  readonly dialogueDisposition: "exclude-resolved-ranges";
  readonly visualDisposition: "inspection-required";
  readonly plannedCells: readonly BroadcastTranscriptEvidencePlanCell[];
  readonly resolvedEvidence: readonly BroadcastTranscriptResolvedEvidenceEntry[];
}

export interface CreateBroadcastTranscriptResolvedEvidenceCheckpointInput {
  readonly sourceFingerprint: string;
  readonly sourceDurationMs: number;
  readonly transcriptInputSignature: string;
  readonly modelRevision: string;
  readonly plannedCells: readonly BroadcastTranscriptEvidencePlanCell[];
}

export interface BroadcastTranscriptChapterRange {
  readonly startMs: number;
  readonly endMs: number;
}

export type BroadcastTranscriptGapRange =
  BroadcastTranscriptEvidencePlanCell;

export interface BroadcastTranscriptEvidenceSettlement {
  readonly checkpoint: BroadcastTranscriptResolvedEvidenceCheckpoint;
  readonly chapterRanges: readonly BroadcastTranscriptChapterRange[];
  readonly gapRanges: readonly BroadcastTranscriptGapRange[];
}

export interface BroadcastTranscriptEvidenceSettlementStatus {
  readonly plannedCellCount: number;
  readonly chapterCellCount: number;
  readonly resolvedEvidenceCount: number;
  readonly gapCellCount: number;
  readonly isPlanSettled: boolean;
  readonly isDialogueEmptyButResolved: boolean;
  /**
   * This is only transcript-plan settlement. It is deliberately not a claim
   * that visual analysis has completed.
   */
  readonly requiresVisualInspection: true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isBoundedFence(value: unknown, maximumLength = 2_048): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value.trim() === value &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function comparePlanCells(
  left: BroadcastTranscriptEvidencePlanCell,
  right: BroadcastTranscriptEvidencePlanCell,
): number {
  return (
    left.sourceStartMs - right.sourceStartMs ||
    left.sourceEndMs - right.sourceEndMs ||
    left.chunkId.localeCompare(right.chunkId)
  );
}

function normalizePlanCells(
  cells: readonly BroadcastTranscriptEvidencePlanCell[],
  sourceDurationMs: number,
): readonly BroadcastTranscriptEvidencePlanCell[] {
  if (
    cells.length === 0 ||
    cells.length > MAX_BROADCAST_TRANSCRIPT_EVIDENCE_CELLS
  ) {
    throw new RangeError(
      `Broadcast transcript evidence requires between 1 and ${MAX_BROADCAST_TRANSCRIPT_EVIDENCE_CELLS} planned cells.`,
    );
  }
  const normalized = cells
    .map((cell) => ({ ...cell }))
    .sort(comparePlanCells);
  const chunkIds = new Set<string>();
  let previousEndMs = -1;
  for (const cell of normalized) {
    if (
      !isBoundedFence(cell.chunkId, 256) ||
      chunkIds.has(cell.chunkId) ||
      !Number.isSafeInteger(cell.sourceStartMs) ||
      !Number.isSafeInteger(cell.sourceEndMs) ||
      cell.sourceStartMs < 0 ||
      cell.sourceEndMs <= cell.sourceStartMs ||
      cell.sourceEndMs > sourceDurationMs ||
      cell.sourceStartMs < previousEndMs
    ) {
      throw new RangeError(
        "Broadcast transcript evidence planned cells must be unique, bounded, non-overlapping source ranges.",
      );
    }
    chunkIds.add(cell.chunkId);
    previousEndMs = cell.sourceEndMs;
  }
  return normalized;
}

function normalizeResolvedEvidence(
  entries: readonly BroadcastTranscriptResolvedEvidenceEntry[],
  plannedCells: readonly BroadcastTranscriptEvidencePlanCell[],
  sourceDurationMs: number,
): readonly BroadcastTranscriptResolvedEvidenceEntry[] {
  if (entries.length > plannedCells.length) {
    throw new RangeError(
      "Resolved transcript evidence cannot exceed the bounded plan.",
    );
  }
  const plannedByChunkId = new Map(
    plannedCells.map((cell) => [cell.chunkId, cell]),
  );
  const chunkIds = new Set<string>();
  const normalized: BroadcastTranscriptResolvedEvidenceEntry[] = [];
  for (const rawEntry of [...entries].sort(comparePlanCells)) {
    const entry = { ...rawEntry };
    const planned = plannedByChunkId.get(entry.chunkId);
    if (
      chunkIds.has(entry.chunkId) ||
      planned === undefined ||
      planned.sourceStartMs !== entry.sourceStartMs ||
      planned.sourceEndMs !== entry.sourceEndMs ||
      (entry.reason !== "no-audio" && entry.reason !== "no-speech")
    ) {
      throw new RangeError(
        "Resolved transcript evidence must match one exact planned chunk and reason.",
      );
    }
    if (entry.reason === "no-audio") {
      if (entry.speechActivityReceipt !== null) {
        throw new RangeError(
          "No-audio transcript evidence cannot carry a VAD receipt.",
        );
      }
      normalized.push({
        chunkId: entry.chunkId,
        sourceStartMs: entry.sourceStartMs,
        sourceEndMs: entry.sourceEndMs,
        reason: entry.reason,
        speechActivityReceipt: null,
      });
    } else {
      const receipt = normalizeBroadcastSpeechActivityRunReceipt(
        entry.speechActivityReceipt,
      );
      if (
        receipt === null ||
        receipt.sourceDurationMs !== sourceDurationMs ||
        receipt.sourceStartMs !== planned.sourceStartMs ||
        receipt.sourceEndMs !== planned.sourceEndMs ||
        !receipt.coverage.complete ||
        receipt.coverage.repairRequired ||
        receipt.coverage.asrRequiredDurationMs !== 0 ||
        receipt.cells.length !== receipt.coverage.plannedCellCount ||
        !receipt.cells.every(broadcastSpeechActivityCanSkipAsr)
      ) {
        throw new RangeError(
          "No-speech transcript evidence requires one complete exact-range VAD receipt.",
        );
      }
      normalized.push({
        chunkId: entry.chunkId,
        sourceStartMs: entry.sourceStartMs,
        sourceEndMs: entry.sourceEndMs,
        reason: entry.reason,
        speechActivityReceipt: receipt,
      });
    }
    chunkIds.add(entry.chunkId);
  }
  return normalized;
}

function normalizedCheckpoint(
  checkpoint: BroadcastTranscriptResolvedEvidenceCheckpoint,
): BroadcastTranscriptResolvedEvidenceCheckpoint {
  if (
    checkpoint.schemaVersion !==
      BROADCAST_TRANSCRIPT_RESOLVED_EVIDENCE_SCHEMA_VERSION ||
    !isBoundedFence(checkpoint.sourceFingerprint) ||
    !isBoundedFence(checkpoint.transcriptInputSignature) ||
    !isBoundedFence(checkpoint.modelRevision, 512) ||
    checkpoint.dialogueDisposition !== "exclude-resolved-ranges" ||
    checkpoint.visualDisposition !== "inspection-required" ||
    !Array.isArray(checkpoint.plannedCells) ||
    !Array.isArray(checkpoint.resolvedEvidence)
  ) {
    throw new TypeError(
      "Broadcast transcript resolved evidence checkpoint is invalid.",
    );
  }
  if (
    !Number.isSafeInteger(checkpoint.sourceDurationMs) ||
    checkpoint.sourceDurationMs <= 0 ||
    checkpoint.sourceDurationMs >
      MAX_BROADCAST_CONTEXT_SOURCE_DURATION_MS
  ) {
    throw new RangeError(
      "Broadcast transcript resolved evidence supports sources up to 12 hours.",
    );
  }
  const plannedCells = normalizePlanCells(
    checkpoint.plannedCells,
    checkpoint.sourceDurationMs,
  );
  const resolvedEvidence = normalizeResolvedEvidence(
    checkpoint.resolvedEvidence,
    plannedCells,
    checkpoint.sourceDurationMs,
  );
  return {
    schemaVersion: BROADCAST_TRANSCRIPT_RESOLVED_EVIDENCE_SCHEMA_VERSION,
    sourceFingerprint: checkpoint.sourceFingerprint,
    sourceDurationMs: checkpoint.sourceDurationMs,
    transcriptInputSignature: checkpoint.transcriptInputSignature,
    modelRevision: checkpoint.modelRevision,
    dialogueDisposition: "exclude-resolved-ranges",
    visualDisposition: "inspection-required",
    plannedCells,
    resolvedEvidence,
  };
}

export function assertBroadcastTranscriptResolvedEvidenceCheckpoint(
  value: unknown,
): asserts value is BroadcastTranscriptResolvedEvidenceCheckpoint {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "sourceFingerprint",
      "sourceDurationMs",
      "transcriptInputSignature",
      "modelRevision",
      "dialogueDisposition",
      "visualDisposition",
      "plannedCells",
      "resolvedEvidence",
    ]) ||
    !Array.isArray(value.plannedCells) ||
    !Array.isArray(value.resolvedEvidence)
  ) {
    throw new TypeError(
      "Broadcast transcript resolved evidence checkpoint is invalid.",
    );
  }
  for (const cell of value.plannedCells) {
    if (
      !isRecord(cell) ||
      !hasExactKeys(cell, ["chunkId", "sourceStartMs", "sourceEndMs"])
    ) {
      throw new TypeError(
        "Broadcast transcript evidence plan cell is invalid.",
      );
    }
  }
  for (const entry of value.resolvedEvidence) {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, [
        "chunkId",
        "sourceStartMs",
        "sourceEndMs",
        "reason",
        "speechActivityReceipt",
      ])
    ) {
      throw new TypeError(
        "Broadcast transcript resolved evidence entry is invalid.",
      );
    }
  }
  normalizedCheckpoint(
    value as unknown as BroadcastTranscriptResolvedEvidenceCheckpoint,
  );
}

export function createBroadcastTranscriptResolvedEvidenceCheckpoint(
  input: CreateBroadcastTranscriptResolvedEvidenceCheckpointInput,
): BroadcastTranscriptResolvedEvidenceCheckpoint {
  return normalizedCheckpoint({
    schemaVersion: BROADCAST_TRANSCRIPT_RESOLVED_EVIDENCE_SCHEMA_VERSION,
    sourceFingerprint: input.sourceFingerprint,
    sourceDurationMs: input.sourceDurationMs,
    transcriptInputSignature: input.transcriptInputSignature,
    modelRevision: input.modelRevision,
    dialogueDisposition: "exclude-resolved-ranges",
    visualDisposition: "inspection-required",
    plannedCells: input.plannedCells,
    resolvedEvidence: [],
  });
}

export function recordBroadcastTranscriptResolvedEvidence(
  checkpoint: BroadcastTranscriptResolvedEvidenceCheckpoint,
  chunkId: string,
  reason: "no-audio",
  speechActivityReceipt?: null,
): BroadcastTranscriptResolvedEvidenceCheckpoint;
export function recordBroadcastTranscriptResolvedEvidence(
  checkpoint: BroadcastTranscriptResolvedEvidenceCheckpoint,
  chunkId: string,
  reason: "no-speech",
  speechActivityReceipt: BroadcastSpeechActivityRunReceipt,
): BroadcastTranscriptResolvedEvidenceCheckpoint;
export function recordBroadcastTranscriptResolvedEvidence(
  checkpoint: BroadcastTranscriptResolvedEvidenceCheckpoint,
  chunkId: string,
  reason: BroadcastTranscriptResolvedEvidenceReason,
  speechActivityReceipt: BroadcastSpeechActivityRunReceipt | null = null,
): BroadcastTranscriptResolvedEvidenceCheckpoint {
  const current = normalizedCheckpoint(checkpoint);
  const planned = current.plannedCells.find(
    (cell) => cell.chunkId === chunkId,
  );
  if (planned === undefined) {
    throw new RangeError(
      "Resolved transcript evidence references an unplanned chunk.",
    );
  }
  if (reason === "no-speech" && speechActivityReceipt === null) {
    throw new TypeError(
      "Confirmed no-speech transcript evidence requires its VAD receipt.",
    );
  }
  const resolvedEntry: BroadcastTranscriptResolvedEvidenceEntry =
    reason === "no-audio"
      ? {
          chunkId,
          sourceStartMs: planned.sourceStartMs,
          sourceEndMs: planned.sourceEndMs,
          reason,
          speechActivityReceipt: null,
        }
      : {
          chunkId,
          sourceStartMs: planned.sourceStartMs,
          sourceEndMs: planned.sourceEndMs,
          reason,
          speechActivityReceipt:
            speechActivityReceipt as BroadcastSpeechActivityRunReceipt,
        };
  return normalizedCheckpoint({
    ...current,
    resolvedEvidence: [
      ...current.resolvedEvidence.filter(
        (entry) => entry.chunkId !== chunkId,
      ),
      resolvedEntry,
    ],
  });
}

/**
 * Rebinds a negative-evidence ledger to the exact aggregate model revision
 * proven by the completed provider-receipt ledger.
 *
 * This deliberately changes only the model fence. The immutable source,
 * transcript operation, ASR plan, and every resolved no-speech/no-audio cell
 * are normalized again and preserved exactly.
 */
export function rebaseBroadcastTranscriptResolvedEvidenceModelRevision(
  checkpoint: BroadcastTranscriptResolvedEvidenceCheckpoint,
  modelRevision: string,
): BroadcastTranscriptResolvedEvidenceCheckpoint {
  const current = normalizedCheckpoint(checkpoint);
  return normalizedCheckpoint({
    ...current,
    modelRevision,
  });
}

export function serializeBroadcastTranscriptResolvedEvidenceCheckpoint(
  checkpoint: BroadcastTranscriptResolvedEvidenceCheckpoint,
): string {
  const serialized = JSON.stringify(normalizedCheckpoint(checkpoint));
  if (
    utf8ByteLength(serialized) >
    MAX_BROADCAST_TRANSCRIPT_RESOLVED_EVIDENCE_BYTES
  ) {
    throw new RangeError(
      "Broadcast transcript resolved evidence checkpoint is too large.",
    );
  }
  return serialized;
}

export function parseBroadcastTranscriptResolvedEvidenceCheckpointJson(
  serialized: string,
): BroadcastTranscriptResolvedEvidenceCheckpoint | null {
  if (
    typeof serialized !== "string" ||
    serialized.length === 0 ||
    utf8ByteLength(serialized) >
      MAX_BROADCAST_TRANSCRIPT_RESOLVED_EVIDENCE_BYTES
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(serialized);
    assertBroadcastTranscriptResolvedEvidenceCheckpoint(parsed);
    return normalizedCheckpoint(parsed);
  } catch {
    return null;
  }
}

function exactPlanCellIndexesForChapterRange(
  plannedCells: readonly BroadcastTranscriptEvidencePlanCell[],
  chapter: BroadcastTranscriptChapterRange,
): readonly number[] {
  if (
    !Number.isSafeInteger(chapter.startMs) ||
    !Number.isSafeInteger(chapter.endMs) ||
    chapter.startMs < 0 ||
    chapter.endMs <= chapter.startMs
  ) {
    throw new RangeError("Broadcast transcript chapter range is invalid.");
  }
  const firstIndex = plannedCells.findIndex(
    (cell) => cell.sourceStartMs === chapter.startMs,
  );
  if (firstIndex < 0) {
    throw new RangeError(
      "Broadcast transcript chapter must start on a planned cell boundary.",
    );
  }
  const coveredIndexes: number[] = [];
  let expectedStartMs = chapter.startMs;
  for (let index = firstIndex; index < plannedCells.length; index += 1) {
    const cell = plannedCells[index];
    if (cell === undefined || cell.sourceStartMs !== expectedStartMs) break;
    if (cell.sourceEndMs > chapter.endMs) break;
    coveredIndexes.push(index);
    expectedStartMs = cell.sourceEndMs;
    if (cell.sourceEndMs === chapter.endMs) return coveredIndexes;
  }
  throw new RangeError(
    "Broadcast transcript chapter must cover complete contiguous planned cells.",
  );
}

/**
 * Verifies that every immutable transcript-plan cell has exactly one outcome:
 * dialogue chapter, resolved no-speech/no-audio evidence, or an explicit gap.
 */
export function inspectBroadcastTranscriptEvidenceSettlement(
  input: BroadcastTranscriptEvidenceSettlement,
): BroadcastTranscriptEvidenceSettlementStatus {
  const checkpoint = normalizedCheckpoint(input.checkpoint);
  const settlementByPlanIndex = new Array<
    "chapter" | "resolved-evidence" | "gap" | null
  >(checkpoint.plannedCells.length).fill(null);
  let chapterCellCount = 0;

  for (const chapter of input.chapterRanges) {
    const indexes = exactPlanCellIndexesForChapterRange(
      checkpoint.plannedCells,
      chapter,
    );
    for (const index of indexes) {
      if (settlementByPlanIndex[index] !== null) {
        throw new RangeError(
          "A transcript plan cell cannot have more than one settlement.",
        );
      }
      settlementByPlanIndex[index] = "chapter";
      chapterCellCount += 1;
    }
  }

  const planIndexByChunkId = new Map(
    checkpoint.plannedCells.map((cell, index) => [cell.chunkId, index]),
  );
  for (const evidence of checkpoint.resolvedEvidence) {
    const index = planIndexByChunkId.get(evidence.chunkId);
    if (index === undefined || settlementByPlanIndex[index] !== null) {
      throw new RangeError(
        "Resolved transcript evidence conflicts with another settlement.",
      );
    }
    settlementByPlanIndex[index] = "resolved-evidence";
  }

  const gapChunkIds = new Set<string>();
  for (const gap of input.gapRanges) {
    const index = planIndexByChunkId.get(gap.chunkId);
    const planned = index === undefined
      ? undefined
      : checkpoint.plannedCells[index];
    if (
      index === undefined ||
      planned === undefined ||
      gapChunkIds.has(gap.chunkId) ||
      planned.sourceStartMs !== gap.sourceStartMs ||
      planned.sourceEndMs !== gap.sourceEndMs ||
      settlementByPlanIndex[index] !== null
    ) {
      throw new RangeError(
        "Broadcast transcript gap must match one otherwise-unsettled planned chunk.",
      );
    }
    gapChunkIds.add(gap.chunkId);
    settlementByPlanIndex[index] = "gap";
  }

  if (settlementByPlanIndex.some((settlement) => settlement === null)) {
    throw new RangeError(
      "Every broadcast transcript plan cell requires an explicit settlement or gap.",
    );
  }
  const isPlanSettled = settlementByPlanIndex.every(
    (settlement) => settlement !== "gap",
  );
  return {
    plannedCellCount: checkpoint.plannedCells.length,
    chapterCellCount,
    resolvedEvidenceCount: checkpoint.resolvedEvidence.length,
    gapCellCount: gapChunkIds.size,
    isPlanSettled,
    isDialogueEmptyButResolved:
      input.chapterRanges.length === 0 &&
      checkpoint.resolvedEvidence.length === checkpoint.plannedCells.length &&
      gapChunkIds.size === 0,
    requiresVisualInspection: true,
  };
}

export function broadcastTranscriptEvidencePlanCoversWholeSource(
  checkpoint: BroadcastTranscriptResolvedEvidenceCheckpoint,
): boolean {
  const current = normalizedCheckpoint(checkpoint);
  let cursorMs = 0;
  for (const cell of current.plannedCells) {
    if (cell.sourceStartMs !== cursorMs) return false;
    cursorMs = cell.sourceEndMs;
  }
  return cursorMs === current.sourceDurationMs;
}
