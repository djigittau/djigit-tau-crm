# Агенты: уведомления в Telegram и WhatsApp, где остановились

_Обновлено: 19.11.2026_

## Готово
- В CRM работает раздел «Город агентов»: 7 агентов, включая Карима (amoCRM). Есть автообход каждые 30 минут и колокольчик.
- В Supabase (проект `djigit-tau-crm`) развёрнуты функции `amocrm-proxy` и `agents-cron` (версия 2: Telegram + WhatsApp).
- В Vault хранятся ключ `agents_key` и (после подключения) токен бота `tg_token`. Получатели Telegram лежат в таблице `agents_tg_chats` (доступ только у сервера).
- Расписание `agents-amo-report`: 9:00, 13:00 и 18:00 по Алматы. Пока amoCRM не настроен, задание ничего не отправляет.

## Telegram: что сделать (около 5 минут, всё в CRM)
1. «Город агентов» → «Автоматика и уведомления» → «Сервер агентов»: вставить ключ из Supabase → Project Settings → Vault → `agents_key` и нажать «Сохранить».
2. В Telegram: @BotFather → `/newbot` → получить токен → вставить в CRM → «Подключить бота».
3. Открыть своего бота, нажать «Старт» → в CRM «Найти чаты» → «Добавить».
4. Нажать «Проверить связь».

## amoCRM на сервере (позже)
В Supabase → Edge Functions → Secrets добавить `AMO_DOMAIN`, `AMO_TOKEN` и по желанию `AUTO_TASKS=1`.

## WhatsApp (отложено)
Остановились на шаге «создать приложение на developers.facebook.com» (не dev.meta.ai). Шаги: `supabase/functions/agents-cron/README.md`.
