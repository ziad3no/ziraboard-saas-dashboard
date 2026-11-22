import type { Role } from './permissions'
import type { Priority, ProjectStatus, UserStatus } from './schemas'

/** The signed-in user, as returned by /api/auth/me. */
export interface SessionUser {
  id: number
  name: string
  email: string
  role: Role
  status: UserStatus
  isDemo: boolean
}

export interface UserRow {
  id: number
  name: string
  email: string
  role: Role
  status: UserStatus
  isDemo: boolean
  createdAt: string
  lastLoginAt: string | null
  projectCount: number
}

export interface ProjectRow {
  id: number
  name: string
  description: string
  status: ProjectStatus
  priority: Priority
  ownerId: number
  ownerName: string
  dueDate: string | null
  budget: number | null
  progress: number
  createdAt: string
  updatedAt: string
  /** Computed for the current user from shared/permissions.ts. */
  canEdit: boolean
  canDelete: boolean
}

export interface ActivityRow {
  id: number
  actorId: number | null
  actorName: string
  action: string
  entityType: 'project' | 'user' | 'auth'
  entityId: number | null
  summary: string
  createdAt: string
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface Stats {
  users: { total: number; active: number } | null
  projects: {
    total: number
    byStatus: Record<ProjectStatus, number>
    overdue: number
    mine: number
  }
  activityByDay: { date: string; count: number }[]
  activityScope: 'everyone' | 'own'
  recent: ActivityRow[]
}

export interface Owner {
  id: number
  name: string
  role: Role
}

export interface ApiErrorBody {
  error: { message: string; fieldErrors?: Record<string, string> }
}

export interface AppConfig {
  demoLogin: boolean
}
