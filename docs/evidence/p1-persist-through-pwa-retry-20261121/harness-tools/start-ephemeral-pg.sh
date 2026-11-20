#!/usr/bin/env bash
# Start a wholly separate temporary PostgreSQL for P2 HTTP integration.
# NEVER points at compose db:5432 / shared defaults. Records init evidence.
#
# Usage:
#   eval "$(api/scripts/start-ephemeral-pg.sh)"
#   # exports DATABASE_URL, HAMSTER_P2_EPHEMERAL_PG_OK=1, and evidence vars
#   # stop later: api/scripts/stop-ephemeral-pg.sh
set -euo pipefail

PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
if [[ ! -x "${PG_BIN}/initdb" ]]; then
  echo "error: initdb not found at ${PG_BIN}/initdb" >&2
  exit 1
fi

ROOT="${HAMSTER_P2_PG_ROOT:-$(mktemp -d /tmp/hamster-p2-ephemeral-pg-XXXXXX)}"
DATA_DIR="${ROOT}/data"
LOG_FILE="${ROOT}/postgres.log"
PORT="${HAMSTER_P2_PG_PORT:-$((55000 + RANDOM % 1000))}"
DB_NAME="hamster_p2_ephemeral_$$"
DB_USER="hamster_p2_ephemeral"
DB_PASS="ephemeral_$(openssl rand -hex 8 2>/dev/null || echo rand$$)"

mkdir -p "${DATA_DIR}"
# All operational output MUST go to stderr so `eval "$(…)"` only sees export lines.
INITDB_CMD=("${PG_BIN}/initdb" -D "${DATA_DIR}" --auth-local=trust --auth-host=scram-sha-256 -U postgres --locale=C --encoding=UTF8)
echo "+ ${INITDB_CMD[*]}" >&2
"${INITDB_CMD[@]}" >&2

# Listen only on localhost; non-5432 port. Socket dir under ROOT (no /var/run).
cat >> "${DATA_DIR}/postgresql.conf" <<EOF
listen_addresses = '127.0.0.1'
port = ${PORT}
max_connections = 40
shared_buffers = 32MB
unix_socket_directories = '${ROOT}'
EOF

# Trust local/loopback only — this cluster is ephemeral and never shared/live.
cat > "${DATA_DIR}/pg_hba.conf" <<EOF
local   all   all                trust
host    all   all   127.0.0.1/32 trust
host    all   all   ::1/128      trust
EOF

START_CMD=("${PG_BIN}/pg_ctl" -D "${DATA_DIR}" -l "${LOG_FILE}" -o "-p ${PORT} -h 127.0.0.1 -k ${ROOT}" start)
echo "+ ${START_CMD[*]}" >&2
"${START_CMD[@]}" >&2

# Wait ready
for _ in $(seq 1 60); do
  if "${PG_BIN}/pg_isready" -h 127.0.0.1 -p "${PORT}" -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
"${PG_BIN}/pg_isready" -h 127.0.0.1 -p "${PORT}" -U postgres >&2

# First start can fail if a leftover cluster holds the port — surface log on failure.
if ! "${PG_BIN}/pg_isready" -h 127.0.0.1 -p "${PORT}" -U postgres >/dev/null 2>&1; then
  echo "---- postgres.log ----" >&2
  cat "${LOG_FILE}" >&2 || true
  exit 1
fi

"${PG_BIN}/psql" -h 127.0.0.1 -p "${PORT}" -U postgres -v ON_ERROR_STOP=1 <<SQL >&2
CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}' SUPERUSER;
CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};
SQL

PID="$("${PG_BIN}/pg_ctl" -D "${DATA_DIR}" status | sed -n 's/.*PID: \([0-9]*\).*/\1/p' | head -1)"
VERSION="$("${PG_BIN}/postgres" --version)"
URL="postgres://${DB_USER}:${DB_PASS}@127.0.0.1:${PORT}/${DB_NAME}"
INSTANCE_TOKEN="$(openssl rand -hex 24 2>/dev/null || echo "tok_${RANDOM}_${RANDOM}_$$_ephemeral_pg")"

# Unique instance marker — harness queries this live before any TRUNCATE.
# Env strings alone are forgeable; live data_directory + token must match.
"${PG_BIN}/psql" -h 127.0.0.1 -p "${PORT}" -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 <<SQL >&2
CREATE TABLE hamster_ephemeral_marker (
  token text PRIMARY KEY,
  data_directory text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO hamster_ephemeral_marker (token, data_directory)
VALUES ('${INSTANCE_TOKEN}', '${DATA_DIR}');
SQL

# Prove live SHOW data_directory matches initdb path (evidence for harness).
LIVE_DATA_DIR="$("${PG_BIN}/psql" -h 127.0.0.1 -p "${PORT}" -U "${DB_USER}" -d "${DB_NAME}" -Atc "SHOW data_directory")"
echo "Live SHOW data_directory=${LIVE_DATA_DIR}" >&2
if [[ "${LIVE_DATA_DIR}" != "${DATA_DIR}" && "${LIVE_DATA_DIR}" != "${DATA_DIR%/}" ]]; then
  echo "error: live data_directory '${LIVE_DATA_DIR}' != expected '${DATA_DIR}'" >&2
  exit 1
fi

EVIDENCE_DIR="${HAMSTER_P2_PG_EVIDENCE:-${ROOT}/evidence}"
mkdir -p "${EVIDENCE_DIR}"
cat > "${EVIDENCE_DIR}/ephemeral-pg.json" <<JSON
{
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "postgresVersion": "${VERSION}",
  "initdbCommand": "${INITDB_CMD[*]}",
  "pg_ctlStartCommand": "${START_CMD[*]}",
  "pid": ${PID:-null},
  "port": ${PORT},
  "dataDir": "${DATA_DIR}",
  "liveDataDirectory": "${LIVE_DATA_DIR}",
  "instanceToken": "${INSTANCE_TOKEN}",
  "logFile": "${LOG_FILE}",
  "database": "${DB_NAME}",
  "user": "${DB_USER}",
  "listen": "127.0.0.1",
  "databaseUrlHostPort": "127.0.0.1:${PORT}",
  "refusedSharedDefaults": ["db:5432", "127.0.0.1:5432", "localhost:5432", "compose service db"]
}
JSON

echo "Ephemeral PG ready pid=${PID} port=${PORT} dataDir=${DATA_DIR} token=${INSTANCE_TOKEN:0:8}…" >&2
echo "Evidence: ${EVIDENCE_DIR}/ephemeral-pg.json" >&2

# Shell exports for eval — ONLY these lines on stdout
cat <<EOF
export PATH="${PG_BIN}:\$PATH"
export HAMSTER_P2_EPHEMERAL_PG_OK=1
export HAMSTER_P2_PG_DATADIR="${DATA_DIR}"
export HAMSTER_P2_PG_PORT="${PORT}"
export HAMSTER_P2_PG_PID="${PID}"
export HAMSTER_P2_PG_VERSION="${VERSION}"
export HAMSTER_P2_PG_LOG="${LOG_FILE}"
export HAMSTER_P2_PG_EVIDENCE="${EVIDENCE_DIR}"
export HAMSTER_P2_PG_ROOT="${ROOT}"
export HAMSTER_P2_PG_INSTANCE_TOKEN="${INSTANCE_TOKEN}"
export DATABASE_URL="${URL}"
EOF
