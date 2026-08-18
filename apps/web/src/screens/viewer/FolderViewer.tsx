/**
 * 폴더 뷰어 — `/{gid}/view/{slug}?t={token}`
 *
 * **모임 밖 사람이 보는 화면이다.** 로그인하지 않는다. 셸도 사이드바도 없다.
 *
 * 여기서 할 수 없어야 하는 것 (CLAUDE.md 확정):
 *  · 하위 폴더·다른 폴더로 이동 — 서버도 목록을 주지 않고 화면에도 통로를 두지 않는다
 *  · 업로드·삭제 — 쓰기 동작이 하나도 없다
 *  · 문서·일정·정산으로 넘어가기 — 이 파일에는 앱 안으로 들어가는 링크가 없다
 *
 * 이미지 주소는 **서버가 준 `photo.url` 을 그대로 쓴다.**
 * Drive 파일 링크나 서명 URL 을 만들지 않는다 — 서버가 저장소에서 받아 전달한다.
 *
 * 링크가 어긋나면 서버가 404 를 준다. 화면도 "만료되었거나 잘못된 주소"라고만 말하고
 * 폴더가 있는지 없는지 짐작할 정보를 주지 않는다.
 */

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api/client.ts";
import { Icon } from "../../components/Icon.tsx";
import { Splash } from "../../components/Splash.tsx";

/** 뷰어 응답. 폴더 하나의 미디어만 들어 있다 — 하위 폴더도, 형제도, 부모 경로도 없다. */
interface ViewerPhoto {
  id: string;
  name: string;
  mime: string;
  uploadedAt: string;
  takenAt: string;
  /** 촬영 메타데이터가 없어 업로드 시각을 쓴 것 — 배지로 알린다 */
  takenFallback: boolean;
  /** 항상 `/api/media/:id?t=…` */
  url: string;
}

interface ViewerFolder {
  folder: { name: string };
  group: { name: string };
  photos: ViewerPhoto[];
}

type Sort = "up" | "taken";

const pad = (n: number): string => String(n).padStart(2, "0");

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const isVideo = (mime: string): boolean => mime.startsWith("video/");

/** 만료·오타·비공개 전환을 하나의 화면으로 처리한다. 어느 쪽인지 알려주지 않는다. */
function Expired() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 420, textAlign: "center", padding: 28 }}>
        <span
          className="tile"
          style={{ background: "var(--warn-bg)", color: "var(--warn)", margin: "0 auto 12px" }}
        >
          <Icon name="lock" />
        </span>
        <h1 style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.02em" }}>
          링크가 만료되었거나 잘못된 주소입니다
        </h1>
        <p style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 8, lineHeight: 1.7 }}>
          공유가 해제되면 이전에 받은 링크는 즉시 사용할 수 없습니다. 링크를 준 분에게 다시
          요청해 주세요.
        </p>
      </div>
    </div>
  );
}

