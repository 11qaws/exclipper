import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AMORETTO_YOUTUBE_CHANNEL_FEED_URL,
  AMORETTO_YOUTUBE_CHANNEL_HANDLE,
  AMORETTO_YOUTUBE_CHANNEL_ID,
  YOUTUBE_CHANNEL_ATOM_FEED_MAX_BYTES,
  normalizeChannelVideoTitle,
} from "../src/analysis/channelPreanalysisCatalog.ts";
import {
  BROADCAST_CONTEXT_SCHEMA_VERSION,
  calculateCoverage,
} from "../src/analysis/broadcastContextProtocol.ts";
import { AI_BROADCAST_CONTEXT_ROUTING_REVISION } from "../src/analysis/aiModelRoutingPolicy.ts";
import {
  QWEN_CONTEXT_DISCOVERY_MODEL_ID,
  QWEN_CONTEXT_DISCOVERY_MODEL_REVISION,
  QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_ID,
  QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_REVISION,
} from "../src/cloudflare/aiProviderConfiguration.ts";
import {
  CHANNEL_PREANALYSIS_MANIFEST_MAX_BYTES as CLIENT_MANIFEST_MAX_BYTES,
  parseChannelPreanalysisManifest,
} from "../src/analysis/channelPreanalysisClient.ts";
import {
  createChannelPreanalysisVisualAnchorDescriptor,
  createChannelPreanalysisVisualFingerprint,
  serializeChannelPreanalysisVisualFingerprint,
} from "../src/analysis/channelPreanalysisVisualFingerprint.ts";
import {
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
} from "../src/analysis/channelPreanalysisSources.ts";
import {
  CHANNEL_PREANALYSIS_MANIFEST_MAX_BYTES,
  MAX_CAPTION_JSON3_BYTES,
  PINNED_YT_DLP_VERSION,
  PREANALYSIS_CONTEXT_CONTRACT_HEADER,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_ATTEMPT_HEADER,
  PREANALYSIS_CONTEXT_POSSIBLE_DUPLICATE_PROVIDER_CHARGE,
  PREANALYSIS_CONTEXT_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_OPERATION_HEADER,
  PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER,
  PREANALYSIS_CONTEXT_PROXY_VERSION,
  PREANALYSIS_CONTEXT_RETRY_RISK_HEADER,
  PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER,
  artifactForBundle,
  artifactForVisualFingerprint,
  createContextReadyBundle,
  createEmptyCatalog,
  classifyYtDlpFailure,
  createExpectedScheduledContextReceipt,
  createRetryCheckpoint,
  createScheduledAsrTranscriptReadyBundle,
  createScheduledContextRequest,
  createTranscriptReadyBundle,
  createYtDlpChildEnvironment,
  mergeFeedIntoCatalog,
  parseSyncArguments,
  reconcileReadyCatalogArtifacts,
  runBoundedCommand,
  selectDueCatalogVideos,
  serializeBundle,
  synchronizeAmorettoCatalog,
  requestScheduledBroadcastContext,
  validateYtDlpMetadata,
  verifyPersistedChannelCatalogSnapshot,
} from "./sync-amoretto-preanalysis.mjs";

const FOOD_TALK_ID = "KzAW3yow80Q";
const SUBSCRIPTION_ID = "EZfCGS5ms_Q";
const MINECRAFT_ID = "vadCuMEo5PQ";
const OLD_VIDEO_ID = "AbCdEfGhI_1";
const BASE_TIME = "2026-07-30T00:00:00.000Z";
const TEST_CONTEXT_TOKEN = "test-context-token-0123456789";

function video(overrides = {}) {
  const videoId = overrides.videoId ?? FOOD_TALK_ID;
  const title = overrides.title ?? "2026 07 17 - 음식 토크";
  return {
    channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
    videoId,
    title,
    normalizedTitle: normalizeChannelVideoTitle(title),
    durationMs: 8_114_000,
    publishedAt: "2026-07-17T04:00:00.000Z",
    updatedAt: "2026-07-17T09:30:00.000Z",
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    state: "discovered",
    revision: 1,
    artifactIds: [],
    registeredLocalSampledFingerprints: [],
    retry: null,
    ...overrides,
  };
}

function manifest(videos, artifacts = []) {
  return {
    schemaVersion: 1,
    channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
    channelHandle: AMORETTO_YOUTUBE_CHANNEL_HANDLE,
    revision: 7,
    generatedAt: BASE_TIME,
    videos,
    artifacts,
  };
}

function feedVideo(overrides = {}) {
  const current = video(overrides);
  return {
    channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
    videoId: current.videoId,
    title: current.title,
    normalizedTitle: current.normalizedTitle,
    publishedAt: current.publishedAt,
    updatedAt: current.updatedAt,
    watchUrl: current.watchUrl,
    durationMs: current.durationMs,
  };
}

function feed(videos) {
  return {
    channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
    channelTitle: "Amoretto VODs",
    feedUrl: AMORETTO_YOUTUBE_CHANNEL_FEED_URL,
    videos,
  };
}

function catalogArtifact(overrides = {}) {
  const videoId = overrides.videoId ?? FOOD_TALK_ID;
  return {
    artifactId: `youtube-caption-bundle:${videoId}:v1`,
    videoId,
    kind: "transcript",
    revision: 1,
    storageKey: `amoretto-vods/videos/${videoId}.v1.json`,
    contentDigest: `sha256:${"a".repeat(64)}`,
    byteLength: 512,
    createdAt: BASE_TIME,
    ...overrides,
  };
}

function assertCatalogInvalid(value) {
  assert.throws(
    () => parseChannelPreanalysisManifest(JSON.stringify(value)),
    (error) => error?.code === "INVALID_MANIFEST",
  );
  assert.throws(
    () => mergeFeedIntoCatalog(value, feed([]), BASE_TIME),
    (error) => error?.code === "CATALOG_INVALID",
  );
}

function atomFeedFor(source) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
  <link rel="self" href="${AMORETTO_YOUTUBE_CHANNEL_FEED_URL}"/>
  <id>yt:channel:${AMORETTO_YOUTUBE_CHANNEL_ID}</id>
  <yt:channelId>${AMORETTO_YOUTUBE_CHANNEL_ID}</yt:channelId>
  <title>Amoretto VODs</title>
  <author>
    <name>Amoretto VODs</name>
    <uri>https://www.youtube.com/channel/${AMORETTO_YOUTUBE_CHANNEL_ID}</uri>
  </author>
  <published>2024-01-01T00:00:00+00:00</published>
  <entry>
    <id>yt:video:${source.videoId}</id>
    <yt:videoId>${source.videoId}</yt:videoId>
    <yt:channelId>${AMORETTO_YOUTUBE_CHANNEL_ID}</yt:channelId>
    <title>${source.title}</title>
    <link rel="alternate" href="${source.watchUrl}"/>
    <author>
      <name>Amoretto VODs</name>
      <uri>https://www.youtube.com/channel/${AMORETTO_YOUTUBE_CHANNEL_ID}</uri>
    </author>
    <published>${source.publishedAt}</published>
    <updated>${source.updatedAt}</updated>
    <media:group>
      <media:content url="https://www.youtube.com/v/${source.videoId}?version=3"
                     duration="${Math.round(source.durationMs / 1_000)}"/>
    </media:group>
  </entry>
