import {
  broadcastTranscriptProviderReceiptCheckpointModelRevision,
  parseBroadcastTranscriptProviderReceiptCheckpointJson,
  serializeBroadcastTranscriptProviderReceiptCheckpoint,
  type BroadcastTranscriptCaptionReceiptEntry,
  type BroadcastTranscriptProviderReceiptCheckpoint,
  type BroadcastTranscriptProviderReceiptEntry,
  type BroadcastTranscriptProviderReceiptPlanCell,
} from "../analysis/broadcastTranscriptProviderReceiptCheckpoint";
import {
  parseBroadcastTranscriptResolvedEvidenceCheckpointJson,
  rebaseBroadcastTranscriptResolvedEvidenceModelRevision,
  serializeBroadcastTranscriptResolvedEvidenceCheckpoint,
  type BroadcastTranscriptResolvedEvidenceCheckpoint,
  type BroadcastTranscriptResolvedEvidenceEntry,
} from "../analysis/broadcastTranscriptResolvedEvidence";
import type { BroadcastContextChapterInput } from "../analysis/broadcastContextProtocol";
import type { BroadcastContextTranscriptionChunk } from "../analysis/broadcastContextSamplingPlan";
import type { BroadcastTranscriptRouteManifest } from "../analysis/broadcastTranscriptRouteManifest";
import {
  checkpointBroadcastContextSessionTranscript,
  partitionBroadcastContextSessionChapters,
  type BroadcastContextSessionRecord,
  type StoredBroadcastTranscriptGap,
} from "../storage/broadcastContextSessionStore";
import { transcriptGapRequiresExplicitBillingRetry } from "./transcriptPhase";

type TerminalSettlement =
  | {
      readonly kind: "provider";
      readonly entry: BroadcastTranscriptProviderReceiptEntry;
      readonly chapter: BroadcastContextChapterInput;
    }
  | {
      readonly kind: "caption";
      readonly entry: BroadcastTranscriptCaptionReceiptEntry;
      readonly chapter: BroadcastContextChapterInput;
    }
  | {
      readonly kind: "resolved";
      readonly entry: BroadcastTranscriptResolvedEvidenceEntry;
    };

type CellSettlement =
  | TerminalSettlement
  | {
      readonly kind: "gap";
      readonly gap: StoredBroadcastTranscriptGap;
    };

interface ParsedTranscriptSession {
  readonly record: BroadcastContextSessionRecord;
  readonly provider: BroadcastTranscriptProviderReceiptCheckpoint;
  readonly evidence: BroadcastTranscriptResolvedEvidenceCheckpoint;
  readonly settlementByChunkId: ReadonlyMap<string, CellSettlement>;
}

function rangeKey(value: {
  readonly sourceStartMs?: number;
  readonly sourceEndMs?: number;
  readonly startMs?: number;
  readonly endMs?: number;
}): string {
  const startMs = value.sourceStartMs ?? value.startMs;
  const endMs = value.sourceEndMs ?? value.endMs;
  return `${startMs}:${endMs}`;
}

