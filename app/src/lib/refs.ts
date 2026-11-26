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
// Направление вводится текстом: находит существующее или создаёт новое (RPC dance_id, миграция 0017).
export async function danceId(name: string): Promise<string | null> {
  return name.trim() ? (must(await sb.rpc('dance_id', { p_name: name })) as string) : null
}
export async function loadGroups(): Promise<GroupRef[]> {
  return must(await sb.from('groups').select('id, name, branch_id, capacity').eq('status', 'active').order('name')) as GroupRef[]
}
export type Staff = Trainer & { role: string }
// Сотрудники с филиалами (видимые по RLS). Тренеры — частный случай.
export async function loadStaff(): Promise<Staff[]> {
  const rows = must(
    await sb.from('employee_branches').select('branch_id, profiles!inner(id, full_name, role, status)').eq('profiles.status', 'active'),
  ) as unknown as { branch_id: string; profiles: { id: string; full_name: string; role: string } }[]
  const m = new Map<string, Staff>()
  for (const r of rows) {
    const t = m.get(r.profiles.id) ?? { id: r.profiles.id, name: r.profiles.full_name, role: r.profiles.role, branches: [] }
    t.branches.push(r.branch_id)
    m.set(t.id, t)
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
}
export async function loadTrainers(): Promise<Trainer[]> {
  return (await loadStaff()).filter((s) => s.role === 'trainer')
}

export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
export const STUDENT_STATUS: Record<string, string> = { active: 'Занимается', frozen: 'Заморозка', left: 'Ушёл' }
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
// Сегодня по Алматы, в каком бы поясе ни был браузер.
export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Almaty' })

export const TRIAL_STATUS: Record<string, string> = {
  new: 'Новая заявка',
  contacted: 'Менеджер связался',
  booked: 'Записан на пробное',
  attended: 'Пробное проведено',
  thinking: 'Думает',
  bought: 'Купил абонемент',
  refused: 'Отказ',
}
export const TRIAL_ORDER = ['new', 'contacted', 'booked', 'attended', 'thinking', 'bought', 'refused']
export const SOURCES = ['Instagram', 'WhatsApp', 'TikTok', '2ГИС', 'Сайт', 'Звонок', 'Рекомендация', 'amoCRM', 'Другое']
export const METHODS: Record<string, string> = { kaspi: 'Kaspi', halyk: 'Halyk', cash: 'Наличные', card: 'Карта', transfer: 'Перевод', other: 'Другое' }

// Поле datetime-local по Алматы (UTC+5) и обратно.
export const toLocalInput = (t: string | null) => (t ? new Date(t).toLocaleString('sv-SE', { timeZone: 'Asia/Almaty' }).slice(0, 16).replace(' ', 'T') : '')
export const fromLocalInput = (v: string) => (v ? new Date(`${v}:00+05:00`).toISOString() : null)

// Месяц студии (YYYY-MM) и его границы: для дат — YYYY-MM-DD, для времени — ISO по Алматы.
export const thisMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Almaty' }).slice(0, 7)
export function monthBounds(m: string) {
  const [y, mo] = m.split('-').map(Number)
  const next = `${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}`
  return { d0: `${m}-01`, d1: `${next}-01`, t0: new Date(`${m}-01T00:00:00+05:00`).toISOString(), t1: new Date(`${next}-01T00:00:00+05:00`).toISOString() }
}
