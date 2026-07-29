import {
  BROADCAST_TRANSCRIPT_MEDIA_ENDPOINT_PATH,
  BROADCAST_TRANSCRIPT_MEDIA_TICKET_MAX_LENGTH,
  isBroadcastTranscriptMediaTicket,
} from "../analysis/broadcastTranscriptMediaProtocol";
import {
  isAiQuotaOperationIdentity,
  type AiQuotaOperationIdentity,
} from "../analysis/aiQuotaProtocol";
import { isBroadcastTranscriptRouteFingerprint } from "../analysis/broadcastTranscriptRouteManifest";

export { BROADCAST_TRANSCRIPT_MEDIA_ENDPOINT_PATH };

export const BROADCAST_TRANSCRIPT_MEDIA_CONTENT_TYPE = "audio/wav" as const;
export const BROADCAST_TRANSCRIPT_MEDIA_CACHE_CONTROL = "no-store" as const;
export const BROADCAST_TRANSCRIPT_MEDIA_OBJECT_PREFIX = "transcript/" as const;
export const BROADCAST_TRANSCRIPT_MEDIA_HEADER_BYTES = 44 as const;
export const BROADCAST_TRANSCRIPT_MEDIA_MAX_BYTES = 2_880_044 as const;
export const BROADCAST_TRANSCRIPT_MEDIA_TICKET_TTL_MS = 10 * 60_000;
export const BROADCAST_TRANSCRIPT_MEDIA_TICKET_MAX_TTL_MS = 15 * 60_000;
export const BROADCAST_TRANSCRIPT_MEDIA_TICKET_QUERY =
  "mediaTicket" as const;

const BROADCAST_TRANSCRIPT_MEDIA_METADATA_SCHEMA = "2" as const;
const BROADCAST_TRANSCRIPT_MEDIA_TICKET_VERSION = 2 as const;
const MIN_SIGNING_KEY_BYTES = 32;
const MAX_SIGNING_KEY_BYTES = 1_024;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const OBJECT_KEY_PATTERN =
  /^transcript\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{32}\.wav$/u;

export type BroadcastTranscriptTransportMode = "free-r2" | "paid-direct";

export interface BroadcastTranscriptTransportEnvironment {
  readonly BROADCAST_TRANSCRIPT_TRANSPORT_MODE?: string;
  readonly TRANSCRIPT_MEDIA?: BroadcastTranscriptMediaBucket;
  readonly TRANSCRIPT_MEDIA_SIGNING_KEY?: string;
}

export type BroadcastTranscriptTransportResolution =
  | {
      readonly ok: true;
      readonly mode: "free-r2";
      readonly bucket: BroadcastTranscriptMediaBucket;
      readonly signingKey: string;
    }
  | {
      readonly ok: true;
      readonly mode: "paid-direct";
    }
  | {
      readonly ok: false;
      readonly reason:
        | "mode-missing"
        | "mode-invalid"
        | "media-binding-missing"
        | "signing-key-missing"
        | "signing-key-invalid";
    };

export interface BroadcastTranscriptMediaHttpMetadata {
  readonly contentType?: string;
  readonly cacheControl?: string;
}

export interface BroadcastTranscriptMediaChecksums {
  readonly sha256?: ArrayBuffer;
}

export interface BroadcastTranscriptMediaRange {
  readonly offset?: number;
  readonly length?: number;
  readonly suffix?: number;
}

export interface BroadcastTranscriptMediaObject {
  readonly key: string;
  readonly size: number;
  readonly etag?: string;
  readonly httpEtag?: string;
  readonly httpMetadata?: BroadcastTranscriptMediaHttpMetadata;
  readonly customMetadata?: Readonly<Record<string, string>>;
  readonly checksums?: BroadcastTranscriptMediaChecksums;
  readonly range?: BroadcastTranscriptMediaRange;
}

export interface BroadcastTranscriptMediaObjectBody
  extends BroadcastTranscriptMediaObject {
  readonly body: ReadableStream<Uint8Array>;
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
}

export interface BroadcastTranscriptMediaGetOptions {
  readonly range?: BroadcastTranscriptMediaRange;
}

export interface BroadcastTranscriptMediaPutOptions {
  readonly onlyIf?: {
    readonly etagDoesNotMatch?: string;
  };
  readonly httpMetadata?: BroadcastTranscriptMediaHttpMetadata;
  readonly customMetadata?: Readonly<Record<string, string>>;
  readonly sha256?: ArrayBuffer | string;
  readonly storageClass?: "Standard" | "InfrequentAccess";
}

