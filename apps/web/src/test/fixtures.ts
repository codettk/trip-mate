/**
 * ══════════ 서버 응답 픽스처 ══════════
 *
 * 값은 전부 `apps/api/src/db/seed.ts` 와 같다 — 시드가 프로토타입 settle() 의 숫자를
 * 검증하고 있으므로, 여기 숫자가 시드와 어긋나면 화면 테스트가 의미를 잃는다.
 *
 *   모임    제주도 4박 5일 · 제주도 · 2026-09-12 ~ 2026-09-16 · KRW
 *   멤버    지현(방장) 민수 수아 윤호 + 기영(left)
 *   일차    5개, 09-14 에 숙소 2개 (씨에스호텔 체크아웃 + 오션스테이 체크인)
 *   정산    total 1,658,570 · guestTotal 51,428 · 이체 4건 · 미지정 3건 · 정산 제외 2건
 *
 * `settlement-math.test.ts` 가 이 픽스처를 @tripmate/core 의 settle() 결과와 대조한다.
 */

import { crossesMidnight, durationMinutes, nightIndex, resolveShared } from "@tripmate/core";
import type {
  DocDetail,
  DocSummary,
  FolderNodeDto,
  FolderView,
  GroupDetail,
  GroupSummary,
  InviteInfo,
  InvitePeek,
  Item,
  Itinerary,
  Me,
  Member,
  Settlement,
  ShareEntryDto,
  ShareList,
  ShareViewer,
} from "../api/types.ts";

export const GID = "g-jeju";
export const GROUP_NAME = "제주도 4박 5일";

/** 멤버 id — 로그인한 사람은 언제나 지현(방장)이다. */
export const M = {
  jh: "m-jh",
  ms: "m-ms",
  sa: "m-sa",
  yh: "m-yh",
  gy: "m-gy",
} as const;

export const ME: Me = {
  id: "u-jh",
  name: "지현",
  kakaoId: "mock:지현",
  avatarUrl: null,
};

export const members: Member[] = [
  { id: M.jh, userId: "u-jh", name: "지현", colorBg: "#E3EAFB", colorFg: "#2F53E0", role: "owner", left: false, joinedAt: "2026-08-01T00:00:00.000Z" },
  { id: M.ms, userId: "u-ms", name: "민수", colorBg: "#FBE4E8", colorFg: "#D8455C", role: "member", left: false, joinedAt: "2026-08-01T00:01:00.000Z" },
  { id: M.sa, userId: "u-sa", name: "수아", colorBg: "#F1E8FB", colorFg: "#7A4FD0", role: "member", left: false, joinedAt: "2026-08-01T00:02:00.000Z" },
  { id: M.yh, userId: "u-yh", name: "윤호", colorBg: "#DEF1EA", colorFg: "#12866A", role: "member", left: false, joinedAt: "2026-08-01T00:03:00.000Z" },
  // 나갔지만 정산에는 그대로 남는다
  { id: M.gy, userId: "u-gy", name: "기영", colorBg: "#EEF1F5", colorFg: "#8A94A6", role: "member", left: true, joinedAt: "2026-08-01T00:04:00.000Z" },
];

const DAY_META = [
  { id: "d1", n: 1, date: "2026-09-12", dow: "토", label: "도착 · 성산" },
  { id: "d2", n: 2, date: "2026-09-13", dow: "일", label: "우도 · 동부" },
  { id: "d3", n: 3, date: "2026-09-14", dow: "월", label: "서귀포 이동" },
  { id: "d4", n: 4, date: "2026-09-15", dow: "화", label: "한라산" },
  { id: "d5", n: 5, date: "2026-09-16", dow: "수", label: "출발 · 정산" },
];

export const days = DAY_META.map((d) => ({ id: d.id, n: d.n, date: d.date, dow: d.dow, label: d.label }));

export const groupSummary: GroupSummary = {
  id: GID,
  name: GROUP_NAME,
  dest: "제주도",
  start: "2026-09-12",
  end: "2026-09-16",
  cur: "KRW",
  memberCount: 4,
  role: "owner",
};

