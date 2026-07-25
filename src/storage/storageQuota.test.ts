import { afterEach, describe, expect, it, vi } from "vitest";

import {
  browserQuotaIsTighterThanCap,
  capFraction,
  readStorageReport,
  requestPersistentStorage,
  type StorageReport,
} from "./storageQuota";

const GB = 1024 * 1024 * 1024;

function stubStorageManager(manager: unknown): void {
  vi.stubGlobal("navigator", { storage: manager });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function report(overrides: Partial<StorageReport> = {}): StorageReport {
  return {
    ownBytes: 0,
    capBytes: 2 * GB,
    originUsageBytes: null,
    originQuotaBytes: null,
    persisted: false,
    ...overrides,
  };
}

describe("storage quota", () => {
  describe("reading the report", () => {
    it("keeps our own footprint separate from the origin's", () => {
      // 오리진 사용량에는 HTTP 캐시·서비스워커가 다 들어 있다. 그것을 "분석이
      // 쓰는 용량" 으로 보여 주면 크게 틀린다.
      stubStorageManager({
        estimate: () => Promise.resolve({ usage: 5 * GB, quota: 60 * GB }),
        persisted: () => Promise.resolve(true),
      });
      return readStorageReport(1 * GB).then((result) => {
        expect(result.ownBytes).toBe(1 * GB);
        expect(result.originUsageBytes).toBe(5 * GB);
        expect(result.originQuotaBytes).toBe(60 * GB);
        expect(result.persisted).toBe(true);
      });
    });

    it("still reports our own footprint when the API is missing", () => {
      // API 가 없다고 화면이 용량을 못 보여 주면 안 된다 — 우리 숫자는 우리가 안다.
      stubStorageManager(undefined);
      return readStorageReport(1 * GB).then((result) => {
        expect(result.ownBytes).toBe(1 * GB);
        expect(result.originUsageBytes).toBeNull();
        expect(result.persisted).toBe(false);
      });
    });

    it("survives an API that throws", async () => {
      stubStorageManager({
        estimate: () => Promise.reject(new Error("denied")),
        persisted: () => Promise.resolve(false),
      });
      const result = await readStorageReport(7);
      expect(result.ownBytes).toBe(7);
      expect(result.originUsageBytes).toBeNull();
    });
  });

  describe("requesting persistence", () => {
    it("does not ask again when already granted", async () => {
      const persist = vi.fn(() => Promise.resolve(true));
      stubStorageManager({ estimate: () => Promise.resolve({}), persisted: () => Promise.resolve(true), persist });
      expect(await requestPersistentStorage()).toBe(true);
      expect(persist).not.toHaveBeenCalled();
    });

    it("treats a refusal as a fact, not a failure", async () => {
      // 거부돼도 데이터는 저장된다. 축출될 수 있다는 것뿐이므로 던지지 않는다.
      stubStorageManager({
        estimate: () => Promise.resolve({}),
        persisted: () => Promise.resolve(false),
        persist: () => Promise.resolve(false),
      });
      expect(await requestPersistentStorage()).toBe(false);
    });

    it("returns false when the browser has no such API", async () => {
      stubStorageManager({ estimate: () => Promise.resolve({}) });
      expect(await requestPersistentStorage()).toBe(false);
    });
  });

  describe("the gauge", () => {
    it("reports the fraction of our own cap", () => {
      expect(capFraction(report({ ownBytes: 1 * GB, capBytes: 2 * GB }))).toBe(0.5);
    });

    it("goes past one rather than clamping when over the cap", () => {
      // 미완료를 지키느라 상한을 넘는 일이 실제로 있다. 게이지가 100% 에서 멈추면
      // 그 사실이 숨는다.
      expect(capFraction(report({ ownBytes: 3 * GB, capBytes: 2 * GB }))).toBe(1.5);
    });

    it("flags a browser quota tighter than our cap", () => {
      // 디스크가 거의 찬 기기에서는 우리 게이지가 여유로워도 쓰기가 실패한다.
      expect(browserQuotaIsTighterThanCap(report({ originQuotaBytes: 1 * GB }))).toBe(true);
      expect(browserQuotaIsTighterThanCap(report({ originQuotaBytes: 40 * GB }))).toBe(false);
      expect(browserQuotaIsTighterThanCap(report())).toBe(false);
    });
  });
});
