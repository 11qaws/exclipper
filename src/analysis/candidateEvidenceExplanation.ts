import type { CandidatePassBCue, CandidatePassBEvidence } from "./candidatePassB";
import type { UnifiedHighlightCandidate } from "./highlightFusion";
import type {
  CandidateAudioEventCandidateResult,
  CandidateAudioEventDetection,
  CandidateAudioEventKind,
} from "./candidateAudioEventWorkerProtocol";

export const CANDIDATE_EVIDENCE_EXPLANATION_VERSION =
  "candidate-evidence-explanation-v1" as const;

export const CANDIDATE_EVIDENCE_MAX_QUOTE_CODE_POINTS = 80 as const;

export type CandidateEvidenceBasisCode =
  | "fast-audio-reaction"
  | "fast-chat-reaction"
  | "fast-visual-context"
  | "audio-chat-cooccurrence"
  | "audio-event-strong"
  | "audio-event-possible"
  | "audio-event-no-clear"
  | "transcript-qualified-cue"
  | "transcript-provisional-cue"
  | "transcript-no-clear"
  | "mixed-audio-source-unresolved"
  | "semantic-event-unknown"
  | "causality-unknown"
  | "outcome-unknown";

export type CandidateEvidenceUnknown = "event" | "actor" | "cause" | "outcome";

export type CandidateEvidenceObservedKind =
  | "fast-audio"
  | "chat"
  | "visual"
  | "audio-event"
  | "transcript";

export type CandidateEvidenceReplayBasis =
  | "strong-audio-event"
  | "possible-audio-event"
  | "near-peak-transcript"
  | "before-peak-transcript"
  | "after-peak-transcript"
  | "reaction-peak";

export interface CandidateEvidenceRange {
  readonly startMs: number;
  readonly endMs: number;
}

export interface CandidateEvidenceStatement {
  readonly text: string;
  readonly basisCodes: readonly CandidateEvidenceBasisCode[];
  readonly requiresReplay: boolean;
}

export interface CandidateEvidenceObservedStatement
  extends CandidateEvidenceStatement {
  readonly kind: CandidateEvidenceObservedKind;
}

export interface CandidateEvidencePrimaryReplayFocus {
  readonly basis: CandidateEvidenceReplayBasis;
  readonly startMs: number;
  readonly endMs: number;
  /** Whether the focus start can be sought inside the user's current range. */
  readonly insideEffectiveRange: boolean;
  readonly label: string;
}

export interface CandidateEvidenceExplanation {
  readonly version: typeof CANDIDATE_EVIDENCE_EXPLANATION_VERSION;
  readonly candidateId: string;
  readonly headline: string;
  readonly eventClue: CandidateEvidenceStatement;
  readonly reactionClue: CandidateEvidenceStatement;
  readonly whyWorthReviewing: CandidateEvidenceStatement;
  readonly unknowns: readonly CandidateEvidenceUnknown[];
  readonly observedStatements: readonly CandidateEvidenceObservedStatement[];
  readonly primaryReplayFocus: CandidateEvidencePrimaryReplayFocus;
}

export interface CandidateEvidenceExplanationProjection {
  readonly explanation: CandidateEvidenceExplanation;
  readonly fallbackReason: CandidateEvidenceExplanationErrorCode | null;
  readonly explanationRange: CandidateEvidenceRange;
}

export type CandidateEvidenceReplayTargetBasis =
  | "primary-evidence-focus"
  | "effective-reaction-peak"
  | "effective-range-start";

export interface CandidateEvidenceReplayTarget {
  readonly basis: CandidateEvidenceReplayTargetBasis;
  readonly startMs: number;
  readonly label: string;
}

export interface CandidateEvidenceExplanationInput {
  readonly candidate: UnifiedHighlightCandidate;
  readonly effectiveRange: CandidateEvidenceRange;
  readonly passBEvidence?: CandidatePassBEvidence | undefined;
  readonly audioEventEvidence?: CandidateAudioEventCandidateResult | undefined;
}

export type CandidateEvidenceExplanationErrorCode =
  | "INVALID_EFFECTIVE_RANGE"
  | "PASS_B_CANDIDATE_ID_MISMATCH"
  | "AUDIO_EVENT_CANDIDATE_ID_MISMATCH"
  | "AUDIO_EVENT_PROPOSAL_BINDING_MISMATCH";