export const groupDetail: GroupDetail = {
  group: {
    id: GID,
    name: GROUP_NAME,
    dest: "제주도",
    start: "2026-09-12",
    end: "2026-09-16",
    memo: "렌터카 1대 · 숙소 2곳 (성산 2박 → 서귀포 2박)",
    cur: "KRW",
    ownerId: "u-jh",
    settleClosedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
  },
  days,
  members,
  me: { memberId: M.jh, role: "owner" },
};

/* ══════════ 일정 ══════════ */

const ALL = [M.jh, M.ms, M.sa, M.yh];

interface ItemSeed {
  id: string;
  dayN: number;
  time: string;
  cat: Item["cat"];
  title: string;
  meta: string;
  booked?: boolean;
  thumb?: string;
  split?: boolean;
  cost?: number;
  payerId?: string | null;
  members?: string[];
  guests?: number;
  checkIn?: string;
  checkOut?: string;
  nights?: number;
  /** 종료 시각. 비우면 시작 시각만 있는 항목이다 */
  endTime?: string;
  /** cat==="stay" 전용. 날짜는 checkIn/checkOut 이 들고 있다 */
  checkInTime?: string;
  checkOutTime?: string;
}

const ITEM_SEEDS: ItemSeed[] = [
  { id: "i1", dayN: 1, time: "08:20", cat: "move", title: "김포 → 제주 (KE1201)", meta: "4인 왕복 · 수하물 포함", split: true, cost: 316000, payerId: M.jh, members: ALL, booked: true },
  { id: "i2", dayN: 1, time: "11:00", cat: "move", title: "렌터카 픽업", meta: "쏘렌토 · 4박 5일 · 완전자차", split: true, cost: 240000, payerId: M.ms, members: ALL, booked: true },
  { id: "i3", dayN: 1, time: "12:30", cat: "food", title: "올레국수", meta: "공항 근처 · 고기국수 4인", split: true, cost: 42000, payerId: M.sa, members: ALL, thumb: "linear-gradient(140deg,#E4B77C,#C88A6B)" },
  // 결제자 미지정 ①
  { id: "i4", dayN: 1, time: "15:00", cat: "spot", title: "성산일출봉", meta: "입장 5,000원 · 도보 40분 코스", split: true, cost: 20000, payerId: null, members: ALL },
  { id: "i5", dayN: 1, time: "18:00", cat: "stay", title: "씨에스호텔 제주", meta: "트윈 2실 · 조식 포함", split: true, cost: 340000, payerId: M.jh, members: ALL, booked: true, checkIn: "2026-09-12", checkOut: "2026-09-14", nights: 2 },
  // 나간 멤버(기영) + 기타 인원 2명 — 정산의 핵심 확인 지점
  { id: "i6", dayN: 1, time: "20:00", cat: "food", title: "흑돼지 회식", meta: "기영 + 현지 친구 2명 합류", split: true, cost: 180000, payerId: M.sa, members: [...ALL, M.gy], guests: 2 },

  { id: "i7", dayN: 2, time: "09:00", cat: "pkg", title: "우도 종일 패키지", meta: "도선 왕복 + 전기차 + 가이드 · 4인", split: true, cost: 240000, payerId: M.yh, members: ALL, booked: true },
  // 정산 제외 ①
  { id: "i8", dayN: 2, time: "13:00", cat: "food", title: "해녀의집", meta: "성게미역국 · 우도 패키지에 포함" },
  // 결제자 미지정 ②
  { id: "i9", dayN: 2, time: "16:30", cat: "spot", title: "비자림", meta: "입장 3,000원 · 숲길 1시간", split: true, cost: 12000, payerId: null, members: ALL },
  // 전원 균등이 규칙이 아니라는 증거 — 두 명만 대상
  { id: "i10", dayN: 2, time: "19:30", cat: "food", title: "애월 카페 · 야경", meta: "지현·민수만 들름", split: true, cost: 28000, payerId: M.jh, members: [M.jh, M.ms] },

  { id: "i11", dayN: 3, time: "10:30", cat: "spot", title: "카멜리아힐", meta: "수국 시즌 · 입장 6,000원", split: true, cost: 24000, payerId: M.yh, members: ALL },
  // 09-14 = 씨에스호텔 체크아웃 + 오션스테이 체크인 → 하루에 숙소 2개
  { id: "i12", dayN: 3, time: "15:00", cat: "stay", title: "서귀포 오션스테이", meta: "복층 1채 · 바베큐 가능", split: true, cost: 300000, payerId: M.ms, members: ALL, booked: true, checkIn: "2026-09-14", checkOut: "2026-09-16", nights: 2 },
  // 결제자 미지정 ③
  { id: "i13", dayN: 3, time: "19:00", cat: "food", title: "올레시장 저녁", meta: "회 + 오메기떡", split: true, cost: 68000, payerId: null, members: ALL },

  // 정산 제외 ②
  { id: "i14", dayN: 5, time: "16:40", cat: "move", title: "제주 → 김포 (KE1210)", meta: "왕복 요금에 포함 — 정산 없음" },
];

