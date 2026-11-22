import { Router } from 'express'
import { can } from '../../shared/permissions'
import { activityListQuery, PROJECT_STATUSES, type ProjectStatus } from '../../shared/schemas'
import type { ActivityRow, Stats } from '../../shared/types'
import { requireAuth } from '../auth'
import type { DB } from '../db'

const SELECT = `
  SELECT id, actor_id AS "actorId", actor_name AS "actorName", action, entity_type AS "entityType",
         entity_id AS "entityId", summary, created_at AS "createdAt"
  FROM activity`

export function activityRoutes(db: DB) {
  const router = Router()
  router.use(requireAuth)

  router.get('/', async (req, res) => {
    const user = req.user!
    const q = activityListQuery.parse(req.query)
    const where: string[] = []
    const params: (string | number)[] = []
    // Members only ever see their own actions, whatever filter they send.
    const actorId = can(user, 'activity:read-all') ? q.actorId : user.id
    if (actorId) (where.push('actor_id = ?'), params.push(actorId))
    if (q.entity) (where.push('entity_type = ?'), params.push(q.entity))
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = (await db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM activity ${whereSql}`, params))?.n ?? 0
    const items = await db.all<ActivityRow>(`${SELECT} ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [
      ...params,
      q.pageSize,
      (q.page - 1) * q.pageSize,
    ])
    res.json({ items, total, page: q.page, pageSize: q.pageSize, scope: can(user, 'activity:read-all') ? 'everyone' : 'own' })
  })

  return router
}

export function statsRoutes(db: DB) {
  const router = Router()
  router.use(requireAuth)

  router.get('/', async (req, res) => {
    const user = req.user!
    const everyone = can(user, 'activity:read-all')
    const today = new Date().toISOString().slice(0, 10)

    const byStatus = Object.fromEntries(PROJECT_STATUSES.map((s) => [s, 0])) as Record<ProjectStatus, number>
    for (const row of await db.all<{ status: ProjectStatus; n: number }>('SELECT status, COUNT(*)::int AS n FROM projects GROUP BY status')) {
      byStatus[row.status] = row.n
    }
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0)
    const overdue = (await db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM projects WHERE due_date < ? AND status <> 'completed'`, [today]))?.n ?? 0
    const mine = (await db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM projects WHERE owner_id = ?', [user.id]))?.n ?? 0

    let users: Stats['users'] = null
    if (can(user, 'user:read')) {
      users = (await db.get<{ total: number; active: number }>(
        `SELECT COUNT(*)::int AS total, (COUNT(*) FILTER (WHERE status = 'active'))::int AS active FROM users`,
      )) ?? { total: 0, active: 0 }
    }

    // Activity per day for the last 14 days, including days with zero events.
    const start = new Date()
    start.setUTCHours(0, 0, 0, 0)
    start.setUTCDate(start.getUTCDate() - 13)
    const scopeSql = everyone ? '' : 'AND actor_id = ?'
    const scopeParams = everyone ? [] : [user.id]
    const counts = new Map(
      (
        await db.all<{ day: string; n: number }>(
          `SELECT substr(created_at, 1, 10) AS day, COUNT(*)::int AS n FROM activity WHERE created_at >= ? ${scopeSql} GROUP BY day`,
          [start.toISOString(), ...scopeParams],
        )
      ).map((r) => [r.day, r.n]),
    )
    const activityByDay = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10)
      return { date: d, count: counts.get(d) ?? 0 }
    })

    const recent = await db.all<ActivityRow>(
      `${SELECT} ${everyone ? '' : 'WHERE actor_id = ?'} ORDER BY created_at DESC, id DESC LIMIT 6`,
      scopeParams,
    )

    const stats: Stats = {
      users,
      projects: { total, byStatus, overdue, mine },
      activityByDay,
      activityScope: everyone ? 'everyone' : 'own',
      recent,
    }
    res.json(stats)
  })

  return router
}
