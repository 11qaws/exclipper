import {
  DEFAULT_RETENTION_POLICY,
  type RetentionPolicy,
} from "../domain/storageRetention";

/**
 * What the browser will let us keep, and what we have chosen to keep.
 *
 * Two numbers that are easy to confuse. `navigator.storage.estimate()` reports
 * the **whole origin** — our database plus the HTTP cache, any service worker,
 * everything. Our own footprint is the sum of the job records we wrote. Showing
 * the origin number as "your analyses are using X" would be wrong, sometimes by
 * a lot, so both are reported separately and labelled.
 */

export interface StorageReport {
  /** 우리가 저장한 작업들의 합. 화면에 "분석 N개 · X GB" 로 쓰는 값. */
  readonly ownBytes: number;
  /** 우리가 스스로 지키는 상한. */
  readonly capBytes: number;
  /** 오리진 전체 사용량. 브라우저가 보는 값이며 우리 것만이 아니다. */
  readonly originUsageBytes: number | null;
  /** 브라우저가 이 오리진에 허용하는 총량. */
  readonly originQuotaBytes: number | null;
  /**
   * 축출 대상에서 빠졌는가. `false` 면 디스크가 부족할 때 브라우저가 우리
   * 데이터를 말없이 지울 수 있다.
   */
  readonly persisted: boolean;
}

/** 브라우저가 이 API 자체를 안 줄 수 있다(오래된 사파리 등). */
function storageManager(): StorageManager | null {
  if (typeof navigator === "undefined") return null;
  const manager = navigator.storage;
  return typeof manager?.estimate === "function" ? manager : null;
}

/**
 * 축출 방지를 요청한다.
 *
 * 브라우저마다 다르게 처리한다 — Chromium 은 사용 이력을 보고 조용히 판단하고,
 * Firefox 는 사용자에게 묻는다. **거부돼도 실패가 아니다**: 데이터는 그대로
 * 저장되고, 디스크가 부족할 때 축출될 수 있다는 것뿐이다. 그래서 실패를 던지지
 * 않고 결과만 돌려준다.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  const manager = storageManager();
  if (manager === null || typeof manager.persist !== "function") return false;
  try {
    if (await manager.persisted()) return true;
    return await manager.persist();
  } catch {
    return false;
  }
}

export async function readStorageReport(
  ownBytes: number,
  policy: RetentionPolicy = DEFAULT_RETENTION_POLICY,
): Promise<StorageReport> {
  const manager = storageManager();
  const base = {
    ownBytes,
    capBytes: policy.capBytes,
    originUsageBytes: null,
    originQuotaBytes: null,
    persisted: false,
  } as const;

  if (manager === null) return base;

  try {
    const [estimate, persisted] = await Promise.all([
      manager.estimate(),
      typeof manager.persisted === "function" ? manager.persisted() : Promise.resolve(false),
    ]);
    return {
      ...base,
      originUsageBytes: estimate.usage ?? null,
      originQuotaBytes: estimate.quota ?? null,
      persisted,
    };
  } catch {
    return base;
  }
}

/**
 * 상한에 얼마나 찼나. 화면의 게이지가 쓴다.
 *
 * 상한을 넘으면 1 을 넘는 값이 나온다 — 잘라내지 않는다. 초과는 실제로 일어날 수
 * 있고(§ 미완료는 지우지 않는다), 게이지가 100% 에서 멈추면 그 사실이 숨는다.
 */
export function capFraction(report: StorageReport): number {
  if (report.capBytes <= 0) return 0;
  return report.ownBytes / report.capBytes;
}

/**
 * 브라우저 쪽이 먼저 막을 상황인가.
 *
 * 우리 상한이 2GB 라도 기기 디스크가 거의 찼다면 브라우저 허용치가 그보다 작을 수
 * 있다. 그때는 우리 게이지가 여유롭게 보여도 쓰기가 실패하므로 따로 알려야 한다.
 */
export function browserQuotaIsTighterThanCap(report: StorageReport): boolean {
  if (report.originQuotaBytes === null) return false;
  return report.originQuotaBytes < report.capBytes;
}
