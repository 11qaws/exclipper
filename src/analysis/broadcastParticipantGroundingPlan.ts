import {
  createContentFingerprint,
  type ContentDigestAdapter,
} from "../security/contentFingerprint";
import {
  BROADCAST_PARTICIPANT_GROUNDING_SCHEMA_VERSION,
  type BroadcastParticipantAdapterUnavailableReason,
  type BroadcastParticipantMediaAdapter,
} from "./broadcastParticipantGrounding";
import {
  CANDIDATE_PASS_B_CAST_ROSTER_VERSION,
  candidatePassBCastReferences,
  isCandidatePassBCastRosterId,
  type CandidatePassBCastRosterId,
  type CandidatePassBParticipantId,
} from "./participantRoster";
import {
  PARTICIPANT_VOICE_UNKNOWN_ID,
  createParticipantVoiceEnrollmentManifestHash,
  eligibleParticipantVoiceEnrollmentAssets,
  normalizeParticipantVoiceEnrollmentManifest,
  type ParticipantVoiceEnrollmentManifest,
} from "./participantVoiceEnrollmentManifest";

export const BROADCAST_PARTICIPANT_GROUNDING_PLAN_SCHEMA_VERSION =
  "1.3.0" as const;
export const BROADCAST_PARTICIPANT_GROUNDING_PLAN_REVISION =
  "broadcast-participant-grounding-plan-v4" as const;
export const BROADCAST_PARTICIPANT_MEDIA_BUNDLE_KEY_REVISION =
  "participant-media-bundle-v1" as const;
export const BROADCAST_PARTICIPANT_VOICE_RECOGNITION_POLICY_VERSION =
  "1.0.0" as const;
export const BROADCAST_PARTICIPANT_VOICE_RECOGNITION_POLICY_DOMAIN =
  "exclipper.broadcast-participant-voice-recognition-policy.v1" as const;
export const BROADCAST_PARTICIPANT_GROUNDING_MAX_SOURCE_DURATION_MS =
  12 * 60 * 60 * 1_000;
export const BROADCAST_PARTICIPANT_GROUNDING_MAX_CELL_COUNT_PER_ADAPTER = 4_320;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+/-]*$/u;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_OPERATION_ATTEMPT_ORDINAL = 9_999;

export type BroadcastParticipantGroundingPlanAdapter =
  "transcript-names" | BroadcastParticipantMediaAdapter;

export type BroadcastParticipantGroundingTerminalOutcome =
  "identified" | "none" | "unidentified" | "no-speech";

export type BroadcastParticipantGroundingGapDisposition =
  "retryable" | "outcome-unknown";

export type BroadcastParticipantGroundingGapReason =
  | "source-decode-failed"
  | "model-load-failed"
  | "inference-failed"
  | "rate-limited"
  | "invalid-model-output"
  | "runtime-unavailable"
  | "operation-interrupted";

export interface BroadcastParticipantGroundingSourceFence {
  readonly sourceFingerprint: string;
  readonly sourceDurationMs: number;
  readonly transcriptSeal: string;
  readonly castRosterId: CandidatePassBCastRosterId | null;
  readonly catalogVersion: typeof CANDIDATE_PASS_B_CAST_ROSTER_VERSION;
  readonly groundingSchemaVersion: typeof BROADCAST_PARTICIPANT_GROUNDING_SCHEMA_VERSION;
  readonly samplingPlanRevision: string;
}

export interface BroadcastParticipantGroundingCellRangeInput {
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly sourceUnitId: string | null;
}

export interface BroadcastParticipantGroundingVisualCellRangeInput extends BroadcastParticipantGroundingCellRangeInput {
  /** Exactly four distinct source timestamps, all inside this source range. */
  readonly frameTimestampsMs: readonly [number, number, number, number];
}

export interface BroadcastParticipantGroundingTranscriptPlanInput {
  readonly adapterRevision: string;
  readonly modelRevision: string;
  readonly cells: readonly BroadcastParticipantGroundingCellRangeInput[];
}

export interface BroadcastParticipantGroundingVisualPlanInput {
  readonly adapterRevision: string;
  readonly modelRevision: string | null;
  readonly referenceManifestHash: string | null;
  readonly referenceParticipantIds: readonly CandidatePassBParticipantId[];
  readonly unavailableReason?: Exclude<
    BroadcastParticipantAdapterUnavailableReason,
    "no-verified-reference-manifest"
  > | null;
  readonly cells: readonly BroadcastParticipantGroundingVisualCellRangeInput[];
}

export interface BroadcastParticipantVoiceAbsoluteMatchThresholdInput {
  readonly participantId: CandidatePassBParticipantId;
  /**
   * Inclusive minimum normalized cosine similarity for this participant.
   * The adapter owns calibration; the plan only validates and source-fences it.
   */
  readonly minimumNormalizedSimilarity: number;
}

export interface BroadcastParticipantVoiceRecognitionPolicyInput {
  readonly policyRevision: string;
  readonly absoluteMatchThresholds: readonly BroadcastParticipantVoiceAbsoluteMatchThresholdInput[];
  /** Inclusive minimum difference between normalized top-1 and top-2 scores. */
  readonly minimumTop1Top2Margin: number;
}

export interface BroadcastParticipantVoiceAbsoluteMatchThreshold {
  readonly participantId: CandidatePassBParticipantId;
  readonly minimumNormalizedSimilarity: number;
}

/**
 * An open-set policy: even though the model compares only covered roster
 * participants, every non-match remains `unknown` rather than being forced to
 * the nearest enrolled person.
 */
export interface BroadcastParticipantVoiceRecognitionPolicy {
  readonly schemaVersion: typeof BROADCAST_PARTICIPANT_VOICE_RECOGNITION_POLICY_VERSION;
  readonly domain: typeof BROADCAST_PARTICIPANT_VOICE_RECOGNITION_POLICY_DOMAIN;
  readonly policyRevision: string;
  readonly scoreMetric: "normalized-cosine-similarity";
  readonly decisionMode: "open-set-with-abstention";
  readonly absoluteMatchThresholds: readonly BroadcastParticipantVoiceAbsoluteMatchThreshold[];
  readonly minimumTop1Top2Margin: number;
  readonly unknownParticipantId: typeof PARTICIPANT_VOICE_UNKNOWN_ID;
  readonly belowAbsoluteThresholdOutcome: "unidentified";
  readonly belowTop1Top2MarginOutcome: "unidentified";
  readonly missingCoverageOutcome: "unidentified";
}

export interface BroadcastParticipantGroundingVoicePlanInput {
  readonly adapterRevision: string;
  readonly segmentationModelRevision: string | null;
  readonly enrollmentManifest: ParticipantVoiceEnrollmentManifest | null;
  /**
   * Required whenever at least one participant has eligible enrollment.
   * Null is valid only while the adapter has zero covered participants.
   */
  readonly recognitionPolicy: BroadcastParticipantVoiceRecognitionPolicyInput | null;
  readonly unavailableReason?: Exclude<
    BroadcastParticipantAdapterUnavailableReason,
    "no-verified-reference-manifest"
  > | null;
  readonly cells: readonly BroadcastParticipantGroundingCellRangeInput[];
}

export interface CreateBroadcastParticipantGroundingPlanInput {
  readonly sourceFingerprint: string;
  readonly sourceDurationMs: number;
  readonly transcriptSeal: string;
  readonly castRosterId: CandidatePassBCastRosterId | null;
  readonly samplingPlanRevision: string;
  readonly transcript: BroadcastParticipantGroundingTranscriptPlanInput;
  readonly visual: BroadcastParticipantGroundingVisualPlanInput;
  readonly voice: BroadcastParticipantGroundingVoicePlanInput;
}

export interface BroadcastParticipantMediaBundleReuseKeys {
  readonly revision: typeof BROADCAST_PARTICIPANT_MEDIA_BUNDLE_KEY_REVISION;
  readonly audioBundleReuseKey: string;
  readonly frameBundleReuseKey: string | null;
}

export interface BroadcastParticipantGroundingCellPlan {
  readonly cellId: string;
  readonly adapter: BroadcastParticipantGroundingPlanAdapter;
  readonly ordinal: number;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly sourceUnitId: string | null;
  readonly frameTimestampsMs: readonly number[];
  readonly bundleReuse: BroadcastParticipantMediaBundleReuseKeys;
}

export interface BroadcastParticipantGroundingEnabledAdapterPlan {
  readonly adapter: BroadcastParticipantGroundingPlanAdapter;
  readonly availability: "enabled";
  readonly adapterRevision: string;
  readonly modelRevision: string;
  readonly referenceManifestHash: string | null;
  readonly coveredParticipantIds: readonly CandidatePassBParticipantId[];
  readonly missingParticipantIds: readonly CandidatePassBParticipantId[];
  readonly voiceRecognitionPolicy: BroadcastParticipantVoiceRecognitionPolicy | null;
  readonly unavailableReason: null;
  readonly adapterFenceKey: string;
  readonly cells: readonly BroadcastParticipantGroundingCellPlan[];
}

export interface BroadcastParticipantGroundingUnavailableAdapterPlan {
  readonly adapter: BroadcastParticipantMediaAdapter;
  readonly availability: "unavailable";
  readonly adapterRevision: string;
  readonly modelRevision: string | null;
  readonly referenceManifestHash: string | null;
  readonly coveredParticipantIds: readonly CandidatePassBParticipantId[];
  readonly missingParticipantIds: readonly CandidatePassBParticipantId[];
  readonly voiceRecognitionPolicy: BroadcastParticipantVoiceRecognitionPolicy | null;
  readonly unavailableReason: BroadcastParticipantAdapterUnavailableReason;
  readonly adapterFenceKey: string;
  readonly cells: readonly [];
}

export type BroadcastParticipantGroundingAdapterPlan =
  | BroadcastParticipantGroundingEnabledAdapterPlan
  | BroadcastParticipantGroundingUnavailableAdapterPlan;

export interface BroadcastParticipantGroundingBundleReuseIndex {
  readonly revision: typeof BROADCAST_PARTICIPANT_MEDIA_BUNDLE_KEY_REVISION;
  readonly audioBundleReuseKeys: readonly string[];
  readonly frameBundleReuseKeys: readonly string[];
}

export interface BroadcastParticipantGroundingPlan {
  readonly schemaVersion: typeof BROADCAST_PARTICIPANT_GROUNDING_PLAN_SCHEMA_VERSION;
  readonly planRevision: typeof BROADCAST_PARTICIPANT_GROUNDING_PLAN_REVISION;
  readonly planFingerprint: string;
  readonly sourceFence: BroadcastParticipantGroundingSourceFence;
  readonly expectedParticipantIds: readonly CandidatePassBParticipantId[];
  readonly adapters: readonly [
    BroadcastParticipantGroundingEnabledAdapterPlan,
    BroadcastParticipantGroundingAdapterPlan,
    BroadcastParticipantGroundingAdapterPlan,
  ];
  readonly bundleReuseIndex: BroadcastParticipantGroundingBundleReuseIndex;
}

interface BroadcastParticipantGroundingCellReceiptBase {
  readonly schemaVersion: typeof BROADCAST_PARTICIPANT_GROUNDING_PLAN_SCHEMA_VERSION;
  readonly planRevision: typeof BROADCAST_PARTICIPANT_GROUNDING_PLAN_REVISION;
  readonly planFingerprint: string;
  readonly sourceFingerprint: string;
  readonly sourceDurationMs: number;
  readonly transcriptSeal: string;
  readonly samplingPlanRevision: string;
  readonly adapterFenceKey: string;
  readonly adapter: BroadcastParticipantGroundingPlanAdapter;
  readonly adapterRevision: string;
  readonly modelRevision: string | null;
  readonly referenceManifestHash: string | null;
  readonly cellId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly audioBundleReuseKey: string;
  readonly frameBundleReuseKey: string | null;
  readonly operationId: string;
  readonly attemptOrdinal: number;
}

