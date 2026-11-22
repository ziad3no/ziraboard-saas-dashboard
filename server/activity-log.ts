import type { SessionUser } from '../shared/types'
import { nowIso, type Queryable } from './db'

export async function logActivity(
  db: Queryable,
  actor: Pick<SessionUser, 'id' | 'name'>,
  action: string,
  entityType: 'project' | 'user' | 'auth',
  entityId: number | null,
  summary: string,
) {
  await db.run(
    `INSERT INTO activity (actor_id, actor_name, action, entity_type, entity_id, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [actor.id, actor.name, action, entityType, entityId, summary, nowIso()],
  )
}
