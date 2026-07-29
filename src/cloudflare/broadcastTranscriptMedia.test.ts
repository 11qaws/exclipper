import { describe, expect, it } from "vitest";

import type {
  BroadcastTranscriptMediaBinding,
  BroadcastTranscriptMediaBucket,
  BroadcastTranscriptMediaError,
  BroadcastTranscriptMediaGetOptions,
  BroadcastTranscriptMediaObject,
  BroadcastTranscriptMediaObjectBody,
  BroadcastTranscriptMediaPutOptions,
} from "./broadcastTranscriptMedia";
import {
  BROADCAST_TRANSCRIPT_MEDIA_CACHE_CONTROL,
  BROADCAST_TRANSCRIPT_MEDIA_CONTENT_TYPE,
  BROADCAST_TRANSCRIPT_MEDIA_HEADER_BYTES,
  createBroadcastTranscriptMediaCapabilityUrl,
  deleteBroadcastTranscriptMediaBestEffort,
  parseBroadcastTranscriptTransportMode,
  resolveBroadcastTranscriptMedia,
  resolveBroadcastTranscriptTransport,
  serveBroadcastTranscriptMediaRequest,
  stageBroadcastTranscriptMedia,
  verifyBroadcastTranscriptMediaTicket,
} from "./broadcastTranscriptMedia";

const SIGNING_KEY = "0123456789abcdef0123456789abcdef";
const ROUTE_MANIFEST_FINGERPRINT = `sha256:${"a".repeat(64)}`;
const NOW_MS = Date.UTC(2026, 6, 27, 12, 0, 0);

interface StoredObject {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly object: BroadcastTranscriptMediaObject;
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
  let byteLength = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
    byteLength += result.value.byteLength;
  }
  const merged = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function streamFor(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    exactArrayBuffer(bytes),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

async function bindingFor(
  bytes: Uint8Array,
): Promise<BroadcastTranscriptMediaBinding> {
  return {
    participantId: "participant_1234567890",
    runId: "run-1",
    operationId: "operation-1",
    pool: "transcript",
    payloadDigest: `sha256:${await sha256Hex(bytes)}`,
    routeManifestFingerprint: ROUTE_MANIFEST_FINGERPRINT,
    sourceStartMs: 120_000,
    durationMs: 30_000,
    expectedByteLength: bytes.byteLength,
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
  public lastGetOptions: BroadcastTranscriptMediaGetOptions | undefined;
  public reportedSizeDelta = 0;
  public omitChecksum = false;
  public failDelete = false;

  public async put(
    key: string,
    value: ReadableStream<Uint8Array>,
    options?: BroadcastTranscriptMediaPutOptions,
  ): Promise<BroadcastTranscriptMediaObject | null> {
    this.lastPutBody = value;
    this.lastPutOptions = options;
    const bytes = await readStream(value);
    const nativeChecksum =
      options?.sha256 instanceof ArrayBuffer
        ? new Uint8Array(options.sha256)
        : null;
    const actualChecksum = new Uint8Array(
      await crypto.subtle.digest("SHA-256", exactArrayBuffer(bytes)),
    );
    if (
      nativeChecksum === null ||
      nativeChecksum.byteLength !== actualChecksum.byteLength ||
      nativeChecksum.some((byte, index) => byte !== actualChecksum[index])
    ) {
      throw new Error("native checksum mismatch");
    }
    const object: BroadcastTranscriptMediaObject = {
      key,
      size: bytes.byteLength + this.reportedSizeDelta,
      etag: "etag",
      httpEtag: '"etag"',
      ...(options?.httpMetadata === undefined
        ? {}
        : { httpMetadata: options.httpMetadata }),
      ...(options?.customMetadata === undefined
        ? {}
        : { customMetadata: options.customMetadata }),
      checksums: this.omitChecksum
        ? {}
        : { sha256: exactArrayBuffer(actualChecksum) },
    };
    this.objects.set(key, { bytes, object });
    return object;
  }

  public get(
    key: string,
    options?: BroadcastTranscriptMediaGetOptions,
  ): Promise<
    BroadcastTranscriptMediaObjectBody | BroadcastTranscriptMediaObject | null
  > {
    this.lastGetOptions = options;
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
    if (this.failDelete) return Promise.reject(new Error("delete failed"));
    const keys = typeof key === "string" ? [key] : key;
    for (const item of keys) {
      this.deletedKeys.push(item);
      this.objects.delete(item);
    }
    return Promise.resolve();
  }
}

function mediaBytes(byteLength = 100): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(byteLength);
  for (let index = 0; index < bytes.byteLength; index += 1) {
    bytes[index] = index % 251;
  }
  return bytes;
}

async function stageLegacyV1Fixture(bucket: MemoryR2Bucket): Promise<{
  readonly binding: BroadcastTranscriptMediaBinding;
  readonly mediaTicket: string;
}> {
  const bytes = mediaBytes();
  const binding = await bindingFor(bytes);
  const objectKey =
    "transcript/2026-07-27/0123456789abcdef0123456789abcdef.wav";
  const expiresAtMs = NOW_MS + 10 * 60_000;
  const bindingDigest = await sha256Hex(
    new TextEncoder().encode(
      JSON.stringify([
        "1",
        binding.participantId,
        binding.runId,
        binding.pool,
        binding.payloadDigest,
        binding.sourceStartMs,
        binding.durationMs,
        binding.expectedByteLength,
      ]),
    ),
  );
  const checksum = await crypto.subtle.digest(
    "SHA-256",
    exactArrayBuffer(bytes),
  );
  await bucket.put(objectKey, streamFor(bytes), {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: {
      contentType: BROADCAST_TRANSCRIPT_MEDIA_CONTENT_TYPE,
      cacheControl: BROADCAST_TRANSCRIPT_MEDIA_CACHE_CONTROL,
    },
    customMetadata: {
      schema: "1",
      expiresAtMs: String(expiresAtMs),
      byteLength: String(bytes.byteLength),
      payloadSha256: binding.payloadDigest.slice("sha256:".length),
      bindingSha256: bindingDigest,
    },
    sha256: checksum,
    storageClass: "Standard",
  });
  const encodedPayload = encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        v: 1,
        k: objectKey,
        e: expiresAtMs,
        s: bytes.byteLength,
        b: bindingDigest,
        a: binding.sourceStartMs,
        d: binding.durationMs,
      }),
    ),
  );
  const signingKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SIGNING_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    signingKey,
    new TextEncoder().encode(`v1.${encodedPayload}`),
  );
  return {
    binding,
    mediaTicket: `v1.${encodedPayload}.${encodeBase64Url(
      new Uint8Array(signature),
    )}`,
  };
}

