# DJIGIT TAU CRM

CRM студии кавказского танца DJIGIT TAU: филиалы, сотрудники, ученики, пробники, посещаемость, смены, финансы, зарплаты, аналитика, журнал действий, amoCRM.

- Сайт: https://djigittau.github.io/djigit-tau-crm/
- Инструкция для студии (как работать в CRM): [docs/GUIDE.md](docs/GUIDE.md)
- ТЗ: [docs/MASTER_PROMPT.md](docs/MASTER_PROMPT.md)
- Архитектура, правила и выполненные этапы: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Устройство

| Папка | Что внутри |
|---|---|
| `app/` | Приложение: React + TypeScript + Vite |
| `supabase/migrations/` | Схема базы, права (RLS), триггеры, журнал — по порядку `0001…0022` |
| `supabase/functions/admin-users` | Аккаунты сотрудников (создать, заблокировать, сбросить пароль) — только директор |
| `supabase/functions/amocrm` | Интеграция amoCRM → CRM: OAuth, синхронизация, webhook — только директор и cron |
| `supabase/first_director.sql` | Шаблон: создать первого директора в новом проекте |
| `tests/` | Проверка прав через API (`rls.cjs`) и тестовые данные (`qa_setup.sql` / `qa_cleanup.sql`; тестовые фото удалять через Storage API) |
| корень (`index.html`, `assets/`) | Собранное приложение для GitHub Pages. Не править руками — собирается `npm run publish` |

## Запуск на компьютере

```bash
cd app
cp .env.example .env.local   # URL и publishable-ключ проекта Supabase
npm install
npm run dev                  # http://localhost:5173
```

## Публикация

```bash
cd app
npm run publish              # проверка типов, сборка и копирование в корень репозитория
```

Затем закоммитьте и отправьте в `main` — GitHub Pages обновит сайт за 1–10 минут.

## Supabase (новый проект с нуля)

1. Примените миграции из `supabase/migrations/` по порядку (SQL Editor или `supabase db push`). В `0007_amocrm.sql` замените адрес проекта в задаче cron на свой.
2. Разверните функции: `supabase functions deploy admin-users` и `supabase functions deploy amocrm --no-verify-jwt` (amoCRM возвращается в функцию без входа; права функция проверяет сама).
3. Authentication → Sign In / Providers: выключите **Allow new users to sign up** (аккаунты создаёт только директор) и включите **Leaked password protection**.
4. Создайте первого директора: `supabase/first_director.sql` (впишите email, имя и временный пароль). Дальше всё — из интерфейса.

Секреты хранятся только в Supabase → Edge Functions → Secrets: service role key (задан Supabase), `AMO_CLIENT_ID`, `AMO_CLIENT_SECRET` (или `AMO_DOMAIN` + `AMO_TOKEN`). В репозиторий и во frontend они не попадают. В `app/.env.*` — только публичные URL и publishable-ключ.

## Подключение amoCRM

1. В amoCRM: Настройки → Интеграции → Создать интеграцию. Адрес перенаправления: `https://<project-ref>.supabase.co/functions/v1/amocrm`. Доступ: сделки, контакты, задачи.
2. Секретный ключ и ID интеграции из «Ключи и доступы» — в Supabase → Edge Functions → Secrets как `AMO_CLIENT_SECRET` и `AMO_CLIENT_ID`.
3. В CRM (директор) → «Интеграция amoCRM»: адрес amoCRM и ID интеграции → «Сохранить» → «Подключить amoCRM» → разрешить доступ.
4. «Синхронизировать» (первый раз — сделки за год). Затем указать соответствия: воронка → филиал, этап → статус пробника.
5. Скопировать адрес webhook и добавить его в amoCRM → Настройки → Интеграции → Web hooks (сделка добавлена, изменена, смена статуса). Раз в час синхронизация запускается сама.

Направление только amoCRM → CRM. Токены хранятся в закрытой схеме базы и в интерфейсе не показываются.

## Проверка прав

```bash
# 1. Supabase → SQL Editor: выполнить tests/qa_setup.sql (тестовые филиалы QA и аккаунты qa.*@test.djigittau.kz)
node tests/rls.cjs            # 45 проверок под каждой ролью через публичный API (нужен npm install в app/)
# 2. SQL Editor: выполнить tests/qa_cleanup.sql — удаляет всё тестовое
```

## Вход

- По email или по телефону (сотруднику без email логином служит телефон).
- Временный пароль выдаёт директор; при первом входе система требует сменить его.
- Заблокированный или деактивированный сотрудник войти не может.
