import { describe, expect, it } from "vitest";

import { selectBroadcastContextCandidateCohort } from "./broadcastContextCandidateCohort";

describe("selectBroadcastContextCandidateCohort", () => {
  it("keeps every candidate in the observed 17-candidate regression", () => {
    const candidates = Array.from({ length: 17 }, (_, index) => ({
      id: `candidate-${index + 1}`,
    }));

    expect(selectBroadcastContextCandidateCohort(candidates)).toHaveLength(17);
  });

  it("uses the protocol bound instead of an unrelated paid-detail bound", () => {
    const candidates = Array.from({ length: 40 }, (_, index) => ({
      id: `candidate-${index + 1}`,
    }));

    expect(selectBroadcastContextCandidateCohort(candidates)).toHaveLength(32);
  });
});
