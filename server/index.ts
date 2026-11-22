import { join, resolve } from 'node:path'
import { createApp } from './app'
import { openDb } from './db'
import { isEmpty, resetDemo, seed } from './seed'

try {
  process.loadEnvFile()
} catch {
  // .env is optional
}

const env = process.env
const production = env.NODE_ENV === 'production'
// In development Vite owns PORT-like settings, so the API uses API_PORT (default 3001).
const port = Number(production ? (env.PORT ?? 3001) : (env.API_PORT ?? 3001))
const dataDir = resolve(env.DATA_DIR ?? './data')
const demoLogin = (env.DEMO_LOGIN ?? 'true') === 'true'
const resetHours = Number(env.DEMO_RESET_HOURS ?? 0)

const db = openDb(join(dataDir, 'ziraboard.db'))
if (isEmpty(db)) {
  seed(db)
  console.log('Seeded demo data')
}

if (resetHours > 0) {
  setInterval(() => {
    resetDemo(db)
    console.log('Demo data reset')
  }, resetHours * 3_600_000).unref()
}

const app = createApp(db, {
  demoLogin,
  secureCookies: production,
  clientDir: resolve('dist'),
})

app.listen(port, () => {
  console.log(`Ziraboard API on http://localhost:${port}${production ? '' : ' (open the app at http://localhost:5174)'}`)
})
