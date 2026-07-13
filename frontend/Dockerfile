# Build a partir do diretório frontend/ como contexto.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine AS run
# O entrypoint do nginx roda envsubst nos templates -> /etc/nginx/conf.d
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
# Ajuste no EasyPanel: hostname interno do serviço backend (ex.: http://loregrid_loregrid-api:3000)
ENV API_UPSTREAM=http://loregrid-api:3000
EXPOSE 80
