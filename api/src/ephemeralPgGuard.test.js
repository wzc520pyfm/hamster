'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertEphemeralDatabaseUrl } = require('./ephemeralPgGuard');

const goodEnv = {
  HAMSTER_P2_EPHEMERAL_PG_OK: '1',
  HAMSTER_P2_PG_DATADIR: '/tmp/hamster-p2-ephemeral-pg-12345/data',
  HAMSTER_P2_PG_PORT: '55123',
  HAMSTER_P2_PG_PID: '999',
  HAMSTER_P2_PG_VERSION: 'postgres (PostgreSQL) 16.15',
};

test('guard accepts ephemeral URL on non-5432 port', () => {
  const info = assertEphemeralDatabaseUrl(
    'postgres://u:p@127.0.0.1:55123/hamster_p2_ephemeral_12345',
    goodEnv,
  );
  assert.equal(info.port, '55123');
});

test('guard refuses default/shared :5432 and compose host', () => {
  assert.throws(
    () =>
      assertEphemeralDatabaseUrl('postgres://hamster:changeme@127.0.0.1:5432/hamster_p2_test', {
        ...goodEnv,
        HAMSTER_P2_PG_PORT: '5432',
      }),
    /5432|Refusing/,
  );
  assert.throws(
    () =>
      assertEphemeralDatabaseUrl('postgres://hamster:changeme@db:5432/hamster', {
        ...goodEnv,
        HAMSTER_P2_PG_PORT: '5432',
      }),
    /db|5432|Refusing/,
  );
  assert.throws(
    () =>
      assertEphemeralDatabaseUrl(
        'postgres://u:p@127.0.0.1:55123/hamster_p2_test',
        goodEnv,
      ),
    /shared|hamster_p2_test|ephemeral/,
  );
  assert.throws(
    () => assertEphemeralDatabaseUrl('postgres://u:p@127.0.0.1:55123/hamster_p2_ephemeral_x', {}),
    /HAMSTER_P2_EPHEMERAL_PG_OK/,
  );
});
