import type { CandidatePassBEvidence } from "../analysis/candidatePassB";
import {
  CANDIDATE_PASS_B_GEMINI_MODEL_ID,
  CANDIDATE_PASS_B_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_CONTEXTLESS_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_OLDER_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_PREVIOUS_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_PRIOR_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_LEGACY_GEMINI_MODEL_ID,
  CANDIDATE_PASS_B_LEGACY_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_CONTEXTLESS_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_OLDER_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_PREVIOUS_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_PRIOR_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_VERIFICATION_RECEIPT_SCHEMA_VERSION,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH,
  type CandidatePassBParticipantAttribution,
  type CandidatePassBParticipantPresence,
  type CandidatePassBVerificationReceipt,
  type CandidatePassBVideoFrame,
} from "../analysis/candidatePassBWorkerProtocol";
import { isCandidatePassBVerificationReceipt } from "../analysis/candidateFinalVerification";

export const CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION = "1.5.0" as const;
export type CandidatePassBInsightSchemaVersion =
  | "1.0.0"
  | "1.1.0"
  | "1.2.0"
  | "1.3.0"
  | "1.4.0"
  | "1.5.0";

const SUPPORTED_INSIGHT_SCHEMA_VERSIONS = new Set<CandidatePassBInsightSchemaVersion>([
  "1.0.0",
  "1.1.0",
  "1.2.0",
  "1.3.0",
  "1.4.0",
  CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
]);

export interface StoredCandidatePassBInsight {
  readonly eventSummaryKo: string;
  readonly reactionSummaryKo: string;
  readonly whyGoodClipKo: string;
  readonly uncertaintiesKo: readonly string[];
  readonly participantPresence?: CandidatePassBParticipantPresence;
  readonly participantSummaryKo?: string;
  readonly identifiedParticipants?: readonly CandidatePassBParticipantAttribution[];
  readonly clipDecision?: "recommend" | "reject" | "uncertain";
  readonly contextConsistency?: "consistent" | "conflict" | "insufficient";
  readonly programMaterial?:
    | "streamer-event"
    | "music-or-intermission"
    | "routine-or-unclear";
}

export interface StoredCandidatePassBModelIdentity {
  readonly id:
    | typeof CANDIDATE_PASS_B_QWEN_MODEL_ID
    | typeof CANDIDATE_PASS_B_GEMINI_MODEL_ID
    | typeof CANDIDATE_PASS_B_LEGACY_GEMINI_MODEL_ID;
  readonly revision:
    | typeof CANDIDATE_PASS_B_QWEN_MODEL_REVISION
    | typeof CANDIDATE_PASS_B_CONTEXTLESS_QWEN_MODEL_REVISION
    | typeof CANDIDATE_PASS_B_PREVIOUS_QWEN_MODEL_REVISION
    | typeof CANDIDATE_PASS_B_PRIOR_QWEN_MODEL_REVISION
    | typeof CANDIDATE_PASS_B_OLDER_QWEN_MODEL_REVISION
    | typeof CANDIDATE_PASS_B_GEMINI_MODEL_REVISION
    | typeof CANDIDATE_PASS_B_CONTEXTLESS_GEMINI_MODEL_REVISION
    | typeof CANDIDATE_PASS_B_PREVIOUS_GEMINI_MODEL_REVISION
    | typeof CANDIDATE_PASS_B_PRIOR_GEMINI_MODEL_REVISION
    | typeof CANDIDATE_PASS_B_OLDER_GEMINI_MODEL_REVISION
    | typeof CANDIDATE_PASS_B_LEGACY_GEMINI_MODEL_REVISION;
}

export interface CandidatePassBInsightsRecord {
  readonly kind: "candidatePassBInsights";
  readonly runId: string;
  readonly schemaVersion: CandidatePassBInsightSchemaVersion;
  readonly inputSignature: string;
  readonly modelManifestHash: string;
  readonly evidenceById: Readonly<Record<string, CandidatePassBEvidence>>;
  readonly insightById: Readonly<Record<string, StoredCandidatePassBInsight>>;
  /** Actual provider model per candidate, including bounded fallback results. */
  readonly modelByCandidateId?: Readonly<
    Record<string, StoredCandidatePassBModelIdentity>
  >;
  /** One impact thumbnail per candidate, kept with the analysis-session snapshot. */
  readonly thumbnailById?: Readonly<Record<string, CandidatePassBVideoFrame>>;
  /** Locally issued proof that the saved result saw context, audio and four frames. */
  readonly verificationReceiptById?: Readonly<
    Record<string, CandidatePassBVerificationReceipt>
  >;
  readonly recordedAt: string;
}

