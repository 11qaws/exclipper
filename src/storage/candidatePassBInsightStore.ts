import type { CandidatePassBEvidence } from "../analysis/candidatePassB";
import {
  CANDIDATE_PASS_B_GEMINI_MODEL_ID,
  CANDIDATE_PASS_B_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_OLDER_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_PREVIOUS_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_LEGACY_GEMINI_MODEL_ID,
  CANDIDATE_PASS_B_LEGACY_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_OLDER_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_PREVIOUS_QWEN_MODEL_REVISION,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH,
  type CandidatePassBParticipantAttribution,
  type CandidatePassBVideoFrame,
} from "../analysis/candidatePassBWorkerProtocol";

export const CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION = "1.3.0" as const;
export type CandidatePassBInsightSchemaVersion =
  | "1.0.0"
  | "1.1.0"
  | "1.2.0"
  | "1.3.0";

const SUPPORTED_INSIGHT_SCHEMA_VERSIONS = new Set<CandidatePassBInsightSchemaVersion>([
  "1.0.0",
  "1.1.0",
  "1.2.0",
  CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
]);

export interface StoredCandidatePassBInsight {
  readonly eventSummaryKo: string;
  readonly reactionSummaryKo: string;
  readonly whyGoodClipKo: string;
  readonly uncertaintiesKo: readonly string[];
  readonly identifiedParticipants?: readonly CandidatePassBParticipantAttribution[];
}

export interface StoredCandidatePassBModelIdentity {
  readonly id:
    | typeof CANDIDATE_PASS_B_QWEN_MODEL_ID
    | typeof CANDIDATE_PASS_B_GEMINI_MODEL_ID
    | typeof CANDIDATE_PASS_B_LEGACY_GEMINI_MODEL_ID;
  readonly revision:
    | typeof CANDIDATE_PASS_B_QWEN_MODEL_REVISION
    | typeof CANDIDATE_PASS_B_PREVIOUS_QWEN_MODEL_REVISION
    | typeof CANDIDATE_PASS_B_OLDER_QWEN_MODEL_REVISION
    | typeof CANDIDATE_PASS_B_GEMINI_MODEL_REVISION
    | typeof CANDIDATE_PASS_B_PREVIOUS_GEMINI_MODEL_REVISION
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
  readonly recordedAt: string;
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
  return (
    isBoundedString(value.eventSummaryKo, 1_000) &&
    isBoundedString(value.reactionSummaryKo, 1_000) &&
    isBoundedString(value.whyGoodClipKo, 1_000) &&
    Array.isArray(value.uncertaintiesKo) &&
    value.uncertaintiesKo.length <= 8 &&
    value.uncertaintiesKo.every((item) => isBoundedString(item, 500)) &&
    (participants === undefined ||
      (Array.isArray(participants) &&
        participants.length <= 6 &&
        participants.every(isStoredParticipantAttribution)))
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
    (value.relativeTimestampMs as number) <= 60_000
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
        value.revision === CANDIDATE_PASS_B_PREVIOUS_QWEN_MODEL_REVISION ||
        value.revision === CANDIDATE_PASS_B_OLDER_QWEN_MODEL_REVISION)) ||
      (value.id === CANDIDATE_PASS_B_GEMINI_MODEL_ID &&
        (value.revision === CANDIDATE_PASS_B_GEMINI_MODEL_REVISION ||
          value.revision === CANDIDATE_PASS_B_PREVIOUS_GEMINI_MODEL_REVISION ||
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
}

export function cloneCandidatePassBInsightsRecord(
  record: CandidatePassBInsightsRecord,
): CandidatePassBInsightsRecord {
  assertCandidatePassBInsightsRecord(record);
  return JSON.parse(JSON.stringify(record)) as CandidatePassBInsightsRecord;
}
