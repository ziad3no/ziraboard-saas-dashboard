import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { can } from '../../shared/permissions'
import type { ActivityRow, Owner, Page } from '../../shared/types'
import { api, errorMessage } from '../api'
import { useUser } from '../auth'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/Layout'
import { EmptyState, ErrorState, LockedHint, Pagination, SkeletonRows } from '../components/ui'
import { formatDateTime, timeAgo } from '../format'
import { useUrlState } from '../hooks'

export function ActivityIcon({ type }: { type: ActivityRow['entityType'] }) {
  const name = type === 'project' ? 'folder' : type === 'user' ? 'users' : 'shield'
  return (
    <span className={`feed-icon feed-${type}`}>
      <Icon name={name} size={15} />
    </span>
  )
}

export function ActivityPage() {
  const user = useUser()
  const seeAll = can(user, 'activity:read-all')
  const url = useUrlState(['actorId', 'entity'] as const)
  const pageSize = url.pageSize ?? 20

  const activity = useQuery({
    queryKey: ['activity', url.values, url.page, pageSize],
    queryFn: () =>
      api<Page<ActivityRow> & { scope: 'own' | 'everyone' }>('/activity', { query: { ...url.values, page: url.page, pageSize } }),
    placeholderData: keepPreviousData,
  })
  // Admins and managers can list people for the "who" filter.
  const people = useQuery({
    queryKey: ['users', 'filter'],
    queryFn: () => api<Page<Owner>>('/users', { query: { pageSize: 50 } }),
    enabled: seeAll,
  })

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle={seeAll ? 'Every sign-in and change made by the team.' : 'Your own sign-ins and changes.'}
      />
      <div className="toolbar">
        {seeAll ? (
          <select className="input" aria-label="Filter by person" value={url.values.actorId} onChange={(e) => url.set({ actorId: e.target.value })}>
            <option value="">Everyone</option>
            {people.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <LockedHint>Members see only their own activity</LockedHint>
        )}
        <select className="input" aria-label="Filter by type" value={url.values.entity} onChange={(e) => url.set({ entity: e.target.value })}>
          <option value="">All types</option>
          <option value="project">Projects</option>
          <option value="user">Users</option>
          <option value="auth">Sign-ins</option>
        </select>
        {url.hasFilters && (
          <button type="button" className="btn btn-ghost" onClick={() => url.set({ actorId: null, entity: null })}>
            Clear filters
          </button>
        )}
      </div>

      <div className="card table-card">
        {activity.isError ? (
          <ErrorState message={errorMessage(activity.error)} onRetry={() => void activity.refetch()} />
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 44 }}>
                    <span className="sr-only">Type</span>
                  </th>
                  <th scope="col">What happened</th>
                  <th scope="col" className="hide-md">
                    Who
                  </th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody className={activity.isPlaceholderData ? 'is-stale' : ''}>
                {activity.isPending ? (
                  <SkeletonRows rows={8} cols={4} />
                ) : (
                  activity.data.items.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <ActivityIcon type={a.entityType} />
                      </td>
                      <td>{a.summary}</td>
                      <td className="hide-md">{a.actorName}</td>
                      <td>
                        <time dateTime={a.createdAt} title={formatDateTime(a.createdAt)}>
                          {timeAgo(a.createdAt)}
                        </time>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {activity.data?.items.length === 0 && (
              <EmptyState icon="activity" title="No activity matches these filters">
                <p className="muted">Try another person or type.</p>
              </EmptyState>
            )}
            {activity.data && (
              <Pagination
                page={activity.data.page}
                pageSize={activity.data.pageSize}
                total={activity.data.total}
                onPage={(p) => url.set({ page: p })}
                onPageSize={(s) => url.set({ pageSize: s })}
              />
            )}
          </>
        )}
      </div>
    </>
  )
}
