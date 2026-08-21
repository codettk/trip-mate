/**
 * 서버 응답 타입. docs/API.md 의 계약과 1:1로 맞춘다.
 * 서버를 고치면 여기도 고친다 — 한쪽만 바꾸면 조용히 undefined 가 흐른다.
 */

import type { Category, TransferState } from "@tripmate/core";

export interface Me {
  id: string;
  name: string;
  kakaoId: string;
  avatarUrl: string | null;
}

export interface GroupSummary {
  id: string;
  name: string;
  dest: string;
  start: string;
  end: string;
  cur: string;
  memberCount: number;
  role: "owner" | "member";
}

export interface Group {
  id: string;
  name: string;
  dest: string;
  start: string;
  end: string;
  memo: string;
  cur: string;
  ownerId: string;
  settleClosedAt: string | null;
  createdAt: string;
}

export interface Member {
  id: string;
  userId: string;
  name: string;
  colorBg: string;
  colorFg: string;
  /** 카카오 프로필 사진. null 이면 이름 첫 글자로 떨어진다 */
  avatarUrl: string | null;
  role: "owner" | "member";
  /** 나갔지만 정산에는 그대로 남는다. 화면에는 "기타"로 표시한다 */
  left: boolean;
  joinedAt: string;
}

export interface Day {
  id: string;
  n: number;
  date: string;
  dow: string;
  label: string;
}

export interface GroupDetail {
  group: Group;
  days: Day[];
  members: Member[];
  me: { memberId: string; role: "owner" | "member" };
}

export interface Shared {
  members: string[];
  guests: number;
}

export interface Item {
  id: string;
  dayId: string;
  dayN: number;
  date: string;
  time: string;
  /** 종료 시각. 비어 있을 수 있다 */
  endTime: string;
  cat: Category;
  title: string;
  meta: string;
  booked: boolean;
  thumb: string | null;
  checkIn: string | null;
  checkOut: string | null;
  nights: number;
  /** cat==="stay" 전용. 날짜는 checkIn/checkOut 이 들고 있고 여기는 시각뿐이다 */
  checkInTime: string;
  checkOutTime: string;
  /** endTime < time — 자정을 넘긴다. 화면은 "+1일" 배지를 붙인다 */
  nextDay: boolean;
  /** 걸린 시간(분). 한쪽이라도 비면 null — "모른다"와 0분은 다르다 */
  duration: number | null;
  /** false 면 아래 금액 필드가 전부 비어 있다 */
  split: boolean;
  cost: number;
  cur: string;
  rate: number;
  /** round(cost × rate). split=false 면 0 */
  krw: number;
  payerId: string | null;
  shared: Shared;
}

export interface StayChip {
  itemId: string;
  title: string;
  phase: "in" | "mid" | "out";
  /** 체크인한 날이 1박째. 체크아웃하는 날은 묵지 않으므로 null */
  nightIndex: number | null;
  checkIn: string | null;
  checkOut: string | null;
  checkInTime: string;
  checkOutTime: string;
}

export interface ItineraryDay extends Day {
  items: Item[];
  /** 그날 묵는 숙소. 2개일 수 있다 */
  stays: StayChip[];
}

export interface Itinerary {
  days: ItineraryDay[];
}

export interface BalanceRow {
  id: string;
  name: string;
  left: boolean;
  /** 실제 결제액 — 그 사람이 실제로 낸 돈 */
  spent: number;
  /** 정산 반영액 — 정산 계산에 들어간 금액 */
  paid: number;
  owed: number;
  net: number;
}

export interface TransferRow {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amt: number;
  state: TransferState;
  /** 로그인한 사람이 지금 누를 수 있는 것. null 이면 버튼을 끈다 */
  canAct: "req" | "done" | null;
}

export interface CollectorRow {
  id: string;
  name: string;
  amt: number;
  received: boolean;
  canAct: boolean;
}

