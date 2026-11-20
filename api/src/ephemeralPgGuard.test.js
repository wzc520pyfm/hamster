'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertEphemeralDatabaseUrl,
  assertEphemeralLiveConnection,
} = require('./ephemeralPgGuard');

const goodEnv = {
  HAMSTER_P2_EPHEMERAL_PG_OK: '1',
  HAMSTER_P2_PG_DATADIR: '/tmp/hamster-p2-ephemeral-pg-12345/data',
  HAMSTER_P2_PG_PORT: '55123',
  HAMSTER_P2_PG_PID: '999',
  HAMSTER_P2_PG_VERSION: 'postgres (PostgreSQL) 16.15',
  HAMSTER_P2_PG_INSTANCE_TOKEN: 'tok_abcdef0123456789deadbeef',
  DATABASE_URL: 'postgres://u:p@127.0.0.1:55123/hamster_p2_ephemeral_12345',
};

test('guard accepts ephemeral URL on non-5432 port', () => {
  const info = assertEphemeralDatabaseUrl(
    'postgres://u:p@127.0.0.1:55123/hamster_p2_ephemeral_12345',
    goodEnv,
  );
  assert.equal(info.port, '55123');
  assert.equal(info.instanceToken, goodEnv.HAMSTER_P2_PG_INSTANCE_TOKEN);
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

test('guard refuses missing/short instance token (env forge incomplete)', () => {
  assert.throws(
    () =>
      assertEphemeralDatabaseUrl(goodEnv.DATABASE_URL, {
        ...goodEnv,
        HAMSTER_P2_PG_INSTANCE_TOKEN: '',
      }),
    /INSTANCE_TOKEN/,
  );
  assert.throws(
    () =>
      assertEphemeralDatabaseUrl(goodEnv.DATABASE_URL, {
        ...goodEnv,
        HAMSTER_P2_PG_INSTANCE_TOKEN: 'short',
      }),
    /INSTANCE_TOKEN/,
  );
});

test('live connection: refuses forged dataDir / wrong marker / wrong URL', async () => {
  const liveDir = '/tmp/hamster-p2-ephemeral-pg-12345/data';
  const token = goodEnv.HAMSTER_P2_PG_INSTANCE_TOKEN;

  // Happy path mock
  const okClient = {
    async query(sql) {
      if (String(sql).includes('SHOW data_directory')) {
        return { rows: [{ data_directory: liveDir }] };
      }
      if (String(sql).includes('hamster_ephemeral_marker')) {
        return { rows: [{ token, data_directory: liveDir }] };
      }
      throw new Error(`unexpected sql ${sql}`);
    },
  };
  const verified = await assertEphemeralLiveConnection(okClient, goodEnv);
  assert.equal(verified.verified, true);
  assert.equal(verified.liveDataDirectory, liveDir);
  assert.equal(verified.markerToken, token);

  // Forged env dataDir — live SHOW differs
  await assert.rejects(
    () =>
      assertEphemeralLiveConnection(okClient, {
        ...goodEnv,
        HAMSTER_P2_PG_DATADIR: '/tmp/hamster-p2-ephemeral-pg-FORGED/data',
      }),
    /data_directory|!== expected|refusing/i,
  );

  // Forged marker token in env
  const wrongMarkerClient = {
    async query(sql) {
      if (String(sql).includes('SHOW data_directory')) {
        return { rows: [{ data_directory: liveDir }] };
      }
      return { rows: [{ token: 'forged_other_token_xxxxxxxxxxxx', data_directory: liveDir }] };
    },
  };
  await assert.rejects(
    () => assertEphemeralLiveConnection(wrongMarkerClient, goodEnv),
    /marker mismatch|refusing/i,
  );

  // Forged DATABASE_URL pointing at different port than env claim
  await assert.rejects(
    () =>
      assertEphemeralLiveConnection(okClient, {
        ...goodEnv,
        DATABASE_URL: 'postgres://u:p@127.0.0.1:55999/hamster_p2_ephemeral_12345',
      }),
    /port|DATABASE_URL|!==/i,
  );

  // Missing marker table
  const noMarker = {
    async query(sql) {
      if (String(sql).includes('SHOW data_directory')) {
        return { rows: [{ data_directory: liveDir }] };
      }
      throw new Error('relation "hamster_ephemeral_marker" does not exist');
    },
  };
  await assert.rejects(
    () => assertEphemeralLiveConnection(noMarker, goodEnv),
    /marker missing|refusing/i,
  );
});
