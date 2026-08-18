/**
 * 폴더 트리.
 *
 * 하위 폴더는 멤버가 자유롭게 만들고 **중첩 깊이에 제한이 없다**(CLAUDE.md).
 * 그래서 정해진 단계만큼 반복문으로 그릴 수 없고 재귀 컴포넌트로 그린다.
 *
 * ⚠ 초록(--ok)은 "외부 공유 상태" 전용 색이다. 공개 폴더에만 쓰고 다른 뜻으로 쓰지 않는다.
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
            {node.pub ? (
              // 공개 폴더 표시 — 외부 뷰어 링크가 열려 있다는 뜻이다
              <span
                title="공개 · 외부 뷰어 링크가 열려 있습니다"
                aria-label="공개 폴더"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--ok)",
                  flex: "none",
                }}
              />
            ) : (
              // 비공개(기본값) — 자물쇠는 조용하게 둔다. 눈에 띄어야 하는 쪽은 "밖으로 나가 있는" 폴더다
              <span
                title="비공개 · 모임 멤버만 봅니다"
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
