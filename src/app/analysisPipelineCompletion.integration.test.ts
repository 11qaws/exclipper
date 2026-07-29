import { describe, expect, it, vi } from "vitest";

import type { AnalysisStage } from "../domain/analysisRun";
import {
  InMemoryAnalysisResultStore,
  type AnalysisResultStore,
} from "../storage/analysisResultStore";
import {
  createAnalysisPipelineHappyPathFixture,
} from "../testSupport/analysisPipelineHappyPathFixture";
import {
  certifyAnalysisPipelineSuccess,
  createAnalysisPipelineDurableSnapshotToken,
  type AnalysisPipelineSuccessCertificate,
  type AnalysisPipelineSuccessInput,
} from "./analysisPipelineSuccess";
import {
  commitDurableFastPassManifest,
  commitDurableFastPassResult,
  type DurableFastPassResultCommitResult,
} from "./durableFastPassArtifacts";
import {
  commitDurableAnalysisStage,
  completeDurableAnalysisJob,
  startDurableAnalysisJob,
  type DurableAnalysisJobOperationInput,
  type DurableAnalysisJobOperationResult,
} from "./durableAnalysisJobBridge";

const POLICY = {
  maximumAttempts: 4,
  mutationTimeoutMs: 100,
  readbackTimeoutMs: 100,
  initialBackoffMs: 1,
  maximumBackoffMs: 2,
} as const;

const POST_BUNDLE_FAST_STAGES = [
  "fastPass",
  "seedClustering",
  "commitFastResult",
] as const satisfies readonly AnalysisStage[];

const CERTIFIED_STAGES = [
  "broadcastContext",
  "deepPass",
  "publication",
] as const satisfies readonly AnalysisStage[];

type HappyPathFixture = Awaited<
  ReturnType<typeof createAnalysisPipelineHappyPathFixture>
>;

function durableInput(
  store: AnalysisResultStore,
  fixture: HappyPathFixture,
  operationToken: string,
): DurableAnalysisJobOperationInput {
  const identity = {
    runId: fixture.manifest.runId,
    operationToken,
  };
  return {
    store,
    inputSignature: fixture.manifest.inputSignature,
    runId: identity.runId,
    operationToken: identity.operationToken,
    isCurrent: (candidate) =>
      candidate.runId === identity.runId &&
      candidate.operationToken === identity.operationToken,
    policy: POLICY,
  };
}

function requireSucceeded(
  result: DurableAnalysisJobOperationResult,
): Extract<DurableAnalysisJobOperationResult, { readonly status: "succeeded" }> {
  expect(result.status).toBe("succeeded");
  if (result.status !== "succeeded") {
    throw new Error(`Durable operation failed: ${result.status}`);
  }
  return result;
}

function requireFastBundleSucceeded(
  result: DurableFastPassResultCommitResult,
): Extract<DurableFastPassResultCommitResult, { readonly status: "succeeded" }> {
  expect(result.status).toBe("succeeded");
  if (result.status !== "succeeded") {
    throw new Error(
      `Durable fast-pass bundle failed at ${result.artifact}: ${result.status}`,
    );
  }
  return result;
}

function fastArtifactInput(
  store: AnalysisResultStore,
  fixture: HappyPathFixture,
  operationToken: string,
) {
  const identity = {
    runId: fixture.manifest.runId,
    operationToken,
  };
  return {
    store,
    runId: identity.runId,
    operationToken: identity.operationToken,
    isCurrent: (candidate: {
      readonly runId: string;
      readonly operationToken: string;
    }) =>
      candidate.runId === identity.runId &&
      candidate.operationToken === identity.operationToken,
    policy: POLICY,
  };
}

async function persistCertificationArtifacts(
  store: AnalysisResultStore,
  fixture: HappyPathFixture,
): Promise<void> {
  await store.putBroadcastContextSession(fixture.session);
  if (fixture.candidateRecord !== null) {
    await store.putCandidatePassBInsights(fixture.candidateRecord);
  }
}

