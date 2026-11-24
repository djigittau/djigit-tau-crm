-- ТЗ v2: пятая роль «Управляющий». Значение enum добавляется отдельной миграцией (нельзя использовать в той же транзакции).
alter type public.app_role add value if not exists 'manager' after 'owner';