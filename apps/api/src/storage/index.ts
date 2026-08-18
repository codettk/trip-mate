/**
 * ══════════ 저장소 어댑터 ══════════
 *
 * 파일 저장소는 운영자 본인의 Google Drive 한 곳이다. 멤버 개인 Drive 를 쓰지 않는다.
 * 그래서 모임을 만든 사람이 탈퇴해도 사진이 사라지지 않는다 — 소유자는 언제나 서비스다.
 *
 * ⚠ 어떤 구현도 브라우저에 Drive 링크나 서명 URL 을 주지 않는다.
 *   이미지는 항상 서버가 stream() 으로 받아서 /api/media/:photoId 로 전달한다.
 *   그래야 폴더 범위를 앱이 통제할 수 있다.
 *
 * STORAGE_DRIVER=local  개발·테스트. 서버 디스크에 실제 파일로 저장
 * STORAGE_DRIVER=gdrive 운영. OAuth 클라이언트 시크릿 + 리프레시 토큰
 */

import type { Readable } from "node:stream";
import { env } from "../env.ts";

export interface StoredFile {
  /** local: 상대 경로 / gdrive: fileId. DB 의 photos.storage_key 에 들어간다 */
  key: string;
  size: number;
}

export interface StorageAdapter {
  readonly kind: "local" | "gdrive";

  /** 폴더를 만들고 저장소 폴더 id 를 돌려준다. parentId 가 null 이면 루트 아래. */
  createFolder(name: string, parentId: string | null): Promise<string>;

  /** 모임 이름을 바꾸면 Drive 폴더도 리네임한다. id 는 유지되므로 링크가 깨지지 않는다. */
  renameFolder(folderId: string, name: string): Promise<void>;

  /** 폴더를 옮긴다(하위 폴더 이동). */
  moveFolder(folderId: string, newParentId: string): Promise<void>;

  deleteFolder(folderId: string): Promise<void>;

  upload(args: {
    parentId: string;
    name: string;
    mime: string;
    body: Buffer;
  }): Promise<StoredFile>;

  /** 서버가 받아서 전달한다. 절대 URL 을 돌려주지 않는다. */
  stream(key: string): Promise<Readable>;

  deleteFile(key: string): Promise<void>;

  /** 연결이 살아 있는가 — /api/health 에서 확인한다 */
  healthy(): Promise<boolean>;
}

let cached: StorageAdapter | null = null;

export async function storage(): Promise<StorageAdapter> {
  if (cached) return cached;
  if (env.STORAGE_DRIVER === "gdrive") {
    const { GoogleDriveAdapter } = await import("./gdrive.ts");
    cached = new GoogleDriveAdapter();
  } else {
    const { LocalAdapter } = await import("./local.ts");
    cached = new LocalAdapter();
  }
  return cached;
}

/** 테스트에서 어댑터를 갈아끼운다. */
export function __setStorage(a: StorageAdapter | null): void {
  cached = a;
}

/** 업로드를 허용하는 확장자·MIME. 트랜스코딩은 하지 않는다. */
export const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/avif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

export const isVideo = (mime: string): boolean => mime.startsWith("video/");