export class CandidateEvidenceExplanationError extends Error {
  public readonly code: CandidateEvidenceExplanationErrorCode;
  public readonly candidateId: string;
  public readonly evidenceCandidateId: string | null;

  public constructor(
    code: CandidateEvidenceExplanationErrorCode,
    message: string,
    candidateId: string,
    evidenceCandidateId: string | null = null,
  ) {
    super(message);
    this.name = "CandidateEvidenceExplanationError";
    this.code = code;
    this.candidateId = candidateId;
    this.evidenceCandidateId = evidenceCandidateId;
  }
}

const UNKNOWNS = Object.freeze([
  "event",
  "actor",
  "cause",
  "outcome",
] as const satisfies readonly CandidateEvidenceUnknown[]);

const AUDIO_EVENT_KIND_ORDER = [
  "laughter",
  "shout",
  "scream",
  "applause-or-cheering",
] as const satisfies readonly CandidateAudioEventKind[];

const AUDIO_EVENT_KIND_LABELS: Readonly<Record<CandidateAudioEventKind, string>> = {
  laughter: "웃음",
  shout: "고함·외침",
  scream: "비명",
  "applause-or-cheering": "박수·환호",
};

const TRANSCRIPT_PHASE_LABELS: Readonly<Record<CandidatePassBCue["phase"], string>> = {
  "before-peak": "반응 전",
  "near-peak": "반응 시점 부근",
  "after-peak": "반응 뒤",
};

const TRANSCRIPT_FOCUS_ORDER: Readonly<Record<CandidatePassBCue["phase"], number>> = {
  "near-peak": 0,
  "before-peak": 1,
  "after-peak": 2,
};

function assertEffectiveRange(
  candidateId: string,
  range: CandidateEvidenceRange,
): void {
  if (
    !Number.isSafeInteger(range.startMs) ||
    !Number.isSafeInteger(range.endMs) ||
    range.startMs < 0 ||
    range.startMs >= range.endMs
  ) {
    throw new CandidateEvidenceExplanationError(
      "INVALID_EFFECTIVE_RANGE",
      "The effective candidate range must use non-negative integer milliseconds with start before end.",
      candidateId,
    );
  }
}

function assertEvidenceBindings(input: CandidateEvidenceExplanationInput): void {
  const { candidate, passBEvidence, audioEventEvidence } = input;
  if (passBEvidence !== undefined && passBEvidence.candidateId !== candidate.id) {
    throw new CandidateEvidenceExplanationError(
      "PASS_B_CANDIDATE_ID_MISMATCH",
      "Transcript evidence belongs to another candidate.",
      candidate.id,
      passBEvidence.candidateId,
    );
  }
  if (
    audioEventEvidence !== undefined &&
    audioEventEvidence.candidateId !== candidate.id
  ) {
    throw new CandidateEvidenceExplanationError(
      "AUDIO_EVENT_CANDIDATE_ID_MISMATCH",
      "Audio-event evidence belongs to another candidate.",
      candidate.id,
      audioEventEvidence.candidateId,
    );
  }
  if (
    audioEventEvidence !== undefined &&
    (audioEventEvidence.sourceStartMs !== candidate.startMs ||
      audioEventEvidence.sourceEndMs !== candidate.endMs ||
      audioEventEvidence.reactionPeakMs !== candidate.peakMs)
  ) {
    throw new CandidateEvidenceExplanationError(
      "AUDIO_EVENT_PROPOSAL_BINDING_MISMATCH",
      "Audio-event evidence belongs to another candidate proposal revision.",
      candidate.id,
      audioEventEvidence.candidateId,
    );
  }
}

function frozenBasisCodes(
  values: readonly CandidateEvidenceBasisCode[],
): readonly CandidateEvidenceBasisCode[] {
  return Object.freeze([...new Set(values)]);
}

function statement(
  text: string,
  basisCodes: readonly CandidateEvidenceBasisCode[],
  requiresReplay: boolean,
): CandidateEvidenceStatement {
  return Object.freeze({
    text,
    basisCodes: frozenBasisCodes(basisCodes),
    requiresReplay,
  });
}

