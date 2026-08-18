-- ══════════ 항목의 종료 시각 ══════════
--
-- 지금까지 항목에는 시작 시각(items.time) 하나뿐이었다.
-- 실제로는 "09:30 ~ 11:00" 처럼 끝나는 시각이 있어야 하고,
-- 숙소는 체크인/체크아웃이 날짜만 있어서 "15:00 체크인"을 적을 곳이 없었다.
--
-- check_in / check_out 은 date 타입 그대로 둔다.
-- 그 날짜 비교(staysOn)에 숙소 칩 계산이 전부 걸려 있어서,
-- timestamptz 로 바꾸면 일차·숙박 로직이 통째로 흔들린다.
-- 시각은 별도 컬럼으로 얹고, 날짜 계산은 지금 그대로 굴러가게 한다.
--
-- 전부 '' 기본값이다 — 시간은 원래 비워 둘 수 있는 값이고,
-- 이미 들어 있는 항목이 갑자기 시각을 갖게 되면 안 된다.

ALTER TABLE items
  ADD COLUMN end_time       text NOT NULL DEFAULT '',   -- "11:00". 비어 있을 수 있다
  ADD COLUMN check_in_time  text NOT NULL DEFAULT '',   -- cat='stay' 전용. "15:00"
  ADD COLUMN check_out_time text NOT NULL DEFAULT '';   -- cat='stay' 전용. "11:00"

-- 숙소가 아닌 항목에 체크인/체크아웃 시각이 남아 있으면 안 된다.
-- 카테고리를 바꿨을 때 옛 값이 유령처럼 따라다니는 걸 DB 에서 막는다.
ALTER TABLE items
  ADD CONSTRAINT items_stay_times_ck
  CHECK (cat = 'stay' OR (check_in_time = '' AND check_out_time = ''));

COMMENT ON COLUMN items.end_time IS
  '종료 시각 HH:MM. 시작보다 이르면 익일로 해석한다 (야간 이동)';
