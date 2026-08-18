/**
 * ══════════ 일정 화면 ══════════
 *
 * 이 앱의 심장. 일차 탭 → 그날 숙소 칩 → 타임라인 → 우측 요약 레일.
 *
 * 화면이 지키는 것 (전부 CLAUDE.md 에서 못박힌 것):
 *
 *  · **전원 균등을 가정한 숫자를 만들지 않는다.** "1인당 평균" 같은 값은 아무도 실제로
 *    부담하지 않는 금액이라 오해를 만든다. 대신 로그인한 사람의 `myOwed`(내 부담액)를 쓴다.
 *  · **정산 제외는 조용히 사라지지 않는다.** `split:false` 인 항목은 금액 자리에
 *    "정산 제외"라고 적는다.
 *  · **결제자 미지정은 노란 배지로 드러내고, 카드를 누르면 그 자리에서 지정한다.**
 *    (지정은 상세 모달 안에서 끝난다 — 결제자를 바꾸는 순간 정산 전체가 재계산된다.)
 *  · **나간 멤버는 화면에서 "기타(나감)"로 표시하되 정산에서 빼지 않는다.**
 *    빼면 잔액 합이 0이 되지 않는다.
 *  · 무언가를 만들거나 고칠 때 화면을 갈아타지 않는다 — 추가·상세·수정이 전부 모달이다.
 */

