import { createHash, randomBytes } from "node:crypto";

export const PRODUCTION_ORIGIN = "https://11qaws.github.io";
export const DEFAULT_PROXY_ORIGIN =
  "https://rettohighlight-gemini.11qaws.workers.dev";

export const TRANSCRIPT_ROUTE_HEADER =
  "X-ExClipper-Transcript-Route-Fingerprint";
export const TRANSCRIPT_RESOLVE_CONTENT_TYPE =
  "application/vnd.exclipper.transcript-media-resolve+json";
export const CANDIDATE_BUNDLE_CONTENT_TYPE =
  "application/vnd.exclipper.candidate-media-bundle";
export const CANDIDATE_RESOLVE_CONTENT_TYPE =
  "application/vnd.exclipper.candidate-media-resolve+json";

const QUOTA_SCHEMA_VERSION = "1.0.0";
const MEDIA_SCHEMA_VERSION = "1.0.0";
const MAX_RATE_LIMIT_RETRIES = 5;
const MAX_CONTEXT_SMOKE_GENERATIONS = 3;
const MAX_CANDIDATE_SMOKE_GENERATIONS = 3;
const TRANSCRIPT_ROUTE_DOMAIN = "exclipper.broadcast-transcript-route.v2";
const NO_STORE_FETCH_POLICY = Object.freeze({
  credentials: "omit",
  cache: "no-store",
  referrerPolicy: "no-referrer",
});

const TRANSCRIPT_MODEL_IDENTITIES = Object.freeze({
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
      "groq-whisper-large-v3-turbo-ko-segment-v1-2026-07-29",
  },
});

class SmokeContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "SmokeContractError";
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value, expectedKeys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function boundedJson(value, label) {
  if (!isRecord(value)) {
    throw new SmokeContractError(`${label} did not return a JSON object.`);
  }
  return value;
}

export function sha256Digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function lengthDelimited(parts) {
  return parts.map((part) => `${part.length}:${part}`).join("|");
}

export function contentFingerprint(parts) {
  return sha256Digest(lengthDelimited(parts));
}

export function stableCandidateHash(candidateId) {
  return createHash("sha256").update(candidateId, "utf8").digest("hex").slice(0, 24);
}

export function createSmokeIdentity(prefix) {
  const nonce = randomBytes(18).toString("hex");
  return {
    participantId: `smoke_${nonce}`,
    runId: `smoke-run-${Date.now()}-${nonce.slice(0, 8)}`,
    operationId: `${prefix}-${Date.now()}-${nonce.slice(0, 8)}`,
  };
}

function normalizeOperationId(value) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._:-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 128);
  if (normalized.length === 0) {
    throw new Error("Smoke operation ID is invalid.");
  }
  return normalized;
}

function attemptOperationId(baseOperationId, payloadDigest, attempt) {
  const suffix = `.${payloadDigest.slice("sha256:".length, 19)}.attempt-${attempt}`;
  return `${baseOperationId.slice(0, 160 - suffix.length)}${suffix}`;
}

function quotaHeaders(identity, leaseToken) {
  return {
    "X-ExClipper-Quota-Participant": identity.participantId,
    "X-ExClipper-Quota-Run": identity.runId,
    "X-ExClipper-Quota-Operation": identity.operationId,
    "X-ExClipper-Quota-Payload-Digest": identity.payloadDigest,
    "X-ExClipper-Quota-Lease": leaseToken,
  };
}

async function readJson(response, label) {
  let value;
  try {
    value = await response.json();
  } catch {
    throw new SmokeContractError(
      `${label} returned invalid JSON (HTTP ${response.status}).`,
    );
  }
  return boundedJson(value, label);
}

function retryAfterMilliseconds(response) {
  const value = response.headers.get("Retry-After");
  if (value === null || !/^\d{1,3}$/u.test(value)) return 1_000;
  return Math.min(60_000, Math.max(1_000, Number(value) * 1_000));
}

async function isRetryableRateLimit(response) {
  if (response.status !== 429) return false;
  try {
    const payload = await response.clone().json();
    return (
      payload?.error?.code === "RATE_LIMITED" ||
      payload?.error?.code === "UPSTREAM_RATE_LIMITED"
    );
  } catch {
    return false;
  }
}

