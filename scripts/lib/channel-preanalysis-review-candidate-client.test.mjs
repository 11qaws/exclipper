import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createCandidatePassBContextPacket } from "../../src/analysis/candidateFinalVerification.ts";
import { encodeCandidatePassBPcm16Wav } from "../../src/analysis/candidatePassBGemini.ts";
import {
  CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
  CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
  createCandidateInsightMediaSemanticPayloadDigest,
} from "../../src/analysis/candidateInsightMediaProtocol.ts";
import {
  CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER,
  CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
} from "../../src/analysis/candidatePassBWorkerProtocol.ts";
import { AMORETTO_CHANNEL_PREANALYSIS_SOURCE } from "../../src/analysis/channelPreanalysisSources.ts";
import { candidatePassBCastRosterIdForYouTubeChannelId } from "../../src/analysis/participantRoster.ts";
import {
  PREANALYSIS_CANDIDATE_EXPECTED_MODEL_ID,
  PREANALYSIS_CANDIDATE_EXPECTED_MODEL_REVISION,
  PREANALYSIS_CANDIDATE_MEDIA_DIGEST_HEADER,
  PREANALYSIS_CANDIDATE_MEDIA_ENDPOINT_PATH,
  PREANALYSIS_CONTEXT_ATTEMPT_HEADER,
  PREANALYSIS_CONTEXT_CACHE_HEADER,
  PREANALYSIS_CONTEXT_CONTRACT_HEADER,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_OPERATION_HEADER,
  PREANALYSIS_CONTEXT_ORIGIN,
  PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER,
  PREANALYSIS_CONTEXT_PROXY_VERSION,
  PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER,
  PREANALYSIS_CONTEXT_TRANSPORT_DIGEST_HEADER,
  createPreanalysisCandidateOperationId,
} from "../../src/cloudflare/preanalysisContextProxy.worker.ts";
import {
  ChannelPreanalysisReviewCandidateClientError,
  createChannelPreanalysisReviewCandidateAnalyzer,
} from "./channel-preanalysis-review-candidate-client.mjs";

const ENDPOINT = "https://preanalysis.example/v1/candidate-insights";
const TOKEN = "scheduled-candidate-token-123456789";
const VIDEO_ID = "KzAW3yow80Q";
const SOURCE_DURATION_MS = 2 * 60 * 60_000;
const CANDIDATE_DURATION_MS = 30_000;
const MEDIA_TICKET = `v1.${"a".repeat(64)}.${"b".repeat(64)}`;
const RENEWED_MEDIA_TICKET = `v1.${"c".repeat(64)}.${"d".repeat(64)}`;
const CAST_ROSTER_ID = candidatePassBCastRosterIdForYouTubeChannelId(
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE.channelId,
);

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function context() {
  const value = createCandidatePassBContextPacket({
    transcriptSource: "youtube-caption",
    transcriptKo: "드디어 성공했고 모두가 웃었다.",
    beforeContextKo: "앞서 여러 번 실패한 뒤 다시 도전하고 있었다.",
    afterContextKo: "성공을 확인한 뒤 다음 이야기로 넘어갔다.",
    broadcastSummaryKo: "음식 이야기를 나누며 여러 도전을 이어 간 방송이다.",
    topicContextKo: "반복 실패 끝에 조용히 성공한 흐름이다.",
    fastEvidenceKo: "성공 직후 목소리의 긴장이 풀리고 웃음이 이어졌다.",
    contextDecision: "select",
    contextCategory: "quiet-achievement",
    contextVerdictKo: "앞선 실패가 누적되어 성공의 의미가 분명한 후보이다.",
    chatReactionKo: null,
  });
  assert.notEqual(value, null);
  return value;
}

function jpegFrame(timestampMs, marker) {
  const bytes = Buffer.from([0xff, 0xd8, marker, 0xff, 0xd9]);
  return Object.freeze({
    timestampMs,
    mimeType: "image/jpeg",
    byteLength: bytes.byteLength,
    contentDigest: digest(bytes),
    extractionRevision: CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
    dataBase64: bytes.toString("base64"),
  });
}

let cachedAudio = null;
function audio() {
  if (cachedAudio !== null) return cachedAudio;
  const bytes = Buffer.from(
    encodeCandidatePassBPcm16Wav(
      new Float32Array((CANDIDATE_DURATION_MS * CANDIDATE_PASS_B_SAMPLE_RATE_HZ) / 1_000),
      CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
    ),
  );
  cachedAudio = Object.freeze({
    mimeType: "audio/wav",
    bytes,
    byteLength: bytes.byteLength,
    dataByteLength: bytes.byteLength - 44,
    sampleCount: (bytes.byteLength - 44) / 2,
    sampleRateHz: CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
    contentDigest: digest(bytes),
  });
  return cachedAudio;
}

