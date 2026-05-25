# E-Story Supabase 설정 가이드

> E-Story의 클라우드 동기화 기능을 활성화하려면 아래 단계를 따라주세요.

## 사전 준비

- Supabase 계정 (https://supabase.com)
- Google Cloud OAuth 키 (선택, Supabase 내장 OAuth 사용 시 불필요)

## 1. Supabase 프로젝트 생성

1. [Supabase 대시보드](https://supabase.com/dashboard)에 로그인
2. **New Project** 클릭
3. 프로젝트 이름: `E-Story` (또는 원하는 이름)
4. **Database Password**: 강력한 비밀번호 설정 (꼭 메모!)
5. **Region**: `Northeast Asia (Seoul)` 🇰🇷 — 가장 가까운 리전, 속도 향상
6. **Pricing Plan**: Free Tier로 충분 (월 500MB DB, 5GB 대역폭)
7. **Create New Project** 클릭

> ⏱ 프로젝트 생성에 1~2분 소요됩니다.

## 2. 데이터베이스 스키마 적용

1. 생성된 프로젝트 대시보드에서 **SQL Editor** 메뉴 클릭
2. **New Query** 또는 **+** 버튼 클릭
3. `supabase/schema.sql` 파일 내용을 **전체 복사**해서 붙여넣기
4. **Run** 또는 **▶️ Run** 버튼 클릭
5. 성공 메시지 확인 (11개 테이블 생성)

## 3. RLS 정책 적용

1. SQL Editor에서 **New Query** 클릭
2. `supabase/rls.sql` 파일 내용을 **전체 복사**해서 붙여넣기
3. **Run** 클릭
4. 성공 메시지 확인 (44개 정책 생성)

## 4. Google OAuth 활성화

### 방법 A: Supabase 내장 OAuth 사용 (간편)

1. 프로젝트 대시보드에서 **Authentication** → **Providers** 메뉴 이동
2. **Google** 항목 찾아서 **Enable** 토글 ON
3. 아래 설정 입력:
   - **Client ID**: Supabase 기본 제공 키 사용 (빈 칸으로 두고 저장)
   - **Client Secret**: 빈 칸으로 저장
4. **Save** 클릭

### 방법 B: Google Cloud Console 키 사용 (선택)

1. [Google Cloud Console](https://console.cloud.google.com) 접속
2. 새 프로젝트 생성 또는 기존 프로젝트 선택
3. **OAuth 동의 화면** → **외부** → 만들기
4. 앱 이름: `E-Story`, 사용자 이메일: 본인 이메일 입력
5. **사용자 인증 정보** → **사용자 인증 정보 만들기** → **OAuth 클라이언트 ID**
6. **애플리케이션 유형**: `웹 애플리케이션`
7. **승인된 리디렉션 URI**에 아래 URL 추가:
   ```
   https://<YOUR-PROJECT-REF>.supabase.co/auth/v1/callback
   ```
8. 생성된 **Client ID**와 **Client Secret** 복사
9. Supabase → Authentication → Providers → Google에 붙여넣기

> ⚠️ **URL 설정 주의**: Supabase는 기본적으로 `https://YOUR-PROJECT.supabase.co` 형태입니다.
> 배포 후에는 GitHub Pages 도메인을 **Additional Redirect URIs**에 추가해야 할 수 있습니다.

## 5. API 키 확인

1. 프로젝트 대시보드에서 **Project Settings** (⚙️) → **API** 메뉴 이동
2. 아래 두 값을 복사:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public key**: `eyJhbGciOiJIUzI1NiIs...`
3. 프로젝트 루트의 `js/sync.config.js` 파일을 열고 아래 내용 입력:

```javascript
window.SYNC_CONFIG = {
  SUPABASE_URL: 'https://xxxxx.supabase.co',     // ← 복사한 URL
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIs...', // ← 복사한 anon key
  ENABLED: true,
  DEBOUNCE_MS: 5000,
  PULL_INTERVAL_MS: 60000,
  USE_REALTIME: false  // 폴링 방식 사용
};
```

## 6. 동기화 테스트

1. `python3 -m http.server 8000` 으로 로컬 서버 실행
2. 브라우저에서 `http://localhost:8000` 접속
3. 설정(⚙️) → **☁️ 클라우드 동기화** 섹션 확인
4. **Google로 로그인** 버튼 클릭
5. Supabase OAuth 창에서 구글 계정 선택
6. 로그인 성공 후 우측 상단에 동기화 상태 아이콘(●) 확인
7. 책/단어장 추가 후 다른 기기에서 로그인해서 동기화 확인

## 문제 해결

| 문제 | 해결 방법 |
|------|----------|
| 로그인 버튼이 안 보임 | `js/sync.config.js`에서 `ENABLED: true` 확인 |
| "CORS 오류" 발생 | Supabase 대시보드 → Authentication → Providers → Google의 Redirect URI 확인 |
| 동기화가 안 됨 | 브라우저 개발자 도구 Console에서 `Sync.getStatus()` 입력. `error`면 자세한 메시지 확인 |
| 401 인증 오류 | anon key가 올바른지 확인. service_role key 사용 금지 |
| 데이터 중복 | `js/sync.config.js`의 `SUPABASE_URL`이 올바른 프로젝트를 가리키는지 확인 |

## 보안 참고

- **anon key는 공개해도 안전합니다** — RLS 정책이 사용자별 데이터 접근을 제한합니다
- service_role key는 절대 클라이언트에 사용하지 마세요
- 모든 동기화는 RLS를 통해 사용자 인증 후 이루어집니다
