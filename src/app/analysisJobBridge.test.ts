import { describe, expect, it } from "vitest";

import { ANALYSIS_STAGES } from "../domain/analysisRun";
import { createAnalysisJob } from "../domain/analysisJob";
import {
  ANALYSIS_JOB_RECORD_SCHEMA_VERSION,
  InMemoryAnalysisResultStore,
} from "../storage/analysisResultStore";
import {
  commitAnalysisStage,
  completeAnalysisJob,
  failAnalysisJob,
  JOB_IDENTITY_SCHEME,
  jobIdFor,
  listAnalysisJobs,
  pauseAnalysisJob,
  startAnalysisJob,
} from "./analysisJobBridge";

const SIGNATURE = "sig-relay-broadcast";
const RUN_ID = "run-1";

function newStore() {
  return new InMemoryAnalysisResultStore();
}

async function startedRun(store: InMemoryAnalysisResultStore, runId = RUN_ID) {
  const outcome = await startAnalysisJob({ store, inputSignature: SIGNATURE, runId });
  if (!outcome.ok) throw new Error(`시작 실패: ${outcome.reason}`);
  return outcome.job;
}

describe("analysis job bridge", () => {
  it("creates a job the first time a signature is analysed", async () => {
    const store = newStore();
    const job = await startedRun(store);
    expect(job.jobId).toBe(jobIdFor(SIGNATURE));
    expect(job.jobId).toBe(`exclipper-job-${SIGNATURE}`);
    expect(job.identity.scheme).toBe(JOB_IDENTITY_SCHEME);
    expect(JOB_IDENTITY_SCHEME).toBe("exclipper-input-signature-v1");
    expect(job.status).toBe("running");
    expect(await store.getJob(job.jobId)).not.toBeNull();
  });

  it("reuses the job when the same video is analysed again", async () => {
    // 새로 만들면 같은 영상에 부분 진행된 작업이 둘 남고, 어느 쪽이 진짜인지
    // 알 수 없게 된다.
    const store = newStore();
    await startedRun(store);
    await commitAnalysisStage(store, SIGNATURE, RUN_ID, "preflight");
    await pauseAnalysisJob(store, SIGNATURE, RUN_ID);

    const again = await startedRun(store, "run-2");
    expect(again.lastCommittedStage).toBe("preflight");
    expect((await listAnalysisJobs(store))).toHaveLength(1);
  });

  it("carries committed stages across a pause", async () => {
    const store = newStore();
    await startedRun(store);
    await commitAnalysisStage(store, SIGNATURE, RUN_ID, "preflight");
    await commitAnalysisStage(store, SIGNATURE, RUN_ID, "fastPass");
    await pauseAnalysisJob(store, SIGNATURE, RUN_ID);

    const record = await store.getJob(jobIdFor(SIGNATURE));
    expect(record?.job.status).toBe("paused");
    expect(record?.job.lastCommittedStage).toBe("fastPass");
  });

  it("resumes a paused job rather than refusing the transition", async () => {
    // 멈춘 작업에 START 를 보내면 전이표가 거부한다. 다리가 상태를 보고 알맞은
    // 사건을 골라야 한다.
    const store = newStore();
    await startedRun(store);
    await pauseAnalysisJob(store, SIGNATURE, RUN_ID);
    const resumed = await startAnalysisJob({
      store,
      inputSignature: SIGNATURE,
      runId: "run-2",
    });
    expect(resumed.ok).toBe(true);
  });

  it("never resumes a record carrying the retired identity scheme", async () => {
    const store = newStore();
    const jobId = jobIdFor(SIGNATURE);
    await store.putJob({
      schemaVersion: ANALYSIS_JOB_RECORD_SCHEMA_VERSION,
      jobId,
      job: createAnalysisJob({
        jobId,
        identity: {
          scheme: "app-input-signature-v1",
          key: SIGNATURE,
        },
      }),
      lastActivityAt: "2026-07-29T00:00:00.000Z",
      bytes: 0,
    });

    const outcome = await startAnalysisJob({
      store,
      inputSignature: SIGNATURE,
      runId: RUN_ID,
    });

    expect(outcome).toEqual({
      ok: false,
      failure: "transition",
      retryable: false,
      reason: "analysis_job_identity_mismatch",
    });
  });

  it("does not let a delayed commit from the previous run advance the resumed job", async () => {
    const store = newStore();
    await startedRun(store, "run-1");
    await pauseAnalysisJob(store, SIGNATURE, "run-1");
    await startedRun(store, "run-2");

    const stale = await commitAnalysisStage(
      store,
      SIGNATURE,
      "run-1",
      "preflight",
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("run_fence_mismatch");

    const current = await store.getJob(jobIdFor(SIGNATURE));
    expect(current?.job.activeRunId).toBe("run-2");
    expect(current?.job.lastCommittedStage).toBeNull();
  });

  it("retries a failed job rather than refusing the transition", async () => {
    const store = newStore();
    await startedRun(store);
    await failAnalysisJob(store, SIGNATURE, RUN_ID, "worker_crashed");
    const retried = await startAnalysisJob({
      store,
      inputSignature: SIGNATURE,
      runId: "run-2",
    });
    expect(retried.ok).toBe(true);
  });

  it("treats re-running a finished video as re-analysis", async () => {
    const store = newStore();
    await startedRun(store);
    for (const stage of ANALYSIS_STAGES) {
      await commitAnalysisStage(store, SIGNATURE, RUN_ID, stage);
    }
    await completeAnalysisJob(store, SIGNATURE, RUN_ID, true);

    const again = await startAnalysisJob({
      store,
      inputSignature: SIGNATURE,
      runId: "run-2",
    });
    expect(again.ok).toBe(true);
    if (again.ok) {
      // 무효화됐으므로 확정 지점이 비어야 한다 — 안 그러면 새 실행이 아무 스테이지도
      // 돌지 않고 끝난 것으로 취급된다.
      expect(again.job.lastCommittedStage).toBeNull();
      expect(again.job.runIds).toContain("run-1");
    }
  });

  it("completes a fully verified run that legitimately produced zero candidates", async () => {
    const store = newStore();
    await startedRun(store);
    for (const stage of ANALYSIS_STAGES) {
      await commitAnalysisStage(store, SIGNATURE, RUN_ID, stage);
    }
    const outcome = await completeAnalysisJob(store, SIGNATURE, RUN_ID, false);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.job.status).toBe("completedEmpty");
      expect(outcome.job.quality).toBe("empty");
    }
  });

  it("re-analyses a completed empty broadcast instead of treating it as running", async () => {
    const store = newStore();
    await startedRun(store);
    for (const stage of ANALYSIS_STAGES) {
      await commitAnalysisStage(store, SIGNATURE, RUN_ID, stage);
    }
    await completeAnalysisJob(store, SIGNATURE, RUN_ID, false);

    const again = await startAnalysisJob({
      store,
      inputSignature: SIGNATURE,
      runId: "run-2",
    });

    expect(again.ok).toBe(true);
    if (again.ok) expect(again.job.status).toBe("running");
  });

  it.each([
    { usable: true, status: "completed" },
    { usable: false, status: "completedEmpty" },
  ] as const)(
    "treats a repeated $status completion commit as idempotent",
    async ({ usable, status }) => {
      const store = newStore();
      await startedRun(store);
      for (const stage of ANALYSIS_STAGES) {
        await commitAnalysisStage(store, SIGNATURE, RUN_ID, stage);
      }
      const first = await completeAnalysisJob(store, SIGNATURE, RUN_ID, usable);
      const repeated = await completeAnalysisJob(
        store,
        SIGNATURE,
        RUN_ID,
        usable,
      );

      expect(first.ok).toBe(true);
      expect(repeated.ok).toBe(true);
      if (repeated.ok) expect(repeated.job.status).toBe(status);
    },
  );

  it("keeps a failure's reason so the record says more than 'it failed'", async () => {
    const store = newStore();
    await startedRun(store);
    await failAnalysisJob(store, SIGNATURE, RUN_ID, "");
    const record = await store.getJob(jobIdFor(SIGNATURE));
    expect(record?.job.lastReasonCode).toBe("unknown_failure");
  });

  it("refuses to start while another job is running", async () => {
    const store = newStore();
    const outcome = await startAnalysisJob({
      store,
      inputSignature: SIGNATURE,
      runId: "run-1",
      otherRunningJobCount: 1,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("another_job_is_running");
  });

  it("distinguishes a compare-and-swap conflict from a permanent transition rejection", async () => {
    const store = newStore();
    store.replaceJobIfUnchanged = () => Promise.resolve(false);
    const outcome = await startAnalysisJob({
      store,
      inputSignature: SIGNATURE,
      runId: RUN_ID,
    });

    expect(outcome).toEqual({
      ok: false,
      failure: "conflict",
      retryable: false,
      reason: "analysis_job_snapshot_changed",
    });
  });

  it("labels an unavailable durable store as a storage failure", async () => {
    const store = newStore();
    store.close();
    const outcome = await startAnalysisJob({
      store,
      inputSignature: SIGNATURE,
      runId: RUN_ID,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failure).toBe("storage");
      expect(outcome.retryable).toBe(false);
    }
  });

  it("reports a rejection instead of throwing, so analysis is never blocked by bookkeeping", async () => {
    // 작업 기록은 분석의 부산물이지 조건이 아니다.
    const store = newStore();
    const outcome = await commitAnalysisStage(
      store,
      SIGNATURE,
      RUN_ID,
      "deepPass",
    );
    expect(outcome.ok).toBe(false);
  });

  it("returns an empty list rather than throwing when the store is unavailable", async () => {
    const store = newStore();
    store.close();
    expect(await listAnalysisJobs(store)).toEqual([]);
  });
});
