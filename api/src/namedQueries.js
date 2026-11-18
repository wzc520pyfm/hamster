'use strict';

// Named query registry. Pages never carry raw SQL/shell/JS: bindings reference
// these server-side names only, and the server is the only place they run.

const WEEKS = 12;

function seededWeeks() {
  const rows = [];
  // Deterministic fixture: Mondays ending 2026-11-16.
  const end = new Date(Date.UTC(2026, 10, 16));
  const baseSessions = [4120, 4380, 4010, 4650, 4820, 5130, 4980, 5340, 5510, 5290, 5740, 6025];
  const baseSignups = [186, 204, 171, 232, 258, 271, 240, 289, 305, 297, 333, 361];
  for (let i = WEEKS - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i * 7);
    const idx = WEEKS - 1 - i;
    rows.push({
      week: d.toISOString().slice(0, 10),
      sessions: baseSessions[idx],
      signups: baseSignups[idx],
      conversion: Number(((baseSignups[idx] / baseSessions[idx]) * 100).toFixed(2)),
      exceptions: idx % 5 === 3 ? 7 : idx % 4 === 1 ? 3 : 1,
    });
  }
  return rows;
}

function summarize(rows) {
  const latest = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const deltaSessions = latest.sessions - prev.sessions;
  const deltaSignups = latest.signups - prev.signups;
  const deltaConversion = Number((latest.conversion - prev.conversion).toFixed(2));
  return {
    kpis: [
      { label: 'Sessions (last week)', value: String(latest.sessions), delta: `${deltaSessions >= 0 ? '+' : ''}${deltaSessions} vs prior week` },
      { label: 'Signups (last week)', value: String(latest.signups), delta: `${deltaSignups >= 0 ? '+' : ''}${deltaSignups} vs prior week` },
      { label: 'Conversion', value: `${latest.conversion}%`, delta: `${deltaConversion >= 0 ? '+' : ''}${deltaConversion} pts vs prior week` },
      { label: 'Exceptions', value: String(latest.exceptions), delta: latest.exceptions > 3 ? 'needs review' : 'within range' },
    ],
    rows: rows.map((r) => ({
      week: r.week,
      sessions: r.sessions,
      signups: r.signups,
      conversion: `${r.conversion}%`,
      exceptions: r.exceptions,
    })),
  };
}

const namedQueries = {
  metrics_weekly: {
    description: 'Weekly sessions/signups/conversion/exceptions for the last 12 weeks',
    async run(db) {
      const { rows } = await db.query(
        'SELECT week::text AS week, sessions, signups, conversion::float AS conversion, exceptions FROM metrics_weekly ORDER BY week ASC'
      );
      if (rows.length === 0) throw new Error('metrics_weekly is empty (seed missing)');
      return summarize(rows);
    },
  },
};

async function seedMetrics(db) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM metrics_weekly');
  if (rows[0].n > 0) return;
  for (const r of seededWeeks()) {
    await db.query(
      'INSERT INTO metrics_weekly (week, sessions, signups, conversion, exceptions) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (week) DO NOTHING',
      [r.week, r.sessions, r.signups, r.conversion, r.exceptions]
    );
  }
}

async function runNamedQuery(db, name) {
  const entry = namedQueries[name];
  if (!entry) throw new Error(`Unknown named query: ${name}`);
  return entry.run(db);
}

module.exports = { runNamedQuery, seedMetrics, namedQueries };