import { formatMoney, formatWon, shortDate, STAY_PHASE_LABEL } from "@tripmate/core";
import { useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { useGroup, useItinerary, useMembers, useSettlement } from "../api/hooks.ts";
import type { Item, ItineraryDay, Member } from "../api/types.ts";
import { Avatar, Badge, ErrorBox, memberLabel } from "../components/Bits.tsx";
import { Icon } from "../components/Icon.tsx";
import { ItemDetailModal } from "../modals/ItemDetailModal.tsx";
import { CAT_META, CatTile, ItemModal, targetLabel } from "../modals/ItemModal.tsx";

export function ItineraryScreen() {
  const { gid } = useParams<{ gid: string }>();

  const groupQ = useGroup(gid);
  const itinQ = useItinerary(gid);
  const membersQ = useMembers(gid);
  const settleQ = useSettlement(gid);

  const [dayN, setDayN] = useState(1);
  const [adding, setAdding] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  if (!gid) return null;

  // 정산 조회가 실패해도 일정 자체는 보여준다 — 요약 숫자만 비고 화면이 통째로 죽지 않는다.
  const err = groupQ.error ?? itinQ.error ?? membersQ.error;
  if (err) return <ErrorBox error={err} />;
  if (!groupQ.data || !itinQ.data || !membersQ.data) {
    return <p className="empty">일정을 불러오는 중입니다…</p>;
  }

  const days = itinQ.data.days;
  const members = membersQ.data.members;
  const s = settleQ.data;
  const meId = groupQ.data.me.memberId;

  const allItems = days.flatMap((d) => d.items);
  const byId = new Map(allItems.map((i) => [i.id, i]));
  const day = days.find((d) => d.n === dayN) ?? days[0];
  const detail = detailId ? (byId.get(detailId) ?? null) : null;

  const waiting = (s?.pending.length ?? 0) + (s?.noTarget.length ?? 0);
  const excludedCount = allItems.filter((i) => !i.split).length;
  /** 결제액 막대의 기준선. 0으로 나누지 않도록 최소 1. */
  const maxSpent = Math.max(...(s?.balance ?? []).map((b) => b.spent), 1);

  return (
    <>
      {settleQ.error ? <ErrorBox error={settleQ.error} /> : null}

      {/* ── 통계 타일 ─────────────────────────────────────────────── */}
      <div className="stats">
        <Stat
          icon="won"
          c="var(--brand)"
          bg="var(--brand-soft)"
          label="정산 대상 지출"
          value={formatWon(s?.total ?? 0)}
          sub={
            excludedCount
              ? `정산 제외 ${excludedCount}건은 뺀 금액`
              : "모든 일정이 정산에 들어갑니다"
          }
        />
        {/* "1인당 평균"이 아니라 로그인한 사람이 실제로 낼 돈이다. */}
        <Stat
          icon="check"
          c="var(--pkg)"
          bg="var(--pkg-bg)"
          label="내 부담액"
          value={formatWon(s?.myOwed ?? 0)}
          sub={myNetLabel(s?.balance.find((b) => b.id === meId)?.net ?? 0)}
          tone={netTone(s?.balance.find((b) => b.id === meId)?.net ?? 0)}
        />
        <Stat
          icon="clock"
          c="var(--warn)"
          bg="var(--warn-bg)"
          label="정산 대기"
          value={`${waiting}건`}
          sub={
            waiting
              ? [
                  s?.pending.length ? `결제자 미지정 ${s.pending.length}` : "",
                  s?.noTarget.length ? `대상 없음 ${s.noTarget.length}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "모두 지정됐습니다"
          }
          tone={waiting ? "warn" : "ok"}
        />
        <Stat
          icon="cal"
          c="var(--stay)"
          bg="var(--stay-bg)"
          label="일정"
          value={`${allItems.length}개`}
          sub={excludedCount ? `정산 제외 ${excludedCount}건` : "정산 제외 없음"}
        />
        {/* 기타 인원 몫은 정산에서 빠지고 결제자가 직접 받는다. 없으면 타일 자체를 숨긴다. */}
        {s && s.guestTotal > 0 ? (
          <Stat
            icon="share"
            c="var(--ok)"
            bg="var(--ok-bg)"
            label="기타 인원 몫"
            value={formatWon(s.guestTotal)}
            sub="모임 밖 · 결제자가 직접 회수"
            tone="ok"
          />
        ) : null}
      </div>

      <div className="plan">
        <div>
          {/* ── 일차 탭 — 비어 있는 날은 점으로 알린다 ─────────────── */}
          <div className="daytabs">
            {days.map((d) => (
              <button
                key={d.id}
                className="daytab"
                aria-current={d.n === (day?.n ?? 1)}
                onClick={() => setDayN(d.n)}
              >
                <b>
                  DAY {d.n}
                  {d.items.length ? null : <span className="dot" />}
                </b>
                <small>
                  {shortDate(d.date)} ({d.dow})
                </small>
              </button>
            ))}
          </div>

          {day ? (
            <DayPane
              day={day}
              members={members}
              onOpenItem={setDetailId}
              onAdd={() => setAdding(true)}
            />
          ) : (
            <p className="empty">일차가 아직 없습니다.</p>
          )}
        </div>

        {/* ── 우측 레일 ───────────────────────────────────────────── */}
        <aside className="rail">
          <section className="card">
            <div className="card-h">
              <h3>정산 요약</h3>
              <Link className="more" to={`/g/${gid}/settle`}>
                정산 화면 <Icon name="chev" />
              </Link>
            </div>
            <div className="bigsum-lb">정산 대상 지출</div>
            <div className="bigsum">{formatWon(s?.total ?? 0)}</div>
            <p className="hint" style={{ marginTop: 6 }}>
              {s && s.fxItems.length
                ? `외화 ${s.fxItems.length}건은 각 일자의 마감 환율로 환산했습니다.`
                : `모두 ${groupQ.data.group.cur} 결제입니다.`}
            </p>

            {/* 막대는 "실제 결제액" 기준이다 — 정산 반영액과 항목당 1~2원 차이가 날 수 있다. */}
            <div className="paylist">
              {(s?.balance ?? [])
                .filter((b) => b.spent > 0 || !b.left)
                .map((b) => {
                  const m = members.find((x) => x.id === b.id);
                  return (
                    <div className="payrow" key={b.id}>
                      <div className="top">
                        {m ? <Avatar m={m} /> : null}
                        <span>{memberLabel(b)}</span>
                        <span className="v">{formatWon(b.spent)}</span>
                      </div>
                      <div className="bar">
                        <i
                          style={{
                            width: `${(b.spent / maxSpent) * 100}%`,
                            background: m?.colorFg ?? "var(--brand)",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              막대는 <b>실제 결제액</b>입니다. 반올림 때문에 정산 반영액과 항목당 1~2원 차이가 날 수
              있습니다.
            </p>
          </section>

          <section className="card">
            <div className="card-h">
              <h3>멤버</h3>
              <span className="cnt">{members.filter((m) => !m.left).length}명</span>
            </div>
            <div className="mlist">
              {members.map((m) => {
                const b = s?.balance.find((x) => x.id === m.id);
                return (
                  <div className="mrow" key={m.id}>
                    <Avatar m={m} />
                    <span>
                      <b>{m.name}</b>
                      {m.id === meId ? <small> (나)</small> : null}
                      {/* 나간 멤버도 정산에는 그대로 남는다 — 화면에서만 "기타"로 표시한다 */}
                      {m.left ? <small> 기타 · 나감</small> : null}
                    </span>
                    <span className="v">
                      {!b || b.net === 0
                        ? "정산 완료"
                        : b.net > 0
                          ? `+${formatWon(b.net)}`
                          : `−${formatWon(-b.net)}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {s && s.pending.length > 0 ? (
            <section className="card">
              <div className="card-h">
                <h3>결제자 미지정</h3>
                <span className="cnt">{s.pending.length}건</span>
              </div>
              <div className="mlist">
                {s.pending.map((p) => (
                  <button
                    key={p.id}
                    className="mrow"
                    style={{ width: "100%", textAlign: "left" }}
                    onClick={() => setDetailId(p.id)}
                  >
                    <span
                      className="dotcat"
                      style={{ background: CAT_META[p.cat].c }}
                      aria-hidden="true"
                    />
                    <span>
                      <b>{p.title}</b>
                      <small> DAY {p.dayN}</small>
                    </span>
                    <span className="v">{formatWon(p.krw)}</span>
                  </button>
                ))}
              </div>
              <p className="hint" style={{ marginTop: 8 }}>
                누가 냈는지 정하면 곧바로 정산에 들어갑니다. 지금은 계산에서 빠져 있습니다.
              </p>
            </section>
          ) : null}
        </aside>
      </div>

      <ItemModal
        open={adding}
        gid={gid}
        defaultDayId={day?.id}
        onClose={() => setAdding(false)}
      />
      <ItemDetailModal
        open={!!detail}
        gid={gid}
        item={detail}
        onClose={() => setDetailId(null)}
      />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// 일차 한 장
// ────────────────────────────────────────────────────────────────────

function DayPane({
  day,
  members,
  onOpenItem,
  onAdd,
}: {
  day: ItineraryDay;
  members: Member[];
  onOpenItem: (id: string) => void;
  onAdd: () => void;
}) {
  const sum = day.items.reduce((acc, i) => acc + i.krw, 0);
  const off = day.items.filter((i) => !i.split).length;

  return (
    <>
      <div className="dayhead">
        <h2>
          DAY {day.n}
          {day.label ? ` · ${day.label}` : ""}
        </h2>
        <span className="sub">
          {shortDate(day.date)} ({day.dow}) · 일정 {day.items.length}개 · {formatWon(sum)}
          {off ? ` · 정산 제외 ${off}건` : ""}
        </span>
        <div className="end">
          <button className="btn btn-soft btn-sm" onClick={onAdd}>
            <Icon name="plus" />
            일정 추가
          </button>
        </div>
      </div>

      {/* 그날 묵는 숙소. 체크아웃하는 곳과 새로 체크인하는 곳이 겹치면 2개가 나온다 — 둘 다 보여준다. */}
      {day.stays.length ? (
        <div className="stayband">
          {day.stays.map((st) => (
            <button key={st.itemId} className="staychip" onClick={() => onOpenItem(st.itemId)}>
              <Icon name="bed" />
              {st.title}
              <em>{STAY_PHASE_LABEL[st.phase]}</em>
            </button>
          ))}
        </div>
      ) : null}

      {day.items.length ? (
        <>
          <div className="tl">
            {day.items.map((i) => (
              <ItemStop key={i.id} item={i} members={members} onOpen={onOpenItem} />
            ))}
          </div>
          <button className="addstop" onClick={onAdd}>
            <Icon name="plus" />
            &nbsp;이 날에 일정 추가
          </button>
        </>
      ) : (
        <div className="emptyday">
          <b>아직 비어 있는 날입니다</b>
          <span>숙소·패키지·관광지를 넣으면 여기에 시간순으로 쌓입니다.</span>
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-soft" onClick={onAdd}>
              <Icon name="plus" />
              첫 일정 추가
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// 타임라인 한 칸
// ────────────────────────────────────────────────────────────────────

function ItemStop({
  item,
  members,
  onOpen,
}: {
  item: Item;
  members: Member[];
  onOpen: (id: string) => void;
}) {
  const c = CAT_META[item.cat];
  const payer = members.find((m) => m.id === item.payerId) ?? null;
  // 기타 인원은 따로 강조해야 해서 멤버 부분과 나눠 만든다.
  const memberLabelText = targetLabel({ members: item.shared.members, guests: 0 }, members);
  const noTarget = item.shared.members.length + item.shared.guests === 0;

  return (
    <div className="stop" style={{ "--c": c.c } as CSSProperties}>
      <div className="tm">{item.time || "—"}</div>
      <div className="ln">
        <i />
      </div>
      <div className="bd">
        <button className="icard" onClick={() => onOpen(item.id)}>
          {/* 썸네일이 있으면 그대로 쓰고, 없으면 카테고리 파스텔 타일 + 아이콘 */}
          {item.thumb ? (
            <span className="thumb" style={{ background: item.thumb }} />
          ) : (
            <CatTile cat={item.cat} />
          )}

          <span className="ct">
            <h3>{item.title}</h3>
            <p>{item.meta || " "}</p>
            <span className="catlabel" style={{ background: c.bg, color: c.c }}>
              {c.label}
            </span>
            {item.cat === "stay" && item.checkIn && item.checkOut ? (
              <span className="badge mute" style={{ marginLeft: 5 }}>
                {shortDate(item.checkIn)} → {shortDate(item.checkOut)} · {item.nights}박
              </span>
            ) : null}
            {item.booked ? (
              <span className="badge ok" style={{ marginLeft: 5 }}>
                예약 완료
              </span>
            ) : null}
          </span>

          <span className="rt">
            {item.split ? (
              <>
                <span className="amt">{formatWon(item.krw)}</span>
                {/* 외화는 표시용이다. 정산에 들어가는 값은 위의 원화 정수뿐이다. */}
                {item.cur !== "KRW" ? (
                  <span className="fx">
                    {formatMoney(item.cost, item.cur)} · {shortDate(item.date)} 마감 환율
                  </span>
                ) : null}
                {payer ? (
                  <span className="pay">
                    <Avatar m={payer} />
                    {payer.name} 결제
                  </span>
                ) : (
                  <Badge tone="warn">결제자 미지정</Badge>
                )}
                <span className="tgt">
                  {noTarget ? <em>정산 대상 없음</em> : memberLabelText}
                  {item.shared.guests ? <em> +기타 {item.shared.guests}</em> : null}
                </span>
              </>
            ) : (
              // 정산 제외는 조용히 사라지면 안 된다. 금액 자리에 그렇게 적는다.
              <span className="amt free">정산 제외</span>
            )}
          </span>
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 조각
// ────────────────────────────────────────────────────────────────────

function Stat({
  icon,
  c,
  bg,
  label,
  value,
  sub,
  tone,
}: {
  icon: string;
  c: string;
  bg: string;
  label: string;
  value: string;
  sub: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="stat">
      <span className="tile" style={{ background: bg, color: c }}>
        <Icon name={icon} />
      </span>
      <div>
        <div className="lb">{label}</div>
        <div className="vl">{value}</div>
        <div className={"sb" + (tone ? " " + tone : "")}>{sub}</div>
      </div>
    </div>
  );
}

/** 내 잔액 한 줄. 받을 돈은 초록, 보낼 돈은 노랑 — 색 역할을 섞지 않는다. */
function myNetLabel(net: number): string {
  if (net === 0) return "주고받을 것 없음";
  return net > 0 ? `받을 돈 ${formatWon(net)}` : `보낼 돈 ${formatWon(-net)}`;
}

function netTone(net: number): "ok" | "warn" | undefined {
  if (net > 0) return "ok";
  if (net < 0) return "warn";
  return undefined;
}
