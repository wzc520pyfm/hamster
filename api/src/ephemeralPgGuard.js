'use strict';

/**
 * Refuse shared/default/live Postgres URLs for P2 HTTP integration.
 * Requires an explicitly started ephemeral instance (see api/scripts/start-ephemeral-pg.sh).
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
  };
}

module.exports = { assertEphemeralDatabaseUrl, FORBIDDEN_PORTS, FORBIDDEN_HOSTS };
