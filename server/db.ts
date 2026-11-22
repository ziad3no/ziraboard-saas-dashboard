import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type DB = DatabaseSync

/** Schema. See docs/database.md for the reasoning behind each table. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('admin', 'manager', 'member')),
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL CHECK (status IN ('planning', 'active', 'on_hold', 'completed')),
  priority    TEXT    NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  due_date    TEXT,
  budget      INTEGER CHECK (budget IS NULL OR budget >= 0),
  progress    INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_owner  ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at);

CREATE TABLE IF NOT EXISTS activity (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name  TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  entity_type TEXT    NOT NULL CHECK (entity_type IN ('project', 'user', 'auth')),
  entity_id   INTEGER,
  summary     TEXT    NOT NULL,
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_actor   ON activity(actor_id);
`

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;')
  db.exec(SCHEMA)
  return db
}

/** Run fn inside a transaction; roll back if it throws. */
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export const nowIso = () => new Date().toISOString()
