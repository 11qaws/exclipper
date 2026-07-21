import { describe, expect, it } from "vitest";

import type { ChatHighlightCandidate, ChatHighlightEvidence } from "./highlightSelector";
import {
  fuseHighlightCandidates,
  fuseReactionHighlightCandidates,
  type AudioHighlightCandidate,
  type AudioHighlightCandidateEvidence,
  type VisualHighlightCandidate,
} from "./highlightFusion";

interface TestVisualEvidence {
  readonly changeScore: number;
  readonly robustScore: number;
  readonly sampledFrameCount: number;
}

function visualCandidate(
  id: string,
  peakMs: number,
  score: number,
  startMs = Math.max(0, peakMs - 2500),
  endMs = peakMs + 2500,
): VisualHighlightCandidate<TestVisualEvidence> {
  return {
    id,
    peakMs,
    startMs,
    endMs,
    score,
    reason: `원본 visual reason ${id}`,
    evidence: {
      changeScore: score * 2,
      robustScore: score / 2,
      sampledFrameCount: 30,
    },
  };
}

function chatEvidence(bucketStartMs: number): ChatHighlightEvidence {
  return {
    bucketStartMs,
    bucketEndMs: bucketStartMs + 5000,
    messageCount: 20,
    uniqueAuthorCount: 15,
    reactionMessageCount: 12,
    baselineMessageCount: 3,
    baselineUniqueAuthorCount: 2,
    burstRatio: 5,
    robustBurstScore: 4,
    repetitionRatio: 0.1,
    singleAuthorRatio: 0.15,
    spamPenalty: 0.2,
  };
}

function chatCandidate(
  id: string,
  peakMs: number,
  score: number,
  startMs = Math.max(0, peakMs - 2500),
  endMs = peakMs + 2500,
): ChatHighlightCandidate {
  return {
    id,
    peakMs,
    startMs,
    endMs,
    score,
    reason: `원본 chat reason ${id}`,
    evidence: chatEvidence(startMs),
  };
}

function audioCandidate(
  id: string,
  peakMs: number,
  score: number,
  startMs = Math.max(0, peakMs - 2000),
  endMs = peakMs + 4000,
  evidence: AudioHighlightCandidateEvidence = {
    eventKind: "sustained-vocal-reaction",
    baselineRms: 0.08,
    medianAbsoluteDeviation: 0.02,
    robustLoudnessScore: 4.5,
    rmsLiftRatio: 3.2,
    peakLiftRatio: 2.8,
    sustainedWindowCount: 3,
    activeWindowCount: 4,
    clickPenalty: 0.1,
    backgroundPenalty: 0.2,
    zeroCrossingRate: 0.12,
    speechBandEnergyRatio: 0.74,
  },
): AudioHighlightCandidate<AudioHighlightCandidateEvidence> {
  return {
    id,
    peakMs,
    startMs,
    endMs,
    score,
    reason: `원본 audio reason ${id}`,
    evidence,
  };
}

