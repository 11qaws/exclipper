import { describe, expect, it } from "vitest";
import { createBroadcastContextRequest } from "./broadcastContextProtocol";
import type { BroadcastContextInputError } from "./broadcastContextProtocol";

function validInput() {
  return {
    sourceDurationMs: 60 * 60_000,
    chapters: [
      {
        chapterId: "chapter-1",
        startMs: 0,
        endMs: 30 * 60_000,
        summaryKo: "방송 전반부에서 음식 취향을 이야기한다.",
      },
      {
        chapterId: "chapter-2",
        startMs: 30 * 60_000,
        endMs: 60 * 60_000,
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

    expect(request.schemaVersion).toBe("1.1.0");
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
            summaryKo: "가".repeat(1_201),
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
