/**
 * Conversions between the in-memory candidate the editor sees and the durable
 * record written to IndexedDB. Presentation-only fields are dropped on the way
 * out and recomputed on the way back in, so a stored result never carries
 * display text that a later version would silently reinterpret.
 */
import { highlightReasonForSignalKinds } from "../analysis/highlightFusion";
import type { UnifiedHighlightCandidate } from "../analysis/highlightFusion";
import type { LocalMediaPreflightResult } from "../media/localMediaPreflight";
import {
  classifyDurableMediaContainer,
  type DurableHighlightCandidate,
  type DurableSourceDescriptor,
} from "../storage/durableAnalysisPayload";

export function toDurableCandidate(
  candidate: UnifiedHighlightCandidate,
): DurableHighlightCandidate {
  const { reason: _presentationReason, ...durableCandidate } = candidate;
  void _presentationReason;
  return durableCandidate;
}

export function hydrateDurableCandidate(
  candidate: DurableHighlightCandidate,
): UnifiedHighlightCandidate {
  return {
    ...candidate,
    reason: highlightReasonForSignalKinds(candidate.signalKinds),
  };
}

export function createDurableSourceDescriptor(
  preflight: LocalMediaPreflightResult,
  sourceDefinitionId: string,
  contentFingerprint: string,
): DurableSourceDescriptor {
  return {
    sourceDefinitionId,
    contentFingerprint,
    sizeBytes: preflight.metadata.sizeBytes,
    durationMs: preflight.metadata.durationMs,
    kind: preflight.metadata.kind,
    container: classifyDurableMediaContainer(
      preflight.metadata.extension,
      preflight.metadata.mimeType,
    ),
  };
}