/**
 * Minimal durable-store surface required to commit a Candidate Pass B snapshot.
 *
 * Keep this structural instead of importing AnalysisResultStore: the concrete
 * store already imports this record module, so importing it back here would
 * create a circular dependency.
 */
export interface CandidatePassBInsightStorePort {
  replaceCandidatePassBInsightsIfUnchanged(
    expected: CandidatePassBInsightsRecord | null,
    replacement: CandidatePassBInsightsRecord,
  ): Promise<boolean>;
  getCandidatePassBInsights(
    runId: string,
  ): Promise<CandidatePassBInsightsRecord | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maximum = 20_000): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function isNonEmptyBoundedString(value: unknown, maximum = 20_000): value is string {
  return isBoundedString(value, maximum) && value.trim().length > 0;
}

function isStoredInsight(value: unknown): value is StoredCandidatePassBInsight {
  if (!isRecord(value)) {
    return false;
  }
  const participants = value.identifiedParticipants;
  const participantPresence = value.participantPresence;
  const participantSummaryKo = value.participantSummaryKo;
  return (
    isBoundedString(value.eventSummaryKo, 1_000) &&
    isBoundedString(value.reactionSummaryKo, 1_000) &&
    isBoundedString(value.whyGoodClipKo, 1_000) &&
    Array.isArray(value.uncertaintiesKo) &&
    value.uncertaintiesKo.length <= 8 &&
    value.uncertaintiesKo.every((item) => isBoundedString(item, 500)) &&
    ((participantPresence === undefined && participantSummaryKo === undefined) ||
      ([
        "identified",
        "present-unidentified",
        "none-present",
        "insufficient-evidence",
      ].includes(participantPresence as string) &&
        isNonEmptyBoundedString(participantSummaryKo, 1_000))) &&
    (participants === undefined ||
      (Array.isArray(participants) &&
        participants.length <= 6 &&
        participants.every(isStoredParticipantAttribution))) &&
    (value.clipDecision === undefined ||
      ["recommend", "reject", "uncertain"].includes(value.clipDecision as string)) &&
    (value.contextConsistency === undefined ||
      ["consistent", "conflict", "insufficient"].includes(
        value.contextConsistency as string,
      )) &&
    (value.programMaterial === undefined ||
      ["streamer-event", "music-or-intermission", "routine-or-unclear"].includes(
        value.programMaterial as string,
      ))
  );
}

function isStoredParticipantAttribution(
  value: unknown,
): value is CandidatePassBParticipantAttribution {
  return (
    isRecord(value) &&
    isNonEmptyBoundedString(value.displayName, 80) &&
    ["streamer", "guest", "unknown"].includes(value.role as string) &&
    ["on-screen-name", "spoken-name", "provided-cast-reference"].includes(
      value.evidenceBasis as string,
    ) &&
    isNonEmptyBoundedString(value.evidenceKo, 300) &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    Number.isSafeInteger(value.relativeTimestampMs) &&
    (value.relativeTimestampMs as number) >= 0 &&
    (value.relativeTimestampMs as number) <= 60_000 &&
    (value.observedFrameIndices === undefined ||
      (Array.isArray(value.observedFrameIndices) &&
        value.observedFrameIndices.length <= 4 &&
        new Set(value.observedFrameIndices).size === value.observedFrameIndices.length &&
        value.observedFrameIndices.every(
          (frameIndex) =>
            Number.isSafeInteger(frameIndex) && frameIndex >= 0 && frameIndex < 4,
        )))
  );
}

function isEvidence(value: unknown): value is CandidatePassBEvidence {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isBoundedString(value.candidateId, 256) &&
    Array.isArray(value.cues) &&
    value.cues.length <= 32 &&
    isRecord(value.overlay) &&
    isBoundedString(value.overlay.event, 1_000) &&
    isBoundedString(value.overlay.why, 1_000) &&
    isBoundedString(value.overlay.reviewHint, 1_000) &&
    isBoundedString(value.overlay.basisLabel, 200) &&
    isRecord(value.quality) &&
    Object.entries(value.quality).every(([key, item]) =>
      key === "meanConfidence"
        ? item === null || (typeof item === "number" && Number.isFinite(item))
        : typeof item === "number" && Number.isFinite(item),
    ) &&
    ["grounded-transcript", "provisional-transcript", "fast-pass-fallback"].includes(
      value.status as string,
    )
  );
}

