/**
 * The single source of truth for "who can do what".
 * The API enforces these rules; the UI reads the same table to hide, disable
 * or label actions, so what you see always matches what the server allows.
 */
export const ROLES = ['admin', 'manager', 'member'] as const
export type Role = (typeof ROLES)[number]

export type Action =
  | 'project:read'
  | 'project:create'
  | 'project:update'
  | 'project:delete'
  | 'user:read'
  | 'user:manage'
  | 'activity:read-all'

export interface Actor {
  id: number
  role: Role
}

/** A resource that has an owner, such as a project. */
export interface Owned {
  ownerId: number
}

export function can(actor: Actor | null | undefined, action: Action, resource?: Owned): boolean {
  if (!actor) return false
  switch (action) {
    case 'project:read':
      return true
    case 'project:create':
      return actor.role === 'admin' || actor.role === 'manager'
    case 'project:update':
    case 'project:delete':
      if (actor.role === 'admin') return true
      if (actor.role === 'manager') return resource ? resource.ownerId === actor.id : true
      return false
    case 'user:read':
    case 'activity:read-all':
      return actor.role === 'admin' || actor.role === 'manager'
    case 'user:manage':
      return actor.role === 'admin'
  }
}

/** Human-readable version of the rules, shown on the Settings page and in the README. */
export const PERMISSION_TABLE: { label: string; admin: string; manager: string; member: string }[] = [
  { label: 'View dashboard and projects', admin: 'Yes', manager: 'Yes', member: 'Yes' },
  { label: 'Create projects', admin: 'Yes', manager: 'Yes', member: 'No' },
  { label: 'Edit and delete projects', admin: 'Any project', manager: 'Own projects', member: 'No' },
  { label: 'Reassign a project to another owner', admin: 'Yes', manager: 'No', member: 'No' },
  { label: 'View the user list', admin: 'Yes', manager: 'Yes (read-only)', member: 'No' },
  { label: 'Add, edit, suspend and delete users', admin: 'Yes', manager: 'No', member: 'No' },
  { label: 'View activity log', admin: 'Everyone', manager: 'Everyone', member: 'Own actions' },
]

export const ROLE_LABELS: Record<Role, string> = { admin: 'Admin', manager: 'Manager', member: 'Member' }
