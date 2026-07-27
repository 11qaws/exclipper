import { describe, expect, it, vi } from "vitest";

import {
  AI_QUOTA_LEASE_HEADER,
  AI_QUOTA_OPERATION_HEADER,
  AI_QUOTA_PARTICIPANT_HEADER,
  AI_QUOTA_PAYLOAD_DIGEST_HEADER,
  AI_QUOTA_RUN_HEADER,
  type AiQuotaLeaseHeaders,
} from "../analysis/aiQuotaProtocol";
import {
  BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE,
  createBroadcastTranscriptMediaResolveRequest,
} from "../analysis/broadcastTranscriptMediaProtocol";
import {
  CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
  CANDIDATE_INSIGHT_MEDIA_ENDPOINT_PATH,
  CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
  createCandidateInsightMediaResolveRequest,
} from "../analysis/candidateInsightMediaProtocol";
import {
  buildCandidatePassBProxyRequestBody,
  encodeCandidatePassBBase64,
  encodeCandidatePassBPcm16Wav,
} from "../analysis/candidatePassBGemini";
import {
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH,
  type CandidatePassBContextPacket,
} from "../analysis/candidatePassBWorkerProtocol";
import worker, {
  handleCandidateInsightRequest,
  handleBroadcastTranscriptRequest,
  type AiProxyEnvironment,
} from "./aiProxy.worker";
import type {
  BroadcastTranscriptMediaBucket,
  BroadcastTranscriptMediaGetOptions,
  BroadcastTranscriptMediaObject,
  BroadcastTranscriptMediaObjectBody,
  BroadcastTranscriptMediaPutOptions,
} from "./broadcastTranscriptMedia";

const TRANSCRIPT_ENDPOINT =
  "https://rettohighlight-gemini.example/v1/broadcast-transcript";
const PRODUCTION_ORIGIN = "https://11qaws.github.io";
const SIGNING_KEY = "0123456789abcdef0123456789abcdef";
const PUBLIC_LEASE_TOKEN = `public_${"a".repeat(40)}`;

interface StoredObject {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly object: BroadcastTranscriptMediaObject;
}

interface CoordinatorRequest {
  readonly action:
    | "health"
    | "lease"
    | "inspect"
    | "consume"
    | "complete"
    | "release-upload";
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
    total += result.value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function streamFor(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function cancellableOpenStream(bytes: Uint8Array): {
  readonly body: ReadableStream<Uint8Array>;
  readonly cancelCount: () => number;
} {
  let cancellations = 0;
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
      },
      cancel() {
        cancellations += 1;
      },
    }),
    cancelCount: () => cancellations,
  };
}

function requestWithStreamBody(
  url: URL,
  init: Omit<RequestInit, "body"> & {
    readonly body: ReadableStream<Uint8Array>;
  },
): Request {
  return new Request(url, {
    ...init,
    duplex: "half",
  } as RequestInit & { readonly duplex: "half" });
}

async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

function installFixedLengthStreamFixture(): {
  readonly bodies: WeakSet<object>;
  readonly cancellationCount: () => number;
  readonly restore: () => void;
} {
  const previousDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "FixedLengthStream",
  );
  const bodies = new WeakSet<object>();
  let cancellations = 0;
  class FixedLengthStreamFixture {
    public readonly readable: ReadableStream<Uint8Array>;
    public readonly writable: WritableStream<Uint8Array>;

    public constructor(expectedLength: number | bigint) {
      const expected = Number(expectedLength);
      let received = 0;
      const transform = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > expected) {
            controller.error(new Error("fixed length exceeded"));
            return;
          }
          controller.enqueue(chunk);
        },
        flush(controller) {
          if (received !== expected) {
            controller.error(new Error("fixed length incomplete"));
          }
        },
      });
      const reader = transform.readable.getReader();
      this.readable = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const result = await reader.read();
            if (result.done) {
              controller.close();
            } else {
              controller.enqueue(result.value);
            }
          } catch (error) {
            controller.error(error);
          }
        },
        cancel(reason) {
          cancellations += 1;
          return reader.cancel(reason);
        },
      });
      this.writable = transform.writable;
      bodies.add(this.readable);
    }
  }
  Object.defineProperty(globalThis, "FixedLengthStream", {
    configurable: true,
    value: FixedLengthStreamFixture,
  });
  return {
    bodies,
    cancellationCount: () => cancellations,
    restore: () => {
      if (previousDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, "FixedLengthStream");
      } else {
        Object.defineProperty(
          globalThis,
          "FixedLengthStream",
          previousDescriptor,
        );
      }
    },
  };
}

function objectBody(
  object: BroadcastTranscriptMediaObject,
  bytes: Uint8Array,
): BroadcastTranscriptMediaObjectBody {
  const bodyBytes = new Uint8Array(bytes);
  return {
    ...object,
    body: streamFor(bodyBytes),
    arrayBuffer: () => Promise.resolve(exactArrayBuffer(bodyBytes)),
  };
}

class MemoryR2Bucket implements BroadcastTranscriptMediaBucket {
  public readonly objects = new Map<string, StoredObject>();
  public readonly deletedKeys: string[] = [];
  public lastPutBody: ReadableStream<Uint8Array> | null = null;
  public lastPutOptions: BroadcastTranscriptMediaPutOptions | undefined;
  public putCount = 0;
  public conditionalRaceObject: StoredObject | null = null;

  public async put(
    key: string,
    value: ReadableStream<Uint8Array>,
    options?: BroadcastTranscriptMediaPutOptions,
  ): Promise<BroadcastTranscriptMediaObject | null> {
    if (
      options?.onlyIf?.etagDoesNotMatch === "*" &&
      this.objects.has(key)
    ) {
      return null;
    }
    if (this.conditionalRaceObject !== null) {
      this.objects.set(key, this.conditionalRaceObject);
      this.conditionalRaceObject = null;
      return null;
    }
    this.putCount += 1;
    this.lastPutBody = value;
    this.lastPutOptions = options;
    const bytes = await readStream(value);
    const checksum = new Uint8Array(
      await crypto.subtle.digest("SHA-256", exactArrayBuffer(bytes)),
    );
    const expected =
      options?.sha256 instanceof ArrayBuffer
        ? new Uint8Array(options.sha256)
        : null;
    if (
      expected === null ||
      expected.byteLength !== checksum.byteLength ||
      expected.some((byte, index) => byte !== checksum[index])
    ) {
      throw new Error("R2 native checksum mismatch");
    }
    const object: BroadcastTranscriptMediaObject = {
      key,
      size: bytes.byteLength,
      etag: "etag",
      httpEtag: '"etag"',
      ...(options?.httpMetadata === undefined
        ? {}
        : { httpMetadata: options.httpMetadata }),
      ...(options?.customMetadata === undefined
        ? {}
        : { customMetadata: options.customMetadata }),
      checksums: { sha256: exactArrayBuffer(checksum) },
    };
    this.objects.set(key, { bytes, object });
    return object;
  }

