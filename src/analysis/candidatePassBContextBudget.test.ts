import { describe, expect, it } from "vitest";
import {
  CANDIDATE_PASS_B_CANONICAL_CONTEXT_UTF8_BUDGET,
  CANDIDATE_PASS_B_CONTEXT_OMISSION_MARKER,
  canonicalizeCandidatePassBContextPacket,
  createCanonicalCandidatePassBContextPacket,
  type CandidatePassBContextPacketInput,
} from "./candidatePassBContextBudget";
import {
  MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH,
  type CandidatePassBContextPacket,
} from "./candidatePassBWorkerProtocol";
import { isCandidatePassBContextPacket } from "./candidateFinalVerification";

function packetInput(
  overrides: Partial<CandidatePassBContextPacketInput> = {},
): CandidatePassBContextPacketInput {
  return {
    transcriptSource: "broadcast-transcript",
    transcriptKo: "후보의 정확한 대사",
    beforeContextKo: "직전에는 음식 퀴즈를 풀고 있었다.",
    afterContextKo: "직후에는 실수를 인정하고 다음 문제로 넘어갔다.",
    broadcastSummaryKo: "방송 전체에서 음식 이름 맞히기와 잡담을 진행했다.",
    topicContextKo: "음식 이름 맞히기",
    fastEvidenceKo: "짧은 비명 뒤 웃음과 정정 발화가 이어졌다.",
    contextDecision: "select",
    contextCategory: "reaction",
    contextVerdictKo: "실수와 정정이 한 구간에서 완결된다.",
    chatReactionKo: "채팅도 정답을 알려 주며 함께 웃었다.",
    ...overrides,
  };
}

function maximumField(label: string, fill: string): string {
  const prefix = `${label}START`;
  const suffix = `${label}END`;
  return `${prefix}${fill.repeat(
    MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH -
      prefix.length -
      suffix.length,
  )}${suffix}`;
}

function contextTextValues(
  context: CandidatePassBContextPacket,
): readonly string[] {
  return [
    context.transcriptKo,
    context.beforeContextKo,
    context.afterContextKo,
    context.broadcastSummaryKo,
    context.topicContextKo,
    context.fastEvidenceKo,
    context.contextVerdictKo,
    ...(context.chatReactionKo === null ? [] : [context.chatReactionKo]),
  ];
}

function aggregateUtf8Bytes(context: CandidatePassBContextPacket): number {
  const encoder = new TextEncoder();
  return contextTextValues(context).reduce(
    (sum, value) => sum + encoder.encode(value).byteLength,
    0,
  );
}

describe("candidate Pass B canonical context budget", () => {
  it("keeps normal context byte-identical and idempotent", () => {
    const input = packetInput();
    const canonical = createCanonicalCandidatePassBContextPacket(input);

    expect(canonical).not.toBeNull();
    expect(canonical).toMatchObject(input);
    expect(JSON.stringify(canonical)).not.toContain(
      CANDIDATE_PASS_B_CONTEXT_OMISSION_MARKER,
    );
    expect(canonicalizeCandidatePassBContextPacket(canonical!)).toEqual(
      canonical,
    );
    expect(isCandidatePassBContextPacket(canonical)).toBe(true);
  });

  it("deterministically compacts maximum Korean fields while preserving exact transcript", () => {
    const input = packetInput({
      transcriptKo: maximumField("대사", "가"),
      beforeContextKo: maximumField("직전", "나"),
      afterContextKo: maximumField("직후", "다"),
      broadcastSummaryKo: maximumField("전체", "라"),
      topicContextKo: maximumField("주제", "마"),
      fastEvidenceKo: maximumField("탐색", "바"),
      contextVerdictKo: maximumField("판정", "사"),
      chatReactionKo: maximumField("채팅", "아"),
    });
    const untouchedInput = structuredClone(input);
    const first = createCanonicalCandidatePassBContextPacket(input);
    const second = createCanonicalCandidatePassBContextPacket(input);

    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(input).toEqual(untouchedInput);
    expect(first?.transcriptKo).toBe(input.transcriptKo);
    expect(aggregateUtf8Bytes(first!)).toBeLessThanOrEqual(
      CANDIDATE_PASS_B_CANONICAL_CONTEXT_UTF8_BUDGET,
    );
    for (const value of contextTextValues(first!).slice(1)) {
      expect(value).toContain(CANDIDATE_PASS_B_CONTEXT_OMISSION_MARKER);
    }
    for (const label of ["직전", "직후", "전체", "주제", "탐색", "판정", "채팅"]) {
      const matching = contextTextValues(first!).find((value) =>
        value.startsWith(`${label}START`)
      );
      expect(matching).toContain(`${label}END`);
    }
    expect(contextTextValues(first!).every((value) => value.length > 0)).toBe(
      true,
    );
    expect(isCandidatePassBContextPacket(first)).toBe(true);
  });

  it("applies the same explicit contract to maximum multibyte English context", () => {
    const input = packetInput({
      transcriptKo: maximumField("transcript", "é"),
      beforeContextKo: maximumField("before", "é"),
      afterContextKo: maximumField("after", "é"),
      broadcastSummaryKo: maximumField("broadcast", "é"),
      topicContextKo: maximumField("topic", "é"),
      fastEvidenceKo: maximumField("evidence", "é"),
      contextVerdictKo: maximumField("verdict", "é"),
      chatReactionKo: maximumField("chat", "é"),
    });
    const canonical = createCanonicalCandidatePassBContextPacket(input);

    expect(canonical).not.toBeNull();
    expect(canonical?.transcriptKo).toBe(input.transcriptKo);
    expect(aggregateUtf8Bytes(canonical!)).toBeLessThanOrEqual(
      CANDIDATE_PASS_B_CANONICAL_CONTEXT_UTF8_BUDGET,
    );
    const originalNonTranscript = [
      input.beforeContextKo,
      input.afterContextKo,
      input.broadcastSummaryKo,
      input.topicContextKo,
      input.fastEvidenceKo,
      input.contextVerdictKo,
      input.chatReactionKo!,
    ];
    const canonicalNonTranscript = contextTextValues(canonical!).slice(1);
    let compactedFields = 0;
    canonicalNonTranscript.forEach((value, index) => {
      if (value !== originalNonTranscript[index]) {
        compactedFields += 1;
        expect(value).toContain(CANDIDATE_PASS_B_CONTEXT_OMISSION_MARKER);
      }
    });
    expect(compactedFields).toBeGreaterThan(0);
    expect(canonicalizeCandidatePassBContextPacket(canonical!)).toEqual(
      canonical,
    );
  });

  it("marks per-field protocol compaction instead of silently slicing", () => {
    const longSummary = `방송시작${"긴요약".repeat(2_000)}방송끝`;
    const canonical = createCanonicalCandidatePassBContextPacket(
      packetInput({ broadcastSummaryKo: longSummary }),
    );

    expect(canonical).not.toBeNull();
    expect(canonical?.broadcastSummaryKo).toContain("방송시작");
    expect(canonical?.broadcastSummaryKo).toContain("방송끝");
    expect(canonical?.broadcastSummaryKo).toContain(
      CANDIDATE_PASS_B_CONTEXT_OMISSION_MARKER,
    );
    expect(Array.from(canonical!.broadcastSummaryKo)).toHaveLength(
      MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH,
    );
  });
});
