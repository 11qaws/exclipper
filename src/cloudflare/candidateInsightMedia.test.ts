import { describe, expect, it } from "vitest";

import { encodeCandidatePassBPcm16Wav } from "../analysis/candidatePassBGemini";
import { CANDIDATE_PASS_B_SAMPLE_RATE_HZ } from "../analysis/candidatePassBWorkerProtocol";
import type {
  BroadcastTranscriptMediaBucket,
  BroadcastTranscriptMediaGetOptions,
  BroadcastTranscriptMediaObject,
  BroadcastTranscriptMediaObjectBody,
  BroadcastTranscriptMediaPutOptions,
} from "./broadcastTranscriptMedia";
import {
  createCandidateInsightMediaCapabilityUrl,
  deleteCandidateInsightMediaBestEffort,
  resolveCandidateInsightMedia,
  serveCandidateInsightMediaRequest,
  stageCandidateInsightMedia,
  type CandidateInsightMediaBinding,
} from "./candidateInsightMedia";

const SIGNING_KEY = "0123456789abcdef0123456789abcdef";
const NOW_MS = Date.UTC(2026, 6, 27, 12, 0, 0);

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function streamFor(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
    length += result.value.byteLength;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

interface StoredObject {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly object: BroadcastTranscriptMediaObject;
}

class MemoryR2Bucket implements BroadcastTranscriptMediaBucket {
  public readonly objects = new Map<string, StoredObject>();
  public readonly deletedKeys: string[] = [];
  public putCount = 0;

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
    this.putCount += 1;
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
      expected.some((byte, index) => byte !== checksum[index])
    ) {
      throw new Error("native checksum mismatch");
    }
    const object: BroadcastTranscriptMediaObject = {
      key,
      size: bytes.byteLength,
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
    return Promise.resolve({
      ...stored.object,
      ...(options?.range === undefined
        ? {}
        : { range: { offset, length: bytes.byteLength } }),
      body: streamFor(bytes),
      arrayBuffer: () => Promise.resolve(exactArrayBuffer(bytes)),
    });
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

function jpeg(seed: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0xff, 0xd8, 0xff, seed, seed + 1, 0xff, 0xd9]);
}

async function fixture(): Promise<{
  readonly bucket: MemoryR2Bucket;
  readonly bundle: Uint8Array<ArrayBuffer>;
  readonly audio: Uint8Array<ArrayBuffer>;
  readonly frames: readonly Uint8Array<ArrayBuffer>[];
  readonly binding: CandidateInsightMediaBinding;
}> {
  const durationMs = 10;
  const audio = new Uint8Array(
    encodeCandidatePassBPcm16Wav(
      new Float32Array(
        Math.ceil(
          (durationMs / 1_000) * CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
        ),
      ),
      CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
    ),
  );
  const frames = [jpeg(1), jpeg(3), jpeg(5), jpeg(7)] as const;
  const bundle = new Uint8Array(
    audio.byteLength +
      frames.reduce((total, frame) => total + frame.byteLength, 0),
  );
  bundle.set(audio);
  let offset = audio.byteLength;
  for (const frame of frames) {
    bundle.set(frame, offset);
    offset += frame.byteLength;
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", exactArrayBuffer(bundle)),
  );
  const binding: CandidateInsightMediaBinding = {
    participantId: "participant_00000000000001",
    runId: "run-candidate-media",
    operationId: "candidate-operation",
    pool: "candidate",
    payloadDigest: `sha256:${[...digest]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`,
    candidateHash: "0123456789abcdef01234567",
    candidateDurationMs: durationMs,
    audioByteLength: audio.byteLength,
    frames: [
      { timestampMs: 1, byteLength: frames[0].byteLength },
      { timestampMs: 3, byteLength: frames[1].byteLength },
      { timestampMs: 6, byteLength: frames[2].byteLength },
      { timestampMs: 9, byteLength: frames[3].byteLength },
    ],
    expectedByteLength: bundle.byteLength,
  };
  return { bucket: new MemoryR2Bucket(), bundle, audio, frames, binding };
}

