-- ── 이체·수령 확인에 금액을 묶는다 ─────────────────────────────────
--
-- 001 에서는 확인을 (group, from, to) / (group, member) 로만 키를 잡았다.
-- "금액이 바뀌면 이체 목록 자체가 달라진다"고 전제했기 때문인데, 2인 정산에서는
-- 쌍이 그대로 남고 금액만 바뀐다. 그래서 ₩5,000 을 주고받고 마감한 뒤 항목을
-- ₩30,000 으로 고치면 이체가 ₩15,000 이 되는데도 예전 "done" 이 그대로 붙어
-- 정산이 마감된 채로 남았다. 차액 ₩10,000 이 조용히 사라진다.
--
-- 확인은 "그 금액을 주고받았다"는 뜻이므로 금액을 함께 저장하고,
-- 지금 계산된 금액과 다르면 없던 확인으로 친다 (packages/core/src/settle.ts).
-- 마감은 저장된 상태가 아니라 계산 결과이므로, 그러면 자동으로 풀린다.
--
-- 기존 행에는 0 이 들어간다. 0 은 어떤 이체액과도 같을 수 없으므로
-- (이체는 amt > 0 일 때만 만들어진다) 옛 확인은 안전하게 "대기"로 돌아간다.

ALTER TABLE transfer_states ADD COLUMN amt integer NOT NULL DEFAULT 0;
ALTER TABLE transfer_states ALTER COLUMN amt DROP DEFAULT;

ALTER TABLE guest_back_states ADD COLUMN amt integer NOT NULL DEFAULT 0;
ALTER TABLE guest_back_states ALTER COLUMN amt DROP DEFAULT;
