import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { useLoad, must, State, PageHead, Field, Empty, Icon, act, toast, fmtDateTime } from '../lib/ui'
import { loadBranches, TRIAL_STATUS, TRIAL_ORDER } from '../lib/refs'

// Интеграция amoCRM → CRM. Только директор (RLS + проверка в Edge Function `amocrm`). Токены в интерфейс не попадают.
type Status = { domain: string | null; via: string | null; connected: boolean; account: { name: string; id: number } | null; error: string | null; oauth_ready: boolean; redirect_uri: string; webhook_url: string | null }
type Log = { id: number; kind: string; status: string; started_at: string; items_in: number; items_created: number; items_updated: number; error: string | null }
type Mapping = { entity: string; external_id: number; raw: { name?: string; pipeline?: string } | null }

const KIND: Record<string, string> = { initial: 'Первичная', periodic: 'По расписанию', webhook: 'Webhook', manual: 'Вручную', oauth: 'Подключение' }
// Этапы 142 и 143 в amoCRM — «Успешно реализовано» и «Закрыто и не реализовано»: сопоставляются автоматически.
const AUTO = new Set([142, 143])
const DOMAIN_RE = /^[a-z0-9-]+\.(amocrm\.(ru|com)|kommo\.com)$/

// Вызов Edge Function: при ошибке достаём текст из тела ответа.
async function amo<T>(body: Record<string, string>): Promise<T> {
  const { data, error } = await sb.functions.invoke('amocrm', { body })
  if (error) {
    const j = await (error as { context?: Response }).context?.json?.().catch(() => null)
    throw new Error(j?.error ?? error.message)
  }
  return data as T
}

