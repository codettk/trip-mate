/**
 * ══════════ 설정 ══════════
 *
 * 모임 하나에 대한 설정만 다룬다. 사이드바 항목을 늘리지 않기 위해 여기 모아 둔다.
 *   · 모임 정보 수정 (방장만) — 제목을 바꾸면 Drive 최상위 폴더 이름도 같이 바뀐다
 *   · 멤버 관리 — 방장 위임 / 내보내기, 나간 멤버는 따로
 *   · 모임 나가기 — 미정산 잔액이 있어도 **막지 않는다**. 정산에는 그대로 남는다
 *   · 모임 삭제 (방장만) — 소프트 삭제. 사진은 지워지지 않는다
 *
 * ⚠ 여기에 만들지 않는 것:
 *   · **반올림 단위(10원/100원) 설정** — 원 단위 고정이고 사용자 설정으로 노출하지 않는다.
 *   · 저장소·환율 설정 — 서버 환경변수다. OAuth 시크릿과 리프레시 토큰이 브라우저로 내려오면 안 된다.
 *     드라이버 상태만 읽기 전용으로 보여 준다.
 *
 * ⚠ 브라우저 대화상자(alert/confirm/prompt)를 쓰지 않는다. 확인은 전부 ConfirmModal 이다.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CURRENCY_CODES, currencyOf, tripLength } from "@tripmate/core";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api/client.ts";
import { keys, useGroup, useInvalidateGroup, useMe, useMembers, useSettlement } from "../api/hooks.ts";
import type { Group, Member } from "../api/types.ts";
import { Avatar, Badge, ErrorBox, Field } from "../components/Bits.tsx";
import { Icon } from "../components/Icon.tsx";
import { ConfirmModal } from "../components/Modal.tsx";

interface GroupForm {
  name: string;
  dest: string;
  start: string;
  end: string;
  memo: string;
  /** 기본 통화. 새 지출의 기본값일 뿐이라 바꿔도 기존 항목에는 소급되지 않는다. */
  cur: string;
}

interface Health {
  ok: boolean;
  authMode: "mock" | "kakao";
  storage: { driver: string; healthy: boolean };
}

interface LeaveCheck {
  net: number;
  warn: boolean;
  message: string;
}

/**
 * 기간을 줄일 때 빠지는 날짜에 일정이 남아 있으면 서버가 409 + 날짜 목록을 준다.
 * 그 날짜를 그대로 보여 주고 먼저 옮기라고 안내한다 — 일정을 조용히 지우지 않는다.
 */
function conflictDates(e: unknown): string[] {
  if (!(e instanceof ApiError) || e.status !== 409) return [];
  const d = e.detail;
  if (d && typeof d === "object" && Array.isArray((d as { dates?: unknown }).dates)) {
    return (d as { dates: unknown[] }).dates.filter((x): x is string => typeof x === "string");
  }
  return [];
}

