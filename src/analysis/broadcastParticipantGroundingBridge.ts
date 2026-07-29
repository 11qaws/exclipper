import {
  MAX_BROADCAST_PARTICIPANT_OBSERVED_EVIDENCE,
  type BroadcastParticipantGroundingAdapterOutputs,
  type BroadcastParticipantMediaAdapterOutput,
  type BroadcastParticipantObservedEvidence,
  type CreateBroadcastParticipantGroundingInput,
} from "./broadcastParticipantGrounding";
import {
  sealBroadcastParticipantGroundingPlan,
  type BroadcastParticipantGroundingAdapterCompletionReceipt,
  type BroadcastParticipantGroundingPlan,
  type BroadcastParticipantGroundingSourceFence,
  type BroadcastParticipantGroundingTerminalCellReceipt,
} from "./broadcastParticipantGroundingPlan";
import {
  candidatePassBCastReferences,
  candidatePassBKnownCastReferences,
} from "./participantRoster";

export interface ProjectBroadcastParticipantGroundingAdapterOutputsInput {
  readonly groundingInput: CreateBroadcastParticipantGroundingInput;
  /**
   * Rebuilt from the current run, not copied from `plan.sourceFence`.
   * Every field must match before any evidence is projected.
   */
  readonly expectedSourceFence: BroadcastParticipantGroundingSourceFence;
  readonly plan: BroadcastParticipantGroundingPlan;
  readonly cellReceipts: readonly unknown[];
}

export type BroadcastParticipantGroundingBridgeErrorCode =
  | "SOURCE_FENCE_MISMATCH"
  | "ROSTER_FENCE_MISMATCH"
  | "INVALID_SEALED_ADAPTER"
  | "OUTPUT_TOO_LARGE";

export class BroadcastParticipantGroundingBridgeError extends Error {
  public readonly code: BroadcastParticipantGroundingBridgeErrorCode;

  public constructor(
    code: BroadcastParticipantGroundingBridgeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BroadcastParticipantGroundingBridgeError";
    this.code = code;
  }
}

function sourceFenceMatches(
  left: BroadcastParticipantGroundingSourceFence,
  right: BroadcastParticipantGroundingSourceFence,
): boolean {
  return (
    left.sourceFingerprint === right.sourceFingerprint &&
    left.sourceDurationMs === right.sourceDurationMs &&
    left.transcriptSeal === right.transcriptSeal &&
    left.castRosterId === right.castRosterId &&
    left.catalogVersion === right.catalogVersion &&
    left.groundingSchemaVersion === right.groundingSchemaVersion &&
    left.samplingPlanRevision === right.samplingPlanRevision
  );
}

function assertCurrentSourceFence(
  input: ProjectBroadcastParticipantGroundingAdapterOutputsInput,
): void {
  if (
    !sourceFenceMatches(input.plan.sourceFence, input.expectedSourceFence) ||
    input.groundingInput.sourceDurationMs !==
      input.expectedSourceFence.sourceDurationMs ||
    input.groundingInput.castRosterId !== input.expectedSourceFence.castRosterId
  ) {
    throw new BroadcastParticipantGroundingBridgeError(
      "SOURCE_FENCE_MISMATCH",
      "The sealed participant evidence does not belong to the current source fence.",
    );
  }
  const expectedParticipantIds = (
    input.groundingInput.castRosterId === null
      ? candidatePassBKnownCastReferences()
      : candidatePassBCastReferences(input.groundingInput.castRosterId)
  ).map(({ participantId }) => participantId);
  if (
    JSON.stringify(input.plan.expectedParticipantIds) !==
    JSON.stringify(expectedParticipantIds)
  ) {
    throw new BroadcastParticipantGroundingBridgeError(
      "ROSTER_FENCE_MISMATCH",
      "The participant plan roster does not match the current source roster.",
    );
  }
}

function adapterCompletionReceipt(
  receipts: readonly BroadcastParticipantGroundingAdapterCompletionReceipt[],
  adapter: "visual-identity" | "voice-identity",
): BroadcastParticipantGroundingAdapterCompletionReceipt {
  const receipt = receipts.find((item) => item.adapter === adapter);
  if (receipt === undefined) {
    throw new BroadcastParticipantGroundingBridgeError(
      "INVALID_SEALED_ADAPTER",
      `The sealed plan is missing the ${adapter} completion receipt.`,
    );
  }
  return receipt;
}

