# Decisions

This file is the decision log for the project. It records decisions that change or replace
a contract already written in `docs/design.md`, once Pakorn (the integration owner) has
accepted them. It is not for open requests: an open request that still needs a decision goes
in `docs/contract-change-requests.md` first, and only moves here once Pakorn has decided.

Newest entries go at the top.

## Template

```
### D-<number>: <short title>

- Date: <YYYY-MM-DD>
- Status: <Accepted | Superseded>, by Pakorn
- Context: <what was planned before, and why it needed to change>
- Decision: <what was decided, in plain terms>
- Consequences: <what this enables, what it rules out, what still needs a follow up decision>
- Related: <CR numbers, PR numbers, branch names, design.md sections>
```

## Log

### D-1: Deploy to the existing VPS instead of Vercel and Neon

- Date: 2026-09-18
- Status: Accepted, by Pakorn
- Context: `docs/design.md` section 8 ("Vercel และ Neon (deploy target หลัก)") set Vercel plus
  Neon in the `sin1` region as the deploy plan, with `scripts/vercel-build.mjs` running
  `prisma generate`, then `prisma migrate deploy` gated on `VERCEL_ENV === 'production'`, then
  `next build`, and a `vercel.json` setting `regions: ["sin1"]`. Section 8 also has a
  "Portability notes" part (same section, not a separate numbered section) that already says
  config lives in env vars so the app can move to any container host. That portability note is
  what made this move possible without a design change.
- Decision: deploy to Pakorn's existing Hetzner VPS (2 vCPU, 3.8 GB RAM) instead. This VPS
  already serves a resume site, n8n and a vocab app. The CRM will be reachable at
  `https://ai-crm.kurpakorn.com`, as its own Compose project at `/root/ai-crm-stack`. Pakorn
  builds images locally with `build.ps1` and pushes them to a private Docker Hub repo
  (`patapuputapa/kurpakorn`); agents never push images or read server secrets. Postgres 16 runs
  as a container named `ai-crm-db` on a private network only, with no pooler in front of it, so
  `DATABASE_URL` and `DIRECT_URL` are the same URL. The shared Caddy instance (already running
  in the n8n stack) terminates TLS with automatic certificates; Cloudflare DNS is set to DNS
  only for this host. Migrations run by hand as a one shot `migrate` service under an `ops`
  Compose profile, with Pakorn's consent each time, instead of running as part of a build step.
  Logs are read with `docker logs`; uptime is checked against `/api/health`. Backups are a
  `pg_dump` taken before each migrate run; there is no nightly backup cron, by Pakorn's choice.
  Seed data is synthetic demo data (Pakorn confirmed yes), since seeding is the only way to
  create the first user. `COPILOT_TIMEOUT_MS` is not capped by any `maxDuration` on the VPS.
  15000 ms is suggested, based on the 2026-09-17 live eval (8000 ms timed out 3 of 7 cases;
  25000 ms passed 7 of 7, at roughly 3.4 to 7.4 seconds), but the final number is still pending
  Pakorn's choice.
- Consequences: `vercel.json` and `scripts/vercel-build.mjs` are not needed for this deploy.
  Vercel stays possible again later if needed, since nothing about the app code depends on the
  VPS. The Vercel-only notes in section 8 (PgBouncer and prepared statements with the driver
  adapter, `attachDatabasePool`, Neon cold start after autosuspend, the `sin1` region match to
  Neon) do not apply to this deploy. Running on a single VPS means no redundancy: if the VPS
  goes down, the CRM goes down with it. The CRM also shares CPU and RAM with the resume site,
  n8n and the vocab app on the same box, so compose memory limits are set per service to keep
  one app from starving the others. Migrations are a manual, consented step rather than an
  automatic build gate, so a deploy of new code and a schema migration are two separate actions
  now, not one.
- Related: CR-5 in `docs/contract-change-requests.md` (Lane D owns `Dockerfile`,
  `.dockerignore`, `build.ps1`, `deploy/**`; PR #10). Lane D's deploy files are on branch
  `lane-d-vps-deploy`, not yet pushed, no PR yet. Replaces `docs/design.md` section 8
  ("Vercel และ Neon (deploy target หลัก)"), items 1, 3 and 6 in particular (connection URLs,
  the `vercel-build.mjs` migration step, and the `sin1` region setting). Section 8's
  portability notes are the part of the old design that is kept, not replaced.
