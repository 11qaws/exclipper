import {
  MAX_BROADCAST_TRANSCRIPT_EVIDENCE_CELLS,
  assertBroadcastTranscriptResolvedEvidenceCheckpoint,
  serializeBroadcastTranscriptResolvedEvidenceCheckpoint,
  type BroadcastTranscriptResolvedEvidenceCheckpoint,
  type BroadcastTranscriptResolvedEvidenceReason,
} from "./broadcastTranscriptResolvedEvidence";
import { MAX_BROADCAST_CONTEXT_SOURCE_DURATION_MS } from "./broadcastContextProtocol";
import type {
  CandidatePassBParticipantEvidenceBasis,
  CandidatePassBParticipantPresence,
  CandidatePassBParticipantRole,
} from "./candidatePassBWorkerProtocol";
import type { CandidatePassBParticipantId } from "./participantRoster";

export const BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_SCHEMA_VERSION =
  "3.0.0" as const;
export const BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_PLAN_REVISION =
  "broadcast-transcript-visual-inspection-plan-v3" as const;
export const BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_LEDGER_SCHEMA_VERSION =
  "3.0.0" as const;
export const BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION =
  "broadcast-transcript-visual-audio-pcm16-v1" as const;
export const BROADCAST_TRANSCRIPT_VISUAL_FRAME_COUNT = 4 as const;
export const BROADCAST_TRANSCRIPT_VISUAL_MAX_PARTICIPANT_SAMPLE_COUNT = 12;
export const DEFAULT_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_BATCH_SIZE = 12;
export const MAX_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_BATCH_SIZE = 24;
export const MAX_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_LEDGER_BYTES =
  2 * 1024 * 1024;

const EXACT_FINGERPRINT_PREFIX = "local-exact-fingerprint-v1:";
const CONTENT_FINGERPRINT_PATTERN =
  /^(?:sha256:[a-f0-9]{64}|local-fallback:[a-f0-9]{16})$/u;

export type BroadcastTranscriptVisualFrameTimestamps = readonly [
  number,
  number,
  number,
  number,
];

export type BroadcastTranscriptVisualInspectionPurpose =
  | "transcript-abstention"
  | "participant-grounding";

export type BroadcastTranscriptVisualInspectionReason =
  | BroadcastTranscriptResolvedEvidenceReason
  | "dialogue-sample";

export interface BroadcastTranscriptVisualInspectionSourceFence {
  readonly sourceFingerprint: string;
  readonly sourceDurationMs: number;
  readonly transcriptInputSignature: string;
  readonly transcriptModelRevision: string;
  readonly resolvedEvidenceFingerprint: string;
}

export interface BroadcastTranscriptVisualInspectionCell {
  readonly cellId: string;
  readonly transcriptChunkId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly inspectionPurpose: BroadcastTranscriptVisualInspectionPurpose;
  readonly transcriptAbstentionReason: BroadcastTranscriptVisualInspectionReason;
  readonly frameTimestampsMs: BroadcastTranscriptVisualFrameTimestamps;
  readonly frameBundleKey: string;
}

export interface BroadcastTranscriptVisualInspectionPlan {
  readonly schemaVersion:
    typeof BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_SCHEMA_VERSION;
  readonly planRevision:
    typeof BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_PLAN_REVISION;
  readonly planFingerprint: string;
  readonly sourceFence: BroadcastTranscriptVisualInspectionSourceFence;
  readonly cells: readonly BroadcastTranscriptVisualInspectionCell[];
}

export interface BroadcastTranscriptVisualSalienceHint {
  readonly cellId: string;
  readonly normalizedSalience: number;
}

export interface BroadcastTranscriptVisualCandidateRange {
  readonly candidateId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
}

export type BroadcastTranscriptVisualPriorityBasis =
  | "candidate-overlap"
  | "local-visual-salience"
  | "source-order";

export interface BroadcastTranscriptVisualFramePreparationTask
  extends BroadcastTranscriptVisualInspectionCell {
  readonly priorityOrdinal: number;
  readonly priorityBasis: BroadcastTranscriptVisualPriorityBasis;
  readonly normalizedVisualSalience: number;
  readonly candidateOverlapRatio: number;
  readonly overlappingCandidateIds: readonly string[];
}

export interface BroadcastTranscriptVisualFramePreparationQueue {
  readonly schemaVersion:
    typeof BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_SCHEMA_VERSION;
  readonly planFingerprint: string;
  readonly sourceFingerprint: string;
  readonly tasks: readonly BroadcastTranscriptVisualFramePreparationTask[];
}

export interface BroadcastTranscriptVisualPreparedFrameReceipt {
  readonly schemaVersion:
    typeof BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_SCHEMA_VERSION;
  readonly planFingerprint: string;
  readonly sourceFingerprint: string;
  readonly cellId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly frameBundleKey: string;
  readonly frameTimestampsMs: BroadcastTranscriptVisualFrameTimestamps;
  readonly frameContentFingerprints: readonly [
    string,
    string,
    string,
    string,
  ];
  /**
   * `no-audio` is the only state allowed to omit audio. A `no-speech` cell
   * still has decoded audio evidence: VAD found no usable speech, but the
   * multimodal provider must receive the exact source-fenced audio bytes.
   */
  readonly audioEvidence: BroadcastTranscriptVisualPreparedAudioEvidence | null;
}

export interface BroadcastTranscriptVisualPreparedAudioEvidence {
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly codec: string;
  readonly extractionRevision:
    typeof BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION;
  readonly contentFingerprint: string;
}

export interface BroadcastTranscriptVisualProviderTask
  extends BroadcastTranscriptVisualInspectionCell {
  readonly priorityOrdinal: number;
  readonly frameContentFingerprints: readonly [
    string,
    string,
    string,
    string,
  ];
  readonly audioEvidence: BroadcastTranscriptVisualPreparedAudioEvidence | null;
}

export interface BroadcastTranscriptVisualProviderBatch {
  readonly batchOrdinal: number;
  readonly tasks: readonly BroadcastTranscriptVisualProviderTask[];
}

export interface BroadcastTranscriptVisualProviderBatchQueue {
  readonly schemaVersion:
    typeof BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_SCHEMA_VERSION;
  readonly planFingerprint: string;
  readonly sourceFingerprint: string;
  readonly batches: readonly BroadcastTranscriptVisualProviderBatch[];
  readonly missingPreparedCellIds: readonly string[];
}

export type BroadcastTranscriptVisualProviderOutcome =
  | "completed"
  | "excluded-music-only"
  | "retryable"
  | "outcome-unknown";

export type BroadcastTranscriptVisualEditorialFinding =
  | "quiet-success"
  | "visual-event"
  | "no-usable-event"
  | "music-or-mv-only";

export type BroadcastTranscriptVisualProviderFailureReason =
  | "rate-limited"
  | "provider-unavailable"
  | "invalid-response"
  | "operation-interrupted"
  | "timeout-after-dispatch";

export interface BroadcastTranscriptVisualParticipantAttribution {
  readonly participantId: CandidatePassBParticipantId;
  readonly displayName: string;
  readonly role: CandidatePassBParticipantRole;
  readonly evidenceBasis: CandidatePassBParticipantEvidenceBasis;
  readonly evidenceKo: string;
  readonly confidence: number;
  readonly relativeTimestampMs: number;
  /** Zero-based indices into the same verified four-frame provider bundle. */
  readonly observedFrameIndices: readonly number[];
}

export interface BroadcastTranscriptVisualParticipantOutcome {
  readonly presence: CandidatePassBParticipantPresence;
  readonly summaryKo: string;
  readonly participants: readonly BroadcastTranscriptVisualParticipantAttribution[];
}

