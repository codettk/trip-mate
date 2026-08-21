# apps/site — 공개 정적 페이지

빌드 도구가 없다. HTML 3장이 전부고 그대로 배포된다.

```
index.html     소개
privacy.html   개인정보처리방침
style.css      팔레트는 CLAUDE.md 의 디자인 방향 그대로
```

## 왜 있나

Google 이 **OAuth 앱을 프로덕션으로 게시하려면 홈페이지 URL 과 개인정보처리방침 URL 을 요구**한다.
게시하지 않으면 리프레시 토큰이 **7일마다 만료**된다.
`drive.file` 은 민감 스코프가 아니라 심사(verification)는 면제되지만, **게시 자체에는 이 URL 두 개가 필요하다.**

경위는 `docs/decisions/2026-08-22-kakao-and-drive-live.md`.

## 로컬에서 보기

```
node .data/tmp/serve-site.mjs      # http://localhost:8899
```

또는 `index.html` 을 브라우저로 그냥 연다 (상대 경로라 CSS 도 붙는다).

## 배포 — Cloudflare Pages

도메인이 Cloudflare 로 위임돼 있으므로 **DNS 레코드를 손으로 만들 필요가 없다.**
Pages 에 커스텀 도메인을 붙이면 CNAME 이 자동으로 생긴다.

1. Cloudflare → **Workers 및 Pages** → **만들기** → **Pages** → **직접 업로드**
2. 이 폴더(`apps/site`)의 파일 3개를 올린다
3. 배포된 프로젝트 → **사용자 지정 도메인** → 서브도메인 입력

Git 연동으로 붙일 경우 빌드 명령은 **비워 두고**, 출력 디렉터리를 `apps/site` 로 둔다.

## 고치기 전에

- **연락처 이메일이 두 곳에 하드코딩돼 있다** (`index.html` 푸터, `privacy.html` 10항과 푸터).
  바꾸려면 세 군데를 같이 고친다.
- 개인정보처리방침의 내용은 **실제 코드 동작과 맞춰 쓴 것**이다. 아래가 바뀌면 이 문서도 같이 고친다.
  | 문서에 적힌 것 | 근거 |
  |---|---|
  | 카카오에서 닉네임·프로필 이미지 주소만 받는다 | `apps/api/src/auth/routes.ts` |
  | 세션 30일 | `apps/api/src/auth/session.ts` `TTL_MS` |
  | 초대 링크 30분 | `CLAUDE.md` 확정 규칙 |
  | Drive 접근은 `drive.file` 로 한정 | `.env` 의 스코프, `apps/api/src/storage/gdrive.ts` |
  | 문서는 외부 공유 대상이 아니다 | `packages/core/src/share.ts` `resolveShared()` |