function observedStatement(
  kind: CandidateEvidenceObservedKind,
  text: string,
  basisCodes: readonly CandidateEvidenceBasisCode[],
  requiresReplay: boolean,
): CandidateEvidenceObservedStatement {
  return Object.freeze({
    kind,
    text,
    basisCodes: frozenBasisCodes(basisCodes),
    requiresReplay,
  });
}

function topPercent(rankPercentile: number): number {
  return Math.max(1, Math.round((1 - rankPercentile) * 100));
}

/** Normalizes untrusted model text and truncates by Unicode code point. */
export function normalizeCandidateEvidenceQuote(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const codePoints = Array.from(normalized);
  if (codePoints.length <= CANDIDATE_EVIDENCE_MAX_QUOTE_CODE_POINTS) {
    return normalized;
  }
  return `${codePoints
    .slice(0, CANDIDATE_EVIDENCE_MAX_QUOTE_CODE_POINTS - 1)
    .join("")}…`;
}

function quotedTranscript(value: string): string {
  return `“${normalizeCandidateEvidenceQuote(value).replace(/[“”]/gu, '"')}”`;
}

function transcriptCues(
  evidence: CandidatePassBEvidence | undefined,
): readonly CandidatePassBCue[] {
  if (evidence === undefined || evidence.status === "fast-pass-fallback") {
    return [];
  }
  return [...evidence.cues]
    .filter((cue) => normalizeCandidateEvidenceQuote(cue.text).length > 0)
    .sort(
      (left, right) =>
        left.absoluteStartMs - right.absoluteStartMs ||
        left.absoluteEndMs - right.absoluteEndMs ||
        TRANSCRIPT_FOCUS_ORDER[left.phase] -
          TRANSCRIPT_FOCUS_ORDER[right.phase] ||
        normalizeCandidateEvidenceQuote(left.text).localeCompare(
          normalizeCandidateEvidenceQuote(right.text),
        ),
    );
}

function transcriptFocusCues(
  evidence: CandidatePassBEvidence | undefined,
  reactionPeakMs: number,
): readonly CandidatePassBCue[] {
  return [...transcriptCues(evidence)].sort((left, right) => {
    const phaseOrder =
      TRANSCRIPT_FOCUS_ORDER[left.phase] - TRANSCRIPT_FOCUS_ORDER[right.phase];
    if (phaseOrder !== 0) {
      return phaseOrder;
    }
    const leftDistance = Math.abs(
      (left.absoluteStartMs + left.absoluteEndMs) / 2 - reactionPeakMs,
    );
    const rightDistance = Math.abs(
      (right.absoluteStartMs + right.absoluteEndMs) / 2 - reactionPeakMs,
    );
    return (
      leftDistance - rightDistance ||
      left.absoluteStartMs - right.absoluteStartMs ||
      left.absoluteEndMs - right.absoluteEndMs ||
      normalizeCandidateEvidenceQuote(left.text).localeCompare(
        normalizeCandidateEvidenceQuote(right.text),
      )
    );
  });
}

function compareAudioEventDetections(
  left: CandidateAudioEventDetection,
  right: CandidateAudioEventDetection,
  reactionPeakMs: number,
): number {
  const strengthOrder =
    (left.strength === "strong" ? 0 : 1) -
    (right.strength === "strong" ? 0 : 1);
  if (strengthOrder !== 0) {
    return strengthOrder;
  }
  const leftDistance = Math.abs(
    (left.sourceStartMs + left.sourceEndMs) / 2 - reactionPeakMs,
  );
  const rightDistance = Math.abs(
    (right.sourceStartMs + right.sourceEndMs) / 2 - reactionPeakMs,
  );
  return (
    leftDistance - rightDistance ||
    left.sourceStartMs - right.sourceStartMs ||
    left.sourceEndMs - right.sourceEndMs ||
    AUDIO_EVENT_KIND_ORDER.indexOf(left.kind) -
      AUDIO_EVENT_KIND_ORDER.indexOf(right.kind)
  );
}

