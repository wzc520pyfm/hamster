/**
 * Stamp a deployment identity into sw.js so every client build that changes
 * hashed assets also changes the service worker byte-for-byte (banner can fire).
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const HAMSTER_PWA_BUILD_PLACEHOLDER = '__HAMSTER_PWA_BUILD__'
export const SHELL_CACHE_PREFIX = 'hamster-pwa-shell'

/** @param {string} buildId */
export function shellCacheNameForBuild(buildId) {
  return `${SHELL_CACHE_PREFIX}-${buildId}`
}

/**
 * @param {string} swSource
 * @param {string} buildId
 */
export function stampHamsterPwaBuild(swSource, buildId) {
  if (!buildId || typeof buildId !== 'string') {
    throw new Error('buildId required')
  }
  if (!swSource.includes(HAMSTER_PWA_BUILD_PLACEHOLDER)) {
    throw new Error('sw source missing __HAMSTER_PWA_BUILD__ placeholder')
  }
  return swSource.split(HAMSTER_PWA_BUILD_PLACEHOLDER).join(buildId)
}

/**
 * Stable short id from hashed asset filenames (or file contents if provided).
 * @param {string[]} assetNames
 * @param {string} [extra]
 */
export function deployIdFromAssetNames(assetNames, extra = '') {
  const joined = [...assetNames].filter(Boolean).sort().join('|') + '|' + extra
  return crypto.createHash('sha256').update(joined).digest('hex').slice(0, 12)
}

/**
 * Stamp dist/sw.js from dist/assets/*.{js,css} names. Returns buildId or null.
 * @param {string} distDir
 */
export function stampDistServiceWorker(distDir) {
  const swPath = path.join(distDir, 'sw.js')
  if (!fs.existsSync(swPath)) return null
  const assetsDir = path.join(distDir, 'assets')
  const names = fs.existsSync(assetsDir)
    ? fs.readdirSync(assetsDir).filter((f) => /\.(js|css)$/.test(f))
    : []
  if (names.length === 0) {
    throw new Error('cannot stamp sw.js: no hashed assets in dist/assets')
  }
  const buildId = deployIdFromAssetNames(names)
  const stamped = stampHamsterPwaBuild(fs.readFileSync(swPath, 'utf8'), buildId)
  fs.writeFileSync(swPath, stamped)
  return buildId
}
