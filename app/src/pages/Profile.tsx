import { useState } from 'react'
import { sb, ROLE_LABEL, PHONE_EMAIL_DOMAIN } from '../lib/supabase'
import { useAuth, useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, act, money, initials } from '../lib/ui'
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
        <section className="card">
          <h3>Сменить пароль</h3>
          <ChangePassword />
        </section>
      </div>
    </>
  )
}
