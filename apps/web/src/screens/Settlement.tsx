/**
 * ══════════ 정산 화면 ══════════
 *
 * 왼쪽 장부 + 오른쪽 정산서 2단. 이 앱의 결론이 나오는 화면이다.
 *
 * 여기서 지키는 것 (CLAUDE.md 확정):
 *  · **실제 결제액**(spent)과 **정산 반영액**(paid)은 뜻이 다르다. 이름을 섞지 않고,
 *    화면에는 실제 결제액을 크게 쓰고 둘이 다르면 왜 다른지 문구로 설명한다.
 *  · **"1인당 평균" 같은 전원 균등 가정 숫자를 만들지 않는다.** 정산 대상은 항목마다 다르므로
 *    아무도 실제로 부담하지 않는 금액이라 오해만 만든다. 대신 myOwed(내 부담액)를 쓴다.
 *  · **나간 멤버도 계산에서 빼지 않는다.** 빼면 잔액 합이 0이 되지 않는다. 회색 아바타 + "나감"으로만 표시한다.
 *  · **정산 제외 / 결제자 미지정 / 정산 대상 없음 / 이미 정산함은 네 목록으로 각각 따로 안내한다.**
 *    합치면 왜 빠졌는지 알 수 없다. 특히 **"정산 제외"와 "이미 정산함"은 다른 것이다** —
 *    앞은 금액 자체가 없고, 뒤는 금액이 살아 있는 채로 계산에서만 빠진다.
 *  · **입금 여부를 시스템이 판단하지 않는다.** 대기 → (보낸 사람) 송금 확인 요청 → (받는 사람) 정산 완료.
 *    버튼은 서버가 채워 준 canAct 가 있는 줄에만 켠다.
 *  · 금액은 전부 원 단위 정수다. 소수점이 화면에 나오지 않는다.
 *
 * 계산은 한 줄도 여기서 하지 않는다 — 서버(@tripmate/core 의 settle())가 정본이다.
 * 여기서 만드는 숫자는 "실제 결제액 − 정산 반영액"의 내역 설명뿐이고, 그것도 서버가 준 값들의 뺄셈이다.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CATEGORY_LABEL, formatWon, type Category } from "@tripmate/core";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client.ts";
import {
  keys,
  useApiMutation,
  useGroup,
  useItinerary,
  useMembers,
  useSettlement,
} from "../api/hooks.ts";
import type {
  BalanceRow,
  CollectorRow,
  Member,
  SettleItemBrief,
  Settlement,
  TransferRow,
} from "../api/types.ts";
import { Avatar, Badge, ErrorBox, Won } from "../components/Bits.tsx";
import { Icon } from "../components/Icon.tsx";
import { ShareSettleModal } from "../modals/ShareSettleModal.tsx";

const CAT_COLOR: Record<Category, string> = {
  stay: "var(--stay)",
  pkg: "var(--pkg)",
  spot: "var(--spot)",
  food: "var(--food)",
  move: "var(--move)",
};

/** 아바타 색은 멤버 목록에만 있다. 잔액/이체 줄은 id 로 찾아 쓴다. */
type AvatarInfo = Pick<Member, "name" | "colorBg" | "colorFg" | "left">;

/** 원 단위 정수를 문장 안에 넣을 때. `₩` 기호 없이 "2원" 처럼 쓴다. */
const won = (n: number): string => Math.round(n).toLocaleString("ko-KR") + "원";

