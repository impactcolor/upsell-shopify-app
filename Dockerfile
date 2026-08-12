FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm install

COPY . .

RUN npx prisma generate --schema prisma/postgres/schema.prisma && npm run build
RUN npm prune --omit=dev && npm cache clean --force

CMD ["sh", "-c", "npm run setup:render && npm run start"]
