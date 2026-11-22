import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../server/app'
import { openDb, type DB } from '../server/db'
import { resetDemo } from '../server/seed'

const H = { 'X-Requested-With': 'ziraboard' }

let db: DB
let app: ReturnType<typeof createApp>

// One in-memory Postgres (PGlite) for the file, wiped and re-seeded before each test.
beforeAll(async () => {
  db = await openDb()
}, 60_000)

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  await resetDemo(db)
  app = createApp(db, { demoLogin: true, secureCookies: false })
})

/** Sign in as a demo role and return an agent that keeps the cookie. */
async function as(role: 'admin' | 'manager' | 'member') {
  const agent = request.agent(app)
  const res = await agent.post('/api/auth/demo').set(H).send({ role })
  expect(res.status).toBe(200)
  return agent
}

const validProject = { name: 'New launch plan', description: '', status: 'active', priority: 'high', progress: 10, dueDate: '', budget: '' }

describe('authentication', () => {
  it('rejects API calls without a session', async () => {
    const res = await request(app).get('/api/projects')
    expect(res.status).toBe(401)
  })

  it('registers a member, signs in with the password, and signs out', async () => {
    const agent = request.agent(app)
    const reg = await agent.post('/api/auth/register').set(H).send({ name: 'Test User', email: 'Test@Example.com', password: 'secret123' })
    expect(reg.status).toBe(201)
    expect(reg.body.user).toMatchObject({ email: 'test@example.com', role: 'member' })
    expect(reg.headers['set-cookie']?.[0]).toMatch(/HttpOnly/)

    await agent.post('/api/auth/logout').set(H).expect(204)
    await agent.get('/api/auth/me').expect(401)

    const bad = await agent.post('/api/auth/login').set(H).send({ email: 'test@example.com', password: 'wrong-pass1' })
    expect(bad.status).toBe(401)
    expect(bad.body.error.message).toBe('Email or password is incorrect.')

    const ok = await agent.post('/api/auth/login').set(H).send({ email: 'test@example.com', password: 'secret123' })
    expect(ok.status).toBe(200)
    await agent.get('/api/auth/me').expect(200)
  })

  it('returns field errors for an invalid registration', async () => {
    const res = await request(app).post('/api/auth/register').set(H).send({ name: 'A', email: 'nope', password: 'short' })
    expect(res.status).toBe(400)
    expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual(['email', 'name', 'password'])
  })

  it('refuses a duplicate email with a 409', async () => {
    const res = await request(app).post('/api/auth/register').set(H).send({ name: 'Copy', email: 'admin@ziraboard.test', password: 'secret123' })
    expect(res.status).toBe(409)
    expect(res.body.error.fieldErrors.email).toMatch(/already exists/)
  })

  it('blocks writes without the CSRF header', async () => {
    const res = await request(app).post('/api/auth/demo').send({ role: 'admin' })
    expect(res.status).toBe(403)
  })

  it('throttles repeated failed logins', async () => {
    let last = 0
    for (let i = 0; i < 9; i++) {
      last = (await request(app).post('/api/auth/login').set(H).send({ email: 'admin@ziraboard.test', password: 'guess1234' })).status
    }
    expect(last).toBe(429)
  })

  it('hides demo sign-in when it is turned off', async () => {
    const closed = createApp(db, { demoLogin: false, secureCookies: false })
    await request(closed).post('/api/auth/demo').set(H).send({ role: 'admin' }).expect(404)
  })
})

describe('role-based access', () => {
  it('lets a member read projects but not create, edit or delete them', async () => {
    const member = await as('member')
    const list = await member.get('/api/projects').expect(200)
    expect(list.body.items[0]).toMatchObject({ canEdit: false, canDelete: false })
    const id = list.body.items[0].id
    await member.post('/api/projects').set(H).send(validProject).expect(403)
    await member.put(`/api/projects/${id}`).set(H).send(validProject).expect(403)
    await member.delete(`/api/projects/${id}`).set(H).expect(403)
  })

  it('lets a manager edit their own projects only', async () => {
    const manager = await as('manager')
    const me = (await manager.get('/api/auth/me')).body.user
    const all = (await manager.get('/api/projects?pageSize=50')).body.items as { id: number; ownerId: number; canEdit: boolean }[]
    const own = all.find((p) => p.ownerId === me.id)!
    const other = all.find((p) => p.ownerId !== me.id)!
    expect(own.canEdit).toBe(true)
    expect(other.canEdit).toBe(false)
    await manager.put(`/api/projects/${own.id}`).set(H).send({ ...validProject, name: 'Renamed by manager' }).expect(200)
    const denied = await manager.put(`/api/projects/${other.id}`).set(H).send(validProject)
    expect(denied.status).toBe(403)
    expect(denied.body.error.message).toBe('Managers can only edit projects they own.')
  })

  it('stops a manager from assigning a project to someone else', async () => {
    const manager = await as('manager')
    const res = await manager.post('/api/projects').set(H).send({ ...validProject, ownerId: 1 })
    expect(res.status).toBe(400)
    expect(res.body.error.fieldErrors.ownerId).toMatch(/Only admins/)
  })

  it('keeps the user list away from members and user changes away from managers', async () => {
    const member = await as('member')
    await member.get('/api/users').expect(403)
    const manager = await as('manager')
    await manager.get('/api/users').expect(200)
    await manager.post('/api/users').set(H).send({ name: 'X Y', email: 'x@y.test', role: 'member', password: 'secret123' }).expect(403)
  })

  it('shows members only their own activity, even if they ask for someone else', async () => {
    const member = await as('member')
    const me = (await member.get('/api/auth/me')).body.user
    const res = await member.get('/api/activity?actorId=1').expect(200)
    expect(res.body.scope).toBe('own')
    expect(res.body.items.every((a: { actorId: number }) => a.actorId === me.id)).toBe(true)
  })
})

