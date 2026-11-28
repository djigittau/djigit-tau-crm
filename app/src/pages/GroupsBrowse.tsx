import { useState } from 'react'
import { sb, type Profile } from '../lib/supabase'
import { useLoad, must, State, Empty, Modal, initials, tenure, years } from '../lib/ui'
import { studentPhotoUrl } from '../lib/photo'
import { age, STUDENT_STATUS, WEEKDAYS } from '../lib/refs'
import { StaffHead, StaffProps } from './StaffCard'
import { StudentInfo, STUDENT_SELECT, type StudentRow } from './Students'
import SaleModal from './SaleModal'

// Группы «по тренерам»: тренеры → группы тренера → ученики группы → профиль ученика (в «Учениках»).
export type BrowseGroup = {
  id: string
  name: string
  branch_id: string
  capacity: number | null
  duration_min: number
  status: 'active' | 'archived'
  branch: { name: string } | null
  group_trainers: { trainer_id: string }[]
  group_slots: { weekday: number; start_time: string }[]
  group_members: { left_at: string | null }[]
}

const NONE = 'none' // группы без тренера
const slotText = (g: BrowseGroup) =>
  [...g.group_slots].sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time)).map((x) => `${WEEKDAYS[x.weekday - 1]} ${x.start_time.slice(0, 5)}`).join(', ')
const count = (g: BrowseGroup) => g.group_members.filter((m) => !m.left_at).length

