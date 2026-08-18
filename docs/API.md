# TripMate API 계약

모든 응답은 JSON. 실패는 `{ error: { message, code, detail? } }` 하나로 통일한다.
인증은 httpOnly 세션 쿠키(`tm_session`). `credentials: "include"` 로 부른다.

`:gid` 는 모임 id. **뷰어 라우트(`/api/view/*`)를 뺀 모든 라우트가 "이 사람이 이 모임의 안 나간 멤버인가"를 먼저 확인한다.**

---

## 상태

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/health` | 인증 없이 열린다. `{ ok:true, authMode, storage:{driver,healthy} }` — 컴포즈 헬스체크가 쓴다. 저장소 **식별자나 자격증명은 담지 않는다** |

## 인증

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/auth/me` | `{ user: {id,name,kakaoId,avatarUrl} \| null, authMode }` |
| POST | `/api/auth/mock` | 개발 전용. `{name}` → 로그인. `AUTH_MODE=mock` 일 때만 |
| GET | `/api/auth/kakao?next=` | 카카오로 리다이렉트 |
| GET | `/api/auth/kakao/callback` | 로그인 후 `APP_ORIGIN + next` 로 리다이렉트 |
| POST | `/api/auth/logout` | 세션 삭제 |

## 모임

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/groups` | 내 모임 목록 (스위처용). `{groups:[{id,name,dest,start,end,cur,memberCount,role}]}` |
| POST | `/api/groups` | 생성. body `{name,dest,start,end,memo}` → `{id}`. 일차·루트폴더·방장멤버가 함께 생긴다 |
| GET | `/api/groups/:gid` | 상세 `{group, days, members, me:{memberId,role}}` |
| PATCH | `/api/groups/:gid` | `{name?,dest?,start?,end?,memo?,cur?}`. 방장만. 이름을 바꾸면 루트 폴더도 리네임 |
| DELETE | `/api/groups/:gid` | 소프트 삭제. 방장만. Drive 폴더는 지우지 않는다 |
| GET | `/api/groups/:gid/members` | 전원 (나간 멤버 포함, `left:true`) |
| PATCH | `/api/groups/:gid/members/:mid` | `{role:"owner"}` 방장 위임. 방장만 |
| DELETE | `/api/groups/:gid/members/:mid` | 내보내기(방장) / 나가기(본인). **행을 지우지 않고 `left_at` 을 찍는다** |
| GET | `/api/groups/:gid/leave-check` | 나가기 전 미정산 잔액 안내 `{net, warn:boolean}` |

## 초대

발급 후 **30분 절대 만료**. 새로 발급하면 이전 링크는 즉시 죽는다. 승인 절차는 없다.

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/groups/:gid/invite` | 방장만. 이전 초대를 revoke 하고 새로 발급 → `{code, url, expiresAt}` |
| GET | `/api/groups/:gid/invite` | 현재 유효한 초대 → `{code,url,expiresAt} \| null` |
| GET | `/api/invites/:code` | 로그인 불필요. `{group:{id,name,dest,start,end,memberCount}, valid, expiresAt}` |
| POST | `/api/invites/:code/accept` | 로그인 필요. 즉시 멤버가 된다 → `{groupId}`. 만료면 410 |

## 일정

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/groups/:gid/itinerary` | 일차 + 항목 전부. `{days:[{id,n,date,dow,label,items:[Item]}], stays}` |
| PATCH | `/api/groups/:gid/days/:did` | `{label}` |
| POST | `/api/groups/:gid/items` | 생성 |
| PATCH | `/api/groups/:gid/items/:iid` | 수정 |
| DELETE | `/api/groups/:gid/items/:iid` | 삭제 |
| GET | `/api/groups/:gid/rates?date=&cur=` | 그 일자의 마감 환율 `{rate}`. 폼에서 즉시 환산액을 보여줄 때 |

**Item 본문 (POST/PATCH)**

```jsonc
{
  "dayId": "uuid",
  "time": "08:20",          // 빈 문자열 허용
  "cat": "stay|pkg|spot|food|move",
  "title": "김포 → 제주",
  "meta": "4인 왕복",
  "booked": true,
  "checkIn": "2026-09-12",  // cat==="stay" 전용, null 허용
  "checkOut": "2026-09-14",

  "split": true,            // ← 이게 false 면 아래 넷을 서버가 강제로 비운다
  "cost": 316000,
  "cur": "KRW",
  "payerId": "uuid|null",   // 사전 배정하지 않는다
  "shared": { "members": ["uuid"], "guests": 0 }
}
```

- `rate` 는 **클라이언트가 보내지 않는다.** 서버가 그 항목 일자의 마감 환율을 스냅샷해 저장한다.
- `split:false` 로 저장하면 `cost:0, cur:그룹기본, rate:1, payerId:null, shared:{[],0}` 으로 확정된다.

**Item 응답**

```jsonc
{
  "id","dayId","dayN","date","time","cat","title","meta","booked","thumb",
  "checkIn","checkOut","nights",
  "split","cost","cur","rate","krw",     // krw = round(cost*rate). split=false 면 0
  "payerId","shared":{"members":[],"guests":0}
}
```

## 정산

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/groups/:gid/settlement` | 전체 계산 결과 (아래) |
| PUT | `/api/groups/:gid/settlement/transfers/:from/:to` | `{state:"req"\|"done"\|null}`. **로그인한 사람에게 해당하는 것만 허용** — `req` 는 보낸 사람, `done` 은 받는 사람 |
| PUT | `/api/groups/:gid/settlement/guest-back/:mid` | `{received:boolean}`. 결제자 본인만 |
| GET | `/api/groups/:gid/settlement/share` | `{url, token}` |
| POST | `/api/groups/:gid/settlement/share/rotate` | 토큰 재발급. 방장만 |