async function isRetryableInvalidResponse(response) {
  if (response.status !== 502) return false;
  try {
    return (
      (await response.clone().json())?.error?.code ===
      "UPSTREAM_INVALID_RESPONSE"
    );
  } catch {
    return false;
  }
}

async function acquireQuotaLease({
  proxyOrigin,
  identity,
  fetchImplementation,
  sleep,
}) {
  const quotaUrl = new URL("/v1/ai-quota", proxyOrigin);
  while (true) {
    const response = await fetchImplementation(quotaUrl, {
      method: "POST",
      ...NO_STORE_FETCH_POLICY,
      headers: {
        "Content-Type": "application/json",
        Origin: PRODUCTION_ORIGIN,
      },
      body: JSON.stringify({
        schemaVersion: QUOTA_SCHEMA_VERSION,
        action: "lease",
        ...identity,
      }),
    });
    const payload = await readJson(response, "AI quota coordinator");
    if (!response.ok) {
      throw new Error(
        `AI quota coordinator rejected the smoke (HTTP ${response.status}, ${payload?.error?.code ?? "UNKNOWN"}).`,
      );
    }
    if (
      payload.status === "granted" &&
      typeof payload.leaseToken === "string" &&
      /^[A-Za-z0-9_-]{32,128}$/u.test(payload.leaseToken)
    ) {
      return payload.leaseToken;
    }
    if (payload.status !== "queued" && payload.status !== "capacity-full") {
      throw new Error(`AI quota coordinator returned ${String(payload.status)}.`);
    }
    await sleep(
      Math.min(5_000, Math.max(75, Number(payload.retryAfterMs) || 1_000)),
    );
  }
}

/**
 * Mirrors the browser quota client: one digest identifies the original
 * billable payload, while each explicit 429 retry receives a fresh operation.
 * A staged media ticket may stay captured by `execute` and be resolved again
 * without uploading the media twice.
 */
export async function runWithQuota({
  proxyOrigin = DEFAULT_PROXY_ORIGIN,
  pool,
  payload,
  identity = createSmokeIdentity(`${pool}-smoke`),
  execute,
  fetchImplementation = fetch,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
}) {
  const payloadDigest = sha256Digest(payload);
  const baseOperationId = normalizeOperationId(identity.operationId);
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    const attemptIdentity = {
      participantId: identity.participantId,
      runId: identity.runId,
      operationId: attemptOperationId(baseOperationId, payloadDigest, attempt),
      pool,
      payloadDigest,
    };
    const leaseToken = await acquireQuotaLease({
      proxyOrigin,
      identity: attemptIdentity,
      fetchImplementation,
      sleep,
    });
    const headers = quotaHeaders(attemptIdentity, leaseToken);

    let response;
    try {
      response = await execute(headers, attempt);
    } catch (error) {
      if (error instanceof SmokeContractError) throw error;
      // The production client replays the same lease once to repair an ingress
      // connection loss without creating a second billable operation.
      response = await execute(headers, attempt);
      if (response.status === 409) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(
          "Smoke outcome is unknown; a new paid operation was not created.",
          { cause: error },
        );
      }
    }
    const retryable = await isRetryableRateLimit(response);
    if (!retryable || attempt === MAX_RATE_LIMIT_RETRIES) return response;
    const delayMs = retryAfterMilliseconds(response);
    await response.body?.cancel().catch(() => undefined);
    await sleep(delayMs);
  }
  throw new Error("Smoke exhausted the bounded rate-limit retry loop.");
}

