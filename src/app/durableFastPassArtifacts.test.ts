import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AnalysisResultStoreError,
  InMemoryAnalysisResultStore,
  type AnalysisManifestRecord,
  type AnalysisTerminalRecord,
  type FinalAnalysisResultRecord,
} from "../storage/analysisResultStore";
import { createAnalysisPipelineHappyPathFixture } from "../testSupport/analysisPipelineHappyPathFixture";
import {
  commitDurableFastPassManifest,
  commitDurableFastPassResult,
  type DurableFastPassArtifactStore,
} from "./durableFastPassArtifacts";

const operation = {
  runId: "run-success-certificate-1",
  operationToken: "fast-pass-publication-1",
  isCurrent: () => true,
} as const;

const smallPolicy = {
  maximumAttempts: 3,
  mutationTimeoutMs: 40,
  readbackTimeoutMs: 40,
  initialBackoffMs: 5,
  maximumBackoffMs: 10,
} as const;

function clone<Record>(record: Record): Record {
  return JSON.parse(JSON.stringify(record)) as Record;
}

async function records(): Promise<{
  readonly manifest: AnalysisManifestRecord;
  readonly finalResult: FinalAnalysisResultRecord;
  readonly terminal: AnalysisTerminalRecord;
}> {
  const fixture = await createAnalysisPipelineHappyPathFixture();
  return {
    manifest: fixture.manifest,
    finalResult: fixture.fastResult,
    terminal: fixture.fastTerminal,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("commitDurableFastPassManifest", () => {
  it("captures one stable snapshot and publishes only after exact readback", async () => {
    const store = new InMemoryAnalysisResultStore();
    const { manifest } = await records();
    const expected = clone(manifest);
    const mutable = clone(manifest) as unknown as {
      recordedAt: string;
      result: { signalGapPolicy: { policyId: string } };
    };

    const pending = commitDurableFastPassManifest({
      store,
      ...operation,
      manifest: mutable as unknown as AnalysisManifestRecord,
      policy: smallPolicy,
    });
    mutable.recordedAt = "2099-01-01T00:00:00.000Z";
    mutable.result.signalGapPolicy.policyId = "mutated-after-start";

    await expect(pending).resolves.toMatchObject({
      status: "succeeded",
      attempts: 1,
    });
    await expect(store.getManifest(operation.runId)).resolves.toEqual(
      expected,
    );
  });

  it("returns stale before touching storage when the run/token fence is stale", async () => {
    const store = new InMemoryAnalysisResultStore();
    const insert = vi.spyOn(store, "insertManifestIfAbsent");
    const { manifest } = await records();

    await expect(
      commitDurableFastPassManifest({
        store,
        runId: operation.runId,
        operationToken: "old-operation",
        isCurrent: () => false,
        manifest,
        policy: smallPolicy,
      }),
    ).resolves.toEqual({
      status: "stale",
      reasonCode: "analysis_mutation_fence_stale",
      attempts: 0,
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("keeps the first manifest when another writer races with different evidence", async () => {
    const store = new InMemoryAnalysisResultStore();
    const { manifest } = await records();
    const first = {
      ...manifest,
      artifactId: "first-manifest",
    };
    await store.insertManifestIfAbsent(first);

    await expect(
      commitDurableFastPassManifest({
        store,
        ...operation,
        manifest,
        policy: smallPolicy,
      }),
    ).resolves.toMatchObject({
      status: "permanent-failure",
      reasonCode: "fast_pass_manifest_conflict",
    });
    await expect(store.getManifest(operation.runId)).resolves.toEqual(first);
  });
});

describe("commitDurableFastPassResult", () => {
  it("commits manifest, final, and terminal through one atomic bundle boundary", async () => {
    const store = new InMemoryAnalysisResultStore();
    const { manifest, finalResult, terminal } = await records();
    const events: string[] = [];
    const commitBundle = vi
      .spyOn(store, "commitFastPassResultBundleIfAbsent")
      .mockImplementation(async (bundle) => {
        events.push("commit-bundle");
        return InMemoryAnalysisResultStore.prototype.commitFastPassResultBundleIfAbsent.call(
          store,
          bundle,
        );
      });

    const result = await commitDurableFastPassResult({
      store,
      ...operation,
      manifest,
      finalResult,
      terminal,
      policy: smallPolicy,
    });

    expect(result).toMatchObject({
      status: "succeeded",
      value: {
        recovered: false,
        attempts: {
          manifest: 1,
          finalResult: 1,
          terminal: 1,
          bundleReadback: 1,
        },
      },
    });
    expect(events).toEqual(["commit-bundle"]);
    expect(commitBundle).toHaveBeenCalledOnce();
    await expect(store.getManifest(operation.runId)).resolves.toEqual(
      manifest,
    );
    await expect(store.getFinalResult(operation.runId)).resolves.toEqual(
      finalResult,
    );
    await expect(store.getTerminalRecord(operation.runId)).resolves.toEqual(
      terminal,
    );
  });

  it("treats an identical duplicate as idempotent without issuing another write", async () => {
    const store = new InMemoryAnalysisResultStore();
    const { manifest, finalResult, terminal } = await records();
    await store.putManifest(manifest);
    await store.putFinalResult(finalResult);
    await store.putTerminalRecord(terminal);
    const putManifest = vi.spyOn(store, "putManifest");
    const putFinal = vi.spyOn(store, "putFinalResult");
    const putTerminal = vi.spyOn(store, "putTerminalRecord");
    const commitBundle = vi.spyOn(
      store,
      "commitFastPassResultBundleIfAbsent",
    );

    await expect(
      commitDurableFastPassResult({
        store,
        ...operation,
        manifest,
        finalResult,
        terminal,
        policy: smallPolicy,
      }),
    ).resolves.toMatchObject({ status: "succeeded" });
    expect(putManifest).not.toHaveBeenCalled();
    expect(putFinal).not.toHaveBeenCalled();
    expect(putTerminal).not.toHaveBeenCalled();
    expect(commitBundle).toHaveBeenCalledOnce();
  });

  it("does not let a late stale writer overwrite a newer atomic final and terminal bundle", async () => {
    const baseStore = new InMemoryAnalysisResultStore();
    const { manifest, finalResult, terminal } = await records();
    const staleFinal = {
      ...finalResult,
      artifactId: "stale-final-result",
    };
    const staleTerminal = {
      ...terminal,
      resultArtifactId: staleFinal.artifactId,
    };
    let staleCurrent = true;
    let releaseStaleBundle!: () => void;
    let markStaleBundleEntered!: () => void;
    const staleBundleGate = new Promise<void>((resolve) => {
      releaseStaleBundle = resolve;
    });
    const staleBundleEntered = new Promise<void>((resolve) => {
      markStaleBundleEntered = resolve;
    });
    const commitBundle = vi.fn(
      async (bundle: {
        readonly manifest: AnalysisManifestRecord;
        readonly finalResult: FinalAnalysisResultRecord;
        readonly terminal: AnalysisTerminalRecord;
      }) => {
        if (bundle.finalResult.artifactId === staleFinal.artifactId) {
          markStaleBundleEntered();
          await staleBundleGate;
        }
        return baseStore.commitFastPassResultBundleIfAbsent(bundle);
      },
    );
    const store: DurableFastPassArtifactStore = {
      insertManifestIfAbsent: (record) =>
        baseStore.insertManifestIfAbsent(record),
      getManifest: (runId) => baseStore.getManifest(runId),
      getFinalResult: (runId) => baseStore.getFinalResult(runId),
      getTerminalRecord: (runId) => baseStore.getTerminalRecord(runId),
      commitFastPassResultBundleIfAbsent: commitBundle,
    };

    const staleCommit = commitDurableFastPassResult({
      store,
      runId: operation.runId,
      operationToken: "stale-fast-pass",
      isCurrent: () => staleCurrent,
      manifest,
      finalResult: staleFinal,
      terminal: staleTerminal,
      policy: smallPolicy,
    });
    await staleBundleEntered;

    await expect(
      commitDurableFastPassResult({
        store,
        runId: operation.runId,
        operationToken: "current-fast-pass",
        isCurrent: () => true,
        manifest,
        finalResult,
        terminal,
        policy: smallPolicy,
      }),
    ).resolves.toMatchObject({ status: "succeeded" });

    staleCurrent = false;
    releaseStaleBundle();
    await expect(staleCommit).resolves.toMatchObject({ status: "stale" });
    await expect(baseStore.getFinalResult(operation.runId)).resolves.toEqual(
      finalResult,
    );
    await expect(baseStore.getTerminalRecord(operation.runId)).resolves.toEqual(
      terminal,
    );
    expect(commitBundle).toHaveBeenCalledTimes(2);
  });

  it("recovers a write timeout from exact readback without duplicating the final write", async () => {
    vi.useFakeTimers();
    const { manifest, finalResult, terminal } = await records();
    let storedManifest: AnalysisManifestRecord | null = clone(manifest);
    let storedFinal: FinalAnalysisResultRecord | null = null;
    let storedTerminal: AnalysisTerminalRecord | null = null;
    const commitBundle = vi.fn((bundle: {
      readonly manifest: AnalysisManifestRecord;
      readonly finalResult: FinalAnalysisResultRecord;
      readonly terminal: AnalysisTerminalRecord;
    }) => {
      storedManifest = clone(bundle.manifest);
      storedFinal = clone(bundle.finalResult);
      storedTerminal = clone(bundle.terminal);
      return new Promise<boolean>(() => {
        // The transaction committed, but its completion signal was lost.
      });
    });
    const store: DurableFastPassArtifactStore = {
      insertManifestIfAbsent: vi.fn((record: AnalysisManifestRecord) => {
        storedManifest = clone(record);
        return Promise.resolve(true);
      }),
      getManifest: vi.fn(() => Promise.resolve(clone(storedManifest))),
      getFinalResult: vi.fn(() => Promise.resolve(clone(storedFinal))),
      getTerminalRecord: vi.fn(() => Promise.resolve(clone(storedTerminal))),
      commitFastPassResultBundleIfAbsent: commitBundle,
    };

    const pending = commitDurableFastPassResult({
      store,
      ...operation,
      manifest,
      finalResult,
      terminal,
      policy: {
        ...smallPolicy,
        mutationTimeoutMs: 20,
      },
    });
    await vi.advanceTimersByTimeAsync(20);

    const result = await pending;
    expect(result).toMatchObject({
      status: "succeeded",
      value: { recovered: true },
    });
    expect(commitBundle).toHaveBeenCalledOnce();
    expect(storedFinal).toEqual(finalResult);
    expect(storedTerminal).toEqual(terminal);
  });

  it("does not write final evidence when a conflicting terminal already owns the run", async () => {
    const store = new InMemoryAnalysisResultStore();
    const { manifest, finalResult, terminal } = await records();
    await store.putManifest(manifest);
    await store.putTerminalRecord({
      ...terminal,
      outcome: "failed",
      resultRecordKind: "failure",
      resultArtifactId: "failure-owned-run",
    });
    const putFinal = vi.spyOn(store, "putFinalResult");

    await expect(
      commitDurableFastPassResult({
        store,
        ...operation,
        manifest,
        finalResult,
        terminal,
        policy: smallPolicy,
      }),
    ).resolves.toEqual({
      status: "permanent-failure",
      artifact: "terminal",
      reasonCode: "fast_pass_terminal_conflict",
      attempts: 1,
    });
    expect(putFinal).not.toHaveBeenCalled();
  });

  it("stops at a conflicting final readback and never creates a terminal", async () => {
    const store = new InMemoryAnalysisResultStore();
    const { manifest, finalResult, terminal } = await records();
    await store.putManifest(manifest);
    await store.putFinalResult({
      ...finalResult,
      artifactId: "another-final",
    });
    const putTerminal = vi.spyOn(store, "putTerminalRecord");

    await expect(
      commitDurableFastPassResult({
        store,
        ...operation,
        manifest,
        finalResult,
        terminal,
        policy: smallPolicy,
      }),
    ).resolves.toEqual({
      status: "permanent-failure",
      artifact: "finalResult",
      reasonCode: "fast_pass_finalResult_conflict",
      attempts: 1,
    });
    expect(putTerminal).not.toHaveBeenCalled();
  });

  it("recovers a transient transaction rejection when the write actually committed", async () => {
    const { manifest, finalResult, terminal } = await records();
    let storedManifest: AnalysisManifestRecord | null = clone(manifest);
    let storedFinal: FinalAnalysisResultRecord | null = null;
    let storedTerminal: AnalysisTerminalRecord | null = null;
    const commitBundle = vi.fn((bundle: {
      readonly manifest: AnalysisManifestRecord;
      readonly finalResult: FinalAnalysisResultRecord;
      readonly terminal: AnalysisTerminalRecord;
    }) => {
      storedManifest = clone(bundle.manifest);
      storedFinal = clone(bundle.finalResult);
      storedTerminal = clone(bundle.terminal);
      return Promise.reject(
        new AnalysisResultStoreError(
          "TRANSACTION_FAILED",
          "completion event was lost",
        ),
      );
    });
    const store: DurableFastPassArtifactStore = {
      insertManifestIfAbsent: vi.fn((record: AnalysisManifestRecord) => {
        storedManifest = clone(record);
        return Promise.resolve(true);
      }),
      getManifest: vi.fn(() => Promise.resolve(clone(storedManifest))),
      getFinalResult: vi.fn(() => Promise.resolve(clone(storedFinal))),
      getTerminalRecord: vi.fn(() => Promise.resolve(clone(storedTerminal))),
      commitFastPassResultBundleIfAbsent: commitBundle,
    };

    const result = await commitDurableFastPassResult({
      store,
      ...operation,
      manifest,
      finalResult,
      terminal,
      policy: smallPolicy,
    });

    expect(result).toMatchObject({
      status: "succeeded",
      value: { recovered: true },
    });
    expect(commitBundle).toHaveBeenCalledOnce();
  });

  it("reports a conflict as stale when the operation fence changed during inspection", async () => {
    const baseStore = new InMemoryAnalysisResultStore();
    const { manifest, finalResult, terminal } = await records();
    await baseStore.putManifest(manifest);
    await baseStore.putFinalResult({
      ...finalResult,
      artifactId: "newer-final",
    });
    let current = true;
    const store: DurableFastPassArtifactStore = {
      insertManifestIfAbsent: (record) =>
        baseStore.insertManifestIfAbsent(record),
      getManifest: (runId) => baseStore.getManifest(runId),
      getFinalResult: (runId) => baseStore.getFinalResult(runId),
      getTerminalRecord: (runId) => baseStore.getTerminalRecord(runId),
      commitFastPassResultBundleIfAbsent: async (bundle) => {
        const committed =
          await baseStore.commitFastPassResultBundleIfAbsent(bundle);
        current = false;
        return committed;
      },
    };

    const result = await commitDurableFastPassResult({
      store,
      runId: operation.runId,
      operationToken: operation.operationToken,
      isCurrent: () => current,
      manifest,
      finalResult,
      terminal,
      policy: smallPolicy,
    });

    expect(result).toMatchObject({
      status: "stale",
    });
  });

  it("rejects a final/terminal fence mismatch before any durable write", async () => {
    const store = new InMemoryAnalysisResultStore();
    const { manifest, finalResult, terminal } = await records();
    const putManifest = vi.spyOn(store, "putManifest");

    expect(() =>
      commitDurableFastPassResult({
        store,
        ...operation,
        manifest,
        finalResult,
        terminal: {
          ...terminal,
          resultArtifactId: "wrong-final",
        },
        policy: smallPolicy,
      }),
    ).toThrow(/terminal must point/i);
    expect(putManifest).not.toHaveBeenCalled();
  });
});
