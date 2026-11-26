import { useState } from 'react'
import { sb } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Empty, Icon, act, TZ } from '../lib/ui'
import { today } from '../lib/refs'

type Lesson = {
  id: string
  group_id: string
  branch_id: string
  starts_at: string
  duration_min: number
  status: 'scheduled' | 'completed' | 'cancelled'
  cancel_reason: string | null
  groups: { name: string } | null
  trainer: { full_name: string } | null
}
type Status = 'present' | 'absent' | 'excused' | 'makeup'
type Mark = { student_id: string; status: Status; note: string | null; students: { full_name: string } | null }
const MARK: Record<Status, string> = { present: 'Был', absent: 'Не был', excused: 'Уважительная', makeup: 'Отработка' }

const hm = (t: string) => new Date(t).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
// Сутки по Алматы (UTC+5, без перехода на летнее время).
const dayRange = (d: string) => [new Date(`${d}T00:00:00+05:00`).toISOString(), new Date(`${d}T24:00:00+05:00`).toISOString()]

export default function Attendance() {
  const me = useMe()
  const [day, setDay] = useState(today())
  const [lessonId, setLessonId] = useState('')

  const lessons = useLoad(async () => {
    const [from, to] = dayRange(day)
    return must(
      await sb
        .from('lessons')
        .select('id, group_id, branch_id, starts_at, duration_min, status, cancel_reason, groups(name), trainer:profiles!lessons_trainer_id_fkey(full_name)')
        .gte('starts_at', from)
        .lt('starts_at', to)
        .order('starts_at'),
    ) as unknown as Lesson[]
  }, [day])

  const lesson = lessons.data?.find((l) => l.id === lessonId) ?? lessons.data?.[0]

  return (
    <>
      <PageHead title="Посещаемость" sub="Выберите занятие и отметьте каждого ученика" />
      <div className="toolbar">
        <input
          type="date"
          value={day}
          onChange={(e) => {
            setDay(e.target.value)
            setLessonId('')
          }}
          aria-label="Дата"
          style={{ width: 'auto' }}
        />
      </div>
      <State loading={lessons.loading} error={lessons.error}>
        {lessons.data?.length ? (
          <>
            <div className="lesson-tabs">
              {lessons.data.map((l) => (
                <button key={l.id} className={'lesson-tab' + (l.id === lesson?.id ? ' on' : '') + (l.status === 'cancelled' ? ' cancelled' : '')} onClick={() => setLessonId(l.id)}>
                  <b>{hm(l.starts_at)}</b> {l.groups?.name}
                  <small>{l.trainer?.full_name ?? ''}</small>
                </button>
              ))}
            </div>
            {lesson && <Board key={lesson.id} lesson={lesson} day={day} />}
          </>
        ) : (
          <section className="card">
            <Empty text={me.role === 'trainer' ? 'В этот день у вас нет занятий' : 'В этот день занятий нет. Занятия создаются в «Расписании».'} icon="calendar" />
          </section>
        )}
      </State>
    </>
  )
}

