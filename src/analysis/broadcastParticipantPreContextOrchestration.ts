import {
  createContentFingerprint,
  type ContentDigestAdapter,
} from "../security/contentFingerprint";
import {
  BROADCAST_PARTICIPANT_GROUNDING_SCHEMA_VERSION,
  MAX_BROADCAST_PARTICIPANT_OBSERVED_EVIDENCE,
  createBroadcastParticipantGrounding,
  type BroadcastParticipantGrounding,
  type BroadcastParticipantGroundingChapter,
  type CreateBroadcastParticipantGroundingInput,
} from "./broadcastParticipantGrounding";
import {
  projectBroadcastParticipantGroundingAdapterOutputs,
} from "./broadcastParticipantGroundingBridge";
import {
  BROADCAST_PARTICIPANT_GROUNDING_MAX_SOURCE_DURATION_MS,
  createBroadcastParticipantGroundingPlan,
  createBroadcastParticipantGroundingTerminalReceipt,
  sealBroadcastParticipantGroundingPlan,
  type BroadcastParticipantGroundingCellRangeInput,
  type BroadcastParticipantGroundingPlan,
  type BroadcastParticipantGroundingSourceFence,
  type BroadcastParticipantGroundingTerminalCellReceipt,
  type BroadcastParticipantGroundingVisualCellRangeInput,
  type BroadcastParticipantVoiceRecognitionPolicyInput,
  type SealedBroadcastParticipantGroundingPlan,
} from "./broadcastParticipantGroundingPlan";
import {
  CANDIDATE_PASS_B_CAST_ROSTER_VERSION,
  type CandidatePassBCastRosterId,
  type CandidatePassBParticipantId,
} from "./participantRoster";
import {
  eligibleParticipantVoiceEnrollmentAssets,
  normalizeParticipantVoiceEnrollmentManifest,
  type ParticipantVoiceEnrollmentManifest,
} from "./participantVoiceEnrollmentManifest";

export const BROADCAST_PARTICIPANT_PRE_CONTEXT_ORCHESTRATION_REVISION =
  "broadcast-participant-pre-context-orchestration-v1" as const;
export const BROADCAST_PARTICIPANT_PRE_CONTEXT_SAMPLING_PLAN_REVISION =
  "broadcast-participant-pre-context-sampling-v1" as const;
export const BROADCAST_PARTICIPANT_PRE_CONTEXT_MAX_DIALOGUE_CHAPTERS = 144;

const SOURCE_FINGERPRINT_DOMAIN =
  "exclipper.broadcast-participant-source-fence.v1";
const TRANSCRIPT_ADAPTER_REVISION =
  "pre-context-transcript-name-grounding-v1";
const VISUAL_UNAVAILABLE_ADAPTER_REVISION =
  "pre-context-visual-identity-unavailable-v1";
const VOICE_UNAVAILABLE_ADAPTER_REVISION =
  "pre-context-voice-identity-unavailable-v1";
const NO_DIALOGUE_SOURCE_UNIT_ID = "pre-context.no-dialogue";
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+/-]*$/u;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_SOURCE_FINGERPRINT_INPUT_LENGTH = 4_096;
const MAX_CHAPTER_SUMMARY_LENGTH = 3_000;

export interface BroadcastParticipantVisualReferenceManifestFence {
  readonly manifestHash: string;
  readonly participantIds: readonly CandidatePassBParticipantId[];
}

/**
 * This contract contains only already-decided sampling cells and immutable
 * adapter revisions. Frame extraction and identity inference remain outside
 * this pure orchestration module.
 */
export interface BroadcastParticipantVisualRuntimePlan {
  readonly adapterRevision: string;
  readonly modelRevision: string;
  readonly cells: readonly BroadcastParticipantGroundingVisualCellRangeInput[];
}

/**
 * The enrollment manifest is supplied separately so a verified manifest can
 * remain source-fenced even while its runtime is unavailable.
 */
