'use strict'

/**
 * N-1: Main-process pending-approval OS notification helper.
 *
 * Electron main Notification API (not the Web Notification API):
 *   - Check Notification.isSupported() before constructing
 *   - new Notification({ title, body, icon })  // single options object
 *   - call .show()
 * There is no Notification.permission in the main process.
 *
 * Fail-safe: if unsupported or construction/show throws, return quietly —
 * badge / shell entry remain the operator-facing path (unchanged).
 */

/**
 * @param {object} opts
 * @param {typeof import('electron').Notification} opts.Notification
 * @param {string} opts.iconPath
 * @param {() => void} [opts.onClick]
 * @param {string | null} [opts.taskTitle]
 * @returns {{ shown: boolean, reason?: string }}
 */
function notifyPendingApprovals({ Notification, iconPath, onClick, taskTitle = null }) {
  if (!Notification || typeof Notification !== 'function') {
    return { shown: false, reason: 'no_notification_ctor' }
  }
  if (typeof Notification.isSupported === 'function' && !Notification.isSupported()) {
    return { shown: false, reason: 'unsupported' }
  }

  const title = 'Needs approval'
  const body = taskTitle
    ? `Hamster: task “${taskTitle}” needs your decision. Approve this action / Deny.`
    : 'Hamster needs your approval. Approve this action / Deny.'

  try {
    const notification = new Notification({
      title,
      body,
      icon: iconPath,
    })
    if (typeof onClick === 'function' && notification && typeof notification.on === 'function') {
      notification.on('click', onClick)
    }
    if (notification && typeof notification.show === 'function') {
      notification.show()
    }
    return { shown: true }
  } catch {
    // badge + shell entry remain
    return { shown: false, reason: 'throw' }
  }
}

module.exports = {
  notifyPendingApprovals,
}
