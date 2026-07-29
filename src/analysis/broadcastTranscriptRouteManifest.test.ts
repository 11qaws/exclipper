import { describe, expect, it, vi } from "vitest";
import {
  BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
  BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
} from "./broadcastTranscriptQwen";
import {
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
  } = {},
): unknown {
  const provider = overrides.provider ?? "qwen";
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
      modelId: "whisper-large-v3-turbo",
      modelRevision:
        "groq-whisper-large-v3-turbo-ko-segment-v1-2026-07-29",
    },
  } as const;
  const identity = identities[provider];
  return {
    ok: true,
    service: "rettohighlight-gemini",
    version: 5,
    routingPolicyVersion: "1.11.0",
    transcriptTransport: {
      version: 2,
      mode: overrides.mode ?? "free-r2",
      configured: true,
      primaryMediaType: "audio/wav",
      maximumChunkDurationMs: 90_000,
    },
    providers: {
      schemaVersion: "1.3.0",
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
    schemaVersion: "1.0.0",
    serviceVersion: 5,
    routingPolicyVersion: "1.11.0",
    providerConfigurationVersion: "1.3.0",
    transportVersion: 2,
    transportMode: mode,
    maximumChunkDurationMs: 90_000,
    primaryMediaType: "audio/wav",
    provider: "qwen",
    modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
    modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
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
        provider: "qwen",
        modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
        transportMode: "free-r2",
      },
    });
    expect(route.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
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
