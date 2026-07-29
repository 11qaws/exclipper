import {
  createBroadcastContextRequest,
  MAX_BROADCAST_CONTEXT_CHAPTERS,
  MAX_BROADCAST_CONTEXT_SOURCE_DURATION_MS,
  type BroadcastContextChapterInput,
  type BroadcastContextRequestInput,
} from "../analysis/broadcastContextProtocol";
import { compactBroadcastContextChapters } from "../analysis/broadcastContextChapterCompaction";
import { isBroadcastParticipantGroundingForInput } from "../analysis/broadcastParticipantGrounding";
import {
  broadcastContextPhaseLedgerMatchesFence,
  parseBroadcastContextPhaseLedgerJson,
} from "../analysis/broadcastContextPhaseLedger";
import {
  CANDIDATE_PASS_B_CAST_ROSTER_VERSION,
  isCandidatePassBCastRosterId,
  type CandidatePassBCastRosterId,
} from "../analysis/participantRoster";
import {
  createContentFingerprint,
  type ContentDigestAdapter,
} from "../security/contentFingerprint";
import {
  MAX_BROADCAST_REFINEMENT_TRANSCRIPT_CHECKPOINT_BYTES,
  parseBroadcastRefinementTranscriptCheckpointJson,
} from "../analysis/broadcastRefinementTranscriptCheckpoint";
import {
  MAX_BROADCAST_REFINEMENT_EVIDENCE_LEDGER_BYTES,
  parseBroadcastRefinementEvidenceLedgerJson,
  projectBroadcastRefinementActiveEvidenceRoute,
  type BroadcastRefinementEvidenceLedger,
} from "../analysis/broadcastRefinementEvidenceLedger";
import {
  MAX_BROADCAST_TRANSCRIPT_RESOLVED_EVIDENCE_BYTES,
  broadcastTranscriptEvidencePlanCoversWholeSource,
  inspectBroadcastTranscriptEvidenceSettlement,
  parseBroadcastTranscriptResolvedEvidenceCheckpointJson,
} from "../analysis/broadcastTranscriptResolvedEvidence";
import {
  MAX_BROADCAST_TRANSCRIPT_PROVIDER_RECEIPT_CHECKPOINT_BYTES,
  broadcastTranscriptProviderReceiptCheckpointModelRevision,
  inspectBroadcastTranscriptProviderReceiptSettlement,
  parseBroadcastTranscriptProviderReceiptCheckpointJson,
} from "../analysis/broadcastTranscriptProviderReceiptCheckpoint";

export const BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION = "1.11.0" as const;
const LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_10 = "1.10.0" as const;
const LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_9 = "1.9.0" as const;
const LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_8 = "1.8.0" as const;
const LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_7 = "1.7.0" as const;
const LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_6 = "1.6.0" as const;
const LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_5 = "1.5.0" as const;
const LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_4 = "1.4.0" as const;
const LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_3 = "1.3.0" as const;
const LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_2 = "1.2.0" as const;
const MAX_STORED_BROADCAST_CONTEXT_CHAPTERS = 4_096;
const MAX_PARTICIPANT_GROUNDING_CHECKPOINT_BYTES = 64 * 1024;
/** Matches the Worker's bounded whole-context ingress ceiling. */
const MAX_CONTEXT_INPUT_CHECKPOINT_BYTES = 8 * 1024 * 1024;
export const MAX_CONTEXT_PHASE_LEDGER_CHECKPOINT_BYTES = 4 * 1024 * 1024;
const MAX_CONTEXT_RESULT_CHECKPOINT_BYTES = 256 * 1024;
const MAX_REFINEMENT_CANDIDATES_CHECKPOINT_BYTES = 256 * 1024;

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
  readonly transcriptEvidenceInputSignature: string | null;
  readonly transcriptEvidenceCheckpointJson: string | null;
  readonly transcriptProviderReceiptInputSignature: string | null;
  readonly transcriptProviderReceiptCheckpointJson: string | null;
  readonly modelRevision: string;
  readonly sourceCastRosterId: CandidatePassBCastRosterId | null;
  readonly transcriptSealOperationKey: string | null;
  readonly participantGroundingInputSignature: string | null;
  readonly participantGroundingPlanFingerprint: string | null;
  readonly participantGroundingCheckpointJson: string | null;
  readonly contextInputSignature: string | null;
  readonly contextInputCheckpointJson: string | null;
  readonly contextPhaseLedgerJson: string | null;
  readonly contextResultJson: string | null;
  readonly refinementTranscriptInputSignature: string | null;
  readonly refinementTranscriptCheckpointJson: string | null;
  readonly refinementEvidenceLedgerJson: string | null;
  readonly refinementInputSignature: string | null;
  readonly refinementCandidatesJson: string | null;
  readonly recordedAt: string;
}

/**
 * Transitional initial-write shape for callers created before schema 1.11.
 * Durable readbacks are always normalized to BroadcastContextSessionRecord.
 */
export type BroadcastContextSessionInitialWriteRecord =
  | BroadcastContextSessionRecord
  | (Omit<BroadcastContextSessionRecord, "refinementEvidenceLedgerJson"> & {
      readonly refinementEvidenceLedgerJson?: null;
    });

export interface BroadcastContextSessionContextCommit {
  readonly contextInputSignature: string;
  readonly contextInputCheckpointJson: string;
  readonly contextResultJson: string;
  /**
   * Omit to preserve a ledger only when the exact context input is unchanged.
   * Pass `null` to clear it or a validated replacement to commit it atomically.
   */
  readonly contextPhaseLedgerJson?: string | null;
  readonly recordedAt: string;
}

export interface BroadcastContextSessionPhaseLedgerCheckpoint {
  readonly contextInputSignature: string;
  readonly contextInputCheckpointJson: string;
  readonly contextPhaseLedgerJson: string;
  readonly recordedAt: string;
}

export interface BroadcastContextSessionRefinementTranscriptCheckpoint {
  readonly refinementTranscriptInputSignature: string;
  readonly refinementTranscriptCheckpointJson: string;
  readonly recordedAt: string;
}

