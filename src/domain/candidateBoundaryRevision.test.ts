import { describe, expect, it } from "vitest";

import {
  applyCandidateBoundaryCommand,
  createCandidateBoundaryRevision,
  effectiveCandidateRange,
} from "./candidateBoundaryRevision";

function initial(candidateId = "candidate-1") {
  return createCandidateBoundaryRevision({
    boundarySessionId: "boundary-session-1",
    candidateId,
    proposalRange: { startMs: 60_000, endMs: 105_000 },
    peakMs: 88_000,
    sourceDurationMs: 4 * 60 * 60 * 1_000,
  });
}

describe("candidate boundary revision happy path", () => {
  it("keeps the AI proposal immutable while the user adjusts one boundary", () => {
    const state = initial();
    const transition = applyCandidateBoundaryCommand(state, {
      boundarySessionId: state.boundarySessionId,
      candidateId: state.candidateId,
      expectedRevision: 0,
      kind: "SHIFT_START",
      deltaMs: -5_000,
    });

    expect(transition.status).toBe("applied");
    if (transition.status !== "applied") return;
    expect(state.proposalRange).toEqual({ startMs: 60_000, endMs: 105_000 });
    expect(state.effectiveRange).toEqual(state.proposalRange);
    expect(transition.state).toMatchObject({
      revision: 1,
      provenance: "userAdjusted",
      proposalRange: { startMs: 60_000, endMs: 105_000 },
      effectiveRange: { startMs: 55_000, endMs: 105_000 },
    });
  });

  it("supports the four beginner-friendly 5-second boundary actions", () => {
    let state = initial();
    const commands = [
      { kind: "SHIFT_START" as const, deltaMs: -5_000 as const },
      { kind: "SHIFT_START" as const, deltaMs: 5_000 as const },
      { kind: "SHIFT_END" as const, deltaMs: 5_000 as const },
      { kind: "SHIFT_END" as const, deltaMs: -5_000 as const },
    ];

    for (const command of commands) {
      const transition = applyCandidateBoundaryCommand(state, {
        ...command,
        boundarySessionId: state.boundarySessionId,
        candidateId: state.candidateId,
        expectedRevision: state.revision,
      });
      expect(transition.status).toBe("applied");
      if (transition.status === "applied") state = transition.state;
    }

    expect(state.revision).toBe(4);
    expect(state.effectiveRange).toEqual(state.proposalRange);
    expect(state.provenance).toBe("userAdjusted");
  });

  it("uses the active player's exact position and can explicitly restore the AI range", () => {
    const state = initial();
    const moved = applyCandidateBoundaryCommand(state, {
      boundarySessionId: state.boundarySessionId,
      candidateId: state.candidateId,
      expectedRevision: 0,
      kind: "SET_START_FROM_PLAYER",
      playerMs: 55_250,
    });
    expect(moved.status).toBe("applied");
    if (moved.status !== "applied") return;

    const reset = applyCandidateBoundaryCommand(moved.state, {
      boundarySessionId: moved.state.boundarySessionId,
      candidateId: moved.state.candidateId,
      expectedRevision: moved.state.revision,
      kind: "RESET_TO_AI",
    });
    expect(reset.status).toBe("applied");
    if (reset.status !== "applied") return;
    expect(reset.state).toMatchObject({
      revision: 2,
      provenance: "userResetToAi",
      effectiveRange: { startMs: 60_000, endMs: 105_000 },
    });
  });

  it("projects each of several candidates through only its own revision", () => {
    const first = initial("candidate-1");
    const second = initial("candidate-2");
    const moved = applyCandidateBoundaryCommand(first, {
      boundarySessionId: first.boundarySessionId,
      candidateId: first.candidateId,
      expectedRevision: 0,
      kind: "SHIFT_END",
      deltaMs: 5_000,
    });
    expect(moved.status).toBe("applied");
    if (moved.status !== "applied") return;

    expect(
      effectiveCandidateRange(
        { id: "candidate-1", startMs: 60_000, endMs: 105_000 },
        moved.state,
      ),
    ).toEqual({ startMs: 60_000, endMs: 110_000 });
    expect(
      effectiveCandidateRange(
        { id: "candidate-2", startMs: 60_000, endMs: 105_000 },
        second,
      ),
    ).toEqual({ startMs: 60_000, endMs: 105_000 });
  });
});
