import { readFileSync, writeFileSync } from "node:fs";

import {
  buildEventEpisodes,
  selectContextAwareCandidates,
} from "../src/analysis/contextAwareCandidateSelection.ts";
import { createBroadcastContextRequest } from "../src/analysis/broadcastContextProtocol.ts";
import { mapWithConcurrency } from "../src/analysis/boundedAsyncMap.ts";
import {
  createBroadcastTopicalLeadJuryPlan,
  createBroadcastTopicalDiscoverySlices,
  mergeBroadcastTopicalDiscoveryLeads,
  selectBroadcastTopicalRefinementLeadIds,
} from "../src/analysis/broadcastTopicalDiscovery.ts";
import {
  createCaptionDiscoveredLeadRefinementPlan,
  createDiscoveredLeadRefinementChapters,
} from "../src/analysis/discoveredLeadRefinement.ts";
import { calculateTemporalEventDensity } from "../src/analysis/temporalPointProcess.ts";
import {
  YOUTUBE_VIDEO_ID_PATTERN,
  createYouTubeCaptionChapters,
  createYouTubeCaptionRefinementTranscripts,
} from "../src/analysis/youtubeCaptionTrack.ts";

const videoId = process.argv[2] ?? "";
const sourceDurationMs = Number(process.argv[3]);
const fastPassPath = process.argv[4] === "-" ? null : (process.argv[4] ?? null);
const outputPath = process.argv[5] ?? null;
const runRefinement = process.argv[6] === "--refine";
const workerOrigin = "https://rettohighlight-gemini.11qaws.workers.dev";
const allowedOrigin = "https://11qaws.github.io";

if (
  !YOUTUBE_VIDEO_ID_PATTERN.test(videoId) ||
  !Number.isSafeInteger(sourceDurationMs) ||
  sourceDurationMs <= 0 ||
  sourceDurationMs > 12 * 60 * 60_000
) {
  throw new Error(
    "Usage: tsx scripts/evaluate-live-caption-context.mjs <youtube-id> <duration-ms> [fast-pass.json|-] [output.json] [--refine]",
  );
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/u, ""));
}

function estimatedTextCostUsd(metadata) {
  const prices = metadata.modelId === "qwen3.7-plus"
    ? { input: 0.4, output: 1.6 }
    : metadata.modelId === "qwen3.6-flash"
      ? { input: 0.25, output: 1.5 }
      : null;
  const usage = metadata.usage;
  if (
    prices === null ||
    usage.promptTokens === null ||
    usage.completionTokens === null
  ) {
    return null;
  }
  return Math.round(
    ((usage.promptTokens * prices.input +
      usage.completionTokens * prices.output) /
      1_000_000) *
      1_000_000,
  ) / 1_000_000;
}

function boundedText(values, maximumLength) {
  const normalized = values
    .join(" ")
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(normalized).slice(0, maximumLength).join("").trim();
}

function captionTextForRange(track, startMs, endMs, maximumLength) {
  return boundedText(
    track.events
      .filter(
        (event) =>
          event.startMs < endMs &&
          event.startMs + event.durationMs >= startMs,
      )
      .map((event) => event.text),
    maximumLength,
  );
}

function buildFastPassCandidates(track) {
  if (fastPassPath === null) return { candidates: [], selection: null };
  const fastPass = readJson(fastPassPath);
  if (
    Number(fastPass.sourceDurationMs) !== sourceDurationMs ||
    !Array.isArray(fastPass.candidates)
  ) {
    throw new Error("The fast-pass fixture does not match the requested source.");
  }
  const reservoir = fastPass.candidates.map((candidate, index) => ({
    id: `fast-pass-${String(index + 1).padStart(2, "0")}`,
    startMs: Math.round(Number(candidate.startMs)),
    peakMs: Math.round(Number(candidate.peakMs)),
    endMs: Math.round(Number(candidate.endMs)),
    score: Number(candidate.score),
    signalKinds: ["audio"],
    evidence: candidate.evidence,
  }));
  const episodes = buildEventEpisodes(reservoir);
  const density = calculateTemporalEventDensity(
    episodes.map((episode) => episode.peakMs),
    sourceDurationMs,
  );
  const selection = selectContextAwareCandidates(
    reservoir,
    sourceDurationMs,
    density.bins,
    [],
    {
      detailAnalysisBudget: 12,
      explorationShare: 0.15,
      qualityLambda: 0.75,
    },
  );
  return {
    candidates: selection.candidates.map((candidate) => ({
      candidateId: candidate.id,
      startMs: candidate.startMs,
      endMs: candidate.endMs,
      transcriptKo: captionTextForRange(
        track,
        candidate.startMs,
        candidate.endMs,
        12_000,
      ),
      eventSummaryKo: "빠른 오디오 탐색에서 반응 가능성이 표시된 구간이다.",
      reactionSummaryKo: "전체 방송 대사 맥락으로 실제 사건과 반응을 판정해야 한다.",
      chatReactionSummaryKo: null,
    })),
    selection: {
      summary: selection.summary,
      diagnostics: selection.diagnostics,
      density: density.diagnostics,
    },
  };
}