function Board({ lesson, day }: { lesson: Lesson; day: string }) {
  const [extra, setExtra] = useState('')
  const { data, loading, error, reload } = useLoad(async () => {
    const [members, marks, branchStudents, history] = await Promise.all([
      sb.from('group_members').select('student_id, joined_at, left_at, students(full_name, status)').eq('group_id', lesson.group_id).then(must),
      sb.from('attendance').select('student_id, status, note, students(full_name)').eq('lesson_id', lesson.id).then(must),
      sb.from('students').select('id, full_name').eq('branch_id', lesson.branch_id).eq('status', 'active').order('full_name').then(must),
      // последние 30 дней этой группы — для процента посещаемости
      sb
        .from('lessons')
        .select('id, attendance(student_id, status)')
        .eq('group_id', lesson.group_id)
        .neq('status', 'cancelled')
        .gte('starts_at', new Date(Date.now() - 30 * 864e5).toISOString())
        .then(must),
    ])
    type M = { student_id: string; joined_at: string; left_at: string | null; students: { full_name: string; status: string } | null }
    const roster = (members as unknown as M[])
      .filter((m) => m.joined_at <= day && (!m.left_at || m.left_at >= day) && m.students)
      .map((m) => ({ id: m.student_id, name: m.students!.full_name }))
    const markMap = new Map((marks as unknown as Mark[]).map((m) => [m.student_id, m]))
    // ученики на отработке (не из этой группы) тоже показываются
    for (const m of markMap.values()) if (!roster.some((r) => r.id === m.student_id)) roster.push({ id: m.student_id, name: m.students?.full_name ?? 'Ученик' })
    const stat = new Map<string, { ok: number; all: number }>()
    for (const l of history as unknown as { attendance: { student_id: string; status: Status }[] }[])
      for (const a of l.attendance) {
        const s = stat.get(a.student_id) ?? { ok: 0, all: 0 }
        s.all++
        if (a.status === 'present' || a.status === 'makeup') s.ok++
        stat.set(a.student_id, s)
      }
    return { roster: roster.sort((a, b) => a.name.localeCompare(b.name)), markMap, stat, branchStudents: branchStudents as { id: string; full_name: string }[] }
  }, [lesson.id])

  async function mark(student_id: string, status: Status, note?: string | null) {
    const cur = data?.markMap.get(student_id)
    const row = { lesson_id: lesson.id, student_id, status, note: note !== undefined ? note : status === 'present' ? null : cur?.note ?? null }
    if (await act(async () => must(await sb.from('attendance').upsert(row, { onConflict: 'lesson_id,student_id' })))) reload()
  }

  if (lesson.status === 'cancelled')
    return (
      <section className="card">
        <Empty text={`Занятие отменено${lesson.cancel_reason ? ': ' + lesson.cancel_reason : ''}. Отметки не ставятся.`} icon="x" />
      </section>
    )

  const marked = data ? [...data.markMap.values()] : []
  const present = marked.filter((m) => m.status === 'present' || m.status === 'makeup').length

  return (
    <State loading={loading} error={error}>
      {data && (
        <section className="card flush">
          <div className="board-head">
            <div>
              <b>{lesson.groups?.name}</b> · {hm(lesson.starts_at)}, {lesson.duration_min} мин
            </div>
            <div className="muted">
              Отмечено {marked.length} из {data.roster.length} · присутствуют {present}
            </div>
          </div>
          {data.roster.length ? (
            <div className="table-wrap">
              <table className="stack">
                <thead>
                  <tr>
                    <th>Ученик</th>
                    <th>Отметка</th>
                    <th>Причина / комментарий</th>
                    <th className="num">За 30 дней</th>
                  </tr>
                </thead>
                <tbody>
                  {data.roster.map((s) => {
                    const m = data.markMap.get(s.id)
                    const st = data.stat.get(s.id)
                    return (
                      <tr key={s.id}>
                        <td>
                          <b>{s.name}</b>
                        </td>
                        <td>
                          <div className="marks" role="group" aria-label={`Отметка: ${s.name}`}>
                            {(['present', 'absent', 'excused'] as Status[]).map((k) => (
                              <button key={k} className={'mark ' + k + (m?.status === k ? ' on' : '')} aria-pressed={m?.status === k} onClick={() => mark(s.id, k)}>
                                {MARK[k]}
                              </button>
                            ))}
                            {m?.status === 'makeup' && <span className="mark makeup on">Отработка</span>}
                          </div>
                        </td>
                        <td className={m && m.status !== 'present' ? '' : 'opt'}>
                          {m && m.status !== 'present' ? (
                            <input
                              defaultValue={m.note ?? ''}
                              placeholder={m.status === 'absent' ? 'Почему не пришёл' : 'Причина'}
                              onBlur={(e) => e.target.value !== (m.note ?? '') && mark(s.id, m.status, e.target.value.trim() || null)}
                              aria-label="Причина"
                            />
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="num" data-label="За 30 дней">{st ? `${Math.round((st.ok / st.all) * 100)}% (${st.ok}/${st.all})` : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="В группе на эту дату нет учеников" icon="users" />
          )}
          <form
            className="row board-foot"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!extra) return
              await mark(extra, 'makeup')
              setExtra('')
            }}
          >
            <select value={extra} onChange={(e) => setExtra(e.target.value)} aria-label="Ученик на отработку">
              <option value="">Ученик из другой группы на отработку…</option>
              {data.branchStudents.filter((s) => !data.roster.some((r) => r.id === s.id)).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>
            <button className="btn ghost" disabled={!extra}>
              <Icon name="plus" /> Отметить отработку
            </button>
          </form>
        </section>
      )}
    </State>
  )
}
