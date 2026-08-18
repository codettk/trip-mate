/**
 * 폴더 트리.
 *
 * 하위 폴더는 멤버가 자유롭게 만들고 **중첩 깊이에 제한이 없다**(CLAUDE.md).
 * 그래서 정해진 단계만큼 반복문으로 그릴 수 없고 재귀 컴포넌트로 그린다.
 *
 * ⚠ 초록(--ok)은 "외부 공유 상태" 전용 색이다.
 *   공유는 이제 폴더가 아니라 **묶음(share link)** 에 붙으므로, 초록 점의 뜻은
 *   "이 폴더가 어떤 묶음에 담겨 지금 밖으로 나가는 중"이다(`sharedIn`).
 */

import type { FolderNodeDto } from "../../api/types.ts";
import { Icon } from "../../components/Icon.tsx";

/** 하위 폴더까지 합친 사진 수. 서버가 주는 photoCount 는 그 폴더 자신의 것만이다. */
export function deepCount(n: FolderNodeDto): number {
  return n.photoCount + n.children.reduce((s, k) => s + deepCount(k), 0);
}

/** 루트에서 target 까지의 id 경로. 현재 폴더의 조상을 자동으로 펼칠 때 쓴다. */
export function pathTo(node: FolderNodeDto, target: string): string[] | null {
  if (node.id === target) return [node.id];
  for (const c of node.children) {
    const sub = pathTo(c, target);
    if (sub) return [node.id, ...sub];
  }
  return null;
}

/**
 * 트리를 평평하게 편다.
 * `resolveShared`/`canMoveFolder` 가 {id,parentId} 목록을 받으므로 그대로 넘길 수 있다 —
 * 공유 미리보기 계산을 화면에서 다시 짜지 않기 위해서다.
 */
export function flattenTree(n: FolderNodeDto): FolderNodeDto[] {
  return [n, ...n.children.flatMap(flattenTree)];
}

/** 루트에서 target 까지의 이름 경로. "제주도 4박 5일 / Day 1 · 성산" */
export function namePath(root: FolderNodeDto, target: string): string {
  const ids = pathTo(root, target);
  if (!ids) return "";
  const byId = new Map(flattenTree(root).map((f) => [f.id, f.name]));
  return ids.map((id) => byId.get(id) ?? "").join(" / ");
}

export interface FolderTreeProps {
  node: FolderNodeDto;
  currentId: string | undefined;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}

export function FolderTree({ node, currentId, expanded, onToggle, onOpen }: FolderTreeProps) {
  const hasKids = node.children.length > 0;
  const open = expanded.has(node.id);
  const total = deepCount(node);
  const shared = node.sharedIn.length > 0;

  return (
    <ul>
      <li>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {hasKids ? (
            <button
              onClick={() => onToggle(node.id)}
              aria-expanded={open}
              aria-label={`${node.name} ${open ? "접기" : "펼치기"}`}
              style={{
                width: 20,
                height: 20,
                flex: "none",
                display: "grid",
                placeItems: "center",
                borderRadius: 6,
                color: "var(--ink-3)",
              }}
            >
              <span
                style={{
                  display: "grid",
                  transform: open ? "rotate(90deg)" : "none",
                  transition: "transform .12s",
                }}
              >
                <Icon name="chev" size={13} />
              </span>
            </button>
          ) : (
            <span style={{ width: 20, flex: "none" }} aria-hidden="true" />
          )}

          <button
            className="tnode"
            aria-current={node.id === currentId}
            onClick={() => onOpen(node.id)}
            title={total ? `사진·동영상 ${total}개 (하위 폴더 포함)` : node.name}
          >
            <Icon name="folder" size={15} />
            <span className="nm">{node.name}</span>
            {shared ? (
              // 묶음에 담겨 밖으로 나가는 중이라는 뜻이다 — 초록은 외부 공유 전용 색이다
              <span
                title={`공유 중 · 묶음 ${node.sharedIn.length}개`}
                aria-label="공유 중"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--ok)",
                  flex: "none",
                }}
              />
            ) : (
              // 어느 묶음에도 없다 — 자물쇠는 조용하게 둔다. 눈에 띄어야 하는 쪽은 "밖으로 나가 있는" 폴더다
              <span
                title="모임 멤버만 봅니다"
                style={{ display: "grid", color: "var(--ink-3)", opacity: 0.6 }}
              >
                <Icon name="lock" size={12} />
              </span>
            )}
            <span className="ct">{total}</span>
          </button>
        </div>

        {hasKids && open
          ? node.children.map((c) => (
              <FolderTree
                key={c.id}
                node={c}
                currentId={currentId}
                expanded={expanded}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ))
          : null}
      </li>
    </ul>
  );
}

export interface FolderPickerProps {
  node: FolderNodeDto;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** 고를 수 없는 폴더의 이유. null 이면 고를 수 있다 — 이유를 그대로 보여 준다 */
  disabled?: (node: FolderNodeDto) => string | null;
}

/**
 * 옮길 위치를 고르는 트리.
 *
 * 사진 이동·폴더 이동이 같은 질문("어디로?")을 하므로 한 벌만 둔다.
 * 접었다 펴는 상태를 두지 않고 항상 다 펼친다 — 고르는 창은 작고,
 * 접혀 있어서 못 찾는 것보다 길어지는 편이 낫다.
 */
export function FolderPicker({ node, selectedId, onSelect, disabled }: FolderPickerProps) {
  const reason = disabled?.(node) ?? null;

  return (
    <ul>
      <li>
        <button
          className="tnode"
          aria-current={node.id === selectedId}
          disabled={!!reason}
          title={reason ?? node.name}
          onClick={() => onSelect(node.id)}
          style={reason ? { opacity: 0.45, cursor: "default" } : undefined}
        >
          <Icon name="folder" size={15} />
          <span className="nm">{node.name}</span>
          {reason ? (
            <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{reason}</span>
          ) : null}
          <span className="ct">{node.photoCount}</span>
        </button>
        {node.children.map((c) => (
          <FolderPicker
            key={c.id}
            node={c}
            selectedId={selectedId}
            onSelect={onSelect}
            disabled={disabled}
          />
        ))}
      </li>
    </ul>
  );
}
