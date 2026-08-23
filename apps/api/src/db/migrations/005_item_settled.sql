-- ── 항목 단위 "이미 정산함" ────────────────────────────────────────
--
-- 현장에서는 결제한 자리에서 바로 나눠 내는 일이 흔하다. 그런 건도 **금액은 장부에 남아야**
-- 하지만 정산 계산에는 들어가면 안 된다. 지금까지는 방법이 두 개뿐이었다:
--
--   ① split=false (정산 제외) — 금액·결제자·대상을 **실제로 비운다**. 얼마 썼는지가 사라진다.
--   ② 그냥 둔다 — 이미 주고받았는데 이체 목록에 계속 남아 마감이 되지 않는다.
--
-- 그래서 세 번째 상태를 만든다. settled=true 는 **금액을 그대로 둔 채 계산에서만 빼는 것**이다.
-- 실제 결제액(spent)에는 남고 정산 반영액(paid)에는 들어가지 않으며,
-- 결제자 미지정·정산 대상 없음으로도 세지 않는다 (이미 끝난 건이 마감을 막으면 안 된다).
--
-- split=false 인 항목에는 붙지 않는다. 금액이 없으면 정산할 것도 없기 때문이다 —
-- items_nosplit_empty_ck 와 같은 자리에서 CHECK 로 막는다.

ALTER TABLE items ADD COLUMN settled boolean NOT NULL DEFAULT false;

ALTER TABLE items ADD CONSTRAINT items_settled_needs_split_ck CHECK (split OR NOT settled);
