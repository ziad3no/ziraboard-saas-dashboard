import { Router, type Response } from 'express'
import {
  demoLoginSchema,
  loginSchema,
  passwordChangeSchema,
  profileSchema,
  registerSchema,
} from '../../shared/schemas'
import { logActivity } from '../activity-log'
import {
  clearSessionCookie,
  createLoginLimiter,
  createSession,
  hashPassword,
  requireAuth,
  setSessionCookie,
  toSessionUser,
  type UserRecord,
  verifyPassword,
} from '../auth'
import type { AppOptions } from '../app'
import { nowIso, type DB } from '../db'
import { badRequest, conflict, forbidden, HttpError, notFound, parse } from '../http'

export function authRoutes(db: DB, options: AppOptions) {
  const router = Router()
  const limiter = createLoginLimiter()
  const findByEmail = (email: string) => db.get<UserRecord>('SELECT * FROM users WHERE email = ?', [email])

  async function startSession(res: Response, userId: number) {
    await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso(), userId])
    setSessionCookie(res, await createSession(db, userId), options.secureCookies)
  }

  router.post('/register', async (req, res) => {
    const input = parse(registerSchema, req.body)
    if (await findByEmail(input.email)) {
      throw conflict('An account with this email already exists.', {
        email: 'An account with this email already exists. Try signing in.',
      })
    }
    const hash = await hashPassword(input.password)
    const created = await db.get<UserRecord>(
      `INSERT INTO users (name, email, password_hash, role, status, created_at) VALUES (?, ?, ?, 'member', 'active', ?) RETURNING *`,
      [input.name, input.email, hash, nowIso()],
    )
    const user = created!
    await logActivity(db, user, 'user.registered', 'user', user.id, `${input.name} created an account`)
    await startSession(res, user.id)
    res.status(201).json({ user: toSessionUser(user) })
  })

  router.post('/login', async (req, res) => {
    const input = parse(loginSchema, req.body)
    const key = `${req.ip}|${input.email}`
    limiter.check(key)
    const user = await findByEmail(input.email)
    const ok = user ? await verifyPassword(input.password, user.password_hash) : false
    if (!user || !ok) {
      limiter.fail(key)
      throw new HttpError(401, 'Email or password is incorrect.')
    }
    if (user.status === 'suspended') throw forbidden('This account is suspended. Ask an admin to reactivate it.')
    limiter.reset(key)
    await startSession(res, user.id)
    await logActivity(db, user, 'auth.login', 'auth', user.id, `${user.name} signed in`)
    res.json({ user: toSessionUser(user) })
  })

  /** One-click sign-in as a seeded demo account. Off unless DEMO_LOGIN=true. */
  router.post('/demo', async (req, res) => {
    if (!options.demoLogin) throw notFound('Demo sign-in')
    const { role } = parse(demoLoginSchema, req.body)
    const user = await db.get<UserRecord>(
      `SELECT * FROM users WHERE is_demo AND role = ? AND status = 'active' ORDER BY id LIMIT 1`,
      [role],
    )
    if (!user) throw notFound('The demo account')
    await startSession(res, user.id)
    await logActivity(db, user, 'auth.login', 'auth', user.id, `${user.name} signed in (demo)`)
    res.json({ user: toSessionUser(user) })
  })

  router.post('/logout', async (req, res) => {
    if (req.sessionHash) await db.run('DELETE FROM sessions WHERE token_hash = ?', [req.sessionHash])
    clearSessionCookie(res, options.secureCookies)
    res.status(204).end()
  })

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user })
  })

  router.patch('/me', requireAuth, async (req, res) => {
    const { name } = parse(profileSchema, req.body)
    const me = req.user!
    await db.run('UPDATE users SET name = ? WHERE id = ?', [name, me.id])
    if (name !== me.name) {
      await logActivity(db, { id: me.id, name }, 'user.updated', 'user', me.id, `${me.name} changed their name to ${name}`)
    }
    res.json({ user: { ...me, name } })
  })

  router.post('/me/password', requireAuth, async (req, res) => {
    const me = req.user!
    if (me.isDemo) throw forbidden('Demo accounts share one login, so their password can’t be changed.')
    const input = parse(passwordChangeSchema, req.body)
    const row = await db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [me.id])
    if (!row || !(await verifyPassword(input.currentPassword, row.password_hash))) {
      throw badRequest('Your current password is incorrect.', { currentPassword: 'This doesn’t match your current password.' })
    }
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(input.newPassword), me.id])
    // Sign out every other session for this user.
    await db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [me.id, req.sessionHash ?? ''])
    await logActivity(db, me, 'user.password_changed', 'user', me.id, `${me.name} changed their password`)
    res.status(204).end()
  })

  return router
}
