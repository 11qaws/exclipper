import type { BroadcastContextDiscoveredLead } from "./broadcastContextProtocol";
import type { UnifiedHighlightCandidate } from "./highlightFusion";
import type { RefinedDiscoveredLeadRange } from "./discoveredLeadRefinement";

function semanticLeadPairFingerprint(parentLeadId: string, childLeadId: string): string {
  const serialized = JSON.stringify([parentLeadId, childLeadId]);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return `pair-${hash.toString(16).padStart(16, "0")}`;
}

export function createSemanticLeadCandidate(
  lead: BroadcastContextDiscoveredLead,
  range: RefinedDiscoveredLeadRange,
  transcriptKo: string,
  parentLeadId?: string,
): UnifiedHighlightCandidate {
  const candidateLeadId =
    parentLeadId === undefined
      ? lead.leadId
      : semanticLeadPairFingerprint(parentLeadId, lead.leadId);
  if (
    range.leadId !== lead.leadId ||
    transcriptKo.trim().length === 0 ||
    candidateLeadId.length === 0 ||
    candidateLeadId.length > 300 ||
    /[\p{Cc}\p{Cf}]/u.test(candidateLeadId) ||
    !Number.isFinite(lead.confidence) ||
    lead.confidence < 0 ||
    lead.confidence > 1
  ) {
    throw new RangeError("Semantic lead candidate evidence is invalid.");
  }
  const normalizedScore = Math.round(lead.confidence * 1_000_000) / 1_000_000;
  return {
    id: `semantic-${candidateLeadId}`,
    startMs: range.startMs,
    peakMs: range.peakMs,
    endMs: range.endMs,
    score: normalizedScore,
    reason:
      "방송 전체 대사 맥락에서 소리 크기와 무관한 의미 사건을 다시 찾아낸 후보예요.",
    signalKinds: ["semantic"],
    evidence: {
      normalization: "within-signal-rank-and-mad",
      semantic: {
        rankPercentile: normalizedScore,
        robustPercentile: normalizedScore,
        normalizedScore,
        category: lead.category,
        confidence: normalizedScore,
        eventSummaryKo: lead.eventSummaryKo,
        whyThisMomentKo: lead.whyThisMomentKo,
        evidenceCueKo: lead.evidenceCueKo,
        transcriptKo: transcriptKo.trim(),
      },
    },
  };
}

export const SEMANTIC_LEAD_CANDIDATE_RECORD_VERSION = "1.0.0" as const;

interface SemanticLeadCandidateRecord {
  readonly schemaVersion: typeof SEMANTIC_LEAD_CANDIDATE_RECORD_VERSION;
  readonly id: string;
  readonly startMs: number;
  readonly peakMs: number;
  readonly endMs: number;
  readonly score: number;
  readonly category: BroadcastContextDiscoveredLead["category"];
  readonly eventSummaryKo: string;
  readonly whyThisMomentKo: string;
  readonly evidenceCueKo: string;
  readonly transcriptKo: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SEMANTIC_CATEGORIES = new Set<BroadcastContextDiscoveredLead["category"]>([
  "reaction",
  "quiet-achievement",
  "setup-and-payoff",
  "running-gag",
  "context-dependent",
  "apology-accountability",
]);

function boundedText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

export function serializeSemanticLeadCandidates(
  candidates: readonly UnifiedHighlightCandidate[],
): string {
  const records: SemanticLeadCandidateRecord[] = candidates.map((candidate) => {
    const semantic = candidate.evidence.semantic;
    if (semantic === undefined || candidate.signalKinds.join() !== "semantic") {
      throw new RangeError("Only semantic lead candidates can be serialized here.");
    }
    return {
      schemaVersion: SEMANTIC_LEAD_CANDIDATE_RECORD_VERSION,
      id: candidate.id,
      startMs: candidate.startMs,
      peakMs: candidate.peakMs,
      endMs: candidate.endMs,
      score: candidate.score,
      category: semantic.category,
      eventSummaryKo: semantic.eventSummaryKo,
      whyThisMomentKo: semantic.whyThisMomentKo,
      evidenceCueKo: semantic.evidenceCueKo,
      transcriptKo: semantic.transcriptKo,
    };
  });
  return JSON.stringify(records);
}

export function parseSemanticLeadCandidates(
  value: unknown,
): readonly UnifiedHighlightCandidate[] | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const candidates: UnifiedHighlightCandidate[] = [];
  const seenIds = new Set<string>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      Object.keys(item).sort().join() !==
        [
          "category",
          "endMs",
          "eventSummaryKo",
          "evidenceCueKo",
          "id",
          "peakMs",
          "schemaVersion",
          "score",
          "startMs",
          "transcriptKo",
          "whyThisMomentKo",
        ]
          .sort()
          .join() ||
      item.schemaVersion !== SEMANTIC_LEAD_CANDIDATE_RECORD_VERSION ||
      !boundedText(item.id, 320) ||
      seenIds.has(item.id) ||
      !Number.isSafeInteger(item.startMs) ||
      !Number.isSafeInteger(item.peakMs) ||
      !Number.isSafeInteger(item.endMs) ||
      (item.startMs as number) < 0 ||
      (item.peakMs as number) < (item.startMs as number) ||
      (item.endMs as number) <= (item.peakMs as number) ||
      (item.endMs as number) - (item.startMs as number) < 30_000 ||
      (item.endMs as number) - (item.startMs as number) > 60_000 ||
      typeof item.score !== "number" ||
      !Number.isFinite(item.score) ||
      item.score < 0 ||
      item.score > 1 ||
      typeof item.category !== "string" ||
      !SEMANTIC_CATEGORIES.has(item.category as BroadcastContextDiscoveredLead["category"]) ||
      !boundedText(item.eventSummaryKo, 1_200) ||
      !boundedText(item.whyThisMomentKo, 1_200) ||
      !boundedText(item.evidenceCueKo, 1_200) ||
      !boundedText(item.transcriptKo, 12_000)
    ) {
      return null;
    }
    seenIds.add(item.id);
    const normalizedScore = item.score;
    candidates.push({
      id: item.id,
      startMs: item.startMs as number,
      peakMs: item.peakMs as number,
      endMs: item.endMs as number,
      score: normalizedScore,
      reason:
        "방송 전체 대사 맥락에서 소리 크기와 무관한 의미 사건을 다시 찾아낸 후보예요.",
      signalKinds: ["semantic"],
      evidence: {
        normalization: "within-signal-rank-and-mad",
        semantic: {
          rankPercentile: normalizedScore,
          robustPercentile: normalizedScore,
          normalizedScore,
          category: item.category as BroadcastContextDiscoveredLead["category"],
          confidence: normalizedScore,
          eventSummaryKo: item.eventSummaryKo,
          whyThisMomentKo: item.whyThisMomentKo,
          evidenceCueKo: item.evidenceCueKo,
          transcriptKo: item.transcriptKo,
        },
      },
    });
  }
  return candidates;
}
