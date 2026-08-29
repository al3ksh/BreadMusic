FROM node:22-alpine AS bot

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache fontconfig ttf-dejavu

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY assets/breadarcade-logo.png ./assets/breadarcade-logo.png
RUN mkdir -p /app/data

EXPOSE 3001
CMD ["npm", "start"]

FROM node:22-alpine AS web-builder

WORKDIR /app/web
ARG API_URL=http://bot:3001
ENV NEXT_PUBLIC_API_URL=$API_URL
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-alpine AS web

WORKDIR /app/web
ENV NODE_ENV=production

COPY web/package*.json ./
RUN npm ci --omit=dev
COPY --from=web-builder /app/web/.next ./.next
COPY --from=web-builder /app/web/public ./public
COPY --from=web-builder /app/web/next.config.mjs ./next.config.mjs

EXPOSE 3000
CMD ["npm", "start"]
