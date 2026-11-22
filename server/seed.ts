/**
 * Demo data: three demo accounts (one per role), a team of fictional people,
 * 42 projects and about a month of activity. A fixed random seed keeps it
 * the same on every run. Seeded accounts have no usable password; the demo
 * accounts are reached through the "Try a demo account" buttons instead.
 */
import type { Role } from '../shared/permissions'
import { PRIORITIES, PROJECT_STATUSES, type Priority, type ProjectStatus } from '../shared/schemas'
import { NO_PASSWORD } from './auth'
import { transaction, type DB } from './db'

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DEMO_USERS: { name: string; email: string; role: Role }[] = [
  { name: 'Amina Farouk', email: 'admin@ziraboard.test', role: 'admin' },
  { name: 'Omar Khaled', email: 'manager@ziraboard.test', role: 'manager' },
  { name: 'Lina Haddad', email: 'member@ziraboard.test', role: 'member' },
]

const TEAM: [string, Role][] = [
  ['Youssef Adel', 'manager'],
  ['Sara Mansour', 'manager'],
  ['Daniel Okafor', 'manager'],
  ['Mariam Saleh', 'admin'],
  ['Karim Nabil', 'member'],
  ['Hana Ibrahim', 'member'],
  ['Mostafa Gamal', 'member'],
  ['Priya Raman', 'member'],
  ['Nadine Fawzy', 'member'],
  ['Tarek Hassan', 'member'],
  ['Laila Mostafa', 'member'],
  ['Ahmed Samir', 'member'],
  ['Chloe Martin', 'member'],
  ['Ziad Ashraf', 'member'],
  ['Rana Youssef', 'member'],
  ['Mohamed Ezzat', 'member'],
  ['Farida Kamal', 'member'],
  ['Hassan Ali', 'member'],
  ['Noor Eldin', 'member'],
  ['Salma Hegazy', 'member'],
]

const PROJECT_NAMES = [
  'Customer portal redesign', 'Billing service migration', 'Mobile app onboarding', 'Q1 marketing site',
  'Data warehouse cleanup', 'Support inbox automation', 'Partner API v2', 'Security audit fixes',
  'Arabic localisation', 'Checkout A/B test', 'Internal wiki refresh', 'Design system tokens',
  'Search relevance tuning', 'Invoice PDF generator', 'Churn dashboard', 'SSO for enterprise plan',
  'Accessibility review', 'Notification preferences', 'CRM sync', 'Pricing page experiment',
  'Warehouse barcode scanner', 'Feedback widget', 'Team offsite planning', 'Hiring pipeline tracker',
  'GDPR data export', 'Status page', 'Referral programme', 'Load testing suite',
  'Analytics event audit', 'Dark mode', 'Help centre articles', 'Contract renewal reminders',
  'Onboarding emails', 'Dependency upgrades', 'Uptime alerts', 'Sales deck refresh',
  'Product tour video', 'Bug bash: November', 'Expense approvals', 'Vendor review',
  'Image CDN rollout', 'Two-factor authentication',
]

const DESCRIPTIONS = [
  'Scope agreed with the client. Waiting on final copy.',
  'Moving the remaining jobs off the old server before the contract ends.',
  'Shorter sign-up with fewer required fields.',
  'Tracks weekly numbers for the leadership meeting.',
  'Fixing the issues raised in the last review.',
  '',
]

export function seed(db: DB, now = new Date()) {
  const rand = mulberry32(20261117)
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!
  const daysAgo = (d: number, jitterHours = 10) =>
    new Date(now.getTime() - d * 86_400_000 - Math.floor(rand() * jitterHours * 3_600_000)).toISOString()

  transaction(db, () => {
    const insertUser = db.prepare(
      `INSERT INTO users (name, email, password_hash, role, status, is_demo, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const users: { id: number; name: string; role: Role }[] = []
    for (const u of DEMO_USERS) {
      const { lastInsertRowid } = insertUser.run(u.name, u.email, NO_PASSWORD, u.role, 'active', 1, daysAgo(120), daysAgo(1))
      users.push({ id: Number(lastInsertRowid), name: u.name, role: u.role })
    }
    TEAM.forEach(([name, role], i) => {
      const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@ziraboard.test`
      const status = i === 12 || i === 17 ? 'suspended' : 'active'
      const { lastInsertRowid } = insertUser.run(name, email, NO_PASSWORD, role, status, 0, daysAgo(30 + i * 4), i % 5 === 4 ? null : daysAgo(i % 9))
      users.push({ id: Number(lastInsertRowid), name, role })
    })

    const owners = users.filter((u) => u.role !== 'member')
    const insertProject = db.prepare(
      `INSERT INTO projects (name, description, status, priority, owner_id, due_date, budget, progress, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const projects: { id: number; name: string; ownerName: string }[] = []
    PROJECT_NAMES.forEach((name, i) => {
      const status = pick(PROJECT_STATUSES) as ProjectStatus
      const priority = pick(PRIORITIES) as Priority
      // The demo manager owns several projects so the "own projects" rule is easy to try.
      const owner = i % 6 === 0 ? owners[1]! : pick(owners)
      const progress =
        status === 'completed' ? 100 : status === 'planning' ? Math.floor(rand() * 4) * 5 : 10 + Math.floor(rand() * 17) * 5
      const due = rand() < 0.15 ? null : new Date(now.getTime() + (Math.floor(rand() * 120) - 30) * 86_400_000).toISOString().slice(0, 10)
      const budget = rand() < 0.25 ? null : Math.round(rand() * 80 + 2) * 1000
      const created = daysAgo(40 + Math.floor(rand() * 60))
      const updated = daysAgo(Math.floor(rand() * 25))
      const { lastInsertRowid } = insertProject.run(name, pick(DESCRIPTIONS), status, priority, owner.id, due, budget, progress, created, updated)
      projects.push({ id: Number(lastInsertRowid), name, ownerName: owner.name })
    })

    const insertActivity = db.prepare(
      `INSERT INTO activity (actor_id, actor_name, action, entity_type, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    const active = users.filter((_, i) => i !== 15 && i !== 20)
    for (let i = 0; i < 260; i++) {
      const actor = pick(active)
      const when = daysAgo(Math.floor(Math.pow(rand(), 1.6) * 30), 24)
      const roll = rand()
      if (roll < 0.45 || actor.role === 'member') {
        insertActivity.run(actor.id, actor.name, 'auth.login', 'auth', actor.id, `${actor.name} signed in`, when)
      } else if (roll < 0.85) {
        const p = pick(projects)
        const change = pick(['status Planning → Active', 'progress 40% → 55%', 'priority Medium → High', 'progress 70% → 85%', 'status Active → On hold'])
        insertActivity.run(actor.id, actor.name, 'project.updated', 'project', p.id, `${actor.name} updated “${p.name}”: ${change}`, when)
      } else {
        const p = pick(projects)
        insertActivity.run(actor.id, actor.name, 'project.created', 'project', p.id, `${actor.name} created “${p.name}”`, when)
      }
    }
  })
}

export function isEmpty(db: DB) {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n === 0
}

/** Delete everything and seed again. Used by the optional demo reset timer. */
export function resetDemo(db: DB) {
  transaction(db, () => {
    db.exec('DELETE FROM sessions; DELETE FROM activity; DELETE FROM projects; DELETE FROM users;')
  })
  seed(db)
}
