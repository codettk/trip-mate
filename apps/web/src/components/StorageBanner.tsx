/**
 * 사진 저장소(Drive)가 죽었을 때 화면에 띄우는 띠.
 *
 * 2026-09-05 에 리프레시 토큰이 만료돼 Drive 가 통째로 막혔는데, 화면에는
 * **깨진 이미지만** 떴다. 사용자가 눈으로 발견해서 신고할 때까지 아무도 몰랐다.
 * 서버는 이미 `/api/health` 로 `storage.healthy` 를 내보내고 있었으므로,
 * 그것을 읽어 "지금 사진을 못 가져오는 중"이라고 말해 준다.
 * 경위는 `docs/decisions/2026-09-05-oauth-project-and-token-expiry.md`.
 *
 * ⚠ 원인(토큰 만료·권한 등)을 화면에 쓰지 않는다. 외부 뷰어도 이 띠를 보고,
 *   서버 사정을 밖에 알릴 이유가 없다. "지금 안 된다"까지만 말한다.
 */

import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { api } from "../api/client.ts";
import type { Health } from "../api/types.ts";
import { Icon } from "./Icon.tsx";

/** 저장소 상태. 실패하면 `undefined` — 모를 때는 띠를 띄우지 않는다. */
export function useStorageHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<Health>("/api/health"),
    staleTime: 60_000,
    retry: false,
  });
}

interface Props {
  /** 계속 안 될 때 누구에게 말하라고 할지. 뷰어는 링크를 보낸 사람이다. */
  contact?: string;
  style?: CSSProperties;
  /**
   * 띠를 감쌀 바깥 상자. 정상일 때는 **이 상자도 안 그린다** —
   * 늘 그려 두면 여백만 남아 레이아웃이 미묘하게 밀린다.
   */
  wrapStyle?: CSSProperties;
}

export function StorageBanner({ contact = "방장", style, wrapStyle }: Props) {
  const health = useStorageHealth();

  // 아직 모르거나(로딩·실패) 정상이면 아무것도 그리지 않는다.
  if (!health.data || health.data.storage.healthy) return null;

  const banner = (
    <div className="tip warn" style={{ alignItems: "center", ...style }}>
      <Icon name="alert" size={15} />
      <span>
        <b>지금 사진을 불러오지 못하고 있습니다.</b> 사진이 안 보이는 것은 이 문제 때문이고,
        올려 둔 사진이 사라진 것이 아닙니다. 잠시 뒤 다시 열어 보시고 계속 그러면 {contact}에게 알려
        주세요.
      </span>
    </div>
  );

  return wrapStyle ? <div style={wrapStyle}>{banner}</div> : banner;
}
