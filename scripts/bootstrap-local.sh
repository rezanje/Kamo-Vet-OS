#!/usr/bin/env bash
# VetOS Fase 1 — one-shot local bootstrap. Run once Docker Desktop engine is up (green).
#   bash scripts/bootstrap-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 1/5 supabase start"
npx --yes supabase start

echo "==> 2/5 write .env.local"
API_URL=$(npx --yes supabase status -o env | grep '^API_URL=' | cut -d= -f2- | tr -d '"')
ANON=$(npx --yes supabase status -o env | grep '^ANON_KEY=' | cut -d= -f2- | tr -d '"')
SERVICE=$(npx --yes supabase status -o env | grep '^SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '"')
cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=${API_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON}
EOF
echo "   wrote .env.local (URL=${API_URL})"

echo "==> 3/5 db reset (apply migrations + seed)"
npx --yes supabase db reset

echo "==> 4/5 create test users (owner + staff)"
for u in owner staff; do
  curl -s "${API_URL}/auth/v1/admin/users" \
    -H "apikey: ${SERVICE}" -H "Authorization: Bearer ${SERVICE}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${u}@vetos.local\",\"password\":\"password123\",\"email_confirm\":true}" \
    -o /dev/null -w "   ${u}@vetos.local -> HTTP %{http_code}\n"
done

echo "==> 5/5 set roles/assignments + run RLS isolation check"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
if command -v psql >/dev/null 2>&1; then
  psql "$DB_URL" -f supabase/verify_rls.sql
else
  docker exec -i "$(docker ps --filter name=supabase_db --format '{{.Names}}' | head -1)" \
    psql "postgresql://postgres:postgres@127.0.0.1:5432/postgres" < supabase/verify_rls.sql
fi

echo ""
echo "DONE. npm run dev  ->  http://localhost:3000  (login staff@vetos.local / password123)"
echo "Expect: STAFF sees 1 warehouse (WH_BTKM), OWNER sees 27."