export interface BroadcastTranscriptVisualProviderSettlement {
  readonly schemaVersion:
    typeof BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_SCHEMA_VERSION;
  readonly planFingerprint: string;
  readonly sourceFingerprint: string;
  readonly transcriptInputSignature: string;
  readonly cellId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly frameBundleKey: string;
  readonly transcriptAbstentionReason: BroadcastTranscriptVisualInspectionReason;
  readonly providerModelRevision: string;
  readonly operationId: string;
  readonly attemptOrdinal: number;
  readonly requestedInspectionMode:
    "multimodal-audio-evidence-and-four-video-frames";
  /**
   * Exact content fence for the prepared images submitted with this attempt.
   * This remains present for retryable/unknown outcomes so a later retry cannot
   * silently settle against a different frame bundle.
   */
  readonly requestedFrameContentFingerprints: readonly [
    string,
    string,
    string,
    string,
  ];
  readonly requestedAudioEvidence:
    | BroadcastTranscriptVisualPreparedAudioEvidence
    | null;
  readonly outcome: BroadcastTranscriptVisualProviderOutcome;
  readonly reviewedFrameTimestampsMs:
    | BroadcastTranscriptVisualFrameTimestamps
    | readonly [];
  readonly transcriptAbstentionReviewed: boolean;
  readonly providerResponseFingerprint: string | null;
  readonly editorialFinding: BroadcastTranscriptVisualEditorialFinding | null;
  readonly summaryKo: string | null;
  readonly participantOutcome: BroadcastTranscriptVisualParticipantOutcome | null;
  readonly failureReason: BroadcastTranscriptVisualProviderFailureReason | null;
}

interface CreateBroadcastTranscriptVisualProviderSettlementBase {
  readonly plan: BroadcastTranscriptVisualInspectionPlan;
  readonly cellId: string;
  readonly preparedFrameReceipt: BroadcastTranscriptVisualPreparedFrameReceipt;
  readonly providerModelRevision: string;
  readonly operationId: string;
  readonly attemptOrdinal: number;
}

export type CreateBroadcastTranscriptVisualProviderSettlementInput =
  | (CreateBroadcastTranscriptVisualProviderSettlementBase & {
      readonly outcome: "completed";
      readonly editorialFinding: Exclude<
        BroadcastTranscriptVisualEditorialFinding,
        "music-or-mv-only"
      >;
      readonly summaryKo: string;
      readonly providerResponseFingerprint: string;
      readonly participantOutcome: BroadcastTranscriptVisualParticipantOutcome;
    })
  | (CreateBroadcastTranscriptVisualProviderSettlementBase & {
      readonly outcome: "excluded-music-only";
      readonly editorialFinding: "music-or-mv-only";
      readonly summaryKo: string;
      readonly providerResponseFingerprint: string;
      readonly participantOutcome: BroadcastTranscriptVisualParticipantOutcome;
    })
  | (CreateBroadcastTranscriptVisualProviderSettlementBase & {
      readonly outcome: "retryable" | "outcome-unknown";
      readonly failureReason: BroadcastTranscriptVisualProviderFailureReason;
    });

export interface BroadcastTranscriptVisualProviderSettlementLedger {
  readonly schemaVersion:
    typeof BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_LEDGER_SCHEMA_VERSION;
  readonly planFingerprint: string;
  readonly sourceFingerprint: string;
  readonly transcriptInputSignature: string;
  readonly settlements: readonly BroadcastTranscriptVisualProviderSettlement[];
}

export interface RecordBroadcastTranscriptVisualProviderSettlementOptions {
  /**
   * Outcome-unknown may already have consumed provider capacity. Replacing it
   * requires an explicit caller decision and a strictly newer attempt.
   */
  readonly allowOutcomeUnknownReplacement?: boolean;
}

export interface BroadcastTranscriptVisualInspectionPublicationStatus {
  readonly plannedCellCount: number;
  readonly preparedCellCount: number;
  readonly completedCellIds: readonly string[];
  readonly quietSuccessCellIds: readonly string[];
  readonly downstreamEligibleCellIds: readonly string[];
  readonly excludedMusicOnlyCellIds: readonly string[];
  readonly missingPreparedCellIds: readonly string[];
  readonly pendingProviderCellIds: readonly string[];
  readonly retryableCellIds: readonly string[];
  readonly outcomeUnknownCellIds: readonly string[];
  readonly publicationReady: boolean;
}

export type BroadcastTranscriptVisualInspectionContractErrorCode =
  | "INVALID_SOURCE_FENCE"
  | "INVALID_PLAN"
  | "INVALID_PRIORITY_INPUT"
  | "INVALID_FRAME_RECEIPT"
  | "INVALID_PROVIDER_SETTLEMENT"
  | "DUPLICATE_SETTLEMENT"
  | "STALE_SETTLEMENT"
  | "OUTCOME_UNKNOWN_REQUIRES_CONFIRMATION";

export class BroadcastTranscriptVisualInspectionContractError extends Error {
  public readonly code: BroadcastTranscriptVisualInspectionContractErrorCode;

  public constructor(
    code: BroadcastTranscriptVisualInspectionContractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BroadcastTranscriptVisualInspectionContractError";
    this.code = code;
  }
}

function boundedString(value: unknown, maximumLength = 2_048): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value.trim() === value &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function exactFingerprint(value: string): string {
  let high = 0x811c9dc5;
  let low = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    low = Math.imul(low ^ codePoint, 0x01000193) >>> 0;
    high = Math.imul(high ^ (codePoint + index), 0x85ebca6b) >>> 0;
  }
  return (
    EXACT_FINGERPRINT_PREFIX +
    high.toString(16).padStart(8, "0") +
    low.toString(16).padStart(8, "0")
  );
}

function exactFrameTimestamps(
  sourceStartMs: number,
  sourceEndMs: number,
): BroadcastTranscriptVisualFrameTimestamps {
  const durationMs = sourceEndMs - sourceStartMs;
  if (durationMs < BROADCAST_TRANSCRIPT_VISUAL_FRAME_COUNT) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      "INVALID_PLAN",
      "A visual inspection cell must contain four distinct source milliseconds.",
    );
  }
  const maximumOffsetMs = durationMs - 1;
  return [
    sourceStartMs,
    sourceStartMs + Math.floor(maximumOffsetMs / 3),
    sourceStartMs + Math.floor((maximumOffsetMs * 2) / 3),
    sourceEndMs - 1,
  ];
}

function exactFrameBundleKey(input: {
  readonly sourceFingerprint: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly frameTimestampsMs: BroadcastTranscriptVisualFrameTimestamps;
}): string {
  return [
    "broadcast-transcript-visual-jpeg4-v1",
    input.sourceFingerprint,
    `${input.sourceStartMs}-${input.sourceEndMs}`,
    input.frameTimestampsMs.join("."),
  ].join(":");
}

function canonicalPlanPayload(
  sourceFence: BroadcastTranscriptVisualInspectionSourceFence,
  cells: readonly BroadcastTranscriptVisualInspectionCell[],
): string {
  return JSON.stringify({
    planRevision: BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_PLAN_REVISION,
    sourceFence,
    cells,
  });
}

function expectedPlanFingerprint(
  sourceFence: BroadcastTranscriptVisualInspectionSourceFence,
  cells: readonly BroadcastTranscriptVisualInspectionCell[],
): string {
  return exactFingerprint(canonicalPlanPayload(sourceFence, cells));
}

function assertFrameTimestamps(
  value: unknown,
  cell: Pick<
    BroadcastTranscriptVisualInspectionCell,
    "sourceStartMs" | "sourceEndMs"
  >,
  code:
    | "INVALID_PLAN"
    | "INVALID_FRAME_RECEIPT"
    | "INVALID_PROVIDER_SETTLEMENT",
): asserts value is BroadcastTranscriptVisualFrameTimestamps {
  if (
    !Array.isArray(value) ||
    value.length !== BROADCAST_TRANSCRIPT_VISUAL_FRAME_COUNT ||
    value.some(
      (timestamp) =>
        !Number.isSafeInteger(timestamp) ||
        timestamp < cell.sourceStartMs ||
        timestamp >= cell.sourceEndMs,
    ) ||
    new Set(value).size !== BROADCAST_TRANSCRIPT_VISUAL_FRAME_COUNT ||
    value.some(
      (timestamp, index) => index > 0 && timestamp <= value[index - 1],
    )
  ) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      code,
      "A visual inspection receipt requires four ordered, distinct, source-fenced frame timestamps.",
    );
  }
}

