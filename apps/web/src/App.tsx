/**
 * 라우팅.
 *
 * 화면은 넷(일정·사진·정산·문서) + 설정뿐이다. 섹션을 늘려 탐색을 무겁게 만들지 않는다.
 * 무언가를 만들거나 고칠 때는 화면을 갈아타지 않는다 — 전부 모달이나 인라인이다.
 * 그래서 라우트가 이만큼밖에 없다.
 */

import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { useGroups, useMe } from "./api/hooks.ts";
import { Shell } from "./layout/Shell.tsx";
import { Splash } from "./components/Splash.tsx";
import { DocsScreen } from "./screens/Docs.tsx";
import { ItineraryScreen } from "./screens/Itinerary.tsx";
import { JoinScreen } from "./screens/Join.tsx";
import { LoginScreen } from "./screens/Login.tsx";
import { OnboardingScreen } from "./screens/Onboarding.tsx";
import { PhotosScreen } from "./screens/Photos.tsx";
import { SettingsScreen } from "./screens/Settings.tsx";
import { SettlementScreen } from "./screens/Settlement.tsx";
import { FolderViewerScreen } from "./screens/viewer/FolderViewer.tsx";
import { SettleViewerScreen } from "./screens/viewer/SettleViewer.tsx";

/** 로그인했고 모임이 있으면 첫 모임으로, 없으면 온보딩으로 보낸다. */
function Landing() {
  const me = useMe();
  const groups = useGroups();

  if (me.isLoading) return <Splash />;
  if (!me.data?.user) return <Navigate to="/login" replace />;
  if (groups.isLoading) return <Splash />;

  const first = groups.data?.groups[0];
  // 모임이 하나도 없는 사용자는 모임 만들기 / 모임 참여하기 두 갈래를 본다
  if (!first) return <Navigate to="/start" replace />;

  const last = localStorage.getItem("tm:lastGroup");
  const target = last && groups.data?.groups.some((g) => g.id === last) ? last : first.id;
  return <Navigate to={`/g/${target}`} replace />;
}

/** 모임 안 화면들은 전부 셸(사이드바 + 헤더) 안에서 그려진다. */
function GroupShell() {
  const { gid } = useParams<{ gid: string }>();
  const me = useMe();
  if (me.isLoading) return <Splash />;
  if (!me.data?.user) return <Navigate to="/login" replace />;
  if (!gid) return <Navigate to="/" replace />;
  return <Shell groupId={gid} />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/start" element={<OnboardingScreen />} />
      <Route path="/join" element={<JoinScreen />} />

      <Route path="/g/:gid" element={<GroupShell />}>
        <Route index element={<ItineraryScreen />} />
        <Route path="photos" element={<PhotosScreen />} />
        <Route path="photos/:fid" element={<PhotosScreen />} />
        <Route path="settle" element={<SettlementScreen />} />
        <Route path="docs" element={<DocsScreen />} />
        <Route path="docs/:did" element={<DocsScreen />} />
        <Route path="settings" element={<SettingsScreen />} />
      </Route>

      {/*
        공개 뷰어 — 로그인하지 않는다. 셸도 사이드바도 없다.

        공유 단위가 폴더에서 묶음으로 바뀌면서 주소가 `/{gid}/view/{token}` 이 됐다.
        옛 주소 `/{gid}/view/{slug}?t={token}` 은 **경로 모양이 똑같아서** 같은 라우트가 받고,
        `?t=` 가 있는지로 화면이 갈라 처리한다. 이미 뿌려 둔 링크가 죽으면 안 된다.
      */}
      <Route path="/:gid/view/:token" element={<FolderViewerScreen />} />
      <Route path="/:gid/view/:token/:slug" element={<FolderViewerScreen />} />
      <Route path="/:gid/settle/:token" element={<SettleViewerScreen />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
