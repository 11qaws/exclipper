import { describe, expect, it } from "vitest";
import {
  candidatePassBContextFingerprint,
  createCandidatePassBContextPacket,
  createCandidatePassBVerificationReceipt,
  candidatePassBReceiptMatchesContext,
  finalizeFullyVerifiedCandidates,
} from "./candidateFinalVerification";
import {
  MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH,
  type CandidatePassBContextPacket,
  type CandidatePassBInsight,
} from "./candidatePassBWorkerProtocol";
import { canonicalizeCandidatePassBContextPacket } from "./candidatePassBContextBudget";

const candidate = {
  id: "candidate-1",
  startMs: 10_000,
  peakMs: 25_000,
  endMs: 50_000,
  score: 0.9,
};

const context = createCandidatePassBContextPacket({
  transcriptSource: "youtube-caption",
  transcriptKo: "실제로 확인한 후보 대사",
  beforeContextKo: "앞에서 음식 이름을 맞히는 퀴즈를 시작했다.",
  afterContextKo: "정답을 확인하고 자신의 실수를 인정했다.",
  broadcastSummaryKo: "방송 전체에서 음식 이름 맞히기와 잡담을 진행했다.",
  topicContextKo: "음식 이름 맞히기 퀴즈 구간",
  fastEvidenceKo: "말의 높낮이와 화면 변화가 함께 나타난 잠재 구간",
  contextDecision: "select",
  contextCategory: "reaction",
  contextVerdictKo: "오답을 알아차린 반응이 앞뒤 흐름과 연결된다.",
  chatReactionKo: null,
});

const insight: CandidatePassBInsight = {
  eventSummaryKo: "화면과 대사에서 오답을 확인하고 반응하는 과정이 확인됐다.",
  reactionSummaryKo: "스트리머가 잠시 멈춘 뒤 웃으며 자신의 실수를 인정했다.",
  whyGoodClipKo: "앞선 추측과 정답 확인이 한 구간 안에서 완결된다.",
  uncertaintiesKo: [],
  participantPresence: "present-unidentified",
  participantSummaryKo: "화면 오른쪽에 이름을 확인하지 못한 아바타가 있다.",
  identifiedParticipants: [],
  clipDecision: "recommend",
  contextConsistency: "consistent",
  programMaterial: "streamer-event",
};

function maximumContextField(label: string, fill: string): string {
  const prefix = `${label}START`;
  const suffix = `${label}END`;
  return `${prefix}${fill.repeat(
    MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH -
      prefix.length -
      suffix.length,
  )}${suffix}`;
}

function maximumContext(
  label: string,
  fill: string,
): CandidatePassBContextPacket {
  return {
    ...context!,
    transcriptKo: maximumContextField(`${label}-transcript`, fill),
    beforeContextKo: maximumContextField(`${label}-before`, fill),
    afterContextKo: maximumContextField(`${label}-after`, fill),
    broadcastSummaryKo: maximumContextField(`${label}-broadcast`, fill),
    topicContextKo: maximumContextField(`${label}-topic`, fill),
    fastEvidenceKo: maximumContextField(`${label}-evidence`, fill),
    contextVerdictKo: maximumContextField(`${label}-verdict`, fill),
    chatReactionKo: maximumContextField(`${label}-chat`, fill),
  };
}

