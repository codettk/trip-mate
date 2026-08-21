# TripMate

여행 모임 하나를 **일정표 · 사진 · 정산 · 문서**로 함께 굴리는 웹 서비스.

여행 하나를 준비하는 데 노션(일정), 카톡 앨범(사진), 정산 앱(돈)이 따로 논다.
TripMate 는 이 넷을 **하나의 여행 모임 = 하나의 작업 공간**으로 합친다.

기획의 정본은 [`CLAUDE.md`](CLAUDE.md) 다. 이 문서는 **어떻게 돌리는가**만 다룬다.

---

## 빠르게 띄우기

```bash
cp .env.example .env          # SESSION_SECRET 만 아무 32자 이상으로 바꾸면 된다
npm install
npm run db:up                 # Postgres 17 (도커, 5433 포트)
npm run db:migrate
npm run db:seed               # 제주도 4박 5일 데모 — 정산이 실제로 계산된다
npm run dev:api               # http://localhost:4000
npm run dev:web               # http://localhost:5173
```

브라우저에서 <http://localhost:5173> → **목 로그인**으로 `지현` 을 넣으면 방장으로 들어간다.
카카오 앱 키 없이 전체 기능을 테스트할 수 있다 (`AUTH_MODE=mock`).

계정을 갈아 끼우며 정산 버튼 권한을 확인하려면 로그인 화면의 칩(`지현 · 민수 · 수아 · 윤호`)을 쓴다.
**이체 버튼은 로그인한 사람에게 해당하는 것만 활성화된다.**

전체 스택을 도커로 띄우려면:

```bash
npm run docker:up             # db + api + web(nginx) → http://localhost:8080
```

> `.env` 의 `APP_ORIGIN` 을 `http://localhost:8080` 으로 바꿔야 초대·공유 링크가 그 주소로 만들어진다.
> 그리고 **목 로그인으로 전체 스택을 테스트하려면 `.env` 에 `NODE_ENV=development` 가 있어야 한다** —
> API 는 운영 모드에서 목 로그인을 거부하고 부팅을 멈춘다. 그 가드는 일부러 남겨 뒀다.

---

## 폴더 구조

```
trip-mate/
├─ packages/
│  └─ core/                        서버와 브라우저가 같은 코드로 돌려야 하는 것
│     └─ src/
│        ├─ settle.ts              ★ 정산 알고리즘 정본 (+ verifySettlement, previewSplit)
│        ├─ settle.test.ts           프로토타입 재현 + 무작위 1000케이스 불변식
│        ├─ currency.ts            통화 13종 · 여행지→통화 추론 · 금액 표기
│        ├─ dates.ts               일차 자동 생성 · 숙소 기간 · 요일
│        ├─ dates.test.ts
│        ├─ slug.ts                슬러그 · 공유 토큰 · 뷰어/초대 경로
│        └─ types.ts               도메인 타입 (CLAUDE.md 의 데이터 모델과 1:1)
│
├─ apps/
│  ├─ api/                         Fastify 5 + Kysely + Postgres
│  │  ├─ Dockerfile
│  │  └─ src/
│  │     ├─ index.ts               부트스트랩 (부팅 시 마이그레이션 자동 적용)
│  │     ├─ app.ts                 Fastify 조립 · 에러 핸들러 · 라우트 등록
│  │     ├─ env.ts                 환경변수 검증 (잘못되면 부팅에서 터진다)
│  │     ├─ db/
│  │     │  ├─ types.ts            Kysely Database 인터페이스 (손으로 SQL 과 맞춘다)
│  │     │  ├─ client.ts           풀 · numeric→number 변환
│  │     │  ├─ migrate.ts          마이그레이션 러너 (파일 하나 = 트랜잭션 하나)
│  │     │  ├─ migrations/*.sql    평문 SQL
│  │     │  └─ seed.ts             데모 데이터 + 정산 기대값 자체 검증
│  │     ├─ auth/
│  │     │  ├─ routes.ts           카카오 OAuth + 개발용 목 로그인
│  │     │  ├─ session.ts          DB 세션 + httpOnly 쿠키
│  │     │  └─ membership.ts       requireMember / requireOwner
│  │     ├─ modules/               도메인별 라우트 — 여기가 REST 표면
│  │     │  ├─ groups.ts  invites.ts  itinerary.ts  settlement.ts
│  │     │  └─ folders.ts  photos.ts  docs.ts  share.ts
│  │     ├─ services/              라우트가 공유하는 로직
│  │     │  ├─ groups.ts           모임 생성 · 이름 변경 · 일차 동기화
│  │     │  ├─ settlement.ts       DB → core.settle() → 불변식 검증
│  │     │  └─ folders.ts          트리 · 공개 토글 · 토큰 재발급
│  │     ├─ storage/               ★ Drive 를 어댑터 뒤에 숨긴다
│  │     │  ├─ index.ts            StorageAdapter 인터페이스
│  │     │  ├─ local.ts            개발·테스트용 디스크
│  │     │  └─ gdrive.ts           운영자 Drive (OAuth 시크릿 + 리프레시 토큰)
│  │     ├─ rates/provider.ts      일자별 마감 환율 (fx_rates 테이블이 정본)
│  │     └─ lib/http.ts            ApiError 와 상태코드 헬퍼
│  │
│  └─ web/                         React 19 + Vite + TanStack Query
│     ├─ Dockerfile  nginx.conf
│     └─ src/
│        ├─ App.tsx                라우팅 (화면 4개 + 설정 + 뷰어 2개뿐)
│        ├─ styles/app.css         ★ 프로토타입에서 그대로 가져온 디자인 시스템
│        ├─ api/
│        │  ├─ client.ts           fetch 래퍼 · mediaUrl
│        │  ├─ types.ts            서버 응답 타입 (docs/API.md 와 1:1)
│        │  └─ hooks.ts            쿼리 키 · 훅 · 모임 단위 캐시 무효화
│        ├─ components/            Modal · ConfirmModal · Icon · Won/Fx · Avatar · Badge
│        ├─ layout/Shell.tsx       사이드바 + 헤더 + 모임 스위처
│        ├─ screens/
│        │  ├─ Itinerary.tsx       일정 — 일차 탭 · 숙소 칩 · 타임라인 · 우측 레일
│        │  ├─ Photos.tsx          사진 — 앨범 목록이 아니라 폴더 탐색기
│        │  ├─ Settlement.tsx      정산 — 장부 + 정산서 2단
│        │  ├─ Docs.tsx            문서 — 자유 블록 (외부 공유 없음)
│        │  ├─ Settings.tsx        모임 설정 · 멤버 관리 · 나가기
│        │  ├─ Login/Onboarding/Join.tsx
│        │  └─ viewer/             ★ 로그인하지 않는 공개 화면
│        │     ├─ FolderViewer.tsx   그 폴더의 미디어만
│        │     └─ SettleViewer.tsx   읽기 전용 정산
│        └─ modals/                ItemModal · ItemDetailModal · NewGroup · Invite · ShareSettle
│
├─ prototype/index.html            의존성 없는 단일 파일 프로토타입 (기획의 시각적 정본)
├─ docs/
│  ├─ API.md                       REST 계약
│  ├─ WORKFLOW.md                  멀티에이전트 운용 규칙
│  ├─ decisions/                   확정된 판단과 그 근거
│  └─ design/pencil/               Pencil 디자인
├─ .claude/agents/                 서브에이전트 정의 4종
├─ docker-compose.yml              db · db-test · api · web
├─ CLAUDE.md                       ★ 기획 정본 — 바꾸려면 사용자 승인
└─ .env.example
```

