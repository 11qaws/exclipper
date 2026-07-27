import { describe, expect, it } from "vitest";

import {
  canStartTranscriptRun,
  transcriptNeedsExplicitRetry,
  transcriptOperationKey,
  transcriptPhaseFor,
} from "./transcriptPhase";

describe("transcriptPhaseFor", () => {
  it("runs the uniform phase while the scan is still working", () => {
    expect(transcriptPhaseFor(false)).toBe("uniform");
  });

  it("runs the event-boost phase once candidates exist", () => {
    expect(transcriptPhaseFor(true)).toBe("event-boost");
  });
});

describe("transcriptOperationKey", () => {
  it("separates phases so completion of one lets the next begin", () => {
    const uniform = transcriptOperationKey("run-1", "fp", "uniform");
    const boost = transcriptOperationKey("run-1", "fp", "event-boost");
    expect(uniform).not.toBe(boost);
  });

  it("never lets a new run inherit a previous run's fence", () => {
    expect(transcriptOperationKey("run-1", "fp", "uniform")).not.toBe(
      transcriptOperationKey("run-2", "fp", "uniform"),
    );
  });

  it("gives an explicit retry a fresh operation fence", () => {
    expect(transcriptOperationKey("run-1", "fp", "uniform", 0)).not.toBe(
      transcriptOperationKey("run-1", "fp", "uniform", 1),
    );
  });
});

describe("canStartTranscriptRun", () => {
  it("starts the uniform phase as soon as the run is live", () => {
    expect(
      canStartTranscriptRun({
        analysisComplete: false,
        analysisRunStatus: "running",
        broadcastTranscriptStatus: "idle",
      }),
    ).toBe(true);
  });

  it("never spends before the user starts the run", () => {
    for (const status of [null, "created", "starting", "paused", "cancelled"]) {
      expect(
        canStartTranscriptRun({
          analysisComplete: false,
          analysisRunStatus: status,
          broadcastTranscriptStatus: "idle",
        }),
      ).toBe(false);
    }
  });

  it("starts the event-boost phase after the scan completes, run status aside", () => {
    expect(
      canStartTranscriptRun({
        analysisComplete: true,
        analysisRunStatus: "completed",
        broadcastTranscriptStatus: "completedWithGaps",
      }),
    ).toBe(true);
  });

  it("keeps recovered sessions working, where no run is live", () => {
    expect(
      canStartTranscriptRun({
        analysisComplete: true,
        analysisRunStatus: null,
        broadcastTranscriptStatus: "idle",
      }),
    ).toBe(true);
  });

  it("never pre-empts a pass that is already transcribing", () => {
    expect(
      canStartTranscriptRun({
        analysisComplete: true,
        analysisRunStatus: "completed",
        broadcastTranscriptStatus: "running",
      }),
    ).toBe(false);
    expect(
      canStartTranscriptRun({
        analysisComplete: false,
        analysisRunStatus: "running",
        broadcastTranscriptStatus: "running",
      }),
    ).toBe(false);
  });
});

describe("transcriptNeedsExplicitRetry", () => {
  it("reopens a completed-with-gaps map so only uncovered chunks can resume", () => {
    expect(transcriptNeedsExplicitRetry("completedWithGaps", 263)).toBe(true);
    expect(transcriptNeedsExplicitRetry("completed", 271)).toBe(false);
  });
});
