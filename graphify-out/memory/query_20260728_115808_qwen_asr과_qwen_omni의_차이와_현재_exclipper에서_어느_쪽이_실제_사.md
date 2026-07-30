---
type: "query"
date: "2026-07-28T11:58:08.486005+00:00"
question: "qwen asr과 qwen omni의 차이와 현재 ExClipper에서 어느 쪽이 실제 사용되는가"
contributor: "graphify"
outcome: "useful"
source_nodes: ["broadcastTranscriptQwen.ts", "aiProviderConfiguration.ts", "aiProxy.worker.ts", "candidatePassBQwenOmni.ts", "aiQuotaPolicy.ts"]
---

# Q: qwen asr과 qwen omni의 차이와 현재 ExClipper에서 어느 쪽이 실제 사용되는가

## Answer

Expanded from original query via graph vocab: [qwen, asr, omni, transcript, candidate, context, model, audio, frames, timestamps, transport, provider, worker]. Code audit: qwen3-asr-flash is defined in broadcastTranscriptQwen.ts with a native DashScope Base64 builder and extractor, but production code never imports/calls those functions. The provider catalog maps broadcast-transcript/qwen to qwen3.5-omni-flash, the active revision is the Omni revision, wrangler selects qwen, and aiProxy attemptBroadcastTranscriptProvider always builds Omni inline or URL requests and parses Omni SSE. Therefore current 90-second whole-broadcast transcript is Omni over browser WAV -> private R2 -> capability URL, not Qwen ASR. Candidate AV correctly uses qwen3.5-omni-flash with audio, frames, bounded context, and structured clip interpretation. Broadcast context is qwen3.7-plus/qwen3.6-flash, not Omni. Both transcript adapters currently yield only a whole-chunk source fence, not canonical word timestamps; candidate Omni relative segments are generated analysis output. There is a real accounting/routing mismatch: QWEN_ASR_SAFE_CHUNK_DURATION_MS, adaptive-qwen-asr, and qwen3-asr-filetrans price are used while Omni is actually billed. Recommendation: make qwen3-asr-flash/filetrans the canonical transcript provider through a dedicated native URL adapter, keep Omni for selected candidate audio+frames and ambiguity validation, split qwen-asr and qwen-omni quota gates, update model IDs/revisions/costing/health and preserve old Omni checkpoints as legacy identities.

## Outcome

- Signal: useful

## Source Nodes

- broadcastTranscriptQwen.ts
- aiProviderConfiguration.ts
- aiProxy.worker.ts
- candidatePassBQwenOmni.ts
- aiQuotaPolicy.ts