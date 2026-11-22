import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import type { Stats } from '../../shared/types'
import { api, errorMessage } from '../api'
import { useUser } from '../auth'
import { ActivityChart, StatusDonut } from '../components/Charts'
import { Icon, type IconName } from '../components/Icon'
import { PageHeader } from '../components/Layout'
import { ErrorState } from '../components/ui'
import { timeAgo } from '../format'
import { ActivityIcon } from './Activity'

function StatCard({ icon, label, value, note, to }: { icon: IconName; label: string; value: number | string; note?: string; to?: string }) {
  const body = (
    <>
      <span className="stat-icon">
        <Icon name={icon} />
      </span>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {note && <span className="stat-note">{note}</span>}
    </>
  )
  return to ? (
    <Link to={to} className="card stat">
      {body}
    </Link>
  ) : (
    <div className="card stat">{body}</div>
  )
}

export function DashboardPage() {
  const user = useUser()
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/stats') })
  const firstName = user.name.split(' ')[0]

  return (
    <>
      <PageHeader title={`Hello, ${firstName}`} subtitle="Here’s what your team has been working on." />
      {stats.isError ? (
        <ErrorState message={errorMessage(stats.error)} onRetry={() => void stats.refetch()} />
      ) : !stats.data ? (
        <div className="grid-stats" aria-busy="true" aria-label="Loading dashboard">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="card stat">
              <span className="skeleton" style={{ width: '40%', height: 28 }} />
              <span className="skeleton" style={{ width: '70%' }} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid-stats">
            <StatCard icon="folder" label="Projects" value={stats.data.projects.total} note={`${stats.data.projects.byStatus.active} active`} to="/projects" />
            <StatCard
              icon="clock"
              label="Overdue"
              value={stats.data.projects.overdue}
              note="Past due date, not completed"
              to="/projects?sort=due&dir=asc"
            />
            {stats.data.users ? (
              <StatCard icon="users" label="Users" value={stats.data.users.total} note={`${stats.data.users.active} active`} to="/users" />
            ) : (
              <StatCard icon="folder" label="Owned by you" value={stats.data.projects.mine} note="Members don’t own projects" />
            )}
            <StatCard
              icon="activity"
              label={stats.data.activityScope === 'own' ? 'Your actions (14 days)' : 'Team actions (14 days)'}
              value={stats.data.activityByDay.reduce((a, d) => a + d.count, 0)}
              to="/activity"
            />
          </div>

          <div className="grid-2">
            <section className="card">
              <div className="card-head">
                <h2>Activity</h2>
                <span className="muted">{stats.data.activityScope === 'own' ? 'Your actions only' : 'Whole team'} · last 14 days</span>
              </div>
              <ActivityChart data={stats.data.activityByDay} />
            </section>
            <section className="card">
              <div className="card-head">
                <h2>Projects by status</h2>
              </div>
              <StatusDonut byStatus={stats.data.projects.byStatus} />
            </section>
          </div>

          <section className="card">
            <div className="card-head">
              <h2>Recent activity</h2>
              <Link to="/activity">View all</Link>
            </div>
            {stats.data.recent.length === 0 ? (
              <p className="muted pad">Nothing yet. Actions you take will show up here.</p>
            ) : (
              <ul className="feed">
                {stats.data.recent.map((a) => (
                  <li key={a.id}>
                    <ActivityIcon type={a.entityType} />
                    <span className="feed-text">{a.summary}</span>
                    <time className="muted" dateTime={a.createdAt}>
                      {timeAgo(a.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  )
}
