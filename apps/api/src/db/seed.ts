/**
 * 시드 — 프로토타입(prototype/index.html)의 데모 데이터를 DB 에 그대로 넣는다.
 *
 *   npm run seed -w @tripmate/api
 *
 * 목적은 "화면을 바로 볼 수 있는 상태"다. 마이그레이션 직후 이걸 돌리면
 * 목 로그인(지현 등)만으로 일정·폴더·문서·정산이 전부 채워진 모임이 열린다.
 *
 * 규칙:
 *  · 두 번 돌려도 중복이 생기지 않는다 — 같은 이름의 기존 시드 모임을 먼저 하드 삭제한다.
 *  · 운영에서는 거부한다.
 *  · 마지막에 정산을 검증한다. 프로토타입과 숫자가 다르면 에러로 종료한다 —
 *    시드가 조용히 틀리면 이후 모든 확인이 의미를 잃는다.
 */

import { buildDays, formatWon, randomToken, slugify, verifySettlement } from "@tripmate/core";
import { closeDb, db } from "./client.ts";
import { env } from "../env.ts";
import { loadSettlement } from "../services/settlement.ts";
import { storage } from "../storage/index.ts";

// ══════════ 시드 정의 ══════════ 프로토타입 743~815줄과 1:1 로 맞춘다

const GROUP_NAME = "제주도 4박 5일";
const GROUP_DEST = "제주도";
const START = "2026-09-12";
const END = "2026-09-16";
const MEMO = "렌터카 1대 · 숙소 2곳 (성산 2박 → 서귀포 2박)";
const CUR = "KRW";

interface SeedMember {
  key: string;
  name: string;
  bg: string;
  fg: string;
  /** 나간 멤버. 정산에는 그대로 남고 화면에는 "기타(나감)"으로 나온다 */
  left?: boolean;
  owner?: boolean;
}

const MEMBERS: SeedMember[] = [
  { key: "jh", name: "지현", bg: "#E3EAFB", fg: "#2F53E0", owner: true },
  { key: "ms", name: "민수", bg: "#FBE4E8", fg: "#D8455C" },
  { key: "sa", name: "수아", bg: "#F1E8FB", fg: "#7A4FD0" },
  { key: "yh", name: "윤호", bg: "#DEF1EA", fg: "#12866A" },
  { key: "gy", name: "기영", bg: "#EEF1F5", fg: "#8A94A6", left: true },
];

/** 새 지출의 기본 정산 대상 = 안 나간 멤버 전원 */
const ALL = ["jh", "ms", "sa", "yh"];

interface SeedItem {
  time: string;
  cat: "stay" | "pkg" | "spot" | "food" | "move";
  title: string;
  meta: string;
  booked?: boolean;
  thumb?: string;
  /** 정산 토글. false 면 금액·결제자·대상을 아예 갖지 않는다 */
  split?: boolean;
  cost?: number;
  /** 결제자는 사전 배정하지 않는다 — null 이면 "결제자 미지정" 배지가 뜬다 */
  payer?: string | null;
  members?: string[];
  /** 모임에 초대되지 않은 인원. 분모에는 들어가지만 정산에서는 빠진다 */
  guests?: number;
  checkIn?: string;
  checkOut?: string;
}

