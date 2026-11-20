'use strict';

// Target-aware eve routing: control-plane and isolated-desktop must not share one endpoint.

const test = require('node:test');
const assert = require('node:assert/strict');
const eve = require('./eve');
const isolation = require('./isolation');

test('eve baseUrlForTarget: control plane uses EVE_API_URL, isolated uses EVE_ISOLATED_API_URL', () => {
  const control = eve.baseUrlForTarget(isolation.CONTROL_PLANE_TARGET_ID);
  const isolated = eve.baseUrlForTarget(isolation.ISOLATED_DESKTOP_TARGET_ID);
  assert.equal(typeof control, 'string');
  assert.equal(typeof isolated, 'string');
  assert.notEqual(
    control,
    isolated,
    'control-plane and isolated-desktop workers must resolve to different eve base URLs',
  );
  assert.match(isolated, /desktop/i);
});

test('eve baseUrlForTarget: unknown / missing target stays on control plane (never host)', () => {
  const fallback = eve.baseUrlForTarget(undefined);
  assert.equal(fallback, eve.baseUrlForTarget(isolation.CONTROL_PLANE_TARGET_ID));
  assert.equal(eve.baseUrlForTarget('host_machine'), eve.baseUrlForTarget(isolation.CONTROL_PLANE_TARGET_ID));
});
