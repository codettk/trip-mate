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
  "time": "08:20",          // 시작. 빈 문자열 허용
  "endTime": "10:45",       // 종료. 선택. time 보다 이르면 익일이다 (야간 이동)
  "cat": "stay|pkg|spot|food|move",
  "title": "김포 → 제주",
  "meta": "4인 왕복",
  "booked": true,
  "checkIn": "2026-09-12",  // cat==="stay" 전용, null 허용 — 날짜
  "checkOut": "2026-09-14",
  "checkInTime": "15:00",   // cat==="stay" 전용 — 시각. 날짜와 별개 컬럼이다
  "checkOutTime": "11:00",

  "split": true,            // ← 이게 false 면 아래 다섯을 서버가 강제로 비운다
  "cost": 316000,
  "cur": "KRW",
  "payerId": "uuid|null",   // 사전 배정하지 않는다
  "shared": { "members": ["uuid"], "guests": 0 },
  "settled": false          // 이미 주고받은 건. 금액은 남기고 계산에서만 뺀다
}
```

- `rate` 는 **클라이언트가 보내지 않는다.** 서버가 그 항목 일자의 마감 환율을 스냅샷해 저장한다.
  **시각만 고쳐서는 환율이 다시 잡히지 않는다** — 이미 굳은 환산액이 흔들리면 안 된다.
- `split:false` 로 저장하면 `cost:0, cur:그룹기본, rate:1, payerId:null, shared:{[],0}, settled:false` 로 확정된다.
- **`settled` 는 `split:false` 와 다르다.** 정산 제외는 금액 자체를 지우고, `settled` 는
  **금액·결제자·대상을 그대로 둔 채 계산에서만 뺀다.** 현장에서 그 자리에 나눠 낸 지출용이다.
  `settled:true` 인 항목은 `pending`(결제자 미지정)·`noTarget`(대상 없음)으로도 세지 않는다 —
  이미 끝난 건이 마감을 막으면 안 되기 때문이다. 실제 결제액(`spent`)에는 남고
  정산 반영액(`paid`)에는 들어가지 않으며, 그 차이는 `balance[].settled` 로 따로 내려간다.
  켜고 끄는 것은 항목 PATCH 하나다: `PATCH /api/groups/:gid/items/:iid {"settled":true}`.
- `cat !== "stay"` 로 저장하면 `checkInTime`/`checkOutTime` 은 **400 없이 조용히 `""`** 가 된다.
  카테고리를 바꿨을 때 옛 값이 유령처럼 남는 걸 없애는 것이고, `split` 토글과 같은 처리다.
  다만 **형식이 틀린 값은 카테고리와 무관하게 400** 이다 — 오타를 삼키면 저장됐다고 믿게 된다.
- 시각은 전부 `""` 또는 `HH:MM` 이다. `endTime` 만 보내고 `time` 이 비어 있으면 400 —
  타임라인 정렬 키가 시작 시각이라 놓을 자리가 없다.

**Item 응답**

```jsonc
{
  "id","dayId","dayN","date","time","endTime","cat","title","meta","booked","thumb",
  "checkIn","checkOut","nights","checkInTime","checkOutTime",
  "nextDay": false,                      // endTime < time → 익일. 화면이 +1일 배지를 붙인다
  "duration": 90,                        // 분. 한쪽이라도 비면 null ("모른다"와 0분은 다르다)
  "split","cost","cur","rate","krw",     // krw = round(cost*rate). split=false 면 0
  "settled": false,                      // 이미 정산함 — krw 는 그대로 남는다
  "payerId","shared":{"members":[],"guests":0}
}
```

**숙소 칩 (`days[].stays[]`)**

```jsonc
{
  "itemId","title",
  "phase": "in|mid|out",                 // 체크인 / 숙박 중 / 체크아웃
  "nightIndex": 3,                       // 체크인한 날이 1박째. 체크아웃 날은 null
  "checkIn","checkOut","checkInTime","checkOutTime"
}
```

칩은 **일정 카드와 별개로 매일 다시 계산된다.** 숙소 항목 자체는 체크인한 날에만 남는다 —
매일 복제하면 같은 항목이 여러 번 있는 것처럼 보여 일정 개수와 금액 합계가 어긋난다.

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
  "total": 1658570,          // 정산 대상 지출 (정산 반영액 합). 이미 정산한 건은 빠져 있다
  "guestTotal": 51428,       // 기타 인원 몫
  "settledTotal": 0,         // 이미 주고받아 계산에서 뺀 금액. total 에 들어 있지 않다
  "myOwed": 415214,          // 로그인한 사람의 낼 돈. "1인당 평균"을 쓰지 않는다
  "closed": false,
  "doneCount": 0, "totalSteps": 5,
  // settled = 이 사람이 결제자인 "이미 정산함" 항목의 합. spent 에는 있고 paid 에는 없다
  "balance": [{ "id","name","left","spent","paid","settled","owed","net" }],
  "transfers": [{ "fromId","fromName","toId","toName","amt","state","canAct":"req"|"done"|null }],
  "collectors": [{ "id","name","amt","received","canAct":boolean }],
  "pending": [Item],         // 결제자 미지정 — 따로 안내
  "noTarget": [Item],        // 정산 대상 0명 — 따로 안내
  "excluded": [Item],        // 정산 제외 (금액 자체가 없다) — 조용히 사라지면 안 된다
  "settledItems": [Item],    // 이미 정산함 (금액은 살아 있다) — excluded 와 합치지 않는다
  "fxItems": [Item]
}
```

