import { describe, expect, it } from "vitest";

import { selectCandidateVerificationCohort } from "./candidateVerificationCohort";

const candidates = Array.from({ length: 17 }, (_, index) => ({
  id: `candidate-${index + 1}`,
}));
const allCandidateIds = new Set(candidates.map(({ id }) => id));
const paidDetailIds = new Set(candidates.slice(0, 12).map(({ id }) => id));

describe("selectCandidateVerificationCohort", () => {
  it("does not drop context-qualified candidates outside one detail batch", () => {
    const contextByCandidateId = Object.fromEntries(
      candidates.map(({ id }) => [id, { context: true }]),
    );

    const result = selectCandidateVerificationCohort({
      candidates,
      contextScheduledCandidateIds: allCandidateIds,
      contextExcludedCandidateIds: new Set(),
      detailScheduledCandidateIds: paidDetailIds,
      contextByCandidateId,
    });

    expect(result.map(({ id }) => id)).toEqual(
      candidates.map(({ id }) => id),
    );
  });

  it("keeps genuine context packet omissions fail-closed", () => {
    const contextByCandidateId = Object.fromEntries(
      candidates.slice(0, 12).map(({ id }) => [id, { context: true }]),
    );

    const result = selectCandidateVerificationCohort({
      candidates,
      contextScheduledCandidateIds: allCandidateIds,
      contextExcludedCandidateIds: new Set(),
      detailScheduledCandidateIds: paidDetailIds,
      contextByCandidateId,
    });

    expect(result).toHaveLength(17);
  });

  it("retains explicit whole-context exclusions for non-error reporting", () => {
    const excludedId = candidates[16]!.id;
    const result = selectCandidateVerificationCohort({
      candidates,
      contextScheduledCandidateIds: allCandidateIds,
      contextExcludedCandidateIds: new Set([excludedId]),
      detailScheduledCandidateIds: paidDetailIds,
      contextByCandidateId: Object.fromEntries(
        candidates.map(({ id }) => [id, { context: true }]),
      ),
    });

    expect(result.map(({ id }) => id)).toContain(excludedId);
  });
});