function audioEventDetections(
  evidence: CandidateAudioEventCandidateResult | undefined,
  reactionPeakMs: number,
): readonly CandidateAudioEventDetection[] {
  if (evidence?.status !== "detected") {
    return [];
  }
  return [...evidence.detections].sort((left, right) =>
    compareAudioEventDetections(left, right, reactionPeakMs),
  );
}

function audioEventBasisCodes(
  detections: readonly CandidateAudioEventDetection[],
): readonly CandidateEvidenceBasisCode[] {
  const codes: CandidateEvidenceBasisCode[] = [];
  if (detections.some(({ strength }) => strength === "strong")) {
    codes.push("audio-event-strong");
  }
  if (detections.some(({ strength }) => strength === "possible")) {
    codes.push("audio-event-possible");
  }
  codes.push("mixed-audio-source-unresolved");
  return codes;
}

function audioObservation(candidate: UnifiedHighlightCandidate): string | null {
  const audio = candidate.evidence.audio;
  if (audio === undefined) {
    return null;
  }
  const liftText =
    audio.rmsLiftRatio === undefined
      ? "상대적으로 두드러진"
      : `분석 기준의 ${audio.rmsLiftRatio.toFixed(1)}배 수준인`;
  if (audio.eventKind === "dialogue-issue-signal") {
    return `${liftText} 대사 대역의 변화가 커서 말의 내용이 바뀌는 지점일 가능성이 있어요. 실제 사건과 반응은 영상을 재생해 확인해 주세요.`;
  }
  if (audio.eventKind === "sustained-vocal-reaction") {
    const durationText =
      audio.sustainedWindowCount === undefined
        ? "잠시 이어진"
        : `${audio.sustainedWindowCount}개 분석 창에 이어진`;
    return `혼합 방송 오디오에서 ${liftText} 소리가 ${durationText} 반응 신호로 잡혔어요. 소리의 주체는 구분되지 않았어요.`;
  }
  if (audio.eventKind === "short-loudness-burst") {
    return `혼합 방송 오디오에서 ${liftText} 짧은 소리 변화가 반응 신호로 잡혔어요. 소리의 주체는 구분되지 않았어요.`;
  }
  return `혼합 방송 오디오에서 ${liftText} 반응 신호가 잡혔어요. 소리의 주체는 구분되지 않았어요.`;
}

function chatObservation(candidate: UnifiedHighlightCandidate): string | null {
  const chat = candidate.evidence.chat;
  if (chat === undefined) {
    return null;
  }
  const reactionText =
    chat.reactionMessageCount > 0
      ? ` 이 중 반응 표현 패턴이 있는 메시지는 ${chat.reactionMessageCount}개예요.`
      : "";
  return `채팅 5초 구간에 메시지 ${chat.messageCount}개와 고유 작성자 키 ${chat.uniqueAuthorCount}개가 집계됐고, 메시지 수는 분석 기준의 ${chat.burstRatio.toFixed(1)}배였어요.${reactionText}`;
}

function visualObservation(candidate: UnifiedHighlightCandidate): string | null {
  const visual = candidate.evidence.visual;
  if (visual === undefined) {
    return null;
  }
  const rank = topPercent(visual.rankPercentile);
  const strengthText =
    visual.sceneChangeStrength === undefined
      ? ""
      : ` 변화 강도는 ${visual.sceneChangeStrength.toFixed(2)}였고,`;
  return `후보 구간에서 화면 변화가 감지됐어요.${strengthText} 영상 안에서는 상위 ${rank}%의 변화 신호예요. 화면 변화가 반응의 원인인지는 알 수 없어요.`;
}

function audioEventObservation(
  evidence: CandidateAudioEventCandidateResult | undefined,
  detections: readonly CandidateAudioEventDetection[],
): CandidateEvidenceObservedStatement | null {
  if (evidence === undefined) {
    return null;
  }
  if (evidence.status === "no-clear-event") {
    return observedStatement(
      "audio-event",
      "혼합 방송 오디오에서 웃음·고함·비명·박수/환호 가운데 분명한 종류를 나누지 못했어요. 반응이 없거나 후보 가치가 낮다는 뜻은 아니에요.",
      ["audio-event-no-clear", "mixed-audio-source-unresolved"],
      true,
    );
  }
  const labels = detections.map(
    (detection) =>
      `${AUDIO_EVENT_KIND_LABELS[detection.kind]} · ${
        detection.strength === "strong" ? "뚜렷함" : "가능성 있음"
      }`,
  );
  return observedStatement(
    "audio-event",
    `혼합 방송 오디오에서 ${labels.join(", ")}처럼 분류된 확인 창을 찾았어요. 스트리머 마이크와 게임·영상 소리를 분리하지 않았어요.`,
    audioEventBasisCodes(detections),
    true,
  );
}

