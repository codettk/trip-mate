# 이체·수령 확인을 금액에 묶는다

2026-08-20 · 전체 점검 중 발견한 결함 하나와, 고치면서 내린 판단 하나.

새 규칙을 만든 게 아니다. **이미 확정돼 있던 규칙을 구현이 지키지 못하고 있었다.**

> `2026-08-17-ambiguity-resolution.md`
> 마감 후 정산에 영향을 주는 항목을 고치면 **경고**한다 (재계산은 하되 마감을 풀고 알린다).

> `2026-08-17-implementation-choices.md`
> 정산 마감 후 항목 수정 → **자동으로 풀린다.** 마감은 저장된 상태가 아니라 계산 결과이므로,
> 조건이 깨지면 `settle_closed_at` 이 NULL 로 돌아간다.

## 무엇이 잘못돼 있었나

`001_init.sql` 은 확인을 이렇게 저장했다.

```sql
CREATE TABLE transfer_states (
  ...
  PRIMARY KEY (group_id, from_id, to_id)   -- 금액이 없다
);
```

`modules/settlement.ts` 의 PUT 핸들러에 근거가 주석으로 남아 있었다.

> `// 금액이 바뀌면 이체 목록 자체가 달라지므로, 없는 쌍이면 화면이 낡은 것이다.`

**이 전제가 틀렸다.** 이체 목록이 달라지는 건 *짝짓기가 바뀔 때*지 *금액이 바뀔 때*가 아니다.
2인 정산에서는 채권자·채무자가 그대로라 **쌍은 남고 금액만 바뀐다.**

재현 (`.data/tmp/audit4.mjs`):

```
B → A ₩5,000   B "송금함" → A "정산 완료" → 마감 ✓
항목 10,000 → 30,000 으로 수정
이체가 ₩15,000 이 됨      → 그런데 여전히 "완료 · 마감" ✗
```

**차액 ₩10,000 을 아무도 주고받지 않았는데 정산이 끝난 것으로 보인다.**
기타 인원 몫(`guest_back_states`)도 키가 `(group_id, member_id)` 뿐이라 같은 결함이었다 —
₩5,000 을 받았다고 확인한 뒤 금액을 고치면 **₩45,000 이 "받음"으로 남았다.**

`syncClosed()` 는 제대로 쓰여 있었다(`!result.closed` 면 `settle_closed_at` 을 NULL 로 되돌린다).
`result.closed` 가 계속 `true` 라 발동할 기회가 없었을 뿐이다.

## 어떻게 고쳤나

확인은 "**그 금액을** 주고받았다"는 뜻이다. 그래서 금액을 함께 저장하고,
지금 계산된 금액과 다르면 없던 확인으로 친다.

- `004_settle_confirm_amounts.sql` — 두 표에 `amt integer NOT NULL`
- `packages/core/src/settle.ts` — `saved.amt === amt` 일 때만 상태를 물려준다
- `SettleInput.transferStates` 가 `Record<string, "req"|"done">` → `Record<string, TransferConfirm>`,
  `guestBackStates` 가 `Record<string, boolean>` → `Record<string, number>`(확인한 금액)

마감은 계산 결과이므로, 확인이 풀리면 `settle_closed_at` 이 저절로 NULL 로 돌아간다.
**정산 로직은 여전히 `settle.ts` 한 벌이다.** 서버·브라우저 어디에도 두 번째 판정이 생기지 않았다.

## 판단 — 금액을 되돌리면 확인이 되살아난다

₩5,000 확인 → 오타로 ₩30,000 → 다시 ₩10,000 으로 정정하면, 이체는 다시 ₩5,000 이 되고
저장된 `amt` 와 일치하므로 **예전 "done" 이 되살아난다.**

일부러 이렇게 뒀다. **₩5,000 은 실제로 주고받은 돈이다.** 오타를 고쳤다고 해서
사람들에게 "다시 눌러라"라고 할 이유가 없다. 무효가 되어야 하는 것은 "지금 금액과 다른 확인"이지
"한 번이라도 흔들린 적 있는 확인"이 아니다.

되돌리려면 확인을 지우는 쪽(`amt` 불일치 시 행 삭제)으로 바꾸면 된다. 한 줄이다.
다만 그러면 위 시나리오에서 이미 정산한 사람들이 이유 없이 다시 눌러야 한다.

## 되돌리는 비용

크지 않다. `amt` 컬럼 두 개와 core 의 비교 두 줄이 전부다.
컬럼을 남긴 채 비교만 없애면 옛 동작으로 돌아간다 — 다만 그건 위 결함을 되살리는 일이다.

## 함께 고친 것

`apps/web/src/modals/ItemDetailModal.tsx` 가 1인 몫을 손으로 나누고 있었다
(`Math.round(item.krw / parts)`). 지출 폼은 `previewSplit` 을 부르는데 상세 모달만 자체 계산이라,
`previewSplit` 의 반올림을 한 번만 손대도 **상세 화면만 조용히 어긋날** 수 있었다.
지금은 양쪽 다 `previewSplit` 을 부른다. 숫자는 그대로다.

## 회귀 방지

- `packages/core/src/settle.test.ts` — 이체·수령 확인 각각 금액 변경 시 무효화 (2건)
- `apps/api/test/settlement.test.ts` — 마감 → 금액 변경 → 자동 해제 → 되돌림까지 API 왕복 (3건)