function analysisPayload(overrides = {}) {
  const candidate = Object.freeze({
    candidateId: "scheduled-candidate-1",
    startMs: 60_000,
    endMs: 90_000,
    focusMs: 75_000,
  });
  const candidateContext = context();
  return {
    candidate,
    context: candidateContext,
    evidence: { candidateId: candidate.candidateId, cues: [] },
    frames: [
      jpegFrame(1_000, 1),
      jpegFrame(10_000, 2),
      jpegFrame(16_000, 3),
      jpegFrame(29_000, 4),
    ],
    audio: audio(),
    broadcastContext: {
      schemaVersion: "3.0.0",
      broadcastSummaryKo: candidateContext.broadcastSummaryKo,
      semanticChaptersSupported: true,
      discoveredLeadsSupported: true,
    },
    participantGrounding: {
      schemaVersion: "1.2.0",
      status: "sealed",
      sourceDurationMs: SOURCE_DURATION_MS,
      castRosterId: CAST_ROSTER_ID,
    },
    semanticAttempt: {
      attemptOrdinal: 0,
      retryGrantId: null,
    },
    ...overrides,
  };
}

function modelAnalysis() {
  return {
    segments: [
      { relativeStartMs: 13_000, relativeEndMs: 17_000, text: "됐다, 드디어 성공했어!" },
    ],
    eventSummaryKo: "여러 차례 실패했던 도전을 마침내 성공하자 스트리머가 결과를 확인하고 안도하며 웃는 장면이다.",
    reactionSummaryKo: "결과를 확인한 직후 긴장이 풀린 목소리로 성공을 외치고 짧게 웃는다.",
    whyGoodClipKo: "앞선 실패가 전체 방송 맥락에 쌓여 있어 조용한 성공도 분명한 결말과 반응을 가진다.",
    uncertaintiesKo: ["화면의 작은 글자는 원본 재생으로 확인할 필요가 있다."],
    participantPresence: "present-unidentified",
    participantSummaryKo: "스트리머의 목소리는 들리지만 제공된 화면만으로 고유 이름은 확인되지 않는다.",
    identifiedParticipants: [],
    clipDecision: "recommend",
    contextConsistency: "consistent",
    programMaterial: "streamer-event",
  };
}

function successResponse(headers = {}) {
  return new Response(JSON.stringify({
    candidates: [{
      finishReason: "STOP",
      content: { parts: [{ text: JSON.stringify(modelAnalysis()) }] },
    }],
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      [PREANALYSIS_CONTEXT_CONTRACT_HEADER]: PREANALYSIS_CONTEXT_PROXY_VERSION,
      [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
      [PREANALYSIS_CONTEXT_MODEL_ID_HEADER]: CANDIDATE_PASS_B_QWEN_MODEL_ID,
      [PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER]: CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
      [PREANALYSIS_CONTEXT_CACHE_HEADER]: "miss",
      [PREANALYSIS_CONTEXT_ATTEMPT_HEADER]: "1",
      [CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER]: "false",
      ...headers,
    },
  });
}

function stagedResponse(
  url,
  mediaTicket = MEDIA_TICKET,
  expiresAtMs = Date.now() + 15 * 60_000,
  contentType = "application/json",
) {
  const parsed = new URL(url);
  return new Response(JSON.stringify({
    schemaVersion: "1.0.0",
    status: "staged",
    mediaTicket,
    expiresAtMs,
    candidateHash: parsed.searchParams.get("candidateHash"),
    candidateDurationMs: Number(parsed.searchParams.get("durationMs")),
    frameCount: 4,
  }), {
    status: 202,
    headers: {
      "Content-Type": contentType,
      [PREANALYSIS_CONTEXT_CONTRACT_HEADER]: PREANALYSIS_CONTEXT_PROXY_VERSION,
    },
  });
}

function isMediaStageUrl(url) {
  return new URL(url).pathname === PREANALYSIS_CANDIDATE_MEDIA_ENDPOINT_PATH;
}

function errorResponse(status, code, retryAfter = null) {
  return new Response(JSON.stringify({ error: { code, message: "redacted" } }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(retryAfter === null ? {} : { "Retry-After": retryAfter }),
    },
  });
}