function assertPreparedAudioEvidenceForCell(
  value: unknown,
  cell: BroadcastTranscriptVisualInspectionCell,
  code: "INVALID_FRAME_RECEIPT" | "INVALID_PROVIDER_SETTLEMENT",
): asserts value is BroadcastTranscriptVisualPreparedAudioEvidence | null {
  if (cell.transcriptAbstentionReason === "no-audio") {
    if (value !== null) {
      throw new BroadcastTranscriptVisualInspectionContractError(
        code,
        "A no-audio visual inspection cell must carry explicit null audio evidence.",
      );
    }
    return;
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "sourceStartMs",
      "sourceEndMs",
      "codec",
      "extractionRevision",
      "contentFingerprint",
    ]) ||
    value.sourceStartMs !== cell.sourceStartMs ||
    value.sourceEndMs !== cell.sourceEndMs ||
    !boundedString(value.codec, 256) ||
    value.extractionRevision !==
      BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION ||
    typeof value.contentFingerprint !== "string" ||
    !CONTENT_FINGERPRINT_PATTERN.test(value.contentFingerprint)
  ) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      code,
      "A visual inspection cell with source audio requires exact-range audio evidence with the current extraction revision.",
    );
  }
}

export function assertBroadcastTranscriptVisualInspectionPlan(
  value: unknown,
): asserts value is BroadcastTranscriptVisualInspectionPlan {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "planRevision",
      "planFingerprint",
      "sourceFence",
      "cells",
    ]) ||
    value.schemaVersion !==
      BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_SCHEMA_VERSION ||
    value.planRevision !==
      BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_PLAN_REVISION ||
    !boundedString(value.planFingerprint) ||
    !isRecord(value.sourceFence) ||
    !hasExactKeys(value.sourceFence, [
      "sourceFingerprint",
      "sourceDurationMs",
      "transcriptInputSignature",
      "transcriptModelRevision",
      "resolvedEvidenceFingerprint",
    ]) ||
    !boundedString(value.sourceFence.sourceFingerprint) ||
    !Number.isSafeInteger(value.sourceFence.sourceDurationMs) ||
    (value.sourceFence.sourceDurationMs as number) <= 0 ||
    (value.sourceFence.sourceDurationMs as number) >
      MAX_BROADCAST_CONTEXT_SOURCE_DURATION_MS ||
    !boundedString(value.sourceFence.transcriptInputSignature) ||
    !boundedString(value.sourceFence.transcriptModelRevision, 512) ||
    !boundedString(value.sourceFence.resolvedEvidenceFingerprint) ||
    !Array.isArray(value.cells) ||
    value.cells.length > MAX_BROADCAST_TRANSCRIPT_EVIDENCE_CELLS
  ) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      "INVALID_SOURCE_FENCE",
      "The transcript visual inspection source or plan fence is invalid.",
    );
  }

  const sourceFence =
    value.sourceFence as unknown as BroadcastTranscriptVisualInspectionSourceFence;
  const cells: BroadcastTranscriptVisualInspectionCell[] = [];
  const cellIds = new Set<string>();
  const transcriptChunkIds = new Set<string>();
  let previousEndMs = -1;
  for (const rawCell of value.cells) {
    if (
      !isRecord(rawCell) ||
      !hasExactKeys(rawCell, [
        "cellId",
        "transcriptChunkId",
        "sourceStartMs",
        "sourceEndMs",
        "inspectionPurpose",
        "transcriptAbstentionReason",
        "frameTimestampsMs",
        "frameBundleKey",
      ]) ||
      !boundedString(rawCell.cellId, 256) ||
      !boundedString(rawCell.transcriptChunkId, 256) ||
      rawCell.cellId !== `visual:${rawCell.transcriptChunkId}` ||
      cellIds.has(rawCell.cellId) ||
      transcriptChunkIds.has(rawCell.transcriptChunkId) ||
      !Number.isSafeInteger(rawCell.sourceStartMs) ||
      !Number.isSafeInteger(rawCell.sourceEndMs) ||
      (rawCell.sourceStartMs as number) < 0 ||
      (rawCell.sourceEndMs as number) <= (rawCell.sourceStartMs as number) ||
      (rawCell.sourceEndMs as number) > sourceFence.sourceDurationMs ||
      (rawCell.sourceStartMs as number) < previousEndMs ||
      !(
        (rawCell.inspectionPurpose === "transcript-abstention" &&
          (rawCell.transcriptAbstentionReason === "no-audio" ||
            rawCell.transcriptAbstentionReason === "no-speech")) ||
        (rawCell.inspectionPurpose === "participant-grounding" &&
          rawCell.transcriptAbstentionReason === "dialogue-sample")
      ) ||
      !boundedString(rawCell.frameBundleKey)
    ) {
      throw new BroadcastTranscriptVisualInspectionContractError(
        "INVALID_PLAN",
        "A transcript visual inspection cell is invalid or duplicated.",
      );
    }
    const cell = rawCell as unknown as BroadcastTranscriptVisualInspectionCell;
    assertFrameTimestamps(cell.frameTimestampsMs, cell, "INVALID_PLAN");
    if (
      JSON.stringify(cell.frameTimestampsMs) !==
        JSON.stringify(exactFrameTimestamps(cell.sourceStartMs, cell.sourceEndMs)) ||
      cell.frameBundleKey !== exactFrameBundleKey({
        sourceFingerprint: sourceFence.sourceFingerprint,
        sourceStartMs: cell.sourceStartMs,
        sourceEndMs: cell.sourceEndMs,
        frameTimestampsMs: cell.frameTimestampsMs,
      })
    ) {
      throw new BroadcastTranscriptVisualInspectionContractError(
        "INVALID_PLAN",
        "A transcript visual inspection cell does not match its deterministic four-frame plan.",
      );
    }
    cellIds.add(cell.cellId);
    transcriptChunkIds.add(cell.transcriptChunkId);
    previousEndMs = cell.sourceEndMs;
    cells.push(cell);
  }
  if (
    value.planFingerprint !== expectedPlanFingerprint(sourceFence, cells)
  ) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      "INVALID_PLAN",
      "The transcript visual inspection plan fingerprint is stale.",
    );
  }
}

