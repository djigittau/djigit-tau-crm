import { useState } from 'react'
import { sb, ROLE_LABEL, type Role } from '../lib/supabase'
import { useLoad, must, State, PageHead, Empty, Modal, fmtDateTime } from '../lib/ui'
import { loadBranches, today } from '../lib/refs'

// Журнал действий (audit_logs). Директор — всё; управляющий — записи своих филиалов (RLS). Изменить журнал не может никто.
type Log = { id: number; at: string; actor_id: string | null; actor_role: Role | null; action: string; entity: string; entity_id: string | null; branch_id: string | null; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; ip: string | null }

const ENTITY: Record<string, string> = {
  profiles: 'Сотрудник', branches: 'Филиал', employee_branches: 'Назначение в филиал', parents: 'Родитель', students: 'Ученик', groups: 'Группа',
  group_trainers: 'Тренер группы', group_members: 'Состав группы', lessons: 'Занятие', attendance: 'Посещаемость', shifts: 'Смена', trial_leads: 'Пробник',
  sales: 'Продажа', payments: 'Платёж', bonuses: 'Бонус', fines: 'Штраф', salary_accruals: 'Начисление зарплаты', salary_payments: 'Выплата зарплаты',
  expenses: 'Расход', expense_categories: 'Статья расходов', employee_insurance: 'Медстраховка', crm_settings: 'Настройка', accounts: 'Аккаунт',
}
const ACTION: Record<string, string> = {
  insert: 'Создание', update: 'Изменение', delete: 'Удаление',
  create_account: 'Создан аккаунт', block_account: 'Аккаунт заблокирован', unblock_account: 'Аккаунт разблокирован', deactivate_account: 'Аккаунт деактивирован', reset_password: 'Сброс пароля', change_login: 'Изменён логин',
}
const BAD = new Set(['delete', 'block_account', 'deactivate_account'])
const SKIP = new Set(['updated_at', 'created_at'])
const PAGE = 100
const show = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))
// Граница дня по Алматы (UTC+5).
const dayStart = (d: string, plus = 0) => new Date(new Date(`${d}T00:00:00+05:00`).getTime() + plus * 86400000).toISOString()