function createAnalyzer(fetchImplementation, overrides = {}) {
  return createChannelPreanalysisReviewCandidateAnalyzer({
    endpointUrl: ENDPOINT,
    authorizationToken: TOKEN,
    sourceId: AMORETTO_CHANNEL_PREANALYSIS_SOURCE.sourceId,
    channelId: AMORETTO_CHANNEL_PREANALYSIS_SOURCE.channelId,
    videoId: VIDEO_ID,
    sourceDurationMs: SOURCE_DURATION_MS,
    artifactRevision: 1,
    pipelineRevision: "scheduled-review-v1",
    castRosterId: CAST_ROSTER_ID,
    fetchImplementation,
    sleepImplementation: async () => {},
    ...overrides,
  });
}

test("stages exact binary media and seals a runner-compatible receipt", async () => {
  const observed = [];
  const analyze = createAnalyzer(async (url, init) => {
    observed.push({ url, init });
    if (isMediaStageUrl(url)) return stagedResponse(url);
    return successResponse();
  });

  const payload = analysisPayload();
  const result = await analyze(payload);
  assert.equal(observed.length, 2);
  const stage = observed[0];
  const request = observed[1];
  assert.equal(new URL(stage.url).pathname, PREANALYSIS_CANDIDATE_MEDIA_ENDPOINT_PATH);
  assert.equal(request.url, ENDPOINT);
  const stageHeaders = new Headers(stage.init.headers);
  assert.equal(
    stageHeaders.get("Content-Type"),
    CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
  );
  assert.equal(
    stageHeaders.get(PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER),
    digest(stage.init.body),
  );
  assert.equal(
    Number(stageHeaders.get("Content-Length")),
    audio().byteLength + payload.frames.reduce((total, frame) => total + frame.byteLength, 0),
  );
  const headers = new Headers(request.init.headers);
  const requestBody = request.init.body;
  const transportDigest = digest(Buffer.from(requestBody, "utf8"));
  const mediaPayloadDigest = digest(stage.init.body);
  const candidateHash = new URL(stage.url).searchParams.get("candidateHash");
  const semanticPayloadDigest =
    await createCandidateInsightMediaSemanticPayloadDigest({
      mediaPayloadDigest,
      candidateHash,
      candidateDurationMs: CANDIDATE_DURATION_MS,
      audioByteLength: audio().byteLength,
      frames: payload.frames.map(({ timestampMs, byteLength }) => ({
        timestampMs,
        byteLength,
      })),
      castRosterId: CAST_ROSTER_ID,
      outputLanguage: "ko",
      context: payload.context,
    });
  assert.equal(headers.get("Origin"), PREANALYSIS_CONTEXT_ORIGIN);
  assert.equal(headers.get("Authorization"), `Bearer ${TOKEN}`);
  assert.equal(
    headers.get("Content-Type"),
    CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
  );
  assert.equal(
    headers.get(PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER),
    semanticPayloadDigest,
  );
  assert.equal(
    headers.get(PREANALYSIS_CONTEXT_TRANSPORT_DIGEST_HEADER),
    transportDigest,
  );
  assert.equal(
    headers.get(PREANALYSIS_CANDIDATE_MEDIA_DIGEST_HEADER),
    mediaPayloadDigest,
  );
  assert.equal(
    headers.get(PREANALYSIS_CONTEXT_OPERATION_HEADER),
    await createPreanalysisCandidateOperationId(semanticPayloadDigest),
  );
  assert.equal(
    stageHeaders.get(PREANALYSIS_CONTEXT_OPERATION_HEADER),
    headers.get(PREANALYSIS_CONTEXT_OPERATION_HEADER),
  );
  assert.equal(
    headers.get(PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER),
    PREANALYSIS_CANDIDATE_EXPECTED_MODEL_ID,
  );
  assert.equal(
    headers.get(PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER),
    PREANALYSIS_CANDIDATE_EXPECTED_MODEL_REVISION,
  );
  assert.equal(headers.has("x-goog-api-key"), false);
  assert.equal(headers.has("X-DashScope-API-Key"), false);

  const body = JSON.parse(requestBody);
  assert.equal(body.mediaTicket, MEDIA_TICKET);
  assert.equal(Object.hasOwn(body, "audioBase64"), false);
  assert.equal(Object.hasOwn(body, "videoFrames"), false);
  assert.equal(result.impactThumbnailIndex, 2);
  assert.equal(result.verificationReceipt.thumbnailTimestampMs, 16_000);
  assert.equal(result.verificationReceipt.candidateId, payload.candidate.candidateId);
  assert.equal(result.verificationReceipt.sourceStartMs, payload.candidate.startMs);
  assert.equal(result.verificationReceipt.sourceEndMs, payload.candidate.endMs);
  assert.equal(result.verificationReceipt.dispatchIntent.mediaReceipt.audio.kind, "verified-no-speech");
  assert.equal(
    result.verificationReceipt.dispatchIntent.operationId,
    headers.get(PREANALYSIS_CONTEXT_OPERATION_HEADER),
  );
  assert.equal(result.model.id, CANDIDATE_PASS_B_QWEN_MODEL_ID);
  assert.equal(result.insight.clipDecision, "recommend");
});

