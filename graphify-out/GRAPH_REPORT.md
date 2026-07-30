# Graph Report - workspace  (2026-07-29)

## Corpus Check
- 415 files · ~667,691 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 5983 nodes · 13807 edges · 357 communities (334 shown, 23 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 155 edges (avg confidence: 0.67)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5d892464`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- highlightFusion.ts
- highlightExport.ts
- broadcastTranscript.worker.ts
- App.tsx
- candidateEvidenceExplanation.ts
- aiProxy.worker.ts
- candidateAudioEventWorkerProtocol.ts
- candidateAudioEvent.worker.ts
- discoveredLeadRefinement.ts
- candidateAudioEventRun.ts
- candidatePassBRun.ts
- broadcastContextProtocol.ts
- durableAnalysisPayload.ts
- candidateAudioEventWorkerClient.ts
- candidateAudioEvent.ts
- candidatePassBGemini.ts
- broadcastTranscriptQwen.ts
- aiProviderConfiguration.ts
- AnalysisResultStore
- candidatePassB.ts
- analysisResultStore.test.ts
- candidatePassBWorkerProtocol.ts
- candidatePassB.worker.ts
- candidatePassBWorkerClient.ts
- analysisRun.ts
- analysisResultStore.ts
- contextAwareCandidateSelection.ts
- localFileFingerprint.ts
- candidateRanking.ts
- candidatePassBWorkerClient.test.ts
- chatImport.ts
- localAudioReactionAnalysisCore.ts
- compilerOptions
- 사람 중심 후보 검토
- participantRoster.ts
- rejectedOperation
- broadcastTopicalDiscovery.ts
- candidateRankingView.ts
- broadcastContextSamplingPlan.ts
- candidatePassBPresentation.ts
- audioReactionAnalysis.worker.ts
- localMediaPreflight.ts
- localVideoVisualAnalysis.ts
- ExClipper 동적 타임라인·후보 검토 워크스페이스 계획
- localVideoVisualAnalysisCore.ts
- AnalysisRun State Machine
- 로컬 데이터·비밀정보 보안 경계
- localAudioReactionAnalysis.test.ts
- evaluate-live-caption-context.mjs
- IndexedDbAnalysisResultStore
- highlightSelector.ts
- evaluate-local-audio-fast-pass.mjs
- broadcastContextDeepseekClient.ts
- candidatePassB.worker.test.ts
- candidateVideoFrames.ts
- compilerOptions
- candidateMerge.ts
- sourceCheck.ts
- localAudioReactionAnalysis.ts
- devDependencies
- analyzeLocalAudioReactions
- loadVideoMetadata
- chatAnalysisWorkerClient.test.ts
- clipRenderer.ts
- chatAnalysisWorkerProtocol.ts
- localVideoVisualAnalysis.test.ts
- broadcastContextTimelinePresentation.ts
- FakeWorker
- eventFence.ts
- evaluate-caption-selection.mjs
- RunCandidatePassBWorkerOptions
- chatAnalysisWorkerClient.ts
- broadcastContextSessionStore.ts
- scripts
- evaluate-caption-refinement.mjs
- contextQualifiedFinalSelection.ts
- localMediaPreflight.test.ts
- FakeVideoProbe
- evaluate-caption-context.mjs
- candidatePassBModelDownloadProgress.ts
- candidateReviewFeatureAvailability.ts
- smoke-broadcast-transcript.mjs
- FakeVideoProbe
- dependencies
- smoke-gemini-proxy.mjs
- broadcastSelectionProtocol.ts
- candidatePassBRuntime.ts
- AppErrorBoundary
- ExClipper
- chzzkVideoChannel.ts
- localAudioReactionAnalysisCore.test.ts
- cleanupResources
- LocalMediaPreflightAdapters
- package.json
- CandidatePassBEvidence
- LocalVideoVisualAnalysisAdapters
- inspect-youtube-caption-json3.mjs
- AnalysisLanguage
- CandidatePassBWorkerFailureReason
- candidateRankingView.test.ts
- sampleEvaluationContract.ts
- ExClipper `0.3.34` 적용 판단
- Q: How do durable analysis records prevent raw chat and nickname leakage through arbitrary nested fields?
- Q: 현재의 하이라이트 검출은 무슨 기준을 사용하고 있지
- Q: 스트리머 반응 중심 목표 대비 현재 하이라이트 검출 신호의 적합성, 오탐, 미탐, 다음 구조를 감사
- Q: 근데 클립이란건 스트리머의 반응을 보는거지 화려한 연출을 보는게 아니야. 이게 맞는 접근인지 알려진 다른 사례들과 함께 확인해
- Q: 0.3 오디오 반응부터 설명·저장·내보내기까지의 경로
- Q: Candidate Pass B 구조가 App, Worker, provisional evidence, finalizing 완료 fence를 어떻게 연결하는가?
- Q: Trace candidate array order consumers and design CandidateRankingProposal lifecycle
- Q: 0.3.5 후보 재정렬 제안은 canonical 후보, 정밀 근거, 검토·경계·미리보기·export를 어떻게 안전하게 분리해야 하는가?
- Q: Beginner UX audit for per-candidate event and reaction explanations including evidence lifecycle states.
- Q: 현재 v0.3.6 미커밋 diff를 초심자 UI/UX, 접근성, 모바일, 과장 표현 관점에서 다시 읽기 전용 감사해 주세요. App.tsx, styles/retto-highlight.css, README와 새 설명 모듈을 보되 수정은 하지 말고 P0/P1/P2만 파일·라인 근거로 보고하세요. 이전 지적이 실제로 해결됐는지도 확인하세요.
- Q: 현재 v0.3.6 미커밋 diff를 초심자 UI/UX, 접근성, 모바일, 과장 표현 관점에서 다시 읽기 전용 감사해 주세요. App.tsx, styles/retto-highlight.css, README와 새 설명 모듈을 보되 수정은 하지 말고 P0/P1/P2만 파일·라인 근거로 보고하세요. 이전 지적이 실제로 해결됐는지도 확인하세요.
- Q: 후보별 사건·반응 설명을 어떤 근거 경계로 구현하고 UI에 연결해야 하나?
- Q: 현재 repo에서 local Whisper CandidatePassB 흐름을 Gemini API 기반 후보 오디오 전사/사건 설명으로 교체하거나 병행하는 최소 안전 수직 슬라이스
- Q: How does App start Gemini candidate analysis and keep the response fenced from canonical editing state?
- Q: 세팅하려면 이제 뭐가 필요하지
- Q: Where should grounded VTuber participant identity be added without changing highlight ranking?
- Q: Where is the model routing policy disconnected from runtime, and which paths control provider fallback?
- Q: Audit candidate selection, context, music filtering, participant identity, transcript transport, and timeline architecture.
- Q: How does ExClipper select topic-balanced caption refinements and prevent routine gameplay from reaching canonical editor cards?
- Q: How should ExClipper distinguish semantic chapter and lead states on the restored timeline?
- Q: Gemini 공용 키를 모든 필요한 모델 경로에 연결하고 교환학생 출연진을 전체 맥락 분석에 사용하는 방법은 무엇인가?
- sourceReadyTimelinePresentation.ts
- Q: Should v0.3.6 add a Korean text generator or deterministic evidence explanation?
- highlightSelector.test.ts
- appendHiddenElement
- boundedAsyncMap.ts
- tsconfig.json
- candidateAudioEventEvidenceState.ts
- broadcastContextPersistence.ts
- candidatePassBDurability.ts
- eslint-plugin-react-refresh
- @types/node
- CandidatePassBCandidateGapReason
- contextQualifiedFinalSelection.ts
- vite
- analysisBudgetPolicy.ts
- 방송 등장인물 근거화 파이프라인
- eslint.config.js
- smoke-broadcast-context.mjs
- BROADCAST_TRANSCRIPT_ACTIVE_MODEL_REVISION
- QWEN_CANDIDATE_MODEL_ID
- QWEN_CANDIDATE_MODEL_REVISION
- MAX_CANDIDATE_AUDIO_EVENT_CANDIDATES
- vite-env.d.ts
- CandidatePassBEvidence
- vitest.config.ts
- 13.2 장시간 원본을 위한 계층형 멀티패스
- 2026-07-25 · 스트리머 팔레트 대비-보정 + 검토 카드 보존
- candidateSignals.ts
- 2026-07-19 — `rettolight` 저장소 생성과 첫 실행 가능한 수직 슬라이스
- 2026-07-28 다음 배포 후보 · 6인 등장인물 근거와 맥락 commit 봉인
- tsconfig.json
- Q: 1) groq에서 whisper v3을 무료 제공하는데, 지금 qwen3-asr/qwen3.5 omni flash 와 비교해보자. 뭐가 가장 합리적인지
- @eslint/js
- eslint-plugin-react-hooks
- eslint-plugin-react-refresh
- Q: 어떻게 구현할지 한번 정리하자
- @types/react-dom
- typescript
- typescript-eslint
- vitest
- 22. 전이 중심 테스트 매트릭스
- eslint.config.js
- smoke-broadcast-context.mjs
- gen-forms.mjs
- 2026-07-19 — 사용자 피드백에 따른 AI-first 전면 개정
- candidatePublicationGate.ts
- QWEN_CANDIDATE_MODEL_ID
- QWEN_CANDIDATE_MODEL_REVISION
- 19. 상태별 UI 투영
- MAX_CANDIDATE_AUDIO_EVENT_CANDIDATES
- vite-env.d.ts
- vite.config.ts
- vitest.config.ts
- 2026-07-19 — 제품 계획 수립
- 11. 장애 대응 runbook
- semanticLeadCandidate.ts
- 7. ChatImport와 ChatSource 생애주기
- 2026-07-19 — 최신 공용 지침 재감사와 개인 편집 어시스턴트 확정
- 11. 로컬 미디어 처리 계획
- 18. 단계별 구현 로드맵
- 4. 단방향 핵심 흐름
- 5.4 생방송 기록
- AudioFeatureAccumulator
- 2026-07-19 — 앱 0.3.0 스트리머 반응 우선 오디오 fast pass
- 2026-07-24 `0.5.4` PassB가 한 번도 시작되지 않던 버그
- ExClipper
- Q: 이건 별도로 검토한 건데, 한번 비교해보자
- candidateVerificationCohort.ts
- 21. 전역 불변식
- 9. AnalysisJob, AnalysisSpec, AnalysisRun 생애주기
- ui-forms — 공용 표시 폼
- 2026-07-19 — AI 기능 우선순위 재조정과 앱 0.3.3 Pass B 착수
- 2026-07-19 — 앱 0.2.0 완료 분석 복구·내용 샘플 지문·영속 개인정보 allowlist
- 보완 색인 — graphify 가 못 잡는 것
- 2. 배포 구조와 데이터 경계
- 14. RenderBatch와 RenderItem 생애주기
- gen-palettes.mjs
- 2026-07-20 — 앱 0.3.7 Gemini 한국어 후보 정밀 분석 착수
- 2026-07-20 — 앱 0.3.8 로컬 빠른 분석 impulse 포화 교정
- 2026-07-19 — 최초 Pages 배포 완료와 앱 0.3.2 여러 후보 구간 다듬기
- 2026-07-19 — 앱 0.2.1 기본 완주 화면·편집 시간표 출력
- 2026-07-23 `0.3.46` 키보드 검토 루프와 App 구조 분리
- 2026-07-23 `0.3.47` 전사 중계 503 복구와 오류 경계
- 2026-07-24 `0.5.0` 검토 화면 원점 재설계 — 물리적 태블릿
- 2026-07-24 `0.5.3` 내부 구성 재설계 — 신호 타일 · 필름스트립 · 레일의 쓸모
- 2026-07-27 `0.8.5` 전사 CORS의 실제 원인·직접 Base64 transport
- 10. 저장·자동 복구·개인정보
- 14. GitHub Pages 전용 설계
- 17. 테스트 계획
- aiProxy.worker.test.ts
- 10. CandidateProposal과 Segment revision 병합
- 12. 저장 생애주기
- 2. 상태 모델 공통 원칙
- README.md
- 2026-07-20 — 앱 0.3.3 배포와 0.3.4 오디오 반응 종류 AI 착수
- 2026-07-20 — 앱 0.3.6 근거 기반 사건·반응 단서 착수
- 2026-07-20 — `0.3.11` 제품명 ExClipper 전환
- 2026-07-23 — `0.3.43` 동적 사건 지도·안전한 검토창·모바일 후보 파이프라인
- 2026-07-24 `0.4.5` 16:9 검토 서피스 · 위치 스트립 · 도시에 탭 (PART C+D+E)
- 2026-07-24 `0.4.7` 결과·산출물 개선 (PART H-1~H-6)
- 2026-07-24 `0.5.1` 검토 화면 실측 교정 — 브라우저로 보고 고침
- 2026-07-27 `0.8.3` 5인 AI 용량 조정 · 30초 전사 경로 확정
- 2026-07-27 `0.8.4` 맥락 502 복구 · 누락 구간 이어하기
- ExClipper `0.3.34` 적용 판단
- Q: How do durable analysis records prevent raw chat and nickname leakage through arbitrary nested fields?
- Q: 현재의 하이라이트 검출은 무슨 기준을 사용하고 있지
- Q: 스트리머 반응 중심 목표 대비 현재 하이라이트 검출 신호의 적합성, 오탐, 미탐, 다음 구조를 감사
- Q: 근데 클립이란건 스트리머의 반응을 보는거지 화려한 연출을 보는게 아니야. 이게 맞는 접근인지 알려진 다른 사례들과 함께 확인해
- Q: 0.3 오디오 반응부터 설명·저장·내보내기까지의 경로
- Q: Candidate Pass B 구조가 App, Worker, provisional evidence, finalizing 완료 fence를 어떻게 연결하는가?
- Q: Trace candidate array order consumers and design CandidateRankingProposal lifecycle
- Q: 0.3.5 후보 재정렬 제안은 canonical 후보, 정밀 근거, 검토·경계·미리보기·export를 어떻게 안전하게 분리해야 하는가?
- Q: Beginner UX audit for per-candidate event and reaction explanations including evidence lifecycle states.
- Q: 현재 v0.3.6 미커밋 diff를 초심자 UI/UX, 접근성, 모바일, 과장 표현 관점에서 다시 읽기 전용 감사해 주세요. App.tsx, styles/retto-highlight.css, README와 새 설명 모듈을 보되 수정은 하지 말고 P0/P1/P2만 파일·라인 근거로 보고하세요. 이전 지적이 실제로 해결됐는지도 확인하세요.
- Q: 현재 v0.3.6 미커밋 diff를 초심자 UI/UX, 접근성, 모바일, 과장 표현 관점에서 다시 읽기 전용 감사해 주세요. App.tsx, styles/retto-highlight.css, README와 새 설명 모듈을 보되 수정은 하지 말고 P0/P1/P2만 파일·라인 근거로 보고하세요. 이전 지적이 실제로 해결됐는지도 확인하세요.
- Q: 후보별 사건·반응 설명을 어떤 근거 경계로 구현하고 UI에 연결해야 하나?
- Q: 현재 repo에서 local Whisper CandidatePassB 흐름을 Gemini API 기반 후보 오디오 전사/사건 설명으로 교체하거나 병행하는 최소 안전 수직 슬라이스
- Q: How does App start Gemini candidate analysis and keep the response fenced from canonical editing state?
- Q: 세팅하려면 이제 뭐가 필요하지
- Q: Where should grounded VTuber participant identity be added without changing highlight ranking?
- Q: Where is the model routing policy disconnected from runtime, and which paths control provider fallback?
- Q: Audit candidate selection, context, music filtering, participant identity, transcript transport, and timeline architecture.
- Q: How does ExClipper select topic-balanced caption refinements and prevent routine gameplay from reaching canonical editor cards?
- Q: How should ExClipper distinguish semantic chapter and lead states on the restored timeline?
- Q: Gemini 공용 키를 모든 필요한 모델 경로에 연결하고 교환학생 출연진을 전체 맥락 분석에 사용하는 방법은 무엇인가?
- Q: 그리고 모바일에서는 다중 검토가 안되고 한곳에서만 계속 이어서 분석해서 예전처럼 아주 느린데, 별다른 원인이 있나
- Q: 현재 등장인물 파악 로직을 점검하고, 가능한지 말해줘. 반드시 등장인물 파악이 별도 로직으로 분리될 필요는 없지만, 맥락 파악에는 반드시 등장해야 해. 등장인물이 없으면 없다고 해야 하고
- Q: 현재 ExClipper UI를 Fable 0.4.1과 태블릿 샘플 기반의 물리 태블릿형 편집 콘솔로 재구성하려면 어떤 App·CSS·타임라인 구조를 함께 수정해야 하는가?
- Q: 5명 정도까지만 동시에 쓸 수 있는 ExClipper 환경을 어떻게 구성해야 하는가
- Q: Inspect aiProxy.worker.ts request-body readers and quota lease lifecycle; propose the smallest correct ingress timeout and upload-ticket cancellation design.
- Q: 최대 5명의 ExClipper 사용자가 공유 AI credential을 오류 없이 빠르게 쓰도록 어떤 quota와 전송 구조가 필요한가?
- Q: 오류가 정확히 8개 뜨고 다시 진행됐는데, 이거 나중에 재시도로 메꿔지는지 확인
- Q: 탐색 구간 CORS 뒤 broadcast-context 502와 ai-quota 409가 발생하고 최종 후보 0개로 끝나는 이유와 복구 방법
- Q: Implement focused free-r2 Worker integration tests without changing production files.
- Q: 무료 유지하는 한도로 최적화를 하자. 하지만 과금하게 되면 바로 전환할 수 있도록 구조만 내부에 만들어 두자
- Q: Audit candidate ID/version/context fingerprint joins across fast and semantic candidates, context annotations, Pass B receipts, and restore: how can 12 topics/31 leads plus 5 context-not-ready and 8 Pass B incomplete yield zero without a context API error?
- Q: 끝까지 마치지 못했다는 게 무슨 뜻이며, 맥락 분석 성공 후 최종 후보 0개가 된 이유는 무엇인가?
- 12. 결과 내보내기
- 21. 공식 근거와 기술 참고
- analysisControlState.ts
- 13. MigrationRun 생애주기
- 15. ExportJob 생애주기
- 17. 다중 탭 단일 writer
- 3. 식별자, 실행 fence, 이벤트 봉투
- 2026-07-20 — 앱 0.3.5 설명 가능한 검토 우선순위 제안 착수
- 2026-07-20 — 앱 0.3.9 기본 배포 키와 Gemini 한국어 성공 경로
- 2026-07-21 — `0.3.24` 후보 회귀 조사: 오프닝 음악 제거와 채팅 단독 후보 복원
- 2026-07-21 — `0.3.26` 편집자 중심 후보 검토 UI
- 2026-07-23 `0.4.0` 전사 바이너리 전송과 중계 바이트 조립
- 2026-07-24 `0.4.2` 병렬 전사 프리페치와 태블릿 스킨 1차
- 2026-07-24 `0.4.4` 동시 진행 트랙 (PART F)
- 2026-07-24 `0.4.6` 좌측 아이콘 레일 · 시작 화면 명세 패널 (PART B+G)
- 2026-07-24 `0.4.8` 검증 전 빠른 후보 공개 (PART H-4' + PART F 배너)
- 2026-07-24 `0.5.2` 기기 치수 고정 — 16:10 · 여백 10%
- 2026-07-27 다음 배포 후보 · 최종 후보 파이프라인 정상화
- Q: Should v0.3.6 add a Korean text generator or deterministic evidence explanation?
- Q: How should ExClipper v0.8.3 safely deploy a shared AI quota coordinator for at most five trusted editor sessions without regressing the v0.8.2 transcript path?
- 3. 진실 공급원과 백업 계층
- 7. 배포 절차
- 2026-07-21 implementation update
- 0. 먼저 합의해야 할 결론
- 2. 제품 목표와 성공 조건
- 7. 키보드·접근성·반응형
- broadcastTranscriptChapters.ts
- 11. RangeCapture 생애주기
- 16. AppSession 생애주기
- 5. Project, SourceDefinition, SourceBinding
- 2026-07-20 — 0.3.10 후보별 미리보기·클립 파일 다운로드
- 2026-07-21 — `0.3.25` AI provider와 방송 전체 맥락 준비 구조
- 2026-07-27 `0.8.6` Free R2 전사 transport 착수
- 2026-07-27 파이프라인 정상화 후보 · 최종 검증
- 10. 로컬 관측과 진단
- 4. 단일 사용자 안의 동시성: 여러 탭
- 5. 환경 설정과 비밀정보
- 8. 롤백과 호환성
- 9. 저장 공간·대역폭·보존 상한
- 1. 입력별 현실적인 지원 범위
- 20. 새로고침·중단 복구 절차
- 6. SourceCheck 생애주기
- 8. ModelArtifact와 ModelDownload 생애주기
- README.md
- DESIGN_RULES.md
- Q: qwen asr과 qwen omni의 차이와 현재 ExClipper에서 어느 쪽이 실제 사용되는가
- aiProxy.worker.test.ts
- Q: How does ExClipper guarantee bounded context and durable candidate completion?
- eslint
- Q: 현재 그러면 인물 파악은 어느 시점에 되는거지? 영상이나 목소리를 기반으로 인물을 파악해야 하는데, 일단 6명이잖아
- Q: Design the smallest sound participant-grounding schema for ExClipper: six-person global catalog, source-specific priors, conservative evidence, sealed pre-context grounding, and future visual/voice adapters.
- Q: How should a participant grounding packet and timeline be persisted backward-compatibly across broadcast context sessions?
- localAudioReactionAnalysisCore.test.ts
- CandidateAudioEventCandidateGapReason
- @emnapi/runtime
- summarizeCandidatePassBAudioGate
- broadcastContextCandidateCohort.ts
- 2026-07-29 개발자 전용 6인 음성 enrollment 후보 추출 도구
- 2026-07-29 맥락 전 6인 등장인물 grounding 계획·완료 gate
- 2026-07-29 화자 임베딩 실행부·18개 표본 교차검증
- QWEN_CANDIDATE_MODEL_ID
- QWEN_CANDIDATE_MODEL_REVISION
- broadcastContextCandidateCohort.ts
- MAX_CANDIDATE_AUDIO_EVENT_CANDIDATES
- 2026-07-21 — `0.3.25` AI provider와 방송 전체 맥락 준비 구조
- 2026-07-27 파이프라인 정상화 후보 · 최종 검증
- 2026-07-29 Groq Whisper Large V3 Turbo 선택형 전사 경로 준비
- 2026-07-29 자막 없는 의미 refinement 전사 per-fragment checkpoint
- @eslint/js
- README.md
- extractBroadcastTranscriptGroqResponse
- candidatePassBCost.ts
- CandidatePassBWorkerFailureReason
- 2026-07-20 — 0.3.10 후보별 미리보기·클립 파일 다운로드
- UnifiedHighlightCandidate
- durableBroadcastContextPipeline.test.ts
- gen-forms.mjs
- broadcastContextExploration.ts
- analysisControlState.ts
- PcmRangeBuilder
- finalVerificationGapSummary.ts
- BroadcastTranscriptResolvedEvidenceReason
- gen-palettes.mjs
- AnalysisProgressPanel.tsx
- typescript-eslint
- QuotaOutcomeUnknownError
- RequestBodyTimeoutError
- boundedAsyncMap.ts
- broadcastContextCandidateCohort.ts
- 2026-07-29 v0.8.8 파이프라인 내구성 릴리스

## God Nodes (most connected - your core abstractions)
1. `App()` - 227 edges
2. `Development Log` - 86 edges
3. `ExClipper 제품·UX·기술 계획서` - 51 edges
4. `ExClipper 상태·생애주기 명세` - 48 edges
5. `handleBroadcastTranscriptRequest()` - 36 edges
6. `IndexedDbAnalysisResultStore` - 36 edges
7. `rejectedOperation()` - 35 edges
8. `createBroadcastParticipantGrounding()` - 32 edges
9. `createContentFingerprint()` - 32 edges
10. `AnalysisResultStore` - 32 edges

## Surprising Connections (you probably didn't know these)
- `drive()` --indirect_call--> `event()`  [INFERRED]
  dev/gen-unfinished-sheet.mjs → src/analysis/candidatePassBModelDownloadProgress.test.ts
- `groundHostStreamerProfile()` --indirect_call--> `item()`  [INFERRED]
  src/analysis/broadcastContextDeepseek.ts → dev/gen-unfinished-sheet.mjs
- `replaceUnexpectedHan()` --indirect_call--> `item()`  [INFERRED]
  src/analysis/broadcastContextDeepseek.ts → dev/gen-unfinished-sheet.mjs
- `normalizeBroadcastParticipantGroundingForInput()` --indirect_call--> `item()`  [INFERRED]
  src/analysis/broadcastParticipantGrounding.ts → dev/gen-unfinished-sheet.mjs
- `normalizeCheckpoint()` --indirect_call--> `item()`  [INFERRED]
  src/analysis/broadcastRefinementTranscriptCheckpoint.ts → dev/gen-unfinished-sheet.mjs

## Import Cycles
- 3-file cycle: `src/analysis/aiModelRoutingPolicy.ts -> src/analysis/broadcastTranscriptWorkerProtocol.ts -> src/analysis/broadcastTranscriptRouteManifest.ts -> src/analysis/aiModelRoutingPolicy.ts`

## Communities (357 total, 23 thin omitted)

### Community 0 - "highlightFusion.ts"
Cohesion: 0.04
Nodes (71): buildBroadcastTranscriptGeminiRequestBody(), buildBroadcastTranscriptQwenOmniRequestBody(), extractBroadcastTranscriptGeminiResponse(), extractBroadcastTranscriptGroqResponse(), extractBroadcastTranscriptQwenOmniSseResponse(), hasExactKeys(), isRecord(), normalizedTranscript() (+63 more)

### Community 1 - "highlightExport.ts"
Cohesion: 0.05
Nodes (77): aggregateBroadcastSpeechActivityCoverage(), asrDisposition(), assertCanonicalPlan(), assertCell(), assertOperation(), assertSourceDuration(), baseReceiptMatches(), BROADCAST_SPEECH_ACTIVITY_DECISION_POLICY (+69 more)

### Community 2 - "broadcastTranscript.worker.ts"
Cohesion: 0.14
Nodes (28): CandidateBoundaryProvenance, CandidateTimeRange, assertMilliseconds(), candidateExportTitle(), chronologicalCandidates(), createCsv(), createHighlightClipboardText(), createHighlightExportFile() (+20 more)

### Community 3 - "App.tsx"
Cohesion: 0.08
Nodes (52): accept(), assertCandidatePassBRunInvariant(), baseAfterWorkerEvent(), baseOf(), CANDIDATE_PASS_B_TERMINAL_STATUSES, candidateEventRejection(), CandidatePassBCancelTerminationKind, CandidatePassBCandidateOutcome (+44 more)

### Community 4 - "candidateEvidenceExplanation.ts"
Cohesion: 0.07
Nodes (62): adapterFenceKey(), adapterFor(), assertOperationIdentity(), assertRange(), assertSha256(), assertSourceFenceInput(), baseBundleKey(), boundedIdentifier() (+54 more)

### Community 5 - "aiProxy.worker.ts"
Cohesion: 0.17
Nodes (8): assertIdentifier(), cloneJson(), InMemoryAnalysisResultStore, rejectedOperation(), validateAndCloneAnalysisRecord(), validateAndCloneJobRecord(), validateAndCloneSourceSnapshot(), validateAndCloneTerminalRecord()

### Community 6 - "candidateAudioEventWorkerProtocol.ts"
Cohesion: 0.08
Nodes (43): BroadcastContextPhaseLedger, broadcastContextPhaseLedgerCanComplete(), BroadcastContextPhaseLedgerEvent, BroadcastContextPhaseLedgerJsonValue, BroadcastContextPhaseLedgerModelReceipt, BroadcastContextPhaseLedgerRejectionReason, BroadcastContextPhaseLedgerStatus, BroadcastContextPhaseLedgerSummary (+35 more)

### Community 7 - "candidateAudioEvent.worker.ts"
Cohesion: 0.06
Nodes (53): assertEffectiveRange(), assertEvidenceBindings(), AUDIO_EVENT_KIND_LABELS, audioEventBasisCodes(), audioEventDetections(), audioEventObservation(), audioObservation(), buildCandidateEvidenceExplanation() (+45 more)

### Community 8 - "discoveredLeadRefinement.ts"
Cohesion: 0.07
Nodes (51): acknowledgeAfterLoadedModelCleanup(), ANALYZE_REQUEST_KEYS, analyzeCandidate(), AnalyzeRequest, assertPinnedId2Label(), BUNDLED_ORT_WASM_URL, CancelRequest, CandidateFailure (+43 more)

### Community 9 - "candidateAudioEventRun.ts"
Cohesion: 0.11
Nodes (39): accept(), assertBroadcastContextPhaseLedger(), BROADCAST_CONTEXT_PHASE_LEDGER_PHASES, BROADCAST_CONTEXT_PHASE_LEDGER_STATUSES, BroadcastContextPhaseLedgerPhase, BroadcastContextPhaseLedgerRetryableUnit, BroadcastContextPhaseLedgerTransitionOutcome, BroadcastContextPhaseLedgerUnitBase (+31 more)

### Community 10 - "candidatePassBRun.ts"
Cohesion: 0.07
Nodes (54): accept(), assertCandidateAudioEventRunInvariant(), baseAfterWorkerEvent(), baseOf(), CANDIDATE_AUDIO_EVENT_TERMINAL_STATUSES, CandidateAudioEventCancelTerminationKind, CandidateAudioEventCandidateOutcome, CandidateAudioEventCandidateSnapshot (+46 more)

### Community 11 - "broadcastContextProtocol.ts"
Cohesion: 0.07
Nodes (51): createCandidateInsightMediaResolveRequest(), isCandidateInsightMediaTicket(), bytesToHex(), CANDIDATE_INSIGHT_MEDIA_AUDIO_HEADER_BYTES, CANDIDATE_INSIGHT_MEDIA_CACHE_CONTROL, CANDIDATE_INSIGHT_MEDIA_MAX_AUDIO_BYTES, CANDIDATE_INSIGHT_MEDIA_MAX_FRAME_BYTES, CANDIDATE_INSIGHT_MEDIA_OBJECT_PREFIX (+43 more)

### Community 12 - "durableAnalysisPayload.ts"
Cohesion: 0.07
Nodes (53): arraysEqual(), BROADCAST_TRANSCRIPT_MEDIA_MAX_BYTES, BROADCAST_TRANSCRIPT_MEDIA_METADATA_SCHEMA, BROADCAST_TRANSCRIPT_MEDIA_OBJECT_PREFIX, BROADCAST_TRANSCRIPT_MEDIA_TICKET_QUERY, BROADCAST_TRANSCRIPT_MEDIA_TICKET_VERSION, BroadcastTranscriptMediaChecksums, BroadcastTranscriptMediaErrorCode (+45 more)

### Community 13 - "candidateAudioEventWorkerClient.ts"
Cohesion: 0.10
Nodes (32): CandidateAudioEventAggregation, chronologicalDetectionOrder(), mergeCandidateAudioEventEvidence(), mergeDetectedResults(), sameBinding(), sameDetection(), sameDetectionList(), strengthRank() (+24 more)

### Community 14 - "candidateAudioEvent.ts"
Cohesion: 0.09
Nodes (52): ActiveTask, CandidateAudioEventFenceRejectionReason, CandidateAudioEventWorkerErrorCode, CandidateAudioEventWorkerFactory, fenceEvent(), FenceOutcome, FenceState, hasExactKeys() (+44 more)

### Community 15 - "candidatePassBGemini.ts"
Cohesion: 0.08
Nodes (64): BroadcastRefinementCaptionSpeechActivityEvidence, canonicalRefinementCheckpoint(), appendCaption(), asrCheckpoints(), binding(), captionInput(), captionTrack, paidRoute() (+56 more)

### Community 16 - "broadcastTranscriptQwen.ts"
Cohesion: 0.09
Nodes (37): BroadcastContextDiscoveredLeadCategory, AUDIO_EVENT_KINDS, AudioHighlightCandidateEvidence, AudioReactionEventKind, createAudioEvidence(), createChatEvidence(), createReactionUnifiedCandidate(), createUnifiedCandidate() (+29 more)

### Community 17 - "aiProviderConfiguration.ts"
Cohesion: 0.06
Nodes (75): bounded(), candidateMap, candidates, chapters, context, parentLead, ranked, refinement (+67 more)

### Community 18 - "AnalysisResultStore"
Cohesion: 0.09
Nodes (41): AI_PROVIDER_CONFIGURATION_VERSION, AiProviderConfigurationErrorCode, AiProviderConfigurationFailure, AiProviderDescriptor, AiProviderFallbackMode, AiProviderImplementationStatus, AiProviderReadinessManifest, BroadcastContextConnection (+33 more)

### Community 19 - "candidatePassB.ts"
Cohesion: 0.07
Nodes (46): aggregateCandidateAudioEventScores(), aggregationQuality(), aggregationQualityTuple(), assertAndIndexWindowScores(), assertScoreVector(), assertTarget(), assertTargetSet(), baseResult() (+38 more)

### Community 20 - "analysisResultStore.test.ts"
Cohesion: 0.04
Nodes (52): CANDIDATE_INSIGHT_MEDIA_SCHEMA_VERSION, ActiveTask, FakeAudioSampleSink, FakeBlobSource, FakeInput, FakeInputDisposedError, FakeUnsupportedInputFormatError, identity (+44 more)

### Community 21 - "candidatePassBWorkerProtocol.ts"
Cohesion: 0.09
Nodes (31): MemoryR2Bucket, BROADCAST_TRANSCRIPT_MEDIA_CACHE_CONTROL, BROADCAST_TRANSCRIPT_MEDIA_CONTENT_TYPE, BROADCAST_TRANSCRIPT_MEDIA_HEADER_BYTES, BroadcastTranscriptMediaBucket, BroadcastTranscriptMediaError, BroadcastTranscriptMediaGetOptions, BroadcastTranscriptMediaObject (+23 more)

### Community 22 - "candidatePassB.worker.ts"
Cohesion: 0.10
Nodes (35): BroadcastContextPhaseLedgerFence, BroadcastContextPhaseLedgerPlannedUnit, BroadcastContextPhaseRunnerResult, DurableBroadcastContextPipelineInput, asLedgerJsonValue(), assertIdentifier(), assertParentPhasesSucceeded(), assertRunnerComplete() (+27 more)

### Community 23 - "candidatePassBWorkerClient.ts"
Cohesion: 0.14
Nodes (30): item(), CANDIDATE_PASS_B_CONTEXTLESS_GEMINI_MODEL_REVISION, CANDIDATE_PASS_B_CONTEXTLESS_QWEN_MODEL_REVISION, CANDIDATE_PASS_B_GEMINI_MODEL_ID, CANDIDATE_PASS_B_GEMINI_MODEL_REVISION, CANDIDATE_PASS_B_LEGACY_GEMINI_MODEL_ID, CANDIDATE_PASS_B_LEGACY_GEMINI_MODEL_REVISION, CANDIDATE_PASS_B_OLDER_GEMINI_MODEL_REVISION (+22 more)

### Community 24 - "analysisRun.ts"
Cohesion: 0.08
Nodes (57): requestContext(), BROADCAST_CONTEXT_DEEPSEEK_ENDPOINT, BroadcastContextDeepseekParseOutcome, BroadcastContextDeepseekRequestBody, BroadcastContextParseOptions, BroadcastContextQwenMode, BroadcastContextQwenRequestBody, buildBroadcastContextCastRosterBlock() (+49 more)

### Community 25 - "analysisResultStore.ts"
Cohesion: 0.12
Nodes (10): silentWav(), encodeCandidatePassBBase64(), encodeCandidatePassBPcm16Wav(), writeAscii(), CANDIDATE_PASS_B_SAMPLE_RATE_HZ, createCandidateBody(), silentWav(), silentWavBase64() (+2 more)

### Community 26 - "contextAwareCandidateSelection.ts"
Cohesion: 0.11
Nodes (46): activeParticipantCount(), activeProviderGateParticipantIds(), AI_QUOTA_POOL_POLICY, AI_QUOTA_POOL_PROVIDER_GATE, AI_QUOTA_PROVIDER_GATE_POLICY, AiQuotaOperationStatus, AiQuotaParticipantRecord, AiQuotaPoolPolicy (+38 more)

### Community 27 - "localFileFingerprint.ts"
Cohesion: 0.10
Nodes (22): createBroadcastContextPhaseLedger(), serializeBroadcastContextPhaseLedger(), createLedger(), createMultiPhaseLedger(), session(), AUDIO_CANDIDATE, FakeEventHandler, FakeFileSystemHandle (+14 more)

### Community 28 - "candidateRanking.ts"
Cohesion: 0.09
Nodes (16): ensureReadPermission(), PermissionCapableHandle, ReconnectDependencies, ReconnectFailureReason, reconnectMessage(), ReconnectOutcome, reconnectSource(), FakeHandleOptions (+8 more)

### Community 29 - "candidatePassBWorkerClient.test.ts"
Cohesion: 0.12
Nodes (35): eligibleVoiceEmbeddingModelRevision(), eligibleVoiceParticipantIds(), planInput(), bytesToHex(), canonicalParticipantVoiceEnrollmentManifestForGroundingSignature(), createParticipantVoiceEnrollmentManifestHash(), eligibleParticipantVoiceEnrollmentAssets(), ENROLLMENT_PARTICIPANT_IDS (+27 more)

### Community 30 - "chatImport.ts"
Cohesion: 0.09
Nodes (36): assertCandidate(), assertMaxCandidates(), assertSourceDuration(), assertTarget(), buildCandidatePassBEvidence(), CandidatePassBEvidenceBase, CandidatePassBFallbackReason, CandidatePassBInputError (+28 more)

### Community 31 - "localAudioReactionAnalysisCore.ts"
Cohesion: 0.11
Nodes (41): CandidatePassBEventFenceRejectionReason, CandidatePassBWorkerErrorCode, CandidatePassBWorkerFactory, CandidatePassBWorkerLike, fenceEvent(), FenceOutcome, hasBoundedCodePointLength(), hasExactKeys() (+33 more)

### Community 32 - "compilerOptions"
Cohesion: 0.14
Nodes (20): parsePublicResponse(), AiQuotaCancelledResponse, AiQuotaCancelRequest, AiQuotaCapacityFullResponse, AiQuotaConflictResponse, AiQuotaGrantedResponse, AiQuotaLeaseRequest, AiQuotaOperationIdentity (+12 more)

### Community 33 - "사람 중심 후보 검토"
Cohesion: 0.12
Nodes (30): adjacentWindows(), amplitudeToDb(), AudioReactionCandidate, AudioReactionCandidateEvidence, AudioReactionEventKind, buildClusters(), clamp(), clampInteger() (+22 more)

### Community 34 - "participantRoster.ts"
Cohesion: 0.10
Nodes (54): ANALYSIS_INPUT_KEYS, asPlainRecord(), assertAudioEvidence(), assertAudioGapReason(), assertBoolean(), assertCandidate(), assertChatEvidence(), assertChatInput() (+46 more)

### Community 35 - "rejectedOperation"
Cohesion: 0.12
Nodes (27): BroadcastContextInputError, chapters, CandidatePassBParticipantRole, AMORETTO_CHANNEL_CAST_ROSTER_ID, CandidatePassBCastReference, candidatePassBCastReferenceForName(), candidatePassBCastReferences(), candidatePassBCastRosterIdForSourceName() (+19 more)

### Community 36 - "broadcastTopicalDiscovery.ts"
Cohesion: 0.05
Nodes (39): 2026-07-19 — 앱 0.3.1 최초 GitHub Pages 배포 준비, 2026-07-20 — `0.3.12` Gemini 후보 오디오·화면 멀티모달 분석, 2026-07-21 — `0.3.13` Gemini 3.1 Pro 해석 모델 전환, 2026-07-21 — `0.3.14` automatic phase, recovery, and fixed-segment guard, 2026-07-21 — `0.3.15` header title and music false-positive guard, 2026-07-21 `0.3.16` candidate timeline overview, 2026-07-21 `0.3.16` reaction-only fast pass and music plateau suppression, 2026-07-21 `0.3.17` parallel candidate explanations (+31 more)

### Community 37 - "candidateRankingView.ts"
Cohesion: 0.06
Nodes (36): 0.1 외부 평가를 반영한 품질 방향, `0.3.31` bounded runtime model routing, `0.3.33` context-first editorial routing, `0.3.34` Gemini 3.6 Flash 폴백 전환, `0.3.35` 전사 복구·대표 화면 안정화·닫힌 VTuber roster, `0.3.36` 주제 균형 의미 후보와 게임 방송 무후보 판정, `0.3.37` 저장 맥락 복구와 정직한 타임라인 상태, `0.3.39` 공통 맥락 분석 가속과 Editorial Intent Profiles 원칙 (+28 more)

### Community 38 - "broadcastContextSamplingPlan.ts"
Cohesion: 0.07
Nodes (49): BroadcastContextTranscriptionChunk, BroadcastRefinementTranscriptPlannedChunk, BroadcastRefinementTranscriptSuccessfulFragment, CreateBroadcastRefinementTranscriptCheckpointInput, abortError(), BroadcastTranscriptFragmentRecoveryProgress, BroadcastTranscriptFragmentRecoveryResult, isAutomaticallyRetryableTranscriptGap() (+41 more)

### Community 39 - "candidatePassBPresentation.ts"
Cohesion: 0.08
Nodes (36): checkpointBroadcastContextSessionRefinementEvidenceLedgerWithReadback(), checkpointBroadcastContextSessionTranscriptIfUnchanged(), commitBroadcastContextSessionContextIfUnchanged(), invalidateBroadcastContextSessionContextIfUnchanged(), assertCurrentParticipantGroundingFence(), BroadcastContextSessionContextCommit, BroadcastContextSessionInitialWriteRecord, BroadcastContextSessionPhaseLedgerCheckpoint (+28 more)

### Community 40 - "audioReactionAnalysis.worker.ts"
Cohesion: 0.06
Nodes (76): activateBroadcastRefinementEvidenceRoute(), activeProjectionFingerprint(), AppendBroadcastRefinementAsrEvidenceInput, AppendBroadcastRefinementCaptionEvidenceInput, AppendBroadcastRefinementEvidenceInput, appendBroadcastRefinementEvidenceRouteEntry(), AppendBroadcastRefinementEvidenceRouteEntryResult, assertInputBinding() (+68 more)

### Community 41 - "localMediaPreflight.ts"
Cohesion: 0.15
Nodes (21): abortedError(), bytesToHex(), createLocalFileFingerprint(), CreateLocalFileFingerprintOptions, emitProgress(), frameDigestInput(), isAbortError(), LocalFileFingerprintErrorCode (+13 more)

### Community 42 - "localVideoVisualAnalysis.ts"
Cohesion: 0.09
Nodes (45): ALL_OBJECT_STORES, ANALYSIS_RESULT_OBJECT_STORES, AnalysisFailureRecord, AnalysisPayloadByKind, AnalysisRecord, AnalysisRecordKind, AnalysisResultStoreErrorCode, analysisSchemaFamily() (+37 more)

### Community 43 - "ExClipper 동적 타임라인·후보 검토 워크스페이스 계획"
Cohesion: 0.09
Nodes (42): analyzeCandidateWithRemoteAi(), AnalyzeRequest, CandidateFailure, candidateGap(), candidateMediaStageUrl(), CandidatePcmBuilder, candidateProxyOrigin(), CandidateRemoteTransport (+34 more)

### Community 44 - "localVideoVisualAnalysisCore.ts"
Cohesion: 0.06
Nodes (40): CandidateAudioEventEvidenceById, CandidateEvidenceExplanationInput, CandidatePassBEvidence, CandidatePassBEvidenceById, evidenceQualityRank(), mergeCandidatePassBEvidence(), fallback, provisional (+32 more)

### Community 45 - "AnalysisRun State Machine"
Cohesion: 0.12
Nodes (30): aliasAuthor(), AliasValue, AUTHOR_ALIASES, ChatImportDiagnostic, ChatImportDiagnosticCode, ChatImportDiagnosticSeverity, ChatImportFormat, ChatImportResult (+22 more)

### Community 46 - "로컬 데이터·비밀정보 보안 경계"
Cohesion: 0.11
Nodes (30): here, panel(), SCENES, clampUnit(), committedFraction(), computeProgressAxis(), finiteUnit(), formatSingleRemaining() (+22 more)

### Community 47 - "localAudioReactionAnalysis.test.ts"
Cohesion: 0.06
Nodes (59): paidRoute(), BROADCAST_TRANSCRIPT_CHECKPOINT_MIXED_REVISION_PREFIX, BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID, BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION, BROADCAST_TRANSCRIPT_GROQ_MODEL_ID, BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION, BROADCAST_TRANSCRIPT_MIXED_CHECKPOINT_MODEL_REVISION, BROADCAST_TRANSCRIPT_PREVIOUS_ACTIVE_MODEL_REVISION (+51 more)

### Community 48 - "evaluate-live-caption-context.mjs"
Cohesion: 0.06
Nodes (30): DOM, DOM.Iterable, ES2022, src, vite/client, WebWorker, compilerOptions, allowJs (+22 more)

### Community 49 - "IndexedDbAnalysisResultStore"
Cohesion: 0.17
Nodes (18): fetchWithAiQuota(), AI_QUOTA_ENDPOINT_PATH, aiQuotaLeaseHeaders, BROADCAST_TRANSCRIPT_BASE64_CONTENT_TYPE, isBroadcastTranscriptModelId(), BROADCAST_TRANSCRIPT_PROXY_ENDPOINT, BroadcastTranscriptQwenClientError, FetchImplementation (+10 more)

### Community 50 - "highlightSelector.ts"
Cohesion: 0.12
Nodes (26): abortError(), acquireLease(), AiQuotaClientError, AiQuotaClientIdentity, AiQuotaWaitProgress, attemptOperationId(), bodyBytes(), cancelQuotaOperationBestEffort() (+18 more)

### Community 51 - "evaluate-local-audio-fast-pass.mjs"
Cohesion: 0.07
Nodes (43): AdaptiveConcurrency, AdaptiveConcurrencyOptions, AdaptiveConcurrencyRequestStamp, clamp(), DEFAULT_ADAPTIVE_CONCURRENCY, DEFAULT_REQUEST_START_TIMING, requestSpacingMs(), RequestStartTiming (+35 more)

### Community 52 - "broadcastContextDeepseekClient.ts"
Cohesion: 0.08
Nodes (51): cellId(), assertBroadcastTranscriptVisualInspectionPlan(), assertFramePreparationQueueForPlan(), assertFrameTimestamps(), assertPreparedFrameReceiptForPlan(), assertProviderLedgerForPlan(), assertProviderSettlementForPlan(), boundedString() (+43 more)

### Community 53 - "candidatePassB.worker.test.ts"
Cohesion: 0.13
Nodes (25): ActiveAudioTask, clamp(), clampInteger(), createEventId(), decodeAndScore(), disposeInputOnce(), handleCancel(), isUnsupportedAudioCodecError() (+17 more)

### Community 54 - "candidateVideoFrames.ts"
Cohesion: 0.19
Nodes (22): buildEventEpisodes(), calculateBlockQuotas(), CandidateSelectionEligibility, canJoinEpisode(), clamp(), compareCandidateStrength(), ContextAwareSelectionOptions, ContextAwareSelectionResult (+14 more)

### Community 55 - "compilerOptions"
Cohesion: 0.10
Nodes (51): base64DecodedByteLength(), broadcastTranscriptProviderFailureResponse(), candidateProviderFailureResponse(), candidateTokenReservation(), clearBroadcastTranscriptAudio(), clientRateLimitKey(), corsHeaders(), decodeBase64BytePrefix() (+43 more)

### Community 56 - "candidateMerge.ts"
Cohesion: 0.11
Nodes (36): broadcastResolvedAbstentionReasonForChapter(), exactPlanJson(), prepareBroadcastTranscriptEvidenceProjection(), chunks, assertBroadcastTranscriptResolvedEvidenceCheckpoint(), BROADCAST_TRANSCRIPT_RESOLVED_EVIDENCE_SCHEMA_VERSION, BroadcastTranscriptChapterRange, BroadcastTranscriptEvidencePlanCell (+28 more)

### Community 57 - "sourceCheck.ts"
Cohesion: 0.13
Nodes (21): AnalysisJobStatus, DEFAULT_RETENTION_POLICY, EvictionReason, idleDays(), isEvictable(), PlannedEviction, planRetention(), RetentionPlan (+13 more)

### Community 58 - "localAudioReactionAnalysis.ts"
Cohesion: 0.07
Nodes (28): `0.3.31` 후보 모델 라우팅과 결과 귀속, `0.3.33` context-first gate와 자막 refinement, `0.3.34` Gemini 후보 폴백 identity와 유료 결과 보존, `0.3.35` 검증된 전사 transport·청크 checkpoint·닫힌 출연진, `0.3.36` topic-balanced 내부 refinement와 canonical projection 경계, `0.3.39` 병렬 맥락 run과 편집 목적 projection 경계, `0.3.40` 맥락 후 세부 검토와 후보 수 상한 분리, `0.3.41` 분산 탐색·후보 공개·풍부한 맥락 결과 (+20 more)

### Community 59 - "devDependencies"
Cohesion: 0.20
Nodes (15): badge(), bleed(), focusStrip(), here, NON_STREAMER_SUBTITLE, palettes, panel(), rowA() (+7 more)

### Community 60 - "analyzeLocalAudioReactions"
Cohesion: 0.13
Nodes (23): applySourceEvent(), candidateElementId(), createOperationId(), initialAnalysisLanguage(), initialTheme(), triggerClipDownload(), accept(), assertNever() (+15 more)

### Community 61 - "loadVideoMetadata"
Cohesion: 0.14
Nodes (24): applyAnalysisEvent(), accept(), AnalysisCompletionTarget, AnalysisRunBase, AnalysisRunEvent, AnalysisRunRejectionReason, AnalysisRunTransitionOutcome, approvalsAreComplete() (+16 more)

### Community 62 - "chatAnalysisWorkerClient.test.ts"
Cohesion: 0.14
Nodes (15): AnalyzeLocalVideoVisualOptions, appendHiddenElement(), createDefaultCanvas(), createDefaultVideoProbe(), DEFAULT_ADAPTERS, DEFAULT_VISUAL_METADATA_TIMEOUT_MS, DEFAULT_VISUAL_SEEK_TIMEOUT_MS, ErrorDetailValue (+7 more)

### Community 63 - "clipRenderer.ts"
Cohesion: 0.08
Nodes (42): BroadcastTranscriptVisualEditorialFinding, BroadcastTranscriptVisualInspectionPublicationStatus, BroadcastTranscriptVisualProviderFailureReason, createBroadcastTranscriptVisualFramePreparationQueue(), createBroadcastTranscriptVisualProviderSettlementLedger(), inspectBroadcastTranscriptVisualInspectionPublication(), overlapDurationMs(), assertBroadcastTranscriptVisualInspectionRunnerCheckpoint() (+34 more)

### Community 64 - "chatAnalysisWorkerProtocol.ts"
Cohesion: 0.08
Nodes (25): 10. 추가 검토: 동일 높이 후보 미니 카드, 11. 완료 기준, 1.1 후보 검토 영역의 비대칭, 1.2 타임라인의 시각 부호와 데이터가 분리됨, 1.3 분석 중 상태와 최종 편집 상태가 섞임, 1. 현재 화면에서 확인된 문제, 2. 일반적인 타임라인 UI와의 비교, 3. 설계 원칙 (+17 more)

### Community 65 - "localVideoVisualAnalysis.test.ts"
Cohesion: 0.10
Nodes (29): assertExactInput(), sourceInputFromReceipt(), assertPreparation(), assertSpeakerEmbeddingPcm(), assertSpeakerEmbeddingSourceInput(), bytesToHex(), createSpeakerEmbeddingAudioContentSha256(), createSpeakerEmbeddingInputFingerprint() (+21 more)

### Community 66 - "broadcastContextTimelinePresentation.ts"
Cohesion: 0.09
Nodes (39): BroadcastContextAnalysisMode, broadcastContextFailureDisposition, broadcastContextPhaseLedgerMatchesFence(), parseBroadcastContextPhaseLedgerJson(), BroadcastContextCandidateInput, BroadcastContextChapterInput, boundedText(), BROADCAST_TOPICAL_DISCOVERY_VERSION (+31 more)

### Community 67 - "FakeWorker"
Cohesion: 0.11
Nodes (17): AudioReactionWorkerRequest, analyzeLocalAudioReactions(), LocalAudioReactionWorkerLike, normalizeCancelAcknowledgementTimeout(), normalizeWorkerTimeout(), completeResult, decodingProgress, emitResponse() (+9 more)

### Community 68 - "eventFence.ts"
Cohesion: 0.08
Nodes (21): AnalysisManifestRecord, AnalysisResultStore, AnalysisTerminalOutcome, AnalysisTerminalRecord, FinalAnalysisResultRecord, CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION, CandidatePassBInsightsRecord, durableCoverageDisposition() (+13 more)

### Community 69 - "evaluate-caption-selection.mjs"
Cohesion: 0.14
Nodes (27): boundedText(), BroadcastParticipantAdapterReceipt, BroadcastParticipantGroundingEvidence, BroadcastParticipantObservedEvidenceKind, BroadcastParticipantSourceRolePrior, createBroadcastParticipantGrounding(), escapeRegExp(), hasExactKeys() (+19 more)

### Community 70 - "RunCandidatePassBWorkerOptions"
Cohesion: 0.09
Nodes (40): CandidateRankingProposal, accepted(), applyProposal(), CandidateRankingProjectable, CandidateRankingProposalDisposition, CandidateRankingProposalView, CandidateRankingViewEvent, candidateRankingViewHasSessionWork() (+32 more)

### Community 71 - "chatAnalysisWorkerClient.ts"
Cohesion: 0.13
Nodes (23): buildVisualSampleTimestamps(), clamp(), clampInteger(), compareTransitions(), createCandidate(), createTransitionSignals(), LocalVideoVisualAnalysisDiagnostics, LocalVideoVisualAnalysisResult (+15 more)

### Community 72 - "broadcastContextSessionStore.ts"
Cohesion: 0.07
Nodes (21): AI_QUOTA_MAX_ACTIVE_PARTICIPANTS, AI_QUOTA_MAX_PUBLIC_REQUEST_BYTES, AiQuotaPublicRequest, AiQuotaCoordinator, createLeaseToken(), DurableObjectStateLike, DurableObjectStorageLike, isRecord() (+13 more)

### Community 73 - "scripts"
Cohesion: 0.18
Nodes (14): BASE, ReviewStage(), ReviewStageProps, formatTime(), PlayerCardOrigin, ReviewCandidate, ReviewContextItem, ReviewCue (+6 more)

### Community 74 - "evaluate-caption-refinement.mjs"
Cohesion: 0.14
Nodes (20): AI_BROADCAST_CONTEXT_ROUTING_REVISION, AI_MODEL_ROUTING_POLICY_VERSION, AiAnalysisPlanStep, AiAnalysisRoutingPlan, AiAnalysisStage, createAiAnalysisRoutingPlan(), EXCLIPPER_MODEL_IDS, boundedEventPeaks() (+12 more)

### Community 75 - "contextQualifiedFinalSelection.ts"
Cohesion: 0.08
Nodes (51): broadcastContext, semanticCandidate, candidatePassBContextFingerprint(), createCandidatePassBVerificationReceipt(), isCandidatePassBContextPacket(), canonicalizeCandidatePassBContextPacket(), buildCandidatePassBAudioOnlySafeResponse(), buildCandidatePassBGeminiRequestBody() (+43 more)

### Community 76 - "localMediaPreflight.test.ts"
Cohesion: 0.14
Nodes (27): card(), here, IMG, row(), textContrast(), buildStreamerPalette(), compositeOver(), contrastBetween() (+19 more)

### Community 77 - "FakeVideoProbe"
Cohesion: 0.12
Nodes (20): acquireInternalQuotaLease(), boundedRetryAfterMs(), createQuotaMeteredFetch(), internalAttemptOperationId(), quotaOutcomeForStatus(), releaseUnusedQuotaLeaseBestEffort(), waitForRetry(), wrapQuotaTrackedResponse() (+12 more)

### Community 78 - "evaluate-caption-context.mjs"
Cohesion: 0.08
Nodes (27): boundedRepresentativeText(), compactBroadcastContextChapters(), COMPACTED_SUMMARY_LENGTH, compactGroup(), BROADCAST_CONTEXT_PROXY_ENDPOINT, BroadcastContextDeepseekClientError, BroadcastContextDeepseekClientErrorDetails, BroadcastContextProxyDiagnosticHeaders (+19 more)

### Community 79 - "candidatePassBModelDownloadProgress.ts"
Cohesion: 0.15
Nodes (20): apply(), assertKnown(), ENTRY_KEY, entryKeys(), GENERATORS, here, IMAGE_EXTENSIONS, knownNames() (+12 more)

### Community 80 - "candidateReviewFeatureAvailability.ts"
Cohesion: 0.09
Nodes (33): BROADCAST_PARTICIPANT_GROUNDING_SCHEMA_VERSION, BroadcastParticipantGroundingChapter, BroadcastParticipantGroundingCellRangeInput, BroadcastParticipantGroundingSourceFence, BroadcastParticipantGroundingVisualCellRangeInput, BroadcastParticipantVoiceRecognitionPolicyInput, SealedBroadcastParticipantGroundingPlan, BROADCAST_PARTICIPANT_PRE_CONTEXT_ORCHESTRATION_REVISION (+25 more)

### Community 81 - "smoke-broadcast-transcript.mjs"
Cohesion: 0.13
Nodes (30): AnalyzeRequest, BUNDLED_ORT_WASM_URL, CancelRequest, cancelTask(), configureBundledOrtWasm(), createEventId(), createLoadingReporter(), disposeTensorGraph() (+22 more)

### Community 82 - "FakeVideoProbe"
Cohesion: 0.12
Nodes (14): ActiveTask, RunSpeakerEmbeddingOptions, identity, source, SpeakerEmbeddingWorkerResponsePayload, speechSamples(), start(), WorkerEventType (+6 more)

### Community 83 - "dependencies"
Cohesion: 0.15
Nodes (18): CandidatePassBBasisLabel, CandidatePassBCuePhase, basePresentation(), buildCandidatePassBPresentation(), CandidatePassBCuePhaseLabel, CandidatePassBPresentation, CandidatePassBPresentationCue, CandidatePassBPresentationErrorCode (+10 more)

### Community 84 - "smoke-gemini-proxy.mjs"
Cohesion: 0.20
Nodes (19): abortIfRequested(), asReadyBundle(), CANDIDATE_VIDEO_FRAME_SAMPLE_RATIOS, CandidateVideoFrameBundleResult, CandidateVideoFrameBundleTarget, candidateVideoFrameDimensions(), CandidateVideoFrameProducerOptions, CandidateVideoFrameSamplerSession (+11 more)

### Community 85 - "broadcastSelectionProtocol.ts"
Cohesion: 0.13
Nodes (27): cell(), canonicalProviderCheckpoint(), assertBroadcastTranscriptProviderReceiptCheckpoint(), BROADCAST_TRANSCRIPT_PROVIDER_RECEIPT_CHECKPOINT_SCHEMA_VERSION, broadcastTranscriptProviderReceiptCheckpointModelRevision(), BroadcastTranscriptProviderReceiptEntry, BroadcastTranscriptProviderReceiptPlanCell, BroadcastTranscriptProviderReceiptSettlement (+19 more)

### Community 86 - "candidatePassBRuntime.ts"
Cohesion: 0.06
Nodes (51): BROADCAST_TRANSCRIPT_ACTIVE_MODEL_REVISION, AnalysisCoverageSummary, AnalysisGapApprovalEvidence, AnalysisSelectionSummary, AudioAnalysisOutcome, BroadcastTranscriptExplorationCellState, CandidateBoundaryFeedback, CandidateGeminiInsight (+43 more)

### Community 87 - "AppErrorBoundary"
Cohesion: 0.18
Nodes (19): baselineValues(), BUCKET_SIZE_MS, clamp(), compareScoredBuckets(), createBucket(), createCandidate(), emptyResult(), finiteNonNegativeInteger() (+11 more)

### Community 88 - "ExClipper"
Cohesion: 0.33
Nodes (6): 2026-07-23 `0.3.47` 전사 중계 503 복구와 오류 경계, After / 구현, Before / 원인, 검증, 위험과 경계, 파급

### Community 89 - "chzzkVideoChannel.ts"
Cohesion: 0.18
Nodes (12): amplitudeToDb(), candidatePeakDistribution(), candidateSummary(), captureStdout(), clamp(), decodeFeatures(), main(), percentile() (+4 more)

### Community 90 - "localAudioReactionAnalysisCore.test.ts"
Cohesion: 0.21
Nodes (10): DurableBroadcastRefinementLeadInput, chapterFor(), completedParentLedger(), fence, identity(), lead(), requestFor(), RequestOptions (+2 more)

### Community 91 - "cleanupResources"
Cohesion: 0.17
Nodes (17): allocateWeightedFieldBytes(), CandidatePassBContextPacketInput, CandidatePassBContextTextKey, compactCodePointsHeadAndTail(), compactUtf8HeadAndTail(), createCanonicalCandidatePassBContextPacket(), normalizedContextText(), normalizedInputText() (+9 more)

### Community 92 - "LocalMediaPreflightAdapters"
Cohesion: 0.21
Nodes (18): LocalAudioReactionAnalysisStage, hasExactKeys(), isCandidate(), isCompletedResult(), isFenceEnvelope(), isFiniteNumber(), isNonNegativeInteger(), isProgress() (+10 more)

### Community 93 - "package.json"
Cohesion: 0.11
Nodes (18): 10. 상태·TTL·복구, 11. 보안 경계, 12. 배포 전 release gate, 1. 결론, 2. 확인된 외부 한도, 3. 왜 transcript와 candidate를 합쳤는가, 4. token 예약, 5. 요청 본문·header·응답 한도 (+10 more)

### Community 94 - "CandidatePassBEvidence"
Cohesion: 0.11
Nodes (19): @emnapi/core, @emnapi/runtime, eslint, devDependencies, @emnapi/core, @emnapi/runtime, eslint, @types/react (+11 more)

### Community 95 - "LocalVideoVisualAnalysisAdapters"
Cohesion: 0.11
Nodes (18): ES2023, node, vite.config.ts, vitest.config.ts, compilerOptions, exactOptionalPropertyTypes, lib, module (+10 more)

### Community 96 - "inspect-youtube-caption-json3.mjs"
Cohesion: 0.27
Nodes (13): ALLOWED_CATEGORIES, allowedCategory(), buildCandidatePassBContextPackets(), chatReaction(), matchingTopic(), nearestChapterText(), surroundingContext(), textForRange() (+5 more)

### Community 97 - "AnalysisLanguage"
Cohesion: 0.19
Nodes (13): delay(), FetchImplementation, isRecord(), isRetryableCaptionStatus(), parseYouTubeCaptionProxyResult(), requestYouTubeCaptionTrack(), requestYouTubeCaptionTrackOnce(), payload (+5 more)

### Community 98 - "CandidatePassBWorkerFailureReason"
Cohesion: 0.11
Nodes (31): event(), actionFor(), blockedReasonFor(), committedPercent(), ResumeActionKind, selectUnfinishedJobs(), summarizeUnfinishedJob(), drive() (+23 more)

### Community 99 - "candidateRankingView.test.ts"
Cohesion: 0.15
Nodes (15): CandidateCompareOnlyReason, CandidateField, CandidateFieldMergeOutcome, CandidateMergeContext, CandidateProposal, CandidateProposalMergeOutcome, compareOnly(), globalCompareOnlyReason() (+7 more)

### Community 100 - "sampleEvaluationContract.ts"
Cohesion: 0.11
Nodes (25): assertValidFile(), AUDIO_EXTENSIONS, BrowserCapabilitySnapshot, BrowserCapabilitySupport, CapabilityGlobal, createProbeWaitState(), DEFAULT_ADAPTERS, DocumentGlobal (+17 more)

### Community 101 - "ExClipper `0.3.34` 적용 판단"
Cohesion: 0.20
Nodes (10): 2026-07-19 — 제품 계획 수립, 미해결·검증 필요, 생성·수정 파일, 요청, 저장소 상태, 적용한 공용 규칙, 제품 결정 초안, 조사 결과 (+2 more)

### Community 102 - "Q: How do durable analysis records prevent raw chat and nickname leakage through arbitrary nested fields?"
Cohesion: 0.40
Nodes (5): 2026-07-28 다음 배포 후보 · 6인 등장인물 근거와 맥락 commit 봉인, 검증 결과, 반영한 계약, 이전 구조에서 확인한 문제, 현재 경계

### Community 103 - "Q: 현재의 하이라이트 검출은 무슨 기준을 사용하고 있지"
Cohesion: 0.17
Nodes (15): boundedInspectionRange(), createCaptionDiscoveredLeadRefinementPlan(), createDiscoveredLeadRefinementPlan(), DiscoveredLeadRefinementPlanOptions, DiscoveredLeadRefinementSegment, MaterializedRefinedLeadEvidence, materializeRefinedDiscoveredLeadEvidence(), MAX_REFINEMENT_AUDIO_MS (+7 more)

### Community 104 - "Q: 스트리머 반응 중심 목표 대비 현재 하이라이트 검출 신호의 적합성, 오탐, 미탐, 다음 구조를 감사"
Cohesion: 0.20
Nodes (16): apply(), commitAnalysisStage(), completeAnalysisJob(), failAnalysisJob(), JobBridgeOutcome, jobIdFor(), listAnalysisJobs(), nowIso() (+8 more)

### Community 105 - "Q: 근데 클립이란건 스트리머의 반응을 보는거지 화려한 연출을 보는게 아니야. 이게 맞는 접근인지 알려진 다른 사례들과 함께 확인해"
Cohesion: 0.16
Nodes (5): reject(), IndexedDbAnalysisResultStore, normalizeStoreFailure(), requestError(), storeClosedError()

### Community 106 - "Q: 0.3 오디오 반응부터 설명·저장·내보내기까지의 경로"
Cohesion: 0.20
Nodes (15): buildClipBaseName(), buildClipFileName(), ClipOutputKind, ClipRenderError, ClipRenderFailureCode, ClipRenderProgress, ClipRenderRequest, ClipRenderResult (+7 more)

### Community 107 - "Q: Candidate Pass B 구조가 App, Worker, provisional evidence, finalizing 완료 fence를 어떻게 연결하는가?"
Cohesion: 0.12
Nodes (13): durationMs, endpoint, extraction, file, quotaIdentity, quotaUrl, requestedDurationSeconds, sampleCount (+5 more)

### Community 108 - "Q: Trace candidate array order consumers and design CandidateRankingProposal lifecycle"
Cohesion: 0.33
Nodes (11): BroadcastContextPhaseRunnerError, accepted(), captureRunnerError(), createLedger(), fence, identity(), inFlightLedger(), outcomeUnknownLedger() (+3 more)

### Community 109 - "Q: 0.3.5 후보 재정렬 제안은 canonical 후보, 정밀 근거, 검토·경계·미리보기·export를 어떻게 안전하게 분리해야 하는가?"
Cohesion: 0.07
Nodes (51): boundedText(), CandidateFinalVerificationGap, CandidateFinalVerificationResult, candidatePassBReceiptMatchesContext(), CONTEXT_PACKET_KEYS, createCandidatePassBContextPacket(), finalizeFullyVerifiedCandidates(), hasValidCandidatePassBVerificationSourceRange() (+43 more)

### Community 110 - "Q: Beginner UX audit for per-candidate event and reaction explanations including evidence lifecycle states."
Cohesion: 0.18
Nodes (10): abortedError(), attemptCleanup(), cleanupResources(), defaultYieldControl(), loadVideoMetadata(), LocalVideoVisualProbe, mediaFailure(), seekVideo() (+2 more)

### Community 111 - "Q: 현재 v0.3.6 미커밋 diff를 초심자 UI/UX, 접근성, 모바일, 과장 표현 관점에서 다시 읽기 전용 감사해 주세요. App.tsx, styles/retto-highlight.css, README와 새 설명 모듈을 보되 수정은 하지 말고 P0/P1/P2만 파일·라인 근거로 보고하세요. 이전 지적이 실제로 해결됐는지도 확인하세요."
Cohesion: 0.17
Nodes (12): here, patternFor(), readRowHeight(), readRowMetrics(), readToken(), TEXT_SIZE_BASE, TUNABLE_TOKENS, UI_FORMS_CSS (+4 more)

### Community 112 - "Q: 현재 v0.3.6 미커밋 diff를 초심자 UI/UX, 접근성, 모바일, 과장 표현 관점에서 다시 읽기 전용 감사해 주세요. App.tsx, styles/retto-highlight.css, README와 새 설명 모듈을 보되 수정은 하지 말고 P0/P1/P2만 파일·라인 근거로 보고하세요. 이전 지적이 실제로 해결됐는지도 확인하세요."
Cohesion: 0.22
Nodes (11): DIALOGS, here, pair(), panel(), chip(), drive(), here, jobAt() (+3 more)

### Community 113 - "Q: 후보별 사건·반응 설명을 어떤 근거 경계로 구현하고 UI에 연결해야 하나?"
Cohesion: 0.27
Nodes (9): createEventFence(), CreateEventFenceInput, EventFenceOutcome, EventFenceState, FenceableEvent, fenceEvent(), reject(), makeFence() (+1 more)

### Community 114 - "Q: 현재 repo에서 local Whisper CandidatePassB 흐름을 Gemini API 기반 후보 오디오 전사/사건 설명으로 교체하거나 병행하는 최소 안전 수직 슬라이스"
Cohesion: 0.14
Nodes (9): ChatAnalysisWorkerLike, normalizeWorkerTimeout(), runChatAnalysisWorker(), emptyResult, FakeWorker, identity, startWith(), WorkerEventType (+1 more)

### Community 115 - "Q: How does App start Gemini candidate analysis and keep the response fenced from canonical editing state?"
Cohesion: 0.19
Nodes (7): ProgressAxisInput, formatStageTimingReport(), StageTimer, StageTiming, StageTimingReport, timerWith(), AnalysisStage

### Community 116 - "Q: 세팅하려면 이제 뭐가 필요하지"
Cohesion: 0.15
Nodes (22): hasExactKeys(), isNonNegativeSafeInteger(), isProgress(), isRecord(), isResponseEnvelope(), isWorkerIdentity(), modelDescriptorMatches(), PROGRESS_STAGE_RANK (+14 more)

### Community 117 - "Q: Where should grounded VTuber participant identity be added without changing highlight ranking?"
Cohesion: 0.13
Nodes (14): 1. 공용 지침과 우선순위, 2. 고정된 제품 정체성, 3. 데이터·보안 경계, 4. 상태·생애주기 우선 설계, 5. 초심자 UI/UX, 6. StreamSaver 디자인 기준, 7. 작업공간과 변경 규칙, 8. 버전·로그·커밋 (+6 more)

### Community 118 - "Q: Where is the model routing policy disconnected from runtime, and which paths control provider fallback?"
Cohesion: 0.12
Nodes (16): scripts, build, check, cloudflare:deploy, cloudflare:dev, dev, dev:focus, enrollment:evaluate-speakers (+8 more)

### Community 119 - "Q: Audit candidate selection, context, music filtering, participant identity, transcript transport, and timeline architecture."
Cohesion: 0.17
Nodes (14): BroadcastContextResult, BroadcastContextSemanticChapterKind, BroadcastContextSemanticFamily, BroadcastContextTimelineMetric, BroadcastContextTimelinePresentation, BroadcastContextTimelinePresentationInput, BroadcastContextTimelineState, BroadcastContextUiStatus (+6 more)

### Community 120 - "Q: How does ExClipper select topic-balanced caption refinements and prevent routine gameplay from reaching canonical editor cards?"
Cohesion: 0.08
Nodes (16): CandidateAudioEventRunResult, CandidateAudioEventWorkerLike, emit(), emitCandidateProgress(), emitModelReady(), FakeWorker, identity, StartOverrides (+8 more)

### Community 121 - "Q: How should ExClipper distinguish semantic chapter and lead states on the restored timeline?"
Cohesion: 0.19
Nodes (17): BroadcastParticipantVoiceRecognitionPolicy, BroadcastParticipantVoiceRecognitionScore, PARTICIPANT_VOICE_UNKNOWN_ID, embeddingFromOutput(), assertL2NormalizedSpeakerEmbedding(), averageSpeakerEmbeddingPrototype(), cosineSpeakerEmbeddings(), l2NormalizeSpeakerEmbedding() (+9 more)

### Community 122 - "Q: Gemini 공용 키를 모든 필요한 모델 경로에 연결하고 교환학생 출연진을 전체 맥락 분석에 사용하는 방법은 무엇인가?"
Cohesion: 0.06
Nodes (40): broadcastRefinementEvidenceLedgerCanPublish(), projectBroadcastRefinementActiveEvidenceRoute(), candidateAudioEventKindLabel(), CandidateAudioEventWorkerError, CandidateAudioEventWorkerFailureReason, CandidateEvidenceUnknown, ChatAnalysisWorkerError, App() (+32 more)

### Community 123 - "sourceReadyTimelinePresentation.ts"
Cohesion: 0.16
Nodes (15): buildCandidates(), Case(), fill(), buildReviewCandidates(), fallbackTitle(), ReviewModelInput, ReviewSourceCandidate, ReviewSourceFrame (+7 more)

### Community 124 - "Q: Should v0.3.6 add a Korean text generator or deterministic evidence explanation?"
Cohesion: 0.31
Nodes (12): balancedJsonObject(), createYouTubeCaptionChapters(), createYouTubeCaptionRefinementTranscripts(), extractKoreanYouTubeCaptionTrack(), extractKoreanYouTubeCaptionTrackFromPlayerResponse(), isRecord(), normalizedCaptionText(), parseYouTubeCaptionJson3() (+4 more)

### Community 125 - "highlightSelector.test.ts"
Cohesion: 0.15
Nodes (11): captureDefaultLumaFingerprint(), LocalVideoVisualCanvas, createVisualHarness(), FakeCanvas, fingerprint(), samplesFromValues(), VideoEventType, VisualHarness (+3 more)

### Community 126 - "appendHiddenElement"
Cohesion: 0.13
Nodes (15): 12. 개인용 출시 승인 기준, 13. 구현 전 추가 검토 체크리스트, 14. `0.3.28` provider 설정 운영 경계, 15. `0.3.29` 계층형 문맥·자막·네거티브 게이트, 16. `0.3.30` 출연자 근거와 문맥 응답 복구, 1. 운영 범위와 명시적 프로젝트 예외, 2026-07-22 release notes, 2026-07-23 release notes (+7 more)

### Community 127 - "boundedAsyncMap.ts"
Cohesion: 0.14
Nodes (14): 23.10 현재 구현하는 후보 검토 우선순위 제안 슬라이스, 23.11 현재 구현하는 근거 기반 후보 설명 projection, 23.12 `0.3.7` Gemini 후보 정밀 분석 전이, 23.13 `0.3.26` 편집자 작업공간의 후보 포커스 projection, 23.1 command와 event 분리, 23.2 TypeScript 규칙, 23.3 reasonCode 최소 집합, 23.4 현재 구현된 완료 분석 복구 슬라이스 (+6 more)

### Community 128 - "tsconfig.json"
Cohesion: 0.08
Nodes (35): BROADCAST_TRANSCRIPT_MEDIA_ENDPOINT_PATH, BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE, BROADCAST_TRANSCRIPT_MEDIA_SCHEMA_VERSION, BroadcastTranscriptMediaResolveRequest, BroadcastTranscriptMediaStagedResponse, createBroadcastTranscriptMediaResolveRequest(), hasExactKeys(), isBroadcastTranscriptMediaTicket() (+27 more)

### Community 129 - "candidateAudioEventEvidenceState.ts"
Cohesion: 0.22
Nodes (10): buildBroadcastContextEligibilityById(), CandidateAiProjectionById, CandidateAiProjectionDisposition, CandidateAiQueueItem, ContextQualifiedFinalSelection, finalizeContextQualifiedCandidates(), isContextExcludedProgramMaterial(), selectCandidateDetailCandidateIds() (+2 more)

### Community 130 - "broadcastContextPersistence.ts"
Cohesion: 0.12
Nodes (20): BroadcastTranscriptResolvedEvidenceReason, BroadcastTranscriptVisualFramePreparationTask, BroadcastTranscriptVisualInspectionCell, BroadcastTranscriptVisualInspectionPlan, BroadcastTranscriptVisualPreparedFrameReceipt, BroadcastTranscriptVisualProviderSettlement, BroadcastTranscriptVisualProviderSettlementLedger, BroadcastTranscriptVisualProviderTask (+12 more)

### Community 131 - "candidatePassBDurability.ts"
Cohesion: 0.18
Nodes (18): ChatAnalysisWorkerFactory, hasFiniteNumberFields(), isChatCandidate(), isFenceEnvelope(), isFiniteNumber(), isHighlightSelectionResult(), isNonNegativeInteger(), isRecord() (+10 more)

### Community 132 - "eslint-plugin-react-refresh"
Cohesion: 0.11
Nodes (28): BroadcastParticipantGroundingAdapterOutputs, BroadcastParticipantMediaAdapterOutput, BroadcastParticipantObservedEvidence, CreateBroadcastParticipantGroundingInput, adapterCompletionReceipt(), assertCurrentSourceFence(), BroadcastParticipantGroundingBridgeError, BroadcastParticipantGroundingBridgeErrorCode (+20 more)

### Community 133 - "@types/node"
Cohesion: 0.15
Nodes (13): 0.6.1 배포 · 2026-07-25, 2026-07-25 · 스트리머 팔레트 대비-보정 + 검토 카드 보존, Candidate Pass B verification receipt exact source-range fence · 2026-07-29, 검토 화면 재구축 · 코드 인제스션 1단계 · 2026-07-25, 남은 시간 표시: 18% 여유분 + 단조 감소 · 2026-07-25, 로컬↔배포 동기화 + 0.6.0 · 2026-07-25, 명세 §11 키맵 정합 + 폰트 경로 버그 · 2026-07-25, 사용자 문장에서 "상위 N%" 순위 지표 제거 · 2026-07-25 (+5 more)

### Community 134 - "CandidatePassBCandidateGapReason"
Cohesion: 0.17
Nodes (12): 13.10 실패 모드와 정직한 폴백, 13.11 스포츠·중계·기존 자동 클립에서 가져올 원칙, 13.1 제품 규칙, 13.3 방송 내부 기준선과 특징 정규화, 13.4 채팅 점수·도배 보정·반응 지연, 13.5 멀티모달 점수와 신뢰도, 13.6 로컬 모델과 실행 tier, 13.7 모델 다운로드·캐시·삭제 (+4 more)

### Community 135 - "contextQualifiedFinalSelection.ts"
Cohesion: 0.18
Nodes (7): candidates, captions, chapters, events, fastPass, result, sourceDurationMs

### Community 136 - "vite"
Cohesion: 0.18
Nodes (10): boundedText(), captions, discoveredLeads, events, lead, parent, refineWindow(), result (+2 more)

### Community 137 - "analysisBudgetPolicy.ts"
Cohesion: 0.31
Nodes (13): audienceReactionExplanation(), audioRange(), buildHighlightNarrative(), chatRange(), eventExplanation(), HighlightInterpretationBasis, recommendationExplanation(), relationBetween() (+5 more)

### Community 139 - "eslint.config.js"
Cohesion: 0.17
Nodes (12): 22.10 property·fuzz 테스트, 22.11 출시 gate, 22.1 테스트 기반, 22.2 생애주기별 최소 매트릭스, 22.3 AnalysisRun 상세 전이 테스트, 22.4 LocalLiveCaptureRun 상세 전이 테스트, 22.5 AI와 사용자 revision 경합 테스트, 22.6 다중 탭·writer 경합 테스트 (+4 more)

### Community 140 - "smoke-broadcast-context.mjs"
Cohesion: 0.14
Nodes (10): CandidatePassBCue, CandidatePassBQualitySummary, MappedTranscriptChunk, CANDIDATE_PASS_B_CUE_PHASE_LABELS, CandidatePassBPresentationError, baseNarrative, cue(), expectedFastNarrativeFields (+2 more)

### Community 141 - "BROADCAST_TRANSCRIPT_ACTIVE_MODEL_REVISION"
Cohesion: 0.17
Nodes (12): 2026-07-19 — `rettolight` 저장소 생성과 첫 실행 가능한 수직 슬라이스, 검증, 구현 구조, 문제 해결 기록, 요청과 범위, 이번 단계의 정직한 기능 경계, 저장소, 커밋·배포 상태 (+4 more)

### Community 142 - "QWEN_CANDIDATE_MODEL_ID"
Cohesion: 0.23
Nodes (10): CandidatePublicationGate, CandidatePublicationGateInput, CandidateStageCommitGate, deriveCandidatePublicationGate(), deriveCandidateStageCommitGate(), selectCandidateDetailActionIds(), SemanticLeadRefinementStatus, refinementEvidenceProjectionFingerprint (+2 more)

### Community 143 - "QWEN_CANDIDATE_MODEL_REVISION"
Cohesion: 0.29
Nodes (7): byteCount(), CandidatePassBModelDownloadAggregate, CandidatePassBModelDownloadTracker, DownloadFileState, isRecord(), nonEmptyBoundedString(), safeSum()

### Community 144 - "MAX_CANDIDATE_AUDIO_EVENT_CANDIDATES"
Cohesion: 0.22
Nodes (9): 2026-07-19 — 최신 공용 지침 재감사와 개인 편집 어시스턴트 확정, 개인용 운영 완성도 재해석, 다시 읽은 지침과 안전 조치, 버전·커밋, 상태·생애주기 감사 결과, 생성·수정 파일, 요청과 최종 제품 결정, 최종 정합성 검증 (+1 more)

### Community 145 - "vite-env.d.ts"
Cohesion: 0.32
Nodes (7): AUDIO_REACTION_CANDIDATE_WINDOW_MS, AudioReactionFeatureWindow, NormalizedWindow, ScoredWindow, baseline(), setReaction(), speechWindow()

### Community 146 - "CandidatePassBEvidence"
Cohesion: 0.13
Nodes (28): attachVisualContext(), canonicalSignalKinds(), clamp(), compareDrafts(), comparePairProposals(), comparePreparedCandidates(), compareReactionDrafts(), compareReactionPairProposals() (+20 more)

### Community 147 - "vitest.config.ts"
Cohesion: 0.33
Nodes (6): 2026-07-23 `0.3.46` 키보드 검토 루프와 App 구조 분리, After / 구현, Before / 원인, 검증, 구조 분리, 위험과 경계

### Community 148 - "13.2 장시간 원본을 위한 계층형 멀티패스"
Cohesion: 0.18
Nodes (11): 19.10 암묵적 변화 피드백, 19.1 공통 표시 원칙, 19.2 SourceCheck UI, 19.3 ChatImport UI, 19.4 선택형 로컬 수집기 UI, 19.5 ModelDownload UI, 19.6 AnalysisRun UI, 19.7 Segment와 AI proposal UI (+3 more)

### Community 149 - "2026-07-25 · 스트리머 팔레트 대비-보정 + 검토 카드 보존"
Cohesion: 0.18
Nodes (11): 2026-07-19 — 사용자 피드백에 따른 AI-first 전면 개정, CHZZK 채팅 조사·결정, StreamSaver UI 기준 반영, 기존 결정 중 폐기·강등, 로컬 AI 조사·결정, 문서 변경, 방향 수정 요청, 새 핵심 흐름 (+3 more)

### Community 150 - "candidateSignals.ts"
Cohesion: 0.15
Nodes (12): 2026-07-29 보완: 맥락 전 근거화와 후보별 재확인의 분리, 6인 목소리 판정 계약, 6인 카탈로그와 출처 prior, 다음 단계: 실제 목소리 근거 어댑터, 다음 단계: 실제 화면 근거 어댑터, 목표, 방송 등장인물 근거화 파이프라인, 실제 매체 어댑터의 완료 게이트 (+4 more)

### Community 151 - "2026-07-19 — `rettolight` 저장소 생성과 첫 실행 가능한 수직 슬라이스"
Cohesion: 0.20
Nodes (10): 11.1 저장 공간 부족, 11.2 모델 다운로드 실패 또는 hash 불일치, 11.3 WebGPU device lost·Worker crash, 11.4 IndexedDB 손상·migration 실패, 11.5 앱 셸·service worker 버전 불일치, 11.6 source 권한 상실·파일 이동, 11.7 분석 중 브라우저 종료, 11.8 렌더 실패·취소 (+2 more)

### Community 152 - "2026-07-28 다음 배포 후보 · 6인 등장인물 근거와 맥락 commit 봉인"
Cohesion: 0.36
Nodes (8): BroadcastSummaryCitationCandidate, BroadcastSummaryCitationPart, BroadcastSummaryCitationPresentation, buildBroadcastSummaryCitationPresentation(), normalizeText(), overlapScore(), sentences(), tokens()

### Community 153 - "tsconfig.json"
Cohesion: 0.40
Nodes (5): 2026-07-20 — `0.3.11` 제품명 ExClipper 전환, 검증 결과, 결정, 외부 평가 반영, 적용

### Community 154 - "Q: 1) groq에서 whisper v3을 무료 제공하는데, 지금 qwen3-asr/qwen3.5 omni flash 와 비교해보자. 뭐가 가장 합리적인지"
Cohesion: 0.22
Nodes (7): assertNonNegativeFinite(), formatBytes(), formatDuration(), Harness, ProbeEventType, ProbeListener, trimTrailingZeroes()

### Community 156 - "eslint-plugin-react-hooks"
Cohesion: 0.20
Nodes (10): 7.1 ChatImport 상태, 7.2 전이표, 7.3 정렬 revision과 안전 경계, 7.4 선택형 LocalLiveCaptureRun의 위치, 7.5 LocalLiveCaptureRun 중심 상태, 7.6 시작·연결·재연결 전이표, 7.7 종료 요청·진행·확정, 7.8 수집기 interruption 복구 (+2 more)

### Community 157 - "eslint-plugin-react-refresh"
Cohesion: 0.22
Nodes (9): @huggingface/transformers, mediabunny, dependencies, @huggingface/transformers, mediabunny, react, react-dom, react (+1 more)

### Community 158 - "Q: 어떻게 구현할지 한번 정리하자"
Cohesion: 0.22
Nodes (9): 11.1 1차 엔진: Mediabunny + WebCodecs, 11.2 렌더 사전 검사, 11.3 실제 클립 생성 흐름, 11.4 대용량 메모리 방어 규칙, 11.5 파일 저장 폴백, 11.6 ffmpeg.wasm의 위치, 11.7 브라우저 지원 정책, 11.8 검토한 대안 (+1 more)

### Community 159 - "@types/react-dom"
Cohesion: 0.22
Nodes (9): 18. 단계별 구현 로드맵, 단계 0 — 상태 안전성 골격과 AI 핵심 가능성 검증, 단계 1 — AI-first 로컬 MVP, 단계 2 — 채팅 결합과 후보 정밀 AI, 단계 3 — 복구·신뢰·Pages·접근성 강화, 단계 4 — YouTube·CHZZK 링크와 원본 획득 안내, 단계 5 — 실제 로컬 클립 출력과 편집기 전달, 단계 6 — 로컬 개인화와 품질 확대 (+1 more)

### Community 160 - "typescript"
Cohesion: 0.22
Nodes (9): 4.1 첫 화면, 4.2 소스 사전 검사, 4.3 AI 분석 화면, 4.4 AI 누락을 보완하는 수동 후보, 4.5 긴 하이라이트, 4.6 중복·겹침, 4.7 검토 화면, 4.8 결과 화면 (+1 more)

### Community 161 - "typescript-eslint"
Cohesion: 0.22
Nodes (9): 5.1 로컬 원본, 5.2 YouTube 링크, 5.3 CHZZK 링크, 5.4 생방송 기록, 5. 플랫폼별 핵심 시나리오, Pages 단독 모드에서 바로 지원, 개인정보 기본값, 공식 실시간 수집의 경계 (+1 more)

### Community 162 - "vitest"
Cohesion: 0.22
Nodes (8): expectedInsightKeys, extraction, insight, insightKeys, offsetSeconds, result, videoFrames, wav

### Community 163 - "22. 전이 중심 테스트 매트릭스"
Cohesion: 0.22
Nodes (8): BROADCAST_SELECTION_SCHEMA_VERSION, BroadcastSelectionCandidateInput, BroadcastSelectionCandidateRelation, BroadcastSelectionChapterInput, BroadcastSelectionCoverageGap, BroadcastSelectionRelationType, BroadcastSelectionRequest, BroadcastSelectionResult

### Community 164 - "eslint.config.js"
Cohesion: 0.42
Nodes (7): BroadcastResolvedAbstentionReason, createBroadcastNoAudioChapters(), createBroadcastNoSpeechChapters(), createBroadcastResolvedAbstentionChapters(), createBroadcastTranscriptChapters(), mergeBroadcastTranscriptChapters(), representativeCodePoints()

### Community 165 - "smoke-broadcast-context.mjs"
Cohesion: 0.28
Nodes (6): CandidatePassBRuntimeCapabilitySnapshot, CandidatePassBRuntimeSelectionOptions, LegacyCandidatePassBDevice, NavigatorWithOptionalGpu, selectCandidatePassBRuntimeDevice(), PreferredPreflightRuntimeTier

### Community 166 - "gen-forms.mjs"
Cohesion: 0.21
Nodes (10): DeleteConfirm(), UnfinishedJobsSheetProps, deleteConfirmationText(), UnfinishedJobSummary, dismissSheet(), INITIAL_SHEET_VISIBILITY, openSheet(), reconcileSheetVisibility() (+2 more)

### Community 167 - "2026-07-19 — 사용자 피드백에 따른 AI-first 전면 개정"
Cohesion: 0.25
Nodes (4): AppErrorBoundary, AppErrorBoundaryProps, AppErrorBoundaryState, rootElement

### Community 168 - "candidatePublicationGate.ts"
Cohesion: 0.20
Nodes (3): SpeakerEmbeddingWorkerLike, FakeWorker, SpeakerEmbeddingWorkerRequest

### Community 170 - "QWEN_CANDIDATE_MODEL_REVISION"
Cohesion: 0.33
Nodes (6): 2026-07-24 `0.5.3` 내부 구성 재설계 — 신호 타일 · 필름스트립 · 레일의 쓸모, 검증, 글자 한도와 그 출구, 무엇을 바꿨나, 왜, 프레임이 좁아질 때

### Community 171 - "19. 상태별 UI 투영"
Cohesion: 0.25
Nodes (8): CHZZK 채팅, ExClipper, GitHub Pages 배포, 개발 서버에서 실행하기, 설계 문서, 저장과 계정, 지금 구현된 첫 수직 슬라이스, 키보드로 검토하기

### Community 172 - "MAX_CANDIDATE_AUDIO_EVENT_CANDIDATES"
Cohesion: 0.40
Nodes (5): 2026-07-23 — `0.3.43` 동적 사건 지도·안전한 검토창·모바일 후보 파이프라인, After / 구현, Before / 원인, 검증, 위험과 복구

### Community 173 - "vite-env.d.ts"
Cohesion: 0.40
Nodes (5): 2026-07-24 `0.4.5` 16:9 검토 서피스 · 위치 스트립 · 도시에 탭 (PART C+D+E), After / 구현, Before / 원인, 검증, 명세 대비 의도적 축소(2건, 공개)

### Community 174 - "vite.config.ts"
Cohesion: 0.46
Nodes (6): CHZZK_VIDEO_CHANNEL_PROXY_ENDPOINT, chzzkVideoNoFromSourceName(), FetchImplementation, isRecord(), parseChzzkVideoChannelResult(), requestChzzkVideoChannel()

### Community 175 - "vitest.config.ts"
Cohesion: 0.40
Nodes (5): 2026-07-24 `0.4.7` 결과·산출물 개선 (PART H-1~H-6), After / 구현, Before / 원인, 검증, 무결성 사고 하나 (기록해 둘 가치가 있어서)

### Community 176 - "2026-07-19 — 제품 계획 수립"
Cohesion: 0.40
Nodes (5): 2026-07-24 `0.5.1` 검토 화면 실측 교정 — 브라우저로 보고 고침, 검증, 도구 (신규, 저장소에 남김), 실측으로 잡은 것, 왜

### Community 177 - "11. 장애 대응 runbook"
Cohesion: 0.29
Nodes (6): CandidateVerificationCohortInput, CandidateVerificationIdentity, selectCandidateVerificationCohort(), allCandidateIds, candidates, paidDetailIds

### Community 179 - "7. ChatImport와 ChatSource 생애주기"
Cohesion: 0.25
Nodes (3): createDefaultObjectURL(), LocalMediaPreflightAdapters, revokeDefaultObjectURL()

### Community 180 - "2026-07-19 — 최신 공용 지침 재감사와 개인 편집 어시스턴트 확정"
Cohesion: 0.25
Nodes (8): 21.1 소유·동시성, 21.2 식별자·이벤트, 21.3 사람 편집 보호, 21.4 완료·내구성, 21.5 데이터와 시간, 21.6 종료와 청소, 21.7 canonical 불변식 요약, 21. 전역 불변식

### Community 181 - "11. 로컬 미디어 처리 계획"
Cohesion: 0.25
Nodes (8): 9.1 AnalysisJob과 AnalysisSpec, 9.2 AnalysisRun 중심 상태, 9.3 정상 전이표, 9.4 일시정지·재개 전이표, 9.5 취소·실패·중단 전이표, 9.6 부분 결과 공개 규칙, 9.7 분석 실행 불변식, 9. AnalysisJob, AnalysisSpec, AnalysisRun 생애주기

### Community 182 - "18. 단계별 구현 로드맵"
Cohesion: 0.25
Nodes (7): 5번이 실제로 잡은 것, ui-forms — 공용 표시 폼, 나중에 별도 저장소로 뺄 때, 변형, 붙이는 법, 지금 있는 것, 지켜야 하는 규칙 (별도 저장소로 떼어낼 수 있게)

### Community 183 - "4. 단방향 핵심 흐름"
Cohesion: 0.29
Nodes (7): `0.3.3` 검증 결과, `0.3.3` 첫 AI 슬라이스 구현 결과, 2026-07-19 — AI 기능 우선순위 재조정과 앱 0.3.3 Pass B 착수, 독립 감사 뒤 긴급 품질·lifecycle 보강, 사용자 우선순위 수정, 코드·계획 재감사, 확정한 첫 AI 슬라이스

### Community 184 - "5.4 생방송 기록"
Cohesion: 0.25
Nodes (8): 2026-07-19 — 앱 0.3.0 스트리머 반응 우선 오디오 fast pass, 검증, 다음 품질 슬라이스, 반응 anchor fusion과 설명, 알려진 방법 재검토와 채택 결정, 오디오 순차 분석 Worker, 저장·복구·내보내기, 초심자 UI와 CSS

### Community 185 - "AudioFeatureAccumulator"
Cohesion: 0.33
Nodes (6): 2026-07-27 `0.8.5` 전사 CORS의 실제 원인·직접 Base64 transport, Worker-first 운영 검증, 구현, 로컬 검증, 운영 증거와 원인, 장시간 후속 검증과 판정 수정

### Community 186 - "2026-07-19 — 앱 0.3.0 스트리머 반응 우선 오디오 fast pass"
Cohesion: 0.25
Nodes (8): 2026-07-24 `0.5.4` PassB가 한 번도 시작되지 않던 버그, 검증, 기각된 첫 가설 (기록용), 남는 것, 명세서, 수정, 실제 원인, 증상

### Community 187 - "2026-07-24 `0.5.4` PassB가 한 번도 시작되지 않던 버그"
Cohesion: 0.29
Nodes (6): 1. 저장 필드 — AST 가 노드로 만들지 않는다, 2. 파일명이 개념과 다른 것, 3. 두 번 만들기 쉬운 것 — 이미 있다, 4. 갱신 방법, 데이터베이스가 둘인 이유, 보완 색인 — graphify 가 못 잡는 것

### Community 188 - "ExClipper"
Cohesion: 0.29
Nodes (7): 2.1 현재 `0.3.2` 오디오 fast pass·세션 구간 편집 운영 경계, 2.2 `0.3.3~0.3.6` 후보 전용 로컬 전사 운영 기록 (`0.3.7`에서 비활성), 2.3 `0.3.4` 후보 전용 오디오 사건 AI 운영 경계, 2.4 `0.3.5` 후보 검토 우선순위 제안 운영 경계, 2.5 `0.3.6` 근거 기반 사건·반응 단서 운영 경계, 2.6 `0.3.9` Gemini 후보 정밀 분석 운영 경계, 2. 배포 구조와 데이터 경계

### Community 189 - "Q: 이건 별도로 검토한 건데, 한번 비교해보자"
Cohesion: 0.29
Nodes (6): engines, node, name, private, type, version

### Community 190 - "candidateVerificationCohort.ts"
Cohesion: 0.29
Nodes (7): 13.2 장시간 원본을 위한 계층형 멀티패스, Pass 0 — 사전 검사와 3분 성능 측정, Pass A.5 — 후보 회수와 sentinel, Pass A — 전체 저비용 스캔, Pass B — 후보 구간만 정밀 AI, Pass C — `맥락 → 사건 → 반응` 경계 다듬기, Pass D — 설명·중복 제거·다양성

### Community 191 - "21. 전역 불변식"
Cohesion: 0.40
Nodes (5): 2026-07-28 `0.8.7` 배포 후보 · 실패 전사 조각 선복구와 맥락 봉인, Candidate Free R2 실서비스 결함과 수정, 검증 결과, 수정한 복구 계약, 확인한 원인

### Community 192 - "9. AnalysisJob, AnalysisSpec, AnalysisRun 생애주기"
Cohesion: 0.19
Nodes (9): analyzeLocalVideoVisuals(), assertValidFile(), clampInteger(), copyFingerprint(), emitProgress(), eraseFingerprints(), LocalVideoVisualAnalysisAdapters, normalizeTimeout() (+1 more)

### Community 193 - "ui-forms — 공용 표시 폼"
Cohesion: 0.29
Nodes (7): 14.1 출력 snapshot, 14.2 RenderBatch 상태, 14.3 RenderBatch 전이표, 14.4 RenderItem 상태, 14.5 렌더 중 취소와 부분 실패, 14.6 렌더 불변식, 14. RenderBatch와 RenderItem 생애주기

### Community 194 - "2026-07-19 — AI 기능 우선순위 재조정과 앱 0.3.3 Pass B 착수"
Cohesion: 0.33
Nodes (6): `0.3.7` 구현 결과, `0.3.7` 구현 계약, `0.3.7` 배포 완료, `0.3.7` 배포 전 검증, 2026-07-20 — 앱 0.3.7 Gemini 한국어 후보 정밀 분석 착수, 사용자 문제와 방향 전환

### Community 195 - "2026-07-19 — 앱 0.2.0 완료 분석 복구·내용 샘플 지문·영속 개인정보 allowlist"
Cohesion: 0.33
Nodes (6): `0.3.8` 배포 완료, `0.3.8` 배포 전 검증, 2026-07-20 — 앱 0.3.8 로컬 빠른 분석 impulse 포화 교정, 구현과 실제 샘플 검증, 발견한 원인과 변경 계약, 배포 후 후보 시간 분포 관측 보강

### Community 196 - "보완 색인 — graphify 가 못 잡는 것"
Cohesion: 0.29
Nodes (7): 2026-07-19 — 앱 0.2.0 완료 분석 복구·내용 샘플 지문·영속 개인정보 allowlist, 검증, 로컬 영상 내용 샘플 지문, 여전히 남은 경계, 영속 개인정보 경계, 완료 결과 발견과 복구 권위, 초심자 UI

### Community 197 - "2. 배포 구조와 데이터 경계"
Cohesion: 0.33
Nodes (6): 10.1 IndexedDB에는 기록만 저장, 10.2 자동 저장, 10.3 초심자 안내 문구, 10.4 한 탭만 쓰기, 10.5 로컬 백업과 운영 기준, 10. 저장·자동 복구·개인정보

### Community 198 - "14. RenderBatch와 RenderItem 생애주기"
Cohesion: 0.33
Nodes (6): 14.1 정적 호스팅 경계, 14.2 경로와 라우팅, 14.3 응답 헤더, 14.4 PWA, 14.5 개인용 운영 경계, 14. GitHub Pages 전용 설계

### Community 199 - "gen-palettes.mjs"
Cohesion: 0.33
Nodes (6): 17.1 초심자 사용성 과제, 17.2 기능·엣지 케이스, 17.3 미디어 테스트 매트릭스, 17.4 플랫폼·배포 테스트, 17.5 AI 품질 벤치마크와 출시 게이트, 17. 테스트 계획

### Community 200 - "2026-07-20 — 앱 0.3.7 Gemini 한국어 후보 정밀 분석 착수"
Cohesion: 0.33
Nodes (6): 8.1 핵심 원칙, 8.2 권장 기술 스택, 8.3 Source Adapter 계약, 8.4 상태·생애주기 모델, 8.5 권장 소스 폴더 구조, 8. 프로그램 아키텍처

### Community 201 - "2026-07-20 — 앱 0.3.8 로컬 빠른 분석 impulse 포화 교정"
Cohesion: 0.33
Nodes (5): endSeconds, matches, pattern, payload, startSeconds

### Community 202 - "2026-07-19 — 최초 Pages 배포 완료와 앱 0.3.2 여러 후보 구간 다듬기"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: rettolight(exclipper) 폴더를 보고 얘가 뭐 하고 있는지 분석해보자, Source Nodes

### Community 203 - "2026-07-19 — 앱 0.2.1 기본 완주 화면·편집 시간표 출력"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: How should a durable broadcast context unit runner resume, retry, persist, and complete work?, Source Nodes

### Community 204 - "2026-07-23 `0.3.46` 키보드 검토 루프와 App 구조 분리"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: App.tsx를 잘게 분석해서 나눌 수 있는 구조인지 확인, 억지로 나눌 필요는 없고 기능적으로 분해가 되는지, Source Nodes

### Community 205 - "2026-07-23 `0.3.47` 전사 중계 503 복구와 오류 경계"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Implement a safe partial-coverage participant voice grounding contract with explicit coverage, thresholds, margin, and abstention., Source Nodes

### Community 206 - "2026-07-24 `0.5.0` 검토 화면 원점 재설계 — 물리적 태블릿"
Cohesion: 0.50
Nodes (3): SpeakerEmbeddingWorkerFailure, SpeakerEmbeddingWorkerClientError, SpeakerEmbeddingWorkerFailureReason

### Community 207 - "2026-07-24 `0.5.3` 내부 구성 재설계 — 신호 타일 · 필름스트립 · 레일의 쓸모"
Cohesion: 0.33
Nodes (4): NamedPositiveMoment, SAMPLE_EVALUATION_CONTRACT_VERSION, SampleEvaluationContract, SampleGroundTruthMode

### Community 208 - "2026-07-27 `0.8.5` 전사 CORS의 실제 원인·직접 Base64 transport"
Cohesion: 0.33
Nodes (6): 10.1 두 데이터를 분리하는 이유, 10.2 AI 제안 자동 반영 조건, 10.3 필드별 소유권, 10.4 승인과 제외, 10.5 동시 도착 예시, 10. CandidateProposal과 Segment revision 병합

### Community 209 - "10. 저장·자동 복구·개인정보"
Cohesion: 0.33
Nodes (6): 12.1 SaveCoordinator와 SaveCommit 분리, 12.2 전이표, 12.3 저장 generation과 CAS, 12.4 낙관적 화면과 내구성 표시, 12.5 저장 불변식, 12. 저장 생애주기

### Community 210 - "14. GitHub Pages 전용 설계"
Cohesion: 0.33
Nodes (6): 2.1 한 상태는 한 대상의 한 생애주기만 표현한다, 2.2 중심 상태와 보조 상태를 분리한다, 2.3 요청·진행·확정을 구분한다, 2.4 종료 의미를 섞지 않는다, 2.5 재시도와 재개 식별자 규칙, 2. 상태 모델 공통 원칙

### Community 211 - "17. 테스트 계획"
Cohesion: 0.40
Nodes (3): css, here, SIZES

### Community 213 - "aiProxy.worker.test.ts"
Cohesion: 0.40
Nodes (5): `0.3.3` 배포 완료, `0.3.4` 배포 전 검증, `0.3.4` 후보 오디오 반응 종류 AI 구현 결과, 2026-07-20 — 앱 0.3.3 배포와 0.3.4 오디오 반응 종류 AI 착수, 다음 AI 기능 결정

### Community 214 - "10. CandidateProposal과 Segment revision 병합"
Cohesion: 0.40
Nodes (5): `0.3.6` 구현 결과, `0.3.6` 배포 완료, `0.3.6` 배포 전 검증, 2026-07-20 — 앱 0.3.6 근거 기반 사건·반응 단서 착수, 구현 전 조사와 선택

### Community 215 - "12. 저장 생애주기"
Cohesion: 0.33
Nodes (6): 12시간 원본 상한 확정, 2026-07-19 — 최초 Pages 배포 완료와 앱 0.3.2 여러 후보 구간 다듬기, AI 제안 보존형 시작·끝 다듬기, 검증, 여러 후보 성공 경로, 최초 공개 배포

### Community 216 - "2. 상태 모델 공통 원칙"
Cohesion: 0.33
Nodes (6): 2026-07-19 — 앱 0.2.1 기본 완주 화면·편집 시간표 출력, 검증, 다음 핵심 슬라이스, 단방향 초심자 흐름, 실제 클립 파일 방향, 편집에 쓸 수 있는 결과

### Community 217 - "README.md"
Cohesion: 0.33
Nodes (6): 2026-07-24 `0.5.0` 검토 화면 원점 재설계 — 물리적 태블릿, JSX 재구성 (이번엔 실제로 옮겼다), 검증, 무엇을 만들었나, 왜 다시 만들었나, 의도적 예외 하나 (공개)

### Community 218 - "2026-07-20 — 앱 0.3.3 배포와 0.3.4 오디오 반응 종류 AI 착수"
Cohesion: 0.40
Nodes (5): 2026-07-27 `0.8.3` 5인 AI 용량 조정 · 30초 전사 경로 확정, 기준선과 병합 범위, 무중단 배포와 검증, 실제 병목과 30초 계산, 최대 5개 독립 편집 세션의 공정한 공유

### Community 219 - "2026-07-20 — 앱 0.3.6 근거 기반 사건·반응 단서 착수"
Cohesion: 0.40
Nodes (5): 2026-07-27 `0.8.4` 맥락 502 복구 · 누락 구간 이어하기, 수정한 데이터 흐름, 실서비스 배포 검증, 실제 장애 원인, 회귀 기준

### Community 220 - "2026-07-20 — `0.3.11` 제품명 ExClipper 전환"
Cohesion: 0.40
Nodes (4): Context-aware highlight pipeline 재검토 및 구현 요청, ExClipper `0.3.34` 적용 판단, 별도 구조 개선으로 보류, 이번 패치에 수용

### Community 221 - "2026-07-23 — `0.3.43` 동적 사건 지도·안전한 검토창·모바일 후보 파이프라인"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: How do durable analysis records prevent raw chat and nickname leakage through arbitrary nested fields?, Source Nodes

### Community 222 - "2026-07-24 `0.4.5` 16:9 검토 서피스 · 위치 스트립 · 도시에 탭 (PART C+D+E)"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 현재의 하이라이트 검출은 무슨 기준을 사용하고 있지, Source Nodes

### Community 223 - "2026-07-24 `0.4.7` 결과·산출물 개선 (PART H-1~H-6)"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 스트리머 반응 중심 목표 대비 현재 하이라이트 검출 신호의 적합성, 오탐, 미탐, 다음 구조를 감사, Source Nodes

### Community 224 - "2026-07-24 `0.5.1` 검토 화면 실측 교정 — 브라우저로 보고 고침"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 근데 클립이란건 스트리머의 반응을 보는거지 화려한 연출을 보는게 아니야. 이게 맞는 접근인지 알려진 다른 사례들과 함께 확인해, Source Nodes

### Community 225 - "2026-07-27 `0.8.3` 5인 AI 용량 조정 · 30초 전사 경로 확정"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 0.3 오디오 반응부터 설명·저장·내보내기까지의 경로, Source Nodes

### Community 226 - "2026-07-27 `0.8.4` 맥락 502 복구 · 누락 구간 이어하기"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Candidate Pass B 구조가 App, Worker, provisional evidence, finalizing 완료 fence를 어떻게 연결하는가?, Source Nodes

### Community 227 - "ExClipper `0.3.34` 적용 판단"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Trace candidate array order consumers and design CandidateRankingProposal lifecycle, Source Nodes

### Community 228 - "Q: How do durable analysis records prevent raw chat and nickname leakage through arbitrary nested fields?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 0.3.5 후보 재정렬 제안은 canonical 후보, 정밀 근거, 검토·경계·미리보기·export를 어떻게 안전하게 분리해야 하는가?, Source Nodes

### Community 229 - "Q: 현재의 하이라이트 검출은 무슨 기준을 사용하고 있지"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Beginner UX audit for per-candidate event and reaction explanations including evidence lifecycle states., Source Nodes

### Community 230 - "Q: 스트리머 반응 중심 목표 대비 현재 하이라이트 검출 신호의 적합성, 오탐, 미탐, 다음 구조를 감사"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 현재 v0.3.6 미커밋 diff를 초심자 UI/UX, 접근성, 모바일, 과장 표현 관점에서 다시 읽기 전용 감사해 주세요. App.tsx, styles/retto-highlight.css, README와 새 설명 모듈을 보되 수정은 하지 말고 P0/P1/P2만 파일·라인 근거로 보고하세요. 이전 지적이 실제로 해결됐는지도 확인하세요., Source Nodes

### Community 231 - "Q: 근데 클립이란건 스트리머의 반응을 보는거지 화려한 연출을 보는게 아니야. 이게 맞는 접근인지 알려진 다른 사례들과 함께 확인해"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 현재 v0.3.6 미커밋 diff를 초심자 UI/UX, 접근성, 모바일, 과장 표현 관점에서 다시 읽기 전용 감사해 주세요. App.tsx, styles/retto-highlight.css, README와 새 설명 모듈을 보되 수정은 하지 말고 P0/P1/P2만 파일·라인 근거로 보고하세요. 이전 지적이 실제로 해결됐는지도 확인하세요., Source Nodes

### Community 232 - "Q: 0.3 오디오 반응부터 설명·저장·내보내기까지의 경로"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 후보별 사건·반응 설명을 어떤 근거 경계로 구현하고 UI에 연결해야 하나?, Source Nodes

### Community 233 - "Q: Candidate Pass B 구조가 App, Worker, provisional evidence, finalizing 완료 fence를 어떻게 연결하는가?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 현재 repo에서 local Whisper CandidatePassB 흐름을 Gemini API 기반 후보 오디오 전사/사건 설명으로 교체하거나 병행하는 최소 안전 수직 슬라이스, Source Nodes

### Community 234 - "Q: Trace candidate array order consumers and design CandidateRankingProposal lifecycle"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: How does App start Gemini candidate analysis and keep the response fenced from canonical editing state?, Source Nodes

### Community 235 - "Q: 0.3.5 후보 재정렬 제안은 canonical 후보, 정밀 근거, 검토·경계·미리보기·export를 어떻게 안전하게 분리해야 하는가?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 세팅하려면 이제 뭐가 필요하지, Source Nodes

### Community 236 - "Q: Beginner UX audit for per-candidate event and reaction explanations including evidence lifecycle states."
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Where should grounded VTuber participant identity be added without changing highlight ranking?, Source Nodes

### Community 237 - "Q: 현재 v0.3.6 미커밋 diff를 초심자 UI/UX, 접근성, 모바일, 과장 표현 관점에서 다시 읽기 전용 감사해 주세요. App.tsx, styles/retto-highlight.css, README와 새 설명 모듈을 보되 수정은 하지 말고 P0/P1/P2만 파일·라인 근거로 보고하세요. 이전 지적이 실제로 해결됐는지도 확인하세요."
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Where is the model routing policy disconnected from runtime, and which paths control provider fallback?, Source Nodes

### Community 238 - "Q: 현재 v0.3.6 미커밋 diff를 초심자 UI/UX, 접근성, 모바일, 과장 표현 관점에서 다시 읽기 전용 감사해 주세요. App.tsx, styles/retto-highlight.css, README와 새 설명 모듈을 보되 수정은 하지 말고 P0/P1/P2만 파일·라인 근거로 보고하세요. 이전 지적이 실제로 해결됐는지도 확인하세요."
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Audit candidate selection, context, music filtering, participant identity, transcript transport, and timeline architecture., Source Nodes

### Community 239 - "Q: 후보별 사건·반응 설명을 어떤 근거 경계로 구현하고 UI에 연결해야 하나?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: How does ExClipper select topic-balanced caption refinements and prevent routine gameplay from reaching canonical editor cards?, Source Nodes

### Community 240 - "Q: 현재 repo에서 local Whisper CandidatePassB 흐름을 Gemini API 기반 후보 오디오 전사/사건 설명으로 교체하거나 병행하는 최소 안전 수직 슬라이스"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: How should ExClipper distinguish semantic chapter and lead states on the restored timeline?, Source Nodes

### Community 241 - "Q: How does App start Gemini candidate analysis and keep the response fenced from canonical editing state?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Gemini 공용 키를 모든 필요한 모델 경로에 연결하고 교환학생 출연진을 전체 맥락 분석에 사용하는 방법은 무엇인가?, Source Nodes

### Community 242 - "Q: 세팅하려면 이제 뭐가 필요하지"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 그리고 모바일에서는 다중 검토가 안되고 한곳에서만 계속 이어서 분석해서 예전처럼 아주 느린데, 별다른 원인이 있나, Source Nodes

### Community 243 - "Q: Where should grounded VTuber participant identity be added without changing highlight ranking?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 현재 등장인물 파악 로직을 점검하고, 가능한지 말해줘. 반드시 등장인물 파악이 별도 로직으로 분리될 필요는 없지만, 맥락 파악에는 반드시 등장해야 해. 등장인물이 없으면 없다고 해야 하고, Source Nodes

### Community 244 - "Q: Where is the model routing policy disconnected from runtime, and which paths control provider fallback?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 현재 ExClipper UI를 Fable 0.4.1과 태블릿 샘플 기반의 물리 태블릿형 편집 콘솔로 재구성하려면 어떤 App·CSS·타임라인 구조를 함께 수정해야 하는가?, Source Nodes

### Community 245 - "Q: Audit candidate selection, context, music filtering, participant identity, transcript transport, and timeline architecture."
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 5명 정도까지만 동시에 쓸 수 있는 ExClipper 환경을 어떻게 구성해야 하는가, Source Nodes

### Community 246 - "Q: How does ExClipper select topic-balanced caption refinements and prevent routine gameplay from reaching canonical editor cards?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Inspect aiProxy.worker.ts request-body readers and quota lease lifecycle; propose the smallest correct ingress timeout and upload-ticket cancellation design., Source Nodes

### Community 247 - "Q: How should ExClipper distinguish semantic chapter and lead states on the restored timeline?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 최대 5명의 ExClipper 사용자가 공유 AI credential을 오류 없이 빠르게 쓰도록 어떤 quota와 전송 구조가 필요한가?, Source Nodes

### Community 248 - "Q: Gemini 공용 키를 모든 필요한 모델 경로에 연결하고 교환학생 출연진을 전체 맥락 분석에 사용하는 방법은 무엇인가?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 오류가 정확히 8개 뜨고 다시 진행됐는데, 이거 나중에 재시도로 메꿔지는지 확인, Source Nodes

### Community 249 - "Q: 그리고 모바일에서는 다중 검토가 안되고 한곳에서만 계속 이어서 분석해서 예전처럼 아주 느린데, 별다른 원인이 있나"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 탐색 구간 CORS 뒤 broadcast-context 502와 ai-quota 409가 발생하고 최종 후보 0개로 끝나는 이유와 복구 방법, Source Nodes

### Community 250 - "Q: 현재 등장인물 파악 로직을 점검하고, 가능한지 말해줘. 반드시 등장인물 파악이 별도 로직으로 분리될 필요는 없지만, 맥락 파악에는 반드시 등장해야 해. 등장인물이 없으면 없다고 해야 하고"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Implement focused free-r2 Worker integration tests without changing production files., Source Nodes

### Community 251 - "Q: 현재 ExClipper UI를 Fable 0.4.1과 태블릿 샘플 기반의 물리 태블릿형 편집 콘솔로 재구성하려면 어떤 App·CSS·타임라인 구조를 함께 수정해야 하는가?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 무료 유지하는 한도로 최적화를 하자. 하지만 과금하게 되면 바로 전환할 수 있도록 구조만 내부에 만들어 두자, Source Nodes

### Community 252 - "Q: 5명 정도까지만 동시에 쓸 수 있는 ExClipper 환경을 어떻게 구성해야 하는가"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Audit candidate ID/version/context fingerprint joins across fast and semantic candidates, context annotations, Pass B receipts, and restore: how can 12 topics/31 leads plus 5 context-not-ready and 8 Pass B incomplete yield zero without a context API error?, Source Nodes

### Community 253 - "Q: Inspect aiProxy.worker.ts request-body readers and quota lease lifecycle; propose the smallest correct ingress timeout and upload-ticket cancellation design."
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 끝까지 마치지 못했다는 게 무슨 뜻이며, 맥락 분석 성공 후 최종 후보 0개가 된 이유는 무엇인가?, Source Nodes

### Community 254 - "Q: 최대 5명의 ExClipper 사용자가 공유 AI credential을 오류 없이 빠르게 쓰도록 어떤 quota와 전송 구조가 필요한가?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 파이프라인 분석해서 이걸 정상화하자, Source Nodes

### Community 255 - "Q: 오류가 정확히 8개 뜨고 다시 진행됐는데, 이거 나중에 재시도로 메꿔지는지 확인"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: How does ExClipper guarantee bounded context and durable candidate completion?, Source Nodes

### Community 256 - "Q: 탐색 구간 CORS 뒤 broadcast-context 502와 ai-quota 409가 발생하고 최종 후보 0개로 끝나는 이유와 복구 방법"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 1) groq에서 whisper v3을 무료 제공하는데, 지금 qwen3-asr/qwen3.5 omni flash 와 비교해보자. 뭐가 가장 합리적인지, Source Nodes

### Community 257 - "Q: Implement focused free-r2 Worker integration tests without changing production files."
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 어떻게 구현할지 한번 정리하자, Source Nodes

### Community 258 - "Q: 무료 유지하는 한도로 최적화를 하자. 하지만 과금하게 되면 바로 전환할 수 있도록 구조만 내부에 만들어 두자"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 이건 별도로 검토한 건데, 한번 비교해보자, Source Nodes

### Community 259 - "Q: Audit candidate ID/version/context fingerprint joins across fast and semantic candidates, context annotations, Pass B receipts, and restore: how can 12 topics/31 leads plus 5 context-not-ready and 8 Pass B incomplete yield zero without a context API error?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: qwen asr과 qwen omni의 차이와 현재 ExClipper에서 어느 쪽이 실제 사용되는가, Source Nodes

### Community 260 - "Q: 끝까지 마치지 못했다는 게 무슨 뜻이며, 맥락 분석 성공 후 최종 후보 0개가 된 이유는 무엇인가?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: ExClipper에서 Qwen3-ASR과 Qwen3.5-Omni-Flash의 차이는 무엇이며 어느 단계에 써야 하는가?, Source Nodes

### Community 261 - "12. 결과 내보내기"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 현재 그러면 인물 파악은 어느 시점에 되는거지? 영상이나 목소리를 기반으로 인물을 파악해야 하는데, 일단 6명이잖아, Source Nodes

### Community 262 - "21. 공식 근거와 기술 참고"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Design the smallest sound participant-grounding schema for ExClipper: six-person global catalog, source-specific priors, conservative evidence, sealed pre-context grounding, and future visual/voice adapters., Source Nodes

### Community 263 - "analysisControlState.ts"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: How should a participant grounding packet and timeline be persisted backward-compatibly across broadcast context sessions?, Source Nodes

### Community 264 - "13. MigrationRun 생애주기"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: How was ExClipper's pre-context six-person participant grounding pipeline refined?, Source Nodes

### Community 265 - "15. ExportJob 생애주기"
Cohesion: 0.40
Nodes (5): 12.1 기본 묶음, 12.2 CSV 열, 12.3 YouTube 챕터, 12.4 후속 편집기 형식, 12. 결과 내보내기

### Community 266 - "17. 다중 탭 단일 writer"
Cohesion: 0.40
Nodes (5): 21. 공식 근거와 기술 참고, AI·평가, 미디어 엔진, 정적 호스팅·브라우저, 플랫폼

### Community 267 - "3. 식별자, 실행 fence, 이벤트 봉투"
Cohesion: 0.60
Nodes (3): buildSourceReadyTimelineTicks(), labelStrideForDuration(), SourceReadyTimelineTick

### Community 268 - "2026-07-20 — 앱 0.3.5 설명 가능한 검토 우선순위 제안 착수"
Cohesion: 0.50
Nodes (4): 2026-07-23 `0.4.0` 전사 바이너리 전송과 중계 바이트 조립, After / 구현, Before / 원인, 검증

### Community 269 - "2026-07-20 — 앱 0.3.9 기본 배포 키와 Gemini 한국어 성공 경로"
Cohesion: 0.40
Nodes (5): 13.1 상태, 13.2 전이표, 13.3 migration 규칙, 13.4 migration 검증 항목, 13. MigrationRun 생애주기

### Community 270 - "2026-07-21 — `0.3.24` 후보 회귀 조사: 오프닝 음악 제거와 채팅 단독 후보 복원"
Cohesion: 0.40
Nodes (5): 15.1 상태와 전이, 15.2 snapshot과 동시 편집, 15.3 export 완료 의미, 15.4 export 불변식, 15. ExportJob 생애주기

### Community 271 - "2026-07-21 — `0.3.26` 편집자 중심 후보 검토 UI"
Cohesion: 0.40
Nodes (5): 17.1 기본 구조, 17.2 쓰기 권한 넘기기, 17.3 Web Locks 미지원 폴백, 17.4 다중 탭 불변식, 17. 다중 탭 단일 writer

### Community 272 - "2026-07-23 `0.4.0` 전사 바이너리 전송과 중계 바이트 조립"
Cohesion: 0.40
Nodes (5): 3.1 식별자 규칙, 3.2 이벤트 수락 순서, 3.3 원자적 checkpoint, 3.4 입력 서명, 3. 식별자, 실행 fence, 이벤트 봉투

### Community 273 - "2026-07-24 `0.4.2` 병렬 전사 프리페치와 태블릿 스킨 1차"
Cohesion: 0.50
Nodes (4): `0.3.5` 구현 결과, `0.3.5` 배포 전 검증, 2026-07-20 — 앱 0.3.5 설명 가능한 검토 우선순위 제안 착수, 구현 전 계약

### Community 274 - "2026-07-24 `0.4.4` 동시 진행 트랙 (PART F)"
Cohesion: 0.50
Nodes (4): 2026-07-20 — 앱 0.3.9 기본 배포 키와 Gemini 한국어 성공 경로, 구현과 운영 경계, 배포 전 검사, 실제 한국어 성공 검증

### Community 275 - "2026-07-24 `0.4.6` 좌측 아이콘 레일 · 시작 화면 명세 패널 (PART B+G)"
Cohesion: 0.50
Nodes (3): Answer, Outcome, Q: Should v0.3.6 add a Korean text generator or deterministic evidence explanation?

### Community 276 - "2026-07-24 `0.4.8` 검증 전 빠른 후보 공개 (PART H-4' + PART F 배너)"
Cohesion: 0.50
Nodes (3): Answer, Outcome, Q: How should ExClipper v0.8.3 safely deploy a shared AI quota coordinator for at most five trusted editor sessions without regressing the v0.8.2 transcript path?

### Community 277 - "2026-07-24 `0.5.2` 기기 치수 고정 — 16:10 · 여백 10%"
Cohesion: 0.50
Nodes (3): Answer, Outcome, Q: 파이프라인 분석해서 이걸 정상화하자

### Community 278 - "2026-07-27 다음 배포 후보 · 최종 후보 파이프라인 정상화"
Cohesion: 0.50
Nodes (4): 3.1 무엇이 원본인가, 3.2 백업 방식, 3.3 백업 권유 시점, 3. 진실 공급원과 백업 계층

### Community 279 - "Q: Should v0.3.6 add a Korean text generator or deterministic evidence explanation?"
Cohesion: 0.50
Nodes (4): 7.1 배포 전, 7.2 배포, 7.3 배포 후 smoke test, 7. 배포 절차

### Community 280 - "Q: How should ExClipper v0.8.3 safely deploy a shared AI quota coordinator for at most five trusted editor sessions without regressing the v0.8.2 transcript path?"
Cohesion: 0.50
Nodes (4): `0.3.26` 편집자 중심 작업공간, 2026-07-21 implementation update, Qwen Omni planning estimate, YouTube script boundary

### Community 281 - "3. 진실 공급원과 백업 계층"
Cohesion: 0.50
Nodes (4): 0. 먼저 합의해야 할 결론, 절대 약속하지 않을 것, 조건부로 제공할 결과, 항상 보장할 결과

### Community 282 - "7. 배포 절차"
Cohesion: 0.50
Nodes (4): 2.1 사용자의 진짜 목표, 2.2 첫 공개판의 성공 문장, 2.3 측정할 성공 기준, 2. 제품 목표와 성공 조건

### Community 283 - "2026-07-21 implementation update"
Cohesion: 0.50
Nodes (4): 7.1 기본 단축키, 7.2 접근성 기준, 7.3 StreamSaver를 기준으로 한 UI 디자인 시스템, 7. 키보드·접근성·반응형

### Community 284 - "0. 먼저 합의해야 할 결론"
Cohesion: 0.83
Nodes (3): addCollectiveSpike(), message(), quietBaseline()

### Community 286 - "7. 키보드·접근성·반응형"
Cohesion: 0.50
Nodes (4): 2026-07-24 `0.4.4` 동시 진행 트랙 (PART F), After / 구현, Before / 원인, 검증

### Community 287 - "broadcastTranscriptChapters.ts"
Cohesion: 0.50
Nodes (4): 2026-07-24 `0.4.6` 좌측 아이콘 레일 · 시작 화면 명세 패널 (PART B+G), After / 구현, Before / 원인, 검증

### Community 288 - "11. RangeCapture 생애주기"
Cohesion: 0.50
Nodes (4): 11.1 상태, 11.2 전이표, 11.3 불변식, 11. RangeCapture 생애주기

### Community 289 - "16. AppSession 생애주기"
Cohesion: 0.50
Nodes (4): 16.1 상태, 16.2 전이표, 16.3 visibility와 네트워크, 16. AppSession 생애주기

### Community 290 - "5. Project, SourceDefinition, SourceBinding"
Cohesion: 0.50
Nodes (4): 5.1 Project 생애주기, 5.2 SourceDefinition, 5.3 SourceBinding, 5. Project, SourceDefinition, SourceBinding

### Community 291 - "2026-07-20 — 0.3.10 후보별 미리보기·클립 파일 다운로드"
Cohesion: 0.50
Nodes (4): 2026-07-21 — `0.3.24` 후보 회귀 조사: 오프닝 음악 제거와 채팅 단독 후보 복원, 검증, 변경 계약, 재현한 원인

### Community 292 - "2026-07-21 — `0.3.25` AI provider와 방송 전체 맥락 준비 구조"
Cohesion: 0.50
Nodes (4): 2026-07-21 — `0.3.26` 편집자 중심 후보 검토 UI, 검증, 문제와 우선순위 재정의, 상태·호환성 경계

### Community 293 - "2026-07-27 `0.8.6` Free R2 전사 transport 착수"
Cohesion: 0.50
Nodes (4): 2026-07-24 `0.4.2` 병렬 전사 프리페치와 태블릿 스킨 1차, 검증, 병렬 실행, 태블릿 스킨 1차 (`styles/exclipper-app.css`)

### Community 294 - "2026-07-27 파이프라인 정상화 후보 · 최종 검증"
Cohesion: 0.50
Nodes (4): 2026-07-24 `0.5.2` 기기 치수 고정 — 16:10 · 여백 10%, 검증, 문제, 해결

### Community 295 - "10. 로컬 관측과 진단"
Cohesion: 0.67
Nodes (3): 2026-07-27 `0.8.6` Free R2 전사 transport 착수, 구현·회귀 검증, 무료 자원과 실서비스 검증

### Community 296 - "4. 단일 사용자 안의 동시성: 여러 탭"
Cohesion: 0.67
Nodes (3): 10.1 앱 안 상태 카드, 10.2 구조화 진단 이벤트, 10. 로컬 관측과 진단

### Community 297 - "5. 환경 설정과 비밀정보"
Cohesion: 0.67
Nodes (3): 4.1 기본 정책, 4.2 충돌 방어, 4. 단일 사용자 안의 동시성: 여러 탭

### Community 298 - "8. 롤백과 호환성"
Cohesion: 0.67
Nodes (3): 5.1 환경, 5.2 비밀정보 금지, 5. 환경 설정과 비밀정보

### Community 299 - "9. 저장 공간·대역폭·보존 상한"
Cohesion: 0.67
Nodes (3): 8.1 코드 롤백, 8.2 데이터 롤백, 8. 롤백과 호환성

### Community 300 - "1. 입력별 현실적인 지원 범위"
Cohesion: 0.67
Nodes (3): 9.1 경고 단계, 9.2 기본 보존 정책, 9. 저장 공간·대역폭·보존 상한

### Community 301 - "20. 새로고침·중단 복구 절차"
Cohesion: 0.67
Nodes (3): 1.1 YouTube의 2026년 변경, 1.2 CHZZK의 공식 범위, 1. 입력별 현실적인 지원 범위

### Community 302 - "6. SourceCheck 생애주기"
Cohesion: 0.50
Nodes (4): 2026-07-24 `0.4.8` 검증 전 빠른 후보 공개 (PART H-4' + PART F 배너), After / 구현, Before / 원인, 검증

### Community 303 - "8. ModelArtifact와 ModelDownload 생애주기"
Cohesion: 0.67
Nodes (3): 20.1 persisted 상태별 복구, 20.2 복구 화면 우선순위, 20. 새로고침·중단 복구 절차

### Community 304 - "README.md"
Cohesion: 0.67
Nodes (3): 6.1 상태, 6.2 전이표, 6. SourceCheck 생애주기

### Community 305 - "DESIGN_RULES.md"
Cohesion: 0.67
Nodes (3): 8.1 ModelArtifact 보조 상태, 8.2 ModelDownload 상태와 전이, 8. ModelArtifact와 ModelDownload 생애주기

### Community 314 - "CandidateAudioEventCandidateGapReason"
Cohesion: 0.50
Nodes (4): 2026-07-27 다음 배포 후보 · 최종 후보 파이프라인 정상화, Free Worker 후보 미디어 경로, 수정한 데이터 계약, 확인한 원인

### Community 320 - "2026-07-29 개발자 전용 6인 음성 enrollment 후보 추출 도구"
Cohesion: 0.50
Nodes (4): 2026-07-29 개발자 전용 6인 음성 enrollment 후보 추출 도구, bounded HLS·ffmpeg 처리, sample·실측·검증, 상태·안전 경계

### Community 322 - "2026-07-29 맥락 전 6인 등장인물 grounding 계획·완료 gate"
Cohesion: 0.50
Nodes (4): 2026-07-29 맥락 전 6인 등장인물 grounding 계획·완료 gate, 검증, 실제 순서와 순환 제거, 참조 자료와 재사용 경계

### Community 323 - "2026-07-29 화자 임베딩 실행부·18개 표본 교차검증"
Cohesion: 0.50
Nodes (4): 2026-07-29 화자 임베딩 실행부·18개 표본 교차검증, Groq secret 상태, 실행부, 표본 추출·실측

### Community 326 - "broadcastContextCandidateCohort.ts"
Cohesion: 0.35
Nodes (9): parseBroadcastContextProxyResult(), boundedUniqueCandidateIds(), isRecord(), legacyCandidateIds(), parsePersistedBroadcastContextResult(), PersistedBroadcastContextEnvelope, input, storedResult (+1 more)

### Community 331 - "2026-07-21 — `0.3.25` AI provider와 방송 전체 맥락 준비 구조"
Cohesion: 0.67
Nodes (3): 2026-07-21 — `0.3.25` AI provider와 방송 전체 맥락 준비 구조, 검증, 구현

### Community 332 - "2026-07-27 파이프라인 정상화 후보 · 최종 검증"
Cohesion: 0.09
Nodes (12): AI_QUOTA_LEASE_HEADER, AI_QUOTA_OPERATION_HEADER, AI_QUOTA_PARTICIPANT_HEADER, AI_QUOTA_PAYLOAD_DIGEST_HEADER, AI_QUOTA_RUN_HEADER, AI_QUOTA_SCHEMA_VERSION, CoordinatorRequest, createCoordinator() (+4 more)

### Community 333 - "2026-07-29 Groq Whisper Large V3 Turbo 선택형 전사 경로 준비"
Cohesion: 0.67
Nodes (3): 2026-07-29 Groq Whisper Large V3 Turbo 선택형 전사 경로 준비, 검증과 남은 release gate, 구현

### Community 334 - "2026-07-29 자막 없는 의미 refinement 전사 per-fragment checkpoint"
Cohesion: 0.67
Nodes (3): 2026-07-29 자막 없는 의미 refinement 전사 per-fragment checkpoint, 검증, 저장 계약과 복구 경계

### Community 337 - "extractBroadcastTranscriptGroqResponse"
Cohesion: 0.14
Nodes (23): ShortcutHelpOverlay(), ShortcutHelpOverlayProps, applyCandidateBoundaryCommand(), BoundaryCommandBase, CandidateBoundaryAdjustmentReason, CandidateBoundaryCommand, CandidateBoundaryIgnoreReason, CandidateBoundaryProposalInput (+15 more)

### Community 338 - "candidatePassBCost.ts"
Cohesion: 0.29
Nodes (7): ANALYSIS_BUDGET_POLICY_VERSION, AnalysisBudgetEnvelope, createAnalysisBudgetEnvelope(), CandidatePassBCostEstimate, clampInteger(), estimateCandidatePassBCost(), formatEstimatedUsd()

### Community 339 - "CandidatePassBWorkerFailureReason"
Cohesion: 0.47
Nodes (4): ProxyWorkerFailure, CandidatePassBProxyHttpFailure, CandidatePassBWorkerError, CandidatePassBWorkerFailureReason

### Community 340 - "2026-07-20 — 0.3.10 후보별 미리보기·클립 파일 다운로드"
Cohesion: 0.67
Nodes (3): 2026-07-20 — 0.3.10 후보별 미리보기·클립 파일 다운로드, 검증, 구현 내용

### Community 341 - "UnifiedHighlightCandidate"
Cohesion: 0.10
Nodes (20): boundedText(), buildFastPassCandidates(), captionTextForRange(), chapters, discoverySlices, fastPass, fastRefinementLeadIdSet, juryPlan (+12 more)

### Community 342 - "durableBroadcastContextPipeline.test.ts"
Cohesion: 0.18
Nodes (5): ControlledOpenRequest, ControlledRequest, ControlledTransaction, fakeEvent(), FakeIndexedDbHarness

### Community 343 - "gen-forms.mjs"
Cohesion: 0.26
Nodes (16): BroadcastContextRequest, BroadcastContextRequestInput, BroadcastParticipantGrounding, CandidateFinalVerificationInput, CandidateInsightMediaResolveRequest, CandidatePassBProxyRequestBody, NormalizedRunInput, CandidatePassBContextPacket (+8 more)

### Community 344 - "broadcastContextExploration.ts"
Cohesion: 0.16
Nodes (14): BroadcastParticipantAdapterUnavailableReason, BroadcastParticipantGroundingPerson, BroadcastParticipantMediaAdapter, BroadcastParticipantGroundingAdapterCompletionReceipt, BroadcastParticipantGroundingEnabledAdapterPlan, BroadcastParticipantGroundingUnavailableAdapterPlan, BroadcastParticipantGroundingVisualPlanInput, BroadcastParticipantGroundingVoicePlanInput (+6 more)

### Community 345 - "analysisControlState.ts"
Cohesion: 0.22
Nodes (8): SelectableCandidate, approximateErf(), calculateTemporalEventDensity(), clampProbability(), poissonUpperTail(), TemporalEventDensityBin, TemporalEventDensityDiagnostics, TemporalEventDensityResult

### Community 346 - "PcmRangeBuilder"
Cohesion: 0.26
Nodes (11): canStartTranscriptRun(), createTranscriptSourceIdentityFence(), transcriptContextReadiness, TranscriptContextSealInput, transcriptGapRequiresExplicitBillingRetry(), transcriptIsSealedForContext(), transcriptNeedsExplicitRetry(), transcriptOperationKey() (+3 more)

### Community 347 - "finalVerificationGapSummary.ts"
Cohesion: 0.23
Nodes (11): byId, demo(), here, METRICS, NON_STREAMER_SUBTITLE, palettes, row(), subtitleOf() (+3 more)

### Community 348 - "BroadcastTranscriptResolvedEvidenceReason"
Cohesion: 0.29
Nodes (9): CANDIDATE_PASS_B_VERIFICATION_RECEIPT_SCHEMA_VERSION, candidatePassBInsightSnapshotsExactlyMatch(), CandidatePassBInsightStorePort, cloneCandidatePassBInsightsRecord(), persistCandidatePassBInsightsWithReadback(), evidence, getCandidatePassBInsights(), record (+1 more)

### Community 349 - "gen-palettes.mjs"
Cohesion: 0.31
Nodes (9): boundedText(), createSemanticLeadCandidate(), isRecord(), parseSemanticLeadCandidates(), SEMANTIC_CATEGORIES, SEMANTIC_LEAD_CANDIDATE_RECORD_VERSION, SemanticLeadCandidateRecord, semanticLeadPairFingerprint() (+1 more)

### Community 350 - "AnalysisProgressPanel.tsx"
Cohesion: 0.31
Nodes (7): AnalysisControlState, AnalysisControlStateInput, AnalysisRunStatus, BUSY_RUN_STATUSES, CANCELLABLE_RUN_STATUSES, deriveAnalysisControlState(), AnalysisRunState

### Community 351 - "typescript-eslint"
Cohesion: 0.22
Nodes (7): DEFAULT_PORTRAIT_CROP, PORTRAIT_CROP_BY_NAME, PortraitCrop, PROFILE_FILE_BY_NAME, STREAMER_PROFILE_IMAGE_BY_NAME, streamerPortraitFocus(), SUBTITLE_BY_NAME

### Community 352 - "QuotaOutcomeUnknownError"
Cohesion: 0.29
Nodes (5): AudioHighlightCandidate, chatCandidate(), chatEvidence(), TestVisualEvidence, VisualHighlightCandidate

### Community 353 - "RequestBodyTimeoutError"
Cohesion: 0.32
Nodes (7): highlightReasonForSignalKinds(), createDurableSourceDescriptor(), hydrateDurableCandidate(), toDurableCandidate(), LocalMediaPreflightResult, classifyDurableMediaContainer(), DurableHighlightCandidate

### Community 356 - "2026-07-29 v0.8.8 파이프라인 내구성 릴리스"
Cohesion: 0.67
Nodes (3): 2026-07-29 v0.8.8 파이프라인 내구성 릴리스, 릴리스 범위, 배포 게이트

## Knowledge Gaps
- **1787 isolated node(s):** `here`, `root`, `PROFILES`, `MIME`, `GENERATORS` (+1782 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Work-memory lessons

**Preferred sources** — corroborated by past sessions; start here.
- `App()` (22× useful, score=19.060359489) _(code changed — re-verify)_
- `runCandidatePassBWorker()` (9× useful, score=8.185559804)
- `aiProxy.worker.ts` (7× useful, score=6.677756793)
- `participantRoster.ts` (6× useful, score=5.693917554)
- `aiQuotaPolicy.ts` (5× useful, score=4.865692509)
- `broadcastContextSessionStore.ts` (4× useful, score=3.842528369) _(code changed — re-verify)_
- `handleBroadcastTranscriptRequest()` (4× useful, score=3.835296115)
- `broadcastContextProtocol.ts` (4× useful, score=3.712626415)
- `reduceCandidatePassBRun()` (4× useful, score=3.551707784)
- `fuseHighlightCandidates()` (4× useful, score=3.217422385)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `App()` connect `Q: Gemini 공용 키를 모든 필요한 모델 경로에 연결하고 교환학생 출연진을 전체 맥락 분석에 사용하는 방법은 무엇인가?` to `broadcastTranscript.worker.ts`, `App.tsx`, `candidateAudioEvent.worker.ts`, `candidateAudioEventRun.ts`, `candidatePassBRun.ts`, `candidateAudioEventWorkerClient.ts`, `candidateAudioEvent.ts`, `candidatePassBGemini.ts`, `candidatePassB.worker.ts`, `analysisRun.ts`, `contextAwareCandidateSelection.ts`, `localFileFingerprint.ts`, `chatImport.ts`, `localAudioReactionAnalysisCore.ts`, `participantRoster.ts`, `rejectedOperation`, `broadcastContextSamplingPlan.ts`, `candidatePassBPresentation.ts`, `audioReactionAnalysis.worker.ts`, `localMediaPreflight.ts`, `localVideoVisualAnalysisCore.ts`, `AnalysisRun State Machine`, `로컬 데이터·비밀정보 보안 경계`, `localAudioReactionAnalysis.test.ts`, `highlightSelector.ts`, `evaluate-local-audio-fast-pass.mjs`, `candidateVideoFrames.ts`, `candidateMerge.ts`, `analyzeLocalAudioReactions`, `loadVideoMetadata`, `broadcastContextTimelinePresentation.ts`, `FakeWorker`, `eventFence.ts`, `evaluate-caption-selection.mjs`, `RunCandidatePassBWorkerOptions`, `evaluate-caption-refinement.mjs`, `contextQualifiedFinalSelection.ts`, `localMediaPreflight.test.ts`, `evaluate-caption-context.mjs`, `candidateReviewFeatureAvailability.ts`, `dependencies`, `smoke-gemini-proxy.mjs`, `broadcastSelectionProtocol.ts`, `candidatePassBRuntime.ts`, `inspect-youtube-caption-json3.mjs`, `AnalysisLanguage`, `CandidatePassBWorkerFailureReason`, `sampleEvaluationContract.ts`, `Q: 현재의 하이라이트 검출은 무슨 기준을 사용하고 있지`, `Q: 스트리머 반응 중심 목표 대비 현재 하이라이트 검출 신호의 적합성, 오탐, 미탐, 다음 구조를 감사`, `Q: 0.3 오디오 반응부터 설명·저장·내보내기까지의 경로`, `Q: 0.3.5 후보 재정렬 제안은 canonical 후보, 정밀 근거, 검토·경계·미리보기·export를 어떻게 안전하게 분리해야 하는가?`, `Q: 현재 repo에서 local Whisper CandidatePassB 흐름을 Gemini API 기반 후보 오디오 전사/사건 설명으로 교체하거나 병행하는 최소 안전 수직 슬라이스`, `Q: How does App start Gemini candidate analysis and keep the response fenced from canonical editing state?`, `Q: Audit candidate selection, context, music filtering, participant identity, transcript transport, and timeline architecture.`, `sourceReadyTimelinePresentation.ts`, `Q: Should v0.3.6 add a Korean text generator or deterministic evidence explanation?`, `highlightSelector.test.ts`, `candidateAudioEventEvidenceState.ts`, `analysisBudgetPolicy.ts`, `QWEN_CANDIDATE_MODEL_ID`, `CandidatePassBEvidence`, `2026-07-28 다음 배포 후보 · 6인 등장인물 근거와 맥락 commit 봉인`, `Q: 1) groq에서 whisper v3을 무료 제공하는데, 지금 qwen3-asr/qwen3.5 omni flash 와 비교해보자. 뭐가 가장 합리적인지`, `eslint.config.js`, `vite.config.ts`, `11. 장애 대응 runbook`, `9. AnalysisJob, AnalysisSpec, AnalysisRun 생애주기`, `3. 식별자, 실행 fence, 이벤트 봉투`, `2. 제품 목표와 성공 조건`, `broadcastContextCandidateCohort.ts`, `extractBroadcastTranscriptGroqResponse`, `candidatePassBCost.ts`, `analysisControlState.ts`, `PcmRangeBuilder`, `BroadcastTranscriptResolvedEvidenceReason`, `gen-palettes.mjs`, `AnalysisProgressPanel.tsx`, `RequestBodyTimeoutError`, `boundedAsyncMap.ts`, `broadcastContextCandidateCohort.ts`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `createContentFingerprint()` connect `audioReactionAnalysis.worker.ts` to `localVideoVisualAnalysis.test.ts`, `broadcastContextTimelinePresentation.ts`, `candidateEvidenceExplanation.ts`, `candidatePassBPresentation.ts`, `PcmRangeBuilder`, `localAudioReactionAnalysis.test.ts`, `candidateReviewFeatureAvailability.ts`, `broadcastSelectionProtocol.ts`, `candidatePassBRuntime.ts`, `candidatePassB.worker.ts`, `Q: Gemini 공용 키를 모든 필요한 모델 경로에 연결하고 교환학생 출연진을 전체 맥락 분석에 사용하는 방법은 무엇인가?`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `asset()` connect `aiProviderConfiguration.ts` to `candidatePassBWorkerClient.test.ts`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Are the 11 inferred relationships involving `App()` (e.g. with `cell()` and `event()`) actually correct?**
  _`App()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **What connects `here`, `root`, `PROFILES` to the rest of the system?**
  _1787 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `highlightFusion.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.04035542391706775 - nodes in this community are weakly interconnected._
- **Should `highlightExport.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05189873417721519 - nodes in this community are weakly interconnected._