import { describe, expect, it } from "vitest";
import {
  addDays,
  buildDays,
  daysBetween,
  dowOf,
  nightsOf,
  parseDate,
  shortDate,
  stayPhase,
  staysOn,
  tripLength,
} from "./dates.js";
import { guessCurrency } from "./currency.js";
import { slugify, uniqueSlug, randomToken } from "./slug.js";

describe("일차 자동 생성", () => {
  it("시작~종료를 포함해 일차를 만든다 (09.12~09.16 = 5일차)", () => {
    const days = buildDays("2026-09-12", "2026-09-16");
    expect(days).toHaveLength(5);
    expect(days[0]).toEqual({ n: 1, date: "2026-09-12", dow: "토", short: "09.12" });
    expect(days[4]).toEqual({ n: 5, date: "2026-09-16", dow: "수", short: "09.16" });
  });

  it("당일치기는 1일차 하나", () => {
    expect(buildDays("2026-09-12", "2026-09-12")).toHaveLength(1);
    expect(tripLength("2026-09-12", "2026-09-12")).toBe("당일");
  });

  it("4박 5일", () => {
    expect(tripLength("2026-09-12", "2026-09-16")).toBe("4박 5일");
  });

  it("월·연 경계를 넘는다", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-02-27", "2026-03-02")).toBe(3); // 2026은 평년
    expect(buildDays("2024-02-27", "2024-03-01")).toHaveLength(4); // 2024는 윤년
  });

  it("종료일이 시작일보다 빠르면 거부한다", () => {
    expect(() => buildDays("2026-09-16", "2026-09-12")).toThrow();
  });

  it("없는 날짜를 거부한다", () => {
    expect(() => parseDate("2026-02-30")).toThrow();
    expect(() => parseDate("2026-9-1")).toThrow();
  });

  it("요일과 짧은 날짜", () => {
    expect(dowOf("2026-09-12")).toBe("토");
    expect(shortDate("2026-09-12")).toBe("09.12");
  });
});

describe("숙소 기간", () => {
  const stays = [
    { id: "a", cat: "stay", checkIn: "2026-09-12", checkOut: "2026-09-14" },
    { id: "b", cat: "stay", checkIn: "2026-09-14", checkOut: "2026-09-16" },
    { id: "c", cat: "food", checkIn: null, checkOut: null },
  ];

  it("박 수는 체크인~체크아웃 차이다", () => {
    expect(nightsOf("2026-09-12", "2026-09-14")).toBe(2);
    expect(nightsOf(null, "2026-09-14")).toBe(0);
  });

  it("체크아웃과 체크인이 겹치는 날에는 숙소가 2개다", () => {
    expect(staysOn(stays, "2026-09-12").map((s) => s.id)).toEqual(["a"]);
    expect(staysOn(stays, "2026-09-13").map((s) => s.id)).toEqual(["a"]);
    expect(staysOn(stays, "2026-09-14").map((s) => s.id)).toEqual(["a", "b"]);
    expect(staysOn(stays, "2026-09-16").map((s) => s.id)).toEqual(["b"]);
  });

  it("날짜마다 체크인 / 숙박 중 / 체크아웃을 구분한다", () => {
    expect(stayPhase("2026-09-12", "2026-09-12", "2026-09-14")).toBe("in");
    expect(stayPhase("2026-09-13", "2026-09-12", "2026-09-14")).toBe("mid");
    expect(stayPhase("2026-09-14", "2026-09-12", "2026-09-14")).toBe("out");
    expect(stayPhase("2026-09-15", "2026-09-12", "2026-09-14")).toBeNull();
  });
});

describe("여행지 → 기본 통화", () => {
  it.each([
    ["제주도", "KRW"],
    ["다낭", "VND"],
    ["후쿠오카", "JPY"],
    ["방콕", "THB"],
    ["세부", "PHP"],
    ["파리", "EUR"],
    ["뉴욕", "USD"],
    ["타이베이", "TWD"],
    ["홍콩", "HKD"],
    ["알 수 없는 곳", "KRW"],
    ["", "KRW"],
  ])("%s → %s", (dest, cur) => {
    expect(guessCurrency(dest)).toBe(cur);
  });

  it("null 이어도 KRW", () => {
    expect(guessCurrency(null)).toBe("KRW");
  });
});

describe("슬러그와 토큰", () => {
  it("한글을 살리고 나머지는 하이픈으로 접는다", () => {
    expect(slugify("Day 1 · 성산")).toBe("day-1-성산");
    expect(slugify("  영수증!!  ")).toBe("영수증");
    expect(slugify("!!!")).toBe("folder");
  });

  it("같은 이름이면 번호를 붙인다", () => {
    expect(uniqueSlug("성산", [])).toBe("성산");
    expect(uniqueSlug("성산", ["성산"])).toBe("성산-2");
    expect(uniqueSlug("성산", ["성산", "성산-2"])).toBe("성산-3");
  });

  it("공개할 때마다 다른 토큰이 나온다 — 예전 링크가 되살아나면 안 된다", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toHaveLength(32);
    expect(a).not.toBe(b);
  });
});
