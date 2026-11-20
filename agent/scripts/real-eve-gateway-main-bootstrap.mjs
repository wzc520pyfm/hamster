#!/usr/bin/env node
/**
 * REAL production gateway entry bootstrap (2026-11-21).
 *
 * Invokes the production gateway module AS MAIN so it ITSELF calls spawnEve()
 * (npx eve start). Does NOT separately launch Eve then attach a server-only
 * gateway. Does NOT use fetchUpstream stubs.
 *
 * Fixture-only: empty HAMSTER_MODEL_ID, no paid provider keys.
 * Local stub/fixture model plan is labeled explicitly.
 *
 * Run (Node >=24):
 *   HAMSTER_NODE24=/path/to/node24 node agent/scripts/real-eve-gateway-main-bootstrap.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = path.join(__dirname, '..');
const REPO = path.join(AGENT_ROOT, '..');
const EVIDENCE_REPO = path.join(REPO, 'docs/evidence/p2-gateway-main-spawn-eve-20261121');
const EVIDENCE_RAW = '/opt/cursor/artifacts/p2-gateway-main-spawn-eve-20261121';

const DIGEST =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const INSTANCE = 'inst_main_spawn_1';
const TARGET = 'target_isolated_desktop';
const GATEWAY_ENTRY = path.join(AGENT_ROOT, 'lib/isolatedIdentityGateway.mjs');

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
      const r = spawnSync(
        p,
        ['-e', 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:2)'],
        { encoding: 'utf8' },
      );
      if (r.status === 0) return p;
    } catch {
      /* next */
    }
  }
  return null;
}

async function waitJson(url, pred, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'pending';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      const body = await res.json().catch(() => null);
      if (pred(res, body)) return { status: res.status, body };
      last = `http_${res.status}:${JSON.stringify(body)?.slice(0, 120)}`;
    } catch (err) {
      last = String(err?.message ?? err);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`wait failed: ${last}`);
}

function ensureDirs() {
  fs.mkdirSync(EVIDENCE_REPO, { recursive: true });
  fs.mkdirSync(EVIDENCE_RAW, { recursive: true });
}

function writeEvidence(evidence) {
  ensureDirs();
  const json = JSON.stringify(evidence, null, 2);
  fs.writeFileSync(path.join(EVIDENCE_REPO, 'bootstrap-main-spawn.json'), json);
  fs.writeFileSync(path.join(EVIDENCE_RAW, 'bootstrap-main-spawn.json'), json);
  const md = `# Gateway main()→spawnEve bootstrap (2026-11-21)

Production entry: \`node lib/isolatedIdentityGateway.mjs\` (isMain) which **itself**
calls \`spawnEve()\` then listens. Not a separately-launched Eve + server-only gateway.
Not a fetchUpstream shape stub.

pass=${evidence.pass}
fixtureOnly=true (empty HAMSTER_MODEL_ID; labeled hamster-fixture / mockModel)

${evidence.blocker ? `## Blocker\\n\\n\`\`\`json\\n${JSON.stringify(evidence.blocker, null, 2)}\\n\`\`\`\\n` : ''}

## Steps

${(evidence.steps || []).map((s) => `- \`${s.step}\`: ok=${s.ok}`).join('\\n')}

## Summary

\`\`\`json
${JSON.stringify(evidence.summary || {}, null, 2)}
\`\`\`
`;
  fs.writeFileSync(path.join(EVIDENCE_REPO, 'NOTES.md'), md);
  fs.writeFileSync(path.join(EVIDENCE_RAW, 'NOTES.md'), md);
}

