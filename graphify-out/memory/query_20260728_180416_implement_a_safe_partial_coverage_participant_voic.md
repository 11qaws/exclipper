---
type: "query"
date: "2026-07-28T18:04:16.335457+00:00"
question: "Implement a safe partial-coverage participant voice grounding contract with explicit coverage, thresholds, margin, and abstention."
contributor: "graphify"
outcome: "useful"
source_nodes: ["broadcastParticipantGroundingPlan.ts", "participantVoiceEnrollmentManifest.ts", "BroadcastParticipantGrounding"]
---

# Q: Implement a safe partial-coverage participant voice grounding contract with explicit coverage, thresholds, margin, and abstention.

## Answer

Expanded from graph vocabulary via participant, voice, grounding, enrollment, roster, coverage, match, threshold, unknown, identity, and adapter. broadcastParticipantGroundingPlan.ts owns the immutable pre-context plan and now permits a verified roster subset while binding covered and missing IDs plus an open-set recognition policy into the adapter fence. projectBroadcastParticipantVoiceRecognition consumes externally computed normalized scores only; it requires one score per covered participant and emits a known ID only when both the participant absolute threshold and top-1/top-2 margin pass. Otherwise it emits the explicit unknown ID, while no-speech remains a distinct terminal. The runtime media inference and the bridge into BroadcastParticipantGrounding are still absent and must not be claimed.

## Outcome

- Signal: useful

## Source Nodes

- broadcastParticipantGroundingPlan.ts
- participantVoiceEnrollmentManifest.ts
- BroadcastParticipantGrounding