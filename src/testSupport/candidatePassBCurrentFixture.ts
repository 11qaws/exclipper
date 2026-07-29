import type { CandidatePassBEvidence } from "../analysis/candidatePassB";
import {
  candidatePassBContextFingerprint,
  createCandidatePassBContextPacket,
  createCandidatePassBVerificationReceipt,
} from "../analysis/candidateFinalVerification";
import {
  createCandidatePassBInitialAttemptLedger,
} from "../analysis/candidatePassBAttemptLedger";
import {
  CANDIDATE_PASS_B_AUDIO_GATE_REVISION,
  CANDIDATE_PASS_B_DISPATCH_INTENT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
  CANDIDATE_PASS_B_MEDIA_RECEIPT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
  type CandidatePassBCompletedSettlement,
  type CandidatePassBContextPacket,
  type CandidatePassBDispatchIntent,
  type CandidatePassBVerificationReceipt,
  type CandidatePassBVerificationSourceFence,
  type CandidatePassBVideoFrame,
} from "../analysis/candidatePassBWorkerProtocol";
import {
  CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_PLAN_RECEIPT_SCHEMA_VERSION,
  type CandidatePassBPlanReceipt,
  type CandidatePassBInsightsRecord,
  type StoredCandidatePassBInsight,
} from "../storage/candidatePassBInsightStore";

const digest = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;

export function currentCandidatePassBContext(): CandidatePassBContextPacket {
  const context = createCandidatePassBContextPacket({
    transcriptSource: "broadcast-transcript",
    transcriptKo: "조용히 목표를 달성한 뒤 결과를 확인한다.",
    beforeContextKo: "여러 차례 실패한 뒤 마지막 시도를 준비했다.",
    afterContextKo: "성공 과정을 설명하고 다음 주제로 넘어갔다.",
    broadcastSummaryKo: "반복 도전과 성공 확인이 이어지는 방송이다.",
    topicContextKo: "마지막 도전과 성공 확인",
    fastEvidenceKo: "대사와 화면 변화가 같은 사건을 가리킨다.",
    contextDecision: "select",
    contextCategory: "quiet-achievement",
    contextVerdictKo: "앞선 준비와 결과가 연결되는 독립 사건이다.",
    chatReactionKo: null,
  });
  if (context === null) throw new Error("The current Pass B fixture is invalid.");
  return context;
}

export function currentCandidatePassBFrames(): readonly [
  CandidatePassBVideoFrame,
  CandidatePassBVideoFrame,
  CandidatePassBVideoFrame,
  CandidatePassBVideoFrame,
] {
  return [5_000, 15_000, 25_000, 35_000].map((timestampMs, index) => ({
    timestampMs,
    mimeType: "image/jpeg" as const,
    dataBase64: btoa(`frame-${index}`),
  })) as unknown as readonly [
    CandidatePassBVideoFrame,
    CandidatePassBVideoFrame,
    CandidatePassBVideoFrame,
    CandidatePassBVideoFrame,
  ];
}

export function currentCandidatePassBSourceFence(
  candidateId = "candidate-1",
): CandidatePassBVerificationSourceFence {
  return {
    candidateId,
    sourceStartMs: 60_000,
    sourceEndMs: 105_000,
    routingModelRevision: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
    refinementEvidenceProjectionFingerprint: null,
    outputLanguage: "ko",
    castRosterId: null,
  };
}

export function currentCandidatePassBDispatch(
  context = currentCandidatePassBContext(),
  candidateId = "candidate-1",
  audioKind: "audible-audio" | "verified-no-speech" = "audible-audio",
): CandidatePassBDispatchIntent {
  const frames = currentCandidatePassBFrames();
  const audio =
    audioKind === "audible-audio"
      ? {
          kind: "audible-audio" as const,
          wavByteLength: 32_044,
          wavContentDigest: digest("5"),
          sampleRateHz: CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
          sampleCount: 16_000,
        }
      : {
          kind: "verified-no-speech" as const,
          wavByteLength: 32_044,
          wavContentDigest: digest("5"),
          sampleRateHz: CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
          sampleCount: 16_000,
          vadRevision: CANDIDATE_PASS_B_AUDIO_GATE_REVISION,
          frameCount: 50,
          activeFrameCount: 0,
          activeFrameRatio: 0,
          audible: false as const,
        };
  return {
    schemaVersion: CANDIDATE_PASS_B_DISPATCH_INTENT_SCHEMA_VERSION,
    operationId: `candidate-pass-b.${candidateId}`,
    analysisRunId: "analysis-run-1",
    candidateId,
    sourceFingerprint: "source-fingerprint-1",
    sourceStartMs: 60_000,
    sourceEndMs: 105_000,
    contextFingerprint: candidatePassBContextFingerprint(context),
    outputLanguage: "ko",
    castRosterId: null,
    routingModelRevision: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
    attemptOrdinal: 0,
    retryGrantId: null,
    transportMode: "paid-direct",
    mediaReceipt: {
      schemaVersion: CANDIDATE_PASS_B_MEDIA_RECEIPT_SCHEMA_VERSION,
      frameExtractionRevision: CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
      frames: frames.map((frame, index) => ({
        timestampMs: frame.timestampMs,
        mimeType: frame.mimeType,
        byteLength: 7,
        contentDigest: digest(String(index + 1)),
        extractionRevision: CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
      })) as unknown as CandidatePassBDispatchIntent["mediaReceipt"]["frames"],
      audio,
      providerPayloadDigest: digest("6"),
    },
  };
}

