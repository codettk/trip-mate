/**
 * Google Drive 리프레시 토큰을 새로 받는다.
 *
 *   node scripts/drive-reauth.mjs
 *
 * 데스크톱 앱 클라이언트라 로컬 루프백(53682)으로 코드를 받을 수 있다.
 * 브라우저에서 승인하는 것은 사용자 본인이고, 이 스크립트는 코드만 받아 토큰으로 바꾼다.
 * 새 토큰은 config/token.json 에 쓰고, 이전 값은 config/token.json.bak 으로 남긴다.
 *
 * 언제 필요한가:
 *  · 게시 상태가 "테스트 중"이면 리프레시 토큰이 7일마다 죽는다 → 그때마다 다시 돌린다
 *  · 프로덕션으로 게시한 뒤 한 번 더 돌리면 만료가 없어진다
 *  · invalid_grant 가 뜨면 토큰이 죽은 것이다
 *
 * 받은 값은 .env 의 GOOGLE_REFRESH_TOKEN 에도 넣어야 서버가 쓴다.
 */
import fs from "node:fs";
import http from "node:http";

const sec = JSON.parse(fs.readFileSync("config/google_client_secret.json", "utf8"));
const cred = sec.installed ?? sec.web;
const SCOPE = process.env.SCOPE ?? "https://www.googleapis.com/auth/drive.file";
const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;

const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
url.searchParams.set("client_id", cred.client_id);
url.searchParams.set("redirect_uri", REDIRECT);
url.searchParams.set("response_type", "code");
url.searchParams.set("scope", SCOPE);
url.searchParams.set("access_type", "offline");   // 리프레시 토큰을 받으려면 필수
url.searchParams.set("prompt", "consent");        // 이미 동의했어도 새 리프레시 토큰을 강제로 받는다

console.log("\n아래 주소를 브라우저에서 열고 본인 구글 계정으로 승인하세요:\n");
console.log(url.toString());
console.log("\n승인이 끝나면 자동으로 이어집니다. (30분 뒤 만료)\n");

const server = http.createServer(async (req, res) => {
  const q = new URL(req.url, REDIRECT).searchParams;
  const code = q.get("code");
  const err = q.get("error");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  if (!code) { res.end(`<h3>실패: ${err ?? "code 없음"}</h3>`); return; }
  res.end("<h3>완료되었습니다. 이 창을 닫고 터미널로 돌아가세요.</h3>");

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cred.client_id, client_secret: cred.client_secret,
      code, grant_type: "authorization_code", redirect_uri: REDIRECT,
    }),
  });
  const t = await r.json();
  if (!t.refresh_token) {
    console.log("리프레시 토큰이 오지 않았습니다:", JSON.stringify(t).slice(0, 300));
    process.exit(1);
  }
  const tokPath = "config/token.json";
  const prev = JSON.parse(fs.readFileSync(tokPath, "utf8"));
  fs.writeFileSync(tokPath + ".bak", JSON.stringify(prev, null, 2));
  fs.writeFileSync(tokPath, JSON.stringify({ ...prev, refresh_token: t.refresh_token }, null, 2));
  console.log(`새 리프레시 토큰을 ${tokPath} 에 저장했습니다 (이전 값은 .bak).`);
  console.log(`스코프: ${t.scope}`);

  // .env 까지 같이 갈아 끼운다 — 손으로 옮기다 한쪽만 바뀌는 일을 없앤다.
  try {
    const env = fs.readFileSync(".env", "utf8");
    if (/^GOOGLE_REFRESH_TOKEN=.*$/m.test(env)) {
      fs.writeFileSync(
        ".env",
        env.replace(/^GOOGLE_REFRESH_TOKEN=.*$/m, `GOOGLE_REFRESH_TOKEN=${t.refresh_token}`),
      );
      console.log(".env 의 GOOGLE_REFRESH_TOKEN 도 갱신했습니다. API 를 재시작하세요.");
    }
  } catch {
    console.log(".env 를 못 고쳤습니다 — GOOGLE_REFRESH_TOKEN 을 직접 넣어 주세요.");
  }

  server.close();
  process.exit(0);
});
server.listen(PORT);
setTimeout(() => { console.log("시간 초과"); process.exit(1); }, 30 * 60 * 1000);
