import { type FormEvent } from 'react'
import { PERMISSION_TABLE, ROLE_LABELS, ROLES } from '../../shared/permissions'
import { passwordChangeSchema, profileSchema } from '../../shared/schemas'
import type { SessionUser } from '../../shared/types'
import { api } from '../api'
import { useAuth, useUser } from '../auth'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/Layout'
import { FormError, LockedHint, RoleBadge, TextInput, useToast } from '../components/ui'
import { useZodForm } from '../form'

export function SettingsPage() {
  const user = useUser()
  const { updateUser } = useAuth()
  const toast = useToast()
  const profile = useZodForm(profileSchema, { name: user.name })
  const pw = useZodForm(passwordChangeSchema, { currentPassword: '', newPassword: '' })

  const saveProfile = (e: FormEvent) => {
    e.preventDefault()
    void profile.submit(async (data) => {
      const res = await api<{ user: SessionUser }>('/auth/me', { method: 'PATCH', body: data })
      updateUser(res.user)
      toast('ok', 'Profile saved')
    })
  }

  const savePassword = (e: FormEvent) => {
    e.preventDefault()
    void pw.submit(async (data) => {
      await api('/auth/me/password', { method: 'POST', body: data })
      pw.set('currentPassword', '')
      pw.set('newPassword', '')
      toast('ok', 'Password changed. Your other sessions were signed out.')
    })
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Your profile, password and what your role allows." />
      <div className="grid-2 align-start">
        <section className="card pad-lg">
          <h2>Profile</h2>
          <form onSubmit={saveProfile} noValidate className="stack">
            <FormError message={profile.formError} />
            <TextInput label="Full name" required {...profile.field('name')} />
            <TextInput label="Email" value={user.email} disabled hint="Ask an admin to change your email." readOnly />
            <div>
              <button type="submit" className="btn btn-primary" disabled={profile.submitting}>
                {profile.submitting ? 'Saving…' : 'Save profile'}
              </button>
            </div>
          </form>
        </section>

        <section className="card pad-lg">
          <h2>Password</h2>
          {user.isDemo ? (
            <LockedHint>Demo accounts share one login, so the password can’t be changed.</LockedHint>
          ) : (
            <form onSubmit={savePassword} noValidate className="stack">
              <FormError message={pw.formError} />
              <TextInput label="Current password" type="password" autoComplete="current-password" required {...pw.field('currentPassword')} />
              <TextInput
                label="New password"
                type="password"
                autoComplete="new-password"
                required
                hint="At least 8 characters, with a letter and a number."
                {...pw.field('newPassword')}
              />
              <div>
                <button type="submit" className="btn btn-primary" disabled={pw.submitting}>
                  {pw.submitting ? 'Saving…' : 'Change password'}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>

      <section className="card pad-lg">
        <div className="card-head flush">
          <h2>What each role can do</h2>
          <span>
            You are <RoleBadge role={user.role} />
          </span>
        </div>
        <div className="table-scroll">
          <table className="table perm-table">
            <thead>
              <tr>
                <th scope="col">Action</th>
                {ROLES.map((r) => (
                  <th scope="col" key={r} className={r === user.role ? 'mine' : ''}>
                    {ROLE_LABELS[r]}
                    {r === user.role && <span className="sr-only"> (your role)</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_TABLE.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  {ROLES.map((r) => (
                    <td key={r} className={r === user.role ? 'mine' : ''}>
                      {row[r] === 'No' ? (
                        <span className="perm-no">
                          <Icon name="close" size={14} /> No
                        </span>
                      ) : (
                        <span className="perm-yes">
                          <Icon name="check" size={14} /> {row[r]}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">These rules are checked by the server on every request. The screens only reflect them.</p>
      </section>
    </>
  )
}
