# E-Story — 기획서 (PRD) v1.1

> **프로젝트명:** E-Story
> **목표:** txt 원서를 읽다가 문장을 선택하고, 직접 한국어 해석을 쓴 뒤, AI에게 한 포인트씩 교정받는 **Local-first** 영어 독해 훈련 앱
> **위치:** `./E-Story/`
> **버전:** v1.1 (2026-05-25)
> **MVP 목표:** AI 피드백 리더 — 그 외 기능은 Post-MVP

---

## 1. 제품 개요

### 1.1 한 줄 설명
> **"원서를 읽으면서 내가 직접 해석해보고, AI가 한 포인트씩 교정해주는 영어 독해 훈련 앱"**

### 1.2 타겟 사용자
- 영어 원서 읽기에 도전하는 중급자 (토익 700~900, 수능 2~3등급)
- 문법/단어는 어느 정도 알지만 "실제 문장을 제대로 해석"하는 게 어려운 학습자
- 수동적인 단어 암기가 아닌 **능동적인 해석 훈련**을 원하는 사람

### 1.3 핵심 가치
1. **능동 학습** — 답을 먼저 보여주지 않고 사용자가 먼저 쓰게 한다
2. **한 번에 하나씩** — 피드백을 쏟아붓지 않고 한 포인트씩 교정
3. **읽기와 학습의 균형** — 몰입을 깨지 않으면서 학습 포인트를 제공
4. **Local-first** — 책, 단어장, 피드백 이력은 로컬 IndexedDB에 저장. 단, AI 피드백/사전 검색은 외부 API 호출 필요

### 1.4 Non-goals (MVP에서 하지 않을 것)
- PDF/EPUB 지원하지 않음
- 클라우드 동기화 없음
- 사용자 계정 없음
- 페이지 전체 문법 분석은 제공하지 않음
- 정교한 통계 대시보드는 제공하지 않음
- 속독(RSVP) 모드 제공하지 않음

---

## 2. MVP 기능 (P0 ~ P1)

### 2.1 P0 — 반드시 포함

| 기능 | 설명 |
|------|------|
| **txt 업로드** | .txt 파일 선택 → IndexedDB에 내용 저장. 인코딩 자동 감지 |
| **책 목록/진행률** | Bookshelf: 책 목록, 각 책의 읽기 진행률, 이어 읽기 |
| **리더 뷰** | 깔끔한 타이포그래피, 다크모드/폰트/간격 조절, 문장 단위 표시 |
| **문장 선택** | 클릭으로 문장 선택 + 드래그로 범위 선택 모두 지원 |
| **해석 입력** | 선택 문장을 우측/하단 패널에 표시 + 사용자 해석 입력창 |
| **AI one-point 피드백** | 한 번에 **하나의 포인트만** 지적. JSON 응답으로 안정적 처리 |
| **피드백 반복 루프** | 수정 → 재제출 → 다음 포인트 → "충분하다"까지 반복 |
| **추천 해석 비교** | 루프 종료 시에만 사용자 해석 vs AI 추천 해석 병렬 비교 |
| **피드백 이력 저장** | 모든 시도 저장 (feedbackSessions + translationAttempts) |

### 2.2 P1 — 중요하지만 MVP 범위

| 기능 | 설명 |
|------|------|
| **단어 저장** | 피드백 중 모르는 단어 1클릭 저장 (컨텍스트 포함) |
| **단어 발음 TTS** | Web Speech API로 단어/문장 발음 듣기 |
| **기본 단어장** | 저장된 단어 목록, 검색, 학습 상태 표시 |
| **백업/복원** | IndexedDB 데이터 → JSON 내보내기 / 불러오기 |

---

## 3. Post-MVP (확장 기능)

| 기능 | 이유 |
|------|------|
| **문법 분석 모드** | LLM span 매핑 렌더링 난이도 높음. MVP 검증 후 추가 |
| **챕터 복습 퀴즈** | 핵심 학습 루프 검증 후 추가해도 늦지 않음 |
| **약점 요약** | 피드백 데이터가 충분히 쌓인 후 가치가 생김 |
| **SRS 고도화** | 처음에는 단어장 + 간단 복습으로 충분 |
| **통계 대시보드** | Post-MVP |
| **TTS 낭독 모드** | (문장 클릭 재생은 P0/P1에 포함 검토) |

---

## 4. 기술 설계

### 4.1 배포 방식

```
권장 실행 방식:
  python3 -m http.server 8000
  → http://localhost:8000 접속

⚠ file:// 직접 실행:
  - 브라우저별 file:// origin 처리 차이가 있음
  - IndexedDB가 제한될 수 있음
  - 외부 API 호출 시 CORS 문제 가능
  - 지원은 하지만 안정성 보장 어려움
```

### 4.2 "완전 로컬"이 아닌 이유

이 앱은 **완전 오프라인 앱이 아니라 Local-first 앱**입니다.

