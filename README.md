# DJIGIT TAU CRM

CRM студии кавказского танца DJIGIT TAU: филиалы, сотрудники, ученики, пробники, посещаемость, смены, финансы, зарплаты, аналитика, amoCRM.

- Сайт: https://djigittau.github.io/djigit-tau-crm/
- ТЗ: [docs/MASTER_PROMPT.md](docs/MASTER_PROMPT.md)
- Архитектура и план этапов: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Устройство

| Папка | Что внутри |
|---|---|
| `app/` | Приложение: React + TypeScript + Vite |
| `supabase/migrations/` | Схема базы, права (RLS), триггеры — по порядку `0001…` |
| `supabase/functions/` | Серверные функции (Edge Functions): `admin-users` — аккаунты сотрудников |
| корень (`index.html`, `assets/`) | Собранное приложение для GitHub Pages. Не править руками — собирается командой `npm run publish` |

## Запуск на компьютере

```bash
cd app
cp .env.example .env.local   # подставьте URL и publishable-ключ своего проекта Supabase
npm install
npm run dev                  # http://localhost:5173
```

## Публикация

```bash
cd app
npm run publish              # сборка и копирование в корень репозитория
```

Затем закоммитьте и отправьте в `main` — GitHub Pages обновит сайт за 1–10 минут.

## Supabase

1. Примените миграции из `supabase/migrations/` по порядку (SQL Editor или `supabase db push`).
2. Разверните функцию: `supabase functions deploy admin-users`.
3. Authentication → Sign In / Providers → выключите **Allow new users to sign up**. Аккаунты создаёт только директор в разделе «Сотрудники».
4. Первого директора создают один раз (см. `docs/ARCHITECTURE.md`). Дальше всё — из интерфейса.

Секреты (service role key, ключи amoCRM) хранятся только в Supabase → Edge Functions → Secrets. В репозиторий и во frontend они не попадают. В `app/.env.*` — только публичные URL и publishable-ключ.

## Вход

- По email или по телефону (сотруднику без email логином служит телефон).
- Временный пароль выдаёт директор; при первом входе система требует сменить его.
- Заблокированный или деактивированный сотрудник войти не может.