</feed>`;
}

function completeContextResult(sourceDurationMs) {
  const result = {
    schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
    broadcastSummaryKo:
      "아모레또가 음식 취향을 이야기하며 여러 메뉴에 대한 경험과 반응을 이어 갑니다.",
    hostStreamerProfile: {
      displayNameKo: "아모레또",
      profileSummaryKo:
        "채널 소유자 prior와 자막의 이름 언급을 바탕으로 주 진행자로 추정합니다.",
      evidenceKo: ["아모레또 채널의 공개 다시보기 자막을 분석했습니다."],
      uncertaintiesKo: [
        "예약 분석에는 로컬 화면과 목소리 확인이 포함되지 않았습니다.",
      ],
    },
    recurringThemesKo: ["음식 취향", "메뉴 경험담"],
    annotations: [],
    semanticChaptersSupported: true,
    semanticChapters: [],
    discoveredLeadsSupported: true,
    discoveredLeads: [],
    coverage: {
      status: "complete",
      coveredMs: sourceDurationMs,
      coverageRatio: 1,
      gaps: [],
      partialChapterIds: [],
    },
  };
  return { ...result, hostStreamerProfile: null };
}

function contextSuccessResponse(
  result,
  headerOverrides = {},
  analysisMode = "overview",
) {
  return Response.json(result, {
    headers: {
      [PREANALYSIS_CONTEXT_CONTRACT_HEADER]:
        PREANALYSIS_CONTEXT_PROXY_VERSION,
      [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]:
        AI_BROADCAST_CONTEXT_ROUTING_REVISION,
      [PREANALYSIS_CONTEXT_MODEL_ID_HEADER]:
        analysisMode === "discovery"
          ? QWEN_CONTEXT_DISCOVERY_MODEL_ID
          : PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID,
      [PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER]:
        analysisMode === "discovery"
          ? QWEN_CONTEXT_DISCOVERY_MODEL_REVISION
          : PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION,
      [PREANALYSIS_CONTEXT_ATTEMPT_HEADER]: "1",
      ...headerOverrides,
    },
  });
}

function discoveryContextResult(request, leadOrdinal = 1) {
  const chapters = [...request.chapters].sort(
    (left, right) => left.startMs - right.startMs,
  );
  const first = chapters[0];
  return {
    schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
    broadcastSummaryKo: "해당 방송 구간에서 서로 다른 반응 사건을 탐색했습니다.",
    hostStreamerProfile: null,
    recurringThemesKo: [],
    annotations: [],
    semanticChaptersSupported: false,
    semanticChapters: [],
    discoveredLeadsSupported: true,
    discoveredLeads: first === undefined
      ? []
      : [{
          leadId: `discovery-test-${leadOrdinal}`,
          startMs: first.startMs,
          endMs: first.endMs,
          startChapterId: first.chapterId,
          endChapterId: first.chapterId,
          category: "reaction",
          confidence: 0.8,
          eventSummaryKo: `구간 ${leadOrdinal}의 반응 사건입니다.`,
          whyThisMomentKo: "대사 흐름 안에서 독립된 반응이 확인됩니다.",
          evidenceCueKo: first.summaryKo,
          uncertaintiesKo: ["영상과 음성으로 최종 확인이 필요합니다."],
        }],
    coverage: calculateCoverage(chapters, request.sourceDurationMs),
  };
}

function contextSuccessResponseForRequest(
  init,
  overviewResult = null,
  overviewHeaderOverrides = {},
) {
  const request = JSON.parse(init.body);
  return request.analysisMode === "discovery"
    ? contextSuccessResponse(
        discoveryContextResult(
          request,
          Number(request.chapters[0]?.chapterId?.match(/\d+/u)?.[0] ?? 1),
        ),
        {},
        "discovery",
      )
    : contextSuccessResponse(
        overviewResult ?? completeContextResult(request.sourceDurationMs),
        overviewHeaderOverrides,
        "overview",
      );
}

function scheduledContextOutcomeForBundle(transcriptBundle, overviewResult) {
  return requestScheduledBroadcastContext(transcriptBundle, {
    proxyUrl: "https://worker.example/v1/broadcast-context",
    authorizationToken: TEST_CONTEXT_TOKEN,
    fetchImplementation: async (_input, init) =>
      contextSuccessResponseForRequest(init, overviewResult),
  });
}

function transcriptBundleWithChapterCount(transcriptBundle, chapterCount) {
  const chapterDurationMs = transcriptBundle.durationMs / chapterCount;
  return {
    ...transcriptBundle,
    chapters: Array.from({ length: chapterCount }, (_, index) => ({
      chapterId: `coverage-chapter-${String(index + 1).padStart(2, "0")}`,
      startMs: Math.round(index * chapterDurationMs),
      endMs: Math.round((index + 1) * chapterDurationMs),
      evidenceMode: "complete-transcript",
      evidenceCoverageRatio: 1,
      summaryKo: `방송 구간 ${index + 1}의 대사와 사건입니다.`,
    })),
  };
}

function testVisualFingerprintForVideo(source) {
  return createChannelPreanalysisVisualFingerprint({
    videoId: source.videoId,
    sourceDurationMs: source.durationMs,
    createdAt: source.updatedAt,
    anchors: Array.from({ length: 12 }, (_, index) =>
      createChannelPreanalysisVisualAnchorDescriptor({
        timestampMs: Math.round(
          (source.durationMs * (index + 1)) / 13,
        ),
        luma: Uint8Array.from(
          { length: 32 * 18 },
          (_, pixelIndex) =>
            (pixelIndex * (index + 7) +
              Math.floor(pixelIndex / 32) * 31 +
              index * 53) %
            256,
        ),
      }),
    ),
  });
}

async function readyCatalogFixture(catalogDir, overrides = {}) {
  const source = video({
    durationMs: 240_000,
    state: "metadata-ready",
    ...overrides.video,
  });
  const bundle = await createTranscriptReadyBundle({
    video: source,
    catalogRevision: 8,
    extractedAt: BASE_TIME,
    captionJson: {
      events: [
        {
          tStartMs: 1_000,
          dDurationMs: 2_000,
          segs: [{ utf8: "칼국수 이야기를 시작합니다." }],
        },
        {
          tStartMs: 121_000,
          dDurationMs: 2_000,
          segs: [{ utf8: "두바이 초콜릿 반응입니다." }],
        },
      ],
    },
  });
  const serialized = serializeBundle(bundle);
  const artifact = artifactForBundle(source.videoId, serialized, BASE_TIME);
  const visualFingerprint = testVisualFingerprintForVideo(source);
  const serializedFingerprint =
    serializeChannelPreanalysisVisualFingerprint(visualFingerprint);
  const fingerprintArtifact = artifactForVisualFingerprint(
    source.videoId,
    serializedFingerprint,
    source.updatedAt,
  );
  const readyVideo = {
    ...source,
    state: "transcript-ready",
    revision: source.revision + 1,
    artifactIds: [
      artifact.artifactId,
      fingerprintArtifact.artifactId,
    ],
    retry: null,
  };
  const readyManifest = {
    ...manifest([readyVideo], [artifact, fingerprintArtifact]),
    revision: 8,
  };
  const bundlePath = join(
    catalogDir,
    "videos",
    `${source.videoId}.v1.json`,
  );
  const fingerprintPath = join(
    catalogDir,
    "videos",
    `${source.videoId}.visual-fingerprint.v1.json`,
  );
  await mkdir(join(catalogDir, "videos"), { recursive: true });
  await writeFile(
    fingerprintPath,
    overrides.fingerprintText ?? serializedFingerprint,
    "utf8",
  );
  if (overrides.writeBundle !== false) {
    await writeFile(
      bundlePath,
      overrides.bundleText ?? serialized,
      "utf8",
    );
  }
  return {
    bundlePath,
    fingerprintPath,
    manifest: readyManifest,
    serialized,
    serializedFingerprint,
    videoId: source.videoId,
  };
}

test("CLI defaults are bounded and every override is explicit", () => {
  const defaults = parseSyncArguments([], {
    cwd: "/work",
    defaultYtDlp: "/tools/yt-dlp",
  });
  assert.equal(defaults.videoId, null);
  assert.equal(defaults.maxVideos, 2);
  assert.equal(defaults.ytDlpPath, "/tools/yt-dlp");
  assert.equal(defaults.contextProxyUrl, null);
  assert.equal(defaults.contextAuthorizationToken, null);
  assert.equal(defaults.contextProviderRetryPolicy, "free-tier-recovery");
  assert.match(
    defaults.catalogDir.replaceAll("\\", "/"),
    /\/work\/preanalysis-catalog$/u,
  );
  assert.equal(defaults.configuredSource, null);

  const selected = parseSyncArguments(
    [
      `--video-id=${FOOD_TALK_ID}`,
      "--max-videos",
      "1",
      "--catalog-dir=branch/amoretto-vods",
      "--yt-dlp",
      "./pinned-yt-dlp",
      "--source",
      "amoretto-vods",
      "--context-proxy",
      "https://worker.example/v1/broadcast-context",
      "--context-retry-policy",
      "strict-paid",
    ],
    {
      cwd: "/work",
      defaultContextToken: TEST_CONTEXT_TOKEN,
    },
  );
  assert.equal(selected.videoId, FOOD_TALK_ID);
  assert.equal(selected.maxVideos, 1);
  assert.equal(selected.configuredSource?.sourceId, "amoretto-vods");
  assert.equal(selected.ytDlpPath, "./pinned-yt-dlp");
  assert.equal(
    selected.contextProxyUrl,
    "https://worker.example/v1/broadcast-context",
  );
  assert.equal(
    selected.contextAuthorizationToken,
    TEST_CONTEXT_TOKEN,
  );
  assert.equal(selected.contextProviderRetryPolicy, "strict-paid");

  assert.throws(
    () => parseSyncArguments(["--context-retry-policy", "speculative"]),
    /free-tier-recovery or strict-paid/u,
  );
  assert.throws(
    () => parseSyncArguments(["--max-videos", "3"]),
    /between 1 and 2/u,
  );
  assert.throws(
    () => parseSyncArguments(["--video-id", "not-an-id"]),
    /11 characters/u,
  );
  assert.throws(
    () => parseSyncArguments(["--video-id", FOOD_TALK_ID]),
    /requires an explicit --source/u,
  );
  assert.throws(
    () => parseSyncArguments(["--feed-url", "https://example.test/"]),
    /Unknown option/u,
  );
  assert.throws(
    () =>
      parseSyncArguments([
        "--context-proxy",
        "http://worker.example/v1/broadcast-context",
      ], { defaultContextToken: TEST_CONTEXT_TOKEN }),
    /HTTPS/u,
  );
  assert.throws(
    () =>
      parseSyncArguments([
        "--context-proxy",
        "https://worker.example/v1/broadcast-context",
      ]),
    /both a dedicated proxy URL and token/u,
  );
  assert.throws(
    () =>
      parseSyncArguments(
        [
          "--context-proxy",
          "https://rettohighlight-gemini.11qaws.workers.dev/v1/broadcast-context",
        ],
        { defaultContextToken: TEST_CONTEXT_TOKEN },
      ),
    /foreground five-editor Worker/u,
  );
});

test("scheduled and manual runs checkout the immutable workflow event revision through a proven WARP egress", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/channel-preanalysis.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /^\s{2}schedule:/mu);
  assert.match(workflow, /^\s{2}workflow_dispatch:/mu);
  // YouTube refuses this runner's own address, so yt-dlp must go through WARP
  // and the tunnel must be proven before anything depends on it. Losing either
  // of these silently returns every run to deferring every video.
  assert.match(workflow, /warp-cli --accept-tos connect/u);
  assert.match(workflow, /ALL_PROXY:\s*socks5:\/\/127\.0\.0\.1:40000/u);
  assert.match(workflow, /grep -q '\^warp=on'/u);
  const checkoutStart = workflow.indexOf(
    "- name: Checkout application source",
  );
  const checkoutEnd = workflow.indexOf(
    "- name: Require the preanalysis catalog branch",
  );
  assert.ok(checkoutStart >= 0);
  assert.ok(checkoutEnd > checkoutStart);
  const checkout = workflow.slice(checkoutStart, checkoutEnd);
  assert.match(checkout, /ref:\s+\$\{\{\s*github\.sha\s*\}\}/u);
  assert.doesNotMatch(checkout, /ref:\s+main(?:\s|$)/u);
  assert.match(checkout, /persist-credentials:\s+false/u);
  for (const sourceId of [
    "amoretto-vods",
    "eureka-history",
    "sena-replay",
    "coco-replay",
    "mangjing-compilations",
  ]) {
    assert.match(workflow, new RegExp(`\\b${sourceId}\\b`, "u"));
  }
  assert.match(workflow, /channel-preanalysis-run-report\.json/u);
  assert.match(workflow, /Bootstrap missing configured catalog namespaces/u);
  assert.match(workflow, /source\/public\/preanalysis\/\$\{namespace\}/u);
  assert.match(workflow, /Surface partial source failures/u);
  assert.match(workflow, /report\.status !== "complete"/u);
});

test("yt-dlp receives only bounded compatibility variables and never runner secrets", async () => {
  const childEnvironment = createYtDlpChildEnvironment({
    PATH: "/usr/local/bin:/usr/bin",
    HOME: "/home/runner",
    LANG: "C.UTF-8",
    HTTPS_PROXY: "http://proxy.internal:8080",
    NO_PROXY: "localhost,127.0.0.1",
    SSL_CERT_FILE: "/etc/ssl/certs/ca-certificates.crt",
    CHANNEL_PREANALYSIS_CONTEXT_TOKEN: "must-never-reach-child",
    PREANALYSIS_QWEN_API_KEY: "must-never-reach-child",
    GITHUB_TOKEN: "must-never-reach-child",
    ACTIONS_RUNTIME_TOKEN: "must-never-reach-child",
    UNRELATED_SECRET: "must-never-reach-child",
    NO_COLOR: "0",
  });
  assert.deepEqual(childEnvironment, {
    NO_COLOR: "1",
    PATH: "/usr/local/bin:/usr/bin",
    HOME: "/home/runner",
    LANG: "C.UTF-8",
    HTTPS_PROXY: "http://proxy.internal:8080",
    NO_PROXY: "localhost,127.0.0.1",
    SSL_CERT_FILE: "/etc/ssl/certs/ca-certificates.crt",
  });

  assert.throws(
    () =>
      createYtDlpChildEnvironment({
        HTTPS_PROXY: "https://runner:proxy-secret@proxy.internal:8443",
      }),
    (error) => {
      assert.equal(error.code, "YT_DLP_ENV_INVALID");
      assert.doesNotMatch(error.message, /proxy-secret/u);
      return true;
    },
  );
  assert.throws(
    () =>
      createYtDlpChildEnvironment({
        SSL_CERT_FILE: "/safe/path\nCHANNEL_PREANALYSIS_CONTEXT_TOKEN=leak",
      }),
    (error) => error.code === "YT_DLP_ENV_INVALID",
  );

  const safeHostEnvironment = createYtDlpChildEnvironment(process.env);
  const observed = await runBoundedCommand(
    process.execPath,
    [
      "-e",
      "process.stdout.write(JSON.stringify({ keys: Object.keys(process.env).sort(), noColor: process.env.NO_COLOR }))",
    ],
    {
      timeoutMs: 10_000,
      sourceEnvironment: {
        ...safeHostEnvironment,
        CHANNEL_PREANALYSIS_CONTEXT_TOKEN: "must-never-reach-child",
        PREANALYSIS_QWEN_API_KEY: "must-never-reach-child",
        GITHUB_TOKEN: "must-never-reach-child",
      },
    },
  );
  const childSnapshot = JSON.parse(observed.stdout);
  assert.equal(childSnapshot.noColor, "1");
  assert.ok(childSnapshot.keys.includes("NO_COLOR"));
  assert.ok(!childSnapshot.keys.includes("CHANNEL_PREANALYSIS_CONTEXT_TOKEN"));
  assert.ok(!childSnapshot.keys.includes("PREANALYSIS_QWEN_API_KEY"));
  assert.ok(!childSnapshot.keys.includes("GITHUB_TOKEN"));
});

test("catalog producer enforces the browser manifest cardinality bounds", () => {
  assert.equal(
    CHANNEL_PREANALYSIS_MANIFEST_MAX_BYTES,
    CLIENT_MANIFEST_MAX_BYTES,
  );
  assertCatalogInvalid({
    ...manifest([]),
    videos: new Array(10_001).fill(null),
  });
  assertCatalogInvalid({
    ...manifest([]),
    artifacts: new Array(40_001).fill(null),
  });
  assertCatalogInvalid(
    manifest([
      video({
        artifactIds: Array.from(
          { length: 1_001 },
          (_, index) => `artifact-${index}`,
        ),
      }),
    ]),
  );
  assertCatalogInvalid(
    manifest([
      video({
        registeredLocalSampledFingerprints: Array.from(
          { length: 65 },
          (_, index) => ({
            value: `local-file-sampled-sha256-v1:${index
              .toString(16)
              .padStart(64, "0")}`,
            registeredAt: BASE_TIME,
          }),
        ),
      }),
    ]),
  );

  const fullCatalog = Array.from({ length: 10_000 }, (_, index) =>
    video({
      videoId: index.toString().padStart(11, "0"),
      title: `영상 ${index}`,
    }),
  );
  assert.throws(
    () =>
      mergeFeedIntoCatalog(
        manifest(fullCatalog),
        feed([
          feedVideo({
            videoId: "zzzzzzzzzzz",
            title: "상한 뒤 새 영상",
          }),
        ]),
        BASE_TIME,
      ),
    (error) => error?.code === "CATALOG_INVALID",
  );
});

test("catalog producer rejects a structurally valid manifest the browser cannot read", () => {
  const oversizedVideos = Array.from({ length: 4_000 }, (_, index) => {
    const videoId = index.toString(36).padStart(11, "0");
    return video({
      videoId,
      title: `${index}-${"가".repeat(980)}`,
    });
  });
  assert.throws(
    () => mergeFeedIntoCatalog(manifest(oversizedVideos), feed([]), BASE_TIME),
    (error) => error?.code === "CATALOG_TOO_LARGE",
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(manifest(oversizedVideos))) >
      CHANNEL_PREANALYSIS_MANIFEST_MAX_BYTES,
  );
});

test("catalog producer rejects duplicate sampled fingerprints globally", () => {
  const fingerprint = {
    value: `local-file-sampled-sha256-v1:${"b".repeat(64)}`,
    registeredAt: BASE_TIME,
  };
  assertCatalogInvalid(
    manifest([
      video({ registeredLocalSampledFingerprints: [fingerprint] }),
      video({
        videoId: OLD_VIDEO_ID,
        title: "다른 영상",
        registeredLocalSampledFingerprints: [fingerprint],
      }),
    ]),
  );
});

test("catalog producer requires a canonical, source-local artifact closure", () => {
  const transcript = catalogArtifact();
  assertCatalogInvalid(manifest([video()], [transcript]));

  const foreignTranscript = catalogArtifact({ videoId: OLD_VIDEO_ID });
  assertCatalogInvalid(
    manifest(
      [
        video({ artifactIds: [foreignTranscript.artifactId] }),
        video({
          videoId: OLD_VIDEO_ID,
          title: "다른 영상",
        }),
      ],
      [foreignTranscript],
    ),
  );

  const wrongStorage = catalogArtifact({
    storageKey: `amoretto-vods/videos/${OLD_VIDEO_ID}.v1.json`,
  });
  assertCatalogInvalid(
    manifest(
      [video({ artifactIds: [wrongStorage.artifactId] })],
      [wrongStorage],
    ),
  );

  const futureRevision = catalogArtifact({ revision: 2 });
  assertCatalogInvalid(
    manifest(
      [video({ artifactIds: [futureRevision.artifactId], revision: 1 })],
      [futureRevision],
    ),
  );

  assertCatalogInvalid(
    manifest([
      video({
        state: "transcript-ready",
        artifactIds: [],
      }),
    ]),
  );
});

test("catalog producer rejects non-canonical record shapes and storage paths", () => {
  assertCatalogInvalid({ ...manifest([]), unexpected: true });
  assertCatalogInvalid(
    manifest(
      [
        video({
          artifactIds: ["metadata:test"],
        }),
      ],
      [
        catalogArtifact({
          artifactId: "metadata:test",
          kind: "metadata",
          storageKey: "amoretto-vods/videos//metadata.json",
        }),
      ],
    ),
  );
  assertCatalogInvalid(
    manifest([
      video({
        registeredLocalSampledFingerprints: [
          {
            value: `local-file-sampled-sha256-v1:${"c".repeat(64)}`,
            registeredAt: BASE_TIME,
            unexpected: true,
          },
        ],
      }),
    ]),
  );
});

test("feed reconciliation preserves videos outside the short Atom window", () => {
  const oldVideo = video({
    videoId: OLD_VIDEO_ID,
    title: "오래된 다시보기",
    publishedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const merged = mergeFeedIntoCatalog(
    manifest([oldVideo]),
    feed([
      feedVideo({
        videoId: FOOD_TALK_ID,
        publishedAt: "2026-07-17T04:00:00.000Z",
      }),
      feedVideo({
        videoId: SUBSCRIPTION_ID,
        title: "실수로 구독을 열었다",
        publishedAt: "2026-07-16T04:00:00.000Z",
      }),
    ]),
    "2026-07-30T03:00:00.000Z",
  );

  assert.equal(merged.changed, true);
  assert.deepEqual(
    new Set(merged.manifest.videos.map(({ videoId }) => videoId)),
    new Set([OLD_VIDEO_ID, FOOD_TALK_ID, SUBSCRIPTION_ID]),
  );
  assert.equal(
    merged.manifest.videos.find(({ videoId }) => videoId === OLD_VIDEO_ID)
      ?.title,
    "오래된 다시보기",
  );
});

test("feed edits never rewrite identity fields sealed into an immutable bundle", () => {
  const artifact = {
    artifactId: `youtube-caption-bundle:${FOOD_TALK_ID}:v1`,
    videoId: FOOD_TALK_ID,
    kind: "transcript",
    revision: 1,
    storageKey: `amoretto-vods/videos/${FOOD_TALK_ID}.v1.json`,
    contentDigest: `sha256:${"a".repeat(64)}`,
    byteLength: 512,
    createdAt: BASE_TIME,
  };
  const ready = video({
    state: "transcript-ready",
    artifactIds: [artifact.artifactId],
  });
  const merged = mergeFeedIntoCatalog(
    manifest([ready], [artifact]),
    feed([
      feedVideo({
        videoId: FOOD_TALK_ID,
        title: "업로드 뒤 수정된 제목",
        durationMs: null,
        updatedAt: "2026-07-30T03:00:00.000Z",
      }),
    ]),
    "2026-07-30T03:01:00.000Z",
  );
  const result = merged.manifest.videos[0];
  assert.equal(result.title, ready.title);
  assert.equal(result.durationMs, ready.durationMs);
  assert.equal(result.updatedAt, "2026-07-30T03:00:00.000Z");
});

test("due selection protects fresh discoveries from retry starvation and never exceeds two videos", () => {
  const dueRetry = video({
    videoId: SUBSCRIPTION_ID,
    state: "retryable",
    retry: {
      stage: "metadata",
      lastSuccessfulState: "discovered",
      attemptCount: 1,
      nextAttemptAt: "2026-07-29T21:00:00.000Z",
      errorCode: "YT_DLP_FAILED",
    },
  });
  const futureRetry = video({
    videoId: MINECRAFT_ID,
    state: "retryable",
    retry: {
      stage: "metadata",
      lastSuccessfulState: "discovered",
      attemptCount: 1,
      nextAttemptAt: "2026-07-30T06:00:00.000Z",
      errorCode: "YT_DLP_FAILED",
    },
  });
  const lowPriorityFingerprintRetry = video({
    videoId: "FpRetry0001",
    state: "retryable",
    publishedAt: "2026-07-30T00:00:00.000Z",
    retry: {
      stage: "fingerprint",
      lastSuccessfulState: "metadata-ready",
      attemptCount: 4,
      nextAttemptAt: "2026-07-29T00:00:00.000Z",
      errorCode: "FINGERPRINT_STORYBOARD_UNAVAILABLE",
    },
  });
  const selected = selectDueCatalogVideos(
    manifest([
      video(),
      dueRetry,
      futureRetry,
      lowPriorityFingerprintRetry,
      video({
        videoId: OLD_VIDEO_ID,
        publishedAt: "2026-01-01T00:00:00.000Z",
      }),
    ]),
    { nowIso: BASE_TIME, maxVideos: 2 },
  );
  assert.deepEqual(
    selected.map(({ videoId }) => videoId),
    [FOOD_TALK_ID, OLD_VIDEO_ID],
  );

  const forced = selectDueCatalogVideos(
    manifest([futureRetry]),
    {
      nowIso: BASE_TIME,
      maxVideos: 1,
      videoId: MINECRAFT_ID,
    },
  );
  assert.equal(forced[0]?.videoId, MINECRAFT_ID);

  const transcriptArtifact = catalogArtifact();
  const transcriptReady = video({
    state: "transcript-ready",
    artifactIds: [transcriptArtifact.artifactId],
  });
  assert.deepEqual(
    selectDueCatalogVideos(manifest([transcriptReady], [transcriptArtifact]), {
      nowIso: BASE_TIME,
      maxVideos: 1,
    }).map(({ videoId }) => videoId),
    [transcriptReady.videoId],
  );
  assert.equal(
    selectDueCatalogVideos(manifest([transcriptReady], [transcriptArtifact]), {
      nowIso: BASE_TIME,
      maxVideos: 1,
      includeTranscriptReady: true,
    })[0]?.videoId,
    transcriptReady.videoId,
  );

  const missingCaptionRetry = video({
    state: "retryable",
    retry: {
      stage: "transcript",
      lastSuccessfulState: "metadata-ready",
      attemptCount: 1,
      nextAttemptAt: "2026-07-29T00:00:00.000Z",
      errorCode: "KOREAN_CAPTION_NOT_FOUND",
    },
  });
  assert.deepEqual(
    selectDueCatalogVideos(manifest([missingCaptionRetry]), {
      nowIso: BASE_TIME,
      maxVideos: 1,
      includePermanentCaptionRetries: false,
    }),
    [],
  );
});

test("explicit selection revalidates a reached target while scheduled selection skips it", () => {
  const transcriptArtifact = catalogArtifact();
  const target = video({ state: "transcript-ready" });
  const serializedFingerprint =
    serializeChannelPreanalysisVisualFingerprint(
      testVisualFingerprintForVideo(target),
    );
  const fingerprintArtifact = artifactForVisualFingerprint(
    target.videoId,
    serializedFingerprint,
    target.updatedAt,
  );
  const completedTarget = {
    ...target,
    artifactIds: [
      transcriptArtifact.artifactId,
      fingerprintArtifact.artifactId,
    ],
  };
  const completedManifest = manifest(
    [completedTarget],
    [transcriptArtifact, fingerprintArtifact],
  );

  assert.deepEqual(
    selectDueCatalogVideos(completedManifest, {
      nowIso: BASE_TIME,
      maxVideos: 1,
    }),
    [],
  );
  assert.deepEqual(
    selectDueCatalogVideos(completedManifest, {
      nowIso: BASE_TIME,
      maxVideos: 1,
      videoId: target.videoId,
    }).map(({ videoId }) => videoId),
    [target.videoId],
  );
});

test("retry checkpoints keep the last durable stage and bounded backoff", () => {
  const metadataRetry = video({
    state: "retryable",
    retry: {
      stage: "metadata",
      lastSuccessfulState: "discovered",
      attemptCount: 2,
      nextAttemptAt: BASE_TIME,
      errorCode: "YT_DLP_FAILED",
    },
  });
  assert.deepEqual(
    createRetryCheckpoint(
      metadataRetry,
      "metadata",
      "yt-dlp failed",
      BASE_TIME,
    ),
    {
      stage: "metadata",
      lastSuccessfulState: "discovered",
      attemptCount: 3,
      nextAttemptAt: "2026-07-30T12:00:00.000Z",
      errorCode: "YT_DLP_FAILED",
    },
  );

  assert.equal(
    createRetryCheckpoint(video(), "transcript", "caption missing", BASE_TIME)
      .lastSuccessfulState,
    "metadata-ready",
  );
  assert.equal(
    createRetryCheckpoint(
      video({ state: "transcript-ready" }),
      "context",
      "upstream unavailable",
      BASE_TIME,
    ).lastSuccessfulState,
    "transcript-ready",
  );
  assert.equal(
    createRetryCheckpoint(
      video(),
      "transcript",
      "KOREAN_CAPTION_NOT_FOUND",
      BASE_TIME,
    ).nextAttemptAt,
    "2026-07-31T00:00:00.000Z",
  );
});

test("yt-dlp metadata must be the pinned public completed channel video", () => {
  const valid = {
    id: FOOD_TALK_ID,
    channel_id: AMORETTO_YOUTUBE_CHANNEL_ID,
    title: "2026 07 17 - 음식 토크",
    duration: 8_114.375,
    availability: "public",
    live_status: "not_live",
  };
  assert.deepEqual(validateYtDlpMetadata(valid, FOOD_TALK_ID), {
    videoId: FOOD_TALK_ID,
    channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
    title: valid.title,
    normalizedTitle: "2026 07 17 음식 토크",
    durationMs: 8_114_375,
    availability: "public",
    liveStatus: "not_live",
    watchUrl: `https://www.youtube.com/watch?v=${FOOD_TALK_ID}`,
  });

  assert.throws(
    () =>
      validateYtDlpMetadata(
        { ...valid, channel_id: "UC0000000000000000000000" },
        FOOD_TALK_ID,
      ),
    /different channel/u,
  );
  assert.throws(
    () =>
      validateYtDlpMetadata(
        { ...valid, availability: "private" },
        FOOD_TALK_ID,
      ),
    /not publicly available/u,
  );
  assert.throws(
    () =>
      validateYtDlpMetadata(
        { ...valid, live_status: "is_live" },
        FOOD_TALK_ID,
      ),
    /non-live/u,
  );
  assert.throws(
    () =>
      validateYtDlpMetadata(
        { ...valid, duration: 12 * 60 * 60 + 0.001 },
        FOOD_TALK_ID,
      ),
    /exceeds 12 hours/u,
  );
});

