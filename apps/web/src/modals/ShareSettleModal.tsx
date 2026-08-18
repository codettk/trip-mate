/**
 * ══════════ 정산 내역 공유 ══════════
 *
 * **정산 내역 공유는 링크 하나다.** 폴더처럼 공개/비공개 토글을 두지 않는다.
 *   · 모임 멤버가 열면 → 앱의 정산 화면
 *   · 비로그인·모임 밖 사람이 열면 → 읽기 전용 정산 뷰어 (이름·금액·이체 목록만)
 *
 * 문서는 외부 공유 대상이 아니고, 외부로 나가는 것은 미디어뿐이다 —
 * 이 정산 링크가 그 원칙의 **유일한 예외**라서 뷰어에서 사진·문서·일정으로 넘어갈 수 없다는 걸
 * 화면에서 분명히 말해 준다.
 *
 * 재발급(rotate)은 방장만 할 수 있고, 누르는 순간 이전 링크는 즉시 죽는다.
 * 되돌릴 수 없으므로 alert/confirm 대신 ConfirmModal 로 한 번 더 묻는다.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client.ts";
import { Badge, ErrorBox } from "../components/Bits.tsx";
import { Icon } from "../components/Icon.tsx";
import { ConfirmModal, Modal } from "../components/Modal.tsx";

interface ShareLink {
  url: string;
  token: string;
}

const shareKey = (gid: string) => ["settle-share", gid] as const;

export function ShareSettleModal({
  open,
  gid,
  isOwner,
  onClose,
}: {
  open: boolean;
  gid: string;
  isOwner: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const share = useQuery({
    queryKey: shareKey(gid),
    queryFn: () => api.get<ShareLink>(`/api/groups/${gid}/settlement/share`),
    enabled: open && !!gid,
  });

  const rotate = useMutation({
    mutationFn: () => api.post<ShareLink>(`/api/groups/${gid}/settlement/share/rotate`),
    onSuccess: (data) => {
      qc.setQueryData(shareKey(gid), data);
      setConfirmRotate(false);
      setCopied(null);
    },
  });

  const url = share.data?.url ?? "";

  const copy = () => {
    // 브라우저 대화상자를 쓰지 않는다. 실패하면 화면에서 직접 알린다.
    if (!url || !navigator.clipboard) {
      setCopied("fail");
      return;
    }
    navigator.clipboard.writeText(url).then(
      () => setCopied("ok"),
      () => setCopied("fail"),
    );
  };

  return (
    <>
      <Modal open={open} title="정산 내역 공유" icon="share" onClose={onClose}>
        {share.error ? <ErrorBox error={share.error} /> : null}
        {rotate.error ? <ErrorBox error={rotate.error} /> : null}

        <div className="field">
          <span className="lb">공유 링크</span>
          <div className="chips">
            <code
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                background: "var(--sunken)",
                padding: "9px 11px",
                borderRadius: 9,
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {share.isLoading ? "불러오는 중…" : url || "링크를 불러오지 못했습니다"}
            </code>
            <button className="btn btn-ghost" onClick={copy} disabled={!url}>
              복사
            </button>
          </div>
          {copied === "ok" ? (
            <span className="hint">
              <span className="ok">복사했습니다.</span> 카톡에 그대로 붙여 넣으면 됩니다.
            </span>
          ) : copied === "fail" ? (
            <span className="hint">
              <span className="warn">복사하지 못했습니다.</span> 위 주소를 직접 선택해 복사해 주세요.
            </span>
          ) : null}
        </div>

        <div className="lines">
          <div className="li">
            <Icon name="check" />
            <span>
              <b>모임 멤버</b>
              <br />
              <small style={{ color: "var(--ink-3)", fontSize: 11 }}>
                앱의 정산 화면으로 들어가 그대로 확인하고 단계를 넘길 수 있습니다
              </small>
            </span>
          </div>
          <div className="li">
            <Icon name="lock" />
            <span>
              <b>비로그인 · 모임 밖 사람</b>
              <br />
              <small style={{ color: "var(--ink-3)", fontSize: 11 }}>
                읽기 전용 정산 뷰어 — 이름·금액·이체 목록만 보입니다
              </small>
            </span>
          </div>
        </div>

        <div className="tip">
          <Icon name="bulb" size={15} />
          <span>
            뷰어에서는 <b>사진·문서·일정으로 넘어갈 수 없습니다.</b> 누가 누구에게 얼마를 보내야
            하는지만 보여 주기 위한 링크입니다.
          </span>
        </div>

        {isOwner ? (
          <div>
            <button
              className="btn btn-ghost btn-block"
              onClick={() => setConfirmRotate(true)}
              disabled={rotate.isPending}
            >
              <Icon name="clock" />
              링크 재발급
            </button>
            <p className="hint" style={{ marginTop: 6 }}>
              <span className="warn">재발급하면 이전 링크는 즉시 죽습니다.</span> 이미 뿌린 주소로는
              아무것도 열리지 않으니, 새 주소를 다시 보내 주세요.
            </p>
          </div>
        ) : (
          <p className="hint">
            링크 재발급은 방장만 할 수 있습니다. <Badge tone="mute">멤버</Badge>
          </p>
        )}
      </Modal>

      <ConfirmModal
        open={confirmRotate}
        title="정산 링크를 다시 발급할까요?"
        danger
        confirmLabel="재발급"
        busy={rotate.isPending}
        message={
          <>
            새 주소가 만들어지고 <b>이전 링크는 그 즉시 죽습니다.</b> 예전에 공유한 주소를 열면
            아무것도 보이지 않게 되므로, 재발급 후에는 새 주소를 다시 보내 주세요.
          </>
        }
        onConfirm={() => rotate.mutate()}
        onClose={() => setConfirmRotate(false)}
      />
    </>
  );
}