export function createBroadcastTranscriptVisualInspectionPlan(
  evidenceCheckpoint: BroadcastTranscriptResolvedEvidenceCheckpoint,
): BroadcastTranscriptVisualInspectionPlan {
  assertBroadcastTranscriptResolvedEvidenceCheckpoint(evidenceCheckpoint);
  const resolvedEvidenceFingerprint = exactFingerprint(
    serializeBroadcastTranscriptResolvedEvidenceCheckpoint(
      evidenceCheckpoint,
    ),
  );
  const sourceFence: BroadcastTranscriptVisualInspectionSourceFence = {
    sourceFingerprint: evidenceCheckpoint.sourceFingerprint,
    sourceDurationMs: evidenceCheckpoint.sourceDurationMs,
    transcriptInputSignature: evidenceCheckpoint.transcriptInputSignature,
    transcriptModelRevision: evidenceCheckpoint.modelRevision,
    resolvedEvidenceFingerprint,
  };
  const resolvedChunkIds = new Set(
    evidenceCheckpoint.resolvedEvidence.map(({ chunkId }) => chunkId),
  );
  const dialogueCells = evidenceCheckpoint.plannedCells.filter(
    (cell) =>
      !resolvedChunkIds.has(cell.chunkId) &&
      cell.sourceEndMs - cell.sourceStartMs >=
        BROADCAST_TRANSCRIPT_VISUAL_FRAME_COUNT,
  );
  const participantSampleCount = Math.min(
    BROADCAST_TRANSCRIPT_VISUAL_MAX_PARTICIPANT_SAMPLE_COUNT,
    dialogueCells.length,
  );
  const participantSampleCells = Array.from(
    { length: participantSampleCount },
    (_, ordinal) =>
      dialogueCells[
        Math.floor(
          ((ordinal * 2 + 1) * dialogueCells.length) /
            (participantSampleCount * 2),
        )
      ]!,
  );
  const cells = [
    ...evidenceCheckpoint.resolvedEvidence.map((entry) => ({
      transcriptChunkId: entry.chunkId,
      sourceStartMs: entry.sourceStartMs,
      sourceEndMs: entry.sourceEndMs,
      inspectionPurpose: "transcript-abstention" as const,
      transcriptAbstentionReason: entry.reason,
    })),
    ...participantSampleCells.map((entry) => ({
      transcriptChunkId: entry.chunkId,
      sourceStartMs: entry.sourceStartMs,
      sourceEndMs: entry.sourceEndMs,
      inspectionPurpose: "participant-grounding" as const,
      transcriptAbstentionReason: "dialogue-sample" as const,
    })),
  ]
    .sort(
      (left, right) =>
        left.sourceStartMs - right.sourceStartMs ||
        left.sourceEndMs - right.sourceEndMs ||
        left.transcriptChunkId.localeCompare(right.transcriptChunkId),
    )
    .map((entry) => {
      const frameTimestampsMs = exactFrameTimestamps(
        entry.sourceStartMs,
        entry.sourceEndMs,
      );
      return {
        ...entry,
        cellId: `visual:${entry.transcriptChunkId}`,
        frameTimestampsMs,
        frameBundleKey: exactFrameBundleKey({
          sourceFingerprint: evidenceCheckpoint.sourceFingerprint,
          sourceStartMs: entry.sourceStartMs,
          sourceEndMs: entry.sourceEndMs,
          frameTimestampsMs,
        }),
      };
    });
  const plan: BroadcastTranscriptVisualInspectionPlan = {
    schemaVersion: BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_SCHEMA_VERSION,
    planRevision: BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_PLAN_REVISION,
    planFingerprint: expectedPlanFingerprint(sourceFence, cells),
    sourceFence,
    cells,
  };
  assertBroadcastTranscriptVisualInspectionPlan(plan);
  return plan;
}

export function serializeBroadcastTranscriptVisualInspectionPlan(
  plan: BroadcastTranscriptVisualInspectionPlan,
): string {
  assertBroadcastTranscriptVisualInspectionPlan(plan);
  return JSON.stringify(plan);
}

export function parseBroadcastTranscriptVisualInspectionPlanJson(
  serialized: string,
): BroadcastTranscriptVisualInspectionPlan | null {
  if (
    typeof serialized !== "string" ||
    serialized.length === 0 ||
    utf8ByteLength(serialized) >
      MAX_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_LEDGER_BYTES
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(serialized);
    assertBroadcastTranscriptVisualInspectionPlan(parsed);
    return parsed;
  } catch {
    return null;
  }
}

function overlapDurationMs(
  left: Pick<
    BroadcastTranscriptVisualInspectionCell,
    "sourceStartMs" | "sourceEndMs"
  >,
  right: BroadcastTranscriptVisualCandidateRange,
): number {
  return Math.max(
    0,
    Math.min(left.sourceEndMs, right.sourceEndMs) -
      Math.max(left.sourceStartMs, right.sourceStartMs),
  );
}

export function createBroadcastTranscriptVisualFramePreparationQueue(
  plan: BroadcastTranscriptVisualInspectionPlan,
  input: {
    readonly localVisualSalience?: readonly BroadcastTranscriptVisualSalienceHint[];
    readonly existingCandidates?: readonly BroadcastTranscriptVisualCandidateRange[];
  } = {},
): BroadcastTranscriptVisualFramePreparationQueue {
  assertBroadcastTranscriptVisualInspectionPlan(plan);
  const salienceByCellId = new Map<string, number>();
  const plannedCellIds = new Set(plan.cells.map(({ cellId }) => cellId));
  for (const hint of input.localVisualSalience ?? []) {
    if (
      !plannedCellIds.has(hint.cellId) ||
      salienceByCellId.has(hint.cellId) ||
      !Number.isFinite(hint.normalizedSalience) ||
      hint.normalizedSalience < 0 ||
      hint.normalizedSalience > 1
    ) {
      throw new BroadcastTranscriptVisualInspectionContractError(
        "INVALID_PRIORITY_INPUT",
        "Local visual salience must be one normalized hint per planned cell.",
      );
    }
    salienceByCellId.set(hint.cellId, hint.normalizedSalience);
  }

  const candidateIds = new Set<string>();
  const candidates = (input.existingCandidates ?? []).map((candidate) => {
    if (
      !boundedString(candidate.candidateId, 256) ||
      candidateIds.has(candidate.candidateId) ||
      !Number.isSafeInteger(candidate.sourceStartMs) ||
      !Number.isSafeInteger(candidate.sourceEndMs) ||
      candidate.sourceStartMs < 0 ||
      candidate.sourceEndMs <= candidate.sourceStartMs ||
      candidate.sourceEndMs > plan.sourceFence.sourceDurationMs
    ) {
      throw new BroadcastTranscriptVisualInspectionContractError(
        "INVALID_PRIORITY_INPUT",
        "Existing candidate priority ranges must be unique source-fenced ranges.",
      );
    }
    candidateIds.add(candidate.candidateId);
    return candidate;
  });

  const unordered = plan.cells.map((cell) => {
    const overlaps = candidates
      .map((candidate) => ({
        candidate,
        overlapMs: overlapDurationMs(cell, candidate),
      }))
      .filter(({ overlapMs }) => overlapMs > 0)
      .sort(
        (left, right) =>
          right.overlapMs - left.overlapMs ||
          left.candidate.candidateId.localeCompare(
            right.candidate.candidateId,
          ),
      );
    const durationMs = cell.sourceEndMs - cell.sourceStartMs;
    const candidateOverlapRatio =
      overlaps.length === 0 ? 0 : (overlaps[0]?.overlapMs ?? 0) / durationMs;
    const normalizedVisualSalience =
      salienceByCellId.get(cell.cellId) ?? 0;
    const priorityBasis: BroadcastTranscriptVisualPriorityBasis =
      candidateOverlapRatio > 0
        ? "candidate-overlap"
        : normalizedVisualSalience > 0
          ? "local-visual-salience"
          : "source-order";
    return {
      ...cell,
      priorityOrdinal: 0,
      priorityBasis,
      normalizedVisualSalience,
      candidateOverlapRatio,
      overlappingCandidateIds: overlaps.map(
        ({ candidate }) => candidate.candidateId,
      ),
    };
  });
  const tasks = unordered
    .sort(
      (left, right) =>
        Number(right.candidateOverlapRatio > 0) -
          Number(left.candidateOverlapRatio > 0) ||
        right.candidateOverlapRatio - left.candidateOverlapRatio ||
        right.normalizedVisualSalience - left.normalizedVisualSalience ||
        left.sourceStartMs - right.sourceStartMs ||
        left.cellId.localeCompare(right.cellId),
    )
    .map((task, priorityOrdinal) => ({ ...task, priorityOrdinal }));
  if (
    tasks.length !== plan.cells.length ||
    new Set(tasks.map(({ cellId }) => cellId)).size !== plan.cells.length
  ) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      "INVALID_PRIORITY_INPUT",
      "Priority hints may reorder visual inspection cells but cannot remove them.",
    );
  }
  const queue: BroadcastTranscriptVisualFramePreparationQueue = {
    schemaVersion: BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_SCHEMA_VERSION,
    planFingerprint: plan.planFingerprint,
    sourceFingerprint: plan.sourceFence.sourceFingerprint,
    tasks,
  };
  assertFramePreparationQueueForPlan(queue, plan);
  return queue;
}

