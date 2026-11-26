import { useState } from 'react'
import { sb, normPhone } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Empty, Modal, Field, Icon, act, fmtDate, fmtDateTime, money, lessons } from '../lib/ui'
import { loadBranches, loadDances, loadGroups, STUDENT_STATUS, GENDER, METHODS, age, today } from '../lib/refs'
import SaleModal from './SaleModal'

type Row = {
  id: string
  full_name: string
  birth_date: string | null
  gender: string | null
  branch_id: string
  dance_type_id: string | null
  start_date: string | null
  status: string
  comment: string | null
  parent: { full_name: string; phone: string } | null
  dance: { name: string } | null
  branch: { name: string } | null
  group_members: { group_id: string; joined_at: string; left_at: string | null; groups: { name: string } | null }[]
}
type Draft = {
  id?: string
  full_name: string
  birth_date: string
  gender: string
  branch_id: string
  group_id: string
  dance_type_id: string
  start_date: string
  status: string
  comment: string
  parent_name: string
  parent_phone: string
}

const currentGroup = (r: Row) => r.group_members.find((m) => !m.left_at)

export default function Students() {
  const me = useMe()
  const canEdit = me.role !== 'trainer'
  const [q, setQ] = useState('')
  const [f, setF] = useState({ branch: '', group: '', status: 'active' })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [card, setCard] = useState<Row | null>(null)
  const [selling, setSelling] = useState<Row | null>(null)

  const { data, loading, error, reload } = useLoad(async () => {
    const [students, branches, groups, dances] = await Promise.all([
      sb
        .from('students')
        .select('*, parent:parents(full_name, phone), dance:dance_types(name), branch:branches(name), group_members(group_id, joined_at, left_at, groups(name))')
        .order('full_name')
        .then(must),
      loadBranches(),
      loadGroups(),
      loadDances(),
    ])
    return { students: students as unknown as Row[], branches, groups, dances }
  }, [])

  const list = (data?.students ?? []).filter((s) => {
    if (f.status && s.status !== f.status) return false
    if (f.branch && s.branch_id !== f.branch) return false
    if (f.group && currentGroup(s)?.group_id !== f.group) return false
    if (!q) return true
    const t = [s.full_name, s.parent?.full_name, s.parent?.phone].join(' ').toLowerCase()
    return t.includes(q.toLowerCase()) || (normPhone(q).length > 3 && normPhone(s.parent?.phone ?? '').includes(normPhone(q)))
  })

  function open(r?: Row) {
    const b = r?.branch_id ?? (data?.branches.length === 1 ? data.branches[0].id : '')
    setDraft({
      id: r?.id,
      full_name: r?.full_name ?? '',
      birth_date: r?.birth_date ?? '',
      gender: r?.gender ?? '',
      branch_id: b,
      group_id: r ? currentGroup(r)?.group_id ?? '' : '',
      dance_type_id: r?.dance_type_id ?? '',
      start_date: r?.start_date ?? today(),
      status: r?.status ?? 'active',
      comment: r?.comment ?? '',
      parent_name: r?.parent?.full_name ?? '',
      parent_phone: r?.parent?.phone ?? '',
    })
  }

  // Подставить имя, если родитель с таким телефоном уже есть среди видимых.
  async function lookupParent(phone: string) {
    if (!draft || normPhone(phone).length < 11 || draft.parent_name) return
    const r = await sb.from('parents').select('full_name').eq('phone_norm', normPhone(phone)).maybeSingle()
    const name = r.data?.full_name
    if (name) setDraft((d) => d && { ...d, parent_name: name })
  }

  async function save() {
    if (!draft) return
    const ok = await act(async () => {
      if (!draft.full_name.trim()) throw new Error('Введите ФИО ученика')
      if (!draft.branch_id) throw new Error('Выберите филиал')
      let parent_id: string | null = null
      if (draft.parent_phone.trim()) parent_id = must(await sb.rpc('find_or_create_parent', { p_name: draft.parent_name, p_phone: draft.parent_phone, p_branch: draft.branch_id })) as string
      const row = {
        full_name: draft.full_name.trim(),
        birth_date: draft.birth_date || null,
        gender: draft.gender || null,
        branch_id: draft.branch_id,
        dance_type_id: draft.dance_type_id || null,
        start_date: draft.start_date || null,
        status: draft.status,
        comment: draft.comment.trim() || null,
        parent_id,
      }
      let id = draft.id
      if (id) must(await sb.from('students').update(row).eq('id', id))
      else {
        id = (must(await sb.from('students').insert(row).select('id').single()) as { id: string }).id
        const saved = id
        setDraft((d) => d && { ...d, id: saved }) // ученик уже сохранён: повторное «Сохранить» не создаст дубль
      }
      const old = data!.students.find((s) => s.id === draft.id)
      const before = old ? currentGroup(old)?.group_id ?? '' : ''
      if (draft.group_id !== before) must(await sb.rpc('move_student_group', { p_student: id, p_group: draft.group_id || null }))
    }, 'Ученик сохранён')
    if (ok) {
      setDraft(null)
      setCard(null)
      reload()
    }
  }

  return (
    <>
      <PageHead title={me.role === 'trainer' ? 'Мои ученики' : 'Ученики'} sub={data ? `Найдено: ${list.length}` : undefined}>
        {canEdit && (
          <button className="btn" onClick={() => open()}>
            <Icon name="plus" /> Добавить ученика
          </button>
        )}
      </PageHead>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input placeholder="Ученик, родитель или телефон" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
        </div>
        {(data?.branches.length ?? 0) > 1 && (
          <select value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value, group: '' })} aria-label="Филиал">
            <option value="">Все филиалы</option>
            {data!.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <select value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} aria-label="Группа">
          <option value="">Все группы</option>
          {data?.groups.filter((g) => !f.branch || g.branch_id === f.branch).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Статус">
          <option value="">Все статусы</option>
          {Object.entries(STUDENT_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <State loading={loading} error={error}>
        <section className="card flush">
          {list.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ученик</th>
                    {me.role !== 'trainer' && <th>Родитель</th>}
                    <th>Группа</th>
                    <th>Направление</th>
                    <th>Филиал</th>
                    <th>Начало</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.id} className="clickable" onClick={() => setCard(s)}>
                      <td>
                        <b>{s.full_name}</b>
                        {age(s.birth_date) != null && <small className="muted"> · {age(s.birth_date)} лет</small>}
                      </td>
                      {me.role !== 'trainer' && (
                        <td>
                          {s.parent ? (
                            <>
                              {s.parent.full_name}
                              <small className="muted block">{s.parent.phone}</small>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      )}
                      <td>{currentGroup(s)?.groups?.name ?? <span className="muted">без группы</span>}</td>
                      <td>{s.dance?.name ?? '—'}</td>
                      <td>{s.branch?.name}</td>
                      <td>{fmtDate(s.start_date)}</td>
                      <td>
                        <span className={'badge ' + (s.status === 'active' ? 'ok' : s.status === 'left' ? 'bad' : 'warn-b')}>{STUDENT_STATUS[s.status]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text={q || f.branch || f.group ? 'Ничего не найдено' : canEdit ? 'Учеников пока нет. Нажмите «Добавить ученика».' : 'В ваших группах пока нет учеников'} icon="users" />
          )}
        </section>
      </State>

      {card && (
        <Modal
          title={card.full_name}
          onClose={() => setCard(null)}
          footer={
            canEdit && (
              <>
                <button className="btn ghost" onClick={() => setSelling(card)}>
                  Продать абонемент
                </button>
                <button className="btn" onClick={() => open(card)}>
                  <Icon name="edit" /> Изменить
                </button>
              </>
            )
          }
        >
          <dl className="props">
            <dt>Статус</dt>
            <dd>{STUDENT_STATUS[card.status]}</dd>
            <dt>Дата рождения</dt>
            <dd>
              {fmtDate(card.birth_date)}
              {age(card.birth_date) != null && ` (${age(card.birth_date)} лет)`}
            </dd>
            <dt>Пол</dt>
            <dd>{card.gender ? GENDER[card.gender] : '—'}</dd>
            {me.role !== 'trainer' && (
              <>
                <dt>Родитель</dt>
                <dd>{card.parent ? `${card.parent.full_name}, ${card.parent.phone}` : '—'}</dd>
              </>
            )}
            <dt>Филиал</dt>
            <dd>{card.branch?.name}</dd>
            <dt>Направление</dt>
            <dd>{card.dance?.name ?? '—'}</dd>
            <dt>Начало обучения</dt>
            <dd>{fmtDate(card.start_date)}</dd>
            <dt>Комментарий</dt>
            <dd>{card.comment ?? '—'}</dd>
          </dl>
          {canEdit && <SalesHistory studentId={card.id} />}
          <AttendanceHistory studentId={card.id} />
          <h3>История групп</h3>
          {card.group_members.length ? (
            <table>
              <tbody>
                {[...card.group_members]
                  .sort((a, b) => b.joined_at.localeCompare(a.joined_at))
                  .map((m, i) => (
                    <tr key={i}>
                      <td>{m.groups?.name}</td>
                      <td className="num">
                        {fmtDate(m.joined_at)} — {m.left_at ? fmtDate(m.left_at) : <span className="badge ok">сейчас</span>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Ещё не был в группах</p>
          )}
        </Modal>
      )}

      {selling && (
        <SaleModal
          studentId={selling.id}
          branchId={selling.branch_id}
          groupId={currentGroup(selling)?.group_id}
          title={selling.full_name}
          onClose={() => setSelling(null)}
          onDone={() => {
            setSelling(null)
            setCard(null)
            reload()
          }}
        />
      )}

      {draft && (
        <Modal
          title={draft.id ? 'Изменить ученика' : 'Новый ученик'}
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
            <Field label="ФИО ученика *" full>
              <input autoFocus value={draft.full_name} onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} />
            </Field>
            <Field label="Дата рождения">
              <input type="date" value={draft.birth_date} onChange={(e) => setDraft({ ...draft, birth_date: e.target.value })} />
            </Field>
            <Field label="Пол">
              <select value={draft.gender} onChange={(e) => setDraft({ ...draft, gender: e.target.value })}>
                <option value="">—</option>
                <option value="male">Мальчик</option>
                <option value="female">Девочка</option>
              </select>
            </Field>
            <Field label="Телефон родителя" hint="Если родитель уже есть в базе — ученик привяжется к нему">
              <input value={draft.parent_phone} inputMode="tel" placeholder="+7 700 000 00 00" onChange={(e) => setDraft({ ...draft, parent_phone: e.target.value })} onBlur={(e) => lookupParent(e.target.value)} />
            </Field>
            <Field label="ФИО родителя">
              <input value={draft.parent_name} onChange={(e) => setDraft({ ...draft, parent_name: e.target.value })} />
            </Field>
            <Field label="Филиал *">
              <select value={draft.branch_id} onChange={(e) => setDraft({ ...draft, branch_id: e.target.value, group_id: '' })} disabled={!!draft.id}>
                <option value="">—</option>
                {data?.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Группа" hint={draft.id ? 'При смене группы история перехода сохранится' : undefined}>
              <select value={draft.group_id} onChange={(e) => setDraft({ ...draft, group_id: e.target.value })}>
                <option value="">без группы</option>
                {data?.groups.filter((g) => g.branch_id === draft.branch_id).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Направление">
              <select value={draft.dance_type_id} onChange={(e) => setDraft({ ...draft, dance_type_id: e.target.value })}>
                <option value="">—</option>
                {data?.dances.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Дата начала обучения">
              <input type="date" value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} />
            </Field>
            <Field label="Статус">
              <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                {Object.entries(STUDENT_STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Комментарий" full>
              <textarea value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}

const ATT: Record<string, string> = { present: 'Был', absent: 'Не был', excused: 'Уважительная', makeup: 'Отработка' }

// Последние 20 отметок ученика.
function AttendanceHistory({ studentId }: { studentId: string }) {
  const { data } = useLoad(
    async () =>
      must(
        await sb
          .from('attendance')
          .select('status, note, lessons!inner(starts_at, groups(name))')
          .eq('student_id', studentId)
          .order('starts_at', { referencedTable: 'lessons', ascending: false })
          .limit(20),
      ) as unknown as { status: string; note: string | null; lessons: { starts_at: string; groups: { name: string } | null } }[],
    [studentId],
  )
  if (!data) return null
  const ok = data.filter((a) => a.status === 'present' || a.status === 'makeup').length
  return (
    <>
      <h3>Посещаемость{data.length ? ` · ${Math.round((ok / data.length) * 100)}% из последних ${data.length}` : ''}</h3>
      {data.length ? (
        <table>
          <tbody>
            {[...data]
              .sort((a, b) => b.lessons.starts_at.localeCompare(a.lessons.starts_at))
              .map((a, i) => (
                <tr key={i}>
                  <td>{fmtDateTime(a.lessons.starts_at)}</td>
                  <td>{a.lessons.groups?.name}</td>
                  <td className="num">
                    <span className={'badge ' + (a.status === 'absent' ? 'bad' : a.status === 'excused' ? 'warn-b' : 'ok')}>{ATT[a.status]}</span>
                    {a.note && <small className="muted block">{a.note}</small>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">Отметок пока нет</p>
      )}
    </>
  )
}

// Абонементы и оплаты ученика. Остаток занятий = занятий в абонементе − посещённых с даты начала.
function SalesHistory({ studentId }: { studentId: string }) {
  const { data } = useLoad(async () => {
    const [sales, visits] = await Promise.all([
      sb.from('sales').select('id, title, lessons_total, amount_due, valid_from, status, created_at, payments(amount, method, paid_at, kind)').eq('student_id', studentId).order('created_at', { ascending: false }).then(must),
      sb.from('attendance').select('status, lessons!inner(starts_at)').eq('student_id', studentId).in('status', ['present', 'makeup']).then(must),
    ])
    return {
      sales: sales as unknown as { id: string; title: string; lessons_total: number | null; amount_due: number; valid_from: string; status: string; payments: { amount: number; method: string; paid_at: string; kind: string }[] }[],
      visits: (visits as unknown as { lessons: { starts_at: string } }[]).map((v) => v.lessons.starts_at),
    }
  }, [studentId])
  if (!data) return null
  const cur = data.sales.find((s) => s.status === 'active')
  const left = cur?.lessons_total ? cur.lessons_total - data.visits.filter((t) => t.slice(0, 10) >= cur.valid_from).length : null
  return (
    <>
      <h3>
        Абонементы и оплаты
        {left != null && <span className={'badge ' + (left > 2 ? 'ok' : left > 0 ? 'warn-b' : 'bad')}> осталось занятий: {Math.max(0, left)}</span>}
      </h3>
      {data.sales.length ? (
        <table>
          <tbody>
            {data.sales.map((s) => {
              const paid = s.payments.reduce((t, p) => t + (p.kind === 'refund' ? -p.amount : p.amount), 0)
              return (
                <tr key={s.id}>
                  <td>
                    {s.title}
                    <small className="muted block">
                      с {fmtDate(s.valid_from)}
                      {s.lessons_total ? ` · ${lessons(s.lessons_total)}` : ''}
                      {s.payments.length ? ' · ' + s.payments.map((p) => `${money(p.amount)} ${METHODS[p.method]}`).join(', ') : ''}
                    </small>
                  </td>
                  <td className="num">
                    {money(paid)} / {money(s.amount_due)}
                    {paid < s.amount_due && <small className="danger-text block">долг {money(s.amount_due - paid)}</small>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <p className="muted">Абонементов пока нет</p>
      )}
    </>
  )
}
