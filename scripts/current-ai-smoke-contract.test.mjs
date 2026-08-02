import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANDIDATE_BUNDLE_CONTENT_TYPE,
  CANDIDATE_RESOLVE_CONTENT_TYPE,
  createCurrentContextRequest,
  currentTranscriptRouteManifest,
  PRODUCTION_ORIGIN,
  runCandidateSmoke,
  runContextSmoke,
  runTranscriptSmoke,
  runWithQuota,
  sha256Digest,
  TRANSCRIPT_RESOLVE_CONTENT_TYPE,
  TRANSCRIPT_ROUTE_HEADER,
} from "./current-ai-smoke-contract.mjs";

const TEST_ORIGIN = "https://worker.example";
const LEASE_TOKEN = "l".repeat(48);
const TRANSCRIPT_TICKET = `v2.${"a".repeat(64)}.${"b".repeat(43)}`;
const CANDIDATE_TICKET = `v2.${"c".repeat(80)}.${"d".repeat(43)}`;
const IDENTITY = Object.freeze({
  participantId: "participant_00000000000001",
  runId: "smoke-run-1",
  operationId: "smoke-operation-1",
});

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function grantedQuota() {
  return jsonResponse({
    schemaVersion: "1.0.0",
    status: "granted",
    leaseToken: LEASE_TOKEN,
    leaseExpiresAtMs: Date.now() + 60_000,
    retryAfterMs: 0,
    activeParticipantCount: 1,
    poolInFlightCount: 1,
  });
}

function capacityFullQuota() {
  return jsonResponse(
    {
      schemaVersion: "1.0.0",
      status: "capacity-full",
      retryAfterMs: 125,
      activeParticipantCount: 5,
      poolInFlightCount: 6,
    },
    429,
    { "Retry-After": "1" },
  );
}

function currentHealth({
  provider = "groq",
  mode = "free-r2",
  effectiveFallback = { mode: "disabled" },
  providerSchemaVersion = "1.4.0",
  modelId,
  modelRevision,
} = {}) {
  const identities = {
    qwen: {
      modelId: "qwen3.5-omni-flash",
      modelRevision:
        "qwen3.5-omni-flash-audio-transcript-90s-reviewed-2026-07-22",
    },
    gemini: {
      modelId: "gemini-3.6-flash",
      modelRevision:
        "gemini-3.6-flash-audio-transcript-reviewed-2026-07-22",
    },
    groq: {
      modelId: "whisper-large-v3-turbo",
      modelRevision:
        "groq-whisper-large-v3-turbo-ko-segment-v2-2026-08-02",
    },
  };
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
      effectiveFallback,
      stagedSchemaVersion: "1.0.0",
    },
    quota: {
      mode: "required",
      coordinatorReady: true,
      maximumActiveParticipants: 5,
    },
    providers: {
      schemaVersion: providerSchemaVersion,
      broadcastTranscript: {
        selectedProvider: provider,
        implementationStatus: "active",
        configured: true,
        active: true,
        modelId: modelId ?? identity.modelId,
        modelRevision: modelRevision ?? identity.modelRevision,
      },
    },
  };
}

test("transcript smoke distinguishes health catalog 1.4.0 from route configuration 1.3.0", () => {
  const route = currentTranscriptRouteManifest(currentHealth({ provider: "qwen" }));
  assert.equal(route.provider, "qwen");
  assert.equal(route.providerConfigurationVersion, "1.3.0");
  assert.throws(
    () =>
      currentTranscriptRouteManifest(
        currentHealth({ providerSchemaVersion: "1.3.0" }),
      ),
    /current transcript contract/u,
  );
});