test("retries network, in-progress, rate-limit and 5xx with the same exact operation", async () => {
  const calls = [];
  const delays = [];
  const responses = [
    new TypeError("network unavailable"),
    errorResponse(409, "OPERATION_IN_PROGRESS", "1"),
    errorResponse(429, "RATE_LIMITED", "2"),
    errorResponse(503, "UPSTREAM_UNAVAILABLE"),
    successResponse(),
  ];
  const analyze = createAnalyzer(async (url, init) => {
    if (isMediaStageUrl(url)) return stagedResponse(url);
    calls.push({ url, body: init.body, headers: new Headers(init.headers) });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  }, {
    maxAttempts: 6,
    sleepImplementation: async (delayMs) => { delays.push(delayMs); },
  });

  const result = await analyze(analysisPayload());
  assert.equal(result.insight.clipDecision, "recommend");
  assert.equal(calls.length, 5);
  assert.equal(new Set(calls.map(({ body }) => body)).size, 1);
  assert.equal(
    new Set(calls.map(({ headers }) => headers.get(PREANALYSIS_CONTEXT_OPERATION_HEADER))).size,
    1,
  );
  assert.equal(
    new Set(calls.map(({ headers }) => headers.get(PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER))).size,
    1,
  );
  assert.equal(
    new Set(calls.map(({ headers }) => headers.get(PREANALYSIS_CONTEXT_TRANSPORT_DIGEST_HEADER))).size,
    1,
  );
  assert.deepEqual(delays, [1_000, 1_000, 2_000, 8_000]);
});

test("semantic recovery attempts get fresh operations while an exact resume keeps its operation", async () => {
  const stages = [];
  const resolves = [];
  const analyze = createAnalyzer(async (url, init) => {
    if (isMediaStageUrl(url)) {
      stages.push({ url, headers: new Headers(init.headers) });
      return stagedResponse(url);
    }
    resolves.push({ headers: new Headers(init.headers), body: init.body });
    return successResponse();
  });
  const grant1 = "scheduled-semantic-1-test-grant";
  const grant2 = "scheduled-semantic-2-test-grant";
  const results = [];
  results.push(await analyze(analysisPayload()));
  results.push(await analyze(analysisPayload({
    semanticAttempt: { attemptOrdinal: 1, retryGrantId: grant1 },
  })));
  results.push(await analyze(analysisPayload({
    semanticAttempt: { attemptOrdinal: 1, retryGrantId: grant1 },
  })));
  results.push(await analyze(analysisPayload({
    semanticAttempt: { attemptOrdinal: 2, retryGrantId: grant2 },
  })));

  const operationIds = resolves.map(({ headers }) =>
    headers.get(PREANALYSIS_CONTEXT_OPERATION_HEADER));
  const candidateHashes = stages.map(({ url }) =>
    new URL(url).searchParams.get("candidateHash"));
  assert.equal(new Set([operationIds[0], operationIds[1], operationIds[3]]).size, 3);
  assert.equal(operationIds[1], operationIds[2]);
  assert.equal(new Set([candidateHashes[0], candidateHashes[1], candidateHashes[3]]).size, 3);
  assert.equal(candidateHashes[1], candidateHashes[2]);
  assert.equal(
    new Set(results.map(({ verificationReceipt }) =>
      verificationReceipt.dispatchIntent.mediaReceipt.providerPayloadDigest)).size,
    1,
  );
  assert.deepEqual(
    results.map(({ verificationReceipt }) => ({
      attemptOrdinal: verificationReceipt.dispatchIntent.attemptOrdinal,
      retryGrantId: verificationReceipt.dispatchIntent.retryGrantId,
    })),
    [
      { attemptOrdinal: 0, retryGrantId: null },
      { attemptOrdinal: 1, retryGrantId: grant1 },
      { attemptOrdinal: 1, retryGrantId: grant1 },
      { attemptOrdinal: 2, retryGrantId: grant2 },
    ],
  );
});

test("rejects a malformed semantic attempt before staging media", async () => {
  let callCount = 0;
  const analyze = createAnalyzer(async () => {
    callCount += 1;
    return successResponse();
  });

  await assert.rejects(
    analyze(analysisPayload({
      semanticAttempt: { attemptOrdinal: 1, retryGrantId: null },
    })),
    (error) =>
      error instanceof ChannelPreanalysisReviewCandidateClientError &&
      error.code === "INVALID_IDENTITY",
  );
  assert.equal(callCount, 0);
});

