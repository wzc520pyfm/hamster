'use strict';

/**
 * Refuse shared/default/live Postgres for P2 HTTP integration.
 * Env strings alone are forgeable — before ANY destructive SQL, query the live
 * connection's data_directory + instance marker and match the started cluster.
 */

const FORBIDDEN_HOSTS = new Set(['db', 'postgres', 'postgresql']);
const FORBIDDEN_PORTS = new Set(['', '5432']);
const FORBIDDEN_DB_NAMES = new Set(['hamster', 'hamster_p2_test', 'postgres']);

function assertEphemeralDatabaseUrl(url, env = process.env) {
  if (!url || typeof url !== 'string') {
    throw new Error('DATABASE_URL required for P2 HTTP tests (no default)');
  }
  if (env.HAMSTER_P2_EPHEMERAL_PG_OK !== '1') {
    throw new Error(
      'Refusing to run: set HAMSTER_P2_EPHEMERAL_PG_OK=1 only after start-ephemeral-pg.sh',
    );
  }
  if (!env.HAMSTER_P2_PG_DATADIR || !String(env.HAMSTER_P2_PG_DATADIR).includes('hamster-p2-ephemeral-pg-')) {
    throw new Error('HAMSTER_P2_PG_DATADIR must point at ephemeral data dir from start-ephemeral-pg.sh');
  }
  if (!env.HAMSTER_P2_PG_PORT || String(env.HAMSTER_P2_PG_PORT) === '5432') {
    throw new Error('HAMSTER_P2_PG_PORT must be non-5432 ephemeral port');
  }
  if (!env.HAMSTER_P2_PG_INSTANCE_TOKEN || String(env.HAMSTER_P2_PG_INSTANCE_TOKEN).length < 16) {
    throw new Error('HAMSTER_P2_PG_INSTANCE_TOKEN required (from start-ephemeral-pg.sh marker)');
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    throw new Error(`DATABASE_URL unparseable: ${err.message}`);
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`DATABASE_URL must be postgres:// (got ${parsed.protocol})`);
  }
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port || '';
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, '') || '');

  if (FORBIDDEN_HOSTS.has(host)) {
    throw new Error(`Refusing compose/shared DB host '${host}'`);
  }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`Refusing non-local DB host '${host}' (ephemeral must be 127.0.0.1)`);
  }
  if (FORBIDDEN_PORTS.has(port) || port === '5432') {
    throw new Error(`Refusing default/shared Postgres port '${port || '5432'}'`);
  }
  if (String(port) !== String(env.HAMSTER_P2_PG_PORT)) {
    throw new Error(
      `DATABASE_URL port ${port} !== HAMSTER_P2_PG_PORT ${env.HAMSTER_P2_PG_PORT}`,
    );
  }
  if (FORBIDDEN_DB_NAMES.has(dbName)) {
    throw new Error(`Refusing shared/default database name '${dbName}'`);
  }
  if (!dbName.startsWith('hamster_p2_ephemeral_')) {
    throw new Error(`Database name must be hamster_p2_ephemeral_* (got '${dbName}')`);
  }
  return {
    ok: true,
    host,
    port,
    database: dbName,
    dataDir: env.HAMSTER_P2_PG_DATADIR,
    pid: env.HAMSTER_P2_PG_PID || null,
    version: env.HAMSTER_P2_PG_VERSION || null,
    instanceToken: env.HAMSTER_P2_PG_INSTANCE_TOKEN,
  };
}

/**
 * Live connection verification — must run before TRUNCATE / destructive SQL.
 * Queries SHOW data_directory and hamster_ephemeral_marker token.
 */
async function assertEphemeralLiveConnection(clientOrPool, env = process.env) {
  const urlInfo = assertEphemeralDatabaseUrl(env.DATABASE_URL, env);
  const expectedDir = String(env.HAMSTER_P2_PG_DATADIR);
  const expectedToken = String(env.HAMSTER_P2_PG_INSTANCE_TOKEN);

  const dirRes = await clientOrPool.query('SHOW data_directory');
  const liveDir = String(dirRes.rows[0]?.data_directory || dirRes.rows[0]?.show || '').trim();
  if (!liveDir) {
    throw new Error('SHOW data_directory returned empty — refusing destructive SQL');
  }
  // Normalize trailing slashes
  const norm = (p) => p.replace(/\/+$/, '');
  if (norm(liveDir) !== norm(expectedDir)) {
    throw new Error(
      `Live data_directory '${liveDir}' !== expected ephemeral '${expectedDir}' — refusing`,
    );
  }
  if (!liveDir.includes('hamster-p2-ephemeral-pg-')) {
    throw new Error(`Live data_directory '${liveDir}' is not an ephemeral cluster path`);
  }

  let marker;
  try {
    marker = await clientOrPool.query(
      'SELECT token, data_directory FROM hamster_ephemeral_marker LIMIT 1',
    );
  } catch (err) {
    throw new Error(
      `hamster_ephemeral_marker missing/unreadable — refusing destructive SQL (${err.message})`,
    );
  }
  const row = marker.rows[0];
  if (!row || row.token !== expectedToken) {
    throw new Error(
      `Instance marker mismatch (got '${row?.token || null}', expected '${expectedToken}') — refusing`,
    );
  }
  if (row.data_directory && norm(String(row.data_directory)) !== norm(liveDir)) {
    throw new Error(
      `Marker data_directory '${row.data_directory}' !== live '${liveDir}' — refusing`,
    );
  }

  return {
    ...urlInfo,
    liveDataDirectory: liveDir,
    markerToken: row.token,
    verified: true,
  };
}

module.exports = {
  assertEphemeralDatabaseUrl,
  assertEphemeralLiveConnection,
  FORBIDDEN_PORTS,
  FORBIDDEN_HOSTS,
};
