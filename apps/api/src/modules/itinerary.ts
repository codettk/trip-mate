/**
 * ══════════ 일정 ══════════
 *
 * 일차(Day)는 모임 기간에서 자동 생성되므로 여기서 추가·삭제하지 않는다. label 만 고친다.
 * 항목(Item)은 일정이자 지출이다 — `split` 토글 하나로 두 얼굴이 갈린다.
 *
 * 이 파일이 지키는 세 가지 (전부 기획에서 못박힌 것):
 *
 *  1. split=false 면 금액을 "실제로" 비운다.
 *     화면에서 숨기는 게 아니라 DB 에서 0/null 로 확정한다. 숨겨진 금액이 남으면
 *     나중에 토글을 켰을 때 아무도 기억 못 하는 숫자가 되살아난다.
 *     (DB 의 items_nosplit_empty_ck 가 같은 규칙을 한 번 더 막는다.)
 *
 *  2. rate 는 클라이언트가 보내지 않는다.
 *     서버가 "그 항목이 속한 일차의 날짜"로 마감 환율을 불러 스냅샷한다.
 *     환율표가 나중에 갱신돼도 이미 저장된 금액이 흔들리면 안 되기 때문이다.
 *
 *  3. 항목이 바뀌면 정산 마감이 풀린다.
 *     금액이 바뀌었는데 "마감됨"이 남아 있으면 거짓말이 된다.
 */

import {
  CATEGORIES,
  currencyOf,
  dowOf,
  isCurrency,
  nightsOf,
  stayPhase,
  staysOn,
  type Category,
  type StayPhase,
} from "@tripmate/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireMember } from "../auth/membership.ts";
import { requireAuth } from "../auth/session.ts";
import { db, num } from "../db/client.ts";
import { badRequest, notFound } from "../lib/http.ts";
import { closingRate } from "../rates/provider.ts";

// ────────────────────────────────────────────────────────────────────
// 검증 스키마
// ────────────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 빈 문자열이거나 24시간제 HH:MM. 그 사이는 없다. */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const uuid = z.string().uuid("id 형식이 올바르지 않습니다");
const isoDate = z.string().regex(ISO_DATE, "날짜는 YYYY-MM-DD 형식이어야 합니다");

const sharedSchema = z.object({
  members: z.array(uuid).max(100),
  // 모임에 초대되지 않은 사람은 "기타 인원 N명"으로 센다. 50명을 넘길 일이 없다.
  guests: z.number().int("기타 인원은 정수여야 합니다").min(0).max(50),
});

/**
 * 반드시 받아야 하는 건 일차·카테고리·제목 셋뿐이다.
 * 나머지는 기본값을 서버가 채운다 — 일정만 빠르게 추가하는 경우가 가장 흔하고,
 * 그때 빈 문자열과 false 를 폼이 일일이 실어 보내게 만들 이유가 없다.
 */
const itemBodySchema = z.object({
  dayId: uuid,
  cat: z.enum(CATEGORIES),
  title: z.string().trim().min(1, "제목을 입력하세요").max(120),

  time: z.string().max(5).default(""),
  meta: z.string().max(300).default(""),
  booked: z.boolean().default(false),
  thumb: z.string().max(500).nullable().default(null),
  checkIn: isoDate.nullable().default(null),
  checkOut: isoDate.nullable().default(null),

  // 정산 토글이 꺼져 있으면 아래 넷은 저장 시 서버가 강제로 비운다
  split: z.boolean().default(false),
  cost: z.number().finite().min(0, "금액은 0 이상이어야 합니다").max(1e12).default(0),
  cur: z.string().trim().max(8).optional(),
  payerId: uuid.nullable().default(null),
  shared: sharedSchema.default({ members: [], guests: 0 }),
});

/** PATCH 는 보낸 필드만 덮어쓴다. 나머지는 기존 값을 그대로 쓴다. */
const itemPatchSchema = itemBodySchema.partial();

const dayPatchSchema = z.object({
  label: z.string().trim().max(30, "일차 이름은 30자를 넘을 수 없습니다"),
});

// ────────────────────────────────────────────────────────────────────
// 응답 형태 (docs/API.md 의 "Item 응답")
// ────────────────────────────────────────────────────────────────────