test("strict transcript bundle is complete, contiguous, and honestly stops before AI", async () => {
  const source = video({ durationMs: 240_000, state: "metadata-ready" });
  const bundle = await createTranscriptReadyBundle({
    video: source,
    catalogRevision: 8,
    extractedAt: BASE_TIME,
    captionJson: {
      events: [
        {
          tStartMs: 1_000,
          dDurationMs: 2_000,
          segs: [{ utf8: "칼국수 이야기를 시작합니다." }],
        },
        {
          tStartMs: 121_000,
          dDurationMs: 2_000,
          segs: [{ utf8: "두바이 초콜릿 반응입니다." }],
        },
      ],
    },
  });

  assert.equal(bundle.state, "transcript-ready");
  assert.equal(bundle.broadcastContext, null);
  assert.equal(bundle.contextProvenance, null);
  assert.equal(bundle.captionTrack.languageCode, "ko-orig");
  assert.equal(bundle.captionTrack.events.length, 2);
  assert.equal(bundle.chapters[0]?.startMs, 0);
  assert.equal(bundle.chapters.at(-1)?.endMs, 240_000);
  assert.match(bundle.transcriptDigest, /^sha256:[0-9a-f]{64}$/u);

  const serialized = serializeBundle(bundle);
  const artifact = artifactForBundle(FOOD_TALK_ID, serialized, BASE_TIME);
  assert.equal(
    artifact.storageKey,
    `amoretto-vods/videos/${FOOD_TALK_ID}.v1.json`,
  );
  assert.equal(artifact.byteLength, Buffer.byteLength(serialized));
  assert.match(artifact.contentDigest, /^sha256:[0-9a-f]{64}$/u);
});

