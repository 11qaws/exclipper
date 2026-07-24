/**
 * Adapter: analysis results → ReviewSurface view model.
 *
 * Keeping this separate from the component means the surface never imports an
 * analysis type, and the mapping itself stays unit-testable without a DOM.
 *
 * Everything here is defensive about missing data: Pass B may not have produced
 * an insight, a transcript, or participants for a given candidate, and the
 * surface must render honestly in that case rather than inventing content.
 */
import type {
  CandidatePassBContextPacket,
  CandidatePassBInsight,
  CandidatePassBTranscriptSegment,
} from "../analysis/candidatePassBWorkerProtocol";
import type {
  ReviewCandidate,
  ReviewContextItem,
  ReviewCue,
  ReviewDecision,
  ReviewFrame,
  ReviewPerson,
} from "./ReviewSurface";

/** The minimum a candidate must carry for the surface to place it. */
export interface ReviewSourceCandidate {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly peakMs: number;
  readonly titleKo?: string;
}

export interface ReviewModelInput {
  readonly candidates: readonly ReviewSourceCandidate[];
  readonly insightById: Readonly<Record<string, CandidatePassBInsight | undefined>>;
  readonly contextById: Readonly<Record<string, CandidatePassBContextPacket | undefined>>;
  readonly segmentsById: Readonly<
    Record<string, readonly CandidatePassBTranscriptSegment[] | undefined>
  >;
  readonly framesById: Readonly<Record<string, readonly number[] | undefined>>;
  /** 사용 결정. 없으면 미검토. */
  readonly decisionById: Readonly<Record<string, ReviewDecision | undefined>>;
  /** 인물 이름 → 프로필 이미지. 없으면 이니셜로 그린다. */
  readonly profileImageByName?: Readonly<Record<string, string | undefined>>;
}

const ROLE_LABEL_KO: Record<string, string> = {
  streamer: "진행자",
  guest: "게스트",
  unknown: "확인 필요",
};

function roleLabel(role: string): string {
  return ROLE_LABEL_KO[role] ?? role;
}

/** 첫 문장만 취해 제목으로. 제목 필드가 없을 때의 대비책. */
function fallbackTitle(insight: CandidatePassBInsight | undefined): string {
  const summary = insight?.eventSummaryKo?.trim() ?? "";
  if (summary.length === 0) return "제목 없는 구간";
  const firstSentence = summary.split(/(?<=[.!?])\s|\n/u)[0] ?? summary;
  return firstSentence.length > 40 ? `${firstSentence.slice(0, 39)}…` : firstSentence;
}

function toPeople(
  insight: CandidatePassBInsight | undefined,
  profileImageByName: Readonly<Record<string, string | undefined>>,
): readonly ReviewPerson[] {
  const attributions = insight?.identifiedParticipants ?? [];
  const seen = new Set<string>();
  const people: ReviewPerson[] = [];
  for (const attribution of attributions) {
    const name = attribution.displayName.trim();
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    const imageUrl = profileImageByName[name];
    people.push({
      name,
      role: roleLabel(attribution.role),
      ...(imageUrl === undefined ? {} : { imageUrl }),
    });
  }
  return people;
}

function toCues(
  segments: readonly CandidatePassBTranscriptSegment[] | undefined,
  candidateId: string,
): readonly ReviewCue[] {
  if (segments === undefined) return [];
  return segments
    .filter((segment) => segment.text.trim().length > 0)
    .map((segment, index) => ({
      id: `${candidateId}-cue-${index}`,
      atMs: segment.startMs,
      text: segment.text.trim(),
    }));
}

/**
 * Related context. The pipeline gives a before/after pair, so they are labelled
 * by relation ("앞선 맥락"/"이어지는 맥락") rather than asserted adjacency, and
 * anchored just outside the clip so selecting one seeks somewhere meaningful.
 */
function toContext(
  packet: CandidatePassBContextPacket | undefined,
  candidate: ReviewSourceCandidate,
): readonly ReviewContextItem[] {
  if (packet === undefined) return [];
  const items: ReviewContextItem[] = [];
  const before = packet.beforeContextKo?.trim() ?? "";
  const after = packet.afterContextKo?.trim() ?? "";
  if (before.length > 0) {
    items.push({
      id: `${candidate.id}-ctx-before`,
      label: "앞선 맥락",
      text: before,
      atMs: Math.max(0, candidate.startMs - 30_000),
    });
  }
  if (after.length > 0) {
    items.push({
      id: `${candidate.id}-ctx-after`,
      label: "이어지는 맥락",
      text: after,
      atMs: candidate.endMs + 30_000,
    });
  }
  return items;
}

function toFrames(
  timestamps: readonly number[] | undefined,
  candidateId: string,
): readonly ReviewFrame[] {
  if (timestamps === undefined) return [];
  return timestamps.map((atMs, index) => ({ id: `${candidateId}-frame-${index}`, atMs }));
}

export function buildReviewCandidates(input: ReviewModelInput): readonly ReviewCandidate[] {
  const profiles = input.profileImageByName ?? {};
  return input.candidates.map((candidate) => {
    const insight = input.insightById[candidate.id];
    const packet = input.contextById[candidate.id];
    const why = insight?.eventSummaryKo?.trim() ?? "";
    const reaction = insight?.reactionSummaryKo?.trim() ?? "";
    return {
      id: candidate.id,
      title: candidate.titleKo?.trim() ?? fallbackTitle(insight),
      startMs: candidate.startMs,
      endMs: candidate.endMs,
      peakMs: candidate.peakMs,
      decision: input.decisionById[candidate.id] ?? "pending",
      why: why.length > 0 ? why : "이 구간에 대한 설명이 아직 준비되지 않았습니다.",
      ...(reaction.length > 0 ? { quote: reaction } : {}),
      people: toPeople(insight, profiles),
      cues: toCues(input.segmentsById[candidate.id], candidate.id),
      context: toContext(packet, candidate),
      frames: toFrames(input.framesById[candidate.id], candidate.id),
    };
  });
}
