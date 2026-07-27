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
import { encodeCandidatePassBPcm16Wav } from "../analysis/candidatePassBGemini";
import { CANDIDATE_PASS_B_SAMPLE_RATE_HZ } from "../analysis/candidatePassBWorkerProtocol";
import worker, {
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
  readonly action: "inspect" | "consume" | "complete" | "release-upload";
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

  public async put(
    key: string,
    value: ReadableStream<Uint8Array>,
    options?: BroadcastTranscriptMediaPutOptions,
  ): Promise<BroadcastTranscriptMediaObject> {
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
            request.action === "inspect"
              ? "valid"
              : request.action === "consume"
                ? "consumed"
                : request.action === "complete"
                  ? "completed"
                  : "released",
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
