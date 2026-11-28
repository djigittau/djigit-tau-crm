import { sb } from '../lib/supabase'
import { useLoad, must, fetchAll, Empty, money, fmtDate } from '../lib/ui'
import { METHODS, monthBounds, loadBranches } from '../lib/refs'

// Деньги: выручка, расходы, прибыль за месяц; при выборе второго месяца — сравнение с ним.
export type Pay = { amount: number; kind: string; paid_at: string; branch_id: string; method: string }
export type Exp = { amount: number; spent_on: string; branch_id: string; comment: string | null; cat: { name: string } | null }
export type Sal = { amount: number; period: string; branch_id: string; estimated: boolean }
export type Ins = { amount: number; paid_on: string; branch_id: string; profile: { full_name: string } | null }
export type MoneyData = { pays: Pay[]; exps: Exp[]; sal: Sal[]; ins: Ins[]; branches: { id: string; name: string }[] }

export const shiftMonth = (m: string, k: number) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1 + k, 1)).toISOString().slice(0, 7)
}
export const mName = (m: string, long = false) => new Date(m + '-15').toLocaleDateString('ru-RU', long ? { month: 'long', year: 'numeric' } : { month: 'short' })
const dayM = (t: string) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Asia/Almaty' }).slice(0, 7)
const signed = (p: Pay) => Number(p.amount) * (p.kind === 'refund' ? -1 : 1)
const SAL = 'Зарплаты (% тренеров и оклады)'
const INS = 'Медстраховка'

// Данные с первого дня месяца m0 по конец месяца m1 (зарплата — начисление или расчёт, RPC salary_expense).
export async function loadMoney(m0: string, m1: string): Promise<MoneyData> {
  const from = monthBounds(m0)
  const to = monthBounds(m1)
  const [pays, exps, sal, ins, branches] = await Promise.all([
    fetchAll((a, b) => sb.from('payments').select('amount, kind, paid_at, branch_id, method').gte('paid_at', from.t0).lt('paid_at', to.t1).order('id').range(a, b)),
    fetchAll((a, b) => sb.from('expenses').select('amount, spent_on, branch_id, comment, cat:expense_categories(name)').gte('spent_on', from.d0).lt('spent_on', to.d1).order('id').range(a, b)),
    sb.rpc('salary_expense', { p_from: from.d0, p_to: to.d1 }).then(must),
    sb.from('employee_insurance').select('amount, paid_on, branch_id, profile:profiles!employee_insurance_profile_id_fkey(full_name)').gte('paid_on', from.d0).lt('paid_on', to.d1).then(must),
    loadBranches(),
  ])
  return { pays, exps, sal, ins, branches } as unknown as MoneyData
}

// Суммы месяца: выручка и расходы по статьям, по филиалу или по всем.
export function monthTotals(d: MoneyData, m: string, branch?: string) {
  const b = <T extends { branch_id: string }>(r: T) => !branch || r.branch_id === branch
  const inc = d.pays.filter((p) => b(p) && dayM(p.paid_at) === m).reduce((t, p) => t + signed(p), 0)
  const cats = new Map<string, number>()
  for (const e of d.exps) if (b(e) && e.spent_on.slice(0, 7) === m) cats.set(e.cat?.name ?? 'Прочие расходы', (cats.get(e.cat?.name ?? 'Прочие расходы') ?? 0) + Number(e.amount))
  const sal = d.sal.filter((s) => b(s) && s.period.slice(0, 7) === m).reduce((t, s) => t + Number(s.amount), 0)
  const ins = d.ins.filter((s) => b(s) && s.paid_on.slice(0, 7) === m).reduce((t, s) => t + Number(s.amount), 0)
  if (sal) cats.set(SAL, sal)
  if (ins) cats.set(INS, ins)
  const out = [...cats.values()].reduce((t, v) => t + v, 0)
  return { inc, out, profit: inc - out, cats: [...cats].sort((a, b) => b[1] - a[1]) }
}
type Totals = ReturnType<typeof monthTotals>

