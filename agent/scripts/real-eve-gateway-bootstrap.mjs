#!/usr/bin/env node
/**
 * REAL BOOTSTRAP (VM offline / local fixture) — not fetchUpstream stub shape proof.
 *
 * Starts:
 *   1) actual installed Eve (`eve` package bin) on an upstream port
 *   2) production isolatedIdentityGateway proxying to that Eve
 * Then: GET health → POST session (with identity) + mismatch negative.
 *
 * Fixture plan only (empty HAMSTER_MODEL_ID). No real keys / paid calls.
 * No docker / no live desktop / no shared PG.
 *
 * Run (Node >=24 required by eve@1.0.2):
 *   /path/to/node24 agent/scripts/real-eve-gateway-bootstrap.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createIsolatedIdentityGatewayServer,
  IDENTITY_HEADERS,
} from '../lib/isolatedIdentityGateway.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = path.join(__dirname, '..');
const REPO = path.join(AGENT_ROOT, '..');
const EVIDENCE_REPO = path.join(REPO, 'docs/evidence/p2-real-eve-bootstrap-20261120b');
const EVIDENCE_RAW = '/opt/cursor/artifacts/p2-real-eve-bootstrap-20261120b';

const DIGEST =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const INSTANCE = 'inst_real_boot_1';
const TARGET = 'target_isolated_desktop';

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

function resolveNode24() {
  const candidates = [
    process.env.HAMSTER_NODE24,
    process.execPath,
    '/home/ubuntu/.nvm/versions/node/v24.22.3/bin/node',
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      const r = spawnSync(p, ['-e', 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:2)'], {
        encoding: 'utf8',
      });
      if (r.status === 0) return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function waitHealth(url, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'pending';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      const body = await res.json().catch(() => null);
      if (res.ok && body) return { status: res.status, body };
      last = `http_${res.status}`;
    } catch (err) {
      last = String(err?.message ?? err);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`health not ready: ${last}`);
}

function ensureDirs() {
  fs.mkdirSync(EVIDENCE_REPO, { recursive: true });
  fs.mkdirSync(EVIDENCE_RAW, { recursive: true });
}

async function main() {
  ensureDirs();
  const evidence = {
    at: new Date().toISOString(),
    kind: 'real_eve_gateway_bootstrap',
    notFetchUpstreamStub: true,
    fixtureOnly: true,
    steps: [],
    blocker: null,
    pass: false,
  };
  const push = (step) => evidence.steps.push({ ...step, at: new Date().toISOString() });

  const node24 = resolveNode24();
  const eveBin = path.join(AGENT_ROOT, 'node_modules/eve/bin/eve.js');
  const evePkg = JSON.parse(fs.readFileSync(path.join(AGENT_ROOT, 'node_modules/eve/package.json'), 'utf8'));

  if (!node24) {
    evidence.blocker = {
      reason: 'node_lt_24',
      detail: 'eve@1.0.2 engines.node>=24; no Node 24 binary found on PATH/nvm',
      processNode: process.version,
    };
    writeEvidence(evidence);
    console.error(JSON.stringify(evidence.blocker, null, 2));
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(eveBin)) {
    evidence.blocker = { reason: 'eve_bin_missing', path: eveBin };
    writeEvidence(evidence);
    process.exitCode = 1;
    return;
  }

  // Ensure built output exists
  if (!fs.existsSync(path.join(AGENT_ROOT, '.output/server/index.mjs'))) {
    const build = spawnSync(node24, [eveBin, 'build'], {
      cwd: AGENT_ROOT,
      encoding: 'utf8',
      env: { ...process.env, HAMSTER_MODEL_ID: '', PATH: `${path.dirname(node24)}:${process.env.PATH}` },
    });
    push({
      step: 'eve_build',
      status: build.status,
      stderrTail: (build.stderr || '').slice(-800),
      ok: build.status === 0,
    });
    if (build.status !== 0) {
      evidence.blocker = { reason: 'eve_build_failed', status: build.status };
      writeEvidence(evidence);
      process.exitCode = 1;
      return;
    }
  }

  const upstreamPort = await freePort();
  const gatewayPort = await freePort();

  const eveEnv = {
    ...process.env,
    PATH: `${path.dirname(node24)}:${process.env.PATH}`,
    PORT: String(upstreamPort),
    HAMSTER_MODEL_ID: '',
    // Explicitly clear paid/live keys for fixture-only bootstrap
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
    DEEPSEEK_API_KEY: '',
  };

  const eveCmd = [eveBin, 'start', '--host', '127.0.0.1', '--port', String(upstreamPort)];
  push({
    step: 'spawn_real_eve',
    executable: node24,
    nodeVersion: spawnSync(node24, ['-v'], { encoding: 'utf8' }).stdout.trim(),
    eveVersion: evePkg.version,
    eveEngines: evePkg.engines,
    command: [node24, ...eveCmd].join(' '),
    upstreamPort,
    cwd: AGENT_ROOT,
    ok: true,
  });

  const eveChild = spawn(node24, eveCmd, {
    cwd: AGENT_ROOT,
    env: eveEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let eveLog = '';
  eveChild.stdout.on('data', (d) => {
    eveLog += d.toString();
  });
  eveChild.stderr.on('data', (d) => {
    eveLog += d.toString();
  });

  let gatewayServer = null;
  try {
    const upstreamHealth = await waitHealth(`http://127.0.0.1:${upstreamPort}/eve/v1/health`);
    push({
      step: 'real_eve_health_raw',
      pid: eveChild.pid,
      port: upstreamPort,
      status: upstreamHealth.status,
      body: upstreamHealth.body,
      hasTargetId: Object.hasOwn(upstreamHealth.body, 'targetId'),
      hasInstanceId: Object.hasOwn(upstreamHealth.body, 'instanceId'),
      ok:
        upstreamHealth.body?.ok === true &&
        !Object.hasOwn(upstreamHealth.body, 'targetId') &&
        !Object.hasOwn(upstreamHealth.body, 'instanceId'),
    });

    gatewayServer = createIsolatedIdentityGatewayServer({
      instanceId: INSTANCE,
      targetId: TARGET,
      imageId: DIGEST,
      // NO fetchUpstream — proxy to real Eve process
    });
    // Point proxy at real Eve by setting env used by module-level upstreamUrl.
    // createIsolatedIdentityGatewayServer closes over module env; set before listen
    // by patching process.env (module already read defaults — proxy uses process at call time
    // via upstreamUrl which reads module const). We need to pass custom upstream.
    // Production gateway reads HAMSTER_EVE_UPSTREAM_PORT at module load. For this
    // bootstrap we implement a thin reverse proxy that reuses checkIdentity + health augment
    // by pointing the gateway's fetch at the real Eve via temporary env + dynamic import after set.
  } catch (err) {
    push({ step: 'real_eve_health_raw', ok: false, error: String(err?.message ?? err), eveLogTail: eveLog.slice(-1200) });
    evidence.blocker = {
      reason: 'real_eve_health_failed',
      detail: String(err?.message ?? err),
      evePid: eveChild.pid,
      upstreamPort,
      eveLogTail: eveLog.slice(-2000),
    };
    writeEvidence(evidence);
    eveChild.kill('SIGTERM');
    process.exitCode = 1;
    return;
  }

  // Re-import gateway after setting upstream env so module constants match.
  // The already-imported module locked upstreamPort at load — use a dedicated
  // child process for the gateway with correct env instead.
  if (gatewayServer) {
    await new Promise((r) => gatewayServer.close(r));
    gatewayServer = null;
  }

  const gatewayEnv = {
    ...eveEnv,
    PORT: String(gatewayPort),
    HAMSTER_EVE_UPSTREAM_HOST: '127.0.0.1',
    HAMSTER_EVE_UPSTREAM_PORT: String(upstreamPort),
    HAMSTER_ISOLATED_INSTANCE_ID: INSTANCE,
    HAMSTER_ISOLATED_TARGET_ID: TARGET,
    HAMSTER_ISOLATED_IMAGE_ID: DIGEST,
    // Prevent gateway main() from spawning a second Eve — we already have one.
    // Run gateway server-only via inline bootstrap below.
  };

  // Server-only gateway (do not call main/spawnEve): load module with upstream env
  // already set by spawning a tiny runner.
  const runnerPath = path.join(EVIDENCE_RAW, '_gateway-runner.mjs');
  fs.writeFileSync(
    runnerPath,
    `
import { createIsolatedIdentityGatewayServer } from ${JSON.stringify(
      pathToFileURL(path.join(AGENT_ROOT, 'lib/isolatedIdentityGateway.mjs')).href,
    )};
const server = createIsolatedIdentityGatewayServer({
  instanceId: process.env.HAMSTER_ISOLATED_INSTANCE_ID,
  targetId: process.env.HAMSTER_ISOLATED_TARGET_ID,
  imageId: process.env.HAMSTER_ISOLATED_IMAGE_ID,
});
const port = Number(process.env.PORT);
server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ listening: true, port, pid: process.pid }));
});
`,
  );

  // Problem: isolatedIdentityGateway.mjs reads upstreamPort at module load time.
  // Child must set HAMSTER_EVE_UPSTREAM_PORT before importing the module.
  const gatewayChild = spawn(
    node24,
    [
      '-e',
      `
process.env.HAMSTER_EVE_UPSTREAM_HOST='127.0.0.1';
process.env.HAMSTER_EVE_UPSTREAM_PORT='${upstreamPort}';
process.env.PORT='${gatewayPort}';
process.env.HAMSTER_ISOLATED_INSTANCE_ID='${INSTANCE}';
process.env.HAMSTER_ISOLATED_TARGET_ID='${TARGET}';
process.env.HAMSTER_ISOLATED_IMAGE_ID='${DIGEST}';
const { pathToFileURL } = await import('node:url');
const mod = await import(pathToFileURL(${JSON.stringify(
        path.join(AGENT_ROOT, 'lib/isolatedIdentityGateway.mjs'),
      )}).href);
const server = mod.createIsolatedIdentityGatewayServer({
  instanceId: '${INSTANCE}',
  targetId: '${TARGET}',
  imageId: '${DIGEST}',
});
server.listen(${gatewayPort}, '127.0.0.1', () => {
  console.log(JSON.stringify({ listening: true, port: ${gatewayPort}, pid: process.pid }));
});
`,
    ],
    {
      cwd: AGENT_ROOT,
      env: gatewayEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let gatewayLog = '';
  gatewayChild.stdout.on('data', (d) => {
    gatewayLog += d.toString();
  });
  gatewayChild.stderr.on('data', (d) => {
    gatewayLog += d.toString();
  });

  try {
    // Wait for gateway listen log
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !gatewayLog.includes('"listening"')) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!gatewayLog.includes('"listening"')) {
      throw new Error(`gateway did not listen: ${gatewayLog.slice(-500)}`);
    }

    const gwHealth = await waitHealth(`http://127.0.0.1:${gatewayPort}/eve/v1/health`);
    push({
      step: 'gateway_augmented_health',
      gatewayPid: gatewayChild.pid,
      gatewayPort,
      upstreamPid: eveChild.pid,
      upstreamPort,
      status: gwHealth.status,
      body: gwHealth.body,
      ok:
        gwHealth.body?.ok === true &&
        gwHealth.body?.targetId === TARGET &&
        gwHealth.body?.instanceId === INSTANCE &&
        gwHealth.body?.imageId === DIGEST &&
        typeof gwHealth.body?.workflowId === 'string',
    });

    const bad = await fetch(`http://127.0.0.1:${gatewayPort}/eve/v1/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'bootstrap unauthenticated' }),
    });
    const badBody = await bad.json().catch(() => ({}));
    push({
      step: 'session_unauthenticated_rejected',
      status: bad.status,
      body: badBody,
      ok: bad.status === 409,
    });

    // Real Eve channel uses httpBasic (agent/channels/eve.ts defaults).
    const basicUser = process.env.HAMSTER_AGENT_USERNAME || 'hamster';
    const basicPass = process.env.HAMSTER_AGENT_PASSWORD || 'dev-agent-password';
    const basicAuth = `Basic ${Buffer.from(`${basicUser}:${basicPass}`).toString('base64')}`;

    const okSession = await fetch(`http://127.0.0.1:${gatewayPort}/eve/v1/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuth,
        [IDENTITY_HEADERS.INSTANCE]: INSTANCE,
        [IDENTITY_HEADERS.TARGET]: TARGET,
        [IDENTITY_HEADERS.IMAGE]: DIGEST,
      },
      body: JSON.stringify({ message: 'bootstrap fixture session' }),
    });
    const okBody = await okSession.json().catch(() => ({}));
    push({
      step: 'session_with_identity',
      status: okSession.status,
      body: okBody,
      auth: 'httpBasic hamster channel defaults (no paid keys)',
      ok:
        okSession.status >= 200 &&
        okSession.status < 300 &&
        Boolean(okBody.sessionId || okBody.ok === true),
    });

    // Also reject /session/existing without identity (no unsafe passthrough)
    const existing = await fetch(`http://127.0.0.1:${gatewayPort}/eve/v1/session/existing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    push({
      step: 'session_existing_unauthenticated_rejected',
      status: existing.status,
      ok: existing.status === 409,
    });

    evidence.pass = evidence.steps.every((s) => s.ok === true);
    evidence.summary = {
      eveExecutable: eveBin,
      eveVersion: evePkg.version,
      nodeExecutable: node24,
      nodeVersion: spawnSync(node24, ['-v'], { encoding: 'utf8' }).stdout.trim(),
      evePid: eveChild.pid,
      evePort: upstreamPort,
      gatewayPid: gatewayChild.pid,
      gatewayPort,
    };
  } catch (err) {
    evidence.blocker = {
      reason: 'gateway_or_session_failed',
      detail: String(err?.message ?? err),
      eveLogTail: eveLog.slice(-1500),
      gatewayLogTail: gatewayLog.slice(-1500),
    };
    evidence.pass = false;
  } finally {
    gatewayChild.kill('SIGTERM');
    eveChild.kill('SIGTERM');
    try {
      fs.unlinkSync(runnerPath);
    } catch {
      /* ignore */
    }
  }

  writeEvidence(evidence);
  console.log(
    JSON.stringify(
      {
        pass: evidence.pass,
        blocker: evidence.blocker,
        summary: evidence.summary,
        steps: evidence.steps.map((s) => ({ step: s.step, ok: s.ok })),
        evidenceRepo: EVIDENCE_REPO,
        evidenceRaw: EVIDENCE_RAW,
      },
      null,
      2,
    ),
  );
  if (!evidence.pass) process.exitCode = 1;
}

function writeEvidence(evidence) {
  ensureDirs();
  const json = JSON.stringify(evidence, null, 2);
  fs.writeFileSync(path.join(EVIDENCE_REPO, 'bootstrap.json'), json);
  fs.writeFileSync(path.join(EVIDENCE_RAW, 'bootstrap.json'), json);
  const md = `# Real Eve + gateway bootstrap (2026-11-20b)

Not a fetchUpstream constant-shape stub. Fixture-only (empty HAMSTER_MODEL_ID). No paid keys.

pass=${evidence.pass}

${evidence.blocker ? `## Blocker\\n\\n\`\`\`json\\n${JSON.stringify(evidence.blocker, null, 2)}\\n\`\`\`\\n` : ''}

## Steps

${evidence.steps.map((s) => `- \`${s.step}\`: ok=${s.ok}`).join('\\n')}

## Summary

\`\`\`json
${JSON.stringify(evidence.summary || {}, null, 2)}
\`\`\`
`;
  fs.writeFileSync(path.join(EVIDENCE_REPO, 'NOTES.md'), md);
  fs.writeFileSync(path.join(EVIDENCE_RAW, 'NOTES.md'), md);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