export interface BroadcastParticipantGroundingTerminalCellReceipt extends BroadcastParticipantGroundingCellReceiptBase {
  readonly status: "terminal";
  readonly outcome: BroadcastParticipantGroundingTerminalOutcome;
  readonly participantIds: readonly CandidatePassBParticipantId[];
  readonly confidence: number | null;
  readonly voiceRecognition: BroadcastParticipantVoiceRecognitionProjection | null;
}

export interface BroadcastParticipantGroundingGapCellReceipt extends BroadcastParticipantGroundingCellReceiptBase {
  readonly status: "gap";
  readonly disposition: BroadcastParticipantGroundingGapDisposition;
  readonly reason: BroadcastParticipantGroundingGapReason;
}

export type BroadcastParticipantGroundingCellReceipt =
  | BroadcastParticipantGroundingTerminalCellReceipt
  | BroadcastParticipantGroundingGapCellReceipt;

/**
 * Explicit terminal proof that a planned media modality could not be observed.
 *
 * This is not evidence that no person was visible or that no one spoke. It
 * exists solely to distinguish a caller-confirmed unavailable modality from a
 * missing receipt. The whole-source range and every source/model fence are
 * repeated so persisted receipts can be rejected without trusting an opaque
 * status flag.
 */
export interface BroadcastParticipantGroundingNoneObservedReceipt {
  readonly schemaVersion: typeof BROADCAST_PARTICIPANT_GROUNDING_PLAN_SCHEMA_VERSION;
  readonly planRevision: typeof BROADCAST_PARTICIPANT_GROUNDING_PLAN_REVISION;
  readonly planFingerprint: string;
  readonly sourceFingerprint: string;
  readonly sourceDurationMs: number;
  readonly transcriptSeal: string;
  readonly samplingPlanRevision: string;
  readonly adapterFenceKey: string;
  readonly adapter: BroadcastParticipantMediaAdapter;
  readonly adapterRevision: string;
  readonly modelRevision: string | null;
  readonly referenceManifestHash: string | null;
  readonly sourceStartMs: 0;
  readonly sourceEndMs: number;
  readonly operationId: string;
  readonly attemptOrdinal: number;
  readonly status: "terminal";
  readonly outcome: "none-observed";
  readonly unavailableReason: BroadcastParticipantAdapterUnavailableReason;
}

export interface CreateBroadcastParticipantGroundingTerminalReceiptInput {
  readonly plan: BroadcastParticipantGroundingPlan;
  readonly adapter: BroadcastParticipantGroundingPlanAdapter;
  readonly cellId: string;
  readonly operationId: string;
  readonly attemptOrdinal: number;
  readonly outcome: BroadcastParticipantGroundingTerminalOutcome;
  readonly participantIds?: readonly CandidatePassBParticipantId[];
  readonly confidence?: number | null;
  readonly voiceRecognition?: BroadcastParticipantVoiceRecognitionProjection | null;
}

export interface CreateBroadcastParticipantGroundingGapReceiptInput {
  readonly plan: BroadcastParticipantGroundingPlan;
  readonly adapter: BroadcastParticipantGroundingPlanAdapter;
  readonly cellId: string;
  readonly operationId: string;
  readonly attemptOrdinal: number;
  readonly disposition: BroadcastParticipantGroundingGapDisposition;
  readonly reason: BroadcastParticipantGroundingGapReason;
}

export interface CreateBroadcastParticipantGroundingNoneObservedReceiptInput {
  readonly plan: BroadcastParticipantGroundingPlan;
  readonly adapter: BroadcastParticipantMediaAdapter;
  readonly operationId: string;
  readonly attemptOrdinal: number;
}

export interface BroadcastParticipantGroundingCompletionInspection {
  readonly planFingerprint: string;
  readonly plannedCellCount: number;
  readonly terminalCellCount: number;
  readonly requiredNoneObservedAdapterCount: number;
  readonly terminalNoneObservedAdapterCount: number;
  readonly missingCellIds: readonly string[];
  readonly missingNoneObservedAdapters: readonly BroadcastParticipantMediaAdapter[];
  readonly retryableCellIds: readonly string[];
  readonly outcomeUnknownCellIds: readonly string[];
  readonly readyToSeal: boolean;
}

export interface BroadcastParticipantGroundingAdapterCompletionReceipt {
  readonly adapter: BroadcastParticipantGroundingPlanAdapter;
  readonly adapterRevision: string;
  readonly modelRevision: string | null;
  readonly referenceManifestHash: string | null;
  readonly coveredParticipantIds: readonly CandidatePassBParticipantId[];
  readonly missingParticipantIds: readonly CandidatePassBParticipantId[];
  readonly voiceRecognitionPolicy: BroadcastParticipantVoiceRecognitionPolicy | null;
  readonly adapterFenceKey: string;
  readonly status: "completed" | "unavailable";
  readonly inputCount: number;
  readonly processedCount: number;
  readonly unavailableReason: BroadcastParticipantAdapterUnavailableReason | null;
}

export interface BroadcastParticipantVoiceRecognitionScore {
  readonly participantId: CandidatePassBParticipantId;
  readonly normalizedSimilarity: number;
}

interface BroadcastParticipantVoiceRecognitionProjectionBase {
  readonly schemaVersion: typeof BROADCAST_PARTICIPANT_VOICE_RECOGNITION_POLICY_VERSION;
  readonly planFingerprint: string;
  readonly sourceFingerprint: string;
  readonly adapterFenceKey: string;
  readonly modelRevision: string;
  readonly policyRevision: string;
  readonly cellId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly coveredParticipantIds: readonly CandidatePassBParticipantId[];
  readonly missingParticipantIds: readonly CandidatePassBParticipantId[];
  readonly rankedMatches: readonly BroadcastParticipantVoiceRecognitionScore[];
  readonly minimumTop1Top2Margin: number;
}

export type BroadcastParticipantVoiceRecognitionAbstentionReason =
  | "insufficient-covered-comparators"
  | "below-absolute-threshold"
  | "below-top1-top2-margin";

export type BroadcastParticipantVoiceRecognitionProjection =
  | (BroadcastParticipantVoiceRecognitionProjectionBase & {
      readonly speechActivity: "speech";
      readonly outcome: "identified";
      readonly participantId: CandidatePassBParticipantId;
      readonly confidence: number;
      readonly applicableAbsoluteMatchThreshold: number;
      readonly observedTop1Top2Margin: number;
      readonly abstentionReason: null;
    })
  | (BroadcastParticipantVoiceRecognitionProjectionBase & {
      readonly speechActivity: "speech";
      readonly outcome: "unidentified";
      readonly participantId: typeof PARTICIPANT_VOICE_UNKNOWN_ID;
      readonly confidence: null;
      readonly applicableAbsoluteMatchThreshold: number | null;
      readonly observedTop1Top2Margin: number | null;
      readonly abstentionReason: BroadcastParticipantVoiceRecognitionAbstentionReason;
    })
  | (BroadcastParticipantVoiceRecognitionProjectionBase & {
      readonly speechActivity: "no-speech";
      readonly outcome: "no-speech";
      readonly participantId: null;
      readonly confidence: null;
      readonly applicableAbsoluteMatchThreshold: null;
      readonly observedTop1Top2Margin: null;
      readonly abstentionReason: null;
    });

export interface CreateBroadcastParticipantVoiceRecognitionProjectionInput {
  readonly plan: BroadcastParticipantGroundingPlan;
  readonly cellId: string;
  readonly adapterFenceKey: string;
  readonly modelRevision: string;
  readonly speechActivity: "speech" | "no-speech";
  /**
   * Exactly one normalized score per covered participant for speech. Must be
   * empty for no-speech. Raw audio and embeddings are outside this contract.
   */
  readonly scores: readonly BroadcastParticipantVoiceRecognitionScore[];
}

export interface SealedBroadcastParticipantGroundingPlan {
  readonly schemaVersion: typeof BROADCAST_PARTICIPANT_GROUNDING_PLAN_SCHEMA_VERSION;
  readonly status: "sealed";
  readonly planRevision: typeof BROADCAST_PARTICIPANT_GROUNDING_PLAN_REVISION;
  readonly planFingerprint: string;
  readonly sourceFence: BroadcastParticipantGroundingSourceFence;
  readonly expectedParticipantIds: readonly CandidatePassBParticipantId[];
  readonly adapterReceipts: readonly BroadcastParticipantGroundingAdapterCompletionReceipt[];
  readonly terminalCells: readonly BroadcastParticipantGroundingTerminalCellReceipt[];
  readonly noneObservedReceipts: readonly BroadcastParticipantGroundingNoneObservedReceipt[];
  readonly bundleReuseIndex: BroadcastParticipantGroundingBundleReuseIndex;
}

const BROADCAST_PARTICIPANT_ADAPTER_ORDER = [
  "transcript-names",
  "visual-identity",
  "voice-identity",
] as const satisfies readonly BroadcastParticipantGroundingPlanAdapter[];
const BROADCAST_PARTICIPANT_UNAVAILABLE_REASONS = new Set<
  BroadcastParticipantAdapterUnavailableReason
>([
  "no-verified-reference-manifest",
  "source-has-no-modality",
  "unsupported-runtime",
]);

export type BroadcastParticipantGroundingPlanContractErrorCode =
  | "INVALID_SOURCE_FENCE"
  | "INVALID_ADAPTER_FENCE"
  | "INVALID_CELL_PLAN"
  | "INVALID_VOICE_ENROLLMENT_MANIFEST"
  | "INVALID_CELL_RECEIPT"
  | "UNKNOWN_CELL_RECEIPT"
  | "DUPLICATE_CELL_RECEIPT"
  | "PLAN_INCOMPLETE";

export class BroadcastParticipantGroundingPlanContractError extends Error {
  public readonly code: BroadcastParticipantGroundingPlanContractErrorCode;

  public constructor(
    code: BroadcastParticipantGroundingPlanContractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BroadcastParticipantGroundingPlanContractError";
    this.code = code;
  }
}

function boundedIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH &&
    value.trim() === value &&
    IDENTIFIER_PATTERN.test(value)
  );
}

function assertSha256(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_SOURCE_FENCE",
      `${label} must be a SHA-256 content fingerprint.`,
    );
  }
}

function assertSourceFenceInput(
  input: CreateBroadcastParticipantGroundingPlanInput,
): void {
  assertSha256(input.sourceFingerprint, "sourceFingerprint");
  if (
    !Number.isSafeInteger(input.sourceDurationMs) ||
    input.sourceDurationMs <= 0 ||
    input.sourceDurationMs >
      BROADCAST_PARTICIPANT_GROUNDING_MAX_SOURCE_DURATION_MS ||
    !boundedIdentifier(input.transcriptSeal) ||
    !boundedIdentifier(input.samplingPlanRevision) ||
    (input.castRosterId !== null &&
      !isCandidatePassBCastRosterId(input.castRosterId))
  ) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_SOURCE_FENCE",
      "The participant grounding source fence is outside the bounded contract.",
    );
  }
}

function expectedParticipantIds(
  castRosterId: CandidatePassBCastRosterId | null,
): readonly CandidatePassBParticipantId[] {
  return candidatePassBCastReferences(castRosterId).map(
    ({ participantId }) => participantId,
  );
}

function canonicalParticipantIds(
  participantIds: readonly CandidatePassBParticipantId[],
  expectedIds: readonly CandidatePassBParticipantId[],
): readonly CandidatePassBParticipantId[] {
  const expected = new Set(expectedIds);
  const unique = new Set<CandidatePassBParticipantId>();
  for (const participantId of participantIds) {
    if (!expected.has(participantId) || unique.has(participantId)) {
      throw new BroadcastParticipantGroundingPlanContractError(
        "INVALID_ADAPTER_FENCE",
        "A reference participant ID is unknown or duplicated for this source.",
      );
    }
    unique.add(participantId);
  }
  return expectedIds.filter((participantId) => unique.has(participantId));
}

function missingParticipantIds(
  coveredIds: readonly CandidatePassBParticipantId[],
  expectedIds: readonly CandidatePassBParticipantId[],
): readonly CandidatePassBParticipantId[] {
  const covered = new Set(coveredIds);
  return expectedIds.filter((participantId) => !covered.has(participantId));
}

