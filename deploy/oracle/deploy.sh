#!/usr/bin/env bash
# Fast deploy: pull the prebuilt ARM64 images from GHCR and restart.
# Usage: ./deploy.sh            (pull latest main images)
#        ./deploy.sh --build    (fallback: compile on this server)
set -euo pipefail
cd "$(dirname "$0")"

git pull -q
COMPOSE="sudo docker compose --env-file .env.prod"

if [ "${1:-}" = "--build" ]; then
  $COMPOSE build backend frontend
else
  $COMPOSE pull backend frontend
fi
$COMPOSE up -d backend frontend
sudo docker image prune -f >/dev/null
$COMPOSE ps --format '{{.Name}} {{.Status}}'
