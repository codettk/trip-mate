/**
 * 뷰어 두 종(폴더·정산)이 함께 쓰는 머리띠.
 *
 * 지금까지 뷰어에는 **빠져나갈 길이 아예 없었다.** 다 보고 나면 주소창을 지우는 수밖에 없었다.
 * 그래서 로고와 로그인 버튼을 둔다.
 *  · 로그인해 있으면 로고를 눌러 자기 모임 목록으로 간다
 *  · 아니면 로그인으로 보낸다 — 로그인하면 자기 모임으로 갈 수 있다는 걸 알려야 한다
 *
 * ⚠ 뷰어는 로그인을 **요구하지 않는다.** 세션 조회가 실패해도 화면이 그대로 보여야 하므로
 *   여기서 실패를 던지지 않고 조용히 "비로그인"으로 취급한다.
 *
 * ⚠ 이 컴포넌트는 사진·문서·일정으로 가는 통로를 만들지 않는다.
 *   밖으로 나가는 것은 미디어(그리고 정산 공유 링크)뿐이다.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import { keys } from "../../api/hooks.ts";
import type { Me } from "../../api/types.ts";
import { Icon } from "../../components/Icon.tsx";

export function ViewerHeader() {
  // useMe 를 쓰지 않고 여기서 직접 부른다 — 실패를 오류로 만들지 않기 위해서다.
  // 뷰어는 비로그인이 정상 상태이고, 401 이 화면을 막아서는 안 된다.
  const me = useQuery<{ user: Me | null }>({
    queryKey: keys.me,
    queryFn: () => api.get<{ user: Me | null }>("/api/auth/me"),
    retry: false,
    staleTime: 60_000,
  });
  const signedIn = !!me.data?.user;

  return (
    <div
      style={{
        background: "var(--surface)",
        borderBottom: "1px solid var(--line)",
        padding: "12px 26px",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      {/* 로그인해 있으면 내 모임으로, 아니면 로그인으로. 둘 다 앱 안쪽이 아니다 */}
      <a
        href={signedIn ? "/" : "/login"}
        className="logo"
        style={{ padding: 0, fontSize: 15, textDecoration: "none" }}
        title={signedIn ? "내 여행 모임으로" : "로그인"}
      >
        <span className="mk">
          <Icon name="plane" />
        </span>
        TripMate
      </a>

      <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        {signedIn ? (
          <a className="btn btn-ghost btn-sm" href="/" style={{ textDecoration: "none" }}>
            내 여행 모임
          </a>
        ) : (
          <>
            <span className="hint" style={{ fontSize: 11.5 }}>
              여행 모임이 있으신가요?
            </span>
            {/* 카카오 노랑은 로그인 버튼과 계정 표시에만 쓴다 */}
            <a
              className="btn btn-sm"
              href="/login"
              style={{
                textDecoration: "none",
                background: "#FEE500",
                color: "#3C1E1E",
                border: "1px solid #EBD400",
              }}
            >
              카카오로 로그인
            </a>
          </>
        )}
      </span>
    </div>
  );
}
