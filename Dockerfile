
FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

# アプリケーションファイルを適切な所有者でコピー
COPY --chown=1000:1003 . .

# データディレクトリを作成
RUN mkdir -p /app/data \
    && chown 1000:1003 /app/data

USER 1000:1003

ENV NODE_ENV=production
ENV PORT=3000
ENV MEDIA_DIR=/data/Memory
ENV DATABASE_PATH=/app/data/photo-manager.db

EXPOSE 3000

CMD ["node", "server.js"]
