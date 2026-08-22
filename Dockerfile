# TripMate 단일 이미지 — API 가 웹 번들까지 서빙한다.
#
#   docker compose --profile full up -d --build     로컬에서 배포와 같은 모양으로
#
# 왜 하나인가:
#   무료 호스팅은 안 쓰면 잠든다. 웹과 API 를 따로 두면 웹만 깨어나고 API 는 자고 있어
#   첫 요청이 엇갈린다. 하나로 합치면 깨는 것도 한 번이고 주소도 하나라
#   쿠키·리디렉션·CORS 를 신경 쓸 일이 없다.
#
#   그리고 **로컬에서 띄우는 것과 배포하는 것이 같은 이미지**다.
#   두 벌로 두면 한쪽에서만 되는 버그가 생긴다.

FROM node:24-alpine AS build
WORKDIR /app

# 브라우저 번들에 박히는 값. 비워 두면 같은 오리진(/api)으로 부른다 — 그게 기본이다.
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE

# 의존성 먼저 — 소스가 바뀌어도 이 레이어는 재사용된다
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts || npm install --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/api apps/api
COPY apps/web apps/web

RUN npm run build -w @tripmate/core \
 && npm run build -w @tripmate/api \
 && npm run build -w @tripmate/web

# ── 런타임 ────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache tini

COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/apps/api/package.json apps/api/
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts

COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/apps/api/dist apps/api/dist
# 마이그레이션 SQL 은 컴파일 산출물이 아니라 따로 넣는다 (부팅할 때 읽는다)
COPY --from=build /app/apps/api/src/db/migrations apps/api/dist/db/migrations
# 웹 번들. WEB_DIST 가 이 경로를 가리킨다.
COPY --from=build /app/apps/web/dist apps/web/dist

ENV WEB_DIST=apps/web/dist

# 로컬 저장소 모드일 때 쓰는 볼륨 마운트 지점
RUN mkdir -p /app/.data/storage && chown -R node:node /app/.data
USER node

EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/dist/index.js"]
