# [D] Multi stage Dockerfile for the self-hosted (VPS) deploy target. Vercel
# does not use this file. See docs/design.md section 10 "Portability notes".
#
# Targets, in build order (must stay in this order so a plain `docker build`
# with no --target defaults to the last one, `runner`):
#   deps    - installs node_modules from the lockfile only
#   build   - copies source, runs `prisma generate` and `next build`
#   migrate - runs prisma migrate deploy / prisma db seed against the real db
#   runner  - the app itself, default target, smallest image

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# DIRECT_URL is only needed here so `prisma generate` can read prisma.config.ts
# (it calls env('DIRECT_URL') eagerly at load time). This is a placeholder,
# scoped to this build stage only. It is never copied into the migrate or
# runner stage and never touches a real database.
ARG DIRECT_URL=postgresql://build:build@localhost:5432/build
ENV DIRECT_URL=$DIRECT_URL
RUN npx prisma generate

ENV NEXT_OUTPUT=standalone
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# migrate: runs `prisma migrate deploy` (and, on demand, `prisma db seed`)
# against the real database. Needs the full node_modules plus the prisma
# schema/config/seed files. The real DATABASE_URL / DIRECT_URL come from the
# compose env file at run time, not from this image.
FROM node:22-alpine AS migrate
WORKDIR /app
# openssl: prisma's schema engine binary on alpine needs it, keep it around
# to be safe even though runtime queries go through the pg driver adapter.
RUN apk add --no-cache openssl
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 -G nodejs nextjs
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs package.json package-lock.json ./
COPY --chown=nextjs:nodejs prisma ./prisma
COPY --chown=nextjs:nodejs prisma.config.ts ./
COPY --from=build --chown=nextjs:nodejs /app/lib/generated ./lib/generated
COPY --chown=nextjs:nodejs lib/auth/password.ts ./lib/auth/password.ts
USER nextjs
CMD ["npx", "prisma", "migrate", "deploy"]

# runner: the actual app, default target. Kept last on purpose.
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 -G nodejs nextjs

# Standalone output only copies what next build traced. There is no public/
# folder in this repo, so it is not copied here.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# skills/ is read from disk at runtime by modules/copilot/instructions.ts
# (readFileSync on process.cwd()/skills/crm-copilot/instructions.md), so it
# must be present at /app/skills. Copied explicitly here, see design.md
# section 10.
COPY --from=build --chown=nextjs:nodejs /app/skills ./skills

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