export default function Audit() {
  const [f, setF] = useState({ from: new Date(Date.parse(today()) - 7 * 86400000).toISOString().slice(0, 10), to: today(), entity: '', action: '', branch: '', actor: '' })
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState<Log | null>(null)
  const { data, loading, error } = useLoad(async () => {
    let q = sb.from('audit_logs').select('*').gte('at', dayStart(f.from)).lt('at', dayStart(f.to, 1))
    if (f.entity) q = q.eq('entity', f.entity)
    if (f.action) q = q.eq('action', f.action)
    if (f.branch) q = q.eq('branch_id', f.branch)
    if (f.actor) q = q.eq('actor_id', f.actor)
    const [rows, branches, people] = await Promise.all([
      q.order('at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1).then(must),
      loadBranches(),
      sb.from('profiles').select('id, full_name').order('full_name').then(must),
    ])
    return { rows: rows as Log[], branches, people: people as { id: string; full_name: string }[] }
  }, [f, limit])
  const set = (k: keyof typeof f, v: string) => {
    setF({ ...f, [k]: v })
    setLimit(PAGE)
  }
  const who = (r: Log) => (r.actor_id ? data?.people.find((p) => p.id === r.actor_id)?.full_name ?? 'Сотрудник' : 'Система')
  const branch = (id: string | null) => (id ? data?.branches.find((b) => b.id === id)?.name ?? '—' : '—')
  const rows = data?.rows.slice(0, limit) ?? []
  // Подпись записи — имя или название из данных.
  const label = (r: Log) => {
    const d = r.new_data ?? r.old_data ?? {}
    return show(d.full_name ?? d.name ?? d.child_name ?? d.title ?? d.reason ?? d.key ?? '').slice(0, 60)
  }
  const diff = (r: Log) =>
    [...new Set([...Object.keys(r.old_data ?? {}), ...Object.keys(r.new_data ?? {})])]
      .filter((k) => !SKIP.has(k) && (r.action !== 'update' || JSON.stringify(r.old_data?.[k]) !== JSON.stringify(r.new_data?.[k])))
      .map((k) => ({ k, o: r.old_data?.[k], n: r.new_data?.[k] }))

  return (
    <>
      <PageHead title="Журнал действий" sub="Кто, что и когда менял. Записи журнала нельзя изменить или удалить." />
      <div className="toolbar">
        <input type="date" value={f.from} onChange={(e) => e.target.value && set('from', e.target.value)} aria-label="С даты" style={{ width: 'auto' }} />
        <input type="date" value={f.to} onChange={(e) => e.target.value && set('to', e.target.value)} aria-label="По дату" style={{ width: 'auto' }} />
        <select value={f.entity} onChange={(e) => set('entity', e.target.value)} aria-label="Раздел">
          <option value="">Все разделы</option>
          {Object.entries(ENTITY).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={f.action} onChange={(e) => set('action', e.target.value)} aria-label="Действие">
          <option value="">Все действия</option>
          {Object.entries(ACTION).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={f.branch} onChange={(e) => set('branch', e.target.value)} aria-label="Филиал">
          <option value="">Все филиалы</option>
          {data?.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select value={f.actor} onChange={(e) => set('actor', e.target.value)} aria-label="Сотрудник">
          <option value="">Все сотрудники</option>
          {data?.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </div>
      <State loading={loading && !data} error={error}>
        <section className="card flush">
          {rows.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Когда</th>
                    <th>Кто</th>
                    <th>Действие</th>
                    <th>Раздел</th>
                    <th>Запись</th>
                    <th>Филиал</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="clickable" onClick={() => setOpen(r)}>
                      <td className="nowrap">{fmtDateTime(r.at)}</td>
                      <td>
                        <b>{who(r)}</b>
                        {r.actor_role && <small className="block muted">{ROLE_LABEL[r.actor_role]}</small>}
                      </td>
                      <td>
                        <span className={'badge ' + (BAD.has(r.action) ? 'bad' : r.action === 'insert' || r.action === 'create_account' ? 'ok' : 'gold')}>{ACTION[r.action] ?? r.action}</span>
                      </td>
                      <td>{ENTITY[r.entity] ?? r.entity}</td>
                      <td>{label(r)}</td>
                      <td>{branch(r.branch_id)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="За выбранный период записей нет" icon="layers" />
          )}
        </section>
        {(data?.rows.length ?? 0) > limit && (
          <button className="btn ghost" onClick={() => setLimit(limit + PAGE)}>
            Показать ещё
          </button>
        )}
      </State>
      {open && (
        <Modal title={`${ACTION[open.action] ?? open.action}: ${ENTITY[open.entity] ?? open.entity}`} onClose={() => setOpen(null)}>
          <dl className="props">
            <dt>Когда</dt>
            <dd>{fmtDateTime(open.at)}</dd>
            <dt>Кто</dt>
            <dd>
              {who(open)}
              {open.actor_role && ` · ${ROLE_LABEL[open.actor_role]}`}
            </dd>
            <dt>Филиал</dt>
            <dd>{branch(open.branch_id)}</dd>
            <dt>IP</dt>
            <dd>{open.ip ?? '—'}</dd>
            <dt>ID записи</dt>
            <dd className="break small">{open.entity_id ?? '—'}</dd>
          </dl>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Поле</th>
                  {open.old_data != null && <th>Было</th>}
                  {open.new_data != null && <th>Стало</th>}
                </tr>
              </thead>
              <tbody>
                {diff(open).map((d) => (
                  <tr key={d.k}>
                    <td className="muted">{d.k}</td>
                    {open.old_data != null && <td className="break">{show(d.o)}</td>}
                    {open.new_data != null && <td className="break">{show(d.n)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </>
  )
}
