/**
 * 공유 뷰어 — `/{gid}/view/{token}` · `/{gid}/view/{token}/{slug}`
 *
 * **모임 밖 사람이 보는 화면이다.** 로그인하지 않는다. 셸도 사이드바도 없다.
 *
 * 공유 단위는 폴더가 아니라 **묶음**이다. 링크 하나가 여러 폴더를 담을 수 있고,
 * 뷰어는 **그 묶음 안에서만** 돌아다닌다.
 *
 * 여기서 할 수 없어야 하는 것 (CLAUDE.md 확정):
 *  · 묶음 밖으로 나가기 — 서버가 목록에서 빼 주고, 화면에도 임의 slug 로 가는 통로가 없다
 *  · 업로드·삭제 — 쓰기 동작이 하나도 없다
 *  · 문서·일정·정산으로 넘어가기 — 이 파일에는 앱 안으로 들어가는 링크가 없다
 *
 * 이미지 주소는 **서버가 준 `photo.url` 을 그대로 쓴다.**
 * Drive 파일 링크나 서명 URL 을 만들지 않는다 — 서버가 저장소에서 받아 전달한다.
 *
 * 멤버가 열면 서버가 `memberView:true` 를 준다. 그래도 **자동으로 앱에 보내지 않는다** —
 * 방장이 "밖에서는 뭐가 보이는지" 확인하려고 일부러 여는 경우가 있어서, 배너만 띄운다.
 *
 * 링크가 어긋나면 서버가 404 를 준다. 화면도 "만료되었거나 잘못된 주소"라고만 말하고
 * 폴더가 있는지 없는지 짐작할 정보를 주지 않는다.
 */

import { useQuery } from "@tanstack/react-query";
import { kstStamp, sharePath, sharedFolderPath } from "@tripmate/core";
import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api/client.ts";
import { Icon } from "../../components/Icon.tsx";
import { Splash } from "../../components/Splash.tsx";
import { ViewerHeader } from "./ViewerHeader.tsx";

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
  /** 참이면 이 모임의 안 나간 멤버가 열었다. 내용은 그대로 오고 배너만 띄운다 */
  memberView: boolean;
  groupId: string;
  group: { name: string };
  link: { label: string };
  /** null 이면 묶음 루트 — 담긴 최상위 폴더가 여럿이라 고르는 화면이다 */
  folder: { name: string; slug: string } | null;
  /** 묶음 루트까지만. 바깥 조상은 오지 않는다 */
  breadcrumb: Array<{ name: string; slug: string }>;
  /** 묶음에 속한 직속 하위만. ⚠ 폴더 id 가 없다 — 이동은 slug 로만 한다 */
  folders: Array<{ name: string; slug: string; photoCount: number }>;
  photos: ViewerPhoto[];
}

type Sort = "up" | "taken";

/**
 * 촬영/업로드 시각. **항상 한국 시간이다** — 링크를 받은 사람이 어느 나라에서 열든 같은 숫자다.
 * 앱 화면(Lightbox)과 같은 규칙을 쓴다. 복사본을 두면 한쪽만 고쳐진다.
 */
const stamp = (iso: string): string => kstStamp(iso);

const isVideo = (mime: string): boolean => mime.startsWith("video/");

/** 만료·오타·비공개 전환을 하나의 화면으로 처리한다. 어느 쪽인지 알려주지 않는다. */
function Expired() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--app)" }}>
      <ViewerHeader />
      <div style={{ display: "grid", placeItems: "center", padding: 24, minHeight: "70vh" }}>
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
    </div>
  );
}

