import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ROLE_LABELS, type Role } from '../../shared/permissions'
import { loginSchema, registerSchema } from '../../shared/schemas'
import type { AppConfig, SessionUser } from '../../shared/types'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Icon } from '../components/Icon'
import { FormError, TextInput } from '../components/ui'
import { useZodForm } from '../form'

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand brand-lg">
          <span className="brand-mark">Z</span>
          <span>Ziraboard</span>
        </div>
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
        {children}
      </div>
      <p className="auth-foot muted">Users, projects and activity for small teams.</p>
    </div>
  )
}

const DEMO_ROLES: { role: Role; text: string }[] = [
  { role: 'admin', text: 'Everything, including user management' },
  { role: 'manager', text: 'Create projects, edit own projects' },
  { role: 'member', text: 'Read-only, sees own activity' },
]

export function LoginPage() {
  const { signedIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const notice = (location.state as { notice?: string } | null)?.notice
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const form = useZodForm(loginSchema, { email: '', password: '' })
  const [demoBusy, setDemoBusy] = useState<Role | null>(null)
  const [demoError, setDemoError] = useState<string>()
  const config = useQuery({ queryKey: ['config'], queryFn: () => api<AppConfig>('/config'), staleTime: Infinity })

  const finish = (user: SessionUser) => {
    signedIn(user)
    navigate(from, { replace: true })
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void form.submit(async (data) => finish((await api<{ user: SessionUser }>('/auth/login', { method: 'POST', body: data })).user))
  }

  async function demo(role: Role) {
    setDemoBusy(role)
    setDemoError(undefined)
    try {
      finish((await api<{ user: SessionUser }>('/auth/demo', { method: 'POST', body: { role } })).user)
    } catch (err) {
      setDemoError(errorMessage(err))
      setDemoBusy(null)
    }
  }

  return (
    <AuthShell title="Sign in" subtitle="Welcome back. Sign in to see your team’s projects.">
      {notice && <div className="banner banner-info">{notice}</div>}
      <form onSubmit={onSubmit} noValidate className="stack">
        <FormError message={form.formError} />
        <TextInput label="Email" type="email" autoComplete="email" required {...form.field('email')} />
        <TextInput label="Password" type="password" autoComplete="current-password" required {...form.field('password')} />
        <button type="submit" className="btn btn-primary btn-block" disabled={form.submitting}>
          {form.submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="center muted">
        New here? <Link to="/register">Create an account</Link>
      </p>

      {config.data?.demoLogin && (
        <section className="demo-box" aria-labelledby="demo-title">
          <h2 id="demo-title">Try a demo account</h2>
          <p className="muted">Sign in with one click to see what each role can do.</p>
          <FormError message={demoError} />
          <div className="demo-roles">
            {DEMO_ROLES.map((d) => (
              <button key={d.role} type="button" className="demo-role" onClick={() => void demo(d.role)} disabled={demoBusy !== null}>
                <strong>{demoBusy === d.role ? 'Signing in…' : ROLE_LABELS[d.role]}</strong>
                <span>{d.text}</span>
                <Icon name="chevronRight" size={16} />
              </button>
            ))}
          </div>
        </section>
      )}
    </AuthShell>
  )
}

export function RegisterPage() {
  const { signedIn } = useAuth()
  const navigate = useNavigate()
  const form = useZodForm(registerSchema, { name: '', email: '', password: '' })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void form.submit(async (data) => {
      const { user } = await api<{ user: SessionUser }>('/auth/register', { method: 'POST', body: data })
      signedIn(user)
      navigate('/', { replace: true })
    })
  }

  return (
    <AuthShell title="Create an account" subtitle="New accounts start as Members. An admin can change your role.">
      <form onSubmit={onSubmit} noValidate className="stack">
        <FormError message={form.formError} />
        <TextInput label="Full name" autoComplete="name" required {...form.field('name')} />
        <TextInput label="Work email" type="email" autoComplete="email" required {...form.field('email')} />
        <TextInput
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 8 characters, with a letter and a number."
          {...form.field('password')}
        />
        <button type="submit" className="btn btn-primary btn-block" disabled={form.submitting}>
          {form.submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="center muted">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthShell>
  )
}
