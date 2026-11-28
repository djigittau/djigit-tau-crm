import { useState } from 'react'
import { sb } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Empty, Modal, Field, Icon, act, toast, TZ } from '../lib/ui'
import { loadBranches, loadTrainers, WEEKDAYS, LESSON_STATUS } from '../lib/refs'
import { TrainerTiles, GroupPupils, useTrainers } from './GroupsBrowse'

type Lesson = {
  id: string
  starts_at: string
  duration_min: number
  status: 'scheduled' | 'completed' | 'cancelled'
  cancel_reason: string | null
  trainer_id: string | null
  branch_id: string
  group_id: string
  groups: { name: string; age_category: string | null } | null
  trainer: { full_name: string } | null
  branch: { name: string } | null
}

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
function monday(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const hm = (t: string) => new Date(t).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
const dayKey = (t: string | Date) => new Date(t).toLocaleDateString('sv-SE', { timeZone: TZ }) // YYYY-MM-DD по Алматы

export default function Schedule() {
  const me = useMe()
  const office = ['director', 'manager', 'admin'].includes(me.role)
  const [week, setWeek] = useState(() => monday(new Date()))
  const [branchF, setBranchF] = useState('')
  const [sel, setSel] = useState<Lesson | null>(null)
  const [reason, setReason] = useState('')
  const [trainer, setTrainer] = useState('')
  const [onward, setOnward] = useState(false)
  const [view, setView] = useState<'trainers' | 'week'>(me.role === 'director' ? 'trainers' : 'week')
  const [who, setWho] = useState<string | null>(null) // выбранный тренер в виде «По тренерам»; 'none' — без тренера
  const staff = useTrainers()

  const { data, loading, error, reload } = useLoad(async () => {
    const [lessons, branches, trainers] = await Promise.all([
      sb
        .from('lessons')
        .select('id, starts_at, duration_min, status, cancel_reason, trainer_id, branch_id, group_id, groups(name, age_category), trainer:profiles!lessons_trainer_id_fkey(full_name), branch:branches(name)')
        .gte('starts_at', addDays(week, -1).toISOString()) // запас в сутки: неделя считается по Алматы
        .lt('starts_at', addDays(week, 8).toISOString())
        .order('starts_at')
        .then(must),
      loadBranches(),
      office ? loadTrainers() : Promise.resolve([]),
    ])
    return { lessons: lessons as unknown as Lesson[], branches, trainers }
  }, [week.getTime(), office])

  const inBranch = (data?.lessons ?? []).filter((l) => !branchF || l.branch_id === branchF)
  const byTrainer = view === 'trainers' && office
  const lessons = byTrainer && who ? inBranch.filter((l) => (who === 'none' ? !l.trainer_id : l.trainer_id === who)) : inBranch
  const whoP = staff.data?.find((t) => t.id === who) ?? null
  const todayIso = dayKey(new Date())

  async function generate() {
    const ids = branchF ? [branchF] : (data?.branches ?? []).map((b) => b.id)
    if (!ids.length) return act(async () => { throw new Error('Нет филиалов') })
    let total = 0
    const ok = await act(async () => {
      for (const b of ids) total += must(await sb.rpc('generate_lessons', { p_from: iso(week), p_to: iso(addDays(week, 13)), p_branch: b })) as number
    })
    if (!ok) return
    reload()
    if (total) return toast(`Добавлено занятий: ${total}`)
    // Ничего не создано: либо всё уже есть, либо у активных групп не заданы дни и время.
    const { count } = await sb.from('group_slots').select('group_id, groups!inner(branch_id, status)', { count: 'exact', head: true }).in('groups.branch_id', ids).eq('groups.status', 'active')
    toast(count ? 'Все занятия на 2 недели уже в расписании' : 'У групп не заданы дни и время. Откройте «Группы» → группа → «Изменить» → «Добавить день».', !count)
  }

  function pick(l: Lesson) {
    setSel(l)
    setTrainer(l.trainer_id ?? '')
    setOnward(false)
  }

  // Сменить тренера: только это занятие или это и все следующие запланированные занятия группы.
  async function reassign() {
    if (!sel) return
    const q = sb.from('lessons').update({ trainer_id: trainer || null })
    const ok = await act(
      async () => must(await (onward ? q.eq('group_id', sel.group_id).eq('status', 'scheduled').gte('starts_at', sel.starts_at) : q.eq('id', sel.id))),
      onward ? 'Тренер изменён в этом и следующих занятиях' : 'Тренер изменён',
    )
    if (ok) {
      setSel(null)
      reload()
    }
  }

  async function update(patch: Partial<Lesson>, msg: string) {
    if (!sel) return
    if (await act(async () => must(await sb.from('lessons').update(patch).eq('id', sel.id)), msg)) {
      setSel(null)
      setReason('')
      reload()
    }
  }

  return (
    <>
      <PageHead
        title="Расписание"
        sub={`${week.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} — ${addDays(week, 6).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`}
      >
        {office && (
          <button className="btn" onClick={generate} title="Создать занятия по дням групп на 2 недели вперёд">
            <Icon name="plus" /> Сформировать на 2 недели
          </button>
        )}
      </PageHead>
      {office && (
        <div className="seg" role="tablist" style={{ marginBottom: 12 }}>
          <button className={view === 'trainers' ? 'on' : ''} onClick={() => setView('trainers')}>
            По тренерам
          </button>
          <button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>
            Вся неделя
          </button>
        </div>
      )}
      {byTrainer && who && (
        <div className="row" style={{ alignItems: 'center', marginBottom: 12 }}>
          <button className="btn ghost sm" style={{ width: 'fit-content' }} onClick={() => setWho(null)}>
            ← Все тренеры
          </button>
          <b>{who === 'none' ? 'Занятия без тренера' : whoP?.full_name}</b>
        </div>
      )}
      <div className="toolbar">
        <button className="btn ghost" onClick={() => setWeek(addDays(week, -7))} aria-label="Предыдущая неделя">
          ←
        </button>
        <button className="btn ghost" onClick={() => setWeek(monday(new Date()))}>
          Эта неделя
        </button>
        <button className="btn ghost" onClick={() => setWeek(addDays(week, 7))} aria-label="Следующая неделя">
          →
        </button>
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
      </div>
      <State loading={loading || staff.loading} error={error ?? staff.error}>
        {byTrainer && !who ? (
          <TrainerTiles
            items={[
              ...(staff.data ?? []).map((p) => ({ id: p.id, p })),
              ...(inBranch.some((l) => !l.trainer_id) ? [{ id: 'none', p: null }] : []),
            ].map((x) => {
              const n = inBranch.filter((l) => (x.id === 'none' ? !l.trainer_id : l.trainer_id === x.id)).length
              return { ...x, line: `Занятий на неделе: ${n}` }
            })}
            onPick={setWho}
          />
        ) : lessons.length ? (
          <div className="week">
            {WEEKDAYS.map((d, i) => {
              const day = iso(addDays(week, i))
              const items = lessons.filter((l) => dayKey(l.starts_at) === day)
              return (
                <div key={d} className={'day' + (day === todayIso ? ' today' : '')}>
                  <h4>
                    {d} <span>{addDays(week, i).getDate()}</span>
                  </h4>
                  {items.map((l) => (
                    <button key={l.id} className={'lesson ' + l.status} onClick={() => pick(l)}>
                      <b>
                        {hm(l.starts_at)}–{hm(new Date(new Date(l.starts_at).getTime() + l.duration_min * 60000).toISOString())}
                      </b>
                      <span>{l.groups?.name}</span>
                      <small>{l.trainer?.full_name ?? 'тренер не назначен'}</small>
                      {l.status !== 'scheduled' && <em>{LESSON_STATUS[l.status]}</em>}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        ) : (
          <section className="card">
            <Empty
              text={
                office
                  ? 'На эту неделю занятий нет. Задайте дни и время в «Группах», затем нажмите «Сформировать на 2 недели».'
                  : 'На эту неделю занятий нет'
              }
              icon="clock"
            />
          </section>
        )}
      </State>

      {sel && (
        <Modal title={`${sel.groups?.name} · ${new Date(sel.starts_at).toLocaleDateString('ru-RU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })}`} onClose={() => setSel(null)}>
          <dl className="props">
            <dt>Время</dt>
            <dd>
              {hm(sel.starts_at)}, {sel.duration_min} мин
            </dd>
            <dt>Филиал</dt>
            <dd>{sel.branch?.name}</dd>
            <dt>Возраст</dt>
            <dd>{sel.groups?.age_category ?? '—'}</dd>
            <dt>Статус</dt>
            <dd>
              {LESSON_STATUS[sel.status]}
              {sel.cancel_reason && <span className="muted"> · {sel.cancel_reason}</span>}
            </dd>
            {!office && (
              <>
                <dt>Тренер</dt>
                <dd>{sel.trainer?.full_name ?? '—'}</dd>
              </>
            )}
          </dl>
          {office && (
            <div className="form-grid">
              <Field label="Тренер занятия" hint="Замена: выберите другого тренера филиала и нажмите «Сменить тренера»" full>
                <select value={trainer} onChange={(e) => setTrainer(e.target.value)}>
                  <option value="">не назначен</option>
                  {data?.trainers.filter((t) => t.branches.includes(sel.branch_id)).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="check full">
                <input type="checkbox" checked={onward} onChange={(e) => setOnward(e.target.checked)} /> И во всех следующих занятиях этой группы
              </label>
              <div className="full">
                <button className="btn" disabled={trainer === (sel.trainer_id ?? '') && !onward} onClick={reassign}>
                  Сменить тренера
                </button>
              </div>
              {sel.status === 'cancelled' ? (
                <div className="full">
                  <button className="btn ghost" onClick={() => update({ status: 'scheduled', cancel_reason: null }, 'Занятие восстановлено')}>
                    Вернуть в расписание
                  </button>
                </div>
              ) : (
                <>
                  <Field label="Причина отмены" full>
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Например, праздник" />
                  </Field>
                  <div className="full row">
                    <button
                      className="btn danger"
                      onClick={() => (reason.trim() ? update({ status: 'cancelled', cancel_reason: reason.trim() }, 'Занятие отменено') : act(async () => { throw new Error('Укажите причину отмены') }))}
                    >
                      Отменить занятие
                    </button>
                    {sel.status === 'scheduled' && (
                      <button className="btn ghost" onClick={() => update({ status: 'completed' }, 'Отмечено как проведённое')}>
                        Отметить проведённым
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          {office && (
            <>
              <h3>Ученики группы</h3>
              <GroupPupils groupId={sel.group_id} />
            </>
          )}
        </Modal>
      )}
    </>
  )
}