/**
 * Cloudflare's R2 binding surface used by transcript staging.
 *
 * Keeping this interface local avoids pulling Node-only SDK types into the
 * browser build while remaining structurally compatible with an R2Bucket.
 */
export interface BroadcastTranscriptMediaBucket {
  readonly put: (
    key: string,
    value: ReadableStream<Uint8Array>,
    options?: BroadcastTranscriptMediaPutOptions,
  ) => Promise<BroadcastTranscriptMediaObject | null>;
  readonly get: (
    key: string,
    options?: BroadcastTranscriptMediaGetOptions,
  ) => Promise<
    BroadcastTranscriptMediaObjectBody | BroadcastTranscriptMediaObject | null
  >;
  readonly head: (
    key: string,
  ) => Promise<BroadcastTranscriptMediaObject | null>;
  readonly delete: (key: string | readonly string[]) => Promise<void>;
}

export interface BroadcastTranscriptMediaBinding
  extends AiQuotaOperationIdentity {
  readonly routeManifestFingerprint: string;
  readonly sourceStartMs: number;
  readonly durationMs: number;
  readonly expectedByteLength: number;
}

export interface BroadcastTranscriptMediaStableBinding {
  readonly participantId: string;
  readonly runId: string;
  readonly pool: "transcript";
  readonly payloadDigest: string;
  readonly routeManifestFingerprint: string;
  readonly sourceStartMs: number;
  readonly durationMs: number;
  readonly expectedByteLength: number;
}

export type BroadcastTranscriptMediaErrorCode =
  | "INVALID_INPUT"
  | "SIGNING_KEY_INVALID"
  | "STAGE_REJECTED"
  | "STAGE_FAILED"
  | "SIZE_MISMATCH"
  | "CHECKSUM_UNCONFIRMED"
  | "HEADER_UNAVAILABLE";

export class BroadcastTranscriptMediaError extends Error {
  public readonly code: BroadcastTranscriptMediaErrorCode;

  public constructor(
    code: BroadcastTranscriptMediaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BroadcastTranscriptMediaError";
    this.code = code;
  }
}

export interface StageBroadcastTranscriptMediaInput {
  readonly bucket: BroadcastTranscriptMediaBucket;
  readonly signingKey: string;
  readonly body: ReadableStream<Uint8Array> | null;
  readonly binding: BroadcastTranscriptMediaBinding;
  readonly nowMs?: number;
  readonly ticketTtlMs?: number;
  readonly cryptoImplementation?: Crypto;
}

export interface StagedBroadcastTranscriptMedia {
  readonly objectKey: string;
  readonly byteLength: number;
  readonly payloadDigest: string;
  readonly bindingDigest: string;
  readonly header: Uint8Array;
  readonly mediaTicket: string;
  readonly expiresAtMs: number;
}

export interface VerifiedBroadcastTranscriptMediaTicket {
  readonly objectKey: string;
  readonly expiresAtMs: number;
  readonly byteLength: number;
  readonly bindingDigest: string;
  readonly routeManifestFingerprint: string;
  readonly sourceStartMs: number;
  readonly durationMs: number;
}

export interface ResolvedBroadcastTranscriptMedia
  extends VerifiedBroadcastTranscriptMediaTicket {
  readonly object: BroadcastTranscriptMediaObject;
}

export interface ResolveBroadcastTranscriptMediaInput {
  readonly bucket: BroadcastTranscriptMediaBucket;
  readonly signingKey: string;
  readonly mediaTicket: string;
  readonly expectedIdentity?: AiQuotaOperationIdentity;
  readonly expectedRouteManifestFingerprint?: string;
  readonly expectedBinding?: BroadcastTranscriptMediaBinding;
  readonly nowMs?: number;
  readonly cryptoImplementation?: Crypto;
}

export interface ServeBroadcastTranscriptMediaOptions {
  readonly bucket: BroadcastTranscriptMediaBucket;
  readonly signingKey: string;
  readonly nowMs?: number;
  readonly cryptoImplementation?: Crypto;
}

interface BroadcastTranscriptMediaTicketPayload {
  readonly v: typeof BROADCAST_TRANSCRIPT_MEDIA_TICKET_VERSION;
  readonly k: string;
  readonly e: number;
  readonly s: number;
  readonly b: string;
  readonly r: string;
  readonly a: number;
  readonly d: number;
}

type BroadcastTranscriptMediaStoredMetadata = Readonly<Record<string, string>> & {
  readonly schema: typeof BROADCAST_TRANSCRIPT_MEDIA_METADATA_SCHEMA;
  readonly expiresAtMs: string;
  readonly byteLength: string;
  readonly payloadSha256: string;
  readonly bindingSha256: string;
};

