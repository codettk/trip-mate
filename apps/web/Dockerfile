# 웹 이미지. 정적 번들을 nginx 가 서빙하고 /api 는 api 컨테이너로 넘긴다.
#
# VITE_API_BASE 를 비워 두면 브라우저가 같은 오리진(/api)으로 부르고,
# nginx 가 그걸 api 로 프록시한다 — 쿠키가 그대로 붙는다.

FROM node:24-alpine AS build
WORKDIR /app
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE

COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts || npm install --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/web apps/web

RUN npm run build -w @tripmate/core \
 && npm run build -w @tripmate/web

# ── 런타임 ────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