async function requestContext(input, analysisMode = "overview") {
  const request = createBroadcastContextRequest(input);
  const startedAt = performance.now();
  const response = await fetch(`${workerOrigin}/v1/broadcast-context`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: allowedOrigin,
    },
    body: JSON.stringify({
      sourceDurationMs: request.sourceDurationMs,
      chapters: request.chapters,
      candidates: request.candidates,
      ...(analysisMode === "overview" ? {} : { analysisMode }),
    }),
    cache: "no-store",
  });
  const metadata = {
    status: response.status,
    elapsedMs: Math.round(performance.now() - startedAt),
    modelId: response.headers.get("X-ExClipper-Model-Id"),
    modelRevision: response.headers.get("X-ExClipper-Model-Revision"),
    fallbackUsed:
      response.headers.get("X-ExClipper-Fallback-Used") === "true",
    usage: {
      promptTokens: Number(
        response.headers.get("X-ExClipper-Usage-Prompt-Tokens"),
      ) || null,
      completionTokens: Number(
        response.headers.get("X-ExClipper-Usage-Completion-Tokens"),
      ) || null,
      totalTokens: Number(
        response.headers.get("X-ExClipper-Usage-Total-Tokens"),
      ) || null,
    },
  };
  const result = await response.json();
  if (!response.ok) {
    throw new Error(
      `Context request failed with HTTP ${response.status}: ${result?.error?.code ?? "unknown"} (${result?.error?.message ?? "no message"})`,
    );
  }
  return { metadata, result };
}

let captionResponse = null;
let captionPayload = null;
for (let attempt = 0; attempt < 3; attempt += 1) {
  captionResponse = await fetch(
    `${workerOrigin}/v1/youtube-captions?v=${encodeURIComponent(videoId)}`,
    {
      method: "GET",
      headers: { Origin: allowedOrigin },
      cache: "no-store",
    },
  );
  captionPayload = await captionResponse.json();
  if (captionResponse.ok) break;
  if (![429, 502, 503].includes(captionResponse.status) || attempt === 2) {
    throw new Error(
      `Caption request failed with HTTP ${captionResponse.status}: ${captionPayload?.error?.code ?? "unknown"}`,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1_000));
}
if (captionResponse === null || !captionResponse.ok || captionPayload === null) {
  throw new Error("Caption request did not produce a usable response.");
}

const chapters = createYouTubeCaptionChapters(captionPayload, sourceDurationMs);
if (chapters.length === 0) {
  throw new Error("The production caption chapter builder returned no chapters.");
}
const fastPass = buildFastPassCandidates(captionPayload);
const overview = await requestContext({
  sourceDurationMs,
  chapters,
  candidates: fastPass.candidates,
});
const discoverySlices = createBroadcastTopicalDiscoverySlices(
  chapters,
  overview.result.semanticChapters,
);
const discoveryAttempts = await Promise.allSettled(
  discoverySlices.map((slice) =>
    requestContext(
      { sourceDurationMs, chapters: slice.chapters, candidates: [] },
      "discovery",
    ).then((value) => ({ sliceId: slice.sliceId, ...value })),
  ),
);
const successfulDiscoveries = discoveryAttempts.flatMap((attempt) =>
  attempt.status === "fulfilled" ? [attempt.value] : [],
);
const result = {
  ...overview.result,
  discoveredLeads: mergeBroadcastTopicalDiscoveryLeads([
    overview.result.discoveredLeads,
    ...successfulDiscoveries.map((discovery) => discovery.result.discoveredLeads),
  ]),
};
const juryPlan = createBroadcastTopicalLeadJuryPlan(
  sourceDurationMs,
  result.broadcastSummaryKo,
  result.semanticChapters,
  result.discoveredLeads,
);
const jury = juryPlan.candidates.length === 0
  ? null
  : await requestContext(
      {
        sourceDurationMs,
        chapters: juryPlan.chapters,
        candidates: juryPlan.candidates,
      },
      "selection",
    );
