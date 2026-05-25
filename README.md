# E-Story 📖

> **txt 원서를 읽다가 문장을 선택하고, 직접 한국어 해석을 쓴 뒤, AI에게 한 포인트씩 교정받는 Local-first 영어 독해 훈련 앱**

## 특징

- **능동 학습** — 답을 먼저 보여주지 않고 사용자가 먼저 쓰게 한다
- **한 번에 하나씩** — AI 피드백을 한 포인트씩 교정
- **읽기와 학습의 균형** — 몰입을 깨지 않으면서 학습
- **Local-first** — 모든 데이터는 브라우저 IndexedDB에 저장

## 시작하기

```bash
# 1. 클론
git clone https://github.com/boldmottt/E-story.git
cd E-story

# 2. AI 키 설정 (opencode.ai/zen) — 서버가 들고 있고 브라우저엔 노출 안 됨
export OPENCODE_API_KEY=sk-...

# 3. 앱 + AI 프록시 서버 실행
python3 serve.py 8000

# 4. 브라우저에서 접속
open http://localhost:8000
```

> **AI 연결 구조:** `serve.py`가 정적 앱을 서빙하면서 `/api/zen/*` 요청을
> `https://opencode.ai/zen/*`로 프록시하고 `OPENCODE_API_KEY`를 주입합니다.
> opencode.ai는 CORS 헤더를 주지 않아 브라우저가 직접 호출할 수 없기 때문에
> 프록시가 필요합니다. 정적 서버(`python3 -m http.server`)로 띄우면 AI가
> 동작하지 않습니다.

## 기술 스택

- Vanilla JS + CSS (단일 HTML, 번들러 불필요)
- IndexedDB (Dexie.js) — 로컬 데이터 저장
- Web Speech API — TTS
- AI 기반 단어 뜻 검색 — BYOK AI
- BYOK (Bring Your Own Key) — AI 피드백

## 라이선스

MIT
