import { describe, expect, it } from "vitest";

import {
  deriveFrontSurfaceModel,
  type FrontPipelineInput,
  type FrontPreanalysisInput,
  type FrontSourceInput,
  type FrontSurfaceModelInput,
} from "./frontSurfaceModel";

const TWO_HOURS_MS = 2 * 3_600_000;

const READY_SOURCE: FrontSourceInput = {
  title: "2026 07 17 - 음식 토크.mp4",
  durationMs: TWO_HOURS_MS,
  sizeBytes: 476 * 1_024 * 1_024,
  status: "ready",
};

const EMPTY_PREANALYSIS: FrontPreanalysisInput = {
  videoIdentity: { status: "idle" },
  transcriptChapters: { status: "idle" },
  wholeContext: { status: "idle" },
};

function pipeline(
  overrides: Partial<FrontPipelineInput> = {},
): FrontPipelineInput {
  return {
    status: "running",
    phase: "fast-pass",
    terminalOutcome: null,
    progress: {
      ratio: 0.25,
      indeterminate: false,
      remainingMs: 180_000,
      checkpoint: { status: "saved", ratio: 0.2 },
      tracks: [],
    },
    ...overrides,
  };
}

function input(
  overrides: Partial<FrontSurfaceModelInput> = {},
): FrontSurfaceModelInput {
  return {
    language: "ko",
    source: READY_SOURCE,
    pipeline: null,
    preanalysis: EMPTY_PREANALYSIS,
    topics: [],
    recovery: null,
    ...overrides,
  };
}

describe("deriveFrontSurfaceModel modes", () => {
  it("renders a true empty state without inventing progress or candidates", () => {
    const model = deriveFrontSurfaceModel(
      input({ source: null, preanalysis: null }),
    );

    expect(model.mode).toBe("empty");
    expect(model.source).toBeNull();
    expect(model.progress).toBeNull();
    expect(model.stage.index).toBe(1);
    expect(model.stage.total).toBe(4);
    expect(model.topics).toEqual([]);
    expect(model.topicStatus.state).toBe("hidden");
    expect("candidates" in model).toBe(false);
  });

  it("keeps source inspection separate from analysis readiness", () => {
    const selected = deriveFrontSurfaceModel(
      input({ source: { ...READY_SOURCE, status: "selected" } }),
    );
    const checking = deriveFrontSurfaceModel(
      input({ source: { ...READY_SOURCE, status: "checking" } }),
    );
    const ready = deriveFrontSurfaceModel(input());

    expect(selected.mode).toBe("inspecting");
    expect(checking.mode).toBe("inspecting");
    expect(ready.mode).toBe("ready");
    expect(ready.stage.phase).toBe("fast-pass");
    expect(ready.stage.index).toBe(1);
  });

  it("keeps internal phases inside the global analysis step", () => {
    const phases = [
      "fast-pass",
      "broadcast-context",
      "candidate-detail",
    ] as const;

    for (const phase of phases) {
      const model = deriveFrontSurfaceModel(
        input({ pipeline: pipeline({ phase }) }),
      );
      expect(model.mode).toBe("running");
      expect(model.stage.phase).toBe(phase);
      expect(model.stage.index).toBe(2);
      expect(model.stage.total).toBe(4);
    }
  });

  it("treats a verified zero-result completion as normal, not recoverable", () => {
    const model = deriveFrontSurfaceModel(
      input({
        pipeline: pipeline({
          status: "completed",
          phase: "candidate-detail",
          terminalOutcome: "verified-empty",
          progress: {
            ratio: 1,
            indeterminate: false,
            checkpoint: { status: "saved", ratio: 1 },
          },
        }),
      }),
    );

    expect(model.mode).toBe("zero");
    expect(model.stage.index).toBe(2);
    expect(model.recovery).toBeNull();
  });

  it("does not infer a zero result from completed status without a publication receipt", () => {
    const model = deriveFrontSurfaceModel(
      input({
        pipeline: pipeline({
          status: "completed",
          phase: "candidate-detail",
          terminalOutcome: null,
        }),
      }),
    );

    expect(model.mode).toBe("recoverable");
    expect(model.recovery?.primaryAction.id).toBe("retry-candidate-detail");
  });

  it("does not claim a running state when source or phase truth is missing", () => {
    const noSource = deriveFrontSurfaceModel(
      input({ source: null, pipeline: pipeline() }),
    );
    const noPhase = deriveFrontSurfaceModel(
      input({ pipeline: pipeline({ phase: null }) }),
    );

    expect(noSource.mode).toBe("recoverable");
    expect(noSource.recovery?.primaryAction.id).toBe("choose-source");
    expect(noPhase.mode).toBe("recoverable");
    expect(noPhase.recovery?.primaryAction.id).toBe("resume-analysis");
  });

  it("does not label a blocked source as analysis-ready", () => {
    const model = deriveFrontSurfaceModel(
      input({ source: { ...READY_SOURCE, status: "blocked" } }),
    );

    expect(model.mode).toBe("recoverable");
    expect(model.stage.eyebrow).toBe("작업 복구");
    expect(model.stage.phase).toBeNull();
    expect(model.recovery?.primaryAction.id).toBe("choose-source");
  });
});

