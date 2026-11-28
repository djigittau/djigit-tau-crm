-- DJIGIT TAU CRM · 0022 · Зарплата в расходах сразу, без кнопки «Рассчитать».
-- По филиалу и месяцу: если начисления уже есть — их сумма; иначе — расчёт как в «Зарплатах» (оклад + % тренера от абонементов + премии − штрафы).
-- Видны только филиалы офиса вызывающего (salary_preview сам проверяет private.office).
create function public.salary_expense(p_from date, p_to date)
returns table (period date, branch_id uuid, amount numeric, estimated boolean)
language sql stable security definer set search_path = '' as $$
  select m::date, b.id,
    coalesce(
      (select sum(a.total) from public.salary_accruals a where a.branch_id = b.id and a.period = m::date),
      (select coalesce(sum(p.total), 0) from public.salary_preview(m::date, b.id) p)),
    not exists (select 1 from public.salary_accruals a where a.branch_id = b.id and a.period = m::date)
  from public.branches b
  cross join generate_series(date_trunc('month', p_from), p_to - 1, interval '1 month') m
  where private.office(b.id) and p_to > p_from
$$;

revoke all on function public.salary_expense(date, date) from public, anon;
grant execute on function public.salary_expense(date, date) to authenticated;
