/**
 * API 클라이언트.
 *
 * 세션은 httpOnly 쿠키라 토큰을 손으로 붙이지 않는다 — `credentials:"include"` 만 있으면 된다.
 * 개발 중에는 vite 프록시가 /api 를 서버로 넘겨 같은 오리진처럼 보이게 한다.
 */

const BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    override readonly message: string,
    readonly code?: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parse(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(BASE + path, {
    method,
    credentials: "include",
    headers: isForm || body === undefined ? undefined : { "Content-Type": "application/json" },
    body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
    ...init,
  });

  const data = await parse(res);
  if (!res.ok) {
    const e = (data as { error?: { message?: string; code?: string; detail?: unknown } })?.error;
    throw new ApiError(
      res.status,
      e?.message ?? `요청이 실패했습니다 (${res.status})`,
      e?.code,
      e?.detail,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, form),
};

/** 이미지 주소. 서버가 저장소에서 받아 전달한다 — Drive 링크가 아니다. */
export const mediaUrl = (photoId: string, token?: string): string =>
  `${BASE}/api/media/${photoId}${token ? `?t=${encodeURIComponent(token)}` : ""}`;
