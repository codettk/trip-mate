/**
 * 모임 서비스.
 *
 * 모임이 최상위 단위다. 모임을 만들면 그 자리에서 다음이 함께 생긴다:
 *   · 방장 멤버 행
 *   · 시작~종료에서 자동 생성된 일차들
 *   · 저장소 루트 폴더 (이름 = 모임 제목)
 *   · 정산 공유 토큰
 *
 * ⚠ groups.name 과 루트 folders.name 은 항상 같은 값이다. 한쪽만 바꾸는 코드를 두지 않는다.
 */

import { buildDays, guessCurrency, randomToken, slugify } from "@tripmate/core";
import { db } from "../db/client.ts";
import { colorFor } from "../auth/routes.ts";
import { conflict, notFound } from "../lib/http.ts";
import { storage } from "../storage/index.ts";

export interface CreateGroupInput {
  name: string;
  dest: string;
  start: string;
  end: string;
  memo: string;
  ownerId: string;
  ownerName: string;
}

export async function createGroup(input: CreateGroupInput): Promise<string> {
  const days = buildDays(input.start, input.end); // 기간이 잘못되면 여기서 터진다
  const cur = guessCurrency(input.dest);

  const groupId = await db.transaction().execute(async (trx) => {
    const g = await trx
      .insertInto("groups")
      .values({
        name: input.name,
        dest: input.dest,
        start_date: input.start,
        end_date: input.end,
        memo: input.memo,
        cur,
        owner_id: input.ownerId,
        settle_token: randomToken(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const color = colorFor(input.ownerId);
    await trx
      .insertInto("members")
      .values({
        group_id: g.id,
        user_id: input.ownerId,
        name: input.ownerName,
        color_bg: color.bg,
        color_fg: color.fg,
        role: "owner",
      })
      .execute();

    await trx
      .insertInto("days")
      .values(days.map((d) => ({ group_id: g.id, n: d.n, date: d.date, label: "" })))
      .execute();

    await trx
      .insertInto("folders")
      .values({
        group_id: g.id,
        parent_id: null,
        name: input.name,
        slug: slugify(input.name),
        pub: false,
        share_token: null,
        created_by: input.ownerId,
      })
      .execute();

    return g.id;
  });

  // 저장소 폴더는 트랜잭션 밖에서 만든다 — 외부 호출이 DB 트랜잭션을 잡고 있으면 안 된다.
  await ensureDriveFolder(groupId);
  return groupId;
}

/** 루트 폴더가 저장소에 실제로 만들어졌는지 확인하고, 없으면 만든다. */
export async function ensureDriveFolder(groupId: string): Promise<void> {
  const root = await db
    .selectFrom("folders")
    .select(["id", "name", "drive_folder_id"])
    .where("group_id", "=", groupId)
    .where("parent_id", "is", null)
    .executeTakeFirst();
  if (!root || root.drive_folder_id) return;

  const s = await storage();
  const driveId = await s.createFolder(root.name, null);
  await db
    .updateTable("folders")
    .set({ drive_folder_id: driveId })
    .where("id", "=", root.id)
    .execute();
  await db.updateTable("groups").set({ drive_folder_id: driveId }).where("id", "=", groupId).execute();
}

/**
 * 모임 이름을 바꾸면 루트 폴더 이름과 Drive 폴더 이름도 같이 바꾼다.
 * folderId 는 유지되므로 이미 뿌린 뷰어 링크가 깨지지 않는다.
 */
export async function renameGroup(groupId: string, name: string): Promise<void> {
  const root = await db
    .selectFrom("folders")
    .select(["id", "drive_folder_id"])
    .where("group_id", "=", groupId)
    .where("parent_id", "is", null)
    .executeTakeFirst();

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable("groups")
      .set({ name, updated_at: new Date() })
      .where("id", "=", groupId)
      .execute();
    if (root) {
      await trx
        .updateTable("folders")
        .set({ name, updated_at: new Date() })
        .where("id", "=", root.id)
        .execute();
    }
  });

  if (root?.drive_folder_id) {
    const s = await storage();
    await s.renameFolder(root.drive_folder_id, name);
  }
}

/**
 * 기간이 바뀌면 일차를 다시 맞춘다.
 *  · 남는 날짜의 일차는 지운다 — 그 날에 붙은 일정이 있으면 거부한다(조용히 지우면 안 된다)
 *  · 새로 생긴 날짜는 추가한다
 *  · 같은 날짜의 label 은 유지한다
 */
export async function syncDays(groupId: string, start: string, end: string): Promise<void> {
  const want = buildDays(start, end);
  const wantDates = new Set(want.map((d) => d.date));

  const have = await db
    .selectFrom("days")
    .select(["id", "date", "n", "label"])
    .where("group_id", "=", groupId)
    .execute();

  const doomed = have.filter((d) => !wantDates.has(d.date));
  if (doomed.length) {
    const counts = await db
      .selectFrom("items")
      .select(["day_id"])
      .where(
        "day_id",
        "in",
        doomed.map((d) => d.id),
      )
      .execute();
    if (counts.length) {
      const dates = [...new Set(doomed.filter((d) => counts.some((c) => c.day_id === d.id)).map((d) => d.date))];
      throw conflict(
        `기간에서 빠지는 날짜에 일정이 남아 있습니다: ${dates.join(", ")}. 먼저 옮기거나 삭제하세요.`,
        { dates },
      );
    }
  }

  await db.transaction().execute(async (trx) => {
    if (doomed.length) {
      await trx
        .deleteFrom("days")
        .where(
          "id",
          "in",
          doomed.map((d) => d.id),
        )
        .execute();
    }

    const haveByDate = new Map(have.map((d) => [d.date, d]));
    // n 이 UNIQUE 라 한 번에 바꾸면 충돌한다. 먼저 음수로 밀어 두고 다시 채운다.
    await trx
      .updateTable("days")
      .set((eb) => ({ n: eb("n", "*", -1) }))
      .where("group_id", "=", groupId)
      .where("n", ">", 0)
      .execute();

    for (const d of want) {
      const existing = haveByDate.get(d.date);
      if (existing) {
        await trx.updateTable("days").set({ n: d.n }).where("id", "=", existing.id).execute();
      } else {
        await trx
          .insertInto("days")
          .values({ group_id: groupId, n: d.n, date: d.date, label: "" })
          .execute();
      }
    }
  });
}

export async function groupOrThrow(groupId: string) {
  const g = await db
    .selectFrom("groups")
    .selectAll()
    .where("id", "=", groupId)
    .executeTakeFirst();
  if (!g || g.deleted_at) throw notFound("모임을 찾을 수 없습니다");
  return g;
}