function assertRange(
  range: BroadcastParticipantGroundingCellRangeInput,
  sourceDurationMs: number,
): void {
  if (
    !Number.isSafeInteger(range.sourceStartMs) ||
    !Number.isSafeInteger(range.sourceEndMs) ||
    range.sourceStartMs < 0 ||
    range.sourceEndMs <= range.sourceStartMs ||
    range.sourceEndMs > sourceDurationMs ||
    (range.sourceUnitId !== null && !boundedIdentifier(range.sourceUnitId))
  ) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_CELL_PLAN",
      "A participant grounding cell has an invalid source-time fence.",
    );
  }
}

function canonicalFrames(
  range: BroadcastParticipantGroundingVisualCellRangeInput,
): readonly [number, number, number, number] {
  if (
    !Array.isArray(range.frameTimestampsMs) ||
    range.frameTimestampsMs.length !== 4 ||
    range.frameTimestampsMs.some(
      (timestamp) =>
        !Number.isSafeInteger(timestamp) ||
        timestamp < range.sourceStartMs ||
        timestamp >= range.sourceEndMs,
    )
  ) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_CELL_PLAN",
      "A visual grounding cell requires four source-fenced frame timestamps.",
    );
  }
  const sorted = [...range.frameTimestampsMs].sort(
    (left, right) => left - right,
  );
  if (new Set(sorted).size !== 4) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_CELL_PLAN",
      "A visual grounding cell requires four distinct frame timestamps.",
    );
  }
  return sorted as [number, number, number, number];
}

function baseBundleKey(
  sourceFingerprint: string,
  sourceStartMs: number,
  sourceEndMs: number,
): string {
  return [
    BROADCAST_PARTICIPANT_MEDIA_BUNDLE_KEY_REVISION,
    sourceFingerprint,
    `${sourceStartMs}-${sourceEndMs}`,
  ].join(":");
}

/**
 * Produces the exact immutable media keys shared by pre-context grounding and
 * post-context candidate confirmation. Matching keys mean matching source
 * bytes/timestamps, not merely overlapping ranges.
 */
export function createBroadcastParticipantMediaBundleReuseKeys(input: {
  readonly sourceFingerprint: string;
  readonly sourceDurationMs: number;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly frameTimestampsMs?: readonly number[];
}): BroadcastParticipantMediaBundleReuseKeys {
  assertSha256(input.sourceFingerprint, "sourceFingerprint");
  assertRange(
    {
      sourceStartMs: input.sourceStartMs,
      sourceEndMs: input.sourceEndMs,
      sourceUnitId: null,
    },
    input.sourceDurationMs,
  );
  const base = baseBundleKey(
    input.sourceFingerprint,
    input.sourceStartMs,
    input.sourceEndMs,
  );
  let frameBundleReuseKey: string | null = null;
  if (input.frameTimestampsMs !== undefined) {
    if (
      input.frameTimestampsMs.length !== 4 ||
      input.frameTimestampsMs.some(
        (timestamp) =>
          !Number.isSafeInteger(timestamp) ||
          timestamp < input.sourceStartMs ||
          timestamp >= input.sourceEndMs,
      )
    ) {
      throw new BroadcastParticipantGroundingPlanContractError(
        "INVALID_CELL_PLAN",
        "A frame bundle reuse key requires four source-fenced timestamps.",
      );
    }
    const frames = [...input.frameTimestampsMs].sort(
      (left, right) => left - right,
    );
    if (new Set(frames).size !== 4) {
      throw new BroadcastParticipantGroundingPlanContractError(
        "INVALID_CELL_PLAN",
        "A frame bundle reuse key requires four distinct timestamps.",
      );
    }
    frameBundleReuseKey = `${base}:jpeg4:${frames.join(".")}`;
  }
  return {
    revision: BROADCAST_PARTICIPANT_MEDIA_BUNDLE_KEY_REVISION,
    audioBundleReuseKey: `${base}:pcm16k-mono`,
    frameBundleReuseKey,
  };
}

function createCells(
  adapter: BroadcastParticipantGroundingPlanAdapter,
  ranges: readonly (
    | BroadcastParticipantGroundingCellRangeInput
    | BroadcastParticipantGroundingVisualCellRangeInput
  )[],
  sourceFence: BroadcastParticipantGroundingSourceFence,
): readonly BroadcastParticipantGroundingCellPlan[] {
  if (
    ranges.length === 0 ||
    ranges.length > BROADCAST_PARTICIPANT_GROUNDING_MAX_CELL_COUNT_PER_ADAPTER
  ) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_CELL_PLAN",
      "An enabled participant adapter requires a bounded non-empty cell plan.",
    );
  }
  const canonicalRanges = ranges
    .map((range) => {
      assertRange(range, sourceFence.sourceDurationMs);
      const frames =
        adapter === "visual-identity"
          ? canonicalFrames(
              range as BroadcastParticipantGroundingVisualCellRangeInput,
            )
          : [];
      return {
        ...range,
        frameTimestampsMs: frames,
      };
    })
    .sort((left, right) => {
      const sourceRangeOrder =
        left.sourceStartMs - right.sourceStartMs ||
        left.sourceEndMs - right.sourceEndMs;
      if (sourceRangeOrder !== 0) return sourceRangeOrder;
      const leftUnitId = left.sourceUnitId ?? "";
      const rightUnitId = right.sourceUnitId ?? "";
      return leftUnitId < rightUnitId ? -1 : leftUnitId > rightUnitId ? 1 : 0;
    });
  const rangeIdentities = canonicalRanges.map(
    ({ sourceStartMs, sourceEndMs, sourceUnitId }) =>
      `${sourceStartMs}:${sourceEndMs}:${sourceUnitId ?? "-"}`,
  );
  if (new Set(rangeIdentities).size !== rangeIdentities.length) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_CELL_PLAN",
      "A participant adapter cannot plan the same source cell twice.",
    );
  }
  return canonicalRanges.map((range, ordinal) => ({
    cellId:
      `${adapter}:cell-${ordinal + 1}:` +
      `${range.sourceStartMs.toString(36)}-${range.sourceEndMs.toString(36)}`,
    adapter,
    ordinal,
    sourceStartMs: range.sourceStartMs,
    sourceEndMs: range.sourceEndMs,
    sourceUnitId: range.sourceUnitId,
    frameTimestampsMs: range.frameTimestampsMs,
    bundleReuse: createBroadcastParticipantMediaBundleReuseKeys({
      sourceFingerprint: sourceFence.sourceFingerprint,
      sourceDurationMs: sourceFence.sourceDurationMs,
      sourceStartMs: range.sourceStartMs,
      sourceEndMs: range.sourceEndMs,
      ...(adapter === "visual-identity"
        ? { frameTimestampsMs: range.frameTimestampsMs }
        : {}),
    }),
  }));
}

async function adapterFenceKey(input: {
  readonly sourceFence: BroadcastParticipantGroundingSourceFence;
  readonly adapter: BroadcastParticipantGroundingPlanAdapter;
  readonly adapterRevision: string;
  readonly modelRevision: string | null;
  readonly referenceManifestHash: string | null;
  readonly coveredParticipantIds: readonly CandidatePassBParticipantId[];
  readonly missingParticipantIds: readonly CandidatePassBParticipantId[];
  readonly voiceRecognitionPolicy: BroadcastParticipantVoiceRecognitionPolicy | null;
  readonly availability: "enabled" | "unavailable";
  readonly unavailableReason: BroadcastParticipantAdapterUnavailableReason | null;
  readonly digestAdapter: ContentDigestAdapter | null;
}): Promise<string> {
  return createContentFingerprint(
    [
      "exclipper.broadcast-participant-adapter-fence.v1",
      JSON.stringify({
        sourceFence: input.sourceFence,
        adapter: input.adapter,
        adapterRevision: input.adapterRevision,
        modelRevision: input.modelRevision,
        referenceManifestHash: input.referenceManifestHash,
        coveredParticipantIds: input.coveredParticipantIds,
        missingParticipantIds: input.missingParticipantIds,
        voiceRecognitionPolicy: input.voiceRecognitionPolicy,
        availability: input.availability,
        unavailableReason: input.unavailableReason,
      }),
    ],
    input.digestAdapter,
  );
}

function unavailableReasonFor(
  explicitReason:
    | Exclude<
        BroadcastParticipantAdapterUnavailableReason,
        "no-verified-reference-manifest"
      >
    | null
    | undefined,
  hasCompleteManifest: boolean,
): BroadcastParticipantAdapterUnavailableReason | null {
  if (explicitReason !== null && explicitReason !== undefined) {
    return explicitReason;
  }
  return hasCompleteManifest ? null : "no-verified-reference-manifest";
}

async function createTranscriptAdapterPlan(
  input: BroadcastParticipantGroundingTranscriptPlanInput,
  sourceFence: BroadcastParticipantGroundingSourceFence,
  digestAdapter: ContentDigestAdapter | null,
): Promise<BroadcastParticipantGroundingEnabledAdapterPlan> {
  if (
    !boundedIdentifier(input.adapterRevision) ||
    !boundedIdentifier(input.modelRevision)
  ) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_ADAPTER_FENCE",
      "The transcript participant adapter revision is invalid.",
    );
  }
  const cells = createCells("transcript-names", input.cells, sourceFence);
  const fenceKey = await adapterFenceKey({
    sourceFence,
    adapter: "transcript-names",
    adapterRevision: input.adapterRevision,
    modelRevision: input.modelRevision,
    referenceManifestHash: null,
    coveredParticipantIds: [],
    missingParticipantIds: [],
    voiceRecognitionPolicy: null,
    availability: "enabled",
    unavailableReason: null,
    digestAdapter,
  });
  return {
    adapter: "transcript-names",
    availability: "enabled",
    adapterRevision: input.adapterRevision,
    modelRevision: input.modelRevision,
    referenceManifestHash: null,
    coveredParticipantIds: [],
    missingParticipantIds: [],
    voiceRecognitionPolicy: null,
    unavailableReason: null,
    adapterFenceKey: fenceKey,
    cells,
  };
}

async function createVisualAdapterPlan(
  input: BroadcastParticipantGroundingVisualPlanInput,
  sourceFence: BroadcastParticipantGroundingSourceFence,
  expectedIds: readonly CandidatePassBParticipantId[],
  digestAdapter: ContentDigestAdapter | null,
): Promise<BroadcastParticipantGroundingAdapterPlan> {
  if (!boundedIdentifier(input.adapterRevision)) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_ADAPTER_FENCE",
      "The visual participant adapter revision is invalid.",
    );
  }
  if (input.modelRevision !== null && !boundedIdentifier(input.modelRevision)) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_ADAPTER_FENCE",
      "The visual participant model revision is invalid.",
    );
  }
  if (
    input.referenceManifestHash !== null &&
    !SHA256_PATTERN.test(input.referenceManifestHash)
  ) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_ADAPTER_FENCE",
      "The visual reference manifest hash must be SHA-256.",
    );
  }
  const coveredIds = canonicalParticipantIds(
    input.referenceParticipantIds,
    expectedIds,
  );
  const missingIds = missingParticipantIds(coveredIds, expectedIds);
  if (
    (input.referenceManifestHash === null && coveredIds.length > 0) ||
    (input.referenceManifestHash !== null && coveredIds.length === 0)
  ) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_ADAPTER_FENCE",
      "Visual reference participants require an actual non-empty reference manifest.",
    );
  }
  /*
   * Four reviewed source frames can establish that no person is present or
   * read an on-screen name without a separate cast-image bundle. A reference
   * manifest only authorizes appearance matching for the participants it
   * actually covers; it is not a prerequisite for running visual inspection.
   */
  const runtimeReady =
    input.modelRevision !== null && input.cells.length > 0;
  const unavailableReason =
    input.unavailableReason !== null &&
    input.unavailableReason !== undefined
      ? input.unavailableReason
      : runtimeReady
        ? null
        : "unsupported-runtime";
  const availability =
    unavailableReason === null
      ? ("enabled" as const)
      : ("unavailable" as const);
  const fenceKey = await adapterFenceKey({
    sourceFence,
    adapter: "visual-identity",
    adapterRevision: input.adapterRevision,
    modelRevision: input.modelRevision,
    referenceManifestHash: input.referenceManifestHash,
    coveredParticipantIds: coveredIds,
    missingParticipantIds: missingIds,
    voiceRecognitionPolicy: null,
    availability,
    unavailableReason,
    digestAdapter,
  });
  if (availability === "unavailable") {
    return {
      adapter: "visual-identity",
      availability,
      adapterRevision: input.adapterRevision,
      modelRevision: input.modelRevision,
      referenceManifestHash: input.referenceManifestHash,
      coveredParticipantIds: coveredIds,
      missingParticipantIds: missingIds,
      voiceRecognitionPolicy: null,
      unavailableReason: unavailableReason!,
      adapterFenceKey: fenceKey,
      cells: [],
    };
  }
  const cells = createCells("visual-identity", input.cells, sourceFence);
  return {
    adapter: "visual-identity",
    availability,
    adapterRevision: input.adapterRevision,
    modelRevision: input.modelRevision!,
    referenceManifestHash: input.referenceManifestHash,
    coveredParticipantIds: coveredIds,
    missingParticipantIds: missingIds,
    voiceRecognitionPolicy: null,
    unavailableReason: null,
    adapterFenceKey: fenceKey,
    cells,
  };
}

