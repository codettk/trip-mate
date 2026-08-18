/**
 * 문서.
 *
 * 문서는 **모임 멤버 전용**이다. 외부 공개 토글도, 공유 링크도, "링크 복사" 버튼도 없다 —
 * 밖으로 나가는 것은 미디어(사진·동영상)뿐이고 유일한 예외가 정산 공유 링크다.
 * 그래서 이 파일에는 pub / token / share 라는 개념이 아예 등장하지 않는다.
 *
 * 문서는 **일차에 묶이지 않는다.** 자유 문서에 블록을 얹는 구조라 일차별 그룹핑을 하지 않는다.
 *
 * UX 원칙: 새 페이지로 보내지 않는다.
 *  · 새 문서는 목록 위 **인라인 입력**이다. 폼 페이지도 모달도 만들지 않는다.
 *  · 제목은 클릭하면 그 자리에서 input 이 된다.
 *  · 확인이 필요한 삭제만 ConfirmModal 을 쓴다 (브라우저 confirm 은 쓰지 않는다).
 */

import { BLOCK_KINDS, BLOCK_LABEL, type BlockKind } from "@tripmate/core";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api/client.ts";
import { keys, useDoc, useDocs, useSettlement } from "../api/hooks.ts";
import type { DocBlock, DocDetail, DocSummary } from "../api/types.ts";
import { Badge, Empty, ErrorBox, Won } from "../components/Bits.tsx";
import { Icon } from "../components/Icon.tsx";
import { ConfirmModal } from "../components/Modal.tsx";

/** 블록 종류별 아이콘. 색 역할을 섞지 않으려고 타일 색은 쓰지 않고 아이콘만 쓴다. */
const KIND_ICON: Record<BlockKind, string> = {
  timetable: "clock",
  map: "pin",
  stay: "bed",
  settle: "won",
  memo: "doc",
};

const pad = (n: number): string => String(n).padStart(2, "0");

/** "2026.08.17 14:30". 무엇이 최신인지는 절대 시각이 답한다 — 상대 시간만 두면 값이 흔들려 헷갈린다. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * "방금 전" / "3분 전". 절대 시각과 **나란히** 쓴다.
 * "저장이 됐나?"는 상대 시간이 답하고, "무엇이 최신인가"는 위의 절대 시각이 답한다.
 */
function ago(at: number, now: number): string {
  if (!Number.isFinite(at)) return ""; // 서버 값이 이상해도 "NaN분 전"을 보여 주지 않는다
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 45) return "방금 전";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

/** 30초마다 다시 그린다 — "방금 전"이 한 시간째 "방금 전"으로 남아 있으면 거짓말이 된다. */
function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/* ══════════ content 파싱 ══════════
   content 는 jsonb 라 서버가 모양을 보장하지 않는다.
   화면이 깨지면 문서를 통째로 못 여는 셈이므로 전부 방어적으로 읽는다. */

const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
const asNum = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const cells = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

interface TimeRow {
  t: string;
  c: string;
  n: string;
}
const readTimetable = (content: Record<string, unknown>): TimeRow[] =>
  cells(content.rows).map((r) => {
    const a = cells(r);
    return { t: asStr(a[0]), c: asStr(a[1]), n: asStr(a[2]) };
  });
const writeTimetable = (rows: TimeRow[]): Record<string, unknown> => ({
  rows: rows.map((r) => [r.t, r.c, r.n]),
});

interface StayRow {
  name: string;
  period: string;
  cost: number;
}
const readStay = (content: Record<string, unknown>): StayRow[] =>
  cells(content.rows).map((r) => {
    const a = cells(r);
    return { name: asStr(a[0]), period: asStr(a[1]), cost: asNum(a[2]) };
  });
const writeStay = (rows: StayRow[]): Record<string, unknown> => ({
  rows: rows.map((r) => [r.name, r.period, r.cost]),
});

interface Pin {
  name: string;
  x: number;
  y: number;
}
const readPins = (content: Record<string, unknown>): Pin[] =>
  cells(content.pins).map((p) => {
    const a = cells(p);
    return { name: asStr(a[0]), x: asNum(a[1]), y: asNum(a[2]) };
  });
const writePins = (pins: Pin[]): Record<string, unknown> => ({
  pins: pins.map((p) => [p.name, p.x, p.y]),
});

