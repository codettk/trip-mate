/**
 * 정산 뷰어 — `/{gid}/settle/{token}`
 *
 * 정산 내역 공유는 링크 하나다.
 *  · **모임 멤버**가 열면 앱의 정산 화면으로 보낸다 (서버가 `memberView:true` 로 알려 준다).
 *  · **비로그인·모임 밖 사람**이 열면 **읽기 전용 정산 뷰어**를 그린다.
 *
 * 뷰어에는 이름·금액·이체 목록만 나온다. 사진·문서·일정으로 넘어갈 수 없고,
 * 상태를 바꾸는 버튼도 없다 — 이체 단계를 넘기는 것은 앱 안에서 당사자만 한다.
 * (서버도 멤버 id, 항목 제목, 미지정·대상없음 목록을 아예 내려보내지 않는다.)
 *
 * 화면에 "1인당 평균" 같은 전원 균등 가정 숫자를 새로 만들지 않는다.
 * 정산 대상은 항목마다 다르므로 아무도 실제로 부담하지 않는 금액이 된다.
 */

import { useQuery } from "@tanstack/react-query";
import { shortDate, tripLength, type TransferState } from "@tripmate/core";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/client.ts";
import { Won } from "../../components/Bits.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Splash } from "../../components/Splash.tsx";

/** 밖으로 나가는 잔액 한 줄. 멤버 id 는 들어 있지 않다. */
interface ViewBalance {
  name: string;
  /** 나갔지만 정산에는 그대로 남는다 — 빼면 잔액 합이 0이 되지 않는다 */
  left: boolean;
  /** 실제 결제액 */
  spent: number;
  /** 낼 돈 */
  owed: number;
  /** 정산 반영액 − 낼 돈. 전원의 합은 정확히 0 */
  net: number;
}

interface ViewTransfer {
  fromName: string;
  toName: string;
  amt: number;
  state: TransferState;
}

interface ViewCollector {
  name: string;
  amt: number;
  received: boolean;
}

type SettleView =
  | { memberView: true; groupId: string }
  | {
      memberView: false;
      group: { name: string; dest: string; start: string; end: string };
      balance: ViewBalance[];
      transfers: ViewTransfer[];
      collectors: ViewCollector[];
      total: number;
      guestTotal: number;
      closed: boolean;
    };

const STATE_LABEL: Record<"wait" | "req" | "done", string> = {
  wait: "대기",
  req: "요청됨",
  done: "완료",
};

/** 대기·요청됨은 "아직 안 끝난 것"이라 노랑 계열, 완료는 초록이다. 색 역할을 섞지 않는다. */
function StateChip({ state }: { state: TransferState }) {
  if (state === "done") return <span className="badge ok">{STATE_LABEL.done}</span>;
  if (state === "req") return <span className="badge warn">{STATE_LABEL.req}</span>;
  return <span className="badge mute">{STATE_LABEL.wait}</span>;
}

function Expired() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 420, textAlign: "center", padding: 28 }}>
        <span
          className="tile"
          style={{ background: "var(--warn-bg)", color: "var(--warn)", margin: "0 auto 12px" }}
        >
          <Icon name="lock" />
        </span>
        <h1 style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.02em" }}>
          링크가 만료되었거나 잘못된 주소입니다
        </h1>
        <p style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 8, lineHeight: 1.7 }}>
          정산 링크가 다시 발급되면 이전 링크는 사용할 수 없습니다. 링크를 준 분에게 다시
          요청해 주세요.
        </p>
      </div>
    </div>
  );
}

