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

/** 본문 문자열을 JSON 으로. 실패하면 문자열 그대로 (서버가 HTML 오류를 줄 때가 있다). */
function decode(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function parse(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  return decode(await res.text());
}

/** 서버가 주는 `{ error: { message, code, detail } }` 를 ApiError 로. fetch 와 XHR 이 같이 쓴다. */
function toError(status: number, data: unknown): ApiError {
  const e = (data as { error?: { message?: string; code?: string; detail?: unknown } })?.error;
  return new ApiError(status, e?.message ?? `요청이 실패했습니다 (${status})`, e?.code, e?.detail);
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
  if (!res.ok) throw toError(res.status, data);
  return data as T;
}

/** 업로드 진행률. `total` 이 0 이면 브라우저가 전체 크기를 모른다는 뜻이다. */
export interface UploadProgress {
  loaded: number;
  total: number;
}

/**
 * 파일 업로드 — **fetch 가 아니라 XHR 을 쓴다.** fetch 에는 업로드 진행 이벤트가 없다.
 *
 * ⚠ 여기서 나오는 퍼센트는 **브라우저 → TripMate 서버** 구간이다.
 *   서버가 받은 뒤 Google Drive 로 다시 올리는 시간은 이 이벤트에 잡히지 않아서,
 *   100% 에 닿은 다음에도 응답까지 시간이 걸린다. 화면은 그 구간을 "저장 중"이라고
 *   따로 말해야 한다 — 100% 를 완료라고 쓰면 멈춘 것처럼 보인다.
 */
function upload<T>(
  path: string,
  form: FormData,
  onProgress?: (p: UploadProgress) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", BASE + path);
    xhr.withCredentials = true; // 세션 쿠키. fetch 의 credentials:"include" 와 같은 뜻이다

    if (onProgress) {
      xhr.upload.onprogress = (e) =>
        onProgress({ loaded: e.loaded, total: e.lengthComputable ? e.total : 0 });
    }
    xhr.onload = () => {
      const data = decode(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(toError(xhr.status, data));
    };
    // status 0 — 서버가 답을 못 준 경우다. 그 파일 하나만 실패하고 나머지는 계속 간다.
    xhr.onerror = () => reject(new ApiError(0, "연결이 끊겼습니다. 잠시 뒤 다시 올려 주세요"));
    xhr.ontimeout = () => reject(new ApiError(0, "시간이 너무 오래 걸려 멈췄습니다"));
    xhr.onabort = () => reject(new ApiError(0, "업로드를 멈췄습니다"));
    xhr.send(form);
  });
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
  upload: <T>(path: string, form: FormData, onProgress?: (p: UploadProgress) => void) =>
    upload<T>(path, form, onProgress),
};

/** 이미지 주소. 서버가 저장소에서 받아 전달한다 — Drive 링크가 아니다. */
export const mediaUrl = (photoId: string, token?: string): string =>
  `${BASE}/api/media/${photoId}${token ? `?t=${encodeURIComponent(token)}` : ""}`;