export function SettlementScreen() {
  const { gid = "" } = useParams<{ gid: string }>();
  const settlement = useSettlement(gid);
  const group = useGroup(gid);
  const members = useMembers(gid);
  const itinerary = useItinerary(gid);
  const [shareOpen, setShareOpen] = useState(false);

  const qc = useQueryClient();

  /**
   * 이체·수령 확인은 응답이 **정산 결과 전체**다. 그대로 캐시에 넣으면 다시 GET 하지 않아도 된다.
   * (결제자나 정산 대상을 바꾸면 전체가 재계산되는 게 이 앱의 핵심 상호작용이라
   *  부분 갱신을 손으로 만들면 금방 어긋난다.)
   */
  const act = useMutation({
    mutationFn: (v: { path: string; body: unknown }) => api.put<Settlement>(v.path, v.body),
    onSuccess: (data) => qc.setQueryData(keys.settlement(gid), data),
  });

  /**
   * "이미 정산함"을 되돌린다. 항목 PATCH 라 응답이 정산 결과가 아니므로 캐시를 무효화한다 —
   * 항목 하나가 계산에 들어오면 이체 목록 전체가 다시 짜인다. 부분 갱신을 손으로 만들지 않는다.
   */
  const undoSettled = useApiMutation<string, unknown>(
    (id) => api.patch(`/api/groups/${gid}/items/${id}`, { settled: false }),
    gid,
  );

  const meId = group.data?.me.memberId ?? "";

  const avatarOf = useMemo(() => {
    const map = new Map<string, Member>((members.data?.members ?? []).map((m) => [m.id, m]));
    return (id: string, name: string, left = false): AvatarInfo => {
      const m = map.get(id);
      if (m) return { name: m.name, colorBg: m.colorBg, colorFg: m.colorFg, left: m.left };
      // 멤버 목록이 아직 안 왔거나 지워진 사람 — 회색으로 둔다
      return { name, colorBg: "var(--sunken)", colorFg: "var(--ink-3)", left };
    };
  }, [members.data]);

  /**
   * 결제자별 지출 건수. 실제 결제액 옆에 붙여 "무엇의 합인지" 알려 준다.
   * 이미 정산한 항목도 **실제로 결제한 건**이므로 여기서는 빼지 않는다 (spent 와 같은 기준).
   */
  const paidCount = useMemo(() => {
    const c = new Map<string, number>();
    for (const d of itinerary.data?.days ?? []) {
      for (const i of d.items) {
        if (!i.split || !i.payerId) continue;
        c.set(i.payerId, (c.get(i.payerId) ?? 0) + 1);
      }
    }
    return c;
  }, [itinerary.data]);

  /** 기타 인원이 낀 지출이 몇 건인지. 인원 수를 합치면 같은 사람을 여러 번 세게 되므로 건수로 센다. */
  const guestItemCount = useMemo(() => {
    const c = new Map<string, number>();
    for (const d of itinerary.data?.days ?? []) {
      for (const i of d.items) {
        if (!i.split || !i.payerId || i.shared.guests <= 0) continue;
        c.set(i.payerId, (c.get(i.payerId) ?? 0) + 1);
      }
    }
    return c;
  }, [itinerary.data]);

  if (settlement.isLoading || group.isLoading) {
    return <p className="empty">정산을 계산하는 중…</p>;
  }
  if (settlement.error) return <ErrorBox error={settlement.error} />;
  const s = settlement.data;
  if (!s) return <ErrorBox error={new Error("정산 결과를 불러오지 못했습니다")} />;

  const pct = s.totalSteps ? Math.round((s.doneCount / s.totalSteps) * 100) : 0;
  const blockers = s.pending.length + s.noTarget.length;

  return (
    <>
      <div className="settle">
        {/* ══ 왼쪽 — 장부 ══ */}
        <div>
          <div className="ledger">
            <div className="lrow lhead" style={{ display: "flex", gap: 9 }}>
              <span>멤버별 장부</span>
              <span style={{ marginLeft: "auto" }}>실제 결제액</span>
            </div>

            {s.balance.map((b, idx) => (
              <BalanceLine
                key={b.id}
                b={b}
                first={idx === 0}
                me={b.id === meId}
                who={avatarOf(b.id, b.name, b.left)}
                items={paidCount.get(b.id) ?? 0}
                guestAmt={s.collectors.find((c) => c.id === b.id)?.amt ?? 0}
                noTargetAmt={s.noTarget
                  .filter((i) => i.payerId === b.id)
                  .reduce((sum, i) => sum + i.krw, 0)}
              />
            ))}

            <div className="lfoot">
              <span>정산 대상 지출</span>
              <span className="v">
                <Won v={s.total} />
              </span>
            </div>
            {/* 이미 주고받은 금액은 위 합계에 들어 있지 않다. 빠졌다는 사실을 숫자로 말한다. */}
            {s.settledTotal ? (
              <div className="lfoot" style={{ borderTop: "1px solid var(--line-2)" }}>
                <span style={{ color: "var(--ink-2)", fontWeight: 500 }}>
                  이미 정산한 지출 (위 합계에서 빠짐)
                </span>
                <span className="v" style={{ color: "var(--ink-2)" }}>
                  <Won v={s.settledTotal} />
                </span>
              </div>
            ) : null}
          </div>

          <p className="note">
            <b>실제 결제액</b>은 그 사람이 실제로 낸 돈이고, <b>정산 반영액</b>은 정산 계산에 들어간
            금액입니다. 1인 몫을 원 단위로 반올림하면서 남는 1~2원은 결제자가 부담하고, 모임 밖
            인원 몫은 앱이 청구할 대상이 없어 빠지며, <b>이미 정산한 항목</b>은 금액이 남은 채로
            계산에서만 빠지기 때문에 둘이 다를 수 있습니다. 잔액의 합은 항상 정확히 0 입니다.
          </p>

          {s.balance.some((b) => b.left) ? (
            <div className="tip" style={{ marginTop: 12 }}>
              <Icon name="lock" size={15} />
              <span>
                모임에서 나간 사람도 이미 낸 돈과 낼 돈이 있으므로 정산에는 그대로 남습니다. 새 지출의
                대상 기본값과 멤버 목록에서만 빠집니다.
              </span>
            </div>
          ) : null}

          {s.fxItems.length ? (
            <div className="tip" style={{ marginTop: 8 }}>
              <Icon name="fx" size={15} />
              <span>
                외화로 결제한 항목 {s.fxItems.length}건이 있습니다. <b>환율은 그 항목 일자의 마감
                환율로 고정</b>됩니다 — 나중에 환율표가 갱신돼도 이미 정산된 금액은 흔들리지 않습니다.
              </span>
            </div>
          ) : null}

          {/* 세 목록을 합치지 않는다. 각각 왜 정산에서 빠졌는지 이유가 다르다. */}
          <ItemList
            title="결제자 미지정"
            tone="warn"
            icon="clock"
            hint="누가 결제했는지 정하지 않아 정산에서 빠져 있습니다. 항목을 누르면 일정 화면에서 결제자를 지정할 수 있고, 지정하는 순간 전체가 다시 계산됩니다."
            items={s.pending}
            to={`/g/${gid}`}
          />
          <ItemList
            title="정산 대상 없음"
            tone="warn"
            icon="x"
            hint="이 돈을 나눠 낼 사람이 한 명도 선택되지 않았습니다. 대상을 고르거나, 정산에 넣지 않을 항목이라면 정산 토글을 꺼 주세요."
            items={s.noTarget}
            to={`/g/${gid}`}
          />
          {/*
            "정산 제외"와 "이미 정산함"을 한 목록에 합치지 않는다.
            앞은 금액이 없는 항목이고 뒤는 금액이 살아 있는 항목이라, 합치면
            "왜 이 돈이 합계에 없지?"에 답을 못 한다.
          */}
          <ItemList
            title="이미 정산함"
            tone="ok"
            icon="check"
            hint="현장에서 이미 주고받은 항목입니다. 금액은 장부에 그대로 남아 있고 정산 계산과 이체 목록에서만 빠져 있습니다. 되돌리면 그 자리에서 다시 계산됩니다."
            items={s.settledItems}
            onUndo={(id) => undoSettled.mutate(id)}
            undoBusy={undoSettled.isPending}
          />
          <ItemList
            title="정산 제외"
            tone="mute"
            icon="cal"
            hint="정산 토글이 꺼진 항목입니다. 일정에는 남아 있지만 금액·결제자·대상을 아예 갖지 않으므로 계산에 들어가지 않습니다."
            items={s.excluded}
          />
        </div>

        {/* ══ 오른쪽 — 정산서 ══ */}
        <div className="card">
          <div className="card-h">
            <h3>마지막 날 정산서</h3>
            <button
              className="btn btn-soft btn-sm"
              style={{ marginLeft: "auto" }}
              onClick={() => setShareOpen(true)}
            >
              <Icon name="share" />
              정산 공유
            </button>
          </div>

          {s.closed ? (
            <div className="tip ok" style={{ marginBottom: 12 }}>
              <Icon name="check" size={15} />
              <span>
                <b>정산이 마감되었습니다.</b> 모든 이체와 수령 확인이 끝났습니다.
              </span>
            </div>
          ) : blockers ? (
            <div className="tip warn" style={{ marginBottom: 12 }}>
              <Icon name="clock" size={15} />
              <span>
                아직 마감할 수 없습니다 —{" "}
                {s.pending.length ? `결제자 미지정 ${s.pending.length}건` : ""}
                {s.pending.length && s.noTarget.length ? ", " : ""}
                {s.noTarget.length ? `정산 대상 없음 ${s.noTarget.length}건` : ""}
                이 남아 있습니다. 왼쪽 목록에서 정리하면 다시 계산됩니다.
              </span>
            </div>
          ) : null}

          <div className="sumbox">
            <div>
              <div className="lb">정산 대상 지출</div>
              <div className="vl">{formatWon(s.total)}</div>
            </div>
            <div>
              <div className="lb">내 부담액</div>
              <div className="vl brand">{formatWon(s.myOwed)}</div>
            </div>
          </div>

          <div className="prog" title={`${s.doneCount} / ${s.totalSteps} 완료`}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            {s.totalSteps ? (
              <>
                <b>
                  {s.doneCount} / {s.totalSteps}
                </b>{" "}
                완료
              </>
            ) : (
              "주고받을 금액이 없습니다."
            )}
          </p>

          {act.error ? (
            <div style={{ marginTop: 12 }}>
              <ErrorBox error={act.error} />
            </div>
          ) : null}

          <div className="subhead" style={{ margin: "16px 0 4px" }}>
            최종 정산{" "}
            <span style={{ fontWeight: 400, color: "var(--ink-3)" }}>
              송금 횟수를 최소로 짝지었습니다
            </span>
          </div>

          {s.transfers.length ? (
            s.transfers.map((t) => (
              <TransferLine
                key={t.fromId + ">" + t.toId}
                t={t}
                meId={meId}
                from={avatarOf(t.fromId, t.fromName)}
                to={avatarOf(t.toId, t.toName)}
                busy={act.isPending}
                onAct={(state) =>
                  act.mutate({
                    path: `/api/groups/${gid}/settlement/transfers/${t.fromId}/${t.toId}`,
                    body: { state },
                  })
                }
              />
            ))
          ) : (
            <p className="empty">주고받을 금액이 없습니다.</p>
          )}

          {s.collectors.length ? (
            <>
              <div className="subhead" style={{ margin: "16px 0 4px" }}>
                기타 인원 몫{" "}
                <span style={{ fontWeight: 400, color: "var(--ink-3)" }}>
                  결제자가 직접 받습니다
                </span>
              </div>
              {s.collectors.map((c) => (
                <CollectorLine
                  key={c.id}
                  c={c}
                  meId={meId}
                  who={avatarOf(c.id, c.name)}
                  items={guestItemCount.get(c.id) ?? 0}
                  busy={act.isPending}
                  onAct={(received) =>
                    act.mutate({
                      path: `/api/groups/${gid}/settlement/guest-back/${c.id}`,
                      body: { received },
                    })
                  }
                />
              ))}
              <div className="tip warn" style={{ marginTop: 10 }}>
                <Icon name="share" size={15} />
                <span>
                  모임 밖 인원 몫 {formatWon(s.guestTotal)}은 정산에서 빠졌습니다. 분모에는 들어가지만
                  앱이 청구할 대상이 없어서, 그 몫은 <b>결제자가 직접 받을 금액</b>으로만 표시합니다.
                </span>
              </div>
            </>
          ) : null}

          <div className="tip" style={{ marginTop: 12 }}>
            <Icon name="bulb" size={15} />
            <span>
              <b>입금 여부는 시스템이 판단하지 않습니다.</b> 보낸 사람이 “송금 확인 요청”을, 받은
              사람이 “받았습니다 · 정산 완료”를 눌러야 그 건이 끝납니다. 모든 건이 완료되면 이 모임의
              정산이 마감됩니다.
            </span>
          </div>
        </div>
      </div>

      <ShareSettleModal
        open={shareOpen}
        gid={gid}
        isOwner={group.data?.me.role === "owner"}
        onClose={() => setShareOpen(false)}
      />
    </>
  );
}

