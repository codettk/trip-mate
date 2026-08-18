/**
 * 사진 하나 고치기 — 이름 · 촬영 시각 · 폴더.
 *
 * 촬영 시각을 **비울 수 있어야 한다.** 잘못 넣은 값을 되돌릴 방법이 없으면 안 되고,
 * 비우면 다시 업로드 시각을 촬영 시각으로 믿는 상태로 돌아간다("촬영 정보 없음" 배지가 돌아온다).
 *
 * 이름을 바꾸면 서버가 저장소(Drive) 파일명도 함께 바꾼다 — 여기서 할 일은 없다.
 */

import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { useApiMutation } from "../../api/hooks.ts";
import type { Photo } from "../../api/types.ts";
import { Badge, ErrorBox, Field } from "../../components/Bits.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Modal } from "../../components/Modal.tsx";

/** `datetime-local` 이 쓰는 모양(`2026-09-12T18:30`)으로. 초와 시간대는 버린다. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PhotoEditModal({
  photo,
  gid,
  folders,
  onClose,
}: {
  photo: Photo | null;
  gid: string;
  folders: Array<{ id: string; name: string; depth: number }>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [taken, setTaken] = useState("");
  const [folderId, setFolderId] = useState("");

  useEffect(() => {
    if (!photo) return;
    setName(photo.name);
    // takenFallback 이면 서버가 업로드 시각을 대신 채워 보낸 것이다 — 그걸 실제 촬영 시각처럼
    // 입력칸에 넣으면 저장하는 순간 추측이 사실로 굳는다. 비워 둔다.
    setTaken(photo.takenFallback ? "" : toLocalInput(photo.takenAt));
    setFolderId(photo.folderId);
  }, [photo]);

  const save = useApiMutation<void, { photo: Photo }>(
    () =>
      api.patch<{ photo: Photo }>(`/api/groups/${gid}/photos/${photo?.id}`, {
        name: name.trim(),
        // 빈 값은 null 로 보낸다 — "지운다"는 뜻이고 서버가 그렇게 받는다
        takenAt: taken ? new Date(taken).toISOString() : null,
        folderId,
      }),
    gid,
    onClose,
  );

  const ok = name.trim().length > 0;

  return (
    <Modal open={!!photo} title="사진 정보" onClose={onClose} icon="img">
      <Field label="이름" htmlFor="peName" hint="저장소(Drive)의 파일명도 함께 바뀝니다.">
        <input id="peName" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </Field>

      <Field
        label="촬영 시각"
        htmlFor="peTaken"
        hint="비우면 업로드 시각을 촬영 시각으로 믿습니다 — 정렬도 그 값을 씁니다."
      >
        <input
          id="peTaken"
          type="datetime-local"
          value={taken}
          onChange={(e) => setTaken(e.target.value)}
        />
      </Field>

      {photo?.takenFallback && !taken ? (
        <div className="tip">
          <Icon name="bulb" />
          <span>
            이 사진에는 촬영 정보가 없어 <b>업로드 시각</b>을 쓰고 있습니다. 실제 촬영 시각을 알면
            여기 적어 주세요.
          </span>
        </div>
      ) : null}

      <Field label="폴더" htmlFor="peFolder">
        <select id="peFolder" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {"　".repeat(f.depth) + f.name}
            </option>
          ))}
        </select>
      </Field>

      {photo && folderId !== photo.folderId ? (
        <p className="hint">
          <Badge tone="warn">폴더 이동</Badge> 옮긴 폴더가 공유 묶음에 담겨 있으면 이 사진도 밖으로
          나갑니다.
        </p>
      ) : null}

      {save.isError ? <ErrorBox error={save.error} /> : null}

      <div className="chips" style={{ marginTop: 14, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onClose}>
          취소
        </button>
        <button className="btn" disabled={!ok || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "저장 중…" : "저장"}
        </button>
      </div>
    </Modal>
  );
}