function normalizeTranscriptFallback(value, provider, transportMode) {
  if (isRecord(value) && exactKeys(value, ["mode"]) && value.mode === "disabled") {
    return { mode: "disabled" };
  }
  if (
    transportMode !== "paid-direct" ||
    !isRecord(value) ||
    !exactKeys(value, ["mode", "provider", "modelId", "modelRevision"]) ||
    value.mode !== "bounded" ||
    !Object.hasOwn(TRANSCRIPT_MODEL_IDENTITIES, value.provider) ||
    value.provider === provider
  ) {
    throw new Error("Health returned an invalid transcript fallback route.");
  }
  const expected = TRANSCRIPT_MODEL_IDENTITIES[value.provider];
  if (
    value.modelId !== expected.modelId ||
    value.modelRevision !== expected.modelRevision
  ) {
    throw new Error("Health returned an unknown transcript fallback identity.");
  }
  return {
    mode: "bounded",
    provider: value.provider,
    modelId: value.modelId,
    modelRevision: value.modelRevision,
  };
}

export function currentTranscriptRouteManifest(health) {
  if (
    !isRecord(health) ||
    health.ok !== true ||
    health.service !== "rettohighlight-gemini" ||
    health.version !== 6 ||
    health.routingPolicyVersion !== "1.11.0" ||
    !isRecord(health.transcriptTransport) ||
    health.transcriptTransport.version !== 3 ||
    !["free-r2", "paid-direct"].includes(health.transcriptTransport.mode) ||
    health.transcriptTransport.configured !== true ||
    health.transcriptTransport.primaryMediaType !== "audio/wav" ||
    health.transcriptTransport.maximumChunkDurationMs !== 90_000 ||
    health.transcriptTransport.stagedSchemaVersion !== MEDIA_SCHEMA_VERSION ||
    !isRecord(health.quota) ||
    health.quota.mode !== "required" ||
    health.quota.coordinatorReady !== true ||
    health.quota.maximumActiveParticipants !== 5 ||
    !isRecord(health.providers) ||
    health.providers.schemaVersion !== "1.3.0" ||
    !isRecord(health.providers.broadcastTranscript)
  ) {
    throw new Error("Health does not advertise the current transcript contract.");
  }
  const provider = health.providers.broadcastTranscript.selectedProvider;
  if (
    !Object.hasOwn(TRANSCRIPT_MODEL_IDENTITIES, provider) ||
    health.providers.broadcastTranscript.implementationStatus !== "active" ||
    health.providers.broadcastTranscript.configured !== true ||
    health.providers.broadcastTranscript.active !== true
  ) {
    throw new Error("Health does not advertise an active transcript provider.");
  }
  const identity = TRANSCRIPT_MODEL_IDENTITIES[provider];
  if (
    health.providers.broadcastTranscript.modelId !== identity.modelId ||
    health.providers.broadcastTranscript.modelRevision !== identity.modelRevision ||
    (health.transcriptTransport.mode === "free-r2" && provider === "gemini")
  ) {
    throw new Error("Health transcript provider identity is not current.");
  }
  return {
    schemaVersion: "1.1.0",
    serviceVersion: 6,
    routingPolicyVersion: "1.11.0",
    providerConfigurationVersion: "1.3.0",
    transportVersion: 3,
    transportMode: health.transcriptTransport.mode,
    maximumChunkDurationMs: 90_000,
    primaryMediaType: "audio/wav",
    provider,
    modelId: identity.modelId,
    modelRevision: identity.modelRevision,
    effectiveFallback: normalizeTranscriptFallback(
      health.transcriptTransport.effectiveFallback,
      provider,
      health.transcriptTransport.mode,
    ),
  };
}

export async function requestCurrentTranscriptRoute({
  proxyOrigin = DEFAULT_PROXY_ORIGIN,
  fetchImplementation = fetch,
}) {
  const response = await fetchImplementation(new URL("/healthz", proxyOrigin), {
    method: "GET",
    ...NO_STORE_FETCH_POLICY,
    headers: {
      Accept: "application/json",
      Origin: PRODUCTION_ORIGIN,
    },
  });
  if (!response.ok) {
    throw new Error(`Health rejected the transcript smoke (HTTP ${response.status}).`);
  }
  const manifest = currentTranscriptRouteManifest(
    await readJson(response, "Worker health"),
  );
  return {
    manifest,
    fingerprint: contentFingerprint([
      TRANSCRIPT_ROUTE_DOMAIN,
      JSON.stringify(manifest),
    ]),
  };
}

function validTranscriptTicket(value) {
  return (
    typeof value === "string" &&
    value.length >= 64 &&
    value.length <= 512 &&
    /^v2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(value)
  );
}

