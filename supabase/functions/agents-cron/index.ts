// Круглосуточные агенты «DJIGIT TAU»: проверка amoCRM по расписанию и отчёты в WhatsApp (официальный WhatsApp Cloud API).
//
// Режимы (всегда нужен заголовок x-agents-key = секрет AGENTS_KEY):
//   POST {}              — Карим проверяет amoCRM и присылает отчёт (так вызывает расписание pg_cron)
//   POST {"text":"..."}  — отправить готовую сводку из CRM (кнопка «Отправить в WhatsApp»)
//   POST {"test":true}   — проверочное сообщение
//
// Секреты (Supabase → Edge Functions → Secrets):
//   AGENTS_KEY       — пароль агентов, его же вставляют в CRM. Если не задан, берётся из Supabase Vault
//                      (секрет agents_key, через SQL-функцию public.agents_key(), доступную только service_role)
//   WA_TOKEN         — постоянный токен системного пользователя Meta (whatsapp_business_messaging)
//   WA_PHONE_ID      — Phone number ID отправителя из WhatsApp Manager
//   WA_TO            — получатели через запятую, только цифры: 77010000000,77020000000
//   WA_TEMPLATE      — имя одобренного шаблона с одной переменной {{1}} (по умолчанию agents_report)
//   WA_LANG          — язык шаблона (по умолчанию ru)
//   WA_API_VERSION   — версия Graph API (по умолчанию v23.0)
//   AMO_DOMAIN, AMO_TOKEN — адрес amoCRM (studio.amocrm.ru) и долгосрочный токен
//   AUTO_TASKS=1     — Карим сам ставит задачи в amoCRM на сделки без задач
//   SEND_IF_OK=1     — присылать отчёт, даже если проблем нет
//   ALLOW_ORIGIN     — адрес, где открыта CRM (по умолчанию *)

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const cors = {
  "Access-Control-Allow-Origin": env("ALLOW_ORIGIN", "*"),
  "Access-Control-Allow-Headers": "content-type, x-agents-key, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/* ---------- WhatsApp Cloud API ---------- */
// Переменная шаблона не может содержать переводы строк, табы и больше 4 пробелов подряд.
const forTemplate = (s: string) =>
  s.replace(/\s*\n+\s*/g, " · ").replace(/\t/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 1000);

async function waSend(to: string, text: string) {
  const tpl = env("WA_TEMPLATE", "agents_report");
  const url = `https://graph.facebook.com/${env("WA_API_VERSION", "v23.0")}/${env("WA_PHONE_ID")}/messages`;
  const message = tpl === "-"
    ? { type: "text", text: { body: text.slice(0, 4000) } } // свободный текст: только в течение 24 ч после сообщения получателя
    : {
      type: "template",
      template: {
        name: tpl,
        language: { code: env("WA_LANG", "ru") },
        components: [{ type: "body", parameters: [{ type: "text", text: forTemplate(text) }] }],
      },
    };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${env("WA_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, ...message }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${to}: ${j?.error?.message ?? r.status}`);
  return j?.messages?.[0]?.id as string | undefined;
}

async function waSendAll(text: string) {
  const to = env("WA_TO").split(/[,;]+/).map((x) => x.replace(/\D/g, "")).filter(Boolean);
  if (!env("WA_TOKEN") || !env("WA_PHONE_ID") || !to.length) throw new Error("Не заданы WA_TOKEN, WA_PHONE_ID или WA_TO");
  const sent: string[] = [], errors: string[] = [];
  for (const n of to) {
    try { await waSend(n, text); sent.push(n); } catch (e) { errors.push(String((e as Error).message)); }
  }
  return { sent: sent.length, errors };
}

/* ---------- amoCRM ---------- */
async function amo(path: string, init: RequestInit = {}, query: Record<string, string | number> = {}) {
  const u = new URL(`https://${env("AMO_DOMAIN")}${path}`);
  Object.entries(query).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  const r = await fetch(u, { ...init, headers: { "Authorization": `Bearer ${env("AMO_TOKEN")}`, "Content-Type": "application/json" } });
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`amoCRM ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}
async function amoPages(path: string, key: string, query: Record<string, string | number> = {}, max = 8) {
  const out: any[] = [];
  for (let page = 1; page <= max; page++) {
    const j = await amo(path, {}, { ...query, limit: 250, page });
    const a = j?._embedded?.[key] ?? [];
    out.push(...a);
    if (a.length < 250) break;
  }
  return out;
}
const names = (a: { name?: string; id: number }[], k = 4) =>
  a.slice(0, k).map((x) => x.name || `#${x.id}`).join(", ") + (a.length > k ? ` и ещё ${a.length - k}` : "");

async function amoReport(): Promise<string | null> {
  if (!/^[a-z0-9-]+\.(amocrm\.(ru|com)|kommo\.com)$/.test(env("AMO_DOMAIN")) || !env("AMO_TOKEN")) {
    throw new Error("Не заданы AMO_DOMAIN или AMO_TOKEN");
  }
  const now = Math.floor(Date.now() / 1000);
  const users = Object.fromEntries((await amoPages("/api/v4/users", "users", {}, 2)).map((u) => [u.id, u.name]));
  const leads = await amoPages("/api/v4/leads", "leads", { "filter[updated_at][from]": now - 120 * 86400 });
  const tasks = (await amoPages("/api/v4/tasks", "tasks", { "filter[is_completed]": 0 }, 4)).filter((t) => !t.is_completed);

  const open = leads.filter((l) => l.status_id !== 142 && l.status_id !== 143);
  const withTask = new Set(tasks.filter((t) => t.entity_type === "leads").map((t) => t.entity_id));
  const noTask = open.filter((l) => !withTask.has(l.id) && !l.closest_task_at);
  const late = tasks.filter((t) => t.complete_till && t.complete_till < now);
  const stale = open.filter((l) => l.updated_at && now - l.updated_at > 7 * 86400);

  const lines: string[] = [];
  if (noTask.length) {
    let made = "";
    if (env("AUTO_TASKS") === "1") {
      const list = noTask.slice(0, 100);
      for (let i = 0; i < list.length; i += 50) {
        await amo("/api/v4/tasks", {
          method: "POST",
          body: JSON.stringify(list.slice(i, i + 50).map((l) => ({
            text: "Связаться с клиентом и назначить следующий шаг (агент Карим)",
            complete_till: now + 3600, entity_id: l.id, entity_type: "leads", task_type_id: 1,
            ...(l.responsible_user_id ? { responsible_user_id: l.responsible_user_id } : {}),
          }))),
        });
      }
      made = ` — Карим поставил задач: ${list.length}`;
    }
    lines.push(`Сделки без задачи: ${noTask.length} (${names(noTask)})${made}`);
  }
  if (late.length) {
    const by: Record<string, number> = {};
    late.forEach((t) => { const k = users[t.responsible_user_id] ?? "без ответственного"; by[k] = (by[k] ?? 0) + 1; });
    lines.push(`Просрочено задач: ${late.length} (${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([u, n]) => `${u} — ${n}`).join("; ")})`);
  }
  if (stale.length) lines.push(`Сделки без движения больше 7 дней: ${stale.length} (${names(stale.sort((a, b) => a.updated_at - b.updated_at))})`);
  if (!lines.length && env("SEND_IF_OK") !== "1") return null;

  const ms = new Date(); ms.setDate(1); ms.setHours(0, 0, 0, 0);
  const from = Math.floor(ms.getTime() / 1000);
  const won = leads.filter((l) => l.status_id === 142 && (l.closed_at ?? 0) >= from);
  const sum = won.reduce((s, l) => s + (l.price || 0), 0);
  const when = new Date().toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return [`Агент Карим, amoCRM, ${when}`, ...(lines.length ? lines : ["Всё спокойно"]),
    `Месяц: успешных сделок ${won.length} на ${sum.toLocaleString("ru-RU")} ₸, открыто ${open.length}`].join("\n");
}

let cachedKey = "";
async function agentsKey(): Promise<string> {
  if (env("AGENTS_KEY")) return env("AGENTS_KEY");
  if (cachedKey) return cachedKey;
  const url = env("SUPABASE_URL"), srk = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !srk) return "";
  const r = await fetch(`${url}/rest/v1/rpc/agents_key`, {
    method: "POST",
    headers: { "apikey": srk, "Authorization": `Bearer ${srk}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) return "";
  cachedKey = String(await r.json() ?? "");
  return cachedKey;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  const key = await agentsKey();
  if (!key || req.headers.get("x-agents-key") !== key) return json(401, { error: "bad agents key" });

  const body = await req.json().catch(() => ({})) as { text?: unknown; test?: unknown };
  try {
    const text = body.test
      ? "Проверка связи: агенты DJIGIT TAU подключены к WhatsApp"
      : typeof body.text === "string" && body.text.trim()
      ? body.text.slice(0, 3000)
      : await amoReport();
    if (!text) return json(200, { sent: 0, skipped: "Проблем не найдено" });
    const res = await waSendAll(text);
    return json(res.sent ? 200 : 502, res);
  } catch (e) {
    return json(500, { error: String((e as Error).message) });
  }
});