export function currentCandidatePassBSettlement(
  dispatch: CandidatePassBDispatchIntent,
): CandidatePassBCompletedSettlement {
  return {
    schemaVersion: CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
    status: "completed",
    operationId: dispatch.operationId,
    providerPayloadDigest: dispatch.mediaReceipt.providerPayloadDigest,
    outputLanguage: dispatch.outputLanguage,
    castRosterId: dispatch.castRosterId,
    responseDigest: digest("7"),
    providerModelId: CANDIDATE_PASS_B_QWEN_MODEL_ID,
    providerModelRevision: CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  };
}

export function currentCandidatePassBReceipt(
  context = currentCandidatePassBContext(),
  dispatch = currentCandidatePassBDispatch(context),
  settlement = currentCandidatePassBSettlement(dispatch),
): CandidatePassBVerificationReceipt {
  const receipt = createCandidatePassBVerificationReceipt(
    context,
    25_000,
    currentCandidatePassBSourceFence(dispatch.candidateId),
    dispatch,
    settlement,
  );
  if (receipt === null) throw new Error("The current receipt fixture is invalid.");
  return receipt;
}

export function currentCandidatePassBInsight(): StoredCandidatePassBInsight {
  return {
    eventSummaryKo: "반복 도전 끝에 목표를 달성하고 결과를 확인했다.",
    reactionSummaryKo: "스트리머가 성공 화면을 확인하고 기뻐했다.",
    whyGoodClipKo: "준비와 성공, 반응이 짧은 구간 안에서 완결된다.",
    uncertaintiesKo: [],
    participantPresence: "present-unidentified",
    participantSummaryKo: "아바타는 보이지만 이름 근거는 확인되지 않았다.",
    identifiedParticipants: [],
    clipDecision: "recommend",
    contextConsistency: "consistent",
    programMaterial: "streamer-event",
  };
}

function currentCandidatePassBEvidence(
  candidateId: string,
): CandidatePassBEvidence {
  return {
    candidateId,
    cues: [],
    overlay: {
      event: "성공 사건",
      why: "준비와 결과가 연결된다.",
      reviewHint: "성공 화면과 반응을 확인하세요.",
      basisLabel: "AI 대사 단서 · 재생 확인 필요",
    },
    quality: {
      receivedChunkCount: 1,
      mappedChunkCount: 1,
      usableChunkCount: 1,
      discardedChunkCount: 0,
      meanConfidence: 0.9,
    },
    status: "grounded-transcript",
    fallbackReason: null,
  };
}

export function currentCandidatePassBRecord(input?: {
  readonly context?: CandidatePassBContextPacket;
  readonly dispatch?: CandidatePassBDispatchIntent;
  readonly settlement?: CandidatePassBCompletedSettlement;
  readonly planReceipt?: CandidatePassBPlanReceipt;
}): CandidatePassBInsightsRecord {
  const context = input?.context ?? currentCandidatePassBContext();
  const dispatch = input?.dispatch ?? currentCandidatePassBDispatch(context);
  const settlement =
    input?.settlement ?? currentCandidatePassBSettlement(dispatch);
  const receipt = currentCandidatePassBReceipt(context, dispatch, settlement);
  const candidateId = dispatch.candidateId;
  return {
    kind: "candidatePassBInsights",
    runId: "analysis-run-1",
    schemaVersion: CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
    inputSignature: "input-signature-1",
    modelManifestHash: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
    planReceipt: input?.planReceipt ?? {
      schemaVersion: CANDIDATE_PASS_B_PLAN_RECEIPT_SCHEMA_VERSION,
      runId: "analysis-run-1",
      inputSignature: "input-signature-1",
      contextInputSignature: "context-input-signature-1",
      refinementEvidenceProjectionFingerprint: null,
      plannedCandidateIds: [candidateId],
      plannedContextFingerprints: [
        candidatePassBContextFingerprint(context),
      ],
      planFingerprint: digest("f"),
    },
    contextByCandidateId: { [candidateId]: context },
    evidenceById: {
      [candidateId]: currentCandidatePassBEvidence(candidateId),
    },
    insightById: { [candidateId]: currentCandidatePassBInsight() },
    modelByCandidateId: {
      [candidateId]: {
        id: settlement.providerModelId,
        revision: settlement.providerModelRevision,
      },
    },
    thumbnailById: {
      [candidateId]: currentCandidatePassBFrames()[2],
    },
    attemptLedgerByCandidateId: {
      [candidateId]: createCandidatePassBInitialAttemptLedger(
        dispatch,
        settlement,
      ),
    },
    dispatchIntentByCandidateId: { [candidateId]: dispatch },
    settlementByCandidateId: { [candidateId]: settlement },
    verificationReceiptById: { [candidateId]: receipt },
    recordedAt: "2026-07-29T00:00:00.000Z",
  };
}
