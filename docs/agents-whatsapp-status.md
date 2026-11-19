# Агенты: уведомления в Telegram и WhatsApp, где остановились

_Обновлено: 19.11.2026_

## Готово
- В CRM работает раздел «Город агентов»: 7 агентов, включая Карима (amoCRM). Есть автообход каждые 30 минут и колокольчик.
- В Supabase (проект `djigit-tau-crm`) развёрнуты функции `amocrm-proxy` и `agents-cron` (версия 2: Telegram + WhatsApp).
- В Vault хранятся ключ `agents_key` и (после подключения) токен бота `tg_token`. Получатели Telegram лежат в таблице `agents_tg_chats` (доступ только у сервера).
- Расписание `agents-amo-report`: 9:00, 13:00 и 18:00 по Алматы. Пока amoCRM не настроен, задание ничего не отправляет.

## Telegram: подключён ✅
- Бот **@DjigitTauBot**, токен в Vault. Получатель: Jkh. Приветствие, тест и пример сводки доставлены.
- Чтобы CRM сама отправляла сводки, один раз введите ключ: «Город агентов» → «Автоматика и уведомления» → «Сервер агентов» → ключ из Supabase → Project Settings → Vault → `agents_key`.
- Новый получатель: он нажимает «Старт» в боте (https://t.me/DjigitTauBot?start=agents), затем в CRM «Найти чаты» → «Добавить».
- Рекомендация: токен побывал в чате. Можно выпустить новый (@BotFather → /mybots → бот → API Token → Revoke) и вставить в CRM («Сменить бота»). Получатели сохранятся.

## amoCRM на сервере (позже)
В Supabase → Edge Functions → Secrets добавить `AMO_DOMAIN`, `AMO_TOKEN` и по желанию `AUTO_TASKS=1`.

## WhatsApp (отложено)
Остановились на шаге «создать приложение на developers.facebook.com» (не dev.meta.ai). Шаги: `supabase/functions/agents-cron/README.md`.
