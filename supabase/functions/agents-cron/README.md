# Агенты круглосуточно: amoCRM + WhatsApp

Функция `agents-cron` работает в Supabase, даже когда CRM закрыта:

- по расписанию агент **Карим** проверяет amoCRM: сделки без задач, просроченные задачи по менеджерам, сделки без движения больше 7 дней. Может сам поставить задачи (`AUTO_TASKS=1`);
- отправляет отчёт в WhatsApp через **официальный WhatsApp Cloud API** (Meta);
- принимает сводку из CRM: кнопка «Отправить сводку в WhatsApp» и утренняя сводка в разделе «Город агентов».

Данные студии (ученики, финансы) пока хранятся в браузере, поэтому круглосуточно проверяется только amoCRM. Остальные агенты работают, пока открыта CRM.

## 1. WhatsApp Cloud API (Meta)

1. На developers.facebook.com создайте приложение типа **Business** и добавьте продукт **WhatsApp**.
2. В WhatsApp Manager добавьте номер-отправитель. Это должен быть отдельный номер, который не используется в обычном приложении WhatsApp. Скопируйте **Phone number ID**.
3. В business.facebook.com → Настройки компании → Пользователи → **Системные пользователи** создайте пользователя с ролью администратора. Дайте ему доступ к приложению и аккаунту WhatsApp и сгенерируйте **бессрочный токен** с правами `whatsapp_business_messaging` и `whatsapp_business_management`.
4. В WhatsApp Manager → Шаблоны сообщений создайте шаблон:
   - категория **Utility** (служебные), имя `agents_report`, язык **Russian**;
   - текст: `Отчёт агентов DJIGIT TAU: {{1}}`;
   - пример для `{{1}}`: `Сделки без задачи: 3 · Просрочено задач: 2`.

   Дождитесь одобрения: обычно от нескольких минут до суток.
5. Каждый получатель должен хотя бы раз написать на номер-отправитель или дать согласие на сообщения.

Сообщения по шаблону Meta тарифицирует поштучно. Цены для Казахстана указаны в WhatsApp Manager.
Если отправлять без шаблона (`WA_TEMPLATE=-`), сообщение дойдёт, только если получатель писал на этот номер в последние 24 часа.

## 2. Секреты функции

Supabase → Edge Functions → Secrets (или `supabase secrets set ...`):

| Секрет | Значение |
|---|---|
| `AGENTS_KEY` | необязательно: по умолчанию ключ берётся из Vault (`agents_key`) |
| `WA_TOKEN` | бессрочный токен системного пользователя |
| `WA_PHONE_ID` | Phone number ID |
| `WA_TO` | номера получателей через запятую: `77010000000, 77020000000` |
| `WA_TEMPLATE` | `agents_report` (по умолчанию) |
| `WA_LANG` | `ru` (по умолчанию) |
| `AMO_DOMAIN` | `studio.amocrm.ru` |
| `AMO_TOKEN` | долгосрочный токен amoCRM |
| `AUTO_TASKS` | `1`, если Карим должен сам ставить задачи в amoCRM |
| `SEND_IF_OK` | `1`, если присылать отчёт, даже когда проблем нет |
| `ALLOW_ORIGIN` | адрес, где открыта CRM, например `https://djigittau.github.io` |

## 3. Развёртывание

```bash
supabase functions deploy agents-cron --no-verify-jwt
supabase functions deploy amocrm-proxy --no-verify-jwt
```

Функции не требуют входа в Supabase: `agents-cron` защищена ключом `AGENTS_KEY`, а `amocrm-proxy` пересылает запросы только в API amoCRM с токеном, который передал браузер.

## 4. Расписание и ключ (уже сделано в проекте djigit-tau-crm)

- Расширения `pg_cron` и `pg_net` включены.
- В Vault создан случайный ключ `agents_key`. Функция читает его через `public.agents_key()`, которая доступна только `service_role`.
- Задание `agents-amo-report` вызывает функцию в 9:00, 13:00 и 18:00 по Алматы (`0 4,8,13 * * *` UTC).

Для другого проекта повторите так:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'agents_key');
create or replace function public.agents_key() returns text language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'agents_key' $$;
revoke all on function public.agents_key() from public, anon, authenticated;
grant execute on function public.agents_key() to service_role;
select cron.schedule('agents-amo-report', '0 4,8,13 * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/agents-cron',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-agents-key', (select decrypted_secret from vault.decrypted_secrets where name = 'agents_key')),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
$$);
```

Ответы функции видны в `select * from net._http_response order by id desc limit 5;`.

## 5. В CRM

«Город агентов» → «Автоматика и WhatsApp»: адрес функции уже подставлен; вставьте ключ из Supabase → Project Settings → Vault → `agents_key`. Нажмите «Проверить связь».
