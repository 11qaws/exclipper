import { CHANNEL_PREANALYSIS_TITLE_DURATION_TOLERANCE_MS } from "./channelPreanalysisCatalog";

export type ChannelPreanalysisTimelineStatus =
  | "compatible"
  | "unknown"
  | "incompatible";

export type ChannelPreanalysisTrustedIdentityBasis =
  | "manual-pasted"
  | "registered-local-binding"
  | "visual-fingerprint-consensus"
  | "editor-confirmed-catalog";

export type ChannelPreanalysisFilenameDisposition =
  | "absent"
  | "verified"
  | "needs-confirmation"
  | "rejected";

export interface ChannelPreanalysisTrustInput {
  readonly manualVideoId: string | null;
  readonly registeredBindingVideoId: string | null;
  readonly visualFingerprintVideoId?: string | null;
  readonly filenameVideoId: string | null;
  readonly editorConfirmedVideoId: string | null;
  readonly catalogConfidence: "none" | "probable" | "exact";
  readonly catalogVideoId: string | null;
  readonly timelineStatus: ChannelPreanalysisTimelineStatus;
}

export interface ChannelPreanalysisTrustResolution {
  readonly durableCaptionVideoId: string | null;
  readonly rosterVideoId: string | null;
  readonly basis: ChannelPreanalysisTrustedIdentityBasis | null;
  readonly filenameDisposition: ChannelPreanalysisFilenameDisposition;
  readonly rejectionReason: "timeline-incompatible" | null;
}

export interface ChannelPreanalysisLookupLaneEvidence {
  readonly confidence: "none" | "probable" | "exact";
  readonly timelineStatus: ChannelPreanalysisTimelineStatus;
}

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;

export function classifyChannelPreanalysisTimeline(
  catalogDurationMs: number | null | undefined,
  sourceDurationMs: number,
): ChannelPreanalysisTimelineStatus {
  if (
    typeof catalogDurationMs !== "number" ||
    !Number.isSafeInteger(catalogDurationMs) ||
    catalogDurationMs <= 0 ||
    !Number.isSafeInteger(sourceDurationMs) ||
    sourceDurationMs <= 0
  ) {
    return "unknown";
  }
  return Math.abs(catalogDurationMs - sourceDurationMs) <=
    CHANNEL_PREANALYSIS_TITLE_DURATION_TOLERANCE_MS
    ? "compatible"
    : "incompatible";
}

