/**
 * ══════════ 일정 추가 / 수정 모달 ══════════
 *
 * 화면을 갈아타지 않는다. 항목·시간·카테고리·연결 일차를 **한 폼**에서 받는다.
 *
 * 이 폼의 핵심은 `split`(정산 포함) 토글이다.
 *  · 꺼져 있으면 금액·통화·결제자·정산 대상이 **아예 보이지 않는다.**
 *    숨기기만 하는 게 아니라 저장할 때 서버가 실제로 비운다 —
 *    숨겨진 금액이 남으면 나중에 토글을 켰을 때 아무도 기억 못 하는 숫자가 되살아난다.
 *  · 켜면 그 자리에서 펼쳐지고, `previewSplit`(서버와 같은 코드)으로 1인 몫을 즉시 계산해 보여준다.
 *    같은 반올림을 쓰므로 저장 후에 숫자가 달라지지 않는다.
 *
 * `rate` 는 절대 보내지 않는다. 서버가 그 항목이 속한 일자의 마감 환율을 스냅샷한다.
 * 여기서 부르는 `/rates` 는 **폼에 근거를 보여주기 위한 조회일 뿐**이다.
 */

import { useQuery } from "@tanstack/react-query";
import {
  CATEGORIES,
  CURRENCIES,
  CURRENCY_CODES,
  currencyOf,
  formatMoney,
  formatWon,
  previewSplit,
  shortDate,
  type Category,
} from "@tripmate/core";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client.ts";
import { useApiMutation, useGroup, useMembers } from "../api/hooks.ts";
import type { Item, Member, Shared } from "../api/types.ts";
import { Avatar, ErrorBox } from "../components/Bits.tsx";
import { Icon } from "../components/Icon.tsx";
import { Modal } from "../components/Modal.tsx";

// ────────────────────────────────────────────────────────────────────
// 카테고리 — 색과 아이콘은 CLAUDE.md 에서 확정된 값이다. 여기서만 정의하고 화면들이 가져다 쓴다.
// ────────────────────────────────────────────────────────────────────

export interface CatMeta {
  label: string;
  /** 카테고리 색 */
  c: string;
  /** 같은 계열의 연한 배경 타일 */
  bg: string;
  icon: string;
}

export const CAT_META: Record<Category, CatMeta> = {
  stay: { label: "숙소", c: "var(--stay)", bg: "var(--stay-bg)", icon: "bed" },
  pkg: { label: "패키지", c: "var(--pkg)", bg: "var(--pkg-bg)", icon: "ticket" },
  spot: { label: "관광지", c: "var(--spot)", bg: "var(--spot-bg)", icon: "pin" },
  food: { label: "식사", c: "var(--food)", bg: "var(--food-bg)", icon: "fork" },
  move: { label: "이동", c: "var(--move)", bg: "var(--move-bg)", icon: "bus" },
};

/** 카테고리 파스텔 타일 + 아이콘. */
export function CatTile({ cat, size }: { cat: Category; size?: number }) {
  const c = CAT_META[cat];
  return (
    <span
      className="tile"
      style={{
        background: c.bg,
        color: c.c,
        ...(size ? { width: size, height: size, borderRadius: Math.round(size * 0.29) } : {}),
      }}
    >
      <Icon name={c.icon} size={size ? Math.round(size * 0.5) : undefined} />
    </span>
  );
}

/**
 * "전원 4명" · "지현·민수" · "4명 +기타 2" 같은 라벨.
 * 전원 균등을 **가정하지 않는다** — 실제로 지정된 대상만 세어 적는다.
 */
export function targetLabel(shared: Shared, members: Member[]): string {
  const n = shared.members.length;
  const byId = new Map(members.map((m) => [m.id, m]));
  const activeCount = members.filter((m) => !m.left).length;
  const allActive =
    n > 0 && n === activeCount && shared.members.every((id) => byId.get(id)?.left === false);

  const base = allActive
    ? `전원 ${n}명`
    : n === 0
      ? "대상 없음"
      : n <= 2
        ? shared.members.map((id) => byId.get(id)?.name ?? "?").join("·")
        : `${n}명`;

  return base + (shared.guests ? ` +기타 ${shared.guests}` : "");
}

