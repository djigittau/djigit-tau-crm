import { useState } from 'react'
import { sb, ROLE_LABEL, type Profile } from '../lib/supabase'
import { useLoad, must, act, initials, fmtDate, tenure, years } from '../lib/ui'
import { uploadPhoto } from '../lib/photo'
import { age, monthBounds, thisMonth } from '../lib/refs'

// Шапка профиля сотрудника: фото, имя, роль, стаж, возраст. onPhoto — можно сменить фото (сам сотрудник или директор).
export function StaffHead({ p, onPhoto }: { p: Profile; onPhoto?: (url: string) => Promise<unknown> }) {
  const [busy, setBusy] = useState(false)
  const t = tenure(p.hired_at)
  const a = age(p.birth_date)
  return (
    <div className="person">
      <span className="avatar xl">{p.photo_url ? <img src={p.photo_url} alt="" /> : initials(p.full_name)}</span>
      <div>
        <h2>{p.full_name}</h2>
        <span className="badge gold">{ROLE_LABEL[p.role]}</span>
        <small className="muted block">
          {t ? `Стаж: ${t}` : 'Стаж: дата приёма не указана'}
          {a != null && ` · ${years(a)}`}
        </small>
        {onPhoto && (
          <label className="btn ghost sm" style={{ marginTop: 8 }}>
            {busy ? 'Загрузка…' : p.photo_url ? 'Сменить фото' : 'Добавить фото'}
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={busy}
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                setBusy(true)
                await act(async () => onPhoto(await uploadPhoto('staff', p.id, f)), 'Фото сохранено')
                setBusy(false)
              }}
            />
          </label>
        )}
      </div>
    </div>
  )
}

// Подробности профиля (видят руководители и сам сотрудник).
export function StaffProps({ p }: { p: Profile }) {
  return (
    <dl className="props">
      <dt>Телефон</dt>
      <dd>{p.phone || '—'}</dd>
      <dt>Email</dt>
      <dd>{p.email || '—'}</dd>
      <dt>Дата приёма</dt>
      <dd>{fmtDate(p.hired_at)}</dd>
      <dt>Дата рождения</dt>
      <dd>{fmtDate(p.birth_date)}</dd>
      {p.bio && (
        <>
          <dt>О себе</dt>
          <dd style={{ whiteSpace: 'pre-wrap' }}>{p.bio}</dd>
        </>
      )}
    </dl>
  )
}

// Тренер: группы, проведённые занятия, процент от абонементов.
export function TrainerStats({ p }: { p: Profile }) {
  const { data } = useLoad(async () => {
    const now = new Date().toISOString()
    const base = () => sb.from('lessons').select('id', { count: 'exact', head: true }).eq('trainer_id', p.id).in('status', ['scheduled', 'completed']).lt('starts_at', now)
    const [groups, month, all, def] = await Promise.all([
      sb.from('group_trainers').select('groups(name, status, branches(name))').eq('trainer_id', p.id).then(must),
      base().gte('starts_at', monthBounds(thisMonth()).t0),
      base(),
      sb.from('crm_settings').select('value').eq('key', 'trainer_percent').maybeSingle().then(must),
    ])
    type G = { name: string; status: string; branches: { name: string } | null }
    return {
      groups: (groups as unknown as { groups: G | null }[]).map((g) => g.groups).filter((g): g is G => !!g && g.status === 'active'),
      month: month.count ?? 0,
      all: all.count ?? 0,
      def: Number((def as { value: unknown } | null)?.value ?? 0),
    }
  }, [p.id])
  if (!data) return null
  return (
    <section className="card">
      <h3>Работа тренера</h3>
      <dl className="props">
        <dt>Группы</dt>
        <dd>
          {data.groups.length
            ? data.groups.map((g, i) => (
                <div key={i}>
                  {g.name} <span className="muted">· {g.branches?.name}</span>
                </div>
              ))
            : '—'}
        </dd>
        <dt>Занятий</dt>
        <dd>
          в этом месяце {data.month} · всего {data.all}
        </dd>
        <dt>Процент</dt>
        <dd>
          {p.salary_percent ?? data.def}% от абонементов
          {p.salary_percent == null && <span className="muted"> (по умолчанию)</span>}
        </dd>
      </dl>
    </section>
  )
}