export interface BroadcastParticipantVoiceRuntimePlan {
  readonly adapterRevision: string;
  readonly segmentationModelRevision: string;
  readonly recognitionPolicy: BroadcastParticipantVoiceRecognitionPolicyInput;
  readonly cells: readonly BroadcastParticipantGroundingCellRangeInput[];
}

export interface PrepareBroadcastParticipantPreContextInput {
  /**
   * May be a local-file fingerprint, URL-derived key, or any other bounded
   * source identity. It is always hashed into a fresh SHA-256 source fence.
   */
  readonly sourceContentFingerprint: string;
  readonly sourceDurationMs: number;
  readonly transcriptSeal: string;
  readonly castRosterId: CandidatePassBCastRosterId | null;
  readonly dialogueChapters: readonly BroadcastParticipantGroundingChapter[];
  readonly transcriptModelRevision: string;
  readonly visualReferenceManifest?:
    | BroadcastParticipantVisualReferenceManifestFence
    | null;
  readonly visualRuntime?: BroadcastParticipantVisualRuntimePlan | null;
  readonly voiceEnrollmentManifest?: ParticipantVoiceEnrollmentManifest | null;
  readonly voiceRuntime?: BroadcastParticipantVoiceRuntimePlan | null;
}

export interface PreparedBroadcastParticipantPreContext {
  readonly orchestrationRevision:
    typeof BROADCAST_PARTICIPANT_PRE_CONTEXT_ORCHESTRATION_REVISION;
  readonly sourceFingerprint: string;
  readonly expectedSourceFence: BroadcastParticipantGroundingSourceFence;
  readonly groundingInput: CreateBroadcastParticipantGroundingInput;
  readonly planFingerprint: string;
  readonly plan: BroadcastParticipantGroundingPlan;
  readonly transcriptTerminalReceipts: readonly BroadcastParticipantGroundingTerminalCellReceipt[];
}

export interface CompleteBroadcastParticipantPreContextInput {
  readonly visualTerminalReceipts?: readonly unknown[];
  readonly voiceTerminalReceipts?: readonly unknown[];
}

export interface OrchestrateBroadcastParticipantPreContextInput extends PrepareBroadcastParticipantPreContextInput {
  readonly visualTerminalReceipts?: readonly unknown[];
  readonly voiceTerminalReceipts?: readonly unknown[];
}

export interface BroadcastParticipantPreContextResult {
  readonly orchestrationRevision:
    typeof BROADCAST_PARTICIPANT_PRE_CONTEXT_ORCHESTRATION_REVISION;
  readonly sourceFingerprint: string;
  readonly sourceFence: BroadcastParticipantGroundingSourceFence;
  readonly planFingerprint: string;
  readonly sealedPlan: SealedBroadcastParticipantGroundingPlan;
  readonly grounding: BroadcastParticipantGrounding;
}

function isBoundedIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH &&
    value.trim() === value &&
    IDENTIFIER_PATTERN.test(value)
  );
}

function canonicalDialogueChapters(
  chapters: readonly BroadcastParticipantGroundingChapter[],
  sourceDurationMs: number,
): readonly BroadcastParticipantGroundingChapter[] {
  if (
    chapters.length > BROADCAST_PARTICIPANT_PRE_CONTEXT_MAX_DIALOGUE_CHAPTERS
  ) {
    throw new RangeError(
      `Participant pre-context accepts at most ${BROADCAST_PARTICIPANT_PRE_CONTEXT_MAX_DIALOGUE_CHAPTERS} dialogue chapters.`,
    );
  }
  const chapterIds = new Set<string>();
  let previousEndMs = 0;
  return chapters.map((chapter, index) => {
    if (
      !isBoundedIdentifier(chapter.chapterId) ||
      chapterIds.has(chapter.chapterId) ||
      !Number.isSafeInteger(chapter.startMs) ||
      !Number.isSafeInteger(chapter.endMs) ||
      chapter.startMs < 0 ||
      chapter.endMs <= chapter.startMs ||
      chapter.endMs > sourceDurationMs ||
      (index > 0 && chapter.startMs < previousEndMs) ||
      typeof chapter.summaryKo !== "string" ||
      chapter.summaryKo.length === 0 ||
      chapter.summaryKo.length > MAX_CHAPTER_SUMMARY_LENGTH ||
      chapter.summaryKo.trim() !== chapter.summaryKo ||
      /[\p{Cc}\p{Cf}]/u.test(chapter.summaryKo)
    ) {
      throw new RangeError(
        "Participant pre-context chapters must be unique, ordered, non-overlapping, and source-bounded.",
      );
    }
    chapterIds.add(chapter.chapterId);
    previousEndMs = chapter.endMs;
    return {
      chapterId: chapter.chapterId,
      startMs: chapter.startMs,
      endMs: chapter.endMs,
      summaryKo: chapter.summaryKo,
    };
  });
}

