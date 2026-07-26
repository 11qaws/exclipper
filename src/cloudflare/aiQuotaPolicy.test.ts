import { describe, expect, it } from "vitest";

import type { AiQuotaOperationIdentity } from "../analysis/aiQuotaProtocol";
import {
  AI_QUOTA_LEASE_TTL_MS,
  AI_QUOTA_MAX_OPERATIONS,
  AI_QUOTA_OPERATION_RETENTION_TARGET,
  AI_QUOTA_POOL_POLICY,
  AI_QUOTA_PROVIDER_GATE_POLICY,
  AI_QUOTA_QUEUED_TTL_MS,
  applyAiQuotaInternalRequest,
  createAiQuotaCoordinatorState,
  inspectAiQuotaState,
  requestAiQuotaLease,
} from "./aiQuotaPolicy";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

function identity(
  participantOrdinal: number,
  operationOrdinal: number,
  overrides: Partial<AiQuotaOperationIdentity> = {},
): AiQuotaOperationIdentity {
  return {
    participantId: `participant-${String(participantOrdinal).padStart(4, "0")}`,
    runId: "analysis-run-0001",
    operationId: `operation-${String(operationOrdinal).padStart(4, "0")}`,
    pool: "transcript",
    payloadDigest: DIGEST_A,
    ...overrides,
  };
}

function tokenFactory(): () => string {
  let ordinal = 0;
  return () => `lease_${String(++ordinal).padStart(40, "0")}`;
}