function eligibleVoiceParticipantIds(
  manifest: ParticipantVoiceEnrollmentManifest,
  expectedIds: readonly CandidatePassBParticipantId[],
): readonly CandidatePassBParticipantId[] {
  const eligibleIds = new Set(
    eligibleParticipantVoiceEnrollmentAssets(manifest).map(
      ({ participantId }) => participantId,
    ),
  );
  return expectedIds.filter((participantId) => eligibleIds.has(participantId));
}

function eligibleVoiceEmbeddingModelRevision(
  manifest: ParticipantVoiceEnrollmentManifest,
  coveredIds: readonly CandidatePassBParticipantId[],
): string | null {
  const covered = new Set(coveredIds);
  const revisions = new Set(
    eligibleParticipantVoiceEnrollmentAssets(manifest)
      .filter(({ participantId }) => covered.has(participantId))
      .map(({ embeddingModelRevision }) => embeddingModelRevision),
  );
  if (revisions.size !== 1) return null;
  return [...revisions][0] ?? null;
}

function isNormalizedSimilarity(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function canonicalVoiceRecognitionPolicy(
  value: BroadcastParticipantVoiceRecognitionPolicyInput,
  coveredIds: readonly CandidatePassBParticipantId[],
): BroadcastParticipantVoiceRecognitionPolicy {
  if (
    !boundedIdentifier(value.policyRevision) ||
    !Array.isArray(value.absoluteMatchThresholds) ||
    !isNormalizedSimilarity(value.minimumTop1Top2Margin) ||
    value.minimumTop1Top2Margin <= 0
  ) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_ADAPTER_FENCE",
      "The voice recognition policy requires a bounded revision and positive normalized margin.",
    );
  }
  const covered = new Set(coveredIds);
  const thresholdByParticipantId = new Map<
    CandidatePassBParticipantId,
    number
  >();
  for (const threshold of value.absoluteMatchThresholds) {
    if (
      !isRecord(threshold) ||
      !hasExactKeys(threshold, [
        "participantId",
        "minimumNormalizedSimilarity",
      ]) ||
      !covered.has(threshold.participantId as CandidatePassBParticipantId) ||
      !isNormalizedSimilarity(threshold.minimumNormalizedSimilarity) ||
      threshold.minimumNormalizedSimilarity <= 0 ||
      thresholdByParticipantId.has(
        threshold.participantId as CandidatePassBParticipantId,
      )
    ) {
      throw new BroadcastParticipantGroundingPlanContractError(
        "INVALID_ADAPTER_FENCE",
        "Voice absolute thresholds must cover each eligible participant exactly once.",
      );
    }
    thresholdByParticipantId.set(
      threshold.participantId as CandidatePassBParticipantId,
      threshold.minimumNormalizedSimilarity,
    );
  }
  if (thresholdByParticipantId.size !== coveredIds.length) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_ADAPTER_FENCE",
      "Voice absolute thresholds must cover each eligible participant exactly once.",
    );
  }
  return {
    schemaVersion: BROADCAST_PARTICIPANT_VOICE_RECOGNITION_POLICY_VERSION,
    domain: BROADCAST_PARTICIPANT_VOICE_RECOGNITION_POLICY_DOMAIN,
    policyRevision: value.policyRevision,
    scoreMetric: "normalized-cosine-similarity",
    decisionMode: "open-set-with-abstention",
    absoluteMatchThresholds: coveredIds.map((participantId) => ({
      participantId,
      minimumNormalizedSimilarity: thresholdByParticipantId.get(participantId)!,
    })),
    minimumTop1Top2Margin: value.minimumTop1Top2Margin,
    unknownParticipantId: PARTICIPANT_VOICE_UNKNOWN_ID,
    belowAbsoluteThresholdOutcome: "unidentified",
    belowTop1Top2MarginOutcome: "unidentified",
    missingCoverageOutcome: "unidentified",
  };
}

async function createVoiceAdapterPlan(
  input: BroadcastParticipantGroundingVoicePlanInput,
  sourceFence: BroadcastParticipantGroundingSourceFence,
  expectedIds: readonly CandidatePassBParticipantId[],
  digestAdapter: ContentDigestAdapter | null,
): Promise<BroadcastParticipantGroundingAdapterPlan> {
  if (
    !boundedIdentifier(input.adapterRevision) ||
    (input.segmentationModelRevision !== null &&
      !boundedIdentifier(input.segmentationModelRevision))
  ) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_ADAPTER_FENCE",
      "The voice participant adapter revision is invalid.",
    );
  }
  const manifest =
    input.enrollmentManifest === null
      ? null
      : normalizeParticipantVoiceEnrollmentManifest(input.enrollmentManifest);
  if (input.enrollmentManifest !== null && manifest === null) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_VOICE_ENROLLMENT_MANIFEST",
      "The voice enrollment manifest failed its exact metadata contract.",
    );
  }
  const manifestHash =
    manifest === null
      ? null
      : await createParticipantVoiceEnrollmentManifestHash(
          manifest,
          digestAdapter,
        );
  const coveredIds =
    manifest === null ? [] : eligibleVoiceParticipantIds(manifest, expectedIds);
  const missingIds = missingParticipantIds(coveredIds, expectedIds);
  const embeddingRevision =
    manifest === null
      ? null
      : eligibleVoiceEmbeddingModelRevision(manifest, coveredIds);
  const modelRevision =
    input.segmentationModelRevision === null || embeddingRevision === null
      ? null
      : `${input.segmentationModelRevision}+${embeddingRevision}`;
  if (coveredIds.length === 0 && input.recognitionPolicy !== null) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_ADAPTER_FENCE",
      "A voice recognition policy cannot name participants without eligible enrollment.",
    );
  }
  const recognitionPolicy =
    input.recognitionPolicy === null
      ? null
      : canonicalVoiceRecognitionPolicy(input.recognitionPolicy, coveredIds);
  if (
    coveredIds.length > 0 &&
    recognitionPolicy === null &&
    (input.unavailableReason === null || input.unavailableReason === undefined)
  ) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_ADAPTER_FENCE",
      "Eligible voice enrollment requires an explicit open-set recognition policy.",
    );
  }
  const hasRunnablePartialManifest =
    manifestHash !== null &&
    modelRevision !== null &&
    coveredIds.length > 0 &&
    recognitionPolicy !== null;
  const unavailableReason = unavailableReasonFor(
    input.unavailableReason,
    hasRunnablePartialManifest,
  );
  const availability =
    unavailableReason === null
      ? ("enabled" as const)
      : ("unavailable" as const);
  const fenceKey = await adapterFenceKey({
    sourceFence,
    adapter: "voice-identity",
    adapterRevision: input.adapterRevision,
    modelRevision,
    referenceManifestHash: manifestHash,
    coveredParticipantIds: coveredIds,
    missingParticipantIds: missingIds,
    voiceRecognitionPolicy: recognitionPolicy,
    availability,
    unavailableReason,
    digestAdapter,
  });
  if (availability === "unavailable") {
    return {
      adapter: "voice-identity",
      availability,
      adapterRevision: input.adapterRevision,
      modelRevision,
      referenceManifestHash: manifestHash,
      coveredParticipantIds: coveredIds,
      missingParticipantIds: missingIds,
      voiceRecognitionPolicy: recognitionPolicy,
      unavailableReason: unavailableReason!,
      adapterFenceKey: fenceKey,
      cells: [],
    };
  }
  const cells = createCells("voice-identity", input.cells, sourceFence);
  return {
    adapter: "voice-identity",
    availability,
    adapterRevision: input.adapterRevision,
    modelRevision: modelRevision!,
    referenceManifestHash: manifestHash!,
    coveredParticipantIds: coveredIds,
    missingParticipantIds: missingIds,
    voiceRecognitionPolicy: recognitionPolicy!,
    unavailableReason: null,
    adapterFenceKey: fenceKey,
    cells,
  };
}

function bundleReuseIndex(
  adapters: readonly BroadcastParticipantGroundingAdapterPlan[],
): BroadcastParticipantGroundingBundleReuseIndex {
  const cells = adapters.flatMap(({ cells }) => cells);
  return {
    revision: BROADCAST_PARTICIPANT_MEDIA_BUNDLE_KEY_REVISION,
    audioBundleReuseKeys: [
      ...new Set(
        cells.map(({ bundleReuse }) => bundleReuse.audioBundleReuseKey),
      ),
    ].sort(),
    frameBundleReuseKeys: [
      ...new Set(
        cells.flatMap(({ bundleReuse }) =>
          bundleReuse.frameBundleReuseKey === null
            ? []
            : [bundleReuse.frameBundleReuseKey],
        ),
      ),
    ].sort(),
  };
}

/**
 * Builds the immutable pre-context plan. A voice manifest with only pending,
 * music-bearing, overlapping, unconsented, or unverified assets is preserved
 * in the fence but produces an explicit unavailable adapter with zero cells.
 * A verified subset may run, but uncovered roster members stay explicit and
 * can never be emitted by the score projection.
 */
export async function createBroadcastParticipantGroundingPlan(
  input: CreateBroadcastParticipantGroundingPlanInput,
  digestAdapter: ContentDigestAdapter | null = globalThis.crypto?.subtle ??
    null,
): Promise<BroadcastParticipantGroundingPlan> {
  assertSourceFenceInput(input);
  if (digestAdapter === null) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_SOURCE_FENCE",
      "SHA-256 is required to bind a participant grounding plan.",
    );
  }
  const sourceFence: BroadcastParticipantGroundingSourceFence = {
    sourceFingerprint: input.sourceFingerprint,
    sourceDurationMs: input.sourceDurationMs,
    transcriptSeal: input.transcriptSeal,
    castRosterId: input.castRosterId,
    catalogVersion: CANDIDATE_PASS_B_CAST_ROSTER_VERSION,
    groundingSchemaVersion: BROADCAST_PARTICIPANT_GROUNDING_SCHEMA_VERSION,
    samplingPlanRevision: input.samplingPlanRevision,
  };
  const participantIds = expectedParticipantIds(input.castRosterId);
  const [transcript, visual, voice] = await Promise.all([
    createTranscriptAdapterPlan(input.transcript, sourceFence, digestAdapter),
    createVisualAdapterPlan(
      input.visual,
      sourceFence,
      participantIds,
      digestAdapter,
    ),
    createVoiceAdapterPlan(
      input.voice,
      sourceFence,
      participantIds,
      digestAdapter,
    ),
  ]);
  const adapters = [transcript, visual, voice] as const;
  const reuseIndex = bundleReuseIndex(adapters);
  const planFingerprint = await createContentFingerprint(
    [
      "exclipper.broadcast-participant-grounding-plan.v1",
      JSON.stringify({
        schemaVersion: BROADCAST_PARTICIPANT_GROUNDING_PLAN_SCHEMA_VERSION,
        planRevision: BROADCAST_PARTICIPANT_GROUNDING_PLAN_REVISION,
        sourceFence,
        expectedParticipantIds: participantIds,
        adapters,
        bundleReuseIndex: reuseIndex,
      }),
    ],
    digestAdapter,
  );
  return {
    schemaVersion: BROADCAST_PARTICIPANT_GROUNDING_PLAN_SCHEMA_VERSION,
    planRevision: BROADCAST_PARTICIPANT_GROUNDING_PLAN_REVISION,
    planFingerprint,
    sourceFence,
    expectedParticipantIds: participantIds,
    adapters,
    bundleReuseIndex: reuseIndex,
  };
}