function toItem(s: ItemSeed): Item {
  const day = DAY_META.find((d) => d.n === s.dayN)!;
  const split = s.split === true;
  return {
    id: s.id,
    dayId: day.id,
    dayN: day.n,
    date: day.date,
    time: s.time,
    endTime: s.endTime ?? "",
    cat: s.cat,
    title: s.title,
    meta: s.meta,
    booked: s.booked === true,
    thumb: s.thumb ?? null,
    checkIn: s.checkIn ?? null,
    checkOut: s.checkOut ?? null,
    nights: s.nights ?? 0,
    checkInTime: s.cat === "stay" ? (s.checkInTime ?? "") : "",
    checkOutTime: s.cat === "stay" ? (s.checkOutTime ?? "") : "",
    // 서버가 core 로 계산해 내려주는 값이다. 픽스처도 같은 함수로 만든다 —
    // 손으로 적으면 화면이 실제와 다른 값을 보고도 통과해 버린다.
    nextDay: crossesMidnight(s.time, s.endTime ?? ""),
    duration: durationMinutes(s.time, s.endTime ?? ""),
    split,
    // split=false 면 금액·결제자·대상이 실제로 비어 있다 (숨겨진 금액을 남기지 않는다)
    cost: split ? (s.cost ?? 0) : 0,
    cur: "KRW",
    rate: 1,
    krw: split ? (s.cost ?? 0) : 0,
    payerId: split ? (s.payerId ?? null) : null,
    shared: split ? { members: s.members ?? [], guests: s.guests ?? 0 } : { members: [], guests: 0 },
  };
}

export const items: Item[] = ITEM_SEEDS.map(toItem);

/** 09-14 에는 체크아웃하는 숙소와 새로 체크인하는 숙소가 겹친다 → 칩 2개 */
/**
 * 숙소 칩. 서버가 core 의 nightIndex() 로 계산해 내려주는 값이라
 * 여기서도 같은 함수로 만든다 — 손으로 적으면 화면이 틀린 값을 보고도 통과한다.
 */
type StaySeed = { itemId: string; title: string; phase: "in" | "mid" | "out" };
const STAY_SPAN: Record<string, { checkIn: string; checkOut: string; inT: string; outT: string }> = {
  i5: { checkIn: "2026-09-12", checkOut: "2026-09-14", inT: "15:00", outT: "11:00" },
  i12: { checkIn: "2026-09-14", checkOut: "2026-09-16", inT: "15:00", outT: "11:00" },
};
const STAYS: Record<number, StaySeed[]> = {
  1: [{ itemId: "i5", title: "씨에스호텔 제주", phase: "in" }],
  2: [{ itemId: "i5", title: "씨에스호텔 제주", phase: "mid" }],
  3: [
    { itemId: "i5", title: "씨에스호텔 제주", phase: "out" },
    { itemId: "i12", title: "서귀포 오션스테이", phase: "in" },
  ],
  4: [{ itemId: "i12", title: "서귀포 오션스테이", phase: "mid" }],
  5: [{ itemId: "i12", title: "서귀포 오션스테이", phase: "out" }],
};

