import { sb } from '../lib/supabase'
import { useLoad, must, Modal, Empty, money, fmtDate } from '../lib/ui'
import { METHODS } from '../lib/refs'

// Подробности денег на «Главной»: выручка, расходы, прибыль за месяц со сравнением с прошлым месяцем.
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

function Compare({ label, now, before, m, good }: { label: string; now: number; before: number; m: string; good?: 'up' | 'down' }) {
  return (
    <div className="kpis k3" style={{ marginBottom: 12 }}>
      <div className="card kpi">
        <span>
          {label} · {mName(m, true)}
        </span>
        <b>{money(now)}</b>
      </div>
      <div className="card kpi">
        <span>{mName(shiftMonth(m, -1), true)}</span>
        <b>{money(before)}</b>
      </div>
      <div className="card kpi">
        <span>Разница</span>
        <b style={{ fontSize: 20 }}>
          <Delta now={now} before={before} good={good} />
        </b>
      </div>
    </div>
  )
}

const months6 = (m: string) => [-5, -4, -3, -2, -1, 0].map((k) => shiftMonth(m, k))

export function RevenueModal({ d, m, onClose }: { d: MoneyData; m: string; onClose: () => void }) {
  const prev = shiftMonth(m, -1)
  const now = monthTotals(d, m)
  const before = monthTotals(d, prev)
  const mine = d.pays.filter((p) => dayM(p.paid_at) === m)
  const paysN = mine.filter((p) => p.kind !== 'refund')
  const refunds = mine.filter((p) => p.kind === 'refund').reduce((t, p) => t + Number(p.amount), 0)
  const methods = new Map<string, number>()
  for (const p of mine) methods.set(METHODS[p.method] ?? p.method, (methods.get(METHODS[p.method] ?? p.method) ?? 0) + signed(p))
  return (
    <Modal title="Выручка" onClose={onClose}>
      <Compare label="Выручка" now={now.inc} before={before.inc} m={m} />
      <p className="muted small">
        Оплат: {paysN.length} · средняя {money(paysN.length ? paysN.reduce((t, p) => t + Number(p.amount), 0) / paysN.length : 0)}
        {refunds > 0 && ` · возвраты −${money(refunds)}`}
      </p>
      <h3>По месяцам</h3>
      <Bars rows={months6(m).map((x) => [mName(x, true), monthTotals(d, x).inc])} />
      <h3>По филиалам</h3>
      <BranchTable d={d} m={m} pick={(t) => t.inc} />
      <h3>Способы оплаты</h3>
      <Bars rows={[...methods].sort((a, b) => b[1] - a[1])} />
    </Modal>
  )
}

function BranchTable({ d, m, pick, good }: { d: MoneyData; m: string; pick: (t: ReturnType<typeof monthTotals>) => number; good?: 'up' | 'down' }) {
  const prev = shiftMonth(m, -1)
  const rows = d.branches.map((b) => ({ b, now: pick(monthTotals(d, m, b.id)), before: pick(monthTotals(d, prev, b.id)) })).filter((r) => r.now || r.before).sort((a, b) => b.now - a.now)
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Филиал</th>
            <th className="num">{mName(m)}</th>
            <th className="num">{mName(prev)}</th>
            <th className="num">Разница</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.b.id}>
              <td>{r.b.name}</td>
              <td className="num">{money(r.now)}</td>
              <td className="num">{money(r.before)}</td>
              <td className="num">
                <Delta now={r.now} before={r.before} good={good} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty text="Нет данных" icon="building" />
  )
}

type Person = { full_name: string; branch: string; sales: number; percent: number; base: number; total: number }

