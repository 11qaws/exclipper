# Voice enrollment candidate recipes

이 디렉터리는 ExClipper 개발자가 직접 검토할 **음성 후보 구간**만 정의합니다.
recipe가 있다는 사실은 화자, 단독 발화, 음악·겹침 부재 또는 음성 등록 동의를
확인했다는 뜻이 아닙니다.

현재 도구는 의도적으로 코드에 등록된 CHZZK replay와 참여자 조합만 허용합니다.
임의 URL은 받지 않으며, 각 영상은 CHZZK 메타데이터의 채널 ID까지 고정된
출처와 일치해야 합니다. sample recipe도 다음 고정 문구를 유지해야 합니다.

```text
candidate-ranges-are-unverified-and-require-human-voice-review
```

실행:

```powershell
npm run enrollment:extract-candidates -- `
  --recipe scripts/voice-enrollment-recipes/chzzk-13996057.pending.json
```

개인 채널 후보는 아래 recipe로 같은 방식으로 추출합니다.

- `chzzk-14415543.pending.json` — 유레카
- `chzzk-14423365.pending.json` — 세나 아르벨
- `chzzk-14402822.pending.json` — 토로리 코코
- `chzzk-14393572.pending.json` — 망징이

기본 출력은 repository의 `public/`이 아닌
`../artifacts/voice-enrollment-candidates/<manifestRevision>/`에 만들어집니다.
기존 디렉터리는 덮어쓰지 않습니다. 출력 manifest는 모든 asset을 다음 상태로
고정합니다.

- `consent.status = unknown`
- `humanVerification.status = pending`
- `containsOverlappingSpeech = true`
- `containsMusic = true`
- `embeddingModelRevision = speaker-embedding:unassigned`

따라서 사람이 각 FLAC을 듣고 출처·동의·단독 화자·음악·겹침을 별도 절차로
검증해 새로운 manifest revision을 만들기 전에는 enrollment 대상으로 사용할 수
없습니다.

후보 품질 교차검증:

```powershell
npm run enrollment:evaluate-speakers
```

이 명령은 고정된 WavLM speaker-verification 모델로 개인 채널 표본의 내부
일관성과 전원 방송 표본의 prototype 일치도를 계산합니다. 디코딩한 PCM과
임베딩은 메모리에만 두고 종료 전에 비우며 파일로 저장하지 않습니다. 출력
cosine 점수는 오염된 후보를 거르는 개발 진단일 뿐 `pending`을 `verified`로
바꾸거나 사람 동의·단독 발화·음악 부재를 대신하지 않습니다.
