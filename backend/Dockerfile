FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json

ENV HUSKY=0
RUN npm ci

COPY backend ./backend

WORKDIR /app/backend
RUN npm run prisma:generate
RUN npm run build

EXPOSE 3001

CMD ["npm", "run", "start", "--workspace=backend"]
