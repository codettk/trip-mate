# API 이미지.
# 루트를 컨텍스트로 받아 workspace 전체를 넣는다 — @tripmate/core 를 같이 빌드해야 하기 때문이다.
#
#   docker compose --profile full up -d --build

FROM node:24-alpine AS build
WORKDIR /app

# 의존성 먼저 — 소스가 바뀌어도 이 레이어는 재사용된다
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts || npm install --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/api apps/api

RUN npm run build -w @tripmate/core \
 && npm run build -w @tripmate/api

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
# 마이그레이션 SQL 은 컴파일 산출물이 아니라 따로 넣는다 (부팅 시 읽는다)
COPY --from=build /app/apps/api/src/db/migrations apps/api/dist/db/migrations

# 로컬 저장소 모드일 때 쓰는 볼륨 마운트 지점
RUN mkdir -p /app/.data/storage && chown -R node:node /app/.data
USER node

EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/dist/index.js"]
