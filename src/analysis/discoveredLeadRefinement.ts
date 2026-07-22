import {
  MAX_BROADCAST_CONTEXT_SUMMARY_LENGTH,
  type BroadcastContextChapterInput,
  type BroadcastContextDiscoveredLead,
} from "./broadcastContextProtocol";
import { QWEN_ASR_FILETRANS_USD_PER_SECOND } from "./broadcastContextSamplingPlan";

export const DISCOVERED_LEAD_REFINEMENT_VERSION = "1.1.0" as const;
export const DISCOVERED_LEAD_REFINEMENT_BUDGET_USD = 0.03;
export const MAX_DISCOVERED_LEADS_TO_REFINE = 4;
export const MAX_CAPTION_DISCOVERED_LEADS_TO_REFINE = 6;
export const REFINEMENT_SEGMENT_DURATION_MS = 60_000;
export const CAPTION_REFINEMENT_SEGMENT_DURATION_MS = 30_000;
export const REFINED_CLIP_DURATION_MS = 60_000;

export interface DiscoveredLeadRefinementSegment {
  readonly segmentId: string;
  readonly leadId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
}

export interface DiscoveredLeadRefinementPlan {
  readonly version: typeof DISCOVERED_LEAD_REFINEMENT_VERSION;
  readonly selectedLeadIds: readonly string[];
  readonly segments: readonly DiscoveredLeadRefinementSegment[];
  readonly estimatedAsrCostUsd: number;
}

export interface DiscoveredLeadRefinementPlanOptions {
  /** The caller already applied a whole-broadcast editorial jury. */
  readonly preserveInputOrder?: boolean;
}

export interface RefinementTranscriptRange {
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly textKo: string;
}

export interface RefinedDiscoveredLeadRange {
  readonly leadId: string;
  readonly startMs: number;
  readonly peakMs: number;
  readonly endMs: number;
  readonly transcriptMatchScore: number;
  readonly matchedSegmentId: string;
}

const MAX_REFINEMENT_AUDIO_MS = Math.floor(
  (DISCOVERED_LEAD_REFINEMENT_BUDGET_USD /
    QWEN_ASR_FILETRANS_USD_PER_SECOND) *
    1_000,
);

function boundedInspectionRange(
  lead: BroadcastContextDiscoveredLead,
  allocatedMs: number,
): { readonly startMs: number; readonly endMs: number } {
  const durationMs = lead.endMs - lead.startMs;
  if (durationMs <= allocatedMs) {
    return { startMs: lead.startMs, endMs: lead.endMs };
  }
  const midpointMs = lead.startMs + durationMs / 2;
  const startMs = Math.round(midpointMs - allocatedMs / 2);
  return { startMs, endMs: startMs + allocatedMs };
}

/**
 * Re-ASRs only a few context-discovered ranges in one-minute cells. This turns
 * a coarse chapter lead into a bounded location before multimodal AI sees
 * the final one-minute audio/video candidate.
 */
export function createDiscoveredLeadRefinementPlan(
  leads: readonly BroadcastContextDiscoveredLead[],
  options: DiscoveredLeadRefinementPlanOptions = {},
): DiscoveredLeadRefinementPlan {
  const eligible = [...leads].filter(
      (lead) =>
        Number.isFinite(lead.confidence) &&
        lead.confidence >= 0.55 &&
        Number.isSafeInteger(lead.startMs) &&
        Number.isSafeInteger(lead.endMs) &&
        lead.startMs >= 0 &&
        lead.endMs > lead.startMs,
    );
  const selected = (options.preserveInputOrder === true
    ? eligible
    : eligible.sort(
        (left, right) =>
          right.confidence - left.confidence ||
          left.startMs - right.startMs ||
          left.leadId.localeCompare(right.leadId),
      )
  ).slice(0, MAX_DISCOVERED_LEADS_TO_REFINE);
  const perLeadBudgetMs =
    selected.length === 0
      ? 0
      : Math.floor(MAX_REFINEMENT_AUDIO_MS / selected.length);
  const segments: DiscoveredLeadRefinementSegment[] = [];

  for (const lead of selected) {
    const range = boundedInspectionRange(lead, perLeadBudgetMs);
    let sourceStartMs = range.startMs;
    while (sourceStartMs < range.endMs) {
      const sourceEndMs = Math.min(
        range.endMs,
        sourceStartMs + REFINEMENT_SEGMENT_DURATION_MS,
      );
      segments.push({
        segmentId: `refine-${String(segments.length + 1).padStart(3, "0")}`,
        leadId: lead.leadId,
        sourceStartMs,
        sourceEndMs,
      });
      sourceStartMs = sourceEndMs;
    }
  }
  const sampledMs = segments.reduce(
    (sum, segment) => sum + segment.sourceEndMs - segment.sourceStartMs,
    0,
  );
  return {
    version: DISCOVERED_LEAD_REFINEMENT_VERSION,
    selectedLeadIds: selected.map((lead) => lead.leadId),
    segments,
    estimatedAsrCostUsd:
      (sampledMs / 1_000) * QWEN_ASR_FILETRANS_USD_PER_SECOND,
  };
}