/* ══════════ 저장 ══════════ */

/** 문서 헤더가 보여 주는 저장 상태. 조용히 있으면 "저장이 안 된다"고 오해한다. */
type SaveState =
  | { kind: "idle" }
  | { kind: "pending" } // 디바운스 대기 중 — 아직 서버로 안 나갔다
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error" };

/**
 * 블록들의 flush 를 모아 두는 통로.
 *
 * 자동 저장은 **걷어내지 않는다** — 작성 중 이탈에 내용이 날아가기 때문이다.
 * 대신 헤더의 "저장" 버튼이 이 통로로 대기 중인 디바운스를 전부 즉시 밀어 넣는다.
 * 누를 곳이 있어야 사람이 안심한다.
 */
interface SaveBus {
  /** 블록이 자기 flush 를 등록한다. 반환값은 해제 함수다. */
  register: (flush: () => void) => () => void;
  /** 아직 서버로 안 나간 편집이 생겼다는 신호 */
  pending: () => void;
}

const SaveBusCtx = createContext<SaveBus | null>(null);

/**
 * 타이핑마다 저장하면 글자 수만큼 요청이 나간다.
 * 600ms 디바운스로 모으고, 포커스를 잃는 순간(blur)과 언마운트에는 즉시 밀어 넣는다 —
 * 마지막 타이핑이 저장되지 않은 채 화면을 떠나는 게 제일 나쁘다.
 */
function useDebouncedSave(save: (content: Record<string, unknown>) => void) {
  const timer = useRef<number | null>(null);
  const pending = useRef<Record<string, unknown> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const bus = useContext(SaveBusCtx);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const c = pending.current;
    pending.current = null;
    if (c) saveRef.current(c);
  }, []);

  const schedule = useCallback(
    (content: Record<string, unknown>) => {
      pending.current = content;
      bus?.pending(); // 헤더에 "저장 대기 중"을 띄운다 — 타이핑이 허공에 뜬 것처럼 보이면 안 된다
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 600);
    },
    [flush, bus],
  );

  // 헤더의 "저장" 버튼이 이 블록의 대기분도 밀어 넣을 수 있게 등록해 둔다
  useEffect(() => {
    if (!bus) return;
    return bus.register(flush);
  }, [bus, flush]);

  // 화면을 떠날 때 남은 초안을 흘리지 않는다
  useEffect(() => () => flush(), [flush]);

  return { schedule, flush };
}

/** 저장 상태 표시. 색 역할: 초록=완료, 노랑=아직 안 끝난 것. */
function SaveBadge({ state, now }: { state: SaveState; now: number }) {
  switch (state.kind) {
    case "pending":
      return <Badge tone="warn">저장 대기 중…</Badge>;
    case "saving":
      return <Badge tone="mute">저장 중…</Badge>;
    case "saved":
      return (
        <Badge tone="ok" icon="check">
          저장됨 · {ago(state.at, now)}
        </Badge>
      );
    case "error":
      // app.css 에 `.badge.danger` 가 없고 여기서 스타일을 늘리지 않기로 해서 색만 인라인으로 준다
      return (
        <span className="badge" style={{ background: "#FFF1F3", color: "var(--danger)" }}>
          <Icon name="x" size={12} />
          저장 실패
        </span>
      );
    case "idle":
      return (
        <Badge tone="mute" icon="check">
          모든 변경이 저장됨
        </Badge>
      );
  }
}

/* ══════════ 화면 ══════════ */

