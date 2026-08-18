/**
 * ══════════ 일정 상세 모달 ══════════
 *
 * 상세를 보다가 그 자리에서 수정·삭제로 이어진다. 새 페이지로 보내지 않는다.
 *
 * 여기서 가장 중요한 것은 **결제자 미지정 항목을 이 모달 안에서 바로 지정하는 것**이다.
 * 결제자를 바꾸는 순간 정산 전체가 재계산된다 — 이게 이 앱의 핵심 상호작용이라
 * "수정 폼으로 가세요"로 미루지 않는다. (캐시 무효화는 useApiMutation 이 한다.)
 */

import { dowOf, formatMoney, formatWon, shortDate } from "@tripmate/core";
import { useState } from "react";
import { api } from "../api/client.ts";
import { useApiMutation, useMembers } from "../api/hooks.ts";
import type { Item } from "../api/types.ts";
import { Avatar, Badge, ErrorBox, memberLabel } from "../components/Bits.tsx";
import { Icon } from "../components/Icon.tsx";
import { ConfirmModal, Modal } from "../components/Modal.tsx";
import { CAT_META, ItemModal, targetLabel } from "./ItemModal.tsx";

export interface ItemDetailModalProps {
  open: boolean;
  gid: string;
  item: Item | null;
  onClose: () => void;
}

export function ItemDetailModal({ open, gid, item, onClose }: ItemDetailModalProps) {
  const membersQ = useMembers(gid);
  const members = membersQ.data?.members ?? [];

  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  /** 결제자만 갈아 끼운다. PATCH 는 보낸 필드만 덮어쓰므로 금액·대상은 그대로 남는다. */
  const setPayer = useApiMutation<string | null, Item>(
    (payerId) => api.patch<Item>(`/api/groups/${gid}/items/${item?.id ?? ""}`, { payerId }),
    gid,
  );

  const del = useApiMutation<void, { ok: boolean }>(
    () => api.del<{ ok: boolean }>(`/api/groups/${gid}/items/${item?.id ?? ""}`),
    gid,
    () => {
      setConfirming(false);
      onClose();
    },
  );

  if (!open || !item) return null;

  // 수정으로 넘어가면 상세는 접고 폼만 남긴다 — 모달 두 장이 겹치지 않게.
  if (editing) {
    return (
      <ItemModal
        open
        gid={gid}
        item={item}
        onClose={() => {
          setEditing(false);
          onClose();
        }}
      />
    );
  }

  const cat = CAT_META[item.cat];
  const payer = members.find((m) => m.id === item.payerId) ?? null;
  const parts = item.shared.members.length + item.shared.guests;
  const per = parts ? Math.round(item.krw / parts) : 0;
  const assignable = members.filter((m) => !m.left);

  return (
    <>
      <Modal
        open={open}
        title={item.title}
        icon={cat.icon}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-danger" onClick={() => setConfirming(true)}>
              삭제
            </button>
            <div className="sp" />
            <button className="btn btn-ghost" onClick={onClose}>
              닫기
            </button>
            <button className="btn" onClick={() => setEditing(true)}>
              수정
            </button>
          </>
        }
      >
        {item.thumb ? (
          <div style={{ height: 130, borderRadius: 12, background: item.thumb }} />
        ) : null}

        {setPayer.error ? <ErrorBox error={setPayer.error} /> : null}

        <dl className="dl">
          <dt>날짜</dt>
          <dd>
            DAY {item.dayN} · {shortDate(item.date)} ({dowOf(item.date)})
          </dd>

          <dt>시간</dt>
          <dd className={item.time ? "mono" : undefined}>{item.time || "시간 미정"}</dd>

          <dt>분류</dt>
          <dd>
            <span className="catlabel" style={{ background: cat.bg, color: cat.c, padding: "2px 8px" }}>
              {cat.label}
            </span>
            {item.booked ? (
              <span style={{ marginLeft: 6 }}>
                <Badge tone="ok" icon="check">
                  예약 완료
                </Badge>
              </span>
            ) : null}
          </dd>

          {item.cat === "stay" && item.checkIn && item.checkOut ? (
            <>
              <dt>숙박</dt>
              <dd className="num">
                {shortDate(item.checkIn)} → {shortDate(item.checkOut)} · {item.nights}박
              </dd>
            </>
          ) : null}

          <dt>정산</dt>
          <dd>
            {item.split ? (
              <Badge tone="ok">포함</Badge>
            ) : (
              <Badge tone="mute">정산 제외 — 일정만</Badge>
            )}
          </dd>

          {item.split ? (
            <>
              <dt>금액</dt>
              <dd className="num">
                {formatWon(item.krw)}
                {item.cur !== "KRW" ? (
                  <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>
                    {" "}
                    ({formatMoney(item.cost, item.cur)} · {shortDate(item.date)} 마감 환율{" "}
                    {item.rate.toLocaleString("ko-KR")}원)
                  </span>
                ) : null}
              </dd>

              <dt>결제자</dt>
              <dd>
                {payer ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Avatar m={payer} size={22} />
                    {memberLabel(payer)}
                  </span>
                ) : (
                  <Badge tone="warn">미지정</Badge>
                )}
              </dd>

              <dt>정산 대상</dt>
              <dd className="num">
                {targetLabel(item.shared, members)}
                {parts ? ` · 1인 ${formatWon(per)}` : ""}
              </dd>
            </>
          ) : null}

          {item.meta ? (
            <>
              <dt>메모</dt>
              <dd>{item.meta}</dd>
            </>
          ) : null}
        </dl>

        {/* 결제자 미지정 — 여기서 바로 지정한다. 누르는 순간 정산 전체가 다시 계산된다. */}
        {item.split && !item.payerId ? (
          <div className="field">
            <label>결제자를 지금 지정하세요</label>
            <div className="chips">
              {assignable.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="chip"
                  disabled={setPayer.isPending}
                  onClick={() => setPayer.mutate(m.id)}
                >
                  <Avatar m={m} />
                  {m.name}
                </button>
              ))}
            </div>
            <p className="hint">
              결제자를 정하면 이 항목이 곧바로 정산에 들어갑니다. 지금 정하지 않아도 됩니다 — 현장에서
              누가 냈는지 나중에 채워 넣을 수 있습니다.
            </p>
          </div>
        ) : null}

        {item.split && parts === 0 ? (
          <div className="tip warn">
            <Icon name="bulb" size={15} />
            <span>
              정산 대상이 없어 이 항목은 정산 계산에서 빠져 있습니다. 수정에서 대상을 지정하거나 정산
              토글을 꺼 주세요.
            </span>
          </div>
        ) : null}

        {!item.split ? (
          <div className="tip">
            <Icon name="bulb" size={15} />
            <span>
              이 일정은 <b>정산 제외</b>입니다. 금액·결제자·정산 대상을 저장하지 않습니다. 정산에
              넣으려면 <b>수정</b>에서 “정산에 포함”을 켜 주세요.
            </span>
          </div>
        ) : null}
      </Modal>

      <ConfirmModal
        open={confirming}
        title="일정을 삭제할까요?"
        message={
          <>
            <b>{item.title}</b> 을(를) 삭제합니다.
            {item.split && item.krw > 0
              ? " 이 지출이 사라지면서 정산 이체 목록이 다시 계산됩니다."
              : ""}{" "}
            되돌릴 수 없습니다.
          </>
        }
        confirmLabel="삭제"
        danger
        busy={del.isPending}
        onConfirm={() => del.mutate()}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
