FROM node:24.16.0-bookworm@sha256:40ad9f3064e67d6860b4bc3fe1880b2953934fd6320ada990e45fe0efa6badd7
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pil python3-requests ffmpeg \
    && ln -s /usr/bin/python3 /usr/bin/python && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/deps
COPY backend/package*.json backend/
COPY nodes/package*.json nodes/
COPY frontend/package*.json frontend/
RUN npm ci --prefix backend && npm ci --prefix nodes && npm ci --prefix frontend \
    && mkdir -p frontend/node_modules/.vite-temp
COPY trusted/ /trusted/
USER node
WORKDIR /work
CMD ["node", "/trusted/idle.cjs"]
