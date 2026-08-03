/**
 * Adapter: analysis results → ReviewSurface view model.
 *
 * Keeping this separate from the component means the surface never imports an
 * analysis type, and the mapping itself stays unit-testable without a DOM.
 *
 * Everything here is defensive about missing data: Pass B may not have produced
 * an insight, a transcript, participants or frames for a given candidate, and
 * the surface must render honestly in that case rather than inventing content.
 */
import type { CandidatePassBContextPacket } from "../analysis/candidatePassBWorkerProtocol";
import type { CandidatePassBInsight } from "../analysis/candidatePassBWorkerProtocol";
import type { CandidatePassBPresentationCue } from "../analysis/candidatePassBPresentation";
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

/** A captured frame. `timestampMs` is relative to the candidate's start. */
export interface ReviewSourceFrame {
  readonly timestampMs: number;
  readonly mimeType?: string;
  readonly dataBase64?: string;
}

export interface ReviewModelInput {
  readonly candidates: readonly ReviewSourceCandidate[];
  readonly insightById: Readonly<Record<string, CandidatePassBInsight | undefined>>;
  readonly contextById: Readonly<Record<string, CandidatePassBContextPacket | undefined>>;
  /** 이미 절대 시각으로 정규화된 대사 cue (`buildCandidatePassBPresentation`). */
  readonly cuesById: Readonly<
    Record<string, readonly CandidatePassBPresentationCue[] | undefined>
  >;
  readonly framesById: Readonly<Record<string, readonly ReviewSourceFrame[] | undefined>>;
  /** 사용/빼기 결정. 없으면 미검토. */
  readonly decisionById: Readonly<Record<string, ReviewDecision | undefined>>;
  /** 사용자가 고친 제목이 있으면 그것을 우선한다. */
  readonly titleById?: Readonly<Record<string, string | undefined>>;
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

/**
 * 등장 인물 전원. 이름이 확인되지 않은 참가자도 **빼지 않는다** — 화면에
 * 있었다는 사실 자체가 판단 재료이므로, 이름만 비워 "이름 미확인"으로 보낸다.
 */
function toPeople(
  insight: CandidatePassBInsight | undefined,
  profileImageByName: Readonly<Record<string, string | undefined>>,
): readonly ReviewPerson[] {
  const attributions = insight?.identifiedParticipants ?? [];
  const seen = new Set<string>();
  const people: ReviewPerson[] = [];
  for (const attribution of attributions) {
    const name = attribution.displayName.trim();
    if (name.length === 0) {
      people.push({ role: roleLabel(attribution.role) });
      continue;
    }
    if (seen.has(name)) continue;
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
  cues: readonly CandidatePassBPresentationCue[] | undefined,
  candidateId: string,
): readonly ReviewCue[] {
  if (cues === undefined) return [];
  return cues
    .filter((cue) => cue.text.trim().length > 0)
    .map((cue, index) => ({
      id: `${candidateId}-cue-${index}`,
      atMs: cue.absoluteStartMs,
      text: cue.text.trim(),
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

/** 프레임 시각은 후보 시작 기준 상대값이라 절대 시각으로 되돌린다. */
function toFrames(
  frames: readonly ReviewSourceFrame[] | undefined,
  candidate: ReviewSourceCandidate,
): readonly ReviewFrame[] {
  if (frames === undefined) return [];
  return frames.map((frame, index) => {
    const imageUrl =
      frame.mimeType !== undefined && frame.dataBase64 !== undefined
        ? `data:${frame.mimeType};base64,${frame.dataBase64}`
        : undefined;
    return {
      id: `${candidate.id}-frame-${index}`,
      atMs: candidate.startMs + frame.timestampMs,
      ...(imageUrl === undefined ? {} : { imageUrl }),
    };
  });
}

export function buildReviewCandidates(input: ReviewModelInput): readonly ReviewCandidate[] {
  const profiles = input.profileImageByName ?? {};
  const titles = input.titleById ?? {};
  return input.candidates.map((candidate) => {
    const insight = input.insightById[candidate.id];
    const packet = input.contextById[candidate.id];
    const event = insight?.eventSummaryKo?.trim() ?? "";
    const reaction = insight?.reactionSummaryKo?.trim() ?? "";
    const clipReason = insight?.whyGoodClipKo?.trim() ?? "";
    const contextSummary = packet?.contextVerdictKo?.trim() ?? "";
    const contextTopic = packet?.topicContextKo?.trim() ?? "";
    const cues = toCues(input.cuesById[candidate.id], candidate.id);
    const representativeCue = [...cues].sort(
      (left, right) =>
        Math.abs(left.atMs - candidate.peakMs) -
          Math.abs(right.atMs - candidate.peakMs) ||
        left.atMs - right.atMs,
    )[0];
    const editedTitle = titles[candidate.id]?.trim();
    return {
      id: candidate.id,
      title:
        editedTitle !== undefined && editedTitle.length > 0
          ? editedTitle
          : candidate.titleKo?.trim() ?? fallbackTitle(insight),
      startMs: candidate.startMs,
      endMs: candidate.endMs,
      peakMs: candidate.peakMs,
      decision: input.decisionById[candidate.id] ?? "pending",
      event: event.length > 0 ? event : "이 구간의 사건 설명이 아직 준비되지 않았습니다.",
      reaction:
        reaction.length > 0
          ? reaction
          : "스트리머의 반응 설명이 아직 준비되지 않았습니다.",
      clipReason:
        clipReason.length > 0
          ? clipReason
          : "클립 후보로 남긴 이유가 아직 준비되지 않았습니다.",
      ...(contextSummary.length > 0 ? { contextSummary } : {}),
      ...(contextTopic.length > 0 ? { contextTopic } : {}),
      ...(representativeCue === undefined ? {} : { quote: representativeCue.text }),
      people: toPeople(insight, profiles),
      cues,
      context: toContext(packet, candidate),
      frames: toFrames(input.framesById[candidate.id], candidate),
    };
  });
}
