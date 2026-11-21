'use strict'

/**
 * N-1 TDD: mock Electron main-process Notification — no real GUI / system toast.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { notifyPendingApprovals } = require('./notifyPendingApprovals.cjs')

function mockNotificationFactory({ isSupported = true, throwOnConstruct = false } = {}) {
  const constructed = []
  const shown = []
  const clicks = []

  function Notification(options) {
    if (throwOnConstruct) throw new Error('construct_fail')
    // Capture arity/shape: must be single options object (Electron main API).
    constructed.push({ args: [...arguments], options })
    this._handlers = {}
    this.on = (ev, cb) => {
      this._handlers[ev] = cb
      clicks.push({ ev, cb })
    }
    this.show = () => {
      shown.push(true)
    }
  }
  Notification.isSupported = () => isSupported
  Notification._constructed = constructed
  Notification._shown = shown
  Notification._clicks = clicks
  return Notification
}

test('N-1: uses Electron main constructor new Notification({ title, body, icon }) then show()', () => {
  const Notification = mockNotificationFactory()
  const icon = '/tmp/icon.png'
  const result = notifyPendingApprovals({
    Notification,
    iconPath: icon,
    taskTitle: null,
  })
  assert.equal(result.shown, true)
  assert.equal(Notification._constructed.length, 1)
  const call = Notification._constructed[0]
  // Single-arg options object — NOT (title, { body }) Web API shape
  assert.equal(call.args.length, 1)
  assert.equal(typeof call.args[0], 'object')
  assert.equal(call.options.title, 'Needs approval')
  assert.equal(call.options.body, 'Hamster needs your approval. Approve this action / Deny.')
  assert.equal(call.options.icon, icon)
  assert.equal(Notification._shown.length, 1)
})

test('N-1: includes task title in body when provided', () => {
  const Notification = mockNotificationFactory()
  notifyPendingApprovals({
    Notification,
    iconPath: '/i.png',
    taskTitle: 'Ship crates',
  })
  assert.match(Notification._constructed[0].options.body, /Ship crates/)
})

test('N-1: wires click handler when provided', () => {
  const Notification = mockNotificationFactory()
  let clicked = 0
  notifyPendingApprovals({
    Notification,
    iconPath: '/i.png',
    onClick: () => {
      clicked += 1
    },
  })
  assert.equal(Notification._clicks.length, 1)
  assert.equal(Notification._clicks[0].ev, 'click')
  Notification._clicks[0].cb()
  assert.equal(clicked, 1)
})

test('N-1: fail-safe when Notification.isSupported() === false (no construct/show)', () => {
  const Notification = mockNotificationFactory({ isSupported: false })
  const result = notifyPendingApprovals({
    Notification,
    iconPath: '/i.png',
  })
  assert.equal(result.shown, false)
  assert.equal(result.reason, 'unsupported')
  assert.equal(Notification._constructed.length, 0)
  assert.equal(Notification._shown.length, 0)
})

test('N-1: fail-safe when constructor throws (no claim of delivery)', () => {
  const Notification = mockNotificationFactory({ throwOnConstruct: true })
  const result = notifyPendingApprovals({
    Notification,
    iconPath: '/i.png',
  })
  assert.equal(result.shown, false)
  assert.equal(result.reason, 'throw')
})

test('N-1: fail-safe when Notification ctor missing', () => {
  const result = notifyPendingApprovals({
    Notification: null,
    iconPath: '/i.png',
  })
  assert.equal(result.shown, false)
  assert.equal(result.reason, 'no_notification_ctor')
})

test('N-1 contract: must NOT use Web Notification.permission gate', () => {
  // If someone passes a Web-like Notification with .permission and (title, opts) arity,
  // our helper must still call with options object only — permission is never read.
  let permissionReads = 0
  const constructed = []
  function Notification(options) {
    constructed.push({ argsLen: arguments.length, options })
    this.on = () => {}
    this.show = () => {}
  }
  Object.defineProperty(Notification, 'permission', {
    get() {
      permissionReads += 1
      return 'denied'
    },
  })
  Notification.isSupported = () => true
  const result = notifyPendingApprovals({
    Notification,
    iconPath: '/i.png',
  })
  assert.equal(result.shown, true)
  assert.equal(permissionReads, 0, 'must not read Notification.permission')
  assert.equal(constructed[0].argsLen, 1)
  assert.equal(typeof constructed[0].options.title, 'string')
})