export function DocsScreen() {
  const { gid, did } = useParams<{ gid: string; did?: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const list = useDocs(gid);

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [delDoc, setDelDoc] = useState<DocSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refreshList = useCallback(() => {
    if (gid) void qc.invalidateQueries({ queryKey: keys.docs(gid) });
  }, [qc, gid]);

  if (!gid) return null;

  const docs = list.data?.docs ?? [];
  const current = docs.find((d) => d.id === did) ?? null;

  const create = () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr(null);
    api
      .post<DocDetail>(`/api/groups/${gid}/docs`, { title: t })
      .then((r) => {
        setTitle("");
        setAdding(false);
        refreshList();
        // 만든 문서를 바로 펼친다. 목록으로 돌아갔다가 다시 찾아 누르게 하지 않는다.
        nav(`/g/${gid}/docs/${r.doc.id}`);
      })
      .catch((e: unknown) => setErr(e))
      .finally(() => setBusy(false));
  };

  const removeDoc = () => {
    if (!delDoc) return;
    setDeleting(true);
    api
      .del(`/api/groups/${gid}/docs/${delDoc.id}`)
      .then(() => {
        const gone = delDoc.id;
        setDelDoc(null);
        refreshList();
        if (did === gone) nav(`/g/${gid}/docs`, { replace: true });
      })
      .catch((e: unknown) => setErr(e))
      .finally(() => setDeleting(false));
  };

  return (
    <div className="explorer">
      <aside className="tree">
        <div className="card" style={{ padding: 12 }}>
          <div className="card-h" style={{ marginBottom: 10, padding: "0 4px" }}>
            <h3>문서</h3>
            <span className="cnt">{docs.length}</span>
          </div>

          {/* 새 문서는 목록 위 인라인 입력이다 — 폼 페이지도 모달도 만들지 않는다 */}
          {adding ? (
            <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
              <input
                type="text"
                autoFocus
                value={title}
                placeholder="문서 제목"
                maxLength={80}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") create();
                  if (e.key === "Escape") {
                    setAdding(false);
                    setTitle("");
                  }
                }}
                style={{
                  padding: "8px 10px",
                  border: "1px solid var(--brand)",
                  borderRadius: "var(--r-sm)",
                  fontSize: 13,
                  width: "100%",
                }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-sm" onClick={create} disabled={busy || !title.trim()}>
                  {busy ? "만드는 중…" : "만들기"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setAdding(false);
                    setTitle("");
                  }}
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn-soft btn-sm btn-block"
              style={{ marginBottom: 8 }}
              onClick={() => setAdding(true)}
            >
              <Icon name="plus" />새 문서
            </button>
          )}

          {list.isLoading ? (
            <p className="empty" style={{ padding: "8px 4px" }}>
              불러오는 중…
            </p>
          ) : docs.length === 0 ? (
            <p className="empty" style={{ padding: "8px 4px" }}>
              아직 문서가 없습니다.
            </p>
          ) : (
            <ul>
              {docs.map((d) => (
                <li key={d.id}>
                  <button
                    className="tnode"
                    aria-current={d.id === did}
                    onClick={() => nav(`/g/${gid}/docs/${d.id}`)}
                  >
                    <Icon name="doc" size={15} />
                    <span className="nm">{d.title}</span>
                    <span className="ct">{d.blockCount}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="hint" style={{ marginTop: 12, padding: "0 4px" }}>
            문서는 일차에 묶이지 않습니다. 모임 멤버만 볼 수 있고 밖으로 공유되지 않습니다.
          </p>
        </div>
      </aside>

      <section style={{ minWidth: 0 }}>
        {err ? (
          <div style={{ marginBottom: 14 }}>
            <ErrorBox error={err} />
          </div>
        ) : null}

        {list.error ? (
          <ErrorBox error={list.error} />
        ) : did ? (
          <DocDetailView
            gid={gid}
            did={did}
            onAskDelete={() => setDelDoc(current)}
            onTouched={refreshList}
          />
        ) : (
          <Empty
            title="문서를 고르세요"
            hint="계획서·시간표·지도·숙소 후보·정산 초안을 자유롭게 만들 수 있습니다. 문서는 모임 안에서만 보입니다."
            action={
              <button className="btn" onClick={() => setAdding(true)}>
                <Icon name="plus" />새 문서
              </button>
            }
          />
        )}
      </section>

      <ConfirmModal
        open={!!delDoc}
        title="문서 삭제"
        message={
          <>
            <b>{delDoc?.title}</b> 문서를 삭제합니다. 문서 안의 블록도 함께 사라지며 되돌릴 수
            없습니다.
          </>
        }
        confirmLabel="삭제"
        danger
        busy={deleting}
        onConfirm={removeDoc}
        onClose={() => setDelDoc(null)}
      />
    </div>
  );
}

/* ══════════ 문서 본문 ══════════ */

function DocDetailView({
  gid,
  did,
  onAskDelete,
  onTouched,
}: {
  gid: string;
  did: string;
  onAskDelete: () => void;
  onTouched: () => void;
}) {
  const qc = useQueryClient();
  const q = useDoc(gid, did);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [conflict, setConflict] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [delBlock, setDelBlock] = useState<DocBlock | null>(null);
  const [busyBlock, setBusyBlock] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const now = useNow();

  // 블록들이 등록한 flush. 헤더의 "저장" 버튼이 한 번에 밀어 넣는다.
  const flushes = useRef(new Set<() => void>());
  const bus = useMemo<SaveBus>(
    () => ({
      register: (fn) => {
        flushes.current.add(fn);
        return () => {
          flushes.current.delete(fn);
        };
      },
      pending: () => setSaveState({ kind: "pending" }),
    }),
    [],
  );

  // 문서가 바뀌면 앞 문서의 저장 상태를 물고 오지 않는다
  useEffect(() => setSaveState({ kind: "idle" }), [did]);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: keys.doc(gid, did) });
    onTouched();
  }, [qc, gid, did, onTouched]);

  /**
   * 서버로 나가는 모든 변경이 같은 표시를 쓴다 — 무엇을 고쳤든 사람이 궁금한 건 "저장됐나" 하나다.
   * (에러는 다시 던져서 기존 catch 들이 그대로 처리하게 둔다.)
   */
  const track = useCallback(<T,>(p: Promise<T>): Promise<T> => {
    setSaveState({ kind: "saving" });
    return p.then(
      (r) => {
        setSaveState({ kind: "saved", at: Date.now() });
        return r;
      },
      (e: unknown) => {
        setSaveState({ kind: "error" });
        throw e;
      },
    );
  }, []);

  const status = q.error instanceof ApiError ? q.error.status : 0;
  if (status === 404) {
    return <Empty title="문서를 찾을 수 없습니다" hint="이미 삭제되었을 수 있습니다." />;
  }
  if (q.isLoading) return <p className="empty">불러오는 중…</p>;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return null;

  const { doc, blocks } = q.data;

  const saveTitle = () => {
    const t = draft.trim();
    setEditing(false);
    if (!t || t === doc.title) return;
    setErr(null);
    track(api.patch(`/api/groups/${gid}/docs/${did}`, { title: t, version: doc.version }))
      .then(() => {
        setConflict(false);
        refresh();
      })
      .catch((e: unknown) => {
        // 낙관적 잠금 충돌. 서버가 현재 문서를 detail 에 담아 주므로 그걸 그대로 화면에 얹는다 —
        // 조용히 덮어쓰면 남이 방금 쓴 제목이 사라진다.
        if (e instanceof ApiError && e.status === 409) {
          const latest = e.detail as Partial<DocDetail> | undefined;
          if (latest?.doc && Array.isArray(latest.blocks)) {
            qc.setQueryData(keys.doc(gid, did), latest as DocDetail);
          } else {
            refresh();
          }
          setConflict(true);
          // 서버가 거절한 게 아니라 "남이 먼저 저장했다"는 뜻이다. 저장 실패로 겁주지 않고 안내로 넘긴다.
          setSaveState({ kind: "idle" });
          return;
        }
        setErr(e);
      });
  };

  const addBlock = (kind: BlockKind) => {
    setErr(null);
    track(api.post(`/api/groups/${gid}/docs/${did}/blocks`, { kind }))
      .then(refresh)
      .catch((e: unknown) => setErr(e));
  };

  // 서버가 position 을 0,1,2… 로 다시 매겨 주므로 화면의 인덱스가 곧 position 이다
  const move = (b: DocBlock, from: number, delta: number) => {
    const at = from + delta;
    if (at < 0 || at >= blocks.length) return;
    setErr(null);
    track(api.patch(`/api/groups/${gid}/docs/${did}/blocks/${b.id}`, { position: at }))
      .then(refresh)
      .catch((e: unknown) => setErr(e));
  };

  const removeBlock = () => {
    if (!delBlock) return;
    setBusyBlock(true);
    track(api.del(`/api/groups/${gid}/docs/${did}/blocks/${delBlock.id}`))
      .then(() => {
        setDelBlock(null);
        refresh();
      })
      .catch((e: unknown) => setErr(e))
      .finally(() => setBusyBlock(false));
  };

  const saveContent = (bid: string, content: Record<string, unknown>) => {
    setErr(null);
    track(api.patch(`/api/groups/${gid}/docs/${did}/blocks/${bid}`, { content }))
      .then(refresh)
      .catch((e: unknown) => setErr(e));
  };

  /**
   * 헤더의 "저장" 버튼.
   * 대기 중인 디바운스를 전부 즉시 밀어 넣는다. 밀어 넣을 게 없으면 서버 상태를 다시 받아
   * "저장됨"을 확인시켜 준다 — 아무 반응도 없으면 눌렀는지조차 알 수 없다.
   */
  const saveNow = () => {
    const waiting = saveState.kind === "pending";
    for (const f of [...flushes.current]) f();
    if (!waiting) {
      setSaveState({ kind: "saved", at: Date.now() });
      refresh();
    }
  };

  return (
    <SaveBusCtx.Provider value={bus}>
      <div className="doc">
        <div className="docbar">
          {/* 문서에는 외부 공유 버튼이 없다. 자물쇠 배지로 "여기까지가 모임 안"임을 분명히 한다. */}
          <Badge tone="mute" icon="lock">
            모임 멤버 전용
          </Badge>
          {/* 자동 저장은 그대로 두되 상태를 드러낸다 — 조용하면 "저장이 안 된다"고 오해한다 */}
          <SaveBadge state={saveState} now={now} />
          <button
            className="btn btn-sm"
            style={{ marginLeft: "auto" }}
            onClick={saveNow}
            disabled={saveState.kind === "saving"}
          >
            {saveState.kind === "saving" ? "저장 중…" : "저장"}
          </button>
          <button className="btn btn-danger btn-sm" onClick={onAskDelete}>
            문서 삭제
          </button>
        </div>

        {editing ? (
          <input
            className="doctitle"
            autoFocus
            value={draft}
            maxLength={80}
            aria-label="문서 제목"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setDraft(doc.title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            className="doctitle"
            style={{ textAlign: "left", cursor: "text" }}
            title="클릭하면 제목을 고칠 수 있습니다"
            onClick={() => {
              setDraft(doc.title);
              setEditing(true);
            }}
          >
            {doc.title}
          </button>
        )}

        <div className="docmeta">
          {/* 절대 시각(무엇이 최신인가) + 상대 시간(방금 저장됐나)을 나란히 둔다 */}
          {when(doc.updatedAt)} 수정 · {ago(new Date(doc.updatedAt).getTime(), now)} · 블록{" "}
          {blocks.length} · 외부로 공유되지 않습니다
        </div>

        {conflict ? (
          <div className="tip warn" style={{ marginBottom: 14 }}>
            <Icon name="bulb" size={15} />
            <span>
              다른 사람이 먼저 저장했습니다. 위에 보이는 내용이 <b>지금 서버에 있는 최신 문서</b>
              입니다. 다시 고쳐서 저장해 주세요.
            </span>
          </div>
        ) : null}

        {err ? (
          <div style={{ marginBottom: 14 }}>
            <ErrorBox error={err} />
          </div>
        ) : null}

        {blocks.map((b, i) => (
          <section className="block" key={b.id}>
            <div className="bhead">
              <span className="kind">{BLOCK_LABEL[b.kind]}</span>
              <Icon name={KIND_ICON[b.kind]} size={15} />
              <h5>{BLOCK_LABEL[b.kind]} 블록</h5>
              <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
                <button
                  className="del"
                  aria-label="위로"
                  disabled={i === 0}
                  style={i === 0 ? { opacity: 0.35, cursor: "default" } : undefined}
                  onClick={() => move(b, i, -1)}
                >
                  <Icon name="up" size={14} />
                </button>
                <button
                  className="del"
                  aria-label="아래로"
                  disabled={i === blocks.length - 1}
                  style={
                    i === blocks.length - 1 ? { opacity: 0.35, cursor: "default" } : undefined
                  }
                  onClick={() => move(b, i, 1)}
                >
                  <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}>
                    <Icon name="up" size={14} />
                  </span>
                </button>
                <button className="del" onClick={() => setDelBlock(b)}>
                  삭제
                </button>
              </div>
            </div>
            <BlockBody
              key={b.id}
              gid={gid}
              block={b}
              onSave={(c) => saveContent(b.id, c)}
            />
          </section>
        ))}

        <div className="addblock">
          <span className="lb">블록 추가</span>
          {BLOCK_KINDS.map((k) => (
            <button key={k} className="btn btn-ghost btn-sm" onClick={() => addBlock(k)}>
              <Icon name={KIND_ICON[k]} size={14} />
              {BLOCK_LABEL[k]}
            </button>
          ))}
        </div>

        {blocks.length === 0 ? (
          <p className="hint" style={{ marginTop: 12 }}>
            아직 블록이 없습니다. 시간표·지도·숙소·정산서·메모를 얹어 문서를 채워 보세요.
          </p>
        ) : null}

        <ConfirmModal
          open={!!delBlock}
          title="블록 삭제"
          message={
            <>
              <b>{delBlock ? BLOCK_LABEL[delBlock.kind] : ""}</b> 블록을 삭제합니다. 되돌릴 수
              없습니다.
            </>
          }
          confirmLabel="삭제"
          danger
          busy={busyBlock}
          onConfirm={removeBlock}
          onClose={() => setDelBlock(null)}
        />
      </div>
    </SaveBusCtx.Provider>
  );
}

