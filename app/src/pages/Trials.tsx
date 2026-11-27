import { useState } from 'react'
import { sb, normPhone } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Empty, Modal, Field, Icon, act, fmtDateTime, TZ } from '../lib/ui'
import { loadBranches, loadGroups, TRIAL_STATUS, TRIAL_ORDER, toLocalInput, fromLocalInput } from '../lib/refs'
import { TrialForm } from './TrialFill'
import { TrainerPick } from './TrainerPick'
import SaleModal from './SaleModal'

type Lead = {
  id: string
  parent_name: string | null
  phone: string | null
  child_name: string
  child_birth_date: string | null
  branch_id: string | null
  group_id: string | null
  trainer_id: string | null
  manager_id: string | null
  source: string | null
  trial_at: string | null
  status: string
  comment: string | null
  refusal_reason: string | null
  result: string | null
  created_at: string
  branch: { name: string } | null
  grp: { name: string } | null
  dance: { name: string } | null
  manager: { full_name: string } | null
  trial_events: { to_status: string | null; kind: string; done: boolean; due_at: string | null }[]
}
type Ev = { id: string; kind: string; from_status: string | null; to_status: string | null; text: string | null; due_at: string | null; done: boolean; created_at: string; author: { full_name: string } | null }

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + '%' : '—')
const monthStart = (shift = 0) => {
  const [y, m] = new Date().toLocaleDateString('sv-SE', { timeZone: TZ }).slice(0, 7).split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + shift, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00+05:00`
}

export default function Trials() {
  const me = useMe()
  const [period, setPeriod] = useState('month')
  const [f, setF] = useState({ branch: '', manager: '', q: '' })
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const { data, loading, error, reload } = useLoad(async () => {
    let q = sb
      .from('trial_leads')
      .select('*, branch:branches(name), grp:groups(name), dance:dance_types(name), manager:profiles!trial_leads_manager_id_fkey(full_name), trial_events(to_status, kind, done, due_at)')
      .order('created_at', { ascending: false })
    if (period === 'month') q = q.gte('created_at', new Date(monthStart()).toISOString())
    if (period === 'prev') q = q.gte('created_at', new Date(monthStart(-1)).toISOString()).lt('created_at', new Date(monthStart()).toISOString())
    const [leads, branches] = await Promise.all([q.then(must), loadBranches()])
    return { leads: leads as unknown as Lead[], branches }
  }, [period])

  const leads = (data?.leads ?? []).filter(
    (l) =>
      (!f.branch || l.branch_id === f.branch) &&
      (!f.manager || l.manager_id === f.manager) &&
      (!f.q || [l.child_name, l.parent_name, l.phone].join(' ').toLowerCase().includes(f.q.toLowerCase()) || (normPhone(f.q).length > 3 && normPhone(l.phone ?? '').includes(normPhone(f.q)))),
  )
  const managers = new Map<string, string>()
  for (const l of data?.leads ?? []) if (l.manager_id) managers.set(l.manager_id, l.manager?.full_name ?? '—')
  const reached = (l: Lead, s: string) => l.status === s || l.trial_events.some((e) => e.to_status === s)
  const stats = (list: Lead[]) => ({
    total: list.length,
    booked: list.filter((l) => reached(l, 'booked')).length,
    attended: list.filter((l) => reached(l, 'attended')).length,
    bought: list.filter((l) => l.status === 'bought').length,
  })
  const all = stats(leads)
  const by = (key: (l: Lead) => string) => {
    const m = new Map<string, Lead[]>()
    for (const l of leads) m.set(key(l), [...(m.get(key(l)) ?? []), l])
    return [...m].map(([k, v]) => ({ k, ...stats(v) })).sort((a, b) => b.total - a.total)
  }
  const reasons = new Map<string, number>()
  for (const l of leads) if (l.status === 'refused') reasons.set(l.refusal_reason ?? '—', (reasons.get(l.refusal_reason ?? '—') ?? 0) + 1)
  const now = Date.now()
  const overdue = (l: Lead) => l.trial_events.some((e) => e.kind === 'task' && !e.done && e.due_at && new Date(e.due_at).getTime() < now)

  return (
    <>
      <PageHead title={me.role === 'sales' ? 'Обработка пробников' : 'Пробники'} sub={`Заявок: ${all.total} · купили: ${all.bought} · конверсия ${pct(all.bought, all.total)}`}>
        <button className="btn" onClick={() => setAdding(true)}>
          <Icon name="plus" /> Новая заявка
        </button>
      </PageHead>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input placeholder="Ребёнок, родитель, телефон" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Поиск" />
        </div>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Период">
          <option value="month">Этот месяц</option>
          <option value="prev">Прошлый месяц</option>
          <option value="all">Всё время</option>
        </select>
        {(data?.branches.length ?? 0) > 1 && (
          <select value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} aria-label="Филиал">
            <option value="">Все филиалы</option>
            {data!.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        {managers.size > 1 && (
          <select value={f.manager} onChange={(e) => setF({ ...f, manager: e.target.value })} aria-label="Менеджер">
            <option value="">Все менеджеры</option>
            {[...managers].map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
        )}
      </div>
      <State loading={loading} error={error}>
        <div className="kpis">
          <div className="card kpi">
            <span>Заявок</span>
            <b>{all.total}</b>
          </div>
          <div className="card kpi">
            <span>Записано на пробное</span>
            <b>{all.booked}</b>
          </div>
          <div className="card kpi">
            <span>Пробное проведено</span>
            <b>{all.attended}</b>
          </div>
          <div className="card kpi">
            <span>Купили абонемент</span>
            <b>{all.bought}</b>
          </div>
          <div className="card kpi">
            <span>Конверсия в покупку</span>
            <b>{pct(all.bought, all.total)}</b>
          </div>
        </div>

        <div className="funnel">
          {TRIAL_ORDER.map((s) => {
            const col = leads.filter((l) => l.status === s)
            return (
              <div key={s} className={'fcol s-' + s}>
                <h4>
                  {TRIAL_STATUS[s]} <span className="badge">{col.length}</span>
                </h4>
                {col.map((l) => (
                  <button key={l.id} className={'fcard' + (overdue(l) ? ' late' : '')} onClick={() => setOpenId(l.id)}>
                    <b>{l.child_name}</b>
                    <span>{[l.parent_name, l.phone].filter(Boolean).join(' · ')}</span>
                    <small>
                      {[l.branch?.name, l.grp?.name, l.trial_at && 'пробное ' + fmtDateTime(l.trial_at)].filter(Boolean).join(' · ')}
                    </small>
                    <small>{l.manager?.full_name}</small>
                    {overdue(l) && <em>просрочена задача</em>}
                  </button>
                ))}
              </div>
            )
          })}
        </div>

        {all.total > 0 && (
          <div className="grid-2">
            <ConvTable title="Конверсия по менеджерам" rows={by((l) => l.manager?.full_name ?? 'Без менеджера')} />
            <ConvTable title="Конверсия по филиалам" rows={by((l) => l.branch?.name ?? 'Без филиала')} />
            {reasons.size > 0 && (
              <section className="card">
                <h3>Причины отказов</h3>
                <table>
                  <tbody>
                    {[...reasons].sort((a, b) => b[1] - a[1]).map(([r, n]) => (
                      <tr key={r}>
                        <td>{r}</td>
                        <td className="num">{n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        )}
      </State>

      {adding && (
        <Modal title="Новая заявка на пробное" onClose={() => setAdding(false)}>
          <TrialForm
            onSaved={() => {
              setAdding(false)
              reload()
            }}
          />
        </Modal>
      )}
      {openId && <LeadCard id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  )
}

function ConvTable({ title, rows }: { title: string; rows: { k: string; total: number; booked: number; attended: number; bought: number }[] }) {
  return (
    <section className="card">
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th />
            <th className="num">Заявок</th>
            <th className="num">Пробных</th>
            <th className="num">Купили</th>
            <th className="num">Конверсия</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k}>
              <td>{r.k}</td>
              <td className="num">{r.total}</td>
              <td className="num">{r.attended}</td>
              <td className="num">{r.bought}</td>
              <td className="num">{pct(r.bought, r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function LeadCard({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const me = useMe()
  const [edit, setEdit] = useState<{ status: string; refusal_reason: string; result: string; trial_at: string; group_id: string; trainer_id: string } | null>(null)
  const [note, setNote] = useState('')
  const [task, setTask] = useState({ text: '', due: '' })
  const [selling, setSelling] = useState(false)
  const { data, reload } = useLoad(async () => {
    const [lead, events, groups] = await Promise.all([
      sb.from('trial_leads').select('*, branch:branches(name), grp:groups(name), dance:dance_types(name), manager:profiles!trial_leads_manager_id_fkey(full_name), trial_events(to_status, kind, done, due_at)').eq('id', id).single().then(must),
      sb.from('trial_events').select('id, kind, from_status, to_status, text, due_at, done, created_at, author:profiles!trial_events_author_id_fkey(full_name)').eq('trial_lead_id', id).order('created_at', { ascending: false }).then(must),
      loadGroups(),
    ])
    const l = lead as unknown as Lead
    setEdit({ status: l.status, refusal_reason: l.refusal_reason ?? '', result: l.result ?? '', trial_at: toLocalInput(l.trial_at), group_id: l.group_id ?? '', trainer_id: l.trainer_id ?? '' })
    return { lead: l, events: events as unknown as Ev[], groups }
  }, [id])

  if (!data || !edit) return null
  const l = data.lead
  const refresh = () => {
    reload()
    onChanged()
  }

  async function saveLead() {
    if (!edit) return
    if (
      await act(async () => {
        if (edit.status === 'refused' && !edit.refusal_reason.trim()) throw new Error('Укажите причину отказа')
        must(
          await sb
            .from('trial_leads')
            .update({
              status: edit.status,
              refusal_reason: edit.status === 'refused' ? edit.refusal_reason.trim() : null,
              result: edit.result.trim() || null,
              trial_at: fromLocalInput(edit.trial_at),
              group_id: edit.group_id || null,
              trainer_id: edit.trainer_id || null,
            })
            .eq('id', id),
        )
      }, 'Сохранено')
    )
      refresh()
  }

  async function addEvent(kind: 'comment' | 'task') {
    const text = kind === 'comment' ? note.trim() : task.text.trim()
    if (!text) return
    if (kind === 'task' && !task.due) return act(async () => { throw new Error('Укажите, когда напомнить') })
    if (await act(async () => must(await sb.from('trial_events').insert({ trial_lead_id: id, kind, text, due_at: kind === 'task' ? fromLocalInput(task.due) : null, author_id: me.id })))) {
      setNote('')
      setTask({ text: '', due: '' })
      refresh()
    }
  }

  const evText = (e: Ev) =>
    e.kind === 'status' ? (e.from_status ? `${TRIAL_STATUS[e.from_status]} → ${TRIAL_STATUS[e.to_status ?? '']}` : e.text ?? 'Заявка создана') : e.text

  return (
    <Modal
      title={`${l.child_name} · ${TRIAL_STATUS[l.status]}`}
      onClose={onClose}
      footer={
        <>
          {l.status !== 'bought' && l.branch_id && (
            <button className="btn ghost" onClick={() => setSelling(true)}>
              Купил абонемент
            </button>
          )}
          <button className="btn" onClick={saveLead}>
            Сохранить
          </button>
        </>
      }
    >
      <dl className="props">
        <dt>Родитель</dt>
        <dd>{[l.parent_name, l.phone].filter(Boolean).join(', ') || '—'}</dd>
        <dt>Ребёнок</dt>
        <dd>
          {l.child_name}
          {l.child_birth_date && <span className="muted"> · {l.child_birth_date.split('-').reverse().join('.')}</span>}
        </dd>
        <dt>Филиал</dt>
        <dd>{l.branch?.name ?? '—'}</dd>
        <dt>Направление</dt>
        <dd>{l.dance?.name ?? '—'}</dd>
        <dt>Источник</dt>
        <dd>{l.source ?? '—'}</dd>
        <dt>Менеджер</dt>
        <dd>{l.manager?.full_name ?? '—'}</dd>
        <dt>Создана</dt>
        <dd>{fmtDateTime(l.created_at)}</dd>
        <dt>Комментарий</dt>
        <dd>{l.comment ?? '—'}</dd>
      </dl>
      <div className="form-grid">
        <Field label="Статус">
          <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })} disabled={l.status === 'bought'}>
            {TRIAL_ORDER.filter((s) => s !== 'bought' || l.status === 'bought').map((s) => (
              <option key={s} value={s}>
                {TRIAL_STATUS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Дата и время пробного">
          <input type="datetime-local" value={edit.trial_at} onChange={(e) => setEdit({ ...edit, trial_at: e.target.value })} />
        </Field>
        <Field label="Группа">
          <select value={edit.group_id} onChange={(e) => setEdit({ ...edit, group_id: e.target.value })}>
            <option value="">—</option>
            {data.groups.filter((g) => g.branch_id === l.branch_id).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Тренер" hint="Тренер увидит пробник у себя в разделе «Пробники»">
          <TrainerPick branch={l.branch_id ?? ''} group={edit.group_id} value={edit.trainer_id} onChange={(v) => setEdit((x) => x && { ...x, trainer_id: v })} />
        </Field>
        {edit.status === 'refused' && (
          <Field label="Причина отказа *">
            <input value={edit.refusal_reason} onChange={(e) => setEdit({ ...edit, refusal_reason: e.target.value })} placeholder="Дорого, далеко, не подошло время…" />
          </Field>
        )}
        <Field label="Результат обработки" full>
          <textarea value={edit.result} onChange={(e) => setEdit({ ...edit, result: e.target.value })} />
        </Field>
      </div>

      <h3>Комментарий</h3>
      <div className="row">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Позвонили, договорились…" aria-label="Комментарий" />
        <button className="btn ghost" onClick={() => addEvent('comment')}>
          Добавить
        </button>
      </div>
      <h3>Задача-напоминание</h3>
      <div className="row">
        <input value={task.text} onChange={(e) => setTask({ ...task, text: e.target.value })} placeholder="Перезвонить после пробного" aria-label="Задача" />
        <input type="datetime-local" value={task.due} onChange={(e) => setTask({ ...task, due: e.target.value })} aria-label="Когда напомнить" />
        <button className="btn ghost" onClick={() => addEvent('task')}>
          Поставить
        </button>
      </div>

      <h3>История</h3>
      {data.events.length ? (
        <table>
          <tbody>
            {data.events.map((e) => (
              <tr key={e.id} className={e.kind === 'task' && e.done ? 'dimmed' : ''}>
                <td className="nowrap">{fmtDateTime(e.created_at)}</td>
                <td>
                  {e.kind === 'task' && (
                    <label className="check inline">
                      <input
                        type="checkbox"
                        checked={e.done}
                        onChange={async (x) => {
                          if (await act(async () => must(await sb.from('trial_events').update({ done: x.target.checked }).eq('id', e.id)))) refresh()
                        }}
                      />
                      <span className={e.due_at && !e.done && new Date(e.due_at).getTime() < Date.now() ? 'danger-text' : ''}>
                        Задача до {fmtDateTime(e.due_at)}:
                      </span>
                    </label>
                  )}{' '}
                  {evText(e)}
                  <small className="muted block">{e.author?.full_name ?? 'система'}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty text="Событий нет" icon="clock" />
      )}

      {selling && (
        <SaleModal
          trialId={l.id}
          branchId={l.branch_id!}
          groupId={l.group_id}
          title={l.child_name}
          onClose={() => setSelling(false)}
          onDone={() => {
            setSelling(false)
            refresh()
          }}
        />
      )}
    </Modal>
  )
}
