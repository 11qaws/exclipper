import { describe, expect, it } from "vitest";
import {
  captionTextForRange,
  chapterTextForRange,
  isExplicitMusicOnlyCaption,
} from "./captionCandidateEvidence";

describe("captionCandidateEvidence", () => {
  it("keeps candidate transcript text source-fenced", () => {
    const events = [
      { startMs: 5_000, durationMs: 1_000, text: "앞 장면" },
      { startMs: 12_000, durationMs: 2_000, text: "칼국수는 맞잖아요" },
      { startMs: 35_000, durationMs: 1_000, text: "뒤 장면" },
    ];
    expect(captionTextForRange(events, 10_000, 30_000)).toBe(
      "칼국수는 맞잖아요",
    );
  });

  it("uses persisted chapters only as a bounded fallback", () => {
    expect(
      chapterTextForRange(
        [
          {
            chapterId: "c1",
            startMs: 0,
            endMs: 120_000,
            evidenceMode: "complete-transcript",
            evidenceCoverageRatio: 1,
            summaryKo: "음식 이름을 맞히며 항변한다.",
          },
          {
            chapterId: "c2",
            startMs: 120_000,
            endMs: 240_000,
            evidenceMode: "complete-transcript",
            evidenceCoverageRatio: 1,
            summaryKo: "다음 주제로 넘어간다.",
          },
        ],
        30_000,
        60_000,
      ),
    ).toBe("음식 이름을 맞히며 항변한다.");
  });

  it("rejects explicit music cues without Korean speech", () => {
    expect(isExplicitMusicOnlyCaption("[음악] >> เฮ [음악]")).toBe(true);
    expect(isExplicitMusicOnlyCaption("[음악] [비명] ♪♪")).toBe(true);
  });

  it("does not erase speech or unmarked evidence", () => {
    expect(isExplicitMusicOnlyCaption("[음악] 안녕하세요 여러분")).toBe(false);
    expect(isExplicitMusicOnlyCaption("we finally did it")).toBe(false);
    expect(isExplicitMusicOnlyCaption("칼국수는 맞잖아요")).toBe(false);
  });
});
