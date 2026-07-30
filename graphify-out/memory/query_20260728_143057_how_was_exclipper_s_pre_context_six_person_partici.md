---
type: "query"
date: "2026-07-28T14:30:57.855786+00:00"
question: "How was ExClipper's pre-context six-person participant grounding pipeline refined?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["BroadcastParticipantGrounding", "broadcastParticipantGrounding.ts", "participantRoster.ts", "broadcastContextProtocol.ts", "broadcastContextDeepseek.ts", "broadcastContextSessionStore.ts", "analysisResultStore.ts", "App.tsx"]
---

# Q: How was ExClipper's pre-context six-person participant grounding pipeline refined?

## Answer

Separated the six-person catalog, source roster priors, transcript name mentions, and observed visual/voice evidence. Personal channels now retain five eligible members while excluding Sera. Canonical media adapter receipts can preserve identified, unidentified, none-visible, unknown-speaker, and no-speech terminal evidence through 144-chapter rebasing. Whole-context prompts cannot promote roster priors to observed identity. Session schema 1.5 binds source roster, transcript seal, participant checkpoint, and exact context input; context and refinement commits use IndexedDB compare-and-swap and recovery recomputes fingerprints before reuse. Actual visual/voice adapters remain explicitly unavailable until verified six-person reference assets exist.

## Outcome

- Signal: useful

## Source Nodes

- BroadcastParticipantGrounding
- broadcastParticipantGrounding.ts
- participantRoster.ts
- broadcastContextProtocol.ts
- broadcastContextDeepseek.ts
- broadcastContextSessionStore.ts
- analysisResultStore.ts
- App.tsx