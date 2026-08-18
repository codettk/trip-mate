/**
 * API 공통 에러. 라우트에서 throw 하면 app.ts 의 핸들러가 JSON 으로 바꾼다.
 *
 * ⚠ 파라미터 프로퍼티(`constructor(readonly x: number)`)를 쓰지 않는다.
 *   Node 가 .ts 를 타입만 벗겨 실행하는 모드에서는 그 문법이 지원되지 않아 부팅이 터진다.
 *   같은 이유로 이 저장소의 서버 코드에는 enum·namespace·데코레이터도 쓰지 않는다.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly detail: unknown;

  constructor(status: number, message: string, code?: string, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const badRequest = (msg: string, detail?: unknown) => new ApiError(400, msg, "bad_request", detail);
export const unauthorized = (msg = "로그인이 필요합니다") => new ApiError(401, msg, "unauthorized");
export const forbidden = (msg = "권한이 없습니다") => new ApiError(403, msg, "forbidden");
export const notFound = (msg = "찾을 수 없습니다") => new ApiError(404, msg, "not_found");
export const conflict = (msg: string, detail?: unknown) => new ApiError(409, msg, "conflict", detail);
export const gone = (msg = "만료된 링크입니다") => new ApiError(410, msg, "gone");
export const tooLarge = (msg: string) => new ApiError(413, msg, "too_large");