export function SettingsScreen() {
  const { gid = "" } = useParams<{ gid: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidate = useInvalidateGroup(gid);

  const group = useGroup(gid);
  const members = useMembers(gid);
  const me = useMe();
  const settlement = useSettlement(gid);

  const isOwner = group.data?.me.role === "owner";
  const myMemberId = group.data?.me.memberId ?? "";

  /* ── 모임 정보 폼 ── */
  const [form, setForm] = useState<GroupForm>({
    name: "",
    dest: "",
    start: "",
    end: "",
    memo: "",
    cur: "KRW",
  });
  const [saved, setSaved] = useState(false);
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    const g = group.data?.group;
    // 서버가 다시 fetch 될 때마다 입력을 덮어쓰면 타이핑이 사라진다. 모임이 바뀔 때만 채운다.
    if (g && loaded.current !== g.id) {
      loaded.current = g.id;
      setForm({ name: g.name, dest: g.dest, start: g.start, end: g.end, memo: g.memo, cur: g.cur });
    }
  }, [group.data]);

  const save = useMutation({
    mutationFn: (body: GroupForm) => api.patch<{ group: Group }>(`/api/groups/${gid}`, body),
    onSuccess: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: keys.groups });
      setSaved(true);
    },
  });

  /* ── 멤버 ── */
  const [delegate, setDelegate] = useState<Member | null>(null);
  const [kick, setKick] = useState<Member | null>(null);

  const delegateM = useMutation({
    mutationFn: (mid: string) => api.patch<{ ok: true }>(`/api/groups/${gid}/members/${mid}`, { role: "owner" }),
    onSuccess: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: keys.groups });
      setDelegate(null);
    },
  });

  const kickM = useMutation({
    mutationFn: (mid: string) => api.del<{ ok: true }>(`/api/groups/${gid}/members/${mid}`),
    onSuccess: () => {
      invalidate();
      setKick(null);
    },
  });

  /* ── 나가기 ── */
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveCheck = useQuery({
    queryKey: ["leave-check", gid],
    queryFn: () => api.get<LeaveCheck>(`/api/groups/${gid}/leave-check`),
    enabled: leaveOpen && !!gid,
  });
  const leave = useMutation({
    mutationFn: () => api.del<{ ok: true }>(`/api/groups/${gid}/members/${myMemberId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.groups });
      localStorage.removeItem("tm:lastGroup");
      navigate("/", { replace: true });
    },
  });

  /* ── 삭제 ── */
  const [removeOpen, setRemoveOpen] = useState(false);
  const removeGroup = useMutation({
    mutationFn: () => api.del<{ ok: true }>(`/api/groups/${gid}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.groups });
      localStorage.removeItem("tm:lastGroup");
      navigate("/", { replace: true });
    },
  });

  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<Health>("/api/health"),
    staleTime: 60_000,
  });

  if (group.isLoading) return <p className="empty">불러오는 중…</p>;
  if (group.error) return <ErrorBox error={group.error} />;
  const g = group.data?.group;
  if (!g) return <ErrorBox error={new Error("모임을 불러오지 못했습니다")} />;

  const all = members.data?.members ?? [];
  const active = all.filter((m) => !m.left);
  const gone = all.filter((m) => m.left);
  const dates = conflictDates(save.error);
  const s = settlement.data;

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 760 }}>
      {/* ══ 모임 정보 ══ */}
      <div className="card">
        <div className="card-h">
          <Icon name="ticket" />
          <h3>모임 정보</h3>
          {isOwner ? null : (
            <Badge tone="mute">방장만 수정할 수 있습니다</Badge>
          )}
        </div>

        {isOwner ? (
          <form
            style={{ display: "grid", gap: 14 }}
            onSubmit={(e) => {
              e.preventDefault();
              setSaved(false);
              save.mutate(form);
            }}
          >
            <Field
              label="제목"
              hint="모임 제목이 곧 Google Drive 최상위 폴더 이름입니다. 제목을 바꾸면 Drive 폴더 이름도 같이 바뀌고, 폴더 ID 는 그대로라 이미 공유한 링크가 깨지지 않습니다."
            >
              <input
                type="text"
                value={form.name}
                maxLength={50}
                required
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>

            <Field label="여행지" hint="여행지에서 기본 통화를 추론하지만, 이미 정해진 기본 통화는 바뀌지 않습니다.">
              <input
                type="text"
                value={form.dest}
                maxLength={50}
                onChange={(e) => setForm({ ...form, dest: e.target.value })}
              />
            </Field>

            {/* 기본 통화는 모임 정보의 일부다 — 여기만 멤버에게 열면 "모임 정보는 방장만" 규칙이 깨진다 */}
            <Field
              label="기본 통화"
              hint={
                <>
                  바꿔도 <b>기존 지출은 바뀌지 않습니다</b> — 항목마다 결제한 통화와 저장 시점의
                  환율 스냅샷을 그대로 들고 있기 때문입니다. 새로 추가하는 지출의 기본값만
                  달라집니다.
                </>
              }
            >
              <select
                value={form.cur}
                onChange={(e) => setForm({ ...form, cur: e.target.value })}
              >
                {CURRENCY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {currencyOf(c).sym} {c} · {currencyOf(c).name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="row2">
              <Field label="시작일">
                <input
                  type="date"
                  value={form.start}
                  required
                  onChange={(e) => setForm({ ...form, start: e.target.value })}
                />
              </Field>
              <Field label="종료일">
                <input
                  type="date"
                  value={form.end}
                  required
                  onChange={(e) => setForm({ ...form, end: e.target.value })}
                />
              </Field>
            </div>
            <p className="hint">
              일차는 시작일~종료일에서 자동으로 만들어집니다. 기간을 줄이면 빠지는 날의 일차가
              사라지므로, 그 날에 일정이 남아 있으면 저장되지 않습니다.
            </p>

            <Field label="메모">
              <textarea
                value={form.memo}
                maxLength={500}
                onChange={(e) => setForm({ ...form, memo: e.target.value })}
              />
            </Field>

            {dates.length ? (
              <div className="tip warn">
                <Icon name="cal" size={15} />
                <span>
                  <b>{dates.join(", ")}</b> 에 일정이 남아 있어 기간을 줄일 수 없습니다. 그 날의
                  일정을 다른 일차로 옮기거나 지운 뒤에 다시 저장해 주세요.
                </span>
              </div>
            ) : save.error ? (
              <ErrorBox error={save.error} />
            ) : null}

            {saved && !save.isPending && !save.error ? (
              <div className="tip ok">
                <Icon name="check" size={15} />
                <span>저장했습니다. Drive 폴더 이름도 함께 맞췄습니다.</span>
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" type="submit" disabled={save.isPending}>
                {save.isPending ? "저장 중…" : "저장"}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={save.isPending}
                onClick={() => {
                  setSaved(false);
                  save.reset();
                  setForm({
                    name: g.name,
                    dest: g.dest,
                    start: g.start,
                    end: g.end,
                    memo: g.memo,
                    cur: g.cur,
                  });
                }}
              >
                되돌리기
              </button>
            </div>
          </form>
        ) : (
          <div className="lines">
            <div className="li">
              <span>제목</span>
              <span className="v" style={{ fontWeight: 500 }}>
                {g.name}
              </span>
            </div>
            <div className="li">
              <span>여행지</span>
              <span className="v" style={{ fontWeight: 500 }}>
                {g.dest}
              </span>
            </div>
            <div className="li">
              <span>기간</span>
              <span className="v" style={{ fontWeight: 500 }}>
                {g.start} → {g.end} · {tripLength(g.start, g.end)}
              </span>
            </div>
            <div className="li">
              <span>메모</span>
              <span className="v" style={{ fontWeight: 400, color: "var(--ink-2)", fontSize: 12 }}>
                {g.memo || "—"}
              </span>
            </div>
          </div>
        )}

        {/* 방장은 위 폼에서 셀렉트로 바꾼다. 멤버에게는 읽기 전용으로 두고 이유를 적는다. */}
        {isOwner ? null : (
          <div className="lines" style={{ marginTop: 12 }}>
            <div className="li">
              <span>기본 통화</span>
              <span className="v" style={{ fontWeight: 500, display: "flex", gap: 6, alignItems: "center" }}>
                {currencyOf(g.cur).sym} {g.cur} · {currencyOf(g.cur).name}
                <Badge tone="mute">방장만 변경</Badge>
              </span>
            </div>
          </div>
        )}
        <p className="hint" style={{ marginTop: 6 }}>
          기본 통화는 새 지출의 기본값일 뿐입니다. 항목마다 결제한 통화 그대로 입력하고, 원화 환산은
          그 항목 일자의 마감 환율로 고정됩니다. 그래서 기본 통화를 바꿔도{" "}
          <b>이미 저장된 지출의 금액·환산액·정산 결과는 그대로입니다.</b>
        </p>
      </div>

      {/* ══ 멤버 ══ */}
      <div className="card">
        <div className="card-h">
          <Icon name="plus" />
          <h3>멤버</h3>
          <span className="cnt">{active.length}명</span>
        </div>

        <div className="lines">
          {active.map((m) => (
            <div className="li" key={m.id}>
              <Avatar m={m} size={26} />
              <span>
                <b>{m.name}</b>
                {m.id === myMemberId ? (
                  <small style={{ color: "var(--ink-3)", fontSize: 11 }}> (나)</small>
                ) : null}
              </span>
              <span className="v" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {m.role === "owner" ? <Badge tone="ok">방장</Badge> : null}
                {isOwner && m.id !== myMemberId ? (
                  <>
                    <button className="btn btn-ghost btn-sm" onClick={() => setDelegate(m)}>
                      방장 위임
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => setKick(m)}>
                      내보내기
                    </button>
                  </>
                ) : null}
              </span>
            </div>
          ))}
        </div>

        {gone.length ? (
          <>
            <div className="subhead" style={{ margin: "16px 0 6px" }}>
              나간 멤버
            </div>
            <div className="lines">
              {gone.map((m) => (
                <div className="li" key={m.id}>
                  <Avatar m={m} size={26} />
                  <span style={{ color: "var(--ink-2)" }}>{m.name}</span>
                  <span className="v">
                    <Badge tone="mute">나감</Badge>
                  </span>
                </div>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 6 }}>
              나간 멤버도 이미 낸 돈과 낼 돈이 있으므로 <b>정산에는 그대로 남습니다.</b> 정산 화면에는
              회색 아바타로 표시되고, 새 지출의 대상 기본값과 초대 화면에서만 빠집니다. 다시 부르려면
              초대 링크를 새로 발급하세요.
            </p>
          </>
        ) : null}

        {kickM.error ? (
          <div style={{ marginTop: 10 }}>
            <ErrorBox error={kickM.error} />
          </div>
        ) : null}
        {delegateM.error ? (
          <div style={{ marginTop: 10 }}>
            <ErrorBox error={delegateM.error} />
          </div>
        ) : null}
      </div>

      {/* ══ 정산 · 저장소 (읽기 전용) ══ */}
      <div className="card">
        <div className="card-h">
          <Icon name="won" />
          <h3>정산과 저장소</h3>
        </div>
        <div className="lines">
          <div className="li">
            <Icon name="won" />
            <span>
              <b>원 단위 반올림</b>
              <br />
              <small style={{ color: "var(--ink-3)", fontSize: 11 }}>
                고정값 · 설정으로 바꿀 수 없습니다
              </small>
            </span>
          </div>
          <div className="li">
            <Icon name="check" />
            <span>
              <b>정산 마감</b>
              <br />
              <small style={{ color: "var(--ink-3)", fontSize: 11 }}>
                {s
                  ? s.closed
                    ? "마감됨 — 모든 이체와 수령 확인이 끝났습니다"
                    : `${s.doneCount}/${s.totalSteps} 완료 — 받은 사람이 확인을 눌러야 끝납니다`
                  : "불러오는 중…"}
              </small>
            </span>
          </div>
          <div className="li">
            <Icon name="folder" />
            <span>
              <b>파일 저장소</b>
              <br />
              <small style={{ color: "var(--ink-3)", fontSize: 11 }}>
                {health.data
                  ? `${health.data.storage.driver} · ${health.data.storage.healthy ? "정상" : "연결 실패"} · /${g.name}`
                  : "확인 중…"}
              </small>
            </span>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          1인 몫 = 반올림(금액 ÷ 인원)이고, 나눠떨어지지 않아 남는 1~2원은 결제자가 부담합니다.
          파일은 운영자 계정 한 곳에 저장되므로 <b>모임을 만든 사람이 탈퇴해도 사진은 사라지지
          않습니다.</b> 업로드·다운로드는 전부 서버를 통하고, 저장소 링크는 밖으로 나가지 않습니다.
          저장소와 환율 설정은 서버 환경변수라 여기서 바꾸지 않습니다.
        </p>
      </div>

      {/* ══ 위험 구역 ══ */}
      <div className="card">
        <div className="card-h">
          <Icon name="x" />
          <h3>모임에서 나가기</h3>
        </div>
        <p className="hint">
          나가도 <b>정산에는 그대로 남습니다</b> — 이미 낸 돈과 낼 돈이 있기 때문입니다. 목록에는
          “나감”으로 표시되고, 새 지출의 대상 기본값에서는 빠집니다.
        </p>
        <button
          className="btn btn-danger btn-block"
          style={{ marginTop: 12 }}
          onClick={() => {
            leave.reset();
            setLeaveOpen(true);
          }}
        >
          이 모임에서 나가기
        </button>

        {isOwner ? (
          <>
            <div className="subhead" style={{ margin: "18px 0 6px" }}>
              모임 삭제
            </div>
            <p className="hint">
              모임을 삭제하면 일정·정산·문서가 더 이상 보이지 않습니다. <b>사진은 지워지지
              않습니다</b> — 파일은 운영자 저장소에 그대로 남습니다.
            </p>
            <button
              className="btn btn-danger btn-block"
              style={{ marginTop: 12 }}
              onClick={() => {
                removeGroup.reset();
                setRemoveOpen(true);
              }}
            >
              모임 삭제
            </button>
          </>
        ) : null}
      </div>

      {/* ══ 확인 모달 ══ */}
      <ConfirmModal
        open={!!delegate}
        title="방장을 위임할까요?"
        confirmLabel="위임"
        busy={delegateM.isPending}
        message={
          <>
            <b>{delegate?.name}</b>님이 이 모임의 방장이 됩니다. 모임 정보 수정·초대·삭제 권한이
            넘어가고, 나는 일반 멤버가 됩니다.
          </>
        }
        onConfirm={() => delegate && delegateM.mutate(delegate.id)}
        onClose={() => setDelegate(null)}
      />

      <ConfirmModal
        open={!!kick}
        title="이 멤버를 내보낼까요?"
        confirmLabel="내보내기"
        danger
        busy={kickM.isPending}
        message={
          <>
            <b>{kick?.name}</b>님이 모임에서 빠집니다. 다만 <b>정산에는 그대로 남습니다</b> — 이미
            낸 돈과 낼 돈이 있기 때문입니다. 계산에서 빼면 잔액 합이 0이 되지 않습니다.
          </>
        }
        onConfirm={() => kick && kickM.mutate(kick.id)}
        onClose={() => setKick(null)}
      />

      <ConfirmModal
        open={leaveOpen}
        title="이 모임에서 나갈까요?"
        confirmLabel="나가기"
        danger
        busy={leave.isPending}
        message={
          <>
            {leaveCheck.isLoading ? (
              "미정산 잔액을 확인하는 중…"
            ) : leaveCheck.data ? (
              <>
                {/* 미정산 잔액이 있어도 막지 않는다. 정산에는 그대로 남으므로 데이터가 깨지지 않는다. */}
                <span className={leaveCheck.data.warn ? "warn" : undefined}>
                  {leaveCheck.data.message}
                </span>
                <br />
                <br />
              </>
            ) : null}
            나가면 이 모임의 일정·사진·문서를 볼 수 없게 됩니다. 정산 목록에는 “나감”으로 남고,
            주고받을 금액은 그대로 유지됩니다.
            {leave.error ? (
              <span style={{ display: "block", marginTop: 10 }}>
                <ErrorBox error={leave.error} />
              </span>
            ) : null}
          </>
        }
        onConfirm={() => leave.mutate()}
        onClose={() => setLeaveOpen(false)}
      />

      <ConfirmModal
        open={removeOpen}
        title="모임을 삭제할까요?"
        confirmLabel="삭제"
        danger
        busy={removeGroup.isPending}
        message={
          <>
            <b>{g.name}</b> 모임의 일정·정산·문서가 더 이상 보이지 않습니다.{" "}
            <b>사진은 지워지지 않습니다</b> — 파일은 운영자 저장소에 그대로 남고, 이미 공개한 폴더
            링크만 열리지 않게 됩니다.
            {removeGroup.error ? (
              <span style={{ display: "block", marginTop: 10 }}>
                <ErrorBox error={removeGroup.error} />
              </span>
            ) : null}
          </>
        }
        onConfirm={() => removeGroup.mutate()}
        onClose={() => setRemoveOpen(false)}
      />

      {me.data?.user ? (
        <p className="note">
          {me.data.user.name} 님으로 로그인되어 있습니다 · {me.data.authMode === "kakao" ? "카카오 계정" : "개발용 계정"}
        </p>
      ) : null}
    </div>
  );
}
