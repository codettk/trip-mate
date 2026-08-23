/**
 * 서버와 브라우저가 공유하는 도메인 타입.
 *
 * 여기 있는 이름은 CLAUDE.md 의 데이터 모델과 1:1로 맞춘다.
 * 한쪽만 바꾸면 기획이 흔들리므로 이름을 바꿀 때는 CLAUDE.md 도 같이 고친다.
 */

/** 일정 항목의 종류. 다섯 가지에서 늘리지 않는다. */
export type Category = "stay" | "pkg" | "spot" | "food" | "move";

export const CATEGORIES = ["stay", "pkg", "spot", "food", "move"] as const;

export const CATEGORY_LABEL: Record<Category, string> = {
  stay: "숙소",
  pkg: "패키지",
  spot: "관광지",
  food: "식사",
  move: "이동",
};

/** 모임 안에서의 역할. 방장은 모임을 만든 사람이고 위임할 수 있다. */
export type MemberRole = "owner" | "member";

/**
 * 이체 한 건의 상태. 시스템이 입금을 판단하지 않고 사람이 단계를 넘긴다.
 *   null  대기 — 아직 아무도 안 눌렀다
 *   "req" 보낸 사람이 "송금 확인 요청"을 눌렀다
 *   "done" 받은 사람이 "정산 완료"를 눌렀다
 */
export type TransferState = null | "req" | "done";

/** 정산에 참여하는 사람. 나간 멤버(left)도 계산에는 그대로 들어간다. */
export interface SettleMember {
  id: string;
  name: string;
  /** true 면 모임에서 나갔다. 화면에는 "기타"로 표시하고 새 지출의 기본 대상에서는 뺀다. */
  left: boolean;
}

/** 한 항목을 누가 나눠 내는가. members 는 멤버 id, guests 는 모임 밖 인원 수. */
export interface SharedWith {
  members: string[];
  guests: number;
}

/**
 * 정산 계산에 들어가는 일정 항목.
 *
 * split=false 면 cost/cur/rate/payer/shared 는 전부 비어 있는 것으로 확정된다.
 * 숨겨진 금액을 남기지 않기 위해 저장 시점에 실제로 비운다.
 */
export interface SettleItem {
  id: string;
  /** 몇 일차인가 (1-base) */
  dayN: number;
  /** 화면 표기용 날짜 문자열 (예: "09.12") */
  date: string;
  title: string;
  cat: Category;
  /** 정산에 포함하는가 */
  split: boolean;
  /** 결제한 통화 그대로의 금액. split=false 면 0 */
  cost: number;
  /** 통화 코드 (KRW, USD, ...) */
  cur: string;
  /** 저장 시점에 스냅샷한 그 일자의 마감 환율. 1 외화 = rate 원 */
  rate: number;
  /** 결제자. 사전 배정하지 않으므로 나중에 채워질 수 있다 */
  payer: string | null;
  shared: SharedWith;
  /**
   * **이미 주고받은 항목인가.** 현장에서 그 자리에 나눠 냈거나 따로 정산이 끝난 건이다.
   *
   * `split=false`(정산 제외) 와 다르다 — 그쪽은 금액 자체가 없다.
   * 여기는 **금액·결제자·대상을 그대로 두고 계산에서만 뺀다.** 장부에는 남아야 하기 때문이다.
   * `split=false` 인 항목에는 붙지 않는다 (금액이 없으니 정산할 것도 없다).
   */
  settled: boolean;
}

/** 멤버 한 명의 잔액 한 줄. */
export interface Balance {
  id: string;
  name: string;
  left: boolean;
  /** 실제 결제액 — 그 사람이 실제로 낸 돈 Σ item.krw */
  spent: number;
  /** 정산 반영액 — 정산 계산에 들어간 금액 Σ (per × 대상 멤버 수) */
  paid: number;
  /** 이 사람이 결제자인 **이미 정산한** 항목의 합. spent 에는 들어 있고 paid 에는 없다 */
  settled: number;
  /** 낼 돈 Σ per */
  owed: number;
  /** paid − owed. 전원의 합은 항상 정확히 0 */
  net: number;
}

/** 누가 누구에게 얼마를 보내는가. */
export interface Transfer {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  /** 원 단위 정수 */
  amt: number;
  state: TransferState;
}

