import { useSearchParams } from 'react-router-dom'
import { useLoad, State, PageHead } from '../lib/ui'
import { thisMonth } from '../lib/refs'
import { loadMoney, shiftMonth, RevenueDetails, ExpensesDetails, ProfitDetails } from './MoneyDetails'

// Отдельная страница денег (из карточек «Главной»): вкладки, месяц и кнопка «Сравнить» со вторым месяцем.
// Состояние в адресе (?tab=inc&m=2026-10&cmp=2026-09) — «Назад» в браузере возвращает к прежнему виду.
const TABS = [
  ['inc', 'Выручка'],
  ['out', 'Расходы'],
  ['profit', 'Прибыль'],
] as const

export default function Money() {
  const [q, setQ] = useSearchParams()
  const tab = (q.get('tab') ?? 'inc') as (typeof TABS)[number][0]
  const m = q.get('m') ?? thisMonth()
  const cmp = q.get('cmp')
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(q)
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k))
    setQ(next, { replace: true })
  }
  // Полгода до месяца (для истории) и второй месяц, если выбран.
  const first = [shiftMonth(m, -5), cmp ?? m].sort()[0]
  const last = [m, cmp ?? m].sort()[1]
  const { data, loading, error } = useLoad(() => loadMoney(first, last), [first, last])
  const P = tab === 'out' ? ExpensesDetails : tab === 'profit' ? ProfitDetails : RevenueDetails

  return (
    <>
      <PageHead title={TABS.find(([k]) => k === tab)?.[1] ?? 'Деньги'} sub="Подробно по месяцу; «Сравнить» — со вторым месяцем" />
      <div className="seg" role="tablist" style={{ marginBottom: 12 }}>
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => set({ tab: k })}>
            {label}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <label className="field" style={{ margin: 0 }}>
          <span>Месяц</span>
          <input type="month" value={m} onChange={(e) => e.target.value && set({ m: e.target.value })} style={{ width: 'auto' }} />
        </label>
        {cmp ? (
          <>
            <label className="field" style={{ margin: 0 }}>
              <span>Сравнить с</span>
              <input type="month" value={cmp} onChange={(e) => e.target.value && set({ cmp: e.target.value })} style={{ width: 'auto' }} />
            </label>
            <button className="btn ghost" style={{ alignSelf: 'flex-end' }} onClick={() => set({ cmp: null })}>
              Без сравнения
            </button>
          </>
        ) : (
          <button className="btn ghost" style={{ alignSelf: 'flex-end' }} onClick={() => set({ cmp: shiftMonth(m, -1) })}>
            Сравнить с другим месяцем
          </button>
        )}
      </div>
      <State loading={loading} error={error}>
        {data && <P d={data} m={m} cmp={cmp} />}
      </State>
    </>
  )
}
