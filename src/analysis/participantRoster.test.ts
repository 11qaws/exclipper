import { describe, expect, it } from "vitest";

import {
  DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
  LEGACY_CANDIDATE_PASS_B_CAST_ROSTER_ID,
  candidatePassBCastReferenceForName,
  candidatePassBCastReferences,
  candidatePassBCastRosterIdForSourceName,
  isCandidatePassBCastRosterId,
} from "./participantRoster";

describe("participantRoster", () => {
  it("exposes a unique closed set grounded from the reference broadcast", () => {
    const references = candidatePassBCastReferences(
      DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
    );
    expect(references.map(({ displayName }) => displayName)).toEqual([
      "세라 교수님",
      "아모레또",
      "유레카",
      "세나 아르벨",
      "토로리 코코",
      "망징이",
    ]);
    expect(new Set(references.map(({ displayName }) => displayName)).size).toBe(
      references.length,
    );
    expect(references.every(({ visualDescriptionKo }) => /아바타/u.test(visualDescriptionKo))).toBe(true);
    expect(candidatePassBCastReferenceForName(
      DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      "교수님",
    )?.displayName).toBe("세라 교수님");
    expect(candidatePassBCastReferenceForName(
      DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      "코코",
    )?.displayName).toBe("토로리 코코");
  });

  it("does not accept arbitrary public roster identifiers", () => {
    expect(isCandidatePassBCastRosterId(DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID)).toBe(true);
    expect(isCandidatePassBCastRosterId(LEGACY_CANDIDATE_PASS_B_CAST_ROSTER_ID)).toBe(true);
    expect(isCandidatePassBCastRosterId("user-supplied-prompt")).toBe(false);
    expect(candidatePassBCastReferences(null)).toEqual([]);
  });

  it("scopes the roster to the reviewed replay instead of every uploaded video", () => {
    expect(
      candidatePassBCastRosterIdForSourceName(
        "[교환학생] 합격생&장학생 공개 [13996057].mp4",
      ),
    ).toBe(DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID);
    expect(
      candidatePassBCastRosterIdForSourceName(
        "[교환학생] 합격생&장학생 공개.mp4",
      ),
    ).toBe(DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID);
    expect(
      candidatePassBCastRosterIdForSourceName(
        "2026 07 17 - 음식 토크[KzAW3yow80Q].mp4",
      ),
    ).toBeNull();
    expect(
      candidatePassBCastRosterIdForSourceName("139960570.mp4"),
    ).toBeNull();
  });
});