| 기능 | 네트워크 필요? | 이유 |
|------|:---:|------|
| 책/단어장/이력 저장 | ❌ | IndexedDB 로컬 저장 |
| AI 피드백 | ✅ | 사용자 API 키로 외부 AI 호출 |
| 사전 검색 | ✅ | Free Dictionary API |
| TTS | ❌ | Web Speech API (브라우저 내장) |
| Google Fonts | ✅ (첫 로딩) | CDN 로딩 |

### 4.3 문장 분할 전략

문장 분할 품질이 전체 UX를 결정합니다.

```
1. 기본적으로 문단 단위로 나눈다
2. 문단 내부는 sentence splitter로 분리
3. 약어 예외 목록: Mr., Mrs., Dr., St., etc.
4. 사용자가 드래그로 직접 범위 선택 가능 → 자동 분할 실패 보완
```

### 4.4 BYOK (Bring Your Own Key)

**보안 주의사항:**
- API 키를 IndexedDB에 평문 저장 시 XSS 탈취 위험
- 외부 CDN 스크립트 사용 시 키 노출 가능성
- AI 제공업체별 CORS 정책 확인 필요

**API 키 저장 UX:**
```
API 키 저장 방식:
[●] 이번 세션에서만 사용 (기본값, 안전)
[○] 브라우저에 저장 (위험을 이해했습니다)
```

### 4.5 파일 저장 정책

```
업로드된 txt 파일은 브라우저가 직접 프로젝트 폴더에 저장하지 않는다.
파일 내용은 IndexedDB에 저장한다.
(로컬 파일 시스템 접근은 브라우저 보안상 불가능)
```

---

## 5. AI 피드백 설계

### 5.1 System Prompt

```
You are an English tutor for a Korean learner.

The learner reads an English sentence from a novel and writes a Korean translation.

Your job:
- Give feedback in Korean.
- Point out exactly ONE issue per response.
- Focus on meaning first, then grammar, then naturalness.
- Do not reveal the full model translation unless finishRequested is true.
- If the user's translation fixes the previous issue, move to the next point.
- If the current translation is good enough, say so and suggest finishing.
- Avoid nitpicking style differences when meaning is already correct.
- 💡 If the mistake is typical for Korean learners, add a brief L1 note.

Return JSON only.
```

### 5.2 JSON 응답 형식

```json
{
  "status": "needs_revision" | "good_enough" | "finished",
  "issueType": "meaning" | "grammar" | "tense" | "article" | "preposition" | "word_choice" | "structure" | "naturalness" | "none",
  "feedbackKo": "한국어 피드백 (2~3문장)",
  "hintKo": "짧은 힌트",
  "l1InterferenceKo": null,
  "shouldShowModelTranslation": false,
  "modelTranslationKo": null
}
```

종료 시:
```json
{
  "status": "finished",
  "issueType": "none",
  "feedbackKo": "좋아요. 이제 추천 해석과 비교해볼게요.",
  "hintKo": null,
  "l1InterferenceKo": null,
  "shouldShowModelTranslation": true,
  "modelTranslationKo": "추천 해석..."
}
```

### 5.3 이전 피드백 컨텍스트 전달

```json
{
  "originalSentence": "...",
  "userTranslation": "...",
  "previousIssues": [
    {"type": "passive_voice", "resolved": true},
    {"type": "article", "resolved": false}
  ]
}
```

### 5.4 "모범 해석" 대신 "추천 해석"

문학 번역에는 정답이 하나가 아닙니다.
- ~~모범 해석~~ → **추천 해석**
- ~~정답~~ → **참고 해석**
- ~~틀린 부분~~ → **개선 포인트**

톤은 "채점기"보다 "튜터"에 가깝게.

---

## 6. 데이터 모델

```javascript
{
  books: {
    id, title, fileName, sourceHash, encoding,
    totalChunks, currentChunk, currentOffset,
    createdAt, updatedAt
  },

  chunks: {
    id, bookId, index, title, content,
    startOffset, endOffset, createdAt
  },

  sentences: {
    id, bookId, chunkId, index, text,
    startOffset, endOffset
  },

  feedbackSessions: {
    id, bookId, sentenceId, originalSentence,
    status: "active" | "finished",
    finalUserTranslation, modelTranslation,
    createdAt, updatedAt
  },

  translationAttempts: {
    id, sessionId, attemptNo,
    userTranslation,
    aiStatus, issueType,
    feedbackKo, hintKo, l1InterferenceKo,
    createdAt
  },

  vocabulary: {
    id, word, lemma, meaningKo, definitionEn,
    partOfSpeech, pronunciation, audioUrl,
    sentenceId, contextSentence, bookId,
    status: "new" | "learning" | "known",
    reviewBox: 0,  // 0=new, 1=today, 2=3day, 3=7day
    nextReview: Date,
    addedAt, updatedAt
  },

  grammarAnalyses: {
    id, sentenceId, model, sourceHash,
    spans: [{ start, end, text, label }],
    createdAt
  },

  settings: {
    id, theme, fontSize, lineHeight,
    ttsRate, aiProvider, apiKeyStorageMode
  }
}
```

