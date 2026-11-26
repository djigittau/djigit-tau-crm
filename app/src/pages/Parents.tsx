import { useState } from 'react'
import { sb, normPhone } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Empty, Modal, Field, Icon, act, fmtDate } from '../lib/ui'
import { loadBranches, STUDENT_STATUS } from '../lib/refs'

type Row = {
  id: string
  full_name: string
  phone: string
  phone2: string | null
  branch_id: string
  comment: string | null
  created_at: string
  branch: { name: string } | null
  students: { id: string; full_name: string; status: string }[]
}
type Draft = { id?: string; full_name: string; phone: string; phone2: string; branch_id: string; comment: string }

export default function Parents() {
  const me = useMe()
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [card, setCard] = useState<Row | null>(null)

  const { data, loading, error, reload } = useLoad(async () => {
    const [parents, branches] = await Promise.all([
      sb.from('parents').select('*, branch:branches(name), students(id, full_name, status)').order('full_name').then(must),
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
            <dd>{card.phone}</dd>
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
                    <td>{s.full_name}</td>
                    <td className="num">{STUDENT_STATUS[s.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Детей пока не привязано</p>
          )}
          {me.role !== 'sales' && <p className="muted small">История оплат появится вместе с модулем продаж.</p>}
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
