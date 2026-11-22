import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { can, ROLE_LABELS, ROLES } from '../../shared/permissions'
import { userCreateSchema, userUpdateSchema } from '../../shared/schemas'
import type { Page, SessionUser, UserRow } from '../../shared/types'
import { api, errorMessage } from '../api'
import { useUser } from '../auth'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/Layout'
import {
  Avatar,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormError,
  LockedHint,
  Modal,
  Pagination,
  RoleBadge,
  Select,
  SkeletonRows,
  TextInput,
  useToast,
} from '../components/ui'
import { formatDate, timeAgo } from '../format'
import { useZodForm } from '../form'
import { useDebounced, useUrlState } from '../hooks'

export function UsersPage() {
  const me = useUser()
  const queryClient = useQueryClient()
  const toast = useToast()
  const manage = can(me, 'user:manage')
  const url = useUrlState(['q', 'role', 'status'] as const)
  const pageSize = url.pageSize ?? 10
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null)
  const [deleting, setDeleting] = useState<UserRow | null>(null)

  const [search, setSearch] = useState(url.values.q)
  const debounced = useDebounced(search, 300)
  useEffect(() => {
    if (debounced !== url.values.q) url.set({ q: debounced })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const query = { ...url.values, page: url.page, pageSize }
  const users = useQuery({
    queryKey: ['users', query],
    queryFn: () => api<Page<UserRow>>('/users', { query }),
    placeholderData: keepPreviousData,
  })

  const remove = useMutation({
    mutationFn: (u: UserRow) => api(`/users/${u.id}`, { method: 'DELETE' }),
    onSuccess: (_d, u) => {
      toast('ok', `Removed ${u.name}`)
      setDeleting(null)
      void queryClient.invalidateQueries()
    },
  })

  return (
    <>
      <PageHeader
        title="Users"
        subtitle={manage ? 'Add people, change roles and suspend accounts.' : 'Everyone on the team. Only admins can make changes.'}
        actions={
          manage ? (
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
              <Icon name="plus" size={16} /> Add user
            </button>
          ) : (
            <LockedHint>Read-only for managers</LockedHint>
          )
        }
      />
      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={16} />
          <input
            type="search"
            className="input"
            placeholder="Search name or email"
            aria-label="Search users"
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select className="input" aria-label="Filter by role" value={url.values.role} onChange={(e) => url.set({ role: e.target.value })}>
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <select className="input" aria-label="Filter by status" value={url.values.status} onChange={(e) => url.set({ status: e.target.value })}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        {(url.hasFilters || search) && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setSearch('')
              url.set({ q: null, role: null, status: null })
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="card table-card">
        {users.isError ? (
          <ErrorState message={errorMessage(users.error)} onRetry={() => void users.refetch()} />
        ) : (
          <>
            <table className="table table-cards">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Projects</th>
                  <th scope="col">Last sign-in</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className={users.isPlaceholderData ? 'is-stale' : ''}>
                {users.isPending ? (
                  <SkeletonRows cols={6} />
                ) : (
                  users.data.items.map((u) => (
                    <tr key={u.id}>
                      <td data-label="Name">
                        <div className="person">
                          <Avatar name={u.name} />
                          <div>
                            <strong>
                              {u.name}
                              {u.id === me.id && <span className="muted"> (you)</span>}
                            </strong>
                            <div className="muted small">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Role">
                        <RoleBadge role={u.role} />
                        {u.isDemo && <span className="badge badge-outline">Demo</span>}
                      </td>
                      <td data-label="Status">
                        <span className={`state-dot ${u.status}`}>{u.status === 'active' ? 'Active' : 'Suspended'}</span>
                      </td>
                      <td data-label="Projects">{u.projectCount}</td>
                      <td data-label="Last sign-in">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : <span className="muted">Never</span>}</td>
                      <td className="row-actions">
                        {manage ? (
                          <>
                            <button type="button" className="icon-btn" onClick={() => setEditing(u)} aria-label={`Edit ${u.name}`} title="Edit">
                              <Icon name="edit" size={16} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn danger"
                              onClick={() => {
                                remove.reset()
                                setDeleting(u)
                              }}
                              disabled={u.id === me.id || u.isDemo}
                              aria-label={`Delete ${u.name}`}
                              title={u.id === me.id ? 'You can’t delete yourself' : u.isDemo ? 'Demo accounts can’t be deleted' : 'Delete'}
                            >
                              <Icon name="trash" size={16} />
                            </button>
                          </>
                        ) : (
                          <span className="icon-btn is-locked" title="Only admins can change users" role="img" aria-label="Read only">
                            <Icon name="lock" size={15} />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {users.data?.items.length === 0 && (
              <EmptyState icon="users" title="No users match your filters">
                <p className="muted">Try another name, role or status.</p>
              </EmptyState>
            )}
            {users.data && (
              <Pagination
                page={users.data.page}
                pageSize={users.data.pageSize}
                total={users.data.total}
                onPage={(p) => url.set({ page: p })}
                onPageSize={(s) => url.set({ pageSize: s })}
              />
            )}
          </>
        )}
      </div>

      {editing && <UserDialog user={editing === 'new' ? null : editing} me={me} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        title="Remove user?"
        message={
          <>
            {deleting?.name} will lose access straight away. Their past activity stays in the log. This can’t be undone.
          </>
        }
        confirmLabel="Remove user"
        busy={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : undefined}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}

function UserDialog({ user, me, onClose }: { user: UserRow | null; me: SessionUser; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const isSelf = user?.id === me.id
  const form = useZodForm(user ? userUpdateSchema : userCreateSchema, {
    name: user?.name ?? '',
    email: user?.email ?? '',
    role: user?.role ?? 'member',
    status: user?.status ?? 'active',
    password: '',
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void form.submit(async (data) => {
      const saved = user
        ? await api<{ user: UserRow }>(`/users/${user.id}`, { method: 'PUT', body: data })
        : await api<{ user: UserRow }>('/users', { method: 'POST', body: data })
      toast('ok', user ? `Saved ${saved.user.name}` : `Added ${saved.user.name}`)
      void queryClient.invalidateQueries()
      onClose()
    })
  }

  return (
    <Modal
      open
      title={user ? `Edit ${user.name}` : 'Add user'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="user-form" className="btn btn-primary" disabled={form.submitting}>
            {form.submitting ? 'Saving…' : user ? 'Save changes' : 'Add user'}
          </button>
        </>
      }
    >
      <form id="user-form" onSubmit={onSubmit} noValidate className="form-grid">
        <FormError message={form.formError} />
        {user?.isDemo && (
          <div className="banner banner-info span-2">
            <Icon name="lock" size={16} /> This is a shared demo account. Only its name can be changed.
          </div>
        )}
        <div className="span-2">
          <TextInput label="Full name" required {...form.field('name')} />
        </div>
        <div className="span-2">
          <TextInput label="Email" type="email" required disabled={user?.isDemo} {...form.field('email')} />
        </div>
        <Select
          label="Role"
          required
          disabled={isSelf || user?.isDemo}
          hint={isSelf ? 'You can’t change your own role.' : 'Members can’t own projects.'}
          options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
          {...form.field('role')}
        />
        {user ? (
          <Select
            label="Status"
            required
            disabled={isSelf || user.isDemo}
            hint={isSelf ? 'You can’t suspend yourself.' : 'Suspended users are signed out at once.'}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'suspended', label: 'Suspended' },
            ]}
            {...form.field('status')}
          />
        ) : (
          <TextInput
            label="Temporary password"
            type="password"
            autoComplete="new-password"
            required
            hint="8+ characters with a letter and a number. Share it privately."
            {...form.field('password')}
          />
        )}
        {user && (
          <p className="muted small span-2">
            Joined {formatDate(user.createdAt)} · owns {user.projectCount} project{user.projectCount === 1 ? '' : 's'}
          </p>
        )}
      </form>
    </Modal>
  )
}
