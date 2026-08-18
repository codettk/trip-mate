/**
 * 모임 참여 — 초대 링크로 합류한다.
 *
 * 초대 링크는 발급 후 **30분만 유효**하고, 그 안에 들어오면 **승인 절차 없이 즉시 멤버**가 된다.
 * 그래서 이 모달은 두 걸음이다: 링크를 확인해 **어느 모임인지 보여 주고** → 참여한다.
 * 어느 모임인지 모른 채 합류 버튼을 누르게 하지 않는다.
 *
 * 시작 페이지에만 있던 참여 경로를 사이드바 스위처에도 놓는다 —
 * 이미 모임이 있는 사람이 초대를 받았을 때 로그아웃했다 돌아올 이유가 없어야 한다.
 *
 * 새 페이지로 보내지 않는다. `/join` 라우트로 튕기지 않고 여기서 끝낸다.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tripLength } from "@tripmate/core";
import { useState } from "react";
import { ApiError, api } from "../api/client.ts";
import { keys } from "../api/hooks.ts";
import type { InvitePeek } from "../api/types.ts";
import { Badge, ErrorBox, Field } from "../components/Bits.tsx";
import { Icon } from "../components/Icon.tsx";
import { Modal } from "../components/Modal.tsx";

/**
 * 만들거나 참여한 직후 "무엇이 되었는지" 보여 줄 때 쓰는 최소 정보.
 * 목록(`GroupSummary`)을 다시 받아 오기를 기다리지 않으려고 따로 둔다 — 결과 모달은 즉시 떠야 한다.
 */
export interface GroupBrief {
  id: string;
  name: string;
  dest: string;
  start: string;
  end: string;
  memberCount: number;
}

/**
 * 초대 링크에서 코드만 뽑는다. 전체 URL 도, `?code=…` 조각도, 코드만 붙여넣어도 받는다 —
 * 카카오톡에서 링크를 복사하면 어떤 모양으로 넘어올지 사람이 통제할 수 없기 때문이다.
 *
 * ⚠ 시작 페이지(`Onboarding.tsx`)의 `extractInviteCode` 와 **같은 규칙이 두 벌 존재한다.**
 *    원래는 `packages/core` 로 올려 한 벌만 두는 게 맞고, 다음 정리 대상이다.
 *    지금 두 벌인 이유는 이번 작업의 파일 경계상 시작 페이지를 건드리지 않기 때문이다.
 */
