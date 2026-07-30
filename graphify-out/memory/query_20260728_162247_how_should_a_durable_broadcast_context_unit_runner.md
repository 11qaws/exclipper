---
type: "query"
date: "2026-07-28T16:22:47.367103+00:00"
question: "How should a durable broadcast context unit runner resume, retry, persist, and complete work?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["broadcastTranscriptFragmentRecovery.ts", "reduceCandidateAudioEventRun()", "durableAnalysisPayload.ts"]
---

# Q: How should a durable broadcast context unit runner resume, retry, persist, and complete work?

## Answer

Expanded from original query via graph vocab: durable, execution, recovery, resume, operation, attempt, identity, transition, persistence, failure, unknown, completion. Existing reducer and transcript recovery patterns support persisting in-flight before provider execution, sealing recovered in-flight work as outcome-unknown, retrying only explicitly safe gaps with fresh operation identities, preserving successful siblings, serializing durable transitions, and publishing completion only after required units succeed. The implemented runner additionally applies bounded provider concurrency inside strict discovery-to-jury-to-refinement phase barriers.

## Outcome

- Signal: useful

## Source Nodes

- broadcastTranscriptFragmentRecovery.ts
- reduceCandidateAudioEventRun()
- durableAnalysisPayload.ts