describe("five-user AI quota coordinator policy", () => {
  it("admits five participants and rejects the sixth without mutating state", () => {
    const state = createAiQuotaCoordinatorState();
    const createToken = tokenFactory();
    for (let participant = 1; participant <= 5; participant += 1) {
      const response = requestAiQuotaLease(
        state,
        identity(participant, 1),
        participant,
        createToken,
      );
      expect(["granted", "queued"]).toContain(response.status);
    }

    const before = structuredClone(state);
    const sixth = requestAiQuotaLease(
      state,
      identity(6, 1),
      10,
      createToken,
    );

    expect(sixth).toMatchObject({
      status: "capacity-full",
      activeParticipantCount: 5,
    });
    expect(state).toEqual(before);
  });

  it("counts two tabs with the same participant and run as one participant", () => {
    const state = createAiQuotaCoordinatorState();
    const createToken = tokenFactory();
    requestAiQuotaLease(state, identity(1, 1), 0, createToken);
    requestAiQuotaLease(state, identity(1, 2), 1, createToken);

    expect(inspectAiQuotaState(state, 1).activeParticipantCount).toBe(1);
    expect(
      Object.values(state.operations).filter(
        (operation) => operation.participantId === identity(1, 1).participantId,
      ),
    ).toHaveLength(2);
  });

  it("rejects a second run while the participant still has open work", () => {
    const state = createAiQuotaCoordinatorState();
    const createToken = tokenFactory();
    requestAiQuotaLease(state, identity(1, 1), 0, createToken);

    const response = requestAiQuotaLease(
      state,
      identity(1, 2, { runId: "analysis-run-0002" }),
      1,
      createToken,
    );

    expect(response).toMatchObject({
      status: "conflict",
      reason: "RUN_CONFLICT",
    });
  });

  it("returns the same unconsumed lease for an idempotent poll", () => {
    const state = createAiQuotaCoordinatorState();
    const createToken = tokenFactory();
    const operation = identity(1, 1);
    const first = requestAiQuotaLease(state, operation, 0, createToken);
    const second = requestAiQuotaLease(state, operation, 1, createToken);

    expect(first.status).toBe("granted");
    expect(second.status).toBe("granted");
    if (first.status === "granted" && second.status === "granted") {
      expect(second.leaseToken).toBe(first.leaseToken);
      expect(second.leaseExpiresAtMs).toBe(first.leaseExpiresAtMs);
    }
  });

  it("uses a two-second public queue poll to bound Durable Object requests", () => {
    const state = createAiQuotaCoordinatorState();
    const createToken = tokenFactory();
    for (let ordinal = 1; ordinal <= 6; ordinal += 1) {
      expect(
        requestAiQuotaLease(
          state,
          identity(1, ordinal, { pool: "candidate" }),
          0,
          createToken,
        ).status,
      ).toBe("granted");
    }
    expect(
      requestAiQuotaLease(
        state,
        identity(1, 7, { pool: "candidate" }),
        0,
        createToken,
      ),
    ).toMatchObject({ status: "queued", retryAfterMs: 2_000 });
  });

  it("can prepare one candidate upload for each of five active participants", () => {
    const state = createAiQuotaCoordinatorState();
    const createToken = tokenFactory();
    const statuses = Array.from({ length: 5 }, (_, index) =>
      requestAiQuotaLease(
        state,
        identity(index + 1, 1, { pool: "candidate" }),
        0,
        createToken,
      ).status,
    );
    expect(statuses).toEqual([
      "granted",
      "granted",
      "granted",
      "granted",
      "granted",
    ]);
    expect(AI_QUOTA_POOL_POLICY.candidate.maxInFlight).toBe(4);
  });

  it("rejects operation ID reuse with a different payload digest", () => {
    const state = createAiQuotaCoordinatorState();
    const createToken = tokenFactory();
    requestAiQuotaLease(state, identity(1, 1), 0, createToken);

    const response = requestAiQuotaLease(
      state,
      identity(1, 1, { payloadDigest: DIGEST_B }),
      1,
      createToken,
    );

    expect(response).toMatchObject({
      status: "conflict",
      reason: "OPERATION_CONFLICT",
    });
  });

  it("enforces a single-use lease through inspect, consume, and completion", () => {
    const state = createAiQuotaCoordinatorState();
    const operation = identity(1, 1);
    const lease = requestAiQuotaLease(state, operation, 0, tokenFactory());
    expect(lease.status).toBe("granted");
    if (lease.status !== "granted") throw new Error("expected a lease");

    expect(
      applyAiQuotaInternalRequest(
        state,
        { action: "inspect", ...operation, leaseToken: lease.leaseToken },
        1,
      ),
    ).toEqual({ ok: true, status: "valid" });
    expect(
      applyAiQuotaInternalRequest(
        state,
        { action: "consume", ...operation, leaseToken: lease.leaseToken },
        2,
      ),
    ).toEqual({ ok: true, status: "consumed" });
    expect(
      applyAiQuotaInternalRequest(
        state,
        { action: "consume", ...operation, leaseToken: lease.leaseToken },
        3,
      ),
    ).toEqual({ ok: false, status: "already-consumed" });
    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "complete",
          ...operation,
          leaseToken: lease.leaseToken,
          outcome: "succeeded",
        },
        4,
      ),
    ).toEqual({ ok: true, status: "completed" });
    expect(
      applyAiQuotaInternalRequest(
        state,
        { action: "inspect", ...operation, leaseToken: lease.leaseToken },
        5,
      ),
    ).toEqual({ ok: false, status: "mismatch" });
  });

  it("atomically releases only an unconsumed upload ticket", () => {
    const state = createAiQuotaCoordinatorState();
    const operation = identity(1, 1);
    const lease = requestAiQuotaLease(state, operation, 0, tokenFactory());
    expect(lease.status).toBe("granted");
    if (lease.status !== "granted") throw new Error("expected a lease");

    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "release-upload",
          ...operation,
          leaseToken: lease.leaseToken,
        },
        1,
      ),
    ).toEqual({ ok: true, status: "released" });
    expect(Object.values(state.operations)[0]?.status).toBe("cancelled");
  });

  it("does not let a late invalid duplicate cancel an execution waiter", () => {
    const state = createAiQuotaCoordinatorState();
    const createToken = tokenFactory();
    const firstOperation = identity(1, 1);
    const waitingOperation = identity(1, 2);
    const firstLease = requestAiQuotaLease(
      state,
      firstOperation,
      0,
      createToken,
    );
    const waitingLease = requestAiQuotaLease(
      state,
      waitingOperation,
      0,
      createToken,
    );
    expect(firstLease.status).toBe("granted");
    expect(waitingLease.status).toBe("granted");
    if (firstLease.status !== "granted" || waitingLease.status !== "granted") {
      throw new Error("expected two leases");
    }

    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "consume",
          ...firstOperation,
          leaseToken: firstLease.leaseToken,
          tokenReservation: 1,
        },
        0,
      ),
    ).toEqual({ ok: true, status: "consumed" });
    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "consume",
          ...waitingOperation,
          leaseToken: waitingLease.leaseToken,
          tokenReservation: 1,
        },
        1,
      ),
    ).toMatchObject({ ok: false, status: "not-ready" });

    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "release-upload",
          ...waitingOperation,
          leaseToken: waitingLease.leaseToken,
        },
        2,
      ),
    ).toEqual({ ok: false, status: "already-consumed" });
    expect(
      Object.values(state.operations).find(
        ({ operationId }) =>
          operationId === waitingOperation.operationId,
      )?.status,
    ).toBe("execution-waiting");
  });

  it("round-robins 50 mixed transcript and candidate consumes across five backlogged participants", () => {
    const state = createAiQuotaCoordinatorState();
    const createToken = tokenFactory();
    const operations: AiQuotaOperationIdentity[] = [];
    for (
      let operationOrdinal = 1;
      operationOrdinal <= 10;
      operationOrdinal += 1
    ) {
      for (let participant = 1; participant <= 5; participant += 1) {
        const operation = identity(participant, operationOrdinal, {
          pool:
            (participant + operationOrdinal) % 2 === 0
              ? "candidate"
              : "transcript",
        });
        operations.push(operation);
        expect(
          requestAiQuotaLease(state, operation, 0, createToken).status,
        ).toMatch(/^(granted|queued)$/u);
      }
    }

    const consumeOrder: string[] = [];
    const consumeTimes: number[] = [];
    const consumedPools = new Set<AiQuotaOperationIdentity["pool"]>();
    const consumedSequencesByParticipant = new Map<string, number[]>();
    const interval =
      AI_QUOTA_PROVIDER_GATE_POLICY["qwen-omni"].minimumStartIntervalMs;

    for (let consumeOrdinal = 0; consumeOrdinal < 50; consumeOrdinal += 1) {
      const nowMs = consumeOrdinal * interval;

      // Refill each participant's bounded upload-ticket window. Public ticket
      // issuance is intentionally independent from the paid execution clock.
      for (const operation of operations) {
        const record = Object.values(state.operations).find(
          (candidate) =>
            candidate.participantId === operation.participantId &&
            candidate.operationId === operation.operationId &&
            candidate.pool === operation.pool,
        );
        if (record?.status === "queued") {
          requestAiQuotaLease(state, operation, nowMs, createToken);
        }
      }

      let started:
        | {
            readonly operation: (typeof state.operations)[string];
            readonly leaseToken: string;
          }
        | undefined;
      const ticketHolders = Object.values(state.operations).filter(
        (operation) =>
          operation.status === "lease-issued" ||
          operation.status === "execution-waiting",
      );
      for (const operation of ticketHolders) {
        const leaseToken = operation.leaseToken;
        expect(leaseToken).not.toBeNull();
        if (leaseToken === null) throw new Error("ticket must have a token");
        const response = applyAiQuotaInternalRequest(
          state,
          {
            action: "consume",
            participantId: operation.participantId,
            runId: operation.runId,
            operationId: operation.operationId,
            pool: operation.pool,
            payloadDigest: operation.payloadDigest,
            leaseToken,
            tokenReservation: 1,
          },
          nowMs,
        );
        if (response.ok) {
          expect(started).toBeUndefined();
          started = { operation, leaseToken };
        } else {
          expect(response.status).toBe("not-ready");
        }
      }

      expect(started).toBeDefined();
      if (started === undefined) throw new Error("one consume must start");
      consumeOrder.push(started.operation.participantId);
      consumeTimes.push(nowMs);
      consumedPools.add(started.operation.pool);
      const participantSequences =
        consumedSequencesByParticipant.get(started.operation.participantId) ??
        [];
      participantSequences.push(started.operation.enqueuedSequence);
      consumedSequencesByParticipant.set(
        started.operation.participantId,
        participantSequences,
      );
      expect(
        applyAiQuotaInternalRequest(
          state,
          {
            action: "complete",
            ...started.operation,
            leaseToken: started.leaseToken,
            outcome: "succeeded",
          },
          nowMs,
        ),
      ).toEqual({ ok: true, status: "completed" });
    }

    expect(consumeOrder).toHaveLength(50);
    for (let index = 1; index < consumeTimes.length; index += 1) {
      expect(
        (consumeTimes[index] ?? 0) - (consumeTimes[index - 1] ?? 0),
      ).toBe(interval);
    }
    for (let offset = 0; offset < consumeOrder.length; offset += 5) {
      expect(new Set(consumeOrder.slice(offset, offset + 5))).toEqual(
        new Set([
          identity(1, 1).participantId,
          identity(2, 1).participantId,
          identity(3, 1).participantId,
          identity(4, 1).participantId,
          identity(5, 1).participantId,
        ]),
      );
    }
    expect(consumedPools).toEqual(new Set(["transcript", "candidate"]));
    for (const sequences of consumedSequencesByParticipant.values()) {
      expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
    }
  });

  it("shares six provider slots across four candidate and two transcript calls while context stays independent", () => {
    const state = createAiQuotaCoordinatorState();
    const createToken = tokenFactory();
    const qwenOperations = [
      identity(1, 101, { pool: "candidate" }),
      identity(2, 101, { pool: "candidate" }),
      identity(3, 101, { pool: "candidate" }),
      identity(4, 101, { pool: "candidate" }),
      identity(5, 101, { pool: "transcript" }),
      identity(1, 102, { pool: "transcript" }),
    ] as const;
    expect(qwenOperations).toHaveLength(
      AI_QUOTA_PROVIDER_GATE_POLICY["qwen-omni"].maxInFlight,
    );
    const qwenTickets = qwenOperations.map((operation) => {
      const response = requestAiQuotaLease(state, operation, 0, createToken);
      expect(response.status).toBe("granted");
      if (response.status !== "granted") {
        throw new Error("expected a shared-provider upload ticket");
      }
      return { operation, leaseToken: response.leaseToken };
    });

    const seventhOperation = identity(2, 102, { pool: "transcript" });
    expect(
      requestAiQuotaLease(state, seventhOperation, 0, createToken).status,
    ).toBe("queued");

    const contextOperation = identity(3, 102, { pool: "context" });
    const contextTicket = requestAiQuotaLease(
      state,
      contextOperation,
      0,
      createToken,
    );
    expect(contextTicket.status).toBe("granted");
    if (contextTicket.status !== "granted") {
      throw new Error("expected an independent context upload ticket");
    }
    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "consume",
          ...contextOperation,
          leaseToken: contextTicket.leaseToken,
        },
        0,
      ),
    ).toEqual({ ok: true, status: "consumed" });

    const pendingTicketIndexes = new Set(
      qwenTickets.map((_, index) => index),
    );
    const startedTickets: Array<(typeof qwenTickets)[number]> = [];
    const interval =
      AI_QUOTA_PROVIDER_GATE_POLICY["qwen-omni"].minimumStartIntervalMs;
    for (let startOrdinal = 0; startOrdinal < qwenTickets.length; startOrdinal += 1) {
      const nowMs = startOrdinal * interval;
      let startedIndex: number | undefined;
      for (const index of [...pendingTicketIndexes]) {
        const ticket = qwenTickets[index];
        if (ticket === undefined) throw new Error("missing qwen ticket");
        const response = applyAiQuotaInternalRequest(
          state,
          {
            action: "consume",
            ...ticket.operation,
            leaseToken: ticket.leaseToken,
          },
          nowMs,
        );
        if (response.ok) {
          expect(startedIndex).toBeUndefined();
          startedIndex = index;
          startedTickets.push(ticket);
        } else {
          expect(response.status).toBe("not-ready");
        }
      }
      expect(startedIndex).toBeDefined();
      if (startedIndex === undefined) {
        throw new Error("one shared-provider call must start");
      }
      pendingTicketIndexes.delete(startedIndex);
    }

    const saturated = inspectAiQuotaState(
      state,
      (qwenTickets.length - 1) * interval,
    );
    expect(saturated.pools.candidate.inFlightCount).toBe(4);
    expect(saturated.pools.transcript.inFlightCount).toBe(2);
    expect(saturated.pools.context.inFlightCount).toBe(1);
    expect(
      saturated.pools.candidate.inFlightCount +
        saturated.pools.transcript.inFlightCount,
    ).toBe(AI_QUOTA_PROVIDER_GATE_POLICY["qwen-omni"].maxInFlight);

    const nextStartAtMs = qwenTickets.length * interval;
    expect(
      requestAiQuotaLease(
        state,
        seventhOperation,
        nextStartAtMs,
        createToken,
      ).status,
    ).toBe("queued");

    const completed = startedTickets[0];
    if (completed === undefined) throw new Error("expected a started ticket");
    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "complete",
          ...completed.operation,
          leaseToken: completed.leaseToken,
          outcome: "succeeded",
        },
        nextStartAtMs,
      ),
    ).toEqual({ ok: true, status: "completed" });

    const seventhTicket = requestAiQuotaLease(
      state,
      seventhOperation,
      nextStartAtMs,
      createToken,
    );
    expect(seventhTicket.status).toBe("granted");
    if (seventhTicket.status !== "granted") {
      throw new Error("expected a ticket after one provider slot completed");
    }
    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "consume",
          ...seventhOperation,
          leaseToken: seventhTicket.leaseToken,
        },
        nextStartAtMs,
      ),
    ).toEqual({ ok: true, status: "consumed" });
  });

  it("shares one provider start clock and backoff across transcript and candidate", () => {
    const state = createAiQuotaCoordinatorState();
    const createToken = tokenFactory();
    const transcript = identity(1, 1, { pool: "transcript" });
    const candidate = identity(2, 1, { pool: "candidate" });
    const transcriptLease = requestAiQuotaLease(
      state,
      transcript,
      0,
      createToken,
    );
    const candidateLease = requestAiQuotaLease(
      state,
      candidate,
      0,
      createToken,
    );
    expect(transcriptLease.status).toBe("granted");
    expect(candidateLease.status).toBe("granted");
    if (
      transcriptLease.status !== "granted" ||
      candidateLease.status !== "granted"
    ) {
      throw new Error("expected both upload tickets");
    }

    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "consume",
          ...candidate,
          leaseToken: candidateLease.leaseToken,
        },
        0,
      ),
    ).toEqual({ ok: true, status: "consumed" });
    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "complete",
          ...candidate,
          leaseToken: candidateLease.leaseToken,
          outcome: "succeeded",
        },
        1,
      ),
    ).toEqual({ ok: true, status: "completed" });

    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "consume",
          ...transcript,
          leaseToken: transcriptLease.leaseToken,
        },
        999,
      ),
    ).toMatchObject({ ok: false, status: "not-ready", retryAfterMs: 75 });
    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "consume",
          ...transcript,
          leaseToken: transcriptLease.leaseToken,
        },
        1_000,
      ),
    ).toEqual({ ok: true, status: "consumed" });
    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "complete",
          ...transcript,
          leaseToken: transcriptLease.leaseToken,
          outcome: "rate-limited",
          retryAfterMs: 20_000,
        },
        1_001,
      ),
    ).toEqual({ ok: true, status: "completed" });

    const nextCandidate = identity(1, 2, { pool: "candidate" });
    const nextLease = requestAiQuotaLease(
      state,
      nextCandidate,
      1_002,
      createToken,
    );
    expect(nextLease.status).toBe("granted");
    if (nextLease.status !== "granted") {
      throw new Error("expected transcript upload ticket");
    }
    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "consume",
          ...nextCandidate,
          leaseToken: nextLease.leaseToken,
        },
        1_002,
      ),
    ).toMatchObject({
      ok: false,
      status: "not-ready",
      retryAfterMs: 19_999,
    });
  });

  it("reserves the shared Qwen 100k TPM window and releases it after 60 seconds", () => {
    const state = createAiQuotaCoordinatorState();
    const createToken = tokenFactory();
    const first = identity(1, 301, { pool: "transcript" });
    const second = identity(1, 302, { pool: "candidate" });
    const third = identity(1, 303, { pool: "transcript" });
    const leases = [first, second, third].map((operation) => {
      const response = requestAiQuotaLease(state, operation, 0, createToken);
      expect(response.status).toBe("granted");
      if (response.status !== "granted") throw new Error("expected a ticket");
      return response.leaseToken;
    });

    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "consume",
          ...first,
          leaseToken: leases[0]!,
          tokenReservation: 50_000,
        },
        0,
      ),
    ).toEqual({ ok: true, status: "consumed" });
    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "complete",
          ...first,
          leaseToken: leases[0]!,
          outcome: "succeeded",
        },
        1,
      ),
    ).toEqual({ ok: true, status: "completed" });

    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "consume",
          ...second,
          leaseToken: leases[1]!,
          tokenReservation: 50_000,
        },
        1_000,
      ),
    ).toEqual({ ok: true, status: "consumed" });
    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "complete",
          ...second,
          leaseToken: leases[1]!,
          outcome: "succeeded",
        },
        1_001,
      ),
    ).toEqual({ ok: true, status: "completed" });

    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "consume",
          ...third,
          leaseToken: leases[2]!,
          tokenReservation: 1,
        },
        2_000,
      ),
    ).toEqual({
      ok: false,
      status: "not-ready",
      retryAfterMs: 58_000,
    });
    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "consume",
          ...third,
          leaseToken: leases[2]!,
          tokenReservation: 1,
        },
        60_000,
      ),
    ).toEqual({ ok: true, status: "consumed" });
    expect(state.providerGates["qwen-omni"].tokenReservations).toEqual([
      { startedAtMs: 1_000, tokens: 50_000 },
      { startedAtMs: 60_000, tokens: 1 },
    ]);
  });

  it("skips a token-blocked participant without idling a smaller ready request", () => {
    const state = createAiQuotaCoordinatorState();
    const createToken = tokenFactory();
    const filler = identity(3, 401, { pool: "transcript" });
    const fillerLease = requestAiQuotaLease(state, filler, 0, createToken);
    if (fillerLease.status !== "granted") throw new Error("expected filler");
    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "consume",
          ...filler,
          leaseToken: fillerLease.leaseToken,
          tokenReservation: 98_000,
        },
        0,
      ),
    ).toEqual({ ok: true, status: "consumed" });
    applyAiQuotaInternalRequest(
      state,
      {
        action: "complete",
        ...filler,
        leaseToken: fillerLease.leaseToken,
        outcome: "succeeded",
      },
      1,
    );

    const large = identity(1, 401, { pool: "candidate" });
    const small = identity(2, 401, { pool: "transcript" });
    const largeLease = requestAiQuotaLease(state, large, 2, createToken);
    const smallLease = requestAiQuotaLease(state, small, 2, createToken);
    if (largeLease.status !== "granted" || smallLease.status !== "granted") {
      throw new Error("expected both waiting tickets");
    }
    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "consume",
          ...large,
          leaseToken: largeLease.leaseToken,
          tokenReservation: 3_000,
        },
        1_000,
      ),
    ).toMatchObject({ ok: false, status: "not-ready" });
    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "consume",
          ...small,
          leaseToken: smallLease.leaseToken,
          tokenReservation: 1_000,
        },
        1_000,
      ),
    ).toEqual({ ok: true, status: "consumed" });
  });

  it("issues upload tickets during provider backoff but keeps consume not-ready", () => {
    const state = createAiQuotaCoordinatorState();
    const operation = identity(1, 1);
    const lease = requestAiQuotaLease(state, operation, 0, tokenFactory());
    if (lease.status !== "granted") throw new Error("expected a lease");
    applyAiQuotaInternalRequest(
      state,
      { action: "consume", ...operation, leaseToken: lease.leaseToken },
      1,
    );
    applyAiQuotaInternalRequest(
      state,
      {
        action: "complete",
        ...operation,
        leaseToken: lease.leaseToken,
        outcome: "rate-limited",
        retryAfterMs: 20_000,
      },
      2,
    );

    expect(state.providerGates["qwen-omni"].nextGrantAtMs).toBe(20_002);
    const next = requestAiQuotaLease(state, identity(1, 2), 3, tokenFactory());
    expect(next).toMatchObject({
      status: "granted",
      retryAfterMs: 0,
    });
    if (next.status !== "granted") throw new Error("expected upload ticket");

    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "consume",
          ...identity(1, 2),
          leaseToken: next.leaseToken,
        },
        3,
      ),
    ).toEqual({
      ok: false,
      status: "not-ready",
      retryAfterMs: 19_999,
    });
    expect(
      applyAiQuotaInternalRequest(
        state,
        {
          action: "consume",
          ...identity(1, 2),
          leaseToken: next.leaseToken,
        },
        20_002,
      ),
    ).toEqual({ ok: true, status: "consumed" });
  });

  it("cleans abandoned queued work and expired upload tickets at their TTLs", () => {
    const queuedState = createAiQuotaCoordinatorState();
    const createQueuedToken = tokenFactory();
    const queuedOperation = identity(1, 7);

    for (let operationOrdinal = 1; operationOrdinal <= 7; operationOrdinal += 1) {
      const response = requestAiQuotaLease(
        queuedState,
        identity(1, operationOrdinal),
        0,
        createQueuedToken,
      );
      expect(response.status).toBe(
        operationOrdinal <=
          AI_QUOTA_POOL_POLICY.transcript.maxInFlight
          ? "granted"
          : "queued",
      );
    }
    expect(
      Object.values(queuedState.operations).find(
        (operation) =>
          operation.operationId === queuedOperation.operationId,
      )?.status,
    ).toBe("queued");

    expect(
      inspectAiQuotaState(queuedState, AI_QUOTA_QUEUED_TTL_MS)
        .activeParticipantCount,
    ).toBe(0);
    expect(
      Object.values(queuedState.operations).find(
        (operation) =>
          operation.operationId === queuedOperation.operationId,
      )?.status,
    ).toBe("cancelled");

    const ticketState = createAiQuotaCoordinatorState();
    const ticketOperation = identity(1, 1);
    const ticket = requestAiQuotaLease(
      ticketState,
      ticketOperation,
      0,
      tokenFactory(),
    );
    expect(ticket.status).toBe("granted");
    if (ticket.status !== "granted") throw new Error("expected upload ticket");

    inspectAiQuotaState(ticketState, AI_QUOTA_LEASE_TTL_MS);
    const expiredTicket = Object.values(ticketState.operations).find(
      (operation) => operation.operationId === ticketOperation.operationId,
    );
    expect(expiredTicket).toMatchObject({
      status: "cancelled",
      leaseToken: null,
      leaseExpiresAtMs: null,
    });
    expect(
      applyAiQuotaInternalRequest(
        ticketState,
        {
          action: "consume",
          ...ticketOperation,
          leaseToken: ticket.leaseToken,
        },
        AI_QUOTA_LEASE_TTL_MS,
      ),
    ).toEqual({ ok: false, status: "mismatch" });
  });

  it("keeps the persisted coordinator state bounded below the storage value limit", () => {
    const state = createAiQuotaCoordinatorState();
    const createToken = tokenFactory();
    const participantId = `participant-${"p".repeat(84)}`;
    const runId = `run-${"r".repeat(156)}`;

    for (let ordinal = 1; ordinal <= 900; ordinal += 1) {
      const operationId =
        `operation-${String(ordinal).padStart(4, "0")}-${"o".repeat(141)}`;
      const request = identity(1, ordinal, {
        participantId,
        runId,
        operationId,
      });
      const nowMs =
        ordinal * AI_QUOTA_POOL_POLICY.transcript.minimumStartIntervalMs;
      const ticket = requestAiQuotaLease(
        state,
        request,
        nowMs,
        createToken,
      );
      expect(ticket.status).toBe("granted");
      if (ticket.status !== "granted") throw new Error("expected upload ticket");
      expect(
        applyAiQuotaInternalRequest(
          state,
          {
            action: "consume",
            ...request,
            leaseToken: ticket.leaseToken,
          },
          nowMs,
        ),
      ).toEqual({ ok: true, status: "consumed" });
      expect(
        applyAiQuotaInternalRequest(
          state,
          {
            action: "complete",
            ...request,
            leaseToken: ticket.leaseToken,
            outcome: "succeeded",
          },
          nowMs + 1,
        ),
      ).toEqual({ ok: true, status: "completed" });
    }

    const operationCount = Object.keys(state.operations).length;
    const serializedBytes = new TextEncoder().encode(
      JSON.stringify(state),
    ).byteLength;
    expect(operationCount).toBeLessThanOrEqual(AI_QUOTA_MAX_OPERATIONS);
    expect(operationCount).toBeGreaterThanOrEqual(
      AI_QUOTA_OPERATION_RETENTION_TARGET,
    );
    expect(serializedBytes).toBeLessThan(1_500_000);
  }, 15_000);
});