  public get(
    key: string,
    options?: BroadcastTranscriptMediaGetOptions,
  ): Promise<BroadcastTranscriptMediaObjectBody | null> {
    const stored = this.objects.get(key);
    if (stored === undefined) return Promise.resolve(null);
    const offset = options?.range?.offset ?? 0;
    const length =
      options?.range?.length ?? stored.bytes.byteLength - offset;
    const bytes = stored.bytes.slice(offset, offset + length);
    return Promise.resolve(
      objectBody(
        {
          ...stored.object,
          ...(options?.range === undefined
            ? {}
            : { range: { offset, length: bytes.byteLength } }),
        },
        bytes,
      ),
    );
  }

  public head(key: string): Promise<BroadcastTranscriptMediaObject | null> {
    return Promise.resolve(this.objects.get(key)?.object ?? null);
  }

  public delete(key: string | readonly string[]): Promise<void> {
    for (const item of typeof key === "string" ? [key] : key) {
      this.deletedKeys.push(item);
      this.objects.delete(item);
    }
    return Promise.resolve();
  }
}

function silentWav(durationMs: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(encodeCandidatePassBPcm16Wav(
    new Float32Array(
      Math.ceil(
        (durationMs / 1_000) * CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
      ),
    ),
    CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  ));
}

function maximumMultibyteCandidateContext(): CandidatePassBContextPacket {
  const maximumField = "가".repeat(
    MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH,
  );
  return {
    schemaVersion: "1.0.0",
    transcriptSource: "broadcast-transcript",
    transcriptKo: maximumField,
    beforeContextKo: maximumField,
    afterContextKo: maximumField,
    broadcastSummaryKo: maximumField,
    topicContextKo: maximumField,
    fastEvidenceKo: maximumField,
    contextDecision: "select",
    contextCategory: "reaction",
    contextVerdictKo: maximumField,
    chatReactionKo: maximumField,
  };
}

