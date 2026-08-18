/**
 * ══════════ 공유 묶음 ══════════
 *
 * 공유는 폴더가 아니라 **묶음**에 붙는다. 한 모임에 용도별로 여러 개를 두고
 * ("부모님께" / "동반 모임"), 묶음마다 내보낼 폴더를 골라 담는다.
 *
 * 이 화면의 존재 이유는 하나다 — **고른 것과 실제로 나가는 것이 같아야 한다.**
 * 그래서 폴더 집합을 세는 계산을 여기서 다시 쓰지 않고 core 의 `resolveShared` 를 부른다.
 * 서버의 권한 검사도 같은 함수다. 이 모달이 "폴더 3개" 라고 했는데 5개가 나가면 그게 유출이다.
 *
 * ⚠ 밖으로 나가는 것은 담긴 폴더의 **미디어뿐이다.** 문서·정산·일정은 묶음으로도 나가지 않는다.
 * ⚠ 링크는 토큰이 전부고 서버가 발급한다. 여기서 주소를 조립하지 않는다.
 */

import { useQueryClient } from "@tanstack/react-query";
import { isAutoIncluded, resolveShared, type ShareEntry } from "@tripmate/core";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { keys, useShares } from "../../api/hooks.ts";
import type { FolderNodeDto, ShareEntryDto, ShareLink } from "../../api/types.ts";
import { Badge, ErrorBox, Field } from "../../components/Bits.tsx";
import { Icon } from "../../components/Icon.tsx";
import { ConfirmModal, Modal } from "../../components/Modal.tsx";

/** 트리를 평평하게. 깊이 제한이 없으므로 재귀로 훑는다. */
function flatten(node: FolderNodeDto, depth = 0): Array<{ node: FolderNodeDto; depth: number }> {
  return [{ node, depth }, ...node.children.flatMap((c) => flatten(c, depth + 1))];
}

/** 묶음 하나를 고치는 동안의 편집 상태. 저장할 때까지 서버에 보내지 않는다. */
interface Draft {
  /** 편집 중인 묶음. null 이면 새로 만드는 중 */
  id: string | null;
  label: string;
  entries: ShareEntryDto[];
}

const EMPTY: Draft = { id: null, label: "", entries: [] };

