FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY web/package*.json ./web/

RUN npm ci
RUN npm ci --prefix web

COPY src/ ./src/
COPY web/ ./web/

RUN npm run build --prefix web

RUN npm ci --only=production

COPY . .

RUN mkdir -p /app/data

ENV NODE_ENV=production

EXPOSE 3001

CMD ["npm", "start"]
