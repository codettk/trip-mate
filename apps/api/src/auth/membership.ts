/**
 * 모임 멤버십 확인.
 *
 * 모든 리소스가 group_id 를 갖고, 모든 라우트는 "이 사람이 이 모임의 (안 나간) 멤버인가"를 먼저 묻는다.
 * 폴더별 권한은 없다 — 멤버는 모임 안의 모든 것을 그대로 본다.
 */

import { db } from "../db/client.ts";
import { forbidden, notFound } from "../lib/http.ts";
import type { AuthUser } from "./session.ts";

export interface Membership {
  groupId: string;
  memberId: string;
  role: "owner" | "member";
  name: string;
  isOwner: boolean;
}

/** 모임 멤버인지 확인하고 내 멤버 행을 돌려준다. 나간 멤버는 접근할 수 없다. */
export async function requireMember(user: AuthUser, groupId: string): Promise<Membership> {
  const group = await db
    .selectFrom("groups")
    .select(["id", "deleted_at"])
    .where("id", "=", groupId)
    .executeTakeFirst();
  if (!group || group.deleted_at) throw notFound("모임을 찾을 수 없습니다");

  const m = await db
    .selectFrom("members")
    .select(["id", "role", "name", "left_at"])
    .where("group_id", "=", groupId)
    .where("user_id", "=", user.id)
    .executeTakeFirst();

  if (!m) throw forbidden("이 모임의 멤버가 아닙니다");
  if (m.left_at) throw forbidden("이미 나간 모임입니다");

  return {
    groupId,
    memberId: m.id,
    role: m.role,
    name: m.name,
    isOwner: m.role === "owner",
  };
}

/** 방장만 할 수 있는 일 — 초대 발급, 모임 삭제, 정산 마감 해제, 멤버 내보내기 */
export async function requireOwner(user: AuthUser, groupId: string): Promise<Membership> {
  const m = await requireMember(user, groupId);
  if (!m.isOwner) throw forbidden("방장만 할 수 있습니다");
  return m;
}

/** 그 모임의 전원 (나간 멤버 포함). 정산 계산에 그대로 쓴다. */
export async function allMembers(groupId: string) {
  // 프로필 사진은 users 에만 있다. 멤버 표시에 쓰려면 여기서 같이 가져와야 한다.
  return db
    .selectFrom("members")
    .innerJoin("users", "users.id", "members.user_id")
    .select([
      "members.id as id",
      "members.user_id as user_id",
      "members.name as name",
      "members.color_bg as color_bg",
      "members.color_fg as color_fg",
      "members.role as role",
      "members.left_at as left_at",
      "members.joined_at as joined_at",
      "users.avatar_url as avatar_url",
    ])
    .where("members.group_id", "=", groupId)
    .orderBy("members.joined_at", "asc")
    .orderBy("members.id", "asc")
    .execute();
}
