import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AI_QUOTA_MAX_ACTIVE_PARTICIPANTS,
  AI_QUOTA_SCHEMA_VERSION,
  type AiQuotaOperationIdentity,
} from "../analysis/aiQuotaProtocol";
import { AiQuotaCoordinator } from "./aiQuotaCoordinator";

const STATE_STORAGE_KEY = "coordinator-state";
const PAYLOAD_DIGEST = `sha256:${"0".repeat(64)}`;

class FakeDurableObjectStorage {
  private readonly values = new Map<string, unknown>();

  public get<T>(key: string): Promise<T | undefined> {
    const value = this.values.get(key);
    return Promise.resolve(
      value === undefined ? undefined : (structuredClone(value) as T),
    );
  }

  public put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
    return Promise.resolve();
  }

  public peek<T>(key: string): T | undefined {
    const value = this.values.get(key);
    return value === undefined ? undefined : (structuredClone(value) as T);
  }
}

class FakeDurableObjectState {
  public constructor(
    public readonly storage: FakeDurableObjectStorage,
  ) {}

  public blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    return callback();
  }
}

interface StoredCoordinatorStateView {
  readonly participants: Readonly<Record<string, unknown>>;
  readonly operations: Readonly<Record<string, unknown>>;
  readonly providerGates: {
    readonly "qwen-omni": {
      readonly nextGrantAtMs: number;
    };
  };
}

function identity(
  participantNumber: number,
  operationNumber: number,
): AiQuotaOperationIdentity {
  return {
    participantId: `participant-${participantNumber.toString().padStart(16, "0")}`,
    runId: `run-${participantNumber}`,
    operationId: `operation-${operationNumber}`,
    pool: "transcript",
    payloadDigest: PAYLOAD_DIGEST,
  };
}

function leaseRequest(
  operationIdentity: AiQuotaOperationIdentity,
): Record<string, unknown> {
  return {
    schemaVersion: AI_QUOTA_SCHEMA_VERSION,
    action: "lease",
    ...operationIdentity,
  };
}

function internalRequest(
  action: "release-upload" | "consume" | "complete",
  operationIdentity: AiQuotaOperationIdentity,
  leaseToken: string,
  completion?: {
    readonly outcome:
      | "succeeded"
      | "rate-limited"
      | "retryable"
      | "failed"
      | "outcome-unknown";
    readonly retryAfterMs?: number;
  },
): Record<string, unknown> {
  return {
    schemaVersion: AI_QUOTA_SCHEMA_VERSION,
    action,
    ...operationIdentity,
    leaseToken,
    ...(action === "consume" ? { tokenReservation: 1 } : {}),
    ...(completion ?? {}),
  };
}

