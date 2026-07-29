import type { AnalysisLanguage } from "../domain/analysisLanguage";
import {
  createDiscoveredLeadRefinementChapters,
  type DiscoveredLeadRefinementPlan,
  type RefinementTranscriptRange,
} from "../analysis/discoveredLeadRefinement";
import type {
  BroadcastContextChapterInput,
  BroadcastContextDiscoveredLead,
} from "../analysis/broadcastContextProtocol";
import {
  rebaseBroadcastParticipantGrounding,
  type BroadcastParticipantGrounding,
} from "../analysis/broadcastParticipantGrounding";
import type {
  BroadcastRefinementActiveEvidencePayloadProjection,
} from "../analysis/broadcastRefinementEvidenceLedger";
import type {
  CandidatePassBCastRosterId,
} from "../analysis/participantRoster";
import {
  createContentFingerprint,
  type ContentDigestAdapter,
} from "../security/contentFingerprint";
import type {
  DurableBroadcastRefinementLeadInput,
} from "./durableBroadcastRefinementPipeline";
import type {
  BroadcastContextPhaseLedgerUnit,
} from "../analysis/broadcastContextPhaseLedger";

const SEMANTIC_REFINEMENT_AI_INPUT_DOMAIN =
  "exclipper.semantic-refinement-ai-input.v2";

export function activeRefinementEvidenceTranscripts(
  activeEvidence: BroadcastRefinementActiveEvidencePayloadProjection,
): readonly RefinementTranscriptRange[] {
  if (!activeEvidence.settlement.publicationEligible) {
    throw new RangeError(
      "Semantic refinement requires a publication-eligible active evidence route.",
    );
  }
  if (activeEvidence.evidencePayload.kind === "youtube-caption-cells") {
    return activeEvidence.evidencePayload.settlements.flatMap((settlement) =>
      settlement.status === "success"
        ? [{
            sourceStartMs: settlement.sourceStartMs,
            sourceEndMs: settlement.sourceEndMs,
            textKo: settlement.textKo,
          }]
        : [],
    );
  }
  return activeEvidence.evidencePayload.refinementCheckpoint.successfulFragments
    .map(({ result }) => result);
}

export interface CreateSemanticRefinementLeadInputsInput {
  readonly plan: DiscoveredLeadRefinementPlan;
  readonly transcripts: readonly RefinementTranscriptRange[];
  readonly discoveredLeads: readonly BroadcastContextDiscoveredLead[];
  readonly fastRefinementLeadIds: readonly string[];
  readonly sourceDurationMs: number;
  readonly castRosterId: CandidatePassBCastRosterId | null;
  readonly wholeBroadcastChapters: readonly BroadcastContextChapterInput[];
  readonly participantGrounding: BroadcastParticipantGrounding;
  readonly outputLanguage: AnalysisLanguage;
}

export function createSemanticRefinementLeadInputs(
  input: CreateSemanticRefinementLeadInputsInput,
): readonly DurableBroadcastRefinementLeadInput[] {
  const parentLeadById = new Map(
    input.discoveredLeads.map((lead) => [lead.leadId, lead]),
  );
  const fastLeadIds = new Set(input.fastRefinementLeadIds);
  return input.plan.selectedLeadIds.map((leadId) => {
    const parent = parentLeadById.get(leadId);
    if (parent === undefined) {
      throw new RangeError(
        `Semantic refinement lead ${leadId} is not in the parent context result.`,
      );
    }
    const chapters = createDiscoveredLeadRefinementChapters(
      leadId,
      input.plan,
      input.transcripts,
      `${parent.eventSummaryKo} / ${parent.evidenceCueKo}`,
    );
    const participantGrounding = rebaseBroadcastParticipantGrounding(
      input.participantGrounding,
      {
        sourceDurationMs: input.sourceDurationMs,
        castRosterId: input.castRosterId,
        chapters: input.wholeBroadcastChapters,
      },
      {
        sourceDurationMs: input.sourceDurationMs,
        castRosterId: input.castRosterId,
        chapters,
      },
    );
    if (participantGrounding === null) {
      throw new RangeError(
        `Participant grounding could not be projected to refinement lead ${leadId}.`,
      );
    }
    return {
      leadId,
      analysisMode: fastLeadIds.has(leadId)
        ? "refinement-fast"
        : "refinement",
      requestInput: {
        sourceDurationMs: input.sourceDurationMs,
        chapters,
        candidates: [],
        participantGrounding,
        outputLanguage: input.outputLanguage,
        castRosterId: input.castRosterId,
      },
    };
  });
}

export async function createSemanticRefinementAiInputSignature(
  input: {
    readonly activeEvidenceProjectionFingerprint: string;
    readonly routingManifestSignature: string;
    readonly leadInputs: readonly DurableBroadcastRefinementLeadInput[];
  },
  digestAdapter: ContentDigestAdapter | null = globalThis.crypto?.subtle ??
    null,
): Promise<string> {
  return createContentFingerprint(
    [
      SEMANTIC_REFINEMENT_AI_INPUT_DOMAIN,
      input.activeEvidenceProjectionFingerprint,
      input.routingManifestSignature,
      JSON.stringify(input.leadInputs),
    ],
    digestAdapter,
  );
}

export function semanticRefinementPhaseReceiptsMatchActiveProjection(input: {
  readonly units: readonly BroadcastContextPhaseLedgerUnit[];
  readonly leadInputs: readonly DurableBroadcastRefinementLeadInput[];
  readonly activeEvidenceProjectionFingerprint: string;
  readonly routingManifestSignature: string;
  readonly outputLanguage: AnalysisLanguage;
}): boolean {
  const requiredRefinementUnits = input.units.filter(
    (unit) => unit.phase === "refinement" && unit.required,
  );
  const expectedLeadByUnitId = new Map(
    input.leadInputs.map((lead) => [`lead:${lead.leadId}`, lead]),
  );
  return (
    requiredRefinementUnits.length === expectedLeadByUnitId.size &&
    requiredRefinementUnits.every((unit) => {
      const expectedLead = expectedLeadByUnitId.get(unit.unitId);
      return (
        expectedLead !== undefined &&
        unit.status === "succeeded" &&
        unit.modelReceipt?.routingManifestSignature ===
          input.routingManifestSignature &&
        unit.modelReceipt.evidenceManifestSignature ===
          input.activeEvidenceProjectionFingerprint &&
        unit.modelReceipt.outputLanguage === input.outputLanguage &&
        unit.modelReceipt.analysisMode === expectedLead.analysisMode &&
        unit.modelReceipt.providerDispatch ===
          (expectedLead.requestInput.chapters.length > 0)
      );
    })
  );
}
