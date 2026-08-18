-- ════════════════════════════════════════════════════════════════════
-- TripMate 초기 스키마
--
-- 규칙:
--  · 원화 금액은 BIGINT(정수)만 쓴다. 부동소수를 아예 못 넣게 한다.
--  · 외화 입력액과 환율만 NUMERIC 이고, 그 곱을 반올림한 원화는 계산 시점에 정수로 떨어진다.
--  · 시각은 전부 timestamptz(UTC). 날짜(여행 일자)만 date.
--  · 공유 토큰은 폴더 ID 에서 파생하지 않는다 — 재발급이 가능해야 한다.
-- ════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 사용자 ──────────────────────────────────────────────────────────
-- 로그인은 카카오 하나만 지원한다. 이메일·비밀번호 컬럼을 두지 않는다.
CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kakao_id     text UNIQUE NOT NULL,
  name         text NOT NULL,
  avatar_url   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expires_idx ON sessions(expires_at);

-- ── 여행 모임 ───────────────────────────────────────────────────────
-- 모임이 최상위 단위다. 모든 리소스가 group_id 를 갖는다.
-- name 은 Drive 최상위 폴더 이름과 항상 같은 값이다 — 한쪽만 바꾸는 코드를 두지 않는다.
CREATE TABLE groups (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  dest               text NOT NULL DEFAULT '',
  start_date         date NOT NULL,
  end_date           date NOT NULL,
  memo               text NOT NULL DEFAULT '',
  cur                text NOT NULL DEFAULT 'KRW',   -- 여행지에서 자동 추론된 기본 통화
  owner_id           uuid NOT NULL REFERENCES users(id),
  drive_folder_id    text,                          -- 저장소의 최상위 폴더 id
  settle_token       text UNIQUE NOT NULL,          -- 정산 공유 링크 토큰
  settle_closed_at   timestamptz,                   -- 모든 이체·수령 확인이 끝난 시각
  deleted_at         timestamptz,                   -- 소프트 삭제. Drive 폴더는 지우지 않는다
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT groups_period_ck CHECK (end_date >= start_date)
);
CREATE INDEX groups_owner_idx ON groups(owner_id);

-- ── 멤버 ────────────────────────────────────────────────────────────
-- left_at 이 찍혀도 행을 지우지 않는다. 정산에서 빼면 잔액 합이 0이 되지 않는다.
CREATE TABLE members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id),
  name         text NOT NULL,                 -- 합류 시점 이름 스냅샷
  color_bg     text NOT NULL DEFAULT '#EEF1F5',
  color_fg     text NOT NULL DEFAULT '#8A94A6',
  role         text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  left_at      timestamptz,                   -- NOT NULL 이면 나간 멤버 → 화면에 "기타"
  UNIQUE (group_id, user_id)
);
CREATE INDEX members_group_idx ON members(group_id);
CREATE INDEX members_user_idx ON members(user_id);

-- ── 초대 ────────────────────────────────────────────────────────────
-- 발급 후 30분 절대 만료. 사용해도 죽지 않는다(여러 명이 같은 링크로 들어온다).
-- 새로 발급하면 그 순간 이전 링크는 revoked_at 이 찍혀 죽는다.
CREATE TABLE invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  code         text UNIQUE NOT NULL,
  created_by   uuid NOT NULL REFERENCES users(id),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invites_group_idx ON invites(group_id);

-- ── 일차 ────────────────────────────────────────────────────────────
-- 시작~종료에서 자동 생성된다. 사용자가 직접 추가·삭제하지 않는다.
-- label 만 선택 입력이고, 기간을 바꿔도 같은 날짜의 label 은 유지한다.
CREATE TABLE days (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  n            integer NOT NULL,
  date         date NOT NULL,
  label        text NOT NULL DEFAULT '',
  UNIQUE (group_id, date),
  UNIQUE (group_id, n)
);
CREATE INDEX days_group_idx ON days(group_id);

-- ── 일정 항목 ───────────────────────────────────────────────────────
-- split=false 면 cost/payer/guests 가 전부 비어 있다. 숨겨진 금액을 남기지 않는다.
CREATE TABLE items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  day_id         uuid NOT NULL REFERENCES days(id) ON DELETE CASCADE,
  time           text NOT NULL DEFAULT '',      -- "08:20". 비어 있을 수 있다
  cat            text NOT NULL CHECK (cat IN ('stay','pkg','spot','food','move')),
  title          text NOT NULL,
  meta           text NOT NULL DEFAULT '',
  booked         boolean NOT NULL DEFAULT false,
  thumb          text,                          -- 카드 썸네일 (그라디언트 문자열 또는 photo id)

  split          boolean NOT NULL DEFAULT false,
  cost           numeric(18,4) NOT NULL DEFAULT 0,   -- 결제한 통화 그대로
  cur            text NOT NULL DEFAULT 'KRW',
  rate           numeric(18,6) NOT NULL DEFAULT 1,   -- 저장 시점 그 일자의 마감 환율 스냅샷
  payer_id       uuid REFERENCES members(id),        -- 사전 배정하지 않는다. nullable
  guests         integer NOT NULL DEFAULT 0 CHECK (guests >= 0),

  check_in       date,                          -- cat='stay' 전용
  check_out      date,

  sort_order     integer NOT NULL DEFAULT 0,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- 정산을 끄면 금액·결제자·기타 인원이 실제로 비어야 한다
  CONSTRAINT items_nosplit_empty_ck CHECK (
    split OR (cost = 0 AND payer_id IS NULL AND guests = 0)
  ),
  CONSTRAINT items_stay_period_ck CHECK (
    check_in IS NULL OR check_out IS NULL OR check_out >= check_in
  )
);
CREATE INDEX items_group_idx ON items(group_id);
CREATE INDEX items_day_idx ON items(day_id);
CREATE INDEX items_payer_idx ON items(payer_id);

