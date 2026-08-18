/**
 * 모임 참여 (`/join?code=…`).
 *
 * 초대 링크로 들어온 흐름이다. **승인 절차가 없다** — 확인만 누르면 즉시 멤버가 된다.
 * 링크는 발급 후 30분만 유효하고, 만료는 오류가 아니라 안내다 (방장이 다시 발급하면 된다).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shortDate, tripLength } from "@tripmate/core";
import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client.ts";
import { keys, useMe } from "../api/hooks.ts";
import type { InvitePeek } from "../api/types.ts";
import { ErrorBox } from "../components/Bits.tsx";
import { Icon } from "../components/Icon.tsx";
import { Splash } from "../components/Splash.tsx";

interface AcceptResult {
  groupId: string;
  already?: boolean;
  rejoined?: boolean;
}

function Sheet({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card" style={{ width: "100%", maxWidth: 420, padding: 24 }}>{children}</div>
    </div>
  );
}

export function JoinScreen() {
  const [params] = useSearchParams();
  const code = params.get("code") ?? "";
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();

  const peek = useQuery({
    queryKey: ["invite-peek", code],
    queryFn: () => api.get<InvitePeek>(`/api/invites/${encodeURIComponent(code)}`),
    enabled: !!code,
    retry: false,
  });

  const [result, setResult] = useState<AcceptResult | null>(null);

  // 합류 결과 문구를 잠깐 보여 준 뒤 그 모임으로 들어간다
  useEffect(() => {
    if (!result) return;
    localStorage.setItem("tm:lastGroup", result.groupId);
    const t = setTimeout(() => nav(`/g/${result.groupId}`, { replace: true }), 1100);
    return () => clearTimeout(t);
  }, [result, nav]);

  const accept = useMutation({
    mutationFn: () => api.post<AcceptResult>(`/api/invites/${encodeURIComponent(code)}/accept`),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: keys.groups });
      setResult(d);
    },
  });

  if (!code) {
    return (
      <Sheet>
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>초대 코드가 없습니다</h1>
        <p className="hint" style={{ marginTop: 8 }}>
          받은 초대 링크 전체를 열어 주세요. 방장에게 링크를 다시 요청할 수도 있습니다.
        </p>
        <button className="btn btn-ghost btn-block" style={{ marginTop: 16 }} onClick={() => nav("/")}>
          처음으로
        </button>
      </Sheet>
    );
  }

  if (me.isLoading) return <Splash />;
  // 로그인하고 돌아와야 그대로 이어서 합류할 수 있다
  if (!me.data?.user) {
    return <Navigate to={`/login?next=${encodeURIComponent(`/join?code=${code}`)}`} replace />;
  }

  if (peek.isLoading) return <Splash message="초대 링크를 확인하는 중…" />;

  // 만료·폐기는 오류 페이지가 아니라 안내다
  if (peek.error || !peek.data?.valid || !peek.data.group) {
    return (
      <Sheet>
        <span className="tile" style={{ background: "var(--warn-bg)", color: "var(--warn)" }}>
          <Icon name="clock" />
        </span>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginTop: 12 }}>만료된 초대 링크입니다</h1>
        <p className="hint" style={{ marginTop: 8 }}>
          방장에게 새 링크를 요청하세요. 초대 링크는 발급 후 <b>30분</b>만 유효하고, 방장이 다시
          발급하면 이전 링크는 즉시 죽습니다.
        </p>
        <button className="btn btn-ghost btn-block" style={{ marginTop: 16 }} onClick={() => nav("/")}>
          처음으로
        </button>
      </Sheet>
    );
  }

  const g = peek.data.group;

  if (result) {
    const msg = result.already
      ? "이미 참여 중인 모임입니다"
      : result.rejoined
        ? "다시 오셨습니다"
        : "참여했습니다";
    return (
      <Sheet>
        <span className="tile" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>
          <Icon name="check" />
        </span>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginTop: 12 }}>{msg}</h1>
        <p className="hint" style={{ marginTop: 8 }}>
          <b>{g.name}</b> 모임으로 이동합니다…
        </p>
      </Sheet>
    );
  }

  return (
    <Sheet>
      <div className="logo" style={{ padding: "0 0 14px", fontSize: 18 }}>
        <span className="mk">
          <Icon name="plane" />
        </span>
        TripMate
      </div>

      <div className="joinbox">
        <b>{g.name}</b>
        <small>
          {g.dest} · {g.start.replaceAll("-", ".")} → {shortDate(g.end)} ·{" "}
          {tripLength(g.start, g.end)} · 멤버 {g.memberCount}명
        </small>
        <small style={{ marginTop: 8 }}>이 모임에 참여하시겠습니까?</small>
      </div>

      <p className="hint" style={{ marginTop: 14 }}>
        참여하면 이 모임의 일정·사진·정산·문서를 모두 볼 수 있습니다. <b>승인 절차는 없습니다</b> —
        확인을 누르면 바로 멤버가 됩니다.
      </p>

      {accept.error ? (
        <div style={{ marginTop: 12 }}>
          <ErrorBox error={accept.error} />
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={() => nav("/")} disabled={accept.isPending}>
          아니요
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => accept.mutate()} disabled={accept.isPending}>
          <Icon name="check" />
          {accept.isPending ? "참여하는 중…" : "참여하기"}
        </button>
      </div>
    </Sheet>
  );
}