async function stageFixture(
  bucket = new MemoryR2Bucket(),
): Promise<{
  readonly bucket: MemoryR2Bucket;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly binding: BroadcastTranscriptMediaBinding;
  readonly mediaTicket: string;
  readonly objectKey: string;
  readonly expiresAtMs: number;
}> {
  const bytes = mediaBytes();
  const binding = await bindingFor(bytes);
  const staged = await stageBroadcastTranscriptMedia({
    bucket,
    signingKey: SIGNING_KEY,
    body: streamFor(bytes),
    binding,
    nowMs: NOW_MS,
  });
  return {
    bucket,
    bytes,
    binding,
    mediaTicket: staged.mediaTicket,
    objectKey: staged.objectKey,
    expiresAtMs: staged.expiresAtMs,
  };
}

describe("broadcast transcript transport resolution", () => {
  it("accepts only the two explicit transport mode values", () => {
    expect(parseBroadcastTranscriptTransportMode("free-r2")).toBe("free-r2");
    expect(parseBroadcastTranscriptTransportMode("paid-direct")).toBe(
      "paid-direct",
    );
    expect(parseBroadcastTranscriptTransportMode(undefined)).toBeNull();
    expect(parseBroadcastTranscriptTransportMode("FREE-R2")).toBeNull();
  });

  it("fails closed instead of silently falling through to direct transport", () => {
    const bucket = new MemoryR2Bucket();
    expect(resolveBroadcastTranscriptTransport({})).toEqual({
      ok: false,
      reason: "mode-missing",
    });
    expect(
      resolveBroadcastTranscriptTransport({
        BROADCAST_TRANSCRIPT_TRANSPORT_MODE: "unknown",
        TRANSCRIPT_MEDIA: bucket,
        TRANSCRIPT_MEDIA_SIGNING_KEY: SIGNING_KEY,
      }),
    ).toEqual({ ok: false, reason: "mode-invalid" });
    expect(
      resolveBroadcastTranscriptTransport({
        BROADCAST_TRANSCRIPT_TRANSPORT_MODE: "free-r2",
        TRANSCRIPT_MEDIA_SIGNING_KEY: SIGNING_KEY,
      }),
    ).toEqual({ ok: false, reason: "media-binding-missing" });
    expect(
      resolveBroadcastTranscriptTransport({
        BROADCAST_TRANSCRIPT_TRANSPORT_MODE: "free-r2",
        TRANSCRIPT_MEDIA: bucket,
      }),
    ).toEqual({ ok: false, reason: "signing-key-missing" });
    expect(
      resolveBroadcastTranscriptTransport({
        BROADCAST_TRANSCRIPT_TRANSPORT_MODE: "free-r2",
        TRANSCRIPT_MEDIA: bucket,
        TRANSCRIPT_MEDIA_SIGNING_KEY: "too-short",
      }),
    ).toEqual({ ok: false, reason: "signing-key-invalid" });
  });

  it("requires R2 only for free mode and keeps paid-direct switchable", () => {
    const bucket = new MemoryR2Bucket();
    expect(
      resolveBroadcastTranscriptTransport({
        BROADCAST_TRANSCRIPT_TRANSPORT_MODE: "free-r2",
        TRANSCRIPT_MEDIA: bucket,
        TRANSCRIPT_MEDIA_SIGNING_KEY: SIGNING_KEY,
      }),
    ).toEqual({
      ok: true,
      mode: "free-r2",
      bucket,
      signingKey: SIGNING_KEY,
    });
    expect(
      resolveBroadcastTranscriptTransport({
        BROADCAST_TRANSCRIPT_TRANSPORT_MODE: "paid-direct",
      }),
    ).toEqual({ ok: true, mode: "paid-direct" });
  });
});

