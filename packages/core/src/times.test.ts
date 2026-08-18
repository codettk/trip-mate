import { describe, expect, it } from "vitest";
import {
  crossesMidnight,
  durationMinutes,
  formatDuration,
  formatRange,
  isTime,
  minutesOf,
  nightIndex,
  timeOf,
} from "./times.js";

describe("시각 검증", () => {
  it("빈 문자열은 통과한다 — 시간은 비워 둘 수 있는 값이다", () => {
    expect(isTime("")).toBe(true);
  });

  it("HH:MM 만 받는다", () => {
    for (const ok of ["00:00", "08:20", "23:59", "09:05"]) expect(isTime(ok)).toBe(true);
    for (const no of ["24:00", "8:20", "0820", "23:60", "12:5", "12:345", " 08:20"]) {
      expect(isTime(no), no).toBe(false);
    }
  });

  it("분으로 바꾸고 되돌린다", () => {
    expect(minutesOf("08:20")).toBe(500);
    expect(minutesOf("00:00")).toBe(0);
    expect(minutesOf("23:59")).toBe(1439);
    expect(minutesOf("엉망")).toBeNull();
    expect(timeOf(500)).toBe("08:20");
    expect(timeOf(0)).toBe("00:00");
    expect(timeOf(1440)).toBe("00:00");
  });
});

describe("자정 넘김", () => {
  it("종료가 시작보다 이르면 익일이다", () => {
    expect(crossesMidnight("23:00", "01:30")).toBe(true);
    expect(crossesMidnight("09:30", "11:00")).toBe(false);
    // 같은 시각은 넘기지 않은 것으로 본다 — 24시간짜리 일정을 만들 이유가 없다
    expect(crossesMidnight("09:00", "09:00")).toBe(false);
  });

  it("한쪽이 비어 있으면 판단하지 않는다", () => {
    expect(crossesMidnight("", "01:30")).toBe(false);
    expect(crossesMidnight("23:00", "")).toBe(false);
  });

  it("걸린 시간은 익일을 넘어서도 맞는다", () => {
    expect(durationMinutes("09:30", "11:00")).toBe(90);
    expect(durationMinutes("23:00", "01:30")).toBe(150);
    expect(durationMinutes("00:00", "23:59")).toBe(1439);
    expect(durationMinutes("09:30", "")).toBeNull();
  });

  it("모른다와 0분은 다르다", () => {
    expect(durationMinutes("", "")).toBeNull();
    expect(durationMinutes("09:00", "09:00")).toBe(0);
  });
});

describe("표기", () => {
  it("걸린 시간", () => {
    expect(formatDuration(90)).toBe("1시간 30분");
    expect(formatDuration(45)).toBe("45분");
    expect(formatDuration(120)).toBe("2시간");
    expect(formatDuration(0)).toBe("");
  });

  it("시간 범위", () => {
    expect(formatRange("09:30", "11:00")).toBe("09:30 – 11:00");
    expect(formatRange("09:30", "")).toBe("09:30");
    expect(formatRange("", "11:00")).toBe("11:00");
    expect(formatRange("", "")).toBe("");
  });
});

describe("N박째", () => {
  const IN = "2026-08-22";
  const OUT = "2026-08-26";

  it("체크인한 날이 1박째다", () => {
    expect(nightIndex("2026-08-22", IN, OUT)).toBe(1);
    expect(nightIndex("2026-08-23", IN, OUT)).toBe(2);
    expect(nightIndex("2026-08-25", IN, OUT)).toBe(4);
  });

  it("체크아웃하는 날은 묵지 않는다", () => {
    expect(nightIndex("2026-08-26", IN, OUT)).toBeNull();
  });

  it("기간 밖이면 null", () => {
    expect(nightIndex("2026-08-21", IN, OUT)).toBeNull();
    expect(nightIndex("2026-08-27", IN, OUT)).toBeNull();
  });

  it("날짜가 없는 숙소는 셀 수 없다", () => {
    expect(nightIndex("2026-08-22", null, OUT)).toBeNull();
    expect(nightIndex("2026-08-22", IN, null)).toBeNull();
  });

  it("당일치기(0박)는 어느 날도 묵지 않는다", () => {
    expect(nightIndex("2026-08-22", "2026-08-22", "2026-08-22")).toBeNull();
  });
});
