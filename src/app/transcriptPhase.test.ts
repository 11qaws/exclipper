import { describe, expect, it } from "vitest";

import {
  canStartTranscriptRun,
  createTranscriptSourceIdentityFence,
  transcriptGapRequiresExplicitBillingRetry,
  transcriptContextReadiness,
  transcriptIsSealedForContext,
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

  it("keeps the exact source seal stable across retry generations", () => {
    expect(transcriptOperationKey("run-1", "fp", "uniform", 0)).toBe(
      transcriptOperationKey("run-1", "fp", "uniform", 1),
    );
  });

  it("fences a transcript seal to the resolved source roster", () => {
    const unresolved = transcriptOperationKey(
      "run-1",
      "fp",
      "uniform",
      0,
      "cast-none",
    );
    const resolved = transcriptOperationKey(
      "run-1",
      "fp",
      "uniform",
      0,
      "cast-amoretto-v1",
    );
    expect(unresolved).not.toBe(resolved);
    expect(resolved).toContain("identity-cast-amoretto-v1");
  });

  it("rejects an invalid source identity fence", () => {
    expect(() =>
      transcriptOperationKey("run-1", "fp", "uniform", 0, "bad\r\nfence"),
    ).toThrow(/identity fence/u);
  });

  it("hashes long descriptive identities before they enter the bounded key", async () => {
    const descriptiveIdentity = [
      "cast-exchange-student-six-person-roster-v2",
      "qwen3.5-omni-flash-audio-transcript-90s-reviewed-2026-07-22",
      "worker-1.9.0",
      "vad-733a93b6473d019a773298e08cefa686894b1854",
      "speech-presence-v1",
      `route-${"a".repeat(71)}`,
    ];
    expect(descriptiveIdentity.join(":").length).toBeGreaterThan(160);

    const fence = await createTranscriptSourceIdentityFence(
      descriptiveIdentity,
    );
    expect(fence.length).toBeLessThanOrEqual(160);
    expect(() =>
      transcriptOperationKey("run-1", "fp", "uniform", 0, fence),
    ).not.toThrow();
  });

  it("changes the compact fence when any exact route identity changes", async () => {
    const primary = await createTranscriptSourceIdentityFence([
      "source-policy",
      "route-a",
    ]);
    const fallback = await createTranscriptSourceIdentityFence([
      "source-policy",
      "route-b",
    ]);
    expect(primary).not.toBe(fallback);
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
    expect(transcriptNeedsExplicitRetry("completed", 0)).toBe(false);
  });
});

describe("transcriptGapRequiresExplicitBillingRetry", () => {
  it("blocks automatic rebilling after an ambiguous or interrupted paid request", () => {
    expect(
      transcriptGapRequiresExplicitBillingRetry("outcome-unknown", 1),
    ).toBe(true);
    expect(transcriptGapRequiresExplicitBillingRetry("in-flight", 5)).toBe(
      true,
    );
    expect(transcriptGapRequiresExplicitBillingRetry("pending", 0)).toBe(
      false,
    );
    expect(
      transcriptGapRequiresExplicitBillingRetry("transcription-failed", 3),
    ).toBe(false);
  });
});

describe("transcriptIsSealedForContext", () => {
  const eventBoostKey = transcriptOperationKey(
    "run-1",
    "fp",
    "event-boost",
    4,
  );

  it("blocks the context effect while only the earlier uniform phase is complete", () => {
    expect(
      transcriptIsSealedForContext({
        analysisComplete: true,
        broadcastTranscriptStatus: "completed",
        completedChapterCount: 20,
        requiredEventBoostOperationKey: eventBoostKey,
        sealedOperationKey: transcriptOperationKey(
          "run-1",
          "fp",
          "uniform",
          4,
        ),
      }),
    ).toBe(false);
  });

  it("blocks legacy completed-with-gaps maps", () => {
    expect(
      transcriptIsSealedForContext({
        analysisComplete: true,
        broadcastTranscriptStatus: "completedWithGaps",
        completedChapterCount: 20,
        requiredEventBoostOperationKey: eventBoostKey,
        sealedOperationKey: eventBoostKey,
      }),
    ).toBe(false);
  });

  it("allows context only after the final event-boost map is sealed", () => {
    expect(
      transcriptIsSealedForContext({
        analysisComplete: true,
        broadcastTranscriptStatus: "completed",
        completedChapterCount: 20,
        requiredEventBoostOperationKey: eventBoostKey,
        sealedOperationKey: eventBoostKey,
      }),
    ).toBe(true);
  });

  it("routes an exact sealed zero-dialogue map to visual evidence instead of retranscription", () => {
    const input = {
      analysisComplete: true,
      broadcastTranscriptStatus: "completed",
      completedChapterCount: 0,
      requiredEventBoostOperationKey: eventBoostKey,
      sealedOperationKey: eventBoostKey,
    };

    expect(transcriptContextReadiness(input)).toBe(
      "visual-evidence-required",
    );
    expect(transcriptIsSealedForContext(input)).toBe(false);
  });

  it("does not mistake an unsealed empty map for visual evidence work", () => {
    expect(
      transcriptContextReadiness({
        analysisComplete: true,
        broadcastTranscriptStatus: "completed",
        completedChapterCount: 0,
        requiredEventBoostOperationKey: eventBoostKey,
        sealedOperationKey: null,
      }),
    ).toBe("not-ready");
  });
});
