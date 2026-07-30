import { describe, expect, it, vi } from "vitest";
import { createBroadcastParticipantGrounding } from "../analysis/broadcastParticipantGrounding";
import { AI_BROADCAST_CONTEXT_ROUTING_REVISION } from "../analysis/aiModelRoutingPolicy";
import { AMORETTO_CHANNEL_CAST_ROSTER_ID } from "../analysis/participantRoster";
import {
  PREANALYSIS_CONTEXT_CACHE_HEADER,
  PREANALYSIS_CONTEXT_ATTEMPT_HEADER,
  PREANALYSIS_CONTEXT_CONTRACT_HEADER,
  PREANALYSIS_CONTEXT_ENDPOINT_PATH,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_OPERATION_HEADER,
  PREANALYSIS_CONTEXT_OPERATION_GENERATION,
  PREANALYSIS_CONTEXT_ORIGIN,
  PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER,
  PREANALYSIS_CONTEXT_PROXY_VERSION,
  PREANALYSIS_CONTEXT_RETRY_RISK_HEADER,
  PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER,
  PreanalysisContextOperation,
  createPreanalysisContextOperationId,
  handlePreanalysisContextProxyRequest,
  type PreanalysisContextProxyDependencies,
  type PreanalysisContextProxyEnvironment,
} from "./preanalysisContextProxy.worker";

const ENDPOINT =
  `https://exclipper-preanalysis-context.example${PREANALYSIS_CONTEXT_ENDPOINT_PATH}`;
const TOKEN = "scheduled-secret-token-with-at-least-24-chars";

class FakeDurableObjectStorage {
  private readonly values = new Map<string, unknown>();

  public get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.values.get(key) as T | undefined);
  }

  public put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
    return Promise.resolve();
  }

  public delete(key: string): Promise<boolean> {
    return Promise.resolve(this.values.delete(key));
  }

  public seed(key: string, value: unknown): void {
    this.values.set(key, structuredClone(value));
  }

  public read<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }
}

class FakeDurableObjectState {
  public constructor(
    public readonly storage: FakeDurableObjectStorage,
  ) {}

  public blockConcurrencyWhile<T>(
    callback: () => Promise<T>,
  ): Promise<T> {
    return callback();
  }
}

class FakeDurableObjectNamespace {
  public readonly requestedNames: string[] = [];
  private readonly storageByName = new Map<
    string,
    FakeDurableObjectStorage
  >();
  private readonly instanceByName = new Map<
    string,
    PreanalysisContextOperation
  >();

  public constructor(
    private readonly environment: () => PreanalysisContextProxyEnvironment,
    private readonly dependencies: PreanalysisContextProxyDependencies,
  ) {}

  public idFromName(name: string): string {
    this.requestedNames.push(name);
    return name;
  }

  public get(id: unknown): {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  } {
    const name = String(id);
    let instance = this.instanceByName.get(name);
    if (instance === undefined) {
      const storage =
        this.storageByName.get(name) ?? new FakeDurableObjectStorage();
      this.storageByName.set(name, storage);
      instance = new PreanalysisContextOperation(
        new FakeDurableObjectState(storage),
        this.environment(),
        this.dependencies,
      );
      this.instanceByName.set(name, instance);
    }
    const operation = instance;
    return {
      fetch(input, init) {
        return operation.fetch(new Request(input, init));
      },
    };
  }

  public restart(name: string): void {
    this.instanceByName.delete(name);
  }

  public seed(name: string, value: unknown): void {
    const storage =
      this.storageByName.get(name) ?? new FakeDurableObjectStorage();
    storage.seed("operation-state", value);
    this.storageByName.set(name, storage);
    this.instanceByName.delete(name);
  }

  public read<T>(name: string, key: string): T | undefined {
    return this.storageByName.get(name)?.read<T>(key);
  }
}

function scheduledRequestBody(
  summaryKo = "진행자가 음식 취향을 설명하고 시청자와 이야기를 나눴다.",
): string {
  const chapters = [
    {
      chapterId: "chapter-1",
      startMs: 0,
      endMs: 60_000,
      evidenceMode: "complete-transcript" as const,
      evidenceCoverageRatio: 1,
      summaryKo,
    },
  ];
  const participantGrounding = createBroadcastParticipantGrounding({
    sourceDurationMs: 60_000,
    castRosterId: AMORETTO_CHANNEL_CAST_ROSTER_ID,
    chapters,
  });
  return JSON.stringify({
    sourceDurationMs: 60_000,
    chapters,
    candidates: [],
    castRosterId: AMORETTO_CHANNEL_CAST_ROSTER_ID,
    participantGrounding,
    outputLanguage: "ko",
  });
}

