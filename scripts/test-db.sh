#!/usr/bin/env bash
# Applies the Supabase migrations to a throwaway local Postgres and runs the
# schema tests. Needs Postgres 15+ server binaries (initdb, pg_ctl) and psql.
#
#   npm run db:test
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$BIN/initdb" ] || BIN="$(dirname "$(command -v initdb)")"

WORK="$(mktemp -d)"
chmod 755 "$WORK"

# Postgres refuses to run as root; use the postgres OS user if we are root.
AS=()
if [ "$(id -u)" = 0 ]; then
  chown postgres "$WORK"
  AS=(runuser -u postgres --)
fi

trap '"${AS[@]}" "$BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

"${AS[@]}" "$BIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${AS[@]}" "$BIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null

PSQL=(psql -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)

"${PSQL[@]}" -f "$ROOT/supabase/tests/support/supabase-shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate: $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
# Query results go to /dev/null; each check reports itself as a NOTICE.
for t in "$ROOT"/supabase/tests/*_test.sql; do
  echo "test: $(basename "$t")"
  "${PSQL[@]}" -o /dev/null -f "$t" 2>&1 \
    | sed -E 's/^psql:[^ ]+ (NOTICE|INFO):  /  /'
done
