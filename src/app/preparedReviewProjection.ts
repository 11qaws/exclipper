import type {
  ChannelPreanalysisReviewBundle,
  ChannelPreanalysisReviewCandidate,
} from "../analysis/channelPreanalysisReviewBundle";
import { channelPreanalysisSourceById } from "../analysis/channelPreanalysisSources";
import type { CandidatePassBParticipantRole } from "../analysis/candidatePassBWorkerProtocol";
import type {
  ReviewCandidate,
  ReviewContextItem,
  ReviewPerson,
} from "./ReviewSurface";

const PARTICIPANT_ROLE_LABEL_KO: Readonly<
  Record<CandidatePassBParticipantRole, string>
> = {
  streamer: "스트리머",
  guest: "게스트",
  unknown: "역할 미확인",
};

export interface PreparedReviewDisplayMetadata {
  readonly artifactId: string;
  readonly artifactRevision: number;
  readonly createdAt: string;
  readonly pipelineRevision: string;
  readonly sourceId: ChannelPreanalysisReviewBundle["source"]["sourceId"];
  readonly channelId: string;
  readonly videoId: string;
  /** Configured channel label, not an inferred video title. */
  readonly sourceDisplayNameKo: string;
  readonly sourceDurationMs: number;
  /** Null unless the sealed broadcast context identified the host by name. */
  readonly streamerNameKo: string | null;
  readonly broadcastSummaryKo: string;
  readonly recurringThemesKo: readonly string[];
  readonly hostStreamerProfile: ChannelPreanalysisReviewBundle["broadcastContext"]["hostStreamerProfile"];
  readonly participantResolutionStatus: ChannelPreanalysisReviewBundle["participantGrounding"]["resolutionStatus"];
}

export type PreparedReviewProjection =
  | {
      readonly outcome: "review-ready";
      readonly display: PreparedReviewDisplayMetadata;
      readonly candidates: readonly ReviewCandidate[];
    }
  | {
      readonly outcome: "verified-empty";
      readonly display: PreparedReviewDisplayMetadata;
      readonly candidates: readonly [];
    };

function nonEmptyText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length === 0 ? null : normalized;
}

function joinedDistinctText(values: readonly (string | null | undefined)[]): string {
  return [
    ...new Set(
      values
        .map(nonEmptyText)
        .filter((value): value is string => value !== null),
    ),
  ].join("\n");
}

function candidatePeakMs(candidate: ChannelPreanalysisReviewCandidate): number {
  return (
    candidate.sourceStartMs +
    candidate.frames[candidate.impactThumbnailFrameIndex].timestampMs
  );
}

function participantPeople(
  candidate: ChannelPreanalysisReviewCandidate,
): readonly ReviewPerson[] {
  return candidate.insight.identifiedParticipants.map((participant) => ({
    name: participant.displayName,
    role: PARTICIPANT_ROLE_LABEL_KO[participant.role],
  }));
}

function candidateContext(
  candidate: ChannelPreanalysisReviewCandidate,
  peakMs: number,
): readonly ReviewContextItem[] {
  const packet = candidate.context;
  const items: ReviewContextItem[] = [
    {
      id: `${candidate.candidateId}-context-before`,
      label: "앞 맥락",
      text: packet.beforeContextKo,
      atMs: candidate.sourceStartMs,
    },
    {
      id: `${candidate.candidateId}-context-topic`,
      label: "주제 맥락",
      text: packet.topicContextKo,
      atMs: peakMs,
    },
    {
      id: `${candidate.candidateId}-context-verdict`,
      label: "전체 흐름 판단",
      text: packet.contextVerdictKo,
      atMs: peakMs,
    },
    {
      id: `${candidate.candidateId}-context-fast-evidence`,
      label: "빠른 탐색 근거",
      text: packet.fastEvidenceKo,
      atMs: peakMs,
    },
    {
      id: `${candidate.candidateId}-context-participants`,
      label: "등장인물",
      text: candidate.insight.participantSummaryKo,
      atMs: peakMs,
    },
    {
      id: `${candidate.candidateId}-context-after`,
      label: "뒤 맥락",
      text: packet.afterContextKo,
      atMs: candidate.sourceEndMs,
    },
  ];
  if (packet.chatReactionKo !== null) {
    items.push({
      id: `${candidate.candidateId}-context-chat`,
      label: "채팅 반응",
      text: packet.chatReactionKo,
      atMs: peakMs,
    });
  }
  candidate.insight.identifiedParticipants.forEach((participant, index) => {
    items.push({
      id: `${candidate.candidateId}-participant-evidence-${String(index)}`,
      label: `인물 근거 · ${participant.displayName}`,
      text: participant.evidenceKo,
      atMs: candidate.sourceStartMs + participant.relativeTimestampMs,
    });
  });
  candidate.insight.uncertaintiesKo.forEach((uncertainty, index) => {
    items.push({
      id: `${candidate.candidateId}-uncertainty-${String(index)}`,
      label: "AI가 확인하지 못한 점",
      text: uncertainty,
      atMs: peakMs,
    });
  });
  return items;
}

