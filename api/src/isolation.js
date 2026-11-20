'use strict';

// Hamster P2 slice 1 — isolated desktop as an assignable execution target.
// Pure decision helpers + fail-closed start broker. The Docker broker runs only in the
// control plane and must use the minimum privilege: allowlisted image only, no host-root
// bind mounts, no docker.sock mounted into the desktop, no privileged/host-pid/host-network
// flags, create/start only after an approval ticket bound to that targetId.

const CONTROL_PLANE_TARGET_ID = 'target_control_plane';
const ISOLATED_DESKTOP_TARGET_ID = 'target_isolated_desktop';

const CREATE_ISOLATED_DESKTOP_ACTION = 'create_isolated_desktop';

/** Exact EN copy for create/start key params (direction §3). Do not synonym-rewrite. */
const ISOLATED_DESKTOP_SCOPE =
  'An isolated container on the same host as this Hamster. The bot cannot use the host itself.';

const INVALIDATED_NOTE = 'Invalidated — approve again';
const APPROVED_ONCE_NOTE = 'Approved for this action only';

/** Event kind that marks a mid-run isolated-desktop container stop (not any task failure). */
const ISOLATED_DESKTOP_STOPPED_KIND = 'isolated_desktop_stopped';

// Aligned with docker-compose.p2.yml service/network names so create/start hits the
// container the worker actually routes to (must-fix 2).
const ISOLATED_CONTAINER_NAME = 'desktop';
const ISOLATED_NETWORK_NAME = process.env.HAMSTER_ISOLATED_NETWORK || 'hamster_p2';
const ALLOWLISTED_IMAGE = process.env.HAMSTER_ISOLATED_DESKTOP_IMAGE || 'hamster/worker-isolated:latest';

/** Docker labels proving Hamster-managed provenance (not an arbitrary same-name runtime). */
const LABEL_MANAGED = 'hamster.managed';
const LABEL_INSTANCE = 'hamster.instance_id';
const LABEL_TARGET = 'hamster.target_id';
const MANAGED_LABEL_VALUE = 'approved';

/** Params for a create/start ticket — always includes targetId + plain-language scope. */
function createIsolatedDesktopParams(taskId, targetId) {
  return {
    taskId,
    targetId,
    scope: ISOLATED_DESKTOP_SCOPE,
  };
}

function containerIdsEqual(a, b) {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') return false;
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x === y) return true;
  // Docker may report full vs short container ids — NOT used for image digests.
  return x.startsWith(y) || y.startsWith(x);
}

/** Complete Docker image digest: sha256: + exactly 64 hex chars. Truncation fails. */
const IMAGE_DIGEST_RE = /^sha256:[a-f0-9]{64}$/i;

function isCompleteImageDigest(id) {
  return typeof id === 'string' && IMAGE_DIGEST_RE.test(id.trim());
}

/**
 * Strict digest equality — no prefix match (rejects imageId='sha256:' and truncations).
 */
