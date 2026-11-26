import { useState } from 'react'
import { sb, normPhone } from '../lib/supabase'
import { useLoad, must, State, PageHead, Empty, Modal, Field, Icon, act, fmtDate, money, Contact } from '../lib/ui'
import { loadBranches, STUDENT_STATUS, METHODS } from '../lib/refs'

type Row = {
  id: string
  full_name: string
  phone: string
  phone2: string | null
  branch_id: string
  comment: string | null
  created_at: string
  branch: { name: string } | null
  students: { id: string; full_name: string; status: string; group_members: { left_at: string | null; groups: { name: string } | null }[] }[]
}
type Draft = { id?: string; full_name: string; phone: string; phone2: string; branch_id: string; comment: string }

export default function Parents() {
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [card, setCard] = useState<Row | null>(null)

  const { data, loading, error, reload } = useLoad(async () => {
    const [parents, branches] = await Promise.all([
      sb.from('parents').select('*, branch:branches(name), students(id, full_name, status, group_members(left_at, groups(name))))').order('full_name').then(must),
      loadBranches(),
    ])
    return { parents: parents as unknown as Row[], branches }
  }, [])

  const list = (data?.parents ?? []).filter((p) => {
    if (!q) return true
    const t = [p.full_name, p.phone, p.phone2, ...p.students.map((s) => s.full_name)].join(' ').toLowerCase()
    return t.includes(q.toLowerCase()) || (normPhone(q).length > 3 && normPhone(p.phone).includes(normPhone(q)))
  })

  async function save() {
    if (!draft) return
    const ok = await act(async () => {
      if (!draft.full_name.trim()) throw new Error('Введите ФИО родителя')
      if (normPhone(draft.phone).length < 11) throw new Error('Укажите телефон полностью')
      if (!draft.branch_id) throw new Error('Выберите филиал')
      const row = { full_name: draft.full_name.trim(), phone: draft.phone.trim(), phone2: draft.phone2.trim() || null, branch_id: draft.branch_id, comment: draft.comment.trim() || null }
      const r = draft.id ? await sb.from('parents').update(row).eq('id', draft.id) : await sb.from('parents').insert(row)
      if (r.error && /duplicate key/i.test(r.error.message)) throw new Error('Родитель с таким телефоном уже есть в базе')
      must(r)
    }, 'Родитель сохранён')
    if (ok) {
      setDraft(null)
      setCard(null)
      reload()
    }
  }

  const open = (p?: Row) =>
    setDraft({
      id: p?.id,
      full_name: p?.full_name ?? '',
      phone: p?.phone ?? '',
      phone2: p?.phone2 ?? '',
      branch_id: p?.branch_id ?? (data?.branches.length === 1 ? data.branches[0].id : ''),
      comment: p?.comment ?? '',
    })

  return (
    <>
      <PageHead title="Родители" sub={data ? `Всего: ${data.parents.length}` : undefined}>
        <button className="btn" onClick={() => open()}>
          <Icon name="plus" /> Добавить родителя
        </button>
      </PageHead>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input placeholder="Имя, телефон или имя ребёнка" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
        </div>
      </div>
      <State loading={loading} error={error}>
        <section className="card flush">
          {list.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Родитель</th>
                    <th>Телефон</th>
                    <th>Дети</th>
                    <th>Филиал</th>
                    <th>Зарегистрирован</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => setCard(p)}>
                      <td>
                        <b>{p.full_name}</b>
                      </td>
                      <td>
                        {p.phone}
                        {p.phone2 && <small className="muted block">{p.phone2}</small>}
                      </td>
                      <td>{p.students.map((s) => s.full_name).join(', ') || '—'}</td>
                      <td>{p.branch?.name}</td>
                      <td>{fmtDate(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text={q ? 'Ничего не найдено' : 'Родителей пока нет. Они появляются при добавлении ученика или пробника.'} icon="users" />
          )}
        </section>
      </State>

      {card && (
        <Modal
          title={card.full_name}
          onClose={() => setCard(null)}
          footer={
            <button className="btn" onClick={() => open(card)}>
              <Icon name="edit" /> Изменить
            </button>
          }
        >
          <dl className="props">
            <dt>Телефон</dt>
            <dd>
              {card.phone}
              <Contact phone={card.phone} />
            </dd>
            <dt>Доп. телефон</dt>
            <dd>{card.phone2 ?? '—'}</dd>
            <dt>Филиал</dt>
            <dd>{card.branch?.name}</dd>
            <dt>Зарегистрирован</dt>
            <dd>{fmtDate(card.created_at)}</dd>
            <dt>Комментарий</dt>
            <dd>{card.comment ?? '—'}</dd>
          </dl>
          <h3>Дети</h3>
          {card.students.length ? (
            <table>
              <tbody>
                {card.students.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.full_name}
                      <small className="muted block">{s.group_members.find((m) => !m.left_at)?.groups?.name ?? 'без группы'}</small>
                    </td>
                    <td className="num">{STUDENT_STATUS[s.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Детей пока не привязано</p>
          )}
          <ParentPayments ids={card.students.map((s) => s.id)} names={Object.fromEntries(card.students.map((s) => [s.id, s.full_name]))} />
        </Modal>
      )}

      {draft && (
        <Modal
          title={draft.id ? 'Изменить родителя' : 'Новый родитель'}
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
            <Field label="ФИО *" full>
              <input autoFocus value={draft.full_name} onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} />
            </Field>
            <Field label="Телефон *">
              <input value={draft.phone} inputMode="tel" placeholder="+7 700 000 00 00" onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            </Field>
            <Field label="Дополнительный телефон">
              <input value={draft.phone2} inputMode="tel" onChange={(e) => setDraft({ ...draft, phone2: e.target.value })} />
            </Field>
            <Field label="Филиал *" full>
              <select value={draft.branch_id} onChange={(e) => setDraft({ ...draft, branch_id: e.target.value })}>
                <option value="">—</option>
                {data?.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
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

// Все оплаты и возвраты по детям родителя (RLS: офис филиала; продажи — только свои продажи).
function ParentPayments({ ids, names }: { ids: string[]; names: Record<string, string> }) {
  const { data } = useLoad(
    async () =>
      ids.length
        ? (must(await sb.from('payments').select('id, student_id, amount, kind, method, paid_at, comment').in('student_id', ids).order('paid_at', { ascending: false })) as {
            id: string; student_id: string; amount: number; kind: string; method: string; paid_at: string; comment: string | null
          }[])
        : [],
    [ids.join()],
  )
  if (!data) return null
  const total = data.reduce((t, p) => t + (p.kind === 'refund' ? -p.amount : +p.amount), 0)
  return (
    <>
      <h3>Оплаты {data.length > 0 && <span className="badge gold">итого {money(total)}</span>}</h3>
      {data.length ? (
        <table>
          <tbody>
            {data.map((p) => (
              <tr key={p.id}>
                <td>
                  {fmtDate(p.paid_at)} · {names[p.student_id]}
                  <small className="muted block">
                    {METHODS[p.method]}
                    {p.kind === 'refund' && ` · возврат: ${p.comment}`}
                  </small>
                </td>
                <td className={'num' + (p.kind === 'refund' ? ' danger-text' : '')}>
                  {p.kind === 'refund' ? '−' : ''}
                  {money(p.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">Оплат пока нет</p>
      )}
    </>
  )
}
