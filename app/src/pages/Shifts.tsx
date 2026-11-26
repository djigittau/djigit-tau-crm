import { useState } from 'react'
import { sb, ROLE_LABEL, type Role } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Empty, Modal, Field, Icon, act, fmtDateTime, fmtMinutes, TZ } from '../lib/ui'
import { loadBranches, toLocalInput, fromLocalInput } from '../lib/refs'

type Row = {
  id: string
  profile_id: string
  branch_id: string | null
  started_at: string
  ended_at: string | null
  duration_min: number | null
  note: string | null
  adjusted_at: string | null
  person: { full_name: string; role: Role } | null
  adjuster: { full_name: string } | null
  branches: { name: string } | null
}

const toLocal = toLocalInput
const fromLocal = fromLocalInput
const thisMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ }).slice(0, 7)

// Смены сотрудников: директор — все, управляющий и администратор — свои филиалы (RLS).
export default function Shifts() {
  const me = useMe()
  const [month, setMonth] = useState(thisMonth())
  const [branchF, setBranchF] = useState('')
  const [personF, setPersonF] = useState('')
  const [edit, setEdit] = useState<{ row: Row; start: string; end: string } | null>(null)

  const { data, loading, error, reload } = useLoad(async () => {
    const [y, m] = month.split('-').map(Number)
    const from = new Date(`${month}-01T00:00:00+05:00`).toISOString()
    const to = new Date(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01T00:00:00+05:00`).toISOString()
    const [shifts, branches] = await Promise.all([
      sb
        .from('shifts')
        .select('id, profile_id, branch_id, started_at, ended_at, duration_min, note, adjusted_at, person:profiles!shifts_profile_id_fkey(full_name, role), adjuster:profiles!shifts_adjusted_by_fkey(full_name), branches(name)')
        .gte('started_at', from)
        .lt('started_at', to)
        .order('started_at', { ascending: false })
        .then(must),
      loadBranches(),
    ])
    return { shifts: shifts as unknown as Row[], branches }
  }, [month])

  const rows = (data?.shifts ?? []).filter((s) => (!branchF || s.branch_id === branchF) && (!personF || s.profile_id === personF))
  const people = new Map<string, { name: string; role: Role; count: number; min: number; open: boolean }>()
  for (const s of data?.shifts ?? []) {
    if (branchF && s.branch_id !== branchF) continue
    const p = people.get(s.profile_id) ?? { name: s.person?.full_name ?? '—', role: s.person?.role ?? 'trainer', count: 0, min: 0, open: false }
    p.count++
    p.min += s.duration_min ?? 0
    if (!s.ended_at) p.open = true
    people.set(s.profile_id, p)
  }
  const canEdit = (s: Row) => me.role === 'director' || s.profile_id !== me.id

  async function save() {
    if (!edit) return
    const start = fromLocal(edit.start)
    const end = fromLocal(edit.end)
    const ok = await act(async () => {
      if (!start) throw new Error('Укажите начало смены')
      if (end && end <= start) throw new Error('Конец смены должен быть позже начала')
      must(await sb.from('shifts').update({ started_at: start, ended_at: end }).eq('id', edit.row.id))
    }, 'Смена исправлена')
    if (ok) {
      setEdit(null)
      reload()
    }
  }

  return (
    <>
      <PageHead title="Смены сотрудников" />
      <div className="toolbar">
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Месяц" style={{ width: 'auto' }} />
        {(data?.branches.length ?? 0) > 1 && (
          <select value={branchF} onChange={(e) => setBranchF(e.target.value)} aria-label="Филиал">
            <option value="">Все филиалы</option>
            {data!.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <select value={personF} onChange={(e) => setPersonF(e.target.value)} aria-label="Сотрудник">
          <option value="">Все сотрудники</option>
          {[...people].map(([id, p]) => (
            <option key={id} value={id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <State loading={loading} error={error}>
        {people.size ? (
          <>
            <section className="card flush">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Сотрудник</th>
                      <th>Роль</th>
                      <th className="num">Смен</th>
                      <th className="num">Отработано</th>
                      <th>Сейчас</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...people].map(([id, p]) => (
                      <tr key={id} className="clickable" onClick={() => setPersonF(personF === id ? '' : id)}>
                        <td>
                          <b>{p.name}</b>
                        </td>
                        <td>{ROLE_LABEL[p.role]}</td>
                        <td className="num">{p.count}</td>
                        <td className="num">{fmtMinutes(p.min)}</td>
                        <td>{p.open ? <span className="badge ok">на смене</span> : <span className="muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="card flush">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Сотрудник</th>
                      <th>Начало</th>
                      <th>Конец</th>
                      <th className="num">Длительность</th>
                      <th>Филиал</th>
                      <th>Комментарий</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.id}>
                        <td>{s.person?.full_name}</td>
                        <td>{fmtDateTime(s.started_at)}</td>
                        <td>{s.ended_at ? fmtDateTime(s.ended_at) : <span className="badge ok">идёт</span>}</td>
                        <td className="num">
                          {fmtMinutes(s.duration_min)}
                          {s.adjusted_at && (
                            <span className="badge warn" title={`Исправил ${s.adjuster?.full_name ?? '—'}, ${fmtDateTime(s.adjusted_at)}`}>
                              исправлено
                            </span>
                          )}
                        </td>
                        <td>{s.branches?.name ?? '—'}</td>
                        <td>{s.note ?? '—'}</td>
                        <td className="act">
                          {canEdit(s) && (
                            <button className="icon-btn" aria-label="Исправить время" title="Исправить время" onClick={() => setEdit({ row: s, start: toLocal(s.started_at), end: toLocal(s.ended_at) })}>
                              <Icon name="edit" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <section className="card">
            <Empty text="В этом месяце смен нет" icon="clock" />
          </section>
        )}
      </State>

      {edit && (
        <Modal
          title={`Исправить смену · ${edit.row.person?.full_name}`}
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
          <p className="muted">Исправление попадёт в журнал действий с вашим именем.</p>
          <div className="form-grid">
            <Field label="Начало">
              <input type="datetime-local" value={edit.start} onChange={(e) => setEdit({ ...edit, start: e.target.value })} />
            </Field>
            <Field label="Конец" hint="Пусто — смена ещё идёт">
              <input type="datetime-local" value={edit.end} onChange={(e) => setEdit({ ...edit, end: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}
