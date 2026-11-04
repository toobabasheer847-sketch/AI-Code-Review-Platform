FROM node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json

ENV HUSKY=0
RUN npm ci

COPY frontend ./frontend

ARG VITE_API_URL=http://localhost:3001/api
ARG VITE_APP_NAME=AI-CodeGuard
ARG VITE_STRIPE_PRO_PRICE_ID=
ARG VITE_SENTRY_DSN=
ARG VITE_SENTRY_RELEASE=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_NAME=$VITE_APP_NAME
ENV VITE_STRIPE_PRO_PRICE_ID=$VITE_STRIPE_PRO_PRICE_ID
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ENV VITE_SENTRY_RELEASE=$VITE_SENTRY_RELEASE

RUN npm run build --workspace=frontend

FROM nginxinc/nginx-unprivileged:1.29.4-alpine@sha256:a6c4f61f456b85b8fdf7ec7ab28cc3e299440e6fb4a9dea520e5fd8fd440025e

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
