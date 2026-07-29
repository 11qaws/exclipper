import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAnalysisPipelineHappyPathFixture,
  createAnalysisPipelineIntentionalEmptyFixture,
} from "../testSupport/analysisPipelineHappyPathFixture";
import {
  AnalysisResultStoreError,
  type AnalysisManifestRecord,
} from "../storage/analysisResultStore";
import {
  createAnalysisPipelineDurableSnapshotToken,
  type AnalysisPipelineSuccessInput,
} from "./analysisPipelineSuccess";
import {
  runDurableAnalysisPipelineCertification,
  type DurableAnalysisPipelineCertificationOptions,
  type DurableAnalysisPipelineCertificationPolicy,
  type DurableAnalysisPipelineCertificationStore,
} from "./durableAnalysisPipelineCertification";

const identity = {
  runId: "run-success-certificate-1",
  operationToken: "pipeline-certificate:revision-7",
} as const;

const smallPolicy: DurableAnalysisPipelineCertificationPolicy = {
  maximumAttempts: 3,
  readbackTimeoutMs: 500,
  initialBackoffMs: 1,
  maximumBackoffMs: 2,
};

afterEach(() => {
  vi.useRealTimers();
});

function createStore(
  fixture: AnalysisPipelineSuccessInput,
  overrides: Partial<DurableAnalysisPipelineCertificationStore> = {},
): DurableAnalysisPipelineCertificationStore {
  return {
    getManifest: vi.fn(() => Promise.resolve(fixture.manifest)),
    getFinalResult: vi.fn(() => Promise.resolve(fixture.fastResult)),
    getTerminalRecord: vi.fn(() =>
      Promise.resolve(fixture.fastTerminal),
    ),
    getBroadcastContextSession: vi.fn(() =>
      Promise.resolve(fixture.session),
    ),
    getCandidatePassBInsights: vi.fn(() =>
      Promise.resolve(fixture.candidateRecord),
    ),
    ...overrides,
  };
}

function createOptions(
  fixture: AnalysisPipelineSuccessInput,
  input: Partial<DurableAnalysisPipelineCertificationOptions> = {},
): DurableAnalysisPipelineCertificationOptions {
  return {
    identity,
    store: createStore(fixture),
    evidence: {
      candidates: fixture.candidates,
    },
    isCurrent: () => true,
    policy: smallPolicy,
    ...input,
  };
}

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
} {
  let resolvePromise: ((value: Value) => void) | null = null;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      if (resolvePromise === null) {
        throw new Error("Deferred promise is not initialized.");
      }
      resolvePromise(value);
    },
  };
}

