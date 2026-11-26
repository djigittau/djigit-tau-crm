// DJIGIT TAU CRM · amocrm — интеграция amoCRM → CRM (только в эту сторону).
//
// Вызовы:
//   GET  ?code=…&state=…&referer=…            — возврат из amoCRM после OAuth (redirect_uri = адрес этой функции)
//   POST ?webhook=<AMO_WEBHOOK_KEY>            — webhook amoCRM (form-urlencoded), каждое событие один раз
//   POST {"action":"status"}                   — директор: подключение и аккаунт (без токенов)
//   POST {"action":"sync","kind":"manual"}     — директор: синхронизация; cron — с заголовком x-agents-key
//
// Секреты (Supabase → Edge Functions → Secrets): AMO_CLIENT_ID, AMO_CLIENT_SECRET — для OAuth;
// или AMO_DOMAIN + AMO_TOKEN (долгосрочный токен). Ключ webhook — AMO_WEBHOOK_KEY или случайный из базы.
// Токены OAuth хранятся в private.amocrm_credentials (функции amocrm_creds / amocrm_save_creds, только service_role).
import { createClient } from 'npm:@supabase/supabase-js@2'

const env = (k: string) => Deno.env.get(k) ?? ''
const SELF = `${env('SUPABASE_URL')}/functions/v1/amocrm`
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const DOMAIN_RE = /^[a-z0-9-]+\.(amocrm\.(ru|com)|kommo\.com)$/
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-agents-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const page = (title: string, text: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;background:#0b0b0c;color:#ece6d8;display:grid;place-items:center;height:90vh"><div><h2 style="color:#e4c77a">${title}</h2><p>${text}</p></div>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )

async function setting<T>(k: string): Promise<T | null> {
  const { data } = await db.from('crm_settings').select('value').eq('key', k).maybeSingle()
  return (data?.value as T) ?? null
}
const putSetting = (key: string, value: unknown) => db.from('crm_settings').upsert({ key, value, updated_at: new Date().toISOString() })

async function domain() {
  const d = (env('AMO_DOMAIN') || (await setting<string>('amocrm_domain')) || '').toLowerCase().trim()
  return DOMAIN_RE.test(d) ? d : ''
}
const clientId = async () => env('AMO_CLIENT_ID') || (await setting<string>('amocrm_client_id')) || ''

async function saveTokens(d: string, j: { access_token: string; refresh_token: string; expires_in: number }) {
  const r = await db.rpc('amocrm_save_creds', { p_domain: d, p_access: j.access_token, p_refresh: j.refresh_token, p_expires: new Date(Date.now() + j.expires_in * 1000).toISOString() })
  if (r.error) throw new Error('Не удалось сохранить токен: ' + r.error.message)
}

async function oauthExchange(d: string, body: Record<string, string>) {
  const r = await fetch(`https://${d}/oauth2/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: await clientId(), client_secret: env('AMO_CLIENT_SECRET'), redirect_uri: SELF, ...body }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) throw new Error(`amoCRM OAuth ${r.status}: ${j.hint ?? j.detail ?? j.title ?? 'ошибка'}`)
  await saveTokens(d, j)
  return j.access_token as string
}

// Токен: OAuth (с автообновлением за минуту до истечения) или долгосрочный AMO_TOKEN.
async function token(d: string): Promise<{ t: string; via: string }> {
  const { data } = await db.rpc('amocrm_creds')
  const c = (data as { domain: string; access_token: string; refresh_token: string; expires_at: string }[] | null)?.[0]
  if (c?.access_token && c.domain === d) {
    if (new Date(c.expires_at).getTime() - 60_000 > Date.now()) return { t: c.access_token, via: 'oauth' }
    return { t: await oauthExchange(d, { grant_type: 'refresh_token', refresh_token: c.refresh_token }), via: 'oauth' }
  }
  return { t: env('AMO_TOKEN'), via: env('AMO_TOKEN') ? 'token' : '' }
}

async function amo(d: string, t: string, path: string, q: Record<string, string | number | string[]> = {}) {
  const u = new URL(`https://${d}${path}`)
  for (const [k, v] of Object.entries(q)) for (const x of Array.isArray(v) ? v : [v]) u.searchParams.append(k, String(x))
  const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } })
  if (r.status === 204) return null
  if (!r.ok) throw new Error(`amoCRM ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return await r.json()
}
async function pages(d: string, t: string, path: string, key: string, q: Record<string, string | number | string[]> = {}, max = 40) {
  const out: any[] = []
  for (let p = 1; p <= max; p++) {
    const a = (await amo(d, t, path, { ...q, limit: 250, page: p }))?._embedded?.[key] ?? []
    out.push(...a)
    if (a.length < 250) break
  }
  return out
}
const phoneOf = (c: any) => c?.custom_fields_values?.find((f: any) => f.field_code === 'PHONE')?.values?.[0]?.value ?? null
const mapId = async (entity: string, ext: number) =>
  (await db.from('amocrm_mappings').select('internal_id').eq('entity', entity).eq('external_id', ext).maybeSingle()).data?.internal_id as string | undefined
const putMap = (entity: string, ext: number, table: string | null, id: string | null, raw: unknown) =>
  db.from('amocrm_mappings').upsert({ entity, external_id: ext, internal_table: table, internal_id: id, raw, synced_at: new Date().toISOString() }, { onConflict: 'entity,external_id' })

// Синхронизация amoCRM → CRM. leadIds — только эти сделки (из webhook).
async function sync(kind: string, leadIds?: number[]) {
  const d = await domain()
  const { t } = d ? await token(d) : { t: '' }
  if (!d || !t) {
    if (kind === 'periodic') return { skipped: 'amoCRM не подключён' }
    throw new Error('amoCRM не подключён: укажите домен и подключите OAuth (или задайте AMO_TOKEN)')
  }
  const log = (await db.from('amocrm_sync_logs').insert({ kind }).select('id').single()).data!
  const c = { items_in: 0, items_created: 0, items_updated: 0 }
  try {
    // Сотрудники amoCRM → профили CRM по email.
    const profiles = (await db.from('profiles').select('id, email')).data ?? []
    const byEmail = new Map(profiles.filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p.id]))
    const users = new Map<number, string>()
    for (const u of await pages(d, t, '/api/v4/users', 'users', {}, 4)) {
      const pid = byEmail.get(String(u.email ?? '').toLowerCase())
      if (pid) users.set(u.id, pid)
      await putMap('user', u.id, pid ? 'profiles' : null, pid ?? null, { name: u.name, email: u.email })
    }
    // Воронки и этапы — для настройки соответствия филиалам и статусам.
    for (const p of (await amo(d, t, '/api/v4/leads/pipelines'))?._embedded?.pipelines ?? []) {
      await putMap('pipeline', p.id, null, null, { name: p.name })
      for (const s of p._embedded?.statuses ?? []) await putMap('status', s.id, null, null, { name: s.name, pipeline_id: p.id, pipeline: p.name })
    }
    const branchMap = (await setting<Record<string, string>>('amocrm_pipeline_branch')) ?? {}
    const statusMap = (await setting<Record<string, string>>('amocrm_status_map')) ?? {}

    // Сделки: из webhook — по id; иначе изменённые с прошлой удачной синхронизации (первая — за год).
    let leads: any[] = []
    let from = Math.floor(Date.now() / 1000) - 365 * 86400
    if (leadIds?.length) {
      for (let i = 0; i < leadIds.length; i += 50) leads.push(...(await pages(d, t, '/api/v4/leads', 'leads', { with: 'contacts', 'filter[id][]': leadIds.slice(i, i + 50).map(String) }, 1)))
    } else {
      const last = (await db.from('amocrm_sync_logs').select('started_at').eq('status', 'ok').neq('kind', 'oauth').order('started_at', { ascending: false }).limit(1).maybeSingle()).data
      if (last) from = Math.floor(new Date(last.started_at).getTime() / 1000) - 3600
      leads = await pages(d, t, '/api/v4/leads', 'leads', { with: 'contacts', 'filter[updated_at][from]': from })
    }
    c.items_in = leads.length

    // Контакты (родители) — пачками.
    const cids = [...new Set(leads.flatMap((l) => (l._embedded?.contacts ?? []).map((x: any) => x.id)))]
    const contacts = new Map<number, any>()
    for (let i = 0; i < cids.length; i += 50)
      for (const x of await pages(d, t, '/api/v4/contacts', 'contacts', { 'filter[id][]': cids.slice(i, i + 50).map(String) }, 1)) contacts.set(x.id, x)

    for (const l of leads) {
      const main = l._embedded?.contacts?.find((x: any) => x.is_main) ?? l._embedded?.contacts?.[0]
      const ct = main ? contacts.get(main.id) : null
      const status = l.status_id === 142 ? 'bought' : l.status_id === 143 ? 'refused' : statusMap[l.status_id] ?? 'new'
      const row = {
        child_name: (l.name || `Сделка ${l.id}`).slice(0, 200),
        parent_name: ct?.name ?? null,
        phone: phoneOf(ct),
        branch_id: branchMap[l.pipeline_id] ?? null,
        manager_id: users.get(l.responsible_user_id) ?? null,
        source: 'amoCRM',
        status,
        refusal_reason: status === 'refused' ? 'Закрыта в amoCRM' : null,
      }
      const id = await mapId('lead', l.id)
      let tid = id
      if (id) {
        const r = await db.from('trial_leads').update(row).eq('id', id).select('id').maybeSingle()
        if (r.error) throw new Error(`Сделка ${l.id}: ${r.error.message}`)
        if (r.data) c.items_updated++
        else tid = undefined // запись удалили в CRM — создадим заново
      }
      if (!tid) {
        const r = await db.from('trial_leads').insert(row).select('id').single()
        if (r.error) throw new Error(`Сделка ${l.id}: ${r.error.message}`)
        tid = r.data.id
        c.items_created++
      }
      await putMap('lead', l.id, 'trial_leads', tid!, { name: l.name, pipeline_id: l.pipeline_id, status_id: l.status_id, price: l.price })
      if (main) {
        const pid = (await db.from('trial_leads').select('parent_id').eq('id', tid!).single()).data?.parent_id ?? null
        await putMap('contact', main.id, pid ? 'parents' : null, pid, { name: ct?.name })
      }
    }

    // Задачи менеджеров по сделкам → напоминания в истории пробника.
    const tasks = await pages(d, t, '/api/v4/tasks', 'tasks', { 'filter[entity_type]': 'leads', 'filter[updated_at][from]': from }, 10)
    for (const k of tasks) {
      if (leadIds?.length && !leadIds.includes(k.entity_id)) continue
      const lead = await mapId('lead', k.entity_id)
      if (!lead) continue
      const ev = { trial_lead_id: lead, kind: 'task', text: (k.text || 'Задача из amoCRM').slice(0, 1000), due_at: k.complete_till ? new Date(k.complete_till * 1000).toISOString() : null, done: !!k.is_completed, author_id: null }
      const id = await mapId('task', k.id)
      if (id) await db.from('trial_events').update(ev).eq('id', id)
      else {
        const r = await db.from('trial_events').insert(ev).select('id').single()
        if (r.data) await putMap('task', k.id, 'trial_events', r.data.id, { text: k.text })
      }
    }

    await db.from('amocrm_sync_logs').update({ ...c, status: 'ok', finished_at: new Date().toISOString() }).eq('id', log.id)
    return c
  } catch (e) {
    await db.from('amocrm_sync_logs').update({ ...c, status: 'error', error: String((e as Error).message).slice(0, 1000), finished_at: new Date().toISOString() }).eq('id', log.id)
    throw e
  }
}

async function caller(req: Request): Promise<'director' | 'cron' | null> {
  const k = req.headers.get('x-agents-key')
  if (k) {
    const { data } = await db.rpc('agents_key')
    return data && k === data ? 'cron' : null
  }
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '')
  const { data } = await db.auth.getUser(jwt)
  if (!data?.user) return null
  const { data: p } = await db.from('profiles').select('role, status').eq('id', data.user.id).maybeSingle()
  return p?.role === 'director' && p.status === 'active' ? 'director' : null
}

// Ключ webhook: секрет AMO_WEBHOOK_KEY или случайный ключ из закрытой таблицы (миграция 0008).
async function webhookKey() {
  if (env('AMO_WEBHOOK_KEY')) return env('AMO_WEBHOOK_KEY')
  const { data } = await db.rpc('amocrm_creds')
  return ((data as { webhook_key: string }[] | null)?.[0]?.webhook_key ?? '') as string
}

async function sha256(s: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)
  try {
    // 1. Возврат из amoCRM после подключения.
    if (req.method === 'GET' && url.searchParams.get('code')) {
      const state = url.searchParams.get('state')
      if (!state || state !== (await setting<string>('amocrm_oauth_state'))) return page('Ошибка подключения', 'Ссылка устарела. Нажмите «Подключить amoCRM» в CRM ещё раз.')
      const d = (url.searchParams.get('referer') || (await domain())).toLowerCase()
      if (!DOMAIN_RE.test(d)) return page('Ошибка подключения', 'Неизвестный адрес amoCRM.')
      await oauthExchange(d, { grant_type: 'authorization_code', code: url.searchParams.get('code')! })
      await putSetting('amocrm_domain', d)
      await db.from('crm_settings').delete().eq('key', 'amocrm_oauth_state')
      await db.from('amocrm_sync_logs').insert({ kind: 'oauth', status: 'ok', finished_at: new Date().toISOString(), details: { domain: d } })
      return page('amoCRM подключён', 'Вернитесь в CRM и нажмите «Синхронизировать».')
    }

    // 2. Webhook: ключ в адресе, повтор того же события не обрабатывается.
    if (url.searchParams.has('webhook')) {
      const wk = await webhookKey()
      if (!wk || url.searchParams.get('webhook') !== wk) return json({ error: 'forbidden' }, 403)
      const raw = await req.text()
      const key = await sha256(raw)
      const ins = await db.from('amocrm_webhook_events').insert({ event_key: key, payload: { raw: raw.slice(0, 20000) } })
      if (ins.error) return json({ ok: true, duplicate: true }) // уже обработано
      const ids = new Set<number>()
      for (const [k, v] of new URLSearchParams(raw)) if (/^leads\[(add|update|status|restore)\]\[\d+\]\[id\]$/.test(k)) ids.add(Number(v))
      try {
        if (ids.size) await sync('webhook', [...ids])
        await db.from('amocrm_webhook_events').update({ status: ids.size ? 'ok' : 'skipped', processed_at: new Date().toISOString() }).eq('event_key', key)
      } catch (e) {
        await db.from('amocrm_webhook_events').update({ status: 'error', error: String((e as Error).message).slice(0, 500), processed_at: new Date().toISOString() }).eq('event_key', key)
      }
      return json({ ok: true })
    }

    // 3. Действия директора и cron.
    const who = await caller(req)
    if (!who) return json({ error: 'Только директор' }, 403)
    const b = await req.json().catch(() => ({}))
    if (b.action === 'status') {
      const d = await domain()
      const tk = d ? await token(d).catch((e) => ({ t: '', via: 'error: ' + (e as Error).message })) : { t: '', via: '' }
      let account = null
      let error = null
      if (d && tk.t) {
        try {
          const a = await amo(d, tk.t, '/api/v4/account')
          account = { name: a.name, id: a.id }
        } catch (e) {
          error = (e as Error).message
        }
      }
      return json({
        domain: d || null,
        via: tk.via || null,
        connected: !!account,
        account,
        error,
        oauth_ready: !!(await clientId()) && !!env('AMO_CLIENT_SECRET'),
        redirect_uri: SELF,
        webhook_url: (await webhookKey()) ? `${SELF}?webhook=${await webhookKey()}` : null,
      })
    }
    if (b.action === 'sync') return json(await sync(who === 'cron' ? 'periodic' : b.kind === 'initial' ? 'initial' : 'manual'))
    return json({ error: 'Неизвестное действие' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
