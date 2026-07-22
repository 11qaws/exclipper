import type {
  BroadcastContextCandidateAnnotation,
  BroadcastContextCandidateInput,
  BroadcastContextChapterInput,
  BroadcastContextDiscoveredLead,
  BroadcastContextSemanticChapter,
} from "./broadcastContextProtocol";

export const MAX_TOPICAL_DISCOVERY_CALLS = 4;
export const MAX_MERGED_DISCOVERED_LEADS = 32;
export const MAX_TOPICAL_REFINEMENT_LEADS = 20;
export const BROADCAST_TOPICAL_DISCOVERY_VERSION = "1.2.0" as const;

export interface BroadcastTopicalDiscoverySlice {
  readonly sliceId: string;
  readonly titleKo: string;
  readonly chapters: readonly BroadcastContextChapterInput[];
}

function selectedSemanticChapters(
  semanticChapters: readonly BroadcastContextSemanticChapter[],
): readonly BroadcastContextSemanticChapter[] {
  return [...semanticChapters]
    .filter(
      (chapter) =>
        chapter.kind !== "context-shift" && chapter.endMs > chapter.startMs,
    )
    .sort(
      (left, right) =>
        (right.salience === "primary" ? 1 : 0) -
          (left.salience === "primary" ? 1 : 0) ||
        right.endMs - right.startMs - (left.endMs - left.startMs) ||
        left.startMs - right.startMs,
    )
    .slice(0, MAX_TOPICAL_DISCOVERY_CALLS)
    .sort((left, right) => left.startMs - right.startMs);
}

/**
 * Builds at most four cheap second-pass transcript slices.  Grounded semantic
 * chapters are preferred; a malformed/empty overview falls back to four even
 * chronological partitions so discovery still has full-broadcast coverage.
 */
export function createBroadcastTopicalDiscoverySlices(
  chapters: readonly BroadcastContextChapterInput[],
  semanticChapters: readonly BroadcastContextSemanticChapter[],
): readonly BroadcastTopicalDiscoverySlice[] {
  if (chapters.length === 0) return [];
  const selected = selectedSemanticChapters(semanticChapters);
  if (selected.length > 0) {
    return selected.flatMap((semanticChapter, index) => {
      const matching = chapters.filter(
        (chapter) =>
          chapter.startMs < semanticChapter.endMs &&
          chapter.endMs > semanticChapter.startMs,
      );
      return matching.length === 0
        ? []
        : [{
            sliceId: `topic-${String(index + 1).padStart(2, "0")}`,
            titleKo: semanticChapter.titleKo,
            chapters: matching,
          }];
    });
  }

  const sliceCount = Math.min(MAX_TOPICAL_DISCOVERY_CALLS, chapters.length);
  return Array.from({ length: sliceCount }, (_, index) => {
    const startIndex = Math.floor((chapters.length * index) / sliceCount);
    const endIndex = Math.floor((chapters.length * (index + 1)) / sliceCount);
    return {
      sliceId: `coverage-${String(index + 1).padStart(2, "0")}`,
      titleKo: `방송 구간 ${index + 1}`,
      chapters: chapters.slice(startIndex, Math.max(startIndex + 1, endIndex)),
    };
  });
}

function nearDuplicate(
  left: BroadcastContextDiscoveredLead,
  right: BroadcastContextDiscoveredLead,
): boolean {
  const overlapMs = Math.max(
    0,
    Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs),
  );
  const shorterMs = Math.min(
    left.endMs - left.startMs,
    right.endMs - right.startMs,
  );
  const longerMs = Math.max(
    left.endMs - left.startMs,
    right.endMs - right.startMs,
  );
  const sameCue =
    left.evidenceCueKo.normalize("NFKC").trim() ===
    right.evidenceCueKo.normalize("NFKC").trim();
  // A broad overview range can contain several genuinely different moments.
  // Deduplicate only similarly-sized ranges; otherwise the more precise
  // topical pass would be erased by a coarse overview lead.
  return sameCue || (
    shorterMs > 0 &&
    longerMs > 0 &&
    shorterMs / longerMs >= 0.5 &&
    overlapMs / shorterMs >= 0.8
  );
}

