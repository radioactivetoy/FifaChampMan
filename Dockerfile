# ChampMan — Node 24 (built-in node:sqlite, no native modules), one runtime dependency (express).
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=3210 \
    DB_PATH=/data/champman.db
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY tools ./tools

# The database (and its start-up backups/, which live next to it) is the only state: keep it on a volume.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3210

# Plain HTTP GET on the home page; node is already in the image, so no curl/wget needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3210)+'/').then(r=>process.exit(r.ok||r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
