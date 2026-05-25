# E-Story AI 프록시 (Cloudflare Worker)

GitHub Pages 같은 정적 호스팅에서 opencode.ai를 쓰려면 CORS 허용 프록시가 필요합니다.
이 워커가 그 역할을 합니다 — **키는 워커 secret에 저장되고 브라우저엔 노출되지 않습니다.**

## 배포 (한 번만)

```bash
cd cloudflare-worker

# 1. wrangler 설치 (없다면)
npm install -g wrangler

# 2. Cloudflare 로그인
wrangler login

# 3. API 키를 secret으로 등록 (repo에 안 들어감)
wrangler secret put OPENCODE_API_KEY
#   → 프롬프트에 sk-... 붙여넣기

# 4. 배포
wrangler deploy
```

배포가 끝나면 다음과 같은 URL이 출력됩니다:
```
https://estory-proxy.<your-account>.workers.dev
```

## 앱 연결

배포된 사이트(`https://boldmottt.github.io/E-story/`)에서:

1. **설정** 페이지 열기
2. **API URL** 에 입력:
   ```
   https://estory-proxy.<your-account>.workers.dev/api/zen/go/v1
   ```
3. **모델**: `deepseek-v4-flash` (또는 `deepseek-v4-pro`)
4. **API Key**: 비워둠 — 키는 워커가 들고 있음
5. **💾 설정 저장** → **🔌 AI 연결 테스트** 로 확인

앱은 `.workers.dev` URL을 프록시로 인식해서 브라우저 키 없이 동작합니다.

## 허용 도메인

`worker.js`의 `ALLOWED_ORIGINS`에 호출을 허용할 도메인이 있습니다.
본인 Pages 주소가 다르면 거기에 추가하세요. (기본: `https://boldmottt.github.io`)

## 비용

Cloudflare Workers 무료 플랜: 하루 100,000 요청. 개인 사용엔 충분합니다.
