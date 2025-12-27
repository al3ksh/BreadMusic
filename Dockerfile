FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY . .

RUN mkdir -p /app/data

ENV NODE_ENV=production

CMD ["npm", "start"]
