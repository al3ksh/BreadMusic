FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY app ./app
COPY components ./components
COPY lib ./lib
COPY public ./public
COPY next.config.mjs next-env.d.ts tsconfig.json postcss.config.js ./
ENV BREAD_LANDING_PREVIEW=1
ENV NEXT_PUBLIC_API_URL=http://127.0.0.1:9
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV BREAD_LANDING_PREVIEW=1
ENV NEXT_PUBLIC_API_URL=http://127.0.0.1:9
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