async function main() {
  ensureDirs();
  const evidence = {
    at: new Date().toISOString(),
    kind: 'gateway_main_spawnEve_bootstrap',
    notFetchUpstreamStub: true,
    notSeparatelyLaunchedEve: true,
    fixtureOnly: true,
    fixtureLabel: 'HAMSTER_MODEL_ID empty → eve mockModel / hamster-fixture plan',
    steps: [],
    blocker: null,
    pass: false,
  };
  const push = (step) => evidence.steps.push({ ...step, at: new Date().toISOString() });

  const node24 = resolveNode24();
  const evePkg = JSON.parse(
    fs.readFileSync(path.join(AGENT_ROOT, 'node_modules/eve/package.json'), 'utf8'),
  );

  if (!node24) {
    evidence.blocker = {
      reason: 'node_lt_24',
      detail: 'eve@1.0.2 requires Node >=24',
      processNode: process.version,
    };
    writeEvidence(evidence);
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(path.join(AGENT_ROOT, '.output/server/index.mjs'))) {
    const build = spawnSync(node24, [path.join(AGENT_ROOT, 'node_modules/eve/bin/eve.js'), 'build'], {
      cwd: AGENT_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.dirname(node24)}:${process.env.PATH}`,
        HAMSTER_MODEL_ID: '',
      },
    });
    push({ step: 'eve_build', status: build.status, ok: build.status === 0 });
    if (build.status !== 0) {
      evidence.blocker = { reason: 'eve_build_failed', stderrTail: (build.stderr || '').slice(-800) };
      writeEvidence(evidence);
      process.exitCode = 1;
      return;
    }
  }

  const upstreamPort = await freePort();
  const gatewayPort = await freePort();
  const basicUser = process.env.HAMSTER_AGENT_USERNAME || 'hamster';
  const basicPass = process.env.HAMSTER_AGENT_PASSWORD || 'dev-agent-password';
  const basicAuth = `Basic ${Buffer.from(`${basicUser}:${basicPass}`).toString('base64')}`;

  const cmd = [node24, GATEWAY_ENTRY];
  push({
    step: 'spawn_production_gateway_main',
    command: cmd.join(' '),
    gatewayEntry: GATEWAY_ENTRY,
    nodeVersion: spawnSync(node24, ['-v'], { encoding: 'utf8' }).stdout.trim(),
    eveVersion: evePkg.version,
    gatewayPort,
    upstreamPort,
    note: 'Gateway main() will spawnEve(npx eve start) on upstreamPort',
    ok: true,
  });

  const child = spawn(node24, [GATEWAY_ENTRY], {
    cwd: AGENT_ROOT,
    env: {
      ...process.env,
      PATH: `${path.dirname(node24)}:${process.env.PATH}`,
      PORT: String(gatewayPort),
      HAMSTER_EVE_UPSTREAM_HOST: '127.0.0.1',
      HAMSTER_EVE_UPSTREAM_PORT: String(upstreamPort),
      HAMSTER_ISOLATED_INSTANCE_ID: INSTANCE,
      HAMSTER_ISOLATED_TARGET_ID: TARGET,
      HAMSTER_ISOLATED_IMAGE_ID: DIGEST,
      HAMSTER_MODEL_ID: '',
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      DEEPSEEK_API_KEY: '',
      HAMSTER_AGENT_USERNAME: basicUser,
      HAMSTER_AGENT_PASSWORD: basicPass,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  child.stdout.on('data', (d) => {
    log += d.toString();
  });
  child.stderr.on('data', (d) => {
    log += d.toString();
  });

  try {
    // Wait until gateway announces listen (implies spawnEve + upstream healthy).
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline && !/listening on 0\.0\.0\.0:/.test(log)) {
      if (child.exitCode != null) throw new Error(`gateway exited early: ${log.slice(-1500)}`);
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!/listening on 0\.0\.0\.0:/.test(log)) {
      throw new Error(`gateway did not listen: ${log.slice(-1500)}`);
    }

    const evePidMatch = log.match(/spawned eve pid=(\d+)/);
    const gwPidMatch = log.match(/gatewayPid=(\d+)/);
    const evePid = evePidMatch ? Number(evePidMatch[1]) : null;
    const gatewayPid = gwPidMatch ? Number(gwPidMatch[1]) : child.pid;

    push({
      step: 'gateway_main_listening',
      gatewayPid,
      evePid,
      gatewayPort,
      upstreamPort,
      logTail: log.slice(-800),
      ok: Boolean(gatewayPid) && /spawned eve pid=/.test(log),
    });

    const health = await waitJson(
      `http://127.0.0.1:${gatewayPort}/eve/v1/health`,
      (res, body) =>
        res.ok &&
        body?.ok === true &&
        body?.targetId === TARGET &&
        body?.instanceId === INSTANCE &&
        body?.imageId === DIGEST &&
        typeof body?.workflowId === 'string',
    );
    push({
      step: 'gateway_augmented_health_via_main',
      status: health.status,
      body: health.body,
      ok: true,
    });

    const bad = await fetch(`http://127.0.0.1:${gatewayPort}/eve/v1/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: basicAuth },
      body: JSON.stringify({ message: 'no identity' }),
    });
    push({
      step: 'session_without_identity_rejected',
      status: bad.status,
      ok: bad.status === 409,
    });

    const ok = await fetch(`http://127.0.0.1:${gatewayPort}/eve/v1/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuth,
        'x-hamster-instance-id': INSTANCE,
        'x-hamster-target-id': TARGET,
        'x-hamster-image-id': DIGEST,
      },
      body: JSON.stringify({ message: 'main-spawn fixture session' }),
    });
    const okBody = await ok.json().catch(() => ({}));
    push({
      step: 'session_with_identity_via_main_spawned_eve',
      status: ok.status,
      body: okBody,
      ok: ok.status >= 200 && ok.status < 300 && Boolean(okBody.sessionId || okBody.ok === true),
    });

    evidence.summary = {
      gatewayEntry: GATEWAY_ENTRY,
      command: cmd.join(' '),
      nodeExecutable: node24,
      nodeVersion: spawnSync(node24, ['-v'], { encoding: 'utf8' }).stdout.trim(),
      evePackage: 'eve@' + evePkg.version,
      eveSpawn: 'npx eve start (via gateway spawnEve)',
      gatewayPid,
      evePid,
      gatewayPort,
      upstreamPort,
      fixtureOnly: true,
    };
    evidence.pass = evidence.steps.every((s) => s.ok === true);
  } catch (err) {
    evidence.blocker = {
      reason: 'main_spawn_bootstrap_failed',
      detail: String(err?.message ?? err),
      logTail: log.slice(-2000),
    };
    evidence.pass = false;
  } finally {
    child.kill('SIGTERM');
    // Also try to reap any leftover eve on upstream port via process group — best effort.
    await new Promise((r) => setTimeout(r, 500));
    try {
      child.kill('SIGKILL');
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

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
