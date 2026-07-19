import type {
  CandidateAudioEventCandidateResult,
  CandidateAudioEventDetection,
  CandidateAudioEventKind,
} from "./candidateAudioEventWorkerProtocol";

export interface CandidateAudioEventCuePresentation {
  readonly kind: CandidateAudioEventKind;
  readonly kindLabel: string;
  readonly strengthLabel: "뚜렷함" | "가능성 있음";
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
}

export interface CandidateAudioEventPresentation {
  readonly statusLabel: string;
  readonly summary: string | null;
  readonly caution: string | null;
  readonly cues: readonly CandidateAudioEventCuePresentation[];
}

const KIND_LABELS: Readonly<Record<CandidateAudioEventKind, string>> = {
  laughter: "웃음",
  shout: "고함·외침",
  scream: "비명",
  "applause-or-cheering": "박수·환호",
};

function detectionLabel(detection: CandidateAudioEventDetection): string {
  return `${KIND_LABELS[detection.kind]}${detection.strength === "strong" ? "이 뚜렷하게" : "처럼"}`;
}

export function candidateAudioEventKindLabel(
  kind: CandidateAudioEventKind,
): string {
  return KIND_LABELS[kind];
}

export function buildCandidateAudioEventPresentation(
  candidateId: string,
  result: CandidateAudioEventCandidateResult | undefined,
): CandidateAudioEventPresentation {
  if (result === undefined) {
    return {
      statusLabel: "반응 종류 미확인",
      summary: null,
      caution: null,
      cues: [],
    };
  }
  if (result.candidateId !== candidateId) {
    throw new Error("Audio-event evidence belongs to another candidate.");
  }
  if (result.status === "no-clear-event") {
    return {
      statusLabel: "반응 종류 불분명",
      summary:
        "후보 오디오에서 웃음·고함·비명·박수/환호 가운데 분명한 종류를 나누기 어려웠어요.",
      caution:
        "후보가 나쁘다는 뜻은 아니에요. 빠른 분석이 남긴 기존 근거는 그대로 확인해 주세요.",
      cues: [],
    };
  }

  const labels = result.detections.map(detectionLabel);
  const joined =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} ${labels.at(-1)}`;
  return {
    statusLabel: `반응 종류 단서 ${result.detections.length}개`,
    summary: `후보의 혼합 오디오에서 ${joined} 들리는 구간을 찾았어요.`,
    caution:
      "스트리머 마이크와 게임·영상 소리를 분리한 결과는 아니므로, 표시 범위는 AI가 들은 약 10초 확인 창이지 사건의 정확한 시작·끝이 아니에요. 아래 위치를 재생해 실제 반응인지 확인해 주세요.",
    cues: result.detections.map((detection) => ({
      kind: detection.kind,
      kindLabel: KIND_LABELS[detection.kind],
      strengthLabel:
        detection.strength === "strong" ? "뚜렷함" : "가능성 있음",
      sourceStartMs: detection.sourceStartMs,
      sourceEndMs: detection.sourceEndMs,
    })),
  };
}
