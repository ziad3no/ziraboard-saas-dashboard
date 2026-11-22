/**
 * Validation rules shared by the browser (instant feedback) and the API
 * (the real gate). Messages are written for the person filling in the form.
 */
import { z } from 'zod'
import { ROLES } from './permissions'

export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed'] as const
export const PRIORITIES = ['low', 'medium', 'high'] as const
export const USER_STATUSES = ['active', 'suspended'] as const

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]
export type Priority = (typeof PRIORITIES)[number]
export type UserStatus = (typeof USER_STATUSES)[number]

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
}
export const PRIORITY_LABELS: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High' }

const personName = z
  .string({ error: 'Enter a name' })
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(60, 'Name must be 60 characters or fewer')

const email = z
  .string({ error: 'Enter an email address' })
  .trim()
  .toLowerCase()
  .min(1, 'Enter an email address')
  .max(120, 'Email must be 120 characters or fewer')
  .pipe(z.email('Enter a valid email address, like name@company.com'))

export const password = z
  .string({ error: 'Enter a password' })
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be 72 characters or fewer')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number')

export const registerSchema = z.object({ name: personName, email, password })
export const loginSchema = z.object({
  email,
  password: z.string({ error: 'Enter your password' }).min(1, 'Enter your password').max(200),
})
export const demoLoginSchema = z.object({ role: z.enum(ROLES) })
export const profileSchema = z.object({ name: personName })
export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(200),
    newPassword: password,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'The new password must be different from the current one',
    path: ['newPassword'],
  })

const isoDate = /^\d{4}-\d{2}-\d{2}$/

export const projectSchema = z
  .object({
    name: z
      .string({ error: 'Enter a project name' })
      .trim()
      .min(3, 'Project name must be at least 3 characters')
      .max(80, 'Project name must be 80 characters or fewer'),
    description: z.string().trim().max(500, 'Description must be 500 characters or fewer').default(''),
    status: z.enum(PROJECT_STATUSES, { error: 'Choose a status' }),
    priority: z.enum(PRIORITIES, { error: 'Choose a priority' }),
    ownerId: z.coerce.number().int().positive('Choose an owner').optional(),
    dueDate: z
      .string()
      .trim()
      .refine((v) => v === '' || (isoDate.test(v) && !Number.isNaN(Date.parse(v))), 'Use a valid date')
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .default(null),
    budget: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? null : typeof v === 'string' ? Number(v) : v),
      z
        .number({ error: 'Budget must be a number' })
        .int('Budget must be a whole number')
        .min(0, 'Budget can’t be negative')
        .max(10_000_000, 'Budget must be 10,000,000 or less')
        .nullable(),
    ),
    progress: z.coerce
      .number({ error: 'Progress must be a number' })
      .int('Progress must be a whole number')
      .min(0, 'Progress can’t be below 0%')
      .max(100, 'Progress can’t be above 100%'),
  })
  .refine((p) => p.status !== 'completed' || p.progress === 100, {
    message: 'A completed project must be at 100% progress',
    path: ['progress'],
  })
  .refine((p) => p.status !== 'planning' || p.progress <= 20, {
    message: 'A project in planning can’t be more than 20% done. Move it to Active first.',
    path: ['progress'],
  })

export type ProjectInput = z.input<typeof projectSchema>
export type ProjectData = z.output<typeof projectSchema>

export const userCreateSchema = z.object({
  name: personName,
  email,
  role: z.enum(ROLES, { error: 'Choose a role' }),
  password,
})
export const userUpdateSchema = z.object({
  name: personName,
  email,
  role: z.enum(ROLES, { error: 'Choose a role' }),
  status: z.enum(USER_STATUSES, { error: 'Choose a status' }),
})

const page = z.coerce.number().int().min(1).max(10_000).catch(1)
const pageSize = z.coerce
  .number()
  .int()
  .refine((n) => [10, 20, 50].includes(n))
  .catch(10)
const search = z.string().trim().max(100).catch('')

export const PROJECT_SORTS = ['updated', 'name', 'due', 'priority', 'progress'] as const
export type ProjectSort = (typeof PROJECT_SORTS)[number]

export const projectListQuery = z.object({
  page,
  pageSize,
  q: search.default(''),
  status: z.enum(PROJECT_STATUSES).optional().catch(undefined),
  priority: z.enum(PRIORITIES).optional().catch(undefined),
  ownerId: z.coerce.number().int().positive().optional().catch(undefined),
  sort: z.enum(PROJECT_SORTS).catch('updated').default('updated'),
  dir: z.enum(['asc', 'desc']).catch('desc').default('desc'),
})

export const userListQuery = z.object({
  page,
  pageSize,
  q: search.default(''),
  role: z.enum(ROLES).optional().catch(undefined),
  status: z.enum(USER_STATUSES).optional().catch(undefined),
})

export const ACTIVITY_ENTITIES = ['project', 'user', 'auth'] as const
export const activityListQuery = z.object({
  page,
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => [10, 20, 50].includes(n))
    .catch(20),
  actorId: z.coerce.number().int().positive().optional().catch(undefined),
  entity: z.enum(ACTIVITY_ENTITIES).optional().catch(undefined),
})

/** Turn a ZodError into { field: firstMessage } for forms. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form'
    if (!(key in out)) out[key] = issue.message
  }
  return out
}