function canonicalStoredAdapterPlan(
  value: unknown,
  adapter: BroadcastParticipantGroundingPlanAdapter,
  sourceFence: BroadcastParticipantGroundingSourceFence,
  participantIds: readonly CandidatePassBParticipantId[],
): BroadcastParticipantGroundingAdapterPlan | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "adapter",
      "availability",
      "adapterRevision",
      "modelRevision",
      "referenceManifestHash",
      "coveredParticipantIds",
      "missingParticipantIds",
      "voiceRecognitionPolicy",
      "unavailableReason",
      "adapterFenceKey",
      "cells",
    ]) ||
    value.adapter !== adapter ||
    !["enabled", "unavailable"].includes(
      typeof value.availability === "string" ? value.availability : "",
    ) ||
    !boundedIdentifier(value.adapterRevision) ||
    !(
      value.modelRevision === null ||
      boundedIdentifier(value.modelRevision)
    ) ||
    !(
      value.referenceManifestHash === null ||
      (typeof value.referenceManifestHash === "string" &&
        SHA256_PATTERN.test(value.referenceManifestHash))
    ) ||
    !Array.isArray(value.coveredParticipantIds) ||
    !Array.isArray(value.missingParticipantIds) ||
    !boundedIdentifier(value.adapterFenceKey) ||
    !Array.isArray(value.cells)
  ) {
    return null;
  }

  let coveredParticipantIds: readonly CandidatePassBParticipantId[];
  try {
    coveredParticipantIds = canonicalParticipantIds(
      value.coveredParticipantIds as readonly CandidatePassBParticipantId[],
      participantIds,
    );
  } catch {
    return null;
  }
  const missingIds =
    adapter === "transcript-names"
      ? []
      : missingParticipantIds(coveredParticipantIds, participantIds);
  if (
    JSON.stringify(value.coveredParticipantIds) !==
      JSON.stringify(coveredParticipantIds) ||
    JSON.stringify(value.missingParticipantIds) !== JSON.stringify(missingIds)
  ) {
    return null;
  }

  let voiceRecognitionPolicy: BroadcastParticipantVoiceRecognitionPolicy | null =
    null;
  if (adapter === "voice-identity" && value.voiceRecognitionPolicy !== null) {
    if (!isRecord(value.voiceRecognitionPolicy)) return null;
    try {
      voiceRecognitionPolicy = canonicalVoiceRecognitionPolicy(
        value.voiceRecognitionPolicy as unknown as BroadcastParticipantVoiceRecognitionPolicyInput,
        coveredParticipantIds,
      );
    } catch {
      return null;
    }
    if (
      JSON.stringify(value.voiceRecognitionPolicy) !==
      JSON.stringify(voiceRecognitionPolicy)
    ) {
      return null;
    }
  } else if (value.voiceRecognitionPolicy !== null) {
    return null;
  }

  const availability = value.availability as "enabled" | "unavailable";
  const unavailableReason =
    typeof value.unavailableReason === "string" &&
    BROADCAST_PARTICIPANT_UNAVAILABLE_REASONS.has(
      value.unavailableReason as BroadcastParticipantAdapterUnavailableReason,
    )
      ? (value.unavailableReason as BroadcastParticipantAdapterUnavailableReason)
      : null;
  if (
    (availability === "enabled" && value.unavailableReason !== null) ||
    (availability === "unavailable" &&
      unavailableReason === null)
  ) {
    return null;
  }

  if (
    adapter === "transcript-names" &&
    (availability !== "enabled" ||
      value.modelRevision === null ||
      value.referenceManifestHash !== null ||
      coveredParticipantIds.length !== 0 ||
      missingIds.length !== 0 ||
      voiceRecognitionPolicy !== null)
  ) {
    return null;
  }
  if (
    adapter === "visual-identity" &&
    (voiceRecognitionPolicy !== null ||
      (availability === "enabled" &&
        (value.modelRevision === null ||
          (value.referenceManifestHash === null &&
            coveredParticipantIds.length > 0) ||
          (value.referenceManifestHash !== null &&
            coveredParticipantIds.length === 0))))
  ) {
    return null;
  }
  if (
    adapter === "voice-identity" &&
    availability === "enabled" &&
    (value.modelRevision === null ||
      value.referenceManifestHash === null ||
      coveredParticipantIds.length === 0 ||
      voiceRecognitionPolicy === null)
  ) {
    return null;
  }

  let cells: readonly BroadcastParticipantGroundingCellPlan[] = [];
  if (availability === "enabled") {
    if (
      value.cells.some(
        (cell) =>
          !isRecord(cell) ||
          !hasExactKeys(cell, [
            "cellId",
            "adapter",
            "ordinal",
            "sourceStartMs",
            "sourceEndMs",
            "sourceUnitId",
            "frameTimestampsMs",
            "bundleReuse",
          ]) ||
          cell.adapter !== adapter ||
          !Array.isArray(cell.frameTimestampsMs),
      )
    ) {
      return null;
    }
    try {
      cells = createCells(
        adapter,
        (value.cells as readonly BroadcastParticipantGroundingCellPlan[]).map(
          (cell) => ({
            sourceStartMs: cell.sourceStartMs,
            sourceEndMs: cell.sourceEndMs,
            sourceUnitId: cell.sourceUnitId,
            ...(adapter === "visual-identity"
              ? { frameTimestampsMs: cell.frameTimestampsMs }
              : {}),
          }),
        ),
        sourceFence,
      );
    } catch {
      return null;
    }
    if (JSON.stringify(value.cells) !== JSON.stringify(cells)) return null;
  } else if (value.cells.length !== 0) {
    return null;
  }

  if (availability === "enabled") {
    if (value.modelRevision === null) return null;
    return {
      adapter,
      availability,
      adapterRevision: value.adapterRevision,
      modelRevision: value.modelRevision,
      referenceManifestHash: value.referenceManifestHash,
      coveredParticipantIds,
      missingParticipantIds: missingIds,
      voiceRecognitionPolicy,
      unavailableReason: null,
      adapterFenceKey: value.adapterFenceKey,
      cells,
    };
  }
  if (adapter === "transcript-names") return null;
  return {
    adapter,
    availability,
    adapterRevision: value.adapterRevision,
    modelRevision: value.modelRevision,
    referenceManifestHash: value.referenceManifestHash,
    coveredParticipantIds,
    missingParticipantIds: missingIds,
    voiceRecognitionPolicy,
    unavailableReason: unavailableReason!,
    adapterFenceKey: value.adapterFenceKey,
    cells: [],
  };
}

/**
 * Reopens one current-schema plan without trusting its stored fingerprints.
 * Every cell and adapter fence is rebuilt from the persisted source-time plan,
 * then the top-level plan fingerprint is recalculated.
 */
export async function normalizeBroadcastParticipantGroundingPlan(
  value: unknown,
  digestAdapter: ContentDigestAdapter | null = globalThis.crypto?.subtle ??
    null,
): Promise<BroadcastParticipantGroundingPlan | null> {
  if (
    digestAdapter === null ||
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "planRevision",
      "planFingerprint",
      "sourceFence",
      "expectedParticipantIds",
      "adapters",
      "bundleReuseIndex",
    ]) ||
    value.schemaVersion !==
      BROADCAST_PARTICIPANT_GROUNDING_PLAN_SCHEMA_VERSION ||
    value.planRevision !== BROADCAST_PARTICIPANT_GROUNDING_PLAN_REVISION ||
    typeof value.planFingerprint !== "string" ||
    !SHA256_PATTERN.test(value.planFingerprint) ||
    !isRecord(value.sourceFence) ||
    !hasExactKeys(value.sourceFence, [
      "sourceFingerprint",
      "sourceDurationMs",
      "transcriptSeal",
      "castRosterId",
      "catalogVersion",
      "groundingSchemaVersion",
      "samplingPlanRevision",
    ]) ||
    value.sourceFence.catalogVersion !==
      CANDIDATE_PASS_B_CAST_ROSTER_VERSION ||
    value.sourceFence.groundingSchemaVersion !==
      BROADCAST_PARTICIPANT_GROUNDING_SCHEMA_VERSION ||
    !Array.isArray(value.expectedParticipantIds) ||
    !Array.isArray(value.adapters) ||
    value.adapters.length !== BROADCAST_PARTICIPANT_ADAPTER_ORDER.length ||
    !isRecord(value.bundleReuseIndex)
  ) {
    return null;
  }

  const sourceFence = value.sourceFence as unknown as BroadcastParticipantGroundingSourceFence;
  try {
    assertSourceFenceInput({
      sourceFingerprint: sourceFence.sourceFingerprint,
      sourceDurationMs: sourceFence.sourceDurationMs,
      transcriptSeal: sourceFence.transcriptSeal,
      castRosterId: sourceFence.castRosterId,
      samplingPlanRevision: sourceFence.samplingPlanRevision,
      transcript: {
        adapterRevision: "stored-plan-validation",
        modelRevision: "stored-plan-validation",
        cells: [],
      },
      visual: {
        adapterRevision: "stored-plan-validation",
        modelRevision: null,
        referenceManifestHash: null,
        referenceParticipantIds: [],
        cells: [],
      },
      voice: {
        adapterRevision: "stored-plan-validation",
        segmentationModelRevision: null,
        enrollmentManifest: null,
        recognitionPolicy: null,
        cells: [],
      },
    });
  } catch {
    return null;
  }
  const participantIds = expectedParticipantIds(sourceFence.castRosterId);
  if (
    JSON.stringify(value.expectedParticipantIds) !==
    JSON.stringify(participantIds)
  ) {
    return null;
  }

  const adapters: BroadcastParticipantGroundingAdapterPlan[] = [];
  for (const [index, adapter] of BROADCAST_PARTICIPANT_ADAPTER_ORDER.entries()) {
    const canonical = canonicalStoredAdapterPlan(
      value.adapters[index],
      adapter,
      sourceFence,
      participantIds,
    );
    if (canonical === null) return null;
    const expectedFenceKey = await adapterFenceKey({
      sourceFence,
      adapter,
      adapterRevision: canonical.adapterRevision,
      modelRevision: canonical.modelRevision,
      referenceManifestHash: canonical.referenceManifestHash,
      coveredParticipantIds: canonical.coveredParticipantIds,
      missingParticipantIds: canonical.missingParticipantIds,
      voiceRecognitionPolicy: canonical.voiceRecognitionPolicy,
      availability: canonical.availability,
      unavailableReason: canonical.unavailableReason,
      digestAdapter,
    });
    if (canonical.adapterFenceKey !== expectedFenceKey) return null;
    adapters.push(canonical);
  }

  const canonicalAdapters = adapters as unknown as BroadcastParticipantGroundingPlan["adapters"];
  const canonicalBundleReuseIndex = bundleReuseIndex(canonicalAdapters);
  if (
    JSON.stringify(value.bundleReuseIndex) !==
    JSON.stringify(canonicalBundleReuseIndex)
  ) {
    return null;
  }
  const planFingerprint = await createContentFingerprint(
    [
      "exclipper.broadcast-participant-grounding-plan.v1",
      JSON.stringify({
        schemaVersion: BROADCAST_PARTICIPANT_GROUNDING_PLAN_SCHEMA_VERSION,
        planRevision: BROADCAST_PARTICIPANT_GROUNDING_PLAN_REVISION,
        sourceFence,
        expectedParticipantIds: participantIds,
        adapters: canonicalAdapters,
        bundleReuseIndex: canonicalBundleReuseIndex,
      }),
    ],
    digestAdapter,
  );
  if (value.planFingerprint !== planFingerprint) return null;
  const canonical: BroadcastParticipantGroundingPlan = {
    schemaVersion: BROADCAST_PARTICIPANT_GROUNDING_PLAN_SCHEMA_VERSION,
    planRevision: BROADCAST_PARTICIPANT_GROUNDING_PLAN_REVISION,
    planFingerprint,
    sourceFence,
    expectedParticipantIds: participantIds,
    adapters: canonicalAdapters,
    bundleReuseIndex: canonicalBundleReuseIndex,
  };
  return JSON.stringify(value) === JSON.stringify(canonical)
    ? canonical
    : null;
}

