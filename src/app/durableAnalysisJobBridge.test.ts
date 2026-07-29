import { afterEach, describe, expect, it, vi } from "vitest";

import { ANALYSIS_STAGES } from "../domain/analysisRun";
import {
  AnalysisResultStoreError,
  InMemoryAnalysisResultStore,
  type AnalysisCompletionDurableSnapshot,
} from "../storage/analysisResultStore";
import { createAnalysisPipelineHappyPathFixture } from "../testSupport/analysisPipelineHappyPathFixture";
import {
  commitDurableAnalysisStage,
  completeDurableAnalysisJob,
  failDurableAnalysisJob,
  pauseDurableAnalysisJob,
  startDurableAnalysisJob,
  type DurableAnalysisJobOperationInput,
} from "./durableAnalysisJobBridge";

const INPUT_SIGNATURE = `sha256:${"a".repeat(64)}`;
const RUN_ID = "run-success-certificate-1";
const POLICY = {
  maximumAttempts: 3,
  mutationTimeoutMs: 50,
  readbackTimeoutMs: 50,
  initialBackoffMs: 2,
  maximumBackoffMs: 4,
} as const;

function operationInput(
  store: InMemoryAnalysisResultStore,
  operationToken: string,
  isCurrent: DurableAnalysisJobOperationInput["isCurrent"] = () => true,
): DurableAnalysisJobOperationInput {
  return {
    store,
    inputSignature: INPUT_SIGNATURE,
    runId: RUN_ID,
    operationToken,
    isCurrent,
    policy: POLICY,
  };
}

async function startedStore(): Promise<InMemoryAnalysisResultStore> {
  const store = new InMemoryAnalysisResultStore();
  const result = await startDurableAnalysisJob({
    ...operationInput(store, "start"),
  });
  if (result.status !== "succeeded") {
    throw new Error(`start failed: ${result.status}`);
  }
  return store;
}

async function fullyCommittedStore(): Promise<InMemoryAnalysisResultStore> {
  const store = await startedStore();
  for (const [index, stage] of ANALYSIS_STAGES.entries()) {
    const result = await commitDurableAnalysisStage({
      ...operationInput(store, `stage-${index}`),
      stage,
    });
    if (result.status !== "succeeded") {
      throw new Error(`${stage} failed: ${result.status}`);
    }
  }
  return store;
}

async function completionSnapshot(): Promise<AnalysisCompletionDurableSnapshot> {
  const fixture = await createAnalysisPipelineHappyPathFixture();
  return {
    manifest: fixture.manifest,
    fastResult: fixture.fastResult,
    fastTerminal: fixture.fastTerminal,
    session: fixture.session,
    candidateRecord: fixture.candidateRecord,
  };
}

async function seedCompletionSnapshot(
  store: InMemoryAnalysisResultStore,
  snapshot: AnalysisCompletionDurableSnapshot,
): Promise<void> {
  await store.putManifest(snapshot.manifest);
  await store.putFinalResult(snapshot.fastResult);
  await store.putTerminalRecord(snapshot.fastTerminal);
  await store.putBroadcastContextSession(snapshot.session);
  if (snapshot.candidateRecord !== null) {
    await store.putCandidatePassBInsights(snapshot.candidateRecord);
  }
}

type CompletionSnapshotRecordName =
  | "manifest"
  | "fastResult"
  | "fastTerminal"
  | "session"
  | "candidateRecord";