const pct = (a: number, b: number) => (b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / Math.abs(b)) * 100)}%` : '—')
function Delta({ now, before, good = 'up' }: { now: number; before: number; good?: 'up' | 'down' }) {
  const d = now - before
  if (!before && !now) return <span className="muted">—</span>
  const ok = good === 'up' ? d >= 0 : d <= 0
  return (
    <span className={ok ? 'ok-text' : 'danger-text'}>
      {d >= 0 ? '+' : '−'}
      {money(Math.abs(d))} ({pct(now, before)})
    </span>
  )
}

function Bars({ rows }: { rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map(([, v]) => Math.abs(v)))
  return rows.length ? (
    <div className="hbars">
      {rows.map(([name, v]) => (
        <div key={name} className="hbar" title={`${name}: ${money(v)}`}>
          <span>{name}</span>
          <div>
            <i style={{ width: `${(Math.max(0, v) / max) * 100}%` }} />
          </div>
          <b>{money(v)}</b>
        </div>
      ))}
    </div>
  ) : (
    <Empty text="Нет данных" icon="layers" />
  )
}

// Итог месяца; если выбран второй месяц — он и разница рядом.
function Head({ label, d, m, cmp, pick, good }: { label: string; d: MoneyData; m: string; cmp: string | null; pick: (t: Totals) => number; good?: 'up' | 'down' }) {
  const now = pick(monthTotals(d, m))
  const before = cmp ? pick(monthTotals(d, cmp)) : 0
  return (
    <div className={'kpis' + (cmp ? ' k3' : '')} style={{ marginBottom: 12 }}>
      <div className="card kpi">
        <span>
          {label} · {mName(m, true)}
        </span>
        <b>{money(now)}</b>
      </div>
      {cmp && (
        <>
          <div className="card kpi">
            <span>
              {label} · {mName(cmp, true)}
            </span>
            <b>{money(before)}</b>
          </div>
          <div className="card kpi">
            <span>Разница</span>
            <b style={{ fontSize: 20 }}>
              <Delta now={now} before={before} good={good} />
            </b>
          </div>
        </>
      )}
    </div>
  )
}

// Таблица «строка × месяц (× второй месяц и разница)».
function CmpTable({ title, rows, m, cmp, good }: { title: string; rows: { name: string; now: number; before: number; sub?: string }[]; m: string; cmp: string | null; good?: 'up' | 'down' }) {
  const list = rows.filter((r) => r.now || (cmp && r.before)).sort((a, b) => b.now - a.now)
  if (!list.length) return <Empty text="Нет данных" icon="layers" />
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{title}</th>
            <th className="num">{mName(m, true)}</th>
            {cmp && <th className="num">{mName(cmp, true)}</th>}
            {cmp && <th className="num">Разница</th>}
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.name}>
              <td>
                {r.name}
                {r.sub && <small className="muted block">{r.sub}</small>}
              </td>
              <td className="num">{money(r.now)}</td>
              {cmp && <td className="num">{money(r.before)}</td>}
              {cmp && (
                <td className="num">
                  <Delta now={r.now} before={r.before} good={good} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const months6 = (m: string) => [-5, -4, -3, -2, -1, 0].map((k) => shiftMonth(m, k))
const byBranch = (d: MoneyData, m: string, cmp: string | null, pick: (t: Totals) => number) =>
  d.branches.map((b) => ({ name: b.name, now: pick(monthTotals(d, m, b.id)), before: cmp ? pick(monthTotals(d, cmp, b.id)) : 0 }))

type P = { d: MoneyData; m: string; cmp: string | null }

export function RevenueDetails({ d, m, cmp }: P) {
  const methods = (x: string) => {
    const r = new Map<string, number>()
    for (const p of d.pays.filter((p) => dayM(p.paid_at) === x)) r.set(METHODS[p.method] ?? p.method, (r.get(METHODS[p.method] ?? p.method) ?? 0) + signed(p))
    return r
  }
  const stat = (x: string) => {
    const mine = d.pays.filter((p) => dayM(p.paid_at) === x)
    const n = mine.filter((p) => p.kind !== 'refund')
    return { n: n.length, avg: n.length ? n.reduce((t, p) => t + Number(p.amount), 0) / n.length : 0, ref: mine.filter((p) => p.kind === 'refund').reduce((t, p) => t + Number(p.amount), 0) }
  }
  const a = stat(m)
  const b = cmp ? stat(cmp) : null
  const mA = methods(m)
  const mB = cmp ? methods(cmp) : new Map<string, number>()
  return (
    <>
      <Head label="Выручка" d={d} m={m} cmp={cmp} pick={(t) => t.inc} />
      <p className="muted small">
        {mName(m, true)}: оплат {a.n} · средняя {money(a.avg)}
        {a.ref > 0 && ` · возвраты −${money(a.ref)}`}
        {b && cmp && (
          <>
            <br />
            {mName(cmp, true)}: оплат {b.n} · средняя {money(b.avg)}
            {b.ref > 0 && ` · возвраты −${money(b.ref)}`}
          </>
        )}
      </p>
      <h3>По филиалам</h3>
      <CmpTable title="Филиал" rows={byBranch(d, m, cmp, (t) => t.inc)} m={m} cmp={cmp} />
      <h3>Способы оплаты</h3>
      <CmpTable title="Способ" rows={[...new Set([...mA.keys(), ...mB.keys()])].map((k) => ({ name: k, now: mA.get(k) ?? 0, before: mB.get(k) ?? 0 }))} m={m} cmp={cmp} />
      <h3>По месяцам · последние полгода</h3>
      <Bars rows={months6(m).map((x) => [mName(x, true), monthTotals(d, x).inc])} />
    </>
  )
}

type Person = { full_name: string; branch: string; sales: number; percent: number; base: number; total: number }

// Зарплата по сотрудникам за месяц: начисления, а где их нет — расчёт, как в «Зарплатах».
function usePeople(d: MoneyData, m: string | null) {
  return useLoad(async () => {
    if (!m) return [] as Person[]
    const rows = d.sal.filter((x) => x.period.slice(0, 7) === m && Number(x.amount) > 0)
    const parts = await Promise.all(
      rows.map(async (s): Promise<Person[]> => {
        const branch = d.branches.find((b) => b.id === s.branch_id)?.name ?? ''
        if (s.estimated) {
          const r = must(await sb.rpc('salary_preview', { p_period: `${m}-01`, p_branch: s.branch_id })) as { full_name: string; sales_amount: number; percent: number; base_amount: number; total: number }[]
          return r.map((x) => ({ full_name: x.full_name, branch, sales: Number(x.sales_amount), percent: Number(x.percent), base: Number(x.base_amount), total: Number(x.total) }))
        }
        const r = must(await sb.from('salary_accruals').select('total, sales_amount, percent, base_amount, profiles(full_name)').eq('branch_id', s.branch_id).eq('period', `${m}-01`)) as unknown as { total: number; sales_amount: number; percent: number; base_amount: number; profiles: { full_name: string } | null }[]
        return r.map((x) => ({ full_name: x.profiles?.full_name ?? '—', branch, sales: Number(x.sales_amount), percent: Number(x.percent), base: Number(x.base_amount), total: Number(x.total) }))
      }),
    )
    return parts.flat().filter((p) => p.total).sort((a, b) => b.total - a.total)
  }, [d, m])
}

export function ExpensesDetails({ d, m, cmp }: P) {
  const people = usePeople(d, m)
  const peopleB = usePeople(d, cmp)
  const bName = (id: string) => d.branches.find((b) => b.id === id)?.name ?? '—'
  const now = monthTotals(d, m)
  const before = cmp ? monthTotals(d, cmp) : null
  const entries = [
    ...d.exps.filter((e) => e.spent_on.slice(0, 7) === m).map((e) => ({ date: e.spent_on, what: e.cat?.name ?? 'Прочие расходы', branch: bName(e.branch_id), amount: Number(e.amount), note: e.comment })),
    ...d.ins.filter((e) => e.paid_on.slice(0, 7) === m).map((e) => ({ date: e.paid_on, what: INS, branch: bName(e.branch_id), amount: Number(e.amount), note: e.profile?.full_name ?? null })),
  ].sort((a, b) => b.date.localeCompare(a.date))
  const estimated = d.sal.some((s) => s.period.slice(0, 7) === m && s.estimated && Number(s.amount) > 0)
  const keyOf = (p: Person) => `${p.full_name} · ${p.branch}`
  const prevBy = new Map((cmp ? peopleB.data ?? [] : []).map((p) => [keyOf(p), p.total]))
  return (
    <>
      <Head label="Расходы" d={d} m={m} cmp={cmp} pick={(t) => t.out} good="down" />
      <h3>По статьям</h3>
      <CmpTable
        title="Статья"
        rows={[...new Set([...now.cats.map(([k]) => k), ...(before?.cats ?? []).map(([k]) => k)])].map((k) => ({
          name: k,
          now: now.cats.find(([x]) => x === k)?.[1] ?? 0,
          before: before?.cats.find(([x]) => x === k)?.[1] ?? 0,
        }))}
        m={m}
        cmp={cmp}
        good="down"
      />
      <h3>Зарплаты по сотрудникам</h3>
      {estimated && <p className="muted small">Расчёт: процент тренера от абонементов его учеников за месяц. Начислить и выплатить — в «Зарплатах».</p>}
      {people.loading || (cmp && peopleB.loading) ? (
        <p className="muted">Загрузка…</p>
      ) : people.data?.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Филиал</th>
                <th className="num">Абонементы учеников</th>
                <th className="num">{mName(m, true)}</th>
                {cmp && <th className="num">{mName(cmp, true)}</th>}
              </tr>
            </thead>
            <tbody>
              {people.data.map((p) => (
                <tr key={keyOf(p)}>
                  <td>{p.full_name}</td>
                  <td>{p.branch}</td>
                  <td className="num">
                    {p.sales ? `${money(p.sales)} × ${p.percent}%` : '—'}
                    {p.base > 0 && <small className="muted block">оклад {money(p.base)}</small>}
                  </td>
                  <td className="num">
                    <b>{money(p.total)}</b>
                  </td>
                  {cmp && <td className="num">{money(prevBy.get(keyOf(p)) ?? 0)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty text="Зарплат за месяц нет" icon="user" />
      )}
      <h3>По филиалам</h3>
      <CmpTable title="Филиал" rows={byBranch(d, m, cmp, (t) => t.out)} m={m} cmp={cmp} good="down" />
      <h3>Записи расходов · {mName(m, true)} · {entries.length}</h3>
      {entries.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Статья</th>
                <th>Филиал</th>
                <th className="num">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i}>
                  <td>{fmtDate(e.date)}</td>
                  <td>
                    {e.what}
                    {e.note && <small className="muted block">{e.note}</small>}
                  </td>
                  <td>{e.branch}</td>
                  <td className="num">{money(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">Аренда, коммунальные, доп. расходы и медстраховка за месяц не внесены.</p>
      )}
    </>
  )
}

export function ProfitDetails({ d, m, cmp }: P) {
  const now = monthTotals(d, m)
  const before = cmp ? monthTotals(d, cmp) : null
  const margin = (t: { inc: number; profit: number }) => (t.inc ? `${Math.round((t.profit / t.inc) * 100)}%` : '—')
  const cats = [...new Set([...now.cats.map(([k]) => k), ...(before?.cats ?? []).map(([k]) => k)])]
  const v = (t: Totals | null, k: string) => t?.cats.find(([x]) => x === k)?.[1] ?? 0
  return (
    <>
      <Head label="Прибыль" d={d} m={m} cmp={cmp} pick={(t) => t.profit} />
      <h3>Откуда прибыль</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th />
              <th className="num">{mName(m, true)}</th>
              {cmp && <th className="num">{mName(cmp, true)}</th>}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Выручка (оплаты − возвраты)</td>
              <td className="num ok-text">+{money(now.inc)}</td>
              {before && <td className="num ok-text">+{money(before.inc)}</td>}
            </tr>
            {cats.map((k) => (
              <tr key={k}>
                <td>{k}</td>
                <td className="num danger-text">−{money(v(now, k))}</td>
                {before && <td className="num danger-text">−{money(v(before, k))}</td>}
              </tr>
            ))}
            <tr>
              <td>
                <b>Прибыль</b>
                <small className="muted block">рентабельность = прибыль ÷ выручка</small>
              </td>
              <td className={'num' + (now.profit < 0 ? ' danger-text' : '')}>
                <b>{money(now.profit)}</b>
                <small className="muted block">{margin(now)}</small>
              </td>
              {before && (
                <td className={'num' + (before.profit < 0 ? ' danger-text' : '')}>
                  <b>{money(before.profit)}</b>
                  <small className="muted block">{margin(before)}</small>
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>
      <h3>По филиалам</h3>
      <CmpTable
        title="Филиал"
        rows={d.branches.map((b) => {
          const t = monthTotals(d, m, b.id)
          return { name: b.name, now: t.profit, before: cmp ? monthTotals(d, cmp, b.id).profit : 0, sub: `выручка ${money(t.inc)} · расходы ${money(t.out)}` }
        })}
        m={m}
        cmp={cmp}
      />
      <h3>По месяцам · последние полгода</h3>
      <div className="table-wrap">
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
            {months6(m).map((x) => {
              const t = monthTotals(d, x)
              return (
                <tr key={x}>
                  <td>{mName(x, true)}</td>
                  <td className="num">{money(t.inc)}</td>
                  <td className="num">{money(t.out)}</td>
                  <td className={'num' + (t.profit < 0 ? ' danger-text' : '')}>
                    {money(t.profit)}
                    <small className="muted block">{margin(t)}</small>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