export const itinerary: Itinerary = {
  days: DAY_META.map((d) => ({
    id: d.id,
    n: d.n,
    date: d.date,
    dow: d.dow,
    label: d.label,
    stays: (STAYS[d.n] ?? []).map((c) => {
      const sp = STAY_SPAN[c.itemId]!;
      return {
        ...c,
        nightIndex: nightIndex(d.date, sp.checkIn, sp.checkOut),
        checkIn: sp.checkIn,
        checkOut: sp.checkOut,
        checkInTime: sp.inT,
        checkOutTime: sp.outT,
      };
    }),
    items: items.filter((i) => i.dayN === d.n),
  })),
};

/* ══════════ 정산 ══════════ */

const brief = (id: string) => {
  const i = items.find((x) => x.id === id)!;
  return { id: i.id, title: i.title, dayN: i.dayN, date: i.date, cat: i.cat, cost: i.cost, cur: i.cur, krw: i.krw, payerId: i.payerId };
};

/**
 * 로그인한 사람은 지현이다.
 *  · 수아 → 지현 은 수아가 "송금 확인 요청"을 눌러 둔 상태(req) 라 지현이 "정산 완료"를 누를 수 있다.
 *  · 나머지 세 줄은 지현이 당사자가 아니거나 보낸 사람이 아니라 canAct 가 null 이다 — 버튼이 없어야 한다.
 */
export const settlement: Settlement = {
  total: 1658570,
  guestTotal: 51428,
  myOwed: 415214, // 지현의 낼 돈 ("1인당 평균"이 아니다)
  closed: false,
  closedAt: null,
  doneCount: 0,
  totalSteps: 5, // 이체 4건 + 기타 인원 수령 확인 1건
  balance: [
    { id: M.jh, name: "지현", left: false, spent: 684000, paid: 684000, owed: 415214, net: 268786 },
    { id: M.ms, name: "민수", left: false, spent: 540000, paid: 540000, owed: 415214, net: 124786 },
    { id: M.sa, name: "수아", left: false, spent: 222000, paid: 170570, owed: 401214, net: -230644 },
    { id: M.yh, name: "윤호", left: false, spent: 264000, paid: 264000, owed: 401214, net: -137214 },
    { id: M.gy, name: "기영", left: true, spent: 0, paid: 0, owed: 25714, net: -25714 },
  ],
  transfers: [
    { fromId: M.sa, fromName: "수아", toId: M.jh, toName: "지현", amt: 230644, state: "req", canAct: "done" },
    { fromId: M.yh, fromName: "윤호", toId: M.jh, toName: "지현", amt: 38142, state: null, canAct: null },
    { fromId: M.yh, fromName: "윤호", toId: M.ms, toName: "민수", amt: 99072, state: null, canAct: null },
    { fromId: M.gy, fromName: "기영", toId: M.ms, toName: "민수", amt: 25714, state: null, canAct: null },
  ],
  collectors: [{ id: M.sa, name: "수아", amt: 51428, received: false, canAct: false }],
  pending: [brief("i4"), brief("i9"), brief("i13")],
  noTarget: [],
  excluded: [brief("i8"), brief("i14")],
  fxItems: [],
};

/* ══════════ 폴더 ══════════ */

/**
 * 공유는 폴더가 아니라 묶음(share link)에 붙는다.
 * 그래서 폴더 노드에는 `pub`/`token` 이 없고, 대신 이 폴더를 담고 있는 묶음 id 들이
 * `sharedIn` 으로 온다 — 비어 있지 않으면 그 폴더의 미디어가 밖으로 나가는 중이다.
 */
const folder = (
  id: string,
  name: string,
  slug: string,
  parentId: string | null,
  children: FolderNodeDto[] = [],
): FolderNodeDto => ({
  id,
  name,
  slug,
  parentId,
  photoCount: 0,
  sharedIn: [],
  children,
});

export const SHARE_PARENTS = "sl-parents";
export const SHARE_MATES = "sl-mates";
export const SHARE_TOKEN_PARENTS = "tok-parents";
export const SHARE_TOKEN_MATES = "tok-mates";

