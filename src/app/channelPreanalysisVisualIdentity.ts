import {
  fetchChannelPreanalysisVisualFingerprintCohortForLookup,
  fetchChannelPreanalysisVisualFingerprintForLookup,
  resolveChannelPreanalysisLookupByVisualFingerprintCohort,
  type ChannelPreanalysisLookupResult,
  type ChannelPreanalysisVisualCohortResolution,
  type LoadedChannelPreanalysisVisualFingerprintCohort,
  type LoadedChannelPreanalysisVisualFingerprint,
} from "../analysis/channelPreanalysisClient";
import {
  buildChannelPreanalysisLocalVisualCohortSamplingPlan,
  buildChannelPreanalysisLocalVisualSamplingPlan,
  matchChannelPreanalysisVisualFingerprint,
  type ChannelPreanalysisVisualMatchResult,
} from "../analysis/channelPreanalysisVisualFingerprint";
import {
  eraseLocalVideoLumaSamples,
  sampleLocalVideoLumaFrames,
  type LocalVideoLumaSamplingResult,
} from "../media/localVideoVisualAnalysis";

export type ChannelPreanalysisLocalVisualIdentityStatus =
  | "verified"
  | "not-verifiable"
  | "not-matched";

export interface ChannelPreanalysisLocalVisualIdentityResult {
  readonly status: ChannelPreanalysisLocalVisualIdentityStatus;
  readonly videoId: string | null;
  readonly match: ChannelPreanalysisVisualMatchResult | null;
  readonly verifiedLookup: ChannelPreanalysisLookupResult | null;
}

export interface VerifyChannelPreanalysisLocalVisualIdentityOptions {
  readonly signal?: AbortSignal;
  readonly loadFingerprint?: (
    lookup: ChannelPreanalysisLookupResult,
    signal: AbortSignal | undefined,
  ) => Promise<LoadedChannelPreanalysisVisualFingerprint | null>;
  readonly loadFingerprintCohort?: (
    lookup: ChannelPreanalysisLookupResult,
    sourceDurationMs: number,
    signal: AbortSignal | undefined,
  ) => Promise<LoadedChannelPreanalysisVisualFingerprintCohort>;
  readonly resolveFingerprintCohort?: (
    lookup: ChannelPreanalysisLookupResult,
    cohort: LoadedChannelPreanalysisVisualFingerprintCohort,
    input: {
      readonly durationMs: number;
      readonly samples: LocalVideoLumaSamplingResult["samples"];
    },
    signal: AbortSignal | undefined,
  ) => Promise<ChannelPreanalysisVisualCohortResolution>;
  readonly sampleFrames?: (
    file: File,
    timestampsMs: readonly number[],
    signal: AbortSignal | undefined,
  ) => Promise<LocalVideoLumaSamplingResult>;
}

const NOT_VERIFIABLE: ChannelPreanalysisLocalVisualIdentityResult = {
  status: "not-verifiable",
  videoId: null,
  match: null,
  verifiedLookup: null,
};

/**
 * Verifies one catalog-discovered replay against a local upload without
 * depending on filename text or exact encoded bytes.
 *
 * The common path seeks only the fingerprint anchors. A bounded offset plan is
 * sampled only after that first pass fails. Returned luma planes are ephemeral
 * and erased before this function settles.
 */
export async function verifyChannelPreanalysisLocalVisualIdentity(
  file: File,
  sourceDurationMs: number,
  lookup: ChannelPreanalysisLookupResult,
  options: VerifyChannelPreanalysisLocalVisualIdentityOptions = {},
): Promise<ChannelPreanalysisLocalVisualIdentityResult> {
  if (
    !Number.isSafeInteger(sourceDurationMs) ||
    sourceDurationMs <= 0
  ) {
    return NOT_VERIFIABLE;
  }

  if (lookup.match.match === null) {
    return verifyCatalogVisualCohort(
      file,
      sourceDurationMs,
      lookup,
      options,
    );
  }

  const loadFingerprint =
    options.loadFingerprint ??
    (async (candidateLookup, signal) =>
      fetchChannelPreanalysisVisualFingerprintForLookup(candidateLookup, {
        ...(signal === undefined ? {} : { signal }),
      }));
  const sampleFrames =
    options.sampleFrames ??
    (async (sourceFile, timestampsMs, signal) =>
      sampleLocalVideoLumaFrames(sourceFile, timestampsMs, {
        ...(signal === undefined ? {} : { signal }),
      }));

  let loaded: LoadedChannelPreanalysisVisualFingerprint | null;
  try {
    loaded = await loadFingerprint(lookup, options.signal);
  } catch {
    return NOT_VERIFIABLE;
  }
  if (loaded === null) return NOT_VERIFIABLE;

  const durationProbe = matchChannelPreanalysisVisualFingerprint(
    loaded.fingerprint,
    { durationMs: sourceDurationMs, samples: [] },
  );
  if (durationProbe.reason === "duration-conflict") {
    return {
      status: "not-matched",
      videoId: null,
      match: durationProbe,
      verifiedLookup: null,
    };
  }

  const retainedSamples: LocalVideoLumaSamplingResult["samples"][number][] = [];
  try {
    const zeroOffsetPlan = boundedPlanForLocalDuration(
      buildChannelPreanalysisLocalVisualSamplingPlan(loaded.fingerprint, {
        phase: "zero-offset",
      }),
      sourceDurationMs,
    );
    if (zeroOffsetPlan.length === 0) return NOT_VERIFIABLE;
    const zeroOffsetSamples = await sampleFrames(
      file,
      zeroOffsetPlan,
      options.signal,
    );
    if (zeroOffsetSamples.sourceDurationMs !== sourceDurationMs) {
      eraseLocalVideoLumaSamples(zeroOffsetSamples.samples);
      return NOT_VERIFIABLE;
    }
    retainedSamples.push(...zeroOffsetSamples.samples);
    const zeroOffsetMatch = matchChannelPreanalysisVisualFingerprint(
      loaded.fingerprint,
      {
        durationMs: sourceDurationMs,
        samples: retainedSamples,
      },
    );
    if (zeroOffsetMatch.matched) {
      return verifiedResult(zeroOffsetMatch);
    }

    const sampledTimestamps = new Set(
      retainedSamples.map(({ timestampMs }) => timestampMs),
    );
    const recoveryPlan = boundedPlanForLocalDuration(
      buildChannelPreanalysisLocalVisualSamplingPlan(loaded.fingerprint, {
        phase: "offset-recovery",
      }),
      sourceDurationMs,
    ).filter((timestampMs) => !sampledTimestamps.has(timestampMs));
    if (recoveryPlan.length === 0) {
      return {
        status: "not-matched",
        videoId: null,
        match: zeroOffsetMatch,
        verifiedLookup: null,
      };
    }
    const recoverySamples = await sampleFrames(
      file,
      recoveryPlan,
      options.signal,
    );
    if (recoverySamples.sourceDurationMs !== sourceDurationMs) {
      eraseLocalVideoLumaSamples(recoverySamples.samples);
      return NOT_VERIFIABLE;
    }
    retainedSamples.push(...recoverySamples.samples);
    const recoveredMatch = matchChannelPreanalysisVisualFingerprint(
      loaded.fingerprint,
      {
        durationMs: sourceDurationMs,
        samples: retainedSamples,
      },
    );
    return recoveredMatch.matched
      ? verifiedResult(recoveredMatch)
        : {
            status: "not-matched",
            videoId: null,
            match: recoveredMatch,
            verifiedLookup: null,
          };
  } catch {
    return NOT_VERIFIABLE;
  } finally {
    eraseLocalVideoLumaSamples(retainedSamples);
  }
}

