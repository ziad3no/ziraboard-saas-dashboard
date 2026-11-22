import { Router } from 'express'
import { ROLE_LABELS } from '../../shared/permissions'
import { userCreateSchema, userListQuery, userUpdateSchema } from '../../shared/schemas'
import type { Owner, UserRow } from '../../shared/types'
import { logActivity } from '../activity-log'
import { hashPassword, requireAuth, requirePermission } from '../auth'
import { nowIso, type DB } from '../db'
import { badRequest, conflict, notFound, parse, parseId } from '../http'
import { likePattern } from './projects'

const SELECT = `
  SELECT u.id, u.name, u.email, u.role, u.status, u.is_demo AS "isDemo", u.created_at AS "createdAt",
         u.last_login_at AS "lastLoginAt",
         (SELECT COUNT(*)::int FROM projects p WHERE p.owner_id = u.id) AS "projectCount"
  FROM users u`

export function userRoutes(db: DB) {
  const router = Router()
  const getUser = (id: number) => db.get<UserRow>(`${SELECT} WHERE u.id = ?`, [id])
  const emailTaken = async (email: string, exceptId = 0) =>
    (await db.get('SELECT 1 FROM users WHERE email = ? AND id <> ?', [email, exceptId])) !== undefined
  const activeAdmins = async () =>
    (await db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND status = 'active'`))?.n ?? 0

  /** Everyone who can own a project. Used by the owner filter and the project form. */
  router.get('/owners', requireAuth, async (_req, res) => {
    const owners = await db.all<Owner>(
      `SELECT id, name, role FROM users WHERE role IN ('admin', 'manager') AND status = 'active' ORDER BY lower(name)`,
    )
    res.json({ owners })
  })

  router.get('/', requirePermission('user:read', 'Only admins and managers can see the user list.'), async (req, res) => {
    const q = userListQuery.parse(req.query)
    const where: string[] = []
    const params: (string | number)[] = []
    if (q.q) {
      const like = likePattern(q.q)
      where.push(`(u.name ILIKE ? ESCAPE '\\' OR u.email ILIKE ? ESCAPE '\\')`)
      params.push(like, like)
    }
    if (q.role) (where.push('u.role = ?'), params.push(q.role))
    if (q.status) (where.push('u.status = ?'), params.push(q.status))
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = (await db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users u ${whereSql}`, params))?.n ?? 0
    const items = await db.all<UserRow>(`${SELECT} ${whereSql} ORDER BY lower(u.name), u.id LIMIT ? OFFSET ?`, [
      ...params,
      q.pageSize,
      (q.page - 1) * q.pageSize,
    ])
    res.json({ items, total, page: q.page, pageSize: q.pageSize })
  })

  const manage = requirePermission('user:manage', 'Only admins can add, change or remove users.')

  router.post('/', manage, async (req, res) => {
    const me = req.user!
    const input = parse(userCreateSchema, req.body)
    if (await emailTaken(input.email)) throw conflict('That email is already in use.', { email: 'Another user already has this email.' })
    const row = await db.get<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, 'active', ?) RETURNING id`,
      [input.name, input.email, await hashPassword(input.password), input.role, nowIso()],
    )
    const id = row!.id
    await logActivity(db, me, 'user.created', 'user', id, `${me.name} added ${input.name} as ${ROLE_LABELS[input.role]}`)
    res.status(201).json({ user: await getUser(id) })
  })

  router.put('/:id', manage, async (req, res) => {
    const me = req.user!
    const current = await getUser(parseId(req.params.id))
    if (!current) throw notFound('That user')
    const input = parse(userUpdateSchema, req.body)

    if (current.id === me.id && input.role !== current.role) {
      throw badRequest('Please fix the highlighted fields.', { role: 'You can’t change your own role. Ask another admin.' })
    }
    if (current.id === me.id && input.status !== 'active') {
      throw badRequest('Please fix the highlighted fields.', { status: 'You can’t suspend your own account.' })
    }
    if (current.isDemo && (input.role !== current.role || input.status !== current.status || input.email !== current.email)) {
      throw badRequest('Demo accounts are shared, so only their name can be changed.')
    }
    const losesAdmin = current.role === 'admin' && current.status === 'active' && (input.role !== 'admin' || input.status !== 'active')
    if (losesAdmin && (await activeAdmins()) <= 1) {
      throw conflict('The team needs at least one active admin.')
    }
    if (input.role === 'member' && current.projectCount > 0) {
      throw conflict(
        `${current.name} owns ${current.projectCount} project${current.projectCount === 1 ? '' : 's'}. Reassign ${current.projectCount === 1 ? 'it' : 'them'} before changing the role to Member.`,
        { role: 'Members can’t own projects. Reassign their projects first.' },
      )
    }
    if (await emailTaken(input.email, current.id)) {
      throw conflict('That email is already in use.', { email: 'Another user already has this email.' })
    }

    await db.tx(async (t) => {
      await t.run('UPDATE users SET name = ?, email = ?, role = ?, status = ? WHERE id = ?', [
        input.name,
        input.email,
        input.role,
        input.status,
        current.id,
      ])
      if (input.status === 'suspended') await t.run('DELETE FROM sessions WHERE user_id = ?', [current.id])
    })

    const changes: string[] = []
    if (input.role !== current.role) changes.push(`role ${ROLE_LABELS[current.role]} → ${ROLE_LABELS[input.role]}`)
    if (input.status !== current.status) changes.push(input.status === 'suspended' ? 'suspended the account' : 'reactivated the account')
    if (input.name !== current.name) changes.push(`name → ${input.name}`)
    if (input.email !== current.email) changes.push('changed the email')
    await logActivity(db, me, 'user.updated', 'user', current.id, `${me.name} updated ${input.name}${changes.length ? `: ${changes.join(', ')}` : ''}`)
    res.json({ user: await getUser(current.id) })
  })

  router.delete('/:id', manage, async (req, res) => {
    const me = req.user!
    const current = await getUser(parseId(req.params.id))
    if (!current) throw notFound('That user')
    if (current.id === me.id) throw badRequest('You can’t delete your own account.')
    if (current.isDemo) throw badRequest('Demo accounts can’t be deleted.')
    if (current.projectCount > 0) {
      throw conflict(
        `${current.name} owns ${current.projectCount} project${current.projectCount === 1 ? '' : 's'}. Reassign or delete ${current.projectCount === 1 ? 'it' : 'them'} first, or suspend the account instead.`,
      )
    }
    if (current.role === 'admin' && current.status === 'active' && (await activeAdmins()) <= 1) {
      throw conflict('The team needs at least one active admin.')
    }
    await db.run('DELETE FROM users WHERE id = ?', [current.id])
    await logActivity(db, me, 'user.deleted', 'user', current.id, `${me.name} removed ${current.name}`)
    res.status(204).end()
  })

  return router
}