function exactPlan(
  left: readonly BroadcastTranscriptProviderReceiptPlanCell[],
  right: readonly BroadcastTranscriptProviderReceiptPlanCell[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function gapSafetyRank(reason: StoredBroadcastTranscriptGap["reason"]): number {
  switch (reason) {
    case "outcome-unknown":
      return 3;
    case "decode-failed":
    case "transcription-failed":
    case "rate-limited":
    case "route-changed":
      return 2;
    case "pending":
      return 1;
    case "in-flight":
      return 0;
  }
}

function chooseSettlement(
  current: CellSettlement | undefined,
  pending: CellSettlement | undefined,
): CellSettlement | undefined {
  if (current === undefined) return pending;
  if (pending === undefined) return current;
  if (current.kind !== "gap") return current;
  if (pending.kind !== "gap") return pending;
  if (pending.gap.attemptCount > current.gap.attemptCount) return pending;
  if (pending.gap.attemptCount < current.gap.attemptCount) return current;
  return gapSafetyRank(pending.gap.reason) >
    gapSafetyRank(current.gap.reason)
    ? pending
    : current;
}

function parseSession(
  record: BroadcastContextSessionRecord,
): ParsedTranscriptSession | null {
  if (
    record.transcriptProviderReceiptCheckpointJson === null ||
    record.transcriptEvidenceCheckpointJson === null
  ) {
    return null;
  }
  const provider = parseBroadcastTranscriptProviderReceiptCheckpointJson(
    record.transcriptProviderReceiptCheckpointJson,
  );
  const evidence = parseBroadcastTranscriptResolvedEvidenceCheckpointJson(
    record.transcriptEvidenceCheckpointJson,
  );
  if (
    provider === null ||
    evidence === null ||
    provider.sourceFingerprint !== record.inputSignature ||
    provider.sourceDurationMs !== record.sourceDurationMs ||
    evidence.sourceFingerprint !== record.inputSignature ||
    evidence.sourceDurationMs !== record.sourceDurationMs ||
    record.transcriptEvidenceInputSignature !==
      evidence.transcriptInputSignature ||
    record.transcriptProviderReceiptInputSignature !==
      provider.routeManifestFingerprint ||
    !exactPlan(provider.plannedCells, evidence.plannedCells)
  ) {
    return null;
  }

  let transcriptChapters: readonly BroadcastContextChapterInput[];
  try {
    transcriptChapters =
      partitionBroadcastContextSessionChapters(record).transcriptChapters;
  } catch {
    return null;
  }
  const chapterByRange = new Map(
    transcriptChapters.map((chapter) => [rangeKey(chapter), chapter]),
  );
  if (chapterByRange.size !== transcriptChapters.length) return null;

  const settlementByChunkId = new Map<string, CellSettlement>();
  const add = (chunkId: string, settlement: CellSettlement): boolean => {
    if (settlementByChunkId.has(chunkId)) return false;
    settlementByChunkId.set(chunkId, settlement);
    return true;
  };
  for (const entry of provider.receipts) {
    const chapter = chapterByRange.get(rangeKey(entry));
    if (
      chapter === undefined ||
      !add(entry.chunkId, { kind: "provider", entry, chapter })
    ) {
      return null;
    }
  }
  for (const entry of provider.captionReceipts) {
    const chapter = chapterByRange.get(rangeKey(entry));
    if (
      chapter === undefined ||
      !add(entry.chunkId, { kind: "caption", entry, chapter })
    ) {
      return null;
    }
  }
  for (const entry of evidence.resolvedEvidence) {
    if (!add(entry.chunkId, { kind: "resolved", entry })) return null;
  }
  for (const gap of record.fragmentGaps) {
    if (!add(gap.chunkId, { kind: "gap", gap })) return null;
  }
  if (
    transcriptChapters.some(
      (chapter) =>
        ![...provider.receipts, ...provider.captionReceipts].some(
          (entry) => rangeKey(entry) === rangeKey(chapter),
        ),
    )
  ) {
    return null;
  }
  return { record, provider, evidence, settlementByChunkId };
}

function transcriptStateJson(record: BroadcastContextSessionRecord): string {
  const transcriptChapters =
    partitionBroadcastContextSessionChapters(record).transcriptChapters;
  return JSON.stringify({
    completeAudioCoverage: record.completeAudioCoverage,
    chapters: transcriptChapters,
    gapChunkIds: record.gapChunkIds,
    fragmentGaps: record.fragmentGaps,
    transcriptEvidenceInputSignature:
      record.transcriptEvidenceInputSignature,
    transcriptEvidenceCheckpointJson:
      record.transcriptEvidenceCheckpointJson,
    transcriptProviderReceiptInputSignature:
      record.transcriptProviderReceiptInputSignature,
    transcriptProviderReceiptCheckpointJson:
      record.transcriptProviderReceiptCheckpointJson,
    modelRevision: record.modelRevision,
    transcriptSealOperationKey: record.transcriptSealOperationKey,
  });
}

/**
 * Joins two cumulative main-transcript checkpoints without allowing a stale
 * tab to erase a terminal cell or a newer attempt.
 *
 * Returning `null` is a child CAS fence: the records do not share one exact
 * immutable ASR plan and therefore cannot be safely rebased.
 */
export function mergeBroadcastTranscriptSessionCheckpoints(
  currentRecord: BroadcastContextSessionRecord,
  pendingRecord: BroadcastContextSessionRecord,
): BroadcastContextSessionRecord | null {
  if (
    currentRecord.runId !== pendingRecord.runId ||
    currentRecord.inputSignature !== pendingRecord.inputSignature ||
    currentRecord.sourceDurationMs !== pendingRecord.sourceDurationMs ||
    currentRecord.sourceCastRosterId !== pendingRecord.sourceCastRosterId
  ) {
    return null;
  }
  const current = parseSession(currentRecord);
  const pending = parseSession(pendingRecord);
  if (
    current === null ||
    pending === null ||
    current.evidence.transcriptInputSignature !==
      pending.evidence.transcriptInputSignature ||
    !exactPlan(
      current.provider.plannedCells,
      pending.provider.plannedCells,
    )
  ) {
    return null;
  }

  const receipts: BroadcastTranscriptProviderReceiptEntry[] = [];
  const captionReceipts: BroadcastTranscriptCaptionReceiptEntry[] = [];
  const resolvedEvidence: BroadcastTranscriptResolvedEvidenceEntry[] = [];
  const chapters: BroadcastContextChapterInput[] = [];
  const fragmentGaps: StoredBroadcastTranscriptGap[] = [];

  for (const cell of current.provider.plannedCells) {
    const settlement = chooseSettlement(
      current.settlementByChunkId.get(cell.chunkId),
      pending.settlementByChunkId.get(cell.chunkId),
    );
    switch (settlement?.kind) {
      case "provider":
        receipts.push(settlement.entry);
        chapters.push(settlement.chapter);
        break;
      case "caption":
        captionReceipts.push(settlement.entry);
        chapters.push(settlement.chapter);
        break;
      case "resolved":
        resolvedEvidence.push(settlement.entry);
        break;
      case "gap":
        fragmentGaps.push(settlement.gap);
        break;
      case undefined:
        break;
    }
  }

  const mergedProvider: BroadcastTranscriptProviderReceiptCheckpoint = {
    ...current.provider,
    receipts,
    captionReceipts,
  };
  let mergedEvidence: BroadcastTranscriptResolvedEvidenceCheckpoint = {
    ...current.evidence,
    resolvedEvidence,
  };
  let providerJson: string;
  try {
    providerJson =
      serializeBroadcastTranscriptProviderReceiptCheckpoint(mergedProvider);
    mergedEvidence = rebaseBroadcastTranscriptResolvedEvidenceModelRevision(
      mergedEvidence,
      broadcastTranscriptProviderReceiptCheckpointModelRevision(
        mergedProvider,
      ),
    );
  } catch {
    return null;
  }
  const modelRevision = mergedEvidence.modelRevision;
  const completePlan =
    fragmentGaps.length === 0 &&
    receipts.length +
      captionReceipts.length +
      resolvedEvidence.length ===
      current.provider.plannedCells.length;
  const completeAudioCoverage =
    completePlan &&
    (current.record.completeAudioCoverage ||
      pending.record.completeAudioCoverage);
  const normalizedChapters = [...chapters]
    .sort(
      (left, right) =>
        left.startMs - right.startMs || left.endMs - right.endMs,
    )
    .map((chapter, index) => ({
      ...chapter,
      chapterId: `transcript-${String(index + 1).padStart(3, "0")}`,
      evidenceMode: completeAudioCoverage
        ? ("complete-transcript" as const)
        : ("sampled-audio-video" as const),
      evidenceCoverageRatio: 1,
    }));
  try {
    return checkpointBroadcastContextSessionTranscript(current.record, {
      completeAudioCoverage,
      chapters: normalizedChapters,
      gapChunkIds: fragmentGaps.map(({ chunkId }) => chunkId),
      fragmentGaps,
      transcriptEvidenceInputSignature:
        mergedEvidence.transcriptInputSignature,
      transcriptEvidenceCheckpointJson:
        serializeBroadcastTranscriptResolvedEvidenceCheckpoint(mergedEvidence),
      transcriptProviderReceiptInputSignature:
        mergedProvider.routeManifestFingerprint,
      transcriptProviderReceiptCheckpointJson: providerJson,
      modelRevision,
      transcriptSealOperationKey: completePlan
        ? mergedEvidence.transcriptInputSignature
        : null,
      recordedAt: pending.record.recordedAt,
    });
  } catch {
    return null;
  }
}

export function broadcastTranscriptSessionCheckpointIncludes(
  durableRecord: BroadcastContextSessionRecord,
  candidateRecord: BroadcastContextSessionRecord,
): boolean {
  const merged = mergeBroadcastTranscriptSessionCheckpoints(
    durableRecord,
    candidateRecord,
  );
  return (
    merged !== null &&
    transcriptStateJson(merged) === transcriptStateJson(durableRecord)
  );
}

/**
 * Keeps paid outcome ambiguity outside automatic dispatch without using it as
 * a global stop condition. Never-dispatched and known-safe cells remain
 * runnable in the same recovery turn.
 */
export function selectRunnableBroadcastTranscriptChunks(
  chunks: readonly BroadcastContextTranscriptionChunk[],
  storedGaps: readonly StoredBroadcastTranscriptGap[],
  options: {
    readonly transportMode: BroadcastTranscriptRouteManifest["transportMode"];
    readonly allowPaidAmbiguousRetry: boolean;
  },
): readonly BroadcastContextTranscriptionChunk[] {
  if (
    options.transportMode === "free-r2" ||
    options.allowPaidAmbiguousRetry
  ) {
    return [...chunks];
  }
  const ambiguousChunkIds = new Set(
    storedGaps
      .filter(({ reason, attemptCount }) =>
        transcriptGapRequiresExplicitBillingRetry(reason, attemptCount),
      )
      .map(({ chunkId }) => chunkId),
  );
  return chunks.filter(({ chunkId }) => !ambiguousChunkIds.has(chunkId));
}

export function broadcastTranscriptGapCanAutomaticallyRetry(
  gap: StoredBroadcastTranscriptGap,
  transportMode: BroadcastTranscriptRouteManifest["transportMode"],
): boolean {
  return (
    gap.reason === "pending" ||
    gap.reason === "decode-failed" ||
    gap.reason === "transcription-failed" ||
    gap.reason === "rate-limited" ||
    (transportMode === "free-r2" &&
      transcriptGapRequiresExplicitBillingRetry(
        gap.reason,
        gap.attemptCount,
      ))
  );
}

export function broadcastTranscriptGapRequiresExplicitPaidRetry(
  gap: StoredBroadcastTranscriptGap,
  transportMode: BroadcastTranscriptRouteManifest["transportMode"],
): boolean {
  return (
    transportMode === "paid-direct" &&
    transcriptGapRequiresExplicitBillingRetry(
      gap.reason,
      gap.attemptCount,
    )
  );
}
