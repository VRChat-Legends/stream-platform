#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
test -f .env || { echo 'Run python3 deploy/setup-env.py first.'; exit 1; }
chmod 600 .env
docker compose build
docker compose up -d
