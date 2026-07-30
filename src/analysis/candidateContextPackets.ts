import type { UnifiedHighlightCandidate } from "./highlightFusion";
import type {
  BroadcastContextCandidateCategory,
  BroadcastContextChapterInput,
  BroadcastContextResult,
  BroadcastContextSemanticChapter,
} from "./broadcastContextProtocol";
import type { YouTubeCaptionTrackResult } from "./youtubeCaptionTrack";
import {
  captionTextForRange,
  chapterTextForRange,
} from "./captionCandidateEvidence";
import {
  createCanonicalCandidatePassBContextPacket,
} from "./candidatePassBContextBudget";
import { buildHighlightNarrative } from "./highlightNarrative";
import type { CandidatePassBContextPacket } from "./candidatePassBWorkerProtocol";

const CONTEXT_WINDOW_MS = 2 * 60_000;

export interface CandidateContextPacketBuildInput {
  readonly candidates: readonly (UnifiedHighlightCandidate & {
    readonly reviewState?: "unreviewed" | "approved" | "rejected";
  })[];
  readonly sourceDurationMs: number;
  readonly broadcastContext: BroadcastContextResult | null;
  readonly transcriptChapters: readonly BroadcastContextChapterInput[];
  readonly youtubeCaptionTrack: YouTubeCaptionTrackResult | null;
}

function textForRange(
  input: CandidateContextPacketBuildInput,
  startMs: number,
  endMs: number,
): { readonly text: string; readonly source: "youtube-caption" | "broadcast-transcript" } | null {
  const exactCaption =
    input.youtubeCaptionTrack === null
      ? ""
      : captionTextForRange(input.youtubeCaptionTrack.events, startMs, endMs).trim();
  if (exactCaption.length > 0) {
    return { text: exactCaption, source: "youtube-caption" };
  }
  const transcript = chapterTextForRange(
    input.transcriptChapters,
    startMs,
    endMs,
  ).trim();
  return transcript.length > 0
    ? { text: transcript, source: "broadcast-transcript" }
    : null;
}

function nearestChapterText(
  chapters: readonly BroadcastContextChapterInput[],
  timestampMs: number,
  direction: "before" | "after",
): string {
  const eligible = chapters.filter((chapter) =>
    direction === "before"
      ? chapter.endMs <= timestampMs
      : chapter.startMs >= timestampMs,
  );
  const nearest = [...eligible].sort((left, right) =>
    direction === "before"
      ? right.endMs - left.endMs
      : left.startMs - right.startMs,
  )[0];
  return nearest?.summaryKo.trim() ?? "";
}

function surroundingContext(
  input: CandidateContextPacketBuildInput,
  candidate: UnifiedHighlightCandidate,
  direction: "before" | "after",
): string {
  const atSourceEdge =
    direction === "before"
      ? candidate.startMs <= 1_000
      : candidate.endMs >= input.sourceDurationMs - 1_000;
  if (atSourceEdge) {
    return direction === "before"
      ? "방송 시작 지점이라 이 장면보다 앞선 방송 구간은 없습니다."
      : "방송 종료 지점이라 이 장면보다 뒤의 방송 구간은 없습니다.";
  }
  const startMs =
    direction === "before"
      ? Math.max(0, Math.round(candidate.startMs - CONTEXT_WINDOW_MS))
      : Math.round(candidate.endMs);
  const endMs =
    direction === "before"
      ? Math.round(candidate.startMs)
      : Math.min(input.sourceDurationMs, Math.round(candidate.endMs + CONTEXT_WINDOW_MS));
  return (
    textForRange(input, startMs, endMs)?.text ??
    nearestChapterText(
      input.transcriptChapters,
      direction === "before" ? candidate.startMs : candidate.endMs,
      direction,
    )
  );
}

