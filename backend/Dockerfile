# Build a partir do diretório backend/ como contexto.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY db ./db
EXPOSE 3000
# roda migrations (idempotentes) e sobe a API
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
