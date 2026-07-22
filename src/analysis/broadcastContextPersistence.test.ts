import { describe, expect, it } from "vitest";

import type { BroadcastContextRequestInput } from "./broadcastContextProtocol";
import {
  parsePersistedBroadcastContextResult,
  unpackPersistedBroadcastContext,
} from "./broadcastContextPersistence";

const input: BroadcastContextRequestInput = {
  sourceDurationMs: 60_000,
  chapters: [
    {
      chapterId: "chapter-1",
      startMs: 0,
      endMs: 60_000,
      evidenceMode: "complete-transcript",
      evidenceCoverageRatio: 1,
      summaryKo: "방송 내용을 확인했다.",
    },
  ],
  candidates: [],
};

const storedResult = {
  schemaVersion: "1.0.0",
  broadcastSummaryKo: "저장된 방송 요약",
  recurringThemesKo: [],
  annotations: [],
  semanticChaptersSupported: false,
  semanticChapters: [],
  discoveredLeadsSupported: false,
  discoveredLeads: [],
  coverage: {
    status: "complete",
    coveredMs: 60_000,
    coverageRatio: 1,
    gaps: [],
    partialChapterIds: [],
  },
};

describe("broadcastContextPersistence", () => {
  it("unwraps the current envelope and keeps its refinement selection", () => {
    expect(
      unpackPersistedBroadcastContext({
        schemaVersion: "1.0.0",
        result: storedResult,
        refinementLeadIds: ["lead-1"],
      }),
    ).toEqual({
      resultPayload: storedResult,
      refinementLeadIds: ["lead-1"],
      fastRefinementLeadIds: [],
    });
  });

  it("preserves the jury-approved fast localization subset", () => {
    expect(
      unpackPersistedBroadcastContext({
        schemaVersion: "1.1.0",
        result: storedResult,
        refinementLeadIds: ["lead-1", "lead-2"],
        fastRefinementLeadIds: ["lead-1"],
      }),
    ).toMatchObject({
      refinementLeadIds: ["lead-1", "lead-2"],
      fastRefinementLeadIds: ["lead-1"],
    });
  });

  it("preserves explicit legacy unsupported flags after strict parsing", () => {
    const restored = parsePersistedBroadcastContextResult(storedResult, input);

    expect(restored).not.toBeNull();
    expect(restored?.semanticChaptersSupported).toBe(false);
    expect(restored?.discoveredLeadsSupported).toBe(false);
    expect(restored?.hostStreamerProfile).toBeNull();
  });

  it("preserves the grounded host-streamer profile across a saved-session round trip", () => {
    const hostStreamerProfile = {
      displayNameKo: null,
      profileSummaryKo:
        "음식 취향을 구체적으로 설명하고 채팅의 반론에는 비유로 응수하며, 오답이 확인되면 인정하는 진행자다.",
      evidenceKo: ["음식 퀴즈에서 채팅과 논쟁", "정답 공개 뒤 오답 인정"],
      uncertaintiesKo: ["다른 방송에서도 같은 진행 방식인지는 확인하지 않음"],
    };
    const restored = parsePersistedBroadcastContextResult(
      {
        ...storedResult,
        schemaVersion: "1.6.0",
        hostStreamerProfile,
      },
      input,
    );

    expect(restored?.hostStreamerProfile).toEqual(hostStreamerProfile);
  });

  it("does not trust an invalid stored result", () => {
    expect(
      parsePersistedBroadcastContextResult(
        { ...storedResult, broadcastSummaryKo: 42 },
        input,
      ),
    ).toBeNull();
  });
});
