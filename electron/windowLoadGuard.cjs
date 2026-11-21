'use strict'

/**
 * Classify Electron load errors that mean the BrowserWindow/webContents was
 * torn down mid-load (lifecycle race) vs genuine load failures that must surface.
 */
function isWindowDestroyedLoadError(err) {
  if (!err) return false
  const msg = String(err && err.message != null ? err.message : err)
  return /Object has been destroyed/i.test(msg)
}

/**
 * loadFile only when the window is still alive. Lifecycle races after app.close()
 * return { ok:false, reason:'window_destroyed' } without throwing. Other errors rethrow.
 */
async function loadFileIfAlive(win, filePath) {
  if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) {
    return { ok: false, reason: 'window_destroyed' }
  }
  try {
    await win.loadFile(filePath)
    return { ok: true }
  } catch (err) {
    if (
      (typeof win.isDestroyed === 'function' && win.isDestroyed()) ||
      isWindowDestroyedLoadError(err)
    ) {
      return { ok: false, reason: 'window_destroyed' }
    }
    throw err
  }
}

module.exports = {
  isWindowDestroyedLoadError,
  loadFileIfAlive,
}