function transcriptObservation(
  evidence: CandidatePassBEvidence | undefined,
  cues: readonly CandidatePassBCue[],
): CandidateEvidenceObservedStatement | null {
  if (evidence === undefined) {
    return null;
  }
  if (evidence.status === "fast-pass-fallback") {
    const reason =
      evidence.fallbackReason === "silent"
        ? "말소리 단서를 얻지 못했어요."
        : evidence.fallbackReason === "low-quality-transcript"
          ? "Gemini 대사 품질이 낮아 대사 단서를 사건 설명에 사용하지 않았어요."
          : "Gemini에서 읽을 수 있는 한국어 대사 단서를 얻지 못했어요.";
    return observedStatement(
      "transcript",
      `${reason} 실제 사건과 반응은 후보를 재생해 확인해야 해요.`,
      ["transcript-no-clear", "semantic-event-unknown"],
      true,
    );
  }
  if (cues.length === 0) {
    return observedStatement(
      "transcript",
      "Gemini 결과에 표시할 수 있는 한국어 대사 위치가 없어 사건 설명에 사용하지 않았어요. 실제 사건과 반응은 후보를 재생해 확인해야 해요.",
      ["transcript-no-clear", "semantic-event-unknown"],
      true,
    );
  }
  const cueSummary = cues
    .map(
      (cue) =>
        `${TRANSCRIPT_PHASE_LABELS[cue.phase]} ${quotedTranscript(cue.text)}`,
    )
    .join(", ");
  const provisional = evidence.status === "provisional-transcript";
  return observedStatement(
    "transcript",
    provisional
      ? `Gemini 대사 추정에서 ${cueSummary}로 인식됐어요. 독립적인 품질 신호가 충분하지 않아 위치 확인에만 사용해요.`
      : `품질 신호를 통과한 Gemini 대사에서 ${cueSummary}로 인식됐어요. Gemini 대사는 틀릴 수 있으며 문장 내용은 사건 사실이 아니에요.`,
    [
      provisional ? "transcript-provisional-cue" : "transcript-qualified-cue",
      "semantic-event-unknown",
    ],
    true,
  );
}

function headline(
  candidate: UnifiedHighlightCandidate,
  detections: readonly CandidateAudioEventDetection[],
): string {
  const hasAudio = candidate.evidence.audio !== undefined;
  const hasChat = candidate.evidence.chat !== undefined;
  if (hasAudio && hasChat) {
    return "혼합 방송 오디오와 채팅 반응 신호가 함께 잡힌 후보";
  }
  if (hasAudio) {
    return "혼합 방송 오디오 반응 신호가 잡힌 후보";
  }
  if (hasChat) {
    return "채팅 반응 신호가 모인 후보";
  }
  if (detections.length > 0) {
    return "혼합 방송 오디오 반응 종류 단서가 있는 탐색 후보";
  }
  return "화면 변화로 남긴 탐색 후보";
}

function eventClue(
  candidate: UnifiedHighlightCandidate,
  evidence: CandidatePassBEvidence | undefined,
  focusCues: readonly CandidatePassBCue[],
): CandidateEvidenceStatement {
  const cue = focusCues[0];
  if (cue !== undefined && evidence !== undefined) {
    const provisional = evidence.status === "provisional-transcript";
    return statement(
      `${provisional ? "Gemini 대사 추정" : "품질 신호를 통과한 Gemini 대사"}에서 ${
        TRANSCRIPT_PHASE_LABELS[cue.phase]
      } ${quotedTranscript(cue.text)}로 인식됐어요. 이 문장만으로 실제 사건·행위자·결과를 확정하지 않아요.`,
      [
        provisional ? "transcript-provisional-cue" : "transcript-qualified-cue",
        "semantic-event-unknown",
        "outcome-unknown",
      ],
      true,
    );
  }
  if (candidate.evidence.visual !== undefined) {
    return statement(
      "후보 구간에 상대적으로 큰 화면 변화가 감지됐어요. 무엇이 일어났고 이 변화가 반응의 원인인지는 아직 알 수 없어요.",
      [
        "fast-visual-context",
        "semantic-event-unknown",
        "causality-unknown",
        "outcome-unknown",
      ],
      true,
    );
  }
  return statement(
    "반응 신호는 잡혔지만 실제 화면 사건의 종류·행위자·결과는 아직 확인되지 않았어요.",
    ["semantic-event-unknown", "outcome-unknown"],
    true,
  );
}

