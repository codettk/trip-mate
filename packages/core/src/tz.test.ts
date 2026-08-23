/**
 * 시간대 — 실제로 났던 결함을 그대로 고정한다.
 *
 * 결함: Render(UTC)에서 EXIF `"2026:08:22 19:42:44"` 를 `new Date()` 로 읽어
 *       `19:42Z` 로 저장했고, 화면은 기기 시간대로 찍어서 한국에서 04:42 로 보였다.
 *       파일 이름(20260822_194244)이 카메라 시각을 갖고 있어 9시간 밀린 것이 드러났다.
 *
 * 그래서 이 파일의 핵심은 **어느 기계에서 돌려도 같은 값이 나오는가**다.
 */

import { describe, expect, it } from "vitest";
import {
  exifInstant,
  fromKstInput,
  kstDate,
  kstDateTime,
  kstStamp,
  toKstInput,
} from "./tz.js";

describe("EXIF 촬영 시각 — 기계 시간대에 맡기지 않는다", () => {
  it("시간대 표기가 없으면 한국 시간으로 친다 (카메라 벽시계가 그대로 살아난다)", () => {
    const t = exifInstant("2026:08:22 19:42:44");
    // 19:42 KST = 10:42 UTC. UTC 서버에서 돌려도 같은 값이어야 한다.
    expect(t?.toISOString()).toBe("2026-08-22T10:42:44.000Z");
    // 다시 한국 시간으로 찍으면 카메라가 보여 준 숫자 그대로
    expect(kstStamp(t)).toBe("08.22 19:42");
  });

  it("카메라가 시간대를 적어 뒀으면 그것을 믿는다", () => {
    const t = exifInstant("2026:08:22 19:42:44", "+02:00");
    expect(t?.toISOString()).toBe("2026-08-22T17:42:44.000Z");
    // 진짜 순간을 한국 시간으로 보면 다음 날 새벽이다 — 이게 맞는 값이다
    expect(kstStamp(t)).toBe("08.23 02:42");
  });

  it("일본에서 찍어도 +09:00 이라 벽시계 숫자가 그대로다", () => {
    expect(exifInstant("2026:08:22 20:38:11", "+09:00")?.toISOString()).toBe(
      exifInstant("2026:08:22 20:38:11")?.toISOString(),
    );
  });

  it("초가 없거나 하이픈이어도 읽는다", () => {
    expect(exifInstant("2026:08:22 19:42")?.toISOString()).toBe("2026-08-22T10:42:00.000Z");
    expect(exifInstant("2026-08-22T19:42:44")?.toISOString()).toBe("2026-08-22T10:42:44.000Z");
  });

  it("읽을 수 없으면 null — 깨진 메타데이터 때문에 업로드가 실패하면 안 된다", () => {
    for (const bad of ["", "어제", "0000:00:00 00:00:00", null, undefined, 12345, {}]) {
      expect(exifInstant(bad)).toBeNull();
    }
    // 이상한 오프셋은 무시하고 한국 시간으로 돌아간다
    expect(exifInstant("2026:08:22 19:42:44", "말도 안 되는 값")?.toISOString()).toBe(
      "2026-08-22T10:42:44.000Z",
    );
  });
});

describe("표시 — 보는 사람 기기가 아니라 한국 시간", () => {
  it("UTC 자정 직후는 한국에서 같은 날 오전 9시다", () => {
    expect(kstStamp("2026-08-22T00:10:00.000Z")).toBe("08.22 09:10");
    expect(kstDateTime("2026-08-22T00:10:00.000Z")).toBe("2026.08.22 09:10");
    expect(kstDate("2026-08-22T00:10:00.000Z")).toBe("2026-08-22");
  });

  it("UTC 오후 3시 이후는 한국에서 이미 다음 날이다", () => {
    expect(kstStamp("2026-08-22T15:30:00.000Z")).toBe("08.23 00:30");
    expect(kstDate("2026-08-22T15:30:00.000Z")).toBe("2026-08-23");
  });

  it("빈 값과 깨진 값은 빈 문자열 — 화면에 Invalid Date 가 나오면 안 된다", () => {
    for (const bad of [null, undefined, "", "어제"]) {
      expect(kstStamp(bad)).toBe("");
      expect(kstDateTime(bad)).toBe("");
      expect(toKstInput(bad)).toBe("");
    }
  });
});

describe("촬영 시각 고치기 — 읽을 때와 저장할 때가 같은 시간대여야 한다", () => {
  it("입력칸에 넣었다 그대로 저장하면 값이 움직이지 않는다", () => {
    const iso = "2026-08-22T10:42:00.000Z"; // = 19:42 KST
    const input = toKstInput(iso);
    expect(input).toBe("2026-08-22T19:42");
    // 왕복해도 제자리 — 해외에서 고쳐도 9시간씩 밀리지 않는다
    expect(fromKstInput(input)).toBe(iso);
  });

  it("모양이 아니면 null 을 준다 (빈 값은 '지운다'는 뜻으로 따로 다룬다)", () => {
    expect(fromKstInput("")).toBeNull();
    expect(fromKstInput("2026/08/22 19:42")).toBeNull();
  });
});