function unidentifiedVoiceEvidenceKo(
  receipt: BroadcastParticipantGroundingTerminalCellReceipt,
): string {
  switch (receipt.voiceRecognition?.abstentionReason) {
    case "below-absolute-threshold":
      return "발화는 확인했지만 검증된 화자의 절대 일치 임계값을 넘지 못했습니다.";
    case "below-top1-top2-margin":
      return "발화는 확인했지만 가장 가까운 두 화자 점수가 비슷해 이름을 확정하지 않았습니다.";
    case "insufficient-covered-comparators":
      return "발화는 확인했지만 비교 가능한 검증 화자가 부족해 이름을 확정하지 않았습니다.";
    case null:
    case undefined:
      return "발화는 확인했지만 검증된 화자와 연결하지 못했습니다.";
  }
}

function visualEvidenceFor(
  receipt: BroadcastParticipantGroundingTerminalCellReceipt,
): readonly BroadcastParticipantObservedEvidence[] {
  switch (receipt.outcome) {
    case "identified":
      return receipt.participantIds.map((participantId) => ({
        evidenceId: `visual:${receipt.cellId}:${participantId}`,
        participantId,
        kind: "visual-reference-match" as const,
        supports: "visible-identity" as const,
        adapter: "visual-identity" as const,
        startMs: receipt.sourceStartMs,
        endMs: receipt.sourceEndMs,
        chapterId: null,
        confidence: receipt.confidence!,
        evidenceKo:
          "검증된 화면 참조와 참가자 고유 특징이 일치했습니다.",
      }));
    case "none":
      return [
        {
          evidenceId: `visual:${receipt.cellId}:none`,
          participantId: null,
          kind: "no-visible-participant",
          supports: "no-visible-participant",
          adapter: "visual-identity",
          startMs: receipt.sourceStartMs,
          endMs: receipt.sourceEndMs,
          chapterId: null,
          confidence: null,
          evidenceKo: "검토한 화면 묶음에 인물이 보이지 않았습니다.",
        },
      ];
    case "unidentified":
      return [
        {
          evidenceId: `visual:${receipt.cellId}:unknown`,
          participantId: null,
          kind: "visible-participant-unidentified",
          supports: "visible-unidentified",
          adapter: "visual-identity",
          startMs: receipt.sourceStartMs,
          endMs: receipt.sourceEndMs,
          chapterId: null,
          confidence: null,
          evidenceKo:
            "인물은 보이지만 검증된 화면 참조와 일치 여부를 확정하지 못했습니다.",
        },
      ];
    case "no-speech":
      throw new BroadcastParticipantGroundingBridgeError(
        "INVALID_SEALED_ADAPTER",
        "A visual terminal receipt cannot contain a no-speech outcome.",
      );
  }
}

function voiceEvidenceFor(
  receipt: BroadcastParticipantGroundingTerminalCellReceipt,
): readonly BroadcastParticipantObservedEvidence[] {
  switch (receipt.outcome) {
    case "identified": {
      const participantId = receipt.participantIds[0];
      if (
        participantId === undefined ||
        receipt.participantIds.length !== 1 ||
        receipt.confidence === null ||
        receipt.voiceRecognition?.outcome !== "identified"
      ) {
        throw new BroadcastParticipantGroundingBridgeError(
          "INVALID_SEALED_ADAPTER",
          "An identified voice terminal is missing its policy-projected identity.",
        );
      }
      return [
        {
          evidenceId: `voice:${receipt.cellId}:${participantId}`,
          participantId,
          kind: "voice-reference-match",
          supports: "speaker-identity",
          adapter: "voice-identity",
          startMs: receipt.sourceStartMs,
          endMs: receipt.sourceEndMs,
          chapterId: null,
          confidence: receipt.confidence,
          evidenceKo:
            "검증된 음성 참조와 화자 임베딩이 일치했습니다.",
        },
      ];
    }
    case "unidentified":
      if (receipt.voiceRecognition?.outcome !== "unidentified") {
        throw new BroadcastParticipantGroundingBridgeError(
          "INVALID_SEALED_ADAPTER",
          "An unidentified voice terminal is missing its open-set abstention.",
        );
      }
      return [
        {
          evidenceId: `voice:${receipt.cellId}:unknown`,
          participantId: null,
          kind: "speaker-unidentified",
          supports: "speaker-unidentified",
          adapter: "voice-identity",
          startMs: receipt.sourceStartMs,
          endMs: receipt.sourceEndMs,
          chapterId: null,
          confidence: null,
          evidenceKo: unidentifiedVoiceEvidenceKo(receipt),
        },
      ];
    case "no-speech":
      if (receipt.voiceRecognition?.outcome !== "no-speech") {
        throw new BroadcastParticipantGroundingBridgeError(
          "INVALID_SEALED_ADAPTER",
          "A no-speech terminal is missing its speech-activity projection.",
        );
      }
      return [
        {
          evidenceId: `voice:${receipt.cellId}:no-speech`,
          participantId: null,
          kind: "no-speech",
          supports: "no-speech",
          adapter: "voice-identity",
          startMs: receipt.sourceStartMs,
          endMs: receipt.sourceEndMs,
          chapterId: null,
          confidence: null,
          evidenceKo: "검토한 오디오 구간에 발화가 없습니다.",
        },
      ];
    case "none":
      throw new BroadcastParticipantGroundingBridgeError(
        "INVALID_SEALED_ADAPTER",
        "A voice terminal receipt cannot contain a none outcome.",
      );
  }
}

