# Compose verification — 2026-11-19

**Not a product / design-gate pass.** Eve not frozen. Fixture worker path (`mockModel`).

## Commands

```bash
cp .env.example .env   # HAMSTER_MODEL_ID left empty
sudo dockerd &         # if daemon not already running
# On this host: iptables-legacy FORWARD DROP + bridge-nf-call-iptables blocked
# container→container until:
sudo iptables-legacy -I FORWARD -i br-<compose> -j ACCEPT
sudo iptables-legacy -I FORWARD -o br-<compose> -j ACCEPT
sudo iptables-legacy -P FORWARD ACCEPT

sudo docker compose up --build -d
DB_CMD="sudo docker compose exec -T db psql -U hamster -d hamster" \
  ./scripts/verify-p0.sh
```

## Result

- Compose came up (all four services). After the FORWARD fix, API health OK.
- `verify-p0.txt`: **PASS=24 FAIL=0 NOTE=1** (NOTE = fixture/mockModel disclaimer).
- JSON fixtures in this directory mirror `/tmp/hamster-p0-evidence-compose/`.

## Hard constraints observed without inventing model output

Policy / Line A–B / OpenUI refresh-failure / expiry / cancel-invalidation were exercised through the real Compose API. The **worker tool sequence** that created the asset and approval was still the scripted fixture model — not a live provider.
