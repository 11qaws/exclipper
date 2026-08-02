import { describe, expect, it, vi } from "vitest";
import {
  BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
  BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_GROQ_MODEL_ID,
  BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
} from "./broadcastTranscriptQwen";
import {
  BROADCAST_TRANSCRIPT_HEALTH_PROVIDER_CATALOG_SCHEMA_VERSION,
  BROADCAST_TRANSCRIPT_PROVIDER_CONFIGURATION_VERSION,
  createBroadcastTranscriptProviderReceipt,
  createBroadcastTranscriptRouteSelection,
  requestBroadcastTranscriptRouteSelection,
  verifyBroadcastTranscriptRouteSelection,
  type BroadcastTranscriptRouteManifest,
} from "./broadcastTranscriptRouteManifest";

function healthBody(
  overrides: {
    readonly provider?: "qwen" | "gemini" | "groq";
    readonly modelId?: string;
    readonly modelRevision?: string;
    readonly mode?: "free-r2" | "paid-direct";
    readonly active?: boolean;
    readonly healthProviderCatalogSchemaVersion?: string;
  } = {},
): unknown {
  const provider = overrides.provider ?? "qwen";
  const mode = overrides.mode ?? "free-r2";
  const identities = {
    qwen: {
      modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
    },
    gemini: {
      modelId: BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
      modelRevision: BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION,
    },
    groq: {
      modelId: BROADCAST_TRANSCRIPT_GROQ_MODEL_ID,
      modelRevision: BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION,
    },
  } as const;
  const identity = identities[provider];
  return {
    ok: true,
    service: "rettohighlight-gemini",
    version: 6,
    routingPolicyVersion: "1.11.0",
    transcriptTransport: {
      version: 3,
      mode,
      configured: true,
      primaryMediaType: "audio/wav",
      maximumChunkDurationMs: 90_000,
      effectiveFallback:
        mode === "paid-direct"
          ? provider === "qwen"
            ? {
                mode: "bounded",
                provider: "gemini",
                modelId: BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
                modelRevision: BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION,
              }
            : {
                mode: "bounded",
                provider: "qwen",
                modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
                modelRevision:
                  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
              }
          : { mode: "disabled" },
    },
    providers: {
      schemaVersion:
        overrides.healthProviderCatalogSchemaVersion ??
        BROADCAST_TRANSCRIPT_HEALTH_PROVIDER_CATALOG_SCHEMA_VERSION,
      broadcastTranscript: {
        selectedProvider: provider,
        modelId: overrides.modelId ?? identity.modelId,
        modelRevision:
          overrides.modelRevision ?? identity.modelRevision,
        implementationStatus: "active",
        configured: true,
        active: overrides.active ?? true,
      },
    },
  };
}

async function selection(
  mode: "free-r2" | "paid-direct" = "free-r2",
): Promise<Awaited<ReturnType<typeof createBroadcastTranscriptRouteSelection>>> {
  const manifest: BroadcastTranscriptRouteManifest = {
    schemaVersion: "1.1.0",
    serviceVersion: 6,
    routingPolicyVersion: "1.11.0",
    providerConfigurationVersion: "1.3.0",
    transportVersion: 3,
    transportMode: mode,
    maximumChunkDurationMs: 90_000,
    primaryMediaType: "audio/wav",
    provider: "qwen",
    modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
    modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
    effectiveFallback:
      mode === "paid-direct"
        ? {
            mode: "bounded",
            provider: "gemini",
            modelId: BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
            modelRevision: BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION,
          }
        : { mode: "disabled" },
  };
  return createBroadcastTranscriptRouteSelection(manifest);
}