interface ParsedByteRange {
  readonly offset: number;
  readonly length: number;
  readonly endInclusive: number;
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

function byteArrayToExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) {
    result += byte.toString(16).padStart(2, "0");
  }
  return result;
}

function hexToBytes(value: string): Uint8Array | null {
  if (!SHA256_HEX_PATTERN.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isFinite(byte)) return null;
    bytes[index] = byte;
  }
  return bytes;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const paddingLength = (4 - (value.length % 4)) % 4;
  const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat(
    paddingLength,
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
  if (
    bytes.byteLength < MIN_SIGNING_KEY_BYTES ||
    bytes.byteLength > MAX_SIGNING_KEY_BYTES
  ) {
    return null;
  }
  return bytes;
}

function signingKeyIsValid(signingKey: unknown): signingKey is string {
  return (
    typeof signingKey === "string" && signingKeyBytes(signingKey) !== null
  );
}

function mediaCrypto(implementation: Crypto | undefined): Crypto {
  return implementation ?? crypto;
}

async function sha256Hex(
  value: string,
  implementation: Crypto,
): Promise<string> {
  const digest = await implementation.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

async function importHmacKey(
  signingKey: string,
  usages: readonly KeyUsage[],
  implementation: Crypto,
): Promise<CryptoKey> {
  const bytes = signingKeyBytes(signingKey);
  if (bytes === null) {
    throw new BroadcastTranscriptMediaError(
      "SIGNING_KEY_INVALID",
      "Transcript media signing is unavailable.",
    );
  }
  return implementation.subtle.importKey(
    "raw",
    byteArrayToExactArrayBuffer(bytes),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    [...usages],
  );
}

function isBroadcastTranscriptMediaBinding(
  binding: BroadcastTranscriptMediaBinding,
): boolean {
  return (
    isAiQuotaOperationIdentity(binding) &&
    binding.pool === "transcript" &&
    isBroadcastTranscriptRouteFingerprint(
      binding.routeManifestFingerprint,
    ) &&
    Number.isSafeInteger(binding.sourceStartMs) &&
    binding.sourceStartMs >= 0 &&
    Number.isSafeInteger(binding.durationMs) &&
    binding.durationMs > 0 &&
    binding.durationMs <= 90_000 &&
    Number.isSafeInteger(binding.expectedByteLength) &&
    binding.expectedByteLength >= BROADCAST_TRANSCRIPT_MEDIA_HEADER_BYTES &&
    binding.expectedByteLength <= BROADCAST_TRANSCRIPT_MEDIA_MAX_BYTES
  );
}

function stableBinding(
  binding: BroadcastTranscriptMediaBinding,
): BroadcastTranscriptMediaStableBinding {
  return {
    participantId: binding.participantId,
    runId: binding.runId,
    pool: "transcript",
    payloadDigest: binding.payloadDigest,
    routeManifestFingerprint: binding.routeManifestFingerprint,
    sourceStartMs: binding.sourceStartMs,
    durationMs: binding.durationMs,
    expectedByteLength: binding.expectedByteLength,
  };
}

function canonicalBinding(
  binding: BroadcastTranscriptMediaStableBinding,
): string {
  /*
   * operationId and lease token are deliberately absent. A provider 429 can
   * finish one quota operation and issue a fresh operation for the same staged
   * source bytes. The stable run/source fence remains bound while that retry
   * reuses the upload instead of paying the R2 ingress cost again.
   */
  return JSON.stringify([
    BROADCAST_TRANSCRIPT_MEDIA_METADATA_SCHEMA,
    binding.participantId,
    binding.runId,
    binding.pool,
    binding.payloadDigest,
    binding.routeManifestFingerprint,
    binding.sourceStartMs,
    binding.durationMs,
    binding.expectedByteLength,
  ]);
}

function payloadSha256Hex(payloadDigest: string): string | null {
  if (!payloadDigest.startsWith("sha256:")) return null;
  const value = payloadDigest.slice("sha256:".length);
  return SHA256_HEX_PATTERN.test(value) ? value : null;
}

function objectKeyForNow(nowMs: number, implementation: Crypto): string {
  const random = new Uint8Array(16);
  implementation.getRandomValues(random);
  const day = new Date(nowMs).toISOString().slice(0, 10);
  return `${BROADCAST_TRANSCRIPT_MEDIA_OBJECT_PREFIX}${day}/${bytesToHex(
    random,
  )}.wav`;
}

function isObjectBody(
  value: BroadcastTranscriptMediaObject | BroadcastTranscriptMediaObjectBody,
): value is BroadcastTranscriptMediaObjectBody {
  return (
    "body" in value &&
    value.body instanceof ReadableStream &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function"
  );
}

function arraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function checksumMatches(
  object: BroadcastTranscriptMediaObject,
  expected: Uint8Array,
): boolean {
  const checksum = object.checksums?.sha256;
  if (!(checksum instanceof ArrayBuffer)) return false;
  return arraysEqual(new Uint8Array(checksum), expected);
}

function storedMetadata(
  binding: BroadcastTranscriptMediaBinding,
  bindingDigest: string,
  expiresAtMs: number,
): BroadcastTranscriptMediaStoredMetadata | null {
  const payloadSha256 = payloadSha256Hex(binding.payloadDigest);
  if (payloadSha256 === null) return null;
  return {
    schema: BROADCAST_TRANSCRIPT_MEDIA_METADATA_SCHEMA,
    expiresAtMs: String(expiresAtMs),
    byteLength: String(binding.expectedByteLength),
    payloadSha256,
    bindingSha256: bindingDigest,
  };
}

function parseStoredMetadata(
  object: BroadcastTranscriptMediaObject,
): BroadcastTranscriptMediaStoredMetadata | null {
  const value = object.customMetadata;
  const expiresAtMs = value?.expiresAtMs;
  const byteLength = value?.byteLength;
  const payloadSha256 = value?.payloadSha256;
  const bindingSha256 = value?.bindingSha256;
  if (
    value === undefined ||
    !hasExactKeys(value, [
      "schema",
      "expiresAtMs",
      "byteLength",
      "payloadSha256",
      "bindingSha256",
    ]) ||
    value.schema !== BROADCAST_TRANSCRIPT_MEDIA_METADATA_SCHEMA ||
    typeof expiresAtMs !== "string" ||
    !/^\d{1,16}$/u.test(expiresAtMs) ||
    typeof byteLength !== "string" ||
    !/^\d{2,10}$/u.test(byteLength) ||
    typeof payloadSha256 !== "string" ||
    !SHA256_HEX_PATTERN.test(payloadSha256) ||
    typeof bindingSha256 !== "string" ||
    !SHA256_HEX_PATTERN.test(bindingSha256)
  ) {
    return null;
  }
  return {
    schema: BROADCAST_TRANSCRIPT_MEDIA_METADATA_SCHEMA,
    expiresAtMs,
    byteLength,
    payloadSha256,
    bindingSha256,
  };
}

function parseTicketPayload(
  value: unknown,
): BroadcastTranscriptMediaTicketPayload | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["v", "k", "e", "s", "b", "r", "a", "d"]) ||
    value.v !== BROADCAST_TRANSCRIPT_MEDIA_TICKET_VERSION ||
    typeof value.k !== "string" ||
    !OBJECT_KEY_PATTERN.test(value.k) ||
    !Number.isSafeInteger(value.e) ||
    !Number.isSafeInteger(value.s) ||
    (value.s as number) < BROADCAST_TRANSCRIPT_MEDIA_HEADER_BYTES ||
    (value.s as number) > BROADCAST_TRANSCRIPT_MEDIA_MAX_BYTES ||
    typeof value.b !== "string" ||
    !SHA256_HEX_PATTERN.test(value.b) ||
    !isBroadcastTranscriptRouteFingerprint(value.r)
    || !Number.isSafeInteger(value.a)
    || (value.a as number) < 0
    || !Number.isSafeInteger(value.d)
    || (value.d as number) <= 0
    || (value.d as number) > 90_000
  ) {
    return null;
  }
  return {
    v: BROADCAST_TRANSCRIPT_MEDIA_TICKET_VERSION,
    k: value.k,
    e: value.e as number,
    s: value.s as number,
    b: value.b,
    r: value.r,
    a: value.a as number,
    d: value.d as number,
  };
}