export default function AmoCRM() {
  const { data, loading, error, reload } = useLoad(async () => {
    const [settings, logs, maps, branches] = await Promise.all([
      sb.from('crm_settings').select('key, value').like('key', 'amocrm_%').then(must),
      sb.from('amocrm_sync_logs').select('id, kind, status, started_at, items_in, items_created, items_updated, error').order('started_at', { ascending: false }).limit(30).then(must),
      sb.from('amocrm_mappings').select('entity, external_id, raw').in('entity', ['pipeline', 'status']).order('external_id').then(must),
      loadBranches(),
    ])
    const s = Object.fromEntries((settings as { key: string; value: unknown }[]).map((r) => [r.key, r.value]))
    return { s, logs: logs as Log[], maps: maps as Mapping[], branches }
  }, [])
  const [st, setSt] = useState<Status | null>(null)
  const [stErr, setStErr] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [form, setForm] = useState({ domain: '', client: '' })
  const [pb, setPb] = useState<Record<string, string>>({})
  const [sm, setSm] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!data) return
    setForm({ domain: String(data.s.amocrm_domain ?? ''), client: String(data.s.amocrm_client_id ?? '') })
    setPb((data.s.amocrm_pipeline_branch as Record<string, string>) ?? {})
    setSm((data.s.amocrm_status_map as Record<string, string>) ?? {})
  }, [data])

  async function check(quiet = false) {
    setBusy('check')
    try {
      const r = await amo<Status>({ action: 'status' })
      setSt(r)
      setStErr(null)
      if (!quiet) toast(r.connected ? 'Подключение работает' : 'amoCRM не подключён', !r.connected)
    } catch (e) {
      setStErr('Сервер интеграции: ' + (e as Error).message)
    } finally {
      setBusy('')
    }
  }
  useEffect(() => {
    check(true)
  }, [])

  async function saveMain(e: React.FormEvent) {
    e.preventDefault()
    const d = form.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    const ok = await act(async () => {
      if (!DOMAIN_RE.test(d)) throw new Error('Адрес amoCRM вида studio.amocrm.ru')
      must(await sb.from('crm_settings').upsert([{ key: 'amocrm_domain', value: d }, { key: 'amocrm_client_id', value: form.client.trim() }]))
    }, 'Сохранено')
    if (ok) {
      reload()
      check(true)
    }
  }

  // OAuth: случайный state в базе, функция amocrm сверит его при возврате из amoCRM.
  async function connect() {
    const saved = String(data?.s.amocrm_client_id ?? '')
    if (!saved || saved !== form.client.trim()) return toast('Сначала сохраните ID интеграции', true)
    const state = crypto.randomUUID()
    if (await act(async () => must(await sb.from('crm_settings').upsert({ key: 'amocrm_oauth_state', value: state }))))
      location.href = `https://www.amocrm.ru/oauth?client_id=${encodeURIComponent(saved)}&state=${state}`
  }

  async function sync() {
    setBusy('sync')
    const initial = !data?.logs.some((l) => l.status === 'ok' && l.kind !== 'oauth')
    await act(async () => {
      const c = await amo<{ items_in: number; items_created: number; items_updated: number }>({ action: 'sync', kind: initial ? 'initial' : 'manual' })
      toast(`Сделок: ${c.items_in}, новых: ${c.items_created}, обновлено: ${c.items_updated}`)
    })
    setBusy('')
    reload() // ошибка тоже попадает в историю
  }

  async function saveMaps() {
    const clean = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v))
    if (await act(async () => must(await sb.from('crm_settings').upsert([{ key: 'amocrm_pipeline_branch', value: clean(pb) }, { key: 'amocrm_status_map', value: clean(sm) }])), 'Соответствия сохранены'))
      reload()
  }

  const pipelines = data?.maps.filter((m) => m.entity === 'pipeline') ?? []
  const statuses = data?.maps.filter((m) => m.entity === 'status' && !AUTO.has(m.external_id)) ?? []
  const hook = st?.webhook_url

  return (
    <>
      <PageHead title="Интеграция amoCRM" sub="Сделки из amoCRM попадают в «Пробники». Направление только amoCRM → CRM.">
        <button className="btn ghost" onClick={() => check()} disabled={!!busy}>
          {busy === 'check' ? 'Проверяем…' : 'Проверить подключение'}
        </button>
        <button className="btn" onClick={sync} disabled={!!busy || !st?.connected} title={st?.connected ? '' : 'Сначала подключите amoCRM'}>
          {busy === 'sync' ? 'Синхронизация…' : 'Синхронизировать'}
        </button>
      </PageHead>
      <State loading={loading} error={error}>
        <div className="grid-2">
          <section className="card">
            <h3>Подключение</h3>
            {stErr && <div className="alert bad">{stErr}</div>}
            {st && (
              <dl className="props">
                <dt>Статус</dt>
                <dd>{st.connected ? <span className="badge ok">Подключено</span> : <span className="badge bad">Не подключено</span>}</dd>
                <dt>Аккаунт</dt>
                <dd>{st.account ? `${st.account.name} (ID ${st.account.id})` : '—'}</dd>
                <dt>Способ</dt>
                <dd>{st.via === 'oauth' ? 'OAuth 2.0' : st.via === 'token' ? 'Долгосрочный токен' : st.via || '—'}</dd>
                {st.error && (
                  <>
                    <dt>Ошибка</dt>
                    <dd className="danger-text">{st.error}</dd>
                  </>
                )}
              </dl>
            )}
            <form className="form-grid" onSubmit={saveMain}>
              <Field label="Адрес amoCRM" full>
                <input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="studio.amocrm.ru" />
              </Field>
              <Field label="ID интеграции (client_id)" hint="amoCRM → Настройки → Интеграции → ваша интеграция → «Ключи и доступы». Секретный ключ вводится только в Supabase." full>
                <input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
              </Field>
              <div className="full row">
                <button className="btn ghost">Сохранить</button>
                <button type="button" className="btn" onClick={connect}>
                  <Icon name="key" /> Подключить amoCRM
                </button>
              </div>
            </form>
            {st && !st.oauth_ready && <p className="muted small">Для подключения нужен секрет AMO_CLIENT_SECRET в Supabase → Edge Functions → Secrets.</p>}
          </section>
          <section className="card">
            <h3>Адреса для amoCRM</h3>
            <dl className="props">
              <dt>Redirect URI</dt>
              <dd className="break">{st?.redirect_uri ?? '—'}</dd>
              <dt>Webhook</dt>
              <dd className="break">{hook ?? '—'}</dd>
            </dl>
            {hook && (
              <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(hook).then(() => toast('Адрес скопирован'))}>
                Скопировать адрес webhook
              </button>
            )}
            <p className="muted small">
              Webhook: amoCRM → Настройки → Интеграции → Web hooks, события «Сделка добавлена», «Сделка изменена», «Смена статуса». Раз в час синхронизация запускается сама и подбирает
              пропущенное.
            </p>
          </section>
        </div>

        <section className="card">
          <div className="page-head">
            <h3 style={{ margin: 0 }}>Соответствия</h3>
            <div className="actions">
              <button className="btn sm" onClick={saveMaps} disabled={!pipelines.length}>
                Сохранить соответствия
              </button>
            </div>
          </div>
          {pipelines.length ? (
            <div className="grid-2" style={{ marginTop: 14 }}>
              <div className="branch-pick">
                <p className="muted small">Воронка → филиал</p>
                {pipelines.map((p) => (
                  <div className="branch-row" key={p.external_id}>
                    <span>{p.raw?.name}</span>
                    <select value={pb[p.external_id] ?? ''} onChange={(e) => setPb({ ...pb, [p.external_id]: e.target.value })} aria-label={`Филиал для воронки ${p.raw?.name}`}>
                      <option value="">— без филиала —</option>
                      {data?.branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="branch-pick">
                <p className="muted small">Этап → статус пробника. «Успешно реализовано» — купил, «Закрыто и не реализовано» — отказ (автоматически).</p>
                {statuses.map((s) => (
                  <div className="branch-row" key={s.external_id}>
                    <span>
                      {s.raw?.name} <small className="muted">· {s.raw?.pipeline}</small>
                    </span>
                    <select value={sm[s.external_id] ?? ''} onChange={(e) => setSm({ ...sm, [s.external_id]: e.target.value })} aria-label={`Статус для этапа ${s.raw?.name}`}>
                      <option value="">{TRIAL_STATUS.new}</option>
                      {TRIAL_ORDER.filter((k) => k !== 'new').map((k) => (
                        <option key={k} value={k}>
                          {TRIAL_STATUS[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Empty text="Воронки и этапы появятся после первой синхронизации" icon="funnel" />
          )}
        </section>

        <section className="card flush">
          <h3 style={{ padding: '16px 16px 0' }}>История синхронизации</h3>
          {data?.logs.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Начало</th>
                    <th>Тип</th>
                    <th>Результат</th>
                    <th className="num">Сделок</th>
                    <th className="num">Новых</th>
                    <th className="num">Обновлено</th>
                    <th>Ошибка</th>
                  </tr>
                </thead>
                <tbody>
                  {data.logs.map((l) => (
                    <tr key={l.id}>
                      <td className="nowrap">{fmtDateTime(l.started_at)}</td>
                      <td>{KIND[l.kind] ?? l.kind}</td>
                      <td>
                        <span className={'badge ' + (l.status === 'ok' ? 'ok' : l.status === 'error' ? 'bad' : 'gold')}>
                          {l.status === 'ok' ? 'Успешно' : l.status === 'error' ? 'Ошибка' : 'Идёт'}
                        </span>
                      </td>
                      <td className="num">{l.items_in}</td>
                      <td className="num">{l.items_created}</td>
                      <td className="num">{l.items_updated}</td>
                      <td className="danger-text small">{l.error ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="Синхронизаций ещё не было" icon="clock" />
          )}
        </section>
      </State>
    </>
  )
}
