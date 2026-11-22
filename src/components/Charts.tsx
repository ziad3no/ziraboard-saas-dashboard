import { PROJECT_STATUSES, STATUS_LABELS, type ProjectStatus } from '../../shared/schemas'

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Bar chart of events per day. Every bar has a text label for screen readers. */
export function ActivityChart({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  const nice = Math.max(4, Math.ceil(max / 4) * 4)
  const W = 560
  const H = 180
  const padL = 28
  const padB = 22
  const bw = (W - padL) / data.length
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Activity per day over the last 14 days">
      {[0, 0.5, 1].map((t) => {
        const y = (H - padB) * (1 - t) + 4
        return (
          <g key={t}>
            <line x1={padL} x2={W} y1={y} y2={y} className="chart-grid" />
            <text x={padL - 6} y={y + 4} className="chart-axis" textAnchor="end">
              {Math.round(nice * t)}
            </text>
          </g>
        )
      })}
      {data.map((d, i) => {
        const h = ((H - padB - 4) * d.count) / nice
        const x = padL + i * bw + bw * 0.18
        const label = dayFmt.format(new Date(`${d.date}T00:00:00Z`))
        return (
          <g key={d.date}>
            <rect x={x} width={bw * 0.64} y={H - padB - h} height={Math.max(h, d.count ? 2 : 0)} rx={3} className="chart-bar">
              <title>{`${label}: ${d.count} event${d.count === 1 ? '' : 's'}`}</title>
            </rect>
            {(i % 2 === 1 || data.length <= 7) && (
              <text x={x + bw * 0.32} y={H - 6} className="chart-axis" textAnchor="middle">
                {label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

const STATUS_COLORS: Record<ProjectStatus, string> = {
  planning: 'var(--c-planning)',
  active: 'var(--c-active)',
  on_hold: 'var(--c-hold)',
  completed: 'var(--c-done)',
}

export function StatusDonut({ byStatus }: { byStatus: Record<ProjectStatus, number> }) {
  const total = PROJECT_STATUSES.reduce((sum, s) => sum + byStatus[s], 0)
  const r = 52
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 140 140" className="donut" role="img" aria-label={`Projects by status: ${PROJECT_STATUSES.map((s) => `${STATUS_LABELS[s]} ${byStatus[s]}`).join(', ')}`}>
        <circle cx="70" cy="70" r={r} className="donut-track" />
        {total > 0 &&
          PROJECT_STATUSES.map((s) => {
            const len = (byStatus[s] / total) * c
            const seg = (
              <circle
                key={s}
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke={STATUS_COLORS[s]}
                strokeWidth="18"
                strokeDasharray={`${Math.max(0, len - 2)} ${c}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 70 70)"
              />
            )
            offset += len
            return seg
          })}
        <text x="70" y="68" textAnchor="middle" className="donut-total">
          {total}
        </text>
        <text x="70" y="86" textAnchor="middle" className="donut-label">
          projects
        </text>
      </svg>
      <ul className="legend">
        {PROJECT_STATUSES.map((s) => (
          <li key={s}>
            <span className="swatch" style={{ background: STATUS_COLORS[s] }} />
            {STATUS_LABELS[s]}
            <strong>{byStatus[s]}</strong>
          </li>
        ))}
      </ul>
    </div>
  )
}
