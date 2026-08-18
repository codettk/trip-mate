/**
 * 테스트 하니스 — 라우터 + TanStack Query + 가짜 API 를 한 번에 세운다.
 *
 * 화면마다 다시 만들지 않는다. 여기서 바꾸면 모든 렌더 테스트가 같이 따라온다.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App.tsx";
import * as F from "./fixtures.ts";
import { installFakeApi, type Ctx, type FakeApi, type RouteMap } from "./server.ts";

/** 테스트용 QueryClient — 재시도도 캐시 보존도 하지 않는다. */
export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

/** 시드와 같은 값을 주는 기본 라우트 표. 테스트가 필요한 것만 덮어쓴다. */
export function defaultRoutes(overrides: RouteMap = {}): RouteMap {
  return {
    "GET /api/auth/me": { user: F.ME, authMode: "mock" },
    "GET /api/groups": { groups: [F.groupSummary] },
    "GET /api/groups/:gid": F.groupDetail,
    "GET /api/groups/:gid/members": { members: F.members },
    "GET /api/groups/:gid/itinerary": F.itinerary,
    "GET /api/groups/:gid/settlement": F.settlement,
    "GET /api/groups/:gid/settlement/share": F.settleShare,
    "GET /api/groups/:gid/folders": { root: F.folderRoot },
    "GET /api/groups/:gid/folders/:fid": ({ params }: Ctx) => F.folderView(params.fid ?? "f-root"),
    "GET /api/groups/:gid/shares": F.shareList,
    "GET /api/groups/:gid/docs": { docs: [F.docSummary] },
    "GET /api/groups/:gid/docs/:did": F.docDetail,
    "GET /api/groups/:gid/invite": { invite: F.invite },
    "GET /api/groups/:gid/leave-check": F.leaveCheck,
    "GET /api/groups/:gid/rates": { date: "2026-09-12", cur: "KRW", rate: 1 },
    "GET /api/health": F.health,
    "GET /api/invites/:code": F.invitePeek,
    // 뷰어는 두 주소를 다 받는다 — 옛 링크가 죽으면 안 된다
    "GET /api/view/:gid/folder/:slug": F.folderViewer,
    "GET /api/view/:gid/share/:token": F.folderViewer,
    "GET /api/view/:gid/share/:token/:slug": F.folderViewer,
    "GET /api/view/:gid/settle/:token": F.settleView,
    ...overrides,
  };
}

export interface Harness extends RenderResult {
  api: FakeApi;
  client: QueryClient;
}

function Providers({ client, route, children }: { client: QueryClient; route: string; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

/** 앱 전체를 라우트 하나로 띄운다. 실제 라우팅을 그대로 지난다. */
export function renderApp(route: string, overrides: RouteMap = {}): Harness {
  const api = installFakeApi(defaultRoutes(overrides));
  const client = testQueryClient();
  const result = render(
    <Providers client={client} route={route}>
      <App />
    </Providers>,
  );
  return { ...result, api, client };
}

/** 컴포넌트 하나만 띄운다 (모달 등). */
export function renderUi(ui: ReactElement, route = `/g/${F.GID}`, overrides: RouteMap = {}): Harness {
  const api = installFakeApi(defaultRoutes(overrides));
  const client = testQueryClient();
  const result = render(
    <Providers client={client} route={route}>
      {ui}
    </Providers>,
  );
  return { ...result, api, client };
}

/** 화면 전체에서 읽히는 글자. 확정 규칙을 문구 단위로 검사할 때 쓴다. */
export const visibleText = (): string => document.body.textContent ?? "";

/** 버튼·링크의 라벨만 모은다. "UI 가 없다"를 확인할 때는 문구가 아니라 조작 수단을 본다. */
export function actionLabels(root: HTMLElement | Document = document): string[] {
  return Array.from(root.querySelectorAll("button, a, input[type=submit], [role=button]")).map(
    (el) => (el.textContent ?? "") + " " + (el.getAttribute("aria-label") ?? ""),
  );
}