function reactionClue(
  candidate: UnifiedHighlightCandidate,
  audioEventEvidence: CandidateAudioEventCandidateResult | undefined,
  detections: readonly CandidateAudioEventDetection[],
): CandidateEvidenceStatement {
  if (detections.length > 0) {
    const labels = detections.map(
      (detection) =>
        `${AUDIO_EVENT_KIND_LABELS[detection.kind]} ${
          detection.strength === "strong" ? "단서가 뚜렷하게" : "가능성이"
        }`,
    );
    return statement(
      `혼합 방송 오디오에서 ${labels.join(", ")} 들리는 확인 창을 찾았어요. 소리의 주체는 확인되지 않았어요.`,
      audioEventBasisCodes(detections),
      true,
    );
  }
  if (audioEventEvidence?.status === "no-clear-event") {
    const existingReaction =
      audioObservation(candidate) ?? chatObservation(candidate);
    const existingBasis: readonly CandidateEvidenceBasisCode[] =
      candidate.evidence.audio !== undefined
        ? ["fast-audio-reaction", "mixed-audio-source-unresolved"]
        : candidate.evidence.chat !== undefined
          ? ["fast-chat-reaction"]
          : [];
    return statement(
      `${existingReaction === null ? "" : `${existingReaction} `}추가 분류에서는 혼합 방송 오디오의 웃음·고함·비명·박수/환호 중 분명한 종류를 나누지 못했어요. 후보가 나쁘다는 뜻은 아니에요.`,
      [
        ...existingBasis,
        "audio-event-no-clear",
        "mixed-audio-source-unresolved",
      ],
      true,
    );
  }
  const audioText = audioObservation(candidate);
  if (audioText !== null) {
    return statement(
      audioText,
      ["fast-audio-reaction", "mixed-audio-source-unresolved"],
      true,
    );
  }
  const chatText = chatObservation(candidate);
  if (chatText !== null) {
    return statement(chatText, ["fast-chat-reaction"], true);
  }
  return statement(
    "오디오·채팅 반응 근거가 없어 실제 반응은 아직 확인되지 않았어요.",
    ["fast-visual-context"],
    true,
  );
}

function whyWorthReviewing(
  candidate: UnifiedHighlightCandidate,
  detections: readonly CandidateAudioEventDetection[],
): CandidateEvidenceStatement {
  const hasAudio = candidate.evidence.audio !== undefined;
  const hasChat = candidate.evidence.chat !== undefined;
  const hasVisual = candidate.evidence.visual !== undefined;
  if (hasAudio && hasChat) {
    return statement(
      "혼합 방송 오디오 반응 신호와 채팅 증가가 같은 후보 구간에 함께 잡혀 두 신호의 실제 관계를 먼저 재생해 볼 가치가 있어요. 어느 한쪽이 원인이라는 뜻은 아니에요.",
      [
        "fast-audio-reaction",
        "fast-chat-reaction",
        "audio-chat-cooccurrence",
        ...(hasVisual ? (["fast-visual-context"] as const) : []),
        "causality-unknown",
      ],
      true,
    );
  }
  if (hasAudio) {
    return statement(
      `혼합 방송 오디오 반응 신호가 영상 안에서 상대적으로 두드러져 실제 소리 주체와 반응 맥락을 먼저 확인할 후보예요.${
        hasVisual ? " 가까운 화면 변화는 맥락 단서로만 사용했어요." : ""
      }`,
      [
        "fast-audio-reaction",
        ...(hasVisual ? (["fast-visual-context"] as const) : []),
        "mixed-audio-source-unresolved",
      ],
      true,
    );
  }
  if (hasChat) {
    return statement(
      `채팅 메시지가 분석 기준보다 많이 모여 실제 화면과 방송 반응을 먼저 확인할 후보예요.${
        hasVisual ? " 화면 변화는 원인이 아니라 확인할 위치를 보조하는 단서예요." : ""
      }`,
      [
        "fast-chat-reaction",
        ...(hasVisual ? (["fast-visual-context"] as const) : []),
        ...(hasVisual ? (["causality-unknown"] as const) : []),
      ],
      true,
    );
  }
  if (detections.length > 0) {
    return statement(
      "화면 변화로 남은 탐색 후보지만 혼합 방송 오디오의 반응 종류 단서도 있어 실제 반응인지 재생해 볼 이유가 있어요.",
      [...audioEventBasisCodes(detections), "fast-visual-context"],
      true,
    );
  }
  return statement(
    "오디오·채팅 반응 근거가 없어 화면 변화만으로 남긴 낮은 우선순위 탐색 후보예요.",
    ["fast-visual-context", "semantic-event-unknown"],
    true,
  );
}