function validCandidateTicket(value) {
  return (
    typeof value === "string" &&
    value.length >= 64 &&
    value.length <= 1_024 &&
    /^[A-Za-z0-9._-]+$/u.test(value)
  );
}

async function requireDeletedCapability(response, label) {
  if (response.status === 404) return;
  await response.body?.cancel().catch(() => undefined);
  throw new Error(
    `${label} cleanup failed: capability remained readable (HTTP ${response.status}).`,
  );
}

export async function runTranscriptSmoke({
  wav,
  sourceStartMs,
  durationMs,
  proxyOrigin = DEFAULT_PROXY_ORIGIN,
  identity,
  fetchImplementation = fetch,
  sleep,
}) {
  const route = await requestCurrentTranscriptRoute({
    proxyOrigin,
    fetchImplementation,
  });
  const stageUrl = new URL("/v1/broadcast-transcript", proxyOrigin);
  stageUrl.searchParams.set("startMs", String(sourceStartMs));
  stageUrl.searchParams.set("durationMs", String(durationMs));
  let mediaTicket = null;
  const response = await runWithQuota({
    proxyOrigin,
    pool: "transcript",
    payload: wav,
    identity,
    fetchImplementation,
    sleep,
    execute: async (quotaLeaseHeaders) => {
      if (mediaTicket === null) {
        const staged = await fetchImplementation(stageUrl, {
          method: "POST",
          ...NO_STORE_FETCH_POLICY,
          headers: {
            ...quotaLeaseHeaders,
            [TRANSCRIPT_ROUTE_HEADER]: route.fingerprint,
            "Content-Type": "audio/wav",
            Origin: PRODUCTION_ORIGIN,
          },
          body: wav,
        });
        if (staged.status !== 202) return staged;
        const payload = await readJson(staged, "Transcript media stage");
        if (
          !exactKeys(payload, [
            "schemaVersion",
            "status",
            "mediaTicket",
            "expiresAtMs",
            "sourceStartMs",
            "sourceEndMs",
          ]) ||
          payload.schemaVersion !== MEDIA_SCHEMA_VERSION ||
          payload.status !== "staged" ||
          !validTranscriptTicket(payload.mediaTicket) ||
          !Number.isSafeInteger(payload.expiresAtMs) ||
          payload.expiresAtMs <= Date.now() ||
          payload.sourceStartMs !== sourceStartMs ||
          payload.sourceEndMs !== sourceStartMs + durationMs
        ) {
          throw new SmokeContractError(
            "Transcript media stage returned an invalid current ticket.",
          );
        }
        mediaTicket = payload.mediaTicket;
      }
      return fetchImplementation(new URL("/v1/broadcast-transcript", proxyOrigin), {
        method: "POST",
        ...NO_STORE_FETCH_POLICY,
        headers: {
          ...quotaLeaseHeaders,
          [TRANSCRIPT_ROUTE_HEADER]: route.fingerprint,
          "Content-Type": TRANSCRIPT_RESOLVE_CONTENT_TYPE,
          Origin: PRODUCTION_ORIGIN,
        },
        body: JSON.stringify({
          schemaVersion: MEDIA_SCHEMA_VERSION,
          mediaTicket,
        }),
      });
    },
  });
  if (response.ok && mediaTicket !== null) {
    const cleanupUrl = new URL("/v1/broadcast-transcript-media", proxyOrigin);
    cleanupUrl.searchParams.set("mediaTicket", mediaTicket);
    await requireDeletedCapability(
      await fetchImplementation(cleanupUrl, {
        method: "GET",
        ...NO_STORE_FETCH_POLICY,
        headers: { Origin: PRODUCTION_ORIGIN },
      }),
      "Transcript media",
    );
  }
  return { response, route, mediaTicket };
}