function transcriptCells(
  chapters: readonly BroadcastParticipantGroundingChapter[],
  sourceDurationMs: number,
): readonly BroadcastParticipantGroundingCellRangeInput[] {
  if (chapters.length === 0) {
    return [
      {
        sourceStartMs: 0,
        sourceEndMs: sourceDurationMs,
        sourceUnitId: NO_DIALOGUE_SOURCE_UNIT_ID,
      },
    ];
  }
  return chapters.map((chapter) => ({
    sourceStartMs: chapter.startMs,
    sourceEndMs: chapter.endMs,
    sourceUnitId: chapter.chapterId,
  }));
}

function hasEligibleVoiceEnrollment(
  value: ParticipantVoiceEnrollmentManifest | null,
): boolean {
  return value !== null && eligibleParticipantVoiceEnrollmentAssets(value).length > 0;
}

function transcriptTerminalReceipts(
  plan: BroadcastParticipantGroundingPlan,
  transcriptGrounding: BroadcastParticipantGrounding,
): readonly BroadcastParticipantGroundingTerminalCellReceipt[] {
  const transcriptPlan = plan.adapters[0];
  const participantIdsByChapterId = new Map<
    string,
    Set<CandidatePassBParticipantId>
  >();
  for (const evidence of transcriptGrounding.evidence) {
    if (evidence.kind !== "transcript-name-mention") continue;
    const existing =
      participantIdsByChapterId.get(evidence.chapterId) ??
      new Set<CandidatePassBParticipantId>();
    existing.add(evidence.participantId);
    participantIdsByChapterId.set(evidence.chapterId, existing);
  }
  return transcriptPlan.cells.map((cell) => {
    const mentioned = participantIdsByChapterId.get(cell.sourceUnitId ?? "");
    const participantIds =
      mentioned === undefined
        ? []
        : plan.expectedParticipantIds.filter((participantId) =>
            mentioned.has(participantId),
          );
    return createBroadcastParticipantGroundingTerminalReceipt({
      plan,
      adapter: "transcript-names",
      cellId: cell.cellId,
      operationId: `pre-context.transcript.${cell.ordinal + 1}`,
      attemptOrdinal: 0,
      ...(participantIds.length === 0
        ? { outcome: "none" as const }
        : {
            outcome: "identified" as const,
            participantIds,
            // This is certainty of the deterministic roster-name matcher, not
            // a claim that the named person was visible or speaking.
            confidence: 1,
          }),
    });
  });
}

function visualPlanInput(
  input: PrepareBroadcastParticipantPreContextInput,
) {
  const manifest = input.visualReferenceManifest ?? null;
  const runtime = input.visualRuntime ?? null;
  return {
    adapterRevision:
      runtime?.adapterRevision ?? VISUAL_UNAVAILABLE_ADAPTER_REVISION,
    modelRevision: runtime?.modelRevision ?? null,
    referenceManifestHash: manifest?.manifestHash ?? null,
    referenceParticipantIds: manifest?.participantIds ?? [],
    unavailableReason:
      manifest === null
        ? null
        : runtime === null
          ? ("unsupported-runtime" as const)
          : null,
    cells: runtime?.cells ?? [],
  };
}

