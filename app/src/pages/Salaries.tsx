import { useState } from 'react'
import { sb, ROLE_LABEL, type Role } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Empty, Modal, Field, Icon, act, money, toast } from '../lib/ui'
import { loadBranches, loadStaff, METHODS, thisMonth, monthBounds, today } from '../lib/refs'

type Acc = {
  id: string
  profile_id: string
  branch_id: string
  base_amount: number
  lessons_count: number
  lesson_rate: number
  lessons_amount: number
  bonus_amount: number
  fine_amount: number
  total: number
  status: 'draft' | 'approved' | 'paid'
  person: { full_name: string; role: Role } | null
  branch: { name: string } | null
  salary_payments: { amount: number }[]
}
const STATUS = { draft: 'Черновик', approved: 'Утверждено', paid: 'Выплачено' }

// Зарплата = Оклад + Занятия (по расписанию, без отменённых) × Ставка + Бонусы − Штрафы. Считает база (accrue_salaries).
export default function Salaries() {
  const me = useMe()
  const boss = me.role === 'director' || me.role === 'manager'
  const [month, setMonth] = useState(thisMonth())
  const [branchF, setBranchF] = useState('')
  const [pay, setPay] = useState<{ acc: Acc; amount: string; method: string; date: string; key: string } | null>(null)
  const [bonus, setBonus] = useState<{ profile: string; branch: string; amount: string; reason: string } | null>(null)

  const { data, loading, error, reload } = useLoad(async () => {
    const [acc, branches, staff] = await Promise.all([
      sb
        .from('salary_accruals')
        .select('*, person:profiles!salary_accruals_profile_id_fkey(full_name, role), branch:branches(name), salary_payments(amount)')
        .eq('period', monthBounds(month).d0)
        .order('total', { ascending: false })
        .then(must),
      loadBranches(),
      loadStaff(),
    ])
    return { acc: acc as unknown as Acc[], branches, staff }
  }, [month])

  const list = (data?.acc ?? []).filter((a) => !branchF || a.branch_id === branchF)
  const paidOf = (a: Acc) => a.salary_payments.reduce((t, p) => t + Number(p.amount), 0)
  const sum = (f: (a: Acc) => number) => list.reduce((t, a) => t + f(a), 0)

  async function calculate() {
    const ids = branchF ? [branchF] : (data?.branches ?? []).map((b) => b.id)
    let n = 0
    const ok = await act(async () => {
      for (const b of ids) n += must(await sb.rpc('accrue_salaries', { p_period: monthBounds(month).d0, p_branch: b })) as number
    })
    if (ok) {
      toast(n ? `Пересчитано начислений: ${n}` : 'Нет черновиков для пересчёта')
      reload()
    }
  }

  async function setStatus(a: Acc, status: Acc['status']) {
    if (await act(async () => must(await sb.from('salary_accruals').update({ status }).eq('id', a.id)), status === 'approved' ? 'Утверждено' : 'Сохранено')) reload()
  }

  async function savePay() {
    if (!pay) return
    const ok = await act(async () => {
      const amount = Number(pay.amount)
      if (!(amount > 0)) throw new Error('Сумма должна быть больше нуля')
      must(
        await sb.from('salary_payments').insert({
          accrual_id: pay.acc.id,
          profile_id: pay.acc.profile_id,
          branch_id: pay.acc.branch_id,
          amount,
          method: pay.method,
          paid_on: pay.date,
          paid_by: me.id,
          idempotency_key: pay.key,
        }),
      )
    }, 'Выплата записана')
    if (ok) {
      setPay(null)
      reload()
    }
  }

  async function saveBonus() {
    if (!bonus) return
    const ok = await act(async () => {
      if (!bonus.profile || !bonus.branch) throw new Error('Выберите сотрудника и филиал')
      if (!(Number(bonus.amount) > 0)) throw new Error('Сумма должна быть больше нуля')
      if (!bonus.reason.trim()) throw new Error('Укажите, за что бонус')
      const day = month === thisMonth() ? today() : monthBounds(month).d0
      must(await sb.from('bonuses').insert({ profile_id: bonus.profile, branch_id: bonus.branch, amount: Number(bonus.amount), reason: bonus.reason.trim(), given_on: day }))
      must(await sb.rpc('accrue_salaries', { p_period: monthBounds(month).d0, p_branch: bonus.branch }))
    }, 'Бонус начислен')
    if (ok) {
      setBonus(null)
      reload()
    }
  }

  return (
    <>
      <PageHead title="Зарплаты" sub="Оклад + занятия × ставка + бонусы − штрафы">
        {boss && (
          <button className="btn ghost" onClick={() => setBonus({ profile: '', branch: branchF || (data?.branches.length === 1 ? data.branches[0].id : ''), amount: '', reason: '' })}>
            <Icon name="plus" /> Бонус
          </button>
        )}
        <button className="btn" onClick={calculate}>
          Рассчитать за месяц
        </button>
      </PageHead>
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
      </div>
      <State loading={loading} error={error}>
        {list.length ? (
          <>
            <div className="kpis">
              <div className="card kpi">
                <span>Начислено</span>
                <b>{money(sum((a) => Number(a.total)))}</b>
              </div>
              <div className="card kpi">
                <span>Выплачено</span>
                <b>{money(sum(paidOf))}</b>
              </div>
              <div className="card kpi">
                <span>К выплате</span>
                <b>{money(sum((a) => Math.max(0, Number(a.total) - paidOf(a))))}</b>
              </div>
            </div>
            <section className="card flush">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Сотрудник</th>
                      <th className="num">Оклад</th>
                      <th className="num">Занятия</th>
                      <th className="num">Бонусы</th>
                      <th className="num">Штрафы</th>
                      <th className="num">Итого</th>
                      <th className="num">Выплачено</th>
                      <th>Статус</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((a) => {
                      const paid = paidOf(a)
                      return (
                        <tr key={a.id}>
                          <td>
                            <b>{a.person?.full_name}</b>
                            <small className="muted block">
                              {a.person && ROLE_LABEL[a.person.role]} · {a.branch?.name}
                            </small>
                          </td>
                          <td className="num">{money(a.base_amount)}</td>
                          <td className="num">
                            {money(a.lessons_amount)}
                            {a.lessons_count > 0 && (
                              <small className="muted block">
                                {a.lessons_count} × {money(a.lesson_rate)}
                              </small>
                            )}
                          </td>
                          <td className="num">{money(a.bonus_amount)}</td>
                          <td className="num">{a.fine_amount > 0 ? <span className="danger-text">−{money(a.fine_amount)}</span> : money(0)}</td>
                          <td className="num">
                            <b>{money(a.total)}</b>
                          </td>
                          <td className="num">{money(paid)}</td>
                          <td>
                            <span className={'badge ' + (a.status === 'draft' ? '' : a.status === 'approved' ? 'gold' : 'ok')}>{STATUS[a.status]}</span>
                          </td>
                          <td className="act">
                            {a.status === 'draft' && boss && (
                              <button className="btn ghost sm" onClick={() => setStatus(a, 'approved')}>
                                Утвердить
                              </button>
                            )}
                            {a.status !== 'draft' && paid < Number(a.total) && (
                              <button
                                className="btn ghost sm"
                                onClick={() => setPay({ acc: a, amount: String(Math.max(0, Number(a.total) - paid)), method: 'transfer', date: today(), key: crypto.randomUUID() })}
                              >
                                Выплатить
                              </button>
                            )}
                            {a.status === 'approved' && boss && paid >= Number(a.total) && (
                              <button className="btn ghost sm" onClick={() => setStatus(a, 'paid')}>
                                Закрыть
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            <p className="muted small">
              Черновики пересчитываются кнопкой «Рассчитать за месяц». Утверждённые не меняются — изменить их может только директор. Выплата доступна после утверждения.
            </p>
          </>
        ) : (
          <section className="card">
            <Empty text="Начислений за месяц нет. Нажмите «Рассчитать за месяц» — посчитаем оклады, занятия по расписанию, бонусы и штрафы." icon="layers" />
          </section>
        )}
      </State>

      {pay && (
        <Modal
          title={`Выплата · ${pay.acc.person?.full_name}`}
          onClose={() => setPay(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setPay(null)}>
                Отмена
              </button>
              <button className="btn" onClick={savePay}>
                Записать выплату
              </button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="Сумма, ₸">
              <input type="number" min={1} autoFocus value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
            </Field>
            <Field label="Дата">
              <input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} />
            </Field>
            <Field label="Способ">
              <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
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

      {bonus && (
        <Modal
          title="Бонус сотруднику"
          onClose={() => setBonus(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setBonus(null)}>
                Отмена
              </button>
              <button className="btn" onClick={saveBonus}>
                Начислить
              </button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="Филиал">
              <select value={bonus.branch} onChange={(e) => setBonus({ ...bonus, branch: e.target.value, profile: '' })}>
                <option value="">—</option>
                {data?.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Сотрудник">
              <select value={bonus.profile} onChange={(e) => setBonus({ ...bonus, profile: e.target.value })}>
                <option value="">—</option>
                {data?.staff.filter((s) => s.branches.includes(bonus.branch)).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Сумма, ₸">
              <input type="number" min={1} value={bonus.amount} onChange={(e) => setBonus({ ...bonus, amount: e.target.value })} />
            </Field>
            <Field label="За что">
              <input value={bonus.reason} onChange={(e) => setBonus({ ...bonus, reason: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}