export interface SettleItemBrief {
  id: string;
  title: string;
  dayN: number;
  date: string;
  cat: Category;
  cost: number;
  cur: string;
  krw: number;
  payerId: string | null;
}

export interface Settlement {
  total: number;
  guestTotal: number;
  /** 로그인한 사람의 낼 돈. "1인당 평균"을 쓰지 않는다 */
  myOwed: number;
  closed: boolean;
  closedAt: string | null;
  doneCount: number;
  totalSteps: number;
  balance: BalanceRow[];
  transfers: TransferRow[];
  collectors: CollectorRow[];
  pending: SettleItemBrief[];
  noTarget: SettleItemBrief[];
  excluded: SettleItemBrief[];
  fxItems: SettleItemBrief[];
}

export interface FolderNodeDto {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  photoCount: number;
  /** 이 폴더를 담고 있는 공유 묶음 id 들. 비어 있지 않으면 미디어가 밖으로 나가는 중이다 */
  sharedIn: string[];
  children: FolderNodeDto[];
}

export interface Photo {
  id: string;
  name: string;
  mime: string;
  size: number;
  folderId: string;
  uploadedAt: string;
  takenAt: string | null;
  /** 촬영 메타데이터가 없어 업로드 시각을 쓴 것 — 배지로 알린다 */
  takenFallback: boolean;
  /** 항상 /api/media/:id. Drive 링크가 아니다 */
  url: string;
}

export interface FolderView {
  folder: { id: string; name: string; slug: string; sharedIn: string[] };
  breadcrumb: Array<{ id: string; name: string }>;
  children: Array<{ id: string; name: string; slug: string; sharedIn: string[]; photoCount: number }>;
  photos: Photo[];
}

/* ══════════ 공유 묶음 ══════════ */

/**
 * 묶음에 담긴 한 줄.
 * `includeDescendants` 면 그 아래 모든 깊이가 따라 나가고,
 * **나중에 새로 만든 하위 폴더도 자동으로 포함된다** — 화면이 배지로 알려야 한다.
 */
export interface ShareEntryDto {
  folderId: string;
  includeDescendants: boolean;
}

export interface ShareLink {
  id: string;
  label: string;
  /** 밖에 뿌리는 주소. 토큰이 이 안에만 있다 */
  url: string;
  entries: ShareEntryDto[];
  /** resolveShared 결과 크기 — 딸려 나가는 폴더까지 센 실제 개수 */
  folderCount: number;
  photoCount: number;
  createdAt: string;
}

export interface ShareList {
  shares: ShareLink[];
}

/* ══════════ 외부 뷰어 ══════════ */

/**
 * 묶음 뷰어 응답. **묶음에 없는 폴더는 여기 나타나지도 않는다.**
 * `memberView` 가 참이어도 내용은 그대로 온다 — 자동으로 앱에 보내지 않고 배너만 띄운다.
 */
export interface ShareViewer {
  memberView: boolean;
  groupId: string;
  group: { name: string };
  link: { label: string };
  /** null 이면 묶음 루트(담긴 폴더가 여러 개라 고르는 화면) */
  folder: { name: string; slug: string } | null;
  breadcrumb: Array<{ name: string; slug: string }>;
  folders: Array<{ name: string; slug: string; photoCount: number }>;
  photos: Photo[];
  sort: "up" | "taken";
}

export interface DocSummary {
  id: string;
  title: string;
  blockCount: number;
  updatedAt: string;
  version: number;
}

export interface DocBlock {
  id: string;
  kind: "timetable" | "map" | "stay" | "settle" | "memo";
  position: number;
  content: Record<string, unknown>;
}

export interface DocDetail {
  doc: { id: string; title: string; version: number; updatedAt: string };
  blocks: DocBlock[];
}

export interface InviteInfo {
  code: string;
  url: string;
  expiresAt: string;
}

export interface InvitePeek {
  valid: boolean;
  expiresAt?: string;
  group?: {
    id: string;
    name: string;
    dest: string;
    start: string;
    end: string;
    memberCount: number;
  };
}
