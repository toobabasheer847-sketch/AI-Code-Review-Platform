FROM node:20-alpine AS builder

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
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_NAME=$VITE_APP_NAME
ENV VITE_STRIPE_PRO_PRICE_ID=$VITE_STRIPE_PRO_PRICE_ID

RUN npm run build --workspace=frontend

FROM node:20-alpine

WORKDIR /app
RUN npm install --global serve
COPY --from=builder /app/frontend/dist ./dist

USER node

EXPOSE 3000

CMD ["serve", "-s", "dist", "-l", "3000"]
