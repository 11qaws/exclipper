import { describe, expect, it } from "vitest";

import type { UnifiedHighlightCandidate } from "../analysis/highlightFusion";
import {
  applyCandidateBoundaryCommand,
  createCandidateBoundaryRevision,
  type CandidateBoundaryRevision,
} from "../domain/candidateBoundaryRevision";
import type {
  DurableAnalysisInputDescriptor,
  DurableAnalysisSelectionSummary,
} from "../storage/durableAnalysisPayload";
import {
  createHighlightClipboardText,
  createHighlightExportFile,
  formatHighlightTimecode,
  type ApprovedHighlightExportCandidate,
  type HighlightExportRequest,
} from "./highlightExport";

function candidate(
  id: string,
  startMs: number,
  reason = "화면 변화가 두드러진 구간이에요.",
): UnifiedHighlightCandidate {
  return {
    id,
    startMs,
    endMs: startMs + 45_000,
    peakMs: startMs + 20_000,
    score: 0.87,
    reason,
    signalKinds: ["visual"],
    evidence: {
      normalization: "within-signal-rank-and-mad",
      visual: {
        rankPercentile: 1,
        robustPercentile: 0.8,
        normalizedScore: 0.93,
        sceneChangeStrength: 0.72,
      },
    },
  };
}

const input: DurableAnalysisInputDescriptor = {
  source: {
    sourceDefinitionId: "source-1",
    contentFingerprint: `local-file-sampled-sha256-v1:${"a".repeat(64)}`,
    sizeBytes: 123_456,
    durationMs: 7_265_000,
    kind: "video",
    container: "mp4",
  },
  chat: {
    timestampBasis: "relative",
    importedRowCount: 12,
    offsetMs: 500,
  },
  candidateWindowMs: 45_000,
};

const selection: DurableAnalysisSelectionSummary = {
  plannedFrameCount: 100,
  sampledFrameCount: 100,
  analyzedTransitionCount: 99,
  analyzedChatMessageCount: 12,
  outOfRangeChatMessageCount: 0,
  skippedChatMessageCount: 0,
  chatGapReasonCode: null,
  plannedAudioWindowCount: 7_265,
  analyzedAudioWindowCount: 7_265,
  audioGapReasonCode: null,
  candidateCount: 2,
};

function approved(
  proposal: UnifiedHighlightCandidate,
  boundaryRevision: CandidateBoundaryRevision | null = null,
): ApprovedHighlightExportCandidate {
  return { proposal, boundaryRevision };
}

function request(candidates: readonly UnifiedHighlightCandidate[]): HighlightExportRequest {
  return {
    appVersion: "0.3.0",
    engineVersion: "test-engine",
    generatedAt: "2026-07-19T12:00:00.000Z",
    input,
    selection,
    candidates: candidates.map((item) => approved(item)),
  };
}