function isCandidateVideoFrame(value: unknown): value is CandidatePassBVideoFrame {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.timestampMs === "number" &&
    Number.isSafeInteger(value.timestampMs) &&
    value.timestampMs >= 0 &&
    value.timestampMs <= 60_000 &&
    value.mimeType === "image/jpeg" &&
    typeof value.dataBase64 === "string" &&
    value.dataBase64.length > 0 &&
    value.dataBase64.length <= MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH &&
    /^[A-Za-z0-9+/]+={0,2}$/u.test(value.dataBase64)
  );
}

function isStoredModelIdentity(
  value: unknown,
): value is StoredCandidatePassBModelIdentity {
  return (
    isRecord(value) &&
    Object.keys(value).sort().join(",") === "id,revision" &&
    ((value.id === CANDIDATE_PASS_B_QWEN_MODEL_ID &&
      (value.revision === CANDIDATE_PASS_B_QWEN_MODEL_REVISION ||
        value.revision === CANDIDATE_PASS_B_CONTEXTLESS_QWEN_MODEL_REVISION ||
        value.revision === CANDIDATE_PASS_B_PREVIOUS_QWEN_MODEL_REVISION ||
        value.revision === CANDIDATE_PASS_B_PRIOR_QWEN_MODEL_REVISION ||
        value.revision === CANDIDATE_PASS_B_OLDER_QWEN_MODEL_REVISION)) ||
      (value.id === CANDIDATE_PASS_B_GEMINI_MODEL_ID &&
        (value.revision === CANDIDATE_PASS_B_GEMINI_MODEL_REVISION ||
          value.revision === CANDIDATE_PASS_B_CONTEXTLESS_GEMINI_MODEL_REVISION ||
          value.revision === CANDIDATE_PASS_B_PREVIOUS_GEMINI_MODEL_REVISION ||
          value.revision === CANDIDATE_PASS_B_PRIOR_GEMINI_MODEL_REVISION ||
          value.revision === CANDIDATE_PASS_B_OLDER_GEMINI_MODEL_REVISION)) ||
      (value.id === CANDIDATE_PASS_B_LEGACY_GEMINI_MODEL_ID &&
        value.revision === CANDIDATE_PASS_B_LEGACY_GEMINI_MODEL_REVISION))
  );
}

export function assertCandidatePassBInsightsRecord(
  value: unknown,
): asserts value is CandidatePassBInsightsRecord {
  if (
    !isRecord(value) ||
    value.kind !== "candidatePassBInsights" ||
    typeof value.schemaVersion !== "string" ||
    !SUPPORTED_INSIGHT_SCHEMA_VERSIONS.has(
      value.schemaVersion as CandidatePassBInsightSchemaVersion,
    ) ||
    !isNonEmptyBoundedString(value.runId, 180) ||
    !isNonEmptyBoundedString(value.inputSignature, 512) ||
    !isNonEmptyBoundedString(value.modelManifestHash, 256) ||
    !isRecord(value.evidenceById) ||
    !isRecord(value.insightById) ||
    !isNonEmptyBoundedString(value.recordedAt, 40) ||
    Number.isNaN(Date.parse(value.recordedAt))
  ) {
    throw new TypeError("Invalid Candidate Pass B insight record.");
  }
  for (const [candidateId, evidence] of Object.entries(value.evidenceById)) {
    if (!isEvidence(evidence) || candidateId !== evidence.candidateId) {
      throw new TypeError("Invalid Candidate Pass B evidence entry.");
    }
  }
  for (const insight of Object.values(value.insightById)) {
    if (!isStoredInsight(insight)) {
      throw new TypeError("Invalid Candidate Pass B insight entry.");
    }
  }
  if (value.modelByCandidateId !== undefined) {
    if (!isRecord(value.modelByCandidateId)) {
      throw new TypeError("Invalid Candidate Pass B model map.");
    }
    for (const [candidateId, model] of Object.entries(value.modelByCandidateId)) {
      if (!isNonEmptyBoundedString(candidateId, 256) || !isStoredModelIdentity(model)) {
        throw new TypeError("Invalid Candidate Pass B model entry.");
      }
    }
  }
  if (value.thumbnailById !== undefined) {
    if (!isRecord(value.thumbnailById)) {
      throw new TypeError("Invalid Candidate Pass B thumbnail map.");
    }
    for (const frame of Object.values(value.thumbnailById)) {
      if (!isCandidateVideoFrame(frame)) {
        throw new TypeError("Invalid Candidate Pass B thumbnail entry.");
      }
    }
  }
  if (value.verificationReceiptById !== undefined) {
    if (!isRecord(value.verificationReceiptById)) {
      throw new TypeError("Invalid Candidate Pass B verification receipt map.");
    }
    for (const [candidateId, receipt] of Object.entries(
      value.verificationReceiptById,
    )) {
      if (
        !isNonEmptyBoundedString(candidateId, 256) ||
        !isCandidatePassBVerificationReceipt(receipt) ||
        (receipt.schemaVersion ===
          CANDIDATE_PASS_B_VERIFICATION_RECEIPT_SCHEMA_VERSION &&
          receipt.candidateId !== candidateId)
      ) {
        throw new TypeError("Invalid Candidate Pass B verification receipt entry.");
      }
    }
  }
}

