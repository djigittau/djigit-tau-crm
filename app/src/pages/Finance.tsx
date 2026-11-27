import { useState } from 'react'
import { sb } from '../lib/supabase'
import { useLoad, must, State, PageHead, Empty, money } from '../lib/ui'
import { loadBranches, thisMonth, monthBounds } from '../lib/refs'

type Line = { branch_id: string; amount: number }

// Финансы месяца по реальным операциям: поступления − возвраты − расходы − начисленные зарплаты − медстраховка.
// Зарплата учитывается по начислению за месяц («Зарплаты» → «Рассчитать»), медстраховка — по дате оплаты полиса.
export default function Finance() {
  const [month, setMonth] = useState(thisMonth())
  const { data, loading, error } = useLoad(async () => {
    const { d0, d1, t0, t1 } = monthBounds(month)
    const [pays, exps, sal, ins, branches] = await Promise.all([
      sb.from('payments').select('branch_id, amount, kind, purpose').gte('paid_at', t0).lt('paid_at', t1).then(must),
      sb.from('expenses').select('branch_id, amount, cat:expense_categories(name)').gte('spent_on', d0).lt('spent_on', d1).then(must),
      sb.from('salary_accruals').select('branch_id, amount:total').eq('period', d0).then(must),
      sb.from('employee_insurance').select('branch_id, amount').gte('paid_on', d0).lt('paid_on', d1).then(must),
      loadBranches(),
    ])
    return {
      pays: pays as unknown as (Line & { kind: string; purpose: string })[],
      exps: exps as unknown as (Line & { cat: { name: string } | null })[],
      sal: sal as Line[],
      ins: ins as Line[],
      branches,
    }
  }, [month])

  const sum = (l: Line[], b?: string) => l.filter((x) => !b || x.branch_id === b).reduce((t, x) => t + Number(x.amount), 0)
  const row = (b?: string) => {
    if (!data) return null
    const income = sum(data.pays.filter((p) => p.kind === 'payment'), b)
    const refunds = sum(data.pays.filter((p) => p.kind === 'refund'), b)
    const expenses = sum(data.exps, b)
    const salaries = sum(data.sal, b)
    const insurance = sum(data.ins, b)
    return { income, refunds, expenses, salaries, insurance, profit: income - refunds - expenses - salaries - insurance }
  }
  const all = row()
  const byCat = new Map<string, number>()
  for (const e of data?.exps ?? []) byCat.set(e.cat?.name ?? '—', (byCat.get(e.cat?.name ?? '—') ?? 0) + Number(e.amount))
  const empty = all && !all.income && !all.expenses && !all.salaries && !all.insurance && !all.refunds

  return (
    <>
      <PageHead title="Финансы" sub="Поступления и расходы месяца по реальным операциям" />
      <div className="toolbar">
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Месяц" style={{ width: 'auto' }} />
      </div>
      <State loading={loading} error={error}>
        {all && !empty ? (
          <>
            <div className="kpis">
              <div className="card kpi">
                <span>Поступления</span>
                <b>{money(all.income)}</b>
              </div>
              <div className="card kpi">
                <span>Расходы всего</span>
                <b>{money(all.refunds + all.expenses + all.salaries + all.insurance)}</b>
              </div>
              <div className={'card kpi' + (all.profit < 0 ? ' neg' : '')}>
                <span>Прибыль</span>
                <b>{money(all.profit)}</b>
              </div>
            </div>
            <div className="grid-2">
              <section className="card">
                <h3>Расходы по статьям</h3>
                <table>
                  <tbody>
                    <tr>
                      <td>Зарплаты (начислено)</td>
                      <td className="num">{money(all.salaries)}</td>
                    </tr>
                    <tr>
                      <td>Медицинская страховка</td>
                      <td className="num">{money(all.insurance)}</td>
                    </tr>
                    {all.refunds > 0 && (
                      <tr>
                        <td>Возвраты клиентам</td>
                        <td className="num">{money(all.refunds)}</td>
                      </tr>
                    )}
                    {[...byCat].sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                      <tr key={k}>
                        <td>{k}</td>
                        <td className="num">{money(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              {(data?.branches.length ?? 0) > 1 && (
                <section className="card">
                  <h3>По филиалам</h3>
                  <table>
                    <thead>
                      <tr>
                        <th />
                        <th className="num">Поступления</th>
                        <th className="num">Расходы</th>
                        <th className="num">Прибыль</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data!.branches.map((b) => {
                        const r = row(b.id)!
                        return (
                          <tr key={b.id}>
                            <td>{b.name}</td>
                            <td className="num">{money(r.income)}</td>
                            <td className="num">{money(r.refunds + r.expenses + r.salaries + r.insurance)}</td>
                            <td className={'num' + (r.profit < 0 ? ' danger-text' : '')}>{money(r.profit)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </section>
              )}
            </div>
          </>
        ) : (
          <section className="card">
            <Empty text="За этот месяц операций нет" icon="layers" />
          </section>
        )}
      </State>
    </>
  )
}
