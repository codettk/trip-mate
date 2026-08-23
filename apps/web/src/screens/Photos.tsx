/**
 * ══════════ 사진 ══════════
 *
 * 사진 화면은 앨범 목록이 아니라 **폴더 탐색기**다 — 트리 + 브레드크럼 + 폴더 카드 + 그리드.
 * 폴더는 멤버가 자유롭게 만들고 중첩 깊이에 제한이 없다.
 *
 * ⚠ 공유는 TripMate 가 관리한다. Drive 공유 링크를 밖으로 내보내지 않는다.
 *   공유는 폴더가 아니라 **묶음**에 붙는다 — 링크 하나가 여러 폴더를 담을 수 있고 그 관리는
 *   전부 ShareModal 에서 한다. 이 화면은 `sharedIn` 으로 "공유 중"만 표시한다.
 *   이미지는 전부 `/api/media/:id` 로 나간다. Drive 링크·서명 URL 은 어디에도 그리지 않는다.
 *
 * 만들고 고치는 일은 화면을 갈아타지 않는다 — 새 폴더는 목록 위 인라인 입력,
 * 사진 보기·삭제·삭제 확인은 전부 모달이다. alert/confirm/prompt 를 쓰지 않는다.
 */

import { canMoveFolder } from "@tripmate/core";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api/client.ts";
import { useApiMutation, useFolder, useFolders, useInvalidateGroup } from "../api/hooks.ts";
import type { FolderNodeDto, Photo } from "../api/types.ts";
import { Badge, ErrorBox, Field } from "../components/Bits.tsx";
import { Icon } from "../components/Icon.tsx";
import { ConfirmModal, Modal } from "../components/Modal.tsx";
import { FolderTree, pathTo } from "./photos/FolderTree.tsx";
import { Lightbox, isVideo, stamp } from "./photos/Lightbox.tsx";
import { PhotoEditModal } from "./photos/PhotoEditModal.tsx";
import { ShareModal } from "./photos/ShareModal.tsx";

type Sort = "up" | "taken";

/**
 * 업로드 한 건의 상태. **퍼센트는 브라우저 → 서버 구간까지다.**
 * 그 뒤 서버가 Drive 로 다시 올리는 동안은 "저장 중"으로 따로 말한다 —
 * 100% 를 완료라고 쓰면 마지막 몇 초가 멈춘 것처럼 보인다.
 */
type UpState = "wait" | "send" | "store" | "done" | "fail";

interface UpJob {
  key: string;
  name: string;
  size: number;
  /** 서버까지 보낸 바이트. 실패해도 되돌리지 않는다 — 전체 막대가 뒤로 가면 안 된다 */
  sent: number;
  state: UpState;
  reason?: string;
}

const UP_LABEL: Record<UpState, string> = {
  wait: "대기",
  send: "보내는 중",
  store: "저장 중",
  done: "완료",
  fail: "실패",
};

/** 동시에 보내는 개수. 무료 서버라 더 늘리면 서로 느려지기만 한다. */
const UP_AT_ONCE = 2;

/** 파일 크기. 소수점 한 자리까지만 — 진행 표시는 정확도보다 읽히는 게 먼저다. */
function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** 진행률(%). 크기를 모르는 파일은 끝난 것만 100 으로 본다. */
function upPct(j: UpJob): number {
  if (j.state === "done" || j.state === "store") return 100;
  if (!j.size) return j.state === "fail" ? 100 : 0;
  return Math.min(100, Math.floor((j.sent / j.size) * 100));
}

/** 업로드 응답. 일부만 실패할 수 있으므로 전체 실패로 처리하지 않는다. */
interface UploadResult {
  uploaded: Photo[];
  failed: Array<{ name: string; reason: string }>;
}

/**
 * 다중 이동 응답. 부분 실패를 통째 실패로 만들지 않는다 — 업로드 응답과 같은 모양이다.
 * 이미 그 폴더에 있는 사진은 moved 에도 failed 에도 들어가지 않는다.
 */