/* ══════════ 블록 ══════════ */

function BlockBody({
  gid,
  block,
  onSave,
}: {
  gid: string;
  block: DocBlock;
  onSave: (content: Record<string, unknown>) => void;
}) {
  switch (block.kind) {
    case "timetable":
      return <TimetableBlock content={block.content} onSave={onSave} />;
    case "map":
      return <MapBlock content={block.content} onSave={onSave} />;
    case "stay":
      return <StayBlock content={block.content} onSave={onSave} />;
    case "settle":
      return <SettleBlock gid={gid} />;
    case "memo":
      return <MemoBlock content={block.content} onSave={onSave} />;
  }
}

/** 시간표 — [시간, 내용, 장소] 행. */
function TimetableBlock({
  content,
  onSave,
}: {
  content: Record<string, unknown>;
  onSave: (c: Record<string, unknown>) => void;
}) {
  // 초기값만 서버에서 받고 그 뒤로는 로컬이 진실이다. 저장할 때마다 다시 받아 덮으면 커서가 튄다.
  const [rows, setRows] = useState<TimeRow[]>(() => readTimetable(content));
  const { schedule, flush } = useDebouncedSave(onSave);

  const put = (next: TimeRow[], now = false) => {
    setRows(next);
    if (now) onSave(writeTimetable(next));
    else schedule(writeTimetable(next));
  };

  const edit = (i: number, key: keyof TimeRow, v: string) =>
    put(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));

  const cell = (v: string, ph: string, on: (s: string) => void, mono?: boolean) => (
    <input
      type="text"
      value={v}
      placeholder={ph}
      onChange={(e) => on(e.target.value)}
      onBlur={flush}
      className={mono ? "mono" : undefined}
      style={{
        border: "1px solid transparent",
        borderRadius: 6,
        padding: "4px 6px",
        width: "100%",
        background: "transparent",
        fontSize: mono ? 12 : 13,
      }}
    />
  );

  return (
    <>
      {rows.map((r, i) => (
        <div className="ttrow" key={i}>
          {cell(r.t, "08:20", (v) => edit(i, "t", v), true)}
          {cell(r.c, "무엇을 하나요", (v) => edit(i, "c", v))}
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {cell(r.n, "장소", (v) => edit(i, "n", v))}
            <button
              className="del"
              aria-label="행 삭제"
              onClick={() => put(rows.filter((_, j) => j !== i), true)}
            >
              <Icon name="x" size={13} />
            </button>
          </span>
        </div>
      ))}
      <button
        className="btn btn-ghost btn-sm"
        style={{ marginTop: 10 }}
        onClick={() => put([...rows, { t: "", c: "", n: "" }], true)}
      >
        <Icon name="plus" size={13} />행 추가
      </button>
    </>
  );
}

