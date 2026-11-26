import { useState } from 'react'
import { sb } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Empty, Modal, Field, Icon, act, money, fmtDate } from '../lib/ui'
import { loadBranches, loadStaff, thisMonth, monthBounds, today } from '../lib/refs'

type Row = { id: string; profile_id: string; branch_id: string; amount: number; reason: string; fined_on: string; person: { full_name: string } | null; branch: { name: string } | null; author: { full_name: string } | null }

// Штрафы вычитаются из зарплаты месяца при расчёте (черновики пересчитываются кнопкой на странице «Зарплаты»).
export default function Fines() {
  const me = useMe()
  const [month, setMonth] = useState(thisMonth())
  const [draft, setDraft] = useState<{ profile: string; branch: string; amount: string; reason: string; date: string } | null>(null)
  const { data, loading, error, reload } = useLoad(async () => {
    const { d0, d1 } = monthBounds(month)
    const [rows, branches, staff] = await Promise.all([
      sb
        .from('fines')
        .select('*, person:profiles!fines_profile_id_fkey(full_name), branch:branches(name), author:profiles!fines_created_by_fkey(full_name)')
        .gte('fined_on', d0)
        .lt('fined_on', d1)
        .order('fined_on', { ascending: false })
        .then(must),
      loadBranches(),
      loadStaff(),
    ])
    return { rows: rows as unknown as Row[], branches, staff }
  }, [month])

  async function save() {
    if (!draft) return
    const ok = await act(async () => {
      if (!draft.branch || !draft.profile) throw new Error('Выберите филиал и сотрудника')
      if (!(Number(draft.amount) > 0)) throw new Error('Сумма должна быть больше нуля')
      if (!draft.reason.trim()) throw new Error('Укажите причину')
      must(await sb.from('fines').insert({ profile_id: draft.profile, branch_id: draft.branch, amount: Number(draft.amount), reason: draft.reason.trim(), fined_on: draft.date }))
    }, 'Штраф добавлен')
    if (ok) {
      setDraft(null)
      reload()
    }
  }

  const total = (data?.rows ?? []).reduce((t, r) => t + Number(r.amount), 0)
  return (
    <>
      <PageHead title="Штрафы" sub={`За месяц: ${money(total)}`}>
        <button className="btn" onClick={() => setDraft({ profile: '', branch: data?.branches.length === 1 ? data.branches[0].id : '', amount: '', reason: '', date: today() })}>
          <Icon name="plus" /> Добавить штраф
        </button>
      </PageHead>
      <div className="toolbar">
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Месяц" style={{ width: 'auto' }} />
      </div>
      <State loading={loading} error={error}>
        <section className="card flush">
          {data?.rows.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Сотрудник</th>
                    <th>Филиал</th>
                    <th>Причина</th>
                    <th className="num">Сумма</th>
                    <th>Кто назначил</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{fmtDate(r.fined_on)}</td>
                      <td>
                        <b>{r.person?.full_name}</b>
                      </td>
                      <td>{r.branch?.name}</td>
                      <td>{r.reason}</td>
                      <td className="num danger-text">−{money(r.amount)}</td>
                      <td>{r.author?.full_name ?? '—'}</td>
                      <td className="act">
                        {me.role === 'director' && (
                          <button
                            className="icon-btn"
                            aria-label="Удалить"
                            onClick={async () => {
                              if (confirm('Удалить штраф?') && (await act(async () => must(await sb.from('fines').delete().eq('id', r.id)), 'Удалено'))) reload()
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
            <Empty text="Штрафов за этот месяц нет" icon="layers" />
          )}
        </section>
      </State>
      {draft && (
        <Modal
          title="Новый штраф"
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
              <select value={draft.branch} onChange={(e) => setDraft({ ...draft, branch: e.target.value, profile: '' })}>
                <option value="">—</option>
                {data?.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Сотрудник" hint="Себе штраф назначить нельзя">
              <select value={draft.profile} onChange={(e) => setDraft({ ...draft, profile: e.target.value })}>
                <option value="">—</option>
                {data?.staff.filter((s) => s.branches.includes(draft.branch) && s.id !== me.id).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Сумма, ₸">
              <input type="number" min={1} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
            </Field>
            <Field label="Дата">
              <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            </Field>
            <Field label="Причина" full>
              <input value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} placeholder="Опоздание на смену…" />
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}
