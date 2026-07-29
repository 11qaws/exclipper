import { describe, expect, it } from "vitest";
import {
  buildBroadcastContextEligibilityById,
  calculateCoverage,
  createBroadcastContextRequest,
  isFinalBroadcastContextResult,
} from "./broadcastContextProtocol";
import type { BroadcastContextInputError } from "./broadcastContextProtocol";
import { createBroadcastParticipantGrounding } from "./broadcastParticipantGrounding";
import {
  candidatePassBCastReferences,
  DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
} from "./participantRoster";

function validInput() {
  const sourceDurationMs = 60 * 60_000;
  const chapters = [
    {
      chapterId: "chapter-1",
      startMs: 0,
      endMs: 30 * 60_000,
      evidenceMode: "complete-transcript" as const,
      evidenceCoverageRatio: 1,
      summaryKo: "방송 전반부에서 음식 취향을 이야기한다.",
    },
    {
      chapterId: "chapter-2",
      startMs: 30 * 60_000,
      endMs: 60 * 60_000,
      evidenceMode: "sampled-audio-video" as const,
      evidenceCoverageRatio: 0.4,
      summaryKo: "후반부에서 실제 음식과 관련된 경험담이 이어진다.",
    },
  ] as const;
  return {
    sourceDurationMs,
    castRosterId: null,
    chapters,
    candidates: [
      {
        candidateId: "candidate-1",
        startMs: 10 * 60_000,
        endMs: 10 * 60_000 + 45_000,
        transcriptKo: "칼국수를 먹었던 이야기를 꺼낸다.",
        eventSummaryKo: "칼국수 경험담이 시작된다.",
        reactionSummaryKo: "스트리머가 기억을 떠올리며 웃는다.",
        participantContextKo:
          "등장인물 어댑터는 이 구간에서 식별 가능한 인물을 찾지 못했다.",
        chatReactionSummaryKo: null,
      },
    ],
    participantGrounding: createBroadcastParticipantGrounding({
      sourceDurationMs,
      castRosterId: null,
      chapters,
    }),
    outputLanguage: "ko",
  } as const;
}

