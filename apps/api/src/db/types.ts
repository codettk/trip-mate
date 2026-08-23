/**
 * Kysely 용 DB 인터페이스.
 *
 * ⚠ migrations/*.sql 과 손으로 맞춘다. 한쪽만 고치면 컴파일이 깨지므로 조용히 틀리지는 않는다.
 *   컬럼을 더할 때는 SQL → 이 파일 순서로 고친다.
 */

import type { ColumnType, Generated } from "kysely";

/** DB 가 넣어 주는 timestamptz — 넣을 때는 안 써도 되고, 읽으면 Date */
type Created = ColumnType<Date, Date | string | undefined, Date | string>;
/** 항상 읽기만 하는 시각 */
type When = ColumnType<Date, Date | string, Date | string>;

export interface UsersTable {
  id: Generated<string>;
  kakao_id: string;
  name: string;
  avatar_url: string | null;
  created_at: Created;
  updated_at: Created;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  expires_at: When;
  created_at: Created;
}

export interface GroupsTable {
  id: Generated<string>;
  name: string;
  dest: string;
  /** YYYY-MM-DD */
  start_date: ColumnType<string, string, string>;
  end_date: ColumnType<string, string, string>;
  memo: string;
  cur: string;
  owner_id: string;
  drive_folder_id: string | null;
  settle_token: string;
  settle_closed_at: When | null;
  deleted_at: When | null;
  created_at: Created;
  updated_at: Created;
}

export interface MembersTable {
  id: Generated<string>;
  group_id: string;
  user_id: string;
  name: string;
  color_bg: string;
  color_fg: string;
  role: "owner" | "member";
  joined_at: Created;
  /** NOT NULL 이면 나간 멤버. 정산에는 그대로 남고 화면에는 "기타"로 표시한다 */
  left_at: When | null;
}

export interface InvitesTable {
  id: Generated<string>;
  group_id: string;
  code: string;
  created_by: string;
  expires_at: When;
  revoked_at: When | null;
  created_at: Created;
}

export interface DaysTable {
  id: Generated<string>;
  group_id: string;
  n: number;
  date: ColumnType<string, string, string>;
  label: string;
}

export interface ItemsTable {
  id: Generated<string>;
  group_id: string;
  day_id: string;
  time: string;
  cat: "stay" | "pkg" | "spot" | "food" | "move";
  title: string;
  meta: string;
  booked: boolean;
  thumb: string | null;

  split: boolean;
  /** numeric — pg 드라이버가 문자열로 준다. 읽을 때 Number() 한다 */
  cost: ColumnType<string, number | string, number | string>;
  cur: string;
  rate: ColumnType<string, number | string, number | string>;
  payer_id: string | null;
  guests: number;
  /** 이미 주고받은 항목. 금액은 그대로 두고 정산 계산에서만 뺀다 (split=true 일 때만) */
  settled: boolean;

  check_in: ColumnType<string, string | null, string | null> | null;
  check_out: ColumnType<string, string | null, string | null> | null;

  /** 종료 시각 "11:00". 시작보다 이르면 익일이다 (야간 이동) */
  end_time: string;
  /** cat='stay' 전용. 날짜는 check_in 이고 여기는 시각만이다 */
  check_in_time: string;
  check_out_time: string;

  sort_order: number;
  created_by: string | null;
  created_at: Created;
  updated_at: Created;
}

export interface ItemSharesTable {
  item_id: string;
  member_id: string;
}

export interface TransferStatesTable {
  group_id: string;
  from_id: string;
  to_id: string;
  state: "req" | "done";
  /** 확인을 누른 시점의 이체액. 지금 금액과 다르면 그 확인은 무효다 (004) */
  amt: number;
  updated_at: Created;
  updated_by: string | null;
}

export interface GuestBackStatesTable {
  group_id: string;
  member_id: string;
  received: boolean;
  /** 확인을 누른 시점의 기타 인원 몫. 지금 금액과 다르면 무효다 (004) */
  amt: number;
  updated_at: Created;
  updated_by: string | null;
}

export interface FoldersTable {
  id: Generated<string>;
  group_id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  // 공유는 폴더가 아니라 share_links 에 있다. 권한 규칙을 두 군데 두지 않는다.
  drive_folder_id: string | null;
  created_by: string | null;
  created_at: Created;
  updated_at: Created;
}

export interface PhotosTable {
  id: Generated<string>;
  group_id: string;
  folder_id: string;
  name: string;
  mime: string;
  size_bytes: ColumnType<string, number | string, number | string>;
  width: number | null;
  height: number | null;
  /** local: 상대 경로 / gdrive: fileId. 브라우저에 절대 노출하지 않는다 */
  storage_key: string;
  uploaded_by: string | null;
  uploaded_at: Created;
  /** EXIF 촬영 시각. 없으면 정렬에서 uploaded_at 을 믿는다 */
  taken_at: When | null;
}

export interface DocsTable {
  id: Generated<string>;
  group_id: string;
  title: string;
  version: Generated<number>;
  created_by: string | null;
  created_at: Created;
  updated_at: Created;
}

export interface DocBlocksTable {
  id: Generated<string>;
  doc_id: string;
  kind: "timetable" | "map" | "stay" | "settle" | "memo";
  position: number;
  content: ColumnType<unknown, unknown, unknown>;
}

export interface FxRatesTable {
  date: ColumnType<string, string, string>;
  currency: string;
  rate: ColumnType<string, number | string, number | string>;
  source: string;
  fetched_at: Created;
}

export interface MigrationsTable {
  name: string;
  applied_at: Created;
}

/**
 * 외부 공유 묶음. 공유의 정본은 여기 한 곳이다.
 * 토큰은 묶음 id 나 폴더 id 에서 파생시키지 않는다 — 중지했다 다시 공유하면 새로 뽑는다.
 */
export interface ShareLinksTable {
  id: Generated<string>;
  group_id: string;
  label: string;
  token: string;
  created_by: string | null;
  created_at: Created;
  updated_at: Created;
}

export interface ShareLinkFoldersTable {
  link_id: string;
  folder_id: string;
  /** 참이면 그 폴더 아래 전부. 나중에 생긴 하위 폴더도 자동으로 따라 나간다 */
  include_descendants: boolean;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  groups: GroupsTable;
  members: MembersTable;
  invites: InvitesTable;
  days: DaysTable;
  items: ItemsTable;
  item_shares: ItemSharesTable;
  transfer_states: TransferStatesTable;
  guest_back_states: GuestBackStatesTable;
  folders: FoldersTable;
  share_links: ShareLinksTable;
  share_link_folders: ShareLinkFoldersTable;
  photos: PhotosTable;
  docs: DocsTable;
  doc_blocks: DocBlocksTable;
  fx_rates: FxRatesTable;
  _migrations: MigrationsTable;
}
