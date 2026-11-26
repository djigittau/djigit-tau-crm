import { useId } from 'react'

// Направление танца: вписать своё или выбрать из подсказок. Новое название сохранится в справочник при сохранении формы.
export function DanceInput({ dances, value, onChange }: { dances: { id: string; name: string }[]; value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <>
      <input list={id} value={value} maxLength={60} placeholder="Например, лезгинка" onChange={(e) => onChange(e.target.value)} />
      <datalist id={id}>
        {dances.map((d) => (
          <option key={d.id} value={d.name} />
        ))}
      </datalist>
    </>
  )
}