/**
 * Captions are already timestamped and carry no audio-transcription charge, so
 * inspect the entire selected lead instead of trimming it to the ASR reserve.
 * Thirty-second cells give the follow-up router enough precision to place a
 * 30–60 second clip without pretending that the overview knew an exact second.
 */
export function createCaptionDiscoveredLeadRefinementPlan(
  leads: readonly BroadcastContextDiscoveredLead[],
  options: DiscoveredLeadRefinementPlanOptions = {},
): DiscoveredLeadRefinementPlan {
  const eligible = [...leads].filter(
      (lead) =>
        Number.isFinite(lead.confidence) &&
        lead.confidence >= 0.55 &&
        Number.isSafeInteger(lead.startMs) &&
        Number.isSafeInteger(lead.endMs) &&
        lead.startMs >= 0 &&
        lead.endMs > lead.startMs,
    );
  const selected = (options.preserveInputOrder === true
    ? eligible
    : eligible.sort(
        (left, right) =>
          right.confidence - left.confidence ||
          left.startMs - right.startMs ||
          left.leadId.localeCompare(right.leadId),
      )
  ).slice(0, MAX_CAPTION_DISCOVERED_LEADS_TO_REFINE);
  const segments: DiscoveredLeadRefinementSegment[] = [];
  for (const lead of selected) {
    let sourceStartMs = lead.startMs;
    while (sourceStartMs < lead.endMs) {
      const sourceEndMs = Math.min(
        lead.endMs,
        sourceStartMs + CAPTION_REFINEMENT_SEGMENT_DURATION_MS,
      );
      segments.push({
        segmentId: `caption-refine-${String(segments.length + 1).padStart(3, "0")}`,
        leadId: lead.leadId,
        sourceStartMs,
        sourceEndMs,
      });
      sourceStartMs = sourceEndMs;
    }
  }
  return {
    version: DISCOVERED_LEAD_REFINEMENT_VERSION,
    selectedLeadIds: selected.map((lead) => lead.leadId),
    segments,
    estimatedAsrCostUsd: 0,
  };
}

/**
 * Converts the source-fenced refinement ASR results back into the chapter
 * protocol used by the context router. Each parent lead is sent separately so
 * one broad event can yield several independent clip moments without competing
 * with unrelated parts of the broadcast.
 */
export function createDiscoveredLeadRefinementChapters(
  leadId: string,
  plan: DiscoveredLeadRefinementPlan,
  transcripts: readonly RefinementTranscriptRange[],
  parentContextKo = "",
): readonly BroadcastContextChapterInput[] {
  const transcriptByRange = new Map(
    transcripts.map((transcript) => [
      `${transcript.sourceStartMs}:${transcript.sourceEndMs}`,
      transcript,
    ]),
  );
  let emittedCount = 0;
  return plan.segments
    .filter((segment) => segment.leadId === leadId)
    .flatMap((segment) => {
      const transcript = transcriptByRange.get(
        `${segment.sourceStartMs}:${segment.sourceEndMs}`,
      );
      if (transcript === undefined || transcript.textKo.trim().length === 0) {
        return [];
      }
      const prefix = emittedCount === 0 && parentContextKo.trim().length > 0
        ? `[상위 사건] ${parentContextKo.trim()} `
        : "";
      const summaryKo = Array.from(
        `${prefix}${transcript.textKo}`
          .replace(/[\p{Cc}\p{Cf}]/gu, " ")
          .replace(/\s+/gu, " ")
          .trim(),
      )
        .slice(0, MAX_BROADCAST_CONTEXT_SUMMARY_LENGTH)
        .join("")
        .trim();
      if (summaryKo.length === 0) return [];
      emittedCount += 1;
      return [{
        chapterId: segment.segmentId,
        startMs: segment.sourceStartMs,
        endMs: segment.sourceEndMs,
        evidenceMode: "complete-transcript" as const,
        evidenceCoverageRatio: 1,
        summaryKo,
      }];
    });
}

export interface MaterializedRefinedLeadEvidence {
  readonly range: RefinedDiscoveredLeadRange;
  readonly transcriptKo: string;
}