function isFocusInsideRange(startMs: number, range: CandidateEvidenceRange): boolean {
  return startMs >= range.startMs && startMs < range.endMs;
}

function replayFocus(
  candidate: UnifiedHighlightCandidate,
  effectiveRange: CandidateEvidenceRange,
  detections: readonly CandidateAudioEventDetection[],
  cues: readonly CandidatePassBCue[],
): CandidateEvidencePrimaryReplayFocus {
  const detection = detections[0];
  if (detection !== undefined) {
    return Object.freeze({
      basis:
        detection.strength === "strong"
          ? "strong-audio-event"
          : "possible-audio-event",
      startMs: detection.sourceStartMs,
      endMs: detection.sourceEndMs,
      insideEffectiveRange: isFocusInsideRange(
        detection.sourceStartMs,
        effectiveRange,
      ),
      label: `혼합 방송 오디오의 ${AUDIO_EVENT_KIND_LABELS[detection.kind]} 단서가 실제 어떤 소리인지 확인`,
    });
  }
  const cue = cues[0];
  if (cue !== undefined) {
    const basis: CandidateEvidenceReplayBasis =
      cue.phase === "near-peak"
        ? "near-peak-transcript"
        : cue.phase === "before-peak"
          ? "before-peak-transcript"
          : "after-peak-transcript";
    return Object.freeze({
      basis,
      startMs: cue.absoluteStartMs,
      endMs: cue.absoluteEndMs,
      insideEffectiveRange: isFocusInsideRange(
        cue.absoluteStartMs,
        effectiveRange,
      ),
      label: `Gemini 대사 ${quotedTranscript(cue.text)}가 실제 발화인지 확인`,
    });
  }
  return Object.freeze({
    basis: "reaction-peak",
    startMs: candidate.peakMs,
    endMs: candidate.peakMs,
    insideEffectiveRange: isFocusInsideRange(candidate.peakMs, effectiveRange),
    label: "반응 정점에서 실제 화면 사건과 소리 주체를 확인",
  });
}

/**
 * Creates a deterministic, presentation-only explanation from bounded candidate
 * evidence. It reports observed signals and explicit unknowns; it never converts
 * transcript or mixed-audio classifications into an event, actor, cause, or outcome.
 */