/* ══════════ 장부 한 줄 ══════════ */

/**
 * 실제 결제액과 정산 반영액이 왜 다른지 한 문장으로 설명한다.
 * 차이 = 이미 정산한 항목 + 기타 인원 몫 + (정산 대상이 비어 통째로 빠진 항목) + 반올림 잔돈.
 * 숫자를 새로 만들지 않고 서버가 준 값들을 뺄셈해서 내역을 나눈다.
 *
 * ⚠ 이미 정산한 금액(b.settled)을 빼먹으면 그 금액이 통째로 "반올림 잔돈"에 섞여 들어가
 *   ₩300,000 을 반올림으로 흡수했다는 거짓말이 된다. 항목이 늘면 반드시 여기에도 더한다.
 */
function diffNote(
  b: BalanceRow,
  guestAmt: number,
  noTargetAmt: number,
): string | null {
  const diff = b.spent - b.paid;
  if (diff === 0) return null;

  const rounding = diff - guestAmt - noTargetAmt - b.settled;
  const parts: string[] = [];
  if (b.settled > 0) parts.push(`이미 정산한 항목 ${won(b.settled)}`);
  if (guestAmt > 0) parts.push(`기타 인원 몫 ${won(guestAmt)}`);
  if (noTargetAmt > 0) parts.push(`정산 대상이 비어 있는 항목 ${won(noTargetAmt)}`);
  if (rounding > 0) parts.push(`반올림으로 결제자가 흡수한 ${won(rounding)}`);
  if (rounding < 0) parts.push(`반올림 조정 ${won(-rounding)}`);
  if (!parts.length) return null;

  return `정산 반영액은 실제 결제액에서 ${parts.join(", ")}을 뺀 금액입니다.`;
}

