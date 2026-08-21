/**
 * 작은 조각들. 화면마다 다시 만들지 말고 여기서 가져다 쓴다.
 *
 * 금액 표기 규칙(CLAUDE.md 확정):
 *  · `₩ 1,666,000` — 기호 뒤 한 칸, 소수점은 어디에도 나오지 않는다
 *  · 외화는 `$ 120.00` 으로 병기하고 환산액을 옆에 붙인다
 *  · 금액에는 mono 를 쓰지 않는다. tabular-nums 로 자릿수만 맞춘다
 */

import { formatMoney, formatWon } from "@tripmate/core";
import { useState, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";
import type { Member } from "../api/types.ts";

/** 원화. 소수점이 절대 나오지 않는다. */
export function Won({ v, className }: { v: number; className?: string }) {
  return <span className={"num" + (className ? " " + className : "")}>{formatWon(v)}</span>;
}

/** 외화 + 환산액. 외화는 표시용일 뿐이고 정산에는 원화 정수만 들어간다. */
export function Fx({ cost, cur, krw }: { cost: number; cur: string; krw: number }) {
  if (cur === "KRW") return <Won v={krw} />;
  return (
    <span className="num">
      {formatMoney(cost, cur)} <span style={{ color: "var(--ink-3)" }}>· {formatWon(krw)}</span>
    </span>
  );
}

/** 멤버 아바타. 나간 멤버는 점선 테두리 + 회색으로 "기타"임을 드러낸다. */
/**
 * 프로필 사진이 있으면 사진을, 없으면 이름 첫 글자를 그린다.
 *
 * 색 타일은 사진이 있을 때도 배경으로 남긴다 — 이미지가 늦게 뜨거나 실패해도
 * 동그라미 크기가 흔들리지 않고, 사람마다 색으로 구분되던 것이 유지된다.
 * `avatarUrl` 은 선택 필드다. 아직 안 내려주는 화면(뷰어 등)은 그대로 첫 글자로 돈다.
 */
export function Avatar({
  m,
  size,
}: {
  m: Pick<Member, "name" | "colorBg" | "colorFg" | "left"> & { avatarUrl?: string | null };
  size?: number;
}) {
  // 사진 주소가 죽어 있을 수 있다 (카카오가 이미지를 갈아 끼우거나 지운 경우).
  // 깨진 이미지 아이콘 대신 조용히 첫 글자로 돌아간다.
  const [broken, setBroken] = useState(false);
  const src = broken ? null : (m.avatarUrl ?? null);

  return (
    <span
      className={"who" + (m.left ? " left" : "")}
      style={{
        background: m.colorBg,
        color: m.colorFg,
        ...(size ? { width: size, height: size, fontSize: size * 0.4 } : {}),
        ...(m.left ? { border: "1.5px dashed " + m.colorFg } : {}),
      }}
      title={m.left ? `${m.name} (나감)` : m.name}
    >
      {/* 크기·자르기·원형은 전부 app.css 의 `.who>img` 가 낸다 — 칸마다 크기가 달라도 안 눌린다 */}
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        m.name[0]
      )}
    </span>
  );
}

export function Badge({
  tone = "mute",
  icon,
  children,
}: {
  tone?: "ok" | "warn" | "mute";
  icon?: string;
  children: ReactNode;
}) {
  return (
    <span className={`badge ${tone}`}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

/** 나간 멤버는 화면에서 "기타"로 표시한다 — 정산에는 그대로 남아 있다. */
export const memberLabel = (m: Pick<Member, "name" | "left">): string =>
  m.left ? `${m.name} (나감)` : m.name;

export function Empty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="emptyday" style={{ marginLeft: 0 }}>
      <b>{title}</b>
      {hint ? <span>{hint}</span> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다";
  return (
    <div
      style={{
        background: "#FFF1F3",
        border: "1px solid #F5D5DA",
        color: "var(--danger)",
        borderRadius: "var(--r-md)",
        padding: "12px 14px",
        fontSize: 13,
      }}
    >
      {msg}
    </div>
  );
}

/**
 * 폼 필드 한 칸.
 *
 * app.css 는 `.field > label` 을 스타일하므로 바깥을 label 로 감싸지 않는다.
 * `<label className="field"><span>` 로 만들면 라벨 글자가 무스타일로 나온다.
 */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