async function certifyReopenedArtifacts(
  store: AnalysisResultStore,
  fixture: HappyPathFixture,
): Promise<AnalysisPipelineSuccessCertificate> {
  const runId = fixture.manifest.runId;
  const [
    manifest,
    fastResult,
    fastTerminal,
    session,
    candidateRecord,
  ] = await Promise.all([
    store.getManifest(runId),
    store.getFinalResult(runId),
    store.getTerminalRecord(runId),
    store.getBroadcastContextSession(runId),
    store.getCandidatePassBInsights(runId),
  ]);
  if (
    manifest === null ||
    fastResult === null ||
    fastTerminal === null ||
    session === null
  ) {
    throw new Error("The durable pipeline snapshot is incomplete.");
  }

  const snapshot = {
    manifest,
    fastResult,
    fastTerminal,
    session,
    candidateRecord,
  };
  const snapshotTokenBefore =
    await createAnalysisPipelineDurableSnapshotToken(snapshot);
  const input: AnalysisPipelineSuccessInput = {
    ...snapshot,
    candidates: fixture.candidates,
  };
  const result = await certifyAnalysisPipelineSuccess(input);

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(
      `Pipeline certification failed: ${result.gaps
        .map(({ code }) => code)
        .join(", ")}`,
    );
  }

  const reopenedAfterCertification = {
    manifest: await store.getManifest(runId),
    fastResult: await store.getFinalResult(runId),
    fastTerminal: await store.getTerminalRecord(runId),
    session: await store.getBroadcastContextSession(runId),
    candidateRecord: await store.getCandidatePassBInsights(runId),
  };
  if (
    reopenedAfterCertification.manifest === null ||
    reopenedAfterCertification.fastResult === null ||
    reopenedAfterCertification.fastTerminal === null ||
    reopenedAfterCertification.session === null
  ) {
    throw new Error("The certified durable snapshot disappeared.");
  }
  await expect(
    createAnalysisPipelineDurableSnapshotToken({
      manifest: reopenedAfterCertification.manifest,
      fastResult: reopenedAfterCertification.fastResult,
      fastTerminal: reopenedAfterCertification.fastTerminal,
      session: reopenedAfterCertification.session,
      candidateRecord: reopenedAfterCertification.candidateRecord,
    }),
  ).resolves.toBe(snapshotTokenBefore);

  return result.certificate;
}

interface PipelineRunResult {
  readonly certificate: AnalysisPipelineSuccessCertificate;
  readonly trace: readonly string[];
  readonly contextCommit: Extract<
    DurableAnalysisJobOperationResult,
    { readonly status: "succeeded" }
  >;
}

interface FastBundleCheckpoint {
  readonly store: InMemoryAnalysisResultStore;
  readonly fixture: HappyPathFixture;
  readonly preflightCommit: Extract<
    DurableAnalysisJobOperationResult,
    { readonly status: "succeeded" }
  >;
  readonly trace: string[];
}

