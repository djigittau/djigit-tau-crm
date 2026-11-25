import { useState } from 'react'
import { sb, ROLE_LABEL, STATUS_LABEL, PHONE_EMAIL_DOMAIN, type Profile, type Role, type Status } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Empty, Modal, Field, Icon, act, initials, money } from '../lib/ui'

type Row = Profile & { employee_branches: { branch_id: string; base_salary: number; branches: { name: string } | null }[] }
type Draft = {
  id?: string
  full_name: string
  email: string
  phone: string
  role: Role
  branches: Record<string, string> // branch_id → оклад
  password?: string
}

const ROLES: Role[] = ['director', 'manager', 'admin', 'sales', 'trainer']

function genPassword() {
  const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const r = crypto.getRandomValues(new Uint32Array(12))
  return Array.from(r, (n) => a[n % a.length]).join('') + '7'
}

// Вызов серверной функции директора. Права проверяются на сервере.
async function adminCall(body: Record<string, unknown>) {
  const { data, error } = await sb.functions.invoke('admin-users', { body })
  if (error) {
    const ctx = (error as { context?: Response }).context
    let msg = error.message
    try {
      msg = (await ctx?.json())?.error ?? msg
    } catch {
      /* ответ без JSON */
    }
    throw new Error(msg)
  }
  return data
}