// ────────────────────────────────────────────────────────────────────
// 폼 상태
// ────────────────────────────────────────────────────────────────────

interface Draft {
  title: string;
  cat: Category;
  dayId: string;
  time: string;
  meta: string;
  booked: boolean;
  /** cat==="stay" 전용 */
  checkIn: string;
  checkOut: string;
  split: boolean;
  /** 외화 소수 입력을 그대로 받기 위해 문자열로 둔다. 환산·정산은 언제나 원화 정수다. */
  cost: string;
  cur: string;
  /** "" = 아직 정하지 않음. 현장에서 아무나 결제하므로 이게 유효한 기본값이다. */
  payerId: string;
  members: string[];
  guests: number;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface ItemModalProps {
  open: boolean;
  gid: string;
  /** 있으면 수정, 없으면 추가 */
  item?: Item | null;
  /** 추가할 때 기본으로 연결할 일차 */
  defaultDayId?: string;
  onClose: () => void;
}

export function ItemModal({ open, gid, item, defaultDayId, onClose }: ItemModalProps) {
  const groupQ = useGroup(gid);
  const membersQ = useMembers(gid);

  const days = groupQ.data?.days ?? [];
  const members = membersQ.data?.members ?? [];
  const groupCur = groupQ.data?.group.cur ?? "KRW";

  const [draft, setDraft] = useState<Draft | null>(null);

  /**
   * 열릴 때마다 폼을 새로 만든다.
   * 이전에 열었던 항목의 값이 남아 다른 항목에 새는 일을 막는다.
   *
   * ⚠ seedRef 로 "한 번 열 때 한 번만" 초기화한다.
   *   쿼리가 다시 fetch 되면(창 포커스 복귀 등) data 객체가 새로 생기는데,
   *   그때마다 초기화하면 사용자가 입력하던 값이 통째로 날아간다.
   */
  const seed = `${String(open)}|${item?.id ?? "new"}|${defaultDayId ?? ""}|${days.length}|${groupCur}`;
  const seedRef = useRef("");
  useEffect(() => {
    if (!open) {
      seedRef.current = "";
      return;
    }
    if (!groupQ.data || !membersQ.data || seedRef.current === seed) return;
    const dayList = groupQ.data.days;
    const first = dayList[0];
    if (!first) return;
    seedRef.current = seed;

    if (item) {
      setDraft({
        title: item.title,
        cat: item.cat,
        dayId: item.dayId,
        time: item.time,
        meta: item.meta,
        booked: item.booked,
        checkIn: item.checkIn ?? item.date,
        checkOut: item.checkOut ?? (dayList[dayList.length - 1]?.date ?? item.date),
        split: item.split,
        cost: item.split ? String(item.cost) : "",
        cur: item.split ? item.cur : groupQ.data.group.cur,
        payerId: item.payerId ?? "",
        members: [...item.shared.members],
        guests: item.shared.guests,
      });
      return;
    }

    const day = dayList.find((d) => d.id === defaultDayId) ?? first;
    const idx = dayList.findIndex((d) => d.id === day.id);
    setDraft({
      title: "",
      cat: "food",
      dayId: day.id,
      time: "",
      meta: "",
      booked: false,
      checkIn: day.date,
      checkOut: dayList[Math.min(dayList.length - 1, idx + 1)]?.date ?? day.date,
      split: false,
      cost: "",
      cur: groupQ.data.group.cur,
      payerId: "",
      // 기본 정산 대상은 "안 나간 멤버 전원"이다. 규칙이 아니라 기본값일 뿐이고 항목마다 바꾼다.
      members: membersQ.data.members.filter((m) => !m.left).map((m) => m.id),
      guests: 0,
    });
  }, [seed, groupQ.data, membersQ.data, item, defaultDayId, open]);

  /** 숙소는 체크인한 날의 일정에 놓인다 — 일차 select 대신 체크인 날짜가 일차를 정한다. */
  const effDayId =
    draft && draft.cat === "stay"
      ? (days.find((d) => d.date === draft.checkIn)?.id ?? draft.dayId)
      : (draft?.dayId ?? "");
  const effDate = days.find((d) => d.id === effDayId)?.date;

  const needRate = !!draft && draft.split && draft.cur !== "KRW";
  const rateQ = useQuery({
    queryKey: ["rates", gid, effDate ?? "", draft?.cur ?? ""],
    queryFn: () =>
      api.get<{ date: string; cur: string; rate: number }>(
        `/api/groups/${gid}/rates?date=${effDate ?? ""}&cur=${draft?.cur ?? ""}`,
      ),
    enabled: open && needRate && !!effDate,
    staleTime: 5 * 60_000,
  });

  const save = useApiMutation<Record<string, unknown>, Item>(
    (body) =>
      item
        ? api.patch<Item>(`/api/groups/${gid}/items/${item.id}`, body)
        : api.post<Item>(`/api/groups/${gid}/items`, body),
    gid,
    () => onClose(),
  );

  if (!open) return null;

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const title = item ? "일정 수정" : "일정 추가";

  if (!draft) {
    return (
      <Modal open={open} title={title} onClose={onClose} wide>
        <p className="hint">불러오는 중입니다…</p>
      </Modal>
    );
  }

  const cat = CAT_META[draft.cat];
  const isStay = draft.cat === "stay";
  const curInfo = currencyOf(draft.cur);
  const cost = Number(draft.cost) || 0;
  /** KRW 는 물어볼 것도 없이 1이다. 외화는 그 일자의 마감 환율을 받아 온다. */
  const rate = draft.cur === "KRW" ? 1 : (rateQ.data?.rate ?? null);
  const pv =
    rate === null
      ? null
      : previewSplit({ cost, rate, memberCount: draft.members.length, guests: draft.guests });

  const timeOk = draft.time.trim() === "" || HHMM.test(draft.time.trim());
  const canSave = draft.title.trim().length > 0 && timeOk && !save.isPending;

  const submit = () => {
    if (!canSave) return;
    save.mutate({
      dayId: effDayId,
      time: draft.time.trim(),
      cat: draft.cat,
      title: draft.title.trim(),
      meta: draft.meta.trim(),
      booked: draft.booked,
      thumb: item?.thumb ?? null,
      checkIn: isStay ? draft.checkIn : null,
      checkOut: isStay ? draft.checkOut : null,
      // split 이 꺼져 있으면 금액을 아예 보내지 않는다 — 서버도 같은 규칙으로 한 번 더 비운다.
      split: draft.split,
      cost: draft.split ? cost : 0,
      cur: draft.split ? draft.cur : groupCur,
      payerId: draft.split && draft.payerId ? draft.payerId : null,
      shared: draft.split
        ? { members: draft.members, guests: draft.guests }
        : { members: [], guests: 0 },
    });
  };

  /** 나간 멤버는 새 지출의 기본 대상에서 빠지지만, 이미 지정돼 있으면 계속 보여준다. */
  const pickable = members.filter((m) => !m.left || draft.members.includes(m.id));

  return (
    <Modal
      open={open}
      title={title}
      icon={cat.icon}
      onClose={onClose}
      wide
      footer={
        <>
          <div className="sp" />
          <button className="btn btn-ghost" onClick={onClose}>
            취소
          </button>
          <button className="btn" onClick={submit} disabled={!canSave}>
            {save.isPending ? "저장 중…" : "저장"}
          </button>
        </>
      }
    >
      {save.error ? <ErrorBox error={save.error} /> : null}

      <div className="field">
        <label htmlFor="fTitle">항목</label>
        <input
          id="fTitle"
          type="text"
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="예: 씨에스호텔 제주"
        />
      </div>

      <div className="field">
        <label>카테고리</label>
        <div className="chips">
          {CATEGORIES.map((k) => {
            const c = CAT_META[k];
            const on = draft.cat === k;
            return (
              <button
                key={k}
                type="button"
                className="chip"
                aria-pressed={on}
                style={on ? { borderColor: c.c, background: c.bg, color: c.c, fontWeight: 600 } : undefined}
                onClick={() => set({ cat: k })}
              >
                <span
                  className="tile"
                  style={{ width: 22, height: 22, borderRadius: 7, background: c.bg, color: c.c }}
                >
                  <Icon name={c.icon} size={13} />
                </span>
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="row2">
        <div className="field">
          <label htmlFor="fDay">연결된 일차</label>
          <select
            id="fDay"
            value={effDayId}
            disabled={isStay}
            onChange={(e) => set({ dayId: e.target.value })}
          >
            {days.map((d) => (
              <option key={d.id} value={d.id}>
                DAY {d.n} · {shortDate(d.date)} ({d.dow}){d.label ? ` ${d.label}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="fTime">시간</label>
          <input
            id="fTime"
            type="text"
            value={draft.time}
            onChange={(e) => set({ time: e.target.value })}
            placeholder="14:00 (비워도 됩니다)"
          />
          {!timeOk ? (
            <span className="hint">
              <span className="warn">시간은 비워 두거나 HH:MM 형식이어야 합니다.</span>
            </span>
          ) : null}
        </div>
      </div>

      {isStay ? (
        <>
          <div className="row2">
            <div className="field">
              <label htmlFor="fIn">체크인</label>
              <select id="fIn" value={draft.checkIn} onChange={(e) => set({ checkIn: e.target.value })}>
                {days.map((d) => (
                  <option key={d.id} value={d.date}>
                    {shortDate(d.date)} ({d.dow}) · DAY {d.n}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fOut">체크아웃</label>
              <select
                id="fOut"
                value={draft.checkOut}
                onChange={(e) => set({ checkOut: e.target.value })}
              >
                {days.map((d) => (
                  <option key={d.id} value={d.date}>
                    {shortDate(d.date)} ({d.dow}) · DAY {d.n}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="hint">
            숙소는 <b>체크인한 날</b>의 일정에 놓이고, 그 사이 날짜에는 “숙박 중”으로 표시됩니다.
            같은 날 숙소가 2개일 수 있습니다 — 체크아웃하는 곳과 새로 체크인하는 곳이 겹치는 날이
            그렇습니다. <b>비용은 체크인 날 한 번만 정산에 들어가고 박 수로 쪼개지 않습니다.</b>
          </p>
        </>
      ) : null}

      {/* ── 정산 토글 ── 드롭다운이 아니라 스위치다. 이 하나로 폼의 얼굴이 바뀐다. */}
      <button
        type="button"
        className="sw2"
        aria-pressed={draft.split}
        onClick={() => set({ split: !draft.split })}
      >
        <span className="tx">
          <b>정산에 포함</b>
          <small>
            {draft.split
              ? "금액과 정산 대상을 지정합니다."
              : "일정만 추가합니다. 금액·결제자·정산 대상은 저장되지 않습니다."}
          </small>
        </span>
        <span className="tgl">
          <i />
        </span>
      </button>

      {draft.split ? (
        <>
          <div className="rowcur">
            <div className="field">
              <label htmlFor="fCost">금액</label>
              <input
                id="fCost"
                type="number"
                min={0}
                step={curInfo.step}
                value={draft.cost}
                onChange={(e) => set({ cost: e.target.value })}
                placeholder="0"
              />
            </div>
            <div className="field">
              <label htmlFor="fCur">통화</label>
              {/* 선택지는 전 세계 통화다. 기본값은 모임의 여행지에서 추론한 통화. */}
              <select id="fCur" value={draft.cur} onChange={(e) => set({ cur: e.target.value })}>
                {CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code} {CURRENCIES[code]?.sym ?? ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {draft.cur !== "KRW" ? (
            <p className="hint">
              <Icon name="fx" size={13} />{" "}
              {rate === null ? (
                rateQ.isError ? (
                  <span className="warn">
                    환율을 불러오지 못했습니다. 저장할 때 서버가 그 일자의 마감 환율로 다시
                    계산합니다.
                  </span>
                ) : (
                  <>환율을 불러오는 중입니다…</>
                )
              ) : (
                <>
                  {formatMoney(cost, draft.cur)} × {rate.toLocaleString("ko-KR")} ={" "}
                  <b>{formatWon(pv?.krw ?? 0)}</b> · {effDate ? shortDate(effDate) : ""} 마감 환율{" "}
                  {rate.toLocaleString("ko-KR")}원 기준. <b>정산은 원화 정수</b>로만 계산합니다.
                </>
              )}
            </p>
          ) : null}

          <div className="field">
            <label htmlFor="fPayer">결제자</label>
            {/* 결제자는 사전 배정하지 않는다. 현장에서 아무나 결제하는 게 실제 패턴이다. */}
            <select
              id="fPayer"
              value={draft.payerId}
              onChange={(e) => set({ payerId: e.target.value })}
            >
              <option value="">아직 정하지 않음 — 나중에 지정</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.left ? `${m.name} (나감)` : m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>정산 대상 — 이 돈을 나눠 내는 사람</label>
            <div className="chips">
              {pickable.map((m) => {
                const on = draft.members.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="chip"
                    aria-pressed={on}
                    onClick={() =>
                      set({
                        members: on
                          ? draft.members.filter((x) => x !== m.id)
                          : [...draft.members, m.id],
                      })
                    }
                  >
                    <Avatar m={m} />
                    {m.left ? `${m.name} (나감)` : m.name}
                  </button>
                );
              })}
              {/* 모임에 초대되지 않은 사람은 "기타 인원 N명"으로 센다. */}
              <span className="stepper">
                <button
                  type="button"
                  aria-label="기타 인원 줄이기"
                  onClick={() => set({ guests: Math.max(0, draft.guests - 1) })}
                >
                  −
                </button>
                <span>기타 {draft.guests}명</span>
                <button
                  type="button"
                  aria-label="기타 인원 늘리기"
                  onClick={() => set({ guests: Math.min(50, draft.guests + 1) })}
                >
                  +
                </button>
              </span>
            </div>

            {/* 서버와 같은 previewSplit 으로 계산한다 — 저장 후에 숫자가 달라지지 않는다. */}
            <p className="hint">
              {pv === null ? (
                <>환율을 받아오면 1인 몫을 계산해 보여 드립니다.</>
              ) : pv.parts === 0 ? (
                <span className="warn">
                  정산 대상이 없어 이 항목은 정산에서 빠집니다. 금액을 남기지 않으려면 정산 토글을 꺼
                  주세요.
                </span>
              ) : (
                <>
                  {pv.parts}명이 나눠 냅니다 · 1인 <b>{formatWon(pv.per)}</b>
                  {draft.guests ? (
                    <>
                      <br />
                      <span className="warn">
                        기타 {draft.guests}명 몫 <b>{formatWon(pv.guestCut)}</b>은 정산에서 빠집니다 —
                        결제자가 직접 받으세요.
                      </span>
                    </>
                  ) : null}
                  {pv.payerAbsorbs !== 0 ? (
                    <>
                      <br />
                      반올림하고 남는 <b>{formatWon(Math.abs(pv.payerAbsorbs))}</b>은 결제자가
                      부담합니다.
                    </>
                  ) : null}
                </>
              )}
            </p>
          </div>
        </>
      ) : null}

      <div className="field">
        <label htmlFor="fMeta">메모</label>
        <input
          id="fMeta"
          type="text"
          value={draft.meta}
          onChange={(e) => set({ meta: e.target.value })}
          placeholder="예: 가이드 김현수 (010-1234-5678)"
        />
      </div>

      <label className="chk">
        <input
          type="checkbox"
          checked={draft.booked}
          onChange={(e) => set({ booked: e.target.checked })}
        />
        예약 완료
      </label>
    </Modal>
  );
}