function cellFor(
  plan: BroadcastTranscriptVisualInspectionPlan,
  cellId: string,
  code: BroadcastTranscriptVisualInspectionContractErrorCode = "INVALID_FRAME_RECEIPT",
): BroadcastTranscriptVisualInspectionCell {
  const cell = plan.cells.find((candidate) => candidate.cellId === cellId);
  if (cell === undefined) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      code,
      "A visual inspection receipt references an unknown plan cell.",
    );
  }
  return cell;
}

function assertFramePreparationQueueForPlan(
  queue: BroadcastTranscriptVisualFramePreparationQueue,
  plan: BroadcastTranscriptVisualInspectionPlan,
): void {
  if (
    queue.schemaVersion !==
      BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_SCHEMA_VERSION ||
    queue.planFingerprint !== plan.planFingerprint ||
    queue.sourceFingerprint !== plan.sourceFence.sourceFingerprint ||
    !Array.isArray(queue.tasks) ||
    queue.tasks.length !== plan.cells.length
  ) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      "INVALID_PRIORITY_INPUT",
      "The frame-preparation queue does not match its exact source and plan fence.",
    );
  }
  const cellIds = new Set<string>();
  const priorityOrdinals = new Set<number>();
  // Preserve the declared element type after Array.isArray()'s any[] guard.
  const tasks =
    queue.tasks as readonly BroadcastTranscriptVisualFramePreparationTask[];
  for (const [queueOrdinal, task] of tasks.entries()) {
    const cell = cellFor(plan, task.cellId, "INVALID_PRIORITY_INPUT");
    if (
      cellIds.has(task.cellId) ||
      priorityOrdinals.has(task.priorityOrdinal) ||
      task.priorityOrdinal !== queueOrdinal ||
      task.transcriptChunkId !== cell.transcriptChunkId ||
      task.sourceStartMs !== cell.sourceStartMs ||
      task.sourceEndMs !== cell.sourceEndMs ||
      task.inspectionPurpose !== cell.inspectionPurpose ||
      task.transcriptAbstentionReason !== cell.transcriptAbstentionReason ||
      task.frameBundleKey !== cell.frameBundleKey ||
      JSON.stringify(task.frameTimestampsMs) !==
        JSON.stringify(cell.frameTimestampsMs) ||
      ![
        "candidate-overlap",
        "local-visual-salience",
        "source-order",
      ].includes(task.priorityBasis) ||
      !Number.isFinite(task.normalizedVisualSalience) ||
      task.normalizedVisualSalience < 0 ||
      task.normalizedVisualSalience > 1 ||
      !Number.isFinite(task.candidateOverlapRatio) ||
      task.candidateOverlapRatio < 0 ||
      task.candidateOverlapRatio > 1 ||
      !Array.isArray(task.overlappingCandidateIds) ||
      new Set(task.overlappingCandidateIds).size !==
        task.overlappingCandidateIds.length ||
      task.overlappingCandidateIds.some(
        (candidateId) => !boundedString(candidateId, 256),
      ) ||
      (task.priorityBasis === "candidate-overlap"
        ? task.candidateOverlapRatio <= 0 ||
          task.overlappingCandidateIds.length === 0
        : task.candidateOverlapRatio !== 0 ||
          task.overlappingCandidateIds.length !== 0) ||
      (task.priorityBasis === "local-visual-salience"
        ? task.normalizedVisualSalience <= 0
        : task.priorityBasis === "source-order" &&
          task.normalizedVisualSalience !== 0)
    ) {
      throw new BroadcastTranscriptVisualInspectionContractError(
        "INVALID_PRIORITY_INPUT",
        "A frame-preparation task may change only priority metadata, never its planned cell evidence.",
      );
    }
    cellIds.add(task.cellId);
    priorityOrdinals.add(task.priorityOrdinal);
  }
  if (
    cellIds.size !== plan.cells.length ||
    plan.cells.some(({ cellId }) => !cellIds.has(cellId))
  ) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      "INVALID_PRIORITY_INPUT",
      "Priority hints may reorder visual inspection cells but cannot remove them.",
    );
  }
}

function assertPreparedFrameReceiptForPlan(
  receipt: BroadcastTranscriptVisualPreparedFrameReceipt,
  plan: BroadcastTranscriptVisualInspectionPlan,
): void {
  const cell = cellFor(plan, receipt.cellId);
  assertFrameTimestamps(
    receipt.frameTimestampsMs,
    cell,
    "INVALID_FRAME_RECEIPT",
  );
  if (
    !isRecord(receipt) ||
    !hasExactKeys(receipt, [
      "schemaVersion",
      "planFingerprint",
      "sourceFingerprint",
      "cellId",
      "sourceStartMs",
      "sourceEndMs",
      "frameBundleKey",
      "frameTimestampsMs",
      "frameContentFingerprints",
      "audioEvidence",
    ]) ||
    receipt.schemaVersion !==
      BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_SCHEMA_VERSION ||
    receipt.planFingerprint !== plan.planFingerprint ||
    receipt.sourceFingerprint !== plan.sourceFence.sourceFingerprint ||
    receipt.sourceStartMs !== cell.sourceStartMs ||
    receipt.sourceEndMs !== cell.sourceEndMs ||
    receipt.frameBundleKey !== cell.frameBundleKey ||
    JSON.stringify(receipt.frameTimestampsMs) !==
      JSON.stringify(cell.frameTimestampsMs) ||
    !Array.isArray(receipt.frameContentFingerprints) ||
    receipt.frameContentFingerprints.length !==
      BROADCAST_TRANSCRIPT_VISUAL_FRAME_COUNT ||
    receipt.frameContentFingerprints.some(
      (fingerprint) =>
        typeof fingerprint !== "string" ||
        !CONTENT_FINGERPRINT_PATTERN.test(fingerprint),
    )
  ) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      "INVALID_FRAME_RECEIPT",
      "A prepared frame receipt does not match its exact source and frame plan.",
    );
  }
  assertPreparedAudioEvidenceForCell(
    receipt.audioEvidence,
    cell,
    "INVALID_FRAME_RECEIPT",
  );
}

export function createBroadcastTranscriptVisualPreparedFrameReceipt(input: {
  readonly plan: BroadcastTranscriptVisualInspectionPlan;
  readonly cellId: string;
  readonly frameContentFingerprints: readonly [
    string,
    string,
    string,
    string,
  ];
  readonly audioEvidence: BroadcastTranscriptVisualPreparedAudioEvidence | null;
}): BroadcastTranscriptVisualPreparedFrameReceipt {
  assertBroadcastTranscriptVisualInspectionPlan(input.plan);
  const cell = cellFor(input.plan, input.cellId);
  const receipt: BroadcastTranscriptVisualPreparedFrameReceipt = {
    schemaVersion: BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_SCHEMA_VERSION,
    planFingerprint: input.plan.planFingerprint,
    sourceFingerprint: input.plan.sourceFence.sourceFingerprint,
    cellId: cell.cellId,
    sourceStartMs: cell.sourceStartMs,
    sourceEndMs: cell.sourceEndMs,
    frameBundleKey: cell.frameBundleKey,
    frameTimestampsMs: cell.frameTimestampsMs,
    frameContentFingerprints: input.frameContentFingerprints,
    audioEvidence:
      input.audioEvidence === null ? null : { ...input.audioEvidence },
  };
  assertPreparedFrameReceiptForPlan(receipt, input.plan);
  return receipt;
}