async function createBroadcastTranscriptMediaTicket(
  payload: BroadcastTranscriptMediaTicketPayload,
  signingKey: string,
  implementation: Crypto,
): Promise<string> {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const encodedPayload = encodeBase64Url(payloadBytes);
  const signedBytes = new TextEncoder().encode(
    `v${BROADCAST_TRANSCRIPT_MEDIA_TICKET_VERSION}.${encodedPayload}`,
  );
  const key = await importHmacKey(signingKey, ["sign"], implementation);
  const signature = await implementation.subtle.sign(
    "HMAC",
    key,
    signedBytes,
  );
  const mediaTicket = `v${BROADCAST_TRANSCRIPT_MEDIA_TICKET_VERSION}.${encodedPayload}.${encodeBase64Url(
    new Uint8Array(signature),
  )}`;
  if (!isBroadcastTranscriptMediaTicket(mediaTicket)) {
    throw new BroadcastTranscriptMediaError(
      "STAGE_FAILED",
      "Transcript media staging could not create a bounded ticket.",
    );
  }
  return mediaTicket;
}

async function verifyTicketDetailed(
  mediaTicket: string,
  signingKey: string,
  nowMs: number,
  implementation: Crypto,
): Promise<
  | {
      readonly ok: true;
      readonly payload: BroadcastTranscriptMediaTicketPayload;
    }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "expired";
    }