function adapterFor(
  plan: BroadcastParticipantGroundingPlan,
  adapter: BroadcastParticipantGroundingPlanAdapter,
): BroadcastParticipantGroundingAdapterPlan {
  const found = plan.adapters.find((item) => item.adapter === adapter);
  if (found === undefined) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "UNKNOWN_CELL_RECEIPT",
      "The receipt adapter is not part of this grounding plan.",
    );
  }
  return found;
}

function plannedCellFor(
  plan: BroadcastParticipantGroundingPlan,
  adapter: BroadcastParticipantGroundingPlanAdapter,
  cellId: string,
): {
  readonly adapterPlan: BroadcastParticipantGroundingAdapterPlan;
  readonly cell: BroadcastParticipantGroundingCellPlan;
} {
  const adapterPlan = adapterFor(plan, adapter);
  const cell = adapterPlan.cells.find((item) => item.cellId === cellId);
  if (cell === undefined) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "UNKNOWN_CELL_RECEIPT",
      "The receipt does not name an enabled cell in this plan.",
    );
  }
  return { adapterPlan, cell };
}

function assertOperationIdentity(
  operationId: string,
  attemptOrdinal: number,
): void {
  if (
    !boundedIdentifier(operationId) ||
    !Number.isSafeInteger(attemptOrdinal) ||
    attemptOrdinal < 0 ||
    attemptOrdinal > MAX_OPERATION_ATTEMPT_ORDINAL
  ) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_CELL_RECEIPT",
      "The grounding operation identity is outside the bounded contract.",
    );
  }
}

function receiptBase(
  plan: BroadcastParticipantGroundingPlan,
  adapter: BroadcastParticipantGroundingPlanAdapter,
  cellId: string,
  operationId: string,
  attemptOrdinal: number,
): BroadcastParticipantGroundingCellReceiptBase {
  assertOperationIdentity(operationId, attemptOrdinal);
  const { adapterPlan, cell } = plannedCellFor(plan, adapter, cellId);
  return {
    schemaVersion: BROADCAST_PARTICIPANT_GROUNDING_PLAN_SCHEMA_VERSION,
    planRevision: BROADCAST_PARTICIPANT_GROUNDING_PLAN_REVISION,
    planFingerprint: plan.planFingerprint,
    sourceFingerprint: plan.sourceFence.sourceFingerprint,
    sourceDurationMs: plan.sourceFence.sourceDurationMs,
    transcriptSeal: plan.sourceFence.transcriptSeal,
    samplingPlanRevision: plan.sourceFence.samplingPlanRevision,
    adapterFenceKey: adapterPlan.adapterFenceKey,
    adapter,
    adapterRevision: adapterPlan.adapterRevision,
    modelRevision: adapterPlan.modelRevision,
    referenceManifestHash: adapterPlan.referenceManifestHash,
    cellId,
    sourceStartMs: cell.sourceStartMs,
    sourceEndMs: cell.sourceEndMs,
    audioBundleReuseKey: cell.bundleReuse.audioBundleReuseKey,
    frameBundleReuseKey: cell.bundleReuse.frameBundleReuseKey,
    operationId,
    attemptOrdinal,
  };
}

function canonicalTerminalParticipantIds(
  plan: BroadcastParticipantGroundingPlan,
  participantIds: readonly CandidatePassBParticipantId[],
): readonly CandidatePassBParticipantId[] {
  const expected = new Set(plan.expectedParticipantIds);
  const unique = new Set<CandidatePassBParticipantId>();
  for (const participantId of participantIds) {
    if (!expected.has(participantId) || unique.has(participantId)) {
      throw new BroadcastParticipantGroundingPlanContractError(
        "INVALID_CELL_RECEIPT",
        "A terminal cell contains an unknown or duplicate participant ID.",
      );
    }
    unique.add(participantId);
  }
  return plan.expectedParticipantIds.filter((participantId) =>
    unique.has(participantId),
  );
}

function terminalOutcomeAllowedForAdapter(
  adapter: BroadcastParticipantGroundingPlanAdapter,
  outcome: BroadcastParticipantGroundingTerminalOutcome,
): boolean {
  switch (adapter) {
    case "transcript-names":
      return outcome === "identified" || outcome === "none";
    case "visual-identity":
      return (
        outcome === "identified" ||
        outcome === "none" ||
        outcome === "unidentified"
      );
    case "voice-identity":
      return (
        outcome === "identified" ||
        outcome === "unidentified" ||
        outcome === "no-speech"
      );
  }
}

function voiceRecognitionProjectionBase(
  plan: BroadcastParticipantGroundingPlan,
  adapterPlan: BroadcastParticipantGroundingEnabledAdapterPlan,
  cell: BroadcastParticipantGroundingCellPlan,
  rankedMatches: readonly BroadcastParticipantVoiceRecognitionScore[],
): BroadcastParticipantVoiceRecognitionProjectionBase {
  const policy = adapterPlan.voiceRecognitionPolicy;
  if (
    adapterPlan.adapter !== "voice-identity" ||
    policy === null ||
    adapterPlan.modelRevision === null
  ) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_CELL_RECEIPT",
      "Voice recognition requires an enabled, policy-fenced voice adapter.",
    );
  }
  return {
    schemaVersion: BROADCAST_PARTICIPANT_VOICE_RECOGNITION_POLICY_VERSION,
    planFingerprint: plan.planFingerprint,
    sourceFingerprint: plan.sourceFence.sourceFingerprint,
    adapterFenceKey: adapterPlan.adapterFenceKey,
    modelRevision: adapterPlan.modelRevision,
    policyRevision: policy.policyRevision,
    cellId: cell.cellId,
    sourceStartMs: cell.sourceStartMs,
    sourceEndMs: cell.sourceEndMs,
    coveredParticipantIds: adapterPlan.coveredParticipantIds,
    missingParticipantIds: adapterPlan.missingParticipantIds,
    rankedMatches,
    minimumTop1Top2Margin: policy.minimumTop1Top2Margin,
  };
}

/**
 * Projects already-computed normalized speaker scores into a fail-closed
 * identity decision. This function does not decode media, create embeddings,
 * or claim that an inference adapter exists.
 */
export function projectBroadcastParticipantVoiceRecognition(
  input: CreateBroadcastParticipantVoiceRecognitionProjectionInput,
): BroadcastParticipantVoiceRecognitionProjection {
  const { adapterPlan, cell } = plannedCellFor(
    input.plan,
    "voice-identity",
    input.cellId,
  );
  if (
    adapterPlan.availability !== "enabled" ||
    adapterPlan.adapter !== "voice-identity" ||
    adapterPlan.voiceRecognitionPolicy === null ||
    input.adapterFenceKey !== adapterPlan.adapterFenceKey ||
    input.modelRevision !== adapterPlan.modelRevision
  ) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_CELL_RECEIPT",
      "Voice scores do not match the enabled model and recognition-policy fence.",
    );
  }
  if (
    !["speech", "no-speech"].includes(input.speechActivity) ||
    !Array.isArray(input.scores)
  ) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_CELL_RECEIPT",
      "Voice recognition requires an explicit speech activity result.",
    );
  }
  if (input.speechActivity === "no-speech") {
    if (input.scores.length > 0) {
      throw new BroadcastParticipantGroundingPlanContractError(
        "INVALID_CELL_RECEIPT",
        "A no-speech result cannot carry speaker similarity scores.",
      );
    }
    return {
      ...voiceRecognitionProjectionBase(input.plan, adapterPlan, cell, []),
      speechActivity: "no-speech",
      outcome: "no-speech",
      participantId: null,
      confidence: null,
      applicableAbsoluteMatchThreshold: null,
      observedTop1Top2Margin: null,
      abstentionReason: null,
    };
  }

  const covered = new Set(adapterPlan.coveredParticipantIds);
  const scoreByParticipantId = new Map<CandidatePassBParticipantId, number>();
  for (const score of input.scores) {
    if (
      !isRecord(score) ||
      !hasExactKeys(score, ["participantId", "normalizedSimilarity"]) ||
      !covered.has(score.participantId as CandidatePassBParticipantId) ||
      !isNormalizedSimilarity(score.normalizedSimilarity) ||
      scoreByParticipantId.has(
        score.participantId as CandidatePassBParticipantId,
      )
    ) {
      throw new BroadcastParticipantGroundingPlanContractError(
        "INVALID_CELL_RECEIPT",
        "Voice scores must cover each enrolled participant exactly once.",
      );
    }
    scoreByParticipantId.set(
      score.participantId as CandidatePassBParticipantId,
      score.normalizedSimilarity,
    );
  }
  if (scoreByParticipantId.size !== adapterPlan.coveredParticipantIds.length) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_CELL_RECEIPT",
      "Voice scores must cover each enrolled participant exactly once.",
    );
  }
  const rosterOrdinal = new Map(
    adapterPlan.coveredParticipantIds.map((participantId, ordinal) => [
      participantId,
      ordinal,
    ]),
  );
  const rankedMatches = adapterPlan.coveredParticipantIds
    .map((participantId) => ({
      participantId,
      normalizedSimilarity: scoreByParticipantId.get(participantId)!,
    }))
    .sort(
      (left, right) =>
        right.normalizedSimilarity - left.normalizedSimilarity ||
        (rosterOrdinal.get(left.participantId) ?? 0) -
          (rosterOrdinal.get(right.participantId) ?? 0),
    );
  const base = voiceRecognitionProjectionBase(
    input.plan,
    adapterPlan,
    cell,
    rankedMatches,
  );
  const top1 = rankedMatches[0];
  const top2 = rankedMatches[1];
  if (top1 === undefined || top2 === undefined) {
    return {
      ...base,
      speechActivity: "speech",
      outcome: "unidentified",
      participantId: PARTICIPANT_VOICE_UNKNOWN_ID,
      confidence: null,
      applicableAbsoluteMatchThreshold: null,
      observedTop1Top2Margin: null,
      abstentionReason: "insufficient-covered-comparators",
    };
  }
  const threshold =
    adapterPlan.voiceRecognitionPolicy.absoluteMatchThresholds.find(
      ({ participantId }) => participantId === top1.participantId,
    )?.minimumNormalizedSimilarity;
  if (threshold === undefined) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_CELL_RECEIPT",
      "The top voice match has no source-fenced absolute threshold.",
    );
  }
  const observedMargin = top1.normalizedSimilarity - top2.normalizedSimilarity;
  if (top1.normalizedSimilarity < threshold) {
    return {
      ...base,
      speechActivity: "speech",
      outcome: "unidentified",
      participantId: PARTICIPANT_VOICE_UNKNOWN_ID,
      confidence: null,
      applicableAbsoluteMatchThreshold: threshold,
      observedTop1Top2Margin: observedMargin,
      abstentionReason: "below-absolute-threshold",
    };
  }
  if (
    observedMargin < adapterPlan.voiceRecognitionPolicy.minimumTop1Top2Margin
  ) {
    return {
      ...base,
      speechActivity: "speech",
      outcome: "unidentified",
      participantId: PARTICIPANT_VOICE_UNKNOWN_ID,
      confidence: null,
      applicableAbsoluteMatchThreshold: threshold,
      observedTop1Top2Margin: observedMargin,
      abstentionReason: "below-top1-top2-margin",
    };
  }
  return {
    ...base,
    speechActivity: "speech",
    outcome: "identified",
    participantId: top1.participantId,
    confidence: top1.normalizedSimilarity,
    applicableAbsoluteMatchThreshold: threshold,
    observedTop1Top2Margin: observedMargin,
    abstentionReason: null,
  };
}

