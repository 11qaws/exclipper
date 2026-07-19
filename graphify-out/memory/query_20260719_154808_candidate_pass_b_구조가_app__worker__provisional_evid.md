---
type: "query"
date: "2026-07-19T15:48:08.466031+00:00"
question: "Candidate Pass B 구조가 App, Worker, provisional evidence, finalizing 완료 fence를 어떻게 연결하는가?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["App()", "runCandidatePassBWorker()", "buildCandidatePassBEvidence()", "reduceCandidatePassBRun()", "mergeCandidatePassBEvidence()"]
---

# Q: Candidate Pass B 구조가 App, Worker, provisional evidence, finalizing 완료 fence를 어떻게 연결하는가?

## Answer

App이 candidate-only Worker를 실행하고 timestamp 결과를 CandidatePassBEvidence로 변환한다. 품질 신호 없는 결과는 provisional cue로만 카드에 투영하며 fast narrative와 후보 경계·검토 상태를 바꾸지 않는다. reducer는 마지막 후보 뒤 finalizing에 머물고 검증된 RUN_COMPLETED envelope 또는 명시적 cancellation termination 뒤에만 terminal이 된다.

## Outcome

- Signal: useful

## Source Nodes

- App()
- runCandidatePassBWorker()
- buildCandidatePassBEvidence()
- reduceCandidatePassBRun()
- mergeCandidatePassBEvidence()