`★` 는 건드리기 전에 `CLAUDE.md` 를 다시 읽어야 하는 곳이다.

---

## 명령어

| 명령 | 설명 |
|---|---|
| `npm run dev:api` / `dev:web` | 개발 서버 |
| `npm run build` | core → api → web 순서로 빌드 |
| `npm run typecheck` | 전 workspace 타입체크 |
| `npm test` | 전 workspace 테스트 |
| `npm run test:core` | 정산 알고리즘 — **잔액 합 0 · 이체 합 일치 · 전부 정수** |
| `npm run test:db:up` | 통합 테스트용 Postgres (5434 포트, tmpfs) |
| `npm run test:api` | API 통합 — 실제 Postgres 에 붙는다 (`test:db:up` 먼저) |
| `npm run test:web` | 화면 렌더 + 확정 규칙 감사 (jsdom) |
| `npm run db:up` / `db:down` | Postgres 컨테이너 |
| `npm run db:migrate` / `db:reset` / `db:seed` | 스키마와 데모 데이터 |
| `npm run docker:up` / `docker:down` | 전체 스택 |

---

## 아키텍처에서 알아둘 것

### 정산은 한 벌만 존재한다

`packages/core/src/settle.ts` 가 정본이고, **서버와 브라우저가 같은 코드를 돌린다.**
지출 폼 안에서 "1인 몫이 얼마"를 즉시 보여줘야 하는데, 그 값이 서버 결과와 1원이라도
다르면 안 되기 때문이다. 두 벌 구현을 금지한다.

계산을 건드리면 세 가지를 반드시 확인한다 — **잔액 합이 정확히 0, 이체 합이 채권 합과 일치,
모든 값이 정수.** `verifySettlement()` 이 이 셋을 한 번에 돌려주고,
API 는 정산 결과를 내보내기 전에 이걸 통과시킨다. 틀린 금액을 조용히 보여주느니 500 이 낫다.

### 저장소는 어댑터 뒤에 있다

```
STORAGE_DRIVER=local   → 서버 디스크 (.data/storage)   개발·테스트 기본값
STORAGE_DRIVER=gdrive  → 운영자 Google Drive           키만 넣으면 켜진다
```

**Drive 파일 링크나 서명 URL 은 어떤 경로로도 브라우저에 노출되지 않는다.**
이미지는 항상 `/api/media/:id` 로 나가고, 서버가 저장소에서 받아 전달한다.
그래야 "이 폴더의 미디어만" 이라는 범위를 앱이 통제할 수 있다.

