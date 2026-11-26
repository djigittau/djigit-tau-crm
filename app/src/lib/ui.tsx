import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { errText } from './supabase'

// ---------- загрузка данных ----------
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps)
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setData(await run())
      setError(null)
    } catch (e) {
      setError(errText(e))
    } finally {
      setLoading(false)
    }
  }, [run])
  useEffect(() => {
    reload()
  }, [reload])
  return { data, error, loading, reload }
}

// Бросает ошибку Supabase, чтобы её поймал вызывающий код.
export function must<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error
  return r.data
}

// ---------- уведомления ----------
type Toast = { id: number; text: string; bad?: boolean }
let push: (t: Toast) => void = () => {}
export function toast(text: string, bad = false) {
  push({ id: Date.now() + Math.random(), text, bad })
}
export function Toasts() {
  const [list, setList] = useState<Toast[]>([])
  useEffect(() => {
    push = (t) => {
      setList((l) => [...l, t])
      setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), 3500)
    }
  }, [])
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={'toast' + (t.bad ? ' bad' : '')}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

// Выполняет действие, показывает ошибку или успех.
export async function act(fn: () => Promise<unknown>, ok?: string) {
  try {
    await fn()
    if (ok) toast(ok)
    return true
  } catch (e) {
    toast(errText(e), true)
    return false
  }
}

// ---------- компоненты ----------
export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  )
}

export function Field({ label, children, full, hint }: { label: string; children: ReactNode; full?: boolean; hint?: string }) {
  return (
    <label className={'field' + (full ? ' full' : '')}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      <div className="actions">{children}</div>
    </div>
  )
}

export function Empty({ text, icon = 'layers' }: { text: ReactNode; icon?: IconName }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <div>{text}</div>
    </div>
  )
}

export function State({ loading, error, children }: { loading: boolean; error: string | null; children: ReactNode }) {
  if (error) return <div className="alert bad">{error}</div>
  if (loading) return <div className="loading">Загрузка…</div>
  return <>{children}</>
}

// ---------- форматирование ----------
// Время студии — всегда по Алматы, на каком бы устройстве ни открыли CRM.
export const TZ = 'Asia/Almaty'
export const money = (n: number | null | undefined) => Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₸'
// Чистая дата (YYYY-MM-DD) не сдвигается поясом; дата со временем — показывается по Алматы.
export const fmtDate = (d: string | null | undefined) =>
  !d ? '—' : d.length === 10 ? d.split('-').reverse().join('.') : new Date(d).toLocaleDateString('ru-RU', { timeZone: TZ })
export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
export function fmtMinutes(m: number | null | undefined) {
  if (m == null) return '—'
  const h = Math.floor(m / 60)
  return h ? `${h} ч ${m % 60} мин` : `${m} мин`
}
export const initials = (n: string) =>
  n
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

// ---------- иконки ----------
const PATHS = {
  home: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4.4 3.6-8 8-8s8 3.6 8 8',
  users: 'M9 11a3.2 3.2 0 100-6.4A3.2 3.2 0 009 11zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3 3 0 010 6M21 20c0-2.6-1.6-4.8-4-5.6',
  building: 'M4 3h16v18H4zM9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 3',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  menu: 'M4 6h16M4 12h16M4 18h16',
  out: 'M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 17l-5-5 5-5M5 12h11',
  side: 'M3 4h18v16H3zM9 4v16',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4',
  key: 'M15 7a3 3 0 11-3 3M12 10l-9 9M7 15l2 2M5 17l2 2',
  play: 'M7 4l13 8-13 8V4z',
  stop: 'M6 6h12v12H6z',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-3.5-3.5',
  calendar: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  family: 'M8 9a3 3 0 100-6 3 3 0 000 6zM2 21c0-3.3 2.7-6 6-6s6 2.7 6 6M17 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM15 21c0-2.5 1.2-4.5 3-5.3 1.9.8 3 2.8 3 5.3',
} as const
export type IconName = keyof typeof PATHS
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="i" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