describe("single progress axis and durable recovery", () => {
  it("normalizes live progress and exposes one current task and one checkpoint", () => {
    const model = deriveFrontSurfaceModel(
      input({
        pipeline: pipeline({
          progress: {
            ratio: 1.8,
            indeterminate: false,
            remainingMs: 125_000,
            activityLabel: "화면·오디오 표본 19/40 확인 중",
            checkpoint: { status: "saved", ratio: 0.65 },
            tracks: [
              { id: "voice", label: "대사 인식", status: "12/20", ratio: -4 },
              { id: "voice", label: "중복", status: "중복", ratio: 1 },
              { id: "chat", label: "채팅", status: "선택 사항", ratio: null },
            ],
          },
        }),
      }),
    );

    expect(model.progress).toMatchObject({
      ratio: 1,
      percent: 100,
      indeterminate: false,
      displayBasis: "live",
      remainingLabel: "약 3분 남음",
      currentTask: "화면·오디오 표본 19/40 확인 중",
      checkpointLabel: "65%까지 안전하게 저장됐어요",
    });
    expect(model.tracks).toHaveLength(2);
    expect(model.tracks[0]?.ratio).toBe(0);
  });

  it("uses only the durable checkpoint after failure and exposes one recovery action", () => {
    const model = deriveFrontSurfaceModel(
      input({
        pipeline: pipeline({
          status: "failed",
          phase: "broadcast-context",
          progress: {
            ratio: 0.91,
            indeterminate: false,
            remainingMs: 60_000,
            activityLabel: "실패 전에 표시되던 오래된 작업",
            checkpoint: { status: "saved", ratio: 0.42 },
          },
        }),
        recovery: {
          actionId: "retry-transcript",
          safeDetail: "실패한 대사 조각 3개만 남아 있어요.",
        },
      }),
    );

    expect(model.mode).toBe("recoverable");
    expect(model.progress).toMatchObject({
      ratio: 0.42,
      percent: 42,
      displayBasis: "checkpoint",
      indeterminate: false,
      remainingLabel: null,
    });
    expect(model.progress?.currentTask).not.toContain("오래된 작업");
    expect(model.recovery).toEqual({
      title: "대사 확인이 일부 멈췄어요",
      detail: "실패한 대사 조각 3개만 남아 있어요.",
      primaryAction: {
        id: "retry-transcript",
        label: "실패한 대사 조각 다시 확인",
      },
    });
    expect("actions" in (model.recovery ?? {})).toBe(false);
  });

  it("infers a phase-specific recovery action without losing committed progress", () => {
    const model = deriveFrontSurfaceModel(
      input({
        pipeline: pipeline({
          status: "interrupted",
          phase: "candidate-detail",
          progress: {
            ratio: 0.8,
            indeterminate: false,
            checkpoint: { status: "saved", ratio: 0.6 },
          },
        }),
      }),
    );

    expect(model.mode).toBe("recoverable");
    expect(model.progress?.ratio).toBe(0.6);
    expect(model.recovery?.primaryAction.id).toBe("retry-candidate-detail");
  });

  it("treats a non-finite ratio as unknown instead of rendering NaN", () => {
    const model = deriveFrontSurfaceModel(
      input({
        pipeline: pipeline({
          progress: {
            ratio: Number.NaN,
            indeterminate: false,
            checkpoint: { status: "none", ratio: Number.POSITIVE_INFINITY },
          },
        }),
      }),
    );

    expect(model.progress).toMatchObject({
      ratio: null,
      percent: null,
      indeterminate: true,
    });
    expect(model.progress?.checkpointLabel).toBe(
      "아직 저장된 분석 지점이 없어요",
    );
  });
});

