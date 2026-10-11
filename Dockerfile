# PhysioCoach web (Next.js standalone). Build context = repo root.
#   docker build -t physiocoach-web --build-arg NEXT_PUBLIC_APP_URL=https://physio.algon.tech \
#     --build-arg NEXT_PUBLIC_STREAM_VIDEO_API_KEY=... .
#   docker build -t physiocoach-migrator --target migrator .
# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so they are build args.
# No runtime secret is needed to build: the db and Stream clients are lazy (src/lib/lazy.ts).

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM deps AS build
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_STREAM_VIDEO_API_KEY
ARG NEXT_PUBLIC_STREAM_AGENT_USER_ID=physiocoach-agent
ARG NEXT_PUBLIC_DEMO_MODE=false
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_STREAM_VIDEO_API_KEY=$NEXT_PUBLIC_STREAM_VIDEO_API_KEY \
    NEXT_PUBLIC_STREAM_AGENT_USER_ID=$NEXT_PUBLIC_STREAM_AGENT_USER_ID \
    NEXT_PUBLIC_DEMO_MODE=$NEXT_PUBLIC_DEMO_MODE \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
# Placeholder only so modules that read it at import time can be evaluated during `next build`;
# the real secret is supplied at runtime and this layer is not part of the runtime image.
RUN BETTER_AUTH_SECRET=build-placeholder-not-a-secret-000000000000 npm run build

# Pre-deploy job: apply migrations, then upsert the exercise library (idempotent).
FROM deps AS migrator
COPY drizzle ./drizzle
COPY drizzle.config.ts tsconfig.json ./
COPY shared ./shared
COPY src/db ./src/db
COPY src/lib/lazy.ts ./src/lib/lazy.ts
CMD ["sh", "-c", "npx drizzle-kit migrate && npm run db:seed"]

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
