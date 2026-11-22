const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const relFmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export const formatDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)) : '—')
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso))
export const formatMoney = (n: number | null) => (n === null ? '—' : moneyFmt.format(n))

export function timeAgo(iso: string, now = Date.now()) {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 60) return 'just now'
  if (abs < 3600) return relFmt.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return relFmt.format(Math.round(seconds / 3600), 'hour')
  if (abs < 86_400 * 30) return relFmt.format(Math.round(seconds / 86_400), 'day')
  return formatDate(iso)
}

export const todayIso = () => new Date().toISOString().slice(0, 10)

export const isOverdue = (dueDate: string | null, status: string) => !!dueDate && status !== 'completed' && dueDate < todayIso()

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
