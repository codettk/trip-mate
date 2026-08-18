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
  cat: Category;
  title: string;
  meta: string;
  booked: boolean;
  thumb: string | null;
  checkIn: string | null;
  checkOut: string | null;
  nights: number;
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
  pub: boolean;
  token: string | null;
  photoCount: number;
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
  folder: { id: string; name: string; slug: string; pub: boolean; shareUrl: string | null };
  breadcrumb: Array<{ id: string; name: string }>;
  children: Array<{ id: string; name: string; slug: string; pub: boolean; photoCount: number }>;
  photos: Photo[];
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
