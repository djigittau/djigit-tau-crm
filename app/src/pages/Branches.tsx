import { useState } from 'react'
import { sb, type Branch } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Empty, Modal, Field, Icon, act } from '../lib/ui'

type Row = Branch & { manager: { full_name: string } | null }
type Counts = Record<string, { students: number; groups: number }>
type Hours = ([string, string] | null)[]
type Draft = Partial<Branch> & { trainers: string[] }

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const DEFAULT_HOURS: Hours = [...Array(6).fill(['10:00', '21:00']), null]

// «Пн–Пт 10:00–21:00 · Сб 10:00–16:00 · Вс выходной»: подряд идущие дни с одинаковым временем — одной записью.
function hoursText(h: Hours | null) {
  if (!h) return null
  const key = (d: [string, string] | null) => (d ? `${d[0]}–${d[1]}` : 'выходной')
  const parts: string[] = []
  for (let i = 0; i < 7; ) {
    let j = i
    while (j + 1 < 7 && key(h[j + 1]) === key(h[i])) j++
    parts.push(`${DAYS[i]}${j > i ? '–' + DAYS[j] : ''} ${key(h[i])}`)
    i = j + 1
  }
  return parts.join(' · ')
}

export default function Branches() {
  const me = useMe()
  const isDirector = me.role === 'director'
  const canEdit = isDirector || me.role === 'manager' || me.role === 'admin' // база: save_branch — офис своих филиалов
  const [edit, setEdit] = useState<Draft | null>(null)
  const [q, setQ] = useState('')

  const { data, loading, error, reload } = useLoad(async () => {
    const [branches, students, groups, managers, trainers] = await Promise.all([
      sb.from('branches').select('*, manager:profiles!branches_manager_id_fkey(full_name)').order('name').then(must),
      sb.from('students').select('branch_id').eq('status', 'active').then(must),
      sb.from('groups').select('branch_id').eq('status', 'active').then(must),
      isDirector ? sb.from('profiles').select('id, full_name').eq('role', 'manager').eq('status', 'active').order('full_name').then(must) : Promise.resolve([]),
      canEdit ? sb.rpc('branch_trainer_options').then(must) : Promise.resolve([]),
    ])
    const c: Counts = {}
    const add = (list: { branch_id: string }[], k: 'students' | 'groups') => list.forEach((x) => ((c[x.branch_id] ??= { students: 0, groups: 0 })[k] += 1))
    add(students as { branch_id: string }[], 'students')
    add(groups as { branch_id: string }[], 'groups')
    return {
      branches: branches as unknown as Row[],
      counts: c,
      managers: managers as { id: string; full_name: string }[],
      trainers: trainers as { id: string; full_name: string; branches: string[] }[],
    }
  }, [isDirector, canEdit])

  const list = (data?.branches ?? []).filter((b) => !q || (b.name + ' ' + (b.address ?? '')).toLowerCase().includes(q.toLowerCase()))
  const trainersOf = (id: string) => (data?.trainers ?? []).filter((t) => t.branches.includes(id))

  function open(b?: Row) {
    setEdit(b ? { ...b, hours: b.hours ?? DEFAULT_HOURS, trainers: trainersOf(b.id).map((t) => t.id) } : { is_active: true, hours: DEFAULT_HOURS, trainers: [] })
  }

  const setDay = (i: number, v: [string, string] | null) => edit && setEdit({ ...edit, hours: (edit.hours ?? DEFAULT_HOURS).map((d, k) => (k === i ? v : d)) })

  async function save() {
    if (!edit) return
    const ok = await act(async () => {
      if (!edit.name?.trim()) throw new Error('Введите название филиала')
      const h = edit.hours ?? DEFAULT_HOURS
      if (h.some((d) => d && (!d[0] || !d[1] || d[0] >= d[1]))) throw new Error('Проверьте часы работы: «с» должно быть раньше «до»')
      must(
        await sb.rpc('save_branch', {
          p_id: edit.id ?? null,
          p_name: edit.name,
          p_address: edit.address ?? '',
          p_phone: edit.phone ?? '',
          p_hours: h,
          p_trainers: edit.trainers,
          p_manager: edit.manager_id || null,
          p_active: edit.is_active ?? true,
        }),
      )
    }, 'Филиал сохранён')
    if (ok) {
      setEdit(null)
      reload()
    }
  }

  const hours = edit?.hours ?? DEFAULT_HOURS

  return (
    <>
      <PageHead title="Филиалы" sub={data ? `Действующих: ${data.branches.filter((b) => b.is_active).length}` : undefined}>
        {canEdit && (
          <button className="btn" onClick={() => open()}>
            <Icon name="plus" /> Добавить филиал
          </button>
        )}
      </PageHead>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input placeholder="Поиск по названию или адресу" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
        </div>
      </div>
      <State loading={loading} error={error}>
        <section className="card flush">
          {list.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Филиал</th>
                    <th>Часы работы</th>
                    {canEdit && <th>Тренеры</th>}
                    <th className="num">Ученики</th>
                    <th className="num">Группы</th>
                    <th>Статус</th>
                    {canEdit && <th />}
                  </tr>
                </thead>
                <tbody>
                  {list.map((b) => {
                    const c = data!.counts[b.id]
                    const tr = trainersOf(b.id)
                    return (
                      <tr key={b.id}>
                        <td>
                          <b>{b.name}</b>
                          <small className="muted block">{[b.address, b.phone].filter(Boolean).join(' · ') || '—'}</small>
                          {b.manager && <small className="muted block">Управляющий: {b.manager.full_name}</small>}
                        </td>
                        <td>{hoursText(b.hours) ?? <span className="muted">не указаны</span>}</td>
                        {canEdit && <td>{tr.length ? tr.map((t) => t.full_name).join(', ') : <span className="muted">нет</span>}</td>}
                        <td className="num">{c?.students ?? 0}</td>
                        <td className="num">{c?.groups ?? 0}</td>
                        <td>{b.is_active ? <span className="badge ok">Действует</span> : <span className="badge">Закрыт</span>}</td>
                        {canEdit && (
                          <td className="act">
                            <button className="btn ghost sm" onClick={() => open(b)}>
                              Изменить
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text={q ? 'Ничего не найдено' : canEdit ? 'Филиалов пока нет. Нажмите «Добавить филиал».' : 'Вас ещё не назначили на филиал'} icon="building" />
          )}
        </section>
      </State>

      {edit && (
        <Modal
          title={edit.id ? 'Изменить филиал' : 'Новый филиал'}
          onClose={() => setEdit(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setEdit(null)}>
                Отмена
              </button>
              <button className="btn" onClick={save}>
                Сохранить
              </button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="Название *" full>
              <input autoFocus value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Адрес">
              <input value={edit.address ?? ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
            </Field>
            <Field label="Телефон">
              <input value={edit.phone ?? ''} inputMode="tel" onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
            </Field>
            <div className="field full">
              <span>Часы работы</span>
              <div className="hours-grid">
                {DAYS.map((d, i) => {
                  const v = hours[i]
                  return (
                    <div className="hours-row" key={d}>
                      <b>{d}</b>
                      <input type="time" aria-label={`${d} с`} value={v?.[0] ?? ''} disabled={!v} onChange={(e) => setDay(i, [e.target.value, v?.[1] ?? ''])} />
                      <input type="time" aria-label={`${d} до`} value={v?.[1] ?? ''} disabled={!v} onChange={(e) => setDay(i, [v?.[0] ?? '', e.target.value])} />
                      <label className="check inline small">
                        <input type="checkbox" checked={!v} onChange={(e) => setDay(i, e.target.checked ? null : (hours[0] ?? ['10:00', '21:00']))} /> выходной
                      </label>
                    </div>
                  )
                })}
              </div>
              <button type="button" className="btn ghost sm" style={{ marginTop: 8, justifySelf: 'start' }} onClick={() => setEdit({ ...edit, hours: hours.map((d) => (d ? hours[0] : null)) })} disabled={!hours[0]}>
                Как в понедельник
              </button>
            </div>
            <div className="field full">
              <span>Тренеры филиала</span>
              {data?.trainers.length ? (
                <div className="chips">
                  {data.trainers.map((t) => (
                    <label key={t.id} className="check chip-check">
                      <input
                        type="checkbox"
                        checked={edit.trainers.includes(t.id)}
                        onChange={(e) => setEdit({ ...edit, trainers: e.target.checked ? [...edit.trainers, t.id] : edit.trainers.filter((x) => x !== t.id) })}
                      />{' '}
                      {t.full_name}
                    </label>
                  ))}
                </div>
              ) : (
                <small>Тренеров пока нет — аккаунт тренера создаёт директор</small>
              )}
              <small>Отмеченные тренеры появятся в группах, расписании и пробниках этого филиала</small>
            </div>
            {isDirector && (
              <>
                <Field label="Ответственный управляющий" hint={data?.managers.length ? undefined : 'Сначала создайте сотрудника с ролью «Управляющий»'}>
                  <select value={edit.manager_id ?? ''} onChange={(e) => setEdit({ ...edit, manager_id: e.target.value || null })}>
                    <option value="">—</option>
                    {data?.managers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="check full">
                  <input type="checkbox" checked={edit.is_active ?? true} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> Филиал действует
                </label>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
