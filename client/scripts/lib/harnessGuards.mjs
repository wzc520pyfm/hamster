/**
 * Shared harness guards for directed Node regression (no browser).
 * Used by p1-persist-through-pwa-retry harness and harness-guards.test.mjs.
 */

/**
 * Require ENGINEERING_INJECTION to have observed a real controllerchange via
 * the unwrapped origAdd instrument. Soft-pass `(observed === true || true)` is forbidden.
 */
export function requireControllerChangeObserved(injectionMeta) {
  if (!injectionMeta || typeof injectionMeta !== 'object') {
    throw new Error('requireControllerChangeObserved: missing injection meta')
  }
  if (injectionMeta.harnessExtraSkipWaiting === true) {
    throw new Error('requireControllerChangeObserved: harnessExtraSkipWaiting must be false')
  }
  if (injectionMeta.actualControllerChangeObserved !== true) {
    throw new Error(
      'requireControllerChangeObserved: expected actualControllerChangeObserved===true (no soft-pass)',
    )
  }
  return true
}

/**
 * Identity verification queries only (SHOW data_directory + marker).
 * On mismatch: THROW before any caller may run business SQL (messages/conversations/…).
 */
export async function assertLiveEphemeralOrThrow(pool, env, queryLog = null) {
  const log = (kind, sql) => {
    if (queryLog && Array.isArray(queryLog)) queryLog.push({ kind, sql })
  }

  const dirSql = 'SHOW data_directory'
  log('identity', dirSql)
  const dirRes = await pool.query(dirSql)
  const liveDataDirectory = dirRes.rows[0]?.data_directory ?? dirRes.rows[0]?.data_Directory

  const markerSql = 'SELECT token, data_directory FROM hamster_ephemeral_marker LIMIT 1'
  log('identity', markerSql)
  const markerRes = await pool.query(markerSql)
  const marker = markerRes.rows[0]

  const ok =
    liveDataDirectory === env.HAMSTER_P2_PG_DATADIR &&
    marker?.token === env.HAMSTER_P2_PG_INSTANCE_TOKEN &&
    String(liveDataDirectory || '').includes('hamster-p2-ephemeral-pg-')

  if (!ok) {
    const err = new Error(
      `assertLiveEphemeralOrThrow: live PG identity mismatch ` +
        `(liveDataDirectory=${liveDataDirectory} expected=${env.HAMSTER_P2_PG_DATADIR} ` +
        `marker=${marker?.token ? String(marker.token).slice(0, 8) + '…' : 'missing'})`,
    )
    err.code = 'EPHEMERAL_PG_IDENTITY_MISMATCH'
    err.live = {
      verified: false,
      liveDataDirectory,
      markerToken: marker?.token || null,
      expectedDataDir: env.HAMSTER_P2_PG_DATADIR,
    }
    throw err
  }

  return {
    verified: true,
    liveDataDirectory,
    markerToken: marker.token,
    expectedDataDir: env.HAMSTER_P2_PG_DATADIR,
  }
}

/** Parse KEY=VALUE lines from .env.example text (never reads real .env). */
export function parseEnvExampleText(text) {
  const out = {}
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    out[t.slice(0, eq)] = t.slice(eq + 1)
  }
  return out
}

/** Recommended Compose client path: empty VITE_API_BASE_URL → same-origin /api via server.mjs. */
export function assertRecommendedViteApiBaseEmpty(envMap) {
  const v = envMap.VITE_API_BASE_URL
  if (v === undefined) {
    throw new Error('VITE_API_BASE_URL missing from .env.example')
  }
  if (String(v).trim() !== '') {
    throw new Error(
      `recommended path requires empty VITE_API_BASE_URL in .env.example (got ${JSON.stringify(v)})`,
    )
  }
  return true
}
