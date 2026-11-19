// Посредник между CRM «DJIGIT TAU» (браузер) и API amoCRM / Kommo.
// amoCRM не отдаёт CORS-заголовки, поэтому браузер не может обращаться к API напрямую.
// Функция пересылает запрос только на домены amoCRM/Kommo и только в /api/v4/.
// Токен приходит от браузера в заголовке X-Amo-Token и нигде не сохраняется.
//
// Развёртывание (Supabase CLI):
//   supabase functions deploy amocrm-proxy --no-verify-jwt
// Адрес для CRM: https://<project-ref>.supabase.co/functions/v1/amocrm-proxy

const DOMAIN_RE = /^[a-z0-9-]+\.(amocrm\.(ru|com)|kommo\.com)$/;
const PATH_RE = /^\/api\/v4\/[a-z0-9_\/]+$/;
const METHODS = new Set(["GET", "POST", "PATCH"]);

// Ограничьте адресом, где открыта CRM, например "https://djigittau.github.io". "*" — любые сайты.
const ALLOW_ORIGIN = Deno.env.get("ALLOW_ORIGIN") ?? "*";

const cors = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Headers": "content-type, x-amo-domain, x-amo-token, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (!METHODS.has(req.method)) return json(405, { error: "method not allowed" });

  const url = new URL(req.url);
  const path = url.searchParams.get("path") ?? "";
  const domain = (req.headers.get("x-amo-domain") ?? "").toLowerCase();
  const token = req.headers.get("x-amo-token") ?? "";

  if (!DOMAIN_RE.test(domain)) return json(400, { error: "bad amoCRM domain" });
  if (!PATH_RE.test(path) || path.includes("..")) return json(400, { error: "bad path" });
  if (!token) return json(401, { error: "no token" });

  const target = new URL(`https://${domain}${path}`);
  url.searchParams.forEach((v, k) => { if (k !== "path") target.searchParams.append(k, v); });

  const upstream = await fetch(target, {
    method: req.method,
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: req.method === "GET" ? undefined : await req.text(),
  });

  const body = upstream.status === 204 ? null : await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { ...cors, "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
  });
});
