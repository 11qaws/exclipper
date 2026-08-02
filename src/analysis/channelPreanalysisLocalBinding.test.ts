import { describe, expect, it } from "vitest";
import {
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
  CHANNEL_PREANALYSIS_SOURCES,
  EUREKA_CHANNEL_PREANALYSIS_SOURCE,
  type ConfiguredChannelPreanalysisSource,
} from "./channelPreanalysisSources";
import {
  CHANNEL_PREANALYSIS_LOCAL_BINDING_MAX_ENTRIES,
  CHANNEL_PREANALYSIS_LOCAL_BINDING_SCHEMA_VERSION,
  CHANNEL_PREANALYSIS_LOCAL_BINDING_STORAGE_KEY,
  getChannelPreanalysisLocalBinding,
  loadChannelPreanalysisLocalBindings,
  registerChannelPreanalysisLocalBinding,
  type ChannelPreanalysisLocalBindingStorage,
} from "./channelPreanalysisLocalBinding";

const VIDEO_ID = "KzAW3yow80Q";
const SECOND_VIDEO_ID = "EZfCGS5ms_Q";
const REGISTERED_AT = "2026-07-30T01:02:03.004Z";

function provenance(
  source: ConfiguredChannelPreanalysisSource =
    AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
) {
  return {
    sourceId: source.sourceId,
    channelId: source.channelId,
  };
}

function fingerprint(index: number): string {
  return `local-file-sampled-sha256-v1:${index
    .toString(16)
    .padStart(64, "0")}`;
}

class MemoryStorage implements ChannelPreanalysisLocalBindingStorage {
  public readonly values = new Map<string, string>();
  public removed = 0;

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  public removeItem(key: string): void {
    this.removed += 1;
    this.values.delete(key);
  }
}

class FirstWriteCollisionStorage extends MemoryStorage {
  public writeCount = 0;

  public override setItem(key: string, value: string): void {
    super.setItem(key, value);
    this.writeCount += 1;
    if (this.writeCount !== 1) return;

    super.setItem(
      key,
      JSON.stringify({
        schemaVersion: CHANNEL_PREANALYSIS_LOCAL_BINDING_SCHEMA_VERSION,
        bindings: [
          {
            localSampledFingerprint: fingerprint(99),
            ...provenance(EUREKA_CHANNEL_PREANALYSIS_SOURCE),
            videoId: SECOND_VIDEO_ID,
            registeredAt: "2026-07-30T01:02:03.005Z",
          },
        ],
      }),
    );
  }
}

