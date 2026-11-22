import { Router } from 'express'
import { can } from '../../shared/permissions'
import {
  PRIORITY_LABELS,
  projectListQuery,
  projectSchema,
  STATUS_LABELS,
  type ProjectData,
  type ProjectSort,
} from '../../shared/schemas'
import type { ProjectRow, SessionUser } from '../../shared/types'
import { logActivity } from '../activity-log'
import { requireAuth, requirePermission } from '../auth'
import { nowIso, type DB } from '../db'
import { badRequest, forbidden, notFound, parse, parseId } from '../http'

// Column aliases are quoted so Postgres keeps their camelCase.
const SELECT = `
  SELECT p.id, p.name, p.description, p.status, p.priority, p.owner_id AS "ownerId", u.name AS "ownerName",
         p.due_date AS "dueDate", p.budget, p.progress, p.created_at AS "createdAt", p.updated_at AS "updatedAt"
  FROM projects p JOIN users u ON u.id = p.owner_id`

const SORT_SQL: Record<ProjectSort, string> = {
  updated: 'p.updated_at',
  name: 'lower(p.name)',
  due: "COALESCE(p.due_date, '9999-12-31')",
  priority: "CASE p.priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END",
  progress: 'p.progress',
}

type Raw = Omit<ProjectRow, 'canEdit' | 'canDelete'>

const withPermissions = (user: SessionUser, p: Raw): ProjectRow => ({
  ...p,
  canEdit: can(user, 'project:update', p),
  canDelete: can(user, 'project:delete', p),
})

/** Escape LIKE wildcards so a search for "%" or "_" matches those characters literally. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

export function projectRoutes(db: DB) {
  const router = Router()
  router.use(requireAuth)

  const getProject = (id: number) => db.get<Raw>(`${SELECT} WHERE p.id = ?`, [id])

  /** Owners must be active admins or managers. Managers can only own their own projects. */
  async function resolveOwner(user: SessionUser, data: ProjectData, current?: Raw): Promise<number> {
    const requested = data.ownerId ?? current?.ownerId ?? user.id
    if (user.role !== 'admin') {
      const allowed = current ? current.ownerId : user.id
      if (requested !== allowed) {
        throw badRequest('Please fix the highlighted fields.', { ownerId: 'Only admins can assign a project to someone else.' })
      }
      return requested
    }
    const owner = await db.get<{ role: string; status: string }>('SELECT role, status FROM users WHERE id = ?', [requested])
    if (!owner || owner.status !== 'active' || owner.role === 'member') {
      throw badRequest('Please fix the highlighted fields.', { ownerId: 'The owner must be an active admin or manager.' })
    }
    return requested
  }

  router.get('/', async (req, res) => {
    const q = projectListQuery.parse(req.query)
    const where: string[] = []
    const params: (string | number)[] = []
    if (q.q) {
      where.push(`(p.name ILIKE ? ESCAPE '\\' OR p.description ILIKE ? ESCAPE '\\' OR u.name ILIKE ? ESCAPE '\\')`)
      const like = likePattern(q.q)
      params.push(like, like, like)
    }
    if (q.status) (where.push('p.status = ?'), params.push(q.status))
    if (q.priority) (where.push('p.priority = ?'), params.push(q.priority))
    if (q.ownerId) (where.push('p.owner_id = ?'), params.push(q.ownerId))
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const count = await db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM projects p JOIN users u ON u.id = p.owner_id ${whereSql}`, params)
    const order = `${SORT_SQL[q.sort]} ${q.dir === 'asc' ? 'ASC' : 'DESC'}, p.id DESC`
    const rows = await db.all<Raw>(`${SELECT} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, q.pageSize, (q.page - 1) * q.pageSize])
    res.json({ items: rows.map((r) => withPermissions(req.user!, r)), total: count?.n ?? 0, page: q.page, pageSize: q.pageSize })
  })

  router.get('/:id', async (req, res) => {
    const project = await getProject(parseId(req.params.id))
    if (!project) throw notFound('That project')
    res.json({ project: withPermissions(req.user!, project) })
  })

  router.post('/', requirePermission('project:create', 'Only managers and admins can create projects.'), async (req, res) => {
    const user = req.user!
    const data = parse(projectSchema, req.body)
    const ownerId = await resolveOwner(user, data)
    const now = nowIso()
    const row = await db.get<{ id: number }>(
      `INSERT INTO projects (name, description, status, priority, owner_id, due_date, budget, progress, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [data.name, data.description, data.status, data.priority, ownerId, data.dueDate, data.budget, data.progress, now, now],
    )
    const id = row!.id
    await logActivity(db, user, 'project.created', 'project', id, `${user.name} created “${data.name}”`)
    res.status(201).json({ project: withPermissions(user, (await getProject(id))!) })
  })

  router.put('/:id', async (req, res) => {
    const user = req.user!
    const current = await getProject(parseId(req.params.id))
    if (!current) throw notFound('That project')
    if (!can(user, 'project:update', current)) {
      throw forbidden(user.role === 'manager' ? 'Managers can only edit projects they own.' : 'Members can view projects but not edit them.')
    }
    const data = parse(projectSchema, req.body)
    const ownerId = await resolveOwner(user, data, current)
    await db.run(
      `UPDATE projects SET name = ?, description = ?, status = ?, priority = ?, owner_id = ?, due_date = ?, budget = ?, progress = ?, updated_at = ?
       WHERE id = ?`,
      [data.name, data.description, data.status, data.priority, ownerId, data.dueDate, data.budget, data.progress, nowIso(), current.id],
    )
    const updated = (await getProject(current.id))!
    await logActivity(db, user, 'project.updated', 'project', current.id, `${user.name} updated “${updated.name}”${describeChanges(current, updated)}`)
    res.json({ project: withPermissions(user, updated) })
  })

  router.delete('/:id', async (req, res) => {
    const user = req.user!
    const current = await getProject(parseId(req.params.id))
    if (!current) throw notFound('That project')
    if (!can(user, 'project:delete', current)) {
      throw forbidden(user.role === 'manager' ? 'Managers can only delete projects they own.' : 'Members can’t delete projects.')
    }
    await db.run('DELETE FROM projects WHERE id = ?', [current.id])
    await logActivity(db, user, 'project.deleted', 'project', current.id, `${user.name} deleted “${current.name}”`)
    res.status(204).end()
  })

  return router
}

function describeChanges(before: Raw, after: Raw): string {
  const parts: string[] = []
  if (before.status !== after.status) parts.push(`status ${STATUS_LABELS[before.status]} → ${STATUS_LABELS[after.status]}`)
  if (before.priority !== after.priority) parts.push(`priority ${PRIORITY_LABELS[before.priority]} → ${PRIORITY_LABELS[after.priority]}`)
  if (before.progress !== after.progress) parts.push(`progress ${before.progress}% → ${after.progress}%`)
  if (before.ownerId !== after.ownerId) parts.push(`owner ${before.ownerName} → ${after.ownerName}`)
  return parts.length ? `: ${parts.join(', ')}` : ''
}