> {
  if (
    !isBroadcastTranscriptMediaTicket(mediaTicket) ||
    mediaTicket.length > BROADCAST_TRANSCRIPT_MEDIA_TICKET_MAX_LENGTH
  ) {
    return { ok: false, reason: "invalid" };
  }
  const parts = mediaTicket.split(".");
  if (
    parts.length !== 3 ||
    parts[0] !== `v${BROADCAST_TRANSCRIPT_MEDIA_TICKET_VERSION}`
  ) {
    return { ok: false, reason: "invalid" };
  }
  const encodedPayload = parts[1];
  const encodedSignature = parts[2];
  if (encodedPayload === undefined || encodedSignature === undefined) {
    return { ok: false, reason: "invalid" };
  }
  const payloadBytes = decodeBase64Url(encodedPayload);
  const signature = decodeBase64Url(encodedSignature);
  if (payloadBytes === null || signature === null) {
    return { ok: false, reason: "invalid" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const payload = parseTicketPayload(parsed);
  if (payload === null) return { ok: false, reason: "invalid" };

  let key: CryptoKey;
  try {
    key = await importHmacKey(signingKey, ["verify"], implementation);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const signedBytes = new TextEncoder().encode(
    `v${BROADCAST_TRANSCRIPT_MEDIA_TICKET_VERSION}.${encodedPayload}`,
  );
  const validSignature = await implementation.subtle.verify(
    "HMAC",
    key,
    byteArrayToExactArrayBuffer(signature),
    signedBytes,
  );
  if (!validSignature) return { ok: false, reason: "invalid" };
  if (payload.e <= nowMs) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

function matchesStoredObject(
  object: BroadcastTranscriptMediaObject,
  ticket: BroadcastTranscriptMediaTicketPayload,
  nowMs: number,
): boolean {
  const metadata = parseStoredMetadata(object);
  if (metadata === null) return false;
  const byteLength = Number(metadata.byteLength);
  const expiresAtMs = Number(metadata.expiresAtMs);
  const expectedChecksum = hexToBytes(metadata.payloadSha256);
  return (
    object.key === ticket.k &&
    object.size === ticket.s &&
    byteLength === ticket.s &&
    expiresAtMs === ticket.e &&
    expiresAtMs > nowMs &&
    metadata.bindingSha256 === ticket.b &&
    expectedChecksum !== null &&
    checksumMatches(object, expectedChecksum) &&
    object.httpMetadata?.contentType ===
      BROADCAST_TRANSCRIPT_MEDIA_CONTENT_TYPE &&
    object.httpMetadata.cacheControl ===
      BROADCAST_TRANSCRIPT_MEDIA_CACHE_CONTROL
  );
}

function parseByteRange(value: string, size: number): ParsedByteRange | null {
  if (value.includes(",")) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
  if (match === null) return null;
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (startText === "" && endText === "") return null;

  if (startText === "") {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    const length = Math.min(suffixLength, size);
    return {
      offset: size - length,
      length,
      endInclusive: size - 1,
    };
  }

  const offset = Number(startText);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= size) {
    return null;
  }
  const requestedEnd = endText === "" ? size - 1 : Number(endText);
  if (
    !Number.isSafeInteger(requestedEnd) ||
    requestedEnd < offset
  ) {
    return null;
  }
  const endInclusive = Math.min(requestedEnd, size - 1);
  return {
    offset,
    length: endInclusive - offset + 1,
    endInclusive,
  };
}

function mediaResponseHeaders(contentLength: number): Headers {
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": BROADCAST_TRANSCRIPT_MEDIA_CACHE_CONTROL,
    "Content-Length": String(contentLength),
    "Content-Type": BROADCAST_TRANSCRIPT_MEDIA_CONTENT_TYPE,
    "X-Content-Type-Options": "nosniff",
  });
  return headers;
}

function emptyMediaResponse(
  status: number,
  extraHeaders?: Readonly<Record<string, string>>,
): Response {
  const headers = new Headers({
    "Cache-Control": BROADCAST_TRANSCRIPT_MEDIA_CACHE_CONTROL,
    "Content-Length": "0",
    "X-Content-Type-Options": "nosniff",
  });
  if (extraHeaders !== undefined) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      headers.set(name, value);
    }
  }
  return new Response(null, { status, headers });
}

