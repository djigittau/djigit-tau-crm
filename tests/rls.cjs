// Этап 11: RLS-тесты через публичный API под каждой ролью (как обычный клиент с publishable-ключом).
// Запуск: SQL из tests/qa_setup.sql в Supabase → SQL Editor, затем `node tests/rls.cjs`, затем tests/qa_cleanup.sql.
const { createClient } = require('../app/node_modules/@supabase/supabase-js')
const URL_ = 'https://qfrspiobhvugslvcvjdn.supabase.co'
const KEY = 'sb_publishable_4wJa8DyiI6PvhZOzyswWqQ_ZgT0eZtq'
let fails = 0
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++ }
async function as(login) {
  const c = createClient(URL_, KEY, { auth: { persistSession: false } })
  if (login) {
    const { data, error } = await c.auth.signInWithPassword({ email: `qa.${login}@test.djigittau.kz`, password: 'QaTest-2026!' })
    if (error) throw new Error(login + ': ' + error.message)
    c.uid = data.user.id
  }
  return c
}
const rows = async (q) => { const r = await q; return r.error ? -1 : r.data.length }
const denied = (r) => !!r.error || (Array.isArray(r.data) && r.data.length === 0)

;(async () => {
  const [anon, dir, man, man2, adm, tr, sal] = await Promise.all([as(null), as('director'), as('manager'), as('manager2'), as('admin'), as('trainer'), as('sales')])
  const br = (await dir.from('branches').select('id, name').like('name', 'QA%').order('name')).data
  const [b1, b2] = br.map((b) => b.id)

  // Журнал действий
  ok((await rows(dir.from('audit_logs').select('id').in('branch_id', [b1, b2]))) >= 10, 'директор видит журнал обоих филиалов')
  const m1 = (await man.from('audit_logs').select('branch_id').in('branch_id', [b1, b2])).data
  ok(m1.length > 0 && m1.every((r) => r.branch_id === b1), 'управляющий видит журнал только своего филиала')
  ok((await rows(man.from('audit_logs').select('id').is('branch_id', null))) === 0, 'управляющий не видит записи без филиала (аккаунты, настройки)')
  for (const [n, c] of [['админ', adm], ['тренер', tr], ['продажи', sal], ['аноним', anon]]) ok((await rows(c.from('audit_logs').select('id'))) <= 0, `${n} не видит журнал`)
  const one = (await dir.from('audit_logs').select('id').eq('branch_id', b1).limit(1)).data[0].id
  ok(!!(await dir.from('audit_logs').insert({ action: 'x', entity: 'x' })).error, 'директор не пишет в журнал напрямую')
  await dir.from('audit_logs').update({ action: 'hacked' }).eq('id', one)
  await dir.from('audit_logs').delete().eq('id', one)
  const still = (await dir.from('audit_logs').select('action').eq('id', one)).data
  ok(still.length === 1 && still[0].action !== 'hacked', 'журнал не изменить и не удалить (даже директору)')

  // Чужие филиалы
  ok((await rows(man.from('students').select('id').eq('branch_id', b2))) === 0, 'управляющий не видит учеников чужого филиала')
  ok((await rows(man.from('expenses').select('id').eq('branch_id', b2))) === 0, 'управляющий не видит расходы чужого филиала')
  ok((await rows(man2.from('payments').select('id').eq('branch_id', b1))) === 0, 'управляющий 2 не видит платежи филиала 1')
  const cat = (await dir.from('expense_categories').select('id').eq('code', 'rent').single()).data.id
  ok(!!(await man.from('expenses').insert({ branch_id: b2, category_id: cat, amount: 1 })).error, 'управляющий не создаёт расход в чужом филиале')
  ok(!!(await adm.from('students').insert({ full_name: 'QA взлом', branch_id: b2 })).error, 'админ не создаёт ученика в чужом филиале')
  ok(!!(await sal.from('trial_leads').insert({ child_name: 'QA взлом', branch_id: b2 })).error, 'продажи не создают пробник в чужом филиале')

  // Роли и права
  await adm.from('profiles').update({ role: 'director' }).eq('id', adm.uid)
  ok((await dir.from('profiles').select('role').eq('id', adm.uid).single()).data.role === 'admin', 'админ не повышает себе роль')
  await man.from('profiles').update({ role: 'director' }).eq('id', man.uid)
  ok((await dir.from('profiles').select('role').eq('id', man.uid).single()).data.role === 'manager', 'управляющий не повышает себе роль')
  ok(denied(await tr.from('crm_settings').update({ value: 999 }).eq('key', 'lesson_rate').select()), 'тренер не меняет ставку')
  ok(denied(await man.from('crm_settings').update({ value: 999 }).eq('key', 'lesson_rate').select()), 'управляющий не меняет ставку')
  ok((await rows(tr.from('payments').select('id'))) === 0, 'тренер не видит платежи')
  ok((await rows(tr.from('expenses').select('id'))) === 0, 'тренер не видит расходы')
  ok((await rows(sal.from('expenses').select('id'))) === 0, 'продажи не видят расходы')
  ok((await rows(tr.from('fines').select('id'))) === 1, 'тренер видит только свой штраф')
  ok(denied(await tr.from('fines').delete().eq('reason', 'QA штраф').select()), 'тренер не удаляет свой штраф')
  const p1 = (await dir.from('payments').select('id').eq('branch_id', b1).single()).data.id
  await dir.from('payments').delete().eq('id', p1)
  ok((await rows(dir.from('payments').select('id').eq('id', p1))) === 1, 'платёж не удаляется даже директором')
  await man.from('payments').update({ amount: 1 }).eq('id', p1)
  ok((await dir.from('payments').select('amount').eq('id', p1).single()).data.amount == 5000, 'управляющий не меняет сумму платежа')

  // Аноним и серверные функции
  for (const t of ['students', 'parents', 'payments', 'profiles', 'branches', 'crm_settings']) ok((await rows(anon.from(t).select('id').limit(1))) <= 0, `аноним не читает ${t}`)
  ok(!!(await anon.rpc('start_shift', { p_branch: b1 })).error, 'аноним не вызывает RPC')
  const fn = async (c, name, body) => { const r = await c.functions.invoke(name, { body }); return r.error?.context?.status ?? 200 }
  ok((await fn(man, 'admin-users', { action: 'create', full_name: 'X', role: 'director' })) === 403, 'управляющий не создаёт аккаунты (403)')
  ok((await fn(tr, 'admin-users', { action: 'create', full_name: 'X', role: 'director' })) === 403, 'тренер не создаёт аккаунты (403)')
  ok((await fn(anon, 'admin-users', {})) >= 401, 'аноним не вызывает admin-users')
  ok((await fn(adm, 'amocrm', { action: 'status' })) === 403, 'админ не управляет amoCRM (403)')

  console.log(fails ? `ПРОВАЛОВ: ${fails}` : 'ВСЁ OK')
})().catch((e) => { console.error(e); process.exit(1) })