const rawRoot: FolderNodeDto = folder("f-root", GROUP_NAME, "제주도-4박-5일", null, [
  folder("f-day1", "Day 1 · 성산", "day-1-성산", "f-root", [
    folder("f-sunrise", "일출봉", "일출봉", "f-day1"),
    folder("f-dinner", "저녁 · 흑돼지", "저녁-흑돼지", "f-day1"),
  ]),
  folder("f-day2", "Day 2 · 우도", "day-2-우도", "f-root"),
  folder("f-drone", "지현의 드론샷", "지현의-드론샷", "f-root"),
  folder("f-receipt", "영수증", "영수증", "f-root"),
]);

/**
 * 시드와 같은 묶음 둘.
 *   · 부모님께  — Day 1 을 하위까지 (일출봉·저녁이 자동으로 딸려 나간다)
 *   · 동반 모임 — 드론샷 하나만
 *
 * ⚠ `영수증` 은 어느 묶음에도 담지 않는다. 밖에서 열리면 안 되는 폴더가
 *   실제로 안 열리는지 확인할 대조군이 픽스처에도 있어야 한다.
 */
export const shareEntries: Record<string, ShareEntryDto[]> = {
  [SHARE_PARENTS]: [{ folderId: "f-day1", includeDescendants: true }],
  [SHARE_MATES]: [{ folderId: "f-drone", includeDescendants: false }],
};

/** `sharedIn` 은 손으로 적지 않는다 — core 의 resolveShared 로 만든다. */
function withShared(node: FolderNodeDto, flat: FolderNodeDto[]): FolderNodeDto {
  const owners = new Map<string, string[]>();
  for (const [linkId, entries] of Object.entries(shareEntries)) {
    for (const fid of resolveShared(entries, flat.map((f) => ({ id: f.id, parentId: f.parentId })))) {
      owners.set(fid, [...(owners.get(fid) ?? []), linkId]);
    }
  }
  const walk = (n: FolderNodeDto): FolderNodeDto => ({
    ...n,
    sharedIn: owners.get(n.id) ?? [],
    children: n.children.map(walk),
  });
  return walk(node);
}

const rawFlat = ((n: FolderNodeDto): FolderNodeDto[] => [n, ...n.children.flatMap((c) => [c, ...c.children])])(rawRoot);
export const folderRoot: FolderNodeDto = withShared(rawRoot, rawFlat);

const flatten = (n: FolderNodeDto): FolderNodeDto[] => [n, ...n.children.flatMap(flatten)];
export const allFolders = flatten(folderRoot);

/** 폴더 하나를 여는 응답. 시드는 사진 파일을 넣지 않으므로 photos 는 비어 있다. */
export function folderView(id: string): FolderView {
  const node = allFolders.find((f) => f.id === id) ?? folderRoot;
  const crumb: Array<{ id: string; name: string }> = [];
  let cur: FolderNodeDto | undefined = node;
  while (cur) {
    crumb.unshift({ id: cur.id, name: cur.name });
    const parentId: string | null = cur.parentId;
    cur = parentId ? allFolders.find((f) => f.id === parentId) : undefined;
  }
  return {
    folder: { id: node.id, name: node.name, slug: node.slug, sharedIn: node.sharedIn },
    breadcrumb: crumb,
    children: node.children.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      sharedIn: c.sharedIn,
      photoCount: c.photoCount,
    })),
    photos: [],
  };
}

/** 공유 묶음 목록 응답. url 안에만 토큰이 있고 Drive 주소는 어디에도 없다. */
export const shareList: ShareList = {
  shares: [
    {
      id: SHARE_PARENTS,
      label: "부모님께",
      url: `https://tripmate.app/${GID}/view/${SHARE_TOKEN_PARENTS}`,
      entries: shareEntries[SHARE_PARENTS]!,
      // 하위까지 담았으므로 일출봉·저녁이 함께 센다 — 고른 것과 나가는 것이 같아야 한다
      folderCount: 3,
      photoCount: 0,
      createdAt: "2026-08-19T00:00:00.000Z",
    },
    {
      id: SHARE_MATES,
      label: "동반 모임",
      url: `https://tripmate.app/${GID}/view/${SHARE_TOKEN_MATES}`,
      entries: shareEntries[SHARE_MATES]!,
      folderCount: 1,
      photoCount: 0,
      createdAt: "2026-08-19T00:01:00.000Z",
    },
  ],
};