function projectCandidate(
  candidate: ChannelPreanalysisReviewCandidate,
): ReviewCandidate {
  const peakMs = candidatePeakMs(candidate);
  const evidenceTitle = nonEmptyText(candidate.evidence.overlay.event);
  const insightTitle = nonEmptyText(candidate.insight.eventSummaryKo);
  const representativeCue = [...candidate.evidence.cues].sort(
    (left, right) =>
      Math.abs(left.absoluteStartMs - peakMs) -
        Math.abs(right.absoluteStartMs - peakMs) ||
      left.absoluteStartMs - right.absoluteStartMs,
  )[0];
  return {
    id: candidate.candidateId,
    title: evidenceTitle ?? insightTitle ?? candidate.candidateId,
    startMs: candidate.sourceStartMs,
    endMs: candidate.sourceEndMs,
    peakMs,
    decision: "pending",
    why: joinedDistinctText([
      candidate.insight.eventSummaryKo,
      candidate.insight.reactionSummaryKo,
      candidate.insight.whyGoodClipKo,
      candidate.evidence.overlay.why,
    ]),
    ...(representativeCue === undefined
      ? {}
      : { quote: representativeCue.text }),
    people: participantPeople(candidate),
    cues: candidate.evidence.cues.map((cue, index) => ({
      id: `${candidate.candidateId}-cue-${String(index)}`,
      atMs: cue.absoluteStartMs,
      text: cue.text,
    })),
    context: candidateContext(candidate, peakMs),
    frames: candidate.frames.map((frame, index) => ({
      id: `${candidate.candidateId}-frame-${String(index)}`,
      atMs: candidate.sourceStartMs + frame.timestampMs,
      imageUrl: `data:image/jpeg;base64,${frame.dataBase64}`,
    })),
  };
}

/**
 * Projects a previously validated immutable bundle directly into the existing
 * review surface model. It performs no I/O and does not reinterpret evidence.
 */
export function projectPreparedReviewBundle(
  bundle: ChannelPreanalysisReviewBundle,
): PreparedReviewProjection {
  const configuredSource = channelPreanalysisSourceById(bundle.source.sourceId);
  if (configuredSource === null) {
    throw new TypeError("Validated review bundle refers to an unknown source.");
  }
  const display: PreparedReviewDisplayMetadata = {
    artifactId: bundle.artifactId,
    artifactRevision: bundle.artifactRevision,
    createdAt: bundle.createdAt,
    pipelineRevision: bundle.certificate.pipelineRevision,
    sourceId: bundle.source.sourceId,
    channelId: bundle.source.channelId,
    videoId: bundle.source.videoId,
    sourceDisplayNameKo: configuredSource.displayNameKo,
    sourceDurationMs: bundle.sourceDurationMs,
    streamerNameKo:
      nonEmptyText(bundle.broadcastContext.hostStreamerProfile?.displayNameKo) ??
      null,
    broadcastSummaryKo: bundle.broadcastContext.broadcastSummaryKo,
    recurringThemesKo: bundle.broadcastContext.recurringThemesKo,
    hostStreamerProfile: bundle.broadcastContext.hostStreamerProfile,
    participantResolutionStatus: bundle.participantGrounding.resolutionStatus,
  };
  if (bundle.certificate.outcome === "verified-empty") {
    return { outcome: "verified-empty", display, candidates: [] };
  }
  return {
    outcome: "review-ready",
    display,
    candidates: bundle.candidates
      .map(projectCandidate)
      .sort(
        (left, right) =>
          left.peakMs - right.peakMs || left.id.localeCompare(right.id),
      ),
  };
}
