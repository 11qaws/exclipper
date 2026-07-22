import { describe, expect, it } from "vitest";
import {
  buildBroadcastContextEligibilityById,
  calculateCoverage,
  createBroadcastContextRequest,
} from "./broadcastContextProtocol";
import type { BroadcastContextInputError } from "./broadcastContextProtocol";
import { DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID } from "./participantRoster";

function validInput() {
  return {
    sourceDurationMs: 60 * 60_000,
    chapters: [
      {
        chapterId: "chapter-1",
        startMs: 0,
        endMs: 30 * 60_000,
        evidenceMode: "complete-transcript",
        evidenceCoverageRatio: 1,
        summaryKo: "방송 전반부에서 음식 취향을 이야기한다.",
      },
      {
        chapterId: "chapter-2",
        startMs: 30 * 60_000,
        endMs: 60 * 60_000,
        evidenceMode: "sampled-audio-video",
        evidenceCoverageRatio: 0.4,
        summaryKo: "후반부에서 실제 음식과 관련된 경험담이 이어진다.",
      },
    ],
    candidates: [
      {
        candidateId: "candidate-1",
        startMs: 10 * 60_000,
        endMs: 10 * 60_000 + 45_000,
        transcriptKo: "칼국수를 먹었던 이야기를 꺼낸다.",
        eventSummaryKo: "칼국수 경험담이 시작된다.",
        reactionSummaryKo: "스트리머가 기억을 떠올리며 웃는다.",
        chatReactionSummaryKo: null,
      },
    ],
  } as const;
}

describe("broadcastContextProtocol", () => {
  it("snapshots bounded chapter and candidate evidence without decision fields", () => {
    const input = validInput();
    const request = createBroadcastContextRequest(input);

    expect(request.schemaVersion).toBe("1.5.0");
    expect(request.castRosterId).toBeNull();
    expect(request.chapters).not.toBe(input.chapters);
    expect(request.candidates).not.toBe(input.candidates);
    expect(Object.keys(request.candidates[0] ?? {})).toEqual([
      "candidateId",
      "startMs",
      "endMs",
      "transcriptKo",
      "eventSummaryKo",
      "reactionSummaryKo",
      "chatReactionSummaryKo",
    ]);
    expect(JSON.stringify(request)).not.toMatch(
      /score|rank|approval|reviewState|boundary/iu,
    );
  });

  it("accepts only the fixed server-known cast roster", () => {
    const input = validInput();
    expect(
      createBroadcastContextRequest({
        ...input,
        castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      }).castRosterId,
    ).toBe(DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID);
    expect(() =>
      createBroadcastContextRequest({
        ...input,
        castRosterId: "user-authored-roster" as never,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<BroadcastContextInputError>>({
        code: "INVALID_CAST_ROSTER",
      }),
    );
  });

  it("accepts zero sound-led candidates so transcript context can abstain or find quiet leads", () => {
    const input = validInput();
    const request = createBroadcastContextRequest({ ...input, candidates: [] });
    expect(request.candidates).toEqual([]);
  });

  it("accepts a bounded 32-lead editorial jury but rejects a 33rd item", () => {
    const input = validInput();
    const candidates = Array.from({ length: 32 }, (_, index) => ({
      ...input.candidates[0],
      candidateId: `candidate-${index + 1}`,
    }));
    expect(
      createBroadcastContextRequest({ ...input, candidates }).candidates,
    ).toHaveLength(32);
    expect(() =>
      createBroadcastContextRequest({
        ...input,
        candidates: [
          ...candidates,
          { ...input.candidates[0], candidateId: "candidate-33" },
        ],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<BroadcastContextInputError>>({
        code: "INVALID_CANDIDATE_COUNT",
      }),
    );
  });

  it("maps whole-broadcast decisions to a non-forcing final selection gate", () => {
    expect(
      buildBroadcastContextEligibilityById([
        {
          candidateId: "apology",
          category: "apology-accountability",
          clipDecision: "select",
          confidence: 0.94,
          rejectionReasons: [],
          contextSummaryKo: "실수를 인정하고 정확히 사과한다.",
          whyThisMomentKo: "방송의 핵심 해명 장면이다.",
          relatedCandidateIds: [],
          uncertaintiesKo: [],
        },
        {
          candidateId: "relay-fragment",
          category: "not-clip-worthy",
          clipDecision: "reject",
          confidence: 0.91,
          rejectionReasons: ["no-distinct-event"],
          contextSummaryKo: "단편적인 상황이다.",
          whyThisMomentKo: "독립적인 사건이 없다.",
          relatedCandidateIds: [],
          uncertaintiesKo: [],
        },
      ]),
    ).toEqual({ apology: "eligible", "relay-fragment": "ineligible" });
  });

  it("does not describe a partially sampled chapter as complete coverage", () => {
    const input = validInput();
    const coverage = calculateCoverage(input.chapters, input.sourceDurationMs);

    expect(coverage.status).toBe("partial");
    expect(coverage.coverageRatio).toBeCloseTo(0.7, 6);
    expect(coverage.partialChapterIds).toEqual(["chapter-2"]);
    expect(coverage.gaps).toEqual([]);
  });

  it("rejects overlapping chapter summaries", () => {
    const input = validInput();

    expect(() =>
      createBroadcastContextRequest({
        ...input,
        chapters: [
          input.chapters[0],
          { ...input.chapters[1], startMs: 29 * 60_000 },
        ],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<BroadcastContextInputError>>({
        code: "OVERLAPPING_CHAPTERS",
        itemId: "chapter-2",
      }),
    );
  });

  it("rejects duplicate candidate IDs and out-of-source ranges", () => {
    const input = validInput();
    expect(() =>
      createBroadcastContextRequest({
        ...input,
        candidates: [input.candidates[0], input.candidates[0]],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<BroadcastContextInputError>>({
        code: "DUPLICATE_IDENTIFIER",
        itemId: "candidate-1",
      }),
    );

    expect(() =>
      createBroadcastContextRequest({
        ...input,
        candidates: [
          {
            ...input.candidates[0],
            endMs: input.sourceDurationMs + 1,
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<BroadcastContextInputError>>({
        code: "INVALID_RANGE",
        itemId: "candidate-1",
      }),
    );
  });

  it("enforces the twelve-hour and bounded-text limits", () => {
    const input = validInput();
    expect(() =>
      createBroadcastContextRequest({
        ...input,
        sourceDurationMs: 12 * 60 * 60_000 + 1,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<BroadcastContextInputError>>({
        code: "INVALID_SOURCE_DURATION",
      }),
    );

    expect(() =>
      createBroadcastContextRequest({
        ...input,
        chapters: [
          {
            ...input.chapters[0],
            summaryKo: "가".repeat(3_001),
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<BroadcastContextInputError>>({
        code: "INVALID_TEXT",
        itemId: "chapter-1",
      }),
    );
  });
});
