/**
 * 정산 서비스.
 *
 * DB 에서 읽어 @tripmate/core 의 settle() 에 그대로 넘긴다.
 * ⚠ 계산을 여기서 다시 쓰지 않는다. core 가 정본이고, 서버와 브라우저가 같은 코드를 돌린다.
 *
 * 결과를 내보내기 전에 반드시 verifySettlement() 를 통과시킨다.
 * 틀린 금액을 조용히 보여주느니 500 으로 터지는 게 낫다.
 */

import {
  settle,
  transferKey,
  verifySettlement,
  type SettleItem,
  type SettleMember,
  type SettleResult,
} from "@tripmate/core";
import { db, num } from "../db/client.ts";
import { ApiError } from "../lib/http.ts";

export async function loadSettlement(groupId: string): Promise<SettleResult> {
  const members = await db
    .selectFrom("members")
    .select(["id", "name", "left_at"])
    .where("group_id", "=", groupId)
    .orderBy("joined_at", "asc")
    .orderBy("id", "asc")
    .execute();

  const settleMembers: SettleMember[] = members.map((m) => ({
    id: m.id,
    name: m.name,
    left: m.left_at !== null,
  }));

  const rows = await db
    .selectFrom("items")
    .innerJoin("days", "days.id", "items.day_id")
    .select([
      "items.id as id",
      "items.title as title",
      "items.cat as cat",
      "items.split as split",
      "items.cost as cost",
      "items.cur as cur",
      "items.rate as rate",
      "items.payer_id as payer",
      "items.guests as guests",
      "days.n as dayN",
      "days.date as date",
    ])
    .where("items.group_id", "=", groupId)
    .orderBy("days.n", "asc")
    .orderBy("items.time", "asc")
    .orderBy("items.sort_order", "asc")
    .orderBy("items.id", "asc")
    .execute();

  const shares = rows.length
    ? await db
        .selectFrom("item_shares")
        .select(["item_id", "member_id"])
        .where(
          "item_id",
          "in",
          rows.map((r) => r.id),
        )
        .execute()
    : [];

  const byItem = new Map<string, string[]>();
  for (const s of shares) {
    const list = byItem.get(s.item_id);
    if (list) list.push(s.member_id);
    else byItem.set(s.item_id, [s.member_id]);
  }
  // 대상 순서를 멤버 순서로 고정한다 — 순서가 흔들리면 화면이 깜빡인다
  const order = new Map(settleMembers.map((m, i) => [m.id, i]));
  for (const list of byItem.values()) {
    list.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  const items: SettleItem[] = rows.map((r) => ({
    id: r.id,
    dayN: r.dayN,
    date: r.date,
    title: r.title,
    cat: r.cat,
    split: r.split,
    cost: num(r.cost),
    cur: r.cur,
    rate: num(r.rate),
    payer: r.payer,
    shared: { members: byItem.get(r.id) ?? [], guests: r.guests },
  }));

  const tRows = await db
    .selectFrom("transfer_states")
    .select(["from_id", "to_id", "state"])
    .where("group_id", "=", groupId)
    .execute();
  const transferStates = Object.fromEntries(
    tRows.map((t) => [transferKey(t.from_id, t.to_id), t.state]),
  );

  const gRows = await db
    .selectFrom("guest_back_states")
    .select(["member_id", "received"])
    .where("group_id", "=", groupId)
    .execute();
  const guestBackStates = Object.fromEntries(gRows.map((g) => [g.member_id, g.received]));

  const result = settle({ members: settleMembers, items, transferStates, guestBackStates });

  const check = verifySettlement(result);
  if (!check.ok) {
    throw new ApiError(500, "정산 계산이 검증을 통과하지 못했습니다", "settle_invariant", check.problems);
  }
  return result;
}

/**
 * 정산이 마감됐는지 DB 에 반영한다.
 * 마감은 "모든 이체와 수령 확인이 끝났고, 미지정·대상없음 항목이 없는" 상태다.
 * 항목이 바뀌면 자동으로 풀린다 — closed 는 계산 결과이지 사람이 누르는 버튼이 아니다.
 */
export async function syncClosed(groupId: string, result: SettleResult): Promise<Date | null> {
  const cur = await db
    .selectFrom("groups")
    .select("settle_closed_at")
    .where("id", "=", groupId)
    .executeTakeFirst();

  if (result.closed && !cur?.settle_closed_at) {
    const at = new Date();
    await db.updateTable("groups").set({ settle_closed_at: at }).where("id", "=", groupId).execute();
    return at;
  }
  if (!result.closed && cur?.settle_closed_at) {
    await db.updateTable("groups").set({ settle_closed_at: null }).where("id", "=", groupId).execute();
    return null;
  }
  return cur?.settle_closed_at ? new Date(cur.settle_closed_at) : null;
}
