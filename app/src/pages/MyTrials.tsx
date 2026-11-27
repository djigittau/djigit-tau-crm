import { sb } from '../lib/supabase'
import { useLoad, must, State, PageHead, Empty, fmtDateTime, years } from '../lib/ui'
import { TRIAL_STATUS, age } from '../lib/refs'

type T = { id: string; child_name: string; child_birth_date: string | null; parent_name: string | null; trial_at: string | null; status: string; group_name: string | null; branch_name: string | null; dance_name: string | null; manager_name: string | null; comment: string | null }

// Пробники тренера: закреплённые за ним или в его группах (RPC my_trials, без телефонов родителей). Только просмотр.
export default function MyTrials() {
  const { data, loading, error } = useLoad(async () => must(await sb.rpc('my_trials')) as T[], [])
  const now = Date.now() - 2 * 3600_000 // занятие, начавшееся недавно, ещё в «Предстоящих»
  const upcoming = (data ?? []).filter((t) => t.trial_at && new Date(t.trial_at).getTime() >= now && t.status !== 'refused')
  const other = (data ?? []).filter((t) => !upcoming.includes(t))

  const card = (t: T) => {
    const a = age(t.child_birth_date)
    return (
      <div key={t.id} className="card trial-card">
        <div className="trial-when">{t.trial_at ? fmtDateTime(t.trial_at) : <span className="muted">дата не назначена</span>}</div>
        <h3>
          {t.child_name}
          {a != null && <span className="muted"> · {years(a)}</span>}
        </h3>
        <div className="muted small">{[t.branch_name, t.group_name, t.dance_name].filter(Boolean).join(' · ') || 'группа не указана'}</div>
        <div className="small">
          <span className="badge gold">{TRIAL_STATUS[t.status]}</span>
          {t.parent_name && <span className="muted"> · родитель: {t.parent_name}</span>}
          {t.manager_name && <span className="muted"> · записал(а): {t.manager_name}</span>}
        </div>
        {t.comment && <p className="small" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{t.comment}</p>}
      </div>
    )
  }

  return (
    <>
      <PageHead title="Пробники" sub="Пробные уроки, закреплённые за вами или в ваших группах" />
      <State loading={loading} error={error}>
        <h3 className="section-title">Предстоящие · {upcoming.length}</h3>
        {upcoming.length ? <div className="trial-grid">{upcoming.map(card)}</div> : <Empty text="Предстоящих пробных уроков нет" icon="calendar" />}
        {other.length > 0 && (
          <>
            <h3 className="section-title">Прошедшие и без даты · {other.length}</h3>
            <div className="trial-grid">{other.map(card)}</div>
          </>
        )}
      </State>
    </>
  )
}