describe("channel preanalysis truth", () => {
  it("keeps transcript-ready independent from whole-context readiness", () => {
    const model = deriveFrontSurfaceModel(
      input({
        preanalysis: {
          videoIdentity: { status: "ready", detail: "화면 지문 12/12" },
          transcriptChapters: {
            status: "ready",
            transcriptCount: 2_619,
            chapterCount: 68,
          },
          wholeContext: { status: "idle" },
        },
      }),
    );
    const identity = model.preanalysis.find(
      (lane) => lane.id === "video-identity",
    );
    const transcript = model.preanalysis.find(
      (lane) => lane.id === "transcript-chapters",
    );
    const context = model.preanalysis.find(
      (lane) => lane.id === "whole-context",
    );

    expect(identity).toMatchObject({ state: "ready", detail: "화면 지문 12/12" });
    expect(transcript).toMatchObject({
      state: "ready",
      detail: "대사 2,619개 · 챕터 68개",
      count: 68,
    });
    expect(context?.state).toBe("idle");
    expect(context?.detail).not.toContain("완료");
  });

  it("shows whole context as ready only when it is explicitly ready", () => {
    const model = deriveFrontSurfaceModel(
      input({
        preanalysis: {
          videoIdentity: { status: "ready" },
          transcriptChapters: { status: "ready", chapterCount: 4 },
          wholeContext: { status: "ready", detail: "맥락 seed readback 확인" },
        },
      }),
    );

    expect(
      model.preanalysis.find((lane) => lane.id === "whole-context"),
    ).toMatchObject({ state: "ready", detail: "맥락 seed readback 확인" });
  });

  it("fails closed on impossible ready dependencies", () => {
    const model = deriveFrontSurfaceModel(
      input({
        preanalysis: {
          videoIdentity: { status: "checking" },
          transcriptChapters: {
            status: "ready",
            transcriptCount: -10,
            chapterCount: 0,
          },
          wholeContext: { status: "ready" },
        },
      }),
    );

    expect(model.preanalysis.map((lane) => lane.state)).toEqual([
      "checking",
      "error",
      "error",
    ]);
    expect(model.preanalysis[1]?.count).toBeNull();
    expect(model.preanalysis[2]?.detail).toContain("표시하지 않아요");
  });
});

