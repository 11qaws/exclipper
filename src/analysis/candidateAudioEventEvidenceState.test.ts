import { describe, expect, it } from "vitest";

import { mergeCandidateAudioEventEvidence } from "./candidateAudioEventEvidenceState";
import {
  CANDIDATE_AUDIO_EVENT_MODEL_DTYPE,
  CANDIDATE_AUDIO_EVENT_MODEL_ID,
  CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
  CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE,
  CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ,
  type CandidateAudioEventCandidateResult,
  type CandidateAudioEventDetection,
} from "./candidateAudioEventWorkerProtocol";

const base = {
  mode: "candidate-audio-event" as const,
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

function result(
  candidateId: string,
  status: "none" | "possible" | "strong",
): CandidateAudioEventCandidateResult {
  if (status === "none") {
    return {
      ...base,
      candidateId,
      status: "no-clear-event",
      reasonCode: "LOW_EVENT_CONFIDENCE",
      detections: [],
    };
  }
  return {
    ...base,
    candidateId,
    status: "detected",
    detections: [
      {
        kind: "laughter",
        strength: status,
        sourceStartMs: 30_000,
        sourceEndMs: 40_000,
      },
    ],
  };
}

function detectedResult(
  candidateId: string,
  detections: readonly [
    CandidateAudioEventDetection,
    ...CandidateAudioEventDetection[],
  ],
): CandidateAudioEventCandidateResult {
  return {
    ...base,
    candidateId,
    status: "detected",
    detections,
  };
}

describe("mergeCandidateAudioEventEvidence", () => {
  it("keeps evidence for different candidates independent", () => {
    const first = mergeCandidateAudioEventEvidence({}, result("a", "possible"));
    const second = mergeCandidateAudioEventEvidence(first, result("b", "strong"));
    expect(Object.keys(second)).toEqual(["a", "b"]);
  });

  it("does not erase a detected reaction with a no-clear retry", () => {
    const detected = result("a", "strong");
    const current = { a: detected };
    expect(
      mergeCandidateAudioEventEvidence(current, result("a", "none")),
    ).toBe(current);
  });

  it("allows a stronger retry to replace a weaker result", () => {
    const current = { a: result("a", "possible") };
    const stronger = result("a", "strong");
    expect(mergeCandidateAudioEventEvidence(current, stronger).a).toBe(
      stronger,
    );
  });

  it("keeps an equal-quality result stable", () => {
    const current = { a: result("a", "strong") };
    expect(
      mergeCandidateAudioEventEvidence(current, result("a", "strong")),
    ).toBe(current);
  });

  it("never drops an existing strong kind when a retry finds different kinds", () => {
    const existing = detectedResult("a", [
      {
        kind: "laughter",
        strength: "strong",
        sourceStartMs: 30_000,
        sourceEndMs: 40_000,
      },
    ]);
    const incoming = detectedResult("a", [
      {
        kind: "scream",
        strength: "strong",
        sourceStartMs: 20_000,
        sourceEndMs: 30_000,
      },
      {
        kind: "applause-or-cheering",
        strength: "possible",
        sourceStartMs: 40_000,
        sourceEndMs: 50_000,
      },
    ]);

    const merged = mergeCandidateAudioEventEvidence({ a: existing }, incoming).a;
    expect(merged?.status).toBe("detected");
    if (merged?.status !== "detected") {
      throw new Error("expected detected evidence");
    }
    expect(merged.detections.map(({ kind }) => kind)).toEqual([
      "scream",
      "laughter",
    ]);
    expect(merged.detections).not.toContainEqual(
      expect.objectContaining({ kind: "applause-or-cheering" }),
    );
  });

  it("admits a new strong kind before possible evidence while keeping capacity two", () => {
    const existing = result("a", "possible");
    const incoming = detectedResult("a", [
      {
        kind: "scream",
        strength: "strong",
        sourceStartMs: 20_000,
        sourceEndMs: 30_000,
      },
    ]);

    const merged = mergeCandidateAudioEventEvidence({ a: existing }, incoming).a;
    expect(merged?.status).toBe("detected");
    if (merged?.status !== "detected") {
      throw new Error("expected detected evidence");
    }
    expect(merged.detections.map(({ kind, strength }) => [kind, strength])).toEqual([
      ["scream", "strong"],
      ["laughter", "possible"],
    ]);
  });

  it("rejects retry evidence from a different immutable candidate range", () => {
    const current = { a: result("a", "strong") };
    expect(() =>
      mergeCandidateAudioEventEvidence(current, {
        ...result("a", "strong"),
        sourceStartMs: 10_001,
      }),
    ).toThrow("different source binding");
  });
});
