import { describe, expect, it } from 'vitest'
import { can } from '../shared/permissions'
import { projectSchema } from '../shared/schemas'

const admin = { id: 1, role: 'admin' as const }
const manager = { id: 2, role: 'manager' as const }
const member = { id: 3, role: 'member' as const }

describe('can()', () => {
  it('matches the permission table', () => {
    expect(can(member, 'project:read')).toBe(true)
    expect(can(member, 'project:create')).toBe(false)
    expect(can(manager, 'project:create')).toBe(true)
    expect(can(manager, 'project:update', { ownerId: 2 })).toBe(true)
    expect(can(manager, 'project:update', { ownerId: 9 })).toBe(false)
    expect(can(admin, 'project:delete', { ownerId: 9 })).toBe(true)
    expect(can(manager, 'user:read')).toBe(true)
    expect(can(manager, 'user:manage')).toBe(false)
    expect(can(admin, 'user:manage')).toBe(true)
    expect(can(null, 'project:read')).toBe(false)
  })
})

describe('projectSchema', () => {
  const base = { name: 'Valid name', status: 'active', priority: 'low', progress: 30 }

  it('turns empty optional fields into null', () => {
    const out = projectSchema.parse({ ...base, dueDate: '', budget: '' })
    expect(out).toMatchObject({ dueDate: null, budget: null, description: '' })
  })

  it('rejects a bad date, a fractional budget and a short name', () => {
    const result = projectSchema.safeParse({ ...base, name: 'ab', dueDate: '2026-13-45', budget: '12.5' })
    expect(result.success).toBe(false)
    const paths = result.error!.issues.map((i) => i.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['name', 'dueDate', 'budget']))
  })

  it('limits progress for planning projects', () => {
    expect(projectSchema.safeParse({ ...base, status: 'planning', progress: 50 }).success).toBe(false)
    expect(projectSchema.safeParse({ ...base, status: 'planning', progress: 20 }).success).toBe(true)
  })
})