export function createBroadcastTranscriptVisualProviderBatchQueue(input: {
  readonly plan: BroadcastTranscriptVisualInspectionPlan;
  readonly framePreparationQueue: BroadcastTranscriptVisualFramePreparationQueue;
  readonly preparedFrameReceipts: readonly BroadcastTranscriptVisualPreparedFrameReceipt[];
  readonly maximumBatchSize?: number;
}): BroadcastTranscriptVisualProviderBatchQueue {
  assertBroadcastTranscriptVisualInspectionPlan(input.plan);
  const maximumBatchSize =
    input.maximumBatchSize ??
    DEFAULT_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_BATCH_SIZE;
  if (
    !Number.isSafeInteger(maximumBatchSize) ||
    maximumBatchSize <= 0 ||
    maximumBatchSize >
      MAX_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_BATCH_SIZE
  ) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      "INVALID_PRIORITY_INPUT",
      "The visual provider batch size is outside its bounded contract.",
    );
  }
  assertFramePreparationQueueForPlan(
    input.framePreparationQueue,
    input.plan,
  );

  const receiptsByCellId = new Map<
    string,
    BroadcastTranscriptVisualPreparedFrameReceipt
  >();
  for (const receipt of input.preparedFrameReceipts) {
    if (receiptsByCellId.has(receipt.cellId)) {
      throw new BroadcastTranscriptVisualInspectionContractError(
        "INVALID_FRAME_RECEIPT",
        "A visual inspection cell cannot have duplicate prepared-frame receipts.",
      );
    }
    assertPreparedFrameReceiptForPlan(receipt, input.plan);
    receiptsByCellId.set(receipt.cellId, receipt);
  }

  const tasks: BroadcastTranscriptVisualProviderTask[] = [];
  const missingPreparedCellIds: string[] = [];
  for (const queued of input.framePreparationQueue.tasks) {
    const cell = cellFor(input.plan, queued.cellId);
    const receipt = receiptsByCellId.get(cell.cellId);
    if (receipt === undefined) {
      missingPreparedCellIds.push(cell.cellId);
      continue;
    }
    tasks.push({
      ...cell,
      priorityOrdinal: queued.priorityOrdinal,
      frameContentFingerprints: receipt.frameContentFingerprints,
      audioEvidence:
        receipt.audioEvidence === null ? null : { ...receipt.audioEvidence },
    });
  }
  const batches = Array.from(
    { length: Math.ceil(tasks.length / maximumBatchSize) },
    (_, index) => ({
      batchOrdinal: index,
      tasks: tasks.slice(
        index * maximumBatchSize,
        (index + 1) * maximumBatchSize,
      ),
    }),
  );
  return {
    schemaVersion: BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_SCHEMA_VERSION,
    planFingerprint: input.plan.planFingerprint,
    sourceFingerprint: input.plan.sourceFence.sourceFingerprint,
    batches,
    missingPreparedCellIds,
  };
}

function validProviderFailureForOutcome(
  outcome: "retryable" | "outcome-unknown",
  reason: BroadcastTranscriptVisualProviderFailureReason,
): boolean {
  return outcome === "retryable"
    ? ["rate-limited", "provider-unavailable", "invalid-response"].includes(
        reason,
      )
    : ["operation-interrupted", "timeout-after-dispatch"].includes(reason);
}

const VISUAL_PARTICIPANT_IDS = new Set<CandidatePassBParticipantId>([
  "sera-professor",
  "amoretto",
  "eureka",
  "sena-arbel",
  "torori-coco",
  "mangjing",
]);

function validVisualParticipantOutcome(
  value: unknown,
  cellDurationMs: number,
): value is BroadcastTranscriptVisualParticipantOutcome {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["presence", "summaryKo", "participants"]) ||
    ![
      "identified",
      "present-unidentified",
      "none-present",
      "insufficient-evidence",
    ].includes(String(value.presence)) ||
    !boundedString(value.summaryKo, 2_000) ||
    !Array.isArray(value.participants) ||
    value.participants.length > VISUAL_PARTICIPANT_IDS.size
  ) {
    return false;
  }
  const participantIds = new Set<CandidatePassBParticipantId>();
  for (const participant of value.participants) {
    if (
      !isRecord(participant) ||
      !hasExactKeys(participant, [
        "participantId",
        "displayName",
        "role",
        "evidenceBasis",
        "evidenceKo",
        "confidence",
        "relativeTimestampMs",
        "observedFrameIndices",
      ]) ||
      !VISUAL_PARTICIPANT_IDS.has(
        participant.participantId as CandidatePassBParticipantId,
      ) ||
      participantIds.has(
        participant.participantId as CandidatePassBParticipantId,
      ) ||
      !boundedString(participant.displayName, 256) ||
      !["streamer", "guest", "unknown"].includes(String(participant.role)) ||
      ![
        "on-screen-name",
        "spoken-name",
        "provided-cast-reference",
      ].includes(String(participant.evidenceBasis)) ||
      !boundedString(participant.evidenceKo, 1_000) ||
      typeof participant.confidence !== "number" ||
      !Number.isFinite(participant.confidence) ||
      participant.confidence < 0 ||
      participant.confidence > 1 ||
      typeof participant.relativeTimestampMs !== "number" ||
      !Number.isSafeInteger(participant.relativeTimestampMs) ||
      participant.relativeTimestampMs < 0 ||
      participant.relativeTimestampMs > cellDurationMs ||
      !Array.isArray(participant.observedFrameIndices) ||
      participant.observedFrameIndices.some(
        (index) =>
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= BROADCAST_TRANSCRIPT_VISUAL_FRAME_COUNT,
      ) ||
      new Set(participant.observedFrameIndices).size !==
        participant.observedFrameIndices.length
    ) {
      return false;
    }
    participantIds.add(
      participant.participantId as CandidatePassBParticipantId,
    );
  }
  return value.presence === "identified"
    ? value.participants.length > 0
    : value.participants.length === 0;
}

function assertProviderSettlementForPlan(
  settlement: BroadcastTranscriptVisualProviderSettlement,
  plan: BroadcastTranscriptVisualInspectionPlan,
): void {
  const cell = cellFor(plan, settlement.cellId, "INVALID_PROVIDER_SETTLEMENT");
  if (
    !isRecord(settlement) ||
    !hasExactKeys(settlement, [
      "schemaVersion",
      "planFingerprint",
      "sourceFingerprint",
      "transcriptInputSignature",
      "cellId",
      "sourceStartMs",
      "sourceEndMs",
      "frameBundleKey",
      "transcriptAbstentionReason",
      "providerModelRevision",
      "operationId",
      "attemptOrdinal",
      "requestedInspectionMode",
      "requestedFrameContentFingerprints",
      "requestedAudioEvidence",
      "outcome",
      "reviewedFrameTimestampsMs",
      "transcriptAbstentionReviewed",
      "providerResponseFingerprint",
      "editorialFinding",
      "summaryKo",
      "participantOutcome",
      "failureReason",
    ]) ||
    settlement.schemaVersion !==
      BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_SCHEMA_VERSION ||
    settlement.planFingerprint !== plan.planFingerprint ||
    settlement.sourceFingerprint !== plan.sourceFence.sourceFingerprint ||
    settlement.transcriptInputSignature !==
      plan.sourceFence.transcriptInputSignature ||
    settlement.sourceStartMs !== cell.sourceStartMs ||
    settlement.sourceEndMs !== cell.sourceEndMs ||
    settlement.frameBundleKey !== cell.frameBundleKey ||
    settlement.transcriptAbstentionReason !==
      cell.transcriptAbstentionReason ||
    !boundedString(settlement.providerModelRevision, 512) ||
    !boundedString(settlement.operationId, 256) ||
    !Number.isSafeInteger(settlement.attemptOrdinal) ||
    settlement.attemptOrdinal < 0 ||
    settlement.requestedInspectionMode !==
      "multimodal-audio-evidence-and-four-video-frames" ||
    !Array.isArray(settlement.requestedFrameContentFingerprints) ||
    settlement.requestedFrameContentFingerprints.length !==
      BROADCAST_TRANSCRIPT_VISUAL_FRAME_COUNT ||
    settlement.requestedFrameContentFingerprints.some(
      (fingerprint) =>
        typeof fingerprint !== "string" ||
        !CONTENT_FINGERPRINT_PATTERN.test(fingerprint),
    ) ||
    ![
      "completed",
      "excluded-music-only",
      "retryable",
      "outcome-unknown",
    ].includes(settlement.outcome)
  ) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      "INVALID_PROVIDER_SETTLEMENT",
      "A provider settlement does not match its exact visual inspection plan.",
    );
  }
  assertPreparedAudioEvidenceForCell(
    settlement.requestedAudioEvidence,
    cell,
    "INVALID_PROVIDER_SETTLEMENT",
  );

  const terminal =
    settlement.outcome === "completed" ||
    settlement.outcome === "excluded-music-only";
  if (terminal) {
    assertFrameTimestamps(
      settlement.reviewedFrameTimestampsMs,
      cell,
      "INVALID_PROVIDER_SETTLEMENT",
    );
    if (
      JSON.stringify(settlement.reviewedFrameTimestampsMs) !==
        JSON.stringify(cell.frameTimestampsMs) ||
      settlement.transcriptAbstentionReviewed !== true ||
      typeof settlement.providerResponseFingerprint !== "string" ||
      !CONTENT_FINGERPRINT_PATTERN.test(
        settlement.providerResponseFingerprint,
      ) ||
      !boundedString(settlement.summaryKo, 4_000) ||
      !validVisualParticipantOutcome(
        settlement.participantOutcome,
        cell.sourceEndMs - cell.sourceStartMs,
      ) ||
      settlement.failureReason !== null ||
      (settlement.outcome === "excluded-music-only"
        ? settlement.editorialFinding !== "music-or-mv-only"
        : !["quiet-success", "visual-event", "no-usable-event"].includes(
            settlement.editorialFinding ?? "",
          ))
    ) {
      throw new BroadcastTranscriptVisualInspectionContractError(
        "INVALID_PROVIDER_SETTLEMENT",
        "A terminal visual inspection requires a complete multimodal four-frame receipt.",
      );
    }
    return;
  }

  if (
    !Array.isArray(settlement.reviewedFrameTimestampsMs) ||
    settlement.reviewedFrameTimestampsMs.length !== 0 ||
    settlement.transcriptAbstentionReviewed !== false ||
    settlement.providerResponseFingerprint !== null ||
    settlement.editorialFinding !== null ||
    settlement.summaryKo !== null ||
    settlement.participantOutcome !== null ||
    settlement.failureReason === null ||
    !validProviderFailureForOutcome(
      settlement.outcome,
      settlement.failureReason,
    )
  ) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      "INVALID_PROVIDER_SETTLEMENT",
      "An unresolved provider settlement cannot claim completed multimodal review.",
    );
  }
}