test("transcript smoke pins every current primary provider identity", () => {
  for (const [provider, mode] of [
    ["qwen", "free-r2"],
    ["groq", "free-r2"],
    ["gemini", "paid-direct"],
  ]) {
    const route = currentTranscriptRouteManifest(
      currentHealth({ provider, mode }),
    );
    assert.equal(route.provider, provider);
    assert.equal(route.transportMode, mode);
    assert.throws(
      () =>
        currentTranscriptRouteManifest(
          currentHealth({ provider, mode, modelId: "stale-model" }),
        ),
      /identity is not current/u,
    );
    assert.throws(
      () =>
        currentTranscriptRouteManifest(
          currentHealth({ provider, mode, modelRevision: "stale-revision" }),
        ),
      /identity is not current/u,
    );
  }
});

test("transcript smoke accepts only a bounded Qwen or Gemini paid fallback", () => {
  const geminiFallback = {
    mode: "bounded",
    provider: "gemini",
    modelId: "gemini-3.6-flash",
    modelRevision:
      "gemini-3.6-flash-audio-transcript-reviewed-2026-07-22",
  };
  assert.deepEqual(
    currentTranscriptRouteManifest(
      currentHealth({
        provider: "qwen",
        mode: "paid-direct",
        effectiveFallback: geminiFallback,
      }),
    ).effectiveFallback,
    geminiFallback,
  );
  const qwenFallback = {
    mode: "bounded",
    provider: "qwen",
    modelId: "qwen3.5-omni-flash",
    modelRevision:
      "qwen3.5-omni-flash-audio-transcript-90s-reviewed-2026-07-22",
  };
  assert.deepEqual(
    currentTranscriptRouteManifest(
      currentHealth({
        provider: "groq",
        mode: "paid-direct",
        effectiveFallback: qwenFallback,
      }),
    ).effectiveFallback,
    qwenFallback,
  );
  assert.throws(
    () =>
      currentTranscriptRouteManifest(
        currentHealth({
          provider: "groq",
          effectiveFallback: qwenFallback,
        }),
      ),
    /fallback route/u,
  );
  assert.throws(
    () =>
      currentTranscriptRouteManifest(
        currentHealth({
          provider: "qwen",
          mode: "paid-direct",
          effectiveFallback: {
            mode: "bounded",
            provider: "groq",
            modelId: "whisper-large-v3-turbo",
            modelRevision:
              "groq-whisper-large-v3-turbo-ko-segment-v2-2026-08-02",
          },
        }),
      ),
    /fallback route/u,
  );
});

function urlString(input) {
  return input instanceof URL ? input.toString() : String(input);
}