function matchingTopic(
  chapters: readonly BroadcastContextSemanticChapter[],
  candidate: UnifiedHighlightCandidate,
): string {
  const overlapping = chapters
    .filter(
      (chapter) =>
        chapter.startMs < candidate.endMs && chapter.endMs > candidate.startMs,
    )
    .sort((left, right) => {
      const leftOverlap =
        Math.min(left.endMs, candidate.endMs) -
        Math.max(left.startMs, candidate.startMs);
      const rightOverlap =
        Math.min(right.endMs, candidate.endMs) -
        Math.max(right.startMs, candidate.startMs);
      return rightOverlap - leftOverlap;
    })[0];
  return overlapping === undefined
    ? ""
    : `${overlapping.titleKo}. ${overlapping.summaryKo}`;
}

function chatReaction(candidate: UnifiedHighlightCandidate): string | null {
  const chat = candidate.evidence.chat;
  return chat === undefined
    ? null
    : `채팅 ${chat.messageCount}개, 반응 표현 ${chat.reactionMessageCount}개, 평소 대비 ${chat.burstRatio.toFixed(1)}배`;
}

function allowedCategory(
  category: BroadcastContextCandidateCategory,
): CandidatePassBContextPacket["contextCategory"] {
  return category;
}

export function buildCandidatePassBContextPackets(
  input: CandidateContextPacketBuildInput,
): Readonly<Record<string, CandidatePassBContextPacket>> {
  if (
    input.broadcastContext === null ||
    input.broadcastContext.broadcastSummaryKo.trim().length === 0
  ) {
    return {};
  }
  const result: Record<string, CandidatePassBContextPacket> = {};
  const annotationsById = new Map(
    input.broadcastContext.annotations.map((annotation) => [
      annotation.candidateId,
      annotation,
    ]),
  );

  for (const candidate of input.candidates) {
    const narrative = buildHighlightNarrative(candidate);
    const semantic = candidate.evidence.semantic;
    const annotation = annotationsById.get(candidate.id);
    const editorApproved = candidate.reviewState === "approved";
    const candidateTranscript =
      semantic === undefined
        ? textForRange(
            input,
            Math.round(candidate.startMs),
            Math.round(candidate.endMs),
          ) ?? {
            text:
              "이 후보 구간에는 확정된 참고 대사가 없습니다. 첨부 오디오로 실제 발화 또는 무발화를 확인해야 합니다.",
            source: "broadcast-transcript" as const,
          }
        : {
            text: semantic.transcriptKo.trim(),
            source: "semantic-refinement" as const,
          };
    const category =
      semantic !== undefined
        ? semantic.category
        : annotation === undefined
          ? editorApproved
            ? "context-dependent"
            : "uncertain"
          : allowedCategory(annotation.category);
    const topicContextKo =
      matchingTopic(input.broadcastContext.semanticChapters, candidate) ||
      semantic?.eventSummaryKo ||
      annotation?.contextSummaryKo ||
      narrative.event;
    const contextVerdictKo =
      semantic === undefined
        ? `${annotation?.contextSummaryKo ?? narrative.event} ${annotation?.whyThisMomentKo ?? narrative.whyRecommended}`
        : `${semantic.eventSummaryKo} ${semantic.whyThisMomentKo}`;
    const packet = createCanonicalCandidatePassBContextPacket({
      transcriptSource: candidateTranscript.source,
      transcriptKo: candidateTranscript.text,
      beforeContextKo: surroundingContext(input, candidate, "before"),
      afterContextKo: surroundingContext(input, candidate, "after"),
      broadcastSummaryKo: input.broadcastContext.broadcastSummaryKo,
      topicContextKo,
      fastEvidenceKo: `${narrative.event} ${narrative.streamerReaction} ${narrative.whyRecommended}`,
      contextDecision:
        editorApproved
          ? "review"
          : semantic !== undefined
            ? "select"
            : annotation?.clipDecision ?? "review",
      contextCategory: category,
      contextVerdictKo,
      chatReactionKo: chatReaction(candidate),
    });
    if (packet !== null) result[candidate.id] = packet;
  }
  return result;
}