### 피드백 이력 조회
별도 테이블 없이 `feedbackSessions + translationAttempts`로 조회 가능.

---

## 7. TTS (Text-to-Speech)

- **Web Speech API** 사용 (브라우저 내장, 무료)
- 단어 발음: 단어 팝업의 🔊 버튼
- 문장 발음: 문장 아래 🔊 듣기 버튼
- **낭독 모드**: 재생/일시정지/속도 조절 (0.5x~2.0x)
- **문장 클릭 → 해당 문장부터 재생 시작** + 자동 스크롤
- macOS Samantha 음성 우선, fallback 처리
- 브라우저/OS별 음성 목록 차이를 고려한 fallback 필수

---

## 8. 단어장

### 사전 검색
- **Free Dictionary API**: 발음/품사/영영 정의용
- **한국어 뜻**: AI에게 요청 또는 사용자 직접 입력
- 캐싱: 같은 단어 재호출 방지

### 단어장 필드
```javascript
{
  word, lemma,
  meaningKo,        // 한국어 뜻
  definitionEn,     // 영어 정의 (Free Dictionary API)
  partOfSpeech,     // 품사
  pronunciation,    // 발음 기호
  audioUrl,         // 발음 파일 URL
  contextSentence   // 원문 문장
}
```

---

## 9. UX 설계

### 9.1 레이아웃
```
데스크톱: 좌측 리더 + 우측 해석 패널
태블릿/모바일: 리더 + 하단 슬라이드 패널
```

### 9.2 학습 루프 버튼
- **다시 제출** — 수정 후 재제출
- **이 정도면 종료** — AI가 "충분하다"고 하면 활성화
- **추천 해석 보기** — 종료 시 표시
- **단어장에 저장** — 1클릭 저장
- **이 문장 건너뛰기** — 패널 닫기

### 9.3 문법 분석 (Post-MVP, v1에서는 선택 문장만)
```
MVP용 축소안:
  - 사용자가 선택한 한 문장만 분석
  - 주어/동사/목적어/수식어만 표시
  - 색상 + 라벨 병행 (색맹 대비)
  - 결과 캐시
  
span 형식 (character offset 사용):
  { start: 0, end: 2, text: "It", label: "subject" }
  { start: 3, end: 5, text: "is", label: "verb" }
```

---

## 10. 일정 (8일)

| 일자 | 작업 |
|:---:|------|
| **Day 1** | 앱 구조, IndexedDB 초기화, 설정, 파일 업로드, Bookshelf |
| **Day 2** | 리더 뷰, chunk/sentence 분할, 진행률 저장 |
| **Day 3** | 문장 선택, 해석 패널, 해석 draft 저장 |
| **Day 4** | AI Provider 설정, one-point 피드백 루프 |
| **Day 5** | 피드백 세션/이력 저장, 추천 해석 비교 뷰 |
| **Day 6** | 단어장, 단어 저장, 기본 검색, 사전 API |
| **Day 7** | TTS (단어/문장 발음), UI 마감 |
| **Day 8** | JSON 백업/복원, 에러 처리, 테스트 |

### Stretch Goals (시간 남으면)
- TTS 낭독 모드 (문장 클릭 재생, 속도 조절)
- 다크모드 완성

### Post-MVP
- 문법 분석 모드
- 챕터 복습 퀴즈
- 약점 요약
- 통계 대시보드

---

## 11. 개인정보 및 저작권 안내

```text
AI 피드백 사용 시 선택한 문장과 사용자의 해석이 AI 제공업체로 전송된다.
저작권이 있는 텍스트를 사용할 경우 사용자는 해당 텍스트의 이용 조건을 확인해야 한다.
```

---

## 12. 오픈소스/무료 리소스

| 리소스 | 용도 | 라이선스 |
|--------|------|---------|
| Dexie.js | IndexedDB wrapper | Apache 2.0 |
| Free Dictionary API | 단어 검색 | 무료 |
| Web Speech API | TTS | 브라우저 내장 |
| jschardet | 인코딩 감지 | LGPL |
| Google Fonts | 타이포그래피 | SIL Open Font |

---

## 13. 변경 이력

| 버전 | 날짜 | 변경 내용 |
|:----:|:----:|-----------|
| v1.0 | 2026-05-25 | 초안 작성 |
| v1.1 | 2026-05-25 | MVP 범위 축소 (문법분석/퀴즈/통계 → Post-MVP). "완전 로컬"→"Local-first" 수정. AI 피드백 JSON 형식 명시. 데이터 모델 feedbackSessions+attempts 통합. file:// 리스크 문서화. BYOK 보안 주의사항 추가. "모범 해석"→"추천 해석". Non-goals 명시. 백업/복원 추가. 일정 현실화. 문장 분할 전략 추가. |