export function createBroadcastTranscriptVisualProviderSettlement(
  input: CreateBroadcastTranscriptVisualProviderSettlementInput,
): BroadcastTranscriptVisualProviderSettlement {
  assertBroadcastTranscriptVisualInspectionPlan(input.plan);
  const cell = cellFor(input.plan, input.cellId);
  assertPreparedFrameReceiptForPlan(input.preparedFrameReceipt, input.plan);
  if (input.preparedFrameReceipt.cellId !== cell.cellId) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      "INVALID_FRAME_RECEIPT",
      "A visual provider settlement requires the prepared frames for the same exact plan cell.",
    );
  }
  const terminal =
    input.outcome === "completed" ||
    input.outcome === "excluded-music-only";
  const settlement: BroadcastTranscriptVisualProviderSettlement = {
    schemaVersion: BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_SCHEMA_VERSION,
    planFingerprint: input.plan.planFingerprint,
    sourceFingerprint: input.plan.sourceFence.sourceFingerprint,
    transcriptInputSignature:
      input.plan.sourceFence.transcriptInputSignature,
    cellId: cell.cellId,
    sourceStartMs: cell.sourceStartMs,
    sourceEndMs: cell.sourceEndMs,
    frameBundleKey: cell.frameBundleKey,
    transcriptAbstentionReason: cell.transcriptAbstentionReason,
    providerModelRevision: input.providerModelRevision,
    operationId: input.operationId,
    attemptOrdinal: input.attemptOrdinal,
    requestedInspectionMode:
      "multimodal-audio-evidence-and-four-video-frames",
    requestedFrameContentFingerprints:
      input.preparedFrameReceipt.frameContentFingerprints,
    requestedAudioEvidence:
      input.preparedFrameReceipt.audioEvidence === null
        ? null
        : { ...input.preparedFrameReceipt.audioEvidence },
    outcome: input.outcome,
    reviewedFrameTimestampsMs: terminal ? cell.frameTimestampsMs : [],
    transcriptAbstentionReviewed: terminal,
    providerResponseFingerprint: terminal
      ? input.providerResponseFingerprint
      : null,
    editorialFinding: terminal ? input.editorialFinding : null,
    summaryKo: terminal ? input.summaryKo : null,
    participantOutcome: "participantOutcome" in input
      ? {
          presence: input.participantOutcome.presence,
          summaryKo: input.participantOutcome.summaryKo,
          participants: input.participantOutcome.participants.map(
            (participant) => ({
              ...participant,
              observedFrameIndices: [...participant.observedFrameIndices],
            }),
          ),
        }
      : null,
    failureReason: terminal ? null : input.failureReason,
  };
  assertProviderSettlementForPlan(settlement, input.plan);
  return settlement;
}

export function createBroadcastTranscriptVisualProviderSettlementLedger(
  plan: BroadcastTranscriptVisualInspectionPlan,
): BroadcastTranscriptVisualProviderSettlementLedger {
  assertBroadcastTranscriptVisualInspectionPlan(plan);
  return {
    schemaVersion:
      BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_LEDGER_SCHEMA_VERSION,
    planFingerprint: plan.planFingerprint,
    sourceFingerprint: plan.sourceFence.sourceFingerprint,
    transcriptInputSignature: plan.sourceFence.transcriptInputSignature,
    settlements: [],
  };
}

function assertProviderLedgerForPlan(
  ledger: BroadcastTranscriptVisualProviderSettlementLedger,
  plan: BroadcastTranscriptVisualInspectionPlan,
): void {
  if (
    ledger.schemaVersion !==
      BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_LEDGER_SCHEMA_VERSION ||
    ledger.planFingerprint !== plan.planFingerprint ||
    ledger.sourceFingerprint !== plan.sourceFence.sourceFingerprint ||
    ledger.transcriptInputSignature !==
      plan.sourceFence.transcriptInputSignature ||
    !Array.isArray(ledger.settlements) ||
    ledger.settlements.length > plan.cells.length
  ) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      "INVALID_PROVIDER_SETTLEMENT",
      "The visual provider ledger does not match its exact plan fence.",
    );
  }
  const cellIds = new Set<string>();
  const operationIds = new Set<string>();
  let previousCellOrdinal = -1;
  const ordinalByCellId = new Map(
    plan.cells.map((cell, ordinal) => [cell.cellId, ordinal]),
  );
  // Array.isArray() narrows readonly arrays to any[] in TypeScript's library
  // declaration. Restore the contract's element type after the runtime guard.
  const settlements =
    ledger.settlements as readonly BroadcastTranscriptVisualProviderSettlement[];
  for (const settlement of settlements) {
    assertProviderSettlementForPlan(settlement, plan);
    const ordinal = ordinalByCellId.get(settlement.cellId);
    if (
      ordinal === undefined ||
      ordinal < previousCellOrdinal ||
      cellIds.has(settlement.cellId) ||
      operationIds.has(settlement.operationId)
    ) {
      throw new BroadcastTranscriptVisualInspectionContractError(
        "DUPLICATE_SETTLEMENT",
        "The visual provider ledger must contain one canonical settlement per cell and operation.",
      );
    }
    cellIds.add(settlement.cellId);
    operationIds.add(settlement.operationId);
    previousCellOrdinal = ordinal;
  }
}

