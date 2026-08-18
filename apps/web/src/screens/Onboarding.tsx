/**
 * 온보딩 (`/start`).
 *
 * 모임이 하나도 없는 사용자가 로그인 직후 보는 **두 갈래** 화면이다:
 * 모임 만들기 / 모임 참여하기. 그 외의 선택지를 늘리지 않는다.
 *
 * 초대 URL 을 직접 열고 들어온 사람은 여기가 아니라 `/join?code=` 로 간다.
 * 여기서는 "받은 링크를 붙여 넣는" 경우만 다루므로 문자열에서 code 를 뽑아 그 화면으로 넘긴다.
 */

import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useGroups, useMe } from "../api/hooks.ts";
import { Icon } from "../components/Icon.tsx";
import { Splash } from "../components/Splash.tsx";
import { NewGroupModal } from "../modals/NewGroupModal.tsx";

/**
 * 붙여 넣은 문자열에서 초대 코드를 뽑는다.
 * `?code=` 가 정본이지만, 주소창에서 잘라 온 조각도 받아 준다.
 */
export function extractInviteCode(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const q = /[?&]code=([^&#\s]+)/.exec(s);
  if (q?.[1]) return decodeURIComponent(q[1]);

  // URL 이 아니라 코드만 붙여 넣은 경우 / 마지막 경로 조각인 경우
  const last = s.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop();
  if (last && /^[A-Za-z0-9_-]{6,}$/.test(last)) return last;
  return null;
}

export function OnboardingScreen() {
  const nav = useNavigate();
  const me = useMe();
  const groups = useGroups();

  const [open, setOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);

  if (me.isLoading) return <Splash />;
  if (!me.data?.user) return <Navigate to="/login?next=%2Fstart" replace />;
  // 이미 모임이 있으면 여기 머물 이유가 없다 — 랜딩이 마지막 모임으로 보내 준다
  if (groups.data && groups.data.groups.length > 0) return <Navigate to="/" replace />;

  const go = () => {
    const code = extractInviteCode(url);
    if (!code) {
      setErr("초대 링크를 알아볼 수 없습니다. 받은 주소 전체를 붙여 넣어 주세요.");
      return;
    }
    nav(`/join?code=${encodeURIComponent(code)}`);
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card" style={{ width: "100%", maxWidth: 540, padding: 24 }}>
        <div className="logo" style={{ padding: "0 0 14px", fontSize: 19 }}>
          <span className="mk">
            <Icon name="plane" />
          </span>
          TripMate
        </div>

        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.03em" }}>
          {me.data.user.name}님, 반갑습니다
        </h1>
        <p style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.65 }}>
          아직 참여 중인 여행 모임이 없습니다. 새로 만들거나, 받은 초대 링크로 들어오세요.
        </p>

        <div className="choice" style={{ marginTop: 18 }}>
          <button className="ccard" onClick={() => setOpen(true)}>
            <span className="tile" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
              <Icon name="plus" />
            </span>
            <b>모임 만들기</b>
            <small>
              제목·여행지·시작·종료·메모를 넣으면 일차가 자동으로 생깁니다. 만든 사람이 방장이 됩니다.
            </small>
          </button>

          <button
            className="ccard"
            aria-expanded={joining}
            onClick={() => {
              setJoining(true);
              setErr(null);
            }}
          >
            <span className="tile" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>
              <Icon name="share" />
            </span>
            <b>모임 참여하기</b>
            <small>받은 초대 링크를 붙여 넣으세요. 승인 절차 없이 바로 멤버가 됩니다.</small>
          </button>
        </div>

        {/* 새 페이지로 보내지 않는다 — 붙여넣기 입력은 이 자리에서 펼친다 */}
        {joining ? (
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            <label className="field">
              <span className="lb">초대 링크</span>
              <input
                type="text"
                value={url}
                placeholder="https://tripmate.app/join?code=…"
                autoFocus
                onChange={(e) => {
                  setUrl(e.target.value);
                  setErr(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") go();
                }}
              />
              <span className="hint">
                {err ? (
                  <span className="warn">{err}</span>
                ) : (
                  <>
                    초대 링크는 <b>발급 후 30분</b>만 유효합니다. 만료됐다면 방장에게 새 링크를
                    요청하세요.
                  </>
                )}
              </span>
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={go} disabled={!url.trim()}>
                <Icon name="check" />
                참여 확인하기
              </button>
              <button className="btn btn-ghost" onClick={() => setJoining(false)}>
                취소
              </button>
            </div>
          </div>
        ) : null}

        <div className="tip" style={{ marginTop: 16 }}>
          <Icon name="bulb" size={15} />
          <span>
            사진 폴더만 공유받은 사람은 로그인할 필요가 없습니다 — 뷰어 링크로 바로 열립니다.
          </span>
        </div>
      </div>

      <NewGroupModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