`canAct` 는 서버가 로그인한 멤버 기준으로 채운다. 프론트는 이걸 보고 버튼을 켠다.

## 폴더 · 사진

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/media/:pid` | 원본. 멤버 세션 또는 `?t=` 묶음 토큰 |
| GET | `/api/media/:pid/thumb` | 줄인 이미지. `?s=400`(그리드) 또는 `?s=1600`(상세). **원본과 똑같이 권한을 검사한다.** 저장소가 못 주면 원본으로 되돌아간다 |
| GET | `/api/groups/:gid/folders` | 전체 트리 `{root: FolderNode}` |
| GET | `/api/groups/:gid/folders/:fid` | `?sort=` 는 `up`(기본) 또는 `taken`. `{folder, breadcrumb, children, photos, sort}` |
| POST | `/api/groups/:gid/folders` | `{parentId, name}` |
| PATCH | `/api/groups/:gid/folders/:fid` | `{name?, parentId?}` — `parentId` 로 폴더를 옮긴다 |
| DELETE | `/api/groups/:gid/folders/:fid` | 하위까지. 루트는 불가 |
| POST | `/api/groups/:gid/folders/:fid/photos` | multipart 업로드. **지금 열어 둔 폴더에 올린다** |
| PATCH | `/api/groups/:gid/photos/:pid` | `{name?, takenAt?, folderId?}` — 올린 사람 또는 방장 |
| POST | `/api/groups/:gid/photos/move` | `{ids[], folderId}` → `{moved[], failed[]}` |
| DELETE | `/api/groups/:gid/photos/:pid` | 올린 사람 또는 방장 |
| GET | `/api/media/:pid` | 원본 스트림. 멤버 세션 또는 유효한 공유 토큰(`?t=`) 필요 |
| GET | `/api/media/:pid/thumb` | 같은 스트림 (트랜스코딩 없음) |

**FolderNode**: `{id, name, slug, parentId, photoCount, sharedIn: string[], children[]}`
`sharedIn` 은 그 폴더를 담고 있는 **공유 묶음 id 들**이다. 비어 있지 않으면 미디어가 밖으로 나가는 중이다.
**`pub`/`shareUrl`/`token` 필드는 없다** — 공유는 폴더가 아니라 묶음에 붙는다(아래).

**Photo 응답**: `{id,name,mime,size,folderId,uploadedAt,takenAt,takenFallback,url}`
`takenFallback:true` 면 촬영 메타데이터가 없어 업로드 시각을 쓴 것 — 화면에 배지로 알린다.
`takenAt` 을 `null` 로 PATCH 하면 그 상태로 되돌아간다 — 잘못 넣은 값을 되돌릴 방법이 있어야 한다.
`url` 은 항상 `/api/media/:id` 다. **Drive 링크나 서명 URL 을 절대 넣지 않는다.**

**이동 실패**: `failed[]` 는 `{id, name, reason}` 이다. 한 장이 막혀도 나머지는 옮긴다 —
부분 실패를 통째 실패로 만들면 사용자가 뭐가 됐는지 알 수 없다.
이미 그 폴더에 있는 사진은 `moved` 에도 `failed` 에도 들어가지 않는다.

**폴더 이동**은 자기 자신·자손 밑으로 갈 수 없고(트리가 고리가 된다) 루트는 옮길 수 없다.
검사는 core 의 `canMoveFolder` 한 벌이고 실패 사유가 400 문장으로 그대로 나온다.

**사진 이름을 바꾸면 저장소 파일명도 따라간다**(`StorageAdapter.renameFile`).
`storage_key` 는 바뀌지 않으므로 이미 나간 링크가 깨지지 않는다.
저장소 호출이 실패해도 요청은 성공한다 — DB 가 정본이고, Drive 이름 하나 때문에 사용자의 수정을 되돌리는 게 더 나쁘다.
로컬 드라이버는 아무 일도 하지 않는다(디스크 파일명이 곧 `storage_key` 인 UUID 라 사람이 볼 일이 없다).

## 공유 묶음 (멤버 전용)

공유는 **폴더가 아니라 묶음에 붙는다.** 한 모임에 용도별로 여러 개를 두고, 묶음마다 폴더를 골라 담는다.
경위는 `docs/decisions/2026-08-19-sharing-and-times.md` 에 있다.

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/groups/:gid/shares` | `{shares: [Share]}` |
| POST | `/api/groups/:gid/shares` | `{label?, entries?}` → 새 토큰 발급 |
| PATCH | `/api/groups/:gid/shares/:sid` | `{label?, entries?}` — **토큰은 그대로다** |
| DELETE | `/api/groups/:gid/shares/:sid` | 중지 → 링크 즉시 사망 |
| POST | `/api/groups/:gid/shares/:sid/rotate` | 토큰 재발급 → 옛 주소 즉시 사망 |