export function buildCandidateEvidenceExplanation(
  input: CandidateEvidenceExplanationInput,
): CandidateEvidenceExplanation {
  assertEffectiveRange(input.candidate.id, input.effectiveRange);
  assertEvidenceBindings(input);

  const detections = audioEventDetections(
    input.audioEventEvidence,
    input.candidate.peakMs,
  );
  const chronologicalTranscriptCues = transcriptCues(input.passBEvidence);
  const prioritizedTranscriptCues = transcriptFocusCues(
    input.passBEvidence,
    input.candidate.peakMs,
  );
  const observed: CandidateEvidenceObservedStatement[] = [];

  const fastAudio = audioObservation(input.candidate);
  if (fastAudio !== null) {
    observed.push(
      observedStatement(
        "fast-audio",
        fastAudio,
        ["fast-audio-reaction", "mixed-audio-source-unresolved"],
        true,
      ),
    );
  }
  const chat = chatObservation(input.candidate);
  if (chat !== null) {
    observed.push(
      observedStatement("chat", chat, ["fast-chat-reaction"], false),
    );
  }
  const visual = visualObservation(input.candidate);
  if (visual !== null) {
    observed.push(
      observedStatement(
        "visual",
        visual,
        ["fast-visual-context", "causality-unknown"],
        true,
      ),
    );
  }
  const classifiedAudio = audioEventObservation(
    input.audioEventEvidence,
    detections,
  );
  if (classifiedAudio !== null) {
    observed.push(classifiedAudio);
  }
  const transcript = transcriptObservation(
    input.passBEvidence,
    chronologicalTranscriptCues,
  );
  if (transcript !== null) {
    observed.push(transcript);
  }

  return Object.freeze({
    version: CANDIDATE_EVIDENCE_EXPLANATION_VERSION,
    candidateId: input.candidate.id,
    headline: headline(input.candidate, detections),
    eventClue: eventClue(
      input.candidate,
      input.passBEvidence,
      prioritizedTranscriptCues,
    ),
    reactionClue: reactionClue(
      input.candidate,
      input.audioEventEvidence,
      detections,
    ),
    whyWorthReviewing: whyWorthReviewing(input.candidate, detections),
    unknowns: UNKNOWNS,
    observedStatements: Object.freeze(observed),
    primaryReplayFocus: replayFocus(
      input.candidate,
      input.effectiveRange,
      detections,
      prioritizedTranscriptCues,
    ),
  });
}

/**
 * Keeps one malformed optional overlay from taking down the whole review list.
 * Typed binding/range failures deliberately discard every precision overlay and
 * rebuild from the candidate's validated fast-pass evidence and original range.
 * Unexpected programming errors still surface instead of being hidden.
 */
export function buildCandidateEvidenceExplanationWithFallback(
  input: CandidateEvidenceExplanationInput,
): CandidateEvidenceExplanationProjection {
  try {
    return Object.freeze({
      explanation: buildCandidateEvidenceExplanation(input),
      fallbackReason: null,
      explanationRange: Object.freeze({ ...input.effectiveRange }),
    });
  } catch (error) {
    if (!(error instanceof CandidateEvidenceExplanationError)) {
      throw error;
    }

    const explanationRange = Object.freeze({
      startMs: input.candidate.startMs,
      endMs: input.candidate.endMs,
    });
    return Object.freeze({
      explanation: buildCandidateEvidenceExplanation({
        candidate: input.candidate,
        effectiveRange: explanationRange,
      }),
      fallbackReason: error.code,
      explanationRange,
    });
  }
}

/** Selects the actual safe seek target for the user's current edited range. */
export function resolveCandidateEvidenceReplayTarget(
  focus: CandidateEvidencePrimaryReplayFocus,
  effectiveRange: CandidateEvidenceRange,
  reactionPeakMs: number,
): CandidateEvidenceReplayTarget {
  if (
    !Number.isSafeInteger(effectiveRange.startMs) ||
    !Number.isSafeInteger(effectiveRange.endMs) ||
    effectiveRange.startMs < 0 ||
    effectiveRange.startMs >= effectiveRange.endMs
  ) {
    throw new RangeError("The effective replay range must be a valid millisecond range.");
  }

  if (
    focus.insideEffectiveRange &&
    focus.startMs >= effectiveRange.startMs &&
    focus.startMs < effectiveRange.endMs
  ) {
    return Object.freeze({
      basis: "primary-evidence-focus",
      startMs: focus.startMs,
      label: focus.label,
    });
  }

  if (
    Number.isSafeInteger(reactionPeakMs) &&
    reactionPeakMs >= effectiveRange.startMs &&
    reactionPeakMs < effectiveRange.endMs
  ) {
    return Object.freeze({
      basis: "effective-reaction-peak",
      startMs: reactionPeakMs,
      label: "현재 구간의 반응 정점 확인",
    });
  }

  return Object.freeze({
    basis: "effective-range-start",
    startMs: effectiveRange.startMs,
    label: "현재 구간 처음부터 확인",
  });
}
