import { describe, expect, it } from "vitest";

import { ANALYSIS_STAGES } from "../domain/analysisRun";
import { InMemoryAnalysisResultStore } from "../storage/analysisResultStore";
import {
  commitAnalysisStage,
  completeAnalysisJob,
  failAnalysisJob,
  jobIdFor,
  listAnalysisJobs,
  pauseAnalysisJob,
  startAnalysisJob,
} from "./analysisJobBridge";

const SIGNATURE = "sig-relay-broadcast";

function newStore() {
  return new InMemoryAnalysisResultStore();
}

async function startedRun(store: InMemoryAnalysisResultStore, runId = "run-1") {
  const outcome = await startAnalysisJob({ store, inputSignature: SIGNATURE, runId });
  if (!outcome.ok) throw new Error(`시작 실패: ${outcome.reason}`);
  return outcome.job;
}

describe("analysis job bridge", () => {
  it("creates a job the first time a signature is analysed", async () => {
    const store = newStore();
    const job = await startedRun(store);
    expect(job.jobId).toBe(jobIdFor(SIGNATURE));
    expect(job.status).toBe("running");
    expect(await store.getJob(job.jobId)).not.toBeNull();
  });

  it("reuses the job when the same video is analysed again", async () => {
    // 새로 만들면 같은 영상에 부분 진행된 작업이 둘 남고, 어느 쪽이 진짜인지
    // 알 수 없게 된다.
    const store = newStore();
    await startedRun(store);
    await commitAnalysisStage(store, SIGNATURE, "preflight");
    await pauseAnalysisJob(store, SIGNATURE);

    const again = await startedRun(store, "run-2");
    expect(again.lastCommittedStage).toBe("preflight");
    expect((await listAnalysisJobs(store))).toHaveLength(1);
  });

  it("carries committed stages across a pause", async () => {
    const store = newStore();
    await startedRun(store);
    await commitAnalysisStage(store, SIGNATURE, "preflight");
    await commitAnalysisStage(store, SIGNATURE, "benchmark");
    await pauseAnalysisJob(store, SIGNATURE);

    const record = await store.getJob(jobIdFor(SIGNATURE));
    expect(record?.job.status).toBe("paused");
    expect(record?.job.lastCommittedStage).toBe("benchmark");
  });

  it("resumes a paused job rather than refusing the transition", async () => {
    // 멈춘 작업에 START 를 보내면 전이표가 거부한다. 다리가 상태를 보고 알맞은
    // 사건을 골라야 한다.
    const store = newStore();
    await startedRun(store);
    await pauseAnalysisJob(store, SIGNATURE);
    const resumed = await startAnalysisJob({
      store,
      inputSignature: SIGNATURE,
      runId: "run-2",
    });
    expect(resumed.ok).toBe(true);
  });

  it("retries a failed job rather than refusing the transition", async () => {
    const store = newStore();
    await startedRun(store);
    await failAnalysisJob(store, SIGNATURE, "worker_crashed");
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
      await commitAnalysisStage(store, SIGNATURE, stage);
    }
    await completeAnalysisJob(store, SIGNATURE, true);

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

  it("refuses to complete a run that produced nothing usable", async () => {
    // `done` 과 "쓸 만하다" 를 섞으면 후보 0개인 실행이 완료로 굳고, 캐시가 그것을
    // 영원히 되돌려준다.
    const store = newStore();
    await startedRun(store);
    for (const stage of ANALYSIS_STAGES) {
      await commitAnalysisStage(store, SIGNATURE, stage);
    }
    const outcome = await completeAnalysisJob(store, SIGNATURE, false);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("quality_not_usable");
  });

  it("keeps a failure's reason so the record says more than 'it failed'", async () => {
    const store = newStore();
    await startedRun(store);
    await failAnalysisJob(store, SIGNATURE, "");
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

  it("reports a rejection instead of throwing, so analysis is never blocked by bookkeeping", async () => {
    // 작업 기록은 분석의 부산물이지 조건이 아니다.
    const store = newStore();
    const outcome = await commitAnalysisStage(store, SIGNATURE, "deepPass");
    expect(outcome.ok).toBe(false);
  });

  it("returns an empty list rather than throwing when the store is unavailable", async () => {
    const store = newStore();
    store.close();
    expect(await listAnalysisJobs(store)).toEqual([]);
  });
});
