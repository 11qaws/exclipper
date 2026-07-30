import { describe, expect, it } from "vitest";
import {
  classifyChannelPreanalysisTimeline,
  channelPreanalysisIdentityBasisAuthorizesPreparedData,
  resolveChannelPreanalysisTrust,
  selectChannelPreanalysisLookupLane,
  type ChannelPreanalysisTrustInput,
} from "./channelPreanalysisTrust";

const CATALOG_VIDEO_ID = "KzAW3yow80Q";
const OTHER_VIDEO_ID = "EZfCGS5ms_Q";

function input(
  override: Partial<ChannelPreanalysisTrustInput> = {},
): ChannelPreanalysisTrustInput {
  return {
    manualVideoId: null,
    registeredBindingVideoId: null,
    filenameVideoId: null,
    editorConfirmedVideoId: null,
    catalogConfidence: "none",
    catalogVideoId: null,
    timelineStatus: "unknown",
    ...override,
  };
}

describe("channel preanalysis trust boundary", () => {
  it("classifies known compatible, unknown, and incompatible timelines separately", () => {
    expect(classifyChannelPreanalysisTimeline(8_115_000, 8_114_817)).toBe(
      "compatible",
    );
    expect(classifyChannelPreanalysisTimeline(null, 8_114_817)).toBe("unknown");
    expect(classifyChannelPreanalysisTimeline(8_120_000, 8_114_817)).toBe(
      "incompatible",
    );
  });

  it("does not trust a filename ID that the catalog did not match", () => {
    expect(
      resolveChannelPreanalysisTrust(
        input({ filenameVideoId: OTHER_VIDEO_ID }),
      ),
    ).toMatchObject({
      durableCaptionVideoId: null,
      rosterVideoId: null,
      basis: null,
      filenameDisposition: "rejected",
    });
  });

  it("keeps even an exact compatible filename match behind editor confirmation", () => {
    expect(
      resolveChannelPreanalysisTrust(
        input({
          filenameVideoId: CATALOG_VIDEO_ID,
          catalogConfidence: "exact",
          catalogVideoId: CATALOG_VIDEO_ID,
          timelineStatus: "compatible",
        }),
      ),
    ).toEqual({
      durableCaptionVideoId: null,
      rosterVideoId: null,
      basis: null,
      filenameDisposition: "verified",
      rejectionReason: null,
    });
  });

  it("authorizes prepared data only for explicit, registered, visual, or confirmed identities", () => {
    expect(
      channelPreanalysisIdentityBasisAuthorizesPreparedData("manual-pasted"),
    ).toBe(true);
    expect(
      channelPreanalysisIdentityBasisAuthorizesPreparedData(
        "registered-local-binding",
      ),
    ).toBe(true);
    expect(
      channelPreanalysisIdentityBasisAuthorizesPreparedData(
        "visual-fingerprint-consensus",
      ),
    ).toBe(true);
    expect(
      channelPreanalysisIdentityBasisAuthorizesPreparedData(
        "editor-confirmed-catalog",
      ),
    ).toBe(true);
    expect(
      channelPreanalysisIdentityBasisAuthorizesPreparedData(
        "recovery-preserved",
      ),
    ).toBe(false);
    expect(channelPreanalysisIdentityBasisAuthorizesPreparedData(null)).toBe(
      false,
    );
  });

  it("requires confirmation when an exact filename match has no catalog duration", () => {
    expect(
      resolveChannelPreanalysisTrust(
        input({
          filenameVideoId: CATALOG_VIDEO_ID,
          catalogConfidence: "exact",
          catalogVideoId: CATALOG_VIDEO_ID,
          timelineStatus: "unknown",
        }),
      ),
    ).toMatchObject({
      durableCaptionVideoId: null,
      rosterVideoId: null,
      filenameDisposition: "needs-confirmation",
      rejectionReason: null,
    });
  });

  it("rejects an exact filename match whose time axis conflicts", () => {
    expect(
      resolveChannelPreanalysisTrust(
        input({
          filenameVideoId: CATALOG_VIDEO_ID,
          catalogConfidence: "exact",
          catalogVideoId: CATALOG_VIDEO_ID,
          timelineStatus: "incompatible",
        }),
      ),
    ).toMatchObject({
      durableCaptionVideoId: null,
      rosterVideoId: null,
      filenameDisposition: "rejected",
      rejectionReason: "timeline-incompatible",
    });
  });

  it("keeps an explicit pasted ID authoritative when the catalog is unavailable", () => {
    expect(
      resolveChannelPreanalysisTrust(
        input({
          manualVideoId: OTHER_VIDEO_ID,
          filenameVideoId: CATALOG_VIDEO_ID,
        }),
      ),
    ).toEqual({
      durableCaptionVideoId: OTHER_VIDEO_ID,
      rosterVideoId: null,
      basis: "manual-pasted",
      filenameDisposition: "rejected",
      rejectionReason: null,
    });
  });

  it("uses an explicit pasted ID before a prior local binding and filename hint", () => {
    expect(
      resolveChannelPreanalysisTrust(
        input({
          manualVideoId: OTHER_VIDEO_ID,
          registeredBindingVideoId: CATALOG_VIDEO_ID,
          filenameVideoId: CATALOG_VIDEO_ID,
        }),
      ),
    ).toMatchObject({
      durableCaptionVideoId: OTHER_VIDEO_ID,
      rosterVideoId: null,
      basis: "manual-pasted",
    });
  });

  it("uses a previously registered sampled-fingerprint binding before a filename ID", () => {
    expect(
      resolveChannelPreanalysisTrust(
        input({
          registeredBindingVideoId: CATALOG_VIDEO_ID,
          filenameVideoId: OTHER_VIDEO_ID,
        }),
      ),
    ).toEqual({
      durableCaptionVideoId: CATALOG_VIDEO_ID,
      rosterVideoId: CATALOG_VIDEO_ID,
      basis: "registered-local-binding",
      filenameDisposition: "rejected",
      rejectionReason: null,
    });
  });

  it("authorizes a unique visual consensus only against the exact catalog video", () => {
    expect(
      resolveChannelPreanalysisTrust(
        input({
          visualFingerprintVideoId: CATALOG_VIDEO_ID,
          filenameVideoId: OTHER_VIDEO_ID,
          catalogConfidence: "exact",
          catalogVideoId: CATALOG_VIDEO_ID,
          timelineStatus: "compatible",
        }),
      ),
    ).toEqual({
      durableCaptionVideoId: CATALOG_VIDEO_ID,
      rosterVideoId: CATALOG_VIDEO_ID,
      basis: "visual-fingerprint-consensus",
      filenameDisposition: "rejected",
      rejectionReason: null,
    });
  });

  it("rejects visual consensus when the exact catalog time axis conflicts", () => {
    expect(
      resolveChannelPreanalysisTrust(
        input({
          visualFingerprintVideoId: CATALOG_VIDEO_ID,
          catalogConfidence: "exact",
          catalogVideoId: CATALOG_VIDEO_ID,
          timelineStatus: "incompatible",
        }),
      ),
    ).toMatchObject({
      durableCaptionVideoId: null,
      rosterVideoId: null,
      basis: null,
      rejectionReason: "timeline-incompatible",
    });
  });

  it("allows an editor-confirmed catalog identity when its timeline is not conflicting", () => {
    expect(
      resolveChannelPreanalysisTrust(
        input({
          filenameVideoId: CATALOG_VIDEO_ID,
          editorConfirmedVideoId: CATALOG_VIDEO_ID,
          catalogConfidence: "exact",
          catalogVideoId: CATALOG_VIDEO_ID,
          timelineStatus: "unknown",
        }),
      ),
    ).toMatchObject({
      durableCaptionVideoId: CATALOG_VIDEO_ID,
      rosterVideoId: CATALOG_VIDEO_ID,
      basis: "editor-confirmed-catalog",
      filenameDisposition: "needs-confirmation",
      rejectionReason: null,
    });
  });

  it("rejects even a pasted ID when the exact catalog duration proves a conflict", () => {
    expect(
      resolveChannelPreanalysisTrust(
        input({
          manualVideoId: CATALOG_VIDEO_ID,
          catalogConfidence: "exact",
          catalogVideoId: CATALOG_VIDEO_ID,
          timelineStatus: "incompatible",
        }),
      ),
    ).toMatchObject({
      durableCaptionVideoId: null,
      rosterVideoId: null,
      rejectionReason: "timeline-incompatible",
    });
  });

  it("keeps an exact registered fingerprint ahead of a compatible filename ID", () => {
    expect(
      selectChannelPreanalysisLookupLane(
        { confidence: "exact", timelineStatus: "compatible" },
        { confidence: "exact", timelineStatus: "compatible" },
      ),
    ).toBe("metadata");
  });

  it("uses a filename ID over probable metadata only after a compatible exact match", () => {
    expect(
      selectChannelPreanalysisLookupLane(
        { confidence: "probable", timelineStatus: "compatible" },
        { confidence: "exact", timelineStatus: "compatible" },
      ),
    ).toBe("filename");
    expect(
      selectChannelPreanalysisLookupLane(
        { confidence: "probable", timelineStatus: "compatible" },
        { confidence: "exact", timelineStatus: "unknown" },
      ),
    ).toBe("metadata");
    expect(
      selectChannelPreanalysisLookupLane(
        { confidence: "probable", timelineStatus: "compatible" },
        { confidence: "exact", timelineStatus: "incompatible" },
      ),
    ).toBe("metadata");
  });
});
