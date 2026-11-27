import { sb } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { Link } from 'react-router-dom'
import { useLoad, must, State, PageHead, Empty, fmtDateTime, money } from '../lib/ui'
import { thisMonth, monthBounds } from '../lib/refs'

type Money = { amount: number; kind?: string }
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
    const sum = (rows: Money[], kind?: string) => rows.filter((r) => !kind || r.kind === kind).reduce((t, r) => t + Number(r.amount), 0)
    const { d0, d1, t0, t1 } = monthBounds(thisMonth())
    const [branches, staff, students, groups, open, pays, exps, sal, ins] = await Promise.all([
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
      // Деньги месяца — как в «Финансах»: поступления − возвраты − расходы − выплаченные зарплаты − медстраховка.
      sb.from('payments').select('amount, kind').gte('paid_at', t0).lt('paid_at', t1).then(must),
      sb.from('expenses').select('amount').gte('spent_on', d0).lt('spent_on', d1).then(must),
      sb.from('salary_payments').select('amount').gte('paid_on', d0).lt('paid_on', d1).then(must),
      sb.from('employee_insurance').select('amount').gte('paid_on', d0).lt('paid_on', d1).then(must),
    ])
    const revenue = sum(pays as Money[], 'payment') - sum(pays as Money[], 'refund')
    const costs = sum(exps as Money[]) + sum(sal as Money[]) + sum(ins as Money[])
    return { branches, staff, students, groups, open: (open ?? []) as unknown as OpenShift[], revenue, costs, profit: revenue - costs }
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
            <div className="kpis">
              <Link to="/finance" className="card kpi link-card">
                <span>Расходы общие · {new Date().toLocaleDateString('ru-RU', { month: 'long' })}</span>
                <b>{money(data.costs)}</b>
                <small className="muted">расходы, зарплаты, медстраховка</small>
              </Link>
              <Link to="/finance" className={'card kpi link-card' + (data.profit < 0 ? ' neg' : '')}>
                <span>Прибыль · {new Date().toLocaleDateString('ru-RU', { month: 'long' })}</span>
                <b>{money(data.profit)}</b>
                <small className="muted">выручка {money(data.revenue)}</small>
              </Link>
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
