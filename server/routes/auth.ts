import { Router } from 'express'
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
  const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?')

  function startSession(res: import('express').Response, userId: number) {
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), userId)
    setSessionCookie(res, createSession(db, userId), options.secureCookies)
  }

  router.post('/register', async (req, res) => {
    const input = parse(registerSchema, req.body)
    if (findByEmail.get(input.email)) {
      throw conflict('An account with this email already exists.', {
        email: 'An account with this email already exists. Try signing in.',
      })
    }
    const hash = await hashPassword(input.password)
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO users (name, email, password_hash, role, status, created_at) VALUES (?, ?, ?, 'member', 'active', ?)`)
      .run(input.name, input.email, hash, nowIso())
    const id = Number(lastInsertRowid)
    logActivity(db, { id, name: input.name }, 'user.registered', 'user', id, `${input.name} created an account`)
    startSession(res, id)
    res.status(201).json({ user: toSessionUser(findByEmail.get(input.email) as unknown as UserRecord) })
  })

  router.post('/login', async (req, res) => {
    const input = parse(loginSchema, req.body)
    const key = `${req.ip}|${input.email}`
    limiter.check(key)
    const user = findByEmail.get(input.email) as UserRecord | undefined
    const ok = user ? await verifyPassword(input.password, user.password_hash) : false
    if (!user || !ok) {
      limiter.fail(key)
      throw new HttpError(401, 'Email or password is incorrect.')
    }
    if (user.status === 'suspended') throw forbidden('This account is suspended. Ask an admin to reactivate it.')
    limiter.reset(key)
    startSession(res, user.id)
    logActivity(db, user, 'auth.login', 'auth', user.id, `${user.name} signed in`)
    res.json({ user: toSessionUser(user) })
  })

  /** One-click sign-in as a seeded demo account. Off unless DEMO_LOGIN=true. */
  router.post('/demo', (req, res) => {
    if (!options.demoLogin) throw notFound('Demo sign-in')
    const { role } = parse(demoLoginSchema, req.body)
    const user = db.prepare(`SELECT * FROM users WHERE is_demo = 1 AND role = ? AND status = 'active' ORDER BY id LIMIT 1`).get(role) as UserRecord | undefined
    if (!user) throw notFound('The demo account')
    startSession(res, user.id)
    logActivity(db, user, 'auth.login', 'auth', user.id, `${user.name} signed in (demo)`)
    res.json({ user: toSessionUser(user) })
  })

  router.post('/logout', (req, res) => {
    if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash)
    clearSessionCookie(res, options.secureCookies)
    res.status(204).end()
  })

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user })
  })

  router.patch('/me', requireAuth, (req, res) => {
    const { name } = parse(profileSchema, req.body)
    const me = req.user!
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, me.id)
    if (name !== me.name) logActivity(db, { id: me.id, name }, 'user.updated', 'user', me.id, `${me.name} changed their name to ${name}`)
    res.json({ user: { ...me, name } })
  })

  router.post('/me/password', requireAuth, async (req, res) => {
    const me = req.user!
    if (me.isDemo) throw forbidden('Demo accounts share one login, so their password can’t be changed.')
    const input = parse(passwordChangeSchema, req.body)
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(me.id) as { password_hash: string }
    if (!(await verifyPassword(input.currentPassword, row.password_hash))) {
      throw badRequest('Your current password is incorrect.', { currentPassword: 'This doesn’t match your current password.' })
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(input.newPassword), me.id)
    // Sign out every other session for this user.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(me.id, req.sessionHash ?? '')
    logActivity(db, me, 'user.password_changed', 'user', me.id, `${me.name} changed their password`)
    res.status(204).end()
  })

  return router
}