export function createCurrentContextRequest() {
  const sourceDurationMs = 60_000;
  const chapter = {
    chapterId: "chapter-1",
    startMs: 0,
    endMs: sourceDurationMs,
    evidenceMode: "complete-transcript",
    evidenceCoverageRatio: 1,
    summaryKo:
      "스트리머가 작은 실수를 인정하고 시청자에게 상황을 차분하게 설명한 뒤 방송을 이어간다.",
  };
  return {
    sourceDurationMs,
    chapters: [chapter],
    candidates: [
      {
        candidateId: "candidate-1",
        startMs: 10_000,
        endMs: 55_000,
        transcriptKo: "제가 실수했습니다. 상황을 설명하고 바로잡겠습니다.",
        eventSummaryKo: "스트리머가 방송 중 발생한 실수를 직접 인정한다.",
        reactionSummaryKo: "당황했지만 차분하게 경위를 설명하고 수습한다.",
        participantContextKo:
          "화면과 음성만으로 정확한 이름은 확인하지 못했으며 주 진행자로 보이는 인물이 말한다.",
        chatReactionSummaryKo: null,
      },
    ],
    castRosterId: null,
    participantGrounding: {
      schemaVersion: "1.2.0",
      status: "sealed",
      resolutionStatus: "no-source-roster",
      sourceDurationMs,
      castRosterId: null,
      catalogVersion: "1.3.0",
      transcriptSourceChapterIds: [chapter.chapterId],
      adapterReceipts: [
        {
          adapter: "transcript-names",
          revision: "transcript-name-grounding-v1",
          status: "completed",
          inputCount: 1,
          processedCount: 1,
          unavailableReason: null,
        },
        {
          adapter: "visual-identity",
          revision: "visual-identity-not-configured-v1",
          status: "unavailable",
          inputCount: 0,
          processedCount: 0,
          unavailableReason: "no-verified-reference-manifest",
        },
        {
          adapter: "voice-identity",
          revision: "voice-identity-not-configured-v1",
          status: "unavailable",
          inputCount: 0,
          processedCount: 0,
          unavailableReason: "no-verified-reference-manifest",
        },
      ],
      participants: [],
      evidence: [],
    },
    outputLanguage: "ko",
  };
}

export async function runContextSmoke({
  request = createCurrentContextRequest(),
  proxyOrigin = DEFAULT_PROXY_ORIGIN,
  identity,
  fetchImplementation = fetch,
  sleep,
}) {
  const body = JSON.stringify(request);
  const baseIdentity = identity ?? createSmokeIdentity("context-smoke");
  for (
    let generation = 0;
    generation < MAX_CONTEXT_SMOKE_GENERATIONS;
    generation += 1
  ) {
    const response = await runWithQuota({
      proxyOrigin,
      pool: "context",
      payload: body,
      identity: {
        ...baseIdentity,
        operationId: `${baseIdentity.operationId}.generation-${generation}`,
      },
      fetchImplementation,
      sleep,
      execute: (quotaLeaseHeaders) =>
        fetchImplementation(new URL("/v1/broadcast-context", proxyOrigin), {
          method: "POST",
          ...NO_STORE_FETCH_POLICY,
          headers: {
            ...quotaLeaseHeaders,
            "Content-Type": "application/json",
            Origin: PRODUCTION_ORIGIN,
          },
          body,
        }),
    });
    const retryableInvalidResponse =
      await isRetryableInvalidResponse(response);
    if (
      !retryableInvalidResponse ||
      generation + 1 === MAX_CONTEXT_SMOKE_GENERATIONS
    ) {
      return { response, request, generationCount: generation + 1 };
    }
    await response.body?.cancel().catch(() => undefined);
    await (sleep ?? ((delayMs) =>
      new Promise((resolve) => setTimeout(resolve, delayMs))))(
      Math.min(1_000, 250 * 2 ** generation),
    );
  }
  throw new Error("Context smoke exhausted its current generation loop.");
}

