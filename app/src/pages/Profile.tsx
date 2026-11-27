import { useState } from 'react'
import { sb, PHONE_EMAIL_DOMAIN } from '../lib/supabase'
import { useAuth, useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Field, Modal, Icon, act, money, fmtDate } from '../lib/ui'
import { StaffHead, TrainerStats } from './StaffCard'
import ChangePassword from './ChangePassword'
import { adminCall } from './Employees'

type MyBranch = { base_salary: number; branches: { name: string } | null }
type Edit = { login: string; phone: string; email: string; birth: string; bio: string }

// Свой профиль: данные показаны текстом, правка — кнопкой «Редактировать профиль» (фото, телефон, дата рождения, «О себе»).
// Роль, филиалы, дату приёма и процент меняет директор в «Сотрудниках».
export default function Profile() {
  const me = useMe()
  const { reload: reloadMe, session } = useAuth()
  const [edit, setEdit] = useState<Edit | null>(null)
  const boss = me.role === 'director'
  const login = session?.user.email ?? ''
  const { data, loading, error } = useLoad(
    async () => must(await sb.from('employee_branches').select('base_salary, branches(name)').eq('profile_id', me.id)) as unknown as MyBranch[],
    [me.id],
  )
  const loginText = login.endsWith('@' + PHONE_EMAIL_DOMAIN) ? '+' + login.split('@')[0] : login
  const open = () => setEdit({ login: loginText, phone: me.phone ?? '', email: me.email ?? '', birth: me.birth_date ?? '', bio: me.bio ?? '' })
  async function save(f: Edit, photo = me.photo_url ?? '') {
    must(await sb.rpc('update_my_profile', { p_phone: f.phone, p_photo_url: photo, p_birth_date: f.birth || null, p_bio: f.bio }))
    if (boss) {
      // Директор меняет и контактный email; логин (вход) — через серверную функцию, она пишет в журнал.
      must(await sb.from('profiles').update({ email: f.email.trim().toLowerCase() || null }).eq('id', me.id))
      if (f.login.trim() && f.login.trim().toLowerCase() !== loginText.toLowerCase()) {
        await adminCall({ action: 'set_login', id: me.id, login: f.login })
        await sb.auth.refreshSession()
      }
    }
    await reloadMe()
  }

  return (
    <>
      <PageHead title="Профиль">
        <button className="btn" onClick={open}>
          <Icon name="edit" /> Редактировать профиль
        </button>
      </PageHead>
      <div className="grid-2">
        <section className="card">
          <StaffHead p={me} />
          <dl className="props">
            <dt>Вход</dt>
            <dd>{loginText}</dd>
            <dt>Телефон</dt>
            <dd>{me.phone || <span className="muted">не указан</span>}</dd>
            <dt>Email</dt>
            <dd>{me.email || '—'}</dd>
            <dt>Дата рождения</dt>
            <dd>{me.birth_date ? fmtDate(me.birth_date) : <span className="muted">не указана</span>}</dd>
            {!boss && (
              <>
            <dt>Дата приёма</dt>
            <dd>{fmtDate(me.hired_at)}</dd>
            <dt>Филиалы</dt>
            <dd>
              <State loading={loading} error={error}>
                {data?.length
                  ? data.map((b, i) => (
                      <div key={i}>
                        {b.branches?.name}
                        {b.base_salary > 0 && me.role !== 'trainer' && <span className="muted"> · оклад {money(b.base_salary)}</span>}
                      </div>
                    ))
                  : me.role === 'director' ? 'все' : 'не назначены'}
              </State>
            </dd>
            <dt>О себе</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{me.bio || <span className="muted">не заполнено</span>}</dd>
              </>
            )}
          </dl>
        </section>
        {me.role === 'trainer' && <TrainerStats p={me} />}
        {me.role !== 'director' && <MyPay />}
        <section className="card">
          <h3>Сменить пароль</h3>
          <ChangePassword />
        </section>
      </div>
      {edit && (
        <Modal
          title="Редактировать профиль"
          onClose={() => setEdit(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setEdit(null)}>
                Отмена
              </button>
              <button className="btn" onClick={async () => (await act(() => save(edit), 'Профиль сохранён')) && setEdit(null)}>
                Сохранить
              </button>
            </>
          }
        >
          <StaffHead p={me} onPhoto={(url) => save({ login: loginText, phone: me.phone ?? '', email: me.email ?? '', birth: me.birth_date ?? '', bio: me.bio ?? '' }, url)} />
          <div className="form-grid">
            {boss && (
              <>
                <Field label="Вход (логин)" hint="Email или телефон, по которому входите в CRM" full>
                  <input value={edit.login} onChange={(e) => setEdit({ ...edit, login: e.target.value })} autoComplete="username" />
                </Field>
                <Field label="Email" hint="Контакт; может отличаться от логина" full>
                  <input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
                </Field>
              </>
            )}
            <Field label="Телефон">
              <input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} inputMode="tel" placeholder="+7 700 000 00 00" />
            </Field>
            <Field label="Дата рождения">
              <input type="date" value={edit.birth} onChange={(e) => setEdit({ ...edit, birth: e.target.value })} />
            </Field>
            {!boss && (
              <Field label="О себе" hint="Опыт, направления, награды — видят руководители" full>
                <textarea value={edit.bio} maxLength={2000} onChange={(e) => setEdit({ ...edit, bio: e.target.value })} />
              </Field>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}

// Свои начисления, бонусы и штрафы (RLS отдаёт только свои записи).
function MyPay() {
  const me = useMe()
  const { data } = useLoad(async () => {
    const [acc, bonuses, fines] = await Promise.all([
      sb.from('salary_accruals').select('period, sales_amount, percent, percent_amount, base_amount, bonus_amount, fine_amount, total, status, salary_payments(amount)').eq('profile_id', me.id).order('period', { ascending: false }).limit(6).then(must),
      sb.from('bonuses').select('amount, reason, given_on').eq('profile_id', me.id).order('given_on', { ascending: false }).limit(5).then(must),
      sb.from('fines').select('amount, reason, fined_on').eq('profile_id', me.id).order('fined_on', { ascending: false }).limit(5).then(must),
    ])
    return {
      acc: acc as unknown as { period: string; sales_amount: number; percent: number; percent_amount: number; base_amount: number; bonus_amount: number; fine_amount: number; total: number; status: string; salary_payments: { amount: number }[] }[],
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
                    {me.role === 'trainer' ? `${a.percent}% от абонементов ${money(a.sales_amount)} = ${money(a.percent_amount)}` : `оклад ${money(a.base_amount)}`}
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
