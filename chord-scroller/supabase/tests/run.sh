#!/usr/bin/env bash
# Run the database security tests on a throwaway local PostgreSQL (needs PostgreSQL 15+ server binaries).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
WORK="$(mktemp -d)"
chown postgres "$WORK" 2>/dev/null || true
PORT=55432
as_pg() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
as_pg "$BIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
as_pg "$BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c wal_level=logical" -l "$WORK/log" start >/dev/null
trap 'as_pg "$BIN/pg_ctl" -D "$WORK/data" stop -m fast >/dev/null' EXIT
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -c "create database t" >/dev/null
"${PSQL[@]}" -d t -f "$HERE/stub_supabase.sql" >/dev/null
"${PSQL[@]}" -d t -f "$HERE/../migrations/20261106000000_chord_scroller.sql" >/dev/null
# applying it twice must be harmless
"${PSQL[@]}" -d t -f "$HERE/../migrations/20261106000000_chord_scroller.sql" >/dev/null
psql -h "$WORK" -p "$PORT" -U postgres -X -d t -t -A -f "$HERE/rls_test.sql" 2>&1 | grep -E "^(PASS|FAIL|[0-9]+ passed)|ERROR" || true
