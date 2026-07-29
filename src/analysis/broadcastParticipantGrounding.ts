import {
  CANDIDATE_PASS_B_CAST_ROSTER_VERSION,
  candidatePassBCastReferences,
  isCandidatePassBCastRosterId,
  type CandidatePassBCastRosterId,
  type CandidatePassBParticipantId,
} from "./participantRoster";

export const BROADCAST_PARTICIPANT_GROUNDING_SCHEMA_VERSION = "1.2.0" as const;
export const MAX_BROADCAST_PARTICIPANT_MENTIONS_PER_PERSON = 6;
export const MAX_BROADCAST_PARTICIPANT_OBSERVED_EVIDENCE = 96;

export interface BroadcastParticipantGroundingChapter {
  readonly chapterId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly summaryKo: string;
}

export type BroadcastParticipantSourceRolePrior =
  "likely-host" | "possible-guest" | "none";

export type BroadcastParticipantMediaAdapter =
  "visual-identity" | "voice-identity";

export type BroadcastParticipantAdapterUnavailableReason =
  | "no-verified-reference-manifest"
  | "source-has-no-modality"
  | "unsupported-runtime";

export interface BroadcastParticipantAdapterReceipt {
  readonly adapter: "transcript-names" | BroadcastParticipantMediaAdapter;
  readonly revision: string;
  readonly status: "completed" | "unavailable";
  readonly inputCount: number;
  readonly processedCount: number;
  readonly unavailableReason: BroadcastParticipantAdapterUnavailableReason | null;
}

export interface BroadcastParticipantGroundingPerson {
  readonly participantId: CandidatePassBParticipantId;
  readonly displayNameKo: string;
  readonly sourceRolePrior: BroadcastParticipantSourceRolePrior;
  readonly mentionedChapterCount: number;
  readonly evidenceIds: readonly string[];
}

export type BroadcastParticipantObservedEvidenceKind =
  | "on-screen-name"
  | "visual-reference-match"
  | "visible-participant-unidentified"
  | "no-visible-participant"
  | "spoken-self-identification"
  | "voice-reference-match"
  | "speaker-unidentified"
  | "no-speech";

export type BroadcastParticipantObservedEvidence =
  | {
      readonly evidenceId: string;
      readonly participantId: CandidatePassBParticipantId;
      readonly kind:
        | "on-screen-name"
        | "visual-reference-match"
        | "spoken-self-identification"
        | "voice-reference-match";
      readonly supports: "visible-identity" | "speaker-identity";
      readonly adapter: BroadcastParticipantMediaAdapter;
      readonly startMs: number;
      readonly endMs: number;
      readonly chapterId: string | null;
      readonly confidence: number;
      readonly evidenceKo: string;
    }
  | {
      readonly evidenceId: string;
      readonly participantId: null;
      readonly kind:
        | "visible-participant-unidentified"
        | "no-visible-participant"
        | "speaker-unidentified"
        | "no-speech";
      readonly supports:
        | "visible-unidentified"
        | "no-visible-participant"
        | "speaker-unidentified"
        | "no-speech";
      readonly adapter: BroadcastParticipantMediaAdapter;
      readonly startMs: number;
      readonly endMs: number;
      readonly chapterId: string | null;
      /**
       * Null means the adapter terminally abstained without inventing a
       * probability for absence or an unknown identity.
       */
      readonly confidence: number | null;
      readonly evidenceKo: string;
    };

export type BroadcastParticipantGroundingEvidence =
  | {
      readonly evidenceId: string;
      readonly participantId: CandidatePassBParticipantId;
      readonly kind: "source-channel-prior";
      readonly supports: "host-prior";
      readonly startMs: 0;
      readonly endMs: number;
      readonly chapterId: null;
      readonly matchedNameKo: null;
    }
  | {
      readonly evidenceId: string;
      readonly participantId: CandidatePassBParticipantId;
      readonly kind: "transcript-name-mention";
      readonly supports: "name-mentioned";
      readonly startMs: number;
      readonly endMs: number;
      readonly chapterId: string;
      readonly matchedNameKo: string;
    }
  | BroadcastParticipantObservedEvidence;

