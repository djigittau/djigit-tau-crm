import { sb } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Empty, fmtDateTime } from '../lib/ui'

type OpenShift = { id: string; started_at: string; profiles: { full_name: string } | null; branches: { name: string } | null }

// Главная директора и управляющего: только реальные данные из базы, в пределах видимых филиалов.
export default function Home() {
  const me = useMe()
  const { data, loading, error } = useLoad(async () => {
    const count = async (t: string, f?: (q: any) => any) => {
      let q = sb.from(t).select('*', { count: 'exact', head: true })
      if (f) q = f(q)
      const r = await q
      if (r.error) throw r.error
      return r.count ?? 0
    }
    const [branches, staff, students, groups, open] = await Promise.all([
      count('branches', (q) => q.eq('is_active', true)),
      count('profiles', (q) => q.eq('status', 'active')),
      count('students', (q) => q.eq('status', 'active')),
      count('groups', (q) => q.eq('status', 'active')),
      sb
        .from('shifts')
        .select('id, started_at, profiles!shifts_profile_id_fkey(full_name), branches(name)')
        .is('ended_at', null)
        .order('started_at')
        .then(must),
    ])
    return { branches, staff, students, groups, open: (open ?? []) as unknown as OpenShift[] }
  }, [])

  return (
    <>
      <PageHead title={`Здравствуйте, ${me.full_name.split(' ')[0]}`} sub={new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })} />
      <State loading={loading} error={error}>
        {data && (
          <>
            <div className="kpis">
              <Kpi label="Филиалы" value={data.branches} />
              <Kpi label="Сотрудники" value={data.staff} />
              <Kpi label="Активные ученики" value={data.students} />
              <Kpi label="Активные группы" value={data.groups} />
            </div>
            <section className="card">
              <h3>Сейчас на смене · {data.open.length}</h3>
              {data.open.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Сотрудник</th>
                      <th>Филиал</th>
                      <th>Начало</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.open.map((s) => (
                      <tr key={s.id}>
                        <td>{s.profiles?.full_name}</td>
                        <td>{s.branches?.name ?? '—'}</td>
                        <td>{fmtDateTime(s.started_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty text="Никто не на смене" icon="clock" />
              )}
            </section>
          </>
        )}
      </State>
    </>
  )
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="card kpi">
      <span>{label}</span>
      <b>{value.toLocaleString('ru-RU')}</b>
    </div>
  )
}
