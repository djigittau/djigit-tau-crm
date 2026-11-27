// DJIGIT TAU CRM · admin-users
// Только директор: создание аккаунтов, изменение роли и филиалов, блокировка, сброс пароля, смена логина.
// Service role key есть только здесь, на сервере (переменная окружения Supabase).
import { createClient } from 'npm:@supabase/supabase-js@2'

const ROLES = ['director', 'manager', 'admin', 'sales', 'trainer']
const STATUSES = ['active', 'blocked', 'deactivated']
const PHONE_EMAIL_DOMAIN = 'phone.djigittau.kz'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (error: string, status = 400) => reply({ error }, status)

function normPhone(p: string) {
  let d = p.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1)
  if (d.length === 10) d = '7' + d
  return d
}

type BranchIn = { branch_id: string; base_salary: number }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('Метод не поддерживается', 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''

  // Клиент от имени директора: его изменения проходят RLS и попадают в журнал с его именем.
  const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } })
  const admin = createClient(url, service, { auth: { persistSession: false } })

  const { data: u } = await asUser.auth.getUser()
  if (!u?.user) return fail('Нужен вход', 401)
  const { data: me } = await admin.from('profiles').select('role, status').eq('id', u.user.id).maybeSingle()
  if (me?.role !== 'director' || me.status !== 'active') return fail('Только директор управляет аккаунтами', 403)
  const actor = u.user.id

  let b: Record<string, unknown>
  try {
    b = await req.json()
  } catch {
    return fail('Неверный запрос')
  }
  const audit = (action: string, entityId: string, data: unknown) =>
    admin.from('audit_logs').insert({ actor_id: actor, actor_role: 'director', action, entity: 'accounts', entity_id: entityId, new_data: data })

  const branches = (Array.isArray(b.branches) ? b.branches : []) as BranchIn[]
  if (branches.some((x) => typeof x.branch_id !== 'string' || !(Number(x.base_salary) >= 0))) return fail('Неверные филиалы или оклад')

  switch (b.action) {
    case 'create': {
      const full_name = String(b.full_name ?? '').trim()
      const email = b.email ? String(b.email).trim().toLowerCase() : null
      const phone = b.phone ? String(b.phone).trim() : null
      const role = String(b.role)
      const password = String(b.password ?? '')
      if (!full_name) return fail('Введите ФИО')
      if (!ROLES.includes(role)) return fail('Неверная роль')
      if (!email && !phone) return fail('Нужен телефон или email')
      if (phone && normPhone(phone).length < 11) return fail('Телефон указан не полностью')
      if (password.length < 8) return fail('Пароль — минимум 8 символов')
      const login = email ?? `${normPhone(phone!)}@${PHONE_EMAIL_DOMAIN}`

      const { data: created, error } = await admin.auth.admin.createUser({
        email: login,
        password,
        email_confirm: true,
        user_metadata: { must_change: true, full_name },
      })
      if (error || !created.user)
        return fail(/already|exists|registered/i.test(error?.message ?? '') ? 'Сотрудник с таким телефоном или email уже есть' : error?.message ?? 'Ошибка создания')
      const id = created.user.id
      const { error: pErr } = await admin.from('profiles').insert({ id, full_name, email, phone, role })
      const { error: bErr } = branches.length && !pErr
        ? await admin.from('employee_branches').insert(branches.map((x) => ({ profile_id: id, branch_id: x.branch_id, base_salary: Number(x.base_salary) })))
        : { error: null }
      if (pErr || bErr) {
        await admin.auth.admin.deleteUser(id) // профиль не создан — не оставляем пустой аккаунт
        return fail((pErr ?? bErr)!.message)
      }
      await audit('create_account', id, { full_name, email, phone, role, branches })
      return reply({ id, login })
    }

    case 'update': {
      const id = String(b.id ?? '')
      const role = String(b.role)
      if (!ROLES.includes(role)) return fail('Неверная роль')
      const { error } = await asUser
        .from('profiles')
        .update({ full_name: String(b.full_name ?? '').trim(), email: b.email || null, phone: b.phone || null, role })
        .eq('id', id)
      if (error) return fail(error.message)
      const keep = branches.map((x) => x.branch_id)
      const del = asUser.from('employee_branches').delete().eq('profile_id', id)
      const { error: dErr } = keep.length ? await del.not('branch_id', 'in', `(${keep.join(',')})`) : await del
      if (dErr) return fail(dErr.message)
      if (branches.length) {
        const { error: uErr } = await asUser
          .from('employee_branches')
          .upsert(branches.map((x) => ({ profile_id: id, branch_id: x.branch_id, base_salary: Number(x.base_salary) })))
        if (uErr) return fail(uErr.message)
      }
      return reply({ id })
    }

    case 'set_status': {
      const id = String(b.id ?? '')
      const status = String(b.status)
      if (!STATUSES.includes(status)) return fail('Неверный статус')
      if (id === actor && status !== 'active') return fail('Нельзя заблокировать самого себя')
      const { error } = await asUser.from('profiles').update({ status }).eq('id', id)
      if (error) return fail(error.message)
      // Блокировка закрывает и вход: Supabase Auth не выдаст новый токен.
      const { error: aErr } = await admin.auth.admin.updateUserById(id, { ban_duration: status === 'active' ? 'none' : '876000h' })
      if (aErr) return fail(aErr.message)
      await audit(status === 'active' ? 'unblock_account' : status === 'blocked' ? 'block_account' : 'deactivate_account', id, { status })
      return reply({ id })
    }

    // Логин (вход): email или телефон. Телефон превращается в служебный адрес, как при создании.
    case 'set_login': {
      const id = String(b.id ?? '')
      const raw = String(b.login ?? '').trim().toLowerCase()
      if (!raw) return fail('Введите логин: email или телефон')
      let login = raw
      if (!raw.includes('@')) {
        if (normPhone(raw).length !== 11) return fail('Телефон указан не полностью')
        login = `${normPhone(raw)}@${PHONE_EMAIL_DOMAIN}`
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return fail('Неверный email')
      const { data: t } = await admin.from('profiles').select('id').eq('id', id).maybeSingle()
      if (!t) return fail('Сотрудник не найден', 404)
      const { error } = await admin.auth.admin.updateUserById(id, { email: login, email_confirm: true })
      if (error) return fail(/already|exists|registered/i.test(error.message) ? 'Такой логин уже занят' : error.message)
      await audit('change_login', id, { login })
      return reply({ id, login })
    }

    case 'reset_password': {
      const id = String(b.id ?? '')
      const password = String(b.password ?? '')
      if (password.length < 8) return fail('Пароль — минимум 8 символов')
      const { data: t } = await admin.from('profiles').select('id').eq('id', id).maybeSingle()
      if (!t) return fail('Сотрудник не найден', 404)
      const { error } = await admin.auth.admin.updateUserById(id, { password, user_metadata: { must_change: true } })
      if (error) return fail(error.message)
      await audit('reset_password', id, {})
      return reply({ id })
    }
  }
  return fail('Неизвестное действие')
})