async function runCurrentPipeline(
  clipDecision: "recommend" | "reject",
  prepareStore?: (
    store: InMemoryAnalysisResultStore,
    fixture: HappyPathFixture,
  ) => void,
  afterFastBundle?: (checkpoint: FastBundleCheckpoint) => Promise<void>,
): Promise<PipelineRunResult> {
  const fixture = await createAnalysisPipelineHappyPathFixture({
    clipDecision,
  });
  const store = new InMemoryAnalysisResultStore();
  prepareStore?.(store, fixture);
  const trace: string[] = [];

  requireSucceeded(
    await startDurableAnalysisJob({
      ...durableInput(store, fixture, "start"),
    }),
  );
  trace.push("start");

  const manifestCommit = await commitDurableFastPassManifest({
    ...fastArtifactInput(store, fixture, "fast:manifest"),
    manifest: fixture.manifest,
  });
  expect(manifestCommit.status).toBe("succeeded");
  if (manifestCommit.status !== "succeeded") {
    throw new Error(`Durable manifest failed: ${manifestCommit.status}`);
  }
  expect(manifestCommit.value).toEqual(fixture.manifest);
  trace.push("durable-manifest-readback");

  const preflightCommit = requireSucceeded(
    await commitDurableAnalysisStage({
      ...durableInput(store, fixture, "stage:preflight"),
      stage: "preflight",
    }),
  );
  trace.push("preflight");

  const fastBundleCommit = requireFastBundleSucceeded(
    await commitDurableFastPassResult({
      ...fastArtifactInput(store, fixture, "fast:result-bundle"),
      manifest: fixture.manifest,
      finalResult: fixture.fastResult,
      terminal: fixture.fastTerminal,
    }),
  );
  expect(fastBundleCommit.value).toMatchObject({
    manifest: fixture.manifest,
    finalResult: fixture.fastResult,
    terminal: fixture.fastTerminal,
  });
  trace.push("durable-fast-bundle-readback");

  await afterFastBundle?.({
    store,
    fixture,
    preflightCommit,
    trace,
  });

  for (const stage of POST_BUNDLE_FAST_STAGES) {
    requireSucceeded(
      await commitDurableAnalysisStage({
        ...durableInput(store, fixture, `stage:${stage}`),
        stage,
      }),
    );
    trace.push(stage);
  }

  await persistCertificationArtifacts(store, fixture);
  trace.push("durable-certification-artifact-readback");
  const certificate = await certifyReopenedArtifacts(store, fixture);
  trace.push(`certificate:${certificate.quality}`);

  let contextCommit:
    | Extract<
        DurableAnalysisJobOperationResult,
        { readonly status: "succeeded" }
      >
    | undefined;
  for (const stage of CERTIFIED_STAGES) {
    const committed = requireSucceeded(
      await commitDurableAnalysisStage({
        ...durableInput(store, fixture, `stage:${stage}`),
        stage,
      }),
    );
    if (stage === "broadcastContext") {
      contextCommit = committed;
    }
    trace.push(stage);
  }
  if (contextCommit === undefined) {
    throw new Error("The broadcast-context checkpoint was not committed.");
  }

  const completed = requireSucceeded(
    await completeDurableAnalysisJob({
      ...durableInput(store, fixture, "complete"),
      quality: certificate.quality,
      expectedDurableSnapshot: {
        manifest: fixture.manifest,
        fastResult: fixture.fastResult,
        fastTerminal: fixture.fastTerminal,
        session: fixture.session,
        candidateRecord: fixture.candidateRecord,
      },
    }),
  );
  trace.push("complete");

  expect(completed.value.lastCommittedStage).toBe("publication");
  expect(completed.value.activeRunId).toBeNull();
  expect(completed.value.quality).toBe(certificate.quality);
  expect(completed.value.status).toBe(
    certificate.quality === "usable" ? "completed" : "completedEmpty",
  );

  return { certificate, trace, contextCommit };
}