export function resolveChannelPreanalysisTrust(
  input: ChannelPreanalysisTrustInput,
): ChannelPreanalysisTrustResolution {
  const manualVideoId = validVideoId(input.manualVideoId);
  const registeredBindingVideoId = validVideoId(
    input.registeredBindingVideoId,
  );
  const visualFingerprintVideoId = validVideoId(
    input.visualFingerprintVideoId ?? null,
  );
  const filenameVideoId = validVideoId(input.filenameVideoId);
  const editorConfirmedVideoId = validVideoId(input.editorConfirmedVideoId);
  const catalogVideoId = validVideoId(input.catalogVideoId);
  const exactCatalogVideoId =
    input.catalogConfidence === "exact" ? catalogVideoId : null;
  const catalogHas = (videoId: string): boolean =>
    catalogVideoId === videoId && input.catalogConfidence !== "none";
  const catalogRejectsTimeline = (videoId: string): boolean =>
    exactCatalogVideoId === videoId &&
    input.timelineStatus === "incompatible";

  const filenameDisposition = resolveFilenameDisposition(
    filenameVideoId,
    exactCatalogVideoId,
    input.timelineStatus,
  );

  if (manualVideoId !== null) {
    if (catalogRejectsTimeline(manualVideoId)) {
      return emptyResolution(filenameDisposition, "timeline-incompatible");
    }
    return {
      durableCaptionVideoId: manualVideoId,
      rosterVideoId: catalogHas(manualVideoId) ? manualVideoId : null,
      basis: "manual-pasted",
      filenameDisposition,
      rejectionReason: null,
    };
  }

  if (registeredBindingVideoId !== null) {
    if (catalogRejectsTimeline(registeredBindingVideoId)) {
      return emptyResolution(filenameDisposition, "timeline-incompatible");
    }
    return {
      durableCaptionVideoId: registeredBindingVideoId,
      rosterVideoId: registeredBindingVideoId,
      basis: "registered-local-binding",
      filenameDisposition,
      rejectionReason: null,
    };
  }

  if (visualFingerprintVideoId !== null) {
    if (
      !catalogHas(visualFingerprintVideoId) ||
      catalogRejectsTimeline(visualFingerprintVideoId)
    ) {
      return emptyResolution(
        filenameDisposition,
        catalogRejectsTimeline(visualFingerprintVideoId)
          ? "timeline-incompatible"
          : null,
      );
    }
    return {
      durableCaptionVideoId: visualFingerprintVideoId,
      rosterVideoId: visualFingerprintVideoId,
      basis: "visual-fingerprint-consensus",
      filenameDisposition,
      rejectionReason: null,
    };
  }

  if (editorConfirmedVideoId !== null) {
    if (
      !catalogHas(editorConfirmedVideoId) ||
      catalogRejectsTimeline(editorConfirmedVideoId)
    ) {
      return emptyResolution(
        filenameDisposition,
        catalogRejectsTimeline(editorConfirmedVideoId)
          ? "timeline-incompatible"
          : null,
      );
    }
    return {
      durableCaptionVideoId: editorConfirmedVideoId,
      rosterVideoId: editorConfirmedVideoId,
      basis: "editor-confirmed-catalog",
      filenameDisposition,
      rejectionReason: null,
    };
  }

  return emptyResolution(
    filenameDisposition,
    filenameDisposition === "rejected" &&
      exactCatalogVideoId === filenameVideoId &&
      input.timelineStatus === "incompatible"
      ? "timeline-incompatible"
      : null,
  );
}

/**
 * Only an editor decision or a previously registered exact local-file binding
 * may authorize durable prepared data. Filename and title/duration discovery
 * are confirmation hints, never identity receipts.
 */
export function channelPreanalysisIdentityBasisAuthorizesPreparedData(
  basis: ChannelPreanalysisTrustedIdentityBasis | "recovery-preserved" | null,
): basis is ChannelPreanalysisTrustedIdentityBasis {
  return (
    basis === "manual-pasted" ||
    basis === "registered-local-binding" ||
    basis === "visual-fingerprint-consensus" ||
    basis === "editor-confirmed-catalog"
  );
}

/**
 * A no-ID catalog lookup exposes the stronger registered-fingerprint lane and
 * the weaker title+duration lane. A filename ID may win only when the catalog
 * independently proves both that exact ID and a compatible time axis.
 */
export function selectChannelPreanalysisLookupLane(
  metadataLane: ChannelPreanalysisLookupLaneEvidence,
  filenameLane: ChannelPreanalysisLookupLaneEvidence,
): "metadata" | "filename" {
  if (metadataLane.confidence === "exact") return "metadata";
  if (
    filenameLane.confidence === "exact" &&
    filenameLane.timelineStatus === "compatible"
  ) {
    return "filename";
  }
  if (metadataLane.confidence === "probable") return "metadata";
  return "filename";
}

function resolveFilenameDisposition(
  filenameVideoId: string | null,
  exactCatalogVideoId: string | null,
  timelineStatus: ChannelPreanalysisTimelineStatus,
): ChannelPreanalysisFilenameDisposition {
  if (filenameVideoId === null) return "absent";
  if (exactCatalogVideoId !== filenameVideoId) return "rejected";
  if (timelineStatus === "compatible") return "verified";
  if (timelineStatus === "unknown") return "needs-confirmation";
  return "rejected";
}

function emptyResolution(
  filenameDisposition: ChannelPreanalysisFilenameDisposition,
  rejectionReason: "timeline-incompatible" | null,
): ChannelPreanalysisTrustResolution {
  return {
    durableCaptionVideoId: null,
    rosterVideoId: null,
    basis: null,
    filenameDisposition,
    rejectionReason,
  };
}

function validVideoId(value: string | null): string | null {
  return value !== null && YOUTUBE_VIDEO_ID_PATTERN.test(value) ? value : null;
}
