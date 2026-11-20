'use strict';

// Must-fix 1: isolated desktop is not an install/startup dependency.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const composePath = path.join(__dirname, '..', '..', 'docker-compose.p2.yml');

test('docker-compose.p2.yml: api must not depend_on desktop', () => {
  const text = fs.readFileSync(composePath, 'utf8');
  const apiBlock = extractService(text, 'api');
  assert.ok(apiBlock, 'api service missing');
  // Only the depends_on service keys (six-space indent), not later comments mentioning desktop.
  const entryBlock = apiBlock.match(/depends_on:\n((?: {6}.+\n)+)/)?.[1] || '';
  assert.ok(entryBlock.includes('db:'), 'expected db dependency');
  assert.ok(entryBlock.includes('agent:'), 'expected agent dependency');
  assert.equal(/\bdesktop\b/.test(entryBlock), false, 'api must not depend_on desktop');
});

test('docker-compose.p2.yml: desktop is not a standing auto-started service', () => {
  const text = fs.readFileSync(composePath, 'utf8');
  const desktopBlock = extractService(text, 'desktop');
  if (!desktopBlock) {
    // Prefer: no desktop service at all — broker creates after approval.
    assert.equal(desktopBlock, null);
    return;
  }
  // If a reference service remains, it must be profile-gated so `compose up` never starts it.
  assert.match(desktopBlock, /profiles:/);
});

test('docker-compose.p2.yml: control-plane agent is the default eve; isolated URL is separate', () => {
  const text = fs.readFileSync(composePath, 'utf8');
  const apiBlock = extractService(text, 'api');
  assert.ok(apiBlock);
  assert.match(apiBlock, /EVE_API_URL:\s*http:\/\/agent:8081/);
  assert.match(apiBlock, /EVE_ISOLATED_API_URL:\s*http:\/\/desktop:8081/);
  assert.equal(/EVE_API_URL:\s*http:\/\/desktop:8081/.test(apiBlock), false);
  const agentBlock = extractService(text, 'agent');
  assert.ok(agentBlock, 'control-plane agent service required');
});

test('docker-compose.p2.yml: network hamster_p2 has a stable explicit name', () => {
  const text = fs.readFileSync(composePath, 'utf8');
  assert.match(text, /hamster_p2:\s*\n\s+name:\s*hamster_p2/);
});

function extractService(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start < 0) return null;
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    // Next top-level key or next service (exactly two leading spaces + letter).
    if (/^  [a-zA-Z]/.test(line) || /^[a-zA-Z]/.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
}
