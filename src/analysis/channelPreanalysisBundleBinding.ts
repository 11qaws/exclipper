import type { ChannelPreanalysisBundle } from "./channelPreanalysisBundle";
import type {
  ChannelPreanalysisArtifact,
  ChannelPreanalysisCatalogManifest,
} from "./channelPreanalysisCatalog";
import type { ChannelPreanalysisLookupResult } from "./channelPreanalysisClient";

const LOCAL_FINGERPRINT_PATTERN =
  /^local-file-sampled-sha256-v1:[0-9a-f]{64}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

/**
 * An atomic receipt connecting verified bundle bytes to the exact manifest
 * artifact that authenticated them for one local source.
 */
export interface ChannelPreanalysisVerifiedBundleBinding {
  readonly sourceContentFingerprint: string;
  readonly bundle: ChannelPreanalysisBundle;
  readonly artifactId: string;
  readonly artifactDigest: string;
}

export function createChannelPreanalysisVerifiedBundleBinding(
  sourceContentFingerprint: string,
  lookup: ChannelPreanalysisLookupResult,
): ChannelPreanalysisVerifiedBundleBinding | null {
  const bundle = lookup.bundle;
  const artifact = lookup.bundleArtifact;
  const match = lookup.match.match;
  if (
    !LOCAL_FINGERPRINT_PATTERN.test(sourceContentFingerprint) ||
    lookup.bundleStatus !== "loaded" ||
    lookup.match.confidence !== "exact" ||
    bundle === null ||
    artifact === null ||
    match === null ||
    bundle.videoId !== match.videoId ||
    artifact.videoId !== bundle.videoId ||
    artifact.kind !== "transcript" ||
    !match.artifactIds.includes(artifact.artifactId) ||
    !SHA256_PATTERN.test(artifact.contentDigest) ||
    !manifestContainsExactArtifact(lookup.manifest, artifact)
  ) {
    return null;
  }
  return {
    sourceContentFingerprint,
    bundle,
    artifactId: artifact.artifactId,
    artifactDigest: artifact.contentDigest,
  };
}

export function channelPreanalysisVerifiedBundleBindingMatchesLookup(
  binding: ChannelPreanalysisVerifiedBundleBinding,
  lookup: ChannelPreanalysisLookupResult,
): boolean {
  const current = createChannelPreanalysisVerifiedBundleBinding(
    binding.sourceContentFingerprint,
    lookup,
  );
  return (
    current !== null &&
    current.bundle.videoId === binding.bundle.videoId &&
    current.bundle.transcriptDigest === binding.bundle.transcriptDigest &&
    current.artifactId === binding.artifactId &&
    current.artifactDigest === binding.artifactDigest
  );
}

function manifestContainsExactArtifact(
  manifest: ChannelPreanalysisCatalogManifest,
  artifact: ChannelPreanalysisArtifact,
): boolean {
  const matches = manifest.artifacts.filter(
    ({ artifactId }) => artifactId === artifact.artifactId,
  );
  if (matches.length !== 1) return false;
  const current = matches[0]!;
  return (
    current.videoId === artifact.videoId &&
    current.kind === artifact.kind &&
    current.revision === artifact.revision &&
    current.storageKey === artifact.storageKey &&
    current.contentDigest === artifact.contentDigest &&
    current.byteLength === artifact.byteLength &&
    current.createdAt === artifact.createdAt
  );
}
