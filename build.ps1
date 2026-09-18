# [D] Builds and pushes the ai-crm images (app + migrate) for the VPS deploy.
#
# The human (Pakorn) runs this script. Claude cannot run it: docker
# build/push to an external registry is blocked for the agent.

Push-Location $PSScriptRoot

$dirty = git status --porcelain
if ($dirty) {
  echo "Warning: working tree has uncommitted changes. Building anyway, but the image revision label will point at the last commit, not these changes."
}

$rev = git rev-parse --short HEAD

$ts = Get-Date -format "yyyyMMdd-HHmmss"
$app = "patapuputapa/kurpakorn:ai-crm-$ts"
$migrate = "patapuputapa/kurpakorn:ai-crm-migrate-$ts"

echo "Building runner image: $app"
docker build --platform linux/amd64 --label org.opencontainers.image.revision=$rev --target runner -t $app .
if ($LASTEXITCODE -ne 0) {
  echo "docker build (runner) failed, aborting before push"
  Pop-Location
  exit 1
}

echo "Building migrate image: $migrate"
docker build --platform linux/amd64 --label org.opencontainers.image.revision=$rev --target migrate -t $migrate .
if ($LASTEXITCODE -ne 0) {
  echo "docker build (migrate) failed, aborting before push"
  Pop-Location
  exit 1
}

echo "Pushing $app"
docker push $app
if ($LASTEXITCODE -ne 0) {
  echo "docker push (runner) failed, aborting"
  Pop-Location
  exit 1
}

echo "Pushing $migrate"
docker push $migrate
if ($LASTEXITCODE -ne 0) {
  echo "docker push (migrate) failed, aborting"
  Pop-Location
  exit 1
}

echo ""
echo "Built and pushed:"
echo "  app:     $app"
echo "  migrate: $migrate"
echo ""
echo "Next steps on the VPS (see deploy/README.md for the full runbook):"
echo "1. ssh into the VPS, cd /root/ai-crm-stack"
echo "2. Backup: cp docker-compose.yml docker-compose.yml.predeploy.$ts"
echo "3. Edit docker-compose.yml: set the ai-crm image to $app"
echo "   and the migrate image to $migrate"
echo "4. pg_dump the ai-crm-db service before migrating (see deploy/README.md; skip only on a fresh, empty db)"
echo "5. docker compose --profile ops run --rm migrate (harmless if there is nothing pending to migrate)"
echo "6. docker compose up -d --no-deps ai-crm"
echo "7. docker compose exec ai-crm wget -qO- http://127.0.0.1:3000/api/health"

Pop-Location