async function payloadDigest(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", exactArrayBuffer(bytes)),
  );
  return `sha256:${[...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function leaseHeaders(lease: AiQuotaLeaseHeaders): Record<string, string> {
  return {
    [AI_QUOTA_PARTICIPANT_HEADER]: lease.participantId,
    [AI_QUOTA_RUN_HEADER]: lease.runId,
    [AI_QUOTA_OPERATION_HEADER]: lease.operationId,
    [AI_QUOTA_PAYLOAD_DIGEST_HEADER]: lease.payloadDigest,
    [AI_QUOTA_LEASE_HEADER]: lease.leaseToken,
  };
}

function createLease(digest: string): AiQuotaLeaseHeaders {
  return {
    participantId: "participant_00000000000001",
    runId: "run-free-r2-1",
    operationId: "transcript-chunk-1",
    pool: "transcript",
    payloadDigest: digest,
    leaseToken: PUBLIC_LEASE_TOKEN,
  };
}

function createCoordinator(): {
  readonly requests: CoordinatorRequest[];
  readonly namespace: NonNullable<
    AiProxyEnvironment["AI_QUOTA_COORDINATOR"]
  >;
} {
  const requests: CoordinatorRequest[] = [];
  const fetch = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body !== "string") {
        throw new TypeError("Coordinator body must be JSON.");
      }
      const request = JSON.parse(init.body) as CoordinatorRequest;
      requests.push(request);
      return Promise.resolve(new Response(
        JSON.stringify({
          ok: true,
          status:
            request.action === "health"
              ? "healthy"
              : request.action === "lease"
              ? "granted"
              : request.action === "inspect"
              ? "valid"
              : request.action === "consume"
                ? "consumed"
                : request.action === "complete"
                  ? "completed"
                  : "released",
          ...(request.action === "health"
            ? { schemaVersion: "1.0.0" }
            : request.action === "lease"
              ? { leaseToken: PUBLIC_LEASE_TOKEN }
              : {}),
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ));
    },
  );
  return {
    requests,
    namespace: {
      getByName: vi.fn(() => ({ fetch })),
    },
  };
}

function createEnvironment(options: {
  readonly bucket?: MemoryR2Bucket;
  readonly clientLimit?: ReturnType<typeof vi.fn>;
  readonly globalLimit?: ReturnType<typeof vi.fn>;
  readonly mode?: "free-r2";
} = {}): {
  readonly environment: AiProxyEnvironment;
  readonly clientLimit: ReturnType<typeof vi.fn>;
  readonly globalLimit: ReturnType<typeof vi.fn>;
  readonly coordinator: ReturnType<typeof createCoordinator>;
} {
  const clientLimit =
    options.clientLimit ??
    vi.fn().mockResolvedValue({ success: true });
  const globalLimit =
    options.globalLimit ??
    vi.fn().mockResolvedValue({ success: true });
  const coordinator = createCoordinator();
  const environment: AiProxyEnvironment = {
    QWEN_API_KEY: "qwen-secret",
    CANDIDATE_INSIGHT_PROVIDER: "qwen",
    BROADCAST_TRANSCRIPT_PROVIDER: "qwen",
    AI_PROVIDER_FALLBACK_MODE: "bounded",
    AI_QUOTA_MODE: "required",
    AI_QUOTA_COORDINATOR: coordinator.namespace,
    RATE_LIMITER: {
      limit:
        globalLimit as AiProxyEnvironment["RATE_LIMITER"]["limit"],
    },
    IP_RATE_LIMITER: {
      limit:
        clientLimit as AiProxyEnvironment["IP_RATE_LIMITER"]["limit"],
    },
    ...(options.mode === undefined
      ? {}
      : {
          BROADCAST_TRANSCRIPT_TRANSPORT_MODE: options.mode,
          TRANSCRIPT_MEDIA: options.bucket,
          TRANSCRIPT_MEDIA_SIGNING_KEY: SIGNING_KEY,
        }),
  };
  return { environment, clientLimit, globalLimit, coordinator };
}

function stageRequest(
  wav: Uint8Array,
  lease: AiQuotaLeaseHeaders,
): Request {
  return new Request(
    `${TRANSCRIPT_ENDPOINT}?startMs=120000&durationMs=2000`,
    {
      method: "POST",
      headers: {
        Origin: PRODUCTION_ORIGIN,
        "Content-Type": "audio/wav",
        "CF-Connecting-IP": "203.0.113.42",
        ...leaseHeaders(lease),
      },
      body: wav as Uint8Array<ArrayBuffer>,
    },
  );
}

function resolveRequest(
  mediaTicket: string,
  lease: AiQuotaLeaseHeaders,
): Request {
  return new Request(TRANSCRIPT_ENDPOINT, {
    method: "POST",
    headers: {
      Origin: PRODUCTION_ORIGIN,
      "Content-Type": BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE,
      "CF-Connecting-IP": "203.0.113.42",
      ...leaseHeaders(lease),
    },
    body: JSON.stringify(
      createBroadcastTranscriptMediaResolveRequest(mediaTicket),
    ),
  });
}

function qwenSseSuccess(text: string): Response {
  return new Response(
    [
      `data: ${JSON.stringify({
        choices: [{ delta: { content: text }, finish_reason: null }],
      })}`,
      `data: ${JSON.stringify({
        choices: [{ delta: { content: "" }, finish_reason: "stop" }],
      })}`,
      "data: [DONE]",
      "",
    ].join("\n\n"),
    { status: 200 },
  );
}

async function stageFixture(options: {
  readonly clientLimit?: ReturnType<typeof vi.fn>;
  readonly globalLimit?: ReturnType<typeof vi.fn>;
} = {}): Promise<{
  readonly bucket: MemoryR2Bucket;
  readonly environment: AiProxyEnvironment;
  readonly lease: AiQuotaLeaseHeaders;
  readonly mediaTicket: string;
  readonly clientLimit: ReturnType<typeof vi.fn>;
  readonly globalLimit: ReturnType<typeof vi.fn>;
  readonly coordinator: ReturnType<typeof createCoordinator>;
}> {
  const bucket = new MemoryR2Bucket();
  const wav = silentWav(2_000);
  const lease = createLease(await payloadDigest(wav));
  const fixture = createEnvironment({
    bucket,
    mode: "free-r2",
    ...(options.clientLimit === undefined
      ? {}
      : { clientLimit: options.clientLimit }),
    ...(options.globalLimit === undefined
      ? {}
      : { globalLimit: options.globalLimit }),
  });
  const response = await handleBroadcastTranscriptRequest(
    stageRequest(wav, lease),
    fixture.environment,
  );
  expect(response.status).toBe(202);
  const payload = (await response.json()) as { mediaTicket: string };
  return {
    bucket,
    environment: fixture.environment,
    lease,
    mediaTicket: payload.mediaTicket,
    clientLimit: fixture.clientLimit,
    globalLimit: fixture.globalLimit,
    coordinator: fixture.coordinator,
  };
}

async function stageCandidateMediaFixture(): Promise<{
  readonly bucket: MemoryR2Bucket;
  readonly environment: AiProxyEnvironment;
  readonly lease: AiQuotaLeaseHeaders;
  readonly mediaTicket: string;
  readonly durationMs: number;
  readonly bundle: Uint8Array<ArrayBuffer>;
  readonly stageUrl: URL;
  readonly coordinator: ReturnType<typeof createCoordinator>;
}> {
  const bucket = new MemoryR2Bucket();
  const durationMs = 2_000;
  const wav = silentWav(durationMs);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 0xff, 0xd9]);
  const bundle = new Uint8Array(wav.byteLength + 4 * jpeg.byteLength);
  bundle.set(wav);
  for (let index = 0; index < 4; index += 1) {
    bundle.set(jpeg, wav.byteLength + index * jpeg.byteLength);
  }
  const lease: AiQuotaLeaseHeaders = {
    participantId: "participant_00000000000001",
    runId: "run-candidate-r2-1",
    operationId: "candidate-r2-1",
    pool: "candidate",
    payloadDigest: await payloadDigest(bundle),
    leaseToken: PUBLIC_LEASE_TOKEN,
  };
  const created = createEnvironment({
    bucket,
    mode: "free-r2",
  });
  const stageUrl = new URL(
    CANDIDATE_INSIGHT_MEDIA_ENDPOINT_PATH,
    "https://rettohighlight-gemini.example",
  );
  stageUrl.searchParams.set(
    "candidateHash",
    "0123456789abcdef01234567",
  );
  stageUrl.searchParams.set("durationMs", String(durationMs));
  stageUrl.searchParams.set("audioBytes", String(wav.byteLength));
  [200, 600, 1_200, 1_800].forEach((timestampMs, index) => {
    stageUrl.searchParams.set(`f${index}t`, String(timestampMs));
    stageUrl.searchParams.set(`f${index}b`, String(jpeg.byteLength));
  });
  const response = await worker.fetch(
    new Request(stageUrl, {
      method: "POST",
      headers: {
        Origin: PRODUCTION_ORIGIN,
        "Content-Type": CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
        "CF-Connecting-IP": "203.0.113.42",
        ...leaseHeaders(lease),
      },
      body: bundle,
    }),
    created.environment,
  );
  expect(response.status).toBe(202);
  const payload = (await response.json()) as { readonly mediaTicket: string };
  return {
    bucket,
    environment: created.environment,
    lease,
    mediaTicket: payload.mediaTicket,
    durationMs,
    bundle,
    stageUrl,
    coordinator: created.coordinator,
  };
}

describe("free R2 transcript Worker integration", () => {
  it("fails closed on a missing transport mode before reading media or calling a limiter/provider", async () => {
    const wav = silentWav(2_000);
    const request = stageRequest(
      wav,
      createLease(await payloadDigest(wav)),
    );
    if (request.body === null) throw new Error("Expected request body.");
    const bodyReader = vi.spyOn(request.body, "getReader");
    const { environment, clientLimit, globalLimit, coordinator } =
      createEnvironment();
    const providerFetch = vi.fn();

    const response = await handleBroadcastTranscriptRequest(
      request,
      environment,
      { fetchImplementation: providerFetch },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "TRANSCRIPT_TRANSPORT_NOT_CONFIGURED" },
    });
    expect(request.bodyUsed).toBe(false);
    expect(bodyReader).not.toHaveBeenCalled();
    expect(coordinator.requests).toHaveLength(0);
    expect(clientLimit).not.toHaveBeenCalled();
    expect(globalLimit).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("rejects a Free-mode legacy body before reading it", async () => {
    const bucket = new MemoryR2Bucket();
    const request = new Request(
      `${TRANSCRIPT_ENDPOINT}?startMs=120000&durationMs=2000`,
      {
        method: "POST",
        headers: {
          Origin: PRODUCTION_ORIGIN,
          "Content-Type": "application/vnd.exclipper.transcript-base64",
        },
        body: "UklGRg==",
      },
    );
    const { environment, clientLimit, globalLimit, coordinator } =
      createEnvironment({ bucket, mode: "free-r2" });

    const response = await handleBroadcastTranscriptRequest(
      request,
      environment,
    );

    expect(response.status).toBe(426);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CLIENT_UPDATE_REQUIRED" },
    });
    expect(request.bodyUsed).toBe(false);
    expect(bucket.objects.size).toBe(0);
    expect(coordinator.requests).toHaveLength(0);
    expect(clientLimit).not.toHaveBeenCalled();
    expect(globalLimit).not.toHaveBeenCalled();
  });

  it("streams raw WAV to R2 and returns 202 without provider or global limiter work", async () => {
    const bucket = new MemoryR2Bucket();
    const wav = silentWav(2_000);
    const lease = createLease(await payloadDigest(wav));
    const { environment, clientLimit, globalLimit, coordinator } =
      createEnvironment({ bucket, mode: "free-r2" });
    const request = stageRequest(wav, lease);
    const requestBody = request.body;
    const providerFetch = vi.fn();

    const response = await handleBroadcastTranscriptRequest(
      request,
      environment,
      { fetchImplementation: providerFetch },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "staged",
      sourceStartMs: 120_000,
      sourceEndMs: 122_000,
    });
    expect(bucket.lastPutBody).toBe(requestBody);
    expect(bucket.lastPutOptions?.sha256).toBeInstanceOf(ArrayBuffer);
    expect(bucket.objects.size).toBe(1);
    expect(coordinator.requests.map(({ action }) => action)).toEqual([
      "inspect",
    ]);
    expect(clientLimit).toHaveBeenCalledOnce();
    expect(globalLimit).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("resolves a staged ticket as a Qwen HTTPS URL and deletes media after success", async () => {
    const fixture = await stageFixture();
    let providerBody = "";
    const providerFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected a small Qwen JSON body.");
        }
        providerBody = init.body;
        return Promise.resolve(
          qwenSseSuccess("화면을 보며 이야기합니다."),
        );
      },
    );

    const response = await handleBroadcastTranscriptRequest(
      resolveRequest(fixture.mediaTicket, fixture.lease),
      fixture.environment,
      { fetchImplementation: providerFetch },
    );

    expect(response.status).toBe(200);
    const qwenPayload = JSON.parse(providerBody) as {
      messages: Array<{
        content: Array<{
          input_audio?: { data?: string; format?: string };
        }>;
      }>;
    };
    const audioUrl =
      qwenPayload.messages[0]?.content[0]?.input_audio?.data ?? "";
    expect(audioUrl).toMatch(
      /^https:\/\/rettohighlight-gemini\.example\/v1\/broadcast-transcript-media\?mediaTicket=/u,
    );
    expect(qwenPayload.messages[0]?.content[0]?.input_audio?.format).toBe(
      "wav",
    );
    expect(providerBody).not.toContain("audioBase64");
    expect(providerBody).not.toContain("data:audio/");
    expect(providerBody.length).toBeLessThan(3_000);
    expect(fixture.bucket.objects.size).toBe(0);
    expect(fixture.bucket.deletedKeys).toHaveLength(1);
    expect(fixture.coordinator.requests.map(({ action }) => action)).toEqual([
      "inspect",
      "inspect",
      "consume",
      "complete",
    ]);
  });

  it.each(["local", "provider"] as const)(
    "retains staged media when %s rate limiting asks the client to retry",
    async (kind) => {
      const clientLimit = vi.fn().mockResolvedValue({ success: true });
      if (kind === "local") {
        clientLimit
          .mockResolvedValueOnce({ success: true })
          .mockResolvedValueOnce({ success: false });
      }
      const fixture = await stageFixture({ clientLimit });
      const providerFetch =
        kind === "provider"
          ? vi.fn().mockResolvedValue(new Response(null, { status: 429 }))
          : vi.fn();

      const response = await handleBroadcastTranscriptRequest(
        resolveRequest(fixture.mediaTicket, fixture.lease),
        fixture.environment,
        { fetchImplementation: providerFetch },
      );

      expect(response.status).toBe(429);
      expect(fixture.bucket.objects.size).toBe(1);
      expect(fixture.bucket.deletedKeys).toHaveLength(0);
      if (kind === "local") {
        expect(providerFetch).not.toHaveBeenCalled();
      } else {
        expect(providerFetch).toHaveBeenCalledOnce();
      }
    },
  );

  it("retains staged transcript media when the provider outcome is unknown", async () => {
    const fixture = await stageFixture();
    const response = await handleBroadcastTranscriptRequest(
      resolveRequest(fixture.mediaTicket, fixture.lease),
      fixture.environment,
      {
        fetchImplementation: vi.fn(() =>
          Promise.reject(new TypeError("provider connection lost")),
        ),
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UPSTREAM_OUTCOME_UNKNOWN" },
    });
    expect(fixture.bucket.objects.size).toBe(1);
    expect(fixture.bucket.deletedKeys).toHaveLength(0);
  });

  it("retains staged transcript media when limiter state is temporarily unavailable", async () => {
    const fixture = await stageFixture();
    vi.spyOn(fixture.environment.IP_RATE_LIMITER, "limit").mockRejectedValueOnce(
      new Error("limiter unavailable"),
    );
    const providerFetch = vi.fn();

    const response = await handleBroadcastTranscriptRequest(
      resolveRequest(fixture.mediaTicket, fixture.lease),
      fixture.environment,
      { fetchImplementation: providerFetch },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RATE_LIMIT_UNAVAILABLE" },
    });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(fixture.bucket.objects.size).toBe(1);
    expect(fixture.bucket.deletedKeys).toHaveLength(0);
  });

  it("serves provider GET, HEAD, and one byte range without browser CORS", async () => {
    const fixture = await stageFixture();
    const capabilityUrl =
      `https://rettohighlight-gemini.example/v1/broadcast-transcript-media` +
      `?mediaTicket=${encodeURIComponent(fixture.mediaTicket)}`;

    const getResponse = await worker.fetch(
      new Request(capabilityUrl),
      fixture.environment,
    );
    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("Content-Type")).toBe("audio/wav");
    expect(getResponse.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect((await getResponse.arrayBuffer()).byteLength).toBe(
      silentWav(2_000).byteLength,
    );

    const headResponse = await worker.fetch(
      new Request(capabilityUrl, { method: "HEAD" }),
      fixture.environment,
    );
    expect(headResponse.status).toBe(200);
    expect((await headResponse.arrayBuffer()).byteLength).toBe(0);
    expect(headResponse.headers.has("Access-Control-Allow-Origin")).toBe(
      false,
    );

    const rangeResponse = await worker.fetch(
      new Request(capabilityUrl, {
        headers: { Range: "bytes=10-19" },
      }),
      fixture.environment,
    );
    expect(rangeResponse.status).toBe(206);
    expect(rangeResponse.headers.get("Content-Length")).toBe("10");
    expect(rangeResponse.headers.get("Content-Range")).toBe(
      `bytes 10-19/${silentWav(2_000).byteLength}`,
    );
    expect((await rangeResponse.arrayBuffer()).byteLength).toBe(10);
    expect(rangeResponse.headers.has("Access-Control-Allow-Origin")).toBe(
      false,
    );
  });
});

