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

  check_in: ColumnType<string, string | null, string | null> | null;
  check_out: ColumnType<string, string | null, string | null> | null;

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
  updated_at: Created;
  updated_by: string | null;
}

export interface GuestBackStatesTable {
  group_id: string;
  member_id: string;
  received: boolean;
  updated_at: Created;
  updated_by: string | null;
}

export interface FoldersTable {
  id: Generated<string>;
  group_id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  pub: boolean;
  /** 공개일 때만 존재. 비공개로 돌리면 NULL 이 되어 링크가 즉시 죽는다 */
  share_token: string | null;
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
  photos: PhotosTable;
  docs: DocsTable;
  doc_blocks: DocBlocksTable;
  fx_rates: FxRatesTable;
  _migrations: MigrationsTable;
}
