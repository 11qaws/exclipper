import { describe, expect, it } from "vitest";

import type { UnfinishedJobSummary } from "./unfinishedJobSummary";
import {
  dismissSheet,
  INITIAL_SHEET_VISIBILITY,
  openSheet,
  reconcileSheetVisibility,
  unfinishedSignature,
} from "./unfinishedJobsVisibility";

function row(
  jobId: string,
  overrides: Partial<UnfinishedJobSummary> = {},
): UnfinishedJobSummary {
  return {
    jobId,
    title: jobId,
    percent: 50,
    remainingLabel: "약 8분",
    fromScratchLabel: "처음부터 약 25분",
    action: "resume",
    actionLabel: "이어서 하기",
    blockedReason: null,
    ...overrides,
  };
}

describe("unfinished sheet visibility", () => {
  it("opens itself the first time there is something to resume", () => {
    const next = reconcileSheetVisibility(INITIAL_SHEET_VISIBILITY, [row("a")]);
    expect(next.open).toBe(true);
    expect(next.chipCount).toBe(1);
  });

  it("stays closed after being dismissed", () => {
    // 닫았는데 다시 뜨면 사용자는 이 패널을 무시하는 법을 배운다.
    const rows = [row("a"), row("b")];
    const dismissed = dismissSheet(rows);
    expect(reconcileSheetVisibility(dismissed, rows).open).toBe(false);
  });

  it("leaves a chip behind so the way in never disappears", () => {
    // 접근 경로까지 사라지면 "가끔 사라지는 분석" 이 된다.
    const rows = [row("a"), row("b")];
    const dismissed = dismissSheet(rows);
    expect(dismissed.open).toBe(false);
    expect(dismissed.chipCount).toBe(2);
  });

  it("reopens when a new unfinished job appears", () => {
    const rows = [row("a")];
    const dismissed = dismissSheet(rows);
    expect(reconcileSheetVisibility(dismissed, [row("a"), row("b")]).open).toBe(true);
  });

  it("reopens when one of them finishes and leaves the list", () => {
    const rows = [row("a"), row("b")];
    const dismissed = dismissSheet(rows);
    expect(reconcileSheetVisibility(dismissed, [row("a")]).open).toBe(true);
  });

  it("reopens when a job needs the file reconnected", () => {
    // 무엇을 해야 하는지가 바뀐 것은 알릴 값어치가 있다.
    const rows = [row("a")];
    const dismissed = dismissSheet(rows);
    const blocked = [row("a", { action: "reconnect", actionLabel: "연결하고 이어서" })];
    expect(reconcileSheetVisibility(dismissed, blocked).open).toBe(true);
  });

  it("does not reopen just because progress moved", () => {
    // 진행률은 계속 오른다. 그때마다 끼어들면 그것이 잔소리다.
    const rows = [row("a", { percent: 20, remainingLabel: "약 18분" })];
    const dismissed = dismissSheet(rows);
    const later = [row("a", { percent: 80, remainingLabel: "약 4분" })];
    expect(reconcileSheetVisibility(dismissed, later).open).toBe(false);
  });

  it("ignores the order the jobs arrive in", () => {
    const rows = [row("a"), row("b")];
    const dismissed = dismissSheet(rows);
    expect(reconcileSheetVisibility(dismissed, [row("b"), row("a")]).open).toBe(false);
    expect(unfinishedSignature([row("a"), row("b")])).toBe(
      unfinishedSignature([row("b"), row("a")]),
    );
  });

  it("removes the chip once nothing is left to resume", () => {
    // 아무것도 없는데 칩만 남으면 눌러도 빈 패널이 열린다.
    const rows = [row("a")];
    const dismissed = dismissSheet(rows);
    const empty = reconcileSheetVisibility(dismissed, []);
    expect(empty.chipCount).toBe(0);
    expect(empty.open).toBe(false);
  });

  it("stays open once the user opens it from the chip", () => {
    const rows = [row("a")];
    const dismissed = dismissSheet(rows);
    const reopened = openSheet(dismissed);
    expect(reopened.open).toBe(true);
    expect(reconcileSheetVisibility(reopened, rows).open).toBe(true);
  });
});