const DAYS: Array<{ n: number; label: string; items: SeedItem[] }> = [
  {
    n: 1,
    label: "도착 · 성산",
    items: [
      { time: "08:20", cat: "move", title: "김포 → 제주 (KE1201)", meta: "4인 왕복 · 수하물 포함", split: true, cost: 316000, payer: "jh", members: ALL, booked: true },
      { time: "11:00", cat: "move", title: "렌터카 픽업", meta: "쏘렌토 · 4박 5일 · 완전자차", split: true, cost: 240000, payer: "ms", members: ALL, booked: true },
      { time: "12:30", cat: "food", title: "올레국수", meta: "공항 근처 · 고기국수 4인", split: true, cost: 42000, payer: "sa", members: ALL, thumb: "linear-gradient(140deg,#E4B77C,#C88A6B)" },
      // 결제자 미지정 ①
      { time: "15:00", cat: "spot", title: "성산일출봉", meta: "입장 5,000원 · 도보 40분 코스", split: true, cost: 20000, payer: null, members: ALL, thumb: "linear-gradient(140deg,#8FB79C,#5F7D6B)" },
      { time: "18:00", cat: "stay", title: "씨에스호텔 제주", meta: "트윈 2실 · 조식 포함", split: true, cost: 340000, payer: "jh", members: ALL, booked: true, checkIn: "2026-09-12", checkOut: "2026-09-14", thumb: "linear-gradient(140deg,#A9BEDB,#7FA3C8)" },
      // 나간 멤버(기영)와 기타 인원 2명이 함께 들어간 항목 — 정산의 핵심 확인 지점
      { time: "20:00", cat: "food", title: "흑돼지 회식", meta: "기영 + 현지 친구 2명 합류", split: true, cost: 180000, payer: "sa", members: [...ALL, "gy"], guests: 2, thumb: "linear-gradient(140deg,#D69A8E,#B3736A)" },
    ],
  },
  {
    n: 2,
    label: "우도 · 동부",
    items: [
      { time: "09:00", cat: "pkg", title: "우도 종일 패키지", meta: "도선 왕복 + 전기차 + 가이드 · 4인", split: true, cost: 240000, payer: "yh", members: ALL, booked: true },
      // 정산 제외 ① — 금액을 비운 채로 남긴다. 조용히 사라지면 안 된다
      { time: "13:00", cat: "food", title: "해녀의집", meta: "성게미역국 · 우도 패키지에 포함", thumb: "linear-gradient(140deg,#9BC4BC,#6FA6A0)" },
      // 결제자 미지정 ②
      { time: "16:30", cat: "spot", title: "비자림", meta: "입장 3,000원 · 숲길 1시간", split: true, cost: 12000, payer: null, members: ALL, thumb: "linear-gradient(140deg,#A7C0A0,#6E8F73)" },
      // 전원 균등이 규칙이 아니라는 증거 — 두 명만 대상
      { time: "19:30", cat: "food", title: "애월 카페 · 야경", meta: "지현·민수만 들름", split: true, cost: 28000, payer: "jh", members: ["jh", "ms"] },
    ],
  },
  {
    n: 3,
    label: "서귀포 이동",
    items: [
      { time: "10:30", cat: "spot", title: "카멜리아힐", meta: "수국 시즌 · 입장 6,000원", split: true, cost: 24000, payer: "yh", members: ALL },
      // 09-14 는 씨에스호텔 체크아웃 + 오션스테이 체크인 → 하루에 숙소 2개
      { time: "15:00", cat: "stay", title: "서귀포 오션스테이", meta: "복층 1채 · 바베큐 가능", split: true, cost: 300000, payer: "ms", members: ALL, booked: true, checkIn: "2026-09-14", checkOut: "2026-09-16", thumb: "linear-gradient(140deg,#93AEC0,#6B8FA3)" },
      // 결제자 미지정 ③
      { time: "19:00", cat: "food", title: "올레시장 저녁", meta: "회 + 오메기떡", split: true, cost: 68000, payer: null, members: ALL },
    ],
  },
  { n: 4, label: "한라산", items: [] },
  {
    n: 5,
    label: "출발 · 정산",
    items: [
      // 정산 제외 ②
      { time: "16:40", cat: "move", title: "제주 → 김포 (KE1210)", meta: "왕복 요금에 포함 — 정산 없음" },
    ],
  },
];

interface SeedFolder {
  name: string;
  pub: boolean;
  kids?: SeedFolder[];
}

/**
 * 폴더 트리. 공개 폴더에는 새 토큰을 발급한다.
 *
 * ⚠ 사진(photos) 행은 넣지 않는다.
 *   실제 파일은 사용자가 Drive 연동 후 직접 올린다. 파일 없이 행만 넣으면
 *   /api/media/:id 가 빈 스트림을 주고 화면에는 깨진 썸네일만 남는다 —
 *   "동작하는 화면"을 보여주려다 오히려 고장난 화면을 보여주게 된다.
 */
const FOLDERS: SeedFolder[] = [
  {
    name: "Day 1 · 성산",
    pub: true,
    kids: [
      { name: "일출봉", pub: false },
      { name: "저녁 · 흑돼지", pub: false },
    ],
  },
  { name: "Day 2 · 우도", pub: false },
  { name: "지현의 드론샷", pub: true },
  { name: "영수증", pub: false },
];

const DOC_TITLE = "제주 계획서";
const DOC_BLOCKS: Array<{ kind: "timetable" | "map" | "stay" | "settle" | "memo"; content: unknown }> = [
  {
    kind: "timetable",
    content: {
      rows: [
        ["09:00", "숙소 조식", ""],
        ["10:30", "우도 도선 탑승", "성산항"],
        ["13:00", "해녀의집 점심", ""],
        ["16:30", "비자림 산책", ""],
      ],
    },
  },
  {
    kind: "memo",
    content: {
      text: "여기에 자유롭게 적으세요.\n\n· 렌터카 반납은 출발 2시간 전\n· 서귀포 숙소 바베큐 예약 확인",
    },
  },
  {
    kind: "stay",
    content: {
      rows: [
        ["씨에스호텔 제주", "09.12 → 09.14 · 2박", 340000],
        ["서귀포 오션스테이", "09.14 → 09.16 · 2박", 300000],
      ],
    },
  },
];