describe("runDurableAnalysisPipelineCertification", () => {
  it("reopens two identical five-record waves and returns the exact durable token", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const pendingManifest = deferred<AnalysisManifestRecord | null>();
    const calls: string[] = [];
    const store = createStore(fixture, {
      getManifest: vi.fn((runId) => {
        calls.push(`manifest:${runId}`);
        return pendingManifest.promise;
      }),
      getFinalResult: vi.fn((runId) => {
        calls.push(`final:${runId}`);
        return Promise.resolve(fixture.fastResult);
      }),
      getTerminalRecord: vi.fn((runId) => {
        calls.push(`terminal:${runId}`);
        return Promise.resolve(fixture.fastTerminal);
      }),
      getBroadcastContextSession: vi.fn((runId) => {
        calls.push(`context:${runId}`);
        return Promise.resolve(fixture.session);
      }),
      getCandidatePassBInsights: vi.fn((runId) => {
        calls.push(`candidate:${runId}`);
        return Promise.resolve(fixture.candidateRecord);
      }),
    });

    const promise = runDurableAnalysisPipelineCertification(
      createOptions(fixture, { store }),
    );
    await vi.waitFor(() => {
      expect(calls).toHaveLength(5);
    });

    expect(calls).toEqual([
      `manifest:${identity.runId}`,
      `final:${identity.runId}`,
      `terminal:${identity.runId}`,
      `context:${identity.runId}`,
      `candidate:${identity.runId}`,
    ]);

    pendingManifest.resolve(fixture.manifest);
    const result = await promise;

    expect(calls).toHaveLength(10);
    expect(result).toMatchObject({
      status: "succeeded",
      attempts: 1,
      certificate: {
        runId: identity.runId,
        quality: "usable",
      },
    });
    if (result.status !== "succeeded") return;
    expect(result.durableToken).toBe(
      await createAnalysisPipelineDurableSnapshotToken(fixture),
    );
    expect(result.durableSnapshot).toEqual({
      manifest: fixture.manifest,
      fastResult: fixture.fastResult,
      fastTerminal: fixture.fastTerminal,
      session: fixture.session,
      candidateRecord: fixture.candidateRecord,
    });
  });

  it("retries both readback waves when a required record is not visible yet", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    let manifestAttempt = 0;
    const store = createStore(fixture, {
      getManifest: vi.fn(() => {
        manifestAttempt += 1;
        return Promise.resolve(
          manifestAttempt === 1 ? null : fixture.manifest,
        );
      }),
    });

    const result = await runDurableAnalysisPipelineCertification(
      createOptions(fixture, { store }),
    );

    expect(result).toMatchObject({
      status: "succeeded",
      attempts: 2,
    });
    expect(store.getManifest).toHaveBeenCalledTimes(4);
    expect(store.getFinalResult).toHaveBeenCalledTimes(4);
    expect(store.getTerminalRecord).toHaveBeenCalledTimes(4);
    expect(store.getBroadcastContextSession).toHaveBeenCalledTimes(4);
    expect(store.getCandidatePassBInsights).toHaveBeenCalledTimes(4);
  });

  it("retries a same-timestamp content change instead of certifying a mixed snapshot", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    if (fixture.candidateRecord === null) {
      throw new Error("Happy-path fixture must include candidate evidence.");
    }
    const changedSameTimestampCandidateRecord = {
      ...fixture.candidateRecord,
      inputSignature: `${fixture.candidateRecord.inputSignature}-changed`,
    };
    let candidateRead = 0;
    const store = createStore(fixture, {
      getCandidatePassBInsights: vi.fn(() => {
        candidateRead += 1;
        return Promise.resolve(
          candidateRead === 2
            ? changedSameTimestampCandidateRecord
            : fixture.candidateRecord,
        );
      }),
    });

    const result = await runDurableAnalysisPipelineCertification(
      createOptions(fixture, { store }),
    );

    expect(result).toMatchObject({
      status: "succeeded",
      attempts: 2,
    });
    expect(store.getCandidatePassBInsights).toHaveBeenCalledTimes(4);
  });

  it("retries a transient IndexedDB exception and preserves the same identity", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    let manifestAttempt = 0;
    const store = createStore(fixture, {
      getManifest: vi.fn(() => {
        manifestAttempt += 1;
        return manifestAttempt === 1
          ? Promise.reject(
              new AnalysisResultStoreError(
                "TRANSACTION_FAILED",
                "Temporary transaction failure.",
              ),
            )
          : Promise.resolve(fixture.manifest);
      }),
    });
    const isCurrent = vi.fn<
      (
        candidate: DurableAnalysisPipelineCertificationOptions["identity"],
      ) => boolean
    >(() => true);

    const result = await runDurableAnalysisPipelineCertification(
      createOptions(fixture, { store, isCurrent }),
    );

    expect(result).toMatchObject({
      status: "succeeded",
      attempts: 2,
    });
    expect(isCurrent).toHaveBeenCalledWith(identity);
    expect(
      isCurrent.mock.calls.every(([candidate]) => candidate === identity),
    ).toBe(true);
  });

  it("routes a missing candidate record to candidate-plan recovery", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const store = createStore(fixture, {
      getCandidatePassBInsights: vi.fn(() => Promise.resolve(null)),
    });

    const result = await runDurableAnalysisPipelineCertification(
      createOptions(fixture, { store }),
    );

    expect(result).toMatchObject({
      status: "certificate-rejected",
      failedStage: "deepPass",
      attempts: 1,
    });
    if (result.status !== "certificate-rejected") return;
    expect(result.gaps.map((gap) => gap.code)).toContain(
      "candidate-plan-invalid",
    );
    expect(store.getCandidatePassBInsights).toHaveBeenCalledTimes(2);
  });

  it("certifies a durably reopened exact empty Candidate Pass B plan", async () => {
    const fixture = await createAnalysisPipelineIntentionalEmptyFixture();

    const result = await runDurableAnalysisPipelineCertification(
      createOptions(fixture),
    );

    expect(result).toMatchObject({
      status: "succeeded",
      certificate: {
        quality: "empty",
        finalCandidateIds: [],
      },
    });
  });

  it("routes a missing empty-cohort record to candidate-plan recovery", async () => {
    const fixture = await createAnalysisPipelineIntentionalEmptyFixture();
    const store = createStore(fixture, {
      getCandidatePassBInsights: vi.fn(() => Promise.resolve(null)),
    });

    const result = await runDurableAnalysisPipelineCertification(
      createOptions(fixture, { store }),
    );

    expect(result).toMatchObject({
      status: "certificate-rejected",
      failedStage: "deepPass",
      gaps: [{ code: "candidate-plan-invalid" }],
    });
  });

  it("returns certificate-rejected without retrying deterministic artifact gaps", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const store = createStore(fixture, {
      getTerminalRecord: vi.fn(() =>
        Promise.resolve({
          ...fixture.fastTerminal,
          runId: "run-from-another-operation",
        }),
      ),
    });

    const result = await runDurableAnalysisPipelineCertification(
      createOptions(fixture, { store }),
    );

    expect(result).toMatchObject({
      status: "certificate-rejected",
      failedStage: "commitFastResult",
      attempts: 1,
    });
    if (result.status !== "certificate-rejected") return;
    expect(result.gaps.map((gap) => gap.code)).toContain(
      "run-fence-mismatch",
    );
  });

  it("stops before readback when the run and operation token are stale", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const store = createStore(fixture);

    const result = await runDurableAnalysisPipelineCertification(
      createOptions(fixture, {
        store,
        isCurrent: () => false,
      }),
    );

    expect(result).toEqual({
      status: "stale",
      reasonCode: "analysis_pipeline_certification_fence_stale",
      attempts: 0,
    });
    expect(store.getManifest).not.toHaveBeenCalled();
  });

  it("rejects a stale operation after readback and before certification", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const isCurrent = vi
      .fn<
        (
          candidate: DurableAnalysisPipelineCertificationOptions["identity"],
        ) => boolean
      >()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const store = createStore(fixture);

    const result = await runDurableAnalysisPipelineCertification(
      createOptions(fixture, { isCurrent, store }),
    );

    expect(result).toEqual({
      status: "stale",
      reasonCode: "analysis_pipeline_certification_fence_stale",
      attempts: 1,
    });
    expect(store.getManifest).toHaveBeenCalledTimes(2);
  });

  it("aborts an in-flight readback without accepting its late result", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const never = new Promise<AnalysisManifestRecord | null>(() => {
      // Intentionally stalled to verify the outer AbortSignal fence.
    });
    const controller = new AbortController();
    const store = createStore(fixture, {
      getManifest: vi.fn(() => never),
    });

    const promise = runDurableAnalysisPipelineCertification(
      createOptions(fixture, {
        store,
        signal: controller.signal,
      }),
    );
    await Promise.resolve();
    controller.abort();

    await expect(promise).resolves.toEqual({
      status: "aborted",
      attempts: 1,
    });
  });

  it("bounds stalled readbacks with a per-wave watchdog", async () => {
    vi.useFakeTimers();
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const never = new Promise<AnalysisManifestRecord | null>(() => {
      // Every attempt must time out as one bounded Promise.all wave.
    });
    const store = createStore(fixture, {
      getManifest: vi.fn(() => never),
    });
    const promise = runDurableAnalysisPipelineCertification(
      createOptions(fixture, {
        store,
        policy: {
          maximumAttempts: 2,
          readbackTimeoutMs: 10,
          initialBackoffMs: 2,
          maximumBackoffMs: 2,
        },
      }),
    );

    await vi.advanceTimersByTimeAsync(30);

    await expect(promise).resolves.toEqual({
      status: "retry-exhausted",
      reasonCode: "analysis_pipeline_readback_timeout",
      attempts: 2,
    });
    expect(store.getManifest).toHaveBeenCalledTimes(2);
    expect(store.getCandidatePassBInsights).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent storage rejections", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const store = createStore(fixture, {
      getManifest: vi.fn(() =>
        Promise.reject(
          new AnalysisResultStoreError(
            "INVALID_PAYLOAD",
            "The stored manifest is invalid.",
          ),
        ),
      ),
    });

    const result = await runDurableAnalysisPipelineCertification(
      createOptions(fixture, { store }),
    );

    expect(result).toEqual({
      status: "permanent",
      reasonCode: "analysis_pipeline_readback_storage_rejected",
      attempts: 1,
    });
    expect(store.getManifest).toHaveBeenCalledOnce();
  });

  it("cleans up and classifies a synchronous readback exception", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const store = createStore(fixture, {
      getManifest: vi.fn(() => {
        throw new TypeError("Broken store adapter.");
      }),
    });

    const result = await runDurableAnalysisPipelineCertification(
      createOptions(fixture, { store }),
    );

    expect(result).toEqual({
      status: "permanent",
      reasonCode: "analysis_pipeline_readback_exception",
      attempts: 1,
    });
    expect(store.getFinalResult).not.toHaveBeenCalled();
  });

  it("returns retry-exhausted when required artifacts never become visible", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const store = createStore(fixture, {
      getBroadcastContextSession: vi.fn(() => Promise.resolve(null)),
    });

    const result = await runDurableAnalysisPipelineCertification(
      createOptions(fixture, {
        store,
        policy: {
          ...smallPolicy,
          maximumAttempts: 2,
        },
      }),
    );

    expect(result).toEqual({
      status: "retry-exhausted",
      reasonCode: "analysis_pipeline_snapshot_incomplete",
      attempts: 2,
    });
  });

  it("rejects invalid current-only operation identity without touching storage", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const store = createStore(fixture);

    const result = await runDurableAnalysisPipelineCertification(
      createOptions(fixture, {
        identity: {
          runId: identity.runId,
          operationToken: " ",
        },
        store,
      }),
    );

    expect(result).toEqual({
      status: "permanent",
      reasonCode: "analysis_pipeline_certification_identity_invalid",
      attempts: 0,
    });
    expect(store.getManifest).not.toHaveBeenCalled();
  });
});
