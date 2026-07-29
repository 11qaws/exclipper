import { describe, expect, it, vi } from "vitest";

import type { BroadcastContextTranscriptionChunk } from "./broadcastContextSamplingPlan";
import type { BroadcastTranscriptWorkerRunResult } from "./broadcastTranscriptWorkerClient";
import type {
  BroadcastTranscriptChunkAbstention,
  BroadcastTranscriptChunkGap,
} from "./broadcastTranscriptWorkerProtocol";
import {
  MAX_BROADCAST_TRANSCRIPT_FRAGMENT_ATTEMPTS,
  nextTranscriptFragmentManualGeneration,
  recoverBroadcastTranscriptFragments,
  transcriptFragmentQuotaAttemptOrdinal,
  transcriptFragmentQuotaOperationId,
} from "./broadcastTranscriptFragmentRecovery";
import { BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION } from "./broadcastTranscriptQwen";
import { createVerifiedNoSpeechRunReceiptForTest } from "../testSupport/broadcastSpeechActivityTestReceipt";

const chunks: readonly BroadcastContextTranscriptionChunk[] = [
  {
    chunkId: "asr-a",
    sourceStartMs: 0,
    sourceEndMs: 1_000,
    kind: "uniform",
  },
  {
    chunkId: "asr-b",
    sourceStartMs: 1_000,
    sourceEndMs: 2_000,
    kind: "event",
  },
  {
    chunkId: "asr-c",
    sourceStartMs: 2_000,
    sourceEndMs: 3_000,
    kind: "event",
  },
];
const firstChunk = chunks[0];
if (firstChunk === undefined) {
  throw new Error("Transcript recovery fixture is incomplete.");
}

function transcript(
  chunk: BroadcastContextTranscriptionChunk,
): BroadcastTranscriptWorkerRunResult["fragments"][number] {
  return {
    chunkId: chunk.chunkId,
    result: {
      schemaVersion: "1.0.0",
      modelId: "qwen3.5-omni-flash",
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      providerReceipt: {
        schemaVersion: "1.0.0",
        routeManifestFingerprint: `sha256:${"1".repeat(64)}`,
        provider: "qwen",
        modelId: "qwen3.5-omni-flash",
        modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
        fallbackUsed: false,
      },
      sourceStartMs: chunk.sourceStartMs,
      sourceEndMs: chunk.sourceEndMs,
      textKo: `${chunk.chunkId} transcript`,
      detectedLanguage: "ko",
      emotion: null,
      billedSeconds: 1,
    },
  };
}

function attempt(
  requested: readonly BroadcastContextTranscriptionChunk[],
  successfulIds: readonly string[],
  gapReason:
    | "decode-failed"
    | "no-audio"
    | "no-speech"
    | "transcription-failed"
    | "rate-limited"
    | "outcome-unknown",
): BroadcastTranscriptWorkerRunResult {
  const success = new Set(successfulIds);
  const fragments = requested
    .filter(({ chunkId }) => success.has(chunkId))
    .map(transcript);
  const unresolvedChunks = requested.filter(
    ({ chunkId }) => !success.has(chunkId),
  );
  const abstentions: readonly BroadcastTranscriptChunkAbstention[] =
    gapReason === "no-audio" || gapReason === "no-speech"
      ? unresolvedChunks.map((chunk) =>
          gapReason === "no-audio"
            ? {
                chunkId: chunk.chunkId,
                reason: gapReason,
                speechActivityReceipt: null,
              }
            : {
                chunkId: chunk.chunkId,
                reason: gapReason,
                speechActivityReceipt:
                  createVerifiedNoSpeechRunReceiptForTest(
                    3_000,
                    chunk.sourceStartMs,
                    chunk.sourceEndMs,
                  ),
              },
        )
      : [];
  const gaps: readonly BroadcastTranscriptChunkGap[] =
    gapReason === "no-audio" || gapReason === "no-speech"
      ? []
      : unresolvedChunks.map(({ chunkId }) => ({
          chunkId,
          reason: gapReason,
        }));
  return {
    fragments,
    results: fragments.map(({ result }) => result),
    abstentions,
    abstainedChunkIds: abstentions.map(({ chunkId }) => chunkId),
    gaps,
    gapChunkIds: gaps.map(({ chunkId }) => chunkId),
    requestedCount: requested.length,
    concurrencyOutcome: "concurrency 2",
  };
}

