---
type: "architecture"
date: "2026-07-26T21:26:31.268401+00:00"
question: "최대 5명의 ExClipper 사용자가 공유 AI credential을 오류 없이 빠르게 쓰도록 어떤 quota와 전송 구조가 필요한가?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["aiProxy.worker.ts", "aiQuotaPolicy.ts", "aiQuotaCoordinator.ts", "aiQuotaCoordinatorClient.ts"]
---

# Q: 최대 5명의 ExClipper 사용자가 공유 AI credential을 오류 없이 빠르게 쓰도록 어떤 quota와 전송 구조가 필요한가?

## Answer

transcript와 candidate는 primary qwen-omni의 1초 start clock, 100k TPM, shared in-flight 6을 함께 사용하고 context는 250ms/5M TPM/in-flight 6의 보수적 앱 gate로 분리한다. 활성 참여자 1/2/3~5명은 각 gate에서 pipeline과 in-flight를 6/3/2로 제한하고 round-robin/FIFO를 적용한다. 본문은 60초 deadline과 bounded byte/output/frame/token 계약을 사용한다. 검증 실패 ticket은 공개 cancel이 아니라 leaseToken을 확인하고 lease-issued만 해제하는 내부 release-upload 전이로 회수해야 중복 요청이 execution-waiting을 취소하지 않는다. Free Worker 10ms에서는 90초 WAV의 Base64/JSON 생성이 안전하지 않으므로 운영 전 Paid 또는 R2+ASR 경로 결정과 1/2/5명 live smoke가 남는다.

## Outcome

- Signal: useful

## Source Nodes

- aiProxy.worker.ts
- aiQuotaPolicy.ts
- aiQuotaCoordinator.ts
- aiQuotaCoordinatorClient.ts