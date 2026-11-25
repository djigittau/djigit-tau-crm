import { createClient } from '@supabase/supabase-js'

// Публичные значения: URL проекта и publishable-ключ. Секретные ключи во frontend не попадают.
export const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY)

export type Role = 'director' | 'manager' | 'admin' | 'sales' | 'trainer'
export type Status = 'active' | 'blocked' | 'deactivated'

export const ROLE_LABEL: Record<Role, string> = {
  director: 'Директор',
  manager: 'Управляющий',
  admin: 'Администратор',
  sales: 'Отдел продаж',
  trainer: 'Тренер',
}
export const STATUS_LABEL: Record<Status, string> = { active: 'Активен', blocked: 'Заблокирован', deactivated: 'Деактивирован' }

export type Profile = {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  role: Role
  status: Status
  photo_url: string | null
}

export type Branch = {
  id: string
  name: string
  address: string | null
  phone: string | null
  manager_id: string | null
  is_active: boolean
}

// Телефон к виду 7XXXXXXXXXX — как private.norm_phone в базе.
export function normPhone(p: string) {
  let d = p.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1)
  if (d.length === 10) d = '7' + d
  return d
}

// Сотрудник без почты входит по телефону: для Supabase Auth телефон превращается в служебный адрес.
export const PHONE_EMAIL_DOMAIN = 'phone.djigittau.kz'
export function loginEmail(v: string) {
  const s = v.trim().toLowerCase()
  return s.includes('@') ? s : `${normPhone(s)}@${PHONE_EMAIL_DOMAIN}`
}

// Понятный текст ошибки. Сообщения из триггеров базы уже на русском.
export function errText(e: unknown): string {
  const m = (e as { message?: string })?.message || String(e)
  if (/row-level security|permission denied|42501/i.test(m)) return 'Нет прав на это действие'
  if (/Invalid login credentials/i.test(m)) return 'Неверный логин или пароль'
  if (/banned/i.test(m)) return 'Доступ закрыт. Обратитесь к директору студии'
  if (/duplicate key/i.test(m)) return 'Такая запись уже есть'
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Нет связи с сервером. Проверьте интернет'
  return m
}
