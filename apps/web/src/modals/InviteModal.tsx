/**
 * 멤버 초대.
 *
 * 초대 링크는 **발급 후 30분 절대 만료**다. 그 안에 들어오면 승인 절차 없이 즉시 멤버가 된다.
 * 다시 발급하면 그 순간 이전 링크는 죽는다 — 링크를 뿌리기 전에 이 사실을 반드시 읽게 한다.
 *
 * 남은 시간은 1초마다 갱신한다. 0이 되면 "만료됨 + 다시 발급" 상태로 바뀐다.
 * 방장이 아니면 발급 버튼 자체를 숨긴다.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/client.ts";
import { keys, useGroup, useInvite } from "../api/hooks.ts";
import type { InviteInfo } from "../api/types.ts";
import { Avatar, ErrorBox } from "../components/Bits.tsx";
import { Icon } from "../components/Icon.tsx";
import { Modal } from "../components/Modal.tsx";

/** 남은 초 → `mm:ss` */
function mmss(sec: number): string {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

/** 서버가 경로만 주더라도 사람이 복사해 쓸 수 있는 전체 주소로 만든다. */
const absolute = (url: string): string =>
  /^https?:\/\//.test(url) ? url : window.location.origin + (url.startsWith("/") ? url : "/" + url);

export function InviteModal({
  open,
  onClose,
  groupId,
}: {
  open: boolean;
  onClose: () => void;
  groupId: string;
}) {
  const qc = useQueryClient();
  const g = useGroup(groupId);
  const existing = useInvite(groupId, open);

  const [issued, setIssued] = useState<InviteInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // 만료까지 남은 시간을 1초마다 다시 그린다
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  // 모달을 닫으면 방금 발급한 링크를 화면에서 지운다 (다음에 열면 서버에서 다시 읽는다)
  useEffect(() => {
    if (!open) {
      setIssued(null);
      setErr(null);
      setCopied(false);
    } else {
      setNow(Date.now());
    }
  }, [open]);

  const invite = issued ?? existing.data?.invite ?? null;
  const leftMs = invite ? new Date(invite.expiresAt).getTime() - now : 0;
  const leftSec = Math.max(0, Math.floor(leftMs / 1000));
  const alive = !!invite && leftSec > 0;

  const isOwner = g.data?.me.role === "owner";
  const members = g.data?.members.filter((m) => !m.left) ?? [];
  const leftMembers = g.data?.members.filter((m) => m.left) ?? [];

  const issue = () => {
    setBusy(true);
    setErr(null);
    setCopied(false);
    api
      .post<InviteInfo>(`/api/groups/${groupId}/invite`)
      .then((r) => {
        setIssued(r);
        setNow(Date.now());
        void qc.invalidateQueries({ queryKey: keys.invite(groupId) });
        setBusy(false);
      })
      .catch((e: unknown) => {
        setErr(e);
        setBusy(false);
      });
  };

  const copy = () => {
    if (!invite) return;
    void navigator.clipboard
      .writeText(absolute(invite.url))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => setErr(new Error("복사에 실패했습니다. 주소를 직접 선택해 복사해 주세요.")));
  };

  return (
    <Modal
      open={open}
      title="멤버 초대"
      icon="plus"
      onClose={onClose}
      footer={
        <>
          <div className="sp" />
          <button className="btn btn-ghost" onClick={onClose}>
            닫기
          </button>
        </>
      }
    >
      {err ? <ErrorBox error={err} /> : null}

      {!isOwner ? (
        <div className="tip warn">
          <Icon name="lock" size={15} />
          <span>
            <b>방장만 초대할 수 있습니다.</b> 방장에게 초대 링크를 요청하세요.
          </span>
        </div>
      ) : null}

      {invite ? (
        <div className="field">
          <span className="lb">
            초대 링크{" "}
            <span className={"badge " + (alive ? (leftSec > 300 ? "ok" : "warn") : "mute")}>
              {alive ? `${mmss(leftSec)} 남음` : "만료됨"}
            </span>
          </span>
          <div className="chips">
            <code
              className="mono"
              style={{
                flex: 1,
                minWidth: 0,
                background: "var(--sunken)",
                padding: "9px 11px",
                borderRadius: 9,
                fontSize: 11.5,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                opacity: alive ? 1 : 0.5,
                textDecoration: alive ? "none" : "line-through",
              }}
            >
              {absolute(invite.url)}
            </code>
            <button className="btn btn-ghost" onClick={copy} disabled={!alive}>
              {copied ? "복사됨" : "복사"}
            </button>
          </div>
          <span className="hint">
            {alive ? (
              <>
                링크를 받은 사람은 카카오 로그인 후 <b>승인 없이 바로</b> 이 모임의 멤버가 됩니다.
              </>
            ) : (
              <span className="warn">이 링크는 만료됐습니다. 새로 발급해 다시 보내세요.</span>
            )}
          </span>
        </div>
      ) : (
        <p className="hint">
          {existing.isLoading
            ? "초대 링크를 확인하는 중…"
            : "아직 유효한 초대 링크가 없습니다. 발급하면 30분 동안만 유효합니다."}
        </p>
      )}

      {isOwner ? (
        <button className="btn btn-ghost btn-block" onClick={issue} disabled={busy}>
          <Icon name="clock" />
          {busy ? "발급 중…" : invite ? "링크 다시 발급" : "초대 링크 발급"}
        </button>
      ) : null}

      {isOwner ? (
        <div className="tip warn">
          <Icon name="bulb" size={15} />
          <span>
            초대 링크는 <b>발급 후 30분</b>만 유효합니다. <b>다시 발급하면 이전 링크는 즉시
            죽습니다</b> — 이미 뿌린 링크로는 아무도 들어올 수 없습니다.
          </span>
        </div>
      ) : null}

      <div>
        <div className="subhead" style={{ marginBottom: 6 }}>
          현재 멤버 {members.length}명
        </div>
        <div className="lines">
          {members.map((m) => (
            <div className="li" key={m.id}>
              <Avatar m={m} />
              {m.name}
              <span
                className="v"
                style={{ fontWeight: 400, color: "var(--ink-3)", fontSize: 11.5 }}
              >
                {m.role === "owner" ? "방장" : "멤버"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {leftMembers.length > 0 ? (
        <p className="hint">
          나간 멤버 {leftMembers.map((m) => m.name).join(", ")}님은 멤버 목록과 초대에서 빠졌지만,
          정산에는 “기타”로 남아 있습니다.
        </p>
      ) : null}

      <div className="tip">
        <Icon name="bulb" size={15} />
        <span>
          사진만 보여 주고 싶다면 초대 대신 <b>사진 → 폴더 공개</b>를 쓰세요. 계정 없이 뷰어로만
          열리고, 문서·일정은 나가지 않습니다.
        </span>
      </div>
    </Modal>
  );
}
