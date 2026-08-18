/**
 * 개발·테스트용 로컬 디스크 저장소.
 *
 * Google Drive 어댑터와 인터페이스가 같으므로, 사용자가 나중에 키만 넣고
 * STORAGE_DRIVER=gdrive 로 바꾸면 코드 수정 없이 전환된다.
 *
 * 폴더 id 는 uuid 이고, 실제 디렉터리도 그 uuid 이름으로 만든다.
 * 이름이 겹치거나 한글이 섞여도 파일시스템이 흔들리지 않는다.
 */

import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { env } from "../env.ts";
import { notFound } from "../lib/http.ts";
import type { StorageAdapter, StoredFile } from "./index.ts";

const ROOT = resolve(process.cwd(), env.LOCAL_STORAGE_DIR);
const META = join(ROOT, "_folders.json");

type Meta = Record<string, { name: string; parentId: string | null }>;

export class LocalAdapter implements StorageAdapter {
  readonly kind = "local" as const;

  private async meta(): Promise<Meta> {
    try {
      return JSON.parse(await readFile(META, "utf8")) as Meta;
    } catch {
      return {};
    }
  }

  private async saveMeta(m: Meta): Promise<void> {
    await mkdir(ROOT, { recursive: true });
    await writeFile(META, JSON.stringify(m, null, 2), "utf8");
  }

  async createFolder(name: string, parentId: string | null): Promise<string> {
    const id = randomUUID();
    await mkdir(join(ROOT, id), { recursive: true });
    const m = await this.meta();
    m[id] = { name, parentId };
    await this.saveMeta(m);
    return id;
  }

  async renameFolder(folderId: string, name: string): Promise<void> {
    const m = await this.meta();
    if (m[folderId]) {
      m[folderId].name = name;
      await this.saveMeta(m);
    }
  }

  async moveFolder(folderId: string, newParentId: string): Promise<void> {
    const m = await this.meta();
    if (m[folderId]) {
      m[folderId].parentId = newParentId;
      await this.saveMeta(m);
    }
  }

  async deleteFolder(folderId: string): Promise<void> {
    await rm(join(ROOT, folderId), { recursive: true, force: true });
    const m = await this.meta();
    delete m[folderId];
    await this.saveMeta(m);
  }

  async upload(args: {
    parentId: string;
    name: string;
    mime: string;
    body: Buffer;
  }): Promise<StoredFile> {
    const dir = join(ROOT, args.parentId);
    await mkdir(dir, { recursive: true });
    const ext = args.name.includes(".") ? args.name.slice(args.name.lastIndexOf(".")) : "";
    const fileName = randomUUID() + ext;
    await writeFile(join(dir, fileName), args.body);
    return { key: `${args.parentId}/${fileName}`, size: args.body.byteLength };
  }

  async stream(key: string): Promise<Readable> {
    const path = resolve(ROOT, key);
    // 경로 탈출 방지 — key 는 DB 에서 오지만 방어한다
    if (!path.startsWith(ROOT)) throw notFound("파일을 찾을 수 없습니다");
    return createReadStream(path);
  }

  async deleteFile(key: string): Promise<void> {
    const path = resolve(ROOT, key);
    if (!path.startsWith(ROOT)) return;
    await rm(path, { force: true });
  }

  async healthy(): Promise<boolean> {
    try {
      await mkdir(ROOT, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }
}