describe("candidate insight staged media", () => {
  it("stages one checksum-bound bundle and resolves it across lease attempts", async () => {
    const { bucket, bundle, audio, binding } = await fixture();
    const staged = await stageCandidateInsightMedia({
      bucket,
      signingKey: SIGNING_KEY,
      body: streamFor(bundle),
      binding,
      nowMs: NOW_MS,
    });
    expect(staged.audioHeader).toEqual(audio.slice(0, 44));
    expect(staged.uploadDisposition).toBe("stored");
    expect(bucket.objects).toHaveLength(1);
    expect(bucket.putCount).toBe(1);

    const replayed = await stageCandidateInsightMedia({
      bucket,
      signingKey: SIGNING_KEY,
      body: streamFor(bundle),
      binding: {
        ...binding,
        operationId: "candidate-operation-attempt-2",
      },
      nowMs: NOW_MS + 1,
    });
    expect(replayed.objectKey).toBe(staged.objectKey);
    expect(replayed.expiresAtMs).toBe(staged.expiresAtMs);
    expect(replayed.uploadDisposition).toBe("reused");
    expect(bucket.objects).toHaveLength(1);
    expect(bucket.putCount).toBe(1);

    const retryIdentity = {
      ...binding,
      operationId: "candidate-operation-attempt-2",
    };
    const resolved = await resolveCandidateInsightMedia({
      bucket,
      signingKey: SIGNING_KEY,
      mediaTicket: staged.mediaTicket,
      expectedIdentity: retryIdentity,
      nowMs: NOW_MS + 1,
    });
    expect(resolved).toMatchObject({
      objectKey: staged.objectKey,
      candidateHash: binding.candidateHash,
      candidateDurationMs: binding.candidateDurationMs,
      audioByteLength: audio.byteLength,
    });
  });

  it("serves audio and frame capabilities as bounded R2 ranges", async () => {
    const { bucket, bundle, frames, binding } = await fixture();
    const staged = await stageCandidateInsightMedia({
      bucket,
      signingKey: SIGNING_KEY,
      body: streamFor(bundle),
      binding,
      nowMs: NOW_MS,
    });
    const frameUrl = createCandidateInsightMediaCapabilityUrl(
      "https://worker.example/v1/candidate-insights",
      staged.mediaTicket,
      "2",
    );
    const frameResponse = await serveCandidateInsightMediaRequest(
      new Request(frameUrl),
      {
        bucket,
        signingKey: SIGNING_KEY,
        nowMs: NOW_MS + 1,
      },
    );
    expect(frameResponse.status).toBe(200);
    expect(frameResponse.headers.get("Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await frameResponse.arrayBuffer())).toEqual(
      frames[2],
    );

    const rangedAudio = await serveCandidateInsightMediaRequest(
      new Request(
        createCandidateInsightMediaCapabilityUrl(
          "https://worker.example",
          staged.mediaTicket,
          "audio",
        ),
        { headers: { Range: "bytes=0-3" } },
      ),
      { bucket, signingKey: SIGNING_KEY, nowMs: NOW_MS + 1 },
    );
    expect(rangedAudio.status).toBe(206);
    expect(rangedAudio.headers.get("Content-Range")).toBe(
      `bytes 0-3/${binding.audioByteLength}`,
    );
    expect(new Uint8Array(await rangedAudio.arrayBuffer())).toEqual(
      bundle.slice(0, 4),
    );
  });

  it("rejects another payload identity and supports best-effort cleanup", async () => {
    const { bucket, bundle, binding } = await fixture();
    const staged = await stageCandidateInsightMedia({
      bucket,
      signingKey: SIGNING_KEY,
      body: streamFor(bundle),
      binding,
      nowMs: NOW_MS,
    });
    expect(
      await resolveCandidateInsightMedia({
        bucket,
        signingKey: SIGNING_KEY,
        mediaTicket: staged.mediaTicket,
        expectedIdentity: {
          ...binding,
          payloadDigest: `sha256:${"f".repeat(64)}`,
        },
        nowMs: NOW_MS + 1,
      }),
    ).toBeNull();
    expect(
      await deleteCandidateInsightMediaBestEffort(
        bucket,
        staged.objectKey,
      ),
    ).toBe(true);
    expect(bucket.objects).toHaveLength(0);
  });

  it("fails closed for expired, tampered, widened, and malformed capabilities", async () => {
    const { bucket, bundle, binding } = await fixture();
    const staged = await stageCandidateInsightMedia({
      bucket,
      signingKey: SIGNING_KEY,
      body: streamFor(bundle),
      binding,
      nowMs: NOW_MS,
    });
    expect(staged.objectKey).toMatch(
      /^transcript\/candidate\/[a-f0-9]{64}\.bin$/u,
    );
    expect(
      await resolveCandidateInsightMedia({
        bucket,
        signingKey: SIGNING_KEY,
        mediaTicket: `${staged.mediaTicket.slice(0, -1)}x`,
        nowMs: NOW_MS + 1,
      }),
    ).toBeNull();
    expect(
      await resolveCandidateInsightMedia({
        bucket,
        signingKey: SIGNING_KEY,
        mediaTicket: staged.mediaTicket,
        nowMs: staged.expiresAtMs,
      }),
    ).toBeNull();

    const capability = createCandidateInsightMediaCapabilityUrl(
      "https://worker.example",
      staged.mediaTicket,
      "audio",
    );
    expect(
      (
        await serveCandidateInsightMediaRequest(
          new Request(capability, { method: "POST" }),
          { bucket, signingKey: SIGNING_KEY, nowMs: NOW_MS + 1 },
        )
      ).status,
    ).toBe(405);
    expect(
      (
        await serveCandidateInsightMediaRequest(
          new Request(`${capability}&extra=1`),
          { bucket, signingKey: SIGNING_KEY, nowMs: NOW_MS + 1 },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await serveCandidateInsightMediaRequest(
          new Request(capability, { headers: { Range: "bytes=999999-" } }),
          { bucket, signingKey: SIGNING_KEY, nowMs: NOW_MS + 1 },
        )
      ).status,
    ).toBe(416);
  });

  it("rejects bundles that do not describe four strictly ordered frames", async () => {
    const { bucket, bundle, binding } = await fixture();
    await expect(
      stageCandidateInsightMedia({
        bucket,
        signingKey: SIGNING_KEY,
        body: streamFor(bundle),
        binding: {
          ...binding,
          frames: [
            binding.frames[0],
            { ...binding.frames[1], timestampMs: binding.frames[0].timestampMs },
            binding.frames[2],
            binding.frames[3],
          ],
        },
        nowMs: NOW_MS,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(bucket.objects).toHaveLength(0);
  });

  it("binds deterministic objects to participant, run, and payload identity", async () => {
    const { bucket, bundle, binding } = await fixture();
    const first = await stageCandidateInsightMedia({
      bucket,
      signingKey: SIGNING_KEY,
      body: streamFor(bundle),
      binding,
      nowMs: NOW_MS,
    });
    const otherParticipant = await stageCandidateInsightMedia({
      bucket,
      signingKey: SIGNING_KEY,
      body: streamFor(bundle),
      binding: {
        ...binding,
        participantId: "participant_00000000000002",
      },
      nowMs: NOW_MS,
    });
    const otherRun = await stageCandidateInsightMedia({
      bucket,
      signingKey: SIGNING_KEY,
      body: streamFor(bundle),
      binding: {
        ...binding,
        runId: "run-candidate-media-2",
      },
      nowMs: NOW_MS,
    });
    expect(
      new Set([
        first.objectKey,
        otherParticipant.objectKey,
        otherRun.objectKey,
      ]).size,
    ).toBe(3);
    expect(bucket.putCount).toBe(3);
  });

  it("does not let one leased media payload fan out across query manifests", async () => {
    const { bucket, bundle, binding } = await fixture();
    const first = await stageCandidateInsightMedia({
      bucket,
      signingKey: SIGNING_KEY,
      body: streamFor(bundle),
      binding,
      nowMs: NOW_MS,
    });

    await expect(
      stageCandidateInsightMedia({
        bucket,
        signingKey: SIGNING_KEY,
        body: streamFor(bundle),
        binding: {
          ...binding,
          candidateHash: "fedcba987654321001234567",
          frames: [
            { ...binding.frames[0], timestampMs: 2 },
            { ...binding.frames[1], timestampMs: 4 },
            { ...binding.frames[2], timestampMs: 7 },
            binding.frames[3],
          ],
        },
        nowMs: NOW_MS + 1,
      }),
    ).rejects.toMatchObject({ code: "STAGE_REJECTED" });

    expect(bucket.objects).toHaveLength(1);
    expect(bucket.objects.has(first.objectKey)).toBe(true);
    expect(bucket.deletedKeys).not.toContain(first.objectKey);
    expect(bucket.putCount).toBe(1);
  });

  it("fails closed when stored checksum or HTTP metadata no longer matches", async () => {
    const { bucket, bundle, binding } = await fixture();
    const staged = await stageCandidateInsightMedia({
      bucket,
      signingKey: SIGNING_KEY,
      body: streamFor(bundle),
      binding,
      nowMs: NOW_MS,
    });
    const stored = bucket.objects.get(staged.objectKey);
    expect(stored).toBeDefined();
    if (stored === undefined) return;

    bucket.objects.set(staged.objectKey, {
      ...stored,
      object: {
        ...stored.object,
        httpMetadata: {
          contentType: "application/octet-stream",
          cacheControl: "public, max-age=3600",
        },
      },
    });
    expect(
      await resolveCandidateInsightMedia({
        bucket,
        signingKey: SIGNING_KEY,
        mediaTicket: staged.mediaTicket,
        nowMs: NOW_MS + 1,
      }),
    ).toBeNull();

    bucket.objects.set(staged.objectKey, {
      ...stored,
      object: {
        ...stored.object,
        checksums: {
          sha256: exactArrayBuffer(new Uint8Array(32).fill(9)),
        },
      },
    });
    expect(
      await resolveCandidateInsightMedia({
        bucket,
        signingKey: SIGNING_KEY,
        mediaTicket: staged.mediaTicket,
        nowMs: NOW_MS + 1,
      }),
    ).toBeNull();
  });
});