describe("highlight export", () => {
  it("formats hour-safe editor timecodes", () => {
    expect(formatHighlightTimecode(0)).toBe("00:00:00");
    expect(formatHighlightTimecode(7_265_999)).toBe("02:01:05");
    expect(() => formatHighlightTimecode(-1)).toThrow(RangeError);
  });

  it("creates an Excel-friendly BOM CSV in chronological order", () => {
    const file = createHighlightExportFile(
      "csv",
      request([candidate("later", 70_000), candidate("earlier", 5_000)]),
    );

    expect(file.fileName).toBe("retto-highlight-timeline.csv");
    expect(file.content.startsWith("\uFEFF")).toBe(true);
    expect(file.content.indexOf("00:00:05")).toBeLessThan(
      file.content.indexOf("00:01:10"),
    );
    expect(file.content).toContain('"AI가 고른 이유"');
  });

  it("escapes quotes and neutralizes spreadsheet formulas", () => {
    const file = createHighlightExportFile(
      "csv",
      request([candidate("formula", 5_000, '=HYPERLINK("bad")')]),
    );

    expect(file.content).toContain("'=HYPERLINK");
    expect(file.content).toContain('""bad""');
  });

  it("creates a readable Markdown timeline without claiming video output", () => {
    const file = createHighlightExportFile(
      "markdown",
      request([candidate("one", 5_000)]),
    );

    expect(file.fileName).toBe("retto-highlight-timeline.md");
    expect(file.content).toContain("# Retto Highlight 편집 시간표");
    expect(file.content).toContain("00:00:05–00:00:50");
    expect(file.content).toContain("영상 클립 파일은 포함하지 않습니다");
    expect(file.content).toContain("무슨 일이 있었나");
    expect(file.content).toContain("스트리머 반응");
  });

  it("keeps the privacy-safe JSON contract and approved state", () => {
    const file = createHighlightExportFile(
      "json",
      request([candidate("one", 5_000)]),
    );
    const parsed = JSON.parse(file.content) as Record<string, unknown>;

    expect(parsed).not.toHaveProperty("fileName");
    expect(parsed).not.toHaveProperty("chatMessages");
    expect(parsed).toMatchObject({
      schemaVersion: "0.4.0",
      appVersion: "0.3.0",
      audio: { plannedWindows: 7_265, analyzedWindows: 7_265 },
      candidates: [
        {
          id: "one",
          proposalRange: { startMs: 5_000, endMs: 50_000 },
          effectiveRange: { startMs: 5_000, endMs: 50_000 },
          rangeProvenance: "aiProposal",
          reviewState: "approved",
          interpretation: { basis: "visual-exploration" },
        },
      ],
    });
  });

  it("preserves missing legacy audio analysis as unavailable instead of zero coverage", () => {
    const legacySelection: DurableAnalysisSelectionSummary = {
      plannedFrameCount: 100,
      sampledFrameCount: 100,
      analyzedTransitionCount: 99,
      analyzedChatMessageCount: 12,
      outOfRangeChatMessageCount: 0,
      skippedChatMessageCount: 0,
      chatGapReasonCode: null,
      candidateCount: 1,
    };
    const file = createHighlightExportFile("json", {
      ...request([candidate("legacy", 5_000)]),
      appVersion: "0.2.1",
      selection: legacySelection,
    });
    const parsed = JSON.parse(file.content) as {
      audio: Record<string, unknown>;
    };

    expect(parsed.audio).toEqual({
      analysisStatus: "not-recorded-in-source-result",
      reason: "source-result-predates-audio-analysis",
      message: "해당 결과 버전에는 오디오 분석 정보가 없습니다.",
    });
    expect(parsed.audio).not.toHaveProperty("plannedWindows");
    expect(parsed.audio).not.toHaveProperty("analyzedWindows");
    expect(parsed.audio).not.toHaveProperty("gapReasonCode");
  });

  it("rejects partially populated audio selection metadata", () => {
    const partialSelection: DurableAnalysisSelectionSummary = {
      plannedFrameCount: selection.plannedFrameCount,
      sampledFrameCount: selection.sampledFrameCount,
      analyzedTransitionCount: selection.analyzedTransitionCount,
      analyzedChatMessageCount: selection.analyzedChatMessageCount,
      outOfRangeChatMessageCount: selection.outOfRangeChatMessageCount,
      skippedChatMessageCount: selection.skippedChatMessageCount,
      chatGapReasonCode: selection.chatGapReasonCode,
      plannedAudioWindowCount: 7_265,
      audioGapReasonCode: null,
      candidateCount: selection.candidateCount,
    };

    expect(() =>
      createHighlightExportFile("json", {
        ...request([candidate("partial", 5_000)]),
        selection: partialSelection,
      }),
    ).toThrow("Audio selection fields must be all present or all absent.");
  });

  it("creates a chronological copy-ready list", () => {
    expect(
      createHighlightClipboardText([
        approved(candidate("later", 70_000)),
        approved(candidate("earlier", 5_000)),
      ]),
    ).toBe(
      "Retto Highlight · 승인한 장면 2개\n" +
        "1. 00:00:05–00:00:50 · 오디오·채팅 반응 근거가 없어 화면 변화만으로 남긴 낮은 우선순위 탐색 후보예요.\n" +
        "2. 00:01:10–00:01:55 · 오디오·채팅 반응 근거가 없어 화면 변화만으로 남긴 낮은 우선순위 탐색 후보예요.",
    );
  });

  it("uses each approved candidate's effective range while preserving its AI proposal", () => {
    const proposal = candidate("adjusted", 60_000);
    const initialBoundary = createCandidateBoundaryRevision({
      boundarySessionId: "session-1",
      candidateId: proposal.id,
      proposalRange: { startMs: proposal.startMs, endMs: proposal.endMs },
      peakMs: proposal.peakMs,
      sourceDurationMs: input.source.durationMs,
    });
    const transition = applyCandidateBoundaryCommand(initialBoundary, {
      boundarySessionId: initialBoundary.boundarySessionId,
      candidateId: initialBoundary.candidateId,
      expectedRevision: 0,
      kind: "SHIFT_START",
      deltaMs: -5_000,
    });
    expect(transition.status).toBe("applied");
    if (transition.status !== "applied") return;

    const adjustedRequest: HighlightExportRequest = {
      ...request([]),
      candidates: [approved(proposal, transition.state)],
    };
    const csv = createHighlightExportFile("csv", adjustedRequest);
    const markdown = createHighlightExportFile("markdown", adjustedRequest);
    const json = JSON.parse(
      createHighlightExportFile("json", adjustedRequest).content,
    ) as {
      candidates: Array<Record<string, unknown>>;
    };
    const clipboard = createHighlightClipboardText(adjustedRequest.candidates);

    expect(csv.content).toContain('"00:00:55"');
    expect(csv.content).toContain('"사용자 조정"');
    expect(markdown.content).toContain("00:00:55–00:01:45");
    expect(markdown.content).toContain("AI 제안 구간: 00:01:00–00:01:45");
    expect(json.candidates[0]).toMatchObject({
      proposalRange: { startMs: 60_000, endMs: 105_000 },
      effectiveRange: { startMs: 55_000, endMs: 105_000 },
      rangeProvenance: "userAdjusted",
      userRevision: 1,
    });
    expect(clipboard).toContain("00:00:55–00:01:45");
    expect(clipboard).toContain("AI 제안 00:01:00–00:01:45에서 조정");
  });
});