describe("current-only durable pipeline completion integration", () => {
  it("reopens and certifies a usable run before durable publication", async () => {
    const result = await runCurrentPipeline("recommend");

    expect(result.certificate).toMatchObject({
      quality: "usable",
      finalCandidateIds: ["highlight-audio-1234abcd"],
    });
    expect(result.trace).toEqual([
      "start",
      "durable-manifest-readback",
      "preflight",
      "durable-fast-bundle-readback",
      "fastPass",
      "seedClustering",
      "commitFastResult",
      "durable-certification-artifact-readback",
      "certificate:usable",
      "broadcastContext",
      "deepPass",
      "publication",
      "complete",
    ]);
  });

  it("completes valid empty only after the same durable evidence certificate", async () => {
    const result = await runCurrentPipeline("reject");

    expect(result.certificate).toMatchObject({
      quality: "empty",
      finalCandidateIds: [],
    });
    expect(result.trace).toEqual([
      "start",
      "durable-manifest-readback",
      "preflight",
      "durable-fast-bundle-readback",
      "fastPass",
      "seedClustering",
      "commitFastResult",
      "durable-certification-artifact-readback",
      "certificate:empty",
      "broadcastContext",
      "deepPass",
      "publication",
      "complete",
    ]);
  });

  it("recovers a transient CAS conflict at the same context checkpoint", async () => {
    let rejectedContextWrite = false;
    const result = await runCurrentPipeline(
      "recommend",
      (store, fixture) => {
        const replace = store.replaceJobIfUnchanged.bind(store);
        vi.spyOn(store, "replaceJobIfUnchanged").mockImplementation(
          (expected, replacement) => {
            if (
              !rejectedContextWrite &&
              replacement.job.activeRunId === fixture.manifest.runId &&
              replacement.job.lastCommittedStage === "broadcastContext"
            ) {
              rejectedContextWrite = true;
              return Promise.resolve(false);
            }
            return replace(expected, replacement);
          },
        );
      },
    );

    expect(rejectedContextWrite).toBe(true);
    expect(result.contextCommit).toMatchObject({
      attempts: 2,
      recovered: true,
      value: {
        lastCommittedStage: "broadcastContext",
      },
    });
    expect(result.trace.at(-1)).toBe("complete");
  });

  it("resumes a terminal fast bundle whose durable job cursor stopped at preflight", async () => {
    let resumed = false;
    const result = await runCurrentPipeline(
      "recommend",
      undefined,
      async ({ store, fixture, preflightCommit, trace }) => {
        expect(preflightCommit.value).toMatchObject({
          activeRunId: fixture.manifest.runId,
          lastCommittedStage: "preflight",
          status: "running",
        });
        await expect(
          store.getTerminalRecord(fixture.manifest.runId),
        ).resolves.toEqual(fixture.fastTerminal);

        const putManifest = vi.spyOn(store, "putManifest");
        const putFinalResult = vi.spyOn(store, "putFinalResult");
        const putTerminal = vi.spyOn(store, "putTerminalRecord");

        requireSucceeded(
          await startDurableAnalysisJob({
            ...durableInput(store, fixture, "resume:start"),
          }),
        );
        const reopenedManifest = await commitDurableFastPassManifest({
          ...fastArtifactInput(store, fixture, "resume:manifest"),
          manifest: fixture.manifest,
        });
        expect(reopenedManifest.status).toBe("succeeded");
        if (reopenedManifest.status !== "succeeded") {
          throw new Error(
            `Reopened durable manifest failed: ${reopenedManifest.status}`,
          );
        }
        const reopenedBundle = requireFastBundleSucceeded(
          await commitDurableFastPassResult({
            ...fastArtifactInput(store, fixture, "resume:result-bundle"),
            manifest: fixture.manifest,
            finalResult: fixture.fastResult,
            terminal: fixture.fastTerminal,
          }),
        );

        expect(reopenedManifest.recovered).toBe(false);
        expect(reopenedBundle.value.recovered).toBe(false);
        expect(putManifest).not.toHaveBeenCalled();
        expect(putFinalResult).not.toHaveBeenCalled();
        expect(putTerminal).not.toHaveBeenCalled();
        trace.push("resume:exact-fast-bundle");
        resumed = true;
      },
    );

    expect(resumed).toBe(true);
    expect(result.certificate.quality).toBe("usable");
    expect(result.trace).toEqual([
      "start",
      "durable-manifest-readback",
      "preflight",
      "durable-fast-bundle-readback",
      "resume:exact-fast-bundle",
      "fastPass",
      "seedClustering",
      "commitFastResult",
      "durable-certification-artifact-readback",
      "certificate:usable",
      "broadcastContext",
      "deepPass",
      "publication",
      "complete",
    ]);
  });
});
