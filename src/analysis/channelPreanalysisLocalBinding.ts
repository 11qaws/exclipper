import {
  channelPreanalysisSourceById,
  type ChannelPreanalysisSourceId,
  type ChannelPreanalysisYouTubeChannelId,
} from "./channelPreanalysisSources";

export const CHANNEL_PREANALYSIS_LOCAL_BINDING_SCHEMA_VERSION = 2 as const;
export const CHANNEL_PREANALYSIS_LOCAL_BINDING_STORAGE_KEY =
  "exclipper.channel-preanalysis.local-bindings.v2" as const;
export const CHANNEL_PREANALYSIS_LOCAL_BINDING_MAX_ENTRIES = 256;

const CHANNEL_PREANALYSIS_LOCAL_BINDING_MAX_BYTES = 96 * 1024;
const CHANNEL_PREANALYSIS_LOCAL_BINDING_WRITE_ATTEMPTS = 3;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;
const LOCAL_SAMPLED_FINGERPRINT_PATTERN =
  /^local-file-sampled-sha256-v1:[0-9a-f]{64}$/u;
const CANONICAL_ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/**
 * The smallest synchronous surface used from browser localStorage.
 * Tests and non-browser callers can inject an equivalent implementation.
 */
export interface ChannelPreanalysisLocalBindingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ChannelPreanalysisLocalBinding {
  readonly localSampledFingerprint: string;
  readonly sourceId: ChannelPreanalysisSourceId;
  readonly channelId: ChannelPreanalysisYouTubeChannelId;
  readonly videoId: string;
  readonly registeredAt: string;
}

export interface ChannelPreanalysisLocalBindingDocument {
  readonly schemaVersion: typeof CHANNEL_PREANALYSIS_LOCAL_BINDING_SCHEMA_VERSION;
  readonly bindings: readonly ChannelPreanalysisLocalBinding[];
}

export interface RegisterChannelPreanalysisLocalBindingInput {
  readonly localSampledFingerprint: string;
  readonly sourceId: ChannelPreanalysisSourceId;
  readonly channelId: ChannelPreanalysisYouTubeChannelId;
  readonly videoId: string;
  /**
   * Optional for deterministic imports and tests. It must already be a
   * canonical UTC timestamp such as `2026-07-30T12:34:56.789Z`.
   */
  readonly registeredAt?: string;
}

const EMPTY_DOCUMENT: ChannelPreanalysisLocalBindingDocument = Object.freeze({
  schemaVersion: CHANNEL_PREANALYSIS_LOCAL_BINDING_SCHEMA_VERSION,
  bindings: Object.freeze([]),
});

/**
 * Loads the browser-local exact-file bindings.
 *
 * A malformed document is never partially trusted. It is ignored and removal
 * is attempted so a later registration can repair the cache. Storage access
 * failures are intentionally non-fatal because this cache must not block the
 * main analysis pipeline.
 */
export function loadChannelPreanalysisLocalBindings(
  storage: ChannelPreanalysisLocalBindingStorage | null = defaultStorage(),
): ChannelPreanalysisLocalBindingDocument {
  if (storage === null) return EMPTY_DOCUMENT;

  let serialized: string | null;
  try {
    serialized = storage.getItem(
      CHANNEL_PREANALYSIS_LOCAL_BINDING_STORAGE_KEY,
    );
  } catch {
    return EMPTY_DOCUMENT;
  }
  if (serialized === null) return EMPTY_DOCUMENT;

  if (
    serialized.length > CHANNEL_PREANALYSIS_LOCAL_BINDING_MAX_BYTES ||
    new TextEncoder().encode(serialized).byteLength >
      CHANNEL_PREANALYSIS_LOCAL_BINDING_MAX_BYTES
  ) {
    clearMalformedDocument(storage);
    return EMPTY_DOCUMENT;
  }

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    clearMalformedDocument(storage);
    return EMPTY_DOCUMENT;
  }
  const document = parseDocument(value);
  if (document === null) {
    clearMalformedDocument(storage);
    return EMPTY_DOCUMENT;
  }
  return document;
}

/**
 * Finds only an exact sampled-byte binding. A perceptual or remote digest is
 * never accepted as an equivalent file identity.
 */
export function getChannelPreanalysisLocalBinding(
  localSampledFingerprint: string,
  storage: ChannelPreanalysisLocalBindingStorage | null = defaultStorage(),
): ChannelPreanalysisLocalBinding | null {
  if (!isLocalSampledFingerprint(localSampledFingerprint)) return null;
  return (
    loadChannelPreanalysisLocalBindings(storage).bindings.find(
      (binding) =>
        binding.localSampledFingerprint === localSampledFingerprint,
    ) ?? null
  );
}

/**
 * Registers an exact or editor-confirmed association and makes it the newest
 * binding. Each serialized write is atomic; a readback-and-merge retry repairs
 * detected overlapping tab writes. Only the newest 256 bindings are retained.
 *
 * `null` means the input or browser storage was unavailable; callers can
 * continue without the cache and must not treat it as an analysis failure.
 */
