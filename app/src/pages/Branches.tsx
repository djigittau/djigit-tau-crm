import { useState } from 'react'
import { sb, type Branch } from '../lib/supabase'
import { useMe } from '../lib/auth'
import { useLoad, must, State, PageHead, Empty, Modal, Field, Icon, act } from '../lib/ui'

type Row = Branch & { manager: { full_name: string } | null }
type Counts = Record<string, { staff: number; students: number; groups: number }>

export default function Branches() {
  const me = useMe()
  const canEdit = me.role === 'director'
  const [edit, setEdit] = useState<Partial<Branch> | null>(null)
  const [q, setQ] = useState('')

  const { data, loading, error, reload } = useLoad(async () => {
    const [branches, staff, students, groups, managers] = await Promise.all([
      sb.from('branches').select('*, manager:profiles!branches_manager_id_fkey(full_name)').order('name').then(must),
      sb.from('employee_branches').select('branch_id').then(must),
      sb.from('students').select('branch_id').eq('status', 'active').then(must),
      sb.from('groups').select('branch_id').eq('status', 'active').then(must),
      canEdit ? sb.from('profiles').select('id, full_name').eq('role', 'manager').eq('status', 'active').order('full_name').then(must) : Promise.resolve([]),
    ])
    const c: Counts = {}
    const add = (list: { branch_id: string }[], k: 'staff' | 'students' | 'groups') =>
      list.forEach((x) => ((c[x.branch_id] ??= { staff: 0, students: 0, groups: 0 })[k] += 1))
    add(staff as { branch_id: string }[], 'staff')
    add(students as { branch_id: string }[], 'students')
    add(groups as { branch_id: string }[], 'groups')
    return { branches: branches as unknown as Row[], counts: c, managers: managers as { id: string; full_name: string }[] }
  }, [canEdit])

  const list = (data?.branches ?? []).filter((b) => !q || (b.name + ' ' + (b.address ?? '')).toLowerCase().includes(q.toLowerCase()))

  async function save() {
    if (!edit?.name?.trim()) return act(async () => { throw new Error('Введите название филиала') })
    const row = { name: edit.name.trim(), address: edit.address?.trim() || null, phone: edit.phone?.trim() || null, manager_id: edit.manager_id || null, is_active: edit.is_active ?? true }
    const ok = await act(async () => must(edit.id ? await sb.from('branches').update(row).eq('id', edit.id) : await sb.from('branches').insert(row)), 'Филиал сохранён')
    if (ok) {
      setEdit(null)
      reload()
    }
  }

  return (
    <>
      <PageHead title="Филиалы" sub={data ? `Действующих: ${data.branches.filter((b) => b.is_active).length}` : undefined}>
        {canEdit && (
          <button className="btn" onClick={() => setEdit({ is_active: true })}>
            <Icon name="plus" /> Добавить филиал
          </button>
        )}
      </PageHead>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input placeholder="Поиск по названию или адресу" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
        </div>
      </div>
      <State loading={loading} error={error}>
        <section className="card flush">
          {list.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Филиал</th>
                    <th>Адрес</th>
                    <th>Телефон</th>
                    <th>Управляющий</th>
                    <th className="num">Сотрудники</th>
                    <th className="num">Ученики</th>
                    <th className="num">Группы</th>
                    <th>Статус</th>
                    {canEdit && <th />}
                  </tr>
                </thead>
                <tbody>
                  {list.map((b) => {
                    const c = data!.counts[b.id]
                    return (
                      <tr key={b.id}>
                        <td>
                          <b>{b.name}</b>
                        </td>
                        <td>{b.address ?? '—'}</td>
                        <td>{b.phone ?? '—'}</td>
                        <td>{b.manager?.full_name ?? '—'}</td>
                        <td className="num">{c?.staff ?? 0}</td>
                        <td className="num">{c?.students ?? 0}</td>
                        <td className="num">{c?.groups ?? 0}</td>
                        <td>{b.is_active ? <span className="badge ok">Действует</span> : <span className="badge">Закрыт</span>}</td>
                        {canEdit && (
                          <td className="act">
                            <button className="icon-btn" onClick={() => setEdit(b)} aria-label="Изменить">
                              <Icon name="edit" />
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text={q ? 'Ничего не найдено' : canEdit ? 'Филиалов пока нет. Нажмите «Добавить филиал».' : 'Вас ещё не назначили на филиал'} icon="building" />
          )}
        </section>
      </State>

      {edit && (
        <Modal
          title={edit.id ? 'Изменить филиал' : 'Новый филиал'}
          onClose={() => setEdit(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setEdit(null)}>
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
              <input autoFocus value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Адрес" full>
              <input value={edit.address ?? ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
            </Field>
            <Field label="Контактный телефон">
              <input value={edit.phone ?? ''} inputMode="tel" onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
            </Field>
            <Field label="Ответственный управляющий" hint={data?.managers.length ? undefined : 'Сначала создайте сотрудника с ролью «Управляющий»'}>
              <select value={edit.manager_id ?? ''} onChange={(e) => setEdit({ ...edit, manager_id: e.target.value || null })}>
                <option value="">—</option>
                {data?.managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name}
                  </option>
                ))}
              </select>
            </Field>
            <label className="check full">
              <input type="checkbox" checked={edit.is_active ?? true} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> Филиал действует
            </label>
          </div>
        </Modal>
      )}
    </>
  )
}
