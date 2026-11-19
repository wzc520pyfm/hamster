#!/usr/bin/env python3
"""Hold approvals row FOR UPDATE until COMMIT/ROLLBACK on stdin command line."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone


def ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: lock-helper.py TICKET_ID READY_FILE", file=sys.stderr)
        return 2
    ticket_id = sys.argv[1]
    ready_file = sys.argv[2]
    dsn = os.environ.get("LOCK_DATABASE_URL")
    if not dsn:
        print("LOCK_DATABASE_URL required", file=sys.stderr)
        return 2

    try:
        import psycopg

        conn = psycopg.connect(dsn, autocommit=False)
    except Exception:
        import psycopg2 as psycopg  # type: ignore

        conn = psycopg.connect(dsn)
        conn.autocommit = False

    cur = conn.cursor()
    print(f"{ts()} BEGIN FOR UPDATE ticket={ticket_id}", flush=True)
    cur.execute(
        "SELECT id, status, consumed_at IS NOT NULL FROM approvals WHERE id=%s FOR UPDATE",
        (ticket_id,),
    )
    row = cur.fetchone()
    print(f"{ts()} LOCKED row={row!r}", flush=True)
    with open(ready_file, "w", encoding="utf-8") as fh:
        fh.write(f"LOCKED {row!r}\n")

    cmd = sys.stdin.readline().strip()
    print(f"{ts()} cmd={cmd}", flush=True)
    if cmd == "COMMIT":
        conn.commit()
        print(f"{ts()} COMMIT ok", flush=True)
    else:
        conn.rollback()
        print(f"{ts()} ROLLBACK ({cmd or 'empty'})", flush=True)
    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
