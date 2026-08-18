/**
 * 서버 상태는 전부 TanStack Query 로 다룬다. 상태관리 라이브러리를 따로 두지 않는다.
 *
 * 쿼리 키는 항상 `["무엇", groupId, ...]` 형태다.
 * 모임 단위로 리소스가 완전히 분리되므로 groupId 가 두 번째 자리에 오면 무효화가 쉽다.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "./client.ts";
import type {
  DocDetail,
  DocSummary,
  FolderNodeDto,
  FolderView,
  GroupDetail,
  GroupSummary,
  InviteInfo,
  Itinerary,
  Me,
  Member,
  Settlement,
} from "./types.ts";

export const keys = {
  me: ["me"] as const,
  groups: ["groups"] as const,
  group: (gid: string) => ["group", gid] as const,
  members: (gid: string) => ["members", gid] as const,
  itinerary: (gid: string) => ["itinerary", gid] as const,
  settlement: (gid: string) => ["settlement", gid] as const,
  folders: (gid: string) => ["folders", gid] as const,
  folder: (gid: string, fid: string, sort: string) => ["folder", gid, fid, sort] as const,
  docs: (gid: string) => ["docs", gid] as const,
  doc: (gid: string, did: string) => ["doc", gid, did] as const,
  invite: (gid: string) => ["invite", gid] as const,
};

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api.get<{ user: Me | null; authMode: "mock" | "kakao" }>("/api/auth/me"),
    staleTime: 60_000,
  });
}

export function useGroups() {
  return useQuery({
    queryKey: keys.groups,
    queryFn: () => api.get<{ groups: GroupSummary[] }>("/api/groups"),
  });
}

export function useGroup(gid: string | undefined) {
  return useQuery({
    queryKey: keys.group(gid ?? ""),
    queryFn: () => api.get<GroupDetail>(`/api/groups/${gid}`),
    enabled: !!gid,
  });
}

export function useMembers(gid: string | undefined) {
  return useQuery({
    queryKey: keys.members(gid ?? ""),
    queryFn: () => api.get<{ members: Member[] }>(`/api/groups/${gid}/members`),
    enabled: !!gid,
  });
}

export function useItinerary(gid: string | undefined) {
  return useQuery({
    queryKey: keys.itinerary(gid ?? ""),
    queryFn: () => api.get<Itinerary>(`/api/groups/${gid}/itinerary`),
    enabled: !!gid,
  });
}

export function useSettlement(gid: string | undefined, opts?: Partial<UseQueryOptions<Settlement>>) {
  return useQuery({
    queryKey: keys.settlement(gid ?? ""),
    queryFn: () => api.get<Settlement>(`/api/groups/${gid}/settlement`),
    enabled: !!gid,
    ...opts,
  });
}

export function useFolders(gid: string | undefined) {
  return useQuery({
    queryKey: keys.folders(gid ?? ""),
    queryFn: () => api.get<{ root: FolderNodeDto }>(`/api/groups/${gid}/folders`),
    enabled: !!gid,
  });
}

export function useFolder(gid: string | undefined, fid: string | undefined, sort: "up" | "taken") {
  return useQuery({
    queryKey: keys.folder(gid ?? "", fid ?? "", sort),
    queryFn: () => api.get<FolderView>(`/api/groups/${gid}/folders/${fid}?sort=${sort}`),
    enabled: !!gid && !!fid,
  });
}

export function useDocs(gid: string | undefined) {
  return useQuery({
    queryKey: keys.docs(gid ?? ""),
    queryFn: () => api.get<{ docs: DocSummary[] }>(`/api/groups/${gid}/docs`),
    enabled: !!gid,
  });
}

export function useDoc(gid: string | undefined, did: string | undefined) {
  return useQuery({
    queryKey: keys.doc(gid ?? "", did ?? ""),
    queryFn: () => api.get<DocDetail>(`/api/groups/${gid}/docs/${did}`),
    enabled: !!gid && !!did,
  });
}

export function useInvite(gid: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.invite(gid ?? ""),
    queryFn: () => api.get<{ invite: InviteInfo | null }>(`/api/groups/${gid}/invite`),
    enabled: !!gid && enabled,
  });
}

/**
 * 모임 안에서 뭔가를 바꾸면 그 모임의 캐시를 통째로 무효화한다.
 * 항목 하나를 고쳐도 정산 전체가 재계산되기 때문에 부분 무효화가 오히려 위험하다 —
 * 결제자나 정산 대상을 바꾸는 순간 전체가 다시 계산되는 게 이 앱의 핵심 상호작용이다.
 */
export function useInvalidateGroup(gid: string | undefined) {
  const qc = useQueryClient();
  return () => {
    if (!gid) return;
    for (const k of [
      keys.group(gid),
      keys.members(gid),
      keys.itinerary(gid),
      keys.settlement(gid),
      keys.folders(gid),
      keys.docs(gid),
    ]) {
      void qc.invalidateQueries({ queryKey: k });
    }
    void qc.invalidateQueries({ queryKey: ["folder", gid] });
    void qc.invalidateQueries({ queryKey: ["doc", gid] });
  };
}

export function useApiMutation<TVars, TData>(
  fn: (v: TVars) => Promise<TData>,
  gid?: string,
  onDone?: (d: TData) => void,
) {
  const invalidate = useInvalidateGroup(gid);
  return useMutation({
    mutationFn: fn,
    onSuccess: (d) => {
      invalidate();
      onDone?.(d);
    },
  });
}