export default function GroupsBrowse({ groups }: { groups: BrowseGroup[] }) {
  const [trainer, setTrainer] = useState<string | null>(null)
  const [group, setGroup] = useState<BrowseGroup | null>(null)
  const { data: trainers, loading, error } = useLoad(
    async () => must(await sb.from('profiles').select('*').eq('role', 'trainer').eq('status', 'active').order('full_name')) as Profile[],
    [],
  )
  const groupsOf = (id: string) => groups.filter((g) => (id === NONE ? !g.group_trainers.length : g.group_trainers.some((t) => t.trainer_id === id)))

  if (group) return <GroupView g={group} onBack={() => setGroup(null)} />

  if (trainer) {
    const p = trainers?.find((t) => t.id === trainer)
    const list = groupsOf(trainer)
    return (
      <>
        <button className="btn ghost sm" style={{ width: "fit-content" }} onClick={() => setTrainer(null)}>
          ← Все тренеры
        </button>
        <section className="card" style={{ marginTop: 12 }}>
          {p ? (
            <>
              <StaffHead p={p} />
              <StaffProps p={p} />
            </>
          ) : (
            <h2 style={{ margin: 0 }}>Группы без тренера</h2>
          )}
        </section>
        <h3 className="section-title">
          Группы · {list.length} · учеников {list.reduce((t, g) => t + count(g), 0)}
        </h3>
        {list.length ? (
          <div className="trial-grid">
            {list.map((g) => (
              <button key={g.id} className="card trial-card tile" onClick={() => setGroup(g)}>
                <h3>{g.name}</h3>
                <div className="muted small">{g.branch?.name}</div>
                <div className="small">{slotText(g) || 'дни не заданы'} · {g.duration_min} мин</div>
                <div className="tile-num">
                  {count(g)}
                  {g.capacity ? <span className="muted"> / {g.capacity}</span> : null} <small className="muted">учеников</small>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Empty text="У тренера нет групп" icon="layers" />
        )}
      </>
    )
  }

  const cards = [...(trainers ?? []).map((t) => ({ id: t.id, p: t as Profile | null })), ...(groupsOf(NONE).length ? [{ id: NONE, p: null }] : [])]
  return (
    <State loading={loading} error={error}>
      {cards.length ? (
        <div className="trial-grid">
          {cards.map(({ id, p }) => {
            const list = groupsOf(id)
            return (
              <button key={id} className="card tile person-tile" onClick={() => setTrainer(id)}>
                <span className="avatar xl">{p?.photo_url ? <img src={p.photo_url} alt="" /> : p ? initials(p.full_name) : '—'}</span>
                <div>
                  <h3>{p?.full_name ?? 'Без тренера'}</h3>
                  {p && <small className="muted block">{tenure(p.hired_at) ? `Стаж: ${tenure(p.hired_at)}` : 'Стаж не указан'}</small>}
                  <small className="block">
                    Групп: {list.length} · учеников: {list.reduce((t, g) => t + count(g), 0)}
                  </small>
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <Empty text="Тренеров пока нет" icon="users" />
      )}
    </State>
  )
}

type Pupil = { id: string; full_name: string; birth_date: string | null; photo_path: string | null; status: string; parent: { full_name: string; phone: string } | null }

function GroupView({ g, onBack }: { g: BrowseGroup; onBack: () => void }) {
  const { data, loading, error } = useLoad(async () => {
    const m = must(await sb.from('group_members').select('student_id').eq('group_id', g.id).is('left_at', null)) as { student_id: string }[]
    if (!m.length) return [] as Pupil[]
    return must(
      await sb.from('students').select('id, full_name, birth_date, photo_path, status, parent:parents(full_name, phone)').in('id', m.map((x) => x.student_id)).order('full_name'),
    ) as unknown as Pupil[]
  }, [g.id])
  const [open, setOpen] = useState<string | null>(null)
  return (
    <>
      {open && <StudentModal id={open} groupId={g.id} onClose={() => setOpen(null)} />}
      <button className="btn ghost sm" style={{ width: "fit-content" }} onClick={onBack}>
        ← Группы тренера
      </button>
      <section className="card" style={{ marginTop: 12 }}>
        <h2 style={{ margin: '0 0 4px' }}>{g.name}</h2>
        <div className="muted">
          {g.branch?.name} · {slotText(g) || 'дни не заданы'} · {g.duration_min} мин
        </div>
        <div className="tile-num" style={{ marginTop: 8 }}>
          {count(g)}
          {g.capacity ? <span className="muted"> / {g.capacity}</span> : null} <small className="muted">учеников</small>
        </div>
      </section>
      <State loading={loading} error={error}>
        {data?.length ? (
          <div className="trial-grid">
            {data.map((s) => (
              <button key={s.id} className="card tile person-tile" onClick={() => setOpen(s.id)}>
                <PupilAvatar s={s} />
                <div>
                  <h3>{s.full_name}</h3>
                  <small className="muted block">
                    {s.birth_date ? years(age(s.birth_date)!) : 'возраст не указан'} · {STUDENT_STATUS[s.status]}
                  </small>
                  {s.parent && (
                    <small className="block">
                      {s.parent.full_name}, {s.parent.phone}
                    </small>
                  )}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Empty text="В группе пока нет учеников" icon="users" />
        )}
      </State>
    </>
  )
}

function PupilAvatar({ s }: { s: Pupil }) {
  const { data: url } = useLoad(() => studentPhotoUrl(s.photo_path), [s.photo_path])
  return <span className="avatar xl">{url ? <img src={url} alt="" /> : initials(s.full_name)}</span>
}

// Профиль ученика прямо в «Группах»: те же данные, что в «Учениках», и продажа абонемента.
function StudentModal({ id, groupId, onClose }: { id: string; groupId: string; onClose: () => void }) {
  const { data: s, reload } = useLoad(async () => must(await sb.from('students').select(STUDENT_SELECT).eq('id', id).single()) as unknown as StudentRow, [id])
  const [selling, setSelling] = useState(false)
  if (selling && s)
    return (
      <SaleModal
        studentId={s.id}
        branchId={s.branch_id}
        groupId={groupId}
        title={s.full_name}
        onClose={() => setSelling(false)}
        onDone={() => {
          setSelling(false)
          reload()
        }}
      />
    )
  return (
    <Modal
      title="Карточка ученика"
      onClose={onClose}
      footer={
        <button className="btn ghost" onClick={() => setSelling(true)} disabled={!s}>
          Продать абонемент
        </button>
      }
    >
      {s ? <StudentInfo s={s} canEdit showParent onPhoto={() => reload()} /> : <p className="muted">Загрузка…</p>}
    </Modal>
  )
}