describe("private transcript media staging", () => {
  it("streams the original request body to R2 and reads only the 44-byte header", async () => {
    const bucket = new MemoryR2Bucket();
    const bytes = mediaBytes();
    const binding = await bindingFor(bytes);
    const body = streamFor(bytes);
    const staged = await stageBroadcastTranscriptMedia({
      bucket,
      signingKey: SIGNING_KEY,
      body,
      binding,
      nowMs: NOW_MS,
    });

    expect(bucket.lastPutBody).toBe(body);
    expect(bucket.lastPutOptions?.storageClass).toBe("Standard");
    expect(bucket.lastPutOptions?.sha256).toBeInstanceOf(ArrayBuffer);
    expect(
      new Uint8Array(bucket.lastPutOptions?.sha256 as ArrayBuffer),
    ).toEqual(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", exactArrayBuffer(bytes)),
      ),
    );
    expect(bucket.lastGetOptions).toEqual({
      range: { offset: 0, length: BROADCAST_TRANSCRIPT_MEDIA_HEADER_BYTES },
    });
    expect(staged.header).toEqual(
      bytes.slice(0, BROADCAST_TRANSCRIPT_MEDIA_HEADER_BYTES),
    );
    expect(staged.byteLength).toBe(bytes.byteLength);
    expect(staged.payloadDigest).toBe(binding.payloadDigest);
    expect(staged.objectKey).toMatch(
      /^transcript\/2026-07-27\/[a-f0-9]{32}\.wav$/u,
    );
    expect(staged.mediaTicket).toMatch(/^v2\./u);
    expect(staged.mediaTicket).not.toContain(staged.objectKey);

    const stored = bucket.objects.get(staged.objectKey);
    expect(stored?.object.httpMetadata).toEqual({
      contentType: BROADCAST_TRANSCRIPT_MEDIA_CONTENT_TYPE,
      cacheControl: BROADCAST_TRANSCRIPT_MEDIA_CACHE_CONTROL,
    });
    expect(stored?.object.customMetadata?.schema).toBe("2");
    const metadata = JSON.stringify(stored?.object.customMetadata);
    expect(metadata).not.toContain(binding.participantId);
    expect(metadata).not.toContain(binding.runId);
    expect(metadata).not.toContain(binding.operationId);
  });

  it("rejects a correctly signed v1 ticket backed by schema 1 metadata on every read path", async () => {
    const bucket = new MemoryR2Bucket();
    const legacy = await stageLegacyV1Fixture(bucket);

    await expect(
      verifyBroadcastTranscriptMediaTicket(
        legacy.mediaTicket,
        SIGNING_KEY,
        { nowMs: NOW_MS + 1 },
      ),
    ).resolves.toBeNull();
    await expect(
      resolveBroadcastTranscriptMedia({
        bucket,
        signingKey: SIGNING_KEY,
        mediaTicket: legacy.mediaTicket,
        expectedBinding: legacy.binding,
        nowMs: NOW_MS + 1,
      }),
    ).resolves.toBeNull();

    const capabilityUrl =
      `https://worker.example/v1/broadcast-transcript-media?mediaTicket=${
        encodeURIComponent(legacy.mediaTicket)
      }`;
    const response = await serveBroadcastTranscriptMediaRequest(
      new Request(capabilityUrl),
      {
        bucket,
        signingKey: SIGNING_KEY,
        nowMs: NOW_MS + 1,
      },
    );
    expect(response.status).toBe(404);
    expect(bucket.objects.size).toBe(1);
  });

  it("verifies the HMAC ticket, object metadata, checksum, and expected binding", async () => {
    const fixture = await stageFixture();
    const verified = await verifyBroadcastTranscriptMediaTicket(
      fixture.mediaTicket,
      SIGNING_KEY,
      { nowMs: NOW_MS + 1 },
    );
    expect(verified).toMatchObject({
      objectKey: fixture.objectKey,
      byteLength: fixture.bytes.byteLength,
      expiresAtMs: fixture.expiresAtMs,
      sourceStartMs: fixture.binding.sourceStartMs,
      durationMs: fixture.binding.durationMs,
      routeManifestFingerprint: ROUTE_MANIFEST_FINGERPRINT,
    });
    expect(fixture.expiresAtMs - NOW_MS).toBe(10 * 60_000);
    const resolved = await resolveBroadcastTranscriptMedia({
      bucket: fixture.bucket,
      signingKey: SIGNING_KEY,
      mediaTicket: fixture.mediaTicket,
      expectedBinding: fixture.binding,
      nowMs: NOW_MS + 1,
    });
    expect(resolved).toMatchObject({
      objectKey: fixture.objectKey,
      sourceStartMs: fixture.binding.sourceStartMs,
      durationMs: fixture.binding.durationMs,
    });

    const retriedOperationBinding = {
      ...fixture.binding,
      operationId: "operation-2",
    };
    await expect(
      resolveBroadcastTranscriptMedia({
        bucket: fixture.bucket,
        signingKey: SIGNING_KEY,
        mediaTicket: fixture.mediaTicket,
        expectedBinding: retriedOperationBinding,
        nowMs: NOW_MS + 1,
      }),
    ).resolves.toMatchObject({ objectKey: fixture.objectKey });
    await expect(
      resolveBroadcastTranscriptMedia({
        bucket: fixture.bucket,
        signingKey: SIGNING_KEY,
        mediaTicket: fixture.mediaTicket,
        expectedIdentity: retriedOperationBinding,
        expectedRouteManifestFingerprint: ROUTE_MANIFEST_FINGERPRINT,
        nowMs: NOW_MS + 1,
      }),
    ).resolves.toMatchObject({ objectKey: fixture.objectKey });
    await expect(
      resolveBroadcastTranscriptMedia({
        bucket: fixture.bucket,
        signingKey: SIGNING_KEY,
        mediaTicket: fixture.mediaTicket,
        expectedIdentity: retriedOperationBinding,
        expectedRouteManifestFingerprint: `sha256:${"b".repeat(64)}`,
        nowMs: NOW_MS + 1,
      }),
    ).resolves.toBeNull();
    await expect(
      resolveBroadcastTranscriptMedia({
        bucket: fixture.bucket,
        signingKey: SIGNING_KEY,
        mediaTicket: fixture.mediaTicket,
        expectedIdentity: {
          ...retriedOperationBinding,
          participantId: "participant_0987654321",
        },
        expectedRouteManifestFingerprint: ROUTE_MANIFEST_FINGERPRINT,
        nowMs: NOW_MS + 1,
      }),
    ).resolves.toBeNull();

    const changedStableBindings: BroadcastTranscriptMediaBinding[] = [
      {
        ...fixture.binding,
        participantId: "participant_0987654321",
      },
      {
        ...fixture.binding,
        runId: "run-2",
      },
      {
        ...fixture.binding,
        payloadDigest: `sha256:${"f".repeat(64)}`,
      },
      {
        ...fixture.binding,
        routeManifestFingerprint: `sha256:${"b".repeat(64)}`,
      },
      {
        ...fixture.binding,
        sourceStartMs: fixture.binding.sourceStartMs + 1,
      },
      {
        ...fixture.binding,
        durationMs: fixture.binding.durationMs - 1,
      },
      {
        ...fixture.binding,
        expectedByteLength: fixture.binding.expectedByteLength - 1,
      },
    ];
    for (const changedBinding of changedStableBindings) {
      await expect(
        resolveBroadcastTranscriptMedia({
          bucket: fixture.bucket,
          signingKey: SIGNING_KEY,
          mediaTicket: fixture.mediaTicket,
          expectedBinding: changedBinding,
          nowMs: NOW_MS + 1,
        }),
      ).resolves.toBeNull();
    }
  });

  it("rejects tampered and expired tickets", async () => {
    const fixture = await stageFixture();
    const middleIndex = Math.floor(fixture.mediaTicket.length / 2);
    const current = fixture.mediaTicket[middleIndex] ?? "a";
    const tampered = `${fixture.mediaTicket.slice(0, middleIndex)}${
      current === "a" ? "b" : "a"
    }${fixture.mediaTicket.slice(middleIndex + 1)}`;
    await expect(
      verifyBroadcastTranscriptMediaTicket(tampered, SIGNING_KEY, {
        nowMs: NOW_MS + 1,
      }),
    ).resolves.toBeNull();
    await expect(
      verifyBroadcastTranscriptMediaTicket(
        fixture.mediaTicket,
        SIGNING_KEY,
        {
          nowMs: fixture.expiresAtMs,
        },
      ),
    ).resolves.toBeNull();
  });

  it("deletes the staged object when exact size or checksum confirmation fails", async () => {
    const bytes = mediaBytes();
    const binding = await bindingFor(bytes);
    const sizeBucket = new MemoryR2Bucket();
    sizeBucket.reportedSizeDelta = 1;
    await expect(
      stageBroadcastTranscriptMedia({
        bucket: sizeBucket,
        signingKey: SIGNING_KEY,
        body: streamFor(bytes),
        binding,
        nowMs: NOW_MS,
      }),
    ).rejects.toMatchObject({
      code: "SIZE_MISMATCH",
    } satisfies Partial<BroadcastTranscriptMediaError>);
    expect(sizeBucket.objects.size).toBe(0);
    expect(sizeBucket.deletedKeys).toHaveLength(1);

    const checksumBucket = new MemoryR2Bucket();
    checksumBucket.omitChecksum = true;
    await expect(
      stageBroadcastTranscriptMedia({
        bucket: checksumBucket,
        signingKey: SIGNING_KEY,
        body: streamFor(bytes),
        binding,
        nowMs: NOW_MS,
      }),
    ).rejects.toMatchObject({
      code: "CHECKSUM_UNCONFIRMED",
    } satisfies Partial<BroadcastTranscriptMediaError>);
    expect(checksumBucket.objects.size).toBe(0);
  });

  it("keeps cleanup best-effort and never throws a second failure", async () => {
    const bucket = new MemoryR2Bucket();
    bucket.failDelete = true;
    await expect(
      deleteBroadcastTranscriptMediaBestEffort(
        bucket,
        "transcript/2026-07-27/0123456789abcdef0123456789abcdef.wav",
      ),
    ).resolves.toBe(false);
    await expect(
      deleteBroadcastTranscriptMediaBestEffort(bucket, "../other-object"),
    ).resolves.toBe(false);
  });
});