export function parseBroadcastTranscriptTransportMode(
  value: unknown,
): BroadcastTranscriptTransportMode | null {
  return value === "free-r2" || value === "paid-direct" ? value : null;
}

/**
 * Resolves the deployment transport without a permissive fallback.
 *
 * Missing or malformed configuration never falls through to paid-direct.
 */
export function resolveBroadcastTranscriptTransport(
  environment: BroadcastTranscriptTransportEnvironment,
): BroadcastTranscriptTransportResolution {
  const configuredMode = environment.BROADCAST_TRANSCRIPT_TRANSPORT_MODE;
  if (configuredMode === undefined || configuredMode.trim() === "") {
    return { ok: false, reason: "mode-missing" };
  }
  const mode = parseBroadcastTranscriptTransportMode(configuredMode);
  if (mode === null) return { ok: false, reason: "mode-invalid" };
  if (mode === "paid-direct") return { ok: true, mode };
  if (environment.TRANSCRIPT_MEDIA === undefined) {
    return { ok: false, reason: "media-binding-missing" };
  }
  if (environment.TRANSCRIPT_MEDIA_SIGNING_KEY === undefined) {
    return { ok: false, reason: "signing-key-missing" };
  }
  if (!signingKeyIsValid(environment.TRANSCRIPT_MEDIA_SIGNING_KEY)) {
    return { ok: false, reason: "signing-key-invalid" };
  }
  return {
    ok: true,
    mode,
    bucket: environment.TRANSCRIPT_MEDIA,
    signingKey: environment.TRANSCRIPT_MEDIA_SIGNING_KEY,
  };
}

export async function stageBroadcastTranscriptMedia(
  input: StageBroadcastTranscriptMediaInput,
): Promise<StagedBroadcastTranscriptMedia> {
  if (
    input.body === null ||
    !isBroadcastTranscriptMediaBinding(input.binding)
  ) {
    throw new BroadcastTranscriptMediaError(
      "INVALID_INPUT",
      "Transcript media staging input is invalid.",
    );
  }
  const implementation = mediaCrypto(input.cryptoImplementation);
  if (!signingKeyIsValid(input.signingKey)) {
    throw new BroadcastTranscriptMediaError(
      "SIGNING_KEY_INVALID",
      "Transcript media signing is unavailable.",
    );
  }
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new BroadcastTranscriptMediaError(
      "INVALID_INPUT",
      "Transcript media staging time is invalid.",
    );
  }
  const ticketTtlMs =
    input.ticketTtlMs ?? BROADCAST_TRANSCRIPT_MEDIA_TICKET_TTL_MS;
  if (
    !Number.isSafeInteger(ticketTtlMs) ||
    ticketTtlMs <= 0 ||
    ticketTtlMs > BROADCAST_TRANSCRIPT_MEDIA_TICKET_MAX_TTL_MS
  ) {
    throw new BroadcastTranscriptMediaError(
      "INVALID_INPUT",
      "Transcript media ticket lifetime is invalid.",
    );
  }
  const payloadSha256 = payloadSha256Hex(input.binding.payloadDigest);
  const expectedChecksum =
    payloadSha256 === null ? null : hexToBytes(payloadSha256);
  if (payloadSha256 === null || expectedChecksum === null) {
    throw new BroadcastTranscriptMediaError(
      "INVALID_INPUT",
      "Transcript media payload digest is invalid.",
    );
  }

  const objectKey = objectKeyForNow(nowMs, implementation);
  const expiresAtMs = nowMs + ticketTtlMs;
  const bindingDigest = await sha256Hex(
    canonicalBinding(stableBinding(input.binding)),
    implementation,
  );
  const metadata = storedMetadata(
    input.binding,
    bindingDigest,
    expiresAtMs,
  );
  if (metadata === null) {
    throw new BroadcastTranscriptMediaError(
      "INVALID_INPUT",
      "Transcript media binding is invalid.",
    );
  }

  try {
    const stored = await input.bucket.put(objectKey, input.body, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: {
        contentType: BROADCAST_TRANSCRIPT_MEDIA_CONTENT_TYPE,
        cacheControl: BROADCAST_TRANSCRIPT_MEDIA_CACHE_CONTROL,
      },
      customMetadata: metadata,
      sha256: byteArrayToExactArrayBuffer(expectedChecksum),
      storageClass: "Standard",
    });
    if (stored === null) {
      throw new BroadcastTranscriptMediaError(
        "STAGE_REJECTED",
        "Transcript media object could not be reserved.",
      );
    }
    if (stored.size !== input.binding.expectedByteLength) {
      throw new BroadcastTranscriptMediaError(
        "SIZE_MISMATCH",
        "Transcript media byte length did not match its source fence.",
      );
    }
    if (!checksumMatches(stored, expectedChecksum)) {
      throw new BroadcastTranscriptMediaError(
        "CHECKSUM_UNCONFIRMED",
        "Transcript media checksum could not be confirmed.",
      );
    }

    const headerObject = await input.bucket.get(objectKey, {
      range: {
        offset: 0,
        length: BROADCAST_TRANSCRIPT_MEDIA_HEADER_BYTES,
      },
    });
    if (
      headerObject === null ||
      !isObjectBody(headerObject) ||
      headerObject.size !== input.binding.expectedByteLength
    ) {
      throw new BroadcastTranscriptMediaError(
        "HEADER_UNAVAILABLE",
        "Transcript media header could not be read.",
      );
    }
    const headerBuffer = await headerObject.arrayBuffer();
    if (headerBuffer.byteLength !== BROADCAST_TRANSCRIPT_MEDIA_HEADER_BYTES) {
      throw new BroadcastTranscriptMediaError(
        "HEADER_UNAVAILABLE",
        "Transcript media header range was incomplete.",
      );
    }
    const header = new Uint8Array(headerBuffer);
    const mediaTicket = await createBroadcastTranscriptMediaTicket(
      {
        v: BROADCAST_TRANSCRIPT_MEDIA_TICKET_VERSION,
        k: objectKey,
        e: expiresAtMs,
        s: input.binding.expectedByteLength,
        b: bindingDigest,
        r: input.binding.routeManifestFingerprint,
        a: input.binding.sourceStartMs,
        d: input.binding.durationMs,
      },
      input.signingKey,
      implementation,
    );
    return {
      objectKey,
      byteLength: input.binding.expectedByteLength,
      payloadDigest: input.binding.payloadDigest,
      bindingDigest,
      header,
      mediaTicket,
      expiresAtMs,
    };
  } catch (error) {
    await deleteBroadcastTranscriptMediaBestEffort(input.bucket, objectKey);
    if (error instanceof BroadcastTranscriptMediaError) throw error;
    throw new BroadcastTranscriptMediaError(
      "STAGE_FAILED",
      "Transcript media staging failed.",
    );
  }
}