export function FolderViewerScreen() {
  const { gid, slug } = useParams<{ gid: string; slug: string }>();
  const [params, setParams] = useSearchParams();
  const token = params.get("t") ?? "";
  const sort: Sort = params.get("sort") === "taken" ? "taken" : "up";

  const [open, setOpen] = useState<number | null>(null);

  const q = useQuery<ViewerFolder>({
    // 훅에 없는 라우트라 여기서 직접 부른다 — 뷰어는 세션이 아니라 토큰으로만 열린다
    queryKey: ["view-folder", gid ?? "", slug ?? "", token, sort],
    queryFn: () =>
      api.get<ViewerFolder>(
        `/api/view/${gid}/folder/${encodeURIComponent(slug ?? "")}?t=${encodeURIComponent(token)}&sort=${sort}`,
      ),
    enabled: !!gid && !!slug && !!token,
    retry: false,
  });

  const photos = q.data?.photos ?? [];
  const count = photos.length;

  const step = useCallback(
    (d: number) => setOpen((i) => (i === null || count === 0 ? null : (i + d + count) % count)),
    [count],
  );

  // 라이트박스 키 조작. ESC 로 닫고 좌우로 넘긴다.
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, step]);

  if (!gid || !slug || !token) return <Expired />;
  if (q.isLoading) return <Splash message="폴더를 여는 중…" />;
  // 404(만료·비공개·오타)든 다른 실패든 밖에서 볼 수 있는 정보는 같게 둔다.
  // 사유를 갈라 보여 주면 "그 폴더가 있긴 하다"를 알려주는 셈이다.
  if (q.error || !q.data) return <Expired />;

  const cur = open !== null ? photos[open] : undefined;

  return (
    <div style={{ minHeight: "100vh", background: "var(--app)" }}>
      <header
        className="apphead"
        style={{ position: "static", background: "var(--surface)", padding: "18px 26px" }}
      >
        <div className="logo" style={{ padding: 0, fontSize: 15 }}>
          <span className="mk">
            <Icon name="plane" />
          </span>
          TripMate
        </div>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 18 }}>{q.data.folder.name}</h1>
          <div className="dates">
            {q.data.group.name} · 사진·동영상 {count}
          </div>
        </div>
        <div className="end">
          <span className="badge ok">
            <Icon name="img" size={12} />
            공유된 폴더
          </span>
        </div>
      </header>

      <div className="body" style={{ maxWidth: 1180, margin: "0 auto", width: "100%" }}>
        <div className="toolbar">
          <span className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="sort" size={14} />
            정렬
          </span>
          <select
            value={sort}
            aria-label="정렬 기준"
            onChange={(e) => {
              const next = e.target.value === "taken" ? "taken" : "up";
              // 토큰은 주소에 그대로 남겨야 새로고침해도 열린다
              setParams({ t: token, sort: next }, { replace: true });
            }}
          >
            <option value="up">업로드순</option>
            <option value="taken">촬영순</option>
          </select>
          <div className="sp" />
        </div>

        {count === 0 ? (
          <p className="empty">이 폴더에는 아직 사진·동영상이 없습니다.</p>
        ) : (
          <div className="photos">
            {photos.map((p, i) => (
              <div key={p.id}>
                <button
                  onClick={() => setOpen(i)}
                  aria-label={`${p.name} 크게 보기`}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                >
                  {isVideo(p.mime) ? (
                    <video
                      src={p.url}
                      muted
                      playsInline
                      preload="metadata"
                      style={{ width: "100%", height: "100%", objectFit: "cover", background: "#0B0D12" }}
                    />
                  ) : (
                    <img
                      src={p.url}
                      alt={p.name}
                      loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "cover", background: "var(--sunken)" }}
                    />
                  )}
                </button>
                <span className="nm">{p.name}</span>
                <span className="tm">{stamp(sort === "taken" ? p.takenAt : p.uploadedAt)}</span>
                {/* 촬영 시각 메타데이터가 없으면 업로드 시각을 촬영 시각으로 믿는다 — 그 사실을 숨기지 않는다 */}
                {p.takenFallback ? <span className="noexif">촬영 정보 없음</span> : null}
                {isVideo(p.mime) ? (
                  <span className="tm" style={{ top: "auto", bottom: 6, right: 7 }}>
                    동영상
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}

        <p className="note" style={{ textAlign: "center" }}>
          TripMate 로 공유된 폴더입니다.
        </p>
      </div>

      {/* 라이트박스 — 좌우로 넘기고 ESC 로 닫는다 */}
      {cur ? (
        <div
          className="scrim"
          style={{ background: "rgba(11,13,18,.92)", padding: 20 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(null);
          }}
        >
          <div
            style={{
              display: "grid",
              gap: 12,
              justifyItems: "center",
              maxWidth: "min(1100px, 100%)",
            }}
          >
            {isVideo(cur.mime) ? (
              <video
                src={cur.url}
                controls
                autoPlay
                style={{ maxWidth: "100%", maxHeight: "78vh", borderRadius: "var(--r-md)" }}
              />
            ) : (
              <img
                src={cur.url}
                alt={cur.name}
                style={{ maxWidth: "100%", maxHeight: "78vh", borderRadius: "var(--r-md)" }}
              />
            )}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                color: "#fff",
                fontSize: 12.5,
              }}
            >
              <button className="btn btn-ghost btn-sm" onClick={() => step(-1)} aria-label="이전">
                <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}>
                  <Icon name="chev" size={14} />
                </span>
                이전
              </button>
              <span className="num">
                {(open ?? 0) + 1} / {count}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => step(1)} aria-label="다음">
                다음
                <Icon name="chev" size={14} />
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>
                <Icon name="x" size={14} />
                닫기
              </button>
            </div>

            <div style={{ color: "rgba(255,255,255,.72)", fontSize: 11.5 }} className="mono">
              {cur.name}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
