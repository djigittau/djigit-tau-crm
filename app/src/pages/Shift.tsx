import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Empty, Icon, act, fmtDateTime, fmtMinutes } from '../lib/ui'

type ShiftRow = {
  id: string
  started_at: string
  ended_at: string | null
  duration_min: number | null
  note: string | null
  adjusted_at: string | null
  branches: { name: string } | null
}

// Начало и конец смены — через серверные функции: вторую смену база открыть не даст.
export default function Shift() {
  const me = useMe()
  const [branch, setBranch] = useState('')
  const [note, setNote] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const { data, loading, error, reload } = useLoad(async () => {
    const [shifts, branches] = await Promise.all([
      sb.from('shifts').select('id, started_at, ended_at, duration_min, note, adjusted_at, branches(name)').eq('profile_id', me.id).order('started_at', { ascending: false }).limit(60).then(must),
      sb.from('employee_branches').select('branch_id, branches(name)').eq('profile_id', me.id).then(must),
    ])
    return { shifts: shifts as unknown as ShiftRow[], branches: branches as unknown as { branch_id: string; branches: { name: string } | null }[] }
  }, [me.id])

  const open = data?.shifts.find((s) => !s.ended_at)
  const done = data?.shifts.filter((s) => s.ended_at) ?? []
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
  const monthMin = done.filter((s) => new Date(s.started_at).getTime() >= monthStart).reduce((t, s) => t + (s.duration_min ?? 0), 0)

  return (
    <>
      <PageHead title="Смена" sub={`В этом месяце: ${fmtMinutes(monthMin)}`} />
      <State loading={loading} error={error}>
        <section className={'card shift-card' + (open ? ' on' : '')}>
          {open ? (
            <>
              <div>
                <span className="badge ok">Смена идёт</span>
                <h2>{fmtMinutes(Math.max(0, Math.round((now - new Date(open.started_at).getTime()) / 60000)))}</h2>
                <p className="muted">
                  с {fmtDateTime(open.started_at)}
                  {open.branches && ` · ${open.branches.name}`}
                </p>
              </div>
              <form
                className="row"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (await act(async () => must(await sb.rpc('end_shift', { p_note: note })), 'Смена завершена')) {
                    setNote('')
                    reload()
                  }
                }}
              >
                <input placeholder="Комментарий к смене (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="btn danger">
                  <Icon name="stop" /> Завершить смену
                </button>
              </form>
            </>
          ) : (
            <>
              <div>
                <span className="badge">Смена не начата</span>
                <h2>Начните смену, когда пришли на работу</h2>
              </div>
              <div className="row">
                {(data?.branches.length ?? 0) > 1 && (
                  <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Филиал">
                    <option value="">Филиал…</option>
                    {data!.branches.map((b) => (
                      <option key={b.branch_id} value={b.branch_id}>
                        {b.branches?.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  className="btn"
                  onClick={async () => {
                    if ((data?.branches.length ?? 0) > 1 && !branch) return act(async () => { throw new Error('Выберите филиал') })
                    if (await act(async () => must(await sb.rpc('start_shift', { p_branch: branch || null })), 'Смена начата')) reload()
                  }}
                >
                  <Icon name="play" /> Начать смену
                </button>
              </div>
            </>
          )}
        </section>

        <section className="card">
          <h3>История смен</h3>
          {done.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Начало</th>
                    <th>Конец</th>
                    <th className="num">Длительность</th>
                    <th>Филиал</th>
                    <th>Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {done.map((s) => (
                    <tr key={s.id}>
                      <td>{fmtDateTime(s.started_at)}</td>
                      <td>{fmtDateTime(s.ended_at)}</td>
                      <td className="num">
                        {fmtMinutes(s.duration_min)}
                        {s.adjusted_at && <span className="badge warn" title={'Время исправлено ' + fmtDateTime(s.adjusted_at)}>исправлено</span>}
                      </td>
                      <td>{s.branches?.name ?? '—'}</td>
                      <td>{s.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="Завершённых смен пока нет" icon="clock" />
          )}
        </section>
      </State>
    </>
  )
}
