import { describe, expect, it } from "vitest";

import {
  buildCandidateAudioEventPresentation,
  candidateAudioEventKindLabel,
} from "./candidateAudioEventPresentation";
import {
  CANDIDATE_AUDIO_EVENT_MODEL_DTYPE,
  CANDIDATE_AUDIO_EVENT_MODEL_ID,
  CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
  CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE,
  CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ,
  type CandidateAudioEventCandidateResult,
} from "./candidateAudioEventWorkerProtocol";

const base = {
  mode: "candidate-audio-event" as const,
  candidateId: "candidate-1",
  sourceStartMs: 10_000,
  sourceEndMs: 55_000,
  reactionPeakMs: 38_000,
  analyzedWindowCount: 3,
  quality: "provisional-audio-event" as const,
  model: {
    id: CANDIDATE_AUDIO_EVENT_MODEL_ID,
    revision: CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
    dtype: CANDIDATE_AUDIO_EVENT_MODEL_DTYPE,
    device: CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE,
  },
  sampleRateHz: CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ,
};

describe("buildCandidateAudioEventPresentation", () => {
  it("keeps an untouched candidate neutral before optional classification", () => {
    expect(buildCandidateAudioEventPresentation("candidate-1", undefined)).toEqual({
      statusLabel: "반응 종류 미확인",
      summary: null,
      caution: null,
      cues: [],
    });
  });

  it("describes allowlisted detections without claiming a streamer source", () => {
    const result: CandidateAudioEventCandidateResult = {
      ...base,
      status: "detected",
      detections: [
        {
          kind: "laughter",
          strength: "strong",
          sourceStartMs: 30_000,
          sourceEndMs: 40_000,
        },
        {
          kind: "applause-or-cheering",
          strength: "possible",
          sourceStartMs: 40_000,
          sourceEndMs: 50_000,
        },
      ],
    };

    const presentation = buildCandidateAudioEventPresentation(
      "candidate-1",
      result,
    );
    expect(presentation.statusLabel).toBe("반응 종류 단서 2개");
    expect(presentation.summary).toContain("혼합 오디오");
    expect(presentation.summary).toContain("웃음");
    expect(presentation.summary).toContain("박수·환호");
    expect(presentation.summary).not.toContain("스트리머가");
    expect(presentation.caution).toContain("분리한 결과는 아니므로");
    expect(presentation.caution).toContain("사건의 정확한 시작·끝이 아니에요");
    expect(presentation.cues).toHaveLength(2);
  });

  it("treats a no-clear result as an honest non-destructive sentinel", () => {
    const result: CandidateAudioEventCandidateResult = {
      ...base,
      status: "no-clear-event",
      reasonCode: "LOW_EVENT_CONFIDENCE",
      detections: [],
    };
    const presentation = buildCandidateAudioEventPresentation(
      "candidate-1",
      result,
    );
    expect(presentation.statusLabel).toBe("반응 종류 불분명");
    expect(presentation.summary).toContain("나누기 어려웠어요");
    expect(presentation.caution).toContain("후보가 나쁘다는 뜻은 아니에요");
    expect(presentation.cues).toEqual([]);
  });

  it("rejects evidence for another candidate", () => {
    const result: CandidateAudioEventCandidateResult = {
      ...base,
      status: "no-clear-event",
      reasonCode: "NO_ALLOWLIST_EVENT",
      detections: [],
    };
    expect(() =>
      buildCandidateAudioEventPresentation("candidate-2", result),
    ).toThrow("another candidate");
  });

  it("maps only the product allowlist to Korean labels", () => {
    expect(candidateAudioEventKindLabel("laughter")).toBe("웃음");
    expect(candidateAudioEventKindLabel("shout")).toBe("고함·외침");
    expect(candidateAudioEventKindLabel("scream")).toBe("비명");
    expect(candidateAudioEventKindLabel("applause-or-cheering")).toBe(
      "박수·환호",
    );
  });
});
