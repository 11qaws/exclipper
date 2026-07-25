import type { AnalysisJobStatus } from "./analysisJob";

/**
 * Which stored analyses may be deleted to stay inside our own budget.
 *
 * The rule that shapes everything else: **unfinished work is never deleted
 * automatically, at any age.** A job that is paused or blocked is a promise the
 * screen made — "this video will get finished" — and a cleanup pass that
 * silently drops it breaks that promise on the app's own initiative. Age is
 * surfaced to the user instead, and they decide.
 *
 * So eviction can only ever choose among `completed` jobs, and the cap can
 * therefore be missed. That is the correct failure: telling the user we are
 * full is honest, deleting their unfinished work to make room is not.
 */

/** 저장된 작업 하나가 차지하는 자리. 정리 판단에 필요한 것만 담는다. */
export interface StoredJobFootprint {
  readonly jobId: string;
  readonly status: AnalysisJobStatus;
  /** 마지막으로 무언가 확정된 시각(epoch ms). 오래된 순서를 정한다. */
  readonly lastActivityAt: number;
  readonly bytes: number;
}

export interface RetentionPolicy {
  /** 우리가 스스로 지키는 상한. */
  readonly capBytes: number;
  /** `completed` 를 이 기간이 지나면 지운다. */
  readonly retentionMs: number;
  /** 미완료를 이 기간이 지나면 "방치됨" 으로 **표시**한다. 지우지 않는다. */
  readonly staleAfterMs: number;
}

/**
 * 기본값. 근거 4컷까지 저장해도 방송당 10~30MB 이므로 2GB 면 100개 이상 들어간다.
 *
 * 오리진당 훨씬 더 쓸 수 있지만, `persist()` 로 승격시키면 축출 대상에서 빠져
 * 디스크를 실제로 점유한다 — 다른 사이트의 저장소가 먼저 밀려난다. 그래서 상한은
 * 브라우저가 아니라 우리가 정한다.
 */
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  capBytes: 2 * 1024 * 1024 * 1024,
  retentionMs: 30 * 24 * 60 * 60 * 1000,
  staleAfterMs: 30 * 24 * 60 * 60 * 1000,
};

export type EvictionReason = "abandoned" | "past_retention" | "over_cap";

export interface PlannedEviction {
  readonly jobId: string;
  readonly reason: EvictionReason;
  readonly bytes: number;
}

export interface RetentionPlan {
  /** 지울 것. 오래된 순. */
  readonly evict: readonly PlannedEviction[];
  /** 오래됐지만 **미완료라 지우지 않는** 것. 화면이 "N일 방치됨" 을 붙인다. */
  readonly flagStale: readonly string[];
  readonly bytesBefore: number;
  readonly bytesAfter: number;
  /**
   * 지울 수 있는 것을 다 지워도 상한을 넘는가. 남은 것이 전부 미완료라는 뜻이므로
   * 더 지울 수 없다 — 화면이 사용자에게 알리고 직접 고르게 해야 한다.
   */
  readonly stillOverCap: boolean;
}

/** 자동 삭제 대상이 될 수 있는 상태. 나머지는 나이와 무관하게 보호된다. */
function isEvictable(status: AnalysisJobStatus): boolean {
  // `failed` 는 제외한다 — RETRY 로 이어갈 수 있는 미완료 작업이다.
  return status === "completed";
}

function sumBytes(jobs: readonly StoredJobFootprint[]): number {
  return jobs.reduce((total, job) => total + job.bytes, 0);
}

/**
 * 무엇을 지우고 무엇을 표시만 할지 계산한다. 순수 함수 — 실제 삭제는 하지 않는다.
 *
 * 순서: ① 버려진 것 즉시 → ② 보존 기간 지난 `completed` → ③ 그래도 상한을 넘으면
 * 남은 `completed` 를 오래된 것부터.
 */
export function planRetention(
  jobs: readonly StoredJobFootprint[],
  now: number,
  policy: RetentionPolicy = DEFAULT_RETENTION_POLICY,
): RetentionPlan {
  const bytesBefore = sumBytes(jobs);
  const evict: PlannedEviction[] = [];
  const evicted = new Set<string>();

  const oldestFirst = [...jobs].sort((a, b) => a.lastActivityAt - b.lastActivityAt);

  // ① 버려진 것은 나이를 보지 않는다. 사용자가 이미 버린다고 말했다.
  for (const job of oldestFirst) {
    if (job.status !== "abandoned") continue;
    evict.push({ jobId: job.jobId, reason: "abandoned", bytes: job.bytes });
    evicted.add(job.jobId);
  }

  // ② 보존 기간이 지난 완료본.
  for (const job of oldestFirst) {
    if (evicted.has(job.jobId) || !isEvictable(job.status)) continue;
    if (now - job.lastActivityAt < policy.retentionMs) continue;
    evict.push({ jobId: job.jobId, reason: "past_retention", bytes: job.bytes });
    evicted.add(job.jobId);
  }

  // ③ 아직 상한을 넘으면 남은 완료본을 오래된 것부터.
  //
  // 단, **상한에 도달할 수 없으면 아무것도 지우지 않는다.** 보호 대상만으로 이미
  // 상한을 넘는 경우인데, 여기서 완료본을 지워봐야 여전히 초과 상태이고 사용자의
  // 멀쩡한 분석 결과만 사라진다. 목적을 달성하지 못하는 되돌릴 수 없는 삭제는
  // 하지 않는다 — 대신 `stillOverCap` 으로 알리고 사용자가 고르게 한다.
  let remaining = bytesBefore - evict.reduce((total, one) => total + one.bytes, 0);
  const protectedBytes = sumBytes(
    jobs.filter((job) => !evicted.has(job.jobId) && !isEvictable(job.status)),
  );
  if (protectedBytes <= policy.capBytes) {
    for (const job of oldestFirst) {
      if (remaining <= policy.capBytes) break;
      if (evicted.has(job.jobId) || !isEvictable(job.status)) continue;
      evict.push({ jobId: job.jobId, reason: "over_cap", bytes: job.bytes });
      evicted.add(job.jobId);
      remaining -= job.bytes;
    }
  }

  // 오래된 미완료는 지우는 대신 표시한다. 지우면 "마무리한다" 는 약속이 깨진다.
  const flagStale = oldestFirst
    .filter(
      (job) =>
        !evicted.has(job.jobId) &&
        !isEvictable(job.status) &&
        job.status !== "running" &&
        now - job.lastActivityAt >= policy.staleAfterMs,
    )
    .map((job) => job.jobId);

  return {
    evict,
    flagStale,
    bytesBefore,
    bytesAfter: remaining,
    stillOverCap: remaining > policy.capBytes,
  };
}

/** 화면에 "N일 방치됨" 으로 쓸 값. */
export function idleDays(job: StoredJobFootprint, now: number): number {
  return Math.floor((now - job.lastActivityAt) / (24 * 60 * 60 * 1000));
}