export function registerChannelPreanalysisLocalBinding(
  input: RegisterChannelPreanalysisLocalBindingInput,
  storage: ChannelPreanalysisLocalBindingStorage | null = defaultStorage(),
): ChannelPreanalysisLocalBinding | null {
  const registeredAt = input.registeredAt ?? new Date().toISOString();
  const configuredSource = channelPreanalysisSourceById(input.sourceId);
  if (
    storage === null ||
    configuredSource === null ||
    configuredSource.channelId !== input.channelId ||
    !isLocalSampledFingerprint(input.localSampledFingerprint) ||
    !YOUTUBE_VIDEO_ID_PATTERN.test(input.videoId) ||
    !isCanonicalIsoDate(registeredAt)
  ) {
    return null;
  }

  const binding: ChannelPreanalysisLocalBinding = {
    localSampledFingerprint: input.localSampledFingerprint,
    sourceId: configuredSource.sourceId,
    channelId: configuredSource.channelId,
    videoId: input.videoId,
    registeredAt,
  };

  /*
   * localStorage has no compare-and-swap primitive. A second tab can therefore
   * replace the document between this tab's read and write. Read the committed
   * document back and merge again when our exact binding was displaced. This
   * keeps the synchronous API while repairing the common overlapping-write
   * window instead of silently losing the other tab's association.
   */
  for (
    let attempt = 0;
    attempt < CHANNEL_PREANALYSIS_LOCAL_BINDING_WRITE_ATTEMPTS;
    attempt += 1
  ) {
    const previous = loadChannelPreanalysisLocalBindings(storage);
    const document = documentWithBinding(previous, binding);
    try {
      storage.setItem(
        CHANNEL_PREANALYSIS_LOCAL_BINDING_STORAGE_KEY,
        JSON.stringify(document),
      );
    } catch {
      return null;
    }

    const committed = loadChannelPreanalysisLocalBindings(storage);
    if (
      committed.bindings.some(
        (candidate) =>
          candidate.localSampledFingerprint ===
            binding.localSampledFingerprint &&
          candidate.sourceId === binding.sourceId &&
          candidate.channelId === binding.channelId &&
          candidate.videoId === binding.videoId &&
          candidate.registeredAt === binding.registeredAt,
      )
    ) {
      return binding;
    }
  }
  return null;
}

function documentWithBinding(
  previous: ChannelPreanalysisLocalBindingDocument,
  binding: ChannelPreanalysisLocalBinding,
): ChannelPreanalysisLocalBindingDocument {
  return {
    schemaVersion: CHANNEL_PREANALYSIS_LOCAL_BINDING_SCHEMA_VERSION,
    bindings: [...previous.bindings]
      .filter(
        (candidate) =>
          candidate.localSampledFingerprint !==
          binding.localSampledFingerprint,
      )
      .concat(binding)
      .sort(compareNewestBindingFirst)
      .slice(0, CHANNEL_PREANALYSIS_LOCAL_BINDING_MAX_ENTRIES),
  };
}

function defaultStorage(): ChannelPreanalysisLocalBindingStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

function parseDocument(
  value: unknown,
): ChannelPreanalysisLocalBindingDocument | null {
  if (
    !isExactObject(value, ["schemaVersion", "bindings"]) ||
    value.schemaVersion !==
      CHANNEL_PREANALYSIS_LOCAL_BINDING_SCHEMA_VERSION ||
    !Array.isArray(value.bindings) ||
    value.bindings.length > CHANNEL_PREANALYSIS_LOCAL_BINDING_MAX_ENTRIES
  ) {
    return null;
  }

  const seenFingerprints = new Set<string>();
  const bindings: ChannelPreanalysisLocalBinding[] = [];
  for (const candidate of value.bindings) {
    if (
      !isExactObject(candidate, [
        "localSampledFingerprint",
        "sourceId",
        "channelId",
        "videoId",
        "registeredAt",
      ]) ||
      !isLocalSampledFingerprint(candidate.localSampledFingerprint) ||
      typeof candidate.sourceId !== "string" ||
      typeof candidate.channelId !== "string" ||
      typeof candidate.videoId !== "string" ||
      !YOUTUBE_VIDEO_ID_PATTERN.test(candidate.videoId) ||
      typeof candidate.registeredAt !== "string" ||
      !isCanonicalIsoDate(candidate.registeredAt) ||
      seenFingerprints.has(candidate.localSampledFingerprint)
    ) {
      return null;
    }
    const configuredSource = channelPreanalysisSourceById(
      candidate.sourceId,
    );
    if (
      configuredSource === null ||
      configuredSource.channelId !== candidate.channelId
    ) {
      return null;
    }
    seenFingerprints.add(candidate.localSampledFingerprint);
    bindings.push({
      localSampledFingerprint: candidate.localSampledFingerprint,
      sourceId: configuredSource.sourceId,
      channelId: configuredSource.channelId,
      videoId: candidate.videoId,
      registeredAt: candidate.registeredAt,
    });
  }

  bindings.sort(compareNewestBindingFirst);
  return {
    schemaVersion: CHANNEL_PREANALYSIS_LOCAL_BINDING_SCHEMA_VERSION,
    bindings,
  };
}

function isExactObject(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  );
}

function isLocalSampledFingerprint(value: unknown): value is string {
  return (
    typeof value === "string" &&
    LOCAL_SAMPLED_FINGERPRINT_PATTERN.test(value)
  );
}

function isCanonicalIsoDate(value: string): boolean {
  if (!CANONICAL_ISO_DATE_PATTERN.test(value)) return false;
  const epochMs = Date.parse(value);
  return (
    Number.isFinite(epochMs) &&
    new Date(epochMs).toISOString() === value
  );
}

function compareNewestBindingFirst(
  left: ChannelPreanalysisLocalBinding,
  right: ChannelPreanalysisLocalBinding,
): number {
  const timestampOrder = right.registeredAt.localeCompare(left.registeredAt);
  return timestampOrder !== 0
    ? timestampOrder
    : left.localSampledFingerprint.localeCompare(
        right.localSampledFingerprint,
      );
}

function clearMalformedDocument(
  storage: ChannelPreanalysisLocalBindingStorage,
): void {
  try {
    storage.removeItem(CHANNEL_PREANALYSIS_LOCAL_BINDING_STORAGE_KEY);
  } catch {
    // A denied or full localStorage is equivalent to an unavailable cache.
  }
}