export async function verifyBroadcastTranscriptMediaTicket(
  mediaTicket: string,
  signingKey: string,
  options: {
    readonly nowMs?: number;
    readonly cryptoImplementation?: Crypto;
  } = {},
): Promise<VerifiedBroadcastTranscriptMediaTicket | null> {
  const result = await verifyTicketDetailed(
    mediaTicket,
    signingKey,
    options.nowMs ?? Date.now(),
    mediaCrypto(options.cryptoImplementation),
  );
  if (!result.ok) return null;
  return {
    objectKey: result.payload.k,
    expiresAtMs: result.payload.e,
    byteLength: result.payload.s,
    bindingDigest: result.payload.b,
    routeManifestFingerprint: result.payload.r,
    sourceStartMs: result.payload.a,
    durationMs: result.payload.d,
  };
}

export async function resolveBroadcastTranscriptMedia(
  input: ResolveBroadcastTranscriptMediaInput,
): Promise<ResolvedBroadcastTranscriptMedia | null> {
  const implementation = mediaCrypto(input.cryptoImplementation);
  const nowMs = input.nowMs ?? Date.now();
  const ticket = await verifyTicketDetailed(
    input.mediaTicket,
    input.signingKey,
    nowMs,
    implementation,
  );
  if (!ticket.ok) return null;
  if (
    input.expectedRouteManifestFingerprint !== undefined &&
    (!isBroadcastTranscriptRouteFingerprint(
      input.expectedRouteManifestFingerprint,
    ) ||
      input.expectedRouteManifestFingerprint !== ticket.payload.r)
  ) {
    return null;
  }

  const object = await input.bucket.head(ticket.payload.k);
  if (
    object === null ||
    !matchesStoredObject(object, ticket.payload, nowMs)
  ) {
    return null;
  }
  if (input.expectedIdentity !== undefined) {
    if (
      !isAiQuotaOperationIdentity(input.expectedIdentity) ||
      input.expectedIdentity.pool !== "transcript" ||
      !isBroadcastTranscriptRouteFingerprint(
        input.expectedRouteManifestFingerprint,
      )
    ) {
      return null;
    }
    const expectedStableBinding: BroadcastTranscriptMediaStableBinding = {
      participantId: input.expectedIdentity.participantId,
      runId: input.expectedIdentity.runId,
      pool: "transcript",
      payloadDigest: input.expectedIdentity.payloadDigest,
      routeManifestFingerprint: input.expectedRouteManifestFingerprint,
      sourceStartMs: ticket.payload.a,
      durationMs: ticket.payload.d,
      expectedByteLength: ticket.payload.s,
    };
    const expectedBindingDigest = await sha256Hex(
      canonicalBinding(expectedStableBinding),
      implementation,
    );
    if (expectedBindingDigest !== ticket.payload.b) return null;
  }
  if (input.expectedBinding !== undefined) {
    if (!isBroadcastTranscriptMediaBinding(input.expectedBinding)) return null;
    const expectedBindingDigest = await sha256Hex(
      canonicalBinding(stableBinding(input.expectedBinding)),
      implementation,
    );
    if (
      expectedBindingDigest !== ticket.payload.b ||
      input.expectedBinding.expectedByteLength !== ticket.payload.s
    ) {
      return null;
    }
  }
  return {
    objectKey: ticket.payload.k,
    expiresAtMs: ticket.payload.e,
    byteLength: ticket.payload.s,
    bindingDigest: ticket.payload.b,
    routeManifestFingerprint: ticket.payload.r,
    sourceStartMs: ticket.payload.a,
    durationMs: ticket.payload.d,
    object,
  };
}

