/**
 * ══════════ 사진 ══════════
 *
 * 사진 화면은 앨범 목록이 아니라 **폴더 탐색기**다 — 트리 + 브레드크럼 + 폴더 카드 + 그리드.
 * 폴더는 멤버가 자유롭게 만들고 중첩 깊이에 제한이 없다.
 *
 * ⚠ 공유는 TripMate 가 관리한다. Drive 공유 링크를 밖으로 내보내지 않는다.
 *   이 화면이 보여 주는 유일한 외부 주소는 서버가 준 `folder.shareUrl`(tripmate 뷰어) 하나뿐이고,
 *   이미지도 전부 `/api/media/:id` 로 나간다. Drive 링크·서명 URL 은 어디에도 그리지 않는다.
 *
 * 만들고 고치는 일은 화면을 갈아타지 않는다 — 새 폴더는 목록 위 인라인 입력,
 * 사진 보기·삭제·삭제 확인은 전부 모달이다. alert/confirm/prompt 를 쓰지 않는다.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api/client.ts";
import { useApiMutation, useFolder, useFolders, useInvalidateGroup } from "../api/hooks.ts";
import type { Photo } from "../api/types.ts";
import { Badge, ErrorBox } from "../components/Bits.tsx";
import { Icon } from "../components/Icon.tsx";
import { ConfirmModal } from "../components/Modal.tsx";
import { FolderTree, pathTo } from "./photos/FolderTree.tsx";
import { Lightbox, isVideo, stamp } from "./photos/Lightbox.tsx";

type Sort = "up" | "taken";

/** 업로드 응답. 일부만 실패할 수 있으므로 전체 실패로 처리하지 않는다. */
interface UploadResult {
  uploaded: Photo[];
  failed: Array<{ name: string; reason: string }>;
}

/** 공개 토글 응답. 공개할 때마다 **새 토큰**이 나오므로 예전 링크는 되살아나지 않는다. */
interface PublicResult {
  folder: { id: string; name: string; slug: string; pub: boolean; shareUrl: string | null };
  shareUrl: string | null;
}

/** 사진 타일. `.photos div` 스타일을 버튼에 그대로 옮긴 것 — 타일 전체가 눌러야 하기 때문이다. */
const TILE: CSSProperties = {
  aspectRatio: "1",
  borderRadius: 11,
  position: "relative",
  overflow: "hidden",
  background: "var(--sunken)",
  width: "100%",
  padding: 0,
  display: "block",
};