describe("broadcastTranscriptRouteManifest", () => {
  it("pins the live Qwen route from the public health manifest", async () => {
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(healthBody()), { status: 200 }),
      ),
    );

    const route = await requestBroadcastTranscriptRouteSelection(
      "https://example.test/v1/broadcast-transcript",
      { fetchImplementation },
    );

    expect(fetchImplementation).toHaveBeenCalledWith(
      new URL("https://example.test/healthz"),
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        credentials: "omit",
      }),
    );
    expect(route).toMatchObject({
      manifest: {
        providerConfigurationVersion:
          BROADCAST_TRANSCRIPT_PROVIDER_CONFIGURATION_VERSION,
        provider: "qwen",
        modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
        transportMode: "free-r2",
      },
    });
    expect(route.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("distinguishes the full health provider catalog schema from the transcript route version", async () => {
    expect(BROADCAST_TRANSCRIPT_HEALTH_PROVIDER_CATALOG_SCHEMA_VERSION).toBe(
      "1.4.0",
    );
    expect(BROADCAST_TRANSCRIPT_PROVIDER_CONFIGURATION_VERSION).toBe("1.3.0");

    await expect(
      requestBroadcastTranscriptRouteSelection(
        "https://example.test/v1/broadcast-transcript",
        {
          fetchImplementation: () =>
            Promise.resolve(
              new Response(
                JSON.stringify(
                  healthBody({ healthProviderCatalogSchemaVersion: "1.3.0" }),
                ),
                { status: 200 },
              ),
            ),
        },
      ),
    ).rejects.toMatchObject({ code: "HEALTH_INVALID_RESPONSE" });
  });

  it("rejects a health manifest that labels one provider as another model", async () => {
    await expect(
      requestBroadcastTranscriptRouteSelection(
        "https://example.test/v1/broadcast-transcript",
        {
          fetchImplementation: () =>
            Promise.resolve(
              new Response(
                JSON.stringify(
                  healthBody({
                    modelId: BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
                  }),
                ),
                { status: 200 },
              ),
            ),
        },
      ),
    ).rejects.toMatchObject({ code: "HEALTH_INVALID_RESPONSE" });
  });

  it.each([
    ["groq", "free-r2"],
    ["gemini", "paid-direct"],
  ] as const)(
    "pins the current %s identity on the %s transport",
    async (provider, mode) => {
      const route = await requestBroadcastTranscriptRouteSelection(
        "https://example.test/v1/broadcast-transcript",
        {
          fetchImplementation: () =>
            Promise.resolve(
              new Response(
                JSON.stringify(healthBody({ provider, mode })),
                { status: 200 },
              ),
            ),
        },
      );

      expect(route.manifest.provider).toBe(provider);
      expect(route.manifest.transportMode).toBe(mode);
    },
  );

  it("rejects a stale provider revision even when the provider and model ID match", async () => {
    await expect(
      requestBroadcastTranscriptRouteSelection(
        "https://example.test/v1/broadcast-transcript",
        {
          fetchImplementation: () =>
            Promise.resolve(
              new Response(
                JSON.stringify(
                  healthBody({ modelRevision: "stale-revision" }),
                ),
                { status: 200 },
              ),
            ),
        },
      ),
    ).rejects.toMatchObject({ code: "HEALTH_INVALID_RESPONSE" });
  });

  it("rejects Gemini on the Free R2 capability transport", async () => {
    await expect(
      requestBroadcastTranscriptRouteSelection(
        "https://example.test/v1/broadcast-transcript",
        {
          fetchImplementation: () =>
            Promise.resolve(
              new Response(
                JSON.stringify(healthBody({ provider: "gemini" })),
                { status: 200 },
              ),
            ),
        },
      ),
    ).rejects.toMatchObject({ code: "HEALTH_INVALID_RESPONSE" });
  });

  it("detects a route manifest changed after its fingerprint was issued", async () => {
    const route = await selection();
    await expect(
      verifyBroadcastTranscriptRouteSelection({
        ...route,
        manifest: {
          ...route.manifest,
          transportMode: "paid-direct",
        },
      }),
    ).rejects.toThrow("fingerprint");
  });

  it("changes the route fingerprint when the effective paid fallback changes", async () => {
    const bounded = await selection("paid-direct");
    const disabled = await createBroadcastTranscriptRouteSelection({
      ...bounded.manifest,
      effectiveFallback: { mode: "disabled" },
    });

    expect(disabled.fingerprint).not.toBe(bounded.fingerprint);
    expect(disabled.manifest.effectiveFallback).toEqual({
      mode: "disabled",
    });
  });

  it("accepts only the declared primary or bounded paid fallback identity", async () => {
    const freeRoute = await selection("free-r2");
    expect(
      createBroadcastTranscriptProviderReceipt(
        freeRoute,
        BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
        BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
        false,
      ),
    ).toMatchObject({ provider: "qwen", fallbackUsed: false });
    expect(() =>
      createBroadcastTranscriptProviderReceipt(
        freeRoute,
        BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
        BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION,
        true,
      ),
    ).toThrow("selected route");

    const paidRoute = await selection("paid-direct");
    expect(
      createBroadcastTranscriptProviderReceipt(
        paidRoute,
        BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
        BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION,
        true,
      ),
    ).toMatchObject({ provider: "gemini", fallbackUsed: true });
  });
});
