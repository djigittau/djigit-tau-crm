import { useState } from 'react'
import { sb } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Empty, Modal, Field, Icon, act, money, Contact, TZ } from '../lib/ui'
import { loadBranches, thisMonth, monthBounds, METHODS } from '../lib/refs'
import SaleModal from './SaleModal'
import { StudentModal } from './GroupsBrowse'

// Оплаты месяца: кто из занимающихся оплатил абонемент на месяц, у кого долг, кто не оплатил.
// «Оплатил месяц» = есть абонемент с началом в этом месяце (так же перенесены данные из таблицы).
type Stu = {
  id: string
  full_name: string
  branch_id: string
  branch: { name: string } | null
  parent: { full_name: string; phone: string } | null
  group_members: { group_id: string; left_at: string | null; groups: { name: string; group_trainers: { trainer_id: string; profiles: { full_name: string } | null }[] } | null }[]
}
type Sale = { id: string; student_id: string; branch_id: string; amount_due: number; valid_from: string; payments: { amount: number; kind: string; paid_at: string }[] }
type Line = {
  s: Stu
  group: Stu['group_members'][number] | undefined
  kind: 'unpaid' | 'debt' | 'paid'
  paid: number
  due: number
  debtSale: Sale | null
  last: { amount: number; month: string; day: number } | null
}

const RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const monthName = (m: string) => `${RU[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
const shift = (m: string, k: number) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1 + k, 1)).toISOString().slice(0, 7)
}
const paidOf = (x: Sale) => x.payments.reduce((t, p) => t + (p.kind === 'refund' ? -1 : 1) * Number(p.amount), 0)
const dayOf = (t: string) => Number(new Date(t).toLocaleDateString('sv-SE', { timeZone: TZ }).slice(8, 10))

// Все строки запроса, страницами по 1000 (больше сервер за раз не отдаёт).
async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>) {
  const out: T[] = []
  for (let i = 0; ; i += 1000) {
    const rows = must(await q(i, i + 999)) as T[]
    out.push(...rows)
    if (rows.length < 1000) return out
  }
}

export default function Payments() {
  const me = useMe()
  const [month, setMonth] = useState(thisMonth())
  const [tab, setTab] = useState<Line['kind']>('unpaid')
  const [f, setF] = useState({ branch: '', trainer: '', group: '', q: '' })
  const [open, setOpen] = useState<Line | null>(null)
  const [selling, setSelling] = useState<Line | null>(null)
  const [topup, setTopup] = useState<{ l: Line; amount: string; method: string; key: string } | null>(null)

  const { data, loading, error, reload } = useLoad(async () => {
    const { d1 } = monthBounds(month)
    const from = monthBounds(shift(month, -3)).d0 // история для «прошлой оплаты» и обычного дня
    const [students, sales, branches] = await Promise.all([
      all<Stu>((a, b) =>
        sb
          .from('students')
          .select('id, full_name, branch_id, branch:branches(name), parent:parents(full_name, phone), group_members(group_id, left_at, groups(name, group_trainers(trainer_id, profiles(full_name))))')
          .eq('status', 'active')
          .order('full_name')
          .range(a, b),
      ),
      all<Sale>((a, b) =>
        sb.from('sales').select('id, student_id, branch_id, amount_due, valid_from, payments(amount, kind, paid_at)').eq('status', 'active').gte('valid_from', from).lt('valid_from', d1).order('valid_from').range(a, b),
      ),
      loadBranches(),
    ])
    return { students, sales, branches }
  }, [month])

  const { d0 } = monthBounds(month)
  const lines: Line[] = (data?.students ?? []).map((s) => {
    const mine = (data?.sales ?? []).filter((x) => x.student_id === s.id)
    const cur = mine.filter((x) => x.valid_from >= d0)
    const before = mine.filter((x) => x.valid_from < d0 && paidOf(x) > 0)
    const prev = before[before.length - 1]
    const lastPay = prev?.payments.filter((p) => p.kind !== 'refund').sort((a, b) => a.paid_at.localeCompare(b.paid_at)).pop()
    const paid = cur.reduce((t, x) => t + paidOf(x), 0)
    const due = cur.reduce((t, x) => t + Number(x.amount_due), 0)
    return {
      s,
      group: s.group_members.find((m) => !m.left_at),
      kind: !cur.length ? 'unpaid' : paid < due ? 'debt' : 'paid',
      paid,
      due,
      debtSale: cur.find((x) => paidOf(x) < Number(x.amount_due)) ?? null,
      last: prev && lastPay ? { amount: Number(prev.amount_due), month: prev.valid_from.slice(0, 7), day: dayOf(lastPay.paid_at) } : null,
    }
  })

  const trainers = new Map<string, string>()
  const groups = new Map<string, string>()
  for (const l of lines) {
    for (const t of l.group?.groups?.group_trainers ?? []) trainers.set(t.trainer_id, t.profiles?.full_name ?? '—')
    if (l.group) groups.set(l.group.group_id, l.group.groups?.name ?? '—')
  }
  const filtered = lines.filter(
    (l) =>
      (!f.branch || l.s.branch_id === f.branch) &&
      (!f.trainer || l.group?.groups?.group_trainers.some((t) => t.trainer_id === f.trainer)) &&
      (!f.group || l.group?.group_id === f.group) &&
      (!f.q || [l.s.full_name, l.s.parent?.full_name, l.s.parent?.phone].join(' ').toLowerCase().includes(f.q.toLowerCase())),
  )
  const by = (k: Line['kind']) => filtered.filter((l) => l.kind === k)
  const today = thisMonth() === month ? Number(new Date().toLocaleDateString('sv-SE', { timeZone: TZ }).slice(8, 10)) : null
  const past = month < thisMonth()

  // Срок оплаты в этом месяце по обычному дню ученика.
  const term = (l: Line) => {
    if (!l.last) return <span className="muted">—</span>
    const d = l.last.day
    const badge = past ? (
      <span className="badge bad">не оплачен</span>
    ) : today == null ? null : d < today ? (
      <span className="badge bad">просрочка {today - d} дн.</span>
    ) : d === today ? (
      <span className="badge warn">сегодня</span>
    ) : (
      <span className="badge">через {d - today} дн.</span>
    )
    return (
      <>
        {d}-го {badge}
      </>
    )
  }
  const list = by(tab).sort((a, b) => (tab === 'unpaid' ? (a.last?.day ?? 99) - (b.last?.day ?? 99) : a.s.full_name.localeCompare(b.s.full_name)))
  const paidSum = by('paid').reduce((t, l) => t + l.paid, 0) + by('debt').reduce((t, l) => t + l.paid, 0)

  async function payDebt() {
    if (!topup?.l.debtSale) return
    const sale = topup.l.debtSale
    const left = Number(sale.amount_due) - paidOf(sale)
    const v = Number(topup.amount)
    const ok = await act(async () => {
      if (!(v > 0)) throw new Error('Укажите сумму')
      if (v > left) throw new Error(`Осталось доплатить ${money(left)}`)
      must(
        await sb.from('payments').insert({
          sale_id: sale.id, student_id: topup.l.s.id, parent_id: null, branch_id: sale.branch_id, amount: v, method: topup.method, received_by: me.id, idempotency_key: topup.key,
        }),
      )
    }, 'Доплата принята')
    if (ok) {
      setTopup(null)
      reload()
    }
  }

  return (
    <>
      <PageHead title="Оплаты" sub={`Кто оплатил ${monthName(month)} и кто нет`} />
      <div className="toolbar">
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Месяц" style={{ width: 'auto' }} />
        {(data?.branches.length ?? 0) > 1 && (
          <select value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} aria-label="Филиал">
            <option value="">Все филиалы</option>
            {data!.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <select value={f.trainer} onChange={(e) => setF({ ...f, trainer: e.target.value })} aria-label="Тренер">
          <option value="">Все тренеры</option>
          {[...trainers].sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => (
            <option key={id} value={id}>
              {n}
            </option>
          ))}
        </select>
        <select value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} aria-label="Группа">
          <option value="">Все группы</option>
          {[...groups].sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => (
            <option key={id} value={id}>
              {n}
            </option>
          ))}
        </select>
        <div className="search">
          <Icon name="search" />
          <input placeholder="Ученик, родитель, телефон" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Поиск" />
        </div>
      </div>
      <State loading={loading && !data} error={error}>
        <div className="kpis k3">
          <div className="card kpi">
            <span>Оплатили</span>
            <b>
              {by('paid').length} из {filtered.length}
            </b>
            <small className="muted">получено {money(paidSum)}</small>
          </div>
          <div className={'card kpi' + (by('unpaid').length ? ' neg' : '')}>
            <span>Не оплатили</span>
            <b>{by('unpaid').length}</b>
            <small className="muted">ожидается ≈ {money(by('unpaid').reduce((t, l) => t + (l.last?.amount ?? 0), 0))} (по прошлым оплатам)</small>
          </div>
          <div className="card kpi">
            <span>Долг по абонементам</span>
            <b>
              {by('debt').length} · {money(by('debt').reduce((t, l) => t + l.due - l.paid, 0))}
            </b>
            <small className="muted">оплачено не полностью</small>
          </div>
        </div>
        <div className="seg" role="tablist" style={{ margin: '12px 0' }}>
          <button className={tab === 'unpaid' ? 'on' : ''} onClick={() => setTab('unpaid')}>
            Не оплатили · {by('unpaid').length}
          </button>
          <button className={tab === 'debt' ? 'on' : ''} onClick={() => setTab('debt')}>
            Долг · {by('debt').length}
          </button>
          <button className={tab === 'paid' ? 'on' : ''} onClick={() => setTab('paid')}>
            Оплатили · {by('paid').length}
          </button>
        </div>
        <section className="card flush">
          {list.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ученик</th>
                    <th>Группа · тренер</th>
                    <th>Родитель</th>
                    <th>{tab === 'unpaid' ? 'Обычно платит' : 'Оплачено'}</th>
                    <th className="num">Прошлая оплата</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((l) => (
                    <tr key={l.s.id} className="clickable" onClick={() => setOpen(l)}>
                      <td>
                        <b>{l.s.full_name}</b>
                        <small className="muted block">{l.s.branch?.name}</small>
                      </td>
                      <td>
                        {l.group?.groups?.name ?? <span className="muted">без группы</span>}
                        <small className="muted block">{l.group?.groups?.group_trainers.map((t) => t.profiles?.full_name).join(', ')}</small>
                      </td>
                      <td>
                        {l.s.parent?.full_name ?? '—'}
                        <small className="muted block">{l.s.parent?.phone}</small>
                      </td>
                      <td>
                        {tab === 'unpaid' ? (
                          term(l)
                        ) : (
                          <>
                            {money(l.paid)} <span className="muted">/ {money(l.due)}</span>
                            {tab === 'debt' && <small className="danger-text block">долг {money(l.due - l.paid)}</small>}
                          </>
                        )}
                      </td>
                      <td className="num">
                        {l.last ? money(l.last.amount) : '—'}
                        {l.last && <small className="muted block">{monthName(l.last.month)}</small>}
                      </td>
                      <td className="act" onClick={(e) => e.stopPropagation()}>
                        <div className="row nowrap">
                          <Contact phone={l.s.parent?.phone} />
                          {tab === 'unpaid' && (
                            <button className="btn sm" onClick={() => setSelling(l)}>
                              Принять оплату
                            </button>
                          )}
                          {tab === 'debt' && l.debtSale && (
                            <button
                              className="btn sm"
                              onClick={() => setTopup({ l, amount: String(Number(l.debtSale!.amount_due) - paidOf(l.debtSale!)), method: 'kaspi', key: crypto.randomUUID() })}
                            >
                              Доплатить
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text={tab === 'unpaid' ? 'Все занимающиеся оплатили этот месяц' : tab === 'debt' ? 'Долгов нет' : 'Оплат за этот месяц пока нет'} icon="check" />
          )}
        </section>
      </State>

      {open && <StudentModal id={open.s.id} groupId={open.group?.group_id ?? ''} onClose={() => setOpen(null)} />}

      {selling && (
        <SaleModal
          studentId={selling.s.id}
          branchId={selling.s.branch_id}
          groupId={selling.group?.group_id}
          title={selling.s.full_name}
          preset={{ name: `Абонемент · ${monthName(month)}`, price: selling.last ? String(selling.last.amount) : '', validFrom: d0 }}
          onClose={() => setSelling(null)}
          onDone={() => {
            setSelling(null)
            reload()
          }}
        />
      )}

      {topup && (
        <Modal
          title={`Доплата · ${topup.l.s.full_name}`}
          onClose={() => setTopup(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setTopup(null)}>
                Отмена
              </button>
              <button className="btn" onClick={payDebt}>
                Принять {money(Number(topup.amount) || 0)}
              </button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="Сумма, ₸" hint={`Долг ${money(topup.l.due - topup.l.paid)}`}>
              <input type="number" min={1} value={topup.amount} onChange={(e) => setTopup({ ...topup, amount: e.target.value })} />
            </Field>
            <Field label="Способ оплаты">
              <select value={topup.method} onChange={(e) => setTopup({ ...topup, method: e.target.value })}>
                {Object.entries(METHODS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}
