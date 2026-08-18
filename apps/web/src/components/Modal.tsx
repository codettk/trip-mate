/**
 * 모달.
 *
 * 이 앱의 UX 원칙: **무언가를 만들거나 고칠 때 화면을 갈아타게 하지 않는다.**
 * 일정 추가/수정, 일정 상세, 정산 현황, 정산 공유, 멤버 초대, 모임 만들기·참여가 전부 모달이다.
 *
 * ⚠ 브라우저 대화상자(alert/confirm/prompt)를 쓰지 않는다. 확인이 필요하면 `ConfirmModal` 을 쓴다.
 */

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon.tsx";

export interface ModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** 넓은 모달 (정산 현황처럼 표가 들어갈 때) */
  wide?: boolean;
  /** 헤더 제목 앞에 붙는 아이콘 이름 */
  icon?: string;
}

export function Modal({ open, title, onClose, children, footer, wide, icon }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={"modal" + (wide ? " wide" : "")} role="dialog" aria-modal="true">
        <div className="mhead">
          {icon ? <Icon name={icon} /> : null}
          <h3>{title}</h3>
          <button className="x" onClick={onClose} aria-label="닫기">
            <Icon name="x" />
          </button>
        </div>
        <div className="mbody">{children}</div>
        {footer ? <div className="mfoot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/** alert/confirm 대신 쓰는 확인 모달. 위험한 동작은 `danger` 로 표시한다. */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "확인",
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            취소
          </button>
          <div className="sp" />
          <button
            className={"btn" + (danger ? " btn-danger" : "")}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "처리 중…" : confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.7 }}>{message}</p>
    </Modal>
  );
}
