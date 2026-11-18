#!/usr/bin/env node
// Deterministic locale-toggle check against a running client (default :3000).
// Requires playwright (client devDependency). Not a full three-surface E2E suite.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/package.json'),
)
const { chromium } = require('playwright')

const base = process.env.CLIENT_BASE || 'http://localhost:3000'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto(base + '/', { waitUntil: 'networkidle' })
const before = await page.locator('nav').innerText()
await page.getByTestId('locale-zh').locator('visible=true').first().click()
await page.waitForTimeout(300)
const afterZh = await page.locator('nav').innerText()
const headerZh = await page.locator('main h1').innerText()
await page.getByTestId('locale-en').locator('visible=true').first().click()
await page.waitForTimeout(300)
const afterEn = await page.locator('nav').innerText()
await browser.close()

const zhOk = afterZh.includes('对话') && afterZh.includes('待审批') && headerZh.includes('主对话')
const enOk = afterEn.includes('Conversation') && afterEn.includes('Approvals')
console.log(JSON.stringify({ before, afterZh, headerZh, afterEn, zhOk, enOk }, null, 2))
if (!zhOk || !enOk) process.exit(1)