function BalanceLine({
  b,
  first,
  me,
  who,
  items,
  guestAmt,
  noTargetAmt,
}: {
  b: BalanceRow;
  /** 헤더 바로 아래 줄은 구분선이 겹치므로 위 선을 빼 준다 */
  first: boolean;
  me: boolean;
  who: AvatarInfo;
  items: number;
  guestAmt: number;
  noTargetAmt: number;
}) {
  const note = diffNote(b, guestAmt, noTargetAmt);
  // 잔액: +면 받을 돈(초록), −면 보낼 돈(노랑). 색 역할을 섞지 않는다.
  const netColor = b.net > 0 ? "var(--ok)" : b.net < 0 ? "var(--warn)" : "var(--ink-3)";
  const netLabel = b.net > 0 ? "받을 돈" : b.net < 0 ? "보낼 돈" : "잔액";

  return (
    <div
      style={{
        padding: "13px 16px",
        borderTop: first ? undefined : "1px solid var(--line-2)",
        background: b.left ? "#FCFDFE" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <Avatar m={who} size={26} />
        <b style={{ fontWeight: 600, fontSize: 13.5, color: b.left ? "var(--ink-2)" : undefined }}>
          {b.name}
        </b>
        {me ? <small style={{ color: "var(--ink-3)", fontSize: 11 }}>(나)</small> : null}
        {/* 나간 멤버는 회색 아바타 + "나감" — 계산에서는 빼지 않는다 */}
        {b.left ? <Badge tone="mute">나감</Badge> : null}

        <span style={{ marginLeft: "auto", textAlign: "right" }}>
          <span
            className="num"
            style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.03em", display: "block" }}
          >
            {formatWon(b.spent)}
          </span>
          <small style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
            실제 결제액{items ? ` · 지출 ${items}건` : ""}
          </small>
        </span>
      </div>

      <div
        className="hint"
        style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginTop: 7 }}
      >
        <span>
          정산 반영액 <b>{formatWon(b.paid)}</b>
        </span>
        <span>
          낼 돈 <b>{formatWon(b.owed)}</b>
        </span>
        <span>
          {netLabel}{" "}
          <b style={{ color: netColor, fontWeight: 700 }}>
            {b.net === 0 ? "±0원" : (b.net > 0 ? "+" : "−") + formatWon(Math.abs(b.net))}
          </b>
        </span>
      </div>

      {note ? (
        <p className="hint" style={{ marginTop: 4 }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

/* ══════════ 이체 한 줄 ══════════ */

/**
 * 3단계를 사람이 넘긴다: 대기 → (보낸 사람) 송금 확인 요청 → (받는 사람) 정산 완료.
 * 버튼은 canAct 가 있는 줄에만 켠다 — 서버가 로그인한 사람 기준으로 채워 준다.
 * 되돌리기는 자기가 만든 상태에 대해서만 (req 는 보낸 사람, done 은 받는 사람) 작은 링크로 둔다.
 */
function TransferLine({
  t,
  meId,
  from,
  to,
  busy,
  onAct,
}: {
  t: TransferRow;
  meId: string;
  from: AvatarInfo;
  to: AvatarInfo;
  busy: boolean;
  onAct: (state: "req" | "done" | null) => void;
}) {
  const done = t.state === "done";
  const canUndo = (t.state === "req" && t.fromId === meId) || (done && t.toId === meId);

  let status: ReactNode;
  if (done) {
    status = (
      <Badge tone="ok" icon="check">
        정산 완료
      </Badge>
    );
  } else if (t.state === "req") {
    status = <Badge tone="warn">송금 확인 요청됨 · 받는 사람 확인 대기</Badge>;
  } else {
    status = <Badge tone="mute">대기 중</Badge>;
  }

  let action: ReactNode = null;
  if (t.canAct === "req") {
    action = (
      <button className="btn btn-sm" disabled={busy} onClick={() => onAct("req")}>
        <Icon name="send" />
        송금 확인 요청
      </button>
    );
  } else if (t.canAct === "done") {
    action = (
      <button className="btn btn-ok btn-sm" disabled={busy} onClick={() => onAct("done")}>
        <Icon name="check" />
        받았습니다 · 정산 완료
      </button>
    );
  } else if (!done) {
    // 버튼 대신 누가 눌러야 하는지 알려 준다. 남이 대신 눌러 줄 수 없다.
    action = (
      <span className="hint">
        {t.state === "req"
          ? `${t.toName}님이 “정산 완료”를 눌러야 끝납니다.`
          : `${t.fromName}님이 보낸 뒤 “송금 확인 요청”을 눌러야 합니다.`}
      </span>
    );
  }

  return (
    <div className={"tline" + (done ? " done" : "")}>
      <Avatar m={from} size={22} />
      <span>{t.fromName}</span>
      <Icon name="chev" size={14} />
      <Avatar m={to} size={22} />
      <span>{t.toName}</span>
      <span className="v">{formatWon(t.amt)}</span>
      <div className="act">
        {status}
        {action}
        {canUndo ? (
          <button
            className="btn btn-quiet btn-sm"
            disabled={busy}
            onClick={() => onAct(null)}
            title="내가 누른 단계를 되돌립니다"
          >
            취소
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ══════════ 기타 인원 몫 ══════════ */

function CollectorLine({
  c,
  meId,
  who,
  items,
  busy,
  onAct,
}: {
  c: CollectorRow;
  meId: string;
  who: AvatarInfo;
  items: number;
  busy: boolean;
  onAct: (received: boolean) => void;
}) {
  const mine = c.id === meId;
  return (
    <div className={"tline" + (c.received ? " done" : "")}>
      <Avatar m={who} size={22} />
      <span>
        모임 밖 인원 → {c.name}
        {items ? <small style={{ color: "var(--ink-3)" }}> · 지출 {items}건</small> : null}
      </span>
      <span className="v">{formatWon(c.amt)}</span>
      <div className="act">
        {c.received ? (
          <Badge tone="ok" icon="check">
            받음 확인
          </Badge>
        ) : (
          <Badge tone="warn">직접 받아야 하는 금액</Badge>
        )}
        {c.canAct ? (
          <button className="btn btn-ok btn-sm" disabled={busy} onClick={() => onAct(true)}>
            <Icon name="check" />
            받음 확인
          </button>
        ) : c.received && mine ? (
          <button className="btn btn-quiet btn-sm" disabled={busy} onClick={() => onAct(false)}>
            취소
          </button>
        ) : !c.received ? (
          <span className="hint">{c.name}님이 직접 받고 확인을 눌러야 합니다.</span>
        ) : null}
      </div>
    </div>
  );
}

/* ══════════ 정산에서 빠진 항목 목록 ══════════ */

function ItemList({
  title,
  tone,
  icon,
  hint,
  items,
  to,
  onUndo,
  undoBusy,
}: {
  title: string;
  tone: "warn" | "mute" | "ok";
  icon: string;
  hint: string;
  items: SettleItemBrief[];
  /** 있으면 항목을 눌러 일정 화면으로 갈 수 있다 */
  to?: string;
  /** 있으면 줄마다 "정산에 다시 넣기" 버튼이 붙는다 */
  onUndo?: (id: string) => void;
  undoBusy?: boolean;
}) {
  if (!items.length) return null;

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <Icon name={icon} size={16} />
        <h3>{title}</h3>
        <Badge tone={tone}>{items.length}건</Badge>
      </div>
      <p className="hint" style={{ marginBottom: 10 }}>
        {hint}
      </p>
      <div className="lines">
        {items.map((i) => {
          const body = (
            <>
              <span className="dotcat" style={{ background: CAT_COLOR[i.cat] }} />
              <span style={{ minWidth: 0 }}>
                <b style={{ fontWeight: 500 }}>{i.title}</b>
                <br />
                <small style={{ color: "var(--ink-3)", fontSize: 11 }}>
                  DAY {i.dayN} · {i.date} · {CATEGORY_LABEL[i.cat]}
                </small>
              </span>
              <span className="v">
                {i.krw ? <Won v={i.krw} /> : <span style={{ color: "var(--ink-3)" }}>—</span>}
              </span>
              {onUndo ? (
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={undoBusy}
                  onClick={() => onUndo(i.id)}
                >
                  <Icon name="undo" />
                  정산에 다시 넣기
                </button>
              ) : null}
              {to ? <Icon name="chev" size={14} /> : null}
            </>
          );
          return to ? (
            <Link key={i.id} className="li" to={to} style={{ color: "inherit" }}>
              {body}
            </Link>
          ) : (
            <div key={i.id} className="li">
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
