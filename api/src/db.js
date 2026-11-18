'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    `postgres://hamster:${process.env.HAMSTER_DB_PASSWORD ?? 'changeme'}@db:5432/hamster`,
  max: 10,
});

async function query(text, params) {
  return pool.query(text, params);
}

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
}

module.exports = { pool, query, migrate };