interface ItemDto {
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
  split: boolean;
  cost: number;
  cur: string;
  rate: number;
  /** 원화 정수 환산액. split=false 면 0 — 화면에는 "정산 제외"로 표시한다 */
  krw: number;
  payerId: string | null;
  shared: { members: string[]; guests: number };
}

interface StayChip {
  itemId: string;
  title: string;
  phase: StayPhase;
}

/**
 * 항목을 읽어 응답 형태로 만든다.
 *
 * ⚠ N+1 을 만들지 않는다 — items 를 한 번, item_shares 를 한 번 읽어 메모리에서 합친다.
 *   일정 화면은 모든 일차를 한 번에 그리므로 항목마다 쿼리를 날리면 바로 수십 번이 된다.
 */
async function readItems(groupId: string, itemId?: string): Promise<ItemDto[]> {
  let q = db
    .selectFrom("items")
    .innerJoin("days", "days.id", "items.day_id")
    .select([
      "items.id as id",
      "items.day_id as dayId",
      "items.time as time",
      "items.cat as cat",
      "items.title as title",
      "items.meta as meta",
      "items.booked as booked",
      "items.thumb as thumb",
      "items.split as split",
      "items.cost as cost",
      "items.cur as cur",
      "items.rate as rate",
      "items.payer_id as payerId",
      "items.guests as guests",
      "items.check_in as checkIn",
      "items.check_out as checkOut",
      "items.sort_order as sortOrder",
      "days.n as dayN",
      "days.date as date",
    ])
    .where("items.group_id", "=", groupId);
  if (itemId) q = q.where("items.id", "=", itemId);
  const rows = await q.execute();

  // 정산 대상 순서를 멤버 합류순으로 고정한다 — 순서가 흔들리면 아바타가 매번 자리를 바꿔 화면이 깜빡인다.
  const memberOrder = new Map(
    (
      await db
        .selectFrom("members")
        .select("id")
        .where("group_id", "=", groupId)
        .orderBy("joined_at", "asc")
        .orderBy("id", "asc")
        .execute()
    ).map((m, i) => [m.id, i] as const),
  );

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
  for (const list of byItem.values()) {
    list.sort((a, b) => (memberOrder.get(a) ?? 0) - (memberOrder.get(b) ?? 0));
  }

  // time 오름차순 · 빈 시간은 뒤로 · 같으면 sort_order · 그 다음 id
  rows.sort((a, b) => {
    const ea = a.time === "" ? 1 : 0;
    const eb = b.time === "" ? 1 : 0;
    if (ea !== eb) return ea - eb;
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return rows.map((r) => {
    const cost = num(r.cost);
    const rate = num(r.rate);
    return {
      id: r.id,
      dayId: r.dayId,
      dayN: r.dayN,
      date: r.date,
      time: r.time,
      cat: r.cat,
      title: r.title,
      meta: r.meta,
      booked: r.booked,
      thumb: r.thumb,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      nights: nightsOf(r.checkIn, r.checkOut),
      split: r.split,
      cost,
      cur: r.cur,
      rate,
      // 정산 제외 항목은 금액을 0 으로 내보낸다. 화면에 숫자가 남으면 정산에 들어간 것처럼 보인다.
      krw: r.split ? Math.round(cost * rate) : 0,
      payerId: r.payerId,
      shared: { members: byItem.get(r.id) ?? [], guests: r.guests },
    };
  });
}

async function itemOrThrow(groupId: string, itemId: string): Promise<ItemDto> {
  const [item] = await readItems(groupId, itemId);
  if (!item) throw notFound("일정을 찾을 수 없습니다");
  return item;
}

// ────────────────────────────────────────────────────────────────────
// 저장 전 정규화
// ────────────────────────────────────────────────────────────────────

/** DB 에 그대로 쓸 수 있는, 규칙이 전부 적용된 값. */
interface Normalized {
  dayId: string;
  time: string;
  cat: Category;
  title: string;
  meta: string;
  booked: boolean;
  thumb: string | null;
  checkIn: string | null;
  checkOut: string | null;
  split: boolean;
  cost: number;
  cur: string;
  rate: number;
  payerId: string | null;
  guests: number;
  members: string[];
}

/** 정규화에 들어가는 원본 값 (POST 는 body 그대로, PATCH 는 기존 값 위에 body 를 덮은 것). */
interface Draft {
  dayId: string;
  time: string;
  cat: Category;
  title: string;
  meta: string;
  booked: boolean;
  thumb: string | null;
  checkIn: string | null;
  checkOut: string | null;
  split: boolean;
  cost: number;
  /** 안 보내면 모임 기본 통화를 쓴다 — 여행지에서 이미 추론해 둔 값이다 */
  cur: string | undefined;
  payerId: string | null;
  members: string[];
  guests: number;
}

/** rate 재스냅샷 판단에 쓰는 이전 상태. 생성이면 없다. */
interface Prev {
  dayId: string;
  cur: string;
  rate: number;
  split: boolean;
}

async function normalize(groupId: string, draft: Draft, prev?: Prev): Promise<Normalized> {
  const group = await db
    .selectFrom("groups")
    .select(["cur", "start_date", "end_date", "deleted_at"])
    .where("id", "=", groupId)
    .executeTakeFirst();
  if (!group || group.deleted_at) throw notFound("모임을 찾을 수 없습니다");

  // ── 일차 ─────────────────────────────────────────────────────────
  // 다른 모임의 일차 id 를 넣어 남의 모임에 항목을 꽂는 걸 막는다.
  const day = await db
    .selectFrom("days")
    .select(["id", "date"])
    .where("id", "=", draft.dayId)
    .where("group_id", "=", groupId)
    .executeTakeFirst();
  if (!day) throw badRequest("이 모임의 일차가 아닙니다");

  // ── 시간 ─────────────────────────────────────────────────────────
  const time = draft.time.trim();
  if (time !== "" && !HHMM.test(time)) throw badRequest("시간은 비워 두거나 HH:MM 형식이어야 합니다");

  // ── 숙소 기간 ────────────────────────────────────────────────────
  // 숙소가 아니면 체크인·체크아웃은 무조건 비운다. 카테고리를 바꿨는데 날짜가 남아 있으면
  // staysOn() 이 그 항목을 계속 "숙박 중"으로 집어낸다.
  let checkIn: string | null = null;
  let checkOut: string | null = null;
  if (draft.cat === "stay") {
    checkIn = draft.checkIn;
    checkOut = draft.checkOut;
    if ((checkIn === null) !== (checkOut === null)) {
      throw badRequest("숙소는 체크인·체크아웃 날짜를 함께 입력해야 합니다");
    }
    if (checkIn && checkOut) {
      if (checkOut < checkIn) throw badRequest("체크아웃이 체크인보다 빠릅니다");
      for (const d of [checkIn, checkOut]) {
        if (d < group.start_date || d > group.end_date) {
          throw badRequest(
            `숙소 기간은 여행 기간(${group.start_date} ~ ${group.end_date}) 안이어야 합니다`,
          );
        }
      }
    }
  }

  // ── 정산 끔 ──────────────────────────────────────────────────────
  // 숨겨진 금액을 남기지 않는다. 폼에서 안 보이는 게 아니라 DB 에서 실제로 비운다.
  if (!draft.split) {
    return {
      dayId: day.id,
      time,
      cat: draft.cat,
      title: draft.title,
      meta: draft.meta,
      booked: draft.booked,
      thumb: draft.thumb,
      checkIn,
      checkOut,
      split: false,
      cost: 0,
      cur: group.cur, // 다시 켤 때의 출발점은 모임 기본 통화다
      rate: 1,
      payerId: null,
      guests: 0,
      members: [],
    };
  }

  // ── 통화·금액 ────────────────────────────────────────────────────
  const cur = (draft.cur || group.cur).toUpperCase();
  if (!isCurrency(cur)) throw badRequest(`지원하지 않는 통화입니다: ${cur}`);

  const dec = currencyOf(cur).dec;
  const scaled = draft.cost * 10 ** dec;
  // 부동소수 오차(120.1 * 100 = 12010.000000000002)를 정수 판정으로 오해하지 않도록 여유를 둔다.
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) {
    throw badRequest(
      dec === 0
        ? `${cur} 금액에는 소수점을 쓸 수 없습니다`
        : `${cur} 금액은 소수점 ${dec}자리까지만 입력할 수 있습니다`,
    );
  }

  // ── 결제자·정산 대상 ─────────────────────────────────────────────
  // 나간 멤버도 허용한다. 이미 낸 돈과 낼 돈이 있어서 정산에서 빼면 잔액 합이 0이 되지 않는다.
  const members = [...new Set(draft.members)];
  const wanted = [...members];
  if (draft.payerId) wanted.push(draft.payerId);

  if (wanted.length) {
    const ok = await db
      .selectFrom("members")
      .select("id")
      .where("group_id", "=", groupId)
      .where("id", "in", wanted)
      .execute();
    const okIds = new Set(ok.map((m) => m.id));
    const bad = wanted.filter((id) => !okIds.has(id));
    if (bad.length) throw badRequest("이 모임의 멤버가 아닌 사람이 포함돼 있습니다", { ids: bad });
  }

  // ── 환율 스냅샷 ──────────────────────────────────────────────────
  // 통화도 일차도 그대로면 기존 rate 를 유지한다.
  // 제목만 고쳤는데 환산 금액이 달라지면(= 환율표가 그새 갱신됐다면) 사용자가 만지지 않은 숫자가
  // 혼자 움직인 것이라 신뢰를 잃는다.
  // 반대로 통화나 일차가 바뀌면 "그 항목이 속한 일자의 마감 환율"이라는 정의 자체가 바뀌므로 다시 뜬다.
  // prev.split === false 였다면 저장돼 있던 rate 는 스냅샷이 아니라 강제로 넣은 1 이므로 재사용하지 않는다.
  const keepRate =
    prev !== undefined && prev.split && prev.cur === cur && prev.dayId === day.id;
  const rate = keepRate ? prev.rate : await closingRate(day.date, cur);

  return {
    dayId: day.id,
    time,
    cat: draft.cat,
    title: draft.title,
    meta: draft.meta,
    booked: draft.booked,
    thumb: draft.thumb,
    checkIn,
    checkOut,
    split: true,
    cost: draft.cost,
    cur,
    rate,
    payerId: draft.payerId,
    guests: draft.guests,
    members,
  };
}

/**
 * ── 정산 마감 자동 해제에 대하여 ──────────────────────────────────
 *
 * 항목을 만들거나 고치거나 지우면 아래 트랜잭션들이 `groups.settle_closed_at` 을 NULL 로 되돌린다.
 * 금액이나 대상이 바뀌었는데 "마감됨"이 남아 있으면 화면이 거짓말을 하기 때문이다.
 *
 * 판단 근거는 docs/decisions/2026-08-17-implementation-choices.md B항이지만,
 * 여기서는 **자동 해제만** 한다 — "방장만 마감을 풀 수 있다"는 잠금은 만들지 않았다.
 * 마감은 사람이 누르는 버튼이 아니라 계산 결과(services/settlement.ts 의 syncClosed)이고,
 * 잠금을 두면 방장이 풀어 줄 때까지 여행 중에 영수증 하나 못 고치게 된다.
 */

// ────────────────────────────────────────────────────────────────────
// 라우트
// ────────────────────────────────────────────────────────────────────

export async function itineraryRoutes(app: FastifyInstance): Promise<void> {
  // ── 일정 전체 ──────────────────────────────────────────────────
  app.get("/api/groups/:gid/itinerary", async (req) => {
    const user = await requireAuth(req);
    const { gid } = req.params as { gid: string };
    await requireMember(user, gid);

    const days = await db
      .selectFrom("days")
      .select(["id", "n", "date", "label"])
      .where("group_id", "=", gid)
      .orderBy("n", "asc")
      .execute();

    const items = await readItems(gid);

    const byDay = new Map<string, ItemDto[]>();
    for (const it of items) {
      const list = byDay.get(it.dayId);
      if (list) list.push(it);
      else byDay.set(it.dayId, [it]);
    }

    // 숙소 칩은 항목 목록과 별개로 매일 다시 계산한다.
    // 숙소 항목 자체는 체크인한 날의 items 에 그대로 남아 있고,
    // 그 사이 날짜에는 "숙박 중"으로만 나타난다.
    // 체크아웃하는 곳과 새로 체크인하는 곳이 겹치는 날에는 칩이 2개 이상 나온다.
    const stayItems = items.filter((i) => i.cat === "stay");

    return {
      days: days.map((d) => ({
        id: d.id,
        n: d.n,
        date: d.date,
        dow: dowOf(d.date),
        label: d.label,
        stays: staysOn(stayItems, d.date).map(
          (s): StayChip => ({
            itemId: s.id,
            title: s.title,
            phase: stayPhase(d.date, s.checkIn, s.checkOut) ?? "mid",
          }),
        ),
        items: byDay.get(d.id) ?? [],
      })),
    };
  });

  // ── 일차 이름 ──────────────────────────────────────────────────
  app.patch("/api/groups/:gid/days/:did", async (req) => {
    const user = await requireAuth(req);
    const { gid, did } = req.params as { gid: string; did: string };
    await requireMember(user, gid);

    const body = dayPatchSchema.safeParse(req.body);
    if (!body.success) throw badRequest("일차 이름은 30자까지 입력할 수 있습니다");

    // 다른 모임의 일차를 고치지 못하게 group_id 를 함께 건다.
    const day = await db
      .selectFrom("days")
      .select(["id", "n", "date"])
      .where("id", "=", did)
      .where("group_id", "=", gid)
      .executeTakeFirst();
    if (!day) throw notFound("일차를 찾을 수 없습니다");

    await db.updateTable("days").set({ label: body.data.label }).where("id", "=", did).execute();

    return { id: day.id, n: day.n, date: day.date, dow: dowOf(day.date), label: body.data.label };
  });

  // ── 항목 생성 ──────────────────────────────────────────────────
  app.post("/api/groups/:gid/items", async (req) => {
    const user = await requireAuth(req);
    const { gid } = req.params as { gid: string };
    await requireMember(user, gid);

    const parsed = itemBodySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("일정 입력값이 올바르지 않습니다", parsed.error.issues);
    const b = parsed.data;

    const n = await normalize(gid, {
      dayId: b.dayId,
      time: b.time,
      cat: b.cat,
      title: b.title,
      meta: b.meta,
      booked: b.booked,
      thumb: b.thumb,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      split: b.split,
      cost: b.cost,
      cur: b.cur,
      payerId: b.payerId,
      members: b.shared.members,
      guests: b.shared.guests,
    });

    // 같은 시간대 항목의 표시 순서를 안정시킨다 — 새 항목이 뒤에 붙는다.
    const last = await db
      .selectFrom("items")
      .select("sort_order")
      .where("day_id", "=", n.dayId)
      .orderBy("sort_order", "desc")
      .limit(1)
      .executeTakeFirst();
    const sortOrder = (last?.sort_order ?? 0) + 1;

    const id = await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto("items")
        .values({
          group_id: gid,
          day_id: n.dayId,
          time: n.time,
          cat: n.cat,
          title: n.title,
          meta: n.meta,
          booked: n.booked,
          thumb: n.thumb,
          split: n.split,
          cost: n.cost,
          cur: n.cur,
          rate: n.rate,
          payer_id: n.payerId,
          guests: n.guests,
          check_in: n.checkIn,
          check_out: n.checkOut,
          sort_order: sortOrder,
          created_by: user.id,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      if (n.members.length) {
        await trx
          .insertInto("item_shares")
          .values(n.members.map((m) => ({ item_id: row.id, member_id: m })))
          .execute();
      }

      await trx
        .updateTable("groups")
        .set({ settle_closed_at: null, updated_at: new Date() })
        .where("id", "=", gid)
        .execute();

      return row.id;
    });

    return itemOrThrow(gid, id);
  });

  // ── 항목 수정 ──────────────────────────────────────────────────
  app.patch("/api/groups/:gid/items/:iid", async (req) => {
    const user = await requireAuth(req);
    const { gid, iid } = req.params as { gid: string; iid: string };
    await requireMember(user, gid);

    const parsed = itemPatchSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("일정 입력값이 올바르지 않습니다", parsed.error.issues);
    const b = parsed.data;

    const cur = await itemOrThrow(gid, iid);

    // 보낸 필드만 덮어쓴다. 안 보낸 필드까지 기본값으로 밀면 제목만 고쳤는데 금액이 날아간다.
    const n = await normalize(
      gid,
      {
        dayId: b.dayId ?? cur.dayId,
        time: b.time ?? cur.time,
        cat: b.cat ?? cur.cat,
        title: b.title ?? cur.title,
        meta: b.meta ?? cur.meta,
        booked: b.booked ?? cur.booked,
        thumb: b.thumb !== undefined ? b.thumb : cur.thumb,
        checkIn: b.checkIn !== undefined ? b.checkIn : cur.checkIn,
        checkOut: b.checkOut !== undefined ? b.checkOut : cur.checkOut,
        split: b.split ?? cur.split,
        cost: b.cost ?? cur.cost,
        cur: b.cur ?? cur.cur,
        payerId: b.payerId !== undefined ? b.payerId : cur.payerId,
        members: b.shared?.members ?? cur.shared.members,
        guests: b.shared?.guests ?? cur.shared.guests,
      },
      { dayId: cur.dayId, cur: cur.cur, rate: cur.rate, split: cur.split },
    );

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("items")
        .set({
          day_id: n.dayId,
          time: n.time,
          cat: n.cat,
          title: n.title,
          meta: n.meta,
          booked: n.booked,
          thumb: n.thumb,
          split: n.split,
          cost: n.cost,
          cur: n.cur,
          rate: n.rate,
          payer_id: n.payerId,
          guests: n.guests,
          check_in: n.checkIn,
          check_out: n.checkOut,
          updated_at: new Date(),
        })
        .where("id", "=", iid)
        .where("group_id", "=", gid)
        .execute();

      // 대상은 통째로 갈아 끼운다. 부분 갱신은 "빠진 사람"을 놓치기 쉽다.
      await trx.deleteFrom("item_shares").where("item_id", "=", iid).execute();
      if (n.members.length) {
        await trx
          .insertInto("item_shares")
          .values(n.members.map((m) => ({ item_id: iid, member_id: m })))
          .execute();
      }

      await trx
        .updateTable("groups")
        .set({ settle_closed_at: null, updated_at: new Date() })
        .where("id", "=", gid)
        .execute();
    });

    return itemOrThrow(gid, iid);
  });

  // ── 항목 삭제 ──────────────────────────────────────────────────
  app.delete("/api/groups/:gid/items/:iid", async (req) => {
    const user = await requireAuth(req);
    const { gid, iid } = req.params as { gid: string; iid: string };
    await requireMember(user, gid);

    const exists = await db
      .selectFrom("items")
      .select("id")
      .where("id", "=", iid)
      .where("group_id", "=", gid)
      .executeTakeFirst();
    if (!exists) throw notFound("일정을 찾을 수 없습니다");

    await db.transaction().execute(async (trx) => {
      // item_shares 는 FK ON DELETE CASCADE 로 같이 지워진다.
      await trx.deleteFrom("items").where("id", "=", iid).where("group_id", "=", gid).execute();
      // 지출이 하나 사라졌으니 이체 목록이 달라진다 — 마감을 풀어 둔다.
      await trx
        .updateTable("groups")
        .set({ settle_closed_at: null, updated_at: new Date() })
        .where("id", "=", gid)
        .execute();
    });

    return { ok: true };
  });

  // ── 환율 조회 ──────────────────────────────────────────────────
  // 폼에서 통화를 고르는 순간 환산액을 보여주기 위한 것.
  // 저장은 별개다 — 실제 스냅샷은 POST/PATCH 가 서버에서 다시 뜬다.
  app.get("/api/groups/:gid/rates", async (req) => {
    const user = await requireAuth(req);
    const { gid } = req.params as { gid: string };
    await requireMember(user, gid);

    const q = z
      .object({ date: isoDate, cur: z.string().min(1) })
      .safeParse(req.query);
    if (!q.success) throw badRequest("date(YYYY-MM-DD)와 cur 을 지정하세요");

    const codes = [
      ...new Set(
        q.data.cur
          .split(",")
          .map((c) => c.trim().toUpperCase())
          .filter((c) => c.length > 0),
      ),
    ];
    if (!codes.length) throw badRequest("통화를 지정하세요");
    if (codes.length > 20) throw badRequest("통화는 한 번에 20개까지 조회할 수 있습니다");

    const bad = codes.filter((c) => !isCurrency(c));
    if (bad.length) throw badRequest(`지원하지 않는 통화입니다: ${bad.join(", ")}`);

    const rates: Record<string, number> = {};
    for (const c of codes) rates[c] = await closingRate(q.data.date, c);

    // 하나만 물었으면 하나만 준다 — 폼이 매번 객체를 헤집지 않게.
    const only = codes[0];
    if (codes.length === 1 && only) {
      return { date: q.data.date, cur: only, rate: rates[only] as number };
    }
    return { date: q.data.date, rates };
  });
}
