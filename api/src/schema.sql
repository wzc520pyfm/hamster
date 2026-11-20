-- Hamster P0 control-plane schema. Idempotent; applied on API boot.
-- CREATE TABLE first so a fresh volume (demo-surface 1) succeeds; ALTER afterward
-- upgrades older deployments that predate the isolated-desktop columns.

CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  eve_session_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         TEXT NOT NULL,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS messages_partid_uq ON messages ((meta->>'partId')) WHERE meta ? 'partId';

CREATE TABLE IF NOT EXISTS tasks (
  id                 TEXT PRIMARY KEY,               -- product taskId, distinct from every other id
  conversation_id    TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','running','waiting_for_approval','succeeded','failed','cancelled')),
  target_id          TEXT NOT NULL DEFAULT 'target_control_plane', -- execution target (stable targetId); isolated desktop is NOT the host
  goal               TEXT,
  eve_session_id     TEXT,                            -- runtimeSessionId, distinct from taskId
  asset_id           TEXT,                            -- set when the worker saves a dashboard page
  control_seq        INTEGER NOT NULL DEFAULT 0,      -- monotonically increasing per task
  cancel_requested_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_conversation_idx ON tasks (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS task_events (
  id          BIGSERIAL PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  message     TEXT NOT NULL,
  step        INTEGER,
  total       INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, seq)
);
CREATE INDEX IF NOT EXISTS task_events_task_idx ON task_events (task_id, seq);

CREATE TABLE IF NOT EXISTS task_controls (
  id          BIGSERIAL PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  control_seq INTEGER NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('steer','cancel')),
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL CHECK (status IN ('received','pending_apply','applied')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at  TIMESTAMPTZ,
  UNIQUE (task_id, control_seq)
);

CREATE TABLE IF NOT EXISTS assets (
  id                TEXT PRIMARY KEY,               -- stable assetId, distinct from taskId/conversationId
  task_id           TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  conversation_id   TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  source            TEXT NOT NULL,                  -- named query binding, never raw SQL/shell/JS
  openui_document   TEXT NOT NULL,                  -- OpenUI React Lang 1.0 program (layout, versioned)
  layout_version    INTEGER NOT NULL DEFAULT 1,
  bindings          JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{query:"metrics_weekly", args:{}}]
  default_data      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- last-known-good snapshot embedded at creation
  freshness         TEXT NOT NULL DEFAULT 'fresh'
                    CHECK (freshness IN ('fresh','stale','refresh_failed')),
  last_success_at   TIMESTAMPTZ,
  last_error        TEXT,
  published_at      TIMESTAMPTZ,
  published_channel TEXT,
  revoked_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS asset_snapshots (
  id          BIGSERIAL PRIMARY KEY,
  asset_id    TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  query_name  TEXT NOT NULL,
  data        JSONB NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_snapshots_latest ON asset_snapshots (asset_id, query_name, id DESC);

CREATE TABLE IF NOT EXISTS approvals (
  id              TEXT PRIMARY KEY,                 -- ticket id
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,                    -- e.g. publish_dashboard
  params          JSONB NOT NULL,
  params_hash     TEXT NOT NULL,                    -- sha256 of canonical JSON of params
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','denied','expired','invalidated')),
  target_id       TEXT,                               -- execution target this ticket is bound to (task's targetId at issue time)
  eve_interaction_id TEXT UNIQUE,                   -- linked eve approval interaction, if any
  eve_session_id  TEXT,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  decided_at      TIMESTAMPTZ,
  decided_by      TEXT,
  decision_note   TEXT,
  consumed_at     TIMESTAMPTZ                        -- set when the approved ticket is used exactly once
);
CREATE INDEX IF NOT EXISTS approvals_task_idx ON approvals (task_id, status);
CREATE INDEX IF NOT EXISTS approvals_pending_idx ON approvals (status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS metrics_weekly (
  week        DATE PRIMARY KEY,
  sessions    INTEGER NOT NULL,
  signups     INTEGER NOT NULL,
  conversion  NUMERIC(5,2) NOT NULL,
  exceptions  INTEGER NOT NULL
);

-- Provenance for isolated-desktop reuse: only Hamster-approved create/start may
-- record a managed instance. Same-name/image 2xx alone never authorizes reuse.
CREATE TABLE IF NOT EXISTS isolated_desktop_managed (
  target_id              TEXT PRIMARY KEY,
  instance_id            TEXT NOT NULL,
  container_id           TEXT NOT NULL,
  image_id               TEXT NOT NULL,
  config_image           TEXT NOT NULL,
  approval_id            TEXT,
  task_id                TEXT,
  managed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS isolated_desktop_managed_container_idx
  ON isolated_desktop_managed (container_id);
CREATE INDEX IF NOT EXISTS isolated_desktop_managed_instance_idx
  ON isolated_desktop_managed (instance_id);

-- Idempotent migrations for deployments created before the isolated-desktop slice.
-- Must run AFTER CREATE TABLE so a fresh database does not ALTER missing relations.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS goal TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS target_id TEXT NOT NULL DEFAULT 'target_control_plane';
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS target_id TEXT;
