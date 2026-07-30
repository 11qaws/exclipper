---
type: "query"
date: "2026-07-28T09:19:11.207071+00:00"
question: "1) groq에서 whisper v3을 무료 제공하는데, 지금 qwen3-asr/qwen3.5 omni flash 와 비교해보자. 뭐가 가장 합리적인지\n2) 구간별로 말이 없는 구간은 '무발화'구간으로 처리해서 대화 분석에 넣지 않아야 하는데(영상 분석에는 넣어야함) 알고리즘이 있을까"
contributor: "graphify"
outcome: "useful"
source_nodes: ["src/analysis/broadcastTranscript.worker.ts", "src/analysis/broadcastTranscriptQwen.ts", "src/analysis/broadcastTranscriptFragmentRecovery.ts", "src/analysis/broadcastTranscriptChapters.ts"]
---

# Q: 1) groq에서 whisper v3을 무료 제공하는데, 지금 qwen3-asr/qwen3.5 omni flash 와 비교해보자. 뭐가 가장 합리적인지
2) 구간별로 말이 없는 구간은 '무발화'구간으로 처리해서 대화 분석에 넣지 않아야 하는데(영상 분석에는 넣어야함) 알고리즘이 있을까

## Answer

Expanded query tokens: audio, speech, transcript, transcription, chunk, broadcast, context, video, music, qwen. ExClipper의 합리적 구조는 Silero VAD v6 ONNX로 speech/no-speech/uncertain을 먼저 구분하고, speech와 uncertain만 전용 ASR로 보내며, 모든 구간은 영상 분석에 남기는 것이다. 무료 단계의 1차 ASR 후보는 Groq whisper-large-v3이고, Qwen3-ASR filetrans는 12시간 장문 및 장애/한도 fallback, qwen3.5-omni-flash는 화면·오디오 맥락 해석 전용이 맞다. 현재 코드는 qwen3.5-omni를 전사에 쓰고 pcm.length===0만 no-audio로 판정하며 [대사 없음]도 대화 chapter로 만들 수 있어 역할 분리와 상태 모델 수정이 필요하다.

## Outcome

- Signal: useful

## Source Nodes

- src/analysis/broadcastTranscript.worker.ts
- src/analysis/broadcastTranscriptQwen.ts
- src/analysis/broadcastTranscriptFragmentRecovery.ts
- src/analysis/broadcastTranscriptChapters.ts