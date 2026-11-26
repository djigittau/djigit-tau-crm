import { sb } from './supabase'
import { must } from './ui'

// Справочники для форм. RLS сам ограничивает видимые филиалы и людей.
export type Ref = { id: string; name: string }
export type GroupRef = Ref & { branch_id: string; capacity: number | null }
export type Trainer = { id: string; name: string; branches: string[] }

export async function loadBranches(): Promise<Ref[]> {
  return must(await sb.from('branches').select('id, name').eq('is_active', true).order('name')) as Ref[]
}
export async function loadDances(all = false): Promise<(Ref & { is_active: boolean })[]> {
  let q = sb.from('dance_types').select('id, name, is_active').order('name')
  if (!all) q = q.eq('is_active', true)
  return must(await q) as (Ref & { is_active: boolean })[]
}
export async function loadGroups(): Promise<GroupRef[]> {
  return must(await sb.from('groups').select('id, name, branch_id, capacity').eq('status', 'active').order('name')) as GroupRef[]
}
export async function loadTrainers(): Promise<Trainer[]> {
  const rows = must(
    await sb.from('employee_branches').select('branch_id, profiles!inner(id, full_name, role, status)').eq('profiles.role', 'trainer').eq('profiles.status', 'active'),
  ) as unknown as { branch_id: string; profiles: { id: string; full_name: string } }[]
  const m = new Map<string, Trainer>()
  for (const r of rows) {
    const t = m.get(r.profiles.id) ?? { id: r.profiles.id, name: r.profiles.full_name, branches: [] }
    t.branches.push(r.branch_id)
    m.set(t.id, t)
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
export const STUDENT_STATUS: Record<string, string> = { active: 'Учится', frozen: 'Заморозка', left: 'Ушёл' }
export const GENDER: Record<string, string> = { male: 'Мальчик', female: 'Девочка' }
export const LESSON_STATUS: Record<string, string> = { scheduled: 'По расписанию', completed: 'Проведено', cancelled: 'Отменено' }

export function age(birth: string | null) {
  if (!birth) return null
  const b = new Date(birth)
  const n = new Date()
  let a = n.getFullYear() - b.getFullYear()
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--
  return a
}
export const today = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
