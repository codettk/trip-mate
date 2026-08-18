/**
 * 로그인.
 *
 * **로그인은 카카오 하나뿐이다.** 이메일·비밀번호도, 구글 로그인도 만들지 않는다 (확정 결정).
 * 사진 폴더만 공유받은 사람은 아예 로그인하지 않는다 — 뷰어 링크로 바로 열린다.
 *
 * `authMode === "mock"` 은 개발 전용 우회로다. 최종 테스트하는 사람이 계정을 갈아타며
 * "이 이체 버튼이 나에게만 켜지는가"를 확인해야 하므로 시드 계정 칩을 같이 둔다.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client.ts";
import { keys, useMe } from "../api/hooks.ts";
import { ErrorBox, Field } from "../components/Bits.tsx";
import { Icon } from "../components/Icon.tsx";
import { Splash } from "../components/Splash.tsx";

/** 시드 계정. 서버 시드 데이터의 이름과 맞춘다. */
const SEED_NAMES = ["지현", "민수", "수아", "윤호"];

/** 열린 리다이렉트를 막는다 — 앱 안의 경로만 돌아갈 곳으로 인정한다. */
function safeNext(raw: string | null): string {
  if (!raw) return "/";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export function LoginScreen() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const me = useMe();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  if (me.isLoading) return <Splash />;
  // 이미 로그인돼 있으면 로그인 화면에 머물 이유가 없다
  if (me.data?.user) return <Navigate to={next} replace />;

  const mock = me.data?.authMode === "mock";

  const kakao = () => {
    // 서버가 카카오로 리다이렉트하고, 끝나면 next 로 돌려보낸다
    window.location.href = "/api/auth/kakao?next=" + encodeURIComponent(next);
  };

  const mockLogin = () => {
    const nm = name.trim();
    if (!nm) {
      setErr(new Error("이름을 입력해 주세요"));
      return;
    }
    setBusy(true);
    setErr(null);
    api
      .post("/api/auth/mock", { name: nm })
      .then(async () => {
        await qc.invalidateQueries({ queryKey: keys.me });
        window.location.replace(next);
      })
      .catch((e: unknown) => {
        setErr(e);
        setBusy(false);
      });
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card" style={{ width: "100%", maxWidth: 392, padding: 24 }}>
        <div className="logo" style={{ padding: "0 0 16px", fontSize: 19 }}>
          <span className="mk">
            <Icon name="plane" />
          </span>
          TripMate
        </div>

        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.03em" }}>
          여행 하나를 통째로 함께
        </h1>
        <p style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.65 }}>
          일정표 · 사진 · 정산 · 문서를 여행 모임 하나에 모읍니다.
        </p>

        <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
          {err ? <ErrorBox error={err} /> : null}

          {mock ? (
            <>
              <div className="tip warn">
                <Icon name="bulb" size={15} />
                <span>
                  <b>개발 전용 로그인</b>입니다. 실제 서비스에서는 카카오 로그인 하나만 쓰며, 이
                  화면은 <code className="mono">AUTH_MODE=mock</code> 일 때만 나옵니다.
                </span>
              </div>

              <Field label="이름" hint="시드 계정 이름을 누르면 그 계정으로 바로 들어갑니다.">
                <input
                  type="text"
                  value={name}
                  placeholder="예: 지현"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") mockLogin();
                  }}
                />
              </Field>

              <div className="chips">
                {SEED_NAMES.map((n) => (
                  <button
                    key={n}
                    className="chip"
                    style={{ paddingLeft: 11 }}
                    aria-pressed={name === n}
                    onClick={() => setName(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>

              <button className="btn btn-block" onClick={mockLogin} disabled={busy}>
                {busy ? "들어가는 중…" : "시작하기"}
              </button>
            </>
          ) : (
            <>
              <button
                className="btn btn-block"
                style={{ background: "#FEE500", color: "#3C1E1E" }}
                onClick={kakao}
              >
                카카오로 시작하기
              </button>
              <p className="hint">
                TripMate는 카카오 로그인만 지원합니다. 별도의 아이디·비밀번호가 없습니다.
              </p>
            </>
          )}

          <div className="tip">
            <Icon name="bulb" size={15} />
            <span>
              사진 폴더만 공유받으셨다면 로그인할 필요가 없습니다 — 받은 뷰어 링크로 바로 열립니다.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
