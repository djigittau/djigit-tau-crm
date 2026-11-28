import { useState } from 'react'
import { Link } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, fetchAll, State, PageHead, Empty, fmtDateTime, money } from '../lib/ui'
import { thisMonth, monthBounds, loadBranches } from '../lib/refs'
import { RevenueModal, ExpensesModal, ProfitModal, type MoneyData } from './MoneyDetails'

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
          <div className="kpis">
            <Kpi label="Филиалы" value={data.branches} />
            <Kpi label="Сотрудники" value={data.staff} />
            <Kpi label="Активные ученики" value={data.students} />
            <Kpi label="Активные группы" value={data.groups} />
          </div>
        )}
      </State>
      <MonthMoney />
      {data && (
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
      )}
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

// ---------- деньги: выручка, расходы по статьям, прибыль и динамика за 6 месяцев ----------
// Как в «Финансах»: выручка = поступления − возвраты; расходы = все статьи (аренда, коммунальные, доп.) + выплаченные зарплаты + медстраховка.
type Row = { amount: number; kind?: string; paid_at?: string; spent_on?: string; paid_on?: string; cat?: { name: string } | null }
const shift = (m: string, k: number) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1 + k, 1)).toISOString().slice(0, 7)
}
// Месяц записи по Алматы: у платежа — время оплаты, у расходов — дата.
const monthOf = (r: Row) => (r.paid_at ? new Date(r.paid_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Almaty' }) : (r.spent_on ?? r.paid_on ?? '')).slice(0, 7)
const mName = (m: string, long = false) => new Date(m + '-15').toLocaleDateString('ru-RU', long ? { month: 'long', year: 'numeric' } : { month: 'short' })

function MonthMoney() {
  const [month, setMonth] = useState(thisMonth())
  const [open, setOpen] = useState<'inc' | 'out' | 'profit' | null>(null)
  const { data, loading, error } = useLoad(async () => {
    const from = monthBounds(shift(month, -5))
    const to = monthBounds(month)
    const [pays, exps, sal, ins, branches] = await Promise.all([
      fetchAll((a, b) => sb.from('payments').select('amount, kind, paid_at, branch_id, method').gte('paid_at', from.t0).lt('paid_at', to.t1).order('id').range(a, b)),
      sb.from('expenses').select('amount, spent_on, branch_id, comment, cat:expense_categories(name)').gte('spent_on', from.d0).lt('spent_on', to.d1).then(must),
      // Зарплата — начисление за месяц или, если его ещё нет, расчёт % тренеров (не по дню выплаты).
      sb.rpc('salary_expense', { p_from: from.d0, p_to: to.d1 }).then(must),
      sb.from('employee_insurance').select('amount, paid_on, branch_id, profile:profiles!employee_insurance_profile_id_fkey(full_name)').gte('paid_on', from.d0).lt('paid_on', to.d1).then(must),
      loadBranches(),
    ])
    const raw = { pays, exps, sal, ins, branches } as unknown as MoneyData
    return {
      raw,
      pays: pays as Row[],
      exps: exps as unknown as Row[],
      sal: (sal as { amount: number; period: string }[]).map((x) => ({ amount: x.amount, paid_on: x.period })) as Row[],
      ins: ins as Row[],
    }
  }, [month])

  const months = [-5, -4, -3, -2, -1, 0].map((k) => shift(month, k))
  const sum = (rows: Row[], m: string) => rows.filter((r) => monthOf(r) === m).reduce((t, r) => t + Number(r.amount) * (r.kind === 'refund' ? -1 : 1), 0)
  const series = months.map((m) => (data ? { m, inc: sum(data.pays, m), out: sum(data.exps, m) + sum(data.sal, m) + sum(data.ins, m) } : { m, inc: 0, out: 0 }))
  const cur = series[5]
  const cats = new Map<string, number>()
  for (const e of data?.exps ?? []) if (monthOf(e) === month) cats.set(e.cat?.name ?? 'Прочие расходы', (cats.get(e.cat?.name ?? 'Прочие расходы') ?? 0) + Number(e.amount))
  if (data) {
    cats.set('Зарплаты (% тренеров и оклады)', sum(data.sal, month))
    cats.set('Медстраховка', sum(data.ins, month))
  }
  const catList = [...cats].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  const catMax = Math.max(1, ...catList.map(([, v]) => v))
  const top = Math.max(1, ...series.flatMap((s) => [s.inc, s.out]))

  return (
    <>
      <div className="page-head">
        <h2 style={{ margin: 0, fontSize: 18 }}>Деньги за {mName(month, true)}</h2>
        <div className="actions">
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Месяц" style={{ width: 'auto' }} />
          <Link className="btn ghost" to="/finance">
            Подробно
          </Link>
        </div>
      </div>
      <State loading={loading && !data} error={error}>
        <div className="kpis k3">
          <button className="card kpi tile" onClick={() => setOpen('inc')} disabled={!data}>
            <span>
              <i className="dot in" /> Выручка за месяц
            </span>
            <b>{money(cur.inc)}</b>
            <small className="muted">оплаты минус возвраты · подробнее ›</small>
          </button>
          <button className="card kpi tile" onClick={() => setOpen('out')} disabled={!data}>
            <span>
              <i className="dot out" /> Расходы за месяц
            </span>
            <b>{money(cur.out)}</b>
            <small className="muted">все статьи, зарплаты, медстраховка · подробнее ›</small>
          </button>
          <button className={'card kpi tile' + (cur.inc - cur.out < 0 ? ' neg' : '')} onClick={() => setOpen('profit')} disabled={!data}>
            <span>Прибыль за месяц</span>
            <b>{money(cur.inc - cur.out)}</b>
            <small className="muted">выручка − расходы · подробнее ›</small>
          </button>
        </div>
        <div className="grid-2">
          <section className="card">
            <h3>Расходы по статьям</h3>
            {catList.length ? (
              <div className="hbars">
                {catList.map(([name, v]) => (
                  <div key={name} className="hbar" title={`${name}: ${money(v)}`}>
                    <span>{name}</span>
                    <div>
                      <i style={{ width: `${(v / catMax) * 100}%` }} />
                    </div>
                    <b>{money(v)}</b>
                  </div>
                ))}
              </div>
            ) : (
              <Empty text="Расходов за месяц нет" icon="layers" />
            )}
          </section>
          <section className="card">
            <h3>Выручка и расходы · 6 месяцев</h3>
            <div className="legend">
              <span>
                <i className="dot in" /> Выручка
              </span>
              <span>
                <i className="dot out" /> Расходы
              </span>
            </div>
            <div className="gbars" role="img" aria-label="Выручка и расходы по месяцам, значения — в таблице ниже">
              {series.map((s) => (
                <div key={s.m} className={'gbar' + (s.m === month ? ' on' : '')}>
                  <div className="pair">
                    <i className="in" style={{ height: `${(Math.max(0, s.inc) / top) * 100}%` }} title={`${mName(s.m, true)} · выручка ${money(s.inc)}`} />
                    <i className="out" style={{ height: `${(s.out / top) * 100}%` }} title={`${mName(s.m, true)} · расходы ${money(s.out)}`} />
                  </div>
                  <small>{mName(s.m)}</small>
                </div>
              ))}
            </div>
            <details className="small">
              <summary className="muted">Таблица</summary>
              <table>
                <thead>
                  <tr>
                    <th>Месяц</th>
                    <th className="num">Выручка</th>
                    <th className="num">Расходы</th>
                    <th className="num">Прибыль</th>
                  </tr>
                </thead>
                <tbody>
                  {series.map((s) => (
                    <tr key={s.m}>
                      <td>{mName(s.m, true)}</td>
                      <td className="num">{money(s.inc)}</td>
                      <td className="num">{money(s.out)}</td>
                      <td className={'num' + (s.inc - s.out < 0 ? ' danger-text' : '')}>{money(s.inc - s.out)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>
        </div>
      </State>
      {data && open === 'inc' && <RevenueModal d={data.raw} m={month} onClose={() => setOpen(null)} />}
      {data && open === 'out' && <ExpensesModal d={data.raw} m={month} onClose={() => setOpen(null)} />}
      {data && open === 'profit' && <ProfitModal d={data.raw} m={month} onClose={() => setOpen(null)} />}
    </>
  )
}
