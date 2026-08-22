# 웹 이미지. 정적 번들을 nginx 가 서빙하고 /api 는 API 로 넘긴다.
# 넘길 곳은 API_UPSTREAM 환경변수로 정한다 (compose: api:4000, Fly: <앱>.internal:4000).
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
# 템플릿으로 넣는다 — nginx 진입점이 부팅할 때 envsubst 로 ${API_UPSTREAM} 을 채운다.
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
# compose 기본값. Fly 에서는 <api앱>.internal:4000 으로 덮어쓴다.
ENV API_UPSTREAM=api:4000
# 이걸 켜야 진입점이 /etc/resolv.conf 에서 NGINX_LOCAL_RESOLVERS 를 뽑아 준다.
# 안 켜면 템플릿의 ${NGINX_LOCAL_RESOLVERS} 가 그대로 남아 nginx 가 부팅에 실패한다.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
EXPOSE 80
