import { useState } from 'react'
import { sb } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Empty, Modal, Field, Icon, act } from '../lib/ui'
import { danceId, loadBranches, loadDances, loadTrainers, WEEKDAYS } from '../lib/refs'
import { DanceInput } from '../lib/DanceInput'

type Slot = { weekday: number; start_time: string }
type Row = {
  id: string
  name: string
  branch_id: string
  dance_type_id: string | null
  age_category: string | null
  duration_min: number
  capacity: number | null
  status: 'active' | 'archived'
  branch: { name: string } | null
  dance: { name: string } | null
  group_trainers: { trainer_id: string; profiles: { full_name: string } | null }[]
  group_slots: Slot[]
  group_members: { left_at: string | null; students: { id: string; full_name: string } | null }[]
}
type Draft = {
  id?: string
  name: string
  branch_id: string
  dance: string // название направления: можно вписать новое
  age_category: string
  duration_min: string
  capacity: string
  status: 'active' | 'archived'
  trainers: string[]
  slots: Slot[]
}

const slotText = (s: Slot[]) =>
  [...s].sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time)).map((x) => `${WEEKDAYS[x.weekday - 1]} ${x.start_time.slice(0, 5)}`).join(', ')

export default function Groups() {
  const me = useMe()
  const canEdit = ['director', 'manager', 'admin'].includes(me.role)
  const [q, setQ] = useState('')
  const [branchF, setBranchF] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [card, setCard] = useState<Row | null>(null)
  const [newDance, setNewDance] = useState('')

  const { data, loading, error, reload } = useLoad(async () => {
    const [groups, branches, dances, trainers] = await Promise.all([
      sb
        .from('groups')
        .select('*, branch:branches(name), dance:dance_types(name), group_trainers(trainer_id, profiles(full_name)), group_slots(weekday, start_time), group_members(left_at, students(id, full_name))')
        .order('name')
        .then(must),
      loadBranches(),
      loadDances(true),
      canEdit ? loadTrainers() : Promise.resolve([]),
    ])
    return { groups: groups as unknown as Row[], branches, dances, trainers }
  }, [canEdit])

  const members = (g: Row) => g.group_members.filter((m) => !m.left_at)
  const list = (data?.groups ?? []).filter(
    (g) => (showArchived || g.status === 'active') && (!branchF || g.branch_id === branchF) && (!q || g.name.toLowerCase().includes(q.toLowerCase())),
  )

  function open(g?: Row) {
    setDraft({
      id: g?.id,
      name: g?.name ?? '',
      branch_id: g?.branch_id ?? (data?.branches.length === 1 ? data.branches[0].id : ''),
      dance: g?.dance?.name ?? '',
      age_category: g?.age_category ?? '',
      duration_min: String(g?.duration_min ?? 60),
      capacity: g?.capacity ? String(g.capacity) : '',
      status: g?.status ?? 'active',
      trainers: g?.group_trainers.map((t) => t.trainer_id) ?? [],
      slots: g?.group_slots.map((s) => ({ ...s, start_time: s.start_time.slice(0, 5) })) ?? [],
    })
  }

  async function save() {
    if (!draft) return
    const ok = await act(async () => {
      if (!draft.name.trim()) throw new Error('Введите название группы')
      if (!draft.branch_id) throw new Error('Выберите филиал')
      const dur = Number(draft.duration_min)
      if (!(dur >= 15 && dur <= 300)) throw new Error('Продолжительность — от 15 до 300 минут')
      const keys = draft.slots.map((s) => s.weekday + s.start_time)
      if (draft.slots.some((s) => !s.start_time)) throw new Error('Укажите время каждого занятия')
      if (new Set(keys).size !== keys.length) throw new Error('Одинаковое занятие указано дважды')
      const row = {
        name: draft.name.trim(),
        branch_id: draft.branch_id,
        dance_type_id: await danceId(draft.dance),
        age_category: draft.age_category.trim() || null,
        duration_min: dur,
        capacity: draft.capacity ? Number(draft.capacity) : null,
        status: draft.status,
      }
      let id = draft.id
      if (id) must(await sb.from('groups').update(row).eq('id', id))
      else id = (must(await sb.from('groups').insert(row).select('id').single()) as { id: string }).id
      // тренеры и дни занятий — заменить целиком
      must(await sb.from('group_trainers').delete().eq('group_id', id))
      if (draft.trainers.length) must(await sb.from('group_trainers').insert(draft.trainers.map((t) => ({ group_id: id, trainer_id: t }))))
      must(await sb.from('group_slots').delete().eq('group_id', id))
      if (draft.slots.length) must(await sb.from('group_slots').insert(draft.slots.map((s) => ({ group_id: id, weekday: s.weekday, start_time: s.start_time }))))
    }, 'Группа сохранена')
    if (ok) {
      setDraft(null)
      setCard(null)
      reload()
    }
  }

  async function removeMember(g: Row, studentId: string, name: string) {
    if (!confirm(`Убрать «${name}» из группы «${g.name}»? История сохранится.`)) return
    if (await act(async () => must(await sb.rpc('move_student_group', { p_student: studentId, p_group: null })), 'Ученик выведен из группы')) {
      setCard(null)
      reload()
    }
  }

  return (
    <>
      <PageHead title="Группы" sub={data ? `Активных: ${data.groups.filter((g) => g.status === 'active').length}` : undefined}>
        {canEdit && (
          <button className="btn" onClick={() => open()}>
            <Icon name="plus" /> Добавить группу
          </button>
        )}
      </PageHead>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input placeholder="Название группы" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
        </div>
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
        <label className="check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Показать архив
        </label>
      </div>
      <State loading={loading} error={error}>
        <section className="card flush">
          {list.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Группа</th>
                    <th>Филиал</th>
                    <th>Направление</th>
                    <th>Тренер</th>
                    <th>Возраст</th>
                    <th>Расписание</th>
                    <th className="num">Учеников</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((g) => (
                    <tr key={g.id} className="clickable" onClick={() => setCard(g)}>
                      <td>
                        <b>{g.name}</b>
                      </td>
                      <td>{g.branch?.name}</td>
                      <td>{g.dance?.name ?? '—'}</td>
                      <td>{g.group_trainers.map((t) => t.profiles?.full_name).join(', ') || <span className="muted">не назначен</span>}</td>
                      <td>{g.age_category ?? '—'}</td>
                      <td>
                        {slotText(g.group_slots) || '—'}
                        <small className="muted block">{g.duration_min} мин</small>
                      </td>
                      <td className="num">
                        {members(g).length}
                        {g.capacity ? ` / ${g.capacity}` : ''}
                      </td>
                      <td>{g.status === 'active' ? <span className="badge ok">Активна</span> : <span className="badge">Архив</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text={q || branchF ? 'Ничего не найдено' : canEdit ? 'Групп пока нет. Нажмите «Добавить группу».' : 'Групп пока нет'} icon="layers" />
          )}
        </section>

        {canEdit && data && (
          <section className="card narrow">
            <h3>Направления танца</h3>
            <div className="chips">
              {data.dances.map((d) => (
                <button
                  key={d.id}
                  className={'chip' + (d.is_active ? '' : ' off')}
                  title={d.is_active ? 'Нажмите, чтобы скрыть' : 'Нажмите, чтобы вернуть'}
                  onClick={async () => {
                    if (await act(async () => must(await sb.from('dance_types').update({ is_active: !d.is_active }).eq('id', d.id)))) reload()
                  }}
                >
                  {d.name}
                </button>
              ))}
              {!data.dances.length && <span className="muted">Пока нет. Добавьте первое направление.</span>}
            </div>
            <form
              className="row"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!newDance.trim()) return
                if (await act(async () => must(await sb.from('dance_types').insert({ name: newDance.trim() })), 'Направление добавлено')) {
                  setNewDance('')
                  reload()
                }
              }}
            >
              <input placeholder="Например, Лезгинка" value={newDance} onChange={(e) => setNewDance(e.target.value)} aria-label="Новое направление" />
              <button className="btn ghost">
                <Icon name="plus" /> Добавить
              </button>
            </form>
          </section>
        )}
      </State>

      {card && (
        <Modal
          title={card.name}
          onClose={() => setCard(null)}
          footer={
            canEdit && (
              <button className="btn" onClick={() => open(card)}>
                <Icon name="edit" /> Изменить
              </button>
            )
          }
        >
          <dl className="props">
            <dt>Филиал</dt>
            <dd>{card.branch?.name}</dd>
            <dt>Направление</dt>
            <dd>{card.dance?.name ?? '—'}</dd>
            <dt>Тренер</dt>
            <dd>{card.group_trainers.map((t) => t.profiles?.full_name).join(', ') || '—'}</dd>
            <dt>Возраст</dt>
            <dd>{card.age_category ?? '—'}</dd>
            <dt>Расписание</dt>
            <dd>
              {slotText(card.group_slots) || '—'} · {card.duration_min} мин
            </dd>
            <dt>Мест</dt>
            <dd>
              {members(card).length}
              {card.capacity ? ` из ${card.capacity}` : ' (без ограничения)'}
            </dd>
          </dl>
          <h3>Ученики</h3>
          {members(card).length ? (
            <table>
              <tbody>
                {members(card).map((m) => (
                  <tr key={m.students!.id}>
                    <td>{m.students!.full_name}</td>
                    {me.role !== 'trainer' && (
                      <td className="act">
                        <button className="btn ghost sm" onClick={() => removeMember(card, m.students!.id, m.students!.full_name)}>
                          Убрать
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">В группе пока нет учеников. Ученика добавляют в разделе «Ученики».</p>
          )}
        </Modal>
      )}

      {draft && (
        <Modal
          title={draft.id ? 'Изменить группу' : 'Новая группа'}
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
            <Field label="Название *" full>
              <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Филиал *">
              <select value={draft.branch_id} onChange={(e) => setDraft({ ...draft, branch_id: e.target.value, trainers: [] })}>
                <option value="">—</option>
                {data?.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Направление">
              <DanceInput dances={data?.dances.filter((d) => d.is_active) ?? []} value={draft.dance} onChange={(v) => setDraft({ ...draft, dance: v })} />
            </Field>
            <Field label="Возрастная категория">
              <input placeholder="например, 7–10 лет" value={draft.age_category} onChange={(e) => setDraft({ ...draft, age_category: e.target.value })} />
            </Field>
            <Field label="Продолжительность, мин">
              <input type="number" min={15} max={300} value={draft.duration_min} onChange={(e) => setDraft({ ...draft, duration_min: e.target.value })} />
            </Field>
            <Field label="Максимум учеников">
              <input type="number" min={1} placeholder="без ограничения" value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: e.target.value })} />
            </Field>
            <Field label="Статус">
              <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Draft['status'] })}>
                <option value="active">Активна</option>
                <option value="archived">Архив</option>
              </select>
            </Field>
            <div className="field full">
              <span>Тренер</span>
              {data?.trainers.filter((t) => t.branches.includes(draft.branch_id)).length ? (
                <div className="chips">
                  {data.trainers
                    .filter((t) => t.branches.includes(draft.branch_id))
                    .map((t) => (
                      <label key={t.id} className="check chip-check">
                        <input
                          type="checkbox"
                          checked={draft.trainers.includes(t.id)}
                          onChange={(e) => setDraft({ ...draft, trainers: e.target.checked ? [...draft.trainers, t.id] : draft.trainers.filter((x) => x !== t.id) })}
                        />
                        {t.name}
                      </label>
                    ))}
                </div>
              ) : (
                <small>{draft.branch_id ? 'В этом филиале нет тренеров. Директор назначает их в разделе «Сотрудники».' : 'Сначала выберите филиал'}</small>
              )}
            </div>
            <div className="field full">
              <span>Дни и время занятий</span>
              {draft.slots.map((s, i) => (
                <div key={i} className="slot-row">
                  <select value={s.weekday} aria-label="День" onChange={(e) => setDraft({ ...draft, slots: draft.slots.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)) })}>
                    {WEEKDAYS.map((d, k) => (
                      <option key={k} value={k + 1}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <input type="time" value={s.start_time} aria-label="Время" onChange={(e) => setDraft({ ...draft, slots: draft.slots.map((x, j) => (j === i ? { ...x, start_time: e.target.value } : x)) })} />
                  <button type="button" className="icon-btn" aria-label="Удалить" onClick={() => setDraft({ ...draft, slots: draft.slots.filter((_, j) => j !== i) })}>
                    <Icon name="x" />
                  </button>
                </div>
              ))}
              <div>
                <button type="button" className="btn ghost sm" onClick={() => setDraft({ ...draft, slots: [...draft.slots, { weekday: 1, start_time: '18:00' }] })}>
                  <Icon name="plus" size={14} /> Добавить день
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