function voicePlanInput(
  input: PrepareBroadcastParticipantPreContextInput,
  manifest: ParticipantVoiceEnrollmentManifest | null,
) {
  const runtime = input.voiceRuntime ?? null;
  const hasEligibleEnrollment = hasEligibleVoiceEnrollment(manifest);
  return {
    adapterRevision:
      runtime?.adapterRevision ?? VOICE_UNAVAILABLE_ADAPTER_REVISION,
    segmentationModelRevision: runtime?.segmentationModelRevision ?? null,
    enrollmentManifest: manifest,
    recognitionPolicy:
      runtime !== null && hasEligibleEnrollment
        ? runtime.recognitionPolicy
        : null,
    unavailableReason:
      hasEligibleEnrollment && runtime === null
        ? ("unsupported-runtime" as const)
        : null,
    cells: runtime?.cells ?? [],
  };
}

function normalizedVoiceManifest(
  value: ParticipantVoiceEnrollmentManifest | null | undefined,
): ParticipantVoiceEnrollmentManifest | null {
  if (value === null || value === undefined) return null;
  const manifest = normalizeParticipantVoiceEnrollmentManifest(value);
  if (manifest === null) {
    throw new TypeError(
      "Participant pre-context requires an exact voice enrollment manifest.",
    );
  }
  return manifest;
}

/**
 * Phase 1: builds the immutable source/adapter plan and terminally resolves
 * only the deterministic transcript-name cells. Enabled media cells remain
 * open until their real adapter receipts are supplied to `complete`.
 */
export async function prepareBroadcastParticipantPreContext(
  input: PrepareBroadcastParticipantPreContextInput,
  digestAdapter: ContentDigestAdapter | null = globalThis.crypto?.subtle ??
    null,
): Promise<PreparedBroadcastParticipantPreContext> {
  if (
    typeof input.sourceContentFingerprint !== "string" ||
    input.sourceContentFingerprint.length === 0 ||
    input.sourceContentFingerprint.length >
      MAX_SOURCE_FINGERPRINT_INPUT_LENGTH
  ) {
    throw new TypeError(
      "Participant pre-context requires a bounded source content identity.",
    );
  }
  if (
    !Number.isSafeInteger(input.sourceDurationMs) ||
    input.sourceDurationMs <= 0 ||
    input.sourceDurationMs >
      BROADCAST_PARTICIPANT_GROUNDING_MAX_SOURCE_DURATION_MS
  ) {
    throw new RangeError(
      "Participant pre-context source duration must be between 1 ms and 12 hours.",
    );
  }
  if (digestAdapter === null) {
    throw new TypeError(
      "Participant pre-context requires SHA-256 for its source fence.",
    );
  }
  const chapters = canonicalDialogueChapters(
    input.dialogueChapters,
    input.sourceDurationMs,
  );
  const sourceFingerprint = await createContentFingerprint(
    [SOURCE_FINGERPRINT_DOMAIN, input.sourceContentFingerprint],
    digestAdapter,
  );
  const groundingInput: CreateBroadcastParticipantGroundingInput = {
    sourceDurationMs: input.sourceDurationMs,
    castRosterId: input.castRosterId,
    chapters,
  };
  const transcriptGrounding =
    createBroadcastParticipantGrounding(groundingInput);
  const manifest = normalizedVoiceManifest(input.voiceEnrollmentManifest);
  const expectedSourceFence: BroadcastParticipantGroundingSourceFence = {
    sourceFingerprint,
    sourceDurationMs: input.sourceDurationMs,
    transcriptSeal: input.transcriptSeal,
    castRosterId: input.castRosterId,
    catalogVersion: CANDIDATE_PASS_B_CAST_ROSTER_VERSION,
    groundingSchemaVersion: BROADCAST_PARTICIPANT_GROUNDING_SCHEMA_VERSION,
    samplingPlanRevision:
      BROADCAST_PARTICIPANT_PRE_CONTEXT_SAMPLING_PLAN_REVISION,
  };
  const plan = await createBroadcastParticipantGroundingPlan(
    {
      sourceFingerprint,
      sourceDurationMs: input.sourceDurationMs,
      transcriptSeal: input.transcriptSeal,
      castRosterId: input.castRosterId,
      samplingPlanRevision:
        BROADCAST_PARTICIPANT_PRE_CONTEXT_SAMPLING_PLAN_REVISION,
      transcript: {
        adapterRevision: TRANSCRIPT_ADAPTER_REVISION,
        modelRevision: input.transcriptModelRevision,
        cells: transcriptCells(chapters, input.sourceDurationMs),
      },
      visual: visualPlanInput(input),
      voice: voicePlanInput(input, manifest),
    },
    digestAdapter,
  );
  return {
    orchestrationRevision:
      BROADCAST_PARTICIPANT_PRE_CONTEXT_ORCHESTRATION_REVISION,
    sourceFingerprint,
    expectedSourceFence,
    groundingInput,
    planFingerprint: plan.planFingerprint,
    plan,
    transcriptTerminalReceipts: transcriptTerminalReceipts(
      plan,
      transcriptGrounding,
    ),
  };
}