function outputForAdapter(
  adapterReceipt: BroadcastParticipantGroundingAdapterCompletionReceipt,
  terminalCells: readonly BroadcastParticipantGroundingTerminalCellReceipt[],
): BroadcastParticipantMediaAdapterOutput {
  if (
    adapterReceipt.adapter !== "visual-identity" &&
    adapterReceipt.adapter !== "voice-identity"
  ) {
    throw new BroadcastParticipantGroundingBridgeError(
      "INVALID_SEALED_ADAPTER",
      "Only visual and voice completion receipts can become media outputs.",
    );
  }
  if (adapterReceipt.status === "unavailable") {
    return {
      receipt: {
        adapter: adapterReceipt.adapter,
        revision: adapterReceipt.adapterFenceKey,
        status: "unavailable",
        inputCount: 0,
        processedCount: 0,
        unavailableReason: adapterReceipt.unavailableReason!,
      },
      evidence: [],
    };
  }
  const adapterCells = terminalCells.filter(
    (receipt) => receipt.adapter === adapterReceipt.adapter,
  );
  if (
    adapterReceipt.inputCount !== adapterCells.length ||
    adapterReceipt.processedCount !== adapterCells.length
  ) {
    throw new BroadcastParticipantGroundingBridgeError(
      "INVALID_SEALED_ADAPTER",
      "The sealed adapter counts do not match its terminal cell receipts.",
    );
  }
  return {
    receipt: {
      adapter: adapterReceipt.adapter,
      revision: adapterReceipt.adapterFenceKey,
      status: "completed",
      inputCount: adapterCells.length,
      processedCount: adapterCells.length,
      unavailableReason: null,
    },
    evidence: adapterCells.flatMap((receipt) =>
      adapterReceipt.adapter === "visual-identity"
        ? visualEvidenceFor(receipt)
        : voiceEvidenceFor(receipt),
    ),
  };
}

/**
 * Re-validates and seals the exact plan/receipt set before projecting it into
 * the existing `createBroadcastParticipantGrounding(..., outputs)` contract.
 * It performs no media inference and never invents confidence for abstentions.
 */
export function projectBroadcastParticipantGroundingAdapterOutputs(
  input: ProjectBroadcastParticipantGroundingAdapterOutputsInput,
): BroadcastParticipantGroundingAdapterOutputs {
  assertCurrentSourceFence(input);
  const sealed = sealBroadcastParticipantGroundingPlan(
    input.plan,
    input.cellReceipts,
  );
  if (!sourceFenceMatches(sealed.sourceFence, input.expectedSourceFence)) {
    throw new BroadcastParticipantGroundingBridgeError(
      "SOURCE_FENCE_MISMATCH",
      "The sealed participant result changed its source fence.",
    );
  }
  const visualIdentity = outputForAdapter(
    adapterCompletionReceipt(sealed.adapterReceipts, "visual-identity"),
    sealed.terminalCells,
  );
  const voiceIdentity = outputForAdapter(
    adapterCompletionReceipt(sealed.adapterReceipts, "voice-identity"),
    sealed.terminalCells,
  );
  if (
    visualIdentity.evidence.length + voiceIdentity.evidence.length >
    MAX_BROADCAST_PARTICIPANT_OBSERVED_EVIDENCE
  ) {
    throw new BroadcastParticipantGroundingBridgeError(
      "OUTPUT_TOO_LARGE",
      "The sealed participant evidence exceeds the bounded grounding packet.",
    );
  }
  return { visualIdentity, voiceIdentity };
}