export interface BroadcastParticipantGrounding {
  readonly schemaVersion: typeof BROADCAST_PARTICIPANT_GROUNDING_SCHEMA_VERSION;
  /**
   * `sealed` means every enabled adapter has a terminal receipt and this
   * snapshot is immutable. It does not mean that a person was identified.
   */
  readonly status: "sealed";
  readonly resolutionStatus:
    | "no-source-roster"
    | "catalog-only"
    | "transcript-mentions"
    | "media-reviewed"
    | "observed-identities";
  readonly sourceDurationMs: number;
  readonly castRosterId: CandidatePassBCastRosterId | null;
  readonly catalogVersion: typeof CANDIDATE_PASS_B_CAST_ROSTER_VERSION;
  /**
   * Exact ordered subset of the parent context map inspected by the
   * transcript-name adapter. Visual-only context chapters must never be
   * silently promoted to transcript-name evidence.
   */
  readonly transcriptSourceChapterIds: readonly string[];
  readonly adapterReceipts: readonly BroadcastParticipantAdapterReceipt[];
  readonly participants: readonly BroadcastParticipantGroundingPerson[];
  readonly evidence: readonly BroadcastParticipantGroundingEvidence[];
}

export interface CreateBroadcastParticipantGroundingInput {
  readonly sourceDurationMs: number;
  readonly castRosterId: CandidatePassBCastRosterId | null;
  readonly chapters: readonly BroadcastParticipantGroundingChapter[];
}

export interface BroadcastParticipantMediaAdapterOutput {
  readonly receipt: BroadcastParticipantAdapterReceipt;
  readonly evidence: readonly BroadcastParticipantObservedEvidence[];
}

export interface BroadcastParticipantGroundingAdapterOutputs {
  readonly visualIdentity?: BroadcastParticipantMediaAdapterOutput;
  readonly voiceIdentity?: BroadcastParticipantMediaAdapterOutput;
}

const KOREAN_NAME_SUFFIXES = [
  "에게서",
  "한테서",
  "으로부터",
  "에게",
  "한테",
  "께서",
  "까지",
  "부터",
  "처럼",
  "보다",
  "으로",
  "라고",
  "이라",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "와",
  "과",
  "도",
  "만",
  "의",
  "님",
] as const;

const OBSERVED_EVIDENCE_KINDS = new Set<string>([
  "on-screen-name",
  "visual-reference-match",
  "visible-participant-unidentified",
  "no-visible-participant",
  "spoken-self-identification",
  "voice-reference-match",
  "speaker-unidentified",
  "no-speech",
]);

const VISUAL_EVIDENCE_KINDS = new Set<string>([
  "on-screen-name",
  "visual-reference-match",
  "visible-participant-unidentified",
  "no-visible-participant",
]);

const IDENTIFIED_EVIDENCE_KINDS = new Set<string>([
  "on-screen-name",
  "visual-reference-match",
  "spoken-self-identification",
  "voice-reference-match",
]);

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