describe('projects CRUD, validation and listing', () => {
  it('creates, updates and deletes a project and logs each step', async () => {
    const admin = await as('admin')
    const created = await admin.post('/api/projects').set(H).send({ ...validProject, budget: '12000' }).expect(201)
    const id = created.body.project.id
    expect(created.body.project.budget).toBe(12000)
    await admin.put(`/api/projects/${id}`).set(H).send({ ...validProject, status: 'completed', progress: 100 }).expect(200)
    await admin.delete(`/api/projects/${id}`).set(H).expect(204)
    await admin.get(`/api/projects/${id}`).expect(404)
    const log = (await admin.get('/api/activity?entity=project')).body.items.slice(0, 3).map((a: { action: string }) => a.action)
    expect(log).toEqual(['project.deleted', 'project.updated', 'project.created'])
  })

  it('applies the cross-field rules', async () => {
    const admin = await as('admin')
    const completed = await admin.post('/api/projects').set(H).send({ ...validProject, status: 'completed', progress: 60 })
    expect(completed.status).toBe(400)
    expect(completed.body.error.fieldErrors).toEqual({ progress: 'A completed project must be at 100% progress' })
    const budget = await admin.post('/api/projects').set(H).send({ ...validProject, budget: '-5' })
    expect(budget.body.error.fieldErrors).toEqual({ budget: 'Budget can’t be negative' })
  })

  it('searches, filters and paginates', async () => {
    const admin = await as('admin')
    const page1 = (await admin.get('/api/projects?pageSize=10&page=1')).body
    const page2 = (await admin.get('/api/projects?pageSize=10&page=2')).body
    expect(page1.total).toBe(42)
    expect(page1.items).toHaveLength(10)
    expect(page2.items[0].id).not.toBe(page1.items[0].id)

    const search = (await admin.get('/api/projects?q=billing')).body
    expect(search.items.map((p: { name: string }) => p.name)).toContain('Billing service migration')

    const active = (await admin.get('/api/projects?status=active&pageSize=50')).body
    expect(active.items.every((p: { status: string }) => p.status === 'active')).toBe(true)

    // Wildcards in the search box are treated as plain text.
    expect((await admin.get('/api/projects?q=%25')).body.total).toBe(0)
  })

  it('ignores junk query parameters instead of failing', async () => {
    const admin = await as('admin')
    const res = await admin.get('/api/projects?page=-4&pageSize=9999&status=nonsense&sort=drop').expect(200)
    expect(res.body).toMatchObject({ page: 1, pageSize: 10, total: 42 })
  })
})

describe('user management rules', () => {
  it('will not let an admin demote themselves or remove the last admin', async () => {
    const admin = await as('admin')
    const me = (await admin.get('/api/auth/me')).body.user
    const res = await admin.put(`/api/users/${me.id}`).set(H).send({ name: me.name, email: me.email, role: 'manager', status: 'active' })
    expect(res.status).toBe(400)
    expect(res.body.error.fieldErrors.role).toMatch(/your own role/)
  })

  it('blocks deleting a user who still owns projects', async () => {
    const admin = await as('admin')
    const users = (await admin.get('/api/users?pageSize=50')).body.items as { id: number; projectCount: number; isDemo: boolean }[]
    const owner = users.find((u) => u.projectCount > 0 && !u.isDemo)!
    const res = await admin.delete(`/api/users/${owner.id}`).set(H)
    expect(res.status).toBe(409)
    expect(res.body.error.message).toMatch(/Reassign/)
  })

  it('signs a suspended user out straight away', async () => {
    const admin = await as('admin')
    const agent = request.agent(app)
    await agent.post('/api/auth/register').set(H).send({ name: 'Short Stay', email: 'short@stay.test', password: 'secret123' }).expect(201)
    const me = (await agent.get('/api/auth/me')).body.user
    await admin.put(`/api/users/${me.id}`).set(H).send({ name: me.name, email: me.email, role: 'member', status: 'suspended' }).expect(200)
    await agent.get('/api/auth/me').expect(401)
    const login = await agent.post('/api/auth/login').set(H).send({ email: 'short@stay.test', password: 'secret123' })
    expect(login.status).toBe(403)
  })
})
