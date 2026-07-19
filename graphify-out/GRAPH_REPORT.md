# Graph Report - workspace  (2026-07-20)

## Corpus Check
- 105 files · ~152,758 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1808 nodes · 3919 edges · 87 communities (75 shown, 12 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 65 edges (avg confidence: 0.61)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `de7d32ac`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- 운영·릴리스 안전성
- 개인용 Pages 제품 경계
- 멀티모달 AI 분석
- CHZZK 채팅·정적 제약
- 원본·출력 어댑터
- 입력·모델 스냅샷
- 분석 실행·종료 계약
- AI 후보·사람 검토
- 이벤트 식별·펜싱
- 초심자 UI·스타일
- 후보 수정·안전 경계
- 저장·복구 커밋
- candidateMerge.ts
- eventFence.ts
- Retto Highlight
- tsconfig.json
- localVideoVisualAnalysis.ts
- loadVideoMetadata
- analyzeLocalVideoVisuals
- fakeEvent
- localVideoVisualAnalysis.test.ts
- FakeVideoProbe
- inspectLocalMedia
- FakeVideoProbe
- localMediaPreflight.test.ts
- cleanupResources
- LocalMediaPreflightAdapters
- createContentFingerprint
- highlightSelector.ts
- AnalysisResultStore
- durableAnalysisPayload.ts
- App.tsx
- sourceCheck.ts
- chatAnalysisWorkerClient.ts
- runChatAnalysisWorker
- chatAnalysisWorkerProtocol.ts
- InMemoryAnalysisResultStore
- FakeWorker
- Q: How do durable analysis records prevent raw chat and nickname leakage through arbitrary nested fields?
- highlightSelector.test.ts
- IndexedDbAnalysisResultStore
- localAudioReactionAnalysis.ts
- sourceCheck.ts
- audioReactionAnalysis.worker.ts
- AudioFeatureAccumulator
- analyzeLocalAudioReactions
- HighlightSelectionResult
- highlightNarrative.ts
- scripts
- highlightExport.test.ts
- inspectLocalMedia
- dependencies
- package.json
- Q: 현재의 하이라이트 검출은 무슨 기준을 사용하고 있지
- Q: 스트리머 반응 중심 목표 대비 현재 하이라이트 검출 신호의 적합성, 오탐, 미탐, 다음 구조를 감사
- Q: 근데 클립이란건 스트리머의 반응을 보는거지 화려한 연출을 보는게 아니야. 이게 맞는 접근인지 알려진 다른 사례들과 함께 확인해
- EventFenceRejectionReason
- eslint-plugin-react-hooks
- eslint-plugin-react-refresh
- @types/react
- typescript
- @vitejs/plugin-react
- vitest
- localMediaPreflight.test.ts
- LocalMediaPreflightAdapters
- AudioReactionWorkerIdentity
- candidatePassBRuntime.ts
- appendHiddenElement
- candidatePassBAudioGate.ts
- CandidatePassBCandidateGapReason
- @types/node
- typescript-eslint
- vite
- Q: Candidate Pass B 구조가 App, Worker, provisional evidence, finalizing 완료 fence를 어떻게 연결하는가?
- appendHiddenElement
- @eslint/js
- candidateAudioEventWorkerClient.ts
- candidateAudioEventEvidenceState.test.ts
- highlightNarrative.ts
- fakeEvent
- createReactionUnifiedCandidate
- MAX_CANDIDATE_AUDIO_EVENT_CANDIDATES
- Q: Trace candidate array order consumers and design CandidateRankingProposal lifecycle

## God Nodes (most connected - your core abstractions)
1. `App()` - 76 edges
2. `analyzeLocalVideoVisuals()` - 24 edges
3. `IndexedDbAnalysisResultStore` - 23 edges
4. `invalid()` - 23 edges
5. `compilerOptions` - 23 edges
6. `runCandidateAudioEventWorker()` - 20 edges
7. `runCandidatePassBWorker()` - 19 edges
8. `fuseReactionHighlightCandidates()` - 19 edges
9. `inspectLocalMedia()` - 18 edges
10. `InMemoryAnalysisResultStore` - 18 edges

## Surprising Connections (you probably didn't know these)
- `불변 StreamSaver CSS 기준과 Retto 오버라이드` --conceptually_related_to--> `개인용 제품 production 출시 기준`  [INFERRED]
  AGENTS.md → OPERATIONS.md
- `0.3.0 문서 정합성과 미커밋 기록` --conceptually_related_to--> `개인용 제품 production 출시 기준`  [INFERRED]
  DEVELOPMENT_LOG.md → OPERATIONS.md
- `수동 우선 폐기와 AI-first 전환 결정` --rationale_for--> `1인용 로컬 우선 AI 편집 어시스턴트`  [EXTRACTED]
  DEVELOPMENT_LOG.md → AGENTS.md
- `원격 텔레메트리 없는 비식별 로컬 진단` --implements--> `로컬 데이터·비밀정보 보안 경계`  [EXTRACTED]
  OPERATIONS.md → AGENTS.md
- `저장 공간·캐시·보존 상한` --implements--> `로컬 데이터·비밀정보 보안 경계`  [EXTRACTED]
  OPERATIONS.md → AGENTS.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **계층형 AI 하이라이트 분석 파이프라인** — product_plan_analysis_orchestrator, product_plan_fast_pass, product_plan_candidate_recall, product_plan_deep_pass, product_plan_multimodal_fusion, product_plan_boundary_refinement, product_plan_candidate_diversity [EXTRACTED 1.00]

## Communities (87 total, 12 thin omitted)

### Community 0 - "운영·릴리스 안전성"
Cohesion: 0.14
Nodes (24): 초심자 중심 단방향 UI·UX, 상태·생애주기 우선 설계 계약, 계정·공유·공용 백엔드·클라우드 AI 제외, GitHub Pages 서버 없는 핵심 완주, 불변 StreamSaver CSS 기준과 Retto 오버라이드, 로컬 데이터·비밀정보 보안 경계, 1인용 로컬 우선 AI 편집 어시스턴트, SemVer·개발 로그·승인 후 커밋 (+16 more)

### Community 1 - "개인용 Pages 제품 경계"
Cohesion: 0.11
Nodes (17): AUDIO_EXTENSIONS, BrowserCapabilitySnapshot, BrowserCapabilitySupport, CapabilityGlobal, DEFAULT_ADAPTERS, DocumentGlobal, InspectLocalMediaOptions, kindFromFile() (+9 more)

### Community 2 - "멀티모달 AI 분석"
Cohesion: 0.12
Nodes (30): AI 우선 하이라이트 흐름, 분석 오케스트레이터, 초심자 중심 단방향 UX, 30~60초 경계 다듬기, 중복 억제·후보 다양성, 후보 회수·탐색 슬롯, 사람 중심 후보 검토, 채팅 로그 가져오기 (+22 more)

### Community 3 - "CHZZK 채팅·정적 제약"
Cohesion: 0.09
Nodes (32): AnalysisControlState, AnalysisControlStateInput, AnalysisRunStatus, BUSY_RUN_STATUSES, CANCELLABLE_RUN_STATUSES, deriveAnalysisControlState(), accept(), ANALYSIS_STAGES (+24 more)

### Community 4 - "원본·출력 어댑터"
Cohesion: 0.12
Nodes (30): aliasAuthor(), AliasValue, AUTHOR_ALIASES, ChatImportDiagnostic, ChatImportDiagnosticCode, ChatImportDiagnosticSeverity, ChatImportFormat, ChatImportResult (+22 more)

### Community 5 - "입력·모델 스냅샷"
Cohesion: 0.14
Nodes (25): AnalysisJob AnalysisSpec and AnalysisRun Model, AnalysisRun State Machine, AppSession and Single Writer Lease, Atomic Analysis Checkpoint, AI Candidate and User Revision Merge Policy, Chat Import and Local Live Capture Lifecycles, Completed With Gaps Contract, Domain Event Envelope (+17 more)

### Community 6 - "분석 실행·종료 계약"
Cohesion: 0.06
Nodes (30): DOM, DOM.Iterable, ES2022, src, vite/client, WebWorker, compilerOptions, allowJs (+22 more)

### Community 7 - "AI 후보·사람 검토"
Cohesion: 0.13
Nodes (15): eslint, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, devDependencies, eslint, eslint-plugin-react-hooks, eslint-plugin-react-refresh (+7 more)

### Community 8 - "이벤트 식별·펜싱"
Cohesion: 0.13
Nodes (35): ALL_OBJECT_STORES, AnalysisPayloadByKind, AnalysisRecord, AnalysisRecordKind, AnalysisResultStoreErrorCode, analysisSchemaFamily(), AnalysisStoreName, AnalysisTerminalRecordCatalog (+27 more)

### Community 9 - "초심자 UI·스타일"
Cohesion: 0.19
Nodes (12): ChatAnalysisWorkerError, createEventFence(), CreateEventFenceInput, EventFenceOutcome, EventFenceRejectionReason, EventFenceState, FenceableEvent, fenceEvent() (+4 more)

### Community 10 - "후보 수정·안전 경계"
Cohesion: 0.06
Nodes (67): attachVisualContext(), AUDIO_EVENT_KINDS, AudioHighlightCandidate, AudioHighlightCandidateEvidence, AudioReactionEventKind, canonicalSignalKinds(), clamp(), compareDrafts() (+59 more)

### Community 11 - "저장·복구 커밋"
Cohesion: 0.11
Nodes (18): ES2023, node, vite.config.ts, vitest.config.ts, compilerOptions, exactOptionalPropertyTypes, lib, module (+10 more)

### Community 12 - "candidateMerge.ts"
Cohesion: 0.15
Nodes (15): CandidateCompareOnlyReason, CandidateField, CandidateFieldMergeOutcome, CandidateMergeContext, CandidateProposal, CandidateProposalMergeOutcome, compareOnly(), globalCompareOnlyReason() (+7 more)

### Community 13 - "eventFence.ts"
Cohesion: 0.13
Nodes (23): buildVisualSampleTimestamps(), clamp(), clampInteger(), compareTransitions(), createCandidate(), createTransitionSignals(), LocalVideoVisualAnalysisDiagnostics, LocalVideoVisualAnalysisResult (+15 more)

### Community 14 - "Retto Highlight"
Cohesion: 0.25
Nodes (7): CHZZK 채팅, GitHub Pages 배포, Retto Highlight, 로컬에서 실행하기, 설계 문서, 영상과 개인정보, 지금 구현된 첫 수직 슬라이스

### Community 20 - "localVideoVisualAnalysis.ts"
Cohesion: 0.11
Nodes (22): AnalyzeLocalVideoVisualOptions, analyzeLocalVideoVisuals(), assertValidFile(), clampInteger(), copyFingerprint(), DEFAULT_ADAPTERS, DEFAULT_VISUAL_METADATA_TIMEOUT_MS, DEFAULT_VISUAL_SEEK_TIMEOUT_MS (+14 more)

### Community 21 - "loadVideoMetadata"
Cohesion: 0.20
Nodes (8): abortedError(), attemptCleanup(), cleanupResources(), defaultYieldControl(), loadVideoMetadata(), LocalVideoVisualProbe, mediaFailure(), seekVideo()

### Community 22 - "analyzeLocalVideoVisuals"
Cohesion: 0.09
Nodes (41): event(), amplitudeToDb(), AUDIO_REACTION_CANDIDATE_WINDOW_MS, AudioReactionCandidate, AudioReactionCandidateEvidence, AudioReactionEventKind, AudioReactionFeatureWindow, buildClusters() (+33 more)

### Community 23 - "fakeEvent"
Cohesion: 0.12
Nodes (18): ANALYSIS_RESULT_OBJECT_STORES, AnalysisFailureRecord, AnalysisResultStoreError, ProvisionalAnalysisResultRecord, AUDIO_CANDIDATE, expectStoreError(), FakeEventHandler, FakeFileSystemHandle (+10 more)

### Community 24 - "localVideoVisualAnalysis.test.ts"
Cohesion: 0.16
Nodes (10): captureDefaultLumaFingerprint(), LocalVideoVisualCanvas, createVisualHarness(), FakeCanvas, fingerprint(), samplesFromValues(), VideoEventType, MAX_VISUAL_SAMPLE_COUNT (+2 more)

### Community 26 - "inspectLocalMedia"
Cohesion: 0.47
Nodes (10): hasExactKeys(), isCandidate(), isCompletedResult(), isFenceEnvelope(), isFiniteNumber(), isNonNegativeInteger(), isProgress(), isRecord() (+2 more)

### Community 27 - "FakeVideoProbe"
Cohesion: 0.13
Nodes (5): expectCoreCleanup(), FakeVideoProbe, Harness, ProbeEventType, ProbeListener

### Community 28 - "localMediaPreflight.test.ts"
Cohesion: 0.14
Nodes (9): assertIdentifier(), cloneJson(), IndexedDbAnalysisResultStore, InMemoryAnalysisResultStore, rejectedOperation(), sortTerminalRecordsNewestFirst(), validateAndCloneAnalysisRecord(), validateAndCloneSourceSnapshot() (+1 more)

### Community 30 - "LocalMediaPreflightAdapters"
Cohesion: 0.31
Nodes (6): keyPathFor(), normalizeStoreFailure(), requestError(), storeClosedError(), terminalConflictError(), terminalRecordsAreEquivalent()

### Community 31 - "createContentFingerprint"
Cohesion: 0.10
Nodes (27): bytesToHex(), ContentDigestAdapter, createContentFingerprint(), fallbackFingerprint(), lengthDelimited(), abortedError(), bytesToHex(), createLocalFileFingerprint() (+19 more)

### Community 32 - "highlightSelector.ts"
Cohesion: 0.18
Nodes (19): baselineValues(), BUCKET_SIZE_MS, clamp(), compareScoredBuckets(), createBucket(), createCandidate(), emptyResult(), finiteNonNegativeInteger() (+11 more)

### Community 33 - "AnalysisResultStore"
Cohesion: 0.10
Nodes (17): AnalysisManifestRecord, AnalysisResultStore, AnalysisTerminalOutcome, AnalysisTerminalRecord, FinalAnalysisResultRecord, auditRecoverableAnalysisResults(), immutableIdentityMatches(), isCompletedTerminal() (+9 more)

### Community 34 - "durableAnalysisPayload.ts"
Cohesion: 0.10
Nodes (53): UnifiedHighlightEvidence, ANALYSIS_INPUT_KEYS, asPlainRecord(), assertAudioEvidence(), assertAudioGapReason(), assertBoolean(), assertCandidate(), assertChatEvidence() (+45 more)

### Community 35 - "App.tsx"
Cohesion: 0.06
Nodes (50): candidateAudioEventKindLabel(), AnalysisCoverageSummary, AnalysisGapApprovalEvidence, analysisRunLabel(), AnalysisSelectionSummary, App(), applyAnalysisEvent(), applySourceEvent() (+42 more)

### Community 36 - "sourceCheck.ts"
Cohesion: 0.13
Nodes (30): CandidateBoundaryProvenance, CandidateBoundaryRevision, CandidateTimeRange, ApprovedHighlightExportCandidate, assertMilliseconds(), chronologicalCandidates(), createCsv(), createHighlightClipboardText() (+22 more)

### Community 37 - "chatAnalysisWorkerClient.ts"
Cohesion: 0.18
Nodes (18): ChatAnalysisWorkerFactory, hasFiniteNumberFields(), isChatCandidate(), isFenceEnvelope(), isFiniteNumber(), isHighlightSelectionResult(), isNonNegativeInteger(), isRecord() (+10 more)

### Community 38 - "runChatAnalysisWorker"
Cohesion: 0.14
Nodes (9): ChatAnalysisWorkerLike, normalizeWorkerTimeout(), runChatAnalysisWorker(), emptyResult, FakeWorker, identity, startWith(), WorkerEventType (+1 more)

### Community 39 - "chatAnalysisWorkerProtocol.ts"
Cohesion: 0.18
Nodes (19): applyCandidateBoundaryCommand(), BoundaryCommandBase, CandidateBoundaryAdjustmentReason, CandidateBoundaryCommand, CandidateBoundaryIgnoreReason, CandidateBoundaryProposalInput, CandidateBoundaryRejectionReason, CandidateBoundaryTransition (+11 more)

### Community 41 - "FakeWorker"
Cohesion: 0.05
Nodes (57): assertCandidate(), assertMaxCandidates(), assertSourceDuration(), assertTarget(), buildCandidatePassBEvidence(), CandidatePassBBasisLabel, CandidatePassBCue, CandidatePassBCuePhase (+49 more)

### Community 42 - "Q: How do durable analysis records prevent raw chat and nickname leakage through arbitrary nested fields?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: How do durable analysis records prevent raw chat and nickname leakage through arbitrary nested fields?, Source Nodes

### Community 43 - "highlightSelector.test.ts"
Cohesion: 0.83
Nodes (3): addCollectiveSpike(), message(), quietBaseline()

### Community 44 - "IndexedDbAnalysisResultStore"
Cohesion: 0.07
Nodes (53): CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION, accept(), assertCandidateAudioEventRunInvariant(), baseAfterWorkerEvent(), baseOf(), CANDIDATE_AUDIO_EVENT_TERMINAL_STATUSES, CandidateAudioEventCancelTerminationKind, CandidateAudioEventCandidateOutcome (+45 more)

### Community 45 - "localAudioReactionAnalysis.ts"
Cohesion: 0.14
Nodes (17): ActiveAudioTask, AudioFeatureAccumulator, clamp(), clampInteger(), createEventId(), decodeAndScore(), disposeInputOnce(), handleCancel() (+9 more)

### Community 46 - "sourceCheck.ts"
Cohesion: 0.19
Nodes (17): accept(), assertNever(), baseOf(), createSourceCheck(), isSourceCheckTerminal(), reduceSourceCheck(), reject(), SourceCheckBase (+9 more)

### Community 47 - "audioReactionAnalysis.worker.ts"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 0.3 오디오 반응부터 설명·저장·내보내기까지의 경로, Source Nodes

### Community 48 - "AudioFeatureAccumulator"
Cohesion: 0.11
Nodes (26): AudioAnalysisOutcome, AUDIO_REACTION_FEATURE_WINDOW_MS, AudioReactionWorkerIdentity, AudioReactionWorkerResponse, AudioReactionWorkerResponsePayload, LocalAudioReactionAnalysisOutcome, LocalAudioReactionAnalysisProgress, LocalAudioReactionAnalysisStage (+18 more)

### Community 49 - "analyzeLocalAudioReactions"
Cohesion: 0.07
Nodes (56): accept(), assertCandidatePassBRunInvariant(), baseAfterWorkerEvent(), baseOf(), CANDIDATE_PASS_B_TERMINAL_STATUSES, candidateEventRejection(), CandidatePassBCancelTerminationKind, CandidatePassBCandidateFailureReasonCode (+48 more)

### Community 50 - "HighlightSelectionResult"
Cohesion: 0.29
Nodes (14): audienceReactionExplanation(), audioRange(), buildHighlightNarrative(), chatRange(), eventExplanation(), HighlightInterpretationBasis, recommendationExplanation(), relationBetween() (+6 more)

### Community 51 - "highlightNarrative.ts"
Cohesion: 0.24
Nodes (7): CandidatePcmBuilder, clamp(), decodeCandidate(), isUnsupportedAudioCodecError(), nextPowerOfTwo(), NormalizedRunInput, CandidatePassBTarget

### Community 52 - "scripts"
Cohesion: 0.22
Nodes (9): scripts, build, check, dev, lint, preview, test, test:watch (+1 more)

### Community 53 - "highlightExport.test.ts"
Cohesion: 0.14
Nodes (30): AnalyzeRequest, BUNDLED_ORT_WASM_URL, candidateGap(), clampInteger(), configureBundledOrtWasm(), createEventId(), DecodedCandidate, disposeInputOnce() (+22 more)

### Community 54 - "inspectLocalMedia"
Cohesion: 0.20
Nodes (11): assertValidFile(), createProbeWaitState(), durationSecondsToMilliseconds(), extensionFromName(), inspectLocalMedia(), normalizeCapabilities(), ProbeWaitState, resolveAdapters() (+3 more)

### Community 55 - "dependencies"
Cohesion: 0.22
Nodes (9): @huggingface/transformers, mediabunny, dependencies, @huggingface/transformers, mediabunny, react, react-dom, react (+1 more)

### Community 56 - "package.json"
Cohesion: 0.29
Nodes (6): engines, node, name, private, type, version

### Community 57 - "Q: 현재의 하이라이트 검출은 무슨 기준을 사용하고 있지"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 현재의 하이라이트 검출은 무슨 기준을 사용하고 있지, Source Nodes

### Community 58 - "Q: 스트리머 반응 중심 목표 대비 현재 하이라이트 검출 신호의 적합성, 오탐, 미탐, 다음 구조를 감사"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 스트리머 반응 중심 목표 대비 현재 하이라이트 검출 신호의 적합성, 오탐, 미탐, 다음 구조를 감사, Source Nodes

### Community 59 - "Q: 근데 클립이란건 스트리머의 반응을 보는거지 화려한 연출을 보는게 아니야. 이게 맞는 접근인지 알려진 다른 사례들과 함께 확인해"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 근데 클립이란건 스트리머의 반응을 보는거지 화려한 연출을 보는게 아니야. 이게 맞는 접근인지 알려진 다른 사례들과 함께 확인해, Source Nodes

### Community 60 - "EventFenceRejectionReason"
Cohesion: 0.11
Nodes (27): ActiveTask, CandidatePassBRunResult, CandidatePassBWorkerError, FenceState, RunCandidatePassBWorkerOptions, identity, targets, WorkerEventType (+19 more)

### Community 61 - "eslint-plugin-react-hooks"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 0.3.5 후보 재정렬 제안은 canonical 후보, 정밀 근거, 검토·경계·미리보기·export를 어떻게 안전하게 분리해야 하는가?, Source Nodes

### Community 62 - "eslint-plugin-react-refresh"
Cohesion: 0.18
Nodes (26): CandidatePassBEventFenceRejectionReason, CandidatePassBWorkerErrorCode, CandidatePassBWorkerFactory, FenceOutcome, hasExactKeys(), hasResponseKeys(), isCandidateGap(), isCandidateProgress() (+18 more)

### Community 63 - "@types/react"
Cohesion: 0.07
Nodes (44): aggregateCandidateAudioEventScores(), aggregationQuality(), aggregationQualityTuple(), assertAndIndexWindowScores(), assertScoreVector(), assertTarget(), assertTargetSet(), baseResult() (+36 more)

### Community 65 - "@vitejs/plugin-react"
Cohesion: 0.11
Nodes (13): CandidatePassBWorkerLike, fenceEvent(), hasValidSegmentTimeline(), matchesTargetRange(), normalizeCancelAcknowledgementTimeout(), normalizeWorkerTimeout(), rejectFence(), runCandidatePassBWorker() (+5 more)

### Community 66 - "vitest"
Cohesion: 0.06
Nodes (58): acknowledgeAfterLoadedModelCleanup(), ANALYZE_REQUEST_KEYS, analyzeCandidate(), AnalyzeRequest, assertPinnedId2Label(), BUNDLED_ORT_WASM_URL, CancelRequest, CandidateFailure (+50 more)

### Community 67 - "localMediaPreflight.test.ts"
Cohesion: 0.13
Nodes (32): CandidateRankingProposal, accepted(), applyProposal(), CandidateRankingProjectable, CandidateRankingProposalDisposition, CandidateRankingProposalView, CandidateRankingViewEvent, candidateRankingViewHasSessionWork() (+24 more)

### Community 68 - "LocalMediaPreflightAdapters"
Cohesion: 0.22
Nodes (3): createDefaultObjectURL(), LocalMediaPreflightAdapters, revokeDefaultObjectURL()

### Community 69 - "AudioReactionWorkerIdentity"
Cohesion: 0.10
Nodes (19): ActiveTask, CandidateAudioEventWorkerError, FenceState, NormalizedRunInput, RunCandidateAudioEventWorkerOptions, emit(), emitCandidateProgress(), emitModelReady() (+11 more)

### Community 70 - "candidatePassBRuntime.ts"
Cohesion: 0.32
Nodes (5): CandidatePassBRuntimeCapabilitySnapshot, CandidatePassBRuntimeSelectionOptions, NavigatorWithOptionalGpu, selectCandidatePassBRuntimeDevice(), PreferredPreflightRuntimeTier

### Community 71 - "appendHiddenElement"
Cohesion: 0.08
Nodes (33): CandidateAudioEventEvidenceById, CandidatePassBEvidence, CandidatePassBEvidenceById, evidenceQualityRank(), mergeCandidatePassBEvidence(), fallback, provisional, buildCandidateRankingProposal() (+25 more)

### Community 78 - "Q: Candidate Pass B 구조가 App, Worker, provisional evidence, finalizing 완료 fence를 어떻게 연결하는가?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Candidate Pass B 구조가 App, Worker, provisional evidence, finalizing 완료 fence를 어떻게 연결하는가?, Source Nodes

### Community 79 - "appendHiddenElement"
Cohesion: 0.83
Nodes (4): appendHiddenElement(), createDefaultCanvas(), createDefaultVideoProbe(), requireDocument()

### Community 81 - "candidateAudioEventWorkerClient.ts"
Cohesion: 0.12
Nodes (37): CandidateAudioEventFenceRejectionReason, CandidateAudioEventRunResult, CandidateAudioEventWorkerErrorCode, CandidateAudioEventWorkerFactory, FenceOutcome, hasExactKeys(), hasResponseKeys(), hasValidResultBase() (+29 more)

### Community 82 - "candidateAudioEventEvidenceState.test.ts"
Cohesion: 0.10
Nodes (35): CandidateAudioEventAggregation, DetectionDraft, chronologicalDetectionOrder(), mergeCandidateAudioEventEvidence(), mergeDetectedResults(), sameBinding(), sameDetection(), sameDetectionList() (+27 more)

### Community 85 - "highlightNarrative.ts"
Cohesion: 0.15
Nodes (8): AudioReactionWorkerRequest, analyzeLocalAudioReactions(), LocalAudioReactionWorkerLike, normalizeCancelAcknowledgementTimeout(), normalizeWorkerTimeout(), emitResponse(), FakeWorker, validateInput()

### Community 86 - "fakeEvent"
Cohesion: 0.18
Nodes (5): ControlledOpenRequest, ControlledRequest, ControlledTransaction, fakeEvent(), FakeIndexedDbHarness

### Community 89 - "createReactionUnifiedCandidate"
Cohesion: 0.10
Nodes (13): CandidateAudioEventWorkerLike, fenceEvent(), hasValidDetectionTimeline(), isPreModelSourceGapReason(), matchesTarget(), normalizeCancelAcknowledgementTimeout(), normalizeWorkerTimeout(), rejectFence() (+5 more)

### Community 95 - "Q: Trace candidate array order consumers and design CandidateRankingProposal lifecycle"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Trace candidate array order consumers and design CandidateRankingProposal lifecycle, Source Nodes

## Knowledge Gaps
- **373 isolated node(s):** `name`, `private`, `version`, `type`, `node` (+368 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Work-memory lessons

**Preferred sources** — corroborated by past sessions; start here.
- `App()` (7× useful, score=6.962092962) _(code changed — re-verify)_
- `fuseHighlightCandidates()` (4× useful, score=3.979176779)
- `selectChatHighlights()` (3× useful, score=2.979709505)
- `selectVisualHighlightsFromSamples()` (3× useful, score=2.979709505)
- `highlightExport.ts` (2× useful, score=1.99381946)
- `durableAnalysisPayload.ts` (2× useful, score=1.99381946)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `analyzeLocalVideoVisuals()` connect `localVideoVisualAnalysis.ts` to `App.tsx`, `InMemoryAnalysisResultStore`, `eventFence.ts`, `loadVideoMetadata`, `localVideoVisualAnalysis.test.ts`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `App()` connect `App.tsx` to `CHZZK 채팅·정적 제약`, `원본·출력 어댑터`, `후보 수정·안전 경계`, `localVideoVisualAnalysis.ts`, `analyzeLocalVideoVisuals`, `localVideoVisualAnalysis.test.ts`, `createContentFingerprint`, `AnalysisResultStore`, `sourceCheck.ts`, `runChatAnalysisWorker`, `chatAnalysisWorkerProtocol.ts`, `FakeWorker`, `IndexedDbAnalysisResultStore`, `sourceCheck.ts`, `analyzeLocalAudioReactions`, `HighlightSelectionResult`, `inspectLocalMedia`, `@vitejs/plugin-react`, `localMediaPreflight.test.ts`, `candidatePassBRuntime.ts`, `appendHiddenElement`, `candidateAudioEventEvidenceState.test.ts`, `highlightNarrative.ts`, `createReactionUnifiedCandidate`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `IndexedDbAnalysisResultStore` connect `localMediaPreflight.test.ts` to `AnalysisResultStore`, `App.tsx`, `이벤트 식별·펜싱`, `fakeEvent`, `LocalMediaPreflightAdapters`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `App()` (e.g. with `result()` and `event()`) actually correct?**
  _`App()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _373 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `운영·릴리스 안전성` be split into smaller, more focused modules?**
  _Cohesion score 0.14130434782608695 - nodes in this community are weakly interconnected._
- **Should `개인용 Pages 제품 경계` be split into smaller, more focused modules?**
  _Cohesion score 0.10952380952380952 - nodes in this community are weakly interconnected._