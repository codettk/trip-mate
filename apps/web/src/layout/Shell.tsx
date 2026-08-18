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
        onClose={() => setSwitcher(false)}
      />

      <NewGroupModal open={newGroup} onClose={() => setNewGroup(false)} />
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
  onClose,
}: {
  open: boolean;
  currentId: string;
  groups: GroupSummary[];
  loading: boolean;
  onPick: (id: string) => void;
  onNew: () => void;
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

      <button className="ccard" onClick={onNew}>
        <Tile c="var(--brand)" bg="var(--brand-soft)" icon="plus" />
        <b>새 여행 모임</b>
        <small>제목·여행지·기간을 정하면 일차가 자동으로 생깁니다. 만든 사람이 방장이 됩니다.</small>
      </button>

      <p className="hint">
        모임마다 멤버·일정·폴더·정산·문서가 완전히 분리됩니다. 모임 제목이 곧 Google Drive 최상위
        폴더 이름입니다.
      </p>
    </Modal>
  );
}