export function extractInviteCode(input: string): string {
  const s = input.trim();
  if (!s) return "";

  // 1) `?code=` / `&code=` 가 있으면 그 값이 코드다 (초대 URL 은 `/join?code=…` 형태)
  const q = /[?&]code=([^&#\s]+)/.exec(s);
  const raw = q?.[1] ?? (s.includes("/") ? (s.split(/[?#]/)[0]?.split("/").filter(Boolean).pop() ?? "") : s);

  const code = decodeURIComponent(raw).trim();
  // 2) 코드 모양이 아니면 빈 값으로 돌려 "링크를 다시 확인하라"고 말한다
  return /^[A-Za-z0-9_-]{4,64}$/.test(code) ? code : "";
}

/** `2026.09.12 – 2026.09.16 · 4박 5일` */
const period = (start: string, end: string): string =>
  `${start.replaceAll("-", ".")} – ${end.replaceAll("-", ".")} · ${tripLength(start, end)}`;

/** 남은 유효 시간. 30분 절대 만료라 "몇 분 남았는지"가 사람에게 제일 쓸모 있다. */
function leftLabel(expiresAt: string | undefined): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return null;
  const min = Math.floor(ms / 60_000);
  return min >= 1 ? `약 ${min}분 남음` : "1분 미만 남음";
}

export function JoinGroupModal({
  open,
  onClose,
  onJoined,
}: {
  open: boolean;
  onClose: () => void;
  /** 합류 성공. 바로 이동하지 않고 결과를 부모가 보여 준다. */
  onJoined: (g: GroupBrief) => void;
}) {
  const qc = useQueryClient();
  const [raw, setRaw] = useState("");
  const [peek, setPeek] = useState<InvitePeek | null>(null);

  const code = extractInviteCode(raw);

  const check = useMutation({
    mutationFn: (c: string) => api.get<InvitePeek>(`/api/invites/${c}`),
    onSuccess: (r) => setPeek(r),
  });

  const accept = useMutation({
    mutationFn: (c: string) => api.post<{ groupId: string }>(`/api/invites/${c}/accept`),
    onSuccess: async (r) => {
      // 스위처 목록에 방금 들어간 모임이 보여야 한다
      await qc.invalidateQueries({ queryKey: keys.groups });
      const g = peek?.group;
      onJoined({
        id: r.groupId,
        name: g?.name ?? "새 모임",
        dest: g?.dest ?? "",
        start: g?.start ?? "",
        end: g?.end ?? "",
        // 방금 내가 들어갔으니 미리보기 시점보다 한 명 많다
        memberCount: (g?.memberCount ?? 0) + 1,
      });
      reset();
    },
  });

  const reset = () => {
    setRaw("");
    setPeek(null);
    check.reset();
    accept.reset();
  };

  const close = () => {
    reset();
    onClose();
  };

  // 만료된 링크는 서버가 410 으로 돌려주기도 하고 `valid:false` 로 돌려주기도 한다. 둘 다 같은 문구로 받는다.
  const expired =
    (peek !== null && !peek.valid) ||
    (accept.error instanceof ApiError && accept.error.status === 410);
  const ready = peek?.valid === true && !!peek.group;
  const left = leftLabel(peek?.expiresAt);

  return (
    <Modal
      open={open}
      title="모임 참여하기"
      icon="ticket"
      onClose={close}
      footer={
        <>
          <div className="sp" />
          <button className="btn btn-ghost" onClick={close}>
            취소
          </button>
          {ready ? (
            <button
              className="btn"
              onClick={() => code && accept.mutate(code)}
              disabled={accept.isPending}
            >
              {accept.isPending ? "참여하는 중…" : "참여하기"}
            </button>
          ) : (
            <button
              className="btn"
              onClick={() => code && check.mutate(code)}
              disabled={!code || check.isPending}
            >
              {check.isPending ? "확인하는 중…" : "초대 확인"}
            </button>
          )}
        </>
      }
    >
      <Field
        label="초대 링크"
        hint="받은 링크를 통째로 붙여넣어도 됩니다. 링크는 발급 후 30분만 유효합니다."
      >
        <input
          type="text"
          value={raw}
          placeholder="https://tripmate.app/join?code=…"
          // 경로·URL 은 mono 로 쓴다 (금액에는 쓰지 않는다)
          className="mono"
          onChange={(e) => {
            setRaw(e.target.value);
            // 링크를 고치는 순간 이전 확인 결과는 더 이상 그 링크의 것이 아니다
            setPeek(null);
            check.reset();
            accept.reset();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && code && !ready) check.mutate(code);
          }}
        />
      </Field>

      {raw.trim() && !code ? (
        <p className="hint">
          <span className="warn">초대 코드를 찾지 못했습니다. 링크를 다시 복사해 주세요.</span>
        </p>
      ) : null}

      {check.error ? <ErrorBox error={check.error} /> : null}
      {accept.error && !expired ? <ErrorBox error={accept.error} /> : null}

      {expired ? (
        <div className="tip warn">
          <Icon name="bulb" size={15} />
          <span>
            이 초대 링크는 만료되었거나 이미 새 링크로 교체되었습니다. 방장에게 링크를 다시
            발급해 달라고 요청해 주세요.
          </span>
        </div>
      ) : null}

      {ready && peek?.group ? (
        <div className="lines">
          <div className="li">
            <span>
              <b>{peek.group.name}</b>
              <br />
              <small style={{ color: "var(--ink-3)", fontSize: 11 }}>
                {peek.group.dest} · {period(peek.group.start, peek.group.end)} · 멤버{" "}
                {peek.group.memberCount}명
              </small>
            </span>
            {left ? (
              <span className="v" style={{ marginLeft: "auto" }}>
                {/* 노랑은 "아직 안 끝난 것" — 만료 전까지 남은 시간이 여기 해당한다 */}
                <Badge tone="warn">{left}</Badge>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="tip">
        <Icon name="bulb" size={15} />
        <span>
          링크가 살아 있으면 <b>승인 절차 없이 바로 멤버</b>가 됩니다. 참여하면 그 모임의 일정·사진·
          정산·문서를 볼 수 있고, 지금 있는 모임은 그대로 남습니다.
        </span>
      </div>
    </Modal>
  );
}
