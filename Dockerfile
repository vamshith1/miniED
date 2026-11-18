# One image for the whole app: the API, the built React app and the email worker,
# the same single service that runs on Render. Used by docker-compose.yml.

# ---- Build the web app ----
FROM node:24-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Build the API ----
FROM node:24-slim AS server
# Prisma's engines need OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# ---- Run ----
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app/server
# node_modules keeps the Prisma CLI (used to apply migrations on start) and tsx (for the seed script).
COPY --from=server /app/server/node_modules ./node_modules
COPY --from=server /app/server/dist ./dist
COPY --from=server /app/server/prisma ./prisma
COPY --from=server /app/server/package.json ./
COPY --from=client /app/client/dist /app/client/dist
RUN chown -R node:node /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Applies any new database migrations, then starts the server.
CMD ["npm", "run", "start:prod"]
