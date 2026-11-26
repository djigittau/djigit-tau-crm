import { useState } from 'react'
import { sb, ROLE_LABEL, PHONE_EMAIL_DOMAIN } from '../lib/supabase'
import { useAuth, useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, act, money, initials, fmtDate, lessons } from '../lib/ui'
import ChangePassword from './ChangePassword'

type MyBranch = { base_salary: number; branches: { name: string } | null }

export default function Profile() {
  const me = useMe()
  const { reload: reloadMe, session } = useAuth()
  const [phone, setPhone] = useState(me.phone ?? '')
  const login = session?.user.email ?? ''
  const { data, loading, error } = useLoad(
    async () => must(await sb.from('employee_branches').select('base_salary, branches(name)').eq('profile_id', me.id)) as unknown as MyBranch[],
    [me.id],
  )

  return (
    <>
      <PageHead title="Профиль" />
      <div className="grid-2">
        <section className="card">
          <div className="person">
            <span className="avatar xl">{me.photo_url ? <img src={me.photo_url} alt="" /> : initials(me.full_name)}</span>
            <div>
              <h2>{me.full_name}</h2>
              <span className="badge gold">{ROLE_LABEL[me.role]}</span>
            </div>
          </div>
          <dl className="props">
            <dt>Вход</dt>
            <dd>{login.endsWith('@' + PHONE_EMAIL_DOMAIN) ? 'по телефону' : login}</dd>
            <dt>Email</dt>
            <dd>{me.email || '—'}</dd>
            <dt>Филиалы</dt>
            <dd>
              <State loading={loading} error={error}>
                {data?.length
                  ? data.map((b, i) => (
                      <div key={i}>
                        {b.branches?.name}
                        {b.base_salary > 0 && <span className="muted"> · оклад {money(b.base_salary)}</span>}
                      </div>
                    ))
                  : 'не назначены'}
              </State>
            </dd>
          </dl>
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault()
              if (await act(async () => must(await sb.rpc('update_my_profile', { p_phone: phone, p_photo_url: me.photo_url ?? '' })), 'Телефон сохранён'))
                reloadMe()
            }}
          >
            <label className="field grow">
              <span>Телефон</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
            </label>
            <button className="btn ghost">Сохранить</button>
          </form>
        </section>
        <MyPay />
        <section className="card">
          <h3>Сменить пароль</h3>
          <ChangePassword />
        </section>
      </div>
    </>
  )
}

// Свои начисления, бонусы и штрафы (RLS отдаёт только свои записи).
function MyPay() {
  const me = useMe()
  const { data } = useLoad(async () => {
    const [acc, bonuses, fines] = await Promise.all([
      sb.from('salary_accruals').select('period, lessons_count, lessons_amount, base_amount, bonus_amount, fine_amount, total, status, salary_payments(amount)').eq('profile_id', me.id).order('period', { ascending: false }).limit(6).then(must),
      sb.from('bonuses').select('amount, reason, given_on').eq('profile_id', me.id).order('given_on', { ascending: false }).limit(5).then(must),
      sb.from('fines').select('amount, reason, fined_on').eq('profile_id', me.id).order('fined_on', { ascending: false }).limit(5).then(must),
    ])
    return {
      acc: acc as unknown as { period: string; lessons_count: number; lessons_amount: number; base_amount: number; bonus_amount: number; fine_amount: number; total: number; status: string; salary_payments: { amount: number }[] }[],
      bonuses: bonuses as { amount: number; reason: string; given_on: string }[],
      fines: fines as { amount: number; reason: string; fined_on: string }[],
    }
  }, [me.id])
  if (!data) return null
  return (
    <section className="card">
      <h3>Мои начисления</h3>
      {data.acc.length ? (
        <table>
          <tbody>
            {data.acc.map((a) => (
              <tr key={a.period}>
                <td>
                  {new Date(a.period + 'T00:00:00').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
                  <small className="muted block">
                    оклад {money(a.base_amount)}
                    {a.lessons_count > 0 && ` · ${lessons(a.lessons_count)} ${money(a.lessons_amount)}`}
                    {a.bonus_amount > 0 && ` · бонусы ${money(a.bonus_amount)}`}
                    {a.fine_amount > 0 && ` · штрафы −${money(a.fine_amount)}`}
                  </small>
                </td>
                <td className="num">
                  <b>{money(a.total)}</b>
                  <small className="muted block">выплачено {money(a.salary_payments.reduce((t, p) => t + Number(p.amount), 0))}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">Начислений пока нет</p>
      )}
      {(data.bonuses.length > 0 || data.fines.length > 0) && (
        <table>
          <tbody>
            {data.bonuses.map((b, i) => (
              <tr key={'b' + i}>
                <td>
                  Бонус: {b.reason} <small className="muted">{fmtDate(b.given_on)}</small>
                </td>
                <td className="num">+{money(b.amount)}</td>
              </tr>
            ))}
            {data.fines.map((f, i) => (
              <tr key={'f' + i}>
                <td>
                  Штраф: {f.reason} <small className="muted">{fmtDate(f.fined_on)}</small>
                </td>
                <td className="num danger-text">−{money(f.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
