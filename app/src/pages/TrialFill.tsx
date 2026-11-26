import { useState } from 'react'
import { sb, normPhone } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Empty, Field, act, fmtDateTime } from '../lib/ui'
import { loadBranches, loadDances, loadGroups, SOURCES, TRIAL_STATUS, fromLocalInput } from '../lib/refs'

const blank = { parent_name: '', phone: '', child_name: '', child_birth_date: '', branch_id: '', dance_type_id: '', group_id: '', trial_at: '', source: 'Instagram', comment: '' }

// Форма записи на пробное. Родитель без дублей: база находит его по телефону (триггер trial_before).
export function TrialForm({ onSaved }: { onSaved: () => void }) {
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [same, setSame] = useState<{ child_name: string; status: string; created_at: string }[]>([])
  const refs = useLoad(async () => {
    const [branches, dances, groups] = await Promise.all([loadBranches(), loadDances(), loadGroups()])
    if (branches.length === 1) setF((x) => ({ ...x, branch_id: branches[0].id }))
    return { branches, dances, groups }
  }, [])

  async function checkPhone(p: string) {
    if (normPhone(p).length < 11) return setSame([])
    const r = await sb.from('trial_leads').select('child_name, status, created_at, parents!inner(phone_norm)').eq('parents.phone_norm', normPhone(p)).order('created_at', { ascending: false })
    setSame((r.data as unknown as typeof same) ?? [])
    const par = await sb.from('parents').select('full_name').eq('phone_norm', normPhone(p)).maybeSingle()
    const name = par.data?.full_name
    if (name) setF((x) => (x.parent_name ? x : { ...x, parent_name: name }))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const ok = await act(async () => {
      if (!f.child_name.trim()) throw new Error('Введите имя ребёнка')
      if (normPhone(f.phone).length < 11) throw new Error('Укажите телефон родителя полностью')
      if (!f.branch_id) throw new Error('Выберите филиал')
      must(
        await sb.from('trial_leads').insert({
          parent_name: f.parent_name.trim() || null,
          phone: f.phone.trim(),
          child_name: f.child_name.trim(),
          child_birth_date: f.child_birth_date || null,
          branch_id: f.branch_id,
          dance_type_id: f.dance_type_id || null,
          group_id: f.group_id || null,
          trial_at: fromLocalInput(f.trial_at),
          status: f.trial_at ? 'booked' : 'new',
          source: f.source,
          comment: f.comment.trim() || null,
        }),
      )
    }, 'Заявка сохранена')
    setBusy(false)
    if (ok) {
      setF({ ...blank, branch_id: refs.data?.branches.length === 1 ? refs.data.branches[0].id : '' })
      setSame([])
      onSaved()
    }
  }

  const d = refs.data
  return (
    <form className="form-grid" onSubmit={save}>
      <Field label="Телефон родителя *">
        <input value={f.phone} inputMode="tel" placeholder="+7 700 000 00 00" onChange={(e) => setF({ ...f, phone: e.target.value })} onBlur={(e) => checkPhone(e.target.value)} />
      </Field>
      <Field label="Имя родителя">
        <input value={f.parent_name} onChange={(e) => setF({ ...f, parent_name: e.target.value })} />
      </Field>
      {same.length > 0 && (
        <div className="alert full">
          С этого номера уже есть заявки: {same.map((s) => `${s.child_name} — ${TRIAL_STATUS[s.status]}`).join('; ')}. Новая заявка привяжется к тому же родителю.
        </div>
      )}
      <Field label="Имя ребёнка *">
        <input value={f.child_name} onChange={(e) => setF({ ...f, child_name: e.target.value })} />
      </Field>
      <Field label="Дата рождения ребёнка">
        <input type="date" value={f.child_birth_date} onChange={(e) => setF({ ...f, child_birth_date: e.target.value })} />
      </Field>
      <Field label="Филиал *">
        <select value={f.branch_id} onChange={(e) => setF({ ...f, branch_id: e.target.value, group_id: '' })}>
          <option value="">—</option>
          {d?.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Направление">
        <select value={f.dance_type_id} onChange={(e) => setF({ ...f, dance_type_id: e.target.value })}>
          <option value="">—</option>
          {d?.dances.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Группа">
        <select value={f.group_id} onChange={(e) => setF({ ...f, group_id: e.target.value })}>
          <option value="">—</option>
          {d?.groups.filter((g) => g.branch_id === f.branch_id).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Дата и время пробного" hint="Если указать — статус «Записан на пробное»">
        <input type="datetime-local" value={f.trial_at} onChange={(e) => setF({ ...f, trial_at: e.target.value })} />
      </Field>
      <Field label="Источник">
        <select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
          {SOURCES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      <Field label="Комментарий" full>
        <textarea value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} />
      </Field>
      <div className="full">
        <button className="btn" disabled={busy}>
          {busy ? 'Сохранение…' : 'Сохранить заявку'}
        </button>
      </div>
    </form>
  )
}

// Страница отдела продаж: форма и последние свои заявки.
export default function TrialFill() {
  const me = useMe()
  const mine = useLoad(
    async () =>
      must(
        await sb.from('trial_leads').select('id, child_name, phone, status, trial_at, created_at').eq('manager_id', me.id).order('created_at', { ascending: false }).limit(15),
      ) as { id: string; child_name: string; phone: string | null; status: string; trial_at: string | null; created_at: string }[],
    [me.id],
  )
  return (
    <>
      <PageHead title="Заполнение пробников" sub="Новая заявка на пробное занятие" />
      <section className="card">
        <TrialForm onSaved={mine.reload} />
      </section>
      <section className="card flush">
        <div className="board-head">
          <b>Мои последние заявки</b>
        </div>
        <State loading={mine.loading} error={mine.error}>
          {mine.data?.length ? (
            <div className="table-wrap">
              <table>
                <tbody>
                  {mine.data.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <b>{t.child_name}</b>
                        <small className="muted block">{t.phone}</small>
                      </td>
                      <td>{t.trial_at ? fmtDateTime(t.trial_at) : <span className="muted">дата не назначена</span>}</td>
                      <td>
                        <span className="badge gold">{TRIAL_STATUS[t.status]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="Вы ещё не добавляли заявки" icon="plus" />
          )}
        </State>
      </section>
    </>
  )
}
