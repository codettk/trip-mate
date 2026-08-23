/**
 * 운영자 Google Drive 어댑터.
 *
 * 인증은 OAuth 클라이언트 시크릿 + 리프레시 토큰이다. 서비스 계정 키도, API 키도 아니다.
 * (API 키로는 업로드가 되지 않는다.)
 * 시크릿과 토큰은 서버 환경변수로만 두고, 업로드·다운로드·폴더 조작은 전부 서버를 통한다.
 *
 * ⚠ 이 파일 어디에서도 webViewLink / webContentLink 를 밖으로 내보내지 않는다.
 *   Drive 공유를 켜지도 않는다. 공유는 TripMate 가 관리한다.
 *
 * 사용자가 개발 완료 후 .env 에 아래 넷을 채우고 STORAGE_DRIVER=gdrive 로 바꾸면 켜진다:
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN / GOOGLE_DRIVE_ROOT_FOLDER_ID
 */

import { Readable } from "node:stream";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import { env } from "../env.ts";
import { ApiError } from "../lib/http.ts";
import type { StorageAdapter, StoredFile, StoredThumb } from "./index.ts";

const FOLDER_MIME = "application/vnd.google-apps.folder";

/**
 * 썸네일 바이트를 메모리에 잠깐 들고 있는다.
 *
 * 두 가지를 한꺼번에 막는다:
 *  · thumbnailLink 는 **수명이 짧다.** 매번 files.get 을 다시 불러야 한다.
 *  · Drive 썸네일은 **요청이 몰리면 429** 를 준다. 실제로 받아 봤다.
 * 한 장이 30~40KB 라 몇백 장을 들고 있어도 몇 MB 다.
 */
const THUMB_CACHE = new Map<string, StoredThumb>();
const THUMB_CACHE_MAX = 300;

function cacheThumb(k: string, v: StoredThumb): void {
  // 가장 오래된 것부터 버린다 (Map 은 넣은 순서를 지킨다)
  if (THUMB_CACHE.size >= THUMB_CACHE_MAX) {
    const oldest = THUMB_CACHE.keys().next().value;
    if (oldest !== undefined) THUMB_CACHE.delete(oldest);
  }
  THUMB_CACHE.set(k, v);
}

export class GoogleDriveAdapter implements StorageAdapter {
  readonly kind = "gdrive" as const;
  private client: drive_v3.Drive | null = null;
  /** 썸네일은 googleapis 를 거치지 않고 직접 받아야 해서 토큰이 따로 필요하다 */
  private oauth: InstanceType<typeof google.auth.OAuth2> | null = null;

  private drive(): drive_v3.Drive {
    if (this.client) return this.client;
    const oauth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
    oauth.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
    this.oauth = oauth;
    this.client = google.drive({ version: "v3", auth: oauth });
    return this.client;
  }

  private root(): string | null {
    return env.GOOGLE_DRIVE_ROOT_FOLDER_ID || null;
  }

  async createFolder(name: string, parentId: string | null): Promise<string> {
    const parent = parentId ?? this.root();
    const res = await this.drive().files.create({
      requestBody: {
        name,
        mimeType: FOLDER_MIME,
        ...(parent ? { parents: [parent] } : {}),
      },
      fields: "id",
      supportsAllDrives: true,
    });
    const id = res.data.id;
    if (!id) throw new ApiError(502, "Drive 폴더를 만들지 못했습니다");
    return id;
  }

  async renameFolder(folderId: string, name: string): Promise<void> {
    await this.drive().files.update({
      fileId: folderId,
      requestBody: { name },
      supportsAllDrives: true,
    });
  }

  /**
   * 사진 이름을 바꾸면 Drive 파일명도 따라간다.
   * `key` 가 곧 fileId 라 이름을 바꿔도 식별자는 그대로다 — 링크가 깨지지 않는다.
   */
  async renameFile(key: string, name: string): Promise<void> {
    await this.drive().files.update({
      fileId: key,
      requestBody: { name },
      supportsAllDrives: true,
    });
  }

  async moveFolder(folderId: string, newParentId: string): Promise<void> {
    const cur = await this.drive().files.get({
      fileId: folderId,
      fields: "parents",
      supportsAllDrives: true,
    });
    await this.drive().files.update({
      fileId: folderId,
      addParents: newParentId,
      removeParents: (cur.data.parents ?? []).join(","),
      supportsAllDrives: true,
    });
  }

  async deleteFolder(folderId: string): Promise<void> {
    // 휴지통으로 보낸다. 영구 삭제하지 않는다 — 사진 유실이 가장 비싼 사고다.
    await this.drive().files.update({
      fileId: folderId,
      requestBody: { trashed: true },
      supportsAllDrives: true,
    });
  }

  async upload(args: {
    parentId: string;
    name: string;
    mime: string;
    body: Buffer;
  }): Promise<StoredFile> {
    const res = await this.drive().files.create({
      requestBody: { name: args.name, parents: [args.parentId] },
      media: { mimeType: args.mime, body: Readable.from(args.body) },
      fields: "id,size",
      supportsAllDrives: true,
    });
    const id = res.data.id;
    if (!id) throw new ApiError(502, "Drive 업로드에 실패했습니다");
    return { key: id, size: Number(res.data.size ?? args.body.byteLength) };
  }

  async stream(key: string): Promise<Readable> {
    const res = await this.drive().files.get(
      { fileId: key, alt: "media", supportsAllDrives: true },
      { responseType: "stream" },
    );
    return res.data as unknown as Readable;
  }

  /**
   * Drive 가 이미 만들어 둔 썸네일을 받아 온다. 우리가 리사이즈하지 않는다 —
   * 무료 인스턴스에서 이미지 처리를 돌리는 것보다 이쪽이 싸고, 동영상은 포스터 프레임까지 준다.
   *
   * thumbnailLink 는 `...=s220` 으로 끝난다. 그 숫자를 바꾸면 원하는 크기가 나온다.
   */
  async thumbnail(key: string, size: number): Promise<StoredThumb | null> {
    const cacheKey = `${key}:${size}`;
    const hit = THUMB_CACHE.get(cacheKey);
    if (hit) return hit;

    try {
      const meta = await this.drive().files.get({
        fileId: key,
        fields: "thumbnailLink,hasThumbnail",
        supportsAllDrives: true,
      });
      const link = meta.data.thumbnailLink;
      if (!link) return null;

      // 액세스 토큰을 붙여 받는다. (이 주소는 토큰 없이도 열리지만, 그렇다고
      //  브라우저에 넘길 수는 없다 — 넘기는 순간 누구나 볼 수 있는 주소가 된다.)
      const token = (await this.oauth?.getAccessToken())?.token ?? null;

      const url = link.replace(/=s\d+(-c)?$/, `=s${size}`);
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      // 429(요청 제한)·404 등은 실패가 아니라 "지금은 없다"로 다룬다 → 원본으로 되돌아간다
      if (!res.ok) return null;

      const mime = res.headers.get("content-type") ?? "image/jpeg";
      if (!mime.startsWith("image/")) return null;

      const thumb: StoredThumb = { body: Buffer.from(await res.arrayBuffer()), mime };
      cacheThumb(cacheKey, thumb);
      return thumb;
    } catch {
      return null; // 썸네일 때문에 사진이 안 보이면 안 된다
    }
  }

  async deleteFile(key: string): Promise<void> {
    await this.drive().files.update({
      fileId: key,
      requestBody: { trashed: true },
      supportsAllDrives: true,
    });
  }

  async healthy(): Promise<boolean> {
    try {
      await this.drive().about.get({ fields: "user" });
      return true;
    } catch {
      return false;
    }
  }
}
