#!/usr/bin/env bash
# Stop ephemeral PG started by start-ephemeral-pg.sh. Never touches shared :5432.
set -euo pipefail
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATA_DIR="${HAMSTER_P2_PG_DATADIR:-}"
if [[ -z "${DATA_DIR}" ]]; then
  echo "error: HAMSTER_P2_PG_DATADIR unset — refusing to guess" >&2
  exit 1
fi
# Safety: data dir must look ephemeral
case "${DATA_DIR}" in
  /tmp/hamster-p2-ephemeral-pg-*/data) ;;
  *)
    echo "error: refusing to stop non-ephemeral dataDir=${DATA_DIR}" >&2
    exit 1
    ;;
esac
if [[ -x "${PG_BIN}/pg_ctl" ]]; then
  "${PG_BIN}/pg_ctl" -D "${DATA_DIR}" -m fast stop || true
fi
if [[ -n "${HAMSTER_P2_PG_ROOT:-}" && -d "${HAMSTER_P2_PG_ROOT}" ]]; then
  # Keep evidence; remove data only if explicitly requested
  if [[ "${HAMSTER_P2_PG_RM_DATA:-}" == "1" ]]; then
    rm -rf "${HAMSTER_P2_PG_ROOT}"
  fi
fi
echo "Stopped ephemeral PG at ${DATA_DIR}" >&2