describe("candidate final verification", () => {
  it("publishes only candidates with context, audio, four frames and a consistent recommendation", () => {
    expect(context).not.toBeNull();
    const frames = [1_000, 2_000, 3_000, 4_000].map((timestampMs) => ({
      timestampMs,
    }));
    const receipt = createCandidatePassBVerificationReceipt(context!, frames, 1_000);
    const result = finalizeFullyVerifiedCandidates({
      candidates: [candidate],
      contextByCandidateId: { [candidate.id]: context! },
      insightByCandidateId: { [candidate.id]: insight },
      receiptByCandidateId: { [candidate.id]: receipt! },
      completeEvidenceCandidateIds: new Set([candidate.id]),
    });

    expect(result.candidates.map(({ id }) => id)).toEqual([candidate.id]);
    expect(result.gapByCandidateId).toEqual({});
  });

  it("does not publish fast discoveries when any required evidence is missing", () => {
    const result = finalizeFullyVerifiedCandidates({
      candidates: [candidate],
      contextByCandidateId: { [candidate.id]: context! },
      insightByCandidateId: { [candidate.id]: insight },
      receiptByCandidateId: {},
      completeEvidenceCandidateIds: new Set([candidate.id]),
    });

    expect(result.candidates).toEqual([]);
    expect(result.gapByCandidateId[candidate.id]).toBe(
      "verification-receipt-missing",
    );
  });

  it("does not publish an in-memory result before its artifact set is read back", () => {
    const frames = [1_000, 2_000, 3_000, 4_000].map((timestampMs) => ({
      timestampMs,
    }));
    const receipt = createCandidatePassBVerificationReceipt(
      context!,
      frames,
      1_000,
    )!;
    const result = finalizeFullyVerifiedCandidates({
      candidates: [candidate],
      contextByCandidateId: { [candidate.id]: context! },
      insightByCandidateId: { [candidate.id]: insight },
      receiptByCandidateId: { [candidate.id]: receipt },
      completeEvidenceCandidateIds: new Set(),
    });

    expect(result.candidates).toEqual([]);
    expect(result.gapByCandidateId[candidate.id]).toBe("evidence-incomplete");
  });

  it("fails closed when an untyped stale caller omits the durability fence", () => {
    const frames = [1_000, 2_000, 3_000, 4_000].map((timestampMs) => ({
      timestampMs,
    }));
    const receipt = createCandidatePassBVerificationReceipt(
      context!,
      frames,
      1_000,
    )!;
    const staleInput = {
      candidates: [candidate],
      contextByCandidateId: { [candidate.id]: context! },
      insightByCandidateId: { [candidate.id]: insight },
      receiptByCandidateId: { [candidate.id]: receipt },
    } as unknown as Parameters<typeof finalizeFullyVerifiedCandidates>[0];

    const result = finalizeFullyVerifiedCandidates(staleInput);

    expect(result.candidates).toEqual([]);
    expect(result.gapByCandidateId[candidate.id]).toBe("evidence-incomplete");
  });

  it("records an explicit context rejection as a completed judgement, not missing context", () => {
    const result = finalizeFullyVerifiedCandidates({
      candidates: [candidate],
      contextExcludedCandidateIds: new Set([candidate.id]),
      contextByCandidateId: {},
      insightByCandidateId: {},
      receiptByCandidateId: {},
      completeEvidenceCandidateIds: new Set(),
    });

    expect(result.candidates).toEqual([]);
    expect(result.gapByCandidateId[candidate.id]).toBe("context-excluded");
  });

  it("keeps a genuinely absent context packet fail-closed", () => {
    const result = finalizeFullyVerifiedCandidates({
      candidates: [candidate],
      contextExcludedCandidateIds: new Set(),
      contextByCandidateId: {},
      insightByCandidateId: {},
      receiptByCandidateId: {},
      completeEvidenceCandidateIds: new Set(),
    });

    expect(result.candidates).toEqual([]);
    expect(result.gapByCandidateId[candidate.id]).toBe("context-missing");
  });

  it("invalidates a paid detail receipt when the whole-broadcast context changes", () => {
    const frames = [1_000, 2_000, 3_000, 4_000].map((timestampMs) => ({
      timestampMs,
    }));
    const receipt = createCandidatePassBVerificationReceipt(
      context!,
      frames,
      1_000,
    )!;
    const changedContext = {
      ...context!,
      broadcastSummaryKo:
        "복구된 누락 대사를 포함해 음식 퀴즈의 앞뒤 사건 순서가 달라졌다.",
    };

    expect(candidatePassBReceiptMatchesContext(receipt, changedContext)).toBe(
      false,
    );
    const result = finalizeFullyVerifiedCandidates({
      candidates: [candidate],
      contextByCandidateId: { [candidate.id]: changedContext },
      insightByCandidateId: { [candidate.id]: insight },
      receiptByCandidateId: { [candidate.id]: receipt },
      completeEvidenceCandidateIds: new Set([candidate.id]),
    });
    expect(result.candidates).toEqual([]);
    expect(result.gapByCandidateId[candidate.id]).toBe("evidence-incomplete");
  });

  it.each<{
    readonly label: string;
    readonly context: CandidatePassBContextPacket;
  }>([
    { label: "maximum Korean", context: maximumContext("한국어", "가") },
    {
      label: "maximum multibyte English",
      context: maximumContext("english", "é"),
    },
  ])(
    "fingerprints the same canonical packet for raw and canonical $label context",
    ({ context: rawContext }) => {
      const frames = [1_000, 2_000, 3_000, 4_000].map((timestampMs) => ({
        timestampMs,
      }));
      const canonicalContext =
        canonicalizeCandidatePassBContextPacket(rawContext);
      const receiptFromRaw = createCandidatePassBVerificationReceipt(
        rawContext,
        frames,
        1_000,
      );
      const receiptFromCanonical = createCandidatePassBVerificationReceipt(
        canonicalContext,
        frames,
        1_000,
      );

      expect(canonicalizeCandidatePassBContextPacket(canonicalContext)).toEqual(
        canonicalContext,
      );
      expect(receiptFromRaw).toEqual(receiptFromCanonical);
      expect(receiptFromRaw?.contextFingerprint).toBe(
        candidatePassBContextFingerprint(canonicalContext),
      );
      expect(candidatePassBContextFingerprint(rawContext)).toBe(
        candidatePassBContextFingerprint(canonicalContext),
      );
      expect(candidatePassBReceiptMatchesContext(receiptFromRaw!, rawContext))
        .toBe(true);
      expect(
        candidatePassBReceiptMatchesContext(
          receiptFromRaw!,
          canonicalContext,
        ),
      ).toBe(true);
    },
  );

  it("excludes music and context conflicts even with complete local evidence", () => {
    const frames = [1_000, 2_000, 3_000, 4_000].map((timestampMs) => ({
      timestampMs,
    }));
    const receipt = createCandidatePassBVerificationReceipt(
      context!,
      frames,
      1_000,
    )!;
    const result = finalizeFullyVerifiedCandidates({
      candidates: [candidate],
      contextByCandidateId: { [candidate.id]: context! },
      insightByCandidateId: {
        [candidate.id]: {
          ...insight,
          programMaterial: "music-or-intermission",
          contextConsistency: "conflict",
        },
      },
      receiptByCandidateId: { [candidate.id]: receipt },
      completeEvidenceCandidateIds: new Set([candidate.id]),
    });

    expect(result.candidates).toEqual([]);
    expect(result.gapByCandidateId[candidate.id]).toBe(
      "program-material-excluded",
    );
  });
});
