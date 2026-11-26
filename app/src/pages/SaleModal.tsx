import { useState } from 'react'
import { sb } from '../lib/supabase'
import { useLoad, must, Modal, Field, act, money } from '../lib/ui'
import { METHODS } from '../lib/refs'

// Продажа абонемента: ученик (или пробник → новый ученик), группа, продажа и платёж — одной функцией в базе.
export default function SaleModal({
  trialId,
  studentId,
  branchId,
  groupId,
  title,
  onClose,
  onDone,
}: {
  trialId?: string
  studentId?: string
  branchId: string
  groupId?: string | null
  title: string
  onClose: () => void
  onDone: () => void
}) {
  // Один ключ на окно: повторное нажатие не создаст вторую продажу.
  const [key] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ group: groupId ?? '', name: '', lessons: '8', price: '', discount: '0', paid: '', method: 'kaspi' })
  const groups = useLoad(
    async () => must(await sb.from('groups').select('id, name').eq('branch_id', branchId).eq('status', 'active').order('name')) as { id: string; name: string }[],
    [branchId],
  )
  const due = Math.max(0, (Number(f.price) || 0) - (Number(f.discount) || 0))
  const paid = f.paid === '' ? due : Number(f.paid)

  async function sell() {
    setBusy(true)
    const ok = await act(async () => {
      if (!f.name.trim()) throw new Error('Укажите название абонемента')
      if (!(Number(f.price) >= 0) || f.price === '') throw new Error('Укажите цену')
      must(
        await sb.rpc('buy_subscription', {
          p_trial: trialId ?? null,
          p_student: studentId ?? null,
          p_group: f.group || null,
          p_title: f.name.trim(),
          p_lessons: f.lessons ? Number(f.lessons) : null,
          p_price: Number(f.price),
          p_discount: Number(f.discount) || 0,
          p_paid: paid,
          p_method: f.method,
          p_key: key,
        }),
      )
    }, 'Абонемент продан')
    setBusy(false)
    if (ok) onDone()
  }

  return (
    <Modal
      title={`Продажа абонемента · ${title}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn" onClick={sell} disabled={busy}>
            {busy ? 'Сохранение…' : `Продать · ${money(paid)}`}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Абонемент *" full>
          <input autoFocus placeholder="например, 8 занятий / месяц" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Группа">
          <select value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })}>
            <option value="">не менять</option>
            {groups.data?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Занятий в абонементе">
          <input type="number" min={1} value={f.lessons} onChange={(e) => setF({ ...f, lessons: e.target.value })} />
        </Field>
        <Field label="Цена, ₸ *">
          <input type="number" min={0} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        </Field>
        <Field label="Скидка, ₸">
          <input type="number" min={0} value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} />
        </Field>
        <Field label="Оплачено сейчас, ₸" hint={`К оплате ${money(due)}. Можно оплатить частично`}>
          <input type="number" min={0} placeholder={String(due)} value={f.paid} onChange={(e) => setF({ ...f, paid: e.target.value })} />
        </Field>
        <Field label="Способ оплаты">
          <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            {Object.entries(METHODS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  )
}
