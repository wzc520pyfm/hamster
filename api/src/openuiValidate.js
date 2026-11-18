'use strict';

// Server-side OpenUI React Lang 1.0 validation. Uses @openuidev/lang-core against
// the same registered component set the React client renders. No commercial
// OpenUI Dashboard/Gateway dependency.

const { createLibrary, createParser, defineComponent } = require('@openuidev/lang-core');
const { z } = require('zod');

const ALLOWED_QUERY_TOOLS = new Set(['metrics_weekly']);

const CardHeader = defineComponent({
  name: 'CardHeader',
  description: 'Dashboard section header',
  props: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
  }),
  component: () => null,
});

const KpiGrid = defineComponent({
  name: 'KpiGrid',
  description: 'Row of KPI tiles from query data',
  props: z.object({
    items: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
        delta: z.string(),
      }),
    ),
  }),
  component: () => null,
});

const MetricsTable = defineComponent({
  name: 'MetricsTable',
  description: 'Weekly metrics table from query data',
  props: z.object({
    rows: z.array(
      z.object({
        week: z.string(),
        sessions: z.number(),
        signups: z.number(),
        conversion: z.string(),
        exceptions: z.number(),
      }),
    ),
  }),
  component: () => null,
});

const Note = defineComponent({
  name: 'Note',
  description: 'Footer note',
  props: z.object({
    text: z.string(),
  }),
  component: () => null,
});

const RevSync = defineComponent({
  name: 'RevSync',
  description: 'Internal $rev bridge for constrained refresh (renders nothing)',
  props: z.object({}),
  component: () => null,
});

const Stack = defineComponent({
  name: 'Stack',
  description: 'Vertical stack of registered dashboard slots',
  props: z.object({
    children: z.array(
      z.union([RevSync.ref, CardHeader.ref, KpiGrid.ref, MetricsTable.ref, Note.ref]),
    ),
  }),
  component: () => null,
});

const library = createLibrary({
  root: 'Stack',
  components: [Stack, RevSync, CardHeader, KpiGrid, MetricsTable, Note],
});

const parser = createParser(library.toJSONSchema(), library.root);

function toOpenUiLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(toOpenUiLiteral).join(', ')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value)
      .map(([k, v]) => `${k}: ${toOpenUiLiteral(v)}`)
      .join(', ')}}`;
  }
  return 'null';
}

function validateOpenuiDocument(document) {
  if (typeof document !== 'string' || !document.trim()) {
    return { ok: false, errors: ['empty_document'] };
  }
  // Reject raw credentials / arbitrary executable payloads in the page text.
  if (/\b(password|secret|api[_-]?key|BEGIN (RSA )?PRIVATE KEY)\b/i.test(document)) {
    return { ok: false, errors: ['forbidden_secret_material'] };
  }
  if (/\b(SELECT\s+.+\s+FROM|;\s*DROP\s+|\$\{|eval\(|Function\()/i.test(document)) {
    return { ok: false, errors: ['forbidden_executable_payload'] };
  }

  const result = parser.parse(document);
  const errors = (result.meta?.errors ?? [])
    .filter((e) => e.severity !== 'warning')
    .map((e) => `${e.code}:${e.message}`);

  const queries = Array.isArray(result.queryStatements)
    ? result.queryStatements
    : Object.values(result.queryStatements ?? {});
  for (const q of queries) {
    const tool = q?.toolAST?.v ?? q?.tool ?? q?.name;
    if (tool && !ALLOWED_QUERY_TOOLS.has(tool)) {
      errors.push(`unknown_query_tool:${tool}`);
    }
  }

  if (!result.root) {
    errors.push('no_root');
  }

  return { ok: errors.length === 0, errors, parse: result };
}

module.exports = {
  library,
  validateOpenuiDocument,
  toOpenUiLiteral,
  ALLOWED_QUERY_TOOLS,
};
