/**
 * PostgreSQL access. In production the app talks to Supabase (or any
 * Postgres) through DATABASE_URL / POSTGRES_URL. Locally and in the tests it
 * runs PGlite, a full Postgres compiled to WebAssembly, so there is nothing
 * to install. Both speak the same SQL, so the queries are identical.
 */
import { mkdirSync } from 'node:fs'
import pg from 'pg'

export interface Queryable {
  all<T>(sql: string, params?: unknown[]): Promise<T[]>
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>
  run(sql: string, params?: unknown[]): Promise<{ rowCount: number }>
  exec(sql: string): Promise<void>
}

export interface DB extends Queryable {
  tx<T>(fn: (t: Queryable) => Promise<T>): Promise<T>
  close(): Promise<void>
}

/** Queries are written with "?" placeholders; Postgres wants $1, $2, … */
export const toPg = (sql: string) => {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

// COUNT(*) and other bigint results arrive as strings from node-postgres; numbers are easier to use.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10))

type PgClient = pg.Pool | pg.PoolClient

function pgQueryable(c: PgClient): Queryable {
  return {
    all: async <T>(sql: string, params: unknown[] = []) => (await c.query(toPg(sql), params)).rows as T[],
    get: async <T>(sql: string, params: unknown[] = []) => (await c.query(toPg(sql), params)).rows[0] as T | undefined,
    run: async (sql: string, params: unknown[] = []) => ({ rowCount: (await c.query(toPg(sql), params)).rowCount ?? 0 }),
    exec: async (sql: string) => {
      await c.query(sql)
    },
  }
}

function connectPostgres(url: string): DB {
  // Hosted Postgres (Supabase) uses TLS with its own certificate chain, and some
  // connection strings carry sslmode/pooler hints that node-postgres would
  // interpret too strictly. TLS is configured here instead.
  const u = new URL(url)
  for (const key of ['sslmode', 'supa', 'pgbouncer']) u.searchParams.delete(key)
  const local = ['localhost', '127.0.0.1'].includes(u.hostname)
  const pool = new pg.Pool({
    connectionString: u.toString(),
    ssl: local ? undefined : { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10_000,
  })
  return {
    ...pgQueryable(pool),
    async tx(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn(pgQueryable(client))
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

async function startPglite(dataDir?: string): Promise<DB> {
  const { PGlite } = await import('@electric-sql/pglite')
  if (dataDir) mkdirSync(dataDir, { recursive: true })
  const db = new PGlite(dataDir)
  await db.waitReady
  type Q = Pick<InstanceType<typeof PGlite>, 'query' | 'exec'>
  const wrap = (c: Q): Queryable => ({
    all: async <T>(sql: string, params: unknown[] = []) => (await c.query<T>(toPg(sql), params)).rows,
    get: async <T>(sql: string, params: unknown[] = []) => (await c.query<T>(toPg(sql), params)).rows[0],
    run: async (sql: string, params: unknown[] = []) => ({ rowCount: (await c.query(toPg(sql), params)).affectedRows ?? 0 }),
    exec: async (sql: string) => {
      await c.exec(sql)
    },
  })
  return {
    ...wrap(db),
    tx: (fn) => db.transaction((t) => fn(wrap(t))),
    close: () => db.close(),
  }
}

/** Schema. Created on start-up; safe to run many times. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('admin', 'manager', 'member')),
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  is_demo       BOOLEAN NOT NULL DEFAULT FALSE,
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
  id          SERIAL PRIMARY KEY,
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
CREATE INDEX IF NOT EXISTS idx_projects_owner   ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_status  ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at);

CREATE TABLE IF NOT EXISTS activity (
  id          SERIAL PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

/** Lock id used so two servers starting at once don't create tables or seed twice. */
export const SETUP_LOCK = 7_241_001

export async function openDb(options: { url?: string; dataDir?: string } = {}): Promise<DB> {
  const db = options.url ? connectPostgres(options.url) : await startPglite(options.dataDir)
  await db.tx(async (t) => {
    await t.get('SELECT pg_advisory_xact_lock(?)', [SETUP_LOCK])
    await t.exec(SCHEMA)
  })
  return db
}

export const nowIso = () => new Date().toISOString()
