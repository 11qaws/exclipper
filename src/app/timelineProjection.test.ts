import { describe, expect, it } from "vitest";

import {
  buildCandidateTimelineScorePoints,
  createChapterExplorationCells,
  createTranscriptExplorationCells,
  firstTimelineFrameById,
  timelineSignalLabel,
} from "./timelineProjection";
import type { CandidateTimelineFramesById } from "./appViewTypes";

describe("createTranscriptExplorationCells", () => {
  it("marks every chunk with the requested state and no stage", () => {
    const cells = createTranscriptExplorationCells(
      [
        { chunkId: "a", sourceStartMs: 0, sourceEndMs: 90_000, kind: "uniform" },
        { chunkId: "b", sourceStartMs: 90_000, sourceEndMs: 180_000, kind: "event" },
      ],
      "active",
    );
    expect(cells).toHaveLength(2);
    expect(cells.every(({ state }) => state === "active")).toBe(true);
    expect(cells.every(({ stage }) => stage === null)).toBe(true);
    expect(cells[0]?.chunkId).toBe("a");
  });

  it("defaults to queued", () => {
    const [cell] = createTranscriptExplorationCells([
      { chunkId: "a", sourceStartMs: 0, sourceEndMs: 1_000, kind: "uniform" },
    ]);
    expect(cell?.state).toBe("queued");
  });
});

describe("createChapterExplorationCells", () => {
  it("presents stored chapters as completed exploration cells", () => {
    const [cell] = createChapterExplorationCells([
      {
        chapterId: "ch-1",
        startMs: 1_000,
        endMs: 2_000,
        evidenceMode: "complete-transcript",
        evidenceCoverageRatio: 1,
        summaryKo: "요약",
      },
    ]);
    expect(cell).toEqual({
      chunkId: "chapter:ch-1",
      sourceStartMs: 1_000,
      sourceEndMs: 2_000,
      kind: "uniform",
      state: "complete",
      stage: null,
    });
  });
});

describe("timelineSignalLabel", () => {
  it("names every signal kind in Korean", () => {
    expect(timelineSignalLabel("audio")).toBe("목소리·소리 변화");
    expect(timelineSignalLabel("chat")).toBe("채팅 반응");
    expect(timelineSignalLabel("visual")).toBe("화면 변화");
    expect(timelineSignalLabel("fused")).toBe("복합 신호");
  });
});

describe("firstTimelineFrameById", () => {
  it("keeps the first frame per candidate and drops empty bundles", () => {
    const framesById = {
      "cand-1": [
        { relativeTimestampMs: 0, mimeType: "image/jpeg", dataBase64: "a" },
        { relativeTimestampMs: 10, mimeType: "image/jpeg", dataBase64: "b" },
      ],
      "cand-2": [],
    } as unknown as CandidateTimelineFramesById;
    const thumbnails = firstTimelineFrameById(framesById);
    expect(Object.keys(thumbnails)).toEqual(["cand-1"]);
    expect(thumbnails["cand-1"]?.dataBase64).toBe("a");
  });
});

describe("buildCandidateTimelineScorePoints", () => {
  const candidate = (
    id: string,
    peakMs: number,
    score: number,
  ): { id: string; peakMs: number; startMs: number; endMs: number; score: number } => ({
    id,
    peakMs,
    startMs: peakMs - 15_000,
    endMs: peakMs + 15_000,
    score,
  });

  it("normalises strength inside each signal kind, never across kinds", () => {
    const points = buildCandidateTimelineScorePoints([
      {
        signalKind: "audio",
        candidates: [candidate("a1", 60_000, 10), candidate("a2", 120_000, 5)],
      },
      { signalKind: "chat", candidates: [candidate("c1", 90_000, 2)] },
    ]);
    const byId = Object.fromEntries(points.map((point) => [point.id, point]));
    expect(byId["a1"]?.strength).toBeCloseTo(1);
    expect(byId["a2"]?.strength).toBeCloseTo(0.5);
    // The lone chat candidate is its own maximum, so it is full strength too.
    expect(byId["c1"]?.strength).toBeCloseTo(1);
  });

  it("sorts by source time so the timeline reads left to right", () => {
    const points = buildCandidateTimelineScorePoints([
      {
        signalKind: "audio",
        candidates: [candidate("late", 300_000, 3), candidate("early", 30_000, 1)],
      },
    ]);
    expect(points.map(({ id }) => id)).toEqual(["early", "late"]);
  });

  it("drops points whose range or score is not usable", () => {
    const points = buildCandidateTimelineScorePoints([
      {
        signalKind: "visual",
        candidates: [
          { id: "bad-range", peakMs: 10, startMs: 100, endMs: 100, score: 1 },
          { id: "not-finite", peakMs: Number.NaN, startMs: 0, endMs: 10, score: 1 },
          candidate("good", 60_000, 4),
        ],
      },
    ]);
    expect(points.map(({ id }) => id)).toEqual(["good"]);
  });

  it("keeps a visible floor so a weak signal is never invisible", () => {
    const points = buildCandidateTimelineScorePoints([
      {
        signalKind: "fused",
        candidates: [candidate("strong", 60_000, 1_000), candidate("weak", 90_000, 1)],
      },
    ]);
    const weak = points.find(({ id }) => id === "weak");
    expect(weak?.strength).toBeGreaterThanOrEqual(0.08);
  });
});
