/**
 * 새 여행 모임.
 *
 * 받는 값은 **제목 · 여행지 · 시작일 · 종료일 · 메모 다섯 개뿐**이다. 더 받지 않는다.
 *  · 일차(Day)는 기간에서 **자동 생성**된다 — 사용자가 일차를 직접 추가·삭제하지 않는다.
 *  · 기본 통화는 여행지에서 **자동 추론**한다 (항목마다 바꿀 수 있다).
 *  · 제목이 곧 Google Drive 최상위 폴더 이름이다.
 *
 * 검증 실패는 폼 안에 인라인으로 적는다. 브라우저 대화상자를 쓰지 않는다.
 *
 * 만든 다음 어디로 갈지는 **여는 쪽이 정한다** (`onCreated`).
 *  · 시작 페이지 — 갈 곳이 그 모임뿐이라 곧장 이동한다. 한 번 더 누르게 하는 게 손해다.
 *  · 사이드바 스위처 — 만든 모임을 보여 주고 "이동 / 닫기"를 고르게 한다.
 *    지금 보던 모임에서 튕겨 나가면 하던 일이 끊기기 때문이다.
 */

import { useQueryClient } from "@tanstack/react-query";
import { currencyOf, daysBetween, guessCurrency, tripLength } from "@tripmate/core";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.ts";
import { keys } from "../api/hooks.ts";
import { ErrorBox, Field } from "../components/Bits.tsx";
import { Icon } from "../components/Icon.tsx";
import { Modal } from "../components/Modal.tsx";
// 결과 모달이 쓰는 최소 정보. 참여 쪽과 같은 모양이라 한 곳(JoinGroupModal)에 두고 가져다 쓴다.
import type { GroupBrief } from "./JoinGroupModal.tsx";

const EMPTY = { name: "", dest: "", start: "", end: "", memo: "" };

/** 날짜 입력이 아직 반쯤 채워진 상태에서 core 의 날짜 함수가 던지지 않도록 먼저 막는다. */
const isIso = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function NewGroupModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** 주면 이동하지 않고 만들어진 모임을 넘긴다. 없으면 지금까지처럼 곧장 그 모임으로 간다. */
  onCreated?: (g: GroupBrief) => void;
}) {
  const nav = useNavigate();
  const qc = useQueryClient();

  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);

  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }));

  const cur = f.dest.trim() ? guessCurrency(f.dest.trim()) : null;
  const nights = isIso(f.start) && isIso(f.end) ? daysBetween(f.start, f.end) : null;
  const badRange = nights !== null && nights < 0;
  const tooLong = nights !== null && nights > 364;

  const problem =
    !f.name.trim()
      ? "제목을 입력해 주세요."
      : !f.dest.trim()
        ? "여행지를 입력해 주세요."
        : !isIso(f.start) || !isIso(f.end)
          ? "시작일과 종료일을 골라 주세요."
          : badRange
            ? "종료일이 시작일보다 빠릅니다."
            : tooLong
              ? "여행 기간은 365일을 넘을 수 없습니다."
              : null;

  const close = () => {
    setF(EMPTY);
    setErr(null);
    setTouched(false);
    onClose();
  };

  const submit = () => {
    setTouched(true);
    if (problem) return;
    setBusy(true);
    setErr(null);
    api
      .post<{ id: string }>("/api/groups", {
        name: f.name.trim(),
        dest: f.dest.trim(),
        start: f.start,
        end: f.end,
        memo: f.memo,
      })
      .then(async (r) => {
        // 스위처 목록에 방금 만든 모임이 보여야 한다
        await qc.invalidateQueries({ queryKey: keys.groups });
        const made = {
          id: r.id,
          name: f.name.trim(),
          dest: f.dest.trim(),
          start: f.start,
          end: f.end,
          memberCount: 1, // 만든 사람 혼자다 — 방장 본인
        };
        setBusy(false);
        close();
        if (onCreated) {
          onCreated(made);
          return;
        }
        // 여는 쪽이 정하지 않았으면 지금까지처럼 곧장 그 모임으로 간다
        localStorage.setItem("tm:lastGroup", r.id);
        nav(`/g/${r.id}`);
      })
      .catch((e: unknown) => {
        setErr(e);
        setBusy(false);
      });
  };

  return (
    <Modal
      open={open}
      title="새 여행 모임"
      icon="plus"
      onClose={close}
      footer={
        <>
          <div className="sp" />
          <button className="btn btn-ghost" onClick={close}>
            취소
          </button>
          <button className="btn" onClick={submit} disabled={busy}>
            {busy ? "만드는 중…" : "모임 만들기"}
          </button>
        </>
      }
    >
      {err ? <ErrorBox error={err} /> : null}

      <Field
        label="제목"
        hint={
          <>
            이 이름이 <b>Google Drive 최상위 폴더 이름</b>이 되고, 초대할 때 보이는 이름입니다.
          </>
        }
      >
        <input
          type="text"
          value={f.name}
          placeholder="예: 다낭 3박 4일"
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>

      <Field
        label="여행지"
        hint={
          cur ? (
            <>
              기본 통화가{" "}
              <b>
                {currencyOf(cur).sym} {currencyOf(cur).name}
              </b>{" "}
              ({cur}) 으로 자동 선택됩니다. 항목마다 바꿀 수 있습니다.
            </>
          ) : (
            "여행지를 적으면 기본 통화가 자동으로 정해집니다."
          )
        }
      >
        <input
          type="text"
          value={f.dest}
          placeholder="예: 다낭"
          onChange={(e) => set("dest", e.target.value)}
        />
      </Field>

      <div className="row2">
        <Field label="시작일">
          <input type="date" value={f.start} onChange={(e) => set("start", e.target.value)} />
        </Field>
        <Field label="종료일">
          <input type="date" value={f.end} onChange={(e) => set("end", e.target.value)} />
        </Field>
      </div>

      <p className="hint">
        {badRange ? (
          <span className="warn">종료일이 시작일보다 빠릅니다.</span>
        ) : tooLong ? (
          <span className="warn">여행 기간은 365일을 넘을 수 없습니다.</span>
        ) : nights !== null ? (
          <>
            <b>{tripLength(f.start, f.end)}</b> · 일차 {nights + 1}개가 자동으로 만들어집니다.
            일차를 직접 추가·삭제하지 않습니다.
          </>
        ) : (
          "시작일과 종료일에서 일차가 자동으로 만들어집니다."
        )}
      </p>

      <Field label="메모">
        <textarea
          value={f.memo}
          placeholder="숙소 후보, 렌터카 예약 번호 등"
          onChange={(e) => set("memo", e.target.value)}
        />
      </Field>

      {touched && problem ? (
        <p className="hint">
          <span className="warn">{problem}</span>
        </p>
      ) : null}

      <div className="tip">
        <Icon name="bulb" size={15} />
        <span>
          모임을 만든 사람이 방장이 됩니다. 멤버·일정·폴더·정산·문서는 이 모임 안에서만 보입니다.
        </span>
      </div>
    </Modal>
  );
}
