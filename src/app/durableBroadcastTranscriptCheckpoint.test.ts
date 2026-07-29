import { describe, expect, it, vi } from "vitest";

import { InMemoryAnalysisResultStore } from "../storage/analysisResultStore";
import type { BroadcastContextSessionRecord } from "../storage/broadcastContextSessionStore";
import { createAnalysisPipelineHappyPathFixture } from "../testSupport/analysisPipelineHappyPathFixture";
import { commitDurableBroadcastTranscriptCheckpoint } from "./durableBroadcastTranscriptCheckpoint";

async function session(): Promise<BroadcastContextSessionRecord> {
  return (await createAnalysisPipelineHappyPathFixture()).session;
}

const noWait = {
  maximumAttempts: 3,
  initialBackoffMs: 0,
  maximumBackoffMs: 0,
} as const;

describe("commitDurableBroadcastTranscriptCheckpoint", () => {
  it("inserts the first session without overwriting another exact run", async () => {
    const store = new InMemoryAnalysisResultStore();
    const replacement = await session();

    await expect(
      commitDurableBroadcastTranscriptCheckpoint({
        store,
        expected: null,
        replacement,
        policy: noWait,
      }),
    ).resolves.toEqual(replacement);
    await expect(
      commitDurableBroadcastTranscriptCheckpoint({
        store,
        expected: null,
        replacement: {
          ...replacement,
          recordedAt: "2026-07-29T00:00:01.000Z",
        },
        policy: noWait,
      }),
    ).rejects.toThrow(/newer durable transcript checkpoint/u);
  });

  it("recovers when the atomic insert commits and its acknowledgement is lost", async () => {
    const base = new InMemoryAnalysisResultStore();
    const replacement = await session();
    const insert = vi.fn(async (record: BroadcastContextSessionRecord) => {
      await base.insertBroadcastContextSessionIfAbsent(record);
      throw new Error("completion event lost");
    });

    await expect(
      commitDurableBroadcastTranscriptCheckpoint({
        store: {
          insertBroadcastContextSessionIfAbsent: insert,
          replaceBroadcastContextSessionIfUnchanged: (expected, next) =>
            base.replaceBroadcastContextSessionIfUnchanged(expected, next),
          getBroadcastContextSession: (runId) =>
            base.getBroadcastContextSession(runId),
        },
        expected: null,
        replacement,
        policy: noWait,
      }),
    ).resolves.toEqual(replacement);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("uses readback only after a successful compare-and-swap", async () => {
    const base = new InMemoryAnalysisResultStore();
    const expected = await session();
    await base.insertBroadcastContextSessionIfAbsent(expected);
    const replacement = {
      ...expected,
      recordedAt: "2026-07-29T00:00:02.000Z",
    };
    let readCount = 0;
    const replace = vi.fn((current: BroadcastContextSessionRecord, next: BroadcastContextSessionRecord) =>
      base.replaceBroadcastContextSessionIfUnchanged(current, next),
    );

    await expect(
      commitDurableBroadcastTranscriptCheckpoint({
        store: {
          insertBroadcastContextSessionIfAbsent: (record) =>
            base.insertBroadcastContextSessionIfAbsent(record),
          replaceBroadcastContextSessionIfUnchanged: replace,
          getBroadcastContextSession: async (runId) => {
            readCount += 1;
            if (readCount < 3) throw new Error("temporary read failure");
            return base.getBroadcastContextSession(runId);
          },
        },
        expected,
        replacement,
        policy: noWait,
      }),
    ).resolves.toEqual(replacement);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("rebases the next cumulative checkpoint after a committed write lost every readback", async () => {
    const base = new InMemoryAnalysisResultStore();
    const expected = await session();
    await base.insertBroadcastContextSessionIfAbsent(expected);
    const firstReplacement = {
      ...expected,
      recordedAt: "2026-07-29T00:00:03.000Z",
    };
    let readAvailable = false;
    const store = {
      insertBroadcastContextSessionIfAbsent: (record: BroadcastContextSessionRecord) =>
        base.insertBroadcastContextSessionIfAbsent(record),
      replaceBroadcastContextSessionIfUnchanged: (
        current: BroadcastContextSessionRecord,
        next: BroadcastContextSessionRecord,
      ) => base.replaceBroadcastContextSessionIfUnchanged(current, next),
      getBroadcastContextSession: (runId: string) => {
        if (!readAvailable) {
          return Promise.reject(new Error("readback unavailable"));
        }
        return base.getBroadcastContextSession(runId);
      },
    };

    await expect(
      commitDurableBroadcastTranscriptCheckpoint({
        store,
        expected,
        replacement: firstReplacement,
        policy: { ...noWait, maximumAttempts: 2 },
      }),
    ).rejects.toThrow(/readback stayed unavailable/u);

    readAvailable = true;
    const secondReplacement = {
      ...expected,
      recordedAt: "2026-07-29T00:00:04.000Z",
    };
    await expect(
      commitDurableBroadcastTranscriptCheckpoint({
        store,
        expected,
        replacement: secondReplacement,
        rebaseReplacement: (current, pending) => ({
          ...current,
          recordedAt: pending.recordedAt,
        }),
        policy: noWait,
      }),
    ).resolves.toMatchObject({
      recordedAt: secondReplacement.recordedAt,
    });
  });
});