function boundedText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function transcriptContainsName(value: string, name: string): boolean {
  const normalizedValue = value.normalize("NFC");
  const normalizedName = name.normalize("NFC");
  if (normalizedName.length === 0) return false;
  const lastCodePoint = normalizedName.codePointAt(normalizedName.length - 1);
  const hasHangulFinalConsonant =
    lastCodePoint !== undefined &&
    lastCodePoint >= 0xac00 &&
    lastCodePoint <= 0xd7a3 &&
    (lastCodePoint - 0xac00) % 28 !== 0;
  const vocativeSuffix = hasHangulFinalConsonant ? "아" : "야";
  const suffixes = [...KOREAN_NAME_SUFFIXES, vocativeSuffix]
    .map(escapeRegExp)
    .join("|");
  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escapeRegExp(normalizedName)}` +
      `(?:${suffixes})?(?=$|[^\\p{L}\\p{N}])`,
    "u",
  );
  return pattern.test(normalizedValue);
}

function matchedReferenceName(
  summaryKo: string,
  displayName: string,
  aliasesKo: readonly string[],
  allowAliases: boolean,
): string | null {
  const names = (
    allowAliases ? [displayName, ...aliasesKo] : [displayName]
  ).sort((left, right) => right.length - left.length);
  return names.find((name) => transcriptContainsName(summaryKo, name)) ?? null;
}

function selectSpread<T>(
  items: readonly T[],
  maximumCount: number,
): readonly T[] {
  if (items.length <= maximumCount) return [...items];
  if (maximumCount <= 1) return [items[0]!];
  const selectedIndices = new Set<number>();
  for (let index = 0; index < maximumCount; index += 1) {
    selectedIndices.add(
      Math.round((index * (items.length - 1)) / (maximumCount - 1)),
    );
  }
  return [...selectedIndices].map((index) => items[index]!);
}

function unavailableMediaReceipt(
  adapter: BroadcastParticipantMediaAdapter,
): BroadcastParticipantAdapterReceipt {
  return {
    adapter,
    revision: `${adapter}-not-configured-v1`,
    status: "unavailable",
    inputCount: 0,
    processedCount: 0,
    unavailableReason: "no-verified-reference-manifest",
  };
}

function mediaOutputForAdapter(
  adapter: BroadcastParticipantMediaAdapter,
  outputs: BroadcastParticipantGroundingAdapterOutputs,
): BroadcastParticipantMediaAdapterOutput {
  const output =
    adapter === "visual-identity"
      ? outputs.visualIdentity
      : outputs.voiceIdentity;
  return (
    output ?? {
      receipt: unavailableMediaReceipt(adapter),
      evidence: [],
    }
  );
}

function sourceReferencesForInput(
  input: CreateBroadcastParticipantGroundingInput,
) {
  const sourceReferences = candidatePassBCastReferences(input.castRosterId);
  return {
    sourceReferences,
    references: sourceReferences,
  };
}

export function createBroadcastParticipantGrounding(
  input: CreateBroadcastParticipantGroundingInput,
  outputs: BroadcastParticipantGroundingAdapterOutputs = {},
): BroadcastParticipantGrounding {
  const { sourceReferences, references } = sourceReferencesForInput(input);
  const sourceReferenceById = new Map(
    sourceReferences.map((reference) => [reference.participantId, reference]),
  );
  const evidence: BroadcastParticipantGroundingEvidence[] = [];
  const mentionedChapterCountById = new Map<
    CandidatePassBParticipantId,
    number
  >();

  for (const reference of references) {
    const sourceReference = sourceReferenceById.get(reference.participantId);
    if (sourceReference?.role === "streamer") {
      evidence.push({
        evidenceId: `source-prior:${reference.participantId}`,
        participantId: reference.participantId,
        kind: "source-channel-prior",
        supports: "host-prior",
        startMs: 0,
        endMs: input.sourceDurationMs,
        chapterId: null,
        matchedNameKo: null,
      });
    }

    const mentions = input.chapters.flatMap((chapter) => {
      const matchedNameKo = matchedReferenceName(
        chapter.summaryKo,
        reference.displayName,
        reference.aliasesKo,
        input.castRosterId !== null,
      );
      return matchedNameKo === null ? [] : [{ chapter, matchedNameKo }];
    });
    mentionedChapterCountById.set(reference.participantId, mentions.length);
    for (const [mentionIndex, mention] of selectSpread(
      mentions,
      MAX_BROADCAST_PARTICIPANT_MENTIONS_PER_PERSON,
    ).entries()) {
      evidence.push({
        evidenceId: `transcript-mention:${reference.participantId}:${mentionIndex + 1}`,
        participantId: reference.participantId,
        kind: "transcript-name-mention",
        supports: "name-mentioned",
        startMs: mention.chapter.startMs,
        endMs: mention.chapter.endMs,
        chapterId: mention.chapter.chapterId,
        matchedNameKo: mention.matchedNameKo,
      });
    }
  }

  const visualOutput = mediaOutputForAdapter("visual-identity", outputs);
  const voiceOutput = mediaOutputForAdapter("voice-identity", outputs);
  evidence.push(...visualOutput.evidence, ...voiceOutput.evidence);
  const participants = references.map((reference) => {
    const sourceReference = sourceReferenceById.get(reference.participantId);
    return {
      participantId: reference.participantId,
      displayNameKo: reference.displayName,
      sourceRolePrior:
        sourceReference?.role === "streamer"
          ? ("likely-host" as const)
          : sourceReference === undefined
            ? ("none" as const)
            : ("possible-guest" as const),
      mentionedChapterCount:
        mentionedChapterCountById.get(reference.participantId) ?? 0,
      evidenceIds: evidence
        .filter(
          ({ participantId }) => participantId === reference.participantId,
        )
        .map(({ evidenceId }) => evidenceId),
    };
  });

  const hasObservedIdentity = evidence.some(({ kind }) =>
    IDENTIFIED_EVIDENCE_KINDS.has(kind),
  );
  const hasObservedMedia = evidence.some(({ kind }) =>
    OBSERVED_EVIDENCE_KINDS.has(kind),
  );
  const hasTranscriptMention = evidence.some(
    ({ kind }) => kind === "transcript-name-mention",
  );
  return {
    schemaVersion: BROADCAST_PARTICIPANT_GROUNDING_SCHEMA_VERSION,
    status: "sealed",
    resolutionStatus: hasObservedIdentity
      ? "observed-identities"
      : hasObservedMedia
        ? "media-reviewed"
        : hasTranscriptMention
          ? "transcript-mentions"
          : input.castRosterId === null
            ? "no-source-roster"
            : "catalog-only",
    sourceDurationMs: input.sourceDurationMs,
    castRosterId: input.castRosterId,
    catalogVersion: CANDIDATE_PASS_B_CAST_ROSTER_VERSION,
    transcriptSourceChapterIds: input.chapters.map(
      ({ chapterId }) => chapterId,
    ),
    adapterReceipts: [
      {
        adapter: "transcript-names",
        revision: "transcript-name-grounding-v1",
        status: "completed",
        inputCount: input.chapters.length,
        processedCount: input.chapters.length,
        unavailableReason: null,
      },
      visualOutput.receipt,
      voiceOutput.receipt,
    ],
    participants,
    evidence,
  };
}

function isValidMediaReceipt(
  value: unknown,
  adapter: BroadcastParticipantMediaAdapter,
): value is BroadcastParticipantAdapterReceipt {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "adapter",
      "revision",
      "status",
      "inputCount",
      "processedCount",
      "unavailableReason",
    ]) ||
    value.adapter !== adapter ||
    !boundedText(value.revision, 128) ||
    !Number.isSafeInteger(value.inputCount) ||
    !Number.isSafeInteger(value.processedCount) ||
    (value.inputCount as number) < 0 ||
    (value.processedCount as number) < 0 ||
    (value.processedCount as number) > (value.inputCount as number)
  ) {
    return false;
  }
  if (value.status === "completed") {
    return (
      value.processedCount === value.inputCount &&
      value.unavailableReason === null
    );
  }
  return (
    value.status === "unavailable" &&
    value.inputCount === 0 &&
    value.processedCount === 0 &&
    [
      "no-verified-reference-manifest",
      "source-has-no-modality",
      "unsupported-runtime",
    ].includes(
      typeof value.unavailableReason === "string"
        ? value.unavailableReason
        : "",
    )
  );
}

function isValidObservedEvidence(
  value: unknown,
  input: CreateBroadcastParticipantGroundingInput,
  allowedParticipantIds: ReadonlySet<CandidatePassBParticipantId>,
): value is BroadcastParticipantObservedEvidence {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "evidenceId",
      "participantId",
      "kind",
      "supports",
      "adapter",
      "startMs",
      "endMs",
      "chapterId",
      "confidence",
      "evidenceKo",
    ]) ||
    !boundedText(value.evidenceId, 160) ||
    !OBSERVED_EVIDENCE_KINDS.has(
      typeof value.kind === "string" ? value.kind : "",
    ) ||
    !["visual-identity", "voice-identity"].includes(
      typeof value.adapter === "string" ? value.adapter : "",
    ) ||
    !Number.isSafeInteger(value.startMs) ||
    !Number.isSafeInteger(value.endMs) ||
    (value.startMs as number) < 0 ||
    (value.endMs as number) <= (value.startMs as number) ||
    (value.endMs as number) > input.sourceDurationMs ||
    !(value.chapterId === null || boundedText(value.chapterId, 160)) ||
    !boundedText(value.evidenceKo, 400)
  ) {
    return false;
  }
  const isVisual = VISUAL_EVIDENCE_KINDS.has(value.kind as string);
  if (
    (isVisual && value.adapter !== "visual-identity") ||
    (!isVisual && value.adapter !== "voice-identity")
  ) {
    return false;
  }
  const isIdentified = IDENTIFIED_EVIDENCE_KINDS.has(value.kind as string);
  const confidenceIsValid =
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1;
  if (
    isIdentified
      ? !(
          typeof value.participantId === "string" &&
          allowedParticipantIds.has(
            value.participantId as CandidatePassBParticipantId,
          ) &&
          confidenceIsValid
        )
      : value.participantId !== null ||
        !(value.confidence === null || confidenceIsValid)
  ) {
    return false;
  }
  const expectedSupports = new Map<string, string>([
    ["on-screen-name", "visible-identity"],
    ["visual-reference-match", "visible-identity"],
    ["visible-participant-unidentified", "visible-unidentified"],
    ["no-visible-participant", "no-visible-participant"],
    ["spoken-self-identification", "speaker-identity"],
    ["voice-reference-match", "speaker-identity"],
    ["speaker-unidentified", "speaker-unidentified"],
    ["no-speech", "no-speech"],
  ]).get(value.kind as string);
  return value.supports === expectedSupports;
}

export function normalizeBroadcastParticipantGroundingForInput(
  value: unknown,
  input: CreateBroadcastParticipantGroundingInput,
): BroadcastParticipantGrounding | null {
  if (
    input.castRosterId !== null &&
    !isCandidatePassBCastRosterId(input.castRosterId)
  ) {
    return null;
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "status",
      "resolutionStatus",
      "sourceDurationMs",
      "castRosterId",
      "catalogVersion",
      "transcriptSourceChapterIds",
      "adapterReceipts",
      "participants",
      "evidence",
    ]) ||
    value.schemaVersion !== BROADCAST_PARTICIPANT_GROUNDING_SCHEMA_VERSION ||
    value.status !== "sealed" ||
    value.sourceDurationMs !== input.sourceDurationMs ||
    value.castRosterId !== input.castRosterId ||
    value.catalogVersion !== CANDIDATE_PASS_B_CAST_ROSTER_VERSION ||
    !Array.isArray(value.transcriptSourceChapterIds) ||
    !Array.isArray(value.adapterReceipts) ||
    value.adapterReceipts.length !== 3 ||
    !Array.isArray(value.evidence) ||
    value.evidence.length > MAX_BROADCAST_PARTICIPANT_OBSERVED_EVIDENCE + 48
  ) {
    return null;
  }
  const chapterById = new Map(
    input.chapters.map((chapter, index) => [
      chapter.chapterId,
      { chapter, index },
    ]),
  );
  const transcriptSourceChapters: BroadcastParticipantGroundingChapter[] = [];
  let previousChapterIndex = -1;
  for (const chapterId of value.transcriptSourceChapterIds) {
    if (!boundedText(chapterId, 256)) return null;
    const source = chapterById.get(chapterId);
    if (
      source === undefined ||
      source.index <= previousChapterIndex
    ) {
      return null;
    }
    previousChapterIndex = source.index;
    transcriptSourceChapters.push(source.chapter);
  }
  const groundingInput: CreateBroadcastParticipantGroundingInput = {
    sourceDurationMs: input.sourceDurationMs,
    castRosterId: input.castRosterId,
    chapters: transcriptSourceChapters,
  };
  const adapterReceipts = value.adapterReceipts as readonly unknown[];

  const base = createBroadcastParticipantGrounding(groundingInput);
  const baseEvidenceJson = JSON.stringify(
    value.evidence.slice(0, base.evidence.length),
  );
  if (baseEvidenceJson !== JSON.stringify(base.evidence)) return null;
  if (
    JSON.stringify(adapterReceipts[0]) !==
    JSON.stringify(base.adapterReceipts[0])
  ) {
    return null;
  }
  const visualReceipt: unknown = adapterReceipts[1];
  const voiceReceipt: unknown = adapterReceipts[2];
  if (
    !isValidMediaReceipt(visualReceipt, "visual-identity") ||
    !isValidMediaReceipt(voiceReceipt, "voice-identity")
  ) {
    return null;
  }

  const { references } = sourceReferencesForInput(groundingInput);
  const allowedParticipantIds = new Set(
    references.map(({ participantId }) => participantId),
  );
  const observedEvidence = value.evidence.slice(base.evidence.length);
  if (
    observedEvidence.length > MAX_BROADCAST_PARTICIPANT_OBSERVED_EVIDENCE ||
    !observedEvidence.every((item) =>
      isValidObservedEvidence(item, groundingInput, allowedParticipantIds),
    )
  ) {
    return null;
  }
  const evidenceIds = value.evidence.map((item) =>
    isRecord(item) ? item.evidenceId : null,
  );
  if (
    evidenceIds.some((evidenceId) => typeof evidenceId !== "string") ||
    new Set(evidenceIds).size !== evidenceIds.length
  ) {
    return null;
  }
  if (
    observedEvidence.some(
      (item) =>
        isRecord(item) &&
        item.adapter === "visual-identity" &&
        visualReceipt.status !== "completed",
    ) ||
    observedEvidence.some(
      (item) =>
        isRecord(item) &&
        item.adapter === "voice-identity" &&
        voiceReceipt.status !== "completed",
    )
  ) {
    return null;
  }

  const canonical = createBroadcastParticipantGrounding(groundingInput, {
    visualIdentity: {
      receipt: visualReceipt,
      evidence: observedEvidence.filter(
        (item): item is BroadcastParticipantObservedEvidence =>
          isRecord(item) && item.adapter === "visual-identity",
      ),
    },
    voiceIdentity: {
      receipt: voiceReceipt,
      evidence: observedEvidence.filter(
        (item): item is BroadcastParticipantObservedEvidence =>
          isRecord(item) && item.adapter === "voice-identity",
      ),
    },
  });
  return JSON.stringify(value) === JSON.stringify(canonical) ? canonical : null;
}

export function isBroadcastParticipantGroundingForInput(
  value: unknown,
  input: CreateBroadcastParticipantGroundingInput,
): value is BroadcastParticipantGrounding {
  return normalizeBroadcastParticipantGroundingForInput(value, input) !== null;
}

export function rebaseBroadcastParticipantGrounding(
  value: unknown,
  previousInput: CreateBroadcastParticipantGroundingInput,
  nextInput: CreateBroadcastParticipantGroundingInput,
): BroadcastParticipantGrounding | null {
  const normalized = normalizeBroadcastParticipantGroundingForInput(
    value,
    previousInput,
  );
  if (
    normalized === null ||
    previousInput.sourceDurationMs !== nextInput.sourceDurationMs ||
    previousInput.castRosterId !== nextInput.castRosterId
  ) {
    return null;
  }
  const receiptByAdapter = new Map(
    normalized.adapterReceipts.map((receipt) => [receipt.adapter, receipt]),
  );
  const observedEvidence = normalized.evidence.filter(
    (evidence): evidence is BroadcastParticipantObservedEvidence =>
      OBSERVED_EVIDENCE_KINDS.has(evidence.kind),
  );
  const previousTranscriptSourceChapterIds = new Set(
    normalized.transcriptSourceChapterIds,
  );
  const previousChapterKinds = previousInput.chapters.map((chapter) => ({
    chapter,
    isTranscriptSource: previousTranscriptSourceChapterIds.has(
      chapter.chapterId,
    ),
  }));
  const nextTranscriptSourceChapters = nextInput.chapters.filter(
    (nextChapter) => {
      if (previousTranscriptSourceChapterIds.has(nextChapter.chapterId)) {
        return true;
      }
      const overlapping = previousChapterKinds.filter(
        ({ chapter }) =>
          chapter.startMs < nextChapter.endMs &&
          chapter.endMs > nextChapter.startMs,
      );
      return (
        overlapping.length > 0 &&
        overlapping.every(({ isTranscriptSource }) => isTranscriptSource)
      );
    },
  );
  const outputFor = (
    adapter: BroadcastParticipantMediaAdapter,
  ): BroadcastParticipantMediaAdapterOutput => ({
    receipt: receiptByAdapter.get(adapter) ?? unavailableMediaReceipt(adapter),
    evidence: observedEvidence.filter(
      (evidence) => evidence.adapter === adapter,
    ),
  });
  return createBroadcastParticipantGrounding(
    {
      ...nextInput,
      chapters: nextTranscriptSourceChapters,
    },
    {
      visualIdentity: outputFor("visual-identity"),
      voiceIdentity: outputFor("voice-identity"),
    },
  );
}

export function participantContextForBroadcastRange(
  grounding: BroadcastParticipantGrounding,
  startMs: number,
  endMs: number,
): string {
  const rangeEvidence = grounding.evidence.filter(
    (item) => item.startMs < endMs && item.endMs > startMs,
  );
  const visiblyIdentifiedIds = new Set(
    rangeEvidence
      .filter(({ kind }) =>
        ["on-screen-name", "visual-reference-match"].includes(kind),
      )
      .map(({ participantId }) => participantId),
  );
  const speakerIdentifiedIds = new Set(
    rangeEvidence
      .filter(({ kind }) =>
        ["spoken-self-identification", "voice-reference-match"].includes(kind),
      )
      .map(({ participantId }) => participantId),
  );
  const namesForIds = (
    participantIds: ReadonlySet<CandidatePassBParticipantId | null>,
  ) =>
    grounding.participants
      .filter(({ participantId }) => participantIds.has(participantId))
      .map(({ displayNameKo }) => displayNameKo);
  const visibleNames = namesForIds(visiblyIdentifiedIds);
  const speakerNames = namesForIds(speakerIdentifiedIds);
  const mentionedIds = new Set(
    rangeEvidence
      .filter(({ kind }) => kind === "transcript-name-mention")
      .map(({ participantId }) => participantId),
  );
  const mentionedNames = namesForIds(mentionedIds);
  const observationSentences = [
    visibleNames.length > 0
      ? `화면 근거로 ${visibleNames.join(", ")}을(를) 확인했습니다.`
      : "",
    speakerNames.length > 0
      ? `음성 근거로 ${speakerNames.join(", ")}의 발화를 확인했습니다.`
      : "",
    rangeEvidence.some(
      ({ kind }) => kind === "visible-participant-unidentified",
    )
      ? visibleNames.length > 0
        ? "다른 화면에는 식별하지 못한 인물도 보입니다."
        : "화면에는 인물이 보이지만 닫힌 출연진 후보 중 누구인지는 확인하지 못했습니다."
      : "",
    rangeEvidence.some(({ kind }) => kind === "no-visible-participant")
      ? visibleNames.length > 0 ||
        rangeEvidence.some(
          ({ kind }) => kind === "visible-participant-unidentified",
        )
        ? "일부 화면에는 인물이 보이지 않았습니다."
        : "화면에는 인물이 보이지 않았습니다."
      : "",
    rangeEvidence.some(({ kind }) => kind === "speaker-unidentified")
      ? speakerNames.length > 0
        ? "다른 발화의 화자는 확인하지 못했습니다."
        : "발화는 확인했지만 화자는 확인하지 못했습니다."
      : "",
    rangeEvidence.some(({ kind }) => kind === "no-speech")
      ? speakerNames.length > 0 ||
        rangeEvidence.some(({ kind }) => kind === "speaker-unidentified")
        ? "일부 구간은 무발화로 확인했습니다."
        : "발화가 없는 구간으로 확인했습니다."
      : "",
    mentionedNames.length > 0
      ? `대사에는 ${mentionedNames.join(", ")}의 이름이나 고정 호칭이 언급됩니다. 이름 언급은 그 사람의 등장이나 발화 증거가 아니며, 그 사실만으로 확정하지 않습니다.`
      : "",
  ].filter(Boolean);
  if (observationSentences.length > 0) {
    return observationSentences.join(" ");
  }

  const completedMediaAdapters = grounding.adapterReceipts.filter(
    ({ adapter, status }) =>
      adapter !== "transcript-names" && status === "completed",
  );
  const hostPrior = grounding.participants.find(
    ({ sourceRolePrior }) => sourceRolePrior === "likely-host",
  );
  if (hostPrior !== undefined) {
    return completedMediaAdapters.length > 0
      ? `원본 채널 기준 주 진행자 후보는 ${hostPrior.displayNameKo}이지만, 이는 채널 prior일 뿐입니다. 완료된 매체 검토에서도 이 구간에 직접 연결되는 등장인물이나 화자 근거는 확보하지 못했습니다.`
      : `원본 채널 기준 주 진행자 후보는 ${hostPrior.displayNameKo}이지만, 이는 채널 prior일 뿐 이 구간의 실제 발화자나 화면 등장 증거가 아닙니다. 검증된 참조 자료가 없어 화면·목소리 식별은 아직 수행하지 못했습니다.`;
  }
  if (grounding.participants.length > 0) {
    return completedMediaAdapters.length > 0
      ? "닫힌 출연진 후보 명단은 준비됐지만, 완료된 매체 검토에서도 이 구간에 직접 연결되는 이름 호명·화면 식별·목소리 식별 근거는 확보하지 못했습니다."
      : "닫힌 출연진 후보 명단은 준비됐지만, 이 구간에서 이름 호명 근거를 확보하지 못했고 검증된 참조 자료가 없어 화면·목소리 식별은 아직 수행하지 못했습니다.";
  }
  return "원본과 연결된 닫힌 출연진 명단이 없어, 이 구간의 등장인물과 발화자는 아직 확인하지 못했습니다.";
}
