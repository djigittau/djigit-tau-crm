import { useState } from 'react'
import { sb } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Empty, Modal, Field, Icon, act, money, fmtDate } from '../lib/ui'
import { loadBranches, loadStaff, METHODS, thisMonth, monthBounds, today } from '../lib/refs'

type Cat = { id: string; code: string | null; name: string; is_system: boolean }
type Row = {
  id: string
  branch_id: string
  category_id: string
  amount: number
  spent_on: string
  method: string | null
  responsible_id: string | null
  comment: string | null
  related_ref: string | null
  branch: { name: string } | null
  cat: { name: string } | null
  resp: { full_name: string } | null
}
// Эти статьи ведутся на своих страницах (зарплаты, медстраховка, бонусы) — в расходах их нет.
const OWN_PAGES = ['salary', 'insurance', 'bonus']

// only — коды статей для страницы «Аренда и коммунальные»; без него — все прочие расходы.
export default function Expenses({ only, title = 'Расходы' }: { only?: string[]; title?: string }) {
  const me = useMe()
  const boss = me.role === 'director' || me.role === 'manager'
  const [month, setMonth] = useState(thisMonth())
  const [branchF, setBranchF] = useState('')
  const [catF, setCatF] = useState('')
  const [draft, setDraft] = useState<(Partial<Row> & { amountStr?: string }) | null>(null)
  const [newCat, setNewCat] = useState('')

  const { data, loading, error, reload } = useLoad(async () => {
    const { d0, d1 } = monthBounds(month)
    const [rows, cats, branches, staff] = await Promise.all([
      sb
        .from('expenses')
        .select('*, branch:branches(name), cat:expense_categories(name), resp:profiles!expenses_responsible_id_fkey(full_name)')
        .gte('spent_on', d0)
        .lt('spent_on', d1)
        .order('spent_on', { ascending: false })
        .then(must),
      sb.from('expense_categories').select('id, code, name, is_system').order('name').then(must),
      loadBranches(),
      loadStaff(),
    ])
    const usable = (cats as Cat[]).filter((c) => !OWN_PAGES.includes(c.code ?? '') && (!only || only.includes(c.code ?? '')))
    return { rows: (rows as unknown as Row[]).filter((r) => usable.some((c) => c.id === r.category_id)), cats: usable, branches, staff }
  }, [month, only?.join()])

  const list = (data?.rows ?? []).filter((r) => (!branchF || r.branch_id === branchF) && (!catF || r.category_id === catF))
  const total = list.reduce((t, r) => t + Number(r.amount), 0)
  const byCat = new Map<string, number>()
  for (const r of list) byCat.set(r.cat?.name ?? '—', (byCat.get(r.cat?.name ?? '—') ?? 0) + Number(r.amount))

  const open = (r?: Row) =>
    setDraft(
      r
        ? { ...r, amountStr: String(r.amount) }
        : { spent_on: today(), branch_id: branchF || (data?.branches.length === 1 ? data.branches[0].id : ''), category_id: catF || (data?.cats.length === 1 ? data.cats[0].id : ''), method: 'kaspi', amountStr: '' },
    )

  async function save() {
    if (!draft) return
    const ok = await act(async () => {
      const amount = Number(draft.amountStr)
      if (!draft.branch_id) throw new Error('Выберите филиал')
      if (!draft.category_id) throw new Error('Выберите статью')
      if (!(amount > 0)) throw new Error('Сумма должна быть больше нуля')
      const row = {
        branch_id: draft.branch_id,
        category_id: draft.category_id,
        amount,
        spent_on: draft.spent_on || today(),
        method: draft.method || null,
        responsible_id: draft.responsible_id || null,
        comment: draft.comment?.trim() || null,
        related_ref: draft.related_ref?.trim() || null,
      }
      must(draft.id ? await sb.from('expenses').update(row).eq('id', draft.id) : await sb.from('expenses').insert(row))
    }, 'Расход сохранён')
    if (ok) {
      setDraft(null)
      reload()
    }
  }

  async function remove(r: Row) {
    if (!confirm(`Удалить расход ${money(r.amount)} от ${fmtDate(r.spent_on)}?`)) return
    if (await act(async () => must(await sb.from('expenses').delete().eq('id', r.id)), 'Удалено')) reload()
  }

  return (
    <>
      <PageHead title={title} sub={`Итого за месяц: ${money(total)}`}>
        <button className="btn" onClick={() => open()}>
          <Icon name="plus" /> Добавить расход
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
        <select value={catF} onChange={(e) => setCatF(e.target.value)} aria-label="Статья">
          <option value="">Все статьи</option>
          {data?.cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <State loading={loading} error={error}>
        {byCat.size > 1 && (
          <div className="kpis">
            {[...byCat].map(([k, v]) => (
              <div key={k} className="card kpi">
                <span>{k}</span>
                <b>{money(v)}</b>
              </div>
            ))}
          </div>
        )}
        <section className="card flush">
          {list.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Статья</th>
                    <th>Филиал</th>
                    <th className="num">Сумма</th>
                    <th>Оплата</th>
                    <th>Ответственный</th>
                    <th>Комментарий</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id}>
                      <td>{fmtDate(r.spent_on)}</td>
                      <td>
                        <b>{r.cat?.name}</b>
                      </td>
                      <td>{r.branch?.name}</td>
                      <td className="num">{money(r.amount)}</td>
                      <td>{r.method ? METHODS[r.method] : '—'}</td>
                      <td>{r.resp?.full_name ?? '—'}</td>
                      <td>
                        {r.comment ?? '—'}
                        {r.related_ref && <small className="muted block">№ {r.related_ref}</small>}
                      </td>
                      <td className="act">
                        <button className="icon-btn" aria-label="Изменить" onClick={() => open(r)}>
                          <Icon name="edit" />
                        </button>
                        {boss && (
                          <button className="icon-btn" aria-label="Удалить" onClick={() => remove(r)}>
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
            <Empty text="Расходов за этот месяц нет" icon="layers" />
          )}
        </section>
        {!only && (
          <section className="card narrow">
            <h3>Свои статьи расходов</h3>
            <form
              className="row"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!newCat.trim()) return
                if (await act(async () => must(await sb.from('expense_categories').insert({ name: newCat.trim() })), 'Статья добавлена')) {
                  setNewCat('')
                  reload()
                }
              }}
            >
              <input placeholder="Например, Костюмы" value={newCat} onChange={(e) => setNewCat(e.target.value)} aria-label="Новая статья" />
              <button className="btn ghost">
                <Icon name="plus" /> Добавить статью
              </button>
            </form>
          </section>
        )}
      </State>

      {draft && (
        <Modal
          title={draft.id ? 'Изменить расход' : 'Новый расход'}
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
            <Field label="Статья *">
              <select value={draft.category_id ?? ''} onChange={(e) => setDraft({ ...draft, category_id: e.target.value })}>
                <option value="">—</option>
                {data?.cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Филиал *">
              <select value={draft.branch_id ?? ''} onChange={(e) => setDraft({ ...draft, branch_id: e.target.value })}>
                <option value="">—</option>
                {data?.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Сумма, ₸ *">
              <input type="number" min={1} autoFocus value={draft.amountStr ?? ''} onChange={(e) => setDraft({ ...draft, amountStr: e.target.value })} />
            </Field>
            <Field label="Дата">
              <input type="date" value={draft.spent_on ?? ''} onChange={(e) => setDraft({ ...draft, spent_on: e.target.value })} />
            </Field>
            <Field label="Способ оплаты">
              <select value={draft.method ?? ''} onChange={(e) => setDraft({ ...draft, method: e.target.value })}>
                <option value="">—</option>
                {Object.entries(METHODS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ответственный">
              <select value={draft.responsible_id ?? ''} onChange={(e) => setDraft({ ...draft, responsible_id: e.target.value })}>
                <option value="">—</option>
                {data?.staff.filter((s) => !draft.branch_id || s.branches.includes(draft.branch_id)).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Документ / номер счёта">
              <input value={draft.related_ref ?? ''} onChange={(e) => setDraft({ ...draft, related_ref: e.target.value })} />
            </Field>
            <Field label="Комментарий" full>
              <textarea value={draft.comment ?? ''} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}
