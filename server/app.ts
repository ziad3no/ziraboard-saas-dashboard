import { existsSync } from 'node:fs'
import { join } from 'node:path'
import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import type { AppConfig } from '../shared/types'
import { loadUser, requireCsrfHeader } from './auth'
import type { DB } from './db'
import { errorHandler, notFound } from './http'
import { activityRoutes, statsRoutes } from './routes/activity'
import { authRoutes } from './routes/auth'
import { projectRoutes } from './routes/projects'
import { userRoutes } from './routes/users'

export interface AppOptions {
  /** Show one-click demo sign-in buttons. */
  demoLogin: boolean
  /** Mark cookies Secure (HTTPS only). On in production. */
  secureCookies: boolean
  /** Folder with the built client (dist/). Served when it exists. */
  clientDir?: string
}

export function createApp(db: DB, options: AppOptions) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1) // behind Render's / Fly's proxy, so req.ip is the real client
  app.use(helmet())
  app.use(express.json({ limit: '50kb' }))
  app.use(cookieParser())

  const api = express.Router()
  api.use(requireCsrfHeader)
  api.use(loadUser(db))
  api.get('/health', (_req, res) => {
    res.json({ ok: true })
  })
  api.get('/config', (_req, res) => {
    const config: AppConfig = { demoLogin: options.demoLogin }
    res.json(config)
  })
  api.use('/auth', authRoutes(db, options))
  api.use('/projects', projectRoutes(db))
  api.use('/users', userRoutes(db))
  api.use('/activity', activityRoutes(db))
  api.use('/stats', statsRoutes(db))
  api.use(() => {
    throw notFound('That API route')
  })
  app.use('/api', api)

  // Serve the React app in production. Any non-API path returns index.html
  // so client-side routes like /projects work on refresh.
  if (options.clientDir && existsSync(join(options.clientDir, 'index.html'))) {
    app.use(express.static(options.clientDir, { index: false, maxAge: '1h' }))
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(join(options.clientDir!, 'index.html'))
    })
  }

  app.use(errorHandler)
  return app
}
