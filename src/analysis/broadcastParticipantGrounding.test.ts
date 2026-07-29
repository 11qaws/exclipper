import { describe, expect, it } from "vitest";

import {
  createBroadcastParticipantGrounding,
  isBroadcastParticipantGroundingForInput,
  participantContextForBroadcastRange,
} from "./broadcastParticipantGrounding";
import {
  AMORETTO_CHANNEL_CAST_ROSTER_ID,
  DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
} from "./participantRoster";

const chapters = [
  {
    chapterId: "chapter-1",
    startMs: 0,
    endMs: 60_000,
    summaryKo: "교수님이 오늘 방송 순서를 설명한다.",
  },
  {
    chapterId: "chapter-2",
    startMs: 60_000,
    endMs: 120_000,
    summaryKo: "레또가 들어왔다는 이야기를 하고 유레카를 부른다.",
  },
] as const;

describe("broadcastParticipantGrounding", () => {
  it("seals source priors separately from transcript name mentions", () => {
    const grounding = createBroadcastParticipantGrounding({
      sourceDurationMs: 120_000,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      chapters,
    });

    expect(grounding.status).toBe("sealed");
    expect(grounding.resolutionStatus).toBe("transcript-mentions");
    expect(grounding.adapterReceipts).toEqual([
      expect.objectContaining({
        adapter: "transcript-names",
        status: "completed",
        inputCount: 2,
        processedCount: 2,
      }),
      expect.objectContaining({
        adapter: "visual-identity",
        status: "unavailable",
        unavailableReason: "no-verified-reference-manifest",
      }),
      expect.objectContaining({
        adapter: "voice-identity",
        status: "unavailable",
        unavailableReason: "no-verified-reference-manifest",
      }),
    ]);
    expect(grounding.participants).toHaveLength(6);
    expect(
      grounding.participants.find(
        ({ participantId }) => participantId === "sera-professor",
      ),
    ).toMatchObject({
      sourceRolePrior: "likely-host",
      mentionedChapterCount: 1,
    });
    expect(
      grounding.evidence.filter(
        ({ kind }) => kind === "transcript-name-mention",
      ),
    ).toEqual([
      expect.objectContaining({
        participantId: "sera-professor",
        chapterId: "chapter-1",
        matchedNameKo: "교수님",
      }),
      expect.objectContaining({
        participantId: "amoretto",
        chapterId: "chapter-2",
        matchedNameKo: "레또",
      }),
      expect.objectContaining({
        participantId: "eureka",
        chapterId: "chapter-2",
        matchedNameKo: "유레카",
      }),
    ]);
  });

  it("keeps five possible personal-channel participants while excluding 세라", () => {
    const grounding = createBroadcastParticipantGrounding({
      sourceDurationMs: 120_000,
      castRosterId: AMORETTO_CHANNEL_CAST_ROSTER_ID,
      chapters,
    });
    expect(
      grounding.participants.map(({ displayNameKo }) => displayNameKo),
    ).toEqual(["아모레또", "유레카", "세나 아르벨", "토로리 코코", "망징이"]);
    expect(grounding.participants[0]?.sourceRolePrior).toBe("likely-host");
    expect(
      grounding.participants
        .slice(1)
        .every(({ sourceRolePrior }) => sourceRolePrior === "possible-guest"),
    ).toBe(true);
  });

  it("keeps an unknown source participant list empty instead of leaking the six-person catalog", () => {
    const grounding = createBroadcastParticipantGrounding({
      sourceDurationMs: 120_000,
      castRosterId: null,
      chapters: [],
    });
    expect(grounding.resolutionStatus).toBe("no-source-roster");
    expect(grounding.participants).toEqual([]);
    expect(
      grounding.evidence.some(({ kind }) => kind === "source-channel-prior"),
    ).toBe(false);
  });

  it("does not mistake an embedded alias for a person mention", () => {
    const grounding = createBroadcastParticipantGrounding({
      sourceDurationMs: 60_000,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      chapters: [
        {
          chapterId: "chapter-1",
          startMs: 0,
          endMs: 60_000,
          summaryKo: "코코넛과 코코아 초콜릿, 세나라라는 지명을 이야기한다.",
        },
      ],
    });
    expect(
      grounding.evidence.filter(
        ({ kind }) => kind === "transcript-name-mention",
      ),
    ).toEqual([]);
  });

  it("does not use generic aliases when the source roster is unknown", () => {
    const grounding = createBroadcastParticipantGrounding({
      sourceDurationMs: 60_000,
      castRosterId: null,
      chapters: [
        {
          chapterId: "chapter-1",
          startMs: 0,
          endMs: 60_000,
          summaryKo: "학교 교수님과 코코아에 관한 일반적인 이야기를 한다.",
        },
      ],
    });
    expect(
      grounding.evidence.filter(
        ({ kind }) => kind === "transcript-name-mention",
      ),
    ).toEqual([]);
  });

  it("preserves completed visual evidence without confusing it with a source prior", () => {
    const input = {
      sourceDurationMs: 120_000,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      chapters,
    } as const;
    const grounding = createBroadcastParticipantGrounding(input, {
      visualIdentity: {
        receipt: {
          adapter: "visual-identity",
          revision: "visual-reference-v1",
          status: "completed",
          inputCount: 8,
          processedCount: 8,
          unavailableReason: null,
        },
        evidence: [
          {
            evidenceId: "visual:chapter-2:amoretto",
            participantId: "amoretto",
            kind: "visual-reference-match",
            supports: "visible-identity",
            adapter: "visual-identity",
            startMs: 65_000,
            endMs: 75_000,
            chapterId: "chapter-2",
            confidence: 0.94,
            evidenceKo: "대표 화면에서 아모레또 참조 아바타와 일치합니다.",
          },
        ],
      },
    });

    expect(grounding.resolutionStatus).toBe("observed-identities");
    expect(isBroadcastParticipantGroundingForInput(grounding, input)).toBe(
      true,
    );
    expect(
      participantContextForBroadcastRange(grounding, 65_000, 75_000),
    ).toContain("화면 근거로 아모레또");
  });

  it("reports explicit no-person and no-speech observations as completed evidence", () => {
    const input = {
      sourceDurationMs: 120_000,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      chapters: [],
    } as const;
    const grounding = createBroadcastParticipantGrounding(input, {
      visualIdentity: {
        receipt: {
          adapter: "visual-identity",
          revision: "visual-reference-v1",
          status: "completed",
          inputCount: 1,
          processedCount: 1,
          unavailableReason: null,
        },
        evidence: [
          {
            evidenceId: "visual:empty:1",
            participantId: null,
            kind: "no-visible-participant",
            supports: "no-visible-participant",
            adapter: "visual-identity",
            startMs: 10_000,
            endMs: 20_000,
            chapterId: null,
            confidence: null,
            evidenceKo: "검토한 화면에 인물이 없습니다.",
          },
        ],
      },
      voiceIdentity: {
        receipt: {
          adapter: "voice-identity",
          revision: "voice-reference-v1",
          status: "completed",
          inputCount: 1,
          processedCount: 1,
          unavailableReason: null,
        },
        evidence: [
          {
            evidenceId: "voice:no-speech:1",
            participantId: null,
            kind: "no-speech",
            supports: "no-speech",
            adapter: "voice-identity",
            startMs: 10_000,
            endMs: 20_000,
            chapterId: null,
            confidence: null,
            evidenceKo: "검토한 오디오에 발화가 없습니다.",
          },
        ],
      },
    });

    expect(grounding.resolutionStatus).toBe("media-reviewed");
    expect(participantContextForBroadcastRange(grounding, 10_000, 20_000)).toBe(
      "화면에는 인물이 보이지 않았습니다. 발화가 없는 구간으로 확인했습니다.",
    );
  });

  it("keeps observed-but-unidentified people and speakers distinct from adapter failure", () => {
    const input = {
      sourceDurationMs: 120_000,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      chapters,
    } as const;
    const grounding = createBroadcastParticipantGrounding(input, {
      visualIdentity: {
        receipt: {
          adapter: "visual-identity",
          revision: "visual-reference-v1",
          status: "completed",
          inputCount: 1,
          processedCount: 1,
          unavailableReason: null,
        },
        evidence: [
          {
            evidenceId: "visual:unknown:chapter-2",
            participantId: null,
            kind: "visible-participant-unidentified",
            supports: "visible-unidentified",
            adapter: "visual-identity",
            startMs: 65_000,
            endMs: 75_000,
            chapterId: "chapter-2",
            confidence: null,
            evidenceKo:
              "인물은 보이지만 참조 명단과 일치 여부를 확정할 수 없습니다.",
          },
        ],
      },
      voiceIdentity: {
        receipt: {
          adapter: "voice-identity",
          revision: "voice-reference-v1",
          status: "completed",
          inputCount: 1,
          processedCount: 1,
          unavailableReason: null,
        },
        evidence: [
          {
            evidenceId: "voice:unknown:chapter-2",
            participantId: null,
            kind: "speaker-unidentified",
            supports: "speaker-unidentified",
            adapter: "voice-identity",
            startMs: 65_000,
            endMs: 75_000,
            chapterId: "chapter-2",
            confidence: null,
            evidenceKo: "발화가 있지만 검증된 화자와 연결하지 못했습니다.",
          },
        ],
      },
    });

    const context = participantContextForBroadcastRange(
      grounding,
      65_000,
      75_000,
    );
    expect(context).toContain("화면에는 인물이 보이지만");
    expect(context).toContain("발화는 확인했지만 화자는 확인하지 못했습니다.");
    expect(context).toContain("아모레또, 유레카");
    expect(context).toContain("등장이나 발화 증거가 아니며");
    expect(context).not.toContain("식별은 아직 수행");
  });

  it("rejects observed evidence that is not backed by a completed adapter", () => {
    const input = {
      sourceDurationMs: 120_000,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      chapters,
    } as const;
    const grounding = createBroadcastParticipantGrounding(input, {
      visualIdentity: {
        receipt: {
          adapter: "visual-identity",
          revision: "visual-reference-v1",
          status: "completed",
          inputCount: 8,
          processedCount: 8,
          unavailableReason: null,
        },
        evidence: [
          {
            evidenceId: "visual:chapter-2:amoretto",
            participantId: "amoretto",
            kind: "visual-reference-match",
            supports: "visible-identity",
            adapter: "visual-identity",
            startMs: 65_000,
            endMs: 75_000,
            chapterId: "chapter-2",
            confidence: 0.94,
            evidenceKo: "대표 화면에서 아모레또 참조 아바타와 일치합니다.",
          },
        ],
      },
    });
    expect(
      isBroadcastParticipantGroundingForInput(
        {
          ...grounding,
          adapterReceipts: [
            grounding.adapterReceipts[0],
            {
              adapter: "visual-identity",
              revision: "visual-reference-v1",
              status: "unavailable",
              inputCount: 0,
              processedCount: 0,
              unavailableReason: "no-verified-reference-manifest",
            },
            grounding.adapterReceipts[2],
          ],
        },
        input,
      ),
    ).toBe(false);
  });

  it("describes range-local mentions without upgrading them to presence", () => {
    const grounding = createBroadcastParticipantGrounding({
      sourceDurationMs: 120_000,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      chapters,
    });
    expect(
      participantContextForBroadcastRange(grounding, 60_000, 90_000),
    ).toContain("아모레또, 유레카");
    expect(
      participantContextForBroadcastRange(grounding, 60_000, 90_000),
    ).toContain("증거가 아니며");
  });

  it("accepts only the deterministic packet for the exact source map", () => {
    const input = {
      sourceDurationMs: 120_000,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      chapters,
    } as const;
    const grounding = createBroadcastParticipantGrounding(input);
    expect(isBroadcastParticipantGroundingForInput(grounding, input)).toBe(
      true,
    );
    expect(
      isBroadcastParticipantGroundingForInput(
        {
          ...grounding,
          resolutionStatus: "catalog-only",
        },
        input,
      ),
    ).toBe(false);
  });
});
