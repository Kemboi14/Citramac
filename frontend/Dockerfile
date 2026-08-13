# `base` is also the target used by infra/docker-compose.yml for local dev
# (bind-mounted source + `npm run dev`, see infra/docker-compose.yml).
FROM node:20-slim AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS build
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