export function FolderViewerScreen() {
  // 두 형태의 주소를 다 받는다.
  //   새 주소  /:gid/view/:token[/:slug]   ← token 이 경로에 있다
  //   옛 주소  /:gid/view/:slug?t=token    ← 이미 뿌려 둔 링크가 실제로 있어 살려 둔다
  const { gid, token: pathToken, slug: pathSlug } = useParams<{
    gid: string;
    token?: string;
    slug?: string;
  }>();
  const [params, setParams] = useSearchParams();
  const queryToken = params.get("t") ?? "";
  // 두 주소의 **경로 모양이 같다** (`/:gid/view/:x`). 그래서 구분은 `?t=` 유무로 한다:
  //   `?t=` 가 있으면 옛 주소다 — 경로 조각은 slug 이고 토큰은 쿼리에 있다
  //   없으면 새 주소다 — 경로 조각이 토큰이고, 뒤에 slug 가 더 붙을 수 있다
  const legacy = queryToken !== "";
  const token = legacy ? queryToken : (pathToken ?? "");
  const slug = legacy ? pathToken : pathSlug;
  const sort: Sort = params.get("sort") === "taken" ? "taken" : "up";

  const [open, setOpen] = useState<number | null>(null);

  const q = useQuery<ViewerFolder>({
    // 훅에 없는 라우트라 여기서 직접 부른다 — 뷰어는 세션이 아니라 토큰으로만 열린다
    queryKey: ["view-share", gid ?? "", token, slug ?? "", sort],
    queryFn: () => {
      // 옛 주소는 서버의 호환 라우트로, 새 주소는 묶음 라우트로 보낸다.
      const path = legacy
        ? `/api/view/${gid}/folder/${encodeURIComponent(slug ?? "")}?t=${encodeURIComponent(token)}&sort=${sort}`
        : slug
          ? `/api/view/${gid}/share/${encodeURIComponent(token)}/${encodeURIComponent(slug)}?sort=${sort}`
          : `/api/view/${gid}/share/${encodeURIComponent(token)}?sort=${sort}`;
      return api.get<ViewerFolder>(path);
    },
    enabled: !!gid && !!token,
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

  if (!gid || !token) return <Expired />;
  if (q.isLoading) return <Splash message="사진을 여는 중…" />;
  // 404(만료·비공개·오타)든 다른 실패든 밖에서 볼 수 있는 정보는 같게 둔다.
  // 사유를 갈라 보여 주면 "그 폴더가 있긴 하다"를 알려주는 셈이다.
  if (q.error || !q.data) return <Expired />;

  const cur = open !== null ? photos[open] : undefined;

  return (
    <div style={{ minHeight: "100vh", background: "var(--app)" }}>
      <ViewerHeader />

      {/*
        멤버가 열었을 때. 자동으로 앱으로 보내지 않는다 —
        방장이 "밖에서는 뭐가 보이는지" 확인하려고 일부러 여는 경우가 있다.
      */}
      {q.data.memberView ? (
        <div style={{ maxWidth: 1180, margin: "14px auto 0", padding: "0 26px", width: "100%" }}>
          <div className="tip" style={{ alignItems: "center" }}>
            <Icon name="bulb" />
            <span>
              이 모임의 멤버입니다. <b>지금 보이는 화면은 외부인이 보는 것과 같습니다.</b>
            </span>
            <a
              className="btn btn-sm"
              style={{ marginLeft: "auto", textDecoration: "none" }}
              href={`/g/${q.data.groupId}/photos`}
            >
              앱에서 열기
            </a>
          </div>
        </div>
      ) : null}

      <header
        className="apphead"
        style={{ position: "static", background: "var(--surface)", padding: "18px 26px" }}
      >
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 18 }}>{q.data.folder?.name ?? q.data.link.label}</h1>
          <div className="dates">
            {q.data.group.name} · 사진·동영상 {count}
            {q.data.folders.length ? ` · 폴더 ${q.data.folders.length}개` : ""}
          </div>
        </div>
        <div className="end">
          <span className="badge ok">
            <Icon name="img" size={12} />
            공유된 사진
          </span>
        </div>      </header>

      <div className="body" style={{ maxWidth: 1180, margin: "0 auto", width: "100%" }}>
        {/* 묶음 안에서만 오간다. 서버가 준 경로만 쓰고 주소를 짐작해 만들지 않는다 */}
        {q.data.breadcrumb.length > 1 || (slug && !legacy) ? (
          <div className="crumbs">
            <span>
              <a href={sharePath(gid, token)} style={{ textDecoration: "none" }}>
                {q.data.link.label || "공유"}
              </a>
            </span>
            {q.data.breadcrumb.map((c, i) => (
              <span key={c.slug}>
                <Icon name="chev" size={12} />
                {i === q.data!.breadcrumb.length - 1 ? (
                  <b>{c.name}</b>
                ) : (
                  <a href={sharedFolderPath(gid, token, c.slug)} style={{ textDecoration: "none" }}>
                    {c.name}
                  </a>
                )}
              </span>
            ))}
          </div>
        ) : null}

        {q.data.folders.length ? (
          <>
            <div className="seclabel">폴더 {q.data.folders.length}</div>
            <div className="folders">
              {q.data.folders.map((f) => (
                <a
                  key={f.slug}
                  className="fcard"
                  href={sharedFolderPath(gid, token, f.slug)}
                  style={{ textDecoration: "none" }}
                >
                  <span className="tile" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>
                    <Icon name="folder" />
                  </span>
                  <span className="txt">
                    <b>{f.name}</b>
                    <small>{f.photoCount}개</small>
                  </span>
                </a>
              ))}
            </div>
          </>
        ) : null}

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
              // 옛 주소는 토큰이 쿼리에 있으므로 함께 남겨야 새로고침해도 열린다.
              // 새 주소는 토큰이 경로에 있어서 sort 만 쓴다.
              setParams(legacy ? { t: token, sort: next } : { sort: next }, { replace: true });
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