describe("free R2 candidate media Worker integration", () => {
  it("preserves a fixed byte length before a transformed body reaches R2", async () => {
    const fixedLengthStream = installFixedLengthStreamFixture();
    try {
      const fixture = await stageCandidateMediaFixture();
      expect(fixture.bucket.lastPutBody).not.toBeNull();
      expect(
        fixedLengthStream.bodies.has(fixture.bucket.lastPutBody as object),
      ).toBe(true);
    } finally {
      fixedLengthStream.restore();
    }
  });

  it("reuses an identical staged bundle without leaving its fixed-length upload blocked", async () => {
    const fixedLengthStream = installFixedLengthStreamFixture();
    try {
      const fixture = await stageCandidateMediaFixture();
      const retryBody = cancellableOpenStream(fixture.bundle);
      const retryRequest = requestWithStreamBody(fixture.stageUrl, {
        method: "POST",
        headers: {
          Origin: PRODUCTION_ORIGIN,
          "Content-Type": CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
          "CF-Connecting-IP": "203.0.113.42",
          ...leaseHeaders(fixture.lease),
        },
        body: retryBody.body,
      });
      const retryResponse = await withDeadline(
        worker.fetch(retryRequest, fixture.environment),
        1_000,
        "identical candidate stage retry stalled",
      );

      expect(retryResponse.status).toBe(202);
      await expect(retryResponse.json()).resolves.toMatchObject({
        mediaTicket: fixture.mediaTicket,
      });
      expect(retryRequest.bodyUsed).toBe(true);
      expect(fixedLengthStream.cancellationCount()).toBe(1);
      expect(fixture.bucket.objects).toHaveLength(1);
      expect(fixture.bucket.putCount).toBe(1);
      expect(fixture.bucket.deletedKeys).toHaveLength(0);
      expect(
        fixture.coordinator.requests.map(({ action }) => action),
      ).toEqual(["inspect", "inspect"]);
    } finally {
      fixedLengthStream.restore();
    }
  });

  it("settles a conditional R2 race without consuming the losing upload", async () => {
    const fixedLengthStream = installFixedLengthStreamFixture();
    try {
      const fixture = await stageCandidateMediaFixture();
      const stored = [...fixture.bucket.objects.values()][0];
      expect(stored).toBeDefined();
      if (stored === undefined) return;
      fixture.bucket.objects.clear();
      fixture.bucket.conditionalRaceObject = stored;
      const retryBody = cancellableOpenStream(fixture.bundle);
      const retryResponse = await withDeadline(
        worker.fetch(
          requestWithStreamBody(fixture.stageUrl, {
            method: "POST",
            headers: {
              Origin: PRODUCTION_ORIGIN,
              "Content-Type": CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
              "CF-Connecting-IP": "203.0.113.42",
              ...leaseHeaders(fixture.lease),
            },
            body: retryBody.body,
          }),
          fixture.environment,
        ),
        1_000,
        "conditional candidate stage race stalled",
      );

      expect(retryResponse.status).toBe(202);
      await expect(retryResponse.json()).resolves.toMatchObject({
        mediaTicket: fixture.mediaTicket,
      });
      expect(fixedLengthStream.cancellationCount()).toBe(1);
      expect(fixture.bucket.conditionalRaceObject).toBeNull();
      expect(fixture.bucket.objects).toHaveLength(1);
      expect(fixture.bucket.putCount).toBe(1);
      expect(fixture.bucket.deletedKeys).toHaveLength(0);
    } finally {
      fixedLengthStream.restore();
    }
  });

  it("rejects a conflicting manifest without stranding its unused upload", async () => {
    const fixedLengthStream = installFixedLengthStreamFixture();
    try {
      const fixture = await stageCandidateMediaFixture();
      const conflictUrl = new URL(fixture.stageUrl);
      conflictUrl.searchParams.set(
        "candidateHash",
        "fedcba987654321001234567",
      );
      const conflictBody = cancellableOpenStream(fixture.bundle);
      const conflictResponse = await withDeadline(
        worker.fetch(
          requestWithStreamBody(conflictUrl, {
            method: "POST",
            headers: {
              Origin: PRODUCTION_ORIGIN,
              "Content-Type": CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
              "CF-Connecting-IP": "203.0.113.42",
              ...leaseHeaders(fixture.lease),
            },
            body: conflictBody.body,
          }),
          fixture.environment,
        ),
        1_000,
        "conflicting candidate stage request stalled",
      );

      expect(conflictResponse.status).toBe(503);
      expect(conflictResponse.headers.get("Access-Control-Allow-Origin")).toBe(
        PRODUCTION_ORIGIN,
      );
      await expect(conflictResponse.json()).resolves.toMatchObject({
        error: { code: "CANDIDATE_MEDIA_UNAVAILABLE" },
      });
      expect(fixedLengthStream.cancellationCount()).toBe(1);
      expect(fixture.bucket.objects).toHaveLength(1);
      expect(fixture.bucket.putCount).toBe(1);
      expect(fixture.bucket.deletedKeys).toHaveLength(0);
    } finally {
      fixedLengthStream.restore();
    }
  });

  it("keeps bounded legacy candidate JSON working during a one-release rollout", async () => {
    const durationMs = 2_000;
    const wav = silentWav(durationMs);
    const jpegBase64 = btoa(
      String.fromCharCode(0xff, 0xd8, 0xff, 1, 2, 0xff, 0xd9),
    );
    const serialized = JSON.stringify(
      buildCandidatePassBProxyRequestBody(
        encodeCandidatePassBBase64(wav),
        durationMs,
        [200, 600, 1_200, 1_800].map((timestampMs) => ({
          timestampMs,
          mimeType: "image/jpeg" as const,
          dataBase64: jpegBase64,
        })),
      ),
    );
    const lease: AiQuotaLeaseHeaders = {
      participantId: "participant_00000000000001",
      runId: "run-candidate-legacy-rollout",
      operationId: "candidate-legacy-rollout",
      pool: "candidate",
      payloadDigest: await payloadDigest(
        new TextEncoder().encode(serialized),
      ),
      leaseToken: PUBLIC_LEASE_TOKEN,
    };
    const bucket = new MemoryR2Bucket();
    const { environment } = createEnvironment({
      bucket,
      mode: "free-r2",
    });
    const analysis = {
      segments: [
        {
          relativeStartMs: 200,
          relativeEndMs: 1_200,
          text: "스트리머가 상황을 다시 확인합니다.",
        },
      ],
      eventSummaryKo: "화면의 사건을 확인한 뒤 스트리머가 놀라는 장면입니다.",
      reactionSummaryKo: "상황을 알아차리고 목소리가 커지며 당황합니다.",
      whyGoodClipKo: "사건과 반응의 순서가 화면과 대사에서 명확합니다.",
      uncertaintiesKo: [],
      participantPresence: "present-unidentified",
      participantSummaryKo: "진행자는 보이지만 이름 근거는 확인되지 않았습니다.",
      identifiedParticipants: [],
      clipDecision: "recommend",
      contextConsistency: "consistent",
      programMaterial: "streamer-event",
    };
    const providerFetch = vi.fn().mockResolvedValue(
      qwenSseSuccess(JSON.stringify(analysis)),
    );

    const response = await handleCandidateInsightRequest(
      new Request(
        "https://rettohighlight-gemini.example/v1/candidate-insights",
        {
          method: "POST",
          headers: {
            Origin: PRODUCTION_ORIGIN,
            "Content-Type": "application/json",
            "CF-Connecting-IP": "203.0.113.42",
            ...leaseHeaders(lease),
          },
          body: serialized,
        },
      ),
      environment,
      { fetchImplementation: providerFetch },
    );

    expect(response.status).toBe(200);
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(bucket.objects).toHaveLength(0);
  });

  it("streams one bundle, sends only capability URLs upstream, and deletes it after success", async () => {
    const bucket = new MemoryR2Bucket();
    const durationMs = 2_000;
    const wav = silentWav(durationMs);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 0xff, 0xd9]);
    const bundle = new Uint8Array(wav.byteLength + 4 * jpeg.byteLength);
    bundle.set(wav);
    for (let index = 0; index < 4; index += 1) {
      bundle.set(jpeg, wav.byteLength + index * jpeg.byteLength);
    }
    const lease: AiQuotaLeaseHeaders = {
      participantId: "participant_00000000000001",
      runId: "run-candidate-r2-1",
      operationId: "candidate-r2-1",
      pool: "candidate",
      payloadDigest: await payloadDigest(bundle),
      leaseToken: PUBLIC_LEASE_TOKEN,
    };
    const fixture = createEnvironment({
      bucket,
      mode: "free-r2",
    });
    const stageUrl = new URL(
      CANDIDATE_INSIGHT_MEDIA_ENDPOINT_PATH,
      "https://rettohighlight-gemini.example",
    );
    stageUrl.searchParams.set(
      "candidateHash",
      "0123456789abcdef01234567",
    );
    stageUrl.searchParams.set("durationMs", String(durationMs));
    stageUrl.searchParams.set("audioBytes", String(wav.byteLength));
    [200, 600, 1_200, 1_800].forEach((timestampMs, index) => {
      stageUrl.searchParams.set(`f${index}t`, String(timestampMs));
      stageUrl.searchParams.set(`f${index}b`, String(jpeg.byteLength));
    });
    const stageResponse = await worker.fetch(
      new Request(stageUrl, {
        method: "POST",
        headers: {
          Origin: PRODUCTION_ORIGIN,
          "Content-Type": CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
          "CF-Connecting-IP": "203.0.113.42",
          ...leaseHeaders(lease),
        },
        body: bundle,
      }),
      fixture.environment,
    );
    expect(stageResponse.status).toBe(202);
    const staged = (await stageResponse.json()) as {
      readonly mediaTicket: string;
    };
    expect(bucket.objects).toHaveLength(1);

    const analysis = {
      segments: [
        {
          relativeStartMs: 200,
          relativeEndMs: 1_200,
          text: "스트리머가 놀라서 상황을 다시 확인합니다.",
        },
      ],
      eventSummaryKo: "화면의 사건을 확인한 뒤 스트리머가 놀라는 장면입니다.",
      reactionSummaryKo: "상황을 알아차리고 목소리가 커지며 당황합니다.",
      whyGoodClipKo: "사건과 반응의 순서가 화면과 대사에서 명확합니다.",
      uncertaintiesKo: [],
      participantPresence: "present-unidentified",
      participantSummaryKo: "진행자는 보이지만 이름 근거는 확인되지 않았습니다.",
      identifiedParticipants: [],
      clipDecision: "recommend",
      contextConsistency: "consistent",
      programMaterial: "streamer-event",
    };
    let providerBody = "";
    const providerFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected a bounded Qwen JSON request.");
        }
        providerBody = init.body;
        return Promise.resolve(qwenSseSuccess(JSON.stringify(analysis)));
      },
    );
    const resolveResponse = await handleCandidateInsightRequest(
      new Request(
        "https://rettohighlight-gemini.example/v1/candidate-insights",
        {
          method: "POST",
          headers: {
            Origin: PRODUCTION_ORIGIN,
            "Content-Type": CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
            "CF-Connecting-IP": "203.0.113.42",
            ...leaseHeaders(lease),
          },
          body: JSON.stringify(
            createCandidateInsightMediaResolveRequest(
              staged.mediaTicket,
              durationMs,
              null,
              "ko",
              null,
            ),
          ),
        },
      ),
      fixture.environment,
      { fetchImplementation: providerFetch },
    );

    expect(resolveResponse.status).toBe(200);
    const upstream = JSON.parse(providerBody) as {
      readonly messages: readonly [{
        readonly content: ReadonlyArray<{
          readonly input_audio?: { readonly data?: string };
          readonly image_url?: { readonly url?: string };
        }>;
      }];
    };
    const content = upstream.messages[0].content;
    expect(content[0]?.input_audio?.data).toMatch(
      /\/v1\/candidate-insight-media\?mediaTicket=.*&part=audio/u,
    );
    expect(
      content
        .filter((part) => part.image_url !== undefined)
        .map((part) => part.image_url?.url),
    ).toHaveLength(4);
    expect(providerBody).not.toContain("base64");
    expect(providerBody.length).toBeLessThan(40_000);
    expect(bucket.objects).toHaveLength(0);
    expect(bucket.deletedKeys).toHaveLength(1);
    expect(
      fixture.coordinator.requests.map((request) => request.action),
    ).toEqual(["inspect", "inspect", "consume", "complete"]);
  });

  it("repairs an invalid candidate schema with a fresh internal quota attempt", async () => {
    const fixture = await stageCandidateMediaFixture();
    const validAnalysis = {
      segments: [
        {
          relativeStartMs: 200,
          relativeEndMs: 1_200,
          text: "스트리머가 음식 이름을 다시 확인합니다.",
        },
      ],
      eventSummaryKo: "음식 사진을 보고 이름을 맞히는 과정에서 예상과 다른 답을 발견합니다.",
      reactionSummaryKo: "스트리머가 잠시 멈춘 뒤 웃으며 자신의 답을 정정합니다.",
      whyGoodClipKo: "사건과 반응의 전환이 짧은 구간 안에서 분명하게 이어집니다.",
      uncertaintiesKo: [],
      participantPresence: "present-unidentified",
      participantSummaryKo: "한 명의 진행자가 말하고 있지만 이름을 확정할 화면 근거는 없습니다.",
      identifiedParticipants: [],
      clipDecision: "recommend",
      contextConsistency: "consistent",
      programMaterial: "streamer-event",
    };
    const providerFetch = vi
      .fn()
      .mockResolvedValueOnce(qwenSseSuccess("{}"))
      .mockResolvedValueOnce(
        qwenSseSuccess(JSON.stringify(validAnalysis)),
      );

    const response = await handleCandidateInsightRequest(
      new Request(
        "https://rettohighlight-gemini.example/v1/candidate-insights",
        {
          method: "POST",
          headers: {
            Origin: PRODUCTION_ORIGIN,
            "Content-Type": CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
            "CF-Connecting-IP": "203.0.113.42",
            ...leaseHeaders(fixture.lease),
          },
          body: JSON.stringify(
            createCandidateInsightMediaResolveRequest(
              fixture.mediaTicket,
              fixture.durationMs,
              null,
              "ko",
              null,
            ),
          ),
        },
      ),
      fixture.environment,
      { fetchImplementation: providerFetch },
    );

    expect(response.status).toBe(200);
    expect(providerFetch).toHaveBeenCalledTimes(2);
    expect(fixture.bucket.objects).toHaveLength(0);
    expect(
      fixture.coordinator.requests.map(({ action }) => action),
    ).toEqual([
      "inspect",
      "inspect",
      "consume",
      "complete",
      "lease",
      "consume",
      "complete",
    ]);
  });

  it("retains staged media after bounded schema recovery is exhausted", async () => {
    const fixture = await stageCandidateMediaFixture();
    const malformedSchema = JSON.stringify({
      "bad\nkey": true,
      segments: [],
      participantPresence: "invalid\r\npresence",
    });
    const providerFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(qwenSseSuccess(malformedSchema)),
    );

    const response = await handleCandidateInsightRequest(
      new Request(
        "https://rettohighlight-gemini.example/v1/candidate-insights",
        {
          method: "POST",
          headers: {
            Origin: PRODUCTION_ORIGIN,
            "Content-Type": CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
            "CF-Connecting-IP": "203.0.113.42",
            ...leaseHeaders(fixture.lease),
          },
          body: JSON.stringify(
            createCandidateInsightMediaResolveRequest(
              fixture.mediaTicket,
              fixture.durationMs,
              null,
              "ko",
              null,
            ),
          ),
        },
      ),
      fixture.environment,
      { fetchImplementation: providerFetch },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UPSTREAM_INVALID_RESPONSE" },
    });
    expect(response.headers.get("X-Qwen-Presence")).toBe(
      "invalid??presence",
    );
    expect(response.headers.get("X-Qwen-Keys")).toContain("bad?key");
    expect(providerFetch).toHaveBeenCalledTimes(3);
    expect(fixture.bucket.objects).toHaveLength(1);
    expect(fixture.bucket.deletedKeys).toHaveLength(0);
  });

  it("stops a length-less candidate upload at the signed byte fence", async () => {
    const bucket = new MemoryR2Bucket();
    const durationMs = 2_000;
    const wav = silentWav(durationMs);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 0xff, 0xd9]);
    const bundle = new Uint8Array(wav.byteLength + 4 * jpeg.byteLength);
    bundle.set(wav);
    for (let index = 0; index < 4; index += 1) {
      bundle.set(jpeg, wav.byteLength + index * jpeg.byteLength);
    }
    const oversizedBundle = new Uint8Array(bundle.byteLength + 1);
    oversizedBundle.set(bundle);
    oversizedBundle[oversizedBundle.byteLength - 1] = 0xff;
    const lease: AiQuotaLeaseHeaders = {
      participantId: "participant_00000000000001",
      runId: "run-candidate-r2-oversized",
      operationId: "candidate-r2-oversized",
      pool: "candidate",
      payloadDigest: await payloadDigest(bundle),
      leaseToken: PUBLIC_LEASE_TOKEN,
    };
    const { environment } = createEnvironment({
      bucket,
      mode: "free-r2",
    });
    const stageUrl = new URL(
      CANDIDATE_INSIGHT_MEDIA_ENDPOINT_PATH,
      "https://rettohighlight-gemini.example",
    );
    stageUrl.searchParams.set(
      "candidateHash",
      "0123456789abcdef01234567",
    );
    stageUrl.searchParams.set("durationMs", String(durationMs));
    stageUrl.searchParams.set("audioBytes", String(wav.byteLength));
    [200, 600, 1_200, 1_800].forEach((timestampMs, index) => {
      stageUrl.searchParams.set(`f${index}t`, String(timestampMs));
      stageUrl.searchParams.set(`f${index}b`, String(jpeg.byteLength));
    });
    const request = new Request(stageUrl, {
      method: "POST",
      headers: {
        Origin: PRODUCTION_ORIGIN,
        "Content-Type": CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
        "CF-Connecting-IP": "203.0.113.42",
        ...leaseHeaders(lease),
      },
      body: oversizedBundle,
    });
    expect(request.headers.get("Content-Length")).toBeNull();

    const response = await worker.fetch(request, environment);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
    expect(bucket.objects).toHaveLength(0);
  });

  it("retains the capability after an outcome-unknown provider failure", async () => {
    const fixture = await stageCandidateMediaFixture();
    const response = await handleCandidateInsightRequest(
      new Request(
        "https://rettohighlight-gemini.example/v1/candidate-insights",
        {
          method: "POST",
          headers: {
            Origin: PRODUCTION_ORIGIN,
            "Content-Type": CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
            "CF-Connecting-IP": "203.0.113.42",
            ...leaseHeaders(fixture.lease),
          },
          body: JSON.stringify(
            createCandidateInsightMediaResolveRequest(
              fixture.mediaTicket,
              fixture.durationMs,
              null,
              "ko",
              null,
            ),
          ),
        },
      ),
      fixture.environment,
      {
        fetchImplementation: vi.fn().mockRejectedValue(
          new Error("provider connection outcome unknown"),
        ),
        upstreamRetryDelaysMs: [],
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UPSTREAM_OUTCOME_UNKNOWN" },
    });
    expect(fixture.bucket.objects).toHaveLength(1);
    expect(fixture.bucket.deletedKeys).toHaveLength(0);
  });

  it("canonicalizes a maximum context and continues to provider execution", async () => {
    const fixture = await stageCandidateMediaFixture();
    const clientLimit = vi.mocked(
      fixture.environment.IP_RATE_LIMITER.limit,
    );
    const globalLimit = vi.mocked(
      fixture.environment.RATE_LIMITER.limit,
    );
    clientLimit.mockClear();
    globalLimit.mockClear();
    const providerFetch = vi.fn().mockResolvedValue(
      qwenSseSuccess(JSON.stringify({
        segments: [
          {
            relativeStartMs: 200,
            relativeEndMs: 1_200,
            text: "스트리머가 상황을 다시 확인합니다.",
          },
        ],
        eventSummaryKo: "후보 맥락과 화면에서 사건을 확인했습니다.",
        reactionSummaryKo: "스트리머가 상황을 알아차리고 반응했습니다.",
        whyGoodClipKo: "사건과 반응의 흐름이 짧은 구간 안에서 완결됩니다.",
        uncertaintiesKo: [],
        participantPresence: "present-unidentified",
        participantSummaryKo: "진행자는 보이지만 이름 근거는 확인되지 않았습니다.",
        identifiedParticipants: [],
        clipDecision: "recommend",
        contextConsistency: "consistent",
        programMaterial: "streamer-event",
      })),
    );
    const response = await handleCandidateInsightRequest(
      new Request(
        "https://rettohighlight-gemini.example/v1/candidate-insights",
        {
          method: "POST",
          headers: {
            Origin: PRODUCTION_ORIGIN,
            "Content-Type": CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
            "CF-Connecting-IP": "203.0.113.42",
            ...leaseHeaders(fixture.lease),
          },
          body: JSON.stringify(
            createCandidateInsightMediaResolveRequest(
              fixture.mediaTicket,
              fixture.durationMs,
              null,
              "ko",
              maximumMultibyteCandidateContext(),
            ),
          ),
        },
      ),
      fixture.environment,
      { fetchImplementation: providerFetch },
    );

    expect(response.status).toBe(200);
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(clientLimit).toHaveBeenCalledOnce();
    expect(globalLimit).toHaveBeenCalledOnce();
    expect(fixture.bucket.objects).toHaveLength(0);
    expect(fixture.bucket.deletedKeys).toHaveLength(1);
  });

  it("retains the same staged ticket when the provider asks for a retry", async () => {
    const fixture = await stageCandidateMediaFixture();
    const response = await handleCandidateInsightRequest(
      new Request(
        "https://rettohighlight-gemini.example/v1/candidate-insights",
        {
          method: "POST",
          headers: {
            Origin: PRODUCTION_ORIGIN,
            "Content-Type": CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
            "CF-Connecting-IP": "203.0.113.42",
            ...leaseHeaders(fixture.lease),
          },
          body: JSON.stringify(
            createCandidateInsightMediaResolveRequest(
              fixture.mediaTicket,
              fixture.durationMs,
              null,
              "ko",
              null,
            ),
          ),
        },
      ),
      fixture.environment,
      {
        fetchImplementation: vi
          .fn()
          .mockResolvedValue(new Response(null, { status: 429 })),
        upstreamRetryDelaysMs: [],
      },
    );

    expect(response.status).toBe(429);
    expect(fixture.bucket.objects).toHaveLength(1);
    expect(fixture.bucket.deletedKeys).toHaveLength(0);
    const resolved = await worker.fetch(
      new Request(
        `https://rettohighlight-gemini.example${CANDIDATE_INSIGHT_MEDIA_ENDPOINT_PATH}` +
          `?mediaTicket=${encodeURIComponent(fixture.mediaTicket)}&part=audio`,
      ),
      fixture.environment,
    );
    expect(resolved.status).toBe(200);
  });

  it("retains shared media when a duplicate resolve cannot check its rate limit", async () => {
    const fixture = await stageCandidateMediaFixture();
    vi.spyOn(
      fixture.environment.IP_RATE_LIMITER,
      "limit",
    ).mockRejectedValueOnce(new Error("limiter temporarily unavailable"));
    const providerFetch = vi.fn();
    const response = await handleCandidateInsightRequest(
      new Request(
        "https://rettohighlight-gemini.example/v1/candidate-insights",
        {
          method: "POST",
          headers: {
            Origin: PRODUCTION_ORIGIN,
            "Content-Type": CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
            "CF-Connecting-IP": "203.0.113.42",
            ...leaseHeaders(fixture.lease),
          },
          body: JSON.stringify(
            createCandidateInsightMediaResolveRequest(
              fixture.mediaTicket,
              fixture.durationMs,
              null,
              "ko",
              null,
            ),
          ),
        },
      ),
      fixture.environment,
      { fetchImplementation: providerFetch },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RATE_LIMIT_UNAVAILABLE" },
    });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(fixture.bucket.objects).toHaveLength(1);
    expect(fixture.bucket.deletedKeys).toHaveLength(0);
  });

  it("returns a CORS-visible 408 when the small resolve body stalls", async () => {
    const bucket = new MemoryR2Bucket();
    const { environment } = createEnvironment({
      bucket,
      mode: "free-r2",
    });
    const lease: AiQuotaLeaseHeaders = {
      participantId: "participant_00000000000001",
      runId: "run-candidate-timeout",
      operationId: "candidate-timeout",
      pool: "candidate",
      payloadDigest: `sha256:${"a".repeat(64)}`,
      leaseToken: PUBLIC_LEASE_TOKEN,
    };
    const response = await handleCandidateInsightRequest(
      new Request(
        "https://rettohighlight-gemini.example/v1/candidate-insights",
        {
          method: "POST",
          headers: {
            Origin: PRODUCTION_ORIGIN,
            "Content-Type": CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
            ...leaseHeaders(lease),
          },
          body: new ReadableStream<Uint8Array>(),
          duplex: "half",
        } as RequestInit & { duplex: "half" },
      ),
      environment,
      { requestBodyTimeoutMs: 10 },
    );

    expect(response.status).toBe(408);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REQUEST_BODY_TIMEOUT" },
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      PRODUCTION_ORIGIN,
    );
  });

  it("advertises staged candidate media only when Qwen is ready", async () => {
    const bucket = new MemoryR2Bucket();
    const { environment } = createEnvironment({
      bucket,
      mode: "free-r2",
    });
    const healthy = await worker.fetch(
      new Request("https://rettohighlight-gemini.example/healthz", {
        headers: { Origin: PRODUCTION_ORIGIN },
      }),
      environment,
    );
    expect(healthy.status).toBe(200);
    await expect(healthy.json()).resolves.toMatchObject({
      ok: true,
      candidateTransport: {
        mode: "free-r2",
        configured: true,
        requiredFrameCount: 4,
        providerFallbackMode: "disabled-capability-url",
      },
    });

    const {
      QWEN_API_KEY: configuredQwenKey,
      ...unavailableEnvironment
    } = environment;
    expect(configuredQwenKey).toBe("qwen-secret");
    const unavailable = await worker.fetch(
      new Request("https://rettohighlight-gemini.example/healthz", {
        headers: { Origin: PRODUCTION_ORIGIN },
      }),
      unavailableEnvironment,
    );
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({
      ok: false,
      candidateTransport: {
        mode: "free-r2",
        configured: false,
      },
    });
  });
});
