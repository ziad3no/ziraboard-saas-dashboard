import type { SessionUser } from '../shared/types'
import { nowIso, type DB } from './db'

export function logActivity(
  db: DB,
  actor: Pick<SessionUser, 'id' | 'name'>,
  action: string,
  entityType: 'project' | 'user' | 'auth',
  entityId: number | null,
  summary: string,
) {
  db.prepare(
    `INSERT INTO activity (actor_id, actor_name, action, entity_type, entity_id, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(actor.id, actor.name, action, entityType, entityId, summary, nowIso())
}