async function payloadDigest(body: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  return `sha256:${Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("")}`;
}

async function operationIdForBody(body: string): Promise<string> {
  return createPreanalysisContextOperationId(await payloadDigest(body));
}

async function createScheduledRequest(
  body = scheduledRequestBody(),
  overrides: {
    readonly authorization?: string;
    readonly contractVersion?: string;
    readonly digest?: string;
    readonly expectedModelId?: string;
    readonly expectedModelRevision?: string;
    readonly method?: string;
    readonly operationId?: string;
    readonly origin?: string;
    readonly routingRevision?: string;
    readonly url?: string;
  } = {},
): Promise<Request> {
  const digest = overrides.digest ?? await payloadDigest(body);
  return new Request(overrides.url ?? ENDPOINT, {
    method: overrides.method ?? "POST",
    headers: {
      Authorization: overrides.authorization ?? `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Origin: overrides.origin ?? PREANALYSIS_CONTEXT_ORIGIN,
      [PREANALYSIS_CONTEXT_CONTRACT_HEADER]:
        overrides.contractVersion ?? PREANALYSIS_CONTEXT_PROXY_VERSION,
      [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]:
        overrides.routingRevision ??
        AI_BROADCAST_CONTEXT_ROUTING_REVISION,
      [PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER]:
        overrides.expectedModelId ??
        PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID,
      [PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER]:
        overrides.expectedModelRevision ??
        PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION,
      [PREANALYSIS_CONTEXT_OPERATION_HEADER]:
        overrides.operationId ??
        await createPreanalysisContextOperationId(digest),
      [PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER]:
        digest,
    },
    ...(overrides.method === "OPTIONS" ? {} : { body }),
  });
}

function qwenSuccessResponse(): Response {
  const generated = {
    summary:
      "진행자는 음식 취향을 설명하고 시청자 반응에 답하며 한 가지 주제를 이어 갔다.",
    host: {
      name: null,
      profile:
        "대화의 중심에서 자신의 취향을 차분히 설명하고 시청자의 질문에 답하는 진행을 보였다.",
      evidence: ["음식 취향을 직접 설명했다."],
      uncertainty: ["자막만으로 화면 속 인물은 확인할 수 없다."],
    },
    themes: ["음식 취향 이야기"],
    chapters: [
      {
        s: "chapter-1",
        e: "chapter-1",
        title: "음식 취향 이야기",
        desc: "한 가지 음식 주제를 놓고 취향과 이유를 설명했다.",
        kind: "main-event",
        sal: "primary",
      },
    ],
    leads: [],
    candidates: [],
  };
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(generated) },
        },
      ],
    }),
    { status: 200 },
  );
}

function createHarness(
  fetchImplementation = vi.fn(
    (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      void _input;
      void _init;
      return Promise.resolve(qwenSuccessResponse());
    },
  ),
  options: {
    readonly now?: () => number;
    readonly upstreamTimeoutMs?: number;
  } = {},
): {
  readonly environment: PreanalysisContextProxyEnvironment;
  readonly namespace: FakeDurableObjectNamespace;
  readonly rateLimit: ReturnType<typeof vi.fn>;
  readonly upstreamFetch: typeof fetchImplementation;
} {
  const namespaceHolder: {
    value: FakeDurableObjectNamespace | null;
  } = { value: null };
  const rateLimit = vi.fn(() => Promise.resolve({ success: true }));
  const environment: PreanalysisContextProxyEnvironment = {
    PREANALYSIS_CONTEXT_TOKEN: TOKEN,
    PREANALYSIS_CONTEXT_PROVIDER: "qwen",
    PREANALYSIS_QWEN_API_KEY: "dedicated-qwen-test-key",
    PREANALYSIS_QWEN_REGION: "singapore",
    PREANALYSIS_CONTEXT_RATE_LIMITER: { limit: rateLimit },
    get PREANALYSIS_CONTEXT_OPERATIONS() {
      if (namespaceHolder.value === null) {
        throw new Error("Fake Durable Object namespace is not ready.");
      }
      return namespaceHolder.value;
    },
  };
  const namespace = new FakeDurableObjectNamespace(
    () => environment,
    {
      fetchImplementation,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.upstreamTimeoutMs === undefined
        ? {}
        : { upstreamTimeoutMs: options.upstreamTimeoutMs }),
    },
  );
  namespaceHolder.value = namespace;
  return {
    environment,
    namespace,
    rateLimit,
    upstreamFetch: fetchImplementation,
  };
}

async function errorCode(response: Response): Promise<string | null> {
  const value = await response.json() as {
    readonly error?: { readonly code?: unknown };
  };
  return typeof value.error?.code === "string"
    ? value.error.code
    : null;
}

describe("preanalysisContextProxy.worker", () => {
  it("runs the bounded overview once and replays the durable terminal result", async () => {
    const harness = createHarness();
    const request = await createScheduledRequest();
    const first = await handlePreanalysisContextProxyRequest(
      request,
      harness.environment,
    );

    expect(first.status).toBe(200);
    expect(first.headers.get(PREANALYSIS_CONTEXT_CACHE_HEADER)).toBe("miss");
    expect(first.headers.get(PREANALYSIS_CONTEXT_CONTRACT_HEADER)).toBe(
      PREANALYSIS_CONTEXT_PROXY_VERSION,
    );
    expect(
      first.headers.get(PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER),
    ).toBe(AI_BROADCAST_CONTEXT_ROUTING_REVISION);
    expect(first.headers.get(PREANALYSIS_CONTEXT_MODEL_ID_HEADER)).toBe(
      PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID,
    );
    expect(
      first.headers.get(PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER),
    ).toBe(PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION);
    const firstPayload = JSON.parse(await first.text()) as unknown;
    expect(firstPayload).toMatchObject({
      annotations: [],
      semanticChaptersSupported: true,
      discoveredLeadsSupported: true,
    });
    expect(
      (firstPayload as { readonly broadcastSummaryKo?: unknown })
        .broadcastSummaryKo,
    ).toEqual(expect.stringContaining("음식 취향"));
    expect(harness.upstreamFetch).toHaveBeenCalledTimes(1);
    const providerInit = harness.upstreamFetch.mock.calls[0]?.[1];
    expect(
      new Headers(providerInit?.headers).get("Authorization"),
    ).toBe("Bearer dedicated-qwen-test-key");
    if (typeof providerInit?.body !== "string") {
      throw new TypeError("Expected a serialized provider body.");
    }
    const providerBody = JSON.parse(providerInit.body) as unknown;
    expect(providerBody).toMatchObject({
      model: "qwen3.7-plus",
      enable_thinking: true,
    });

    harness.namespace.restart(
      await operationIdForBody(scheduledRequestBody()),
    );
    const replay = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get(PREANALYSIS_CONTEXT_CACHE_HEADER)).toBe("hit");
    expect(replay.headers.get(PREANALYSIS_CONTEXT_CONTRACT_HEADER)).toBe(
      PREANALYSIS_CONTEXT_PROXY_VERSION,
    );
    expect(harness.upstreamFetch).toHaveBeenCalledTimes(1);

    harness.rateLimit.mockResolvedValue({ success: false });
    const replayWhileLimited = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(replayWhileLimited.status).toBe(200);
    expect(
      replayWhileLimited.headers.get(PREANALYSIS_CONTEXT_CACHE_HEADER),
    ).toBe("hit");
    expect(harness.rateLimit).toHaveBeenCalledTimes(1);
  });

  it("quarantines a corrupt succeeded terminal and recomputes it with billing risk disclosed", async () => {
    const body = scheduledRequestBody();
    const operationId = await operationIdForBody(body);
    const source = createHarness();
    const sourceResponse = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(body),
      source.environment,
    );
    expect(sourceResponse.status).toBe(200);
    const stored = source.namespace.read<{
      readonly schemaVersion: string;
      readonly generation: number;
      readonly operationId: string;
      readonly payloadDigest: string;
      readonly phase: string;
      readonly attempt: number;
      readonly updatedAtMs: number;
      readonly terminal: {
        readonly status: number;
        readonly body: string;
        readonly headers: Readonly<Record<string, string>>;
      };
      readonly retry: null;
    }>(operationId, "operation-state");
    if (stored === undefined) {
      throw new TypeError("Expected a stored success terminal.");
    }

    const harness = createHarness();
    harness.namespace.seed(operationId, {
      ...stored,
      terminal: {
        ...stored.terminal,
        body: "{}",
        headers: {
          ...stored.terminal.headers,
          [PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER]:
            "stale-model-revision",
        },
      },
    });

    const recovered = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(body),
      harness.environment,
    );

    expect(recovered.status).toBe(200);
    expect(recovered.headers.get(PREANALYSIS_CONTEXT_CACHE_HEADER)).toBe(
      "miss",
    );
    expect(recovered.headers.get(PREANALYSIS_CONTEXT_ATTEMPT_HEADER)).toBe(
      "2",
    );
    expect(
      recovered.headers.get(PREANALYSIS_CONTEXT_RETRY_RISK_HEADER),
    ).toBe("possible-duplicate-provider-charge");
    expect(harness.upstreamFetch).toHaveBeenCalledTimes(1);
    expect(
      harness.namespace.read<{
        readonly observedOperationId?: unknown;
        readonly observedPayloadDigest?: unknown;
      }>(operationId, "operation-state-quarantine-v2"),
    ).toMatchObject({
      observedOperationId: operationId,
      observedPayloadDigest: await payloadDigest(body),
    });
    expect(
      harness.namespace.read<{
        readonly phase?: unknown;
        readonly attempt?: unknown;
      }>(operationId, "operation-state"),
    ).toMatchObject({
      phase: "succeeded",
      attempt: 2,
    });
  });

  it("binds the operation namespace to the exact payload and current route", async () => {
    const harness = createHarness();
    const firstBody = scheduledRequestBody();
    const firstOperationId = await operationIdForBody(firstBody);
    const first = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(firstBody),
      harness.environment,
    );
    expect(first.status).toBe(200);

    const changedBody = scheduledRequestBody(
      "진행자가 다른 음식 취향을 설명하고 이야기를 이어 갔다.",
    );
    const conflict = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(changedBody, {
        operationId: firstOperationId,
      }),
      harness.environment,
    );
    expect(conflict.status).toBe(409);
    await expect(errorCode(conflict)).resolves.toBe(
      "OPERATION_NAMESPACE_MISMATCH",
    );
    expect(harness.upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent retries so only one provider request is made", async () => {
    let release: ((response: Response) => void) | undefined;
    const upstreamFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const harness = createHarness(upstreamFetch);
    const firstPromise = handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    const secondPromise = handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    await vi.waitFor(() => {
      expect(upstreamFetch).toHaveBeenCalledTimes(1);
    });
    release?.(qwenSuccessResponse());
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(
      [first, second].map((response) =>
        response.headers.get(PREANALYSIS_CONTEXT_CACHE_HEADER)
      ).sort(),
    ).toEqual(["hit", "miss"]);
  });

  it("retries an explicit upstream rate limit with the same operation", async () => {
    let nowMs = 0;
    const upstreamFetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(qwenSuccessResponse());
    const harness = createHarness(upstreamFetch, { now: () => nowMs });
    const limited = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(limited.status).toBe(429);
    await expect(errorCode(limited)).resolves.toBe(
      "UPSTREAM_RATE_LIMITED",
    );

    nowMs = 30_000;
    const recovered = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(recovered.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it("checkpoints an ambiguous outcome and later resumes with an explicit billing-risk receipt", async () => {
    let nowMs = 0;
    const upstreamFetch = vi.fn()
      .mockRejectedValueOnce(new TypeError("connection reset"))
      .mockResolvedValueOnce(qwenSuccessResponse());
    const harness = createHarness(upstreamFetch, { now: () => nowMs });
    const failed = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(failed.status).toBe(502);
    await expect(errorCode(failed)).resolves.toBe(
      "UPSTREAM_OUTCOME_UNKNOWN",
    );

    const backoff = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(backoff.status).toBe(503);
    await expect(errorCode(backoff)).resolves.toBe("RETRY_BACKOFF");
    expect(upstreamFetch).toHaveBeenCalledTimes(1);

    nowMs = 30_000;
    harness.namespace.restart(
      await operationIdForBody(scheduledRequestBody()),
    );
    const recovered = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(recovered.status).toBe(200);
    expect(
      recovered.headers.get(PREANALYSIS_CONTEXT_RETRY_RISK_HEADER),
    ).toBe("possible-duplicate-provider-charge");
    expect(recovered.headers.get(PREANALYSIS_CONTEXT_ATTEMPT_HEADER)).toBe(
      "2",
    );
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it("recovers a stale running checkpoint instead of making it a permanent gap", async () => {
    let nowMs = 119_999;
    const harness = createHarness(
      vi.fn(() => Promise.resolve(qwenSuccessResponse())),
      { now: () => nowMs },
    );
    const body = scheduledRequestBody();
    const digest = await payloadDigest(body);
    const operationId = await operationIdForBody(body);
    harness.namespace.seed(operationId, {
      schemaVersion: PREANALYSIS_CONTEXT_PROXY_VERSION,
      generation: PREANALYSIS_CONTEXT_OPERATION_GENERATION,
      operationId,
      payloadDigest: digest,
      phase: "running",
      attempt: 1,
      updatedAtMs: 0,
      terminal: null,
      retry: null,
    });

    const stillRunning = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(body),
      harness.environment,
    );
    expect(stillRunning.status).toBe(409);
    await expect(errorCode(stillRunning)).resolves.toBe(
      "OPERATION_IN_PROGRESS",
    );
    expect(harness.upstreamFetch).not.toHaveBeenCalled();

    nowMs = 120_000;
    const recovered = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(body),
      harness.environment,
    );
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get(PREANALYSIS_CONTEXT_ATTEMPT_HEADER)).toBe(
      "2",
    );
    expect(
      recovered.headers.get(PREANALYSIS_CONTEXT_RETRY_RISK_HEADER),
    ).toBe("possible-duplicate-provider-charge");
    expect(harness.upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("quarantines an old same-payload checkpoint and resumes under the current generation", async () => {
    const harness = createHarness();
    const body = scheduledRequestBody();
    const digest = await payloadDigest(body);
    const operationId = await operationIdForBody(body);
    harness.namespace.seed(operationId, {
      schemaVersion: "1.0.0",
      operationId,
      payloadDigest: digest,
      phase: "running",
      attempt: 1,
      updatedAtMs: 0,
      terminal: null,
      retry: null,
    });

    const response = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(body),
      harness.environment,
    );

    expect(response.status).toBe(200);
    expect(harness.upstreamFetch).toHaveBeenCalledTimes(1);
    expect(
      harness.namespace.read<{
        readonly generation?: unknown;
        readonly replacementOperationId?: unknown;
        readonly replacementPayloadDigest?: unknown;
      }>(operationId, "operation-state-quarantine-v2"),
    ).toMatchObject({
      generation: PREANALYSIS_CONTEXT_OPERATION_GENERATION,
      replacementOperationId: operationId,
      replacementPayloadDigest: digest,
    });
    expect(
      harness.namespace.read<{
        readonly schemaVersion?: unknown;
        readonly generation?: unknown;
        readonly phase?: unknown;
      }>(operationId, "operation-state"),
    ).toMatchObject({
      schemaVersion: PREANALYSIS_CONTEXT_PROXY_VERSION,
      generation: PREANALYSIS_CONTEXT_OPERATION_GENERATION,
      phase: "succeeded",
    });
  });

  it("never resets an old checkpoint that identifies different payload bytes", async () => {
    const harness = createHarness();
    const body = scheduledRequestBody();
    const operationId = await operationIdForBody(body);
    const otherBody = scheduledRequestBody("완전히 다른 방송 문맥입니다.");
    harness.namespace.seed(operationId, {
      schemaVersion: "1.0.0",
      operationId: await operationIdForBody(otherBody),
      payloadDigest: await payloadDigest(otherBody),
      phase: "running",
      attempt: 1,
      updatedAtMs: 0,
      terminal: null,
      retry: null,
    });

    const response = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(body),
      harness.environment,
    );

    expect(response.status).toBe(409);
    await expect(errorCode(response)).resolves.toBe(
      "OPERATION_PAYLOAD_CONFLICT",
    );
    expect(harness.upstreamFetch).not.toHaveBeenCalled();
    expect(
      harness.namespace.read(operationId, "operation-state-quarantine-v2"),
    ).toBeUndefined();
  });

  it("keeps one upstream deadline across headers and a stalled response body", async () => {
    const stalled = new ReadableStream<Uint8Array>({
      start() {},
    });
    const harness = createHarness(
      vi.fn(() => Promise.resolve(new Response(stalled, { status: 200 }))),
      { upstreamTimeoutMs: 20 },
    );

    const response = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );

    expect(response.status).toBe(502);
    await expect(errorCode(response)).resolves.toBe(
      "UPSTREAM_OUTCOME_UNKNOWN",
    );
    expect(harness.upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps provider configuration failures retryable for a later repair", async () => {
    let nowMs = 0;
    const upstreamFetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(qwenSuccessResponse());
    const harness = createHarness(upstreamFetch, { now: () => nowMs });
    const failed = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(failed.status).toBe(502);
    await expect(errorCode(failed)).resolves.toBe("UPSTREAM_AUTH_FAILED");

    nowMs = 30_000;
    const recovered = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(recovered.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a provider schema failure retryable for a later parser or model repair", async () => {
    let nowMs = 0;
    const upstreamFetch = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "{}" } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(qwenSuccessResponse());
    const harness = createHarness(upstreamFetch, { now: () => nowMs });
    const invalid = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(invalid.status).toBe(502);
    await expect(errorCode(invalid)).resolves.toBe(
      "UPSTREAM_INVALID_RESPONSE",
    );

    nowMs = 30_000;
    const recovered = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(recovered.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it("rejects bad auth, wrong digests, browser preflight, and general routes before the DO", async () => {
    const harness = createHarness();
    const unauthorized = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(undefined, {
        authorization: `Bearer ${TOKEN}-wrong`,
      }),
      harness.environment,
    );
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const staleContract = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(undefined, {
        contractVersion: "1.0.0",
      }),
      harness.environment,
    );
    expect(staleContract.status).toBe(412);
    await expect(errorCode(staleContract)).resolves.toBe(
      "PROXY_CONTRACT_MISMATCH",
    );

    const staleRoute = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(undefined, {
        routingRevision: "stale-route",
      }),
      harness.environment,
    );
    expect(staleRoute.status).toBe(409);
    await expect(errorCode(staleRoute)).resolves.toBe(
      "PROXY_ROUTE_MISMATCH",
    );

    const digestMismatch = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(undefined, {
        digest: `sha256:${"0".repeat(64)}`,
      }),
      harness.environment,
    );
    expect(digestMismatch.status).toBe(409);
    await expect(errorCode(digestMismatch)).resolves.toBe(
      "PAYLOAD_DIGEST_MISMATCH",
    );

    const preflight = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(undefined, { method: "OPTIONS" }),
      harness.environment,
    );
    expect(preflight.status).toBe(405);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const otherRoute = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(undefined, {
        url: "https://exclipper-preanalysis-context.example/healthz",
      }),
      harness.environment,
    );
    expect(otherRoute.status).toBe(404);
    expect(harness.namespace.requestedNames).toHaveLength(0);
    expect(harness.upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects candidate-bearing requests and a missing dedicated provider key", async () => {
    const base = JSON.parse(scheduledRequestBody()) as Record<string, unknown>;
    base.candidates = [
      {
        candidateId: "candidate-1",
        startMs: 1_000,
        endMs: 30_000,
        transcriptKo: "후보",
        eventSummaryKo: "사건",
        reactionSummaryKo: "반응",
        participantContextKo: "참여자",
        chatReactionSummaryKo: null,
      },
    ];
    const harness = createHarness();
    const candidateBearing = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(JSON.stringify(base)),
      harness.environment,
    );
    expect(candidateBearing.status).toBe(400);
    expect(harness.upstreamFetch).not.toHaveBeenCalled();

    const noKeyNamespaceHolder: {
      value: FakeDurableObjectNamespace | null;
    } = { value: null };
    const noKeyEnvironment: PreanalysisContextProxyEnvironment = {
      PREANALYSIS_CONTEXT_TOKEN: TOKEN,
      PREANALYSIS_CONTEXT_PROVIDER: "qwen",
      PREANALYSIS_QWEN_REGION: "singapore",
      get PREANALYSIS_CONTEXT_OPERATIONS() {
        if (noKeyNamespaceHolder.value === null) {
          throw new Error("Fake Durable Object namespace is not ready.");
        }
        return noKeyNamespaceHolder.value;
      },
    };
    const noKeyNamespace = new FakeDurableObjectNamespace(
      () => noKeyEnvironment,
      { fetchImplementation: harness.upstreamFetch },
    );
    noKeyNamespaceHolder.value = noKeyNamespace;
    const noKey = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      noKeyEnvironment,
    );
    expect(noKey.status).toBe(503);
    await expect(errorCode(noKey)).resolves.toBe(
      "PROXY_NOT_CONFIGURED",
    );
    expect(harness.upstreamFetch).not.toHaveBeenCalled();
  });
});