/* ══════════ 문서 ══════════ */

export const docSummary: DocSummary = {
  id: "doc1",
  title: "제주 계획서",
  blockCount: 3,
  updatedAt: "2026-08-17T09:30:00.000Z",
  version: 1,
};

export const docDetail: DocDetail = {
  doc: { id: "doc1", title: "제주 계획서", version: 1, updatedAt: "2026-08-17T09:30:00.000Z" },
  blocks: [
    {
      id: "b1",
      kind: "timetable",
      position: 0,
      content: {
        rows: [
          ["09:00", "숙소 조식", ""],
          ["10:30", "우도 도선 탑승", "성산항"],
          ["13:00", "해녀의집 점심", ""],
          ["16:30", "비자림 산책", ""],
        ],
      },
    },
    {
      id: "b2",
      kind: "memo",
      position: 1,
      content: { text: "여기에 자유롭게 적으세요.\n\n· 렌터카 반납은 출발 2시간 전\n· 서귀포 숙소 바베큐 예약 확인" },
    },
    {
      id: "b3",
      kind: "stay",
      position: 2,
      content: {
        rows: [
          ["씨에스호텔 제주", "09.12 → 09.14 · 2박", 340000],
          ["서귀포 오션스테이", "09.14 → 09.16 · 2박", 300000],
        ],
      },
    },
  ],
};

/* ══════════ 초대 · 공유 · 뷰어 ══════════ */

export const INVITE_CODE = "inv-abcdefgh";

export const invite: InviteInfo = {
  code: INVITE_CODE,
  url: `/join?code=${INVITE_CODE}`,
  // 언제 돌려도 "남은 시간"이 나오도록 넉넉히 잡는다
  expiresAt: new Date(Date.now() + 29 * 60_000).toISOString(),
};

export const invitePeek: InvitePeek = {
  valid: true,
  expiresAt: invite.expiresAt,
  group: {
    id: GID,
    name: GROUP_NAME,
    dest: "제주도",
    start: "2026-09-12",
    end: "2026-09-16",
    memberCount: 4,
  },
};

export const SETTLE_TOKEN = "tok-settle";

/** 모임 밖 사람이 보는 읽기 전용 정산. 멤버 id·항목 제목이 하나도 들어 있지 않다. */
export const settleView = {
  memberView: false as const,
  group: { name: GROUP_NAME, dest: "제주도", start: "2026-09-12", end: "2026-09-16" },
  balance: settlement.balance.map((b) => ({ name: b.name, left: b.left, spent: b.spent, owed: b.owed, net: b.net })),
  transfers: settlement.transfers.map((t) => ({ fromName: t.fromName, toName: t.toName, amt: t.amt, state: t.state })),
  collectors: settlement.collectors.map((c) => ({ name: c.name, amt: c.amt, received: c.received })),
  total: settlement.total,
  guestTotal: settlement.guestTotal,
  closed: settlement.closed,
};

/**
 * 공개 폴더 뷰어 응답. **묶음에 담긴 폴더만** 나온다.
 * 이미지 주소는 언제나 /api/media/:id 다 — Drive 링크가 아니다.
 * memberView 가 참이어도 내용은 그대로 온다 (자동 이동 대신 배너를 띄운다).
 */
export const folderViewer: ShareViewer = {
  memberView: false,
  groupId: GID,
  group: { name: GROUP_NAME },
  link: { label: "동반 모임" },
  folder: { name: "지현의 드론샷", slug: "지현의-드론샷" },
  breadcrumb: [{ name: "지현의 드론샷", slug: "지현의-드론샷" }],
  folders: [],
  photos: [],
  sort: "up",
};

export const health = {
  ok: true,
  authMode: "mock" as const,
  storage: { driver: "local", healthy: true },
};

export const leaveCheck = {
  net: 268786,
  warn: true,
  message: "받을 돈 ₩ 268,786 이 남아 있습니다. 나가도 정산에는 그대로 남습니다.",
};

export const settleShare = {
  url: `https://tripmate.app/${GID}/settle/${SETTLE_TOKEN}`,
  token: SETTLE_TOKEN,
};