describe("fuseHighlightCandidates", () => {
  it("returns no candidates when both signal lists are empty", () => {
    expect(fuseHighlightCandidates([], { sourceDurationMs: 120_000 })).toEqual([]);
    expect(fuseHighlightCandidates([], [], { sourceDurationMs: 120_000 })).toEqual([]);
    expect(fuseHighlightCandidates([], undefined, { sourceDurationMs: 120_000 })).toEqual([]);
  });

  it("works with visual candidates alone and preserves a 45-second window at both boundaries", () => {
    const candidates = fuseHighlightCandidates(
      [
        visualCandidate("opening", 1000, 10, 0, 3500),
        visualCandidate("ending", 119_000, 5, 116_500, 120_000),
      ],
      { sourceDurationMs: 120_000 },
    );

    expect(candidates).toHaveLength(2);
    expect(candidates.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [0, 45_000],
      [75_000, 120_000],
    ]);
    expect(candidates.every((candidate) => candidate.signalKinds.join() === "visual")).toBe(true);
    expect(candidates.every((candidate) => candidate.reason.includes("화면 변화"))).toBe(true);
    expect(candidates.every((candidate) => candidate.evidence.visual !== undefined)).toBe(true);
    expect(candidates.every((candidate) => candidate.evidence.chat === undefined)).toBe(true);
  });

  it("accepts optional chat-only input", () => {
    const candidates = fuseHighlightCandidates(
      [],
      [chatCandidate("chat-only", 50_000, 900, 47_500, 52_500)],
      { sourceDurationMs: 100_000 },
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      startMs: 27_500,
      endMs: 72_500,
      signalKinds: ["chat"],
    });
    expect(candidates[0]?.reason).toContain("채팅 반응");
    expect(candidates[0]?.evidence.visual).toBeUndefined();
    expect(candidates[0]?.evidence.chat?.messageCount).toBe(20);
  });

  it("combines overlapping or nearby visual and chat signals", () => {
    const overlapping = fuseHighlightCandidates(
      [visualCandidate("visual-overlap", 60_000, 40, 57_000, 63_000)],
      [chatCandidate("chat-overlap", 62_000, 4, 60_000, 65_000)],
      { sourceDurationMs: 120_000 },
    );
    const nearby = fuseHighlightCandidates(
      [visualCandidate("visual-near", 20_000, 40, 18_000, 22_000)],
      [chatCandidate("chat-near", 28_000, 4, 26_000, 30_000)],
      { sourceDurationMs: 120_000 },
    );

    for (const candidates of [overlapping, nearby]) {
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.signalKinds).toEqual(["visual", "chat"]);
      expect(candidates[0]?.reason).toContain("함께");
      expect(candidates[0]?.evidence.visual).toBeDefined();
      expect(candidates[0]?.evidence.chat).toBeDefined();
    }
  });

  it("normalizes each modality independently instead of comparing incompatible raw scales", () => {
    const chat = [
      chatCandidate("chat-low", 30_000, 1, 28_000, 32_000),
      chatCandidate("chat-high", 150_000, 2, 148_000, 152_000),
    ];
    const smallVisualScale = [
      visualCandidate("visual-high", 30_000, 2, 28_000, 32_000),
      visualCandidate("visual-low", 150_000, 1, 148_000, 152_000),
    ];
    const hugeVisualScale = [
      visualCandidate("visual-high", 30_000, 2_000_000_000, 28_000, 32_000),
      visualCandidate("visual-low", 150_000, 1_000_000_000, 148_000, 152_000),
    ];

    const smallScaleResult = fuseHighlightCandidates(smallVisualScale, chat, {
      sourceDurationMs: 200_000,
    });
    const hugeScaleResult = fuseHighlightCandidates(hugeVisualScale, chat, {
      sourceDurationMs: 200_000,
    });

    const comparableResult = (candidates: typeof smallScaleResult) =>
      candidates.map((candidate) => ({
        id: candidate.id,
        peakMs: candidate.peakMs,
        score: candidate.score,
        signalKinds: candidate.signalKinds,
        visualNormalization: {
          rankPercentile: candidate.evidence.visual?.rankPercentile,
          robustPercentile: candidate.evidence.visual?.robustPercentile,
          normalizedScore: candidate.evidence.visual?.normalizedScore,
        },
        chatNormalization: {
          rankPercentile: candidate.evidence.chat?.rankPercentile,
          robustPercentile: candidate.evidence.chat?.robustPercentile,
          normalizedScore: candidate.evidence.chat?.normalizedScore,
        },
      }));

    expect(comparableResult(hugeScaleResult)).toEqual(comparableResult(smallScaleResult));
    expect(smallScaleResult).toHaveLength(2);
    expect(smallScaleResult.every((candidate) => candidate.signalKinds.length === 2)).toBe(true);
    expect(smallScaleResult[0]?.score).toBe(smallScaleResult[1]?.score);
  });

  it("keeps raw chat, user identifiers, source reasons, and raw scores out of evidence", () => {
    const base = chatCandidate("private-user-candidate", 50_000, 500, 48_000, 53_000);
    const privateChat = {
      ...base,
      reason: "SECRET_RAW_CHAT_PHRASE",
      evidence: {
        ...base.evidence,
        rawText: "SECRET_RAW_CHAT_PHRASE",
        authorId: "SECRET_USER_IDENTIFIER",
      },
    };

    const candidates = fuseHighlightCandidates(
      [visualCandidate("visual-private-pair", 50_500, 5, 49_000, 52_000)],
      [privateChat],
      { sourceDurationMs: 100_000 },
    );
    const serialized = JSON.stringify(candidates);

    expect(serialized).not.toContain("SECRET_RAW_CHAT_PHRASE");
    expect(serialized).not.toContain("SECRET_USER_IDENTIFIER");
    expect(serialized).not.toContain("private-user-candidate");
    expect(serialized).not.toContain("rawScore");
    expect(candidates[0]?.evidence.normalization).toBe("within-signal-rank-and-mad");
    expect(candidates[0]?.evidence.chat?.uniqueAuthorCount).toBe(15);
  });

  it("clamps requested clips to 30-60 seconds and uses the whole source when it is shorter", () => {
    const tooShortRequest = fuseHighlightCandidates(
      [visualCandidate("minimum", 50_000, 1)],
      { sourceDurationMs: 100_000, candidateWindowMs: 5000 },
    );
    const tooLongRequest = fuseHighlightCandidates(
      [visualCandidate("maximum", 50_000, 1)],
      { sourceDurationMs: 100_000, candidateWindowMs: 90_000 },
    );
    const shortSource = fuseHighlightCandidates(
      [visualCandidate("whole-source", 24_000, 1, 22_000, 25_000)],
      { sourceDurationMs: 25_000 },
    );

    expect((tooShortRequest[0]?.endMs ?? 0) - (tooShortRequest[0]?.startMs ?? 0)).toBe(30_000);
    expect((tooLongRequest[0]?.endMs ?? 0) - (tooLongRequest[0]?.startMs ?? 0)).toBe(60_000);
    expect(shortSource[0]).toMatchObject({ startMs: 0, endMs: 25_000 });
  });

  it("applies non-maximum suppression and never returns more than 12 candidates", () => {
    const overlapping = fuseHighlightCandidates(
      [
        visualCandidate("overlap-a", 100_000, 3),
        visualCandidate("overlap-b", 105_000, 2),
        visualCandidate("overlap-c", 110_000, 1),
      ],
      { sourceDurationMs: 300_000 },
    );
    const many = Array.from({ length: 15 }, (_, index) => {
      const peakMs = 25_000 + index * 70_000;
      return visualCandidate(`many-${index}`, peakMs, 100 - index);
    });
    const limited = fuseHighlightCandidates(many, {
      sourceDurationMs: 1_100_000,
      maxCandidates: 99,
    });

    expect(overlapping).toHaveLength(1);
    expect(limited.length).toBeLessThanOrEqual(96);
    expect(limited[0]?.score).toBeGreaterThanOrEqual(limited[limited.length-1]?.score ?? 0);
  });

  it("produces stable IDs and order regardless of input order", () => {
    const visual = [
      visualCandidate("visual-a", 60_000, 10, 57_000, 63_000),
      visualCandidate("visual-b", 180_000, 5, 177_000, 183_000),
    ];
    const chat = [
      chatCandidate("chat-a", 62_000, 8, 59_000, 65_000),
      chatCandidate("chat-b", 182_000, 4, 179_000, 185_000),
    ];

    const first = fuseHighlightCandidates(visual, chat, { sourceDurationMs: 240_000 });
    const reversed = fuseHighlightCandidates([...visual].reverse(), [...chat].reverse(), {
      sourceDurationMs: 240_000,
    });

    expect(reversed).toEqual(first);
    expect(new Set(first.map((candidate) => candidate.id)).size).toBe(first.length);
    expect(first.every((candidate) => /^highlight-(?:visual|chat)(?:-chat)?-[0-9a-f]{8}$/u.test(candidate.id))).toBe(
      true,
    );
  });

  it("ignores malformed candidates and invalid source durations", () => {
    const invalid = visualCandidate("invalid", Number.NaN, Number.POSITIVE_INFINITY, 0, 5000);
    const valid = visualCandidate("valid", 20_000, 1, 18_000, 22_000);

    expect(
      fuseHighlightCandidates([invalid, valid], { sourceDurationMs: 60_000 }).map(
        (candidate) => candidate.signalKinds,
      ),
    ).toEqual([["visual"]]);
    expect(fuseHighlightCandidates([valid], { sourceDurationMs: Number.NaN })).toEqual([]);
    expect(fuseHighlightCandidates([valid], { sourceDurationMs: -1 })).toEqual([]);
  });
});

