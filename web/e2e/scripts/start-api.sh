#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
API_DIR="$ROOT_DIR/api"
TEST_API_PORT="${E2E_API_PORT:-3102}"
DB_PATH="/tmp/tech-growth-hub-e2e-${TEST_API_PORT}.db"
RUNTIME_CONFIG_PATH="/tmp/tech-growth-hub-e2e-runtime-${TEST_API_PORT}.json"
MIGRATION_TARGET_PATH="/tmp/tech-growth-hub-e2e-migration.db"

rm -f "$DB_PATH" "$RUNTIME_CONFIG_PATH" "$MIGRATION_TARGET_PATH"

cd "$API_DIR"
npm run build >/dev/null

exec env \
  PORT="$TEST_API_PORT" \
  NODE_ENV=test \
  TRUST_PROXY=1 \
  JWT_SECRET=e2e-secret-key \
  JWT_EXPIRES_IN=7d \
  DATABASE_TYPE=sqlite \
  SQLITE_PATH="$DB_PATH" \
  DATABASE_RUNTIME_CONFIG_PATH="$RUNTIME_CONFIG_PATH" \
  AI_ENABLED=true \
  DEFAULT_AI_PROVIDER=openai \
  OPENAI_API_KEY=e2e-fake-key \
  INIT_ADMIN_USERNAME=e2e_admin \
  INIT_ADMIN_EMAIL=e2e_admin@example.com \
  INIT_ADMIN_PASSWORD=AdminPass123 \
  INIT_ADMIN_FORCE_PASSWORD_CHANGE=false \
  node dist/index.js