### 환율은 스냅샷된다

항목을 저장하는 시점에 **그 항목이 속한 일자의 마감 환율**을 `items.rate` 에 박아 둔다.
환율표가 나중에 갱신돼도 이미 정산된 금액이 흔들리지 않는다.
통화나 일차가 바뀔 때만 다시 뜬다.

어느 API 의 마감 환율을 쓸지는 아직 안 정했다. 그래서 `fx_rates` 테이블이 정본이고
`RateProvider` 인터페이스가 그 표를 채운다 — 나중에 어댑터 하나만 갈아 끼우면 된다.

---

## Google Drive 연동

실제 자격증명으로 왕복 검증을 마쳤다 (2026-08-22).
경위와 남은 것은 `docs/decisions/2026-08-22-kakao-and-drive-live.md`.

1. Google Cloud Console 에서 **OAuth 클라이언트 → 데스크톱 앱**을 만든다.
   (루프백으로 리프레시 토큰을 받기 위해서다. 웹 애플리케이션이면 리디렉션 URI 를 따로 등록해야 한다.)
2. 스코프는 **`https://www.googleapis.com/auth/drive.file`** 하나면 된다.
   전체 `drive` 스코프는 **민감 스코프라 심사를 받아야** 하고, 우리는 우리가 만든 파일만 다루므로 필요 없다.
   서비스 계정 키도, API 키도 아니다 — **API 키로는 업로드가 되지 않는다.**
3. `.env` 를 채운다:
   ```
   STORAGE_DRIVER=gdrive
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REFRESH_TOKEN=...
   GOOGLE_DRIVE_ROOT_FOLDER_ID=...     # 비우면 내 드라이브 루트
   ```
4. API 를 재시작한다. 부팅 시 값이 비어 있으면 **거부하고 무엇이 없는지 알려준다.**
5. `/api/health` 의 `storage.healthy` 가 `true` 인지 확인한다.

모임 폴더는 그때부터 Drive 에 생긴다. **최상위 폴더 이름 = 여행 모임 제목**이고,
모임 이름을 바꾸면 Drive 폴더도 리네임된다 (`folderId` 는 유지되므로 링크가 깨지지 않는다).

### `GOOGLE_DRIVE_ROOT_FOLDER_ID` 에는 손으로 만든 폴더를 넣어도 된다

`drive.file` 은 "앱이 만든 파일만" 접근하는 스코프라, 사람이 Drive 화면에서 만든 폴더는
**읽지 못한다.** 그런데 **그 안에 만드는 것은 된다.** 실제로 확인한 결과다.

```
files.get(그 폴더)                     404 File not found
files.create(parents=[그 폴더])        OK   ← 자식 생성은 통과
```

`GoogleDriveAdapter.root()` 는 오직 `createFolder` 의 `parents:` 값으로만 쓰이고
**어디서도 읽거나 목록을 부르지 않는다.** 그래서 이 제약과 맞아떨어진다.

> ⚠ 이 파일에 `files.list` 를 새로 넣지 말 것. `drive.file` 의 목록은
> **같은 OAuth 클라이언트로 만든 다른 앱의 파일까지 함께 돌려준다.**
> 지금 구조는 항상 `parents` 를 명시해 만들기만 하므로 남의 파일에 닿을 통로가 없다.

폴더 ID 는 Drive 주소창에서 딴다 — `https://drive.google.com/drive/folders/<이 부분>`.

### 저장소를 바꿀 때 — 조용히 깨진다

`STORAGE_DRIVER` 는 전역 스위치인데 `photos.storage_key` 형식은 드라이버마다 다르다
(local 은 `{폴더uuid}/{파일uuid}`, gdrive 는 Drive fileId).
**드라이버를 바꾸면 이미 올라간 사진이 전부 404 가 된다.** 경고도 없다.

바꾸기 전에 사진이 있는지 확인하고, 있으면 폴더를 Drive 에 새로 만들어
파일을 올린 뒤 `folders.drive_folder_id` 와 `photos.storage_key` 를 갈아 끼워야 한다.

---

## 카카오 로그인 연동

```
AUTH_MODE=kakao
KAKAO_REST_API_KEY=...
KAKAO_CLIENT_SECRET=...            # 카카오 콘솔에서 사용 설정한 경우만
KAKAO_REDIRECT_URI=http://localhost:4000/api/auth/kakao/callback
```

**로그인은 카카오 하나만 지원한다.** 이메일·비밀번호나 구글 로그인을 덧붙이지 않는다.
`AUTH_MODE=mock` 은 개발 전용이라 `NODE_ENV=production` 에서 부팅을 거부한다.

---

## 아직 안 정한 것

`docs/decisions/2026-08-17-implementation-choices.md` 에 판단 근거와 함께 정리돼 있다.
큰 것만 옮기면:

- 환율 데이터 출처 — 어느 API 의 마감 환율을 쓸 것인가
- 동영상 트랜스코딩 (지금은 원본 그대로, 파일당 200MB 상한)
- 실시간 동기화 (지금은 쿼리 무효화로만)
- 배포 대상