export async function deleteBroadcastTranscriptMediaBestEffort(
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

export function createBroadcastTranscriptMediaCapabilityUrl(
  workerUrl: string | URL,
  mediaTicket: string,
): string {
  if (!isBroadcastTranscriptMediaTicket(mediaTicket)) {
    throw new RangeError("Broadcast transcript media ticket is invalid.");
  }
  const origin = new URL(workerUrl);
  const url = new URL(BROADCAST_TRANSCRIPT_MEDIA_ENDPOINT_PATH, origin.origin);
  url.searchParams.set(BROADCAST_TRANSCRIPT_MEDIA_TICKET_QUERY, mediaTicket);
  return url.toString();
}

/**
 * Serves a verified private R2 object to an upstream media fetcher.
 *
 * This response intentionally has no CORS header: it is a capability URL for
 * the provider, not a browser-readable public bucket endpoint.
 */
export async function serveBroadcastTranscriptMediaRequest(
  request: Request,
  options: ServeBroadcastTranscriptMediaOptions,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return emptyMediaResponse(405, { Allow: "GET, HEAD" });
  }
  const url = new URL(request.url);
  const mediaTickets = url.searchParams.getAll(
    BROADCAST_TRANSCRIPT_MEDIA_TICKET_QUERY,
  );
  if (
    mediaTickets.length !== 1 ||
    [...url.searchParams.keys()].some(
      (key) => key !== BROADCAST_TRANSCRIPT_MEDIA_TICKET_QUERY,
    )
  ) {
    return emptyMediaResponse(404);
  }
  const mediaTicket = mediaTickets[0];
  if (mediaTicket === undefined) return emptyMediaResponse(404);

  const resolved = await resolveBroadcastTranscriptMedia({
    bucket: options.bucket,
    signingKey: options.signingKey,
    mediaTicket,
    ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
    ...(options.cryptoImplementation === undefined
      ? {}
      : { cryptoImplementation: options.cryptoImplementation }),
  });
  if (resolved === null) return emptyMediaResponse(404);

  const rangeValue = request.headers.get("Range");
  const range =
    rangeValue === null
      ? null
      : parseByteRange(rangeValue, resolved.byteLength);
  if (rangeValue !== null && range === null) {
    return emptyMediaResponse(416, {
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes */${resolved.byteLength}`,
    });
  }

  const contentLength = range?.length ?? resolved.byteLength;
  const headers = mediaResponseHeaders(contentLength);
  const status = range === null ? 200 : 206;
  if (range !== null) {
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.endInclusive}/${resolved.byteLength}`,
    );
  }
  if (request.method === "HEAD") {
    return new Response(null, { status, headers });
  }

  const object = await options.bucket.get(
    resolved.objectKey,
    range === null
      ? undefined
      : {
          range: {
            offset: range.offset,
            length: range.length,
          },
        },
  );
  if (
    object === null ||
    !isObjectBody(object) ||
    object.size !== resolved.byteLength
  ) {
    return emptyMediaResponse(404);
  }
  return new Response(object.body, { status, headers });
}
