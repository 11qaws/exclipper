---
type: "query"
date: "2026-07-28T13:32:17.528267+00:00"
question: "How should a participant grounding packet and timeline be persisted backward-compatibly across broadcast context sessions?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["broadcastContextSessionStore.ts", "BroadcastContextSessionRecord", "analysisResultStore.ts", "candidatePassBInsightStore.ts", "participantRoster.ts"]
---

# Q: How should a participant grounding packet and timeline be persisted backward-compatibly across broadcast context sessions?

## Answer

Expanded from original query via graph vocab: [storage, store, session, record, candidate, insight, persistence, migration, schema, participant, grounding, timeline]. Prefer extending BroadcastContextSessionRecord with a paired, versioned participant-grounding input signature and bounded checkpoint JSON, migrating 1.2->1.3->1.4 while preserving paid chapters/context/refinement. Keep media bytes and embeddings out of per-run storage; store only catalog/reference revisions and bounded evidence. Require sealed exact readback before context and include the packet signature in context cache identity. CandidatePassBInsightsRecord remains the post-context per-candidate insight/thumbnail/receipt store. Existing tracked UI portraits cover five members only; no Sera portrait or voice reference/embedding asset exists.

## Outcome

- Signal: useful

## Source Nodes

- broadcastContextSessionStore.ts
- BroadcastContextSessionRecord
- analysisResultStore.ts
- candidatePassBInsightStore.ts
- participantRoster.ts