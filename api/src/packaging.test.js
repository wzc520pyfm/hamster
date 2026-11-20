'use strict';

// Contracts for image packaging + api docker CLI availability (unit-level, no live Docker).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

test('build-worker-isolated.sh tags hamster/worker-isolated:latest without up desktop', () => {
  const scriptPath = path.join(root, 'scripts', 'build-worker-isolated.sh');
  assert.ok(fs.existsSync(scriptPath), 'scripts/build-worker-isolated.sh must exist');
  const text = fs.readFileSync(scriptPath, 'utf8');
  assert.match(text, /hamster\/worker-isolated:latest/);
  assert.match(text, /agent\/Dockerfile/);
  assert.match(text, /Do NOT/i);
  assert.match(text, /up desktop|no desktop service/i);
  assert.match(text, /"\$DOCKER" build/);
  // Executable lines must not compose-up desktop (comments may forbid it).
  const executable = text
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .join('\n');
  assert.equal(/compose[^\n]*\bup\b[^\n]*\bdesktop\b/.test(executable), false);
  assert.match(executable, /"\$DOCKER" build/);
});

test('api Dockerfile installs a docker CLI and does not leave broker without docker', () => {
  const df = fs.readFileSync(path.join(root, 'api', 'Dockerfile'), 'utf8');
  // Must ship a docker client binary the broker can execFile('docker').
  assert.match(df, /docker/i);
  assert.ok(
    /docker\.com\/linux\/static|docker-ce-cli|docker\.io|\/usr\/local\/bin\/docker/.test(df),
    'Dockerfile must install a docker CLI client',
  );
});

test('docker-compose.p2.yml: docker.sock only on api; model env passthrough on api', () => {
  const text = fs.readFileSync(path.join(root, 'docker-compose.p2.yml'), 'utf8');
  const api = extractService(text, 'api');
  const agent = extractService(text, 'agent');
  assert.ok(api && agent);
  assert.match(api, /\/var\/run\/docker\.sock/);
  assert.equal(/\/var\/run\/docker\.sock/.test(agent), false);
  assert.match(api, /HAMSTER_MODEL_ID/);
  assert.match(api, /HAMSTER_MODEL_PROVIDER/);
  assert.match(api, /DEEPSEEK_API_KEY/);
  // No standing desktop service dependency.
  const depends = api.match(/depends_on:\n((?: {6}.+\n)+)/)?.[1] || '';
  assert.equal(/\bdesktop\b/.test(depends), false);
});

function extractService(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start < 0) return null;
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^  [a-zA-Z]/.test(line) || /^[a-zA-Z]/.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
}
