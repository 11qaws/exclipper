import { ANALYSIS_STAGES, type AnalysisStage } from "./analysisRun";

/**
 * A job is the analysis of one *video*, not of one session.
 *
 * `AnalysisRun` (see ./analysisRun.ts) already models a single execution
 * attempt with sixteen states and its own fencing. This layer sits above it and
 * is deliberately much smaller: it remembers which video is being worked on and
 * how far that work has been committed, so a new attempt can pick up where the
 * last one stopped.
 *
 * That split is what makes the rest possible. A run may end `interrupted` when
 * the tab closes — it is a terminal state and cannot be revived, and
 * `RESUME_REQUESTED_SAME_SESSION` refuses a different `sessionId`. So resuming
 * is not "restart that run"; it is "the job creates a new run that begins after
 * `lastCommittedStage`". Nothing in the run machine has to change for that.
 *
 * The same rule is the cache. Skipping already-committed stages is not a
 * feature added later — it is what resuming means.
 */

/** 생애주기의 현재 위치. 하나만 존재한다. */
export type AnalysisJobStatus =
  | "queued"
  | "running"
  | "paused"
  | "blocked"
  | "completed"
  | "completedEmpty"
  | "failed"
  | "abandoned";

export const ANALYSIS_JOB_STATUSES = [
  "queued",
  "running",
  "paused",
  "blocked",
  "completed",
  "completedEmpty",
  "failed",
  "abandoned",
] as const satisfies readonly AnalysisJobStatus[];

export const COMPLETED_JOB_STATUSES: ReadonlySet<AnalysisJobStatus> = new Set([
  "completed",
  "completedEmpty",
]);

export const TERMINAL_JOB_STATUSES: ReadonlySet<AnalysisJobStatus> = new Set([
  ...COMPLETED_JOB_STATUSES,
  "failed",
  "abandoned",
]);

/**
 * 원본 가용성. 중심 상태와 독립적으로 변한다 — 실행 중에도, 멈춘 중에도 파일
 * 접근 권한은 따로 만료될 수 있다.
 */
export type SourceAvailability = "connected" | "needsPermission" | "missing";

export const SOURCE_AVAILABILITIES = [
  "connected",
  "needsPermission",
  "missing",
] as const satisfies readonly SourceAvailability[];

/**
 * 스테이지 산출물의 품질.
 *
 * `AnalysisRun` 의 gap 프로토콜과 다른 것을 본다. gap 은 **커버리지**(계획한
 * 구간을 다 훑었나), 이쪽은 **산출물**(훑고 나서 쓸 만한 게 나왔나)이다. gap 없이
 * 완주해도 후보가 0개일 수 있으므로 `completedWithGaps` 는 품질을 말해 주지
 * 않는다.
 */
export type StageQuality = "unknown" | "usable" | "empty" | "suspect";

export const STAGE_QUALITIES = [
  "unknown",
  "usable",
  "empty",
  "suspect",
] as const satisfies readonly StageQuality[];

/**
 * 같은 영상인지의 판정. **표면 메타데이터(파일명·크기·재생시간)로 하지 않는다** —
 * 재인코딩 한 번에 전부 달라진다.
 *
 * `scheme` 에 버전이 들어 있어 나중에 오디오 지문(v2)으로 교체할 때 기존 레코드와
 * 공존할 수 있다.
 */
export interface ContentIdentity {
  readonly scheme: string;
  readonly key: string;
  /** 2단 확증으로 기존 작업에 이어붙인 경우. */
  readonly matchedJobId?: string;
  /** 앞뒤가 잘린 영상을 이어붙인 경우의 시간차. */
  readonly offsetMs?: number;
}