function normalizeBroadcastParticipantVoiceRecognitionProjection(
  value: unknown,
  plan: BroadcastParticipantGroundingPlan,
  cellId: string,
): BroadcastParticipantVoiceRecognitionProjection | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "planFingerprint",
      "sourceFingerprint",
      "adapterFenceKey",
      "modelRevision",
      "policyRevision",
      "cellId",
      "sourceStartMs",
      "sourceEndMs",
      "coveredParticipantIds",
      "missingParticipantIds",
      "rankedMatches",
      "minimumTop1Top2Margin",
      "speechActivity",
      "outcome",
      "participantId",
      "confidence",
      "applicableAbsoluteMatchThreshold",
      "observedTop1Top2Margin",
      "abstentionReason",
    ]) ||
    value.cellId !== cellId ||
    !Array.isArray(value.rankedMatches) ||
    !["speech", "no-speech"].includes(value.speechActivity as string)
  ) {
    return null;
  }
  try {
    const projected = projectBroadcastParticipantVoiceRecognition({
      plan,
      cellId,
      adapterFenceKey: value.adapterFenceKey as string,
      modelRevision: value.modelRevision as string,
      speechActivity: value.speechActivity as "speech" | "no-speech",
      scores:
        value.speechActivity === "speech"
          ? (value.rankedMatches as readonly BroadcastParticipantVoiceRecognitionScore[])
          : [],
    });
    return JSON.stringify(projected) === JSON.stringify(value)
      ? projected
      : null;
  } catch {
    return null;
  }
}

export function createBroadcastParticipantGroundingTerminalReceipt(
  input: CreateBroadcastParticipantGroundingTerminalReceiptInput,
): BroadcastParticipantGroundingTerminalCellReceipt {
  const participantIds = canonicalTerminalParticipantIds(
    input.plan,
    input.participantIds ?? [],
  );
  const confidence = input.confidence ?? null;
  const voiceRecognition =
    input.adapter === "voice-identity"
      ? normalizeBroadcastParticipantVoiceRecognitionProjection(
          input.voiceRecognition,
          input.plan,
          input.cellId,
        )
      : null;
  if (
    !["identified", "none", "unidentified", "no-speech"].includes(
      input.outcome,
    ) ||
    !terminalOutcomeAllowedForAdapter(input.adapter, input.outcome) ||
    (input.outcome === "identified"
      ? participantIds.length === 0 ||
        typeof confidence !== "number" ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1
      : participantIds.length > 0 || confidence !== null) ||
    (input.adapter === "voice-identity"
      ? voiceRecognition === null ||
        voiceRecognition.outcome !== input.outcome ||
        (voiceRecognition.outcome === "identified"
          ? participantIds.length !== 1 ||
            participantIds[0] !== voiceRecognition.participantId ||
            confidence !== voiceRecognition.confidence
          : participantIds.length > 0 || confidence !== null)
      : input.voiceRecognition !== undefined && input.voiceRecognition !== null)
  ) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_CELL_RECEIPT",
      "Only a policy-projected voice result or an identified non-voice cell may carry participants and confidence.",
    );
  }
  return {
    ...receiptBase(
      input.plan,
      input.adapter,
      input.cellId,
      input.operationId,
      input.attemptOrdinal,
    ),
    status: "terminal",
    outcome: input.outcome,
    participantIds,
    confidence,
    voiceRecognition,
  };
}

export function createBroadcastParticipantGroundingGapReceipt(
  input: CreateBroadcastParticipantGroundingGapReceiptInput,
): BroadcastParticipantGroundingGapCellReceipt {
  if (
    !["retryable", "outcome-unknown"].includes(input.disposition) ||
    ![
      "source-decode-failed",
      "model-load-failed",
      "inference-failed",
      "rate-limited",
      "invalid-model-output",
      "runtime-unavailable",
      "operation-interrupted",
    ].includes(input.reason)
  ) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_CELL_RECEIPT",
      "The grounding gap classification is invalid.",
    );
  }
  return {
    ...receiptBase(
      input.plan,
      input.adapter,
      input.cellId,
      input.operationId,
      input.attemptOrdinal,
    ),
    status: "gap",
    disposition: input.disposition,
    reason: input.reason,
  };
}

export function createBroadcastParticipantGroundingNoneObservedReceipt(
  input: CreateBroadcastParticipantGroundingNoneObservedReceiptInput,
): BroadcastParticipantGroundingNoneObservedReceipt {
  assertOperationIdentity(input.operationId, input.attemptOrdinal);
  const adapterPlan = adapterFor(input.plan, input.adapter);
  if (adapterPlan.availability !== "unavailable") {
    throw new BroadcastParticipantGroundingPlanContractError(
      "INVALID_CELL_RECEIPT",
      "A none-observed receipt is valid only for an unavailable media adapter.",
    );
  }
  return {
    schemaVersion: BROADCAST_PARTICIPANT_GROUNDING_PLAN_SCHEMA_VERSION,
    planRevision: BROADCAST_PARTICIPANT_GROUNDING_PLAN_REVISION,
    planFingerprint: input.plan.planFingerprint,
    sourceFingerprint: input.plan.sourceFence.sourceFingerprint,
    sourceDurationMs: input.plan.sourceFence.sourceDurationMs,
    transcriptSeal: input.plan.sourceFence.transcriptSeal,
    samplingPlanRevision: input.plan.sourceFence.samplingPlanRevision,
    adapterFenceKey: adapterPlan.adapterFenceKey,
    adapter: input.adapter,
    adapterRevision: adapterPlan.adapterRevision,
    modelRevision: adapterPlan.modelRevision,
    referenceManifestHash: adapterPlan.referenceManifestHash,
    sourceStartMs: 0,
    sourceEndMs: input.plan.sourceFence.sourceDurationMs,
    operationId: input.operationId,
    attemptOrdinal: input.attemptOrdinal,
    status: "terminal",
    outcome: "none-observed",
    unavailableReason: adapterPlan.unavailableReason,
  };
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

function receiptMatchesCell(
  value: Record<string, unknown>,
  plan: BroadcastParticipantGroundingPlan,
  adapterPlan: BroadcastParticipantGroundingAdapterPlan,
  cell: BroadcastParticipantGroundingCellPlan,
): boolean {
  return (
    value.schemaVersion ===
      BROADCAST_PARTICIPANT_GROUNDING_PLAN_SCHEMA_VERSION &&
    value.planRevision === BROADCAST_PARTICIPANT_GROUNDING_PLAN_REVISION &&
    value.planFingerprint === plan.planFingerprint &&
    value.sourceFingerprint === plan.sourceFence.sourceFingerprint &&
    value.sourceDurationMs === plan.sourceFence.sourceDurationMs &&
    value.transcriptSeal === plan.sourceFence.transcriptSeal &&
    value.samplingPlanRevision === plan.sourceFence.samplingPlanRevision &&
    value.adapterFenceKey === adapterPlan.adapterFenceKey &&
    value.adapter === adapterPlan.adapter &&
    value.adapterRevision === adapterPlan.adapterRevision &&
    value.modelRevision === adapterPlan.modelRevision &&
    value.referenceManifestHash === adapterPlan.referenceManifestHash &&
    value.cellId === cell.cellId &&
    value.sourceStartMs === cell.sourceStartMs &&
    value.sourceEndMs === cell.sourceEndMs &&
    value.audioBundleReuseKey === cell.bundleReuse.audioBundleReuseKey &&
    value.frameBundleReuseKey === cell.bundleReuse.frameBundleReuseKey &&
    boundedIdentifier(value.operationId) &&
    Number.isSafeInteger(value.attemptOrdinal) &&
    (value.attemptOrdinal as number) >= 0 &&
    (value.attemptOrdinal as number) <= MAX_OPERATION_ATTEMPT_ORDINAL
  );
}

export function normalizeBroadcastParticipantGroundingCellReceipt(
  value: unknown,
  plan: BroadcastParticipantGroundingPlan,
): BroadcastParticipantGroundingCellReceipt | null {
  if (!isRecord(value) || typeof value.adapter !== "string") return null;
  const adapterPlan = plan.adapters.find(
    ({ adapter }) => adapter === value.adapter,
  );
  if (adapterPlan === undefined || adapterPlan.availability !== "enabled") {
    return null;
  }
  const cell = adapterPlan.cells.find(({ cellId }) => cellId === value.cellId);
  if (
    cell === undefined ||
    !receiptMatchesCell(value, plan, adapterPlan, cell)
  ) {
    return null;
  }
  if (value.status === "terminal") {
    if (
      !hasExactKeys(value, [
        "schemaVersion",
        "planRevision",
        "planFingerprint",
        "sourceFingerprint",
        "sourceDurationMs",
        "transcriptSeal",
        "samplingPlanRevision",
        "adapterFenceKey",
        "adapter",
        "adapterRevision",
        "modelRevision",
        "referenceManifestHash",
        "cellId",
        "sourceStartMs",
        "sourceEndMs",
        "audioBundleReuseKey",
        "frameBundleReuseKey",
        "operationId",
        "attemptOrdinal",
        "status",
        "outcome",
        "participantIds",
        "confidence",
        "voiceRecognition",
      ]) ||
      !["identified", "none", "unidentified", "no-speech"].includes(
        value.outcome as string,
      ) ||
      !terminalOutcomeAllowedForAdapter(
        adapterPlan.adapter,
        value.outcome as BroadcastParticipantGroundingTerminalOutcome,
      ) ||
      !Array.isArray(value.participantIds)
    ) {
      return null;
    }
    let participantIds: readonly CandidatePassBParticipantId[];
    try {
      participantIds = canonicalTerminalParticipantIds(
        plan,
        value.participantIds as readonly CandidatePassBParticipantId[],
      );
    } catch {
      return null;
    }
    const identified = value.outcome === "identified";
    const voiceRecognition =
      adapterPlan.adapter === "voice-identity"
        ? normalizeBroadcastParticipantVoiceRecognitionProjection(
            value.voiceRecognition,
            plan,
            cell.cellId,
          )
        : null;
    if (
      (identified
        ? participantIds.length === 0 ||
          typeof value.confidence !== "number" ||
          !Number.isFinite(value.confidence) ||
          value.confidence < 0 ||
          value.confidence > 1
        : participantIds.length > 0 || value.confidence !== null) ||
      (adapterPlan.adapter === "voice-identity"
        ? voiceRecognition === null ||
          voiceRecognition.outcome !== value.outcome ||
          (voiceRecognition.outcome === "identified"
            ? participantIds.length !== 1 ||
              participantIds[0] !== voiceRecognition.participantId ||
              value.confidence !== voiceRecognition.confidence
            : participantIds.length > 0 || value.confidence !== null)
        : value.voiceRecognition !== null)
    ) {
      return null;
    }
    return {
      ...(value as unknown as BroadcastParticipantGroundingTerminalCellReceipt),
      participantIds,
      voiceRecognition,
    };
  }
  if (
    value.status !== "gap" ||
    !hasExactKeys(value, [
      "schemaVersion",
      "planRevision",
      "planFingerprint",
      "sourceFingerprint",
      "sourceDurationMs",
      "transcriptSeal",
      "samplingPlanRevision",
      "adapterFenceKey",
      "adapter",
      "adapterRevision",
      "modelRevision",
      "referenceManifestHash",
      "cellId",
      "sourceStartMs",
      "sourceEndMs",
      "audioBundleReuseKey",
      "frameBundleReuseKey",
      "operationId",
      "attemptOrdinal",
      "status",
      "disposition",
      "reason",
    ]) ||
    !["retryable", "outcome-unknown"].includes(value.disposition as string) ||
    ![
      "source-decode-failed",
      "model-load-failed",
      "inference-failed",
      "rate-limited",
      "invalid-model-output",
      "runtime-unavailable",
      "operation-interrupted",
    ].includes(value.reason as string)
  ) {
    return null;
  }
  return value as unknown as BroadcastParticipantGroundingGapCellReceipt;
}

export function normalizeBroadcastParticipantGroundingNoneObservedReceipt(
  value: unknown,
  plan: BroadcastParticipantGroundingPlan,
): BroadcastParticipantGroundingNoneObservedReceipt | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "planRevision",
      "planFingerprint",
      "sourceFingerprint",
      "sourceDurationMs",
      "transcriptSeal",
      "samplingPlanRevision",
      "adapterFenceKey",
      "adapter",
      "adapterRevision",
      "modelRevision",
      "referenceManifestHash",
      "sourceStartMs",
      "sourceEndMs",
      "operationId",
      "attemptOrdinal",
      "status",
      "outcome",
      "unavailableReason",
    ]) ||
    !["visual-identity", "voice-identity"].includes(
      typeof value.adapter === "string" ? value.adapter : "",
    )
  ) {
    return null;
  }
  const adapterPlan = plan.adapters.find(
    ({ adapter }) => adapter === value.adapter,
  );
  if (
    adapterPlan === undefined ||
    adapterPlan.availability !== "unavailable" ||
    value.schemaVersion !==
      BROADCAST_PARTICIPANT_GROUNDING_PLAN_SCHEMA_VERSION ||
    value.planRevision !== BROADCAST_PARTICIPANT_GROUNDING_PLAN_REVISION ||
    value.planFingerprint !== plan.planFingerprint ||
    value.sourceFingerprint !== plan.sourceFence.sourceFingerprint ||
    value.sourceDurationMs !== plan.sourceFence.sourceDurationMs ||
    value.transcriptSeal !== plan.sourceFence.transcriptSeal ||
    value.samplingPlanRevision !== plan.sourceFence.samplingPlanRevision ||
    value.adapterFenceKey !== adapterPlan.adapterFenceKey ||
    value.adapterRevision !== adapterPlan.adapterRevision ||
    value.modelRevision !== adapterPlan.modelRevision ||
    value.referenceManifestHash !== adapterPlan.referenceManifestHash ||
    value.sourceStartMs !== 0 ||
    value.sourceEndMs !== plan.sourceFence.sourceDurationMs ||
    value.status !== "terminal" ||
    value.outcome !== "none-observed" ||
    value.unavailableReason !== adapterPlan.unavailableReason ||
    !boundedIdentifier(value.operationId) ||
    !Number.isSafeInteger(value.attemptOrdinal) ||
    (value.attemptOrdinal as number) < 0 ||
    (value.attemptOrdinal as number) > MAX_OPERATION_ATTEMPT_ORDINAL
  ) {
    return null;
  }
  return value as unknown as BroadcastParticipantGroundingNoneObservedReceipt;
}

