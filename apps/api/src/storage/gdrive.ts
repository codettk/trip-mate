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
import type { StorageAdapter, StoredFile } from "./index.ts";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export class GoogleDriveAdapter implements StorageAdapter {
  readonly kind = "gdrive" as const;
  private client: drive_v3.Drive | null = null;

  private drive(): drive_v3.Drive {
    if (this.client) return this.client;
    const oauth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
    oauth.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
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
