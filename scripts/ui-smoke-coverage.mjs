#!/usr/bin/env node
/**
 * Capture missing design-table UI states for smoke coverage expansion.
 * Requires a running stack at CLIENT_BASE / API_BASE. Does not fake states:
 * callers must put the product into the desired state before each shot.
 *
 * Usage:
 *   node scripts/ui-smoke-coverage.mjs shot <name> [options]
 *   node scripts/ui-smoke-coverage.mjs batch-json <manifest.json>
 *
 * Options (env or args):
 *   --url PATH          path under CLIENT_BASE (default /)
 *   --locale en|zh
 *   --width N
 *   --height N
 *   --out FILE          absolute or relative to docs/evidence/ui-smoke/
 *   --wait-text TEXT    wait for visible text before shot
 *   --scroll-text TEXT  scroll element containing text into view
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'client/package.json'))
const { chromium } = require('playwright')

const CLIENT_BASE = process.env.CLIENT_BASE || 'http://127.0.0.1:3000'
const OUT_DIR = path.join(root, 'docs/evidence/ui-smoke')

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

async function shotOnce(opts) {
  const {
    urlPath = '/',
    locale = 'en',
    width = 1280,
    height = 900,
    out,
    waitText = null,
    scrollText = null,
    fullPage = false,
  } = opts
  if (!out) throw new Error('out required')
  const outPath = path.isAbsolute(out) ? out : path.join(OUT_DIR, out)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width: Number(width), height: Number(height) },
  })
  await page.goto(CLIENT_BASE + urlPath, { waitUntil: 'networkidle' })
  if (locale === 'zh') {
    await page.getByTestId('locale-zh').click()
    await page.waitForTimeout(400)
  } else {
    const en = page.getByTestId('locale-en')
    if (await en.count()) {
      await en.click().catch(() => undefined)
      await page.waitForTimeout(200)
    }
  }
  if (waitText) {
    // Prefer exact match so titles like "Succeeded capture…" do not satisfy a
    // status wait for the word "Succeeded".
    const exact = process.argv.includes('--wait-exact')
    await page.getByText(waitText, { exact }).first().waitFor({
      state: 'visible',
      timeout: 20000,
    })
  }
  if (scrollText) {
    const loc = page.getByText(scrollText, { exact: false }).first()
    await loc.scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
  }
  await page.waitForTimeout(400)
  await page.screenshot({ path: outPath, type: 'png', fullPage: Boolean(fullPage) })
  await browser.close()
  // Prefer webp when cwebp exists; else keep png and note caller may convert.
  const webpPath = outPath.replace(/\.png$/i, '.webp')
  if (outPath.endsWith('.png') || opts.forceWebp) {
    // playwright can't write webp; write png then convert externally if needed
  }
  console.log(JSON.stringify({ ok: true, out: outPath, locale, width, height, urlPath }))
  return outPath
}

const cmd = process.argv[2]
if (cmd === 'shot') {
  const name = process.argv[3]
  await shotOnce({
    urlPath: arg('--url', '/'),
    locale: arg('--locale', 'en'),
    width: arg('--width', '1280'),
    height: arg('--height', '900'),
    out: arg('--out', name ? `${name}.png` : null),
    waitText: arg('--wait-text', null),
    scrollText: arg('--scroll-text', null),
    fullPage: process.argv.includes('--full-page'),
  })
} else if (cmd === 'batch-json') {
  const manifest = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
  for (const item of manifest) {
    await shotOnce(item)
  }
} else {
  console.error('Usage: shot | batch-json')
  process.exit(2)
}
