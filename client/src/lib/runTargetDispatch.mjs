/**
 * Pure dispatch helpers for the Run-on selector (must-fix 4 / 5).
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

/** @param {string} runState @param {string} status */
export function showUnstartedIsolatedActions(runState, status) {
  return (
    mayUseControlPlaneInstead(status) &&
    (runState === 'start_failed' || runState === 'pending_approval')
  )
}

/**
 * Retry is only for "Isolated desktop is unavailable" / "Couldn't start the isolated desktop".
 * A pending_approval task must not Retry: awaiting a start approval is not a start failure.
 * @param {string} runState
 */
export function mayRetryIsolatedStart(runState) {
  return runState === 'start_failed' || runState === 'unavailable'
}

/** @param {string} text */
export function isLongTaskDispatch(text) {
  return /^(?:start|dispatch|delegate|派发)\s+(?:a\s+)?(?:long[- ]running\s+)?task:?\s*/is.test(
    String(text).trim(),
  )
}