**정산 응답**

```jsonc
{
  "total": 1658570,          // 정산 대상 지출 (정산 반영액 합)
  "guestTotal": 51428,       // 기타 인원 몫
  "myOwed": 415214,          // 로그인한 사람의 낼 돈. "1인당 평균"을 쓰지 않는다
  "closed": false,
  "doneCount": 0, "totalSteps": 5,
  "balance": [{ "id","name","left","spent","paid","owed","net" }],
  "transfers": [{ "fromId","fromName","toId","toName","amt","state","canAct":"req"|"done"|null }],
  "collectors": [{ "id","name","amt","received","canAct":boolean }],
  "pending": [Item],         // 결제자 미지정 — 따로 안내
  "noTarget": [Item],        // 정산 대상 0명 — 따로 안내
  "excluded": [Item],        // 정산 제외 — 조용히 사라지면 안 된다
  "fxItems": [Item]
}
```

`canAct` 는 서버가 로그인한 멤버 기준으로 채운다. 프론트는 이걸 보고 버튼을 켠다.

## 폴더 · 사진

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/groups/:gid/folders` | 전체 트리 `{root: FolderNode}` |
| GET | `/api/groups/:gid/folders/:fid?sort=up\|taken` | `{folder, breadcrumb, children, photos}` |
| POST | `/api/groups/:gid/folders` | `{parentId, name}` |
| PATCH | `/api/groups/:gid/folders/:fid` | `{name}` |
| PUT | `/api/groups/:gid/folders/:fid/public` | `{pub:boolean}` → 공개 시 **새 토큰**, 비공개 시 null |
| DELETE | `/api/groups/:gid/folders/:fid` | 하위까지. 루트는 불가 |
| POST | `/api/groups/:gid/folders/:fid/photos` | multipart 업로드. **지금 열어 둔 폴더에 올린다** |
| DELETE | `/api/groups/:gid/photos/:pid` | 올린 사람 또는 방장 |
| GET | `/api/media/:pid` | 원본 스트림. 멤버 세션 또는 유효한 뷰어 토큰(`?t=`) 필요 |
| GET | `/api/media/:pid/thumb` | 같은 스트림 (트랜스코딩 없음) |

**Photo 응답**: `{id,name,mime,size,folderId,uploadedAt,takenAt,takenFallback,url}`
`takenFallback:true` 면 촬영 메타데이터가 없어 업로드 시각을 쓴 것 — 화면에 배지로 알린다.
`url` 은 항상 `/api/media/:id` 다. **Drive 링크나 서명 URL 을 절대 넣지 않는다.**

## 문서

모임 멤버 전용. **외부 공개 토글이 없다.**

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/groups/:gid/docs` | 목록 |
| POST | `/api/groups/:gid/docs` | `{title}` |
| GET | `/api/groups/:gid/docs/:did` | `{doc, blocks}` |
| PATCH | `/api/groups/:gid/docs/:did` | `{title?, version}` 낙관적 잠금 |
| DELETE | `/api/groups/:gid/docs/:did` | |
| POST | `/api/groups/:gid/docs/:did/blocks` | `{kind, position?}` |
| PATCH | `/api/groups/:gid/docs/:did/blocks/:bid` | `{content?, position?}` |
| DELETE | `/api/groups/:gid/docs/:did/blocks/:bid` | |

## 공개 뷰어 (로그인 불필요)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/view/:gid/folder/:slug?t=token` | 그 폴더의 **미디어만**. 하위·다른 폴더로 이동 불가 |
| GET | `/api/view/:gid/settle/:token` | 읽기 전용 정산. 이름·금액·이체 목록만 |

뷰어 응답에는 하위 폴더 목록도, 문서도, 일정도 넣지 않는다.
멤버가 정산 링크를 열면 프론트가 앱 정산 화면으로 보낸다 (`memberView:true` 플래그).