test("context promotion is transcript-only provenance and never claims local visual verification", async () => {
  const source = video({ durationMs: 240_000, state: "metadata-ready" });
  const transcriptBundle = await createTranscriptReadyBundle({
    video: source,
    catalogRevision: 8,
    extractedAt: BASE_TIME,
    captionJson: {
      events: [
        {
          tStartMs: 1_000,
          dDurationMs: 2_000,
          segs: [{ utf8: "아모레또가 칼국수 이야기를 시작합니다." }],
        },
      ],
    },
  });
  const request = createScheduledContextRequest(transcriptBundle);
  assert.equal(
    request.castRosterId,
    "chzzk-channel-33bc7a29b771728cf9378604973b620b-v1",
  );
  assert.equal(request.candidates.length, 0);
  assert.equal(request.participantGrounding.status, "sealed");
  assert.equal(
    request.participantGrounding.adapterReceipts.find(
      ({ adapter }) => adapter === "visual-identity",
    )?.status,
    "unavailable",
  );

  const contextOutcome = await scheduledContextOutcomeForBundle(
    transcriptBundle,
    completeContextResult(source.durationMs),
  );
  const contextBundle = await createContextReadyBundle({
    transcriptBundle,
    broadcastContext: contextOutcome.broadcastContext,
    contextReceipt: contextOutcome.contextReceipt,
    catalogRevision: 9,
    generatedAt: BASE_TIME,
  });
  assert.equal(contextBundle.state, "context-ready");
  assert.deepEqual(contextBundle.contextProvenance, {
    generatedAt: BASE_TIME,
    modelRoutingRevision: AI_BROADCAST_CONTEXT_ROUTING_REVISION,
    contextReceipt: contextOutcome.contextReceipt,
    evidenceScope: "youtube-caption-transcript-only",
    localVisualVerificationRequired: true,
  });
  assert.equal(
    contextBundle.transcriptDigest,
    transcriptBundle.transcriptDigest,
  );
});

test("a manual Korean caption track is represented as higher-quality evidence", async () => {
  const source = video({ durationMs: 240_000, state: "metadata-ready" });
  const bundle = await createTranscriptReadyBundle({
    video: source,
    captionLanguageCode: "ko",
    captionIsAutoGenerated: false,
    catalogRevision: 8,
    extractedAt: BASE_TIME,
    captionJson: {
      events: [
        {
          tStartMs: 1_000,
          dDurationMs: 2_000,
          segs: [{ utf8: "직접 작성한 한국어 자막입니다." }],
        },
      ],
    },
  });

  assert.equal(bundle.captionTrack.languageCode, "ko");
  assert.equal(bundle.captionTrack.isAutoGenerated, false);
  assert.equal(bundle.captionTrack.events[0]?.text, "직접 작성한 한국어 자막입니다.");
  await assert.rejects(
    createTranscriptReadyBundle({
      video: source,
      captionLanguageCode: "ko",
      captionIsAutoGenerated: true,
      catalogRevision: 8,
      extractedAt: BASE_TIME,
      captionJson: {
        events: [
          {
            tStartMs: 1_000,
            dDurationMs: 2_000,
            segs: [{ utf8: "서로 모순되는 출처" }],
          },
        ],
      },
    }),
    (error) => error?.code === "INVALID_CAPTION_SOURCE",
  );
});

