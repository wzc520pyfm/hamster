'use strict';

// Hamster P2 slice 1 — isolated desktop as an assignable execution target.
// Pure decision helpers + fail-closed start broker. The Docker broker runs only in the
// control plane and must use the minimum privilege: allowlisted image only, no host-root
// bind mounts, no docker.sock mounted into the desktop, no privileged/host-pid/host-network
// flags, create/start only after an approval ticket bound to that targetId.

const CONTROL_PLANE_TARGET_ID = 'target_control_plane';
const ISOLATED_DESKTOP_TARGET_ID = 'target_isolated_desktop';

const CREATE_ISOLATED_DESKTOP_ACTION = 'create_isolated_desktop';

const ISOLATED_CONTAINER_NAME = 'hamster-isolated-desktop';
const ALLOWLISTED_IMAGE = process.env.HAMSTER_ISOLATED_DESKTOP_IMAGE || 'hamster/worker-isolated:latest';

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

async function dockerRun(args) {
  const { stdout } = await execFileAsync('docker', args, { timeout: 120000, maxBuffer: 1024 * 1024 });
  const text = stdout.trim();
  const firstLine = text.split('\n')[0]?.trim();
  return firstLine ?? '';
}

/** Minimum-privilege broker: allowlisted image, same host, no docker.sock into the desktop. */
function createDockerIsolationBroker() {
  return {
    start: async ({ targetId }) => {
      const containerId = await dockerRun([
        'create',
        '--name',
        ISOLATED_CONTAINER_NAME,
        '--network',
        'hamster_isolated',
        ALLOWLISTED_IMAGE,
      ]);
      await dockerRun(['start', containerId]);
      return { ok: true, containerId };
    },
    status: async () => {
      const running = await dockerRun([
        'inspect',
        '--format',
        '{{.State.Running}}',
        ISOLATED_CONTAINER_NAME,
      ]);
      return { ok: running === 'true' };
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
 * Fail closed: without a working broker probe the desktop counts as unavailable.
 */
async function probeIsolatedDesktop({ broker } = {}) {
  const runner = broker ?? null;
  if (!runner || typeof runner.status !== 'function') {
    return { ok: false, available: false, reason: 'isolation_broker_unavailable' };
  }
  try {
    const status = await runner.status({ targetId: ISOLATED_DESKTOP_TARGET_ID });
    const available = Boolean(status?.ok ?? status?.running ?? status?.available);
    return { ok: Boolean(status?.ok ?? status?.running ?? status?.available), available, reason: null };
  } catch (err) {
    return { ok: false, available: false, reason: `broker_error:${String(err?.message ?? err)}` };
  }
}

module.exports = {
  CONTROL_PLANE_TARGET_ID,
  ISOLATED_DESKTOP_TARGET_ID,
  CREATE_ISOLATED_DESKTOP_ACTION,
  ISOLATED_CONTAINER_NAME,
  ALLOWLISTED_IMAGE,
  createDockerIsolationBroker,
  isKnownTarget,
  isIsolatedDesktopTarget,
  taskExecutionState,
  startIsolatedDesktop,
  probeIsolatedDesktop,
};
