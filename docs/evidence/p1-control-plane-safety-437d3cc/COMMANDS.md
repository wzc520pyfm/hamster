# Commands (secrets redacted)

Docker probe: `command -v docker; ls /var/run/docker.sock` → unavailable.

noDocker stack:
1. `sudo apt-get install -y postgresql` + `sudo pg_ctlcluster 16 main start`
2. Create isolated DB `hamster_p1_cp_437d3cc_r3` / role `hamster_p1_cp`
3. Node 24: agent `npm run build && HAMSTER_MODEL_ID= PORT=<agent> HAMSTER_API_URL=http://127.0.0.1:<api> npm start`
4. API: `PORT=<api> DATABASE_URL=postgres://…@127.0.0.1:5432/hamster_p1_cp_437d3cc_r3 EVE_API_URL=http://127.0.0.1:<agent> npm start`
5. `API_BASE=http://127.0.0.1:<api> DB_CMD="sudo -u postgres psql -d hamster_p1_cp_437d3cc_r3" HAMSTER_INTERNAL_SECRET=<matching> ./scripts/verify-p0.sh`

Ports used this run: API=54083 AGENT=34549. Tip: 437d3cca32558fe42e9d4389080811fefae89a2b.
