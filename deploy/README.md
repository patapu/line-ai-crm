# ai-crm VPS deploy runbook

Short runbook for Pakorn to deploy `line-ai-crm` on the kurpakorn VPS
(167.233.21.135), alongside the existing `n8n-stack` and `resume-stack`.

`build.ps1` (repo root) builds and pushes the images. It is not run by an
agent; run it yourself from the repo root.

Before the first pull, confirm the VPS is already logged in to Docker Hub
for the private repo (`docker login`, done by Pakorn himself). The
resume-stack image already pulls fine on this VPS, so it probably is, but
check this first if `docker compose pull` fails with an auth error.

## First deploy

1. On the VPS: `mkdir -p /root/ai-crm-stack && cd /root/ai-crm-stack`
2. Copy `deploy/compose.yml` to `/root/ai-crm-stack/docker-compose.yml`,
   `deploy/ai-crm.env.example` to `/root/ai-crm-stack/ai-crm.env`, and
   `deploy/db.env.example` to `/root/ai-crm-stack/db.env`.
3. Edit `db.env` yourself: set `POSTGRES_PASSWORD` (`openssl rand -hex 24`).
   Postgres applies it only when the `ai-crm-pgdata` volume is first
   created. Changing it in `db.env` later does nothing; change it inside
   Postgres with `ALTER USER` and update `ai-crm.env` to match.
4. Edit `ai-crm.env` yourself: set `SESSION_SECRET` (`openssl rand -base64
   48`), and the `DATABASE_URL` / `DIRECT_URL` passwords so they match the
   same hex value you just put in `db.env`. Leave `LINE_MODE=mock` until the
   LINE webhook is verified.
5. `chmod 600 ai-crm.env db.env` (both files hold secrets).
6. Edit `docker-compose.yml`: set the `ai-crm` and `migrate` image tags to
   the ones `build.ps1` just pushed (it prints them at the end).
7. `docker compose pull`
8. `docker compose up -d ai-crm-db`, wait for it to report healthy
   (`docker compose ps`).
9. On a first deploy the db is empty, so a `pg_dump` backup is optional here.
   From the second deploy onward, always back it up first (see "Update /
   rollback" below).
10. Run migrations: `docker compose --profile ops run --rm migrate`
11. Seed is required for the first login: there is no other way to create
    the first user, and `LINE_INBOUND_OWNER_EMAIL=admin@crm.test` must exist
    before live LINE inbound works. To avoid the demo password ending up in
    shell history, temporarily add `DEMO_PASSWORD` to `ai-crm.env` with an
    editor, then run:
    `docker compose --profile ops run --rm migrate npx prisma db seed`
    then delete the `DEMO_PASSWORD` line from `ai-crm.env` again. All seed
    users share this one password on a public URL: change it or remove the
    demo users after the demo.
12. Start the app: `docker compose up -d ai-crm`
13. Check health from inside the network:
    `docker compose exec ai-crm wget -qO- http://127.0.0.1:3000/api/health`

## Wire up Caddy

The Caddyfile is a single-file bind mount, so edit it in place. Never use a
tool that rewrites the whole file (no `sed -i`, no editor that replaces it);
only append.

Back up first:

```
cp /root/n8n-stack/Caddyfile /root/n8n-stack/Caddyfile.bak.$(date +%Y%m%d-%H%M%S)
```

Append this block with a heredoc:

```
cat >> /root/n8n-stack/Caddyfile <<'EOF'

ai-crm.kurpakorn.com {
    reverse_proxy ai-crm:3000
    encode gzip
}
EOF
```

Then validate and reload (never restart the Caddy container):

```
docker exec n8n-stack-caddy-1 caddy validate --config /etc/caddy/Caddyfile
docker exec n8n-stack-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

Verify from outside the VPS: `curl -I https://ai-crm.kurpakorn.com/api/health`

LINE webhook URL (once ready to go live): `https://ai-crm.kurpakorn.com/api/line/webhook`.
Test with `LINE_MODE=mock` first, only switch `LINE_MODE=live` (and fill in
`LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN`) after that works.

## Update / rollback

1. `cd /root/ai-crm-stack`
2. Backup: `cp docker-compose.yml docker-compose.yml.predeploy.$(date +%Y%m%d-%H%M%S)`
3. Dump the database. Create `backups/` with mode 700 first if it does not
   exist yet:
   ```
   mkdir -p -m 700 backups
   docker compose exec -T ai-crm-db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > backups/ai-crm-$(date +%Y%m%d-%H%M%S).dump
   chmod 600 backups/ai-crm-*.dump
   ```
   (`$POSTGRES_USER` and `$POSTGRES_DB` come from the container's own env,
   no need to source db.env yourself.)
4. Edit `docker-compose.yml`, change the `ai-crm` (and `migrate`, if the
   schema changed) image tag to the new one.
5. If the schema changed: `docker compose --profile ops run --rm migrate`.
   `build.ps1` always builds and pushes a new migrate image on every run, so
   it is fine to run this step even when nothing changed: it reports no
   pending migrations and exits.
6. `docker compose up -d --no-deps ai-crm`
7. Check health again (see step 13 above).
8. Rollback: the database is not rolled back. Migrations are additive only
   (design.md:951), so an older app image keeps working against the current
   schema. Restore the `docker-compose.yml.predeploy.<ts>` backup and repeat
   step 6 with the old tag. Only restore the `pg_dump` from step 3 if a
   migration itself broke data, not just because you are rolling back the
   app image.

## Warnings

- Never run `docker compose down -v` (drops the `ai-crm-pgdata` volume).
- Never run `prisma migrate reset` or `prisma db push` against this database.
- Never name a service `app` or a generic name like `db` in
  `docker-compose.yml`: the resume-stack already uses `app` on the shared
  `web` network, and a generic `db` risks the same collision if another
  stack on `web` adds one. This stack uses `ai-crm-db`.
- Never restart the `n8n-stack-caddy-1` container to pick up a Caddyfile
  change; use `caddy reload` as shown above.
- Always run `docker compose` from `/root/ai-crm-stack`, so it never touches
  the n8n or resume stacks.
