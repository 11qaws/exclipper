import { describe, expect, it } from "vitest";

import type { BroadcastContextRequestInput } from "./broadcastContextProtocol";
import { createBroadcastParticipantGrounding } from "./broadcastParticipantGrounding";
import {
  BROADCAST_CONTEXT_PERSISTENCE_SCHEMA_VERSION,
  parsePersistedBroadcastContextResult,
  unpackPersistedBroadcastContext,
} from "./broadcastContextPersistence";

const chapters = [
  {
    chapterId: "chapter-1",
    startMs: 0,
    endMs: 60_000,
    evidenceMode: "complete-transcript" as const,
    evidenceCoverageRatio: 1,
    summaryKo: "방송 내용을 확인했다.",
  },
] as const;

const input: BroadcastContextRequestInput = {
  sourceDurationMs: 60_000,
  chapters,
  candidates: [],
  castRosterId: null,
  outputLanguage: "ko",
  participantGrounding: createBroadcastParticipantGrounding({
    sourceDurationMs: 60_000,
    castRosterId: null,
    chapters,
  }),
};

const storedResult = {
  schemaVersion: "1.7.0",
  broadcastSummaryKo: "저장된 방송 요약",
  hostStreamerProfile: {
    displayNameKo: null,
    profileSummaryKo:
      "제공된 방송 근거를 차분하게 설명하는 진행자로 보인다.",
    evidenceKo: ["방송 내용을 순서대로 설명했다."],
    uncertaintiesKo: ["이름은 확인하지 못했다."],
  },
  recurringThemesKo: [],
  annotations: [],
  semanticChaptersSupported: true,
  semanticChapters: [],
  discoveredLeadsSupported: true,
  discoveredLeads: [],
  coverage: {
    status: "complete",
    coveredMs: 60_000,
    coverageRatio: 1,
    gaps: [],
    partialChapterIds: [],
  },
} as const;

function currentEnvelope() {
  return {
    schemaVersion: BROADCAST_CONTEXT_PERSISTENCE_SCHEMA_VERSION,
    result: storedResult,
    refinementLeadIds: ["lead-1", "lead-2"],
    fastRefinementLeadIds: ["lead-1"],
    contextCandidateIds: ["candidate-a", "candidate-b"],
  } as const;
}

describe("broadcastContextPersistence", () => {
  it("unwraps only the complete current envelope and preserves exact cohorts", () => {
    expect(unpackPersistedBroadcastContext(currentEnvelope())).toEqual({
      resultPayload: storedResult,
      refinementLeadIds: ["lead-1", "lead-2"],
      fastRefinementLeadIds: ["lead-1"],
      contextCandidateIds: ["candidate-a", "candidate-b"],
    });
  });

  it("rejects raw results and legacy wrappers without inferring annotations", () => {
    const legacyResult = {
      ...storedResult,
      annotations: [{ candidateId: "candidate-from-annotation" }],
    };

    expect(unpackPersistedBroadcastContext(legacyResult)).toBeNull();
    expect(
      unpackPersistedBroadcastContext({
        schemaVersion: "1.1.0",
        result: legacyResult,
        refinementLeadIds: [],
        fastRefinementLeadIds: [],
      }),
    ).toBeNull();
  });

  it("rejects a current wrapper when any explicit cohort field is missing", () => {
    const missingCohort = Object.fromEntries(
      Object.entries(currentEnvelope()).filter(
        ([key]) => key !== "contextCandidateIds",
      ),
    );

    expect(unpackPersistedBroadcastContext(missingCohort)).toBeNull();
    expect(
      unpackPersistedBroadcastContext({
        ...currentEnvelope(),
        inferredCandidateIds: ["candidate-from-annotation"],
      }),
    ).toBeNull();
  });

  it("rejects malformed cohorts and a fast subset outside refinement", () => {
    expect(
      unpackPersistedBroadcastContext({
        ...currentEnvelope(),
        contextCandidateIds: ["candidate-a", "candidate-a"],
      }),
    ).toBeNull();
    expect(
      unpackPersistedBroadcastContext({
        ...currentEnvelope(),
        fastRefinementLeadIds: ["lead-not-selected"],
      }),
    ).toBeNull();
  });

  it("restores a current grounded context result against the exact request", () => {
    const restored = parsePersistedBroadcastContextResult(storedResult, input);

    expect(restored).not.toBeNull();
    expect(restored?.schemaVersion).toBe("1.7.0");
    expect(restored?.hostStreamerProfile).toEqual(
      storedResult.hostStreamerProfile,
    );
    expect(restored?.semanticChaptersSupported).toBe(true);
    expect(restored?.discoveredLeadsSupported).toBe(true);
  });

  it("does not trust an invalid or previous-schema stored result", () => {
    expect(
      parsePersistedBroadcastContextResult(
        { ...storedResult, broadcastSummaryKo: 42 },
        input,
      ),
    ).toBeNull();
    expect(
      parsePersistedBroadcastContextResult(
        { ...storedResult, schemaVersion: "1.6.0" },
        input,
      ),
    ).toBeNull();
  });
});
