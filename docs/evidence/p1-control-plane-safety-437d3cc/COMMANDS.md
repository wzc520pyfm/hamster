# Commands (secrets redacted)

Docker probe: `command -v docker; ls /var/run/docker.sock` → unavailable.

## r3 verify-p0 (accepted basic scope)

1. Isolated DB `hamster_p1_cp_437d3cc_r3` / role `hamster_p1_cp`
2. Agent `HAMSTER_MODEL_ID=` PORT=34549; API PORT=54083 DATABASE_URL=…/hamster_p1_cp_437d3cc_r3
3. `API_BASE=http://127.0.0.1:54083 DB_CMD="sudo -u postgres psql -d hamster_p1_cp_437d3cc_r3" ./scripts/verify-p0.sh`

## Unplanted single-use chain (gate supplement)

1. Fresh DB/role e.g. `hamster_p1_cp_437d3cc_su1` / unused ports API=54100 AGENT=34600
2. Start eve + API with empty HAMSTER_MODEL_ID (no provider keys); capture successful listen in `api.stdout.log`
3. `EVE_PID=<eve node pid> API_BASE=http://127.0.0.1:54100 DB_CMD="sudo -u postgres psql -d hamster_p1_cp_437d3cc_su1" LOCK_DATABASE_URL=postgres://… REPORT_DIR=… bash unplanted-singleuse/run-unplanted-singleuse-chain.sh`

Tip / code under test: 437d3cca32558fe42e9d4389080811fefae89a2b.