export function cloneCandidatePassBInsightsRecord(
  record: CandidatePassBInsightsRecord,
): CandidatePassBInsightsRecord {
  assertCandidatePassBInsightsRecord(record);
  return JSON.parse(JSON.stringify(record)) as CandidatePassBInsightsRecord;
}

function jsonStructuresExactlyMatch(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) =>
        jsonStructuresExactlyMatch(item, right[index]),
      )
    );
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        jsonStructuresExactlyMatch(left[key], right[key]),
    )
  );
}

export function candidatePassBInsightSnapshotsExactlyMatch(
  left: CandidatePassBInsightsRecord | null,
  right: CandidatePassBInsightsRecord | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  const leftSnapshot = cloneCandidatePassBInsightsRecord(left);
  const rightSnapshot = cloneCandidatePassBInsightsRecord(right);
  return jsonStructuresExactlyMatch(leftSnapshot, rightSnapshot);
}

/**
 * Replaces one complete snapshot only when the durable value is still the
 * exact snapshot the caller observed, then proves the committed replacement
 * can be read back before callers publish success.
 *
 * `expected === null` is a create-only compare. It never means "overwrite
 * whatever is there". This keeps a late callback or another tab from replacing
 * newer evidence, thumbnails or receipts with its older full-map snapshot.
 */
export async function persistCandidatePassBInsightsWithReadback(
  store: CandidatePassBInsightStorePort,
  expectedRecord: CandidatePassBInsightsRecord | null,
  replacementRecord: CandidatePassBInsightsRecord,
): Promise<CandidatePassBInsightsRecord> {
  const expected =
    expectedRecord === null
      ? null
      : cloneCandidatePassBInsightsRecord(expectedRecord);
  const replacement = cloneCandidatePassBInsightsRecord(replacementRecord);
  if (expected !== null && expected.runId !== replacement.runId) {
    throw new Error(
      "Candidate Pass B insight compare-and-swap records must share one run id.",
    );
  }
  const replaced = await store.replaceCandidatePassBInsightsIfUnchanged(
    expected,
    cloneCandidatePassBInsightsRecord(replacement),
  );
  if (!replaced) {
    throw new Error(
      "Candidate Pass B insight commit was rejected because the durable snapshot changed.",
    );
  }

  const readback = await store.getCandidatePassBInsights(replacement.runId);
  if (readback === null) {
    throw new Error(
      "Candidate Pass B insight commit could not be verified: readback is missing.",
    );
  }

  let verifiedReadback: CandidatePassBInsightsRecord;
  try {
    verifiedReadback = cloneCandidatePassBInsightsRecord(readback);
  } catch (error) {
    throw new Error(
      "Candidate Pass B insight commit could not be verified: readback is invalid.",
      { cause: error },
    );
  }
  if (
    !candidatePassBInsightSnapshotsExactlyMatch(
      replacement,
      verifiedReadback,
    )
  ) {
    throw new Error(
      "Candidate Pass B insight commit could not be verified: readback does not exactly match the written snapshot.",
    );
  }
  return verifiedReadback;
}