test("renews an expired media capability without changing the paid operation", async () => {
  const stages = [];
  const resolves = [];
  let stageCount = 0;
  const analyze = createAnalyzer(async (url, init) => {
    if (isMediaStageUrl(url)) {
      stages.push({ url, headers: new Headers(init.headers) });
      const ticket = stageCount === 0 ? MEDIA_TICKET : RENEWED_MEDIA_TICKET;
      stageCount += 1;
      return stagedResponse(url, ticket);
    }
    resolves.push({ body: init.body, headers: new Headers(init.headers) });
    return successResponse();
  });

  const payload = analysisPayload();
  await analyze(payload);
  await analyze(payload);

  assert.equal(stages.length, 2);
  assert.equal(resolves.length, 2);
  assert.notEqual(resolves[0].body, resolves[1].body);
  assert.equal(
    resolves[0].headers.get(PREANALYSIS_CONTEXT_OPERATION_HEADER),
    resolves[1].headers.get(PREANALYSIS_CONTEXT_OPERATION_HEADER),
  );
  assert.equal(
    resolves[0].headers.get(PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER),
    resolves[1].headers.get(PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER),
  );
  assert.notEqual(
    resolves[0].headers.get(PREANALYSIS_CONTEXT_TRANSPORT_DIGEST_HEADER),
    resolves[1].headers.get(PREANALYSIS_CONTEXT_TRANSPORT_DIGEST_HEADER),
  );
  for (let index = 0; index < resolves.length; index += 1) {
    assert.equal(
      resolves[index].headers.get(PREANALYSIS_CONTEXT_TRANSPORT_DIGEST_HEADER),
      digest(Buffer.from(resolves[index].body, "utf8")),
    );
    assert.equal(
      stages[index].headers.get(PREANALYSIS_CONTEXT_OPERATION_HEADER),
      resolves[index].headers.get(PREANALYSIS_CONTEXT_OPERATION_HEADER),
    );
  }
});

test("fails closed on expired or incorrectly typed staging receipts", async () => {
  for (const response of [
    (url) => stagedResponse(url, MEDIA_TICKET, Date.now() - 1),
    (url) => stagedResponse(
      url,
      MEDIA_TICKET,
      Date.now() + 15 * 60_000,
      "text/plain",
    ),
  ]) {
    let resolveCalls = 0;
    const analyze = createAnalyzer(async (url) => {
      if (isMediaStageUrl(url)) return response(url);
      resolveCalls += 1;
      return successResponse();
    });

    await assert.rejects(
      analyze(analysisPayload()),
      (error) =>
        error instanceof ChannelPreanalysisReviewCandidateClientError &&
        error.code === "RESPONSE_RECEIPT_INVALID",
    );
    assert.equal(resolveCalls, 0);
  }
});

test("fails closed on a permanent operation conflict", async () => {
  let callCount = 0;
  const analyze = createAnalyzer(async (url) => {
    callCount += 1;
    if (isMediaStageUrl(url)) return stagedResponse(url);
    return errorResponse(409, "OPERATION_PAYLOAD_CONFLICT");
  });

  await assert.rejects(
    analyze(analysisPayload()),
    (error) => error instanceof ChannelPreanalysisReviewCandidateClientError &&
      error.code === "HTTP_REJECTED" && error.attempts === 1,
  );
  assert.equal(callCount, 2);
});

test("rejects mismatched media before any paid request", async () => {
  let callCount = 0;
  const analyze = createAnalyzer(async () => {
    callCount += 1;
    return successResponse();
  });
  const payload = analysisPayload();
  const tampered = {
    ...payload,
    frames: payload.frames.map((frame, index) => index === 0
      ? { ...frame, contentDigest: `sha256:${"0".repeat(64)}` }
      : frame),
  };

  await assert.rejects(
    analyze(tampered),
    (error) => error instanceof ChannelPreanalysisReviewCandidateClientError &&
      error.code === "INVALID_MEDIA",
  );
  assert.equal(callCount, 0);
});

test("rejects stale provider model receipts without publishing a candidate receipt", async () => {
  const analyze = createAnalyzer(async (url) => isMediaStageUrl(url)
    ? stagedResponse(url)
    : successResponse({
        [PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER]: "stale-model-revision",
      }));

  await assert.rejects(
    analyze(analysisPayload()),
    (error) => error instanceof ChannelPreanalysisReviewCandidateClientError &&
      error.code === "RESPONSE_RECEIPT_INVALID",
  );
});