export function SettleViewerScreen() {
  const { gid, token } = useParams<{ gid: string; token: string }>();
  const nav = useNavigate();

  const q = useQuery<SettleView>({
    queryKey: ["view-settle", gid ?? "", token ?? ""],
    queryFn: () =>
      api.get<SettleView>(`/api/view/${gid}/settle/${encodeURIComponent(token ?? "")}`),
    enabled: !!gid && !!token,
    retry: false,
  });

  const data = q.data;
  // 모임 멤버는 읽기 전용 뷰어를 볼 이유가 없다 — 앱의 정산 화면으로 보낸다.
  const memberGroupId = data && data.memberView ? data.groupId : null;

  useEffect(() => {
    if (memberGroupId) nav(`/g/${memberGroupId}/settle`, { replace: true });
  }, [memberGroupId, nav]);

  if (!gid || !token) return <Expired />;
  if (q.isLoading) return <Splash message="정산 내역을 여는 중…" />;
  if (q.error || !data) return <Expired />;
  if (data.memberView) return <Splash message="정산 화면으로 이동합니다…" />;

  const { group, balance, transfers, collectors, total, guestTotal, closed } = data;
  const period = `${group.start.replaceAll("-", ".")} – ${shortDate(group.end)} · ${tripLength(group.start, group.end)}`;

  return (
    <div style={{ minHeight: "100vh", background: "var(--app)" }}>
      <header
        className="apphead"
        style={{ position: "static", background: "var(--surface)", padding: "18px 26px" }}
      >
        <div className="logo" style={{ padding: 0, fontSize: 15 }}>
          <span className="mk">
            <Icon name="plane" />
          </span>
          TripMate
        </div>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 18 }}>{group.name}</h1>
          <div className="dates">
            {group.dest} · {period}
          </div>
        </div>
        <div className="end">
          {closed ? (
            <span className="badge ok">
              <Icon name="check" size={12} />
              정산 마감
            </span>
          ) : (
            <span className="badge warn">정산 진행 중</span>
          )}
        </div>
      </header>

      <div className="body" style={{ maxWidth: 840, margin: "0 auto", width: "100%" }}>
        <div className="sumbox" style={{ marginBottom: 18 }}>
          <div>
            <div className="lb">정산 반영액</div>
            <div className="vl brand">
              <Won v={total} />
            </div>
          </div>
          <div>
            <div className="lb">기타 인원 몫</div>
            <div className="vl warn">
              <Won v={guestTotal} />
            </div>
          </div>
        </div>

        {/* ── 잔액표 ─────────────────────────────────────────────── */}
        <div className="seclabel">
          잔액
          <span className="sub">실제 낸 돈과 낼 돈의 차이입니다</span>
        </div>
        <div className="ledger" style={{ marginBottom: 22 }}>
          <div
            className="lrow lhead"
            style={{ gridTemplateColumns: "minmax(0,1fr) 116px 116px 124px" }}
          >
            <span>이름</span>
            <span className="am">실제 결제액</span>
            <span className="am">낼 돈</span>
            <span className="am">잔액</span>
          </div>
          {balance.map((b, i) => (
            <div
              className="lrow"
              key={`${b.name}-${i}`}
              style={{ gridTemplateColumns: "minmax(0,1fr) 116px 116px 124px" }}
            >
              <span className="nm">
                <b>{b.name}</b>
                {/* 나간 멤버도 정산에는 그대로 남는다. 화면에는 "나감"으로 표시한다. */}
                {b.left ? (
                  <span className="badge mute" style={{ marginLeft: 2 }}>
                    나감
                  </span>
                ) : null}
              </span>
              <span className="am">
                <Won v={b.spent} />
              </span>
              <span className="am">
                <Won v={b.owed} />
              </span>
              <span
                className="am"
                style={{ color: b.net > 0 ? "var(--ok)" : b.net < 0 ? "var(--warn)" : "var(--ink-3)" }}
              >
                {/* 부호 대신 말로 쓴다 — 뷰어를 여는 사람에게 마이너스 기호는 읽기 어렵다 */}
                <Won v={Math.abs(b.net)} />
                <small>{b.net > 0 ? "받을 돈" : b.net < 0 ? "보낼 돈" : "주고받을 것 없음"}</small>
              </span>
            </div>
          ))}
        </div>

        {/* ── 이체 목록 ──────────────────────────────────────────── */}
        <div className="seclabel">
          보낼 곳
          <span className="sub">송금 횟수를 최소화한 목록입니다</span>
        </div>
        <div className="card" style={{ marginBottom: 22 }}>
          {transfers.length === 0 ? (
            <p className="empty" style={{ padding: 0 }}>
              주고받을 금액이 없습니다.
            </p>
          ) : (
            transfers.map((t, i) => (
              <div
                className={"tline" + (t.state === "done" ? " done" : "")}
                key={`${t.fromName}>${t.toName}-${i}`}
              >
                <b>{t.fromName}</b>
                <span style={{ color: "var(--ink-3)", display: "inline-flex" }}>
                  <Icon name="chev" size={14} />
                </span>
                <b>{t.toName}</b>
                <StateChip state={t.state} />
                <span className="v">
                  <Won v={t.amt} />
                </span>
              </div>
            ))
          )}
        </div>

        {/* ── 기타 인원 몫 ───────────────────────────────────────
            모임에 초대되지 않은 사람 몫은 앱이 청구할 대상이 없으므로
            정산에서 빼고 결제자가 직접 받을 금액으로 표시한다. */}
        {collectors.length > 0 ? (
          <>
            <div className="seclabel">
              기타 인원 몫
              <span className="sub">결제자가 직접 받는 금액입니다</span>
            </div>
            <div className="card" style={{ marginBottom: 22 }}>
              {collectors.map((c, i) => (
                <div className="tline" key={`${c.name}-${i}`}>
                  <b>{c.name}</b>
                  <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                    님이 모임 밖 인원에게 직접 받습니다
                  </span>
                  {c.received ? (
                    <span className="badge ok">받음 확인</span>
                  ) : (
                    <span className="badge warn">미수령</span>
                  )}
                  <span className="v">
                    <Won v={c.amt} />
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {/* 밖에서 보는 사람에게 내부 규칙을 설명할 이유는 없다. 읽는 데 필요한 것만 적는다. */}
        <p className="note">
          읽기 전용 정산 내역입니다. 금액은 전부 원 단위 정수이며, 입금 여부는 보낸 사람과 받는
          사람이 직접 확인합니다.
        </p>
        <p className="note" style={{ marginTop: 8 }}>
          TripMate 로 공유된 정산 내역입니다.
        </p>
      </div>
    </div>
  );
}