/** 지도 — 사각형 캔버스에 핀을 찍는다. 클릭으로 추가, 핀 클릭으로 삭제. */
function MapBlock({
  content,
  onSave,
}: {
  content: Record<string, unknown>;
  onSave: (c: Record<string, unknown>) => void;
}) {
  const [pins, setPins] = useState<Pin[]>(() => readPins(content));
  // 브라우저 prompt 를 쓰지 않기로 했으므로 "다음에 찍을 이름"을 입력칸으로 미리 받는다
  const [name, setName] = useState("");

  const put = (next: Pin[]) => {
    setPins(next);
    onSave(writePins(next));
  };

  const drop = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n * 10) / 10));
    put([
      ...pins,
      {
        name: name.trim() || "새 장소",
        x: clamp(((e.clientX - r.left) / r.width) * 100),
        y: clamp(((e.clientY - r.top) / r.height) * 100),
      },
    ]);
    setName("");
  };

  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <input
          type="text"
          value={name}
          placeholder="핀 이름 (예: 성산일출봉)"
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          style={{
            padding: "7px 10px",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-sm)",
            fontSize: 12.5,
            flex: 1,
            minWidth: 0,
          }}
        />
        <span className="hint" style={{ flex: "none" }}>
          이름을 적고 지도를 누르면 핀이 찍힙니다
        </span>
      </div>

      <div className="map" onClick={drop} style={{ cursor: "crosshair" }}>
        {pins.map((p, i) => (
          <button
            className="pin"
            key={i}
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            title={`${p.name} — 누르면 삭제됩니다`}
            onClick={(e) => {
              e.stopPropagation(); // 핀을 지우려다 새 핀이 찍히면 안 된다
              put(pins.filter((_, j) => j !== i));
            }}
          >
            <i />
            <span>{p.name}</span>
          </button>
        ))}
      </div>
      <p className="memo" style={{ fontSize: 12 }}>
        핀 {pins.length}개 · 지도를 누르면 추가되고, 핀을 누르면 지워집니다.
      </p>
    </>
  );
}

