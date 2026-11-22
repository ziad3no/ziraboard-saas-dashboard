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

const SELECT = `
  SELECT p.id, p.name, p.description, p.status, p.priority, p.owner_id AS ownerId, u.name AS ownerName,
         p.due_date AS dueDate, p.budget, p.progress, p.created_at AS createdAt, p.updated_at AS updatedAt
  FROM projects p JOIN users u ON u.id = p.owner_id`

const SORT_SQL: Record<ProjectSort, string> = {
  updated: 'p.updated_at',
  name: 'p.name COLLATE NOCASE',
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

export function projectRoutes(db: DB) {
  const router = Router()
  router.use(requireAuth)

  const getProject = (id: number) => db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as Raw | undefined

  /** Owners must be active admins or managers. Managers can only own their own projects. */
  function resolveOwner(user: SessionUser, data: ProjectData, current?: Raw): number {
    const requested = data.ownerId ?? current?.ownerId ?? user.id
    if (user.role !== 'admin') {
      const allowed = current ? current.ownerId : user.id
      if (requested !== allowed) {
        throw badRequest('Please fix the highlighted fields.', { ownerId: 'Only admins can assign a project to someone else.' })
      }
      return requested
    }
    const owner = db.prepare(`SELECT role, status FROM users WHERE id = ?`).get(requested) as
      | { role: string; status: string }
      | undefined
    if (!owner || owner.status !== 'active' || owner.role === 'member') {
      throw badRequest('Please fix the highlighted fields.', { ownerId: 'The owner must be an active admin or manager.' })
    }
    return requested
  }

  router.get('/', (req, res) => {
    const q = projectListQuery.parse(req.query)
    const where: string[] = []
    const params: (string | number)[] = []
    if (q.q) {
      where.push(`(p.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')`)
      const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      params.push(like, like, like)
    }
    if (q.status) (where.push('p.status = ?'), params.push(q.status))
    if (q.priority) (where.push('p.priority = ?'), params.push(q.priority))
    if (q.ownerId) (where.push('p.owner_id = ?'), params.push(q.ownerId))
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM projects p JOIN users u ON u.id = p.owner_id ${whereSql}`).get(...params) as { n: number }).n
    const order = `${SORT_SQL[q.sort]} ${q.dir === 'asc' ? 'ASC' : 'DESC'}, p.id DESC`
    const rows = db
      .prepare(`${SELECT} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, q.pageSize, (q.page - 1) * q.pageSize) as unknown as Raw[]
    res.json({ items: rows.map((r) => withPermissions(req.user!, r)), total, page: q.page, pageSize: q.pageSize })
  })

  router.get('/:id', (req, res) => {
    const project = getProject(parseId(req.params.id))
    if (!project) throw notFound('That project')
    res.json({ project: withPermissions(req.user!, project) })
  })

  router.post('/', requirePermission('project:create', 'Only managers and admins can create projects.'), (req, res) => {
    const user = req.user!
    const data = parse(projectSchema, req.body)
    const ownerId = resolveOwner(user, data)
    const now = nowIso()
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO projects (name, description, status, priority, owner_id, due_date, budget, progress, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(data.name, data.description, data.status, data.priority, ownerId, data.dueDate, data.budget, data.progress, now, now)
    const id = Number(lastInsertRowid)
    logActivity(db, user, 'project.created', 'project', id, `${user.name} created “${data.name}”`)
    res.status(201).json({ project: withPermissions(user, getProject(id)!) })
  })

  router.put('/:id', (req, res) => {
    const user = req.user!
    const current = getProject(parseId(req.params.id))
    if (!current) throw notFound('That project')
    if (!can(user, 'project:update', current)) {
      throw forbidden(user.role === 'manager' ? 'Managers can only edit projects they own.' : 'Members can view projects but not edit them.')
    }
    const data = parse(projectSchema, req.body)
    const ownerId = resolveOwner(user, data, current)
    db.prepare(
      `UPDATE projects SET name = ?, description = ?, status = ?, priority = ?, owner_id = ?, due_date = ?, budget = ?, progress = ?, updated_at = ?
       WHERE id = ?`,
    ).run(data.name, data.description, data.status, data.priority, ownerId, data.dueDate, data.budget, data.progress, nowIso(), current.id)
    const updated = getProject(current.id)!
    logActivity(db, user, 'project.updated', 'project', current.id, `${user.name} updated “${updated.name}”${describeChanges(current, updated)}`)
    res.json({ project: withPermissions(user, updated) })
  })

  router.delete('/:id', (req, res) => {
    const user = req.user!
    const current = getProject(parseId(req.params.id))
    if (!current) throw notFound('That project')
    if (!can(user, 'project:delete', current)) {
      throw forbidden(user.role === 'manager' ? 'Managers can only delete projects they own.' : 'Members can’t delete projects.')
    }
    db.prepare('DELETE FROM projects WHERE id = ?').run(current.id)
    logActivity(db, user, 'project.deleted', 'project', current.id, `${user.name} deleted “${current.name}”`)
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
