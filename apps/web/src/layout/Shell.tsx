/**
 * 셸 — 왼쪽 고정 사이드바 + 본문.
 *
 * 사이드바 항목은 넷(일정·사진·정산·문서) + 설정뿐이다. 섹션을 늘려 탐색을 무겁게 만들지 않는다.
 * 모임 스위처는 사이드바 **하단**, 계정 칩 바로 위에 둔다 — 모임이 최상위 단위라
 * "지금 어느 모임에 있는가"가 화면을 떠나지 않아야 하기 때문이다.
 *
 * 모임 바꾸기·멤버 초대·로그아웃은 전부 모달이다. 새 페이지로 보내지 않는다.
 */

import { useQueryClient } from "@tanstack/react-query";
import { currencyOf, shortDate, tripLength } from "@tripmate/core";
import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { ApiError, api } from "../api/client.ts";
import {
  keys,
  useDocs,
  useFolders,
  useGroup,
  useGroups,
  useItinerary,
  useSettlement,
} from "../api/hooks.ts";
import type { FolderNodeDto, GroupSummary } from "../api/types.ts";
import { Avatar, ErrorBox } from "../components/Bits.tsx";
import { Icon } from "../components/Icon.tsx";
import { ConfirmModal, Modal } from "../components/Modal.tsx";
import { Splash } from "../components/Splash.tsx";
import { InviteModal } from "../modals/InviteModal.tsx";
import { JoinGroupModal, type GroupBrief } from "../modals/JoinGroupModal.tsx";
import { NewGroupModal } from "../modals/NewGroupModal.tsx";

/** 파스텔 타일 — 카드·모달 머리에 붙는 아이콘 조각. */
function Tile({ c, bg, icon }: { c: string; bg: string; icon: string }) {
  return (
    <span className="tile" style={{ background: bg, color: c }}>
      <Icon name={icon} />
    </span>
  );
}

/** 폴더 트리 전체의 사진 수. 하위 폴더 깊이에 제한이 없으므로 재귀로 센다. */
function countPhotos(node: FolderNodeDto): number {
  return node.photoCount + node.children.reduce((s, c) => s + countPhotos(c), 0);
}

/** 기간 표기. `2026.09.12 – 09.16 · 4박 5일` */
const periodOf = (start: string, end: string): string =>
  `${start.replaceAll("-", ".")} – ${shortDate(end)} · ${tripLength(start, end)}`;

function NavRow({
  to,
  icon,
  label,
  count,
  end,
}: {
  to: string;
  icon: string;
  label: string;
  count?: number;
  end?: boolean;
}) {
  return (
    // app.css 의 .navitem 은 <button> 기준이라 링크 밑줄만 여기서 지운다.
    // aria-current 는 NavLink 가 활성 링크에만 "page" 로 붙인다 — 내비게이션의 표준값이다.
    <NavLink to={to} end={end} className="navitem" style={{ textDecoration: "none" }}>
      <Icon name={icon} />
      {label}
      {/* 아직 안 불러온 값은 0 으로 속이지 말고 비워 둔다 */}
      <span className="ct">{count && count > 0 ? count : ""}</span>
    </NavLink>
  );
}

