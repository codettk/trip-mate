/**
 * 라이트박스.
 *
 * 사진을 크게 보는 것도 새 페이지로 보내지 않는다 — 모달이다(UX 원칙).
 * 좌우 화살표로 이동하고 ESC 로 닫는다.
 *
 * ⚠ 이미지 주소는 언제나 `/api/media/:id` 다. Drive 파일 링크나 서명 URL 을 쓰지 않는다.
 *   서버가 저장소에서 받아 전달하므로 브라우저는 저장소를 알 필요가 없다.
 */

import { kstStamp } from "@tripmate/core";
import { useEffect } from "react";
import type { Photo } from "../../api/types.ts";
import { Badge } from "../../components/Bits.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Modal } from "../../components/Modal.tsx";

/**
 * 촬영/업로드 시각 표기. **항상 한국 시간이다.**
 * 기기 시간대로 찍으면 같이 보는 앨범인데 사람마다 다른 숫자가 적힌다 —
 * 해외에서 열면 9시간 어긋난다. 규칙은 core 의 kstStamp() 한 곳에만 있다.
 */
export const stamp = (iso: string | null): string => kstStamp(iso);

export const isVideo = (p: Photo): boolean => p.mime.startsWith("video/");

export interface LightboxProps {
  photo: Photo;
  index: number;
  count: number;
  /** 확인 모달이 위에 떠 있으면 ESC 가 라이트박스까지 닫아 버리지 않게 막는다 */
  locked: boolean;
  busy: boolean;
  error: string | null;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onAskDelete: () => void;
  /** 이름·촬영 시각·폴더를 고친다. 라이트박스를 닫고 폼 모달로 넘긴다 */
  onEdit: () => void;
}

export function Lightbox({
  photo,
  index,
  count,
  locked,
  busy,
  error,
  onPrev,
  onNext,
  onClose,
  onAskDelete,
  onEdit,
}: LightboxProps) {
  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [locked, onPrev, onNext]);

  return (
    <Modal
      open
      wide
      icon="img"
      title={photo.name}
      onClose={() => {
        if (!locked) onClose();
      }}
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onPrev} disabled={count < 2}>
            이전
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onNext} disabled={count < 2}>
            다음
          </button>
          <span
            className="num"
            style={{ alignSelf: "center", fontSize: 12, color: "var(--ink-3)" }}
          >
            {index + 1} / {count}
          </span>
          <div className="sp" />
          <button className="btn btn-ghost btn-sm" onClick={onEdit} disabled={busy}>
            정보 고치기
          </button>
          <button className="btn btn-danger btn-sm" onClick={onAskDelete} disabled={busy}>
            <Icon name="x" size={14} />
            삭제
          </button>
        </>
      }
    >
      <div
        style={{
          background: "var(--sunken)",
          borderRadius: "var(--r-md)",
          overflow: "hidden",
          display: "grid",
          placeItems: "center",
          maxHeight: "56vh",
        }}
      >
        {isVideo(photo) ? (
          <video src={photo.url} controls style={{ width: "100%", maxHeight: "56vh" }} />
        ) : (
          <img
            src={photo.url}
            alt={photo.name}
            style={{ width: "100%", maxHeight: "56vh", objectFit: "contain", display: "block" }}
          />
        )}
      </div>

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
        <Badge tone="mute">업로드 {stamp(photo.uploadedAt)}</Badge>
        {photo.takenFallback ? (
          // 촬영 메타데이터가 없어 업로드 시각을 믿은 것이다 — 사용자가 알아야 한다
          <Badge tone="warn">촬영 정보 없음 · 업로드 시각 기준</Badge>
        ) : (
          <Badge tone="mute">촬영 {stamp(photo.takenAt)}</Badge>
        )}
        {isVideo(photo) ? <Badge tone="mute">동영상</Badge> : null}
      </div>

      {error ? (
        <div className="tip warn">
          <Icon name="lock" size={14} />
          <span>{error}</span>
        </div>
      ) : null}
    </Modal>
  );
}