export function ShareModal({
  open,
  onClose,
  gid,
  root,
  /** 폴더에서 "공유"를 눌러 들어왔을 때 그 폴더를 미리 골라 둔다 */
  seedFolderId,
}: {
  open: boolean;
  onClose: () => void;
  gid: string;
  root: FolderNodeDto | undefined;
  seedFolderId?: string | undefined;
}) {
  const qc = useQueryClient();
  const shares = useShares(open ? gid : undefined);

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [askStop, setAskStop] = useState<ShareLink | null>(null);
  const [askRotate, setAskRotate] = useState<ShareLink | null>(null);

  const rows = useMemo(() => (root ? flatten(root) : []), [root]);
  // resolveShared 가 필요한 최소한의 모양. 트리를 그대로 넘기지 않는 건 core 가
  // 화면 타입을 몰라야 하기 때문이다.
  const flat = useMemo(() => rows.map((r) => ({ id: r.node.id, parentId: r.node.parentId })), [rows]);

  // 폴더에서 들어왔으면 그 폴더 하나짜리 초안으로 시작한다.
  // 이미 그 폴더를 담고 있는 묶음이 있으면 새로 만들지 말고 그걸 연다 —
  // 같은 폴더를 가리키는 묶음이 실수로 여러 개 생기는 게 제일 헷갈린다.
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setCopied(null);
    if (!seedFolderId) {
      setDraft(EMPTY);
      return;
    }
    const existing = shares.data?.shares.find((s) => s.entries.some((e) => e.folderId === seedFolderId));
    if (existing) setDraft({ id: existing.id, label: existing.label, entries: existing.entries });
    else setDraft({ id: null, label: "", entries: [{ folderId: seedFolderId, includeDescendants: false }] });
  }, [open, seedFolderId, shares.data]);

  const entryOf = (fid: string): ShareEntryDto | undefined => draft.entries.find((e) => e.folderId === fid);

  /** 지금 초안이 실제로 내보내는 폴더 집합. 화면의 숫자는 전부 여기서 나온다. */
  const sharedIds = useMemo(
    () => resolveShared(draft.entries as ShareEntry[], flat),
    [draft.entries, flat],
  );
  const photoTotal = useMemo(
    () => rows.reduce((sum, r) => (sharedIds.has(r.node.id) ? sum + r.node.photoCount : sum), 0),
    [rows, sharedIds],
  );

  const setEntries = (entries: ShareEntryDto[]) => setDraft((d) => ({ ...d, entries }));

  const toggle = (fid: string) => {
    const cur = entryOf(fid);
    if (cur) setEntries(draft.entries.filter((e) => e.folderId !== fid));
    else setEntries([...draft.entries, { folderId: fid, includeDescendants: false }]);
  };

  const setDeep = (fid: string, deep: boolean) => {
    const cur = entryOf(fid);
    if (!cur) setEntries([...draft.entries, { folderId: fid, includeDescendants: deep }]);
    else setEntries(draft.entries.map((e) => (e.folderId === fid ? { ...e, includeDescendants: deep } : e)));
  };

  /** 전체 선택은 루트 하나에 "하위 전부"를 거는 것으로 표현한다 — 같은 뜻이고 목록이 짧다. */
  const selectAll = () => {
    if (!root) return;
    setEntries([{ folderId: root.id, includeDescendants: true }]);
  };
  const clearAll = () => setEntries([]);
  const onlyThis = () => {
    if (!seedFolderId) return;
    setEntries([{ folderId: seedFolderId, includeDescendants: false }]);
  };

  const save = () => {
    setBusy(true);
    setErr(null);
    const body = { label: draft.label.trim(), entries: draft.entries };
    const req = draft.id
      ? api.patch<{ share: ShareLink }>(`/api/groups/${gid}/shares/${draft.id}`, body)
      : api.post<{ share: ShareLink }>(`/api/groups/${gid}/shares`, body);
    void req
      .then((r) => {
        setDraft({ id: r.share.id, label: r.share.label, entries: r.share.entries });
        // 폴더 트리의 sharedIn 이 같은 진실을 본다 — 한쪽만 갱신하면 배지가 거짓말을 한다
        void qc.invalidateQueries({ queryKey: keys.shares(gid) });
        void qc.invalidateQueries({ queryKey: keys.folders(gid) });
      })
      .catch(setErr)
      .finally(() => setBusy(false));
  };

  const stop = (link: ShareLink) => {
    setBusy(true);
    void api
      .del(`/api/groups/${gid}/shares/${link.id}`)
      .then(() => {
        if (draft.id === link.id) setDraft(EMPTY);
        void qc.invalidateQueries({ queryKey: keys.shares(gid) });
        void qc.invalidateQueries({ queryKey: keys.folders(gid) });
      })
      .catch(setErr)
      .finally(() => {
        setBusy(false);
        setAskStop(null);
      });
  };

  const rotate = (link: ShareLink) => {
    setBusy(true);
    void api
      .post<{ share: ShareLink }>(`/api/groups/${gid}/shares/${link.id}/rotate`)
      .then((r) => {
        setCopied(null);
        if (draft.id === link.id) setDraft({ id: r.share.id, label: r.share.label, entries: r.share.entries });
        void qc.invalidateQueries({ queryKey: keys.shares(gid) });
      })
      .catch(setErr)
      .finally(() => {
        setBusy(false);
        setAskRotate(null);
      });
  };

  const copy = (url: string) => {
    void navigator.clipboard
      .writeText(url)
      .then(() => setCopied(url))
      .catch(() => setCopied(null));
  };

  const editing = draft.id ? shares.data?.shares.find((s) => s.id === draft.id) : undefined;
  const dirty =
    !editing ||
    editing.label !== draft.label.trim() ||
    JSON.stringify(editing.entries) !== JSON.stringify(draft.entries);

  return (
    <>
      <Modal open={open} title="사진 공유" onClose={onClose} wide icon="share">
        <div className="tip">
          <Icon name="share" />
          <span>
            <b>사진과 동영상만</b> 밖으로 나갑니다. 문서·정산·일정은 이 링크로 볼 수 없고, 받은
            사람은 고른 폴더 밖으로 나갈 수 없습니다.
          </span>
        </div>

        {/* ── 이미 만들어 둔 묶음들 ───────────────────────────────── */}
        {shares.isLoading ? (
          <p className="hint">불러오는 중…</p>
        ) : shares.data?.shares.length ? (
          <div className="lines" style={{ marginTop: 14 }}>
            {shares.data.shares.map((s) => (
              <div className="li" key={s.id}>
                <span style={{ minWidth: 0 }}>
                  <b>{s.label || "이름 없는 공유"}</b>
                  <br />
                  <small style={{ color: "var(--ink-3)", fontSize: 11 }}>
                    폴더 {s.folderCount}개 · 사진 {s.photoCount}장
                  </small>
                </span>
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => copy(s.url)}>
                    {copied === s.url ? "복사됨" : "링크 복사"}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setDraft({ id: s.id, label: s.label, entries: s.entries })}
                  >
                    고치기
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setAskRotate(s)}>
                    주소 새로
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setAskStop(s)}>
                    중지
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="hint" style={{ marginTop: 14 }}>
            아직 밖으로 나간 사진이 없습니다. 아래에서 폴더를 골라 공유를 만드세요.
          </p>
        )}

        {/* ── 편집 ────────────────────────────────────────────────── */}
        <div className="seclabel" style={{ marginTop: 18 }}>
          {draft.id ? "공유 고치기" : "새 공유"}
        </div>

        <Field label="이름" htmlFor="shLabel" hint="어디에 뿌린 링크인지 나중에 알아보려고 씁니다.">
          <input
            id="shLabel"
            value={draft.label}
            maxLength={40}
            placeholder="부모님께"
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          />
        </Field>

        <div className="chips" style={{ margin: "10px 0" }}>
          <button className="btn btn-ghost btn-sm" onClick={selectAll} disabled={!root}>
            전체 선택
          </button>
          <button className="btn btn-ghost btn-sm" onClick={clearAll} disabled={!draft.entries.length}>
            전체 해제
          </button>
          {seedFolderId ? (
            <button className="btn btn-ghost btn-sm" onClick={onlyThis}>
              현재 폴더만
            </button>
          ) : null}
        </div>

        {/* 폴더 트리. 깊이 제한이 없으므로 들여쓰기로 계층을 보인다. */}
        <div className="tree" style={{ position: "static", maxHeight: 300, overflowY: "auto" }}>
          {rows.map(({ node, depth }) => {
            const picked = entryOf(node.id);
            const inSet = sharedIds.has(node.id);
            // 직접 담지 않았는데 집합에 있으면 "하위 전부" 때문에 딸려 온 것이다.
            const auto = inSet && isAutoIncluded(node.id, draft.entries as ShareEntry[]);
            return (
              <div
                key={node.id}
                className="chk"
                style={{ paddingLeft: depth * 16, opacity: auto ? 0.75 : 1 }}
              >
                <input
                  type="checkbox"
                  id={`sh-${node.id}`}
                  checked={!!picked}
                  onChange={() => toggle(node.id)}
                />
                <label htmlFor={`sh-${node.id}`} style={{ flex: 1, minWidth: 0 }}>
                  {node.name}
                  <small style={{ color: "var(--ink-3)", marginLeft: 6, fontSize: 11 }}>
                    {node.photoCount}장
                  </small>
                </label>

                {auto ? (
                  <Badge tone="ok">자동</Badge>
                ) : picked ? (
                  <span className="chips" style={{ gap: 4 }}>
                    <button
                      className={"btn btn-sm " + (picked.includeDescendants ? "btn-ghost" : "btn-soft")}
                      onClick={() => setDeep(node.id, false)}
                    >
                      이 폴더만
                    </button>
                    <button
                      className={"btn btn-sm " + (picked.includeDescendants ? "btn-soft" : "btn-ghost")}
                      onClick={() => setDeep(node.id, true)}
                      disabled={node.children.length === 0}
                    >
                      하위 전부
                    </button>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* 고른 것과 나가는 것이 같은지를 사용자가 눈으로 확인하는 자리다 */}
        <div className={"tip " + (sharedIds.size ? "ok" : "")} style={{ marginTop: 12 }}>
          <Icon name={sharedIds.size ? "share" : "lock"} />
          <span>
            {sharedIds.size ? (
              <>
                <b>
                  폴더 {sharedIds.size}개 · 사진 {photoTotal}장
                </b>
                이 밖으로 나갑니다.
              </>
            ) : (
              <>아직 아무 폴더도 고르지 않았습니다. 이대로 저장하면 아무것도 나가지 않습니다.</>
            )}
          </span>
        </div>

        {draft.entries.some((e) => e.includeDescendants) ? (
          <div className="tip warn" style={{ marginTop: 8 }}>
            <Icon name="bulb" />
            <span>
              <b>하위 전부</b>로 고른 폴더 아래에 <b>나중에 만드는 폴더도 자동으로 함께 나갑니다.</b>{" "}
              위에서 “자동”으로 표시된 폴더가 지금 그렇게 딸려 나가는 것들입니다.
            </span>
          </div>
        ) : null}

        {editing ? (
          <div className="linkbar" style={{ marginTop: 14 }}>
            <div className="r1">
              <Icon name="share" />
              이 공유의 주소
            </div>
            {/* Drive 링크가 아니라 TripMate 뷰어 주소다. 서버가 발급한 값을 그대로 쓴다 */}
            <code>{editing.url}</code>
            <div className="chips">
              <button className="btn btn-ghost btn-sm" onClick={() => copy(editing.url)}>
                {copied === editing.url ? "복사됨" : "링크 복사"}
              </button>
            </div>
          </div>
        ) : null}

        {err ? <ErrorBox error={err} /> : null}

        <div className="chips" style={{ marginTop: 14, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>
            닫기
          </button>
          <button className="btn" onClick={save} disabled={busy || !dirty}>
            {busy ? "저장 중…" : draft.id ? "저장" : "공유 만들기"}
          </button>
        </div>
      </Modal>

      <ConfirmModal
        open={!!askStop}
        title="공유 중지"
        message={
          <>
            <b>{askStop?.label || "이름 없는 공유"}</b> 링크가 <b>즉시</b> 열리지 않게 됩니다. 이미
            뿌린 주소도 함께 죽습니다. 사진은 지워지지 않습니다.
          </>
        }
        confirmLabel="중지"
        danger
        busy={busy}
        onConfirm={() => askStop && stop(askStop)}
        onClose={() => setAskStop(null)}
      />

      <ConfirmModal
        open={!!askRotate}
        title="주소 새로 발급"
        message={
          <>
            새 주소가 발급되고 <b>이전 주소는 즉시 사용할 수 없습니다.</b> 받는 분께 새 링크를 다시
            보내야 합니다. 담긴 폴더는 그대로입니다.
          </>
        }
        confirmLabel="새로 발급"
        busy={busy}
        onConfirm={() => askRotate && rotate(askRotate)}
        onClose={() => setAskRotate(null)}
      />
    </>
  );
}
