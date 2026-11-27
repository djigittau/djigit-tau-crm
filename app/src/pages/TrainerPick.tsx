import { useEffect } from 'react'
import { sb } from '../lib/supabase'
import { useLoad, must } from '../lib/ui'

// Тренер пробного урока: тренеры филиала (RPC trial_trainers — доступна продажам и офису).
// При выборе группы подставляется её тренер, если тренер ещё не выбран вручную.
export function TrainerPick({ branch, group, value, onChange }: { branch: string; group: string; value: string; onChange: (v: string) => void }) {
  const { data } = useLoad(
    async () => (branch ? (must(await sb.rpc('trial_trainers', { p_branch: branch })) as { id: string; full_name: string; groups: string[] }[]) : []),
    [branch],
  )
  useEffect(() => {
    if (!data || !group || value) return
    const t = data.find((x) => x.groups.includes(group))
    if (t) onChange(t.id)
  }, [data, group]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={!branch}>
      <option value="">{branch ? '— не назначен —' : 'Сначала выберите филиал'}</option>
      {data?.map((t) => (
        <option key={t.id} value={t.id}>
          {t.full_name}
        </option>
      ))}
    </select>
  )
}
