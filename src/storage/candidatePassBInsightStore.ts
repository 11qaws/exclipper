import type { CandidatePassBEvidence } from "../analysis/candidatePassB";

export const CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION = "1.0.0" as const;

export interface StoredCandidatePassBInsight {
  readonly eventSummaryKo: string;
  readonly reactionSummaryKo: string;
  readonly whyGoodClipKo: string;
  readonly uncertaintiesKo: readonly string[];
}

export interface CandidatePassBInsightsRecord {
  readonly kind: "candidatePassBInsights";
  readonly runId: string;
  readonly schemaVersion: typeof CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION;
  readonly inputSignature: string;
  readonly modelManifestHash: string;
  readonly evidenceById: Readonly<Record<string, CandidatePassBEvidence>>;
  readonly insightById: Readonly<Record<string, StoredCandidatePassBInsight>>;
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
  return (
    isBoundedString(value.eventSummaryKo, 1_000) &&
    isBoundedString(value.reactionSummaryKo, 1_000) &&
    isBoundedString(value.whyGoodClipKo, 1_000) &&
    Array.isArray(value.uncertaintiesKo) &&
    value.uncertaintiesKo.length <= 8 &&
    value.uncertaintiesKo.every((item) => isBoundedString(item, 500))
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

export function assertCandidatePassBInsightsRecord(
  value: unknown,
): asserts value is CandidatePassBInsightsRecord {
  if (
    !isRecord(value) ||
    value.kind !== "candidatePassBInsights" ||
    value.schemaVersion !== CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION ||
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
}

export function cloneCandidatePassBInsightsRecord(
  record: CandidatePassBInsightsRecord,
): CandidatePassBInsightsRecord {
  assertCandidatePassBInsightsRecord(record);
  return JSON.parse(JSON.stringify(record)) as CandidatePassBInsightsRecord;
}