/** 숙소 후보 — [이름, 기간, 금액]. 금액은 원 단위 정수만 다룬다. */
function StayBlock({
  content,
  onSave,
}: {
  content: Record<string, unknown>;
  onSave: (c: Record<string, unknown>) => void;
}) {
  const [rows, setRows] = useState<StayRow[]>(() => readStay(content));
  const { schedule, flush } = useDebouncedSave(onSave);

  const put = (next: StayRow[], now = false) => {
    setRows(next);
    if (now) onSave(writeStay(next));
    else schedule(writeStay(next));
  };

  const edit = (i: number, patch: Partial<StayRow>) =>
    put(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const inp = (v: string, ph: string, on: (s: string) => void, w?: number) => (
    <input
      type="text"
      value={v}
      placeholder={ph}
      onChange={(e) => on(e.target.value)}
      onBlur={flush}
      style={{
        border: "1px solid transparent",
        borderRadius: 6,
        padding: "4px 6px",
        background: "transparent",
        fontSize: 13,
        width: w ? w : "100%",
      }}
    />
  );

  return (
    <>
      {rows.map((r, i) => (
        <div className="stayrow" key={i}>
          <span style={{ minWidth: 0, flex: 1 }}>
            {inp(r.name, "숙소 이름", (v) => edit(i, { name: v }))}
            <br />
            {inp(r.period, "09.12 → 09.14 · 2박", (v) => edit(i, { period: v }))}
          </span>
          <span className="f" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="number"
              value={r.cost === 0 ? "" : r.cost}
              placeholder="0"
              min={0}
              step={1000}
              onChange={(e) => {
                // 원 단위 정수만 다룬다. 소수점은 어디에도 나오지 않는다.
                const n = Math.max(0, Math.round(Number(e.target.value) || 0));
                edit(i, { cost: n });
              }}
              onBlur={flush}
              style={{
                width: 116,
                textAlign: "right",
                border: "1px solid var(--line)",
                borderRadius: 6,
                padding: "5px 8px",
                fontSize: 13,
              }}
              className="num"
            />
            <span style={{ minWidth: 96, textAlign: "right" }}>
              {r.cost > 0 ? <Won v={r.cost} /> : <span style={{ color: "var(--ink-3)" }}>미정</span>}
            </span>
            <button
              className="del"
              aria-label="행 삭제"
              onClick={() => put(rows.filter((_, j) => j !== i), true)}
            >
              <Icon name="x" size={13} />
            </button>
          </span>
        </div>
      ))}
      <button
        className="btn btn-ghost btn-sm"
        style={{ marginTop: 10 }}
        onClick={() => put([...rows, { name: "", period: "", cost: 0 }], true)}
      >
        <Icon name="plus" size={13} />숙소 추가
      </button>
    </>
  );
}

/**
 * 정산서 — **content 를 저장하지 않는다.**
 *
 * 정산 수치를 문서에 복사해 굳히면 결제자나 정산 대상이 바뀐 뒤에도 문서만 옛 금액을 들고 있게 된다.
 * 결제자·대상을 바꾸는 순간 전체가 재계산되는 게 이 앱의 핵심 상호작용이라
 * 문서는 **그릴 때마다 정산 API 를 다시 불러** 지금 값을 보여 준다. (서버도 settle 블록의 content 저장을 거부한다.)
 * 여기는 읽기 전용이다 — 이체 상태를 넘기는 버튼은 정산 화면에만 있다.
 */
function SettleBlock({ gid }: { gid: string }) {
  const s = useSettlement(gid);

  if (s.isLoading) return <p className="empty">정산을 불러오는 중…</p>;
  if (s.error) return <ErrorBox error={s.error} />;
  if (!s.data) return null;

  const { total, guestTotal, transfers, closed } = s.data;

  return (
    <>
      {/*
        "저장이 안 된다"는 오해가 여기서 나왔다. 이 블록만 있는 문서는 채울 칸이 없어서
        빈 화면처럼 보이기 때문이다. 왜 비어 있는지를 블록 안에서 말한다.
      */}
      <div className="tip" style={{ marginBottom: 12 }}>
        <Icon name="bulb" size={15} />
        <span>
          이 블록은 <b>일부러 아무 수치도 저장하지 않습니다.</b> 결제자나 정산 대상이 바뀌면 적어
          둔 숫자가 곧바로 거짓이 되기 때문이고, 서버도 이 블록의 content 저장을 거부합니다. 대신
          정산 화면과 같은 계산을 그때그때 다시 불러옵니다. 그래서 편집할 칸이 없는 게 정상이며,
          이 블록만 있는 문서가 비어 보이는 것도 저장이 안 된 것이 아닙니다.
        </span>
      </div>

      <div className="sumbox" style={{ marginBottom: 12 }}>
        <div>
          <div className="lb">정산 반영액</div>
          <div className="vl brand">
            <Won v={total} />
          </div>
        </div>
        <div>
          <div className="lb">기타 인원 몫</div>
          <div className="vl warn">
            <Won v={guestTotal} />
          </div>
        </div>
      </div>

      {transfers.length === 0 ? (
        <p className="memo">주고받을 금액이 없습니다.</p>
      ) : (
        transfers.map((t) => (
          <div className="stayrow" key={`${t.fromId}>${t.toId}`}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <b>{t.fromName}</b>
              <span style={{ color: "var(--ink-3)", display: "inline-flex" }}>
                <Icon name="chev" size={13} />
              </span>
              <b>{t.toName}</b>
            </span>
            <span className="f">
              <Won v={t.amt} />{" "}
              {t.state === "done" ? (
                <span style={{ color: "var(--ok)", fontSize: 11.5 }}>완료</span>
              ) : t.state === "req" ? (
                <span style={{ color: "var(--warn)", fontSize: 11.5 }}>요청됨</span>
              ) : (
                <span style={{ color: "var(--ink-3)", fontSize: 11.5 }}>대기</span>
              )}
            </span>
          </div>
        ))
      )}

      <p className="hint" style={{ marginTop: 10 }}>
        {closed ? "이 모임의 정산은 마감되었습니다." : "정산 상태를 바꾸는 것은 정산 화면에서 합니다."}
      </p>
    </>
  );
}

/** 메모 — 자유 텍스트. 높이는 내용에 맞춰 늘어난다. */
function MemoBlock({
  content,
  onSave,
}: {
  content: Record<string, unknown>;
  onSave: (c: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState<string>(() => asStr(content.text));
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const { schedule, flush } = useDebouncedSave(onSave);

  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(fit, []);

  return (
    <textarea
      ref={ref}
      value={text}
      placeholder="여기에 자유롭게 적으세요."
      onChange={(e) => {
        setText(e.target.value);
        fit();
        schedule({ text: e.target.value });
      }}
      onBlur={flush}
      className="memo"
      style={{
        width: "100%",
        minHeight: 84,
        border: "1px solid var(--line)",
        borderRadius: "var(--r-sm)",
        padding: "10px 12px",
        resize: "none",
        overflow: "hidden",
        background: "var(--surface)",
      }}
    />
  );
}
