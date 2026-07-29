import {
  COMPLETED_JOB_STATUSES,
  createAnalysisJob,
  transitionAnalysisJob,
  type AnalysisJob,
  type AnalysisJobEvent,
} from "../domain/analysisJob";
import type { AnalysisStage } from "../domain/analysisRun";
import {
  ANALYSIS_JOB_RECORD_SCHEMA_VERSION,
  AnalysisResultStoreError,
  type AnalysisJobRecord,
  type AnalysisResultStore,
} from "../storage/analysisResultStore";

/**
 * Where the run pipeline meets the job layer.
 *
 * The app already writes a manifest when a run starts and a terminal record
 * when it ends. Those two points are the only places that know a run began or
 * finished, so the job is created and closed from there rather than from a
 * parallel lifecycle that could drift out of step with them.
 *
 * Everything here is a thin wrapper on `transitionAnalysisJob`. The transition
 * table stays the only place that decides what may follow what — a second set
 * of rules living in the app is exactly how the two would disagree.
 */

/**
 * A transition rejection is permanent for the captured run. A storage failure
 * is recoverable from the same durable checkpoint and may be retried.
 */
export type JobBridgeOutcome =
  | { readonly ok: true; readonly job: AnalysisJob }
  | {
      readonly ok: false;
      readonly failure: "storage" | "transition" | "conflict";
      readonly retryable: boolean;
      readonly reason: string;
    };

function storageFailure(cause: unknown): JobBridgeOutcome {
  const retryable =
    !(cause instanceof AnalysisResultStoreError) ||
    !["STORE_CLOSED", "INVALID_PAYLOAD", "SCHEMA_MISMATCH"].includes(
      cause.code,
    );
  return {
    ok: false,
    failure: "storage",
    retryable,
    reason: String((cause as Error)?.message ?? cause),
  };
}

/**
 * 같은 영상인지의 판정 키.
 *
 * 지금은 `inputSignature` 를 그대로 쓴다 — 앱이 이미 그것으로 같은 원본을
 * 알아본다. `scheme` 에 버전이 있으므로 나중에 오디오 지문(v2)으로 바꿔도 기존
 * 레코드와 공존한다.
 */
export const JOB_IDENTITY_SCHEME = "exclipper-input-signature-v1";

