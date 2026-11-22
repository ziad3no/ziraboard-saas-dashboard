import { Router } from 'express'
import { can } from '../../shared/permissions'
import { activityListQuery, PROJECT_STATUSES, type ProjectStatus } from '../../shared/schemas'
import type { ActivityRow, Stats } from '../../shared/types'
import { requireAuth } from '../auth'
import type { DB } from '../db'

const SELECT = `
  SELECT id, actor_id AS actorId, actor_name AS actorName, action, entity_type AS entityType,
         entity_id AS entityId, summary, created_at AS createdAt
  FROM activity`

export function activityRoutes(db: DB) {
  const router = Router()
  router.use(requireAuth)

  router.get('/', (req, res) => {
    const user = req.user!
    const q = activityListQuery.parse(req.query)
    const where: string[] = []
    const params: (string | number)[] = []
    // Members only ever see their own actions, whatever filter they send.
    const actorId = can(user, 'activity:read-all') ? q.actorId : user.id
    if (actorId) (where.push('actor_id = ?'), params.push(actorId))
    if (q.entity) (where.push('entity_type = ?'), params.push(q.entity))
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM activity ${whereSql}`).get(...params) as { n: number }).n
    const items = db
      .prepare(`${SELECT} ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, q.pageSize, (q.page - 1) * q.pageSize) as unknown as ActivityRow[]
    res.json({ items, total, page: q.page, pageSize: q.pageSize, scope: actorId === user.id && !can(user, 'activity:read-all') ? 'own' : 'everyone' })
  })

  return router
}

export function statsRoutes(db: DB) {
  const router = Router()
  router.use(requireAuth)

  router.get('/', (req, res) => {
    const user = req.user!
    const everyone = can(user, 'activity:read-all')
    const today = new Date().toISOString().slice(0, 10)

    const byStatus = Object.fromEntries(PROJECT_STATUSES.map((s) => [s, 0])) as Record<ProjectStatus, number>
    for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM projects GROUP BY status').all() as { status: ProjectStatus; n: number }[]) {
      byStatus[row.status] = row.n
    }
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0)
    const overdue = (db.prepare(`SELECT COUNT(*) AS n FROM projects WHERE due_date < ? AND status <> 'completed'`).get(today) as { n: number }).n
    const mine = (db.prepare('SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?').get(user.id) as { n: number }).n

    let users: Stats['users'] = null
    if (can(user, 'user:read')) {
      users = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(status = 'active'), 0) AS active FROM users`).get() as Stats['users']
    }

    // Activity per day for the last 14 days, including days with zero events.
    const start = new Date()
    start.setUTCHours(0, 0, 0, 0)
    start.setUTCDate(start.getUTCDate() - 13)
    const scopeSql = everyone ? '' : 'AND actor_id = ?'
    const scopeParams = everyone ? [] : [user.id]
    const counts = new Map(
      (
        db
          .prepare(`SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM activity WHERE created_at >= ? ${scopeSql} GROUP BY day`)
          .all(start.toISOString(), ...scopeParams) as { day: string; n: number }[]
      ).map((r) => [r.day, r.n]),
    )
    const activityByDay = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10)
      return { date: d, count: counts.get(d) ?? 0 }
    })

    const recent = db
      .prepare(`${SELECT} ${everyone ? '' : 'WHERE actor_id = ?'} ORDER BY created_at DESC, id DESC LIMIT 6`)
      .all(...scopeParams) as unknown as ActivityRow[]

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