describe("fuseReactionHighlightCandidates", () => {
  it("uses audio and chat as anchors and never lets unrelated flashy visuals outrank them", () => {
    const reaction = fuseReactionHighlightCandidates(
      {
        audioCandidates: [audioCandidate("voice-reaction", 60_000, 1)],
        visualCandidates: [
          visualCandidate("flashy-but-unrelated", 200_000, 1_000_000, 198_000, 202_000),
        ],
      },
      { sourceDurationMs: 260_000 },
    );

    expect(reaction).toHaveLength(1);
    expect(reaction[0]?.signalKinds).toEqual(["audio"]);
    expect(reaction[0]?.peakMs).toBe(60_000);
    expect(JSON.stringify(reaction)).not.toContain("flashy-but-unrelated");

    const exploration = fuseReactionHighlightCandidates(
      {
        visualCandidates: [
          visualCandidate("visual-a", 30_000, 100),
          visualCandidate("visual-b", 120_000, 90),
          visualCandidate("visual-c", 210_000, 80),
        ],
      },
      { sourceDurationMs: 260_000, maxCandidates: 12 },
    );

    expect(exploration.length).toBeLessThanOrEqual(6);
    expect(exploration.every(({ signalKinds }) => signalKinds.join() === "visual")).toBe(true);
    expect(exploration.every(({ score }) => score <= 0.32)).toBe(true);
    expect(exploration.every(({ reason }) => reason.includes("탐색 후보"))).toBe(true);
    expect(exploration.every(({ reason }) => reason.includes("반응을 확인한 결과가 아니라"))).toBe(
      true,
    );

    expect(
      fuseReactionHighlightCandidates(
        { visualCandidates: [visualCandidate("opening", 30_000, 100)] },
        { sourceDurationMs: 260_000, allowUnanchoredVisualExploration: false },
      ),
    ).toEqual([]);
  });

  it("combines audio, delayed chat, and nearby visual context in canonical order", () => {
    const candidates = fuseReactionHighlightCandidates(
      {
        audioCandidates: [audioCandidate("audio-anchor", 100_000, 8, 98_000, 104_000)],
        chatCandidates: [chatCandidate("chat-confirmation", 105_000, 6, 102_500, 107_500)],
        visualCandidates: [visualCandidate("visual-context", 99_000, 500, 96_500, 101_500)],
      },
      { sourceDurationMs: 180_000 },
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      peakMs: 100_000,
      startMs: 71_875,
      endMs: 116_875,
      signalKinds: ["audio", "chat", "visual"],
    });
    expect(candidates[0]?.reason).toContain(
      "혼합 방송 오디오 반응 신호와 채팅 반응 신호",
    );
    expect(candidates[0]?.reason).not.toContain("스트리머의 음성 반응");
    expect(candidates[0]?.evidence.audio).toMatchObject({
      eventKind: "sustained-vocal-reaction",
      rmsLiftRatio: 3.2,
      speechBandEnergyRatio: 0.74,
    });
    expect(candidates[0]?.evidence.chat?.messageCount).toBe(20);
    expect(candidates[0]?.evidence.visual).toBeDefined();
  });

  it("keeps a strong unrelated chat burst as its own candidate when audio exists", () => {
    const candidates = fuseReactionHighlightCandidates(
      {
        audioCandidates: [audioCandidate("audio-anchor", 60_000, 8)],
        chatCandidates: [
          chatCandidate("chat-confirmation", 61_000, 6),
          chatCandidate("chat-only", 200_000, 7),
        ],
      },
      { sourceDurationMs: 260_000 },
    );

    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.signalKinds).toEqual(["audio", "chat"]);
    expect(candidates[0]?.evidence.chat?.messageCount).toBe(20);
    expect(candidates[1]?.signalKinds).toEqual(["chat"]);
    expect(candidates[1]?.peakMs).toBe(200_000);
  });

  it("drops an unconfirmed music-like dialogue lead but keeps corroborated dialogue", () => {
    const musicLikeDialogue = audioCandidate(
      "opening-bed",
      75_000,
      8,
      52_500,
      97_500,
      {
        eventKind: "dialogue-issue-signal",
        activeWindowCount: 4,
        sustainedWindowCount: 4,
        speechBandEnergyRatio: 0.63,
        rmsLiftRatio: 0.9,
        robustLoudnessScore: -2.2,
        clickPenalty: 0.13,
        backgroundPenalty: 0,
      },
    );
    const visualConfirmation = visualCandidate("dialogue-screen", 75_000, 3, 72_000, 78_000);

    expect(
      fuseReactionHighlightCandidates(
        { audioCandidates: [musicLikeDialogue] },
        { sourceDurationMs: 180_000 },
      ),
    ).toEqual([]);
    expect(
      fuseReactionHighlightCandidates(
        { audioCandidates: [musicLikeDialogue], visualCandidates: [visualConfirmation] },
        { sourceDurationMs: 180_000 },
      ),
    ).toHaveLength(1);
  });

  it("copies only allowlisted audio evidence and leaves click rejection to the audio core", () => {
    const base = audioCandidate(
      "core-approved-short-burst",
      50_000,
      4,
      49_000,
      52_000,
      {
        eventKind: "short-loudness-burst",
        clickPenalty: 99,
        backgroundPenalty: 0.4,
        robustLoudnessScore: 5,
      },
    );
    const coreApprovedCandidate = {
      ...base,
      reason: "SECRET_SOURCE_AUDIO_REASON",
      evidence: {
        ...base.evidence,
        rawPcm: "SECRET_PCM_BYTES",
        sourceRawScore: 999,
      },
    };

    const candidates = fuseReactionHighlightCandidates(
      { audioCandidates: [coreApprovedCandidate] },
      { sourceDurationMs: 100_000 },
    );
    const serialized = JSON.stringify(candidates);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.evidence.audio?.clickPenalty).toBe(99);
    expect(serialized).not.toContain("SECRET_SOURCE_AUDIO_REASON");
    expect(serialized).not.toContain("SECRET_PCM_BYTES");
    expect(serialized).not.toContain("sourceRawScore");
    expect(serialized).not.toContain("rawScore");
  });

  it("keeps reaction NMS, deterministic ordering, and 30-60 second window clamps", () => {
    const audio = [
      audioCandidate("overlap-a", 60_000, 10),
      audioCandidate("overlap-b", 64_000, 9),
      audioCandidate("separate", 170_000, 8),
    ];
    const first = fuseReactionHighlightCandidates(
      { audioCandidates: audio },
      { sourceDurationMs: 240_000 },
    );
    const reversed = fuseReactionHighlightCandidates(
      { audioCandidates: [...audio].reverse() },
      { sourceDurationMs: 240_000 },
    );
    const minimum = fuseReactionHighlightCandidates(
      { audioCandidates: [audioCandidate("minimum", 80_000, 1)] },
      { sourceDurationMs: 180_000, candidateWindowMs: 5000 },
    );
    const maximum = fuseReactionHighlightCandidates(
      { audioCandidates: [audioCandidate("maximum", 80_000, 1)] },
      { sourceDurationMs: 180_000, candidateWindowMs: 90_000 },
    );

    expect(first).toHaveLength(2);
    expect(reversed).toEqual(first);
    expect((minimum[0]?.endMs ?? 0) - (minimum[0]?.startMs ?? 0)).toBe(30_000);
    expect((maximum[0]?.endMs ?? 0) - (maximum[0]?.startMs ?? 0)).toBe(60_000);
    expect(
      first.every(({ id }) => /^highlight-audio-[0-9a-f]{8}$/u.test(id)),
    ).toBe(true);
  });

  it("returns several distinct clip candidates from one four-hour daily recording", () => {
    const reactionTimes = [
      12 * 60_000,
      37 * 60_000,
      61 * 60_000,
      89 * 60_000,
      124 * 60_000,
      158 * 60_000,
      197 * 60_000,
      226 * 60_000,
    ];
    const result = fuseReactionHighlightCandidates(
      {
        audioCandidates: reactionTimes.map((peakMs, index) =>
          audioCandidate(`daily-reaction-${index + 1}`, peakMs, 100 - index),
        ),
      },
      { sourceDurationMs: 4 * 60 * 60 * 1_000, maxCandidates: 12 },
    );

    expect(result).toHaveLength(8);
    expect(new Set(result.map(({ id }) => id)).size).toBe(8);
    expect(
      result.every(({ startMs, endMs }) => endMs - startMs === 45_000),
    ).toBe(true);
  });
});
