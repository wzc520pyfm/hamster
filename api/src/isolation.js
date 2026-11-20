'use strict';

// Hamster P2 slice 1 — isolated desktop as an assignable execution target.
// Pure decision helpers + fail-closed start broker. The Docker broker runs only in the
// control plane and must use the minimum privilege: allowlisted image only, no host-root
// bind mounts, no docker.sock mounted into the desktop, no privileged/host-pid/host-network
// flags, create/start only after an approval ticket bound to that targetId.

const CONTROL_PLANE_TARGET_ID = 'target_control_plane';
const ISOLATED_DESKTOP_TARGET_ID = 'target_isolated_desktop';

const CREATE_ISOLATED_DESKTOP_ACTION = 'create_isolated_desktop';

// Aligned with docker-compose.p2.yml service/network names so create/start hits the
// container the worker actually routes to (must-fix 2).
const ISOLATED_CONTAINER_NAME = 'desktop';
const ISOLATED_NETWORK_NAME = process.env.HAMSTER_ISOLATED_NETWORK || 'hamster_p2';
const ALLOWLISTED_IMAGE = process.env.HAMSTER_ISOLATED_DESKTOP_IMAGE || 'hamster/worker-isolated:latest';

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

async function defaultDockerRun(args) {
  const { stdout } = await execFileAsync('docker', args, { timeout: 120000, maxBuffer: 1024 * 1024 });
  const text = stdout.trim();
  const firstLine = text.split('\n')[0]?.trim();
  return firstLine ?? '';
}

function isolatedWorkerEnvArgs() {
  const env = {
    PORT: '8081',
    HAMSTER_API_URL: process.env.HAMSTER_ISOLATED_HAMSTER_API_URL || 'http://api:8080',
    HAMSTER_INTERNAL_SECRET: process.env.HAMSTER_INTERNAL_SECRET || 'dev-internal-secret',
    HAMSTER_AGENT_USERNAME: process.env.HAMSTER_AGENT_USERNAME || 'hamster',
    HAMSTER_AGENT_PASSWORD: process.env.HAMSTER_AGENT_PASSWORD || 'dev-agent-password',
    HAMSTER_MODEL_ID: process.env.HAMSTER_MODEL_ID || '',
    HAMSTER_MODEL_PROVIDER: process.env.HAMSTER_MODEL_PROVIDER || '',
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
    HAMSTER_STEP_DELAY_MS: process.env.HAMSTER_STEP_DELAY_MS || '2000',
  };
  const args = [];
  for (const [k, v] of Object.entries(env)) {
    args.push('-e', `${k}=${v}`);
  }
  return args;
}

/**
 * Minimum-privilege broker: allowlisted image, same host, no docker.sock into the desktop.
 * @param {{ dockerRun?: (args: string[]) => Promise<string> }} [opts]
 */
function createDockerIsolationBroker(opts = {}) {
  const dockerRun = opts.dockerRun || defaultDockerRun;
  return {
    start: async ({ targetId }) => {
      if (targetId && targetId !== ISOLATED_DESKTOP_TARGET_ID) {
        return { ok: false, reason: 'not_isolated_desktop_target' };
      }
      // Reuse an existing named container when present; otherwise create on hamster_p2.
      let containerId = null;
      try {
        containerId = await dockerRun([
          'inspect',
          '--format',
          '{{.Id}}',
          ISOLATED_CONTAINER_NAME,
        ]);
      } catch {
        containerId = null;
      }
      if (!containerId) {
        containerId = await dockerRun([
          'create',
          '--name',
          ISOLATED_CONTAINER_NAME,
          '--network',
          ISOLATED_NETWORK_NAME,
          '--restart',
          'no',
          ...isolatedWorkerEnvArgs(),
          ALLOWLISTED_IMAGE,
        ]);
      }
      await dockerRun(['start', containerId || ISOLATED_CONTAINER_NAME]);
      return { ok: true, containerId: containerId || ISOLATED_CONTAINER_NAME };
    },
    status: async () => {
      try {
        await dockerRun(['image', 'inspect', '--format', '{{.Id}}', ALLOWLISTED_IMAGE]);
      } catch (err) {
        return {
          ok: false,
          running: false,
          state: 'unavailable',
          reason: `image_unavailable:${String(err?.message ?? err)}`,
        };
      }
      try {
        const running = await dockerRun([
          'inspect',
          '--format',
          '{{.State.Running}}',
          ISOLATED_CONTAINER_NAME,
        ]);
        if (running === 'true') {
          return { ok: true, running: true, state: 'ok' };
        }
        // Container exists but is not running — not started, not unavailable.
        return { ok: false, running: false, state: 'not_started' };
      } catch {
        // No such container: broker/image ok, simply not started.
        return { ok: false, running: false, state: 'not_started' };
      }
    },
  };
}

function isKnownTarget(targetId) {
  const id = typeof targetId === 'string' ? targetId.trim() : '';
  return id === CONTROL_PLANE_TARGET_ID || id === ISOLATED_DESKTOP_TARGET_ID;
}

