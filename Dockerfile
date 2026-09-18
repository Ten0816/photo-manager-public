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

COPY . .

RUN mkdir -p /app/data \
    && chown -R 1000:1003 /app

USER 1000:1003

ENV NODE_ENV=production
ENV PORT=3000
ENV MEDIA_DIR=/data/Memory
ENV DATABASE_PATH=/app/data/photo-manager.db

EXPOSE 3000

CMD ["node", "server.js"]
