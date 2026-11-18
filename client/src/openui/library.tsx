import { createContext, useContext, useEffect } from 'react'
import { createLibrary, defineComponent, useStateField } from '@openuidev/react-lang'
import { z } from 'zod/v4'

/** Bumps `$rev` from the product shell without remounting the Renderer tree. */
export const RefreshTokenContext = createContext(0)

const RevSync = defineComponent({
  name: 'RevSync',
  description: 'Internal $rev bridge for constrained refresh (renders nothing)',
  props: z.object({}),
  component: () => {
    const token = useContext(RefreshTokenContext)
    const revField = useStateField<number>('rev', 0)
    useEffect(() => {
      if (token > 0 && revField.value !== token) {
        revField.setValue(token)
      }
      // Intentionally only react to shell refresh tokens; setValue is stable enough per render cycle.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token])
    return null
  },
})

const CardHeader = defineComponent({
  name: 'CardHeader',
  description: 'Dashboard section header',
  props: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
  }),
  component: ({ props }) => (
    <div data-slot="head" className="mb-4">
      <h2 className="text-lg font-semibold">{props.title}</h2>
      {props.subtitle ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">{props.subtitle}</p>
      ) : null}
    </div>
  ),
})

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
  component: ({ props }) => (
    <div
      data-slot="kpis"
      className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      {(props.items ?? []).map((kpi) => (
        <div
          key={kpi.label}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3"
        >
          <div className="text-xs text-[var(--color-muted-foreground)]">{kpi.label}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{kpi.value}</div>
          <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">{kpi.delta}</div>
        </div>
      ))}
    </div>
  ),
})

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
  component: ({ props }) => (
    <div data-slot="grid" className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted-foreground)]">
            <th className="px-2 py-2 font-medium">Week</th>
            <th className="px-2 py-2 font-medium">Sessions</th>
            <th className="px-2 py-2 font-medium">Signups</th>
            <th className="px-2 py-2 font-medium">Conversion</th>
            <th className="px-2 py-2 font-medium">Exceptions</th>
          </tr>
        </thead>
        <tbody>
          {(props.rows ?? []).map((row) => (
            <tr key={row.week} className="border-b border-[var(--color-border)]/70">
              <td className="px-2 py-2 font-mono text-xs">{row.week}</td>
              <td className="px-2 py-2 tabular-nums">{row.sessions}</td>
              <td className="px-2 py-2 tabular-nums">{row.signups}</td>
              <td className="px-2 py-2 tabular-nums">{row.conversion}</td>
              <td className="px-2 py-2 tabular-nums">{row.exceptions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
})

const Note = defineComponent({
  name: 'Note',
  description: 'Footer note',
  props: z.object({
    text: z.string(),
  }),
  component: ({ props }) => (
    <p data-slot="note" className="mt-4 text-xs text-[var(--color-muted-foreground)]">
      {props.text}
    </p>
  ),
})

const Stack = defineComponent({
  name: 'Stack',
  description: 'Vertical stack of registered dashboard slots',
  props: z.object({
    children: z.array(
      z.union([RevSync.ref, CardHeader.ref, KpiGrid.ref, MetricsTable.ref, Note.ref]),
    ),
  }),
  component: ({ props, renderNode }) => (
    <div className="flex flex-col gap-1">{renderNode(props.children)}</div>
  ),
})

/** Hamster P0 registered OpenUI React Lang 1.0 library (no commercial Gateway). */
export const hamsterOpenUiLibrary = createLibrary({
  root: 'Stack',
  components: [Stack, RevSync, CardHeader, KpiGrid, MetricsTable, Note],
})
