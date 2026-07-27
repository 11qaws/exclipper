import {
  CANDIDATE_INSIGHT_MEDIA_ENDPOINT_PATH,
  CANDIDATE_INSIGHT_MEDIA_TICKET_MAX_LENGTH,
  isCandidateInsightMediaTicket,
} from "../analysis/candidateInsightMediaProtocol";
import {
  isAiQuotaOperationIdentity,
  type AiQuotaOperationIdentity,
} from "../analysis/aiQuotaProtocol";
import {
  type BroadcastTranscriptMediaBucket,
  type BroadcastTranscriptMediaObject,
  type BroadcastTranscriptMediaObjectBody,
} from "./broadcastTranscriptMedia";

export const CANDIDATE_INSIGHT_MEDIA_CACHE_CONTROL = "no-store" as const;
// The deployed R2 lifecycle expires the existing `transcript/` prefix after
// one day. Candidate bundles live under that covered namespace so a closed tab
// or exhausted retry cannot leave private media indefinitely.
export const CANDIDATE_INSIGHT_MEDIA_OBJECT_PREFIX =
  "transcript/candidate/" as const;
export const CANDIDATE_INSIGHT_MEDIA_AUDIO_HEADER_BYTES = 44 as const;
export const CANDIDATE_INSIGHT_MEDIA_MAX_AUDIO_BYTES = 1_920_044 as const;
export const CANDIDATE_INSIGHT_MEDIA_MAX_FRAME_BYTES = 270_000 as const;
export const CANDIDATE_INSIGHT_MEDIA_MAX_BUNDLE_BYTES =
  CANDIDATE_INSIGHT_MEDIA_MAX_AUDIO_BYTES +
  4 * CANDIDATE_INSIGHT_MEDIA_MAX_FRAME_BYTES;
export const CANDIDATE_INSIGHT_MEDIA_TICKET_TTL_MS = 10 * 60_000;
export const CANDIDATE_INSIGHT_MEDIA_TICKET_MAX_TTL_MS = 15 * 60_000;
export const CANDIDATE_INSIGHT_MEDIA_TICKET_QUERY = "mediaTicket" as const;
export const CANDIDATE_INSIGHT_MEDIA_PART_QUERY = "part" as const;

const METADATA_SCHEMA = "1" as const;
const TICKET_VERSION = 1 as const;
const MIN_SIGNING_KEY_BYTES = 32;
const MAX_SIGNING_KEY_BYTES = 1_024;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const CANDIDATE_HASH_PATTERN = /^[a-f0-9]{24}$/u;
const OBJECT_KEY_PATTERN =
  /^transcript\/candidate\/[a-f0-9]{64}\.bin$/u;

export interface CandidateInsightMediaFrameBinding {
  readonly timestampMs: number;
  readonly byteLength: number;
}

export interface CandidateInsightMediaBinding extends AiQuotaOperationIdentity {
  readonly candidateHash: string;
  readonly candidateDurationMs: number;
  readonly audioByteLength: number;
  readonly frames: readonly [
    CandidateInsightMediaFrameBinding,
    CandidateInsightMediaFrameBinding,
    CandidateInsightMediaFrameBinding,
    CandidateInsightMediaFrameBinding,
  ];
  readonly expectedByteLength: number;
}

interface StableBinding {
  readonly participantId: string;
  readonly runId: string;
  readonly pool: "candidate";
  readonly payloadDigest: string;
  readonly candidateHash: string;
  readonly candidateDurationMs: number;
  readonly audioByteLength: number;
  readonly frames: CandidateInsightMediaBinding["frames"];
  readonly expectedByteLength: number;
}

interface TicketPayload {
  readonly v: typeof TICKET_VERSION;
  readonly k: string;
  readonly e: number;
  readonly s: number;
  readonly b: string;
  readonly p: string;
  readonly c: string;
  readonly d: number;
  readonly a: number;
  readonly f: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
}

interface StoredMetadata extends Readonly<Record<string, string>> {
  readonly schema: typeof METADATA_SCHEMA;
  readonly expiresAtMs: string;
  readonly byteLength: string;
  readonly payloadSha256: string;
  readonly bindingSha256: string;
}

export interface StagedCandidateInsightMedia {
  readonly objectKey: string;
  readonly mediaTicket: string;
  readonly expiresAtMs: number;
  readonly audioHeader: Uint8Array;
  readonly uploadDisposition: "stored" | "reused";
}

export interface ResolvedCandidateInsightMedia {
  readonly objectKey: string;
  readonly expiresAtMs: number;
  readonly byteLength: number;
  readonly bindingDigest: string;
  readonly candidateHash: string;
  readonly candidateDurationMs: number;
  readonly audioByteLength: number;
  readonly frames: CandidateInsightMediaBinding["frames"];
}

