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