-- 이 항목을 누가 나눠 내는가. 나간 멤버도 대상으로 남을 수 있다.
CREATE TABLE item_shares (
  item_id      uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, member_id)
);
CREATE INDEX item_shares_member_idx ON item_shares(member_id);

-- ── 이체 상태 ───────────────────────────────────────────────────────
-- 시스템이 입금을 판단하지 않는다. 사람이 대기 → req → done 으로 넘긴다.
-- 이체 목록은 매번 다시 계산되므로 (from,to) 쌍에 상태만 붙여 둔다.
CREATE TABLE transfer_states (
  group_id      uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_id       uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  to_id         uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  state         text NOT NULL CHECK (state IN ('req','done')),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES users(id),
  PRIMARY KEY (group_id, from_id, to_id)
);

-- 기타 인원 몫을 결제자가 직접 받았다는 확인
CREATE TABLE guest_back_states (
  group_id      uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  received      boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES users(id),
  PRIMARY KEY (group_id, member_id)
);

-- ── 폴더 ────────────────────────────────────────────────────────────
-- 최상위 폴더 이름 = 모임 제목. 하위는 자유롭게, 깊이 제한 없음.
-- share_token 은 공개할 때마다 새로 발급한다. 비공개로 돌리면 NULL 이 되어 링크가 즉시 죽는다.
CREATE TABLE folders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  parent_id         uuid REFERENCES folders(id) ON DELETE CASCADE,
  name              text NOT NULL,
  slug              text NOT NULL,
  pub               boolean NOT NULL DEFAULT false,
  share_token       text UNIQUE,
  drive_folder_id   text,
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, slug),
  CONSTRAINT folders_pub_token_ck CHECK ((pub AND share_token IS NOT NULL) OR (NOT pub AND share_token IS NULL))
);
CREATE INDEX folders_group_idx ON folders(group_id);
CREATE INDEX folders_parent_idx ON folders(parent_id);
-- 모임마다 루트 폴더는 하나뿐이다
CREATE UNIQUE INDEX folders_one_root_idx ON folders(group_id) WHERE parent_id IS NULL;

-- ── 사진 · 동영상 ───────────────────────────────────────────────────
-- DB 에는 바이너리가 아니라 file id 만 저장한다.
-- taken_at 이 없으면 정렬에서 uploaded_at 을 촬영 시각으로 믿는다 (배지로 알린다).
CREATE TABLE photos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  folder_id      uuid NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  name           text NOT NULL,
  mime           text NOT NULL,
  size_bytes     bigint NOT NULL DEFAULT 0,
  width          integer,
  height         integer,
  storage_key    text NOT NULL,        -- local: 상대 경로 / gdrive: fileId
  uploaded_by    uuid REFERENCES users(id),
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  taken_at       timestamptz           -- EXIF. 없을 수 있다
);
CREATE INDEX photos_folder_idx ON photos(folder_id);
CREATE INDEX photos_group_idx ON photos(group_id);
CREATE INDEX photos_uploaded_idx ON photos(folder_id, uploaded_at);

-- ── 문서 ────────────────────────────────────────────────────────────
-- 모임 멤버 전용. 외부 공개 컬럼을 두지 않는다 — 문서는 공유 대상이 아니다.
-- 일차에 묶이지 않는 자유 문서다.
CREATE TABLE docs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title        text NOT NULL DEFAULT '제목 없는 문서',
  version      integer NOT NULL DEFAULT 1,   -- 낙관적 잠금. 마지막 저장 승리
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX docs_group_idx ON docs(group_id);

CREATE TABLE doc_blocks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id       uuid NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('timetable','map','stay','settle','memo')),
  position     integer NOT NULL DEFAULT 0,
  content      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX doc_blocks_doc_idx ON doc_blocks(doc_id, position);

-- ── 환율 ────────────────────────────────────────────────────────────
-- 그 일자의 최종(마감) 환율. 어느 API 를 쓸지는 미정이라 테이블이 정본이고
-- RateProvider 가 이걸 채운다. 항목은 저장 시점 값을 items.rate 에 스냅샷한다.
CREATE TABLE fx_rates (
  date         date NOT NULL,
  currency     text NOT NULL,
  rate         numeric(18,6) NOT NULL,   -- 1 외화 = ? 원
  source       text NOT NULL DEFAULT 'seed',
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, currency)
);