const refinementLeadIds = jury === null
  ? []
  : selectBroadcastTopicalRefinementLeadIds(
      result.discoveredLeads,
      juryPlan,
      jury.result.annotations,
      result.semanticChapters,
    );
const refinementLeads = refinementLeadIds.flatMap((leadId) => {
  const lead = result.discoveredLeads.find((item) => item.leadId === leadId);
  return lead === undefined ? [] : [lead];
});
const refinementPlan = createCaptionDiscoveredLeadRefinementPlan(
  refinementLeads,
  { preserveInputOrder: true },
);
const refinementTranscripts = createYouTubeCaptionRefinementTranscripts(
  captionPayload,
  refinementPlan,
);
const refinementCalls = runRefinement
  ? await mapWithConcurrency(refinementPlan.selectedLeadIds, 3, async (leadId) => {
      const refinementChapters = createDiscoveredLeadRefinementChapters(
        leadId,
        refinementPlan,
        refinementTranscripts,
        (() => {
          const parent = refinementLeads.find((lead) => lead.leadId === leadId);
          return parent === undefined
            ? ""
            : `${parent.eventSummaryKo} / ${parent.evidenceCueKo}`;
        })(),
      );
      if (refinementChapters.length === 0) {
        return { leadId, skipped: true, metadata: null, leads: [] };
      }
      const refined = await requestContext(
        {
          sourceDurationMs,
          chapters: refinementChapters,
          candidates: [],
        },
        "refinement",
      );
      return {
        leadId,
        skipped: false,
        metadata: refined.metadata,
        leads: refined.result.discoveredLeads,
      };
    })
  : [];
const overviewCostUsd = estimatedTextCostUsd(overview.metadata);
const topicalCostUsd = successfulDiscoveries.reduce(
  (sum, discovery) => sum + (estimatedTextCostUsd(discovery.metadata) ?? 0),
  0,
);
const juryCostUsd = jury === null ? 0 : (estimatedTextCostUsd(jury.metadata) ?? 0);
const refinementCostUsd = refinementCalls.reduce(
  (sum, call) => sum + (call.metadata === null ? 0 : (estimatedTextCostUsd(call.metadata) ?? 0)),
  0,
);

const requestCharacterCount = chapters.reduce(
  (sum, chapter) => sum + Array.from(chapter.summaryKo).length,
  0,
);
const serializedResult = `${JSON.stringify(
    {
      videoId,
      sourceDurationMs,
      captionEventCount: captionPayload.events.length,
      chapterCount: chapters.length,
      requestCharacterCount,
      fastPassSelection: fastPass.selection,
      candidateCount: fastPass.candidates.length,
      responseMetadata: overview.metadata,
      estimatedListPriceTextCostUsd: {
        overview: overviewCostUsd,
        topicalDiscovery: Math.round(topicalCostUsd * 1_000_000) / 1_000_000,
        editorialJury: Math.round(juryCostUsd * 1_000_000) / 1_000_000,
        refinement: Math.round(refinementCostUsd * 1_000_000) / 1_000_000,
        total:
          overviewCostUsd === null
            ? null
            : Math.round(
                (overviewCostUsd + topicalCostUsd + juryCostUsd + refinementCostUsd) *
                  1_000_000,
              ) /
              1_000_000,
      },
      topicalJury: {
        consideredCount: juryPlan.candidates.length,
        metadata: jury?.metadata ?? null,
        annotations: jury?.result.annotations ?? [],
        refinementLeadIds,
        refinementLeads,
        refinement: {
          requested: runRefinement,
          selectedLeadCount: refinementPlan.selectedLeadIds.length,
          calls: refinementCalls,
        },
      },
      topicalDiscovery: {
        sliceCount: discoverySlices.length,
        successfulCount: successfulDiscoveries.length,
        failures: discoveryAttempts.filter((attempt) => attempt.status === "rejected").length,
        calls: successfulDiscoveries.map((discovery) => ({
          sliceId: discovery.sliceId,
          metadata: discovery.metadata,
          leadCount: discovery.result.discoveredLeads.length,
          leads: discovery.result.discoveredLeads,
        })),
      },
      result,
    },
    null,
    2,
  )}\n`;
if (outputPath !== null) {
  writeFileSync(outputPath, serializedResult, "utf8");
}
process.stdout.write(serializedResult);