export function jobIdFor(inputSignature: string): string {
  return `exclipper-job-${inputSignature}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isCurrentJobIdentity(
  job: AnalysisJob,
  jobId: string,
  inputSignature: string,
): boolean {
  return (
    job.jobId === jobId &&
    job.identity.scheme === JOB_IDENTITY_SCHEME &&
    job.identity.key === inputSignature
  );
}

/**
 * 작업 레코드를 저장한다.
 *
 * `bytes` 는 아직 실측하지 않는다. 정리 정책이 붙기 전까지는 0 이며, 그때
 * `storageRetention` 이 실제 크기를 받아 판단한다. 여기서 짐작한 값을 넣으면
 * 용량 화면이 틀린 숫자를 확신 있게 보여 준다.
 */
async function persist(
  store: AnalysisResultStore,
  job: AnalysisJob,
  previous: AnalysisJobRecord | null,
): Promise<boolean> {
  return store.replaceJobIfUnchanged(previous, {
    schemaVersion: ANALYSIS_JOB_RECORD_SCHEMA_VERSION,
    jobId: job.jobId,
    job,
    lastActivityAt: nowIso(),
    bytes: previous?.bytes ?? 0,
  });
}

async function apply(
  store: AnalysisResultStore,
  jobId: string,
  event: AnalysisJobEvent,
  fallback: () => AnalysisJob,
): Promise<JobBridgeOutcome> {
  try {
    const existing = await store.getJob(jobId);
    const fresh = fallback();
    if (
      existing !== null &&
      !isCurrentJobIdentity(existing.job, fresh.jobId, fresh.identity.key)
    ) {
      return {
        ok: false,
        failure: "transition",
        retryable: false,
        reason: "analysis_job_identity_mismatch",
      };
    }
    const current = existing?.job ?? fresh;
    const outcome = transitionAnalysisJob(current, event);
    if (!outcome.accepted) {
      return {
        ok: false,
        failure: "transition",
        retryable: false,
        reason: outcome.reason,
      };
    }
    const persisted = await persist(store, outcome.job, existing);
    if (!persisted) {
      return {
        ok: false,
        failure: "conflict",
        retryable: false,
        reason: "analysis_job_snapshot_changed",
      };
    }
    return { ok: true, job: outcome.job };
  } catch (cause) {
    return storageFailure(cause);
  }
}

export interface StartJobInput {
  readonly store: AnalysisResultStore;
  readonly inputSignature: string;
  readonly runId: string;
  /** 이미 다른 작업이 돌고 있는가. 불변식 1(활성 1개)을 여기서 지킨다. */
  readonly otherRunningJobCount?: number;
}

/**
 * 분석이 시작될 때. 같은 영상의 작업이 이미 있으면 **그것을 이어서** 쓴다.
 *
 * 새로 만들면 같은 영상에 작업이 둘 생기고, 둘 다 부분적으로 진행된 채 남아
 * 어느 쪽이 진짜인지 알 수 없게 된다.
 */
export async function startAnalysisJob(input: StartJobInput): Promise<JobBridgeOutcome> {
  const jobId = jobIdFor(input.inputSignature);
  const fresh = () =>
    createAnalysisJob({
      jobId,
      identity: { scheme: JOB_IDENTITY_SCHEME, key: input.inputSignature },
    });

  try {
    const existing = await input.store.getJob(jobId);
    if (
      existing !== null &&
      !isCurrentJobIdentity(existing.job, jobId, input.inputSignature)
    ) {
      return {
        ok: false,
        failure: "transition",
        retryable: false,
        reason: "analysis_job_identity_mismatch",
      };
    }
    const current = existing?.job ?? fresh();
    // 멈춰 있던 작업은 RESUME 으로, 실패했던 것은 RETRY 로 이어야 전이표를
    // 통과한다. 새 작업만 START 다.
    const event: AnalysisJobEvent =
      current.status === "paused"
        ? { type: "RESUME", runId: input.runId }
        : current.status === "blocked"
          ? { type: "SOURCE_RECONNECTED", runId: input.runId }
          : current.status === "failed"
            ? { type: "RETRY", runId: input.runId }
            : { type: "START", runId: input.runId };

    // 끝난 작업을 다시 돌리는 것은 재분석이다 — 먼저 무효화해야 전이가 열린다.
    const base =
      COMPLETED_JOB_STATUSES.has(current.status)
        ? transitionAnalysisJob(current, {
            type: "INVALIDATE",
            reasonCode: "reanalysis_requested",
          })
        : { accepted: true as const, job: current };
    if (!base.accepted) {
      return {
        ok: false,
        failure: "transition",
        retryable: false,
        reason: base.reason,
      };
    }

    const outcome = transitionAnalysisJob(base.job, event, {
      otherRunningJobCount: input.otherRunningJobCount ?? 0,
    });
    if (!outcome.accepted) {
      return {
        ok: false,
        failure: "transition",
        retryable: false,
        reason: outcome.reason,
      };
    }
    const persisted = await persist(input.store, outcome.job, existing);
    if (!persisted) {
      return {
        ok: false,
        failure: "conflict",
        retryable: false,
        reason: "analysis_job_snapshot_changed",
      };
    }
    return { ok: true, job: outcome.job };
  } catch (cause) {
    return storageFailure(cause);
  }
}

/** 스테이지가 확정될 때마다. 이 기록이 곧 재개 지점이자 캐시다. */
export function commitAnalysisStage(
  store: AnalysisResultStore,
  inputSignature: string,
  runId: string,
  stage: AnalysisStage,
): Promise<JobBridgeOutcome> {
  const jobId = jobIdFor(inputSignature);
  return apply(store, jobId, { type: "STAGE_COMMITTED", runId, stage }, () =>
    createAnalysisJob({
      jobId,
      identity: { scheme: JOB_IDENTITY_SCHEME, key: inputSignature },
    }),
  );
}

/**
 * 분석이 끝났을 때.
 *
 * **`quality` 를 받는다** — `done` 과 "후보가 있다" 는 다르다. 완전 검증 뒤
 * 후보가 0개인 정상 음성 결과는 `completedEmpty`, 근거가 빠진 미완료 결과는
 * running/failed 상태로 남겨야 저장 이력이 두 의미를 섞지 않는다.
 */
export async function completeAnalysisJob(
  store: AnalysisResultStore,
  inputSignature: string,
  runId: string,
  usable: boolean,
): Promise<JobBridgeOutcome> {
  const jobId = jobIdFor(inputSignature);
  try {
    const existing = await store.getJob(jobId);
    if (
      existing !== null &&
      !isCurrentJobIdentity(existing.job, jobId, inputSignature)
    ) {
      return {
        ok: false,
        failure: "transition",
        retryable: false,
        reason: "analysis_job_identity_mismatch",
      };
    }
    if (
      existing !== null &&
      existing.job.runIds.at(-1) === runId &&
      ((usable && existing.job.status === "completed") ||
        (!usable && existing.job.status === "completedEmpty"))
    ) {
      return { ok: true, job: existing.job };
    }
  } catch (cause) {
    return storageFailure(cause);
  }
  return apply(
    store,
    jobId,
    {
      type: "ALL_STAGES_DONE",
      runId,
      quality: usable ? "usable" : "empty",
    },
    () =>
      createAnalysisJob({
        jobId,
        identity: { scheme: JOB_IDENTITY_SCHEME, key: inputSignature },
      }),
  );
}

/** 사용자가 멈췄을 때. 확정된 스테이지는 남는다 — 그것이 멈춤과 폐기의 차이다. */
export function pauseAnalysisJob(
  store: AnalysisResultStore,
  inputSignature: string,
  runId: string,
): Promise<JobBridgeOutcome> {
  const jobId = jobIdFor(inputSignature);
  return apply(store, jobId, { type: "PAUSE", runId }, () =>
    createAnalysisJob({
      jobId,
      identity: { scheme: JOB_IDENTITY_SCHEME, key: inputSignature },
    }),
  );
}

export function failAnalysisJob(
  store: AnalysisResultStore,
  inputSignature: string,
  runId: string,
  reasonCode: string,
): Promise<JobBridgeOutcome> {
  const jobId = jobIdFor(inputSignature);
  return apply(
    store,
    jobId,
    // 사유 없는 실패는 전이표가 거부한다. 빈 문자열이 오면 최소한 무엇이었는지
    // 남긴다 — "실패함" 만 남은 기록은 아무 도움이 안 된다.
    {
      type: "FATAL",
      runId,
      reasonCode: reasonCode.length > 0 ? reasonCode : "unknown_failure",
    },
    () =>
      createAnalysisJob({
        jobId,
        identity: { scheme: JOB_IDENTITY_SCHEME, key: inputSignature },
      }),
  );
}

/** 화면에 실을 작업들. 깨진 레코드는 목록 전체를 막지 않는다. */
export async function listAnalysisJobs(
  store: AnalysisResultStore,
): Promise<readonly AnalysisJobRecord[]> {
  try {
    return await store.listJobs();
  } catch {
    return [];
  }
}
