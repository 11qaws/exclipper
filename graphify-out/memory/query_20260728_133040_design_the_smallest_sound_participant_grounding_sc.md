---
type: "query"
date: "2026-07-28T13:30:40.974100+00:00"
question: "Design the smallest sound participant-grounding schema for ExClipper: six-person global catalog, source-specific priors, conservative evidence, sealed pre-context grounding, and future visual/voice adapters."
contributor: "graphify"
outcome: "useful"
source_nodes: ["participantRoster.ts", "broadcastContextProtocol.ts", "broadcastContextDeepseek.ts", "broadcastContextSessionStore.ts"]
---

# Q: Design the smallest sound participant-grounding schema for ExClipper: six-person global catalog, source-specific priors, conservative evidence, sealed pre-context grounding, and future visual/voice adapters.

## Answer

Expanded from original query via graph vocab: [participant, participants, roster, cast, identity, evidence, source, context, protocol, session, visual, references]. Keep the six identities in a global catalog with stable IDs, and represent channel ownership/eligibility as separate source priors; a prior never proves presence or speech. Add a bounded sealed participantGrounding packet to BroadcastContextRequest containing source priors, terminal adapter receipts, and typed observed evidence. Typed evidence distinguishes name mention, self-identification, on-screen name, visual-reference match, voice-reference match, and unidentified visible/speaking observations. A sealed packet contains no failed adapter: transient failures are retried, while structurally unavailable modalities are explicit; completed adapters must process all planned inputs. Raw frames/audio/embeddings never cross this protocol. Host names require both a likely-host source prior and positive observed presence/speaking evidence. Persist the packet with the broadcast context session, include it in the context input fingerprint, and preserve it in both client serialization and Worker chapter-compaction reconstruction. Current risks: personal rosters expose only the owner; host grounding trusts roster role without presence evidence; participantContextKo is unstructured fallback text; session records use exact keys; roster content changes do not invalidate caches because the exported roster version is unused.

## Outcome

- Signal: useful

## Source Nodes

- participantRoster.ts
- broadcastContextProtocol.ts
- broadcastContextDeepseek.ts
- broadcastContextSessionStore.ts