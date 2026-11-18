'use strict';

// Asset (persistent dashboard) helpers: create the OpenUI React Lang 1.0 document,
// read bindings, refresh data in place. Refresh NEVER re-generates the layout and
// NEVER calls a model. On failure the last success stays visible.

const crypto = require('crypto');
const { query } = require('./db');
const { runNamedQuery } = require('./namedQueries');

function buildDashboardDocument(assetId, source, snapshot) {
  // OpenUI React Lang 1.0 program. Only registered components, stable ids,
  // versioned layout (v1). $rev drives query refetch on refresh; same document,
  // same slots — data is swapped in place. The first snapshot is embedded as
  // the query default so refresh failure keeps the last success visible.
  const payload = JSON.stringify(snapshot ?? { kpis: [], rows: [] });
  return `$rev = 0
metrics = Query("${source}", { rev: $rev }, ${payload})
root = Stack([head, kpis, grid, note])
head = CardHeader("Weekly metrics", "Asset ${assetId} · source: ${source} · refresh re-fetches this query only")
kpis = KpiGrid(metrics.kpis)
grid = MetricsTable(metrics.rows)
note = Note("Hamster asset ${assetId} — layout v1. Refresh replaces data in place; it never regenerates this page.")
`;
}

// buildDocument(assetId, snapshot) is called after the row exists so the document
// can embed the stable assetId.
async function createAsset({ taskId, conversationId, title, bindings, defaultData, buildDocument }) {
  const { rows: existing } = taskId
    ? await query('SELECT * FROM assets WHERE task_id = $1 ORDER BY created_at LIMIT 1', [taskId])
    : { rows: [] };
  if (existing.length > 0) return existing[0];

  const assetId = `asset_${crypto.randomUUID()}`;
  const document = buildDocument(assetId, defaultData);
  const { rows } = await query(
    `INSERT INTO assets (id, task_id, conversation_id, title, source, openui_document,
                         layout_version, bindings, default_data, freshness, last_success_at)
     VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,'fresh', now()) RETURNING *`,
    [
      assetId,
      taskId ?? null,
      conversationId ?? null,
      title,
      'metrics_weekly',
      document,
      JSON.stringify(bindings),
      JSON.stringify(defaultData ?? {}),
    ]
  );
  return rows[0];
}

async function refreshAsset(assetId) {
  const { rows } = await query('SELECT * FROM assets WHERE id = $1', [assetId]);
  const asset = rows[0];
  if (!asset) return { ok: false, error: 'asset_not_found' };
  if (asset.revoked_at) return { ok: false, error: 'asset_revoked' };

  try {
    const data = await runNamedQuery(require('./db').pool, 'metrics_weekly');
    await query('BEGIN');
    try {
      await query(
        `INSERT INTO asset_snapshots (asset_id, query_name, data) VALUES ($1, $2, $3)`,
        [assetId, 'metrics_weekly', JSON.stringify(data)]
      );
      await query(
        `UPDATE assets SET freshness = 'fresh', last_success_at = now(), last_error = NULL, updated_at = now()
          WHERE id = $1`,
        [assetId]
      );
      await query('COMMIT');
    } catch (err) {
      await query('ROLLBACK');
      throw err;
    }
    return { ok: true, assetId, refreshedAt: new Date().toISOString(), source: 'metrics_weekly' };
  } catch (err) {
    await query(
      `UPDATE assets SET freshness = 'refresh_failed', last_error = $2, updated_at = now() WHERE id = $1`,
      [assetId, String(err.message ?? err)]
    );
    return { ok: false, error: String(err.message ?? err), assetId };
  }
}

module.exports = { buildDashboardDocument, createAsset, refreshAsset };