function isIsolatedDesktopTarget(targetId) {
  const id = typeof targetId === 'string' ? targetId.trim() : '';
  return id === ISOLATED_DESKTOP_TARGET_ID;
}

/**
 * Execution-target state for a task, per the design table (slice 1):
 * - control plane task (or unknown task)             -> ok / unavailable
 * - isolated task, waiting on create/start approval  -> pending_approval
 * - isolated task, assigned but not started          -> start_failed
 * - isolated task, mid-run container stop            -> stopped (task Failed, never Succeeded)
 * - isolated task, terminal state                    -> lifecycle state
 *
 * Container-state sentences are exclusive to this surface; they never reuse the
 * task lifecycle words Failed / Succeeded / Denied / Refresh failed / Can't reach.
 */
function taskExecutionState(task) {
  const targetId = task?.target_id ?? CONTROL_PLANE_TARGET_ID;
  if (targetId !== ISOLATED_DESKTOP_TARGET_ID) {
    if (!task) return { targetId, state: 'unavailable' };
    return {
      targetId,
      state: task.status === 'failed' || task.status === 'cancelled' ? task.status : 'ok',
    };
  }
  if (!task) return { targetId, state: 'unavailable' };
  switch (task.status) {
    case 'queued': {
      const pendingCreate = (task.approvals ?? []).some(
        (a) =>
          typeof a?.action === 'string' &&
          a.action === CREATE_ISOLATED_DESKTOP_ACTION &&
          a?.status === 'pending',
      );
      if (pendingCreate) return { targetId, state: 'pending_approval' };
      // Queued without a pending create/start ticket => assigned, not started (or start failed).
      return { targetId, state: 'start_failed' };
    }
    case 'waiting_for_approval':
      return { targetId, state: 'pending_approval' };
    case 'running':
      // Approved + started; while running the task executes inside the isolated desktop.
      return { targetId, state: 'ok' };
    case 'failed':
      // Mid-run container stop => task lifecycle Failed with a known reason, never Succeeded.
      return { targetId, state: 'stopped' };
    case 'succeeded':
      return { targetId, state: 'ok' };
    case 'cancelled':
      return { targetId, state: 'cancelled' };
    default:
      return { targetId, state: 'unavailable' };
  }
}

/**
 * Fail-closed start of the isolated desktop for a target.
 * Returns { ok, reason }; never starts anything it cannot positively resolve.
 */
async function startIsolatedDesktop({ targetId, broker } = {}) {
  if (!isIsolatedDesktopTarget(targetId)) {
    return { ok: false, reason: 'not_isolated_desktop_target' };
  }
  const runner = broker ?? null;
  if (!runner) {
    // No broker configured / injected => fail closed. Never start without a broker.
    return { ok: false, reason: 'isolation_broker_unavailable' };
  }
  try {
    const result = await runner.start({ targetId });
    if (!result?.ok) return { ok: false, reason: result?.reason ?? 'broker_start_failed' };
    return { ok: true, containerId: result.containerId ?? null };
  } catch (err) {
    return { ok: false, reason: `broker_error:${String(err?.message ?? err)}` };
  }
}

/**
 * Container availability probe for the isolated desktop (selector state).
 * Fail closed without a working broker. not_started ≠ unavailable (must-fix 4):
 * - unavailable: broker / image / readiness probe failed → block dispatch
 * - not_started: broker+image ok, container simply not up → dispatch issues start approval
 * - ok: container running
 */
async function probeIsolatedDesktop({ broker } = {}) {
  const runner = broker ?? null;
  if (!runner || typeof runner.status !== 'function') {
    return { ok: false, available: false, state: 'unavailable', reason: 'isolation_broker_unavailable' };
  }
  try {
    const status = await runner.status({ targetId: ISOLATED_DESKTOP_TARGET_ID });
    const state = status?.state
      || (status?.ok || status?.running || status?.available ? 'ok' : null)
      || (status?.reason?.startsWith?.('image_unavailable') ? 'unavailable' : null)
      || 'not_started';
    if (state === 'unavailable') {
      return {
        ok: false,
        available: false,
        state: 'unavailable',
        reason: status?.reason ?? 'unavailable',
      };
    }
    if (state === 'ok') {
      return { ok: true, available: true, state: 'ok', reason: null };
    }
    // not_started (and any non-unavailable idle): dispatchable for the approval chain.
    return { ok: true, available: true, state: 'not_started', reason: null };
  } catch (err) {
    return {
      ok: false,
      available: false,
      state: 'unavailable',
      reason: `broker_error:${String(err?.message ?? err)}`,
    };
  }
}

module.exports = {
  CONTROL_PLANE_TARGET_ID,
  ISOLATED_DESKTOP_TARGET_ID,
  CREATE_ISOLATED_DESKTOP_ACTION,
  ISOLATED_CONTAINER_NAME,
  ISOLATED_NETWORK_NAME,
  ALLOWLISTED_IMAGE,
  createDockerIsolationBroker,
  isKnownTarget,
  isIsolatedDesktopTarget,
  taskExecutionState,
  startIsolatedDesktop,
  probeIsolatedDesktop,
};