interface CanonicalBroadcastParticipantGroundingReceipts {
  readonly cellReceipts: readonly BroadcastParticipantGroundingCellReceipt[];
  readonly noneObservedReceipts: readonly BroadcastParticipantGroundingNoneObservedReceipt[];
}

function canonicalReceipts(
  plan: BroadcastParticipantGroundingPlan,
  receipts: readonly unknown[],
): CanonicalBroadcastParticipantGroundingReceipts {
  const cellReceipts: BroadcastParticipantGroundingCellReceipt[] = [];
  const noneObservedReceipts: BroadcastParticipantGroundingNoneObservedReceipt[] =
    [];
  for (const receipt of receipts) {
    const cellReceipt = normalizeBroadcastParticipantGroundingCellReceipt(
      receipt,
      plan,
    );
    const noneObservedReceipt =
      normalizeBroadcastParticipantGroundingNoneObservedReceipt(receipt, plan);
    if (
      (cellReceipt === null && noneObservedReceipt === null) ||
      (cellReceipt !== null && noneObservedReceipt !== null)
    ) {
      throw new BroadcastParticipantGroundingPlanContractError(
        "INVALID_CELL_RECEIPT",
        "A participant grounding receipt does not match the source/model/manifest/range fence.",
      );
    }
    if (cellReceipt !== null) {
      cellReceipts.push(cellReceipt);
    } else {
      noneObservedReceipts.push(noneObservedReceipt!);
    }
  }
  const receiptByCellId = new Map<
    string,
    BroadcastParticipantGroundingCellReceipt
  >();
  const noneObservedByAdapter = new Map<
    BroadcastParticipantMediaAdapter,
    BroadcastParticipantGroundingNoneObservedReceipt
  >();
  const operationIds = new Set<string>();
  for (const receipt of cellReceipts) {
    if (receiptByCellId.has(receipt.cellId)) {
      throw new BroadcastParticipantGroundingPlanContractError(
        "DUPLICATE_CELL_RECEIPT",
        "A grounding cell has more than one current receipt.",
      );
    }
    if (operationIds.has(receipt.operationId)) {
      throw new BroadcastParticipantGroundingPlanContractError(
        "DUPLICATE_CELL_RECEIPT",
        "A grounding operation identity was reused for another cell.",
      );
    }
    receiptByCellId.set(receipt.cellId, receipt);
    operationIds.add(receipt.operationId);
  }
  for (const receipt of noneObservedReceipts) {
    if (noneObservedByAdapter.has(receipt.adapter)) {
      throw new BroadcastParticipantGroundingPlanContractError(
        "DUPLICATE_CELL_RECEIPT",
        "An unavailable grounding adapter has more than one none-observed receipt.",
      );
    }
    if (operationIds.has(receipt.operationId)) {
      throw new BroadcastParticipantGroundingPlanContractError(
        "DUPLICATE_CELL_RECEIPT",
        "A grounding operation identity was reused for another receipt.",
      );
    }
    noneObservedByAdapter.set(receipt.adapter, receipt);
    operationIds.add(receipt.operationId);
  }
  const ordinalByCellId = new Map(
    plan.adapters
      .flatMap(({ cells }) => cells)
      .map((cell, index) => [cell.cellId, index]),
  );
  const adapterOrdinal = new Map(
    plan.adapters.map(({ adapter }, index) => [adapter, index]),
  );
  return {
    cellReceipts: cellReceipts.sort(
      (left, right) =>
        (ordinalByCellId.get(left.cellId) ?? Number.MAX_SAFE_INTEGER) -
        (ordinalByCellId.get(right.cellId) ?? Number.MAX_SAFE_INTEGER),
    ),
    noneObservedReceipts: noneObservedReceipts.sort(
      (left, right) =>
        (adapterOrdinal.get(left.adapter) ?? Number.MAX_SAFE_INTEGER) -
        (adapterOrdinal.get(right.adapter) ?? Number.MAX_SAFE_INTEGER),
    ),
  };
}

function requiredNoneObservedAdapters(
  plan: BroadcastParticipantGroundingPlan,
): readonly BroadcastParticipantMediaAdapter[] {
  if (plan.expectedParticipantIds.length === 0) return [];
  return plan.adapters.flatMap((adapter) =>
    adapter.adapter !== "transcript-names" &&
    adapter.availability === "unavailable"
      ? [adapter.adapter]
      : [],
  );
}

export function inspectBroadcastParticipantGroundingPlanCompletion(
  plan: BroadcastParticipantGroundingPlan,
  receipts: readonly unknown[],
): BroadcastParticipantGroundingCompletionInspection {
  const canonical = canonicalReceipts(plan, receipts);
  const plannedCells = plan.adapters.flatMap(({ cells }) => cells);
  const receiptByCellId = new Map(
    canonical.cellReceipts.map((receipt) => [receipt.cellId, receipt]),
  );
  const missingCellIds = plannedCells
    .filter(({ cellId }) => !receiptByCellId.has(cellId))
    .map(({ cellId }) => cellId);
  const retryableCellIds = canonical.cellReceipts.flatMap((receipt) =>
    receipt.status === "gap" && receipt.disposition === "retryable"
      ? [receipt.cellId]
      : [],
  );
  const outcomeUnknownCellIds = canonical.cellReceipts.flatMap((receipt) =>
    receipt.status === "gap" && receipt.disposition === "outcome-unknown"
      ? [receipt.cellId]
      : [],
  );
  const terminalCellCount = canonical.cellReceipts.filter(
    ({ status }) => status === "terminal",
  ).length;
  const requiredAdapters = requiredNoneObservedAdapters(plan);
  const terminalNoneObservedAdapters = new Set(
    canonical.noneObservedReceipts.map(({ adapter }) => adapter),
  );
  const missingNoneObservedAdapters = requiredAdapters.filter(
    (adapter) => !terminalNoneObservedAdapters.has(adapter),
  );
  return {
    planFingerprint: plan.planFingerprint,
    plannedCellCount: plannedCells.length,
    terminalCellCount,
    requiredNoneObservedAdapterCount: requiredAdapters.length,
    terminalNoneObservedAdapterCount: requiredAdapters.filter((adapter) =>
      terminalNoneObservedAdapters.has(adapter),
    ).length,
    missingCellIds,
    missingNoneObservedAdapters,
    retryableCellIds,
    outcomeUnknownCellIds,
    readyToSeal:
      terminalCellCount === plannedCells.length &&
      missingCellIds.length === 0 &&
      missingNoneObservedAdapters.length === 0 &&
      retryableCellIds.length === 0 &&
      outcomeUnknownCellIds.length === 0,
  };
}

export function sealBroadcastParticipantGroundingPlan(
  plan: BroadcastParticipantGroundingPlan,
  receipts: readonly unknown[],
): SealedBroadcastParticipantGroundingPlan {
  const inspection = inspectBroadcastParticipantGroundingPlanCompletion(
    plan,
    receipts,
  );
  if (!inspection.readyToSeal) {
    throw new BroadcastParticipantGroundingPlanContractError(
      "PLAN_INCOMPLETE",
      "Every enabled transcript, visual, and voice cell and every required unavailable-modality none-observed receipt must be terminal before participant grounding can be sealed.",
    );
  }
  const canonical = canonicalReceipts(plan, receipts);
  const terminalCells = canonical.cellReceipts.filter(
    (receipt): receipt is BroadcastParticipantGroundingTerminalCellReceipt =>
      receipt.status === "terminal",
  );
  const adapterReceipts = plan.adapters.map(
    (adapter): BroadcastParticipantGroundingAdapterCompletionReceipt =>
      adapter.availability === "unavailable"
        ? {
            adapter: adapter.adapter,
            adapterRevision: adapter.adapterRevision,
            modelRevision: adapter.modelRevision,
            referenceManifestHash: adapter.referenceManifestHash,
            coveredParticipantIds: adapter.coveredParticipantIds,
            missingParticipantIds: adapter.missingParticipantIds,
            voiceRecognitionPolicy: adapter.voiceRecognitionPolicy,
            adapterFenceKey: adapter.adapterFenceKey,
            status: "unavailable",
            inputCount: 0,
            processedCount: 0,
            unavailableReason: adapter.unavailableReason,
          }
        : {
            adapter: adapter.adapter,
            adapterRevision: adapter.adapterRevision,
            modelRevision: adapter.modelRevision,
            referenceManifestHash: adapter.referenceManifestHash,
            coveredParticipantIds: adapter.coveredParticipantIds,
            missingParticipantIds: adapter.missingParticipantIds,
            voiceRecognitionPolicy: adapter.voiceRecognitionPolicy,
            adapterFenceKey: adapter.adapterFenceKey,
            status: "completed",
            inputCount: adapter.cells.length,
            processedCount: adapter.cells.length,
            unavailableReason: null,
          },
  );
  return {
    schemaVersion: BROADCAST_PARTICIPANT_GROUNDING_PLAN_SCHEMA_VERSION,
    status: "sealed",
    planRevision: BROADCAST_PARTICIPANT_GROUNDING_PLAN_REVISION,
    planFingerprint: plan.planFingerprint,
    sourceFence: plan.sourceFence,
    expectedParticipantIds: plan.expectedParticipantIds,
    adapterReceipts,
    terminalCells,
    noneObservedReceipts: canonical.noneObservedReceipts,
    bundleReuseIndex: plan.bundleReuseIndex,
  };
}