export interface AnalysisJob {
  readonly jobId: string;
  readonly identity: ContentIdentity;
  readonly status: AnalysisJobStatus;
  /**
   * 어디까지 확정됐나. `null` 이면 아직 아무 스테이지도 커밋되지 않았다.
   * 재개는 이 다음 스테이지부터 시작한다.
   */
  readonly lastCommittedStage: AnalysisStage | null;
  readonly quality: StageQuality;
  readonly source: SourceAvailability;
  /** 현재 진행 중인 `AnalysisRun`. 없으면 `null`. */
  readonly activeRunId: string | null;
  /**
   * 이 작업이 만든 모든 Run. 재개할 때마다 새 Run 이 생기므로 쌓인다.
   *
   * 이력용이 아니라 **삭제용**이다. 실행 결과 레코드는 `runId` 로 저장되므로, 이
   * 목록이 없으면 작업을 지워도 인사이트·대사·맥락이 남는다 — 용량을 차지하는
   * 것은 정확히 그쪽이고, 남으면 용량 집계가 조용히 어긋난다.
   */
  readonly runIds: readonly string[];
  /** 종료 사유. `AnalysisRun` 의 어휘를 그대로 옮겨 적는다. */
  readonly lastReasonCode: string | null;
}

const ANALYSIS_JOB_KEYS = [
  "jobId",
  "identity",
  "status",
  "lastCommittedStage",
  "quality",
  "source",
  "activeRunId",
  "runIds",
  "lastReasonCode",
] as const;

const CONTENT_IDENTITY_REQUIRED_KEYS = ["scheme", "key"] as const;
const CONTENT_IDENTITY_ALLOWED_KEYS = [
  ...CONTENT_IDENTITY_REQUIRED_KEYS,
  "matchedJobId",
  "offsetMs",
] as const;

function invalidAnalysisJob(path: string, message: string): never {
  throw new TypeError(`Invalid AnalysisJob ${path}: ${message}`);
}

function asPlainRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    return invalidAnalysisJob(path, "must be a plain object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function assertExactKeys(
  record: Readonly<Record<string, unknown>>,
  required: readonly string[],
  allowed: readonly string[] = required,
  path: string,
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string") {
      invalidAnalysisJob(path, "contains a symbol-keyed field.");
    }
    if (!allowedKeys.has(key)) {
      invalidAnalysisJob(path, `contains unsupported field ${key}.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      descriptor === undefined ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !descriptor.enumerable
    ) {
      invalidAnalysisJob(path, `field ${key} must be plain enumerable data.`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      invalidAnalysisJob(path, `is missing required field ${key}.`);
    }
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalidAnalysisJob(path, "must be a non-empty string.");
  }
  return value;
}

function nullableNonEmptyString(value: unknown, path: string): string | null {
  return value === null ? null : nonEmptyString(value, path);
}

function parseContentIdentity(value: unknown): ContentIdentity {
  const record = asPlainRecord(value, "identity");
  assertExactKeys(
    record,
    CONTENT_IDENTITY_REQUIRED_KEYS,
    CONTENT_IDENTITY_ALLOWED_KEYS,
    "identity",
  );
  const matchedJobId = Object.hasOwn(record, "matchedJobId")
    ? nonEmptyString(record.matchedJobId, "identity.matchedJobId")
    : undefined;
  let offsetMs: number | undefined;
  if (Object.hasOwn(record, "offsetMs")) {
    if (
      typeof record.offsetMs !== "number" ||
      !Number.isSafeInteger(record.offsetMs)
    ) {
      invalidAnalysisJob("identity.offsetMs", "must be a safe integer.");
    }
    offsetMs = record.offsetMs;
  }
  return {
    scheme: nonEmptyString(record.scheme, "identity.scheme"),
    key: nonEmptyString(record.key, "identity.key"),
    ...(matchedJobId === undefined ? {} : { matchedJobId }),
    ...(offsetMs === undefined ? {} : { offsetMs }),
  };
}

/**
 * Parses the only AnalysisJob shape accepted by the current application.
 *
 * This intentionally has no legacy branch. Durable storage must reject an old
 * or partially shaped job instead of allowing it to re-enter the current run.
 */
export function parseAnalysisJob(value: unknown): AnalysisJob {
  const record = asPlainRecord(value, "$");
  assertExactKeys(record, ANALYSIS_JOB_KEYS, ANALYSIS_JOB_KEYS, "$");

  const jobId = nonEmptyString(record.jobId, "jobId");
  const identity = parseContentIdentity(record.identity);
  if (!ANALYSIS_JOB_STATUSES.includes(record.status as AnalysisJobStatus)) {
    invalidAnalysisJob("status", "is not a current job status.");
  }
  const status = record.status as AnalysisJobStatus;
  if (
    record.lastCommittedStage !== null &&
    !ANALYSIS_STAGES.includes(record.lastCommittedStage as AnalysisStage)
  ) {
    invalidAnalysisJob(
      "lastCommittedStage",
      "is not a current analysis stage.",
    );
  }
  const lastCommittedStage = record.lastCommittedStage as AnalysisStage | null;
  if (!STAGE_QUALITIES.includes(record.quality as StageQuality)) {
    invalidAnalysisJob("quality", "is not a current stage quality.");
  }
  const quality = record.quality as StageQuality;
  if (
    !SOURCE_AVAILABILITIES.includes(record.source as SourceAvailability)
  ) {
    invalidAnalysisJob("source", "is not a current source availability.");
  }
  const source = record.source as SourceAvailability;
  const activeRunId = nullableNonEmptyString(
    record.activeRunId,
    "activeRunId",
  );
  if (!Array.isArray(record.runIds)) {
    invalidAnalysisJob("runIds", "must be an array.");
  }
  const runIds = record.runIds.map((runId, index) =>
    nonEmptyString(runId, `runIds[${index}]`),
  );
  if (new Set(runIds).size !== runIds.length) {
    invalidAnalysisJob("runIds", "must not contain duplicate run ids.");
  }
  const lastReasonCode = nullableNonEmptyString(
    record.lastReasonCode,
    "lastReasonCode",
  );

  if (status === "running") {
    if (activeRunId === null || runIds.at(-1) !== activeRunId) {
      invalidAnalysisJob(
        "activeRunId",
        "must be the latest run while the job is running.",
      );
    }
    if (source !== "connected") {
      invalidAnalysisJob(
        "source",
        "must be connected while the job is running.",
      );
    }
  } else if (activeRunId !== null) {
    invalidAnalysisJob(
      "activeRunId",
      "must be null unless the job is running.",
    );
  }

  if (
    (status === "completed" &&
      (quality !== "usable" || lastCommittedStage !== "publication")) ||
    (status === "completedEmpty" &&
      (quality !== "empty" || lastCommittedStage !== "publication"))
  ) {
    invalidAnalysisJob(
      "status",
      "does not match the committed publication quality.",
    );
  }
  if (status === "failed" && lastReasonCode === null) {
    invalidAnalysisJob(
      "lastReasonCode",
      "is required when the job has failed.",
    );
  }

  return {
    jobId,
    identity,
    status,
    lastCommittedStage,
    quality,
    source,
    activeRunId,
    runIds,
    lastReasonCode,
  };
}

export type AnalysisJobEvent =
  | { readonly type: "START"; readonly runId: string }
  | {
      readonly type: "STAGE_COMMITTED";
      readonly runId: string;
      readonly stage: AnalysisStage;
    }
  | { readonly type: "PAUSE"; readonly runId: string }
  | { readonly type: "RESUME"; readonly runId: string }
  | {
      readonly type: "SOURCE_LOST";
      readonly runId: string;
      readonly availability: SourceAvailability;
    }
  | { readonly type: "SOURCE_RECONNECTED"; readonly runId: string }
  | {
      readonly type: "ALL_STAGES_DONE";
      readonly runId: string;
      readonly quality: StageQuality;
    }
  | { readonly type: "FATAL"; readonly runId: string; readonly reasonCode: string }
  | { readonly type: "RETRY"; readonly runId: string }
  | { readonly type: "INVALIDATE"; readonly reasonCode: string }
  | { readonly type: "ABANDON" };

export type AnalysisJobRejectionReason =
  | "terminal_state_absorbing"
  | "undefined_transition"
  | "source_not_available"
  | "another_job_is_running"
  | "run_fence_mismatch"
  | "stage_order_violation"
  | "quality_not_usable"
  | "missing_reason_code";

export type AnalysisJobTransitionOutcome =
  | { readonly accepted: true; readonly job: AnalysisJob }
  | {
      readonly accepted: false;
      readonly job: AnalysisJob;
      readonly reason: AnalysisJobRejectionReason;
    };

export interface CreateAnalysisJobInput {
  readonly jobId: string;
  readonly identity: ContentIdentity;
  readonly source?: SourceAvailability;
}

export function createAnalysisJob(input: CreateAnalysisJobInput): AnalysisJob {
  return {
    jobId: input.jobId,
    identity: input.identity,
    status: "queued",
    lastCommittedStage: null,
    quality: "unknown",
    source: input.source ?? "connected",
    activeRunId: null,
    runIds: [],
    lastReasonCode: null,
  };
}

/** 재개가 시작할 스테이지. 아무것도 커밋되지 않았으면 맨 앞부터. */
export function nextStageToRun(job: AnalysisJob): AnalysisStage | null {
  if (job.lastCommittedStage === null) return ANALYSIS_STAGES[0];
  const index = ANALYSIS_STAGES.indexOf(job.lastCommittedStage);
  return ANALYSIS_STAGES[index + 1] ?? null;
}

/** 남은 스테이지 수. 남은 시간 추정과 "이어서 N분" 표시의 근거가 된다. */
export function remainingStageCount(job: AnalysisJob): number {
  const next = nextStageToRun(job);
  if (next === null) return 0;
  return ANALYSIS_STAGES.length - ANALYSIS_STAGES.indexOf(next);
}

function reject(
  job: AnalysisJob,
  reason: AnalysisJobRejectionReason,
): AnalysisJobTransitionOutcome {
  return { accepted: false, job, reason };
}

function accept(job: AnalysisJob): AnalysisJobTransitionOutcome {
  return { accepted: true, job };
}

/**
 * 전이. **정의되지 않은 전이는 거부한다** — 조용히 무시하면 상태가 어긋난 채
 * 진행되고, 그 어긋남은 한참 뒤에 다른 증상으로 나타난다.
 *
 * `otherRunningJobCount` 는 불변식 1(활성 작업 1개)을 강제하기 위해 호출자가
 * 넘긴다. 브라우저 자원상 두 영상을 동시에 분석하면 둘 다 느려진다.
 */
export function transitionAnalysisJob(
  job: AnalysisJob,
  event: AnalysisJobEvent,
  context: { readonly otherRunningJobCount?: number } = {},
): AnalysisJobTransitionOutcome {
  if (TERMINAL_JOB_STATUSES.has(job.status) && event.type !== "INVALIDATE" && event.type !== "RETRY") {
    return reject(job, "terminal_state_absorbing");
  }

  const others = context.otherRunningJobCount ?? 0;

  switch (event.type) {
    case "START":
    case "RESUME":
    case "SOURCE_RECONNECTED":
    case "RETRY": {
      const from = job.status;
      const allowed =
        (event.type === "START" && from === "queued") ||
        (event.type === "RESUME" && from === "paused") ||
        (event.type === "SOURCE_RECONNECTED" && from === "blocked") ||
        (event.type === "RETRY" && from === "failed");
      if (!allowed) return reject(job, "undefined_transition");
      // 원본 없이는 시작할 수 없다. 낙관적으로 running 으로 보내면 곧바로
      // 실패하면서 사용자에게는 "시작됐다가 죽었다"로 보인다.
      if (job.source !== "connected" && event.type !== "SOURCE_RECONNECTED") {
        return reject(job, "source_not_available");
      }
      if (others > 0) return reject(job, "another_job_is_running");
      return accept({
        ...job,
        status: "running",
        source: "connected",
        activeRunId: event.runId,
        runIds: job.runIds.includes(event.runId) ? job.runIds : [...job.runIds, event.runId],
        lastReasonCode: null,
      });
    }

    case "STAGE_COMMITTED": {
      if (job.status !== "running") return reject(job, "undefined_transition");
      if (job.activeRunId !== event.runId) {
        return reject(job, "run_fence_mismatch");
      }
      const nextExpected = nextStageToRun(job);
      // 스테이지를 건너뛰거나 되돌아가면 거부한다. 순서가 깨진 채 커밋되면
      // 재개 지점이 거짓이 되고, 그 위에서 캐시가 잘못된 산출물을 재사용한다.
      if (nextExpected !== event.stage) return reject(job, "stage_order_violation");
      return accept({ ...job, lastCommittedStage: event.stage });
    }

    case "PAUSE": {
      if (job.status !== "running") return reject(job, "undefined_transition");
      if (job.activeRunId !== event.runId) {
        return reject(job, "run_fence_mismatch");
      }
      return accept({ ...job, status: "paused", activeRunId: null });
    }

    case "SOURCE_LOST": {
      if (job.status !== "running" && job.status !== "paused") {
        return reject(job, "undefined_transition");
      }
      if (job.status === "running" && job.activeRunId !== event.runId) {
        return reject(job, "run_fence_mismatch");
      }
      return accept({
        ...job,
        status: "blocked",
        source: event.availability,
        activeRunId: null,
      });
    }

    case "ALL_STAGES_DONE": {
      if (job.status !== "running") return reject(job, "undefined_transition");
      if (job.activeRunId !== event.runId) {
        return reject(job, "run_fence_mismatch");
      }
      if (nextStageToRun(job) !== null) return reject(job, "stage_order_violation");
      /*
       * A fully verified broadcast may legitimately produce no clips. Keep it
       * terminal but distinguish it from a positive result so the UI never
       * calls a valid negative result "unfinished".
       */
      if (event.quality !== "usable" && event.quality !== "empty") {
        return reject(job, "quality_not_usable");
      }
      return accept({
        ...job,
        status: event.quality === "usable" ? "completed" : "completedEmpty",
        quality: event.quality,
        activeRunId: null,
      });
    }

    case "FATAL": {
      if (job.status !== "running") return reject(job, "undefined_transition");
      if (job.activeRunId !== event.runId) {
        return reject(job, "run_fence_mismatch");
      }
      if (event.reasonCode.length === 0) return reject(job, "missing_reason_code");
      return accept({
        ...job,
        status: "failed",
        activeRunId: null,
        lastReasonCode: event.reasonCode,
      });
    }

    case "INVALIDATE": {
      // 엔진·모델이 바뀌었거나 품질이 미달이면 완료를 되돌린다. 새 작업을 만들지
      // 않고 같은 작업을 `queued` 로 보내야 이력과 식별이 유지된다.
      if (!COMPLETED_JOB_STATUSES.has(job.status)) {
        return reject(job, "undefined_transition");
      }
      if (event.reasonCode.length === 0) return reject(job, "missing_reason_code");
      return accept({
        ...job,
        status: "queued",
        lastCommittedStage: null,
        quality: "unknown",
        activeRunId: null,
        lastReasonCode: event.reasonCode,
      });
    }

    case "ABANDON": {
      if (COMPLETED_JOB_STATUSES.has(job.status)) {
        return reject(job, "undefined_transition");
      }
      return accept({ ...job, status: "abandoned", activeRunId: null });
    }

    default:
      return reject(job, "undefined_transition");
  }
}

/**
 * 자동 정리 대상인가.
 *
 * **미완료는 절대 자동 삭제하지 않는다.** 30일이 지났어도 `paused` · `blocked` 를
 * 지우면 "한 번 들어온 영상은 마무리한다"는 약속을 화면이 스스로 깬다. 대신
 * "N일 방치됨" 을 보여 주고 사용자가 지우게 한다.
 */
export function isEligibleForAutomaticCleanup(
  job: AnalysisJob,
  ageMs: number,
  retentionMs: number,
): boolean {
  if (!COMPLETED_JOB_STATUSES.has(job.status)) return false;
  return ageMs >= retentionMs;
}
