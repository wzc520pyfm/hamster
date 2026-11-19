#!/usr/bin/env node
/**
 * README-exact recommended install: cp .env.example .env semantics → compose build arg.
 * Asserts the example file and compose wiring force same-origin (empty bake), not localhost:8080.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8')
const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8')
const dockerfile = fs.readFileSync(path.join(ROOT, 'client/Dockerfile'), 'utf8')

const env = {}
for (const line of example.split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#') || !t.includes('=')) continue
  const i = t.indexOf('=')
  env[t.slice(0, i)] = t.slice(i + 1)
}

const viteFromExample = env.VITE_API_BASE_URL ?? '<missing>'
console.log('env.example VITE_API_BASE_URL=', JSON.stringify(viteFromExample))

const loopbackInExample =
  typeof viteFromExample === 'string' &&
  (viteFromExample.includes('localhost:8080') || viteFromExample.includes('127.0.0.1:8080'))
console.log('example_loopback_risk', loopbackInExample)

// Compose must hard-empty the build arg (not ${VITE_API_BASE_URL:-} which inherits .env).
const hardEmpty =
  /VITE_API_BASE_URL:\s*["']{2}/.test(compose) ||
  /VITE_API_BASE_URL:\s*""/.test(compose) ||
  /#\s*forced empty[\s\S]*VITE_API_BASE_URL:\s*["']{0,1}["']{0,1}\s*$/m.test(compose)
const inheritsHostEnv = /VITE_API_BASE_URL:\s*\$\{VITE_API_BASE_URL/.test(compose)
console.log('compose_hard_empty_bake', hardEmpty)
console.log('compose_inherits_host_env', inheritsHostEnv)
console.log('dockerfile_default_empty', /ARG VITE_API_BASE_URL=\s*$/m.test(dockerfile) || /ARG VITE_API_BASE_URL=\n/.test(dockerfile))

// Simulate bake with values that a stale .env might still carry; recommended compose must ignore them.
const stale = path.join(ROOT, 'client')
const out = path.join('/tmp', 'hamster-readme-bake-check')
const build = spawnSync(
  'npx',
  ['vite', 'build', '--outDir', out, '--emptyOutDir'],
  {
    cwd: stale,
    env: { ...process.env, VITE_API_BASE_URL: '' },
    encoding: 'utf8',
  },
)
fs.writeFileSync(
  path.join(process.env.P1_EVIDENCE_DIR || '/tmp', 'readme-bake-vite-stdout.txt'),
  (build.stdout || '') + (build.stderr || ''),
)
const jsFiles = fs.existsSync(out)
  ? fs.readdirSync(path.join(out, 'assets')).filter((f) => f.endsWith('.js'))
  : []
let hits = 0
for (const f of jsFiles) {
  const body = fs.readFileSync(path.join(out, 'assets', f), 'utf8')
  const m = body.match(/localhost:8080/g)
  if (m) hits += m.length
}
console.log('empty_bake_localhost_8080_hits', hits)

const ok = !loopbackInExample && hardEmpty && !inheritsHostEnv && hits === 0 && build.status === 0
console.log('README_COMPOSE_SAME_ORIGIN_OK', ok)
process.exit(ok ? 0 : 1)
