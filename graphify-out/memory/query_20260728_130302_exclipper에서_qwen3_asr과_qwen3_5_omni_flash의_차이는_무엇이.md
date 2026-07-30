---
type: "architecture"
date: "2026-07-28T13:03:02.964728+00:00"
question: "ExClipper에서 Qwen3-ASR과 Qwen3.5-Omni-Flash의 차이는 무엇이며 어느 단계에 써야 하는가?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["broadcastTranscriptQwen.ts", "aiProviderConfiguration.ts", "aiProxy.worker.ts", "candidatePassBQwenOmni.ts", "candidatePassBWorkerProtocol.ts", "aiQuotaPolicy.ts", "broadcastContextSamplingPlan.ts"]
---

# Q: ExClipper에서 Qwen3-ASR과 Qwen3.5-Omni-Flash의 차이는 무엇이며 어느 단계에 써야 하는가?

## Answer

역할을 분리해야 한다. 방송 전체의 기준 대사와 타임스탬프는 전용 Qwen3-ASR, 특히 최종 기준에는 qwen3-asr-flash-filetrans를 사용한다. qwen3.5-omni-flash는 후보 30~60초의 원본 오디오, 대표 화면 4장, ASR 대사, 방송 전체 맥락을 함께 받아 사건·등장인물·반응·음악/MV 여부·클립 가치를 해석한다. 현재 코드는 전용 ASR 빌더가 있으나 운영 broadcastTranscript 카탈로그와 활성 revision이 Omni를 가리켜 전체 전사에도 Omni를 쓰며, transcript와 candidate가 qwen-omni quota gate를 공유하고 ASR 단가로 비용을 계산하는 불일치가 있다. 다음 구현은 ASR/Omni provider와 quota, 결과 스키마를 분리하고 raw ASR 대사와 후처리 교정문을 별도로 보존해야 한다.

## Outcome

- Signal: useful

## Source Nodes

- broadcastTranscriptQwen.ts
- aiProviderConfiguration.ts
- aiProxy.worker.ts
- candidatePassBQwenOmni.ts
- candidatePassBWorkerProtocol.ts
- aiQuotaPolicy.ts
- broadcastContextSamplingPlan.ts