function changeCompletionSnapshotRecord(
  snapshot: AnalysisCompletionDurableSnapshot,
  recordName: CompletionSnapshotRecordName,
): AnalysisCompletionDurableSnapshot {
  const changedAt = "2026-07-29T00:00:01.000Z";
  switch (recordName) {
    case "manifest":
      return {
        ...snapshot,
        manifest: { ...snapshot.manifest, recordedAt: changedAt },
      };
    case "fastResult":
      return {
        ...snapshot,
        fastResult: { ...snapshot.fastResult, recordedAt: changedAt },
      };
    case "fastTerminal":
      return {
        ...snapshot,
        fastTerminal: { ...snapshot.fastTerminal, recordedAt: changedAt },
      };
    case "session":
      return {
        ...snapshot,
        session: { ...snapshot.session, recordedAt: changedAt },
      };
    case "candidateRecord":
      if (snapshot.candidateRecord === null) {
        throw new Error("The completion fixture must include candidate detail.");
      }
      return {
        ...snapshot,
        candidateRecord: {
          ...snapshot.candidateRecord,
          recordedAt: changedAt,
        },
      };
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("durable AnalysisJob bridge", () => {
  it("completes the current-only start → ordered stages → usable terminal path", async () => {
    const store = new InMemoryAnalysisResultStore();
    const expectedDurableSnapshot = await completionSnapshot();
    await seedCompletionSnapshot(store, expectedDurableSnapshot);

    const started = await startDurableAnalysisJob({
      ...operationInput(store, "start"),
    });
    expect(started.status).toBe("succeeded");

    for (const [index, stage] of ANALYSIS_STAGES.entries()) {
      const committed = await commitDurableAnalysisStage({
        ...operationInput(store, `stage-${index}`),
        stage,
      });
      expect(committed.status).toBe("succeeded");
      if (committed.status === "succeeded") {
        expect(committed.value.lastCommittedStage).toBe(stage);
      }
    }

    const completed = await completeDurableAnalysisJob({
      ...operationInput(store, "complete"),
      quality: "usable",
      expectedDurableSnapshot,
    });
    expect(completed.status).toBe("succeeded");
    if (completed.status === "succeeded") {
      expect(completed.value.status).toBe("completed");
      expect(completed.value.activeRunId).toBeNull();
    }
  });

  it("supports the valid-empty terminal independently from a pipeline gap", async () => {
    const store = await fullyCommittedStore();
    const expectedDurableSnapshot = await completionSnapshot();
    await seedCompletionSnapshot(store, expectedDurableSnapshot);
    const result = await completeDurableAnalysisJob({
      ...operationInput(store, "complete-empty"),
      quality: "empty",
      expectedDurableSnapshot,
    });

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.value.status).toBe("completedEmpty");
      expect(result.value.quality).toBe("empty");
    }
  });

  it.each<CompletionSnapshotRecordName>([
    "manifest",
    "fastResult",
    "fastTerminal",
    "session",
    "candidateRecord",
  ])(
    "refuses completion when the durable $name changed after certification",
    async (recordName) => {
      const store = await fullyCommittedStore();
      const expectedDurableSnapshot = await completionSnapshot();
      await seedCompletionSnapshot(
        store,
        changeCompletionSnapshotRecord(
          expectedDurableSnapshot,
          recordName,
        ),
      );

      const result = await completeDurableAnalysisJob({
        ...operationInput(store, `complete-changed-${recordName}`),
        quality: "usable",
        expectedDurableSnapshot,
      });

      expect(result).toEqual({
        status: "stale",
        reasonCode: "analysis_job_completion_snapshot_changed",
        attempts: 1,
      });
      expect((await store.listJobs())[0]?.job).toMatchObject({
        status: "running",
        activeRunId: RUN_ID,
      });
    },
  );

  it("recovers a committed atomic completion from a transient mutation outcome", async () => {
    const store = await fullyCommittedStore();
    const expectedDurableSnapshot = await completionSnapshot();
    await seedCompletionSnapshot(store, expectedDurableSnapshot);
    const replace =
      store.replaceJobIfAnalysisSnapshotUnchanged.bind(store);
    let writes = 0;
    vi.spyOn(
      store,
      "replaceJobIfAnalysisSnapshotUnchanged",
    ).mockImplementation(async (...args) => {
      writes += 1;
      const committed = await replace(...args);
      if (writes === 1 && committed) {
        throw new AnalysisResultStoreError(
          "TRANSACTION_FAILED",
          "Simulated lost completion acknowledgement.",
        );
      }
      return committed;
    });

    const result = await completeDurableAnalysisJob({
      ...operationInput(store, "complete-lost-ack"),
      quality: "usable",
      expectedDurableSnapshot,
    });

    expect(result).toMatchObject({
      status: "succeeded",
      attempts: 1,
      recovered: true,
      value: { status: "completed", activeRunId: null },
    });
    expect(writes).toBe(1);
  });

  it("recovers idempotently from already-applied start, stage, pause, and fail writes", async () => {
    const startStore = await startedStore();
    const repeatedStart = await startDurableAnalysisJob({
      ...operationInput(startStore, "start-repeat"),
    });
    expect(repeatedStart).toMatchObject({
      status: "succeeded",
      recovered: true,
    });

    const stageStore = await startedStore();
    await commitDurableAnalysisStage({
      ...operationInput(stageStore, "preflight-first"),
      stage: "preflight",
    });
    const repeatedStage = await commitDurableAnalysisStage({
      ...operationInput(stageStore, "preflight-repeat"),
      stage: "preflight",
    });
    expect(repeatedStage).toMatchObject({
      status: "succeeded",
      recovered: true,
    });

    const pauseStore = await startedStore();
    await pauseDurableAnalysisJob(operationInput(pauseStore, "pause-first"));
    const repeatedPause = await pauseDurableAnalysisJob(
      operationInput(pauseStore, "pause-repeat"),
    );
    expect(repeatedPause).toMatchObject({
      status: "succeeded",
      recovered: true,
    });

    const failStore = await startedStore();
    await failDurableAnalysisJob({
      ...operationInput(failStore, "fail-first"),
      reasonCode: "worker_failed",
    });
    const repeatedFailure = await failDurableAnalysisJob({
      ...operationInput(failStore, "fail-repeat"),
      reasonCode: "worker_failed",
    });
    expect(repeatedFailure).toMatchObject({
      status: "succeeded",
      recovered: true,
    });
  });

  it("accepts an earlier stage only when the durable cursor is already later", async () => {
    const store = await startedStore();
    await commitDurableAnalysisStage({
      ...operationInput(store, "preflight"),
      stage: "preflight",
    });
    await commitDurableAnalysisStage({
      ...operationInput(store, "fast-pass"),
      stage: "fastPass",
    });

    const repeatedEarlierStage = await commitDurableAnalysisStage({
      ...operationInput(store, "preflight-late-repeat"),
      stage: "preflight",
    });

    expect(repeatedEarlierStage).toMatchObject({
      status: "succeeded",
      recovered: true,
      value: { lastCommittedStage: "fastPass" },
    });
  });

  it.each([
    {
      name: "start",
      run: (input: DurableAnalysisJobOperationInput) =>
        startDurableAnalysisJob(input),
    },
    {
      name: "stage",
      run: (input: DurableAnalysisJobOperationInput) =>
        commitDurableAnalysisStage({ ...input, stage: "preflight" }),
    },
    {
      name: "complete",
      run: async (input: DurableAnalysisJobOperationInput) =>
        completeDurableAnalysisJob({
          ...input,
          quality: "empty",
          expectedDurableSnapshot: await completionSnapshot(),
        }),
    },
    {
      name: "pause",
      run: (input: DurableAnalysisJobOperationInput) =>
        pauseDurableAnalysisJob(input),
    },
    {
      name: "fail",
      run: (input: DurableAnalysisJobOperationInput) =>
        failDurableAnalysisJob({ ...input, reasonCode: "failed" }),
    },
  ])(
    "fences $name before storage when runId + operationToken is stale",
    async ({ run }) => {
      const store = new InMemoryAnalysisResultStore();
      const getJob = vi.spyOn(store, "getJob");
      const result = await run(
        operationInput(store, "stale-operation", () => false),
      );

      expect(result).toEqual({
        status: "stale",
        reasonCode: "analysis_mutation_fence_stale",
        attempts: 0,
      });
      expect(getJob).not.toHaveBeenCalled();
    },
  );

  it("rejects a delayed old-run stage even when the caller fence is accidentally permissive", async () => {
    const store = await startedStore();
    await pauseDurableAnalysisJob(operationInput(store, "pause-old"));
    const newRun = await startDurableAnalysisJob({
      ...operationInput(store, "start-new"),
      runId: "run-new",
    });
    expect(newRun.status).toBe("succeeded");

    const staleCommit = await commitDurableAnalysisStage({
      ...operationInput(store, "old-stage"),
      stage: "preflight",
    });

    expect(staleCommit).toEqual({
      status: "stale",
      reasonCode: "analysis_job_run_fence_mismatch",
      attempts: 1,
    });
  });

  it("recovers a stalled bridge write at the same start checkpoint", async () => {
    vi.useFakeTimers();
    const store = new InMemoryAnalysisResultStore();
    const replace = store.replaceJobIfUnchanged.bind(store);
    let writes = 0;
    vi.spyOn(store, "replaceJobIfUnchanged").mockImplementation(
      (expected, replacement) => {
        writes += 1;
        if (writes === 1) {
          return new Promise<boolean>(() => undefined);
        }
        return replace(expected, replacement);
      },
    );

    const pending = startDurableAnalysisJob({
      ...operationInput(store, "start-stalled-write"),
      policy: {
        ...POLICY,
        mutationTimeoutMs: 5,
      },
    });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({
      status: "succeeded",
      attempts: 2,
      recovered: true,
    });
    expect(writes).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers a stalled durable readback without losing the committed start", async () => {
    vi.useFakeTimers();
    const store = new InMemoryAnalysisResultStore();
    const getJob = store.getJob.bind(store);
    let reads = 0;
    vi.spyOn(store, "getJob").mockImplementation((jobId) => {
      reads += 1;
      if (reads === 2) {
        return new Promise(() => undefined);
      }
      return getJob(jobId);
    });

    const pending = startDurableAnalysisJob({
      ...operationInput(store, "start-stalled-readback"),
      policy: {
        ...POLICY,
        readbackTimeoutMs: 5,
      },
    });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({
      status: "succeeded",
      attempts: 2,
      recovered: true,
      value: { status: "running", activeRunId: RUN_ID },
    });
    expect(reads).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry a permanently closed store", async () => {
    const store = new InMemoryAnalysisResultStore();
    store.close();

    const result = await startDurableAnalysisJob({
      ...operationInput(store, "closed-store"),
    });

    expect(result).toEqual({
      status: "permanent-failure",
      reasonCode: "analysis_job_storage_rejected",
      attempts: 1,
    });
  });
});