/** Round-robin merge prevents one long topic from consuming every lead slot. */
export function mergeBroadcastTopicalDiscoveryLeads(
  leadGroups: readonly (readonly BroadcastContextDiscoveredLead[])[],
): readonly BroadcastContextDiscoveredLead[] {
  const orderedGroups = leadGroups.map((group) =>
    [...group].sort(
      (left, right) =>
        right.confidence - left.confidence ||
        left.startMs - right.startMs ||
        left.leadId.localeCompare(right.leadId),
    ),
  );
  const merged: BroadcastContextDiscoveredLead[] = [];
  const maximumGroupLength = Math.max(0, ...orderedGroups.map((group) => group.length));
  for (let rank = 0; rank < maximumGroupLength; rank += 1) {
    for (const group of orderedGroups) {
      const lead = group[rank];
      if (
        lead !== undefined &&
        !merged.some((existing) => nearDuplicate(existing, lead))
      ) {
        merged.push(lead);
        if (merged.length >= MAX_MERGED_DISCOVERED_LEADS) {
          return [...merged].sort(
            (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
          );
        }
      }
    }
  }
  return merged.sort(
    (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
  );
}

export interface BroadcastTopicalLeadJuryPlan {
  readonly chapters: readonly BroadcastContextChapterInput[];
  readonly candidates: readonly BroadcastContextCandidateInput[];
  readonly leadIdByCandidateId: Readonly<Record<string, string>>;
}

function boundedText(value: string, maximumLength: number): string {
  return Array.from(
    value
      .normalize("NFKC")
      .replace(/[\p{Cc}\p{Cf}]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim(),
  )
    .slice(0, maximumLength)
    .join("")
    .trim();
}

/**
 * Turns the discovery reservoir into one cheap comparative editorial jury.
 * The jury receives compact topic context, not the full transcript again.
 */
export function createBroadcastTopicalLeadJuryPlan(
  sourceDurationMs: number,
  broadcastSummaryKo: string,
  semanticChapters: readonly BroadcastContextSemanticChapter[],
  leads: readonly BroadcastContextDiscoveredLead[],
): BroadcastTopicalLeadJuryPlan {
  const juryLeads = leads.slice(0, MAX_MERGED_DISCOVERED_LEADS);
  const leadIdByCandidateId: Record<string, string> = {};
  const candidates = juryLeads.map((lead, index) => {
    const candidateId = `topical-jury-${String(index + 1).padStart(2, "0")}`;
    leadIdByCandidateId[candidateId] = lead.leadId;
    return {
      candidateId,
      startMs: lead.startMs,
      endMs: lead.endMs,
      transcriptKo: boundedText(lead.evidenceCueKo, 12_000) || "대사 근거 재확인 필요",
      eventSummaryKo: boundedText(lead.eventSummaryKo, 1_200) || "사건 요약 재확인 필요",
      reactionSummaryKo:
        boundedText(lead.whyThisMomentKo, 1_200) || "스트리머 반응 재확인 필요",
      chatReactionSummaryKo: null,
    } satisfies BroadcastContextCandidateInput;
  });
  const orderedSemanticChapters = [...semanticChapters]
    .filter(
      (chapter) =>
        Number.isSafeInteger(chapter.startMs) &&
        Number.isSafeInteger(chapter.endMs) &&
        chapter.startMs >= 0 &&
        chapter.endMs > chapter.startMs &&
        chapter.endMs <= sourceDurationMs,
    )
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const chapters = orderedSemanticChapters.length > 0
    ? orderedSemanticChapters.map((chapter, index) => ({
        chapterId: `jury-context-${String(index + 1).padStart(2, "0")}`,
        startMs: chapter.startMs,
        endMs: chapter.endMs,
        evidenceMode: "candidate-context-only" as const,
        evidenceCoverageRatio: 1,
        summaryKo:
          boundedText(
            `${index === 0 ? `${broadcastSummaryKo} / ` : ""}${chapter.titleKo}: ${chapter.summaryKo}`,
            3_000,
          ) || "방송 주제 맥락 재확인 필요",
      }))
    : [{
        chapterId: "jury-context-01",
        startMs: 0,
        endMs: sourceDurationMs,
        evidenceMode: "candidate-context-only" as const,
        evidenceCoverageRatio: 1,
        summaryKo: boundedText(broadcastSummaryKo, 3_000) || "방송 전체 맥락 재확인 필요",
      }];
  return { chapters, candidates, leadIdByCandidateId };
}

function semanticChapterIndexForLead(
  lead: BroadcastContextDiscoveredLead,
  semanticChapters: readonly BroadcastContextSemanticChapter[],
): number {
  const midpointMs = lead.startMs + (lead.endMs - lead.startMs) / 2;
  return semanticChapters.findIndex(
    (chapter) => midpointMs >= chapter.startMs && midpointMs < chapter.endMs,
  );
}

function midpointDistanceMs(
  left: BroadcastContextDiscoveredLead,
  right: BroadcastContextDiscoveredLead,
): number {
  const leftMidpointMs = left.startMs + (left.endMs - left.startMs) / 2;
  const rightMidpointMs = right.startMs + (right.endMs - right.startMs) / 2;
  return Math.abs(leftMidpointMs - rightMidpointMs);
}

/**
 * Keeps every bounded jury-approved lead, then spends the remaining ASR-free
 * caption-refinement slots on topic-balanced context reserves. A topic with
 * fewer jury selections receives proportionally more reserve turns, so one
 * dominant late discussion cannot erase several different events from an
 * earlier topic. Within a topic, farthest-midpoint sampling preserves temporal
 * variety instead of retaining only adjacent high-confidence paraphrases.
 */
export function selectBroadcastTopicalRefinementLeadIds(
  leads: readonly BroadcastContextDiscoveredLead[],
  juryPlan: BroadcastTopicalLeadJuryPlan,
  annotations: readonly BroadcastContextCandidateAnnotation[],
  semanticChapters: readonly BroadcastContextSemanticChapter[],
): readonly string[] {
  const leadById = new Map(leads.map((lead) => [lead.leadId, lead]));
  const selected = annotations
    .filter((annotation) => annotation.clipDecision === "select")
    .flatMap((annotation) => {
      const leadId = juryPlan.leadIdByCandidateId[annotation.candidateId];
      const lead = leadId === undefined ? undefined : leadById.get(leadId);
      return lead === undefined ? [] : [{ lead, confidence: annotation.confidence }];
    })
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        right.lead.confidence - left.lead.confidence ||
        left.lead.startMs - right.lead.startMs,
    );
  if (selected.length === 0) return [];

  const primarySelected = selected.slice(0, MAX_TOPICAL_REFINEMENT_LEADS);
  const selectedIds = new Set(primarySelected.map(({ lead }) => lead.leadId));
  const primaryLeadsByChapter = new Map<number, BroadcastContextDiscoveredLead[]>();
  for (const { lead } of primarySelected) {
    const chapterIndex = semanticChapterIndexForLead(lead, semanticChapters);
    const chapterLeads = primaryLeadsByChapter.get(chapterIndex) ?? [];
    chapterLeads.push(lead);
    primaryLeadsByChapter.set(chapterIndex, chapterLeads);
  }

  const supportGroups = [...primaryLeadsByChapter.entries()].map(
    ([chapterIndex, anchors]) => ({
      chapterIndex,
      primaryCount: anchors.length,
      pickedCount: 0,
      anchors: [...anchors],
      remaining: leads.filter(
        (lead) =>
          !selectedIds.has(lead.leadId) &&
          semanticChapterIndexForLead(lead, semanticChapters) === chapterIndex,
      ),
    }),
  );
  const supportLeads: BroadcastContextDiscoveredLead[] = [];
  // A single possibly-wrong jury seed must not fan out into a large review
  // queue. Multiple independent approvals progressively unlock the wider,
  // caption-only evidence pass; final multimodal cards remain capped at 12.
  const refinementBudget = Math.min(
    MAX_TOPICAL_REFINEMENT_LEADS,
    Math.max(6, primarySelected.length * 5),
  );
  const supportCapacity = refinementBudget - primarySelected.length;
  while (supportLeads.length < supportCapacity) {
    const group = supportGroups
      .filter((item) => item.remaining.length > 0)
      .sort(
        (left, right) =>
          left.pickedCount * left.primaryCount -
            right.pickedCount * right.primaryCount ||
          left.primaryCount - right.primaryCount ||
          left.chapterIndex - right.chapterIndex,
      )[0];
    if (group === undefined) break;

    group.remaining.sort((left, right) => {
      const leftDistanceMs = Math.min(
        ...group.anchors.map((anchor) => midpointDistanceMs(left, anchor)),
      );
      const rightDistanceMs = Math.min(
        ...group.anchors.map((anchor) => midpointDistanceMs(right, anchor)),
      );
      return (
        rightDistanceMs - leftDistanceMs ||
        right.confidence - left.confidence ||
        left.startMs - right.startMs ||
        left.leadId.localeCompare(right.leadId)
      );
    });
    const support = group.remaining.shift();
    if (support === undefined) break;
    group.pickedCount += 1;
    group.anchors.push(support);
    supportLeads.push(support);
  }

  return [
    ...primarySelected.map(({ lead }) => lead.leadId),
    ...supportLeads.map((lead) => lead.leadId),
  ];
}
