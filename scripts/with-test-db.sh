#!/usr/bin/env bash
# Starts a throwaway local Postgres with the Supabase shim and all migrations,
# runs the given command with DATABASE_URL pointing at it, then deletes it.
# Needs Postgres 15+ server binaries (initdb, pg_ctl) and psql.
#
#   bash scripts/with-test-db.sh npm test -w tools/import
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
  "${PSQL[@]}" -f "$f"
done

export DATABASE_URL="postgresql://postgres@localhost/postgres?host=$WORK"
"$@"
