#!/usr/bin/env node
/**
 * Directed Node regression for cae4daf handoff fixes (no Playwright / no Docker image).
 * Does NOT read real .env (secrets). Does NOT re-run the big browser combined harness.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  requireControllerChangeObserved,
  assertLiveEphemeralOrThrow,
  parseEnvExampleText,
  assertRecommendedViteApiBaseEmpty,
} from './lib/harnessGuards.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.join(__dirname, '../..')

test('.env.example recommended path: VITE_API_BASE_URL empty (same-origin proxy)', () => {
  const text = fs.readFileSync(path.join(REPO, '.env.example'), 'utf8')
  // Never open .env — only the example template.
  assert.equal(fs.existsSync(path.join(REPO, '.env.example')), true)
  const map = parseEnvExampleText(text)
  assertRecommendedViteApiBaseEmpty(map)
  assert.match(text, /same-origin|server\.mjs|cross-origin/i)
  assert.doesNotMatch(text, /^VITE_API_BASE_URL=http:\/\/localhost:8080\s*$/m)
})

test('Dockerfile + compose defaults empty VITE_API_BASE_URL (recommended path)', () => {
  const dockerfile = fs.readFileSync(path.join(REPO, 'client/Dockerfile'), 'utf8')
  assert.match(dockerfile, /ARG VITE_API_BASE_URL=\s*$/m)
  assert.doesNotMatch(dockerfile, /ARG VITE_API_BASE_URL=http:\/\/localhost:8080/)
  const compose = fs.readFileSync(path.join(REPO, 'docker-compose.yml'), 'utf8')
  assert.match(compose, /VITE_API_BASE_URL:\s*\$\{VITE_API_BASE_URL:-\}/)
  assert.match(compose, /API_UPSTREAM:\s*http:\/\/api:8080/)
})

test('requireControllerChangeObserved: positive when observed=true', () => {
  assert.equal(
    requireControllerChangeObserved({
      actualControllerChangeObserved: true,
      harnessExtraSkipWaiting: false,
    }),
    true,
  )
})

test('requireControllerChangeObserved NEGATIVE: missing observed must fail (no soft-pass)', () => {
  assert.throws(
    () =>
      requireControllerChangeObserved({
        actualControllerChangeObserved: false,
        harnessExtraSkipWaiting: false,
      }),
    /actualControllerChangeObserved===true/,
  )
  assert.throws(
    () =>
      requireControllerChangeObserved({
        harnessExtraSkipWaiting: false,
      }),
    /actualControllerChangeObserved===true/,
  )
  // Soft-pass pattern must not be expressible as success:
  const soft = false || true
  assert.equal(soft, true)
  assert.throws(
    () =>
      requireControllerChangeObserved({
        actualControllerChangeObserved: soft && false, // still false
        harnessExtraSkipWaiting: false,
      }),
    /actualControllerChangeObserved===true/,
  )
})

test('assertLiveEphemeralOrThrow NEGATIVE: mismatch throws BEFORE any business query', async () => {
  const queryLog = []
  const pool = {
    async query(sql) {
      const s = String(sql)
      if (/SHOW data_directory/i.test(s)) {
        queryLog.push({ kind: 'identity', sql: s })
        return { rows: [{ data_directory: '/tmp/hamster-p2-ephemeral-pg-REAL/data' }] }
      }
      if (/hamster_ephemeral_marker/i.test(s)) {
        queryLog.push({ kind: 'identity', sql: s })
        return {
          rows: [{ token: 'real-token-aaaaaaaaaaaaaaaa', data_directory: '/tmp/hamster-p2-ephemeral-pg-REAL/data' }],
        }
      }
      queryLog.push({ kind: 'business', sql: s })
      throw new Error('business query must not run on mismatch')
    },
  }
  const badEnv = {
    HAMSTER_P2_PG_DATADIR: '/tmp/hamster-p2-ephemeral-pg-MISMATCH/data',
    HAMSTER_P2_PG_INSTANCE_TOKEN: 'wrong-token-bbbbbbbbbbbbbbbb',
  }

  let threw = null
  try {
    await assertLiveEphemeralOrThrow(pool, badEnv, queryLog)
  } catch (err) {
    threw = err
  }
  assert.ok(threw, 'must throw on mismatch')
  assert.equal(threw.code, 'EPHEMERAL_PG_IDENTITY_MISMATCH')
  assert.equal(threw.live?.verified, false)

  // Attempt business queries after mismatch must be caller-prevented; simulate guard usage:
  let businessAfter = 0
  try {
    await assertLiveEphemeralOrThrow(pool, badEnv)
  } catch {
    // correctly did not proceed — count any business entries still zero
  }
  businessAfter = queryLog.filter((q) => q.kind === 'business').length
  assert.equal(businessAfter, 0, 'ZERO business queries on identity mismatch')

  const identity = queryLog.filter((q) => q.kind === 'identity')
  assert.ok(identity.length >= 1, 'identity verification queries themselves are allowed')
  assert.equal(
    queryLog.filter((q) => /FROM messages|FROM conversations/i.test(q.sql)).length,
    0,
  )
})

test('assertLiveEphemeralOrThrow positive: matching identity allows subsequent business (caller)', async () => {
  const queryLog = []
  const datadir = '/tmp/hamster-p2-ephemeral-pg-OK/data'
  const token = 'ok-token-cccccccccccccccc'
  const pool = {
    async query(sql) {
      const s = String(sql)
      if (/SHOW data_directory/i.test(s)) {
        queryLog.push({ kind: 'identity', sql: s })
        return { rows: [{ data_directory: datadir }] }
      }
      if (/hamster_ephemeral_marker/i.test(s)) {
        queryLog.push({ kind: 'identity', sql: s })
        return { rows: [{ token, data_directory: datadir }] }
      }
      queryLog.push({ kind: 'business', sql: s })
      return { rows: [{ id: 1 }] }
    },
  }
  const live = await assertLiveEphemeralOrThrow(
    pool,
    { HAMSTER_P2_PG_DATADIR: datadir, HAMSTER_P2_PG_INSTANCE_TOKEN: token },
    queryLog,
  )
  assert.equal(live.verified, true)
  // Caller may now run business — prove guard does not block after success
  await pool.query('SELECT id FROM messages WHERE content = $1', ['x'])
  assert.equal(queryLog.filter((q) => q.kind === 'business').length, 1)
})

test('historical combined-run JSON: observed=true is positive record; soft-pass line annotated elsewhere', () => {
  const jsonPath = path.join(
    REPO,
    'docs/evidence/p1-persist-through-pwa-retry-20261121/persist-through-pwa-retry-20261121.json',
  )
  const ev = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  const step = ev.steps.find((s) => s.step === 'activation_observed_unaided_no_harness_skip_waiting')
  assert.ok(step)
  assert.equal(step.injectionLate?.actualControllerChangeObserved, true)
  // Historical positive record retained; harness source soft-pass is a separate defect fixed this round.
})