export function createCurrentCandidateContext() {
  return {
    schemaVersion: "1.0.0",
    transcriptSource: "broadcast-transcript",
    transcriptKo:
      "스모크 검사는 후보 대사를 미리 단정하지 않는다. 첨부 오디오에서 실제 발화를 직접 확인한다.",
    beforeContextKo:
      "이 독립 전송 검사에는 후보 직전의 방송 흐름이 제공되지 않았다.",
    afterContextKo:
      "이 독립 전송 검사에는 후보 직후의 방송 흐름이 제공되지 않았다.",
    broadcastSummaryKo:
      "이 요청은 멀티모달 전송 계약을 확인하는 스모크 검사이며 방송 전체 내용은 제공하지 않는다.",
    topicContextKo: "전체 방송 주제를 확정하지 않은 독립 후보 검사",
    fastEvidenceKo:
      "첨부 오디오와 서로 다른 대표 화면 네 장만 실제 사건 근거로 사용할 수 있다.",
    contextDecision: "review",
    contextCategory: "context-dependent",
    contextVerdictKo:
      "전체 맥락이 없으므로 사건과 반응은 첨부 근거에서 확인하고 불확실성을 명시해야 한다.",
    chatReactionKo: null,
  };
}

export function createCandidateMediaBundle(wav, frames) {
  if (!Array.isArray(frames) || frames.length !== 4) {
    throw new Error("The current candidate contract requires exactly four frames.");
  }
  const frameByteLengths = frames.map((frame) => frame.bytes.byteLength);
  const bundle = Buffer.alloc(
    wav.byteLength + frameByteLengths.reduce((total, value) => total + value, 0),
  );
  Buffer.from(wav).copy(bundle, 0);
  let offset = wav.byteLength;
  for (const frame of frames) {
    Buffer.from(frame.bytes).copy(bundle, offset);
    offset += frame.bytes.byteLength;
  }
  return { bundle, frameByteLengths };
}

export async function runCandidateSmoke({
  wav,
  frames,
  candidateId = "smoke-candidate-1",
  candidateDurationMs,
  context = createCurrentCandidateContext(),
  proxyOrigin = DEFAULT_PROXY_ORIGIN,
  identity,
  fetchImplementation = fetch,
  sleep,
}) {
  const candidateHash = stableCandidateHash(candidateId);
  const { bundle, frameByteLengths } = createCandidateMediaBundle(wav, frames);
  const stageUrl = new URL("/v1/candidate-insight-media", proxyOrigin);
  stageUrl.searchParams.set("candidateHash", candidateHash);
  stageUrl.searchParams.set("durationMs", String(candidateDurationMs));
  stageUrl.searchParams.set("audioBytes", String(wav.byteLength));
  frames.forEach((frame, index) => {
    stageUrl.searchParams.set(`f${index}t`, String(frame.timestampMs));
    stageUrl.searchParams.set(`f${index}b`, String(frameByteLengths[index]));
  });
  let mediaTicket = null;
  const baseIdentity = identity ?? createSmokeIdentity("candidate-smoke");
  let finalResponse = null;
  let generationCount = 0;
  for (
    let generation = 0;
    generation < MAX_CANDIDATE_SMOKE_GENERATIONS;
    generation += 1
  ) {
    const response = await runWithQuota({
      proxyOrigin,
      pool: "candidate",
      payload: bundle,
      identity: {
        ...baseIdentity,
        operationId: `${baseIdentity.operationId}.generation-${generation}`,
      },
      fetchImplementation,
      sleep,
      execute: async (quotaLeaseHeaders) => {
        if (mediaTicket === null) {
          const staged = await fetchImplementation(stageUrl, {
            method: "POST",
            ...NO_STORE_FETCH_POLICY,
            headers: {
              ...quotaLeaseHeaders,
              "Content-Type": CANDIDATE_BUNDLE_CONTENT_TYPE,
              Origin: PRODUCTION_ORIGIN,
            },
            body: bundle,
          });
          if (staged.status !== 202) return staged;
          const payload = await readJson(staged, "Candidate media stage");
          if (
            !exactKeys(payload, [
              "schemaVersion",
              "status",
              "mediaTicket",
              "expiresAtMs",
              "candidateHash",
              "candidateDurationMs",
              "frameCount",
            ]) ||
            payload.schemaVersion !== MEDIA_SCHEMA_VERSION ||
            payload.status !== "staged" ||
            !validCandidateTicket(payload.mediaTicket) ||
            !Number.isSafeInteger(payload.expiresAtMs) ||
            payload.expiresAtMs <= Date.now() ||
            payload.candidateHash !== candidateHash ||
            payload.candidateDurationMs !== candidateDurationMs ||
            payload.frameCount !== 4
          ) {
            throw new SmokeContractError(
              "Candidate media stage returned an invalid current ticket.",
            );
          }
          mediaTicket = payload.mediaTicket;
        }
        return fetchImplementation(
          new URL("/v1/candidate-insights", proxyOrigin),
          {
            method: "POST",
            ...NO_STORE_FETCH_POLICY,
            headers: {
              ...quotaLeaseHeaders,
              "Content-Type": CANDIDATE_RESOLVE_CONTENT_TYPE,
              Origin: PRODUCTION_ORIGIN,
            },
            body: JSON.stringify({
              schemaVersion: MEDIA_SCHEMA_VERSION,
              mediaTicket,
              candidateDurationMs,
              castRosterId: null,
              outputLanguage: "ko",
              context,
            }),
          },
        );
      },
    });
    generationCount = generation + 1;
    finalResponse = response;
    const retryableInvalidResponse =
      await isRetryableInvalidResponse(response);
    if (
      !retryableInvalidResponse ||
      generationCount === MAX_CANDIDATE_SMOKE_GENERATIONS
    ) {
      break;
    }
    await response.body?.cancel().catch(() => undefined);
    await (sleep ?? ((delayMs) =>
      new Promise((resolve) => setTimeout(resolve, delayMs))))(
      Math.min(1_000, 250 * 2 ** generation),
    );
  }
  if (finalResponse === null) {
    bundle.fill(0);
    throw new Error("Candidate smoke exhausted its current generation loop.");
  }
  if (finalResponse.ok && mediaTicket !== null) {
    const cleanupUrl = new URL("/v1/candidate-insight-media", proxyOrigin);
    cleanupUrl.searchParams.set("mediaTicket", mediaTicket);
    cleanupUrl.searchParams.set("part", "audio");
    await requireDeletedCapability(
      await fetchImplementation(cleanupUrl, {
        method: "GET",
        ...NO_STORE_FETCH_POLICY,
        headers: { Origin: PRODUCTION_ORIGIN },
      }),
      "Candidate media",
    );
  }
  bundle.fill(0);
  return {
    response: finalResponse,
    candidateHash,
    mediaTicket,
    generationCount,
  };
}