export function recordBroadcastTranscriptVisualProviderSettlement(
  ledger: BroadcastTranscriptVisualProviderSettlementLedger,
  plan: BroadcastTranscriptVisualInspectionPlan,
  settlement: BroadcastTranscriptVisualProviderSettlement,
  options: RecordBroadcastTranscriptVisualProviderSettlementOptions = {},
): BroadcastTranscriptVisualProviderSettlementLedger {
  assertBroadcastTranscriptVisualInspectionPlan(plan);
  assertProviderLedgerForPlan(ledger, plan);
  assertProviderSettlementForPlan(settlement, plan);
  const existing = ledger.settlements.find(
    ({ cellId }) => cellId === settlement.cellId,
  );
  if (
    existing !== undefined &&
    (existing.outcome === "completed" ||
      existing.outcome === "excluded-music-only")
  ) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      "STALE_SETTLEMENT",
      "A terminal visual provider settlement cannot be replaced.",
    );
  }
  if (
    existing?.outcome === "outcome-unknown" &&
    options.allowOutcomeUnknownReplacement !== true
  ) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      "OUTCOME_UNKNOWN_REQUIRES_CONFIRMATION",
      "Replacing outcome-unknown visual work requires explicit confirmation.",
    );
  }
  if (
    existing !== undefined &&
    settlement.attemptOrdinal <= existing.attemptOrdinal
  ) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      "STALE_SETTLEMENT",
      "A replacement visual provider settlement requires a newer attempt.",
    );
  }
  if (
    ledger.settlements.some(
      (current) =>
        current.cellId !== settlement.cellId &&
        current.operationId === settlement.operationId,
    )
  ) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      "DUPLICATE_SETTLEMENT",
      "A visual provider operation ID cannot settle two cells.",
    );
  }

  const ordinalByCellId = new Map(
    plan.cells.map((cell, ordinal) => [cell.cellId, ordinal]),
  );
  const next = {
    ...ledger,
    settlements: [
      ...ledger.settlements.filter(
        ({ cellId }) => cellId !== settlement.cellId,
      ),
      settlement,
    ].sort(
      (left, right) =>
        (ordinalByCellId.get(left.cellId) ?? Number.MAX_SAFE_INTEGER) -
        (ordinalByCellId.get(right.cellId) ?? Number.MAX_SAFE_INTEGER),
    ),
  };
  assertProviderLedgerForPlan(next, plan);
  return next;
}

export function serializeBroadcastTranscriptVisualProviderSettlementLedger(
  ledger: BroadcastTranscriptVisualProviderSettlementLedger,
  plan: BroadcastTranscriptVisualInspectionPlan,
): string {
  assertBroadcastTranscriptVisualInspectionPlan(plan);
  assertProviderLedgerForPlan(ledger, plan);
  const serialized = JSON.stringify(ledger);
  if (
    utf8ByteLength(serialized) >
    MAX_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_LEDGER_BYTES
  ) {
    throw new BroadcastTranscriptVisualInspectionContractError(
      "INVALID_PROVIDER_SETTLEMENT",
      "The visual provider settlement ledger exceeds its durable byte ceiling.",
    );
  }
  return serialized;
}

export function parseBroadcastTranscriptVisualProviderSettlementLedgerJson(
  serialized: string,
  plan: BroadcastTranscriptVisualInspectionPlan,
): BroadcastTranscriptVisualProviderSettlementLedger | null {
  if (
    typeof serialized !== "string" ||
    serialized.length === 0 ||
    utf8ByteLength(serialized) >
      MAX_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_LEDGER_BYTES
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (
      !isRecord(parsed) ||
      !hasExactKeys(parsed, [
        "schemaVersion",
        "planFingerprint",
        "sourceFingerprint",
        "transcriptInputSignature",
        "settlements",
      ])
    ) {
      return null;
    }
    const ledger =
      parsed as unknown as BroadcastTranscriptVisualProviderSettlementLedger;
    assertProviderLedgerForPlan(ledger, plan);
    return ledger;
  } catch {
    return null;
  }
}

export function inspectBroadcastTranscriptVisualInspectionPublication(input: {
  readonly plan: BroadcastTranscriptVisualInspectionPlan;
  readonly preparedFrameReceipts: readonly BroadcastTranscriptVisualPreparedFrameReceipt[];
  readonly providerLedger: BroadcastTranscriptVisualProviderSettlementLedger;
}): BroadcastTranscriptVisualInspectionPublicationStatus {
  assertBroadcastTranscriptVisualInspectionPlan(input.plan);
  assertProviderLedgerForPlan(input.providerLedger, input.plan);
  const preparedCellIds = new Set<string>();
  const preparedReceiptsByCellId = new Map<
    string,
    BroadcastTranscriptVisualPreparedFrameReceipt
  >();
  for (const receipt of input.preparedFrameReceipts) {
    if (preparedCellIds.has(receipt.cellId)) {
      throw new BroadcastTranscriptVisualInspectionContractError(
        "INVALID_FRAME_RECEIPT",
        "Publication inspection cannot use duplicate frame receipts.",
      );
    }
    assertPreparedFrameReceiptForPlan(receipt, input.plan);
    preparedCellIds.add(receipt.cellId);
    preparedReceiptsByCellId.set(receipt.cellId, receipt);
  }
  const settlementByCellId = new Map(
    input.providerLedger.settlements.map((settlement) => [
      settlement.cellId,
      settlement,
    ]),
  );
  const completedCellIds: string[] = [];
  const quietSuccessCellIds: string[] = [];
  const downstreamEligibleCellIds: string[] = [];
  const excludedMusicOnlyCellIds: string[] = [];
  const missingPreparedCellIds: string[] = [];
  const pendingProviderCellIds: string[] = [];
  const retryableCellIds: string[] = [];
  const outcomeUnknownCellIds: string[] = [];

  for (const cell of input.plan.cells) {
    if (!preparedCellIds.has(cell.cellId)) {
      missingPreparedCellIds.push(cell.cellId);
      continue;
    }
    const settlement = settlementByCellId.get(cell.cellId);
    if (settlement === undefined) {
      pendingProviderCellIds.push(cell.cellId);
      continue;
    }
    const preparedReceipt = preparedReceiptsByCellId.get(cell.cellId);
    if (
      preparedReceipt === undefined ||
      JSON.stringify(settlement.requestedFrameContentFingerprints) !==
        JSON.stringify(preparedReceipt.frameContentFingerprints) ||
      JSON.stringify(settlement.requestedAudioEvidence) !==
        JSON.stringify(preparedReceipt.audioEvidence)
    ) {
      throw new BroadcastTranscriptVisualInspectionContractError(
        "STALE_SETTLEMENT",
        "The visual provider settlement was produced from different prepared media evidence.",
      );
    }
    switch (settlement.outcome) {
      case "completed":
        completedCellIds.push(cell.cellId);
        if (settlement.editorialFinding === "quiet-success") {
          quietSuccessCellIds.push(cell.cellId);
          downstreamEligibleCellIds.push(cell.cellId);
        } else if (settlement.editorialFinding === "visual-event") {
          downstreamEligibleCellIds.push(cell.cellId);
        }
        break;
      case "excluded-music-only":
        excludedMusicOnlyCellIds.push(cell.cellId);
        break;
      case "retryable":
        retryableCellIds.push(cell.cellId);
        break;
      case "outcome-unknown":
        outcomeUnknownCellIds.push(cell.cellId);
        break;
    }
  }

  return {
    plannedCellCount: input.plan.cells.length,
    preparedCellCount: preparedCellIds.size,
    completedCellIds,
    quietSuccessCellIds,
    downstreamEligibleCellIds,
    excludedMusicOnlyCellIds,
    missingPreparedCellIds,
    pendingProviderCellIds,
    retryableCellIds,
    outcomeUnknownCellIds,
    publicationReady:
      missingPreparedCellIds.length === 0 &&
      pendingProviderCellIds.length === 0 &&
      retryableCellIds.length === 0 &&
      outcomeUnknownCellIds.length === 0 &&
      completedCellIds.length + excludedMusicOnlyCellIds.length ===
        input.plan.cells.length,
  };
}
