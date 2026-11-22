import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { can } from '../../shared/permissions'
import {
  PRIORITIES,
  PRIORITY_LABELS,
  PROJECT_STATUSES,
  projectSchema,
  STATUS_LABELS,
} from '../../shared/schemas'
import type { Owner, Page, ProjectRow, SessionUser } from '../../shared/types'
import { api, errorMessage } from '../api'
import { useUser } from '../auth'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/Layout'
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormError,
  LockedHint,
  Modal,
  Pagination,
  PriorityBadge,
  Select,
  SkeletonRows,
  StatusBadge,
  TextArea,
  TextInput,
  useToast,
} from '../components/ui'
import { formatDate, formatMoney, isOverdue } from '../format'
import { useZodForm } from '../form'
import { useDebounced, useUrlState } from '../hooks'

const SORTS = [
  { value: 'updated', label: 'Last updated' },
  { value: 'name', label: 'Name' },
  { value: 'due', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'progress', label: 'Progress' },
]

export function ProjectsPage() {
  const user = useUser()
  const queryClient = useQueryClient()
  const toast = useToast()
  const url = useUrlState(['q', 'status', 'priority', 'ownerId', 'sort', 'dir'] as const)
  const pageSize = url.pageSize ?? 10
  const [editing, setEditing] = useState<ProjectRow | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ProjectRow | null>(null)

  // Search box: type freely, the URL (and the request) follows after 300 ms.
  const [search, setSearch] = useState(url.values.q)
  const debounced = useDebounced(search, 300)
  useEffect(() => {
    if (debounced !== url.values.q) url.set({ q: debounced })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const query = { ...url.values, page: url.page, pageSize }
  const projects = useQuery({
    queryKey: ['projects', query],
    queryFn: () => api<Page<ProjectRow>>('/projects', { query }),
    placeholderData: keepPreviousData,
  })
  const owners = useQuery({ queryKey: ['owners'], queryFn: () => api<{ owners: Owner[] }>('/users/owners') })

  const remove = useMutation({
    mutationFn: (p: ProjectRow) => api(`/projects/${p.id}`, { method: 'DELETE' }),
    onSuccess: (_d, p) => {
      toast('ok', `Deleted “${p.name}”`)
      setDeleting(null)
      void queryClient.invalidateQueries()
    },
  })

  const canCreate = can(user, 'project:create')
  const dir = url.values.dir || 'desc'
  const items = projects.data?.items ?? []

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Search, filter and manage your team’s projects."
        actions={
          canCreate ? (
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
              <Icon name="plus" size={16} /> New project
            </button>
          ) : (
            <span className="locked-wrap">
              <button type="button" className="btn btn-primary" disabled aria-describedby="create-lock">
                <Icon name="plus" size={16} /> New project
              </button>
              <span id="create-lock">
                <LockedHint>Only managers and admins can create projects</LockedHint>
              </span>
            </span>
          )
        }
      />

      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={16} />
          <input
            type="search"
            className="input"
            placeholder="Search name, description or owner"
            aria-label="Search projects"
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select className="input" aria-label="Filter by status" value={url.values.status} onChange={(e) => url.set({ status: e.target.value })}>
          <option value="">All statuses</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select className="input" aria-label="Filter by priority" value={url.values.priority} onChange={(e) => url.set({ priority: e.target.value })}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <select className="input" aria-label="Filter by owner" value={url.values.ownerId} onChange={(e) => url.set({ ownerId: e.target.value })}>
          <option value="">All owners</option>
          {owners.data?.owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.id === user.id ? `${o.name} (you)` : o.name}
            </option>
          ))}
        </select>
        <div className="sort">
          <select className="input" aria-label="Sort by" value={url.values.sort || 'updated'} onChange={(e) => url.set({ sort: e.target.value })}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                Sort: {s.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-btn bordered"
            onClick={() => url.set({ dir: dir === 'asc' ? 'desc' : 'asc' })}
            aria-label={dir === 'asc' ? 'Ascending, switch to descending' : 'Descending, switch to ascending'}
            title={dir === 'asc' ? 'Ascending' : 'Descending'}
          >
            <Icon name="sort" size={16} />
            <span className="dir-label">{dir === 'asc' ? 'Asc' : 'Desc'}</span>
          </button>
        </div>
        {(url.hasFilters || search) && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setSearch('')
              url.set({ q: null, status: null, priority: null, ownerId: null, sort: null, dir: null })
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="card table-card">
        {projects.isError ? (
          <ErrorState message={errorMessage(projects.error)} onRetry={() => void projects.refetch()} />
        ) : (
          <>
            <table className="table table-cards">
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Status</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Due</th>
                  <th scope="col">Progress</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className={projects.isPlaceholderData ? 'is-stale' : ''}>
                {projects.isPending ? (
                  <SkeletonRows cols={7} />
                ) : (
                  items.map((p) => (
                    <tr key={p.id}>
                      <td data-label="Project">
                        <button type="button" className="link-btn strong" onClick={() => setEditing(p)}>
                          {p.name}
                        </button>
                        {p.description && <div className="muted clamp">{p.description}</div>}
                      </td>
                      <td data-label="Status">
                        <StatusBadge status={p.status} />
                      </td>
                      <td data-label="Priority">
                        <PriorityBadge priority={p.priority} />
                      </td>
                      <td data-label="Owner">{p.ownerId === user.id ? <strong>You</strong> : p.ownerName}</td>
                      <td data-label="Due" className={isOverdue(p.dueDate, p.status) ? 'overdue' : ''}>
                        {formatDate(p.dueDate)}
                        {isOverdue(p.dueDate, p.status) && <span className="sr-only"> (overdue)</span>}
                      </td>
                      <td data-label="Progress">
                        <div className="progress" title={`${p.progress}%`}>
                          <div className="progress-bar" style={{ width: `${p.progress}%` }} />
                        </div>
                        <span className="progress-num">{p.progress}%</span>
                      </td>
                      <td className="row-actions">
                        {p.canEdit ? (
                          <button type="button" className="icon-btn" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`} title="Edit">
                            <Icon name="edit" size={16} />
                          </button>
                        ) : (
                          <span
                            className="icon-btn is-locked"
                            title={user.role === 'manager' ? 'Only the owner or an admin can edit this' : 'Read-only for members'}
                            aria-label="Read only"
                            role="img"
                          >
                            <Icon name="lock" size={15} />
                          </span>
                        )}
                        {p.canDelete && (
                          <button
                            type="button"
                            className="icon-btn danger"
                            onClick={() => {
                              remove.reset()
                              setDeleting(p)
                            }}
                            aria-label={`Delete ${p.name}`}
                            title="Delete"
                          >
                            <Icon name="trash" size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {projects.data && items.length === 0 && (
              url.hasFilters ? (
                <EmptyState icon="search" title="No projects match your filters">
                  <p className="muted">Try a different search or clear the filters.</p>
                </EmptyState>
              ) : (
                <EmptyState icon="folder" title="No projects yet">
                  <p className="muted">{canCreate ? 'Create the first one with “New project”.' : 'A manager or admin can create the first one.'}</p>
                </EmptyState>
              )
            )}
            {projects.data && (
              <Pagination
                page={projects.data.page}
                pageSize={projects.data.pageSize}
                total={projects.data.total}
                onPage={(p) => url.set({ page: p })}
                onPageSize={(s) => url.set({ pageSize: s })}
              />
            )}
          </>
        )}
      </div>

      {editing && (
        <ProjectDialog
          project={editing === 'new' ? null : editing}
          user={user}
          owners={owners.data?.owners ?? []}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete project?"
        message={
          <>
            “{deleting?.name}” will be removed for everyone. This can’t be undone.
          </>
        }
        confirmLabel="Delete project"
        busy={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : undefined}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}

function ProjectDialog({
  project,
  user,
  owners,
  onClose,
}: {
  project: ProjectRow | null
  user: SessionUser
  owners: Owner[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const readOnly = project ? !project.canEdit : false
  const form = useZodForm(projectSchema, {
    name: project?.name ?? '',
    description: project?.description ?? '',
    status: project?.status ?? 'planning',
    priority: project?.priority ?? 'medium',
    ownerId: String(project?.ownerId ?? user.id),
    dueDate: project?.dueDate ?? '',
    budget: project?.budget === null || project?.budget === undefined ? '' : String(project.budget),
    progress: String(project?.progress ?? 0),
  })

  const ownerOptions = owners.some((o) => o.id === Number(form.values.ownerId))
    ? owners
    : [...owners, { id: Number(form.values.ownerId), name: project?.ownerName ?? user.name, role: 'manager' as const }]

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void form.submit(async (data) => {
      const saved = project
        ? await api<{ project: ProjectRow }>(`/projects/${project.id}`, { method: 'PUT', body: data })
        : await api<{ project: ProjectRow }>('/projects', { method: 'POST', body: data })
      toast('ok', project ? `Saved “${saved.project.name}”` : `Created “${saved.project.name}”`)
      void queryClient.invalidateQueries()
      onClose()
    })
  }

  const title = !project ? 'New project' : readOnly ? project.name : 'Edit project'

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        readOnly ? (
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" form="project-form" className="btn btn-primary" disabled={form.submitting}>
              {form.submitting ? 'Saving…' : project ? 'Save changes' : 'Create project'}
            </button>
          </>
        )
      }
    >
      {readOnly && (
        <div className="banner banner-info">
          <Icon name="lock" size={16} />
          <span>
            {user.role === 'member'
              ? 'You can view this project. Members can’t edit projects.'
              : 'You can view this project. Only its owner or an admin can edit it.'}
          </span>
        </div>
      )}
      <form id="project-form" onSubmit={onSubmit} noValidate>
        <fieldset disabled={readOnly} className="form-grid">
          <FormError message={form.formError} />
          <div className="span-2">
            <TextInput label="Name" required maxLength={80} {...form.field('name')} />
          </div>
          <div className="span-2">
            <TextArea
              label="Description"
              rows={3}
              maxLength={500}
              hint={`${form.values.description?.length ?? 0}/500`}
              {...form.field('description')}
            />
          </div>
          <Select
            label="Status"
            required
            options={PROJECT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
            {...form.field('status')}
          />
          <Select
            label="Priority"
            required
            options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
            {...form.field('priority')}
          />
          <Select
            label="Owner"
            required
            disabled={user.role !== 'admin' || readOnly}
            hint={user.role !== 'admin' && !readOnly ? 'Only admins can reassign projects.' : undefined}
            options={ownerOptions.map((o) => ({ value: o.id, label: o.id === user.id ? `${o.name} (you)` : o.name }))}
            {...form.field('ownerId')}
          />
          <TextInput label="Due date" type="date" {...form.field('dueDate')} />
          <TextInput label="Budget (USD)" inputMode="numeric" placeholder="e.g. 15000" {...form.field('budget')} />
          <TextInput
            label="Progress (%)"
            type="number"
            min={0}
            max={100}
            step={5}
            required
            hint="Completed projects must be at 100%."
            {...form.field('progress')}
          />
          {project && (
            <p className="muted span-2 small">
              Owner: {project.ownerName} · Budget {formatMoney(project.budget)} · Last updated {formatDate(project.updatedAt)}
            </p>
          )}
        </fieldset>
      </form>
    </Modal>
  )
}