export function currentSmokePlan(kind) {
  const common = {
    proxyOrigin: DEFAULT_PROXY_ORIGIN,
    productionOrigin: PRODUCTION_ORIGIN,
    quota: {
      method: "POST",
      path: "/v1/ai-quota",
      schemaVersion: QUOTA_SCHEMA_VERSION,
      maximumRateLimitRetries: MAX_RATE_LIMIT_RETRIES,
    },
  };
  if (kind === "transcript") {
    return {
      ...common,
      kind,
      steps: [
        "GET /healthz and pin the current transcript route fingerprint",
        "lease transcript quota against the raw WAV digest",
        "POST raw audio/wav to /v1/broadcast-transcript?startMs&durationMs",
        `POST ${TRANSCRIPT_RESOLVE_CONTENT_TYPE} with the staged ticket`,
        "GET the transcript capability and require 404 cleanup",
      ],
    };
  }
  if (kind === "candidate") {
    return {
      ...common,
      kind,
      steps: [
        "concatenate raw WAV and exactly four JPEG frames",
        "lease candidate quota against the binary bundle digest",
        `POST ${CANDIDATE_BUNDLE_CONTENT_TYPE} to /v1/candidate-insight-media`,
        `POST ${CANDIDATE_RESOLVE_CONTENT_TYPE} to /v1/candidate-insights`,
        "GET the candidate audio capability and require 404 cleanup",
      ],
    };
  }
  if (kind === "context") {
    return {
      ...common,
      kind,
      steps: [
        "build the current bounded context packet and sealed participant grounding",
        "lease context quota against the exact JSON body digest",
        "POST application/json to /v1/broadcast-context",
        "no media cleanup: context has no staged object",
      ],
    };
  }
  throw new Error(`Unknown smoke kind: ${String(kind)}`);
}