/**
 * 이체 한 건에 대한 사람의 확인. 금액이 함께 붙는다.
 * 저장된 `amt` 가 지금 계산된 이체액과 다르면 그 확인은 없던 것으로 친다.
 */
export interface TransferConfirm {
  state: Exclude<TransferState, null>;
  /** 확인을 누른 시점의 이체액 (원 단위 정수) */
  amt: number;
}

/** 모임 밖 인원 몫을 직접 받아야 하는 결제자. */
export interface Collector {
  id: string;
  name: string;
  amt: number;
  /** 결제자가 "받음 확인"을 눌렀는가 */
  received: boolean;
}

/** settle() 이 계산한 항목 한 줄 (krw 가 붙는다). */
export interface SettleItemComputed extends SettleItem {
  /** 원화 정수 환산액. split=false 면 0 */
  krw: number;
}

export interface SettleInput {
  /** 나간 멤버를 포함한 전원. 순서가 이체 짝짓기의 타이브레이커가 되므로 안정적으로 넘긴다. */
  members: SettleMember[];
  items: SettleItem[];
  /**
   * "보낸사람>받는사람" → 확인 상태와 **그때의 금액**.
   *
   * ⚠ 금액을 함께 들고 있어야 한다. (보낸사람, 받는사람) 만으로 키를 잡으면
   *   나중에 항목 금액을 고쳐 이체액이 달라져도 예전 "done" 이 그대로 붙어,
   *   ₩5,000 을 주고받고 마감한 정산이 ₩15,000 으로 바뀐 뒤에도 마감으로 남는다.
   *   확인은 "그 금액을 주고받았다"는 뜻이므로 금액이 바뀌면 무효다.
   */
  transferStates?: Record<string, TransferConfirm>;
  /** 결제자 id → 수령 확인을 누른 시점의 기타 인원 몫. 지금 금액과 다르면 무효다. */
  guestBackStates?: Record<string, number>;
}

export interface SettleResult {
  /** krw 가 계산된 전체 항목 */
  items: SettleItemComputed[];
  /** split=true 인 항목 */
  inScope: SettleItemComputed[];
  /** split=false — "정산 제외"로 표시한다 */
  excluded: SettleItemComputed[];
  /** 이미 정산한 항목 — 금액은 살아 있고 계산에서만 빠진다. 마감도 막지 않는다 */
  settledItems: SettleItemComputed[];
  /** 이미 정산한 항목의 원화 합 */
  settledTotal: number;
  /** 결제자가 지정된 + 대상이 1명 이상인 항목. 실제로 계산에 들어간 것 */
  billed: SettleItemComputed[];
  /** 결제자 미지정 — UI 가 따로 안내한다 */
  pending: SettleItemComputed[];
  /** 정산 대상 0명 — UI 가 따로 안내한다 */
  noTarget: SettleItemComputed[];
  /** 멤버끼리 정산된 총액 */
  total: number;
  /** 모임 밖 인원 몫 총액 */
  guestTotal: number;
  /** 결제자 id → 기타 인원에게 직접 받을 금액 */
  guestBack: Record<string, number>;
  balance: Balance[];
  transfers: Transfer[];
  collectors: Collector[];
  /** 미지정·대상없음이 없고 모든 이체와 수령 확인이 끝났는가 */
  closed: boolean;
  doneCount: number;
  totalSteps: number;
  /** 외화로 입력된 항목 (환율 안내용) */
  fxItems: SettleItemComputed[];
  spent: Record<string, number>;
  owed: Record<string, number>;
}

/** 폴더 트리 노드. 깊이 제한 없음. */
export interface FolderNode {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  /** 외부 공개 여부. 기본 false */
  pub: boolean;
  /** 공개일 때만 존재. 비공개로 돌리면 죽고 다시 공개하면 새로 발급된다 */
  token: string | null;
  photoCount: number;
  children: FolderNode[];
}

/** 사진 정렬 기준. */
export type PhotoSort = "up" | "taken";

/** 문서 블록 종류. */
export type BlockKind = "timetable" | "map" | "stay" | "settle" | "memo";

export const BLOCK_KINDS = ["timetable", "map", "stay", "settle", "memo"] as const;

export const BLOCK_LABEL: Record<BlockKind, string> = {
  timetable: "시간표",
  map: "지도",
  stay: "숙소",
  settle: "정산서",
  memo: "메모",
};