/** 프로토타입 settle() 이 내는 값. 하나라도 어긋나면 시드가 잘못 들어간 것이다. */
const EXPECTED: Record<string, number> = {
  지현: 268786,
  민수: 124786,
  수아: -230644,
  윤호: -137214,
  기영: -25714,
};
const EXPECTED_TOTAL = 1658570;
const EXPECTED_GUEST_TOTAL = 51428;

// ══════════ 실행 ══════════

/** 목 계정. 카카오 로그인 하나만 지원하므로 개발용 kakao_id 는 `mock:이름` 으로 통일한다. */
const mockKakaoId = (name: string) => `mock:${name}`;

async function upsertUser(name: string): Promise<string> {
  const kakaoId = mockKakaoId(name);
  const existing = await db
    .selectFrom("users")
    .select("id")
    .where("kakao_id", "=", kakaoId)
    .executeTakeFirst();
  if (existing) {
    await db.updateTable("users").set({ name, updated_at: new Date() }).where("id", "=", existing.id).execute();
    return existing.id;
  }
  const row = await db
    .insertInto("users")
    .values({ kakao_id: kakaoId, name, avatar_url: null })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * 기존 시드를 지운다. 같은 이름의 모임을 통째로 하드 삭제한다(멤버·일정·폴더·문서가 CASCADE).
 * 사용자 행은 남긴다 — 다른 모임에 들어가 있을 수 있고, 지우면 로그인 세션까지 끊긴다.
 */
/** 통합 테스트가 같은 데이터로 시작할 수 있게 내보낸다. */
export async function wipe(log: (s: string) => void): Promise<void> {
  const olds = await db.selectFrom("groups").select(["id"]).where("name", "=", GROUP_NAME).execute();
  if (!olds.length) return;

  const ids = olds.map((g) => g.id);
  const driveFolders = await db
    .selectFrom("folders")
    .select(["drive_folder_id"])
    .where("group_id", "in", ids)
    .where("drive_folder_id", "is not", null)
    .execute();

  await db.deleteFrom("groups").where("id", "in", ids).execute();

  // 저장소 폴더는 DB 를 지운 뒤 정리한다. 실패해도 시드를 막지 않는다(고아 폴더는 사람이 지울 수 있다).
  const s = await storage();
  for (const f of driveFolders) {
    if (f.drive_folder_id) await s.deleteFolder(f.drive_folder_id).catch(() => undefined);
  }
  log(`  · 기존 시드 모임 ${ids.length}개를 지웠습니다`);
}

export async function seed(log: (s: string) => void): Promise<{ groupId: string }> {
  // ── 사용자 ────────────────────────────────────────────────────────
  const userIds = new Map<string, string>();
  for (const m of MEMBERS) userIds.set(m.key, await upsertUser(m.name));

  const owner = MEMBERS.find((m) => m.owner)!;
  const ownerUserId = userIds.get(owner.key)!;
  const days = buildDays(START, END);

  // ── 모임 · 멤버 · 일차 · 루트 폴더 ────────────────────────────────
  // createGroup() 을 쓰지 않는다 — 방장 이름·색·나간 멤버를 직접 통제해야 하기 때문이다.
  // 대신 createGroup 이 함께 만드는 것(일차·루트 폴더·정산 토큰)을 하나도 빠뜨리지 않는다.
  const { groupId, memberIds, dayIds } = await db.transaction().execute(async (trx) => {
    const g = await trx
      .insertInto("groups")
      .values({
        name: GROUP_NAME,
        dest: GROUP_DEST,
        start_date: START,
        end_date: END,
        memo: MEMO,
        cur: CUR,
        owner_id: ownerUserId,
        settle_token: randomToken(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const memberIds = new Map<string, string>();
    const base = Date.now() - MEMBERS.length * 60_000;
    for (const [i, m] of MEMBERS.entries()) {
      // joined_at 을 명시적으로 벌려 둔다. 전부 같은 시각이면 멤버 순서가 uuid 에 끌려간다.
      const row = await trx
        .insertInto("members")
        .values({
          group_id: g.id,
          user_id: userIds.get(m.key)!,
          name: m.name,
          color_bg: m.bg,
          color_fg: m.fg,
          role: m.owner ? "owner" : "member",
          joined_at: new Date(base + i * 60_000),
          // 나간 멤버도 정산에는 그대로 남는다 — 행을 지우지 않는다
          left_at: m.left ? new Date() : null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      memberIds.set(m.key, row.id);
    }

    const dayIds = new Map<number, string>();
    for (const d of days) {
      const row = await trx
        .insertInto("days")
        .values({
          group_id: g.id,
          n: d.n,
          date: d.date,
          label: DAYS.find((x) => x.n === d.n)?.label ?? "",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      dayIds.set(d.n, row.id);
    }

    await trx
      .insertInto("folders")
      .values({
        group_id: g.id,
        parent_id: null,
        name: GROUP_NAME, // 루트 폴더 이름 = 모임 제목. 항상 같은 값이다
        slug: slugify(GROUP_NAME),
        pub: false,
        share_token: null,
        created_by: ownerUserId,
      })
      .execute();

    return { groupId: g.id, memberIds, dayIds };
  });

  // ── 일정 항목 ─────────────────────────────────────────────────────
  let itemCount = 0;
  for (const day of DAYS) {
    for (const [i, it] of day.items.entries()) {
      const split = it.split === true;
      const inserted = await db
        .insertInto("items")
        .values({
          group_id: groupId,
          day_id: dayIds.get(day.n)!,
          time: it.time,
          cat: it.cat,
          title: it.title,
          meta: it.meta,
          booked: it.booked === true,
          thumb: it.thumb ?? null,
          split,
          // split=false 면 금액·결제자·기타 인원이 실제로 비어야 한다 (DB CHECK 가 강제한다)
          cost: split ? (it.cost ?? 0) : 0,
          cur: CUR,
          rate: 1, // 전부 원화라 환율 스냅샷은 1
          payer_id: split && it.payer ? memberIds.get(it.payer)! : null,
          guests: split ? (it.guests ?? 0) : 0,
          check_in: it.checkIn ?? null,
          check_out: it.checkOut ?? null,
          sort_order: i,
          created_by: ownerUserId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      itemCount++;

      if (split && it.members?.length) {
        await db
          .insertInto("item_shares")
          .values(it.members.map((k) => ({ item_id: inserted.id, member_id: memberIds.get(k)! })))
          .execute();
      }
    }
  }

  // ── 폴더 트리 ─────────────────────────────────────────────────────
  const s = await storage();
  const root = await db
    .selectFrom("folders")
    .select(["id", "name", "drive_folder_id"])
    .where("group_id", "=", groupId)
    .where("parent_id", "is", null)
    .executeTakeFirstOrThrow();

  // 저장소에도 실제 폴더를 만들어 둔다. 사용자가 Drive 를 붙이고 바로 업로드할 수 있어야 한다.
  const rootDriveId = await s.createFolder(root.name, null);
  await db.updateTable("folders").set({ drive_folder_id: rootDriveId }).where("id", "=", root.id).execute();
  await db.updateTable("groups").set({ drive_folder_id: rootDriveId }).where("id", "=", groupId).execute();

  const takenSlugs = new Set<string>([slugify(GROUP_NAME)]);
  let folderCount = 0;
  let publicCount = 0;

  async function makeFolders(list: SeedFolder[], parentId: string, parentDriveId: string): Promise<void> {
    for (const f of list) {
      let slug = slugify(f.name);
      for (let i = 2; takenSlugs.has(slug); i++) slug = `${slugify(f.name)}-${i}`;
      takenSlugs.add(slug);

      const driveId = await s.createFolder(f.name, parentDriveId);
      const row = await db
        .insertInto("folders")
        .values({
          group_id: groupId,
          parent_id: parentId,
          name: f.name,
          slug,
          pub: f.pub,
          // 공개할 때마다 새로 발급한다. 폴더 ID 에서 파생시키지 않는다
          share_token: f.pub ? randomToken() : null,
          drive_folder_id: driveId,
          created_by: ownerUserId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      folderCount++;
      if (f.pub) publicCount++;

      if (f.kids?.length) await makeFolders(f.kids, row.id, driveId);
    }
  }
  await makeFolders(FOLDERS, root.id, rootDriveId);

  // ── 문서 ──────────────────────────────────────────────────────────
  // 문서는 모임 멤버 전용이다. 공개 토글도 토큰도 없다.
  const doc = await db
    .insertInto("docs")
    .values({ group_id: groupId, title: DOC_TITLE, created_by: ownerUserId })
    .returning("id")
    .executeTakeFirstOrThrow();
  for (const [i, b] of DOC_BLOCKS.entries()) {
    await db
      .insertInto("doc_blocks")
      .values({ doc_id: doc.id, kind: b.kind, position: i, content: JSON.stringify(b.content) })
      .execute();
  }

  log(`  · 멤버 ${MEMBERS.length}명 · 일차 ${days.length}일 · 일정 ${itemCount}건`);
  log(`  · 폴더 ${folderCount}개 (공개 ${publicCount}개) · 문서 1개 (블록 ${DOC_BLOCKS.length}개)`);
  log("  · 사진 파일은 넣지 않았습니다 — 실제 미디어는 Drive 연동 후 직접 올립니다");

  return { groupId };
}

/**
 * 정산 검증. 잔액 합 0 · 이체 합 일치 · 전부 정수 세 가지에 더해
 * 프로토타입과 같은 숫자가 나오는지까지 확인한다.
 */
async function checkSettlement(groupId: string, log: (s: string) => void): Promise<void> {
  const r = await loadSettlement(groupId);
  const check = verifySettlement(r);

  log("");
  log("── 정산 검증 ──────────────────────────────────────────");
  log("  이름     실제 결제액       정산 반영액        낼 돈            잔액");
  for (const b of r.balance) {
    const name = (b.left ? `${b.name}(나감)` : b.name).padEnd(9, " ");
    log(
      `  ${name} ${formatWon(b.spent).padStart(13)} ${formatWon(b.paid).padStart(13)} ` +
        `${formatWon(b.owed).padStart(13)} ${(b.net >= 0 ? "+" : "−") + formatWon(Math.abs(b.net))}`,
    );
  }
  log(`  정산 총액 ${formatWon(r.total)} · 기타 인원 몫 ${formatWon(r.guestTotal)}`);
  log(`  이체 ${r.transfers.length}건 · 결제자 미지정 ${r.pending.length}건 · 정산 제외 ${r.excluded.length}건`);
  for (const t of r.transfers) log(`    ${t.fromName} → ${t.toName} ${formatWon(t.amt)}`);
  log(
    `  잔액 합 0: ${check.balanceSumZero ? "✓" : "✗"} · ` +
      `이체 합 일치: ${check.transferMatchesCredit ? "✓" : "✗"} · ` +
      `전부 정수: ${check.allIntegers ? "✓" : "✗"}`,
  );

  const problems = [...check.problems];
  for (const [name, want] of Object.entries(EXPECTED)) {
    const got = r.balance.find((b) => b.name === name)?.net;
    if (got !== want) problems.push(`${name} 잔액이 ${want} 이어야 하는데 ${got} 입니다`);
  }
  if (r.total !== EXPECTED_TOTAL) problems.push(`정산 총액이 ${EXPECTED_TOTAL} 이어야 하는데 ${r.total} 입니다`);
  if (r.guestTotal !== EXPECTED_GUEST_TOTAL) {
    problems.push(`기타 인원 몫이 ${EXPECTED_GUEST_TOTAL} 이어야 하는데 ${r.guestTotal} 입니다`);
  }

  if (problems.length) {
    throw new Error(`정산 검증 실패:\n${problems.map((p) => `  · ${p}`).join("\n")}`);
  }
  log("  기대값(프로토타입 settle())과 모두 일치합니다 ✓");
}

async function main(): Promise<void> {
  if (env.NODE_ENV === "production") {
    throw new Error("시드는 개발 전용입니다. 운영 DB 에 데모 데이터를 넣지 않습니다.");
  }

  console.log("▶ 시드 시작");
  await wipe(console.log);
  const { groupId } = await seed(console.log);
  await checkSettlement(groupId, console.log);

  console.log("");
  console.log("── 요약 ───────────────────────────────────────────────");
  console.log(`  모임: ${GROUP_NAME} (${START} ~ ${END})`);
  console.log(`  모임 id: ${groupId}`);
  console.log(`  목 로그인 계정: ${MEMBERS.map((m) => m.name).join(" · ")}`);
  console.log(`  · 방장은 ${MEMBERS.find((m) => m.owner)!.name}, ${MEMBERS.find((m) => m.left)!.name} 은 나간 멤버입니다`);
  console.log("  · 로그인: POST /api/auth/mock  {\"name\":\"지현\"}  (AUTH_MODE=mock)");
  console.log("시드 완료");
}

// 직접 실행할 때만 돈다. 통합 테스트가 wipe/seed 만 가져다 쓸 때
// main() 이 딸려 돌면서 DB 풀을 닫아 버리면 안 된다.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("/db/seed.ts")) {
  main()
    .then(async () => {
      await closeDb();
    })
    .catch(async (e: Error) => {
      console.error("");
      console.error(e.message);
      await closeDb();
      process.exit(1);
    });
}