describe("recoverBroadcastTranscriptFragments", () => {
  it("preserves successes and retries only the failed fragment", async () => {
    const calls: string[][] = [];
    const runAttempt = vi.fn(
      (
        requested: readonly BroadcastContextTranscriptionChunk[],
        _ordinal: number,
        attemptIndex: number,
      ) => {
        calls.push(requested.map(({ chunkId }) => chunkId));
        return Promise.resolve(
          attempt(
            requested,
            attemptIndex === 0 ? ["asr-a", "asr-c"] : ["asr-b"],
            "transcription-failed",
          ),
        );
      },
    );

    const result = await recoverBroadcastTranscriptFragments({
      chunks,
      manualAttemptGeneration: 11,
      runAttempt,
      wait: vi.fn(() => Promise.resolve()),
    });

    expect(calls).toEqual([
      ["asr-a", "asr-b", "asr-c"],
      ["asr-b"],
    ]);
    expect(result.fragments.map(({ chunkId }) => chunkId)).toEqual([
      "asr-a",
      "asr-b",
      "asr-c",
    ]);
    expect(result.unresolvedRetryableGaps).toEqual([]);
    expect(result.attemptedCount).toBe(2);
  });

  it("uses all bounded attempts and reports an unresolved safe failure", async () => {
    const runAttempt = vi.fn(
      (requested: readonly BroadcastContextTranscriptionChunk[]) =>
        Promise.resolve(attempt(requested, [], "rate-limited")),
    );

    const result = await recoverBroadcastTranscriptFragments({
      chunks: [firstChunk],
      manualAttemptGeneration: 2,
      runAttempt,
      wait: vi.fn(() => Promise.resolve()),
    });

    expect(runAttempt).toHaveBeenCalledTimes(
      MAX_BROADCAST_TRANSCRIPT_FRAGMENT_ATTEMPTS,
    );
    expect(result.fragments).toEqual([]);
    expect(result.unresolvedRetryableGaps).toEqual([
      { chunkId: "asr-a", reason: "rate-limited" },
    ]);
  });

  it("treats no-audio as resolved evidence instead of retrying it", async () => {
    const runAttempt = vi.fn(
      (requested: readonly BroadcastContextTranscriptionChunk[]) =>
        Promise.resolve(attempt(requested, [], "no-audio")),
    );

    const result = await recoverBroadcastTranscriptFragments({
      chunks: [firstChunk],
      manualAttemptGeneration: 0,
      runAttempt,
    });

    expect(runAttempt).toHaveBeenCalledTimes(1);
    expect(result.noAudioGaps).toEqual([
      {
        chunkId: "asr-a",
        reason: "no-audio",
        speechActivityReceipt: null,
      },
    ]);
    expect(result.resolvedAbstentions).toEqual([
      {
        chunkId: "asr-a",
        reason: "no-audio",
        speechActivityReceipt: null,
      },
    ]);
    expect(result.unresolvedRetryableGaps).toEqual([]);
  });

  it("normalizes a legacy 1.6 no-audio gap into a resolved abstention", async () => {
    const runAttempt = vi.fn(
      (
        requested: readonly BroadcastContextTranscriptionChunk[],
      ): Promise<BroadcastTranscriptWorkerRunResult> =>
        Promise.resolve({
          fragments: [],
          results: [],
          abstentions: [],
          abstainedChunkIds: [],
          gaps: requested.map(({ chunkId }) => ({
            chunkId,
            reason: "no-audio" as const,
          })),
          gapChunkIds: requested.map(({ chunkId }) => chunkId),
          requestedCount: requested.length,
          concurrencyOutcome: "legacy 1.6",
        }),
    );

    const result = await recoverBroadcastTranscriptFragments({
      chunks: [firstChunk],
      manualAttemptGeneration: 0,
      runAttempt,
    });

    expect(runAttempt).toHaveBeenCalledTimes(1);
    expect(result.resolvedAbstentions).toEqual([
      {
        chunkId: "asr-a",
        reason: "no-audio",
        speechActivityReceipt: null,
      },
    ]);
    expect(result.unresolvedRetryableGaps).toEqual([]);
  });

  it("treats confirmed no-speech as a resolved abstention instead of retrying it", async () => {
    const runAttempt = vi.fn(
      (requested: readonly BroadcastContextTranscriptionChunk[]) =>
        Promise.resolve(attempt(requested, [], "no-speech")),
    );

    const result = await recoverBroadcastTranscriptFragments({
      chunks: [firstChunk],
      manualAttemptGeneration: 0,
      runAttempt,
    });

    expect(runAttempt).toHaveBeenCalledTimes(1);
    expect(result.noSpeechAbstentions).toEqual([
      expect.objectContaining({ chunkId: "asr-a", reason: "no-speech" }),
    ]);
    expect(result.resolvedAbstentions).toEqual([
      expect.objectContaining({ chunkId: "asr-a", reason: "no-speech" }),
    ]);
    expect(result.noAudioGaps).toEqual([]);
    expect(result.unresolvedRetryableGaps).toEqual([]);
    expect(result.outcomeUnknownGaps).toEqual([]);
  });

  it("never blindly retries an outcome-unknown request", async () => {
    const runAttempt = vi.fn(
      (requested: readonly BroadcastContextTranscriptionChunk[]) =>
        Promise.resolve(attempt(requested, [], "outcome-unknown")),
    );

    const result = await recoverBroadcastTranscriptFragments({
      chunks: [firstChunk],
      manualAttemptGeneration: 0,
      runAttempt,
    });

    expect(runAttempt).toHaveBeenCalledTimes(1);
    expect(result.outcomeUnknownGaps).toEqual([
      { chunkId: "asr-a", reason: "outcome-unknown" },
    ]);
  });

  it("awaits durable start and settlement hooks around every worker attempt", async () => {
    const events: string[] = [];
    const result = await recoverBroadcastTranscriptFragments({
      chunks: [firstChunk],
      manualAttemptGeneration: 3,
      onAttemptStarting: async (requested, quotaAttemptOrdinal, attemptIndex) => {
        await Promise.resolve();
        events.push(
          `start:${attemptIndex}:${quotaAttemptOrdinal}:${requested[0]?.chunkId}`,
        );
      },
      runAttempt: (requested, quotaAttemptOrdinal, attemptIndex) => {
        events.push(
          `run:${attemptIndex}:${quotaAttemptOrdinal}:${requested[0]?.chunkId}`,
        );
        return Promise.resolve(
          attempt(requested, ["asr-a"], "transcription-failed"),
        );
      },
      onAttemptSettled: async (
        settled,
        quotaAttemptOrdinal,
        attemptIndex,
      ) => {
        await Promise.resolve();
        events.push(
          `settle:${attemptIndex}:${quotaAttemptOrdinal}:${settled.fragments[0]?.chunkId}`,
        );
      },
    });

    expect(result.fragments.map(({ chunkId }) => chunkId)).toEqual(["asr-a"]);
    expect(events).toEqual([
      "start:0:12:asr-a",
      "run:0:12:asr-a",
      "settle:0:12:asr-a",
    ]);
  });

  it("keeps automatic repair and later manual attempts in disjoint quota generations", () => {
    const firstGeneration = Array.from(
      { length: MAX_BROADCAST_TRANSCRIPT_FRAGMENT_ATTEMPTS },
      (_, attemptIndex) =>
        transcriptFragmentQuotaAttemptOrdinal(7, attemptIndex),
    );
    const nextGeneration = Array.from(
      { length: MAX_BROADCAST_TRANSCRIPT_FRAGMENT_ATTEMPTS },
      (_, attemptIndex) =>
        transcriptFragmentQuotaAttemptOrdinal(8, attemptIndex),
    );

    expect(new Set([...firstGeneration, ...nextGeneration]).size).toBe(6);
    expect(Math.max(...firstGeneration)).toBeLessThan(
      Math.min(...nextGeneration),
    );
  });

  it("moves a reload beyond every durable terminal attempt", () => {
    expect(nextTranscriptFragmentManualGeneration([])).toBe(0);
    expect(nextTranscriptFragmentManualGeneration([1])).toBe(1);
    expect(nextTranscriptFragmentManualGeneration([3])).toBe(1);
    expect(nextTranscriptFragmentManualGeneration([5, 7])).toBe(2);
    expect(
      transcriptFragmentQuotaAttemptOrdinal(
        nextTranscriptFragmentManualGeneration([7]),
        0,
      ),
    ).toBe(8);
  });

  it("names phases, refinement, and retry generations separately", () => {
    const chunkId = "asr-0-1xg";
    expect(transcriptFragmentQuotaOperationId("uniform", 0, chunkId)).not.toBe(
      transcriptFragmentQuotaOperationId("event-boost", 0, chunkId),
    );
    expect(
      transcriptFragmentQuotaOperationId("event-boost", 4, chunkId),
    ).not.toBe(
      transcriptFragmentQuotaOperationId("event-boost", 0, chunkId),
    );
    expect(
      transcriptFragmentQuotaOperationId("refinement", 0, chunkId),
    ).not.toBe(
      transcriptFragmentQuotaOperationId("event-boost", 0, chunkId),
    );
    expect(
      transcriptFragmentQuotaOperationId(
        "refinement",
        0,
        chunkId,
        "inputscope00000001",
      ),
    ).not.toBe(
      transcriptFragmentQuotaOperationId(
        "refinement",
        0,
        chunkId,
        "inputscope00000002",
      ),
    );
  });
});