export type CandidateInsightMediaFailureStage =
  | "preflight"
  | "head-existing"
  | "validate-existing"
  | "delete-existing"
  | "put"
  | "head-race"
  | "validate-stored"
  | "validate-signatures"
  | "create-ticket";

function isCandidateInsightMediaFrames(
  value: unknown,
): value is CandidateInsightMediaBinding["frames"] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (frame: unknown) =>
        isRecord(frame) &&
        hasExactKeys(frame, ["timestampMs", "byteLength"]) &&
        Number.isSafeInteger(frame.timestampMs) &&
        Number.isSafeInteger(frame.byteLength),
    )
  );
}

export class CandidateInsightMediaError extends Error {
  public constructor(
    public readonly code:
      | "INVALID_INPUT"
      | "SIGNING_KEY_INVALID"
      | "STAGE_REJECTED"
      | "STAGE_FAILED"
      | "SIZE_MISMATCH"
      | "CHECKSUM_UNCONFIRMED"
      | "MEDIA_INVALID",
    message: string,
    public readonly stage: CandidateInsightMediaFailureStage = "preflight",
  ) {
    super(message);
    this.name = "CandidateInsightMediaError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

function hexToBytes(value: string): Uint8Array | null {
  if (!SHA256_HEX_PATTERN.test(value)) return null;
  const result = new Uint8Array(32);
  for (let index = 0; index < result.length; index += 1) {
    const byte = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isFinite(byte)) return null;
    result[index] = byte;
  }
  return result;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat(
    (4 - (value.length % 4)) % 4,
  )}`;
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return encodeBase64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

function signingKeyBytes(signingKey: string): Uint8Array | null {
  const bytes = new TextEncoder().encode(signingKey);
  return bytes.byteLength >= MIN_SIGNING_KEY_BYTES &&
    bytes.byteLength <= MAX_SIGNING_KEY_BYTES
    ? bytes
    : null;
}

async function importHmacKey(
  signingKey: string,
  usages: readonly KeyUsage[],
  implementation: Crypto,
): Promise<CryptoKey> {
  const bytes = signingKeyBytes(signingKey);
  if (bytes === null) {
    throw new CandidateInsightMediaError(
      "SIGNING_KEY_INVALID",
      "Candidate media signing is unavailable.",
    );
  }
  return implementation.subtle.importKey(
    "raw",
    exactArrayBuffer(bytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [...usages],
  );
}

async function sha256Hex(
  value: string,
  implementation: Crypto,
): Promise<string> {
  return bytesToHex(
    new Uint8Array(
      await implementation.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value),
      ),
    ),
  );
}

function payloadSha256(payloadDigest: string): string | null {
  if (!payloadDigest.startsWith("sha256:")) return null;
  const value = payloadDigest.slice("sha256:".length);
  return SHA256_HEX_PATTERN.test(value) ? value : null;
}

function stableBinding(binding: CandidateInsightMediaBinding): StableBinding {
  return {
    participantId: binding.participantId,
    runId: binding.runId,
    pool: "candidate",
    payloadDigest: binding.payloadDigest,
    candidateHash: binding.candidateHash,
    candidateDurationMs: binding.candidateDurationMs,
    audioByteLength: binding.audioByteLength,
    frames: binding.frames,
    expectedByteLength: binding.expectedByteLength,
  };
}

function canonicalBinding(binding: StableBinding): string {
  return JSON.stringify([
    METADATA_SCHEMA,
    binding.participantId,
    binding.runId,
    binding.pool,
    binding.payloadDigest,
    binding.candidateHash,
    binding.candidateDurationMs,
    binding.audioByteLength,
    binding.frames.map((frame) => [frame.timestampMs, frame.byteLength]),
    binding.expectedByteLength,
  ]);
}

function canonicalMediaIdentity(
  binding: CandidateInsightMediaBinding,
): string {
  return JSON.stringify([
    METADATA_SCHEMA,
    binding.participantId,
    binding.runId,
    binding.pool,
    binding.payloadDigest,
  ]);
}

export function isCandidateInsightMediaBinding(
  binding: CandidateInsightMediaBinding,
): boolean {
  if (
    !isAiQuotaOperationIdentity(binding) ||
    binding.pool !== "candidate" ||
    !CANDIDATE_HASH_PATTERN.test(binding.candidateHash) ||
    !Number.isSafeInteger(binding.candidateDurationMs) ||
    binding.candidateDurationMs <= 0 ||
    binding.candidateDurationMs > 60_000 ||
    !Number.isSafeInteger(binding.audioByteLength) ||
    binding.audioByteLength < CANDIDATE_INSIGHT_MEDIA_AUDIO_HEADER_BYTES ||
    binding.audioByteLength > CANDIDATE_INSIGHT_MEDIA_MAX_AUDIO_BYTES ||
    !isCandidateInsightMediaFrames(binding.frames)
  ) {
    return false;
  }
  let total = binding.audioByteLength;
  let lastTimestamp = -1;
  for (const frame of binding.frames) {
    if (
      !Number.isSafeInteger(frame.timestampMs) ||
      frame.timestampMs < 0 ||
      frame.timestampMs > binding.candidateDurationMs ||
      frame.timestampMs <= lastTimestamp ||
      !Number.isSafeInteger(frame.byteLength) ||
      frame.byteLength < 4 ||
      frame.byteLength > CANDIDATE_INSIGHT_MEDIA_MAX_FRAME_BYTES
    ) {
      return false;
    }
    lastTimestamp = frame.timestampMs;
    total += frame.byteLength;
  }
  return (
    total === binding.expectedByteLength &&
    total <= CANDIDATE_INSIGHT_MEDIA_MAX_BUNDLE_BYTES
  );
}

function objectKeyForBinding(bindingDigest: string): string {
  if (!SHA256_HEX_PATTERN.test(bindingDigest)) {
    throw new CandidateInsightMediaError(
      "INVALID_INPUT",
      "Candidate media binding digest is invalid.",
    );
  }
  return `${CANDIDATE_INSIGHT_MEDIA_OBJECT_PREFIX}${bindingDigest}.bin`;
}

function checksumMatches(
  object: BroadcastTranscriptMediaObject,
  expected: Uint8Array,
): boolean {
  const checksum = object.checksums?.sha256;
  if (!(checksum instanceof ArrayBuffer)) return false;
  const actual = new Uint8Array(checksum);
  if (actual.byteLength !== expected.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < actual.byteLength; index += 1) {
    difference |= (actual[index] ?? 0) ^ (expected[index] ?? 0);
  }
  return difference === 0;
}

function isObjectBody(
  object: BroadcastTranscriptMediaObject | BroadcastTranscriptMediaObjectBody,
): object is BroadcastTranscriptMediaObjectBody {
  return (
    "body" in object &&
    object.body instanceof ReadableStream &&
    "arrayBuffer" in object &&
    typeof object.arrayBuffer === "function"
  );
}

async function readExactRange(
  bucket: BroadcastTranscriptMediaBucket,
  key: string,
  totalSize: number,
  offset: number,
  length: number,
): Promise<Uint8Array | null> {
  const object = await bucket.get(key, { range: { offset, length } });
  if (object === null || !isObjectBody(object) || object.size !== totalSize) {
    return null;
  }
  const value = new Uint8Array(await object.arrayBuffer());
  return value.byteLength === length ? value : null;
}

async function validateBundleSignatures(
  bucket: BroadcastTranscriptMediaBucket,
  key: string,
  binding: CandidateInsightMediaBinding,
): Promise<Uint8Array | null> {
  const audioHeader = await readExactRange(
    bucket,
    key,
    binding.expectedByteLength,
    0,
    CANDIDATE_INSIGHT_MEDIA_AUDIO_HEADER_BYTES,
  );
  if (audioHeader === null) return null;
  let offset = binding.audioByteLength;
  for (const frame of binding.frames) {
    const header = await readExactRange(
      bucket,
      key,
      binding.expectedByteLength,
      offset,
      3,
    );
    const trailer = await readExactRange(
      bucket,
      key,
      binding.expectedByteLength,
      offset + frame.byteLength - 2,
      2,
    );
    if (
      header === null ||
      trailer === null ||
      header[0] !== 0xff ||
      header[1] !== 0xd8 ||
      header[2] !== 0xff ||
      trailer[0] !== 0xff ||
      trailer[1] !== 0xd9
    ) {
      audioHeader.fill(0);
      return null;
    }
    offset += frame.byteLength;
  }
  return audioHeader;
}

async function createTicket(
  payload: TicketPayload,
  signingKey: string,
  implementation: Crypto,
): Promise<string> {
  const encodedPayload = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signedBytes = new TextEncoder().encode(
    `v${TICKET_VERSION}.${encodedPayload}`,
  );
  const key = await importHmacKey(signingKey, ["sign"], implementation);
  const signature = new Uint8Array(
    await implementation.subtle.sign("HMAC", key, signedBytes),
  );
  const ticket = `v${TICKET_VERSION}.${encodedPayload}.${encodeBase64Url(
    signature,
  )}`;
  signature.fill(0);
  if (!isCandidateInsightMediaTicket(ticket)) {
    throw new CandidateInsightMediaError(
      "STAGE_FAILED",
      "Candidate media ticket exceeded its bounded contract.",
    );
  }
  return ticket;
}

function parseTicketPayload(value: unknown): TicketPayload | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "v",
      "k",
      "e",
      "s",
      "b",
      "p",
      "c",
      "d",
      "a",
      "f",
    ]) ||
    value.v !== TICKET_VERSION ||
    typeof value.k !== "string" ||
    !OBJECT_KEY_PATTERN.test(value.k) ||
    !Number.isSafeInteger(value.e) ||
    !Number.isSafeInteger(value.s) ||
    (value.s as number) <= 0 ||
    (value.s as number) > CANDIDATE_INSIGHT_MEDIA_MAX_BUNDLE_BYTES ||
    typeof value.b !== "string" ||
    !SHA256_HEX_PATTERN.test(value.b) ||
    typeof value.p !== "string" ||
    !SHA256_HEX_PATTERN.test(value.p) ||
    typeof value.c !== "string" ||
    !CANDIDATE_HASH_PATTERN.test(value.c) ||
    !Number.isSafeInteger(value.d) ||
    (value.d as number) <= 0 ||
    (value.d as number) > 60_000 ||
    !Number.isSafeInteger(value.a) ||
    (value.a as number) < CANDIDATE_INSIGHT_MEDIA_AUDIO_HEADER_BYTES ||
    !Array.isArray(value.f) ||
    value.f.length !== 4
  ) {
    return null;
  }
  const parsedFrames: Array<readonly [number, number]> = [];
  for (const rawFrame of value.f as unknown[]) {
    if (
      !Array.isArray(rawFrame) ||
      rawFrame.length !== 2
    ) {
      return null;
    }
    const timestampMs: unknown = rawFrame[0];
    const byteLength: unknown = rawFrame[1];
    if (
      !Number.isSafeInteger(timestampMs) ||
      (timestampMs as number) < 0 ||
      !Number.isSafeInteger(byteLength) ||
      (byteLength as number) < 4 ||
      (byteLength as number) > CANDIDATE_INSIGHT_MEDIA_MAX_FRAME_BYTES
    ) {
      return null;
    }
    parsedFrames.push([
      timestampMs as number,
      byteLength as number,
    ]);
  }
  const frames = parsedFrames as unknown as TicketPayload["f"];
  const bindingLike: CandidateInsightMediaBinding = {
    participantId: "participant_00000000000000000000000000000000",
    runId: "ticket-validation",
    operationId: "ticket-validation",
    pool: "candidate",
    payloadDigest: `sha256:${"0".repeat(64)}`,
    candidateHash: value.c,
    candidateDurationMs: value.d as number,
    audioByteLength: value.a as number,
    frames: frames.map((frame) => ({
      timestampMs: frame[0],
      byteLength: frame[1],
    })) as unknown as CandidateInsightMediaBinding["frames"],
    expectedByteLength: value.s as number,
  };
  if (!isCandidateInsightMediaBinding(bindingLike)) return null;
  return value as unknown as TicketPayload;
}

async function verifyTicket(
  mediaTicket: string,
  signingKey: string,
  nowMs: number,
  implementation: Crypto,
): Promise<TicketPayload | null> {
  if (
    !isCandidateInsightMediaTicket(mediaTicket) ||
    mediaTicket.length > CANDIDATE_INSIGHT_MEDIA_TICKET_MAX_LENGTH
  ) {
    return null;
  }
  const parts = mediaTicket.split(".");
  if (parts.length !== 3 || parts[0] !== `v${TICKET_VERSION}`) return null;
  const payloadBytes = decodeBase64Url(parts[1] ?? "");
  const signature = decodeBase64Url(parts[2] ?? "");
  if (payloadBytes === null || signature === null) return null;
  let payload: TicketPayload | null;
  try {
    payload = parseTicketPayload(
      JSON.parse(new TextDecoder().decode(payloadBytes)),
    );
  } catch {
    return null;
  }
  if (payload === null || payload.e <= nowMs) return null;
  try {
    const key = await importHmacKey(signingKey, ["verify"], implementation);
    const valid = await implementation.subtle.verify(
      "HMAC",
      key,
      exactArrayBuffer(signature),
      new TextEncoder().encode(`v${TICKET_VERSION}.${parts[1] ?? ""}`),
    );
    return valid ? payload : null;
  } catch {
    return null;
  }
}

function storedMetadata(
  binding: CandidateInsightMediaBinding,
  bindingDigest: string,
  expiresAtMs: number,
): StoredMetadata | null {
  const digest = payloadSha256(binding.payloadDigest);
  return digest === null
    ? null
    : {
        schema: METADATA_SCHEMA,
        expiresAtMs: String(expiresAtMs),
        byteLength: String(binding.expectedByteLength),
        payloadSha256: digest,
        bindingSha256: bindingDigest,
      };
}

function metadataMatches(
  object: BroadcastTranscriptMediaObject,
  ticket: TicketPayload,
  nowMs: number,
): boolean {
  const metadata = validatedStoredMetadata(object, nowMs);
  return (
    metadata !== null &&
    metadata.payloadSha256 === ticket.p &&
    metadata.bindingSha256 === ticket.b &&
    Number(metadata.expiresAtMs) === ticket.e &&
    object.key === ticket.k &&
    object.size === ticket.s
  );
}

function validatedStoredMetadata(
  object: BroadcastTranscriptMediaObject,
  nowMs: number,
): StoredMetadata | null {
  const metadata = object.customMetadata;
  if (
    metadata === undefined ||
    !hasExactKeys(metadata, [
      "schema",
      "expiresAtMs",
      "byteLength",
      "payloadSha256",
      "bindingSha256",
    ]) ||
    metadata.schema !== METADATA_SCHEMA ||
    !SHA256_HEX_PATTERN.test(metadata.payloadSha256 ?? "") ||
    !SHA256_HEX_PATTERN.test(metadata.bindingSha256 ?? "") ||
    metadata.byteLength !== String(object.size) ||
    object.size <= 0 ||
    object.size > CANDIDATE_INSIGHT_MEDIA_MAX_BUNDLE_BYTES ||
    object.httpMetadata?.contentType !== "application/octet-stream" ||
    object.httpMetadata.cacheControl !==
      CANDIDATE_INSIGHT_MEDIA_CACHE_CONTROL
  ) {
    return null;
  }
  const payloadSha256Value = metadata.payloadSha256;
  if (payloadSha256Value === undefined) return null;
  const expiresAtMs = Number(metadata.expiresAtMs);
  const expectedChecksum = hexToBytes(payloadSha256Value);
  if (
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs <= nowMs ||
    expiresAtMs > nowMs + CANDIDATE_INSIGHT_MEDIA_TICKET_MAX_TTL_MS ||
    expectedChecksum === null ||
    !checksumMatches(object, expectedChecksum)
  ) {
    return null;
  }
  return metadata as StoredMetadata;
}

function reusableStoredMetadata(
  object: BroadcastTranscriptMediaObject,
  input: {
    readonly objectKey: string;
    readonly binding: CandidateInsightMediaBinding;
    readonly bindingDigest: string;
    readonly payloadSha256: string;
    readonly nowMs: number;
  },
): StoredMetadata | null {
  const metadata = validatedStoredMetadata(object, input.nowMs);
  return metadata !== null &&
    object.key === input.objectKey &&
    object.size === input.binding.expectedByteLength &&
    metadata.byteLength === String(input.binding.expectedByteLength) &&
    metadata.bindingSha256 === input.bindingDigest &&
    metadata.payloadSha256 === input.payloadSha256
    ? metadata
    : null;
}

async function stagedResult(
  input: {
    readonly objectKey: string;
    readonly binding: CandidateInsightMediaBinding;
    readonly bindingDigest: string;
    readonly payloadSha256: string;
    readonly expiresAtMs: number;
    readonly signingKey: string;
    readonly implementation: Crypto;
    readonly audioHeader: Uint8Array;
    readonly uploadDisposition: StagedCandidateInsightMedia["uploadDisposition"];
  },
): Promise<StagedCandidateInsightMedia> {
  const mediaTicket = await createTicket(
    {
      v: TICKET_VERSION,
      k: input.objectKey,
      e: input.expiresAtMs,
      s: input.binding.expectedByteLength,
      b: input.bindingDigest,
      p: input.payloadSha256,
      c: input.binding.candidateHash,
      d: input.binding.candidateDurationMs,
      a: input.binding.audioByteLength,
      f: input.binding.frames.map((frame) => [
        frame.timestampMs,
        frame.byteLength,
      ]) as unknown as TicketPayload["f"],
    },
    input.signingKey,
    input.implementation,
  );
  return {
    objectKey: input.objectKey,
    mediaTicket,
    expiresAtMs: input.expiresAtMs,
    audioHeader: input.audioHeader,
    uploadDisposition: input.uploadDisposition,
  };
}

export async function deleteCandidateInsightMediaBestEffort(
  bucket: BroadcastTranscriptMediaBucket,
  objectKey: string,
): Promise<boolean> {
  if (!OBJECT_KEY_PATTERN.test(objectKey)) return false;
  try {
    await bucket.delete(objectKey);
    return true;
  } catch {
    return false;
  }
}

export async function stageCandidateInsightMedia(input: {
  readonly bucket: BroadcastTranscriptMediaBucket;
  readonly signingKey: string;
  readonly body: ReadableStream<Uint8Array> | null;
  readonly binding: CandidateInsightMediaBinding;
  readonly nowMs?: number;
  readonly ticketTtlMs?: number;
  readonly cryptoImplementation?: Crypto;
}): Promise<StagedCandidateInsightMedia> {
  if (
    input.body === null ||
    !isCandidateInsightMediaBinding(input.binding)
  ) {
    throw new CandidateInsightMediaError(
      "INVALID_INPUT",
      "Candidate media staging input is invalid.",
    );
  }
  const implementation = input.cryptoImplementation ?? crypto;
  if (signingKeyBytes(input.signingKey) === null) {
    throw new CandidateInsightMediaError(
      "SIGNING_KEY_INVALID",
      "Candidate media signing is unavailable.",
    );
  }
  const nowMs = input.nowMs ?? Date.now();
  const ttl = input.ticketTtlMs ?? CANDIDATE_INSIGHT_MEDIA_TICKET_TTL_MS;
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isSafeInteger(ttl) ||
    ttl <= 0 ||
    ttl > CANDIDATE_INSIGHT_MEDIA_TICKET_MAX_TTL_MS
  ) {
    throw new CandidateInsightMediaError(
      "INVALID_INPUT",
      "Candidate media staging time is invalid.",
    );
  }
  const checksumHex = payloadSha256(input.binding.payloadDigest);
  if (checksumHex === null) {
    throw new CandidateInsightMediaError(
      "INVALID_INPUT",
      "Candidate media payload digest is invalid.",
    );
  }
  const checksum = hexToBytes(checksumHex);
  if (checksum === null) {
    throw new CandidateInsightMediaError(
      "INVALID_INPUT",
      "Candidate media payload checksum is invalid.",
    );
  }
  const [bindingDigest, mediaIdentityDigest] = await Promise.all([
    sha256Hex(
      canonicalBinding(stableBinding(input.binding)),
      implementation,
    ),
    sha256Hex(canonicalMediaIdentity(input.binding), implementation),
  ]);
  // The quota coordinator fences participant + run + media payload, so the R2
  // slot uses that same identity. Query-only manifest fields stay bound in the
  // signed metadata but cannot fan one leased payload out into many objects.
  const objectKey = objectKeyForBinding(mediaIdentityDigest);
  const expiresAtMs = nowMs + ttl;
  const metadata = storedMetadata(input.binding, bindingDigest, expiresAtMs);
  if (metadata === null) {
    throw new CandidateInsightMediaError(
      "INVALID_INPUT",
      "Candidate media binding is invalid.",
    );
  }
  let ownsObject = false;
  let failureStage: CandidateInsightMediaFailureStage = "head-existing";
  try {
    const existing = await input.bucket.head(objectKey);
    const existingMetadata =
      existing === null
        ? null
        : reusableStoredMetadata(existing, {
            objectKey,
            binding: input.binding,
            bindingDigest,
            payloadSha256: checksumHex,
            nowMs,
          });
    const validExistingMetadata =
      existing === null ? null : validatedStoredMetadata(existing, nowMs);
    if (existingMetadata !== null) {
      failureStage = "validate-existing";
      const audioHeader = await validateBundleSignatures(
        input.bucket,
        objectKey,
        input.binding,
      );
      if (audioHeader !== null) {
        failureStage = "create-ticket";
        return stagedResult({
          objectKey,
          binding: input.binding,
          bindingDigest,
          payloadSha256: checksumHex,
          expiresAtMs: Number(existingMetadata.expiresAtMs),
          signingKey: input.signingKey,
          implementation,
          audioHeader,
          uploadDisposition: "reused",
        });
      }
    }
    if (validExistingMetadata !== null) {
      throw new CandidateInsightMediaError(
        "STAGE_REJECTED",
        "Candidate media slot is already bound to another manifest.",
      );
    }
    if (existing !== null) {
      failureStage = "delete-existing";
      await deleteCandidateInsightMediaBestEffort(input.bucket, objectKey);
    }
    failureStage = "put";
    const stored = await input.bucket.put(objectKey, input.body, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: {
        contentType: "application/octet-stream",
        cacheControl: CANDIDATE_INSIGHT_MEDIA_CACHE_CONTROL,
      },
      customMetadata: metadata,
      sha256: exactArrayBuffer(checksum),
      storageClass: "Standard",
    });
    if (stored === null) {
      failureStage = "head-race";
      const racedObject = await input.bucket.head(objectKey);
      const racedMetadata =
        racedObject === null
          ? null
          : reusableStoredMetadata(racedObject, {
              objectKey,
              binding: input.binding,
              bindingDigest,
              payloadSha256: checksumHex,
              nowMs,
            });
      const audioHeader =
        racedMetadata === null
          ? null
          : (failureStage = "validate-signatures",
            await validateBundleSignatures(
              input.bucket,
              objectKey,
              input.binding,
            ));
      if (racedMetadata === null || audioHeader === null) {
        throw new CandidateInsightMediaError(
          "STAGE_REJECTED",
          "Candidate media object could not be reserved.",
        );
      }
      failureStage = "create-ticket";
      return stagedResult({
        objectKey,
        binding: input.binding,
        bindingDigest,
        payloadSha256: checksumHex,
        expiresAtMs: Number(racedMetadata.expiresAtMs),
        signingKey: input.signingKey,
        implementation,
        audioHeader,
        uploadDisposition: "reused",
      });
    }
    ownsObject = true;
    failureStage = "validate-stored";
    const storedMetadataValue = reusableStoredMetadata(stored, {
      objectKey,
      binding: input.binding,
      bindingDigest,
      payloadSha256: checksumHex,
      nowMs,
    });
    if (storedMetadataValue === null) {
      throw new CandidateInsightMediaError(
        !checksumMatches(stored, checksum)
          ? "CHECKSUM_UNCONFIRMED"
          : stored.size !== input.binding.expectedByteLength
            ? "SIZE_MISMATCH"
            : "STAGE_REJECTED",
        "Candidate media object did not match its storage fence.",
      );
    }
    failureStage = "validate-signatures";
    const audioHeader = await validateBundleSignatures(
      input.bucket,
      objectKey,
      input.binding,
    );
    if (audioHeader === null) {
      throw new CandidateInsightMediaError(
        "MEDIA_INVALID",
        "Candidate media signatures are invalid.",
      );
    }
    failureStage = "create-ticket";
    return stagedResult({
      objectKey,
      binding: input.binding,
      bindingDigest,
      payloadSha256: checksumHex,
      expiresAtMs,
      signingKey: input.signingKey,
      implementation,
      audioHeader,
      uploadDisposition: "stored",
    });
  } catch (error) {
    if (ownsObject) {
      await deleteCandidateInsightMediaBestEffort(input.bucket, objectKey);
    }
    if (error instanceof CandidateInsightMediaError) {
      throw new CandidateInsightMediaError(
        error.code,
        error.message,
        failureStage,
      );
    }
    throw new CandidateInsightMediaError(
      "STAGE_FAILED",
      "Candidate media staging failed.",
      failureStage,
    );
  }
}

export async function resolveCandidateInsightMedia(input: {
  readonly bucket: BroadcastTranscriptMediaBucket;
  readonly signingKey: string;
  readonly mediaTicket: string;
  readonly expectedIdentity?: AiQuotaOperationIdentity;
  readonly nowMs?: number;
  readonly cryptoImplementation?: Crypto;
}): Promise<ResolvedCandidateInsightMedia | null> {
  const implementation = input.cryptoImplementation ?? crypto;
  const nowMs = input.nowMs ?? Date.now();
  const ticket = await verifyTicket(
    input.mediaTicket,
    input.signingKey,
    nowMs,
    implementation,
  );
  if (ticket === null) return null;
  const object = await input.bucket.head(ticket.k);
  if (object === null || !metadataMatches(object, ticket, nowMs)) return null;
  if (input.expectedIdentity !== undefined) {
    if (
      !isAiQuotaOperationIdentity(input.expectedIdentity) ||
      input.expectedIdentity.pool !== "candidate"
    ) {
      return null;
    }
    const expectedBinding: StableBinding = {
      participantId: input.expectedIdentity.participantId,
      runId: input.expectedIdentity.runId,
      pool: "candidate",
      payloadDigest: input.expectedIdentity.payloadDigest,
      candidateHash: ticket.c,
      candidateDurationMs: ticket.d,
      audioByteLength: ticket.a,
      frames: ticket.f.map(([timestampMs, byteLength]) => ({
        timestampMs,
        byteLength,
      })) as unknown as StableBinding["frames"],
      expectedByteLength: ticket.s,
    };
    if (
      (await sha256Hex(canonicalBinding(expectedBinding), implementation)) !==
      ticket.b
    ) {
      return null;
    }
  }
  return {
    objectKey: ticket.k,
    expiresAtMs: ticket.e,
    byteLength: ticket.s,
    bindingDigest: ticket.b,
    candidateHash: ticket.c,
    candidateDurationMs: ticket.d,
    audioByteLength: ticket.a,
    frames: ticket.f.map(([timestampMs, byteLength]) => ({
      timestampMs,
      byteLength,
    })) as unknown as CandidateInsightMediaBinding["frames"],
  };
}

export function createCandidateInsightMediaCapabilityUrl(
  workerUrl: string | URL,
  mediaTicket: string,
  part: "audio" | "0" | "1" | "2" | "3",
): string {
  if (!isCandidateInsightMediaTicket(mediaTicket)) {
    throw new RangeError("Candidate media ticket is invalid.");
  }
  const origin = new URL(workerUrl);
  const url = new URL(CANDIDATE_INSIGHT_MEDIA_ENDPOINT_PATH, origin.origin);
  url.searchParams.set(CANDIDATE_INSIGHT_MEDIA_TICKET_QUERY, mediaTicket);
  url.searchParams.set(CANDIDATE_INSIGHT_MEDIA_PART_QUERY, part);
  return url.toString();
}

function emptyMediaResponse(
  status: number,
  extraHeaders?: Readonly<Record<string, string>>,
): Response {
  const headers = new Headers({
    "Cache-Control": CANDIDATE_INSIGHT_MEDIA_CACHE_CONTROL,
    "Content-Length": "0",
    "X-Content-Type-Options": "nosniff",
  });
  for (const [name, value] of Object.entries(extraHeaders ?? {})) {
    headers.set(name, value);
  }
  return new Response(null, { status, headers });
}

function parseRelativeRange(
  value: string,
  totalLength: number,
): { readonly offset: number; readonly length: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
  if (match === null) return null;
  const startRaw = match[1] ?? "";
  const endRaw = match[2] ?? "";
  if (startRaw === "" && endRaw === "") return null;
  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    const length = Math.min(totalLength, suffix);
    return { offset: totalLength - length, length };
  }
  const offset = Number(startRaw);
  const end =
    endRaw === "" ? totalLength - 1 : Math.min(totalLength - 1, Number(endRaw));
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(end) ||
    offset < 0 ||
    offset >= totalLength ||
    end < offset
  ) {
    return null;
  }
  return { offset, length: end - offset + 1 };
}

export async function serveCandidateInsightMediaRequest(
  request: Request,
  options: {
    readonly bucket: BroadcastTranscriptMediaBucket;
    readonly signingKey: string;
    readonly nowMs?: number;
    readonly cryptoImplementation?: Crypto;
  },
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return emptyMediaResponse(405, { Allow: "GET, HEAD" });
  }
  const url = new URL(request.url);
  const ticket = url.searchParams.get(CANDIDATE_INSIGHT_MEDIA_TICKET_QUERY);
  const part = url.searchParams.get(CANDIDATE_INSIGHT_MEDIA_PART_QUERY);
  if (
    ticket === null ||
    !isCandidateInsightMediaTicket(ticket) ||
    !["audio", "0", "1", "2", "3"].includes(part ?? "") ||
    [...url.searchParams.keys()].some(
      (key) =>
        key !== CANDIDATE_INSIGHT_MEDIA_TICKET_QUERY &&
        key !== CANDIDATE_INSIGHT_MEDIA_PART_QUERY,
    ) ||
    url.searchParams.getAll(CANDIDATE_INSIGHT_MEDIA_TICKET_QUERY).length !== 1 ||
    url.searchParams.getAll(CANDIDATE_INSIGHT_MEDIA_PART_QUERY).length !== 1
  ) {
    return emptyMediaResponse(404);
  }
  const resolved = await resolveCandidateInsightMedia({
    bucket: options.bucket,
    signingKey: options.signingKey,
    mediaTicket: ticket,
    ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
    ...(options.cryptoImplementation === undefined
      ? {}
      : { cryptoImplementation: options.cryptoImplementation }),
  });
  if (resolved === null) return emptyMediaResponse(404);
  let baseOffset = 0;
  let partLength = resolved.audioByteLength;
  let contentType = "audio/wav";
  if (part !== "audio") {
    const frameIndex = Number(part);
    baseOffset = resolved.audioByteLength;
    for (let index = 0; index < frameIndex; index += 1) {
      baseOffset += resolved.frames[index]?.byteLength ?? 0;
    }
    partLength = resolved.frames[frameIndex]?.byteLength ?? 0;
    contentType = "image/jpeg";
  }
  if (partLength <= 0) return emptyMediaResponse(404);
  const rangeHeader = request.headers.get("Range");
  const relativeRange =
    rangeHeader === null ? null : parseRelativeRange(rangeHeader, partLength);
  if (rangeHeader !== null && relativeRange === null) {
    return emptyMediaResponse(416, {
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes */${partLength}`,
    });
  }
  const range = relativeRange ?? { offset: 0, length: partLength };
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": CANDIDATE_INSIGHT_MEDIA_CACHE_CONTROL,
    "Content-Length": String(range.length),
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  const status = relativeRange === null ? 200 : 206;
  if (relativeRange !== null) {
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${partLength}`,
    );
  }
  if (request.method === "HEAD") return new Response(null, { status, headers });
  const object = await options.bucket.get(resolved.objectKey, {
    range: {
      offset: baseOffset + range.offset,
      length: range.length,
    },
  });
  if (
    object === null ||
    !isObjectBody(object) ||
    object.size !== resolved.byteLength
  ) {
    return emptyMediaResponse(404);
  }
  return new Response(object.body, { status, headers });
}