interface MoveResult {
  moved: Photo[];
  failed: Array<{ id: string; name: string | null; reason: string }>;
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
  // 이 폴더를 담고 있는 묶음이 하나라도 있으면 지금 밖으로 나가는 중이다.
  // 폴더 상세가 오기 전에는 false 로 두지 말고 folder 자체를 조건에 쓴다 —
  // 공개 여부는 잘못 보여주면 안 되는 값이라 깜빡이게 두지 않는다.
  const shared = !!folder && folder.sharedIn.length > 0;

  // 폴더 선택 셀렉트용 평평한 목록. 깊이 제한이 없으므로 들여쓰기로 계층을 보인다.
  const allFolders = useMemo(() => {
    const out: Array<{ id: string; name: string; depth: number; parentId: string | null }> = [];
    const walk = (n: FolderNodeDto, depth: number) => {
      out.push({ id: n.id, name: n.name, depth, parentId: n.parentId });
      for (const c of n.children) walk(c, depth + 1);
    };
    if (root) walk(root, 0);
    return out;
  }, [root]);
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
  // **파일 하나에 요청 하나다.** 전부를 한 요청에 담으면 진행률이 "전체 몇 %" 하나뿐이라
  // 어느 파일이 올라가는 중인지 말할 수 없고, 큰 파일 하나가 413 이면 그 뒤 파일까지 같이 날아간다.
  // 서버 라우트는 그대로다 — 여러 개도 받고 한 개도 받는다.
  const fileRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<UpJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const send = async (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (!files.length || !currentId || busy) return;

    const stamp = String(Date.now());
    const queued: UpJob[] = files.map((f, i) => ({
      key: `${stamp}-${i}`,
      name: f.name,
      size: f.size,
      sent: 0,
      state: "wait",
    }));
    setJobs(queued);
    setBusy(true);

    const patchJob = (key: string, up: Partial<UpJob>) =>
      setJobs((cur) => cur.map((j) => (j.key === key ? { ...j, ...up } : j)));

    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        const file = files[i];
        const job = queued[i];
        if (!file || !job) return;

        const form = new FormData();
        // 업로드 대상은 지금 열어 둔 폴더다. 앱이 촬영 시각 등으로 자동 분류해 옮기지 않는다.
        form.append("files", file, file.name);
        patchJob(job.key, { state: "send" });

        try {
          const r = await api.upload<UploadResult>(
            `/api/groups/${gid}/folders/${currentId}/photos`,
            form,
            ({ loaded, total }) => {
              // total 에는 multipart 경계까지 들어 있어 파일 크기와 다르다 — 비율로 환산한다
              if (!total) return;
              patchJob(job.key, {
                sent: Math.round((loaded / total) * file.size),
                state: loaded >= total ? "store" : "send",
              });
            },
          );
          // 파일 하나짜리 요청이므로 failed 에 들어 있으면 그 파일이 거부된 것이다
          const bad = r.failed[0];
          patchJob(
            job.key,
            bad ? { state: "fail", reason: bad.reason } : { state: "done", sent: file.size },
          );
        } catch (e) {
          patchJob(job.key, {
            state: "fail",
            reason: e instanceof ApiError ? e.message : "올리지 못했습니다",
          });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(UP_AT_ONCE, files.length) }, worker));
    setBusy(false);
    invalidate(); // 파일마다 무효화하면 업로드 내내 목록이 다시 그려진다 — 끝나고 한 번만
  };

  const upTotal = jobs.reduce((a, j) => a + j.size, 0);
  const upSent = jobs.reduce((a, j) => a + j.sent, 0);
  const upDone = jobs.filter((j) => j.state === "done").length;
  const upFail = jobs.filter((j) => j.state === "fail").length;
  const upAll = upTotal ? Math.floor((upSent / upTotal) * 100) : 0;

  // ── 공유 묶음 ────────────────────────────────────────────────────
  // 공유는 이 화면에서 켜고 끄지 않는다. 묶음 단위라 폴더 하나의 토글로 표현할 수 없다.
  // 버튼은 입구일 뿐이고 실제 편집은 ShareModal 이 한다.
  const [shareOpen, setShareOpen] = useState(false);

  // ── 사진 고르기 · 옮기기 ────────────────────────────────────────
  // 폴더를 옮기는 일은 실제로 자주 생긴다 (여행 중엔 아무 폴더에나 올리고 나중에 정리한다).
  // 고르기 모드를 따로 두는 이유는, 타일을 그냥 누르면 크게 보기가 되어야 하기 때문이다.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [moveTo, setMoveTo] = useState<string>("");
  const [moveFailed, setMoveFailed] = useState<Array<{ name: string | null; reason: string }>>([]);

  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const stopPicking = () => {
    setPicking(false);
    setPicked(new Set());
    setMoveFailed([]);
  };

  const moveMut = useApiMutation<{ ids: string[]; folderId: string }, MoveResult>(
    (body) => api.post<MoveResult>(`/api/groups/${gid}/photos/move`, body),
    gid,
    (d) => {
      // 한 장이 막혀도 나머지는 옮긴다. 왜 막혔는지 그대로 보여준다 —
      // 부분 실패를 통째 실패로 만들면 사용자가 뭐가 됐는지 알 수 없다.
      setMoveFailed(d.failed.map((f) => ({ name: f.name, reason: f.reason })));
      setPicked(new Set());
      if (!d.failed.length) setPicking(false);
    },
  );

  // ── 사진 하나 고치기 (이름 · 촬영 시각) ─────────────────────────
  const [editing, setEditing] = useState<Photo | null>(null);

  // ── 폴더 옮기기 ─────────────────────────────────────────────────
  const [folderMove, setFolderMove] = useState(false);

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
            <Badge tone={shared ? "ok" : "mute"} icon={shared ? "share" : "lock"}>
              {shared
                ? `공유 중 · 묶음 ${folder.sharedIn.length}개`
                : "비공개 · 모임 멤버만"}
            </Badge>
          ) : null}
          <div className="end">
            {/* 루트도 묶음에 담을 수 있다 — 공유 버튼은 어느 폴더에서나 보인다 */}
            <button
              className={"btn btn-sm " + (shared ? "btn-ghost" : "btn-soft")}
              disabled={!folder}
              onClick={() => setShareOpen(true)}
            >
              <Icon name="share" size={14} />
              {shared ? "공유 관리" : "공유"}
            </button>
            {isRoot ? null : (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => setFolderMove(true)}>
                  <Icon name="folder" size={14} />
                  폴더 옮기기
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
            최상위 폴더는 이름이 여행 모임 제목이고 지울 수 없습니다. 공유할 때는 어느 폴더까지
            내보낼지 <b>공유</b> 에서 골라 담습니다 — 최상위를 담으면 모임의 사진 전부가 나갑니다.
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
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Icon name="up" />
            {busy ? `올리는 중 ${upDone} / ${jobs.length}` : "사진 올리기"}
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,video/*"
            hidden
            onChange={(e) => {
              void send(e.target.files);
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
        {delError ? <ErrorBox error={new Error(delError)} /> : null}

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
            void send(e.dataTransfer.files);
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
          {busy ? (
            <p style={{ marginTop: 10, color: "var(--brand)", fontWeight: 600, fontSize: 12.5 }}>
              업로드 중… 창을 닫지 마세요
            </p>
          ) : null}
        </div>

        {/*
          업로드 진행. 파일마다 한 줄, 전체는 맨 위 한 줄이다.
          일부만 실패할 수 있으므로 전체 실패로 처리하지 않고 그 파일 줄에 이유를 적는다.
        */}
        {jobs.length ? (
          <div className="uplist" aria-label="업로드 진행">
            <div className="hd">
              <b>
                {busy ? "올리는 중" : upFail ? "일부만 올라갔습니다" : "업로드 완료"} {upDone} /{" "}
                {jobs.length}
              </b>
              {upFail ? <span className="badge warn">실패 {upFail}</span> : null}
              <span className="sp" />
              <span className="pc">{upAll}%</span>
            </div>
            <div
              className="prog"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={upAll}
              aria-label={`전체 ${jobs.length}개 중 ${upDone}개 완료`}
            >
              <i
                className={upFail && !busy ? "bad" : busy ? "on" : ""}
                style={{ width: `${upAll}%` }}
              />
            </div>

            {jobs.map((j) => (
              <div className="uprow" key={j.key}>
                <span className="nm" title={j.name}>
                  {j.name}
                </span>
                <span className={"st " + j.state}>
                  {j.state === "send" ? `${upPct(j)}%` : UP_LABEL[j.state]}
                  <small>{fileSize(j.size)}</small>
                </span>
                <div className="prog">
                  <i
                    className={j.state === "fail" ? "bad" : j.state === "done" ? "" : "on"}
                    style={{ width: `${upPct(j)}%` }}
                  />
                </div>
                {j.reason ? <span className="rs">{j.reason}</span> : null}
              </div>
            ))}

            <p className="hint">
              퍼센트는 <b>서버까지 보낸 양</b>입니다. 100% 뒤에는 서버가 Google Drive 에 저장하는
              시간이 조금 더 걸립니다.
            </p>
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
                      background: k.sharedIn.length ? "var(--ok-bg)" : "var(--stay-bg)",
                      color: k.sharedIn.length ? "var(--ok)" : "var(--stay)",
                    }}
                  >
                    <Icon name="folder" />
                  </span>
                  <span className="txt">
                    <b>{k.name}</b>
                    <small>{k.photoCount}개</small>
                  </span>
                  {k.sharedIn.length ? (
                    <span style={{ marginLeft: "auto" }}>
                      <Badge tone="ok">공유 중</Badge>
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
          {photos.length ? (
            <span className="end">
              <button className="btn btn-ghost btn-sm" onClick={() => (picking ? stopPicking() : setPicking(true))}>
                <Icon name={picking ? "x" : "check"} size={14} />
                {picking ? "고르기 끝" : "골라서 옮기기"}
              </button>
            </span>
          ) : null}
        </div>

        {/* 고른 사진을 어느 폴더로 보낼지. 대상은 이 모임의 폴더 전부다 */}
        {picking ? (
          <div className="tip" style={{ marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Icon name="folder" />
            <span>
              <b>{picked.size}장</b> 골랐습니다. 옮길 폴더를 고르세요.
            </span>
            <span className="chips" style={{ marginLeft: "auto" }}>
              <select
                aria-label="옮길 폴더"
                value={moveTo}
                onChange={(e) => setMoveTo(e.target.value)}
              >
                <option value="">폴더 선택…</option>
                {allFolders
                  .filter((f) => f.id !== currentId)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {"　".repeat(f.depth) + f.name}
                    </option>
                  ))}
              </select>
              <button
                className="btn btn-sm"
                disabled={!picked.size || !moveTo || moveMut.isPending}
                onClick={() => moveMut.mutate({ ids: [...picked], folderId: moveTo })}
              >
                {moveMut.isPending ? "옮기는 중…" : "여기로 옮기기"}
              </button>
            </span>
          </div>
        ) : null}

        {moveFailed.length ? (
          <div className="tip warn" style={{ marginBottom: 12 }}>
            <Icon name="lock" />
            <span>
              {moveFailed.map((f, i) => (
                <span key={i} style={{ display: "block" }}>
                  {f.name ?? "사진"} — {f.reason}
                </span>
              ))}
            </span>
          </div>
        ) : null}

        {photos.length ? (
          <div className="photos">
            {photos.map((p, i) => (
              <button
                key={p.id}
                style={TILE}
                // 고르기 모드가 아니면 타일을 누르면 크게 보기다. 두 동작을 섞지 않는다.
                onClick={() => {
                  if (picking) {
                    togglePick(p.id);
                    return;
                  }
                  setPhotoError(null);
                  setOpenIdx(i);
                }}
                aria-pressed={picking ? picked.has(p.id) : undefined}
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
                {picking ? (
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "grid",
                      placeItems: "center",
                      background: picked.has(p.id) ? "rgba(47,83,224,.35)" : "rgba(19,23,32,.12)",
                      color: "#fff",
                    }}
                  >
                    {picked.has(p.id) ? <Icon name="check" size={26} /> : null}
                  </span>
                ) : null}
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
          모임 멤버는 모든 폴더를 그대로 봅니다 — 폴더별 권한 설정이 없습니다.
          밖으로 내보낼 때는 <b>공유</b>에서 어느 폴더까지 담을지 골라 <b>묶음</b>을 만듭니다.
          링크를 받은 사람은 <b>담긴 폴더의 미디어만</b> 보고 그 밖으로 나갈 수 없으며, 올리거나 지울 수도 없습니다.
          외부로 나가는 것은 <b>미디어뿐</b>이며 문서·정산·일정은 공유되지 않습니다.
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
          onEdit={() => {
            setEditing(current);
            setOpenIdx(null);
          }}
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

      <PhotoEditModal
        photo={editing}
        gid={gid}
        folders={allFolders}
        onClose={() => setEditing(null)}
      />

      <FolderMoveModal
        open={folderMove}
        onClose={() => setFolderMove(false)}
        gid={gid}
        folderId={currentId}
        folderName={folder?.name ?? ""}
        folders={allFolders}
      />

      {/* 공유 묶음 관리. 지금 열어 둔 폴더를 미리 골라 둔 채로 연다 */}
      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        gid={gid}
        root={root}
        seedFolderId={currentId}
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

/**
 * 폴더를 다른 폴더 밑으로 옮긴다.
 *
 * 자기 자신이나 자기 자손 밑으로 넣으면 트리가 고리가 되어 탐색이 끝나지 않는다.
 * 그 검사는 core 의 `canMoveFolder` 한 벌이고 서버도 같은 함수를 쓴다 —
 * 저장 버튼을 눌러 400 을 받기 전에 이유를 먼저 보여 준다.
 */
function FolderMoveModal({
  open,
  onClose,
  gid,
  folderId,
  folderName,
  folders,
}: {
  open: boolean;
  onClose: () => void;
  gid: string;
  folderId: string | undefined;
  folderName: string;
  folders: Array<{ id: string; name: string; depth: number; parentId: string | null }>;
}) {
  const [target, setTarget] = useState("");

  useEffect(() => {
    if (open) setTarget("");
  }, [open]);

  const move = useApiMutation<string, unknown>(
    (parentId) => api.patch(`/api/groups/${gid}/folders/${folderId}`, { parentId }),
    gid,
    onClose,
  );

  const check =
    folderId && target
      ? canMoveFolder(folderId, target, folders.map((f) => ({ id: f.id, parentId: f.parentId })))
      : null;

  return (
    <Modal open={open} title="폴더 옮기기" onClose={onClose} icon="folder">
      <p className="hint">
        <b>“{folderName}”</b> 을 어느 폴더 밑으로 옮길까요? 하위 폴더도 통째로 따라갑니다.
      </p>

      <Field label="옮길 위치" htmlFor="fmTarget">
        <select id="fmTarget" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">폴더 선택…</option>
          {folders
            .filter((f) => f.id !== folderId)
            .map((f) => (
              <option key={f.id} value={f.id}>
                {"　".repeat(f.depth) + f.name}
              </option>
            ))}
        </select>
      </Field>

      {check && !check.ok ? (
        <div className="tip warn">
          <Icon name="lock" />
          <span>{check.reason}</span>
        </div>
      ) : null}

      <div className="tip">
        <Icon name="bulb" />
        <span>
          옮긴 위치가 <b>하위 전부</b>로 공유된 폴더 아래라면 이 폴더의 사진도 함께 밖으로 나갑니다.
        </span>
      </div>

      {move.isError ? <ErrorBox error={move.error} /> : null}

      <div className="chips" style={{ marginTop: 14, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onClose}>
          취소
        </button>
        <button
          className="btn"
          disabled={!target || !check?.ok || move.isPending}
          onClick={() => move.mutate(target)}
        >
          {move.isPending ? "옮기는 중…" : "옮기기"}
        </button>
      </div>
    </Modal>
  );
}
