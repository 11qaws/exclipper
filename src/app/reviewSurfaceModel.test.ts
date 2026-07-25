import { describe, expect, it } from "vitest";

import { buildReviewCandidates, type ReviewModelInput } from "./reviewSurfaceModel";

const CANDIDATE = { id: "c1", startMs: 10_000, endMs: 40_000, peakMs: 25_000 };

function input(overrides: Partial<ReviewModelInput> = {}): ReviewModelInput {
  return {
    candidates: [CANDIDATE],
    insightById: {},
    contextById: {},
    cuesById: {},
    framesById: {},
    decisionById: {},
    ...overrides,
  };
}

describe("review surface model", () => {
  it("renders honestly when Pass B produced nothing for a candidate", () => {
    const [candidate] = buildReviewCandidates(input());
    expect(candidate?.people).toEqual([]);
    expect(candidate?.cues).toEqual([]);
    expect(candidate?.context).toEqual([]);
    expect(candidate?.frames).toEqual([]);
    expect(candidate?.decision).toBe("pending");
    // no invented content — an explicit "not ready" line instead
    expect(candidate?.why).toContain("아직");
    expect(candidate?.quote).toBeUndefined();
  });

  it("carries the summary, reaction quote and participants through", () => {
    const [candidate] = buildReviewCandidates(
      input({
        insightById: {
          c1: {
            eventSummaryKo: "첫 시식 직후 큰 웃음이 이어집니다.",
            reactionSummaryKo: "웃음과 감탄",
            identifiedParticipants: [
              { displayName: "아모레또", role: "guest" },
              { displayName: "아모레또", role: "guest" }, // duplicate collapses
              { displayName: "세라 교수님", role: "streamer" },
            ],
          },
        } as unknown as ReviewModelInput["insightById"],
        profileImageByName: { 아모레또: "/streamers/amoretto.jpg" },
      }),
    );
    expect(candidate?.why).toBe("첫 시식 직후 큰 웃음이 이어집니다.");
    expect(candidate?.quote).toBe("웃음과 감탄");
    expect(candidate?.people).toHaveLength(2);
    expect(candidate?.people[0]).toEqual({
      name: "아모레또",
      role: "게스트",
      imageUrl: "/streamers/amoretto.jpg",
    });
    expect(candidate?.people[1]?.role).toBe("진행자");
  });

  it("labels context by relation and anchors it outside the clip", () => {
    const [candidate] = buildReviewCandidates(
      input({
        contextById: {
          c1: {
            beforeContextKo: "택배 상자를 여는 대화",
            afterContextKo: "다른 참가자들이 맛을 비교",
          },
        } as unknown as ReviewModelInput["contextById"],
      }),
    );
    expect(candidate?.context.map((c) => c.label)).toEqual(["앞선 맥락", "이어지는 맥락"]);
    expect(candidate?.context[0]?.atMs).toBeLessThan(CANDIDATE.startMs);
    expect(candidate?.context[1]?.atMs).toBeGreaterThan(CANDIDATE.endMs);
  });

  it("drops blank transcript segments and keeps absolute timestamps", () => {
    const [candidate] = buildReviewCandidates(
      input({
        cuesById: {
          c1: [
            {
              phase: "near-peak",
              phaseLabel: "반응 시점 부근",
              absoluteStartMs: 12_000,
              absoluteEndMs: 13_000,
              text: "이게 그거구나",
            },
            {
              phase: "after-peak",
              phaseLabel: "반응 뒤",
              absoluteStartMs: 14_000,
              absoluteEndMs: 15_000,
              text: "   ",
            },
          ],
        },
      }),
    );
    expect(candidate?.cues).toHaveLength(1);
    expect(candidate?.cues[0]?.atMs).toBe(12_000);
  });

  it("keeps a participant whose name was never identified", () => {
    // Being on screen is itself review material, so an unnamed participant is
    // carried through with an empty name rather than dropped.
    const [candidate] = buildReviewCandidates(
      input({
        insightById: {
          c1: {
            identifiedParticipants: [
              { displayName: "  ", role: "guest" },
              { displayName: "세라 교수님", role: "streamer" },
            ],
          },
        } as unknown as ReviewModelInput["insightById"],
      }),
    );
    expect(candidate?.people).toHaveLength(2);
    expect(candidate?.people[0]?.name).toBeUndefined();
    expect(candidate?.people[0]?.role).toBe("게스트");
  });

  it("turns candidate-relative frame times into absolute ones", () => {
    // Frames are captured relative to the clip's start; the surface places
    // everything on the broadcast's own clock, so the offset must be added back.
    const [candidate] = buildReviewCandidates(
      input({
        framesById: {
          c1: [
            { timestampMs: 0 },
            { timestampMs: 4_000, mimeType: "image/webp", dataBase64: "AAA" },
          ],
        },
      }),
    );
    expect(candidate?.frames[0]?.atMs).toBe(CANDIDATE.startMs);
    expect(candidate?.frames[1]?.atMs).toBe(CANDIDATE.startMs + 4_000);
    expect(candidate?.frames[1]?.imageUrl).toBe("data:image/webp;base64,AAA");
    expect(candidate?.frames[0]?.imageUrl).toBeUndefined();
  });
});