/** Makes a 30–60 second source-fenced candidate from a router-selected cell. */
export function materializeRefinedDiscoveredLeadEvidence(
  lead: BroadcastContextDiscoveredLead,
  transcripts: readonly RefinementTranscriptRange[],
  sourceDurationMs: number,
): MaterializedRefinedLeadEvidence | null {
  if (
    !Number.isSafeInteger(sourceDurationMs) ||
    sourceDurationMs < 30_000 ||
    lead.startMs < 0 ||
    lead.endMs <= lead.startMs ||
    lead.endMs > sourceDurationMs
  ) {
    return null;
  }
  const overlappingTranscripts = transcripts
    .filter(
      (transcript) =>
        transcript.sourceStartMs < lead.endMs &&
        transcript.sourceEndMs > lead.startMs &&
        transcript.textKo.trim().length > 0,
    )
    .sort((left, right) => left.sourceStartMs - right.sourceStartMs);
  const cueMatches = overlappingTranscripts
    .map((transcript) => ({
      transcript,
      score: transcriptMatchScore(lead.evidenceCueKo, transcript.textKo),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.transcript.sourceStartMs - right.transcript.sourceStartMs,
    );
  const bestCueMatch = cueMatches[0];
  const peakMs = bestCueMatch !== undefined && bestCueMatch.score >= 0.2
    ? Math.round(
        bestCueMatch.transcript.sourceStartMs +
          (bestCueMatch.transcript.sourceEndMs -
            bestCueMatch.transcript.sourceStartMs) /
            2,
      )
    : Math.round(lead.startMs + (lead.endMs - lead.startMs) / 2);
  const desiredDurationMs = Math.min(REFINED_CLIP_DURATION_MS, sourceDurationMs);
  const unclampedStartMs = peakMs - Math.floor(desiredDurationMs / 2);
  const startMs = Math.max(
    0,
    Math.min(sourceDurationMs - desiredDurationMs, unclampedStartMs),
  );
  const endMs = startMs + desiredDurationMs;
  const transcriptKo = transcripts
    .filter(
      (transcript) =>
        transcript.sourceStartMs < endMs && transcript.sourceEndMs > startMs,
    )
    .sort((left, right) => left.sourceStartMs - right.sourceStartMs)
    .map((transcript) => transcript.textKo.trim())
    .filter((text) => text.length > 0)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  if (transcriptKo.length === 0) return null;
  return {
    range: {
      leadId: lead.leadId,
      startMs,
      peakMs: Math.max(startMs, Math.min(endMs - 1, peakMs)),
      endMs,
      transcriptMatchScore: bestCueMatch?.score ?? 0,
      matchedSegmentId:
        bestCueMatch === undefined
          ? lead.startChapterId
          : `${bestCueMatch.transcript.sourceStartMs}:${bestCueMatch.transcript.sourceEndMs}`,
    },
    transcriptKo,
  };
}

function normalizedTerms(value: string): readonly string[] {
  return [
    ...new Set(
      value
        .normalize("NFKC")
        .toLocaleLowerCase("ko-KR")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/u)
        .map((term) => term.trim())
        .filter((term) => Array.from(term).length >= 2),
    ),
  ];
}

function transcriptMatchScore(cue: string, transcript: string): number {
  const cueTerms = normalizedTerms(cue);
  if (cueTerms.length === 0) return 0;
  const transcriptTerms = new Set(normalizedTerms(transcript));
  const matches = cueTerms.filter((term) => transcriptTerms.has(term)).length;
  return matches / cueTerms.length;
}

/** Selects one source-fenced ASR cell and expands it to a 45-second clip range. */
export function refineDiscoveredLeadRange(
  lead: BroadcastContextDiscoveredLead,
  plan: DiscoveredLeadRefinementPlan,
  transcripts: readonly RefinementTranscriptRange[],
  sourceDurationMs: number,
): RefinedDiscoveredLeadRange | null {
  const segmentByRange = new Map(
    plan.segments
      .filter((segment) => segment.leadId === lead.leadId)
      .map((segment) => [
        `${segment.sourceStartMs}:${segment.sourceEndMs}`,
        segment,
      ]),
  );
  const matches = transcripts
    .map((transcript) => ({
      transcript,
      segment: segmentByRange.get(
        `${transcript.sourceStartMs}:${transcript.sourceEndMs}`,
      ),
      score: transcriptMatchScore(lead.evidenceCueKo, transcript.textKo),
    }))
    .filter(
      (entry): entry is typeof entry & { segment: DiscoveredLeadRefinementSegment } =>
        entry.segment !== undefined,
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.segment.sourceStartMs - right.segment.sourceStartMs,
    );
  const best = matches[0];
  if (best === undefined) return null;
  const peakMs = Math.round(
    best.segment.sourceStartMs +
      (best.segment.sourceEndMs - best.segment.sourceStartMs) / 2,
  );
  const unclampedStartMs = peakMs - Math.floor(REFINED_CLIP_DURATION_MS / 2);
  const startMs = Math.max(
    0,
    Math.min(sourceDurationMs - REFINED_CLIP_DURATION_MS, unclampedStartMs),
  );
  return {
    leadId: lead.leadId,
    startMs,
    peakMs,
    endMs: Math.min(sourceDurationMs, startMs + REFINED_CLIP_DURATION_MS),
    transcriptMatchScore: best.score,
    matchedSegmentId: best.segment.segmentId,
  };
}
