import { useState } from 'react'
import { sb } from '../lib/supabase'
import { useLoad, must, State, PageHead, money, TZ } from '../lib/ui'
import { loadBranches, loadDances } from '../lib/refs'

type Pay = { amount: number; kind: string; paid_at: string; branch_id: string; student_id: string | null; sale: { manager_id: string | null; manager: { full_name: string } | null } | null }
type Stu = { id: string; branch_id: string; dance_type_id: string | null; start_date: string | null; status: string; updated_at: string }
type Lead = { status: string; branch_id: string | null; manager_id: string | null; dance_type_id: string | null }

// Даты студии — по Алматы. Конец диапазона не включается.
const day = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: TZ })
const addDays = (s: string, n: number) => {
  const d = new Date(s + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function range(p: string, from: string, to: string) {
  const t = day(new Date())
  const [y, m] = t.split('-').map(Number)
  const q0 = `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`
  const dow = (new Date(t + 'T12:00:00Z').getUTCDay() + 6) % 7
  const r: Record<string, [string, string]> = {
    today: [t, addDays(t, 1)],
    yesterday: [addDays(t, -1), t],
    week: [addDays(t, -dow), addDays(t, 1)],
    month: [t.slice(0, 8) + '01', addDays(t, 1)],
    quarter: [q0, addDays(t, 1)],
    year: [`${y}-01-01`, addDays(t, 1)],
    custom: [from || t, addDays(to || t, 1)],
  }
  const [d0, d1] = r[p]
  return { d0, d1, t0: new Date(`${d0}T00:00:00+05:00`).toISOString(), t1: new Date(`${d1}T00:00:00+05:00`).toISOString() }
}
const PERIODS = { today: 'Сегодня', yesterday: 'Вчера', week: 'Неделя', month: 'Месяц', quarter: 'Квартал', year: 'Год', custom: 'Свой период' }
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + '%' : '—')

export default function Analytics() {
  const [p, setP] = useState('month')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [f, setF] = useState({ branch: '', manager: '', dance: '' })
  const R = range(p, custom.from, custom.to)

  const { data, loading, error } = useLoad(async () => {
    const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString()
    const [pays, students, leads, exps, sal, ins, branches, dances] = await Promise.all([
      sb.from('payments').select('amount, kind, paid_at, branch_id, student_id, sale:sales(manager_id, manager:profiles!sales_manager_id_fkey(full_name))').gte('paid_at', yearAgo < R.t0 ? yearAgo : R.t0).then(must),
      sb.from('students').select('id, branch_id, dance_type_id, start_date, status, updated_at').then(must),
      sb.from('trial_leads').select('status, branch_id, manager_id, dance_type_id').gte('created_at', R.t0).lt('created_at', R.t1).then(must),
      sb.from('expenses').select('amount, branch_id').gte('spent_on', R.d0).lt('spent_on', R.d1).then(must),
      // Зарплата — по начислению за месяцы периода (как в «Финансах»).
      sb.from('salary_accruals').select('amount:total, branch_id').gte('period', R.d0.slice(0, 7) + '-01').lt('period', R.d1).then(must),
      sb.from('employee_insurance').select('amount, branch_id').gte('paid_on', R.d0).lt('paid_on', R.d1).then(must),
      loadBranches(),
      loadDances(true),
    ])
    return {
      pays: pays as unknown as Pay[],
      students: students as Stu[],
      leads: leads as Lead[],
      costs: [...(exps as Pay[]), ...(sal as Pay[]), ...(ins as Pay[])] as { amount: number; branch_id: string }[],
      branches,
      dances,
    }
  }, [R.t0, R.t1])

  if (!data)
    return (
      <>
        <PageHead title="Аналитика" />
        <State loading={loading} error={error}>
          {null}
        </State>
      </>
    )

  const stu = new Map(data.students.map((s) => [s.id, s]))
  const okB = (b: string | null) => !f.branch || b === f.branch
  const okD = (sid: string | null) => !f.dance || stu.get(sid ?? '')?.dance_type_id === f.dance
  const okM = (x: Pay) => !f.manager || x.sale?.manager_id === f.manager
  const inR = (t: string) => t >= R.t0 && t < R.t1
  const pays = data.pays.filter((x) => okB(x.branch_id) && okD(x.student_id) && okM(x))
  const sign = (x: Pay) => (x.kind === 'refund' ? -1 : 1) * Number(x.amount)
  const per = pays.filter((x) => inR(x.paid_at))
  const revenue = per.reduce((t, x) => t + sign(x), 0)
  const checks = per.filter((x) => x.kind === 'payment')
  // Расходы не привязаны к направлению и менеджеру — при этих фильтрах прибыль не считаем, чтобы не вводить в заблуждение.
  const split = !!(f.dance || f.manager)
  const costs = data.costs.filter((c) => okB(c.branch_id)).reduce((t, c) => t + Number(c.amount), 0)

  const studs = data.students.filter((s) => okB(s.branch_id) && (!f.dance || s.dance_type_id === f.dance))
  const isNew = (s: Stu) => s.start_date && s.start_date >= R.d0 && s.start_date < R.d1
  const left = studs.filter((s) => s.status === 'left' && inR(s.updated_at))
  // Срок обучения: от даты начала до ухода (дата изменения статуса) или до сегодня.
  const months = studs.filter((s) => s.start_date).map((s) => (new Date(s.status === 'left' ? s.updated_at : Date.now()).getTime() - new Date(s.start_date!).getTime()) / (30.44 * 864e5))
  const avgMonths = months.length ? months.reduce((a, b) => a + b, 0) / months.length : 0

  const leads = data.leads.filter((l) => okB(l.branch_id) && (!f.manager || l.manager_id === f.manager) && (!f.dance || l.dance_type_id === f.dance))
  const bought = leads.filter((l) => l.status === 'bought').length

  // LTV ученика = сумма его платежей за период минус возвраты. Средний — по ученикам, которые платили.
  const ltvBy = (key: (x: Pay) => string) => {
    const m = new Map<string, Map<string, number>>()
    for (const x of per) {
      if (!x.student_id) continue
      const k = key(x)
      const inner = m.get(k) ?? new Map<string, number>()
      inner.set(x.student_id, (inner.get(x.student_id) ?? 0) + sign(x))
      m.set(k, inner)
    }
    return [...m].map(([k, v]) => ({ k, n: v.size, sum: [...v.values()].reduce((a, b) => a + b, 0) })).map((r) => ({ ...r, ltv: r.n ? r.sum / r.n : 0 })).sort((a, b) => b.ltv - a.ltv)
  }
  const all = ltvBy(() => 'all')[0]
  const bName = (id: string) => data.branches.find((b) => b.id === id)?.name ?? '—'
  const dName = (id: string | null | undefined) => data.dances.find((d) => d.id === id)?.name ?? 'Без направления'
  const managers = new Map<string, string>()
  for (const x of data.pays) if (x.sale?.manager_id) managers.set(x.sale.manager_id, x.sale.manager?.full_name ?? '—')

  // Динамика за 12 месяцев (без фильтра периода).
  const months12: string[] = []
  const now = new Date(day(new Date()) + 'T12:00:00Z')
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    months12.push(d.toISOString().slice(0, 7))
  }
  const monthOf = (t: string) => new Date(t).toLocaleDateString('sv-SE', { timeZone: TZ }).slice(0, 7)
  const revByM = months12.map((m) => pays.filter((x) => monthOf(x.paid_at) === m).reduce((t, x) => t + sign(x), 0))
  const studByM = months12.map((m) => studs.filter((s) => s.start_date && s.start_date.slice(0, 7) <= m && !(s.status === 'left' && monthOf(s.updated_at) < m)).length)

  return (
    <>
      <PageHead title="Аналитика" sub={`${R.d0.split('-').reverse().join('.')} — ${addDays(R.d1, -1).split('-').reverse().join('.')}`} />
      <div className="toolbar">
        <select value={p} onChange={(e) => setP(e.target.value)} aria-label="Период">
          {Object.entries(PERIODS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {p === 'custom' && (
          <>
            <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="С" style={{ width: 'auto' }} />
            <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="По" style={{ width: 'auto' }} />
          </>
        )}
        {data.branches.length > 1 && (
          <select value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} aria-label="Филиал">
            <option value="">Все филиалы</option>
            {data.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <select value={f.manager} onChange={(e) => setF({ ...f, manager: e.target.value })} aria-label="Менеджер">
          <option value="">Все менеджеры</option>
          {[...managers].map(([id, n]) => (
            <option key={id} value={id}>
              {n}
            </option>
          ))}
        </select>
        <select value={f.dance} onChange={(e) => setF({ ...f, dance: e.target.value })} aria-label="Направление">
          <option value="">Все направления</option>
          {data.dances.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <State loading={loading} error={error}>
        <div className="kpis">
          <Kpi l="Учеников всего" v={studs.length} />
          <Kpi l="Активных" v={studs.filter((s) => s.status === 'active').length} />
          <Kpi l="Новых за период" v={studs.filter(isNew).length} />
          <Kpi l="Ушли за период" v={left.length} />
          <Kpi l="Пробников" v={leads.length} />
          <Kpi l="Конверсия в покупку" v={pct(bought, leads.length)} />
          <Kpi l="Выручка" v={money(revenue)} />
          <Kpi l="Расходы" v={split ? '—' : money(costs)} />
          <Kpi l="Прибыль" v={split ? '—' : money(revenue - costs)} neg={!split && revenue - costs < 0} />
          <Kpi l="Средний чек" v={money(checks.length ? checks.reduce((t, x) => t + Number(x.amount), 0) / checks.length : 0)} />
          <Kpi l="Средний срок обучения" v={avgMonths ? avgMonths.toFixed(1) + ' мес.' : '—'} />
          <Kpi l="LTV ученика" v={money(all?.ltv ?? 0)} />
        </div>
        {split && <p className="muted small">Расходы и прибыль считаются по филиалу целиком: при фильтре по направлению или менеджеру они не показываются.</p>}

        <div className="grid-2">
          <Bars title="Выручка по месяцам" labels={months12} values={revByM} fmt={money} />
          <Bars title="Учеников по месяцам" labels={months12} values={studByM} fmt={(n) => String(n)} />
          <LtvTable title="LTV по филиалам" rows={ltvBy((x) => bName(x.branch_id))} />
          <LtvTable title="LTV по направлениям" rows={ltvBy((x) => dName(stu.get(x.student_id ?? '')?.dance_type_id))} />
          <LtvTable title="LTV по менеджерам" rows={ltvBy((x) => x.sale?.manager?.full_name ?? 'Без менеджера')} />
          <section className="card">
            <h3>Как считается LTV</h3>
            <p className="muted small">
              LTV ученика — сумма его оплат за выбранный период минус возвраты. Средний LTV — общая сумма, делённая на число учеников, которые платили в этот период. Учитываются
              только реальные платежи из CRM. «Ушли за период» — ученики со статусом «Ушёл», изменённым в этот период. Расходы не делятся по направлениям и менеджерам, поэтому прибыль видна только без этих фильтров.
            </p>
          </section>
        </div>
      </State>
    </>
  )
}

function Kpi({ l, v, neg }: { l: string; v: string | number; neg?: boolean }) {
  return (
    <div className={'card kpi' + (neg ? ' neg' : '')}>
      <span>{l}</span>
      <b>{v}</b>
    </div>
  )
}

function Bars({ title, labels, values, fmt }: { title: string; labels: string[]; values: number[]; fmt: (n: number) => string }) {
  const max = Math.max(1, ...values.map(Math.abs))
  return (
    <section className="card">
      <h3>{title}</h3>
      <div className="bars" role="img" aria-label={title}>
        {values.map((v, i) => (
          <div key={labels[i]} className="bar" title={`${labels[i]}: ${fmt(v)}`}>
            <i style={{ height: `${Math.max(2, (Math.abs(v) / max) * 100)}%` }} className={v < 0 ? 'neg' : ''} />
            <small>{new Date(labels[i] + '-01T12:00:00Z').toLocaleDateString('ru-RU', { month: 'short' })}</small>
          </div>
        ))}
      </div>
    </section>
  )
}

function LtvTable({ title, rows }: { title: string; rows: { k: string; n: number; sum: number; ltv: number }[] }) {
  return (
    <section className="card">
      <h3>{title}</h3>
      {rows.length ? (
        <table>
          <thead>
            <tr>
              <th />
              <th className="num">Учеников</th>
              <th className="num">Оплачено</th>
              <th className="num">LTV</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k}>
                <td>{r.k}</td>
                <td className="num">{r.n}</td>
                <td className="num">{money(r.sum)}</td>
                <td className="num">
                  <b>{money(r.ltv)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">Оплат за период нет</p>
      )}
    </section>
  )
}
