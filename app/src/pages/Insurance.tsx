import { useState } from 'react'
import { sb } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Empty, Modal, Field, Icon, act, money, fmtDate } from '../lib/ui'
import { loadBranches, loadStaff, today } from '../lib/refs'

type Row = {
  id: string
  profile_id: string
  branch_id: string
  provider: string | null
  policy_number: string | null
  amount: number
  valid_from: string | null
  valid_to: string | null
  paid_on: string | null
  comment: string | null
  person: { full_name: string } | null
  branch: { name: string } | null
}
type Draft = { id?: string; profile_id: string; branch_id: string; provider: string; policy_number: string; amount: string; valid_from: string; valid_to: string; paid_on: string; comment: string }

export default function Insurance() {
  const me = useMe()
  const boss = me.role === 'director' || me.role === 'manager'
  const [draft, setDraft] = useState<Draft | null>(null)
  const { data, loading, error, reload } = useLoad(async () => {
    const [rows, branches, staff] = await Promise.all([
      sb.from('employee_insurance').select('*, person:profiles!employee_insurance_profile_id_fkey(full_name), branch:branches(name)').order('valid_to', { ascending: true, nullsFirst: false }).then(must),
      loadBranches(),
      loadStaff(),
    ])
    return { rows: rows as unknown as Row[], branches, staff }
  }, [])

  const open = (r?: Row) =>
    setDraft({
      id: r?.id,
      profile_id: r?.profile_id ?? '',
      branch_id: r?.branch_id ?? (data?.branches.length === 1 ? data.branches[0].id : ''),
      provider: r?.provider ?? '',
      policy_number: r?.policy_number ?? '',
      amount: r ? String(r.amount) : '',
      valid_from: r?.valid_from ?? today(),
      valid_to: r?.valid_to ?? '',
      paid_on: r?.paid_on ?? today(),
      comment: r?.comment ?? '',
    })

  async function save() {
    if (!draft) return
    const ok = await act(async () => {
      if (!draft.branch_id || !draft.profile_id) throw new Error('Выберите филиал и сотрудника')
      if (!(Number(draft.amount) >= 0) || draft.amount === '') throw new Error('Укажите стоимость полиса')
      const row = {
        profile_id: draft.profile_id,
        branch_id: draft.branch_id,
        provider: draft.provider.trim() || null,
        policy_number: draft.policy_number.trim() || null,
        amount: Number(draft.amount),
        valid_from: draft.valid_from || null,
        valid_to: draft.valid_to || null,
        paid_on: draft.paid_on || null,
        comment: draft.comment.trim() || null,
      }
      must(draft.id ? await sb.from('employee_insurance').update(row).eq('id', draft.id) : await sb.from('employee_insurance').insert(row))
    }, 'Полис сохранён')
    if (ok) {
      setDraft(null)
      reload()
    }
  }

  const soon = (d: string | null) => d && new Date(d).getTime() - Date.now() < 30 * 864e5
  return (
    <>
      <PageHead title="Медицинская страховка" sub={data ? `Полисов: ${data.rows.length}` : undefined}>
        <button className="btn" onClick={() => open()}>
          <Icon name="plus" /> Добавить полис
        </button>
      </PageHead>
      <State loading={loading} error={error}>
        <section className="card flush">
          {data?.rows.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Сотрудник</th>
                    <th>Страховая / полис</th>
                    <th>Действует</th>
                    <th className="num">Стоимость</th>
                    <th>Оплачен</th>
                    <th>Филиал</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <b>{r.person?.full_name}</b>
                      </td>
                      <td>
                        {r.provider ?? '—'}
                        {r.policy_number && <small className="muted block">№ {r.policy_number}</small>}
                      </td>
                      <td>
                        {fmtDate(r.valid_from)} — {fmtDate(r.valid_to)}
                        {soon(r.valid_to) && <span className="badge warn">{new Date(r.valid_to!) < new Date() ? 'истёк' : 'скоро истекает'}</span>}
                      </td>
                      <td className="num">{money(r.amount)}</td>
                      <td>{fmtDate(r.paid_on)}</td>
                      <td>{r.branch?.name}</td>
                      <td className="act">
                        <button className="icon-btn" aria-label="Изменить" onClick={() => open(r)}>
                          <Icon name="edit" />
                        </button>
                        {boss && (
                          <button
                            className="icon-btn"
                            aria-label="Удалить"
                            onClick={async () => {
                              if (confirm('Удалить полис?') && (await act(async () => must(await sb.from('employee_insurance').delete().eq('id', r.id)), 'Удалено'))) reload()
                            }}
                          >
                            <Icon name="x" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="Полисов пока нет" icon="layers" />
          )}
        </section>
      </State>
      {draft && (
        <Modal
          title={draft.id ? 'Изменить полис' : 'Новый полис'}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setDraft(null)}>
                Отмена
              </button>
              <button className="btn" onClick={save}>
                Сохранить
              </button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="Филиал">
              <select value={draft.branch_id} onChange={(e) => setDraft({ ...draft, branch_id: e.target.value, profile_id: '' })}>
                <option value="">—</option>
                {data?.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Сотрудник">
              <select value={draft.profile_id} onChange={(e) => setDraft({ ...draft, profile_id: e.target.value })}>
                <option value="">—</option>
                {data?.staff.filter((s) => s.branches.includes(draft.branch_id)).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Страховая компания">
              <input value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })} />
            </Field>
            <Field label="Номер полиса">
              <input value={draft.policy_number} onChange={(e) => setDraft({ ...draft, policy_number: e.target.value })} />
            </Field>
            <Field label="Стоимость, ₸">
              <input type="number" min={0} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
            </Field>
            <Field label="Дата оплаты" hint="По ней полис попадает в расходы месяца">
              <input type="date" value={draft.paid_on} onChange={(e) => setDraft({ ...draft, paid_on: e.target.value })} />
            </Field>
            <Field label="Действует с">
              <input type="date" value={draft.valid_from} onChange={(e) => setDraft({ ...draft, valid_from: e.target.value })} />
            </Field>
            <Field label="Действует до">
              <input type="date" value={draft.valid_to} onChange={(e) => setDraft({ ...draft, valid_to: e.target.value })} />
            </Field>
            <Field label="Комментарий" full>
              <textarea value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}