describe("broadcastContextProtocol", () => {
  it("distinguishes the final whole-broadcast result from partial phase payloads", () => {
    const result = {
      semanticChaptersSupported: true,
      discoveredLeadsSupported: true,
    } as Parameters<typeof isFinalBroadcastContextResult>[0];

    expect(isFinalBroadcastContextResult(result)).toBe(true);
    expect(
      isFinalBroadcastContextResult({
        ...result,
        semanticChaptersSupported: false,
      }),
    ).toBe(false);
    expect(
      isFinalBroadcastContextResult({
        ...result,
        discoveredLeadsSupported: false,
      }),
    ).toBe(false);
  });

  it("snapshots bounded chapter and candidate evidence without decision fields", () => {
    const input = validInput();
    const request = createBroadcastContextRequest(input);

    expect(request.schemaVersion).toBe("1.7.0");
    expect(request.castRosterId).toBeNull();
    expect(request.participantGrounding).toMatchObject({
      status: "sealed",
      resolutionStatus: "no-source-roster",
    });
    expect(request.chapters).not.toBe(input.chapters);
    expect(request.candidates).not.toBe(input.candidates);
    expect(request.candidates[0]?.participantContextKo).toBe(
      input.candidates[0].participantContextKo,
    );
    expect(Object.keys(request.candidates[0] ?? {})).toEqual([
      "candidateId",
      "startMs",
      "endMs",
      "transcriptKo",
      "eventSummaryKo",
      "reactionSummaryKo",
      "participantContextKo",
      "chatReactionSummaryKo",
    ]);
    expect(JSON.stringify(request)).not.toMatch(
      /score|rank|approval|reviewState|boundary/iu,
    );
  });

  it("accepts only the fixed server-known cast roster", () => {
    const input = validInput();
    const participantGrounding = createBroadcastParticipantGrounding({
      sourceDurationMs: input.sourceDurationMs,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      chapters: input.chapters,
    });
    expect(
      createBroadcastContextRequest({
        ...input,
        castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
        participantGrounding,
      }).castRosterId,
    ).toBe(DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID);
    expect(() =>
      createBroadcastContextRequest({
        ...input,
        castRosterId: "user-authored-roster" as never,
        participantGrounding,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<BroadcastContextInputError>>({
        code: "INVALID_CAST_ROSTER",
      }),
    );
  });

  it("requires explicit language and explicit roster absence", () => {
    const withoutLanguage = { ...validInput() } as Record<string, unknown>;
    const withoutRoster = { ...validInput() } as Record<string, unknown>;
    delete withoutLanguage.outputLanguage;
    delete withoutRoster.castRosterId;

    expect(() =>
      createBroadcastContextRequest(withoutLanguage as never),
    ).toThrowError(
      expect.objectContaining<Partial<BroadcastContextInputError>>({
        code: "INVALID_TEXT",
      }),
    );
    expect(() =>
      createBroadcastContextRequest(withoutRoster as never),
    ).toThrowError(
      expect.objectContaining<Partial<BroadcastContextInputError>>({
        code: "INVALID_CAST_ROSTER",
      }),
    );
  });

  it("accepts only the deterministic sealed participant packet for the exact map", () => {
    const input = validInput();
    const participantGrounding = createBroadcastParticipantGrounding({
      sourceDurationMs: input.sourceDurationMs,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      chapters: input.chapters,
    });
    const canonical = createBroadcastContextRequest({
      ...input,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      participantGrounding,
    });
    expect(
      createBroadcastContextRequest({
        ...input,
        castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
        participantGrounding: canonical.participantGrounding,
      }).participantGrounding,
    ).toEqual(canonical.participantGrounding);
    expect(() =>
      createBroadcastContextRequest({
        ...input,
        castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
        participantGrounding: {
          ...canonical.participantGrounding,
          resolutionStatus: "no-source-roster",
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<BroadcastContextInputError>>({
        code: "INVALID_PARTICIPANT_GROUNDING",
      }),
    );
  });

  it("rejects requests that omit the sealed participant packet", () => {
    const input = validInput();
    const withoutGrounding = Object.fromEntries(
      Object.entries(input).filter(([key]) => key !== "participantGrounding"),
    );

    expect(() =>
      createBroadcastContextRequest(withoutGrounding as never),
    ).toThrowError(
      expect.objectContaining<Partial<BroadcastContextInputError>>({
        code: "INVALID_PARTICIPANT_GROUNDING",
      }),
    );
  });

  it("rejects candidates that omit their checkpointed participant context", () => {
    const input = validInput();
    const candidate = Object.fromEntries(
      Object.entries(input.candidates[0]).filter(
        ([key]) => key !== "participantContextKo",
      ),
    );

    expect(() =>
      createBroadcastContextRequest({
        ...input,
        candidates: [candidate as never],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<BroadcastContextInputError>>({
        code: "INVALID_TEXT",
        itemId: "candidate-1",
      }),
    );
  });

  it("keeps transcript-name matching on an explicit dialogue subset of the full context map", () => {
    const referencedParticipant = candidatePassBCastReferences(
      DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
    )[0]!;
    const fullContextChapters = [
      {
        chapterId: "dialogue-chapter",
        startMs: 0,
        endMs: 30_000,
        evidenceMode: "complete-transcript" as const,
        evidenceCoverageRatio: 1,
        summaryKo: "The streamer discusses the next activity.",
      },
      {
        chapterId: "visual-only-chapter",
        startMs: 30_000,
        endMs: 60_000,
        evidenceMode: "sampled-audio-video" as const,
        evidenceCoverageRatio: 1,
        summaryKo: `${referencedParticipant.displayName} appears in a visual-only summary.`,
      },
    ];
    const participantGrounding = createBroadcastParticipantGrounding({
      sourceDurationMs: 60_000,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      chapters: [fullContextChapters[0]!],
    });

    const request = createBroadcastContextRequest({
      sourceDurationMs: 60_000,
      chapters: fullContextChapters,
      candidates: [],
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      participantGrounding,
      outputLanguage: "ko",
    });

    expect(request.participantGrounding).toEqual(participantGrounding);
    expect(
      request.participantGrounding.transcriptSourceChapterIds,
    ).toEqual(["dialogue-chapter"]);
    expect(
      request.participantGrounding.evidence.some(
        (evidence) =>
          evidence.kind === "transcript-name-mention" &&
          evidence.chapterId === "visual-only-chapter",
      ),
    ).toBe(false);
  });

  it("rejects a participant packet whose dialogue subset is absent from its parent context map", () => {
    const input = validInput();
    const grounding = createBroadcastParticipantGrounding({
      sourceDurationMs: input.sourceDurationMs,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      chapters: input.chapters,
    });

    expect(() =>
      createBroadcastContextRequest({
        ...input,
        castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
        participantGrounding: {
          ...grounding,
          transcriptSourceChapterIds: [
            "chapter-1",
            "missing-dialogue-chapter",
          ],
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<BroadcastContextInputError>>({
        code: "INVALID_PARTICIPANT_GROUNDING",
      }),
    );
  });

  it("preserves canonical visual evidence supplied by a completed pre-context adapter", () => {
    const input = validInput();
    const participantGrounding = createBroadcastParticipantGrounding(
      {
        sourceDurationMs: input.sourceDurationMs,
        castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
        chapters: input.chapters,
      },
      {
        visualIdentity: {
          receipt: {
            adapter: "visual-identity",
            revision: "visual-reference-v1",
            status: "completed",
            inputCount: 4,
            processedCount: 4,
            unavailableReason: null,
          },
          evidence: [
            {
              evidenceId: "visual:candidate-1:amoretto",
              participantId: "amoretto",
              kind: "visual-reference-match",
              supports: "visible-identity",
              adapter: "visual-identity",
              startMs: 10 * 60_000,
              endMs: 10 * 60_000 + 45_000,
              chapterId: "chapter-1",
              confidence: 0.92,
              evidenceKo: "네 장의 대표 화면에서 같은 아바타를 확인했습니다.",
            },
          ],
        },
      },
    );
    const request = createBroadcastContextRequest({
      ...input,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      participantGrounding,
    });

    expect(request.participantGrounding).toEqual(participantGrounding);
    expect(request.participantGrounding.evidence).toContainEqual(
      expect.objectContaining({
        kind: "visual-reference-match",
        participantId: "amoretto",
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