function setRaw(storage: MemoryStorage, value: unknown): void {
  storage.values.set(
    CHANNEL_PREANALYSIS_LOCAL_BINDING_STORAGE_KEY,
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

describe("channel preanalysis local binding", () => {
  it("loads an empty current-schema document when no cache exists", () => {
    expect(loadChannelPreanalysisLocalBindings(new MemoryStorage())).toEqual({
      schemaVersion: CHANNEL_PREANALYSIS_LOCAL_BINDING_SCHEMA_VERSION,
      bindings: [],
    });
  });

  it.each(CHANNEL_PREANALYSIS_SOURCES)(
    "persists an exact sampled-file association for $sourceId",
    (source) => {
      const storage = new MemoryStorage();
      const localSampledFingerprint = fingerprint(
        CHANNEL_PREANALYSIS_SOURCES.indexOf(source) + 1,
      );

      expect(
        registerChannelPreanalysisLocalBinding(
          {
            localSampledFingerprint,
            ...provenance(source),
            videoId: VIDEO_ID,
            registeredAt: REGISTERED_AT,
          },
          storage,
        ),
      ).toEqual({
        localSampledFingerprint,
        ...provenance(source),
        videoId: VIDEO_ID,
        registeredAt: REGISTERED_AT,
      });
      expect(
        getChannelPreanalysisLocalBinding(
          localSampledFingerprint,
          storage,
        ),
      ).toEqual({
        localSampledFingerprint,
        ...provenance(source),
        videoId: VIDEO_ID,
        registeredAt: REGISTERED_AT,
      });
      expect(
        JSON.parse(
          storage.values.get(
            CHANNEL_PREANALYSIS_LOCAL_BINDING_STORAGE_KEY,
          ) ?? "",
        ),
      ).toEqual({
        schemaVersion: CHANNEL_PREANALYSIS_LOCAL_BINDING_SCHEMA_VERSION,
        bindings: [
          {
            localSampledFingerprint,
            ...provenance(source),
            videoId: VIDEO_ID,
            registeredAt: REGISTERED_AT,
          },
        ],
      });
    },
  );

  it("upserts one fingerprint and refreshes its recency", () => {
    const storage = new MemoryStorage();
    const localSampledFingerprint = fingerprint(2);
    registerChannelPreanalysisLocalBinding(
      {
        localSampledFingerprint,
        ...provenance(),
        videoId: VIDEO_ID,
        registeredAt: "2026-07-29T00:00:00.000Z",
      },
      storage,
    );

    registerChannelPreanalysisLocalBinding(
      {
        localSampledFingerprint,
        ...provenance(EUREKA_CHANNEL_PREANALYSIS_SOURCE),
        videoId: SECOND_VIDEO_ID,
        registeredAt: REGISTERED_AT,
      },
      storage,
    );

    expect(loadChannelPreanalysisLocalBindings(storage).bindings).toEqual([
      {
        localSampledFingerprint,
        ...provenance(EUREKA_CHANNEL_PREANALYSIS_SOURCE),
        videoId: SECOND_VIDEO_ID,
        registeredAt: REGISTERED_AT,
      },
    ]);
  });

  it("readback-merges a binding displaced by an overlapping tab write", () => {
    const storage = new FirstWriteCollisionStorage();
    const localSampledFingerprint = fingerprint(2);

    expect(
      registerChannelPreanalysisLocalBinding(
        {
          localSampledFingerprint,
          ...provenance(),
          videoId: VIDEO_ID,
          registeredAt: REGISTERED_AT,
        },
        storage,
      ),
    ).not.toBeNull();

    expect(storage.writeCount).toBe(2);
    expect(loadChannelPreanalysisLocalBindings(storage).bindings).toEqual([
      {
        localSampledFingerprint: fingerprint(99),
        ...provenance(EUREKA_CHANNEL_PREANALYSIS_SOURCE),
        videoId: SECOND_VIDEO_ID,
        registeredAt: "2026-07-30T01:02:03.005Z",
      },
      {
        localSampledFingerprint,
        ...provenance(),
        videoId: VIDEO_ID,
        registeredAt: REGISTERED_AT,
      },
    ]);
  });

  it("keeps the newest 256 bindings and deterministically prunes the oldest", () => {
    const storage = new MemoryStorage();
    for (
      let index = 0;
      index <= CHANNEL_PREANALYSIS_LOCAL_BINDING_MAX_ENTRIES;
      index += 1
    ) {
      registerChannelPreanalysisLocalBinding(
        {
          localSampledFingerprint: fingerprint(index),
          ...provenance(),
          videoId: VIDEO_ID,
          registeredAt: new Date(
            Date.UTC(2026, 0, 1, 0, 0, index),
          ).toISOString(),
        },
        storage,
      );
    }

    const loaded = loadChannelPreanalysisLocalBindings(storage);
    expect(loaded.bindings).toHaveLength(
      CHANNEL_PREANALYSIS_LOCAL_BINDING_MAX_ENTRIES,
    );
    expect(
      loaded.bindings.some(
        ({ localSampledFingerprint }) =>
          localSampledFingerprint === fingerprint(0),
      ),
    ).toBe(false);
    expect(loaded.bindings[0]?.localSampledFingerprint).toBe(
      fingerprint(CHANNEL_PREANALYSIS_LOCAL_BINDING_MAX_ENTRIES),
    );
  });

  it.each([
    ["invalid JSON", "{"],
    [
      "a legacy channel-scoped v1 document",
      {
        schemaVersion: 1,
        channelId: AMORETTO_CHANNEL_PREANALYSIS_SOURCE.channelId,
        bindings: [],
      },
    ],
    [
      "an extra document property",
      {
        schemaVersion: CHANNEL_PREANALYSIS_LOCAL_BINDING_SCHEMA_VERSION,
        bindings: [],
        future: true,
      },
    ],
    [
      "an unknown binding source",
      {
        schemaVersion: CHANNEL_PREANALYSIS_LOCAL_BINDING_SCHEMA_VERSION,
        bindings: [
          {
            localSampledFingerprint: fingerprint(2),
            sourceId: "unknown-source",
            channelId: AMORETTO_CHANNEL_PREANALYSIS_SOURCE.channelId,
            videoId: VIDEO_ID,
            registeredAt: REGISTERED_AT,
          },
        ],
      },
    ],
    [
      "a mismatched configured source and channel",
      {
        schemaVersion: CHANNEL_PREANALYSIS_LOCAL_BINDING_SCHEMA_VERSION,
        bindings: [
          {
            localSampledFingerprint: fingerprint(2),
            sourceId: AMORETTO_CHANNEL_PREANALYSIS_SOURCE.sourceId,
            channelId: EUREKA_CHANNEL_PREANALYSIS_SOURCE.channelId,
            videoId: VIDEO_ID,
            registeredAt: REGISTERED_AT,
          },
        ],
      },
    ],
    [
      "an invalid fingerprint",
      {
        schemaVersion: CHANNEL_PREANALYSIS_LOCAL_BINDING_SCHEMA_VERSION,
        bindings: [
          {
            localSampledFingerprint: `sha256:${"a".repeat(64)}`,
            ...provenance(),
            videoId: VIDEO_ID,
            registeredAt: REGISTERED_AT,
          },
        ],
      },
    ],
    [
      "a non-canonical date",
      {
        schemaVersion: CHANNEL_PREANALYSIS_LOCAL_BINDING_SCHEMA_VERSION,
        bindings: [
          {
            localSampledFingerprint: fingerprint(3),
            ...provenance(),
            videoId: VIDEO_ID,
            registeredAt: "2026-07-30T01:02:03Z",
          },
        ],
      },
    ],
    [
      "a duplicate fingerprint",
      {
        schemaVersion: CHANNEL_PREANALYSIS_LOCAL_BINDING_SCHEMA_VERSION,
        bindings: [
          {
            localSampledFingerprint: fingerprint(4),
            ...provenance(),
            videoId: VIDEO_ID,
            registeredAt: REGISTERED_AT,
          },
          {
            localSampledFingerprint: fingerprint(4),
            ...provenance(EUREKA_CHANNEL_PREANALYSIS_SOURCE),
            videoId: SECOND_VIDEO_ID,
            registeredAt: "2026-07-30T02:02:03.004Z",
          },
        ],
      },
    ],
  ])("clears %s instead of partially trusting it", (_label, value) => {
    const storage = new MemoryStorage();
    setRaw(storage, value);

    expect(loadChannelPreanalysisLocalBindings(storage).bindings).toEqual(
      [],
    );
    expect(storage.removed).toBe(1);
    expect(
      storage.values.has(
        CHANNEL_PREANALYSIS_LOCAL_BINDING_STORAGE_KEY,
      ),
    ).toBe(false);
  });

  it("rejects registration when a configured source and channel do not match", () => {
    const storage = new MemoryStorage();

    expect(
      registerChannelPreanalysisLocalBinding(
        {
          localSampledFingerprint: fingerprint(8),
          sourceId: AMORETTO_CHANNEL_PREANALYSIS_SOURCE.sourceId,
          channelId: EUREKA_CHANNEL_PREANALYSIS_SOURCE.channelId,
          videoId: VIDEO_ID,
          registeredAt: REGISTERED_AT,
        },
        storage,
      ),
    ).toBeNull();
    expect(storage.values.size).toBe(0);
  });

  it("rejects over-limit documents rather than silently truncating them", () => {
    const storage = new MemoryStorage();
    setRaw(storage, {
      schemaVersion: CHANNEL_PREANALYSIS_LOCAL_BINDING_SCHEMA_VERSION,
      bindings: Array.from(
        {
          length:
            CHANNEL_PREANALYSIS_LOCAL_BINDING_MAX_ENTRIES + 1,
        },
        (_, index) => ({
          localSampledFingerprint: fingerprint(index),
          ...provenance(),
          videoId: VIDEO_ID,
          registeredAt: REGISTERED_AT,
        }),
      ),
    });

    expect(loadChannelPreanalysisLocalBindings(storage).bindings).toEqual(
      [],
    );
    expect(storage.removed).toBe(1);
  });

  it("does not throw when browser storage access is denied", () => {
    const deniedStorage: ChannelPreanalysisLocalBindingStorage = {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    };

    expect(loadChannelPreanalysisLocalBindings(deniedStorage)).toEqual({
      schemaVersion: CHANNEL_PREANALYSIS_LOCAL_BINDING_SCHEMA_VERSION,
      bindings: [],
    });
    expect(
      getChannelPreanalysisLocalBinding(fingerprint(5), deniedStorage),
    ).toBeNull();
    expect(
      registerChannelPreanalysisLocalBinding(
        {
          localSampledFingerprint: fingerprint(5),
          ...provenance(),
          videoId: VIDEO_ID,
          registeredAt: REGISTERED_AT,
        },
        deniedStorage,
      ),
    ).toBeNull();
  });

  it("does not accept remote digests, uppercase hashes, invalid IDs, or invalid dates", () => {
    const storage = new MemoryStorage();
    const uppercaseFingerprint =
      `local-file-sampled-sha256-v1:${"A".repeat(64)}`;

    expect(
      registerChannelPreanalysisLocalBinding(
        {
          localSampledFingerprint: `sha256:${"a".repeat(64)}`,
          ...provenance(),
          videoId: VIDEO_ID,
          registeredAt: REGISTERED_AT,
        },
        storage,
      ),
    ).toBeNull();
    expect(
      registerChannelPreanalysisLocalBinding(
        {
          localSampledFingerprint: uppercaseFingerprint,
          ...provenance(),
          videoId: VIDEO_ID,
          registeredAt: REGISTERED_AT,
        },
        storage,
      ),
    ).toBeNull();
    expect(
      registerChannelPreanalysisLocalBinding(
        {
          localSampledFingerprint: fingerprint(6),
          ...provenance(),
          videoId: "too-short",
          registeredAt: REGISTERED_AT,
        },
        storage,
      ),
    ).toBeNull();
    expect(
      registerChannelPreanalysisLocalBinding(
        {
          localSampledFingerprint: fingerprint(6),
          ...provenance(),
          videoId: VIDEO_ID,
          registeredAt: "not-a-date",
        },
        storage,
      ),
    ).toBeNull();
    expect(storage.values.size).toBe(0);
  });
});