test("transcript smoke pins health, stages raw WAV once, resolves, and verifies cleanup", async () => {
  const calls = [];
  const wav = Buffer.alloc(44 + 16, 7);
  const fetchImplementation = async (input, init = {}) => {
    const url = new URL(urlString(input));
    calls.push({
      url: url.toString(),
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body:
        init.body instanceof Uint8Array
          ? Buffer.from(init.body)
          : typeof init.body === "string"
            ? init.body
            : null,
    });
    if (url.pathname === "/healthz") return jsonResponse(currentHealth());
    if (url.pathname === "/v1/ai-quota") return grantedQuota();
    if (
      url.pathname === "/v1/broadcast-transcript" &&
      new Headers(init.headers).get("Content-Type") === "audio/wav"
    ) {
      return jsonResponse(
        {
          schemaVersion: "1.0.0",
          status: "staged",
          mediaTicket: TRANSCRIPT_TICKET,
          expiresAtMs: Date.now() + 60_000,
          sourceStartMs: 12_000,
          sourceEndMs: 13_000,
        },
        202,
      );
    }
    if (url.pathname === "/v1/broadcast-transcript") {
      return jsonResponse({
        schemaVersion: "1.0.0",
        modelId: "whisper-large-v3-turbo",
        modelRevision:
          "groq-whisper-large-v3-turbo-ko-segment-v2-2026-08-02",
        sourceStartMs: 12_000,
        sourceEndMs: 13_000,
        textKo: "테스트 전사",
        detectedLanguage: "ko",
        emotion: null,
        billedSeconds: 1,
      });
    }
    if (url.pathname === "/v1/broadcast-transcript-media") {
      return new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const { response, route } = await runTranscriptSmoke({
    wav,
    sourceStartMs: 12_000,
    durationMs: 1_000,
    proxyOrigin: TEST_ORIGIN,
    identity: IDENTITY,
    fetchImplementation,
    sleep: async () => {},
  });

  assert.equal(response.status, 200);
  assert.equal(route.manifest.provider, "groq");
  assert.deepEqual(
    calls.map(({ method, url }) => [method, new URL(url).pathname]),
    [
      ["GET", "/healthz"],
      ["POST", "/v1/ai-quota"],
      ["POST", "/v1/broadcast-transcript"],
      ["POST", "/v1/broadcast-transcript"],
      ["GET", "/v1/broadcast-transcript-media"],
    ],
  );
  const stage = calls[2];
  const resolve = calls[3];
  assert.equal(stage.headers.get("Content-Type"), "audio/wav");
  assert.equal(
    resolve.headers.get("Content-Type"),
    TRANSCRIPT_RESOLVE_CONTENT_TYPE,
  );
  assert.match(stage.headers.get(TRANSCRIPT_ROUTE_HEADER), /^sha256:[a-f0-9]{64}$/u);
  assert.equal(
    resolve.headers.get(TRANSCRIPT_ROUTE_HEADER),
    stage.headers.get(TRANSCRIPT_ROUTE_HEADER),
  );
  assert.equal(
    stage.headers.get("X-ExClipper-Quota-Payload-Digest"),
    sha256Digest(wav),
  );
  assert.equal(
    resolve.headers.get("X-ExClipper-Quota-Payload-Digest"),
    sha256Digest(wav),
  );
  assert.equal(stage.headers.get("Origin"), PRODUCTION_ORIGIN);
  assert.deepEqual(stage.body, wav);
  assert.deepEqual(JSON.parse(resolve.body), {
    schemaVersion: "1.0.0",
    mediaTicket: TRANSCRIPT_TICKET,
  });
});

test("transcript smoke retains the staged ticket across an explicit 429 retry", async () => {
  let quotaCount = 0;
  let stageCount = 0;
  let resolveCount = 0;
  const operationIds = [];
  const fetchImplementation = async (input, init = {}) => {
    const url = new URL(urlString(input));
    const headers = new Headers(init.headers);
    if (url.pathname === "/healthz") return jsonResponse(currentHealth());
    if (url.pathname === "/v1/ai-quota") {
      quotaCount += 1;
      operationIds.push(JSON.parse(init.body).operationId);
      return grantedQuota();
    }
    if (
      url.pathname === "/v1/broadcast-transcript" &&
      headers.get("Content-Type") === "audio/wav"
    ) {
      stageCount += 1;
      return jsonResponse(
        {
          schemaVersion: "1.0.0",
          status: "staged",
          mediaTicket: TRANSCRIPT_TICKET,
          expiresAtMs: Date.now() + 60_000,
          sourceStartMs: 0,
          sourceEndMs: 1_000,
        },
        202,
      );
    }
    if (url.pathname === "/v1/broadcast-transcript") {
      resolveCount += 1;
      return resolveCount === 1
        ? jsonResponse(
            { error: { code: "UPSTREAM_RATE_LIMITED" } },
            429,
            { "Retry-After": "1" },
          )
        : jsonResponse({ ok: true });
    }
    if (url.pathname === "/v1/broadcast-transcript-media") {
      return new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const { response } = await runTranscriptSmoke({
    wav: Buffer.alloc(60, 3),
    sourceStartMs: 0,
    durationMs: 1_000,
    proxyOrigin: TEST_ORIGIN,
    identity: IDENTITY,
    fetchImplementation,
    sleep: async () => {},
  });

  assert.equal(response.status, 200);
  assert.equal(stageCount, 1);
  assert.equal(resolveCount, 2);
  assert.equal(quotaCount, 2);
  assert.notEqual(operationIds[0], operationIds[1]);
  assert.match(operationIds[0], /\.attempt-0$/u);
  assert.match(operationIds[1], /\.attempt-1$/u);
});

test("smoke quota waits through an HTTP 429 capacity-full response", async () => {
  let quotaCount = 0;
  const waits = [];
  const fetchImplementation = async (input) => {
    const url = new URL(urlString(input));
    if (url.pathname !== "/v1/ai-quota") {
      throw new Error(`Unexpected request: ${url}`);
    }
    quotaCount += 1;
    return quotaCount === 1 ? capacityFullQuota() : grantedQuota();
  };

  const response = await runWithQuota({
    proxyOrigin: TEST_ORIGIN,
    pool: "candidate",
    payload: JSON.stringify({ smoke: true }),
    identity: IDENTITY,
    fetchImplementation,
    sleep: async (delayMs) => {
      waits.push(delayMs);
    },
    execute: async () => jsonResponse({ ok: true }),
  });

  assert.equal(response.status, 200);
  assert.equal(quotaCount, 2);
  assert.deepEqual(waits, [125]);
});

test("context smoke sends the current sealed grounding through context quota", async () => {
  const calls = [];
  const fetchImplementation = async (input, init = {}) => {
    const url = new URL(urlString(input));
    calls.push({
      url,
      headers: new Headers(init.headers),
      body: init.body,
    });
    if (url.pathname === "/v1/ai-quota") return grantedQuota();
    if (url.pathname === "/v1/broadcast-context") {
      return jsonResponse({
        schemaVersion: "1.7.0",
        broadcastSummaryKo: "테스트 방송 요약",
        annotations: [],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const request = createCurrentContextRequest();
  const { response } = await runContextSmoke({
    request,
    proxyOrigin: TEST_ORIGIN,
    identity: IDENTITY,
    fetchImplementation,
    sleep: async () => {},
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.pathname, "/v1/ai-quota");
  assert.equal(calls[1].url.pathname, "/v1/broadcast-context");
  const body = JSON.parse(calls[1].body);
  assert.equal(body.participantGrounding.status, "sealed");
  assert.equal(body.participantGrounding.schemaVersion, "1.2.0");
  assert.equal(body.castRosterId, null);
  assert.equal(body.outputLanguage, "ko");
  assert.equal(body.candidates[0].participantContextKo.length > 0, true);
  assert.equal(
    calls[1].headers.get("X-ExClipper-Quota-Payload-Digest"),
    sha256Digest(calls[1].body),
  );
});

test("context smoke starts a fresh generation after a validated provider shape failure", async () => {
  const operationIds = [];
  let contextRequestCount = 0;
  const fetchImplementation = async (input, init = {}) => {
    const url = new URL(urlString(input));
    if (url.pathname === "/v1/ai-quota") return grantedQuota();
    if (url.pathname === "/v1/broadcast-context") {
      operationIds.push(
        new Headers(init.headers).get("X-ExClipper-Quota-Operation"),
      );
      contextRequestCount += 1;
      return contextRequestCount === 1
        ? jsonResponse(
            { error: { code: "UPSTREAM_INVALID_RESPONSE" } },
            502,
          )
        : jsonResponse({
            schemaVersion: "1.7.0",
            broadcastSummaryKo: "복구된 테스트 방송 요약",
            annotations: [],
          });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const { response, generationCount } = await runContextSmoke({
    proxyOrigin: TEST_ORIGIN,
    identity: IDENTITY,
    fetchImplementation,
    sleep: async () => {},
  });

  assert.equal(response.status, 200);
  assert.equal(generationCount, 2);
  assert.equal(contextRequestCount, 2);
  assert.equal(operationIds.length, 2);
  assert.notEqual(operationIds[0], operationIds[1]);
  assert.match(operationIds[0], /\.generation-0\..*\.attempt-0$/u);
  assert.match(operationIds[1], /\.generation-1\..*\.attempt-0$/u);
});

test("candidate smoke stages one WAV plus four frames, resolves with context, and verifies cleanup", async () => {
  const calls = [];
  let resolveCount = 0;
  const wav = Buffer.alloc(60, 5);
  const frames = [100, 300, 600, 900].map((timestampMs, index) => ({
    timestampMs,
    bytes: Buffer.from([0xff, 0xd8, index, 0xff, 0xd9]),
  }));
  const fetchImplementation = async (input, init = {}) => {
    const url = new URL(urlString(input));
    calls.push({
      url,
      headers: new Headers(init.headers),
      body:
        init.body instanceof Uint8Array
          ? Buffer.from(init.body)
          : typeof init.body === "string"
            ? init.body
            : null,
    });
    if (url.pathname === "/v1/ai-quota") return grantedQuota();
    if (url.pathname === "/v1/candidate-insight-media" && init.method === "POST") {
      return jsonResponse(
        {
          schemaVersion: "1.0.0",
          status: "staged",
          mediaTicket: CANDIDATE_TICKET,
          expiresAtMs: Date.now() + 60_000,
          candidateHash: url.searchParams.get("candidateHash"),
          candidateDurationMs: 1_000,
          frameCount: 4,
        },
        202,
      );
    }
    if (url.pathname === "/v1/candidate-insights") {
      resolveCount += 1;
      return resolveCount === 1
        ? jsonResponse(
            { error: { code: "UPSTREAM_INVALID_RESPONSE" } },
            502,
          )
        : jsonResponse({ clipDecision: "recommend" });
    }
    if (url.pathname === "/v1/candidate-insight-media") {
      return new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const { response, candidateHash, generationCount } = await runCandidateSmoke({
    wav,
    frames,
    candidateDurationMs: 1_000,
    proxyOrigin: TEST_ORIGIN,
    identity: IDENTITY,
    fetchImplementation,
    sleep: async () => {},
  });

  assert.equal(response.status, 200);
  assert.equal(generationCount, 2);
  assert.equal(resolveCount, 2);
  assert.match(candidateHash, /^[a-f0-9]{24}$/u);
  assert.deepEqual(
    calls.map(({ url }) => url.pathname),
    [
      "/v1/ai-quota",
      "/v1/candidate-insight-media",
      "/v1/candidate-insights",
      "/v1/ai-quota",
      "/v1/candidate-insights",
      "/v1/candidate-insight-media",
    ],
  );
  const stage = calls[1];
  const resolve = calls[2];
  assert.equal(stage.headers.get("Content-Type"), CANDIDATE_BUNDLE_CONTENT_TYPE);
  assert.equal(resolve.headers.get("Content-Type"), CANDIDATE_RESOLVE_CONTENT_TYPE);
  assert.equal(stage.url.searchParams.get("audioBytes"), String(wav.byteLength));
  assert.equal(stage.url.searchParams.get("f3t"), "900");
  assert.equal(
    stage.headers.get("X-ExClipper-Quota-Payload-Digest"),
    sha256Digest(stage.body),
  );
  const resolveBody = JSON.parse(resolve.body);
  assert.equal(resolveBody.mediaTicket, CANDIDATE_TICKET);
  assert.equal(resolveBody.context.schemaVersion, "1.0.0");
  assert.equal(resolveBody.context.contextDecision, "review");
  assert.equal(resolveBody.context.contextCategory, "context-dependent");
  assert.notEqual(
    calls[2].headers.get("X-ExClipper-Quota-Operation"),
    calls[4].headers.get("X-ExClipper-Quota-Operation"),
  );
  assert.equal(calls[5].url.searchParams.get("part"), "audio");
});