test("ready artifact closure verifies exact bytes, full SHA, transcript digest, and identity", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-catalog-closure-valid-"),
  );
  try {
    const fixture = await readyCatalogFixture(catalogDir);
    const result = await reconcileReadyCatalogArtifacts(fixture.manifest, {
      catalogDir,
      nowIso: BASE_TIME,
      log: { warn() {} },
    });

    assert.equal(result.changed, false);
    assert.deepEqual(result.invalidatedVideoIds, []);
    assert.equal(result.manifest.videos[0]?.state, "transcript-ready");
    assert.equal(
      await readFile(fixture.bundlePath, "utf8"),
      fixture.serialized,
    );
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("artifact closure accepts a revisioned context-ready canonical bundle", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-catalog-context-ready-"),
  );
  try {
    const contextGeneratedAt = "2026-07-30T00:01:00.000Z";
    const fixture = await readyCatalogFixture(catalogDir);
    const transcriptBundle = JSON.parse(fixture.serialized);
    const contextBundle = {
      ...transcriptBundle,
      state: "context-ready",
      broadcastContext: {
        schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
        broadcastSummaryKo: "음식 이야기가 여러 주제로 이어진 방송입니다.",
        hostStreamerProfile: null,
        recurringThemesKo: ["음식 취향"],
        annotations: [],
        semanticChaptersSupported: true,
        semanticChapters: [],
        discoveredLeadsSupported: true,
        discoveredLeads: [],
        coverage: {
          status: "complete",
          coveredMs: transcriptBundle.durationMs,
          coverageRatio: 1,
          gaps: [],
          partialChapterIds: [],
        },
      },
      contextProvenance: {
        generatedAt: contextGeneratedAt,
        modelRoutingRevision: AI_BROADCAST_CONTEXT_ROUTING_REVISION,
        contextReceipt: createExpectedScheduledContextReceipt(),
        evidenceScope: "youtube-caption-transcript-only",
        localVisualVerificationRequired: true,
      },
    };
    const serialized = serializeBundle(contextBundle);
    const artifact = artifactForBundle(
      fixture.videoId,
      serialized,
      contextGeneratedAt,
      2,
    );
    const contextVideo = {
      ...fixture.manifest.videos[0],
      state: "context-ready",
      artifactIds: [artifact.artifactId],
    };
    const contextManifest = {
      ...fixture.manifest,
      videos: [contextVideo],
      artifacts: [artifact],
    };
    assert.doesNotThrow(() =>
      parseChannelPreanalysisManifest(JSON.stringify(contextManifest)),
    );
    await writeFile(
      join(catalogDir, "videos", `${fixture.videoId}.v2.json`),
      serialized,
      "utf8",
    );

    const result = await reconcileReadyCatalogArtifacts(contextManifest, {
      catalogDir,
      nowIso: BASE_TIME,
      log: { warn() {} },
    });

    assert.equal(result.changed, false);
    assert.equal(result.manifest.videos[0]?.state, "context-ready");
    assert.equal(
      result.manifest.artifacts.find(({ kind }) => kind === "transcript")
        ?.revision,
      2,
    );
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("missing or corrupt ready artifacts become immediately recoverable checkpoints", async (t) => {
  await t.test("missing bundle", async () => {
    const catalogDir = await mkdtemp(
      join(tmpdir(), "exclipper-catalog-closure-missing-"),
    );
    try {
      const fixture = await readyCatalogFixture(catalogDir, {
        writeBundle: false,
      });
      const result = await reconcileReadyCatalogArtifacts(fixture.manifest, {
        catalogDir,
        nowIso: BASE_TIME,
        log: { warn() {} },
      });
      const repaired = result.manifest.videos[0];

      assert.equal(result.changed, true);
      assert.deepEqual(result.invalidatedVideoIds, [fixture.videoId]);
      assert.equal(repaired?.state, "retryable");
      assert.deepEqual(repaired?.artifactIds, []);
      assert.equal(repaired?.retry?.stage, "transcript");
      assert.equal(repaired?.retry?.nextAttemptAt, BASE_TIME);
      assert.equal(result.manifest.artifacts.length, 0);
      assert.deepEqual(
        selectDueCatalogVideos(result.manifest, {
          nowIso: BASE_TIME,
          maxVideos: 1,
        }).map(({ videoId }) => videoId),
        [fixture.videoId],
      );
    } finally {
      await rm(catalogDir, { recursive: true, force: true });
    }
  });

  await t.test("same-length byte corruption", async () => {
    const catalogDir = await mkdtemp(
      join(tmpdir(), "exclipper-catalog-closure-corrupt-"),
    );
    try {
      const fixture = await readyCatalogFixture(catalogDir);
      const bytes = await readFile(fixture.bundlePath);
      bytes[Math.floor(bytes.length / 2)] ^= 1;
      await writeFile(fixture.bundlePath, bytes);

      const result = await reconcileReadyCatalogArtifacts(fixture.manifest, {
        catalogDir,
        nowIso: BASE_TIME,
        log: { warn() {} },
      });
      const repaired = result.manifest.videos[0];

      assert.equal(result.changed, true);
      assert.equal(repaired?.state, "retryable");
      assert.equal(
        repaired?.retry?.errorCode,
        "ARTIFACT_DIGEST_MISMATCH",
      );
      await assert.rejects(readFile(fixture.bundlePath), {
        code: "ENOENT",
      });
    } finally {
      await rm(catalogDir, { recursive: true, force: true });
    }
  });
});

test("fingerprint damage preserves the transcript and repairs only the visual artifact", async (t) => {
  for (const damage of ["missing", "same-length corruption"]) {
    await t.test(damage, async () => {
      const catalogDir = await mkdtemp(
        join(tmpdir(), "exclipper-fingerprint-closure-repair-"),
      );
      try {
        const fixture = await readyCatalogFixture(catalogDir);
        if (damage === "missing") {
          await rm(fixture.fingerprintPath, { force: true });
        } else {
          const bytes = await readFile(fixture.fingerprintPath);
          bytes[Math.floor(bytes.length / 2)] ^= 1;
          await writeFile(fixture.fingerprintPath, bytes);
        }

        const isolated = await reconcileReadyCatalogArtifacts(
          fixture.manifest,
          {
            catalogDir,
            nowIso: BASE_TIME,
            log: { warn() {} },
          },
        );
        const retryVideo = isolated.manifest.videos[0];
        assert.equal(isolated.changed, true);
        assert.equal(retryVideo?.state, "retryable");
        assert.equal(retryVideo?.retry?.stage, "fingerprint");
        assert.equal(
          retryVideo?.retry?.lastSuccessfulState,
          "transcript-ready",
        );
        assert.deepEqual(
          isolated.manifest.artifacts.map(({ kind }) => kind),
          ["transcript"],
        );
        assert.equal(
          await readFile(fixture.bundlePath, "utf8"),
          fixture.serialized,
        );
        await assert.rejects(readFile(fixture.fingerprintPath), {
          code: "ENOENT",
        });

        await writeFile(
          join(catalogDir, "catalog.json"),
          `${JSON.stringify(isolated.manifest, null, 2)}\n`,
          "utf8",
        );
        let nonVersionCommands = 0;
        const repaired = await synchronizeAmorettoCatalog(
          {
            catalogDir,
            ytDlpPath: "test-path-yt-dlp",
            maxVideos: 1,
            videoId: null,
          },
          {
            now: () => new Date(BASE_TIME),
            fetch: async () =>
              new Response(atomFeedFor(retryVideo), { status: 200 }),
            commandRunner: async (_command, arguments_) => {
              if (
                arguments_.length === 1 &&
                arguments_[0] === "--version"
              ) {
                return {
                  stdout: `${PINNED_YT_DLP_VERSION}\n`,
                  stderr: "",
                };
              }
              nonVersionCommands += 1;
              throw new Error("Transcript work must not repeat.");
            },
            visualFingerprintProvider: async ({
              video: currentVideo,
            }) => testVisualFingerprintForVideo(currentVideo),
            log: { info() {}, warn() {} },
          },
        );
        assert.equal(nonVersionCommands, 0);
        assert.equal(repaired.outcomes[0]?.state, "transcript-ready");
        assert.equal(repaired.manifest.videos[0]?.retry, null);
        assert.deepEqual(
          repaired.manifest.artifacts.map(({ kind }) => kind).sort(),
          ["fingerprint", "transcript"],
        );
        assert.equal(
          await readFile(fixture.bundlePath, "utf8"),
          fixture.serialized,
        );
      } finally {
        await rm(catalogDir, { recursive: true, force: true });
      }
    });
  }
});

test("a corrupt orphan bundle is rebuilt and published in the same invocation", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-catalog-orphan-recovery-"),
  );
  try {
    const source = video({
      durationMs: 240_000,
      state: "metadata-ready",
    });
    await mkdir(join(catalogDir, "videos"), { recursive: true });
    await writeFile(
      join(catalogDir, "catalog.json"),
      `${JSON.stringify(manifest([source]), null, 2)}\n`,
      "utf8",
    );
    const bundlePath = join(
      catalogDir,
      "videos",
      `${source.videoId}.v1.json`,
    );
    await writeFile(bundlePath, "{\"incomplete\":true}\n", "utf8");

    const result = await synchronizeAmorettoCatalog(
      {
        catalogDir,
        ytDlpPath: "test-path-yt-dlp",
        maxVideos: 1,
        videoId: null,
      },
      {
        now: () => new Date(BASE_TIME),
        fetch: async () =>
          new Response(atomFeedFor(source), {
            status: 200,
            headers: { "content-type": "application/atom+xml; charset=utf-8" },
          }),
        commandRunner: async (_command, arguments_) => {
          if (arguments_.length === 1 && arguments_[0] === "--version") {
            return { stdout: `${PINNED_YT_DLP_VERSION}\n`, stderr: "" };
          }
          const pathsIndex = arguments_.indexOf("--paths");
          assert.notEqual(pathsIndex, -1);
          const outputDirectory = arguments_[pathsIndex + 1];
          await writeFile(
            join(outputDirectory, `${source.videoId}.ko-orig.json3`),
            JSON.stringify({
              events: [
                {
                  tStartMs: 1_000,
                  dDurationMs: 2_000,
                  segs: [{ utf8: "칼국수 이야기를 시작합니다." }],
                },
                {
                  tStartMs: 121_000,
                  dDurationMs: 2_000,
                  segs: [{ utf8: "두바이 초콜릿 반응입니다." }],
                },
              ],
            }),
            "utf8",
          );
          return { stdout: "", stderr: "" };
        },
        visualFingerprintProvider: async ({ video: currentVideo }) =>
          testVisualFingerprintForVideo(currentVideo),
        log: { info() {}, warn() {} },
      },
    );

    assert.deepEqual(result.selectedVideoIds, [source.videoId]);
    assert.equal(result.outcomes[0]?.state, "transcript-ready");
    const finalManifest = JSON.parse(
      await readFile(join(catalogDir, "catalog.json"), "utf8"),
    );
    const closure = await reconcileReadyCatalogArtifacts(finalManifest, {
      catalogDir,
      nowIso: BASE_TIME,
      log: { warn() {} },
    });
    assert.equal(closure.changed, false);
    assert.equal(closure.manifest.videos[0]?.state, "transcript-ready");
    assert.notEqual(await readFile(bundlePath, "utf8"), "{\"incomplete\":true}\n");
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("a chunked oversized Atom feed is rejected before it can grow unbounded", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(64 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });

  await assert.rejects(
    synchronizeAmorettoCatalog(
      {
        catalogDir: join(tmpdir(), "unused-oversized-feed-catalog"),
        ytDlpPath: "test-path-yt-dlp",
        maxVideos: 1,
        videoId: null,
      },
      {
        fetch: async () =>
          new Response(body, {
            status: 200,
            headers: { "content-type": "application/atom+xml; charset=utf-8" },
          }),
        commandRunner: async (_command, arguments_) => {
          assert.deepEqual(arguments_, ["--version"]);
          return { stdout: `${PINNED_YT_DLP_VERSION}\n`, stderr: "" };
        },
      },
    ),
    (error) =>
      error?.code === "FEED_TOO_LARGE" &&
      error.message.includes("byte limit"),
  );
  assert.equal(cancelled, true);
  assert.equal(
    YOUTUBE_CHANNEL_ATOM_FEED_MAX_BYTES,
    512 * 1024,
  );
});

test("an oversized sparse caption file becomes a bounded retry checkpoint", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-caption-size-limit-"),
  );
  try {
    const source = video({
      durationMs: 240_000,
      state: "metadata-ready",
    });
    await mkdir(join(catalogDir, "videos"), { recursive: true });
    await writeFile(
      join(catalogDir, "catalog.json"),
      `${JSON.stringify(manifest([source]), null, 2)}\n`,
      "utf8",
    );

    const result = await synchronizeAmorettoCatalog(
      {
        catalogDir,
        ytDlpPath: "test-path-yt-dlp",
        maxVideos: 1,
        videoId: null,
      },
      {
        now: () => new Date(BASE_TIME),
        fetch: async () =>
          new Response(atomFeedFor(source), {
            status: 200,
            headers: { "content-type": "application/atom+xml; charset=utf-8" },
          }),
        commandRunner: async (_command, arguments_) => {
          if (arguments_.length === 1 && arguments_[0] === "--version") {
            return { stdout: `${PINNED_YT_DLP_VERSION}\n`, stderr: "" };
          }
          const pathsIndex = arguments_.indexOf("--paths");
          assert.notEqual(pathsIndex, -1);
          const outputDirectory = arguments_[pathsIndex + 1];
          const handle = await open(
            join(outputDirectory, `${source.videoId}.ko-orig.json3`),
            "w",
          );
          try {
            await handle.truncate(MAX_CAPTION_JSON3_BYTES + 1);
          } finally {
            await handle.close();
          }
          return { stdout: "", stderr: "" };
        },
        visualFingerprintProvider: async ({ video: currentVideo }) =>
          testVisualFingerprintForVideo(currentVideo),
        log: { info() {}, warn() {} },
      },
    );

    assert.equal(result.outcomes[0]?.state, "retryable");
    assert.equal(
      result.outcomes[0]?.errorCode,
      "CAPTION_FILE_TOO_LARGE",
    );
    assert.equal(
      result.manifest.videos[0]?.retry?.lastSuccessfulState,
      "metadata-ready",
    );
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("scheduled extraction prefers manual ko over automatic ko-orig", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-manual-caption-priority-"),
  );
  try {
    const source = video({
      durationMs: 240_000,
      state: "metadata-ready",
    });
    await mkdir(join(catalogDir, "videos"), { recursive: true });
    await writeFile(
      join(catalogDir, "catalog.json"),
      `${JSON.stringify(manifest([source]), null, 2)}\n`,
      "utf8",
    );

    const result = await synchronizeAmorettoCatalog(
      {
        catalogDir,
        ytDlpPath: "test-path-yt-dlp",
        maxVideos: 1,
        videoId: null,
      },
      {
        now: () => new Date(BASE_TIME),
        fetch: async () =>
          new Response(atomFeedFor(source), {
            status: 200,
            headers: { "content-type": "application/atom+xml; charset=utf-8" },
          }),
        commandRunner: async (_command, arguments_) => {
          if (arguments_.length === 1 && arguments_[0] === "--version") {
            return { stdout: `${PINNED_YT_DLP_VERSION}\n`, stderr: "" };
          }
          const pathsIndex = arguments_.indexOf("--paths");
          assert.notEqual(pathsIndex, -1);
          const outputDirectory = arguments_[pathsIndex + 1];
          const captionJson = (text) =>
            JSON.stringify({
              events: [
                {
                  tStartMs: 1_000,
                  dDurationMs: 2_000,
                  segs: [{ utf8: text }],
                },
              ],
            });
          await writeFile(
            join(outputDirectory, `${source.videoId}.ko-orig.json3`),
            captionJson("자동 생성 자막"),
            "utf8",
          );
          await writeFile(
            join(outputDirectory, `${source.videoId}.ko.json3`),
            captionJson("직접 작성한 자막"),
            "utf8",
          );
          return { stdout: "", stderr: "" };
        },
        visualFingerprintProvider: async ({ video: currentVideo }) =>
          testVisualFingerprintForVideo(currentVideo),
        log: { info() {}, warn() {} },
      },
    );

    assert.equal(result.outcomes[0]?.state, "transcript-ready");
    const bundle = JSON.parse(
      await readFile(
        join(catalogDir, "videos", `${source.videoId}.v1.json`),
        "utf8",
      ),
    );
    assert.equal(bundle.captionTrack.languageCode, "ko");
    assert.equal(bundle.captionTrack.isAutoGenerated, false);
    assert.equal(bundle.captionTrack.events[0]?.text, "직접 작성한 자막");
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("captionless uploads fall back to checkpointed scheduled ASR and reach context-ready", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-scheduled-asr-fallback-"),
  );
  try {
    const source = video({ durationMs: 240_000, state: "metadata-ready" });
    await mkdir(join(catalogDir, "videos"), { recursive: true });
    await writeFile(
      join(catalogDir, "catalog.json"),
      `${JSON.stringify(manifest([source]), null, 2)}\n`,
      "utf8",
    );
    const checkpointPath = join(
      catalogDir,
      ".transcript-checkpoints",
      `${source.videoId}.asr.v2.json`,
    );
    await mkdir(join(catalogDir, ".transcript-checkpoints"), {
      recursive: true,
    });
    await writeFile(checkpointPath, "checkpoint", "utf8");
    let asrCalls = 0;
    let contextCalls = 0;

    const result = await synchronizeAmorettoCatalog(
      {
        catalogDir,
        ytDlpPath: "test-path-yt-dlp",
        maxVideos: 1,
        videoId: null,
        contextProxyUrl: "https://worker.example/v1/broadcast-context",
        contextAuthorizationToken: TEST_CONTEXT_TOKEN,
      },
      {
        now: () => new Date(BASE_TIME),
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.href === AMORETTO_YOUTUBE_CHANNEL_FEED_URL) {
            return new Response(atomFeedFor(source), { status: 200 });
          }
          if (url.pathname === "/v1/broadcast-context") {
            contextCalls += 1;
            return contextSuccessResponseForRequest(
              init,
              completeContextResult(source.durationMs),
            );
          }
          throw new Error(`Unexpected fetch: ${url.href}`);
        },
        commandRunner: async (_command, arguments_) => {
          if (arguments_.length === 1 && arguments_[0] === "--version") {
            return { stdout: `${PINNED_YT_DLP_VERSION}\n`, stderr: "" };
          }
          assert.notEqual(arguments_.indexOf("--write-auto-subs"), -1);
          return { stdout: "", stderr: "" };
        },
        scheduledAsrProvider: async (input) => {
          asrCalls += 1;
          assert.equal(input.sourceId, "amoretto-vods");
          assert.equal(input.videoId, source.videoId);
          assert.equal(input.durationMs, source.durationMs);
          return {
            checkpointPath,
            track: {
              videoId: source.videoId,
              languageCode: "ko-asr",
              isAutoGenerated: true,
              events: [
                { startMs: 0, durationMs: 90_000, text: "첫 구간 전사" },
                {
                  startMs: 90_000,
                  durationMs: 90_000,
                  text: "두 번째 구간 전사",
                },
                {
                  startMs: 180_000,
                  durationMs: 60_000,
                  text: "마지막 구간 전사",
                },
              ],
            },
          };
        },
        visualFingerprintProvider: async ({ video: currentVideo }) =>
          testVisualFingerprintForVideo(currentVideo),
        log: { info() {}, warn() {} },
      },
    );

    assert.equal(asrCalls, 1);
    assert.equal(contextCalls, 3);
    assert.equal(result.outcomes[0]?.state, "context-ready");
    const bundle = JSON.parse(
      await readFile(
        join(catalogDir, "videos", `${source.videoId}.v2.json`),
        "utf8",
      ),
    );
    assert.equal(bundle.provenance.sourceKind, "scheduled-korean-asr");
    assert.equal(
      bundle.contextProvenance.evidenceScope,
      "scheduled-asr-transcript-only",
    );
    await assert.rejects(readFile(checkpointPath), { code: "ENOENT" });
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("a fully covered no-speech ASR track closes transcript-ready without fake caption events", async () => {
  const source = video({ durationMs: 240_000, state: "metadata-ready" });
  const bundle = await createScheduledAsrTranscriptReadyBundle({
    video: source,
    captionTrack: {
      videoId: source.videoId,
      languageCode: "ko-asr",
      isAutoGenerated: true,
      events: [],
    },
    catalogRevision: 4,
    extractedAt: BASE_TIME,
  });

  assert.equal(bundle.state, "transcript-ready");
  assert.deepEqual(bundle.captionTrack.events, []);
  assert.deepEqual(
    bundle.chapters.map(({ startMs, endMs, summaryKo }) => ({
      startMs,
      endMs,
      summaryKo,
    })),
    [
      { startMs: 0, endMs: 120_000, summaryKo: "[대사 없음]" },
      { startMs: 120_000, endMs: 240_000, summaryKo: "[대사 없음]" },
    ],
  );
});

test("a dedicated opt-in context endpoint promotes a durable transcript to revisioned context-ready", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-context-promotion-"),
  );
  try {
    const fixture = await readyCatalogFixture(catalogDir);
    await writeFile(
      join(catalogDir, "catalog.json"),
      `${JSON.stringify(fixture.manifest, null, 2)}\n`,
      "utf8",
    );
    const source = fixture.manifest.videos[0];
    let contextCalls = 0;
    const fetchImplementation = async (input, init) => {
      const url = new URL(String(input));
      if (url.href === AMORETTO_YOUTUBE_CHANNEL_FEED_URL) {
        return new Response(atomFeedFor(source), { status: 200 });
      }
      if (url.pathname === "/v1/broadcast-context") {
        contextCalls += 1;
        const request = JSON.parse(init.body);
        assert.equal(request.sourceId, "amoretto-vods");
        assert.equal(request.sourceChannelId, AMORETTO_YOUTUBE_CHANNEL_ID);
        assert.equal(request.candidates.length, 0);
        assert.equal(request.participantGrounding.status, "sealed");
        assert.equal(
          init.headers.Authorization,
          `Bearer ${TEST_CONTEXT_TOKEN}`,
        );
        assert.equal(
          init.headers[PREANALYSIS_CONTEXT_CONTRACT_HEADER],
          PREANALYSIS_CONTEXT_PROXY_VERSION,
        );
        assert.equal(
          init.headers[PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER],
          AI_BROADCAST_CONTEXT_ROUTING_REVISION,
        );
        const expectedReceipt = createExpectedScheduledContextReceipt(
          request.analysisMode,
        );
        assert.equal(
          init.headers[PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER],
          expectedReceipt.modelId,
        );
        assert.equal(
          init.headers[
            PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER
          ],
          expectedReceipt.modelRevision,
        );
        assert.match(
          init.headers[PREANALYSIS_CONTEXT_OPERATION_HEADER],
          /^channel-context-amoretto-vods-[0-9a-f]{64}$/u,
        );
        assert.match(
          init.headers[PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER],
          /^sha256:[0-9a-f]{64}$/u,
        );
        return contextSuccessResponseForRequest(
          init,
          completeContextResult(source.durationMs),
        );
      }
      throw new Error(`Unexpected fetch: ${url.href}`);
    };

    const result = await synchronizeAmorettoCatalog(
      {
        catalogDir,
        ytDlpPath: "test-path-yt-dlp",
        maxVideos: 1,
        videoId: null,
        contextProxyUrl: "https://worker.example/v1/broadcast-context",
        contextAuthorizationToken: TEST_CONTEXT_TOKEN,
      },
      {
        now: () => new Date(BASE_TIME),
        fetch: fetchImplementation,
        commandRunner: async (_command, arguments_) => {
          assert.deepEqual(arguments_, ["--version"]);
          return { stdout: `${PINNED_YT_DLP_VERSION}\n`, stderr: "" };
        },
        log: { info() {}, warn() {} },
      },
    );

    assert.equal(contextCalls, 3);
    assert.equal(
      result.outcomes[0]?.state,
      "context-ready",
      JSON.stringify(result.outcomes),
    );
    assert.equal(result.manifest.videos[0]?.state, "context-ready");
    assert.equal(
      result.manifest.artifacts.find(({ kind }) => kind === "transcript")
        ?.revision,
      2,
    );
    assert.equal(
      await readFile(fixture.bundlePath, "utf8"),
      fixture.serialized,
    );
    const bundle = JSON.parse(
      await readFile(
        join(catalogDir, "videos", `${fixture.videoId}.v2.json`),
        "utf8",
      ),
    );
    assert.equal(bundle.state, "context-ready");
    const persistedReceipt = bundle.contextProvenance.contextReceipt;
    assert.deepEqual(
      {
        contractVersion: persistedReceipt.contractVersion,
        routingRevision: persistedReceipt.routingRevision,
        modelId: persistedReceipt.modelId,
        modelRevision: persistedReceipt.modelRevision,
      },
      createExpectedScheduledContextReceipt(),
    );
    assert.deepEqual(
      persistedReceipt.componentReceipts.map(
        ({ componentIndex, analysisMode }) => ({
          componentIndex,
          analysisMode,
        }),
      ),
      [
        { componentIndex: 0, analysisMode: "overview" },
        { componentIndex: 1, analysisMode: "discovery" },
        { componentIndex: 2, analysisMode: "discovery" },
      ],
    );
    assert.equal(
      bundle.contextProvenance.evidenceScope,
      "youtube-caption-transcript-only",
    );
    assert.equal(
      bundle.contextProvenance.localVisualVerificationRequired,
      true,
    );
    const closure = await reconcileReadyCatalogArtifacts(result.manifest, {
      catalogDir,
      nowIso: BASE_TIME,
      log: { warn() {} },
    });
    assert.equal(closure.changed, false);
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("schema-valid context bodies without the exact proxy receipt are rejected", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-context-receipt-"),
  );
  try {
    const fixture = await readyCatalogFixture(catalogDir);
    const transcriptBundle = JSON.parse(fixture.serialized);
    const result = completeContextResult(
      fixture.manifest.videos[0].durationMs,
    );
    await assert.rejects(
      requestScheduledBroadcastContext(transcriptBundle, {
        proxyUrl: "https://worker.example/v1/broadcast-context",
        authorizationToken: TEST_CONTEXT_TOKEN,
        fetchImplementation: async () => Response.json(result),
      }),
      (error) => error?.code === "CONTEXT_PROXY_RECEIPT_INVALID",
    );
    await assert.rejects(
      requestScheduledBroadcastContext(transcriptBundle, {
        proxyUrl: "https://worker.example/v1/broadcast-context",
        authorizationToken: TEST_CONTEXT_TOKEN,
        fetchImplementation: async (_input, init) =>
          contextSuccessResponseForRequest(init, result, {
            [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]: "stale-route",
          }),
      }),
      (error) => error?.code === "CONTEXT_PROXY_RECEIPT_INVALID",
    );
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("a bounded Qwen overview fallback receipt is preserved as the actual provenance", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-context-fallback-receipt-"),
  );
  try {
    const fixture = await readyCatalogFixture(catalogDir);
    const transcriptBundle = JSON.parse(fixture.serialized);
    const result = completeContextResult(
      fixture.manifest.videos[0].durationMs,
    );
    const response = await requestScheduledBroadcastContext(transcriptBundle, {
      proxyUrl: "https://worker.example/v1/broadcast-context",
      authorizationToken: TEST_CONTEXT_TOKEN,
      fetchImplementation: async (_input, init) =>
        contextSuccessResponseForRequest(init, result, {
          [PREANALYSIS_CONTEXT_MODEL_ID_HEADER]:
            QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_ID,
          [PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER]:
            QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_REVISION,
          [PREANALYSIS_CONTEXT_ATTEMPT_HEADER]: "2",
          [PREANALYSIS_CONTEXT_RETRY_RISK_HEADER]:
            PREANALYSIS_CONTEXT_POSSIBLE_DUPLICATE_PROVIDER_CHARGE,
        }),
    });
    assert.deepEqual(
      {
        contractVersion: response.contextReceipt.contractVersion,
        routingRevision: response.contextReceipt.routingRevision,
        modelId: response.contextReceipt.modelId,
        modelRevision: response.contextReceipt.modelRevision,
      },
      {
        contractVersion: PREANALYSIS_CONTEXT_PROXY_VERSION,
        routingRevision: AI_BROADCAST_CONTEXT_ROUTING_REVISION,
        modelId: QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_ID,
        modelRevision: QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_REVISION,
      },
    );
    assert.equal(
      response.contextReceipt.componentReceipts[0].modelId,
      QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_ID,
    );
    assert.deepEqual(
      {
        workerAttempt:
          response.contextReceipt.componentReceipts[0].workerAttempt,
        retryRisk: response.contextReceipt.componentReceipts[0].retryRisk,
      },
      {
        workerAttempt: 2,
        retryRisk: PREANALYSIS_CONTEXT_POSSIBLE_DUPLICATE_PROVIDER_CHARGE,
      },
    );
    assert.ok(
      response.contextReceipt.componentReceipts
        .slice(1)
        .every(({ modelId }) => modelId === QWEN_CONTEXT_DISCOVERY_MODEL_ID),
    );
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("overview and three full-coverage discovery requests start together and preserve a discovery-only lead", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-context-parallel-discovery-"),
  );
  try {
    const fixture = await readyCatalogFixture(catalogDir);
    const transcriptBundle = transcriptBundleWithChapterCount(
      JSON.parse(fixture.serialized),
      12,
    );
    const calls = [];
    let releaseRequests;
    const requestGate = new Promise((resolve) => {
      releaseRequests = resolve;
    });
    let discoveryOrdinal = 0;
    const pending = requestScheduledBroadcastContext(transcriptBundle, {
      proxyUrl: "https://worker.example/v1/broadcast-context",
      authorizationToken: TEST_CONTEXT_TOKEN,
      fetchImplementation: async (_input, init) => {
        const request = JSON.parse(init.body);
        calls.push({
          request,
          operationId:
            init.headers[PREANALYSIS_CONTEXT_OPERATION_HEADER],
          payloadDigest:
            init.headers[PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER],
        });
        await requestGate;
        if (request.analysisMode === "overview") {
          return contextSuccessResponse(
            completeContextResult(request.sourceDurationMs),
          );
        }
        discoveryOrdinal += 1;
        const discoveryResult = discoveryContextResult(
          request,
          discoveryOrdinal,
        );
        if (discoveryOrdinal !== 2) {
          discoveryResult.discoveredLeads = [];
        } else {
          discoveryResult.discoveredLeads[0] = {
            ...discoveryResult.discoveredLeads[0],
            leadId: "discovery-dubai-chocolate",
            eventSummaryKo: "두바이 초콜릿을 맛본 뒤 예상 밖의 반응을 보였습니다.",
            evidenceCueKo: "두바이 초콜릿 맛이 생각과 달라서 놀랐어.",
          };
        }
        return contextSuccessResponse(discoveryResult, {}, "discovery");
      },
    });

    for (let turn = 0; turn < 20 && calls.length < 4; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(calls.length, 4);
    assert.deepEqual(
      calls.map(({ request }) => request.analysisMode).sort(),
      ["discovery", "discovery", "discovery", "overview"],
    );
    const overviewChapters = calls.find(
      ({ request }) => request.analysisMode === "overview",
    ).request.chapters;
    assert.deepEqual(
      calls
        .filter(({ request }) => request.analysisMode === "discovery")
        .flatMap(({ request }) => request.chapters),
      overviewChapters,
    );
    assert.equal(new Set(calls.map(({ operationId }) => operationId)).size, 4);
    assert.equal(new Set(calls.map(({ payloadDigest }) => payloadDigest)).size, 4);
    releaseRequests();

    const result = await pending;
    assert.equal(result.broadcastContext.discoveredLeads.length, 1);
    assert.equal(
      result.broadcastContext.discoveredLeads[0]?.leadId,
      "discovery-dubai-chocolate",
    );
    assert.deepEqual(
      result.contextReceipt.componentReceipts.map(
        ({ componentIndex, analysisMode }) => ({
          componentIndex,
          analysisMode,
        }),
      ),
      [
        { componentIndex: 0, analysisMode: "overview" },
        { componentIndex: 1, analysisMode: "discovery" },
        { componentIndex: 2, analysisMode: "discovery" },
        { componentIndex: 3, analysisMode: "discovery" },
      ],
    );
    assert.deepEqual(
      new Set(
        result.contextReceipt.componentReceipts.map(
          ({ operationId }) => operationId,
        ),
      ),
      new Set(calls.map(({ operationId }) => operationId)),
    );
    const contextBundle = await createContextReadyBundle({
      transcriptBundle,
      broadcastContext: result.broadcastContext,
      contextReceipt: result.contextReceipt,
      catalogRevision: 8,
      generatedAt: BASE_TIME,
    });
    assert.deepEqual(
      JSON.parse(serializeBundle(contextBundle)).contextProvenance
        .contextReceipt.componentReceipts,
      result.contextReceipt.componentReceipts,
    );

    for (const forgedReceipt of [
      {
        ...result.contextReceipt,
        componentReceipts: result.contextReceipt.componentReceipts.slice(0, 3),
      },
      {
        ...result.contextReceipt,
        componentReceipts: result.contextReceipt.componentReceipts.map(
          (receipt, index) =>
            index === 1
              ? { ...receipt, modelRevision: "forged-model-revision" }
              : receipt,
        ),
      },
      {
        ...result.contextReceipt,
        componentReceipts: result.contextReceipt.componentReceipts.map(
          (receipt, index) =>
            index === 2
              ? {
                  ...receipt,
                  payloadDigest:
                    "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                }
              : receipt,
        ),
      },
      {
        ...result.contextReceipt,
        componentReceipts: result.contextReceipt.componentReceipts.map(
          (receipt, index) =>
            index === 2
              ? {
                  ...receipt,
                  operationId:
                    result.contextReceipt.componentReceipts[1].operationId,
                }
              : receipt,
        ),
      },
      {
        ...result.contextReceipt,
        componentReceipts: result.contextReceipt.componentReceipts.map(
          (receipt, index) =>
            index === 1 ? { ...receipt, workerAttempt: 0 } : receipt,
        ),
      },
      {
        ...result.contextReceipt,
        componentReceipts: result.contextReceipt.componentReceipts.map(
          (receipt, index) =>
            index === 1 ? { ...receipt, retryRisk: "unknown-risk" } : receipt,
        ),
      },
    ]) {
      await assert.rejects(
        createContextReadyBundle({
          transcriptBundle,
          broadcastContext: result.broadcastContext,
          contextReceipt: forgedReceipt,
          catalogRevision: 8,
          generatedAt: BASE_TIME,
        }),
        (error) => error?.code === "CONTEXT_PROXY_RECEIPT_INVALID",
      );
    }
    assert.match(
      result.broadcastContext.discoveredLeads[0]?.eventSummaryKo ?? "",
      /두바이 초콜릿/u,
    );
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("rate-limited context pieces retry the exact same operation after Retry-After", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-context-rate-limit-recovery-"),
  );
  try {
    const fixture = await readyCatalogFixture(catalogDir);
    const transcriptBundle = transcriptBundleWithChapterCount(
      JSON.parse(fixture.serialized),
      12,
    );
    const attemptsByOperation = new Map();
    const observedByOperation = new Map();
    const waitedMs = [];
    const result = await requestScheduledBroadcastContext(transcriptBundle, {
      proxyUrl: "https://worker.example/v1/broadcast-context",
      authorizationToken: TEST_CONTEXT_TOKEN,
      waitImplementation: async (delayMs) => {
        waitedMs.push(delayMs);
      },
      fetchImplementation: async (_input, init) => {
        const operationId =
          init.headers[PREANALYSIS_CONTEXT_OPERATION_HEADER];
        const priorAttempt = attemptsByOperation.get(operationId) ?? 0;
        attemptsByOperation.set(operationId, priorAttempt + 1);
        const observed = observedByOperation.get(operationId) ?? [];
        observed.push({
          body: init.body,
          digest: init.headers[PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER],
        });
        observedByOperation.set(operationId, observed);
        if (priorAttempt === 0) {
          return Response.json(
            { error: { code: "RATE_LIMITED" } },
            { status: 429, headers: { "Retry-After": "7" } },
          );
        }
        return contextSuccessResponseForRequest(init);
      },
    });

    assert.equal(result.broadcastContext.schemaVersion, BROADCAST_CONTEXT_SCHEMA_VERSION);
    assert.equal(attemptsByOperation.size, 4);
    assert.deepEqual([...attemptsByOperation.values()], [2, 2, 2, 2]);
    assert.deepEqual(waitedMs, [7_000, 7_000, 7_000, 7_000]);
    for (const observed of observedByOperation.values()) {
      assert.equal(observed.length, 2);
      assert.deepEqual(observed[0], observed[1]);
    }
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

async function assertScheduledContextCheckpointIsReplayed({
  status,
  code,
  retryAfterSeconds,
  responseHeaders = {},
}) {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-context-checkpoint-recovery-"),
  );
  try {
    const fixture = await readyCatalogFixture(catalogDir);
    const transcriptBundle = transcriptBundleWithChapterCount(
      JSON.parse(fixture.serialized),
      12,
    );
    const attemptsByOperation = new Map();
    const observedByOperation = new Map();
    const waitedMs = [];
    await requestScheduledBroadcastContext(transcriptBundle, {
      proxyUrl: "https://worker.example/v1/broadcast-context",
      authorizationToken: TEST_CONTEXT_TOKEN,
      waitImplementation: async (delayMs) => {
        waitedMs.push(delayMs);
      },
      fetchImplementation: async (_input, init) => {
        const operationId =
          init.headers[PREANALYSIS_CONTEXT_OPERATION_HEADER];
        const priorAttempt = attemptsByOperation.get(operationId) ?? 0;
        attemptsByOperation.set(operationId, priorAttempt + 1);
        const observed = observedByOperation.get(operationId) ?? [];
        observed.push({
          operationId,
          body: init.body,
          digest: init.headers[PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER],
        });
        observedByOperation.set(operationId, observed);
        if (priorAttempt === 0) {
          return Response.json(
            { error: { code } },
            {
              status,
              headers: {
                "Retry-After": String(retryAfterSeconds),
                ...responseHeaders,
              },
            },
          );
        }
        return contextSuccessResponseForRequest(init);
      },
    });

    assert.deepEqual([...attemptsByOperation.values()], [2, 2, 2, 2]);
    assert.deepEqual(
      waitedMs,
      Array.from({ length: 4 }, () => retryAfterSeconds * 1_000),
    );
    for (const observed of observedByOperation.values()) {
      assert.deepEqual(observed[0], observed[1]);
    }
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
}

test("an in-progress 409 checkpoint replays the exact scheduled context operation", async () => {
  await assertScheduledContextCheckpointIsReplayed({
    status: 409,
    code: "OPERATION_IN_PROGRESS",
    retryAfterSeconds: 2,
  });
});

test("a backoff 503 checkpoint replays the exact scheduled context operation", async () => {
  await assertScheduledContextCheckpointIsReplayed({
    status: 503,
    code: "RETRY_BACKOFF",
    retryAfterSeconds: 3,
  });
});

test("free-tier recovery replays a newly checkpointed risky provider 503", async () => {
  await assertScheduledContextCheckpointIsReplayed({
    status: 503,
    code: "UPSTREAM_UNAVAILABLE",
    retryAfterSeconds: 4,
    responseHeaders: {
      [PREANALYSIS_CONTEXT_ATTEMPT_HEADER]: "1",
      [PREANALYSIS_CONTEXT_RETRY_RISK_HEADER]:
        PREANALYSIS_CONTEXT_POSSIBLE_DUPLICATE_PROVIDER_CHARGE,
    },
  });
});

test("strict-paid refuses an automatic provider retry carrying duplicate-charge risk", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-context-strict-paid-"),
  );
  try {
    const fixture = await readyCatalogFixture(catalogDir);
    const transcriptBundle = transcriptBundleWithChapterCount(
      JSON.parse(fixture.serialized),
      12,
    );
    let requestCount = 0;
    const waitedMs = [];
    await assert.rejects(
      requestScheduledBroadcastContext(transcriptBundle, {
        proxyUrl: "https://worker.example/v1/broadcast-context",
        authorizationToken: TEST_CONTEXT_TOKEN,
        providerRetryPolicy: "strict-paid",
        waitImplementation: async (delayMs) => {
          waitedMs.push(delayMs);
        },
        fetchImplementation: async () => {
          requestCount += 1;
          return Response.json(
            { error: { code: "UPSTREAM_UNAVAILABLE" } },
            {
              status: 503,
              headers: {
                "Retry-After": "4",
                [PREANALYSIS_CONTEXT_ATTEMPT_HEADER]: "1",
                [PREANALYSIS_CONTEXT_RETRY_RISK_HEADER]:
                  PREANALYSIS_CONTEXT_POSSIBLE_DUPLICATE_PROVIDER_CHARGE,
              },
            },
          );
        },
      }),
      (error) => error?.code === "UPSTREAM_UNAVAILABLE",
    );
    for (let turn = 0; turn < 20 && requestCount < 4; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(requestCount, 4);
    assert.deepEqual(waitedMs, []);
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("strict-paid still polls safe in-progress and backoff checkpoints", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-context-strict-paid-safe-"),
  );
  try {
    const fixture = await readyCatalogFixture(catalogDir);
    const transcriptBundle = transcriptBundleWithChapterCount(
      JSON.parse(fixture.serialized),
      12,
    );
    for (const checkpoint of [
      { status: 409, code: "OPERATION_IN_PROGRESS" },
      { status: 503, code: "RETRY_BACKOFF" },
    ]) {
      const attemptsByOperation = new Map();
      await requestScheduledBroadcastContext(transcriptBundle, {
        proxyUrl: "https://worker.example/v1/broadcast-context",
        authorizationToken: TEST_CONTEXT_TOKEN,
        providerRetryPolicy: "strict-paid",
        waitImplementation: async () => undefined,
        fetchImplementation: async (_input, init) => {
          const operationId =
            init.headers[PREANALYSIS_CONTEXT_OPERATION_HEADER];
          const priorAttempt = attemptsByOperation.get(operationId) ?? 0;
          attemptsByOperation.set(operationId, priorAttempt + 1);
          return priorAttempt === 0
            ? Response.json(
                { error: { code: checkpoint.code } },
                {
                  status: checkpoint.status,
                  headers: { "Retry-After": "1" },
                },
              )
            : contextSuccessResponseForRequest(init);
        },
      });
      assert.deepEqual([...attemptsByOperation.values()], [2, 2, 2, 2]);
    }
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("a permanent route 409 is not retried even when it carries Retry-After", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-context-permanent-conflict-"),
  );
  try {
    const fixture = await readyCatalogFixture(catalogDir);
    const transcriptBundle = transcriptBundleWithChapterCount(
      JSON.parse(fixture.serialized),
      12,
    );
    let requestCount = 0;
    const waitedMs = [];
    await assert.rejects(
      requestScheduledBroadcastContext(transcriptBundle, {
        proxyUrl: "https://worker.example/v1/broadcast-context",
        authorizationToken: TEST_CONTEXT_TOKEN,
        waitImplementation: async (delayMs) => {
          waitedMs.push(delayMs);
        },
        fetchImplementation: async () => {
          requestCount += 1;
          return Response.json(
            { error: { code: "PROXY_ROUTE_MISMATCH" } },
            { status: 409, headers: { "Retry-After": "1" } },
          );
        },
      }),
      (error) => error?.code === "PROXY_ROUTE_MISMATCH",
    );
    for (let turn = 0; turn < 20 && requestCount < 4; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(requestCount, 4);
    assert.deepEqual(waitedMs, []);
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("a bounded allowlisted provider diagnostic survives a failed context response", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-context-diagnostic-"),
  );
  try {
    const fixture = await readyCatalogFixture(catalogDir);
    const transcriptBundle = JSON.parse(fixture.serialized);
    const diagnostic =
      "primary-code=UPSTREAM_INVALID_RESPONSE|model=qwen3.7-plus;stage=chapter-normalization;finish=stop;json=1;keys=summary+host+themes+chapters+candidates+leads;extra=0;chars=1234|fallback-code=UPSTREAM_INVALID_RESPONSE|model=qwen3.6-flash;stage=lead-item;finish=stop;json=1;keys=summary+host+themes+chapters+candidates+leads;extra=0;chars=999";
    await assert.rejects(
      requestScheduledBroadcastContext(transcriptBundle, {
        proxyUrl: "https://worker.example/v1/broadcast-context",
        authorizationToken: TEST_CONTEXT_TOKEN,
        fetchImplementation: async () =>
          Response.json(
            {
              error: {
                code: "UPSTREAM_INVALID_RESPONSE",
                message: "The provider response did not satisfy the schema.",
                diagnostic,
              },
            },
            { status: 502 },
          ),
      }),
      (error) =>
        error?.code === "UPSTREAM_INVALID_RESPONSE" &&
        error.message.includes(`Provider diagnostic: ${diagnostic}`),
    );
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("the context request deadline includes a response body that never finishes", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-context-body-timeout-"),
  );
  try {
    const fixture = await readyCatalogFixture(catalogDir);
    const transcriptBundle = JSON.parse(fixture.serialized);
    await assert.rejects(
      requestScheduledBroadcastContext(transcriptBundle, {
        proxyUrl: "https://worker.example/v1/broadcast-context",
        authorizationToken: TEST_CONTEXT_TOKEN,
        requestTimeoutMs: 20,
        fetchImplementation: async (_input, init) => {
          const request = JSON.parse(init.body);
          const expectedReceipt = createExpectedScheduledContextReceipt(
            request.analysisMode,
          );
          return new Response(new ReadableStream({ start() {} }), {
            status: 200,
            headers: {
              [PREANALYSIS_CONTEXT_CONTRACT_HEADER]:
                PREANALYSIS_CONTEXT_PROXY_VERSION,
              [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]:
                AI_BROADCAST_CONTEXT_ROUTING_REVISION,
              [PREANALYSIS_CONTEXT_MODEL_ID_HEADER]:
                expectedReceipt.modelId,
              [PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER]:
                expectedReceipt.modelRevision,
              [PREANALYSIS_CONTEXT_ATTEMPT_HEADER]: "1",
            },
          });
        },
      }),
      (error) => error?.code === "CONTEXT_REQUEST_TIMEOUT",
    );
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("a crash after immutable context write resumes from v2 without rebilling or losing v1", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-context-orphan-recovery-"),
  );
  try {
    const fixture = await readyCatalogFixture(catalogDir);
    await writeFile(
      join(catalogDir, "catalog.json"),
      `${JSON.stringify(fixture.manifest, null, 2)}\n`,
      "utf8",
    );
    const source = fixture.manifest.videos[0];
    const transcriptBundle = JSON.parse(fixture.serialized);
    const contextOutcome = await scheduledContextOutcomeForBundle(
      transcriptBundle,
      completeContextResult(source.durationMs),
    );
    const contextBundle = await createContextReadyBundle({
      transcriptBundle,
      broadcastContext: contextOutcome.broadcastContext,
      contextReceipt: contextOutcome.contextReceipt,
      catalogRevision: fixture.manifest.revision + 1,
      generatedAt: BASE_TIME,
    });
    const serializedContext = serializeBundle(contextBundle);
    const contextPath = join(
      catalogDir,
      "videos",
      `${fixture.videoId}.v2.json`,
    );
    await writeFile(contextPath, serializedContext, "utf8");
    let contextCalls = 0;

    const result = await synchronizeAmorettoCatalog(
      {
        catalogDir,
        ytDlpPath: "test-path-yt-dlp",
        maxVideos: 1,
        videoId: null,
        contextProxyUrl: "https://worker.example/v1/broadcast-context",
        contextAuthorizationToken: TEST_CONTEXT_TOKEN,
      },
      {
        now: () => new Date(BASE_TIME),
        fetch: async (input) => {
          const url = new URL(String(input));
          if (url.href === AMORETTO_YOUTUBE_CHANNEL_FEED_URL) {
            return new Response(atomFeedFor(source), { status: 200 });
          }
          contextCalls += 1;
          throw new Error(`Unexpected billable request: ${url.href}`);
        },
        commandRunner: async (_command, arguments_) => {
          assert.deepEqual(arguments_, ["--version"]);
          return { stdout: `${PINNED_YT_DLP_VERSION}\n`, stderr: "" };
        },
        log: { info() {}, warn() {} },
      },
    );

    assert.equal(contextCalls, 0);
    assert.equal(result.outcomes[0]?.state, "context-ready");
    assert.equal(
      result.manifest.artifacts.find(({ kind }) => kind === "transcript")
        ?.revision,
      2,
    );
    assert.equal(
      await readFile(fixture.bundlePath, "utf8"),
      fixture.serialized,
    );
    assert.equal(await readFile(contextPath, "utf8"), serializedContext);
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("the shared foreground Worker is never accepted as the scheduled context lane", async () => {
  await assert.rejects(
    synchronizeAmorettoCatalog({
      catalogDir: "/unused",
      ytDlpPath: "test-path-yt-dlp",
      maxVideos: 1,
      videoId: null,
      contextProxyUrl:
        "https://rettohighlight-gemini.11qaws.workers.dev/v1/broadcast-context",
      contextAuthorizationToken: TEST_CONTEXT_TOKEN,
    }),
    (error) =>
      error?.code === "INVALID_ARGUMENT" &&
      /foreground five-editor Worker/u.test(error.message),
  );
});

test("a failed context call checkpoints only context and resumes from the preserved transcript", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-context-retry-"),
  );
  try {
    const fixture = await readyCatalogFixture(catalogDir);
    await writeFile(
      join(catalogDir, "catalog.json"),
      `${JSON.stringify(fixture.manifest, null, 2)}\n`,
      "utf8",
    );
    const source = fixture.manifest.videos[0];
    const contextProxyUrl =
      "https://worker.example/v1/broadcast-context";
    const operationIds = [];
    const fetchForContext = (contextResponder) =>
      async (input, init) => {
        const url = new URL(String(input));
        if (url.href === AMORETTO_YOUTUBE_CHANNEL_FEED_URL) {
          return new Response(atomFeedFor(source), { status: 200 });
        }
        if (url.pathname === "/v1/broadcast-context") {
          assert.equal(
            init.headers.Authorization,
            `Bearer ${TEST_CONTEXT_TOKEN}`,
          );
          operationIds.push(
            init.headers[PREANALYSIS_CONTEXT_OPERATION_HEADER],
          );
          return contextResponder(init);
        }
        throw new Error(`Unexpected fetch: ${url.href}`);
      };
    const commandRunner = async (_command, arguments_) => {
      assert.deepEqual(arguments_, ["--version"]);
      return { stdout: `${PINNED_YT_DLP_VERSION}\n`, stderr: "" };
    };

    const failed = await synchronizeAmorettoCatalog(
      {
        catalogDir,
        ytDlpPath: "test-path-yt-dlp",
        maxVideos: 1,
        videoId: null,
        contextProxyUrl,
        contextAuthorizationToken: TEST_CONTEXT_TOKEN,
      },
      {
        now: () => new Date(BASE_TIME),
        fetch: fetchForContext(() =>
          Response.json(
            { error: { code: "UPSTREAM_UNAVAILABLE" } },
            { status: 503 },
          ),
        ),
        commandRunner,
        log: { info() {}, warn() {} },
      },
    );
    assert.equal(failed.outcomes[0]?.state, "retryable");
    assert.equal(failed.manifest.videos[0]?.retry?.stage, "context");
    assert.equal(
      failed.manifest.videos[0]?.retry?.lastSuccessfulState,
      "transcript-ready",
    );
    assert.equal(
      await readFile(fixture.bundlePath, "utf8"),
      fixture.serialized,
    );
    const verifiedRetry = await verifyPersistedChannelCatalogSnapshot(
      catalogDir,
      AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
    );
    assert.equal(verifiedRetry.videos[0]?.state, "retryable");
    assert.equal(
      verifiedRetry.videos[0]?.retry?.lastSuccessfulState,
      "transcript-ready",
    );

    const resumedAt = "2026-07-30T03:01:00.000Z";
    const resumed = await synchronizeAmorettoCatalog(
      {
        catalogDir,
        ytDlpPath: "test-path-yt-dlp",
        maxVideos: 1,
        videoId: null,
        contextProxyUrl,
        contextAuthorizationToken: TEST_CONTEXT_TOKEN,
      },
      {
        now: () => new Date(resumedAt),
        fetch: fetchForContext((init) =>
          contextSuccessResponseForRequest(
            init,
            completeContextResult(source.durationMs),
          )),
        commandRunner,
        log: { info() {}, warn() {} },
      },
    );
    assert.equal(
      resumed.outcomes[0]?.state,
      "context-ready",
      JSON.stringify(resumed.outcomes),
    );
    assert.equal(resumed.manifest.videos[0]?.state, "context-ready");
    assert.equal(
      resumed.manifest.artifacts.find(({ kind }) => kind === "transcript")
        ?.revision,
      2,
    );
    assert.equal(operationIds.length, 6);
    assert.deepEqual(operationIds.slice(0, 3), operationIds.slice(3));
    assert.equal(
      await readFile(fixture.bundlePath, "utf8"),
      fixture.serialized,
    );
    assert.equal(
      JSON.parse(
        await readFile(
          join(catalogDir, "videos", `${fixture.videoId}.v2.json`),
          "utf8",
        ),
      ).state,
      "context-ready",
    );
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("a context retry is durably restored to transcript-ready when context secrets are absent", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-context-disabled-repair-"),
  );
  try {
    const fixture = await readyCatalogFixture(catalogDir);
    const readyVideo = fixture.manifest.videos[0];
    const retryVideo = {
      ...readyVideo,
      state: "retryable",
      revision: readyVideo.revision + 1,
      retry: {
        stage: "context",
        lastSuccessfulState: "transcript-ready",
        attemptCount: 1,
        nextAttemptAt: BASE_TIME,
        errorCode: "UPSTREAM_UNAVAILABLE",
      },
    };
    const retryManifest = {
      ...fixture.manifest,
      revision: fixture.manifest.revision + 1,
      videos: [retryVideo],
    };
    await writeFile(
      join(catalogDir, "catalog.json"),
      `${JSON.stringify(retryManifest, null, 2)}\n`,
      "utf8",
    );

    const result = await synchronizeAmorettoCatalog(
      {
        catalogDir,
        ytDlpPath: "test-path-yt-dlp",
        maxVideos: 1,
        videoId: null,
        contextProxyUrl: null,
        contextAuthorizationToken: null,
      },
      {
        now: () => new Date(BASE_TIME),
        fetch: async (input) => {
          const url = new URL(String(input));
          assert.equal(url.href, AMORETTO_YOUTUBE_CHANNEL_FEED_URL);
          return new Response(atomFeedFor(retryVideo), { status: 200 });
        },
        commandRunner: async (_command, arguments_) => {
          assert.deepEqual(arguments_, ["--version"]);
          return { stdout: `${PINNED_YT_DLP_VERSION}\n`, stderr: "" };
        },
        log: { info() {}, warn() {} },
      },
    );

    assert.equal(result.outcomes[0]?.state, "transcript-ready");
    assert.equal(result.manifest.videos[0]?.state, "transcript-ready");
    assert.equal(result.manifest.videos[0]?.retry, null);
    const persisted = JSON.parse(
      await readFile(join(catalogDir, "catalog.json"), "utf8"),
    );
    assert.equal(persisted.videos[0]?.state, "transcript-ready");
    assert.equal(persisted.videos[0]?.retry, null);
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("an empty catalog starts with the pinned source contract", () => {
  assert.deepEqual(createEmptyCatalog(BASE_TIME), {
    schemaVersion: 1,
    channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
    channelHandle: AMORETTO_YOUTUBE_CHANNEL_HANDLE,
    revision: 1,
    generatedAt: BASE_TIME,
    videos: [],
    artifacts: [],
  });
});

test("classifies yt-dlp failures so a tightening egress can be counted", () => {
  // The exact string the runner received before WARP was in place.
  assert.equal(
    classifyYtDlpFailure(
      "yt-dlp failed (1): ERROR: [youtube] EZfCGS5ms_Q: Sign in to confirm you’re not a bot. Use --cookies-from-browser",
    ),
    "botwall",
  );
  assert.equal(classifyYtDlpFailure("ERROR: Video unavailable"), "unavailable");
  assert.equal(classifyYtDlpFailure("ERROR: unable to connect: timed out"), "network");
  assert.equal(classifyYtDlpFailure("something nobody has seen yet"), "unknown");
  assert.equal(classifyYtDlpFailure(""), "unknown");
  assert.equal(classifyYtDlpFailure(null), "unknown");
  // Order matters: a botwall that also mentions availability stays a botwall,
  // because the two demand opposite operator responses.
  assert.equal(
    classifyYtDlpFailure("Video unavailable. Sign in to confirm you're not a bot."),
    "botwall",
  );
});