function digestsEqual(a, b) {
  if (!isCompleteImageDigest(a) || !isCompleteImageDigest(b)) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Digest-only allowlist check. Tag/name match alone is NEVER sufficient.
 * Prefers opts.expectedImageId (pinned managed/approved digest) over current tag resolve.
 *
 * @param {object|null|undefined} probe
 * @param {{ expectedImageId?: string|null, allowlistedImageId?: string|null }} [opts]
 */
function imageIsAllowlisted(probe, opts = {}) {
  const actualId =
    typeof probe?.imageId === 'string' && probe.imageId.trim() ? probe.imageId.trim() : null;
  if (!isCompleteImageDigest(actualId)) return false;
  // Pin to expected (managed) digest when provided — tag retarget must not override.
  const expectedId =
    (typeof opts.expectedImageId === 'string' && opts.expectedImageId.trim()) ||
    (typeof opts.allowlistedImageId === 'string' && opts.allowlistedImageId.trim()) ||
    (typeof probe?.allowlistedImageId === 'string' && probe.allowlistedImageId.trim()) ||
    null;
  if (!isCompleteImageDigest(expectedId)) return false;
  return digestsEqual(actualId, expectedId);
}

/**
 * Freeze the identity snapshot used across probe → health → session boundary.
 */
function freezeIsolatedIdentity({ probe, health, managed } = {}) {
  return {
    targetId: ISOLATED_DESKTOP_TARGET_ID,
    instanceId: managed?.instanceId || probe?.instanceId || health?.instanceId || null,
    containerId: managed?.containerId || probe?.containerId || null,
    imageId: managed?.imageId || probe?.imageId || null,
    configImage: managed?.configImage || probe?.configImage || null,
    approvalId: managed?.approvalId || null,
  };
}

/**
 * Fail closed: every required expected field must be present on actual and match.
 * identitiesMatch(fullExpected, {}) === false.
 */
function identitiesMatch(expected, actual) {
  if (!expected || !actual || typeof expected !== 'object' || typeof actual !== 'object') {
    return false;
  }
  const required = ['targetId', 'instanceId', 'containerId', 'imageId'];
  for (const key of required) {
    const exp = expected[key];
    const act = actual[key];
    if (exp == null || exp === '' || act == null || act === '') return false;
    if (key === 'imageId') {
      if (!digestsEqual(String(exp), String(act))) return false;
    } else if (key === 'containerId') {
      if (!containerIdsEqual(String(exp), String(act))) return false;
    } else if (String(exp) !== String(act)) {
      return false;
    }
  }
  return true;
}

/**
 * Decide create vs restart identity for an approve→start without docker rm/stop of foreign.
 * @returns {{ ok: true, mode: 'create'|'restart', instanceId: string, managed?: object }
 *   | { ok: false, reason: string }}
 */
function resolveIsolatedStartIdentity({ managed, probe } = {}) {
  const hasContainer = Boolean(probe?.containerId);
  const probeManaged =
    probe?.managed === MANAGED_LABEL_VALUE &&
    probe?.instanceId &&
    probe?.targetId === ISOLATED_DESKTOP_TARGET_ID;

  if (!hasContainer) {
    return { ok: true, mode: 'create', instanceId: null }; // caller mints new id
  }

  // Stopped or running named container present.
  if (
    managed &&
    probeManaged &&
    managed.instanceId === probe.instanceId &&
    containerIdsEqual(managed.containerId, probe.containerId) &&
    isCompleteImageDigest(managed.imageId) &&
    digestsEqual(managed.imageId, probe.imageId)
  ) {
    // Prior Hamster-managed instance (incl. stopped): coherent restart, same instanceId.
    // Digest remains pinned to approved immutable A (tag retarget does not change this).
    return { ok: true, mode: 'restart', instanceId: managed.instanceId, managed };
  }
  // Managed row exists but probe digest differs (tag retarget / replaced image) → new approval.
  if (managed && hasContainer && probeManaged && managed.instanceId === probe.instanceId) {
    if (!digestsEqual(managed.imageId, probe.imageId)) {
      return {
        ok: false,
        reason: 'managed_image_digest_changed_requires_approval',
        containerId: probe.containerId,
        instanceId: probe.instanceId,
      };
    }
  }

  // Foreign / unmanaged same-name — fail closed; never auto stop/rm.
  return {
    ok: false,
    reason: 'unmanaged_or_foreign_container_present',
    containerId: probe.containerId,
    instanceId: probe.instanceId || null,
  };
}

/** Fill missing identity fields only; never overwrite start()-returned values. */
function mergeIdentityFillMissing(primary, secondary) {
  const out = { ...primary };
  if (!out.containerId && secondary?.containerId) out.containerId = secondary.containerId;
  if (!out.imageId && secondary?.imageId) out.imageId = secondary.imageId;
  if (!out.configImage && secondary?.configImage) out.configImage = secondary.configImage;
  if (!out.instanceId && secondary?.instanceId) out.instanceId = secondary.instanceId;
  if (!out.targetId && secondary?.targetId) out.targetId = secondary.targetId;
  return out;
}

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

async function defaultDockerRun(args) {
  const { stdout } = await execFileAsync('docker', args, { timeout: 120000, maxBuffer: 1024 * 1024 });
  const text = stdout.trim();
  const firstLine = text.split('\n')[0]?.trim();
  return firstLine ?? '';
}

function isolatedWorkerEnvArgs(extra = {}) {
  // Forward the same model env names the agent path uses (values come from api process env;
  // compose passes placeholders — never commit secrets).
  const env = {
    PORT: '8081',
    HAMSTER_API_URL: process.env.HAMSTER_ISOLATED_HAMSTER_API_URL || 'http://api:8080',
    HAMSTER_INTERNAL_SECRET: process.env.HAMSTER_INTERNAL_SECRET || 'dev-internal-secret',
    HAMSTER_AGENT_USERNAME: process.env.HAMSTER_AGENT_USERNAME || 'hamster',
    HAMSTER_AGENT_PASSWORD: process.env.HAMSTER_AGENT_PASSWORD || 'dev-agent-password',
    HAMSTER_MODEL_ID: process.env.HAMSTER_MODEL_ID || '',
    HAMSTER_MODEL_PROVIDER: process.env.HAMSTER_MODEL_PROVIDER || '',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
    HAMSTER_STEP_DELAY_MS: process.env.HAMSTER_STEP_DELAY_MS || '2000',
    ...extra,
  };
  const args = [];
  for (const [k, v] of Object.entries(env)) {
    args.push('-e', `${k}=${v}`);
  }
  return args;
}

function parseInspectStatusLine(text) {
  const parts = String(text || '').trim().split('\t');
  const [
    containerId = '',
    imageId = '',
    configImage = '',
    running = '',
    instanceId = '',
    managed = '',
    targetId = '',
  ] = parts;
  return {
    containerId: containerId || null,
    imageId: imageId || null,
    configImage: configImage || null,
    running: running === 'true',
    instanceId: instanceId && instanceId !== '<no value>' ? instanceId : null,
    managed: managed && managed !== '<no value>' ? managed : null,
    targetId: targetId && targetId !== '<no value>' ? targetId : null,
  };
}

/**
 * Minimum-privilege broker: allowlisted image, same host, no docker.sock into the desktop.
 * @param {{ dockerRun?: (args: string[]) => Promise<string> }} [opts]
 */
function createDockerIsolationBroker(opts = {}) {
  const dockerRun = opts.dockerRun || defaultDockerRun;
  const allowlistedImage = opts.allowlistedImage || ALLOWLISTED_IMAGE;
  const inspectFormat = [
    '{{.Id}}',
    '{{.Image}}',
    '{{.Config.Image}}',
    '{{.State.Running}}',
    `{{index .Config.Labels "${LABEL_INSTANCE}"}}`,
    `{{index .Config.Labels "${LABEL_MANAGED}"}}`,
    `{{index .Config.Labels "${LABEL_TARGET}"}}`,
  ].join('\t');

  async function inspectNamed() {
    const raw = await dockerRun(['inspect', '--format', inspectFormat, ISOLATED_CONTAINER_NAME]);
    return parseInspectStatusLine(raw);
  }

  return {
    /**
     * Create/start only after approval. Never adopts an arbitrary same-name container:
     * unmanaged name collision → fail closed (does NOT stop/rm live desktop).
     */
    start: async ({ targetId, instanceId, approvalId } = {}) => {
      if (targetId && targetId !== ISOLATED_DESKTOP_TARGET_ID) {
        return { ok: false, reason: 'not_isolated_desktop_target' };
      }
      if (!instanceId || typeof instanceId !== 'string') {
        return { ok: false, reason: 'instance_id_required' };
      }
      let allowlistedImageId;
      try {
        allowlistedImageId = await dockerRun([
          'image',
          'inspect',
          '--format',
          '{{.Id}}',
          allowlistedImage,
        ]);
      } catch (err) {
        return { ok: false, reason: `image_unavailable:${String(err?.message ?? err)}` };
      }
      if (!isCompleteImageDigest(allowlistedImageId)) {
        return {
          ok: false,
          reason: 'image_digest_incomplete',
          detail: allowlistedImageId || null,
        };
      }

      let existing = null;
      try {
        existing = await inspectNamed();
      } catch {
        existing = null;
      }

      if (existing?.containerId) {
        // Fail closed: do not silently adopt / replace an unmanaged or foreign instance.
        // Never docker rm/stop here — live desktop must not be replaced by this path.
        // Restart requires container digest === complete allowlisted digest (or caller-pinned).
        const digestOk = digestsEqual(existing.imageId, allowlistedImageId);
        if (
          existing.managed !== MANAGED_LABEL_VALUE ||
          existing.instanceId !== instanceId ||
          existing.targetId !== ISOLATED_DESKTOP_TARGET_ID ||
          !digestOk
        ) {
          return {
            ok: false,
            reason: 'unmanaged_or_foreign_container_present',
            containerId: existing.containerId,
            instanceId: existing.instanceId,
          };
        }
        await dockerRun(['start', existing.containerId]);
        const after = await inspectNamed();
        if (!digestsEqual(after.imageId, allowlistedImageId)) {
          return {
            ok: false,
            reason: 'image_digest_mismatch_after_start',
            imageId: after.imageId,
            expectedImageId: allowlistedImageId,
          };
        }
        return {
          ok: true,
          containerId: after.containerId,
          imageId: after.imageId,
          configImage: after.configImage,
          instanceId: after.instanceId,
          allowlistedImageId,
        };
      }

      // Create with COMPLETE immutable digest — never the mutable tag ref.
      // Isolated image CMD override: identity gateway wraps real `eve start`.
      const containerId = await dockerRun([
        'create',
        '--name',
        ISOLATED_CONTAINER_NAME,
        '--network',
        ISOLATED_NETWORK_NAME,
        '--restart',
        'no',
        '--label',
        `${LABEL_MANAGED}=${MANAGED_LABEL_VALUE}`,
        '--label',
        `${LABEL_INSTANCE}=${instanceId}`,
        '--label',
        `${LABEL_TARGET}=${ISOLATED_DESKTOP_TARGET_ID}`,
        ...(approvalId ? ['--label', `hamster.approval_id=${approvalId}`] : []),
        ...isolatedWorkerEnvArgs({
          HAMSTER_ISOLATED_INSTANCE_ID: instanceId,
          HAMSTER_ISOLATED_TARGET_ID: ISOLATED_DESKTOP_TARGET_ID,
          HAMSTER_ISOLATED_IMAGE_ID: allowlistedImageId,
        }),
        allowlistedImageId,
        'node',
        '/app/lib/isolatedIdentityGateway.mjs',
      ]);
      // Verify inspect digest before start — refuse mutable-tag drift / wrong image.
      let beforeStart;
      try {
        beforeStart = await inspectNamed();
      } catch (err) {
        return {
          ok: false,
          reason: `inspect_before_start_failed:${String(err?.message ?? err)}`,
        };
      }
      if (!digestsEqual(beforeStart.imageId, allowlistedImageId)) {
        return {
          ok: false,
          reason: 'image_digest_mismatch_before_start',
          imageId: beforeStart.imageId,
          expectedImageId: allowlistedImageId,
        };
      }
      await dockerRun(['start', containerId || ISOLATED_CONTAINER_NAME]);
      let afterCreate;
      try {
        afterCreate = await inspectNamed();
      } catch {
        afterCreate = {
          containerId: containerId || null,
          imageId: allowlistedImageId,
          configImage: allowlistedImageId,
          instanceId,
        };
      }
      if (!digestsEqual(afterCreate.imageId, allowlistedImageId)) {
        return {
          ok: false,
          reason: 'image_digest_mismatch_after_start',
          imageId: afterCreate.imageId,
          expectedImageId: allowlistedImageId,
        };
      }
      return {
        ok: true,
        containerId: afterCreate.containerId || containerId,
        imageId: afterCreate.imageId || allowlistedImageId,
        configImage: afterCreate.configImage || allowlistedImageId,
        instanceId: afterCreate.instanceId || instanceId,
        allowlistedImageId,
      };
    },
    status: async () => {
      let allowlistedImageId = null;
      try {
        allowlistedImageId = await dockerRun([
          'image',
          'inspect',
          '--format',
          '{{.Id}}',
          allowlistedImage,
        ]);
      } catch (err) {
        return {
          ok: false,
          running: false,
          state: 'unavailable',
          reason: `image_unavailable:${String(err?.message ?? err)}`,
        };
      }
      if (!isCompleteImageDigest(allowlistedImageId)) {
        return {
          ok: false,
          running: false,
          state: 'unavailable',
          reason: 'image_digest_incomplete',
        };
      }
      try {
        const info = await inspectNamed();
        const base = {
          containerId: info.containerId,
          imageId: info.imageId,
          configImage: info.configImage,
          instanceId: info.instanceId,
          managed: info.managed,
          targetId: info.targetId || ISOLATED_DESKTOP_TARGET_ID,
          allowlistedImageId,
        };
        if (info.running) {
          return { ok: true, running: true, state: 'ok', ...base };
        }
        return { ok: false, running: false, state: 'not_started', ...base };
      } catch {
        return {
          ok: false,
          running: false,
          state: 'not_started',
          allowlistedImageId,
        };
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
    case 'failed': {
      // "The isolated desktop stopped" only for a mid-run container stop, detected from
      // the container (event kind / flag) — never for every isolated task failure.
      const midRunStop =
        task.isolatedDesktopStopped === true ||
        (Array.isArray(task.events) &&
          task.events.some(
            (e) =>
              e?.kind === ISOLATED_DESKTOP_STOPPED_KIND ||
              e?.kind === 'isolated_desktop_stopped',
          ));
      return { targetId, state: midRunStop ? 'stopped' : 'failed' };
    }
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
 * Returns { ok, reason, ...identity }; never starts anything it cannot positively resolve.
 * Never stops/replaces an unmanaged live desktop — broker fails closed on name collision.
 */
async function startIsolatedDesktop({ targetId, broker, instanceId, approvalId } = {}) {
  if (!isIsolatedDesktopTarget(targetId)) {
    return { ok: false, reason: 'not_isolated_desktop_target' };
  }
  const runner = broker ?? null;
  if (!runner) {
    return { ok: false, reason: 'isolation_broker_unavailable' };
  }
  if (!instanceId || typeof instanceId !== 'string') {
    return { ok: false, reason: 'instance_id_required' };
  }
  try {
    const result = await runner.start({ targetId, instanceId, approvalId });
    if (!result?.ok) return { ok: false, reason: result?.reason ?? 'broker_start_failed' };
    return {
      ok: true,
      containerId: result.containerId ?? null,
      imageId: result.imageId ?? null,
      configImage: result.configImage ?? null,
      instanceId: result.instanceId ?? instanceId,
    };
  } catch (err) {
    return { ok: false, reason: `broker_error:${String(err?.message ?? err)}` };
  }
}

/**
 * Container availability probe for the isolated desktop (selector state).
 * Fail closed without a working broker. not_started ≠ unavailable (must-fix 4):
 * - unavailable: broker / image / readiness probe failed → block dispatch
 * - not_started: broker+image ok, container simply not up → dispatch issues start approval
 * - ok: container running (identity fields attached when broker reports them)
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
    const identity = {
      containerId: status?.containerId ?? null,
      imageId: status?.imageId ?? null,
      configImage: status?.configImage ?? null,
      instanceId: status?.instanceId ?? null,
      managed: status?.managed ?? null,
      targetId: status?.targetId ?? ISOLATED_DESKTOP_TARGET_ID,
    };
    if (state === 'unavailable') {
      return {
        ok: false,
        available: false,
        state: 'unavailable',
        reason: status?.reason ?? 'unavailable',
        ...identity,
      };
    }
    const allowlistedImageId = status?.allowlistedImageId ?? null;
    if (state === 'ok') {
      return {
        ok: true,
        available: true,
        state: 'ok',
        reason: null,
        allowlistedImageId,
        ...identity,
      };
    }
    return {
      ok: true,
      available: true,
      state: 'not_started',
      reason: null,
      allowlistedImageId,
      ...identity,
    };
  } catch (err) {
    return {
      ok: false,
      available: false,
      state: 'unavailable',
      reason: `broker_error:${String(err?.message ?? err)}`,
    };
  }
}

/**
 * Pure gate: may createTask skip minting create_isolated_desktop?
 * Reuse requires previously managed/approved SAME instance identity — not merely
 * name/image + 2xx. Client claims are ignored.
 */
function shouldSkipCreateIsolatedDesktopApproval(evidence = {}) {
  void evidence.clientClaim;
  const state = evidence.probe?.state;
  if (state === 'not_started') {
    return { skip: false, reason: 'not_started' };
  }
  if (state !== 'ok') {
    return {
      skip: false,
      reason: state === 'unavailable' ? 'unavailable' : 'unavailable_or_unknown',
    };
  }

  const managed = evidence.managed;
  if (!managed || !managed.instanceId || !managed.containerId) {
    return { skip: false, reason: 'unmanaged_instance' };
  }
  if (managed.targetId && managed.targetId !== ISOLATED_DESKTOP_TARGET_ID) {
    return { skip: false, reason: 'managed_target_mismatch' };
  }
  if (!evidence.probe?.containerId || !containerIdsEqual(managed.containerId, evidence.probe.containerId)) {
    return { skip: false, reason: 'container_id_mismatch' };
  }
  if (!evidence.probe?.instanceId || evidence.probe.instanceId !== managed.instanceId) {
    return { skip: false, reason: 'instance_id_mismatch' };
  }
  if (evidence.probe.managed && evidence.probe.managed !== MANAGED_LABEL_VALUE) {
    return { skip: false, reason: 'probe_not_managed' };
  }
  // Digest compare only — tag match with wrong imageId must fail.
  if (
    !imageIsAllowlisted(evidence.probe, {
      expectedImageId: managed.imageId,
      allowlistedImageId: evidence.probe.allowlistedImageId || managed.imageId,
    })
  ) {
    return { skip: false, reason: 'image_digest_mismatch' };
  }

  if (evidence.health?.ok !== true) {
    return { skip: false, reason: 'health_not_ready' };
  }
  if (!evidence.health.instanceId || evidence.health.instanceId !== managed.instanceId) {
    return { skip: false, reason: 'health_instance_mismatch' };
  }
  if (!evidence.health.targetId || evidence.health.targetId !== ISOLATED_DESKTOP_TARGET_ID) {
    return { skip: false, reason: 'health_target_mismatch' };
  }
  return { skip: true, reason: null };
}

/**
 * Server-side verify for reuse: managed provenance + probe identity + bound health.
 * Never calls broker.start — create/start still requires an approval ticket.
 */
async function verifyHealthyIsolatedDesktopForReuse(opts = {}) {
  void opts.clientClaim;
  const getManaged =
    typeof opts.getManagedInstance === 'function' ? opts.getManagedInstance : async () => null;

  let managed = null;
  try {
    managed = await getManaged(ISOLATED_DESKTOP_TARGET_ID);
  } catch (err) {
    return {
      reuse: false,
      probe: null,
      health: null,
      managed: null,
      identity: null,
      reason: `managed_lookup_failed:${String(err?.message ?? err)}`,
    };
  }

  const probe = await probeIsolatedDesktop({ broker: opts.broker });
  if (probe.state !== 'ok') {
    return {
      reuse: false,
      probe,
      health: null,
      managed,
      identity: null,
      reason:
        probe.state === 'not_started'
          ? 'not_started'
          : probe.reason || probe.state || 'unavailable',
    };
  }

  const expectedIdentity = managed
    ? {
        targetId: ISOLATED_DESKTOP_TARGET_ID,
        instanceId: managed.instanceId,
      }
    : null;

  const waitReady =
    opts.waitReady ||
    (async (readyOpts) => {
      const readiness = require('./readiness');
      return readiness.checkIsolatedDesktopHealthOnce(readyOpts);
    });
  const health = await waitReady({
    baseUrl: opts.baseUrl || process.env.EVE_ISOLATED_API_URL || 'http://desktop:8081',
    expectedIdentity,
    requireHealthIdentity: true,
  });
  const decision = shouldSkipCreateIsolatedDesktopApproval({
    probe,
    health,
    managed,
    clientClaim: opts.clientClaim,
  });
  const identity = decision.skip
    ? freezeIsolatedIdentity({ probe, health, managed })
    : null;
  return {
    reuse: decision.skip,
    reason: decision.reason,
    probe,
    health,
    managed,
    identity,
  };
}

/**
 * TOCTOU guard at session-creation boundary: re-probe + re-health must still
 * match the frozen managed identity. Fail closed → caller mints create/start ticket.
 */
async function recheckManagedIsolatedIdentity(opts = {}) {
  const expected = opts.expected;
  if (!expected?.instanceId || !expected?.containerId) {
    return { ok: false, reason: 'expected_identity_missing' };
  }
  const probe = await probeIsolatedDesktop({ broker: opts.broker });
  if (probe.state !== 'ok') {
    return { ok: false, reason: probe.reason || probe.state || 'probe_failed', probe, health: null };
  }
  if (!identitiesMatch(expected, probe)) {
    return { ok: false, reason: 'identity_swapped', probe, health: null };
  }
  if (
    !imageIsAllowlisted(probe, {
      expectedImageId: expected.imageId,
      allowlistedImageId: probe.allowlistedImageId || expected.imageId,
    })
  ) {
    return { ok: false, reason: 'image_digest_mismatch', probe, health: null };
  }

  const getManaged =
    typeof opts.getManagedInstance === 'function' ? opts.getManagedInstance : async () => null;
  let managed = null;
  try {
    managed = await getManaged(ISOLATED_DESKTOP_TARGET_ID);
  } catch (err) {
    return { ok: false, reason: `managed_lookup_failed:${String(err?.message ?? err)}` };
  }
  if (!managed || managed.instanceId !== expected.instanceId) {
    return { ok: false, reason: 'managed_provenance_lost', probe, managed };
  }
  if (!containerIdsEqual(managed.containerId, probe.containerId)) {
    return { ok: false, reason: 'managed_container_mismatch', probe, managed };
  }

  const waitReady =
    opts.waitReady ||
    (async (readyOpts) => {
      const readiness = require('./readiness');
      return readiness.checkIsolatedDesktopHealthOnce(readyOpts);
    });
  const health = await waitReady({
    baseUrl: opts.baseUrl || process.env.EVE_ISOLATED_API_URL || 'http://desktop:8081',
    expectedIdentity: {
      targetId: ISOLATED_DESKTOP_TARGET_ID,
      instanceId: expected.instanceId,
    },
    requireHealthIdentity: true,
  });
  if (health?.ok !== true) {
    return { ok: false, reason: health?.reason || 'health_not_ready', probe, health, managed };
  }
  if (health.instanceId !== expected.instanceId || health.targetId !== ISOLATED_DESKTOP_TARGET_ID) {
    return { ok: false, reason: 'health_identity_mismatch', probe, health, managed };
  }
  return { ok: true, probe, health, managed };
}

/**
 * Plan isolated createTask / retry / target-switch after a reuse verify.
 * mintCreateTicket when reuse is not positively established; never auto-start docker here.
 */
function planIsolatedCreateTask({ reuse } = {}) {
  if (reuse?.reuse === true) {
    return { mintCreateTicket: false, spawnSession: true, startDesktop: false };
  }
  return { mintCreateTicket: true, spawnSession: false, startDesktop: false };
}

module.exports = {
  CONTROL_PLANE_TARGET_ID,
  ISOLATED_DESKTOP_TARGET_ID,
  CREATE_ISOLATED_DESKTOP_ACTION,
  ISOLATED_DESKTOP_SCOPE,
  INVALIDATED_NOTE,
  APPROVED_ONCE_NOTE,
  ISOLATED_DESKTOP_STOPPED_KIND,
  ISOLATED_CONTAINER_NAME,
  ISOLATED_NETWORK_NAME,
  ALLOWLISTED_IMAGE,
  LABEL_MANAGED,
  LABEL_INSTANCE,
  LABEL_TARGET,
  MANAGED_LABEL_VALUE,
  createIsolatedDesktopParams,
  createDockerIsolationBroker,
  isKnownTarget,
  isIsolatedDesktopTarget,
  taskExecutionState,
  startIsolatedDesktop,
  probeIsolatedDesktop,
  shouldSkipCreateIsolatedDesktopApproval,
  verifyHealthyIsolatedDesktopForReuse,
  recheckManagedIsolatedIdentity,
  planIsolatedCreateTask,
  freezeIsolatedIdentity,
  identitiesMatch,
  imageIsAllowlisted,
  containerIdsEqual,
  digestsEqual,
  isCompleteImageDigest,
  IMAGE_DIGEST_RE,
  parseInspectStatusLine,
  resolveIsolatedStartIdentity,
  mergeIdentityFillMissing,
};