export function ExpensesModal({ d, m, onClose }: { d: MoneyData; m: string; onClose: () => void }) {
  const now = monthTotals(d, m)
  const before = monthTotals(d, shiftMonth(m, -1))
  // Зарплата по сотрудникам: начисления, а где их нет — расчёт, как в «Зарплатах».
  const people = useLoad(async () => {
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
  }, [m])
  const bName = (id: string) => d.branches.find((b) => b.id === id)?.name ?? '—'
  const entries = [
    ...d.exps.filter((e) => e.spent_on.slice(0, 7) === m).map((e) => ({ date: e.spent_on, what: e.cat?.name ?? 'Прочие расходы', branch: bName(e.branch_id), amount: Number(e.amount), note: e.comment })),
    ...d.ins.filter((e) => e.paid_on.slice(0, 7) === m).map((e) => ({ date: e.paid_on, what: INS, branch: bName(e.branch_id), amount: Number(e.amount), note: e.profile?.full_name ?? null })),
  ].sort((a, b) => b.date.localeCompare(a.date))
  const estimated = d.sal.some((s) => s.period.slice(0, 7) === m && s.estimated && Number(s.amount) > 0)
  return (
    <Modal title="Расходы" onClose={onClose}>
      <Compare label="Расходы" now={now.out} before={before.out} m={m} good="down" />
      <h3>По статьям</h3>
      <Bars rows={now.cats} />
      <h3>Зарплаты по сотрудникам</h3>
      {estimated && <p className="muted small">Расчёт: процент тренера от абонементов его учеников за месяц. Начислить и выплатить — в «Зарплатах».</p>}
      {people.loading ? (
        <p className="muted">Загрузка…</p>
      ) : people.data?.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Филиал</th>
                <th className="num">Абонементы учеников</th>
                <th className="num">Итого</th>
              </tr>
            </thead>
            <tbody>
              {people.data.map((p, i) => (
                <tr key={i}>
                  <td>{p.full_name}</td>
                  <td>{p.branch}</td>
                  <td className="num">
                    {p.sales ? `${money(p.sales)} × ${p.percent}%` : '—'}
                    {p.base > 0 && <small className="muted block">оклад {money(p.base)}</small>}
                  </td>
                  <td className="num">
                    <b>{money(p.total)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty text="Зарплат за месяц нет" icon="user" />
      )}
      <h3>По филиалам</h3>
      <BranchTable d={d} m={m} pick={(t) => t.out} good="down" />
      <h3>Записи расходов · {entries.length}</h3>
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
    </Modal>
  )
}

export function ProfitModal({ d, m, onClose }: { d: MoneyData; m: string; onClose: () => void }) {
  const now = monthTotals(d, m)
  const before = monthTotals(d, shiftMonth(m, -1))
  const margin = (t: { inc: number; profit: number }) => (t.inc ? `${Math.round((t.profit / t.inc) * 100)}%` : '—')
  return (
    <Modal title="Прибыль" onClose={onClose}>
      <Compare label="Прибыль" now={now.profit} before={before.profit} m={m} />
      <h3>Откуда прибыль · {mName(m, true)}</h3>
      <table>
        <tbody>
          <tr>
            <td>Выручка (оплаты − возвраты)</td>
            <td className="num ok-text">+{money(now.inc)}</td>
          </tr>
          {now.cats.map(([name, v]) => (
            <tr key={name}>
              <td>{name}</td>
              <td className="num danger-text">−{money(v)}</td>
            </tr>
          ))}
          <tr>
            <td>
              <b>Прибыль</b>
              <small className="muted block">рентабельность {margin(now)} (прибыль ÷ выручка)</small>
            </td>
            <td className={'num' + (now.profit < 0 ? ' danger-text' : '')}>
              <b>{money(now.profit)}</b>
            </td>
          </tr>
        </tbody>
      </table>
      <h3>По филиалам</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Филиал</th>
              <th className="num">Выручка</th>
              <th className="num">Расходы</th>
              <th className="num">Прибыль</th>
            </tr>
          </thead>
          <tbody>
            {d.branches
              .map((b) => ({ b, t: monthTotals(d, m, b.id) }))
              .filter((r) => r.t.inc || r.t.out)
              .sort((a, b) => b.t.profit - a.t.profit)
              .map(({ b, t }) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td className="num">{money(t.inc)}</td>
                  <td className="num">{money(t.out)}</td>
                  <td className={'num' + (t.profit < 0 ? ' danger-text' : '')}>
                    {money(t.profit)}
                    <small className="muted block">{margin(t)}</small>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <h3>По месяцам</h3>
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
    </Modal>
  )
}