function boundedPlanForLocalDuration(
  timestampsMs: readonly number[],
  sourceDurationMs: number,
): readonly number[] {
  return timestampsMs.filter(
    (timestampMs) => timestampMs >= 0 && timestampMs < sourceDurationMs,
  );
}

function verifiedResult(
  match: ChannelPreanalysisVisualMatchResult,
  verifiedLookup: ChannelPreanalysisLookupResult | null = null,
): ChannelPreanalysisLocalVisualIdentityResult {
  return {
    status: "verified",
    videoId: match.videoId,
    match,
    verifiedLookup,
  };
}

async function verifyCatalogVisualCohort(
  file: File,
  sourceDurationMs: number,
  lookup: ChannelPreanalysisLookupResult,
  options: VerifyChannelPreanalysisLocalVisualIdentityOptions,
): Promise<ChannelPreanalysisLocalVisualIdentityResult> {
  const loadFingerprintCohort =
    options.loadFingerprintCohort ??
    (async (candidateLookup, durationMs, signal) =>
      fetchChannelPreanalysisVisualFingerprintCohortForLookup(
        candidateLookup,
        durationMs,
        signal === undefined ? {} : { signal },
      ));
  const resolveFingerprintCohort =
    options.resolveFingerprintCohort ??
    (async (candidateLookup, cohort, input, signal) =>
      resolveChannelPreanalysisLookupByVisualFingerprintCohort(
        candidateLookup,
        cohort,
        input,
        signal === undefined ? {} : { signal },
      ));
  const sampleFrames =
    options.sampleFrames ??
    (async (sourceFile, timestampsMs, signal) =>
      sampleLocalVideoLumaFrames(sourceFile, timestampsMs, {
        ...(signal === undefined ? {} : { signal }),
      }));

  let cohort: LoadedChannelPreanalysisVisualFingerprintCohort;
  try {
    cohort = await loadFingerprintCohort(
      lookup,
      sourceDurationMs,
      options.signal,
    );
  } catch {
    return NOT_VERIFIABLE;
  }
  if (cohort.status !== "ready" || cohort.fingerprints.length === 0) {
    return NOT_VERIFIABLE;
  }

  let sampling: LocalVideoLumaSamplingResult | null = null;
  try {
    const plan = boundedPlanForLocalDuration(
      buildChannelPreanalysisLocalVisualCohortSamplingPlan(
        cohort.fingerprints,
      ),
      sourceDurationMs,
    );
    if (plan.length === 0) return NOT_VERIFIABLE;
    sampling = await sampleFrames(file, plan, options.signal);
    if (sampling.sourceDurationMs !== sourceDurationMs) {
      return NOT_VERIFIABLE;
    }
    const resolution = await resolveFingerprintCohort(
      lookup,
      cohort,
      {
        durationMs: sourceDurationMs,
        samples: sampling.samples,
      },
      options.signal,
    );
    if (
      resolution.status !== "verified" ||
      resolution.selection === null ||
      resolution.selection.result === null ||
      resolution.lookup.match.confidence !== "exact" ||
      resolution.lookup.match.match?.videoId !==
        resolution.selection.result.videoId
    ) {
      return {
        status: "not-matched",
        videoId: null,
        match: resolution.selection?.result ?? null,
        verifiedLookup: null,
      };
    }
    return verifiedResult(
      resolution.selection.result,
      resolution.lookup,
    );
  } catch {
    return NOT_VERIFIABLE;
  } finally {
    if (sampling !== null) {
      eraseLocalVideoLumaSamples(sampling.samples);
    }
  }
}