describe("topic ranges are context, never candidates", () => {
  const topics = [
    {
      id: "later",
      title: "  음식 토크 事件 ",
      summary: "원문 摘要를 그대로 둔다.",
      startMs: 3_600_000,
      endMs: 9_999_999,
      family: "flow-transition" as const,
    },
    {
      id: "early",
      title: "칼국수 이야기",
      summary: "음식 취향을 이야기한다.",
      startMs: -200,
      endMs: 120_000,
      family: "event-reaction" as const,
    },
    {
      id: "invalid-range",
      title: "잘못된 범위",
      summary: "표시하지 않는다.",
      startMs: 500,
      endMs: 500,
    },
    {
      id: "early",
      title: "중복 ID",
      summary: "첫 항목만 유지한다.",
      startMs: 300_000,
      endMs: 400_000,
    },
  ];

  it("hides all topic data before whole-context analysis", () => {
    const model = deriveFrontSurfaceModel(
      input({ pipeline: pipeline({ phase: "fast-pass" }), topics }),
    );

    expect(model.topics).toEqual([]);
    expect(model.topicStatus.state).toBe("hidden");
    expect("candidateCount" in model).toBe(false);
  });

  it("bounds, sorts, and exposes topic ranges without rewriting AI text", () => {
    const model = deriveFrontSurfaceModel(
      input({ pipeline: pipeline({ phase: "broadcast-context" }), topics }),
    );

    expect(model.topicStatus).toMatchObject({ state: "available" });
    expect(model.topics.map((topic) => topic.id)).toEqual(["early", "later"]);
    expect(model.topics[0]).toMatchObject({
      startMs: 0,
      endMs: 120_000,
      startRatio: 0,
    });
    expect(model.topics[1]).toMatchObject({
      title: "  음식 토크 事件 ",
      summary: "원문 摘要를 그대로 둔다.",
      endMs: TWO_HOURS_MS,
      endRatio: 1,
    });
  });

  it("distinguishes context still waiting from a completed zero-topic result", () => {
    const waiting = deriveFrontSurfaceModel(
      input({ pipeline: pipeline({ phase: "broadcast-context" }), topics: [] }),
    );
    const completedEmpty = deriveFrontSurfaceModel(
      input({ pipeline: pipeline({ phase: "candidate-detail" }), topics: [] }),
    );

    expect(waiting.topicStatus.state).toBe("waiting");
    expect(completedEmpty.topicStatus.state).toBe("empty");
    expect(completedEmpty.topics).toEqual([]);
  });

  it("keeps a completed zero-topic context truthful during detail recovery", () => {
    const model = deriveFrontSurfaceModel(
      input({
        pipeline: pipeline({
          status: "failed",
          phase: "candidate-detail",
        }),
        topics: [],
      }),
    );

    expect(model.mode).toBe("recoverable");
    expect(model.topicStatus.state).toBe("empty");
  });
});

describe("input normalization and language", () => {
  it("normalizes invalid source metadata without throwing", () => {
    const model = deriveFrontSurfaceModel(
      input({
        source: {
          title: "   ",
          durationMs: -1,
          sizeBytes: Number.NaN,
          status: "ready",
        },
      }),
    );

    expect(model.mode).toBe("ready");
    expect(model.source).toMatchObject({
      title: "—",
      durationMs: null,
      durationLabel: null,
      sizeBytes: null,
      sizeLabel: null,
    });
  });

  it("renders UI copy in English while preserving supplied evidence text", () => {
    const model = deriveFrontSurfaceModel(
      input({
        language: "en",
        pipeline: pipeline({ phase: "broadcast-context" }),
        preanalysis: {
          videoIdentity: { status: "ready", detail: "화면 지문 12/12" },
          transcriptChapters: {
            status: "ready",
            transcriptCount: 2_619,
            chapterCount: 68,
          },
          wholeContext: { status: "checking" },
        },
        topics: [
          {
            id: "topic",
            title: "원문 제목",
            summary: "원문 설명",
            startMs: 0,
            endMs: 60_000,
          },
        ],
      }),
    );

    expect(model.language).toBe("en");
    expect(model.stage.eyebrow).toBe("Step 2 · Whole context");
    expect(model.preanalysis[0]?.label).toBe("Video identity");
    expect(model.preanalysis[0]?.detail).toBe("화면 지문 12/12");
    expect(model.preanalysis[1]?.detail).toBe(
      "2,619 transcript lines · 68 chapters",
    );
    expect(model.topics[0]).toMatchObject({
      title: "원문 제목",
      summary: "원문 설명",
    });
  });

  it("defaults an invalid runtime language to Korean", () => {
    const model = deriveFrontSurfaceModel(
      input({ language: "ja" as unknown as "ko" }),
    );
    expect(model.language).toBe("ko");
    expect(model.stage.eyebrow).toBe("분석 준비 완료");
  });
});
