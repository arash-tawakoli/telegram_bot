FROM --platform=linux/amd64 node:24-bookworm-slim

ENV NODE_ENV=production
ENV CI_MAX_ARCHIVE_BYTES=314572800

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tar python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY container ./container

EXPOSE 8080

CMD ["node", "/app/container/server.mjs"]