**Share 응답**

```jsonc
{
  "id": "uuid",
  "label": "부모님께",
  "url": "https://tripmate.app/{gid}/view/{token}",  // 토큰은 여기에만 있다
  "entries": [{ "folderId": "uuid", "includeDescendants": true }],
  "folderCount": 3,      // resolveShared 결과 크기 — 딸려 나가는 폴더까지 센 실제 개수
  "photoCount": 41,
  "createdAt": "2026-08-19T…"
}
```

- `includeDescendants` 면 그 아래 **모든 깊이**가 따라 나가고, **나중에 만든 하위 폴더도 자동으로 포함된다.**
  화면은 자동으로 들어온 폴더에 배지를 붙여 알린다 — 모르고 새면 안 된다.
- `entries` 에 같은 폴더가 두 번 오면 **좁은 쪽(`false`)으로 합친다.** 넓은 쪽을 고르면
  공유 모달이 보여 준 개수보다 많이 나간다.
- **묶음에서 폴더를 빼면 그 폴더만 즉시 안 보이고 링크 주소는 그대로 산다.**
- 토큰은 묶음 id 나 폴더 id 에서 **파생시키지 않는다.** 발급할 때마다 난수다.
- 폴더 집합을 푸는 계산은 core 의 `resolveShared` **한 벌**이다 —
  공유 모달의 "몇 개 폴더가 나갑니다"와 서버의 권한 검사가 다르면 그게 유출이다.

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
| GET | `/api/view/:gid/share/:token` | 묶음 루트 |
| GET | `/api/view/:gid/share/:token/:slug` | 묶음 **안**의 폴더 하나 |
| GET | `/api/view/:gid/folder/:slug?t=token` | 옛 주소 호환 — 이미 뿌린 링크가 있어 살려 뒀다 |
| GET | `/api/view/:gid/settle/:token` | 읽기 전용 정산. 이름·금액·이체 목록만 |

**뷰어 응답**

```jsonc
{
  "memberView": false, "groupId": "uuid",
  "group": { "name": "제주도 4박 5일" },
  "link":  { "label": "부모님께" },
  "folder": { "name": "Day 1 · 성산", "slug": "day-1-성산" },  // null 이면 최상위가 여럿인 가상 루트
  "breadcrumb": [{ "name", "slug" }],               // 묶음 루트까지만. 바깥 조상은 없다
  "folders":    [{ "name", "slug", "photoCount" }], // 폴더 id 가 없다 — 이동은 slug 로만
  "photos":     [{ "id","name","mime","uploadedAt","takenAt","takenFallback","url" }],
  "sort": "up"
}
```

- **묶음에 없는 폴더는 목록에 나타나지도 않는다.** 존재를 알리지 않는다.
  묶음 밖 slug 로 직접 접근해도 404 다. **뷰어의 모든 실패는 404 다 — 403 을 쓰지 않는다.**
- 뷰어 Photo 에는 `size` 와 `folderId` 가 없다. 멤버용 응답에만 있다.
- **문서·정산·일정으로 가는 길이 없다.** 밖으로 나가는 것은 미디어뿐이다.
- `memberView:true` 여도 **내용은 그대로 내려간다.** 폴더 링크는 자동으로 앱에 보내지 않고
  화면이 "이 모임의 멤버입니다 · 앱에서 열기" 배너만 띄운다 —
  방장이 외부인 시점을 확인하려고 여는 경우가 있기 때문이다.
  **정산 링크는 예외로 자동 이동한다** — 원래 그렇게 정해졌다.
- 나간 멤버는 `memberView:false` 다. 밖의 사람으로 취급된다.
