import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { useLoad, must, State, PageHead, Field, act } from '../lib/ui'

// Настройки CRM. Менять может только директор (проверяется RLS).
export default function Settings() {
  const { data, loading, error, reload } = useLoad(async () => {
    const rows = must(await sb.from('crm_settings').select('key, value')) as { key: string; value: unknown }[]
    return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, unknown>
  }, [])
  const [rate, setRate] = useState('')
  useEffect(() => {
    if (data) setRate(String(data.lesson_rate ?? 0))
  }, [data])

  return (
    <>
      <PageHead title="Настройки" />
      <State loading={loading} error={error}>
        <section className="card narrow">
          <h3>Зарплата тренеров</h3>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault()
              const v = Number(rate)
              if (!Number.isFinite(v) || v < 0) return act(async () => { throw new Error('Ставка — число 0 или больше') })
              if (await act(async () => must(await sb.from('crm_settings').upsert({ key: 'lesson_rate', value: v })), 'Ставка сохранена')) reload()
            }}
          >
            <Field label="Ставка за занятие, ₸" hint="Единая для всех тренеров. Оплачиваются все занятия из расписания, кроме отменённых." full>
              <input type="number" min={0} step={1} value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
            <div className="full">
              <button className="btn">Сохранить</button>
            </div>
          </form>
        </section>
        <section className="card narrow">
          <h3>Общие</h3>
          <dl className="props">
            <dt>Часовой пояс</dt>
            <dd>{String(data?.timezone ?? 'Asia/Almaty')}</dd>
            <dt>Валюта</dt>
            <dd>{String(data?.currency ?? 'KZT')}</dd>
          </dl>
        </section>
      </State>
    </>
  )
}