export default function Employees() {
  const me = useMe()
  const isDirector = me.role === 'director'
  const [draft, setDraft] = useState<Draft | null>(null)
  const [issued, setIssued] = useState<{ login: string; password: string } | null>(null)
  const [q, setQ] = useState('')
  const [roleF, setRoleF] = useState('')

  const { data, loading, error, reload } = useLoad(async () => {
    const [people, branches] = await Promise.all([
      sb.from('profiles').select('*, employee_branches(branch_id, base_salary, branches(name))').order('full_name').then(must),
      sb.from('branches').select('id, name').eq('is_active', true).order('name').then(must),
    ])
    return { people: people as unknown as Row[], branches: branches as { id: string; name: string }[] }
  }, [])

  const list = (data?.people ?? []).filter(
    (p) => (!roleF || p.role === roleF) && (!q || [p.full_name, p.phone, p.email].join(' ').toLowerCase().includes(q.toLowerCase())),
  )

  async function save() {
    if (!draft) return
    const body = {
      action: draft.id ? 'update' : 'create',
      id: draft.id,
      full_name: draft.full_name.trim(),
      email: draft.email.trim() || null,
      phone: draft.phone.trim() || null,
      role: draft.role,
      branches: Object.entries(draft.branches).map(([branch_id, s]) => ({ branch_id, base_salary: Number(s) || 0 })),
      password: draft.password,
    }
    const ok = await act(async () => {
      if (!body.full_name) throw new Error('Введите ФИО')
      if (!body.email && !body.phone) throw new Error('Нужен телефон или email для входа')
      if (!draft.id && (draft.password ?? '').length < 8) throw new Error('Временный пароль — минимум 8 символов')
      const r = await adminCall(body)
      if (!draft.id) setIssued({ login: r.login, password: draft.password! })
    }, draft.id ? 'Сотрудник сохранён' : 'Аккаунт создан')
    if (ok) {
      setDraft(null)
      reload()
    }
  }

  async function setStatus(p: Row, status: Status) {
    const verb = status === 'active' ? 'Разблокировать' : status === 'blocked' ? 'Заблокировать' : 'Деактивировать'
    if (!confirm(`${verb} «${p.full_name}»?`)) return
    if (await act(() => adminCall({ action: 'set_status', id: p.id, status }), 'Готово')) reload()
  }

  async function resetPassword(p: Row) {
    if (!confirm(`Выдать «${p.full_name}» новый временный пароль?`)) return
    const password = genPassword()
    if (await act(() => adminCall({ action: 'reset_password', id: p.id, password }), 'Пароль сброшен'))
      setIssued({ login: p.email || p.phone || '', password })
  }

  return (
    <>
      <PageHead title="Сотрудники" sub={data ? `Активных: ${data.people.filter((p) => p.status === 'active').length}` : undefined}>
        {isDirector && (
          <button className="btn" onClick={() => setDraft({ full_name: '', email: '', phone: '', role: 'trainer', branches: {}, password: genPassword() })}>
            <Icon name="plus" /> Добавить сотрудника
          </button>
        )}
      </PageHead>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input placeholder="Поиск по имени, телефону, email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
        </div>
        <select value={roleF} onChange={(e) => setRoleF(e.target.value)} aria-label="Роль">
          <option value="">Все роли</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </div>
      <State loading={loading} error={error}>
        <section className="card flush">
          {list.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Сотрудник</th>
                    <th>Роль</th>
                    <th>Телефон</th>
                    <th>Филиалы и оклад</th>
                    <th>Статус</th>
                    {isDirector && <th />}
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => (
                    <tr key={p.id} className={p.status !== 'active' ? 'dimmed' : ''}>
                      <td>
                        <div className="who">
                          <span className="avatar">{initials(p.full_name)}</span>
                          <div>
                            <b>{p.full_name}</b>
                            <small>{p.email ?? ''}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="badge gold">{ROLE_LABEL[p.role]}</span>
                      </td>
                      <td>{p.phone ?? '—'}</td>
                      <td>
                        {p.employee_branches.length
                          ? p.employee_branches.map((b) => (
                              <div key={b.branch_id}>
                                {b.branches?.name}
                                {b.base_salary > 0 && <span className="muted"> · {money(b.base_salary)}</span>}
                              </div>
                            ))
                          : p.role === 'director' ? 'все' : '—'}
                      </td>
                      <td>
                        <span className={'badge ' + (p.status === 'active' ? 'ok' : 'bad')}>{STATUS_LABEL[p.status]}</span>
                      </td>
                      {isDirector && (
                        <td className="act">
                          <button
                            className="icon-btn"
                            aria-label="Изменить"
                            title="Изменить"
                            onClick={() =>
                              setDraft({
                                id: p.id,
                                full_name: p.full_name,
                                email: p.email ?? '',
                                phone: p.phone ?? '',
                                role: p.role,
                                branches: Object.fromEntries(p.employee_branches.map((b) => [b.branch_id, String(b.base_salary)])),
                              })
                            }
                          >
                            <Icon name="edit" />
                          </button>
                          {p.id !== me.id && (
                            <>
                              <button className="icon-btn" aria-label="Сбросить пароль" title="Сбросить пароль" onClick={() => resetPassword(p)}>
                                <Icon name="key" />
                              </button>
                              {p.status === 'active' ? (
                                <button className="btn ghost sm" onClick={() => setStatus(p, 'blocked')}>
                                  Заблокировать
                                </button>
                              ) : (
                                <button className="btn ghost sm" onClick={() => setStatus(p, 'active')}>
                                  Разблокировать
                                </button>
                              )}
                              {p.status !== 'deactivated' && (
                                <button className="btn ghost sm danger-text" onClick={() => setStatus(p, 'deactivated')}>
                                  Деактивировать
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text={q || roleF ? 'Ничего не найдено' : 'Сотрудников пока нет'} icon="users" />
          )}
        </section>
      </State>

      {draft && (
        <Modal
          title={draft.id ? 'Изменить сотрудника' : 'Новый сотрудник'}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setDraft(null)}>
                Отмена
              </button>
              <button className="btn" onClick={save}>
                {draft.id ? 'Сохранить' : 'Создать аккаунт'}
              </button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="ФИО *" full>
              <input autoFocus value={draft.full_name} onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} />
            </Field>
            <Field label="Телефон" hint={!draft.email ? 'Без email сотрудник входит по телефону' : undefined}>
              <input value={draft.phone} inputMode="tel" placeholder="+7 700 000 00 00" onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            </Field>
            <Field label="Email" hint={draft.id ? 'Меняет только контакт, не логин' : 'Если указан — вход по email'}>
              <input value={draft.email} type="email" onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            </Field>
            <Field label="Роль *" full>
              <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })} disabled={draft.id === me.id}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
            {draft.role !== 'director' && (
              <div className="field full">
                <span>Филиалы и оклад, ₸</span>
                {data?.branches.length ? (
                  <div className="branch-pick">
                    {data.branches.map((b) => {
                      const on = b.id in draft.branches
                      return (
                        <div key={b.id} className="branch-row">
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={(e) => {
                                const next = { ...draft.branches }
                                if (e.target.checked) next[b.id] = '0'
                                else delete next[b.id]
                                setDraft({ ...draft, branches: next })
                              }}
                            />
                            {b.name}
                          </label>
                          {on && (
                            <input
                              type="number"
                              min={0}
                              aria-label={`Оклад, ${b.name}`}
                              value={draft.branches[b.id]}
                              onChange={(e) => setDraft({ ...draft, branches: { ...draft.branches, [b.id]: e.target.value } })}
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <small>Сначала добавьте филиал в разделе «Филиалы».</small>
                )}
              </div>
            )}
            {!draft.id && (
              <Field label="Временный пароль *" hint="Сотрудник сменит его при первом входе" full>
                <input value={draft.password ?? ''} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
              </Field>
            )}
          </div>
        </Modal>
      )}

      {issued && (
        <Modal title="Данные для входа" onClose={() => setIssued(null)} footer={<button className="btn" onClick={() => setIssued(null)}>Готово</button>}>
          <p>Передайте сотруднику лично. Пароль показывается один раз — при первом входе система попросит сменить его.</p>
          <dl className="props">
            <dt>Логин</dt>
            <dd>{issued.login.endsWith('@' + PHONE_EMAIL_DOMAIN) ? '+' + issued.login.split('@')[0] : issued.login}</dd>
            <dt>Пароль</dt>
            <dd>
              <code>{issued.password}</code>
            </dd>
          </dl>
        </Modal>
      )}
    </>
  )
}