/**
 * Phase 2: accepts only source-fenced receipts from actual media adapters.
 * Missing, retryable, unknown-outcome, stale, or fabricated receipts fail in
 * the plan seal/bridge rather than degrading to inferred identities.
 */
export function completeBroadcastParticipantPreContext(
  prepared: PreparedBroadcastParticipantPreContext,
  input: CompleteBroadcastParticipantPreContextInput = {},
): BroadcastParticipantPreContextResult {
  const cellReceipts = [
    ...prepared.transcriptTerminalReceipts,
    ...(input.visualTerminalReceipts ?? []),
    ...(input.voiceTerminalReceipts ?? []),
  ];
  const sealedPlan = sealBroadcastParticipantGroundingPlan(
    prepared.plan,
    cellReceipts,
  );
  const outputs = projectBroadcastParticipantGroundingAdapterOutputs({
    groundingInput: prepared.groundingInput,
    expectedSourceFence: prepared.expectedSourceFence,
    plan: prepared.plan,
    cellReceipts,
  });
  const grounding = createBroadcastParticipantGrounding(
    prepared.groundingInput,
    outputs,
  );
  const observedEvidenceCount = grounding.evidence.filter(
    (evidence) =>
      evidence.kind !== "source-channel-prior" &&
      evidence.kind !== "transcript-name-mention",
  ).length;
  if (observedEvidenceCount > MAX_BROADCAST_PARTICIPANT_OBSERVED_EVIDENCE) {
    throw new RangeError(
      "Participant pre-context media evidence exceeds the bounded grounding packet.",
    );
  }
  return {
    orchestrationRevision:
      BROADCAST_PARTICIPANT_PRE_CONTEXT_ORCHESTRATION_REVISION,
    sourceFingerprint: prepared.sourceFingerprint,
    sourceFence: prepared.expectedSourceFence,
    planFingerprint: prepared.planFingerprint,
    sealedPlan,
    grounding,
  };
}

/**
 * One-call replay helper for callers that already persisted exact terminal
 * media receipts. New inference should use prepare -> adapter work -> complete.
 */
export async function orchestrateBroadcastParticipantPreContext(
  input: OrchestrateBroadcastParticipantPreContextInput,
  digestAdapter: ContentDigestAdapter | null = globalThis.crypto?.subtle ??
    null,
): Promise<BroadcastParticipantPreContextResult> {
  const prepared = await prepareBroadcastParticipantPreContext(
    input,
    digestAdapter,
  );
  return completeBroadcastParticipantPreContext(prepared, {
    ...(input.visualTerminalReceipts === undefined
      ? {}
      : { visualTerminalReceipts: input.visualTerminalReceipts }),
    ...(input.voiceTerminalReceipts === undefined
      ? {}
      : { voiceTerminalReceipts: input.voiceTerminalReceipts }),
  });
}