async function postJson(
  coordinator: AiQuotaCoordinator,
  payload: Record<string, unknown>,
): Promise<{
  readonly status: number;
  readonly body: Record<string, unknown>;
}> {
  const response = await coordinator.fetch(
    new Request("https://quota.internal/v1/ai-quota", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

function coordinator(storage: FakeDurableObjectStorage): AiQuotaCoordinator {
  return new AiQuotaCoordinator(new FakeDurableObjectState(storage));
}

function grantedLeaseToken(body: Record<string, unknown>): string {
  expect(body.status).toBe("granted");
  expect(body.leaseToken).toMatch(/^[a-f0-9]{64}$/u);
  return body.leaseToken as string;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AiQuotaCoordinator durable lifecycle", () => {
  it("stops reading a chunked request as soon as the 2 KiB boundary is crossed", async () => {
    const storage = new FakeDurableObjectStorage();
    const instance = coordinator(storage);
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1_024));
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });
    const request = new Request("https://quota.internal/v1/ai-quota", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await instance.fetch(request);

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(3);
    await expect(response.json()).resolves.toEqual({
      error: "PAYLOAD_TOO_LARGE",
    });
    expect(storage.peek(STATE_STORAGE_KEY)).toBeUndefined();
  });

  it("persists request, grant, consume, and completion as one-way transitions", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const storage = new FakeDurableObjectStorage();
    const instance = coordinator(storage);
    const operation = identity(1, 1);

    const grant = await postJson(instance, leaseRequest(operation));
    expect(grant.status).toBe(200);
    const leaseToken = grantedLeaseToken(grant.body);

    vi.mocked(Date.now).mockReturnValue(1_050);
    const consume = await postJson(
      instance,
      internalRequest("consume", operation, leaseToken),
    );
    expect(consume.body).toEqual({ ok: true, status: "consumed" });

    vi.mocked(Date.now).mockReturnValue(1_100);
    const complete = await postJson(
      instance,
      internalRequest("complete", operation, leaseToken, {
        outcome: "succeeded",
      }),
    );
    expect(complete.body).toEqual({ ok: true, status: "completed" });

    const repeatedPublicRequest = await postJson(
      instance,
      leaseRequest(operation),
    );
    expect(repeatedPublicRequest.body).toMatchObject({
      status: "terminal",
      reason: "OPERATION_ALREADY_FINISHED",
    });

    const repeatedConsume = await postJson(
      instance,
      internalRequest("consume", operation, leaseToken),
    );
    expect(repeatedConsume.body).toMatchObject({ ok: false });
  });

  it("parses and persists the token-bound upload-ticket release action", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const storage = new FakeDurableObjectStorage();
    const instance = coordinator(storage);
    const operation = identity(1, 1);
    const grant = await postJson(instance, leaseRequest(operation));
    const leaseToken = grantedLeaseToken(grant.body);

    const release = await postJson(
      instance,
      internalRequest("release-upload", operation, leaseToken),
    );

    expect(release.body).toEqual({ ok: true, status: "released" });
    const persisted = storage.peek<StoredCoordinatorStateView>(
      STATE_STORAGE_KEY,
    );
    expect(
      Object.values(
        persisted?.operations ?? {},
      )[0],
    ).toMatchObject({ status: "cancelled", leaseToken: null });
  });

  it("restores the consume gate, provider backoff, and terminal tombstone after recreation", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const storage = new FakeDurableObjectStorage();
    const firstInstance = coordinator(storage);
    const firstOperation = identity(1, 1);

    const firstGrant = await postJson(
      firstInstance,
      leaseRequest(firstOperation),
    );
    const firstLeaseToken = grantedLeaseToken(firstGrant.body);

    now.mockReturnValue(10_050);
    expect(
      (
        await postJson(
          firstInstance,
          internalRequest("consume", firstOperation, firstLeaseToken),
        )
      ).body,
    ).toEqual({ ok: true, status: "consumed" });

    now.mockReturnValue(10_100);
    expect(
      (
        await postJson(
          firstInstance,
          internalRequest("complete", firstOperation, firstLeaseToken, {
            outcome: "rate-limited",
            retryAfterMs: 10_000,
          }),
        )
      ).body,
    ).toEqual({ ok: true, status: "completed" });

    const persistedAfterBackoff =
      storage.peek<StoredCoordinatorStateView>(STATE_STORAGE_KEY);
    expect(
      persistedAfterBackoff?.providerGates["qwen-omni"].nextGrantAtMs,
    ).toBe(20_100);

    const secondOperation = identity(1, 2);

    now.mockReturnValue(11_000);
    const ticketDuringBackoff = await postJson(
      firstInstance,
      leaseRequest(secondOperation),
    );
    const secondLeaseToken = grantedLeaseToken(ticketDuringBackoff.body);
    const consumeBeforeBackoffEnds = await postJson(
      firstInstance,
      internalRequest("consume", secondOperation, secondLeaseToken),
    );
    expect(consumeBeforeBackoffEnds.body).toEqual({
      ok: false,
      status: "not-ready",
      retryAfterMs: 9_100,
    });

    const recreated = coordinator(storage);
    now.mockReturnValue(12_000);
    const terminalAfterRestart = await postJson(
      recreated,
      leaseRequest(firstOperation),
    );
    expect(terminalAfterRestart.body).toMatchObject({
      status: "terminal",
      reason: "OPERATION_ALREADY_FINISHED",
    });
    const reusedTokenAfterRestart = await postJson(
      recreated,
      internalRequest("consume", firstOperation, firstLeaseToken),
    );
    expect(reusedTokenAfterRestart.body).toMatchObject({ ok: false });

    expect(
      (
        await postJson(
          recreated,
          internalRequest("consume", secondOperation, secondLeaseToken),
        )
      ).body,
    ).toEqual({
      ok: false,
      status: "not-ready",
      retryAfterMs: 8_100,
    });

    now.mockReturnValue(20_100);
    const consumeAfterBackoff = await postJson(
      recreated,
      internalRequest("consume", secondOperation, secondLeaseToken),
    );
    expect(consumeAfterBackoff.body).toEqual({
      ok: true,
      status: "consumed",
    });
  });

  it("admits exactly five participants and keeps a sixth fail-closed across recreation", async () => {
    vi.spyOn(Date, "now").mockReturnValue(50_000);
    const storage = new FakeDurableObjectStorage();
    const firstInstance = coordinator(storage);

    for (
      let participantNumber = 1;
      participantNumber <= AI_QUOTA_MAX_ACTIVE_PARTICIPANTS;
      participantNumber += 1
    ) {
      const response = await postJson(
        firstInstance,
        leaseRequest(identity(participantNumber, 1)),
      );
      expect(["granted", "queued"]).toContain(response.body.status);
      expect(response.body.activeParticipantCount).toBe(participantNumber);
    }

    const sixthOperation = identity(
      AI_QUOTA_MAX_ACTIVE_PARTICIPANTS + 1,
      1,
    );
    const sixthResponse = await postJson(
      firstInstance,
      leaseRequest(sixthOperation),
    );
    expect(sixthResponse.body).toMatchObject({
      status: "capacity-full",
      activeParticipantCount: AI_QUOTA_MAX_ACTIVE_PARTICIPANTS,
    });

    const stored = storage.peek<StoredCoordinatorStateView>(STATE_STORAGE_KEY);
    expect(Object.keys(stored?.participants ?? {})).toHaveLength(
      AI_QUOTA_MAX_ACTIVE_PARTICIPANTS,
    );
    expect(
      stored?.participants[sixthOperation.participantId],
    ).toBeUndefined();
    expect(Object.keys(stored?.operations ?? {})).toHaveLength(
      AI_QUOTA_MAX_ACTIVE_PARTICIPANTS,
    );

    const recreated = coordinator(storage);
    const sixthAfterRestart = await postJson(
      recreated,
      leaseRequest(sixthOperation),
    );
    expect(sixthAfterRestart.body).toMatchObject({
      status: "capacity-full",
      activeParticipantCount: AI_QUOTA_MAX_ACTIVE_PARTICIPANTS,
    });

    const existingParticipantStillWorks = await postJson(
      recreated,
      leaseRequest(identity(AI_QUOTA_MAX_ACTIVE_PARTICIPANTS, 1)),
    );
    expect(existingParticipantStillWorks.body.status).not.toBe(
      "capacity-full",
    );
  });
});