export function PhotosScreen() {
  const { gid = "", fid } = useParams<{ gid: string; fid?: string }>();
  const nav = useNavigate();
  const invalidate = useInvalidateGroup(gid);

  const [sort, setSort] = useState<Sort>("up"); // 업로드순이 기본
  const folders = useFolders(gid);
  const root = folders.data?.root;

  // fid 가 없으면 루트 폴더를 연다. 루트 이름은 곧 여행 모임 제목이다.
  const currentId = fid ?? root?.id;
  const view = useFolder(gid, currentId, sort);

  const folder = view.data?.folder;
  const crumbs = useMemo(() => view.data?.breadcrumb ?? [], [view.data]);
  const isRoot = !!root && !!folder && root.id === folder.id;
  const photos = view.data?.photos ?? [];

  // ── 트리 펼침 ────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!root || !currentId) return;
    const path = pathTo(root, currentId);
    if (!path) return;
    // 현재 폴더의 조상은 자동으로 펼친다 — 깊이가 깊어도 지금 위치가 보여야 한다
    setExpanded((prev) => {
      if (path.every((id) => prev.has(id))) return prev; // 바뀐 게 없으면 그대로 둔다
      const next = new Set(prev);
      for (const id of path) next.add(id);
      return next;
    });
  }, [root, currentId]);

  const toggleNode = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openFolder = (id: string) => nav(`/g/${gid}/photos/${id}`);

  // ── 새 폴더 (모달이 아니라 목록 위 인라인 입력) ──────────────────
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const createMut = useApiMutation<string, unknown>(
    (name) => api.post(`/api/groups/${gid}/folders`, { parentId: currentId, name }),
    gid,
    () => {
      setNewName("");
      setNewOpen(false);
    },
  );

  // ── 업로드 ───────────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState<UploadResult["failed"]>([]);
  const [dragging, setDragging] = useState(false);
  const uploadMut = useApiMutation<File[], UploadResult>(
    (files) => {
      const form = new FormData();
      for (const f of files) form.append("files", f, f.name);
      // 업로드 대상은 지금 열어 둔 폴더다. 앱이 촬영 시각 등으로 자동 분류해 옮기지 않는다.
      return api.upload<UploadResult>(`/api/groups/${gid}/folders/${currentId}/photos`, form);
    },
    gid,
    (d) => setFailed(d.failed),
  );

  const send = (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (!files.length || !currentId) return;
    setFailed([]);
    uploadMut.mutate(files);
  };

  // ── 공개/비공개 ──────────────────────────────────────────────────
  const [askPrivate, setAskPrivate] = useState(false);
  const [copied, setCopied] = useState(false);
  const pubMut = useApiMutation<boolean, PublicResult>(
    (pub) => api.put<PublicResult>(`/api/groups/${gid}/folders/${currentId}/public`, { pub }),
    gid,
    () => {
      setAskPrivate(false);
      setCopied(false);
    },
  );

  const copyShare = async () => {
    if (!folder?.shareUrl) return;
    try {
      await navigator.clipboard.writeText(folder.shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  // ── 폴더 삭제 ────────────────────────────────────────────────────
  // 사진이 들어 있으면 서버가 409 + 장수를 준다. 몇 장이 함께 사라지는지 말하지 않고 지우면 안 된다.
  const [del, setDel] = useState<{ stage: "ask" | "force"; photoCount: number } | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  const removeFolder = async (force: boolean) => {
    if (!currentId) return;
    setDelBusy(true);
    setDelError(null);
    try {
      await api.del(`/api/groups/${gid}/folders/${currentId}${force ? "?force=true" : ""}`);
      const parent = crumbs[crumbs.length - 2];
      setDel(null);
      invalidate();
      nav(parent ? `/g/${gid}/photos/${parent.id}` : `/g/${gid}/photos`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const d = e.detail as { photoCount?: number } | undefined;
        setDel({ stage: "force", photoCount: Number(d?.photoCount ?? 0) });
      } else {
        setDelError(e instanceof Error ? e.message : "폴더를 삭제하지 못했습니다");
      }
    } finally {
      setDelBusy(false);
    }
  };

  // ── 사진 삭제 (라이트박스 안에서) ────────────────────────────────
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [askPhoto, setAskPhoto] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const current = openIdx !== null ? photos[openIdx] : undefined;

  const removePhoto = async () => {
    if (!current) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      await api.del(`/api/groups/${gid}/photos/${current.id}`);
      setAskPhoto(false);
      setOpenIdx(null);
      invalidate();
    } catch (e) {
      // 올린 사람 또는 방장만 지울 수 있다 — 왜 안 되는지 그 자리에서 말한다
      setPhotoError(
        e instanceof ApiError && e.status === 403
          ? "올린 사람 또는 방장만 삭제할 수 있습니다"
          : e instanceof Error
            ? e.message
            : "사진을 삭제하지 못했습니다",
      );
      setAskPhoto(false);
    } finally {
      setPhotoBusy(false);
    }
  };

  const step = (d: number) => {
    if (openIdx === null || !photos.length) return;
    setPhotoError(null);
    setOpenIdx((i) => ((i ?? 0) + d + photos.length) % photos.length);
  };

  // ── 그리기 ───────────────────────────────────────────────────────
  if (folders.isError) return <ErrorBox error={folders.error} />;
  if (!root) return <p className="empty">폴더를 불러오는 중…</p>;

  const fallbackCount = photos.filter((p) => p.takenFallback).length;
  const trail = crumbs.map((c) => c.name).join(" / ");

  return (
    <div className="explorer">
      {/* ── 폴더 트리 ── */}
      <nav className="tree card" aria-label="폴더">
        <div className="card-h">
          <h3>폴더</h3>
        </div>
        <FolderTree
          node={root}
          currentId={currentId}
          expanded={expanded}
          onToggle={toggleNode}
          onOpen={openFolder}
        />
        <p className="note" style={{ marginTop: 14, fontSize: 11.5 }}>
          최상위 폴더 이름은 여행 모임 제목과 같습니다. 모임 멤버는 모든 폴더를 그대로 봅니다.
        </p>
      </nav>

      <div>
        {/* ── 브레드크럼 ── */}
        <div className="crumbs">
          {crumbs.map((c, i) => (
            <span key={c.id} style={{ display: "contents" }}>
              {i ? <span className="sep">/</span> : null}
              <button
                onClick={() => openFolder(c.id)}
                aria-current={i === crumbs.length - 1}
                disabled={i === crumbs.length - 1}
              >
                {c.name}
              </button>
            </span>
          ))}
        </div>

        {/* ── 폴더 헤더 + 공개 토글 ── */}
        <div className="dayhead">
          <h2>{folder?.name ?? root.name}</h2>
          {/*
            폴더 상세가 오기 전에는 배지를 그리지 않는다.
            folder 가 undefined 인 동안 "비공개"로 먼저 그리면, 공개 폴더를 직접 열었을 때
            비공개 → 공개로 깜빡인다. 공개 여부는 잘못 보여주면 안 되는 값이다.
          */}
          {folder ? (
            <Badge tone={folder.pub ? "ok" : "mute"} icon={folder.pub ? "share" : "lock"}>
              {folder.pub ? "공개 · 외부 뷰어 링크 열림" : "비공개 · 모임 멤버만"}
            </Badge>
          ) : null}
          <div className="end">
            {isRoot ? null : (
              <>
                <button
                  className={"btn btn-sm " + (folder?.pub ? "btn-ghost" : "btn-soft")}
                  disabled={pubMut.isPending || !folder}
                  onClick={() => (folder?.pub ? setAskPrivate(true) : pubMut.mutate(true))}
                >
                  <Icon name="share" size={14} />
                  {folder?.pub ? "비공개로 전환" : "공개로 전환"}
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    setDelError(null);
                    setDel({ stage: "ask", photoCount: 0 });
                  }}
                >
                  폴더 삭제
                </button>
              </>
            )}
          </div>
        </div>

        {isRoot ? (
          <p className="hint" style={{ marginBottom: 14 }}>
            최상위 폴더는 공개할 수 없습니다 — 모임의 사진 전부가 링크 하나로 나가기 때문입니다.
            공유할 하위 폴더를 만들어 그 폴더를 공개하세요.
          </p>
        ) : null}

        {/* ── 툴바 ── */}
        <div className="toolbar">
          <button className="btn btn-ghost" onClick={() => setNewOpen((v) => !v)}>
            <Icon name="folder" />새 폴더
          </button>
          <span className="sp" />
          <label
            htmlFor="photoSort"
            style={{ fontSize: 11.5, color: "var(--ink-2)", display: "flex", alignItems: "center", gap: 5 }}
          >
            <Icon name="sort" size={14} />
            정렬
          </label>
          <select
            id="photoSort"
            value={sort}
            onChange={(e) => setSort(e.target.value === "taken" ? "taken" : "up")}
          >
            <option value="up">업로드순</option>
            <option value="taken">촬영순</option>
          </select>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={uploadMut.isPending}>
            <Icon name="up" />
            {uploadMut.isPending ? "올리는 중…" : "사진 올리기"}
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,video/*"
            hidden
            onChange={(e) => {
              send(e.target.files);
              e.target.value = ""; // 같은 파일을 다시 골라도 change 가 뜨게 비운다
            }}
          />
        </div>

        {/* ── 새 폴더: 목록 위 인라인 입력. 폼 페이지를 따로 만들지 않는다 ── */}
        {newOpen ? (
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newName.trim();
              if (name) createMut.mutate(name);
            }}
          >
            <input
              autoFocus
              type="text"
              value={newName}
              maxLength={40}
              placeholder="폴더 이름"
              aria-label="새 폴더 이름"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setNewOpen(false);
              }}
              style={{
                padding: "9px 11px",
                border: "1px solid var(--line)",
                borderRadius: 9,
                flex: "0 1 240px",
              }}
            />
            <button className="btn" type="submit" disabled={createMut.isPending || !newName.trim()}>
              만들기
            </button>
            <button className="btn btn-quiet" type="button" onClick={() => setNewOpen(false)}>
              취소
            </button>
            <span className="hint">
              “{folder?.name ?? root.name}” 안에 만들어집니다. 깊이 제한은 없습니다.
            </span>
          </form>
        ) : null}

        {createMut.isError ? <ErrorBox error={createMut.error} /> : null}
        {pubMut.isError ? <ErrorBox error={pubMut.error} /> : null}
        {delError ? <ErrorBox error={new Error(delError)} /> : null}

        {/* ── 공개 링크 ── */}
        {folder?.pub && folder.shareUrl ? (
          <div className="linkbar">
            <div className="r1">
              <Icon name="share" size={15} />이 폴더의 뷰어 링크
              <code>{folder.shareUrl}</code>
              <button className="btn btn-ghost btn-sm" onClick={() => void copyShare()}>
                {copied ? "복사됨" : "링크 복사"}
              </button>
            </div>
            <div className="r2">
              이 링크로 들어온 사람은 <b>이 폴더의 사진·동영상만</b> 봅니다. 하위 폴더로 이동하거나
              업로드·삭제할 수 없습니다. <b>비공개로 되돌리면 그 링크는 즉시 죽고, 다시 공개하면 새
              주소가 발급됩니다</b> — 예전에 뿌린 링크는 되살아나지 않습니다.
            </div>
          </div>
        ) : null}

        {/* ── 업로드 영역 ── */}
        <div
          className="drop"
          style={dragging ? { borderColor: "var(--brand)", background: "var(--brand-soft)" } : undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            send(e.dataTransfer.files);
          }}
        >
          <span className="tile" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
            <Icon name="up" />
          </span>
          <b>사진·동영상을 여기에 끌어다 놓으세요</b>
          <p>
            지금 열어 둔 폴더로 올라갑니다. 앱이 촬영 시각으로 자동 분류해 다른 폴더로 옮기지
            않습니다.
          </p>
          <div className="pth" title="업로드 대상 폴더">
            {crumbs.map((c, i) =>
              i === crumbs.length - 1 ? <b key={c.id}>{c.name}</b> : <span key={c.id}>{c.name} / </span>,
            )}
          </div>
          {uploadMut.isPending ? (
            <p style={{ marginTop: 10, color: "var(--brand)", fontWeight: 600, fontSize: 12.5 }}>
              업로드 중… 창을 닫지 마세요
            </p>
          ) : null}
        </div>

        {uploadMut.isError ? <ErrorBox error={uploadMut.error} /> : null}

        {/* 일부만 실패했을 수 있다 — 전체 실패로 처리하지 않고 파일마다 이유를 적는다 */}
        {failed.length ? (
          <div className="tip warn" style={{ marginBottom: 16, display: "grid", gap: 4 }}>
            <b>올리지 못한 파일 {failed.length}개</b>
            {failed.map((f) => (
              <span key={f.name} className="mono" style={{ fontSize: 11 }}>
                {f.name} — {f.reason}
              </span>
            ))}
          </div>
        ) : null}

        {view.isError ? <ErrorBox error={view.error} /> : null}

        {/* ── 하위 폴더 카드 ── */}
        {view.data?.children.length ? (
          <>
            <div className="seclabel">폴더 {view.data.children.length}</div>
            <div className="folders">
              {view.data.children.map((k) => (
                <button key={k.id} className="fcard" onClick={() => openFolder(k.id)}>
                  <span
                    className="tile"
                    style={{
                      background: k.pub ? "var(--ok-bg)" : "var(--stay-bg)",
                      color: k.pub ? "var(--ok)" : "var(--stay)",
                    }}
                  >
                    <Icon name="folder" />
                  </span>
                  <span className="txt">
                    <b>{k.name}</b>
                    <small>{k.photoCount}개</small>
                  </span>
                  {k.pub ? (
                    <span style={{ marginLeft: "auto" }}>
                      <Badge tone="ok">공개</Badge>
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {/* ── 사진 그리드 ── */}
        <div className="seclabel">
          사진·동영상 {photos.length}
          <span className="sub">
            {sort === "up" ? "업로드순" : "촬영순"}
            {sort === "taken" && fallbackCount
              ? ` · 촬영 정보 없는 ${fallbackCount}개는 업로드 시각 기준`
              : ""}
          </span>
        </div>

        {photos.length ? (
          <div className="photos">
            {photos.map((p, i) => (
              <button
                key={p.id}
                style={TILE}
                onClick={() => {
                  setPhotoError(null);
                  setOpenIdx(i);
                }}
                title={p.name}
              >
                {isVideo(p) ? (
                  <>
                    <video
                      src={p.url}
                      preload="metadata"
                      muted
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                    {/* 동영상 표시 — 재생 아이콘 오버레이 */}
                    <span
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "grid",
                        placeItems: "center",
                        color: "#fff",
                      }}
                    >
                      <svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
                        <circle cx="24" cy="24" r="18" fill="rgba(19,23,32,.5)" />
                        <path d="M20 16l13 8-13 8z" fill="#fff" />
                      </svg>
                    </span>
                  </>
                ) : (
                  <img
                    src={p.url}
                    alt={p.name}
                    loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                )}
                <span className="nm">{p.name}</span>
                <span className="tm">{stamp(sort === "taken" ? p.takenAt : p.uploadedAt)}</span>
                {p.takenFallback ? (
                  <span className="noexif" title="촬영 정보 없음 · 업로드 시각 기준">
                    촬영 정보 없음
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <p className="empty">이 폴더에는 아직 미디어가 없습니다.</p>
        )}

        <p className="note">
          모임 멤버는 모든 폴더를 그대로 봅니다 — 폴더별 권한 설정이 없습니다. 폴더를 <b>공개</b>로
          바꾸면 그 폴더의 미디어만 보이는 뷰어 링크가 만들어집니다. 하위·다른 폴더로 이동할 수 없고,
          올리거나 지울 수도 없습니다. 외부로 나가는 것은 <b>미디어뿐</b>이며 문서는 공유되지 않습니다.
        </p>
      </div>

      {/* ── 라이트박스 ── */}
      {current ? (
        <Lightbox
          photo={current}
          index={openIdx ?? 0}
          count={photos.length}
          locked={askPhoto}
          busy={photoBusy}
          error={photoError}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onClose={() => setOpenIdx(null)}
          onAskDelete={() => setAskPhoto(true)}
        />
      ) : null}

      {/* ── 확인 모달들 (alert/confirm 을 쓰지 않는다) ── */}
      <ConfirmModal
        open={askPhoto}
        title="사진을 삭제할까요?"
        danger
        busy={photoBusy}
        confirmLabel="삭제"
        message={
          <>
            <b>{current?.name}</b> 을(를) 삭제합니다. 되돌릴 수 없습니다. 올린 사람 또는 방장만 삭제할
            수 있습니다.
          </>
        }
        onConfirm={() => void removePhoto()}
        onClose={() => setAskPhoto(false)}
      />

      <ConfirmModal
        open={askPrivate}
        title="비공개로 되돌릴까요?"
        danger
        busy={pubMut.isPending}
        confirmLabel="비공개로 전환"
        message={
          <>
            지금 뿌려 둔 뷰어 링크가 <b>즉시 죽습니다.</b> 나중에 다시 공개하면 <b>새 주소</b>가
            발급되므로 예전 링크는 되살아나지 않습니다.
          </>
        }
        onConfirm={() => pubMut.mutate(false)}
        onClose={() => setAskPrivate(false)}
      />

      <ConfirmModal
        open={!!del}
        title="폴더를 삭제할까요?"
        danger
        busy={delBusy}
        confirmLabel={del?.stage === "force" ? "사진까지 함께 삭제" : "삭제"}
        message={
          del?.stage === "force" ? (
            <>
              <b>“{folder?.name}”</b> 폴더와 그 하위의 <b>사진 {del.photoCount}장이 함께 삭제됩니다.</b>{" "}
              되돌릴 수 없습니다.
            </>
          ) : (
            <>
              <b>“{folder?.name}”</b> 폴더를 삭제합니다. 하위 폴더도 함께 사라집니다.
            </>
          )
        }
        onConfirm={() => void removeFolder(del?.stage === "force")}
        onClose={() => setDel(null)}
      />
    </div>
  );
}
