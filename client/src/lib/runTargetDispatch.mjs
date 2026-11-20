/**
 * Pure dispatch helpers for the Run-on selector (must-fix 4).
 * Kept as ESM so node:test can import without a TS loader; mirrors runTarget.ts.
 */

/** @param {string} state */
export function canDispatchToIsolated(state) {
  return state === 'ok' || state === 'not_started'
}

/** @param {string} status task lifecycle status */
export function mayUseControlPlaneInstead(status) {
  return status === 'queued'
}