export interface BroadcastContextSessionRefinementEvidenceLedgerCheckpoint {
  readonly refinementEvidenceLedgerJson: string | null;
  readonly recordedAt: string;
}

export interface BroadcastContextSessionTranscriptCheckpoint {
  readonly completeAudioCoverage: boolean;
  readonly chapters: readonly BroadcastContextChapterInput[];
  readonly gapChunkIds: readonly string[];
  readonly fragmentGaps: readonly StoredBroadcastTranscriptGap[];
  readonly transcriptEvidenceInputSignature: string | null;
  readonly transcriptEvidenceCheckpointJson: string | null;
  readonly transcriptProviderReceiptInputSignature: string | null;
  readonly transcriptProviderReceiptCheckpointJson: string | null;
  readonly modelRevision: string;
  readonly transcriptSealOperationKey: string | null;
  readonly recordedAt: string;
}

export interface BroadcastParticipantGroundingSignatureInput {
  readonly inputSignature: string;
  readonly transcriptSealOperationKey: string;
  readonly participantGroundingPlanFingerprint: string;
  readonly participantGroundingCheckpointJson: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
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

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Creates the durable participant-grounding fence used by both the initial
 * save and a later reload. The plan fingerprint is intentionally part of the
 * fence: identical grounding JSON derived from a different sampling plan is
 * not the same evidence.
 */
export async function createBroadcastParticipantGroundingInputSignature(
  input: BroadcastParticipantGroundingSignatureInput,
  digestAdapter: ContentDigestAdapter | null = globalThis.crypto?.subtle ?? null,
): Promise<string> {
  if (
    !boundedString(input.inputSignature, 2_048) ||
    !boundedString(input.transcriptSealOperationKey, 2_048) ||
    !boundedString(input.participantGroundingPlanFingerprint, 2_048) ||
    typeof input.participantGroundingCheckpointJson !== "string" ||
    input.participantGroundingCheckpointJson.length === 0 ||
    utf8ByteLength(input.participantGroundingCheckpointJson) >
      MAX_PARTICIPANT_GROUNDING_CHECKPOINT_BYTES
  ) {
    throw new TypeError(
      "Broadcast participant grounding signature input is invalid.",
    );
  }
  return createContentFingerprint(
    [
      input.inputSignature,
      input.transcriptSealOperationKey,
      `cast-catalog:${CANDIDATE_PASS_B_CAST_ROSTER_VERSION}`,
      `participant-plan:${input.participantGroundingPlanFingerprint}`,
      input.participantGroundingCheckpointJson,
    ],
    digestAdapter,
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
      "transcriptEvidenceInputSignature",
      "transcriptEvidenceCheckpointJson",
      "transcriptProviderReceiptInputSignature",
      "transcriptProviderReceiptCheckpointJson",
      "modelRevision",
      "sourceCastRosterId",
      "transcriptSealOperationKey",
      "participantGroundingInputSignature",
      "participantGroundingPlanFingerprint",
      "participantGroundingCheckpointJson",
      "contextInputSignature",
      "contextInputCheckpointJson",
      "contextPhaseLedgerJson",
      "contextResultJson",
      "refinementTranscriptInputSignature",
      "refinementTranscriptCheckpointJson",
      "refinementEvidenceLedgerJson",
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
    !(
      (value.transcriptEvidenceInputSignature === null &&
        value.transcriptEvidenceCheckpointJson === null) ||
      (boundedString(value.transcriptEvidenceInputSignature, 2_048) &&
        typeof value.transcriptEvidenceCheckpointJson === "string" &&
        value.transcriptEvidenceCheckpointJson.length > 0 &&
        utf8ByteLength(value.transcriptEvidenceCheckpointJson) <=
          MAX_BROADCAST_TRANSCRIPT_RESOLVED_EVIDENCE_BYTES)
    ) ||
    !(
      (value.transcriptProviderReceiptInputSignature === null &&
        value.transcriptProviderReceiptCheckpointJson === null) ||
      (boundedString(
        value.transcriptProviderReceiptInputSignature,
        2_048,
      ) &&
        typeof value.transcriptProviderReceiptCheckpointJson === "string" &&
        value.transcriptProviderReceiptCheckpointJson.length > 0 &&
        utf8ByteLength(value.transcriptProviderReceiptCheckpointJson) <=
          MAX_BROADCAST_TRANSCRIPT_PROVIDER_RECEIPT_CHECKPOINT_BYTES)
    ) ||
    !boundedString(value.modelRevision) ||
    !(
      value.sourceCastRosterId === null ||
      isCandidatePassBCastRosterId(value.sourceCastRosterId)
    ) ||
    !(
      value.transcriptSealOperationKey === null ||
      boundedString(value.transcriptSealOperationKey, 2_048)
    ) ||
    !(
      (value.participantGroundingInputSignature === null &&
        value.participantGroundingCheckpointJson === null) ||
      (boundedString(value.participantGroundingInputSignature) &&
        typeof value.participantGroundingCheckpointJson === "string" &&
        value.participantGroundingCheckpointJson.length > 0 &&
        utf8ByteLength(value.participantGroundingCheckpointJson) <=
          MAX_PARTICIPANT_GROUNDING_CHECKPOINT_BYTES)
    ) ||
    !(
      value.participantGroundingPlanFingerprint === null ||
      boundedString(value.participantGroundingPlanFingerprint, 2_048)
    ) ||
    !(
      (value.contextInputSignature === null &&
        value.contextInputCheckpointJson === null &&
        value.contextPhaseLedgerJson === null &&
        value.contextResultJson === null) ||
      (boundedString(value.contextInputSignature) &&
        (value.contextInputCheckpointJson === null ||
          (typeof value.contextInputCheckpointJson === "string" &&
            value.contextInputCheckpointJson.length > 0 &&
            utf8ByteLength(value.contextInputCheckpointJson) <=
              MAX_CONTEXT_INPUT_CHECKPOINT_BYTES)) &&
        (value.contextPhaseLedgerJson === null ||
          (typeof value.contextPhaseLedgerJson === "string" &&
            value.contextPhaseLedgerJson.length > 0 &&
            utf8ByteLength(value.contextPhaseLedgerJson) <=
              MAX_CONTEXT_PHASE_LEDGER_CHECKPOINT_BYTES)) &&
        ((typeof value.contextResultJson === "string" &&
          value.contextResultJson.length > 0 &&
          utf8ByteLength(value.contextResultJson) <=
            MAX_CONTEXT_RESULT_CHECKPOINT_BYTES) ||
          (value.contextResultJson === null &&
            typeof value.contextInputCheckpointJson === "string" &&
            typeof value.contextPhaseLedgerJson === "string")))
    ) ||
    !(
      (value.refinementTranscriptInputSignature === null &&
        value.refinementTranscriptCheckpointJson === null) ||
      (boundedString(value.refinementTranscriptInputSignature) &&
        typeof value.refinementTranscriptCheckpointJson === "string" &&
        value.refinementTranscriptCheckpointJson.length > 0 &&
        utf8ByteLength(value.refinementTranscriptCheckpointJson) <=
           MAX_BROADCAST_REFINEMENT_TRANSCRIPT_CHECKPOINT_BYTES)
    ) ||
    !(
      value.refinementEvidenceLedgerJson === null ||
      (typeof value.refinementEvidenceLedgerJson === "string" &&
        value.refinementEvidenceLedgerJson.length > 0 &&
        utf8ByteLength(value.refinementEvidenceLedgerJson) <=
          MAX_BROADCAST_REFINEMENT_EVIDENCE_LEDGER_BYTES)
    ) ||
    !(
      (value.refinementInputSignature === null &&
        value.refinementCandidatesJson === null) ||
      (boundedString(value.refinementInputSignature) &&
        typeof value.refinementCandidatesJson === "string" &&
        value.refinementCandidatesJson.length > 0 &&
        utf8ByteLength(value.refinementCandidatesJson) <=
          MAX_REFINEMENT_CANDIDATES_CHECKPOINT_BYTES)
    ) ||
    typeof value.recordedAt !== "string" ||
    !Number.isFinite(Date.parse(value.recordedAt))
  ) {
    throw new TypeError("Broadcast context session record is invalid.");
  }
  if (
    value.participantGroundingCheckpointJson !== null &&
    value.transcriptSealOperationKey === null
  ) {
    throw new TypeError(
      "Broadcast participant grounding requires a sealed transcript operation.",
    );
  }
  if (
    value.participantGroundingPlanFingerprint !== null &&
    (value.participantGroundingInputSignature === null ||
      value.participantGroundingCheckpointJson === null)
  ) {
    throw new TypeError(
      "Broadcast participant grounding plan requires a complete grounding checkpoint.",
    );
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
      throw new TypeError(
        "Stored broadcast transcript fragment gap is invalid.",
      );
    }
    fragmentGapIds.add(gap.chunkId);
    previousGapEndMs = gap.sourceEndMs as number;
  }
  const transcriptEvidenceCheckpoint =
    value.transcriptEvidenceCheckpointJson === null
      ? null
      : parseBroadcastTranscriptResolvedEvidenceCheckpointJson(
          value.transcriptEvidenceCheckpointJson,
        );
  if (
    value.transcriptEvidenceCheckpointJson !== null &&
    (transcriptEvidenceCheckpoint === null ||
      transcriptEvidenceCheckpoint.transcriptInputSignature !==
        value.transcriptEvidenceInputSignature ||
      transcriptEvidenceCheckpoint.sourceFingerprint !== value.inputSignature ||
      transcriptEvidenceCheckpoint.sourceDurationMs !==
        value.sourceDurationMs ||
      transcriptEvidenceCheckpoint.modelRevision !== value.modelRevision ||
      (value.transcriptSealOperationKey !== null &&
        value.transcriptSealOperationKey !==
          value.transcriptEvidenceInputSignature) ||
      fragmentGapIds.size !== gapChunkIds.size)
  ) {
    throw new TypeError(
      "Broadcast transcript resolved evidence does not match its durable source, plan, model, or gap fence.",
    );
  }
  const transcriptProviderReceiptCheckpoint =
    value.transcriptProviderReceiptCheckpointJson === null
      ? null
      : parseBroadcastTranscriptProviderReceiptCheckpointJson(
          value.transcriptProviderReceiptCheckpointJson,
        );
  if (
    value.transcriptProviderReceiptCheckpointJson !== null &&
    (transcriptProviderReceiptCheckpoint === null ||
      transcriptProviderReceiptCheckpoint.sourceFingerprint !==
        value.inputSignature ||
      transcriptProviderReceiptCheckpoint.sourceDurationMs !==
        value.sourceDurationMs ||
      transcriptProviderReceiptCheckpoint.routeManifestFingerprint !==
        value.transcriptProviderReceiptInputSignature ||
      broadcastTranscriptProviderReceiptCheckpointModelRevision(
        transcriptProviderReceiptCheckpoint,
      ) !== value.modelRevision ||
      transcriptEvidenceCheckpoint === null ||
      JSON.stringify(transcriptProviderReceiptCheckpoint.plannedCells) !==
        JSON.stringify(transcriptEvidenceCheckpoint.plannedCells))
  ) {
    throw new TypeError(
      "Broadcast transcript provider receipts do not match their durable source, route, plan, or model fence.",
    );
  }
  if (typeof value.contextResultJson === "string") {
    try {
      const parsed: unknown = JSON.parse(value.contextResultJson);
      if (!isRecord(parsed))
        throw new TypeError("Context result JSON must be an object.");
    } catch {
      throw new TypeError("Broadcast context result JSON is invalid.");
    }
  }
  if (typeof value.participantGroundingCheckpointJson === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value.participantGroundingCheckpointJson);
    } catch {
      throw new TypeError("Broadcast participant grounding JSON is invalid.");
    }
    const parsedRosterId =
      isRecord(parsed) && "castRosterId" in parsed
        ? parsed.castRosterId
        : undefined;
    if (
      parsedRosterId !== null &&
      !isCandidatePassBCastRosterId(parsedRosterId)
    ) {
      throw new TypeError("Broadcast participant roster is invalid.");
    }
    if (parsedRosterId !== value.sourceCastRosterId) {
      throw new TypeError(
        "Broadcast participant roster does not match the stored source roster.",
      );
    }
    if (
      !isBroadcastParticipantGroundingForInput(parsed, {
        sourceDurationMs: value.sourceDurationMs as number,
        castRosterId: parsedRosterId,
        chapters: compactBroadcastContextChapters(
          value.chapters as readonly BroadcastContextChapterInput[],
        ),
      })
    ) {
      throw new TypeError(
        "Broadcast participant grounding does not match the stored transcript map.",
      );
    }
  }
  if (typeof value.contextInputCheckpointJson === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value.contextInputCheckpointJson);
    } catch {
      throw new TypeError(
        "Broadcast context input checkpoint JSON is invalid.",
      );
    }
    if (!isRecord(parsed)) {
      throw new TypeError(
        "Broadcast context input checkpoint must be an object.",
      );
    }
    let canonical;
    try {
      canonical = createBroadcastContextRequest(
        parsed as unknown as BroadcastContextRequestInput,
      );
    } catch {
      throw new TypeError("Broadcast context input checkpoint is invalid.");
    }
    if (
      canonical.sourceDurationMs !== value.sourceDurationMs ||
      canonical.castRosterId !== value.sourceCastRosterId ||
      JSON.stringify(canonical.chapters) !==
        JSON.stringify(
          compactBroadcastContextChapters(
            value.chapters as readonly BroadcastContextChapterInput[],
          ),
        ) ||
      value.participantGroundingCheckpointJson === null ||
      JSON.stringify(canonical.participantGrounding) !==
        value.participantGroundingCheckpointJson
    ) {
      throw new TypeError(
        "Broadcast context input checkpoint does not match its durable source map.",
      );
    }
  }
  if (typeof value.contextPhaseLedgerJson === "string") {
    if (
      value.contextInputSignature === null ||
      value.contextInputCheckpointJson === null ||
      value.transcriptSealOperationKey === null ||
      value.participantGroundingInputSignature === null
    ) {
      throw new TypeError(
        "Broadcast context phase ledger requires exact context, transcript, and grounding fences.",
      );
    }
    const ledger = parseBroadcastContextPhaseLedgerJson(
      value.contextPhaseLedgerJson,
    );
    if (
      ledger === null ||
      !broadcastContextPhaseLedgerMatchesFence(ledger, {
        parentContextSignature: value.contextInputSignature,
        transcriptSignature: value.transcriptSealOperationKey,
        groundingSignature: value.participantGroundingInputSignature,
      })
    ) {
      throw new TypeError(
        "Broadcast context phase ledger does not match its durable input fences.",
      );
    }
  }
  if (typeof value.refinementTranscriptCheckpointJson === "string") {
    if (
      value.contextInputSignature === null ||
      value.contextInputCheckpointJson === null ||
      value.contextResultJson === null ||
      value.refinementTranscriptInputSignature === null
    ) {
      throw new TypeError(
        "Broadcast refinement transcript checkpoint requires a committed parent context.",
      );
    }
    const checkpoint = parseBroadcastRefinementTranscriptCheckpointJson(
      value.refinementTranscriptCheckpointJson,
    );
    if (
      checkpoint === null ||
      checkpoint.refinementInputSignature !==
        value.refinementTranscriptInputSignature
    ) {
      throw new TypeError(
        "Broadcast refinement transcript checkpoint does not match its durable input fence.",
      );
    }
  }
  if (
    value.refinementEvidenceLedgerJson !== null &&
    (value.transcriptSealOperationKey === null ||
      value.participantGroundingInputSignature === null ||
      value.participantGroundingPlanFingerprint === null ||
      value.participantGroundingCheckpointJson === null ||
      value.contextInputSignature === null ||
      value.contextInputCheckpointJson === null ||
      value.contextResultJson === null)
  ) {
    throw new TypeError(
      "Broadcast refinement evidence ledger requires exact transcript, participant, and committed context parents.",
    );
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
  if (transcriptEvidenceCheckpoint !== null) {
    const settlement = (() => {
      try {
        return inspectBroadcastTranscriptEvidenceSettlement({
          checkpoint: transcriptEvidenceCheckpoint,
          chapterRanges: chapters.map(({ startMs, endMs }) => ({
            startMs,
            endMs,
          })),
          gapRanges: (
            value.fragmentGaps as readonly StoredBroadcastTranscriptGap[]
          ).map(({ chunkId, sourceStartMs, sourceEndMs }) => ({
            chunkId,
            sourceStartMs,
            sourceEndMs,
          })),
        });
      } catch {
        throw new TypeError(
          "Broadcast transcript chapters, resolved evidence, and gaps do not exactly partition the stored plan.",
        );
      }
    })();
    if (
      (value.completeAudioCoverage &&
        (!settlement.isPlanSettled ||
          !broadcastTranscriptEvidencePlanCoversWholeSource(
            transcriptEvidenceCheckpoint,
          ))) ||
      (value.transcriptSealOperationKey !== null &&
        !settlement.isPlanSettled) ||
      (chapters.length === 0 &&
        value.gapChunkIds.length === 0 &&
        !settlement.isDialogueEmptyButResolved)
    ) {
      throw new TypeError(
        "Broadcast transcript completion does not match its exact evidence settlement.",
      );
    }
    if (transcriptProviderReceiptCheckpoint !== null) {
      const receiptSettlement = (() => {
        try {
          return inspectBroadcastTranscriptProviderReceiptSettlement({
            checkpoint: transcriptProviderReceiptCheckpoint,
            chapterRanges: chapters.map(({ startMs, endMs }) => ({
              startMs,
              endMs,
            })),
            resolvedChunkIds:
              transcriptEvidenceCheckpoint.resolvedEvidence.map(
                ({ chunkId }) => chunkId,
              ),
            gapChunkIds: value.gapChunkIds,
          });
        } catch {
          throw new TypeError(
            "Broadcast transcript chapters, provider receipts, resolved evidence, and gaps do not exactly partition the stored plan.",
          );
        }
      })();
      if (
        (value.transcriptSealOperationKey !== null &&
          !receiptSettlement.isPlanSettled) ||
        receiptSettlement.checkpointModelRevision !== value.modelRevision
      ) {
        throw new TypeError(
          "Broadcast transcript provider receipt settlement does not match its completion or model fence.",
        );
      }
    }
  } else if (chapters.length === 0) {
    if (
      value.completeAudioCoverage ||
      value.gapChunkIds.length === 0 ||
      value.transcriptSealOperationKey !== null
    ) {
      throw new TypeError(
        "An empty legacy broadcast transcript map must preserve its evidence gaps.",
      );
    }
    return;
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

function migrateLegacyBroadcastContextSessionRecord(value: unknown): unknown {
  let migrated = value;
  if (
    isRecord(migrated) &&
    migrated.schemaVersion ===
      LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_2 &&
    !Object.hasOwn(migrated, "fragmentGaps")
  ) {
    migrated = {
      ...migrated,
      schemaVersion: LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_3,
      fragmentGaps: [],
    };
  }
  if (
    isRecord(migrated) &&
    migrated.schemaVersion ===
      LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_3 &&
    !Object.hasOwn(migrated, "participantGroundingInputSignature") &&
    !Object.hasOwn(migrated, "participantGroundingCheckpointJson")
  ) {
    migrated = {
      ...migrated,
      schemaVersion: LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_4,
      participantGroundingInputSignature: null,
      participantGroundingCheckpointJson: null,
    };
  }
  if (
    isRecord(migrated) &&
    migrated.schemaVersion ===
      LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_4 &&
    !Object.hasOwn(migrated, "sourceCastRosterId") &&
    !Object.hasOwn(migrated, "transcriptSealOperationKey") &&
    !Object.hasOwn(migrated, "contextInputCheckpointJson")
  ) {
    migrated = {
      ...migrated,
      schemaVersion: LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_5,
      sourceCastRosterId: null,
      transcriptSealOperationKey: null,
      contextInputCheckpointJson: null,
    };
  }
  if (
    isRecord(migrated) &&
    migrated.schemaVersion ===
      LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_5 &&
    !Object.hasOwn(migrated, "contextPhaseLedgerJson")
  ) {
    migrated = {
      ...migrated,
      schemaVersion: LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_6,
      contextPhaseLedgerJson: null,
    };
  }
  if (
    isRecord(migrated) &&
    migrated.schemaVersion ===
      LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_6 &&
    !Object.hasOwn(migrated, "refinementTranscriptInputSignature") &&
    !Object.hasOwn(migrated, "refinementTranscriptCheckpointJson")
  ) {
    migrated = {
      ...migrated,
      schemaVersion: LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_7,
      refinementTranscriptInputSignature: null,
      refinementTranscriptCheckpointJson: null,
    };
  }
  if (
    isRecord(migrated) &&
    migrated.schemaVersion ===
      LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_7 &&
    !Object.hasOwn(migrated, "transcriptEvidenceInputSignature") &&
    !Object.hasOwn(migrated, "transcriptEvidenceCheckpointJson")
  ) {
    migrated = {
      ...migrated,
      schemaVersion: LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_8,
      transcriptEvidenceInputSignature: null,
      transcriptEvidenceCheckpointJson: null,
    };
  }
  if (
    isRecord(migrated) &&
    migrated.schemaVersion ===
      LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_8
  ) {
    const hasReceiptInput = Object.hasOwn(
      migrated,
      "transcriptProviderReceiptInputSignature",
    );
    const hasReceiptCheckpoint = Object.hasOwn(
      migrated,
      "transcriptProviderReceiptCheckpointJson",
    );
    if (hasReceiptInput !== hasReceiptCheckpoint) return migrated;
    migrated = {
      ...migrated,
      schemaVersion: LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_9,
      ...(hasReceiptInput
        ? {}
        : {
            transcriptProviderReceiptInputSignature: null,
            transcriptProviderReceiptCheckpointJson: null,
          }),
    };
  }
  if (
    isRecord(migrated) &&
    migrated.schemaVersion ===
      LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_9
  ) {
    migrated = {
      ...migrated,
      schemaVersion: LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_10,
      ...(Object.hasOwn(migrated, "participantGroundingPlanFingerprint")
        ? {}
        : { participantGroundingPlanFingerprint: null }),
    };
  }
  if (
    isRecord(migrated) &&
    migrated.schemaVersion ===
      LEGACY_BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION_1_10
  ) {
    migrated = {
      ...migrated,
      schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
      ...(Object.hasOwn(migrated, "refinementEvidenceLedgerJson")
        ? {}
        : { refinementEvidenceLedgerJson: null }),
    };
  }
  if (
    isRecord(migrated) &&
    migrated.schemaVersion === BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION &&
    typeof migrated.transcriptEvidenceCheckpointJson === "string"
  ) {
    let legacyEvidence: unknown = null;
    try {
      legacyEvidence = JSON.parse(
        migrated.transcriptEvidenceCheckpointJson,
      );
    } catch {
      // Malformed current checkpoints remain invalid and fail normal parsing.
    }
    if (
      isRecord(legacyEvidence) &&
      legacyEvidence.schemaVersion === "1.0.0"
    ) {
      /*
       * Schema 1.0 reduced no-speech to a reason/range pair and cannot prove
       * which VAD model, policy, or source coverage authorized the exclusion.
       * Preserve paid chapters/provider receipts, but reopen every semantic
       * descendant and the transcript seal until current evidence is rebuilt.
       */
      migrated = {
        ...migrated,
        transcriptEvidenceInputSignature: null,
        transcriptEvidenceCheckpointJson: null,
        transcriptSealOperationKey: null,
        participantGroundingInputSignature: null,
        participantGroundingPlanFingerprint: null,
        participantGroundingCheckpointJson: null,
        contextInputSignature: null,
        contextInputCheckpointJson: null,
        contextPhaseLedgerJson: null,
        contextResultJson: null,
        refinementTranscriptInputSignature: null,
        refinementTranscriptCheckpointJson: null,
        refinementEvidenceLedgerJson: null,
        refinementInputSignature: null,
        refinementCandidatesJson: null,
      };
    }
  }
  return migrated;
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

export function cloneBroadcastContextSessionInitialWriteRecord(
  value: BroadcastContextSessionInitialWriteRecord,
): BroadcastContextSessionRecord {
  return cloneBroadcastContextSessionRecord(
    Object.hasOwn(value, "refinementEvidenceLedgerJson")
      ? value
      : { ...value, refinementEvidenceLedgerJson: null },
  );
}

/**
 * Parses the durable refinement ledger through its canonical SHA-256 contract
 * and verifies that it belongs to this exact source and committed parent
 * context. Structural session parsing stays synchronous; callers must use this
 * async gate before consuming or checkpointing ledger evidence.
 */
export async function parseBroadcastContextSessionRefinementEvidenceLedger(
  value: BroadcastContextSessionRecord,
  digestAdapter: ContentDigestAdapter | null = globalThis.crypto?.subtle ?? null,
): Promise<BroadcastRefinementEvidenceLedger | null> {
  const current = cloneBroadcastContextSessionRecord(value);
  if (current.refinementEvidenceLedgerJson === null) return null;
  const ledger = await parseBroadcastRefinementEvidenceLedgerJson(
    current.refinementEvidenceLedgerJson,
    digestAdapter,
  );
  if (
    ledger === null ||
    ledger.sourceFingerprint !== current.inputSignature ||
    ledger.sourceDurationMs !== current.sourceDurationMs ||
    current.transcriptSealOperationKey === null ||
    current.participantGroundingInputSignature === null ||
    current.participantGroundingPlanFingerprint === null ||
    current.participantGroundingCheckpointJson === null ||
    current.contextInputSignature === null ||
    current.contextInputCheckpointJson === null ||
    current.contextResultJson === null
  ) {
    throw new TypeError(
      "Broadcast refinement evidence ledger is non-canonical or does not match its durable source and parent context.",
    );
  }
  return ledger;
}

function transcriptCheckpointComparableJson(
  value: Pick<
    BroadcastContextSessionRecord,
    | "completeAudioCoverage"
    | "chapters"
    | "gapChunkIds"
    | "fragmentGaps"
    | "transcriptEvidenceInputSignature"
    | "transcriptEvidenceCheckpointJson"
    | "transcriptProviderReceiptInputSignature"
    | "transcriptProviderReceiptCheckpointJson"
    | "modelRevision"
    | "transcriptSealOperationKey"
  >,
): string {
  return JSON.stringify({
    completeAudioCoverage: value.completeAudioCoverage,
    chapters: value.chapters,
    gapChunkIds: value.gapChunkIds,
    fragmentGaps: value.fragmentGaps,
    transcriptEvidenceInputSignature:
      value.transcriptEvidenceInputSignature,
    transcriptEvidenceCheckpointJson:
      value.transcriptEvidenceCheckpointJson,
    transcriptProviderReceiptInputSignature:
      value.transcriptProviderReceiptInputSignature,
    transcriptProviderReceiptCheckpointJson:
      value.transcriptProviderReceiptCheckpointJson,
    modelRevision: value.modelRevision,
    transcriptSealOperationKey: value.transcriptSealOperationKey,
  });
}

/**
 * Replaces the transcript map, explicit gaps, and resolved abstention evidence
 * as one validated snapshot. Any changed transcript evidence invalidates every
 * participant/context/refinement child in the same replacement.
 */
export function checkpointBroadcastContextSessionTranscript(
  value: BroadcastContextSessionRecord,
  checkpoint: BroadcastContextSessionTranscriptCheckpoint,
): BroadcastContextSessionRecord {
  const current = cloneBroadcastContextSessionRecord(value);
  const nextTranscriptState = {
    completeAudioCoverage: checkpoint.completeAudioCoverage,
    chapters: checkpoint.chapters,
    gapChunkIds: checkpoint.gapChunkIds,
    fragmentGaps: checkpoint.fragmentGaps,
    transcriptEvidenceInputSignature:
      checkpoint.transcriptEvidenceInputSignature,
    transcriptEvidenceCheckpointJson:
      checkpoint.transcriptEvidenceCheckpointJson,
    transcriptProviderReceiptInputSignature:
      checkpoint.transcriptProviderReceiptInputSignature,
    transcriptProviderReceiptCheckpointJson:
      checkpoint.transcriptProviderReceiptCheckpointJson,
    modelRevision: checkpoint.modelRevision,
    transcriptSealOperationKey: checkpoint.transcriptSealOperationKey,
  };
  const exactTranscriptStateUnchanged =
    transcriptCheckpointComparableJson(current) ===
    transcriptCheckpointComparableJson(nextTranscriptState);
  return cloneBroadcastContextSessionRecord({
    ...current,
    ...nextTranscriptState,
    participantGroundingInputSignature: exactTranscriptStateUnchanged
      ? current.participantGroundingInputSignature
      : null,
    participantGroundingPlanFingerprint: exactTranscriptStateUnchanged
      ? current.participantGroundingPlanFingerprint
      : null,
    participantGroundingCheckpointJson: exactTranscriptStateUnchanged
      ? current.participantGroundingCheckpointJson
      : null,
    contextInputSignature: exactTranscriptStateUnchanged
      ? current.contextInputSignature
      : null,
    contextInputCheckpointJson: exactTranscriptStateUnchanged
      ? current.contextInputCheckpointJson
      : null,
    contextPhaseLedgerJson: exactTranscriptStateUnchanged
      ? current.contextPhaseLedgerJson
      : null,
    contextResultJson: exactTranscriptStateUnchanged
      ? current.contextResultJson
      : null,
    refinementTranscriptInputSignature: exactTranscriptStateUnchanged
      ? current.refinementTranscriptInputSignature
      : null,
    refinementTranscriptCheckpointJson: exactTranscriptStateUnchanged
      ? current.refinementTranscriptCheckpointJson
      : null,
    refinementEvidenceLedgerJson: exactTranscriptStateUnchanged
      ? current.refinementEvidenceLedgerJson
      : null,
    refinementInputSignature: exactTranscriptStateUnchanged
      ? current.refinementInputSignature
      : null,
    refinementCandidatesJson: exactTranscriptStateUnchanged
      ? current.refinementCandidatesJson
      : null,
    recordedAt: checkpoint.recordedAt,
  });
}

/**
 * Builds the only valid retry snapshot for a completed whole-context phase.
 *
 * Participant grounding and the sealed transcript remain reusable, while the
 * exact context triple and every child refinement are invalidated together.
 */
export function invalidateBroadcastContextSessionContext(
  value: BroadcastContextSessionRecord,
  recordedAt: string,
): BroadcastContextSessionRecord {
  const current = cloneBroadcastContextSessionRecord(value);
  return cloneBroadcastContextSessionRecord({
    ...current,
    contextInputSignature: null,
    contextInputCheckpointJson: null,
    contextPhaseLedgerJson: null,
    contextResultJson: null,
    refinementTranscriptInputSignature: null,
    refinementTranscriptCheckpointJson: null,
    refinementEvidenceLedgerJson: null,
    refinementInputSignature: null,
    refinementCandidatesJson: null,
    recordedAt,
  });
}

function assertCurrentParticipantGroundingFence(
  value: BroadcastContextSessionRecord,
): void {
  if (
    value.transcriptSealOperationKey === null ||
    value.participantGroundingInputSignature === null ||
    value.participantGroundingPlanFingerprint === null ||
    value.participantGroundingCheckpointJson === null
  ) {
    throw new TypeError(
      "Broadcast context mutation requires an exact transcript, grounding plan, and grounding checkpoint fence.",
    );
  }
}

/**
 * Builds an exact-input-bound context result and invalidates refinements made
 * from the previous parent context in the same replacement snapshot.
 */
export function commitBroadcastContextSessionContext(
  value: BroadcastContextSessionRecord,
  commit: BroadcastContextSessionContextCommit,
): BroadcastContextSessionRecord {
  const current = cloneBroadcastContextSessionRecord(value);
  assertCurrentParticipantGroundingFence(current);
  const exactContextInputUnchanged =
    current.contextInputSignature === commit.contextInputSignature &&
    current.contextInputCheckpointJson === commit.contextInputCheckpointJson;
  const exactContextParentUnchanged =
    exactContextInputUnchanged &&
    current.contextResultJson === commit.contextResultJson;
  return cloneBroadcastContextSessionRecord({
    ...current,
    contextInputSignature: commit.contextInputSignature,
    contextInputCheckpointJson: commit.contextInputCheckpointJson,
    contextPhaseLedgerJson:
      commit.contextPhaseLedgerJson === undefined
        ? exactContextInputUnchanged
          ? current.contextPhaseLedgerJson
          : null
        : commit.contextPhaseLedgerJson,
    contextResultJson: commit.contextResultJson,
    refinementTranscriptInputSignature: null,
    refinementTranscriptCheckpointJson: null,
    refinementEvidenceLedgerJson: exactContextParentUnchanged
      ? current.refinementEvidenceLedgerJson
      : null,
    refinementInputSignature: null,
    refinementCandidatesJson: null,
    recordedAt: commit.recordedAt,
  });
}

function refinementPhaseLedgerSliceJson(
  ledgerJson: string | null,
): string | null {
  if (ledgerJson === null) return null;
  const ledger = parseBroadcastContextPhaseLedgerJson(ledgerJson);
  if (ledger === null) return null;
  return JSON.stringify(
    ledger.units.filter(({ phase }) => phase === "refinement"),
  );
}

/**
 * Atomically binds an in-progress phase ledger to the exact durable context
 * input. Replacing the input clears results and refinements derived from the
 * previous input; advancing the same input preserves them.
 */
export function checkpointBroadcastContextSessionPhaseLedger(
  value: BroadcastContextSessionRecord,
  checkpoint: BroadcastContextSessionPhaseLedgerCheckpoint,
): BroadcastContextSessionRecord {
  const current = cloneBroadcastContextSessionRecord(value);
  assertCurrentParticipantGroundingFence(current);
  const exactContextInputUnchanged =
    current.contextInputSignature === checkpoint.contextInputSignature &&
    current.contextInputCheckpointJson ===
      checkpoint.contextInputCheckpointJson;
  const currentRefinementSlice = refinementPhaseLedgerSliceJson(
    current.contextPhaseLedgerJson,
  );
  const nextRefinementSlice = refinementPhaseLedgerSliceJson(
    checkpoint.contextPhaseLedgerJson,
  );
  const exactRefinementPlanStateUnchanged =
    exactContextInputUnchanged &&
    currentRefinementSlice !== null &&
    currentRefinementSlice === nextRefinementSlice;
  return cloneBroadcastContextSessionRecord({
    ...current,
    contextInputSignature: checkpoint.contextInputSignature,
    contextInputCheckpointJson: checkpoint.contextInputCheckpointJson,
    contextPhaseLedgerJson: checkpoint.contextPhaseLedgerJson,
    contextResultJson: exactContextInputUnchanged
      ? current.contextResultJson
      : null,
    refinementTranscriptInputSignature: exactContextInputUnchanged
      ? current.refinementTranscriptInputSignature
      : null,
    refinementTranscriptCheckpointJson: exactContextInputUnchanged
      ? current.refinementTranscriptCheckpointJson
      : null,
    refinementEvidenceLedgerJson: exactContextInputUnchanged
      ? current.refinementEvidenceLedgerJson
      : null,
    refinementInputSignature: exactRefinementPlanStateUnchanged
      ? current.refinementInputSignature
      : null,
    refinementCandidatesJson: exactRefinementPlanStateUnchanged
      ? current.refinementCandidatesJson
      : null,
    recordedAt: checkpoint.recordedAt,
  });
}

/**
 * Binds one no-caption semantic-refinement transcript checkpoint to its exact
 * refinement input while preserving the committed parent context.
 *
 * Changing any per-fragment evidence invalidates the already-derived semantic
 * candidate projection in the same replacement. Rewriting an identical
 * checkpoint only refreshes its timestamp and preserves that projection.
 */
export function checkpointBroadcastContextSessionRefinementTranscript(
  value: BroadcastContextSessionRecord,
  checkpoint: BroadcastContextSessionRefinementTranscriptCheckpoint,
): BroadcastContextSessionRecord {
  const current = cloneBroadcastContextSessionRecord(value);
  assertCurrentParticipantGroundingFence(current);
  const exactCheckpointUnchanged =
    current.refinementTranscriptInputSignature ===
      checkpoint.refinementTranscriptInputSignature &&
    current.refinementTranscriptCheckpointJson ===
      checkpoint.refinementTranscriptCheckpointJson;
  return cloneBroadcastContextSessionRecord({
    ...current,
    refinementTranscriptInputSignature:
      checkpoint.refinementTranscriptInputSignature,
    refinementTranscriptCheckpointJson:
      checkpoint.refinementTranscriptCheckpointJson,
    refinementEvidenceLedgerJson: current.refinementEvidenceLedgerJson,
    refinementInputSignature: exactCheckpointUnchanged
      ? current.refinementInputSignature
      : null,
    refinementCandidatesJson: exactCheckpointUnchanged
      ? current.refinementCandidatesJson
      : null,
    recordedAt: checkpoint.recordedAt,
  });
}

/**
 * Atomically installs one canonical refinement evidence ledger on the exact
 * committed context parent. Semantic candidates survive only when both the
 * old and new ledgers select the same active evidence projection.
 */
export async function checkpointBroadcastContextSessionRefinementEvidenceLedger(
  value: BroadcastContextSessionRecord,
  checkpoint: BroadcastContextSessionRefinementEvidenceLedgerCheckpoint,
  digestAdapter: ContentDigestAdapter | null = globalThis.crypto?.subtle ?? null,
): Promise<BroadcastContextSessionRecord> {
  const current = cloneBroadcastContextSessionRecord(value);
  assertCurrentParticipantGroundingFence(current);
  if (
    current.contextInputSignature === null ||
    current.contextInputCheckpointJson === null ||
    current.contextResultJson === null
  ) {
    throw new TypeError(
      "Broadcast refinement evidence checkpoint requires a committed parent context.",
    );
  }
  const currentLedger =
    await parseBroadcastContextSessionRefinementEvidenceLedger(
      current,
      digestAdapter,
    );
  const nextLedger =
    checkpoint.refinementEvidenceLedgerJson === null
      ? null
      : await parseBroadcastContextSessionRefinementEvidenceLedger(
          cloneBroadcastContextSessionRecord({
            ...current,
            refinementEvidenceLedgerJson:
              checkpoint.refinementEvidenceLedgerJson,
          }),
          digestAdapter,
        );
  const currentProjection =
    currentLedger === null
      ? null
      : projectBroadcastRefinementActiveEvidenceRoute(currentLedger);
  const nextProjection =
    nextLedger === null
      ? null
      : projectBroadcastRefinementActiveEvidenceRoute(nextLedger);
  const exactActiveProjectionUnchanged =
    currentLedger !== null &&
    nextLedger !== null &&
    currentProjection?.projectionFingerprint ===
      nextProjection?.projectionFingerprint;
  return cloneBroadcastContextSessionRecord({
    ...current,
    refinementEvidenceLedgerJson: checkpoint.refinementEvidenceLedgerJson,
    refinementInputSignature: exactActiveProjectionUnchanged
      ? current.refinementInputSignature
      : null,
    refinementCandidatesJson: exactActiveProjectionUnchanged
      ? current.refinementCandidatesJson
      : null,
    recordedAt: checkpoint.recordedAt,
  });
}

function refinementLedgerParentComparableJson(
  value: BroadcastContextSessionRecord,
): string {
  return JSON.stringify({
    inputSignature: value.inputSignature,
    sourceDurationMs: value.sourceDurationMs,
    transcript: transcriptCheckpointComparableJson(value),
    sourceCastRosterId: value.sourceCastRosterId,
    participantGroundingInputSignature:
      value.participantGroundingInputSignature,
    participantGroundingPlanFingerprint:
      value.participantGroundingPlanFingerprint,
    participantGroundingCheckpointJson:
      value.participantGroundingCheckpointJson,
    contextInputSignature: value.contextInputSignature,
    contextInputCheckpointJson: value.contextInputCheckpointJson,
    contextResultJson: value.contextResultJson,
  });
}

/**
 * Reconciles a generic participant/context replacement with the refinement
 * ledger lifecycle. It is the safe boundary for callers that replace parent
 * fences without using one of the narrower checkpoint builders.
 */
export function reconcileBroadcastContextSessionRefinementEvidenceLifecycle(
  expected: BroadcastContextSessionRecord,
  replacement: BroadcastContextSessionRecord,
): BroadcastContextSessionRecord {
  const current = cloneBroadcastContextSessionRecord(expected);
  const nextWithoutRefinementEvidence = cloneBroadcastContextSessionRecord({
    ...replacement,
    refinementEvidenceLedgerJson: null,
    refinementInputSignature: null,
    refinementCandidatesJson: null,
  });
  if (current.runId !== nextWithoutRefinementEvidence.runId) {
    throw new TypeError(
      "Broadcast refinement evidence lifecycle records must share one run id.",
    );
  }
  if (
    refinementLedgerParentComparableJson(current) ===
    refinementLedgerParentComparableJson(nextWithoutRefinementEvidence)
  ) {
    return cloneBroadcastContextSessionRecord(replacement);
  }
  return nextWithoutRefinementEvidence;
}
