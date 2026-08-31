FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src/music/embeds.js src/music/searchUtils.js src/music/sourceNames.js src/music/lyrics.js ./src/music/
COPY src/utils/time.js src/utils/trackTitles.js ./src/utils/
COPY src/theme.js ./src/
COPY web/preview/search ./web/preview/search
USER node
CMD ["node", "web/preview/search/server.cjs"]