export function Shell({ groupId }: { groupId: string }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const g = useGroup(groupId);
  const groups = useGroups();

  // 사이드바 숫자용. 화면들이 같은 쿼리 키를 다시 쓰므로 중복 요청이 되지 않는다.
  const itinerary = useItinerary(groupId);
  const folders = useFolders(groupId);
  const settlement = useSettlement(groupId);
  const docs = useDocs(groupId);

  const [switcher, setSwitcher] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const [joinGroup, setJoinGroup] = useState(false);
  // 만들거나 참여한 결과. 지금 보던 모임에서 곧장 튕겨 나가지 않도록 한 번 멈춘다.
  const [result, setResult] = useState<{ kind: "created" | "joined"; group: GroupBrief } | null>(
    null,
  );
  const [invite, setInvite] = useState(false);
  const [logout, setLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // 다음에 들어올 때 이 모임으로 바로 오도록 기억해 둔다
  useEffect(() => {
    if (g.data) localStorage.setItem("tm:lastGroup", groupId);
  }, [g.data, groupId]);

  // 없는 모임이거나 (나가서) 더 이상 멤버가 아니면 랜딩이 알아서 보내 준다
  const status = g.error instanceof ApiError ? g.error.status : 0;
  if (status === 404 || status === 403) return <Navigate to="/" replace />;

  if (g.isLoading) return <Splash />;
  if (g.error) {
    return (
      <div style={{ padding: 26 }}>
        <ErrorBox error={g.error} />
      </div>
    );
  }
  if (!g.data) return <Splash />;

  const { group, members, me } = g.data;
  const active = members.filter((m) => !m.left); // 나간 멤버는 스택에서 뺀다
  const cur = currencyOf(group.cur);

  const itemCount = itinerary.data?.days.reduce((s, d) => s + d.items.length, 0);
  const photoCount = folders.data ? countPhotos(folders.data.root) : undefined;
  // 아직 사람이 눌러야 하는 이체·받음 확인 건수 (시스템이 입금을 판단하지 않는다)
  const openSteps = settlement.data
    ? settlement.data.totalSteps - settlement.data.doneCount
    : undefined;
  const docCount = docs.data?.docs.length;

  const openGroup = (id: string) => {
    localStorage.setItem("tm:lastGroup", id);
    setSwitcher(false);
    nav(`/g/${id}`);
  };

  const doLogout = () => {
    setLoggingOut(true);
    void api
      .post("/api/auth/logout")
      .catch(() => undefined)
      .then(() => {
        qc.clear();
        setLoggingOut(false);
        setLogout(false);
        nav("/login", { replace: true });
      });
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          <span className="mk">
            <Icon name="plane" />
          </span>
          TripMate
        </div>

        <NavRow to={`/g/${groupId}`} end icon="cal" label="일정" count={itemCount} />
        <NavRow to={`/g/${groupId}/photos`} icon="img" label="사진" count={photoCount} />
        <NavRow to={`/g/${groupId}/settle`} icon="won" label="정산" count={openSteps} />
        <NavRow to={`/g/${groupId}/docs`} icon="doc" label="문서" count={docCount} />
        <div className="navsep" />
        <NavRow to={`/g/${groupId}/settings`} icon="gear" label="설정" />

        {/* 모임 스위처 — 사이드바 하단, 계정 칩 바로 위 */}
        <div className="tripcard">
          <b>{group.name}</b>
          <small>{periodOf(group.start, group.end)}</small>
          <span className="cur">
            {cur.sym} {group.cur} · {group.dest}
          </span>
          <button className="sw" onClick={() => setSwitcher(true)}>
            모임 바꾸기
            <Icon name="updown" />
          </button>
        </div>

        <button
          className="acct"
          style={{ width: "100%", textAlign: "left" }}
          onClick={() => setLogout(true)}
        >
          {/* 카카오 노랑은 로그인 버튼과 계정 표시에만 쓴다 */}
          <span className="kk">K</span>
          <span>
            <span className="who-name">
              {members.find((m) => m.id === me.memberId)?.name ?? "내 계정"}
            </span>
            <small>카카오 계정 연결됨 · {me.role === "owner" ? "방장" : "멤버"}</small>
          </span>
        </button>
      </aside>

      <div className="main">
        <header className="apphead">
          <div>
            <h1>{group.name}</h1>
            <div className="dates">{periodOf(group.start, group.end)}</div>
          </div>
          <div className="end">
            <div className="stack">
              {active.map((m) => (
                <Avatar key={m.id} m={m} />
              ))}
            </div>
            <button className="btn btn-ghost" onClick={() => setInvite(true)}>
              <Icon name="plus" />
              멤버 초대
            </button>
          </div>
        </header>

        <div className="body">
          <Outlet />
        </div>
      </div>

      <GroupSwitcher
        open={switcher}
        currentId={groupId}
        groups={groups.data?.groups ?? []}
        loading={groups.isLoading}
        onPick={openGroup}
        onNew={() => {
          setSwitcher(false);
          setNewGroup(true);
        }}
        onJoin={() => {
          setSwitcher(false);
          setJoinGroup(true);
        }}
        onClose={() => setSwitcher(false)}
      />

      {/* 스위처에서 열었으므로 곧장 이동하지 않고 결과 모달을 거친다 */}
      <NewGroupModal
        open={newGroup}
        onClose={() => setNewGroup(false)}
        onCreated={(g) => {
          setNewGroup(false);
          setResult({ kind: "created", group: g });
        }}
      />

      <JoinGroupModal
        open={joinGroup}
        onClose={() => setJoinGroup(false)}
        onJoined={(g) => {
          setJoinGroup(false);
          setResult({ kind: "joined", group: g });
        }}
      />

      <GroupResultModal
        open={!!result}
        kind={result?.kind ?? "created"}
        group={result?.group ?? null}
        onGo={(id) => {
          setResult(null);
          openGroup(id);
        }}
        onClose={() => {
          // 닫으면 스위처 목록으로 돌아간다 — 방금 만든/참여한 모임이 거기 보여야 한다
          setResult(null);
          setSwitcher(true);
        }}
      />

      <InviteModal open={invite} onClose={() => setInvite(false)} groupId={groupId} />

      <ConfirmModal
        open={logout}
        title="로그아웃"
        message="로그아웃하면 다시 카카오로 로그인해야 합니다. 모임과 사진은 그대로 남아 있습니다."
        confirmLabel="로그아웃"
        danger
        busy={loggingOut}
        onConfirm={doLogout}
        onClose={() => setLogout(false)}
      />
    </div>
  );
}

/**
 * 모임 목록. 드롭다운이 아니라 모달이다 —
 * 모임마다 멤버·일정·폴더·정산·문서가 통째로 갈리므로 무엇으로 옮기는지 충분히 보여 줘야 한다.
 */
function GroupSwitcher({
  open,
  currentId,
  groups,
  loading,
  onPick,
  onNew,
  onJoin,
  onClose,
}: {
  open: boolean;
  currentId: string;
  groups: GroupSummary[];
  loading: boolean;
  onPick: (id: string) => void;
  onNew: () => void;
  onJoin: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  useEffect(() => {
    if (open) void qc.invalidateQueries({ queryKey: keys.groups });
  }, [open, qc]);

  return (
    <Modal open={open} title="여행 모임" onClose={onClose}>
      {loading ? (
        <p className="hint">불러오는 중…</p>
      ) : (
        <div className="lines">
          {groups.map((x) => (
            <div className="li" key={x.id}>
              <span>
                <b>{x.name}</b>
                <br />
                <small style={{ color: "var(--ink-3)", fontSize: 11 }}>
                  {x.dest} · {periodOf(x.start, x.end)} · 멤버 {x.memberCount}명 · {x.cur}
                </small>
              </span>
              {x.id === currentId ? (
                <span className="badge ok" style={{ marginLeft: "auto" }}>
                  현재
                </span>
              ) : (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: "auto" }}
                  onClick={() => onPick(x.id)}
                >
                  열기
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 만들기와 참여를 나란히 둔다 — 초대를 받은 사람이 시작 페이지까지 돌아갈 이유가 없어야 한다 */}
      <div className="row2">
        <button className="ccard" onClick={onNew}>
          <Tile c="var(--brand)" bg="var(--brand-soft)" icon="plus" />
          <b>새 여행 모임</b>
          <small>
            제목·여행지·기간을 정하면 일차가 자동으로 생깁니다. 만든 사람이 방장이 됩니다.
          </small>
        </button>

        <button className="ccard" onClick={onJoin}>
          <Tile c="var(--brand)" bg="var(--brand-soft)" icon="ticket" />
          <b>초대 링크로 참여</b>
          <small>받은 링크를 붙여넣으면 어느 모임인지 확인한 뒤 바로 멤버가 됩니다.</small>
        </button>
      </div>

      <p className="hint">
        모임마다 멤버·일정·폴더·정산·문서가 완전히 분리됩니다. 모임 제목이 곧 Google Drive 최상위
        폴더 이름입니다.
      </p>
    </Modal>
  );
}

/**
 * 모임을 만들거나 참여한 직후.
 *
 * 곧장 이동해 버리면 "무엇이 만들어졌는지"를 볼 새도 없이 보던 화면이 갈린다.
 * 여기서 한 번 멈추고, 이동할지 목록으로 돌아갈지 사람이 고른다.
 */
function GroupResultModal({
  open,
  kind,
  group,
  onGo,
  onClose,
}: {
  open: boolean;
  kind: "created" | "joined";
  group: GroupBrief | null;
  onGo: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open && !!group}
      title={kind === "joined" ? "모임에 참여했습니다" : "모임을 만들었습니다"}
      icon="check"
      onClose={onClose}
      footer={
        <>
          <div className="sp" />
          <button className="btn btn-ghost" onClick={onClose}>
            닫기
          </button>
          <button className="btn" onClick={() => group && onGo(group.id)}>
            모임으로 이동
          </button>
        </>
      }
    >
      {group ? (
        <>
          <div className="lines">
            <div className="li">
              <span>
                <b style={{ fontSize: 14 }}>{group.name}</b>
                <br />
                <small style={{ color: "var(--ink-3)", fontSize: 11 }}>
                  {group.dest}
                  {group.start && group.end ? ` · ${periodOf(group.start, group.end)}` : ""} · 멤버{" "}
                  {group.memberCount}명
                </small>
              </span>
            </div>
          </div>

          <p className="hint">
            {kind === "joined" ? (
              <>
                지금 보던 모임은 그대로 있습니다. 닫으면 모임 목록으로 돌아갑니다.
              </>
            ) : (
              <>
                제목이 곧 Google Drive 최상위 폴더 이름이고, 일차는 기간에서 자동으로
                만들어졌습니다. 닫으면 모임 목록으로 돌아갑니다.
              </>
            )}
          </p>
        </>
      ) : null}
    </Modal>
  );
}