describe("provider capability media responses", () => {
  it("serves a complete GET and HEAD without CORS or cacheability", async () => {
    const fixture = await stageFixture();
    const capabilityUrl = createBroadcastTranscriptMediaCapabilityUrl(
      "https://worker.example/healthz",
      fixture.mediaTicket,
    );
    const getResponse = await serveBroadcastTranscriptMediaRequest(
      new Request(capabilityUrl),
      {
        bucket: fixture.bucket,
        signingKey: SIGNING_KEY,
        nowMs: NOW_MS + 1,
      },
    );
    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("Content-Type")).toBe("audio/wav");
    expect(getResponse.headers.get("Content-Length")).toBe(
      String(fixture.bytes.byteLength),
    );
    expect(getResponse.headers.get("Accept-Ranges")).toBe("bytes");
    expect(getResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(getResponse.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(new Uint8Array(await getResponse.arrayBuffer())).toEqual(
      fixture.bytes,
    );

    const headResponse = await serveBroadcastTranscriptMediaRequest(
      new Request(capabilityUrl, { method: "HEAD" }),
      {
        bucket: fixture.bucket,
        signingKey: SIGNING_KEY,
        nowMs: NOW_MS + 1,
      },
    );
    expect(headResponse.status).toBe(200);
    expect(headResponse.headers.get("Content-Length")).toBe(
      String(fixture.bytes.byteLength),
    );
    expect((await headResponse.arrayBuffer()).byteLength).toBe(0);
    expect(headResponse.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  it("serves one bounded byte range with exact 206 headers", async () => {
    const fixture = await stageFixture();
    const capabilityUrl = createBroadcastTranscriptMediaCapabilityUrl(
      "https://worker.example/",
      fixture.mediaTicket,
    );
    const response = await serveBroadcastTranscriptMediaRequest(
      new Request(capabilityUrl, {
        headers: { Range: "bytes=10-19" },
      }),
      {
        bucket: fixture.bucket,
        signingKey: SIGNING_KEY,
        nowMs: NOW_MS + 1,
      },
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Length")).toBe("10");
    expect(response.headers.get("Content-Range")).toBe(
      `bytes 10-19/${fixture.bytes.byteLength}`,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      fixture.bytes.slice(10, 20),
    );
  });

  it("returns bounded 416, 404, and 405 responses with no CORS header", async () => {
    const fixture = await stageFixture();
    const capabilityUrl = createBroadcastTranscriptMediaCapabilityUrl(
      "https://worker.example/",
      fixture.mediaTicket,
    );
    const invalidRangeResponse =
      await serveBroadcastTranscriptMediaRequest(
        new Request(capabilityUrl, {
          headers: { Range: "bytes=0-1,3-4" },
        }),
        {
          bucket: fixture.bucket,
          signingKey: SIGNING_KEY,
          nowMs: NOW_MS + 1,
        },
      );
    expect(invalidRangeResponse.status).toBe(416);
    expect(invalidRangeResponse.headers.get("Content-Range")).toBe(
      `bytes */${fixture.bytes.byteLength}`,
    );
    expect(invalidRangeResponse.headers.get("Accept-Ranges")).toBe("bytes");
    expect(
      invalidRangeResponse.headers.has("Access-Control-Allow-Origin"),
    ).toBe(false);

    const expiredResponse = await serveBroadcastTranscriptMediaRequest(
      new Request(capabilityUrl),
      {
        bucket: fixture.bucket,
        signingKey: SIGNING_KEY,
        nowMs: fixture.expiresAtMs,
      },
    );
    expect(expiredResponse.status).toBe(404);
    expect(expiredResponse.headers.get("Content-Length")).toBe("0");

    const methodResponse = await serveBroadcastTranscriptMediaRequest(
      new Request(capabilityUrl, { method: "POST" }),
      {
        bucket: fixture.bucket,
        signingKey: SIGNING_KEY,
        nowMs: NOW_MS + 1,
      },
    );
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get("Allow")).toBe("GET, HEAD");
    expect(methodResponse.headers.has("Access-Control-Allow-Origin")).toBe(
      false,
    );
  });
});
