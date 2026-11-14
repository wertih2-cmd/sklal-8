-- Этап 4: посещаемость и зарплата (персонал: staff).
-- Расчёт: премия за уборку = базовая премия типа квартиры x коэффициент уборки; делится поровну между
-- хаускиперами уборки, а без них идёт в пул дня и делится между отработавшими в этот день (shares_pool).
-- Округление: каждая составляющая человека округляется до 0,01 (round half up) за месяц; итог человека = сумма
-- округлённых составляющих; итог команды = сумма итогов людей.
-- Какие уборки дают премию: все, кроме status = 'reversed' и posting_status = 'rejected'.
-- Суточные границы: Africa/Cairo.
-- Ставки и премии заполняет и правит только админ. В начальных данных ставка 0 и нет премий за типы квартир:
-- пока админ их не задал, месяц не закрывается (контроль no_hourly_rate / no_rate).

-- 1. Настройки и справочники (правит админ; менеджер читает)
create table payroll_settings (
  id             int primary key default 1 check (id = 1),
  hourly_rate    numeric(10,2) not null check (hourly_rate >= 0),
  norm_hours     numeric(4,2)  not null check (norm_hours > 0 and norm_hours <= 24),
  overtime_coef  numeric(4,2)  not null check (overtime_coef >= 1),
  updated_at     timestamptz not null default now()
);
insert into payroll_settings(id, hourly_rate, norm_hours, overtime_coef) values (1, 0, 8, 1.5);

create table cleaning_bonus_rates (
  id          serial primary key,
  apt_type    apt_type not null unique,
  base_bonus  numeric(10,2) not null check (base_bonus >= 0)
);

-- коэффициент отдельной уборки (если нет строки, коэффициент 1)
create table cleaning_bonus_coef (
  id        serial primary key,
  event_id  uuid not null unique references cleaning_events(id) on delete cascade,
  coef      numeric(5,2) not null check (coef >= 0),
  note      text
);

-- личные премии и удержания за месяц (month = первое число месяца)
create table payroll_adjustments (
  id        bigserial primary key,
  month     date not null check (month = date_trunc('month', month)::date),
  staff_id  int not null references staff(id),
  amount    numeric(12,2) not null,
  note      text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index payroll_adjustments_month on payroll_adjustments(month, staff_id);

-- 2. Посещаемость: одна отметка на (дата, работник)
create table attendance (
  id              bigserial primary key,
  work_date       date not null,
  staff_id        int  not null references staff(id),
  kind            text not null check (kind in ('work', 'weekend', 'leave')),  -- работа / выходной (В) / отпуск (О)
  hours           numeric(4,2) not null default 0 check (hours >= 0 and hours <= 24),
  shares_pool     boolean not null default true,
  note            text,
  marked_by       uuid default auth.uid(),
  marked_by_name  text,
  marked_at       timestamptz not null default now(),
  unique (work_date, staff_id),
  check ((kind = 'leave' and hours = 0) or (kind <> 'leave' and hours > 0))
);
create index attendance_date on attendance(work_date);

-- 3. Закрытие месяца: снимок расчёта и журнал
create table payroll_months (
  id             serial primary key,
  month          date not null unique check (month = date_trunc('month', month)::date),
  status         text not null check (status in ('open', 'closed')),
  closed_by      uuid,
  closed_at      timestamptz,
  reopened_by    uuid,
  reopened_at    timestamptz,
  reopen_reason  text
);
create table payroll_lines (
  id              bigserial primary key,
  month           date not null,
  staff_id        int  not null references staff(id),
  full_name       text not null,
  work_days       int not null,
  hours           numeric(8,2) not null,
  overtime_hours  numeric(8,2) not null,
  base_pay        numeric(12,2) not null,
  overtime_pay    numeric(12,2) not null,
  pool_share      numeric(12,2) not null,
  cleaning_bonus  numeric(12,2) not null,
  personal_bonus  numeric(12,2) not null,
  total           numeric(12,2) not null,
  unique (month, staff_id)
);
create table payroll_month_log (
  id        bigserial primary key,
  month     date not null,
  action    text not null check (action in ('closed', 'reopened')),
  by_user   uuid default auth.uid(),
  at        timestamptz not null default now(),
  reason    text,
  snapshot  jsonb
);

-- 4. Права на таблицы (RLS)
alter table payroll_settings     enable row level security;
alter table cleaning_bonus_rates enable row level security;
alter table cleaning_bonus_coef  enable row level security;
alter table payroll_adjustments  enable row level security;
alter table attendance           enable row level security;
alter table payroll_months       enable row level security;
alter table payroll_lines        enable row level security;
alter table payroll_month_log    enable row level security;

revoke all on payroll_settings, cleaning_bonus_rates, cleaning_bonus_coef, payroll_adjustments,
              attendance, payroll_months, payroll_lines, payroll_month_log from anon;

-- ставки, премии, коэффициенты, личные премии: пишет админ, читает админ и менеджер; супервайзер не видит
do $$
declare t text;
begin
  foreach t in array array['payroll_settings', 'cleaning_bonus_rates', 'cleaning_bonus_coef', 'payroll_adjustments']
  loop
    execute format('create policy admin_all on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
    execute format('create policy manager_read on %I for select to authenticated using (is_manager())', t);
  end loop;
end $$;

-- посещаемость: читают все супервайзеры (is_supervisor() включает менеджера) и админ; пишут только через RPC
create policy att_admin_read on attendance for select to authenticated using (is_admin());
create policy att_sv_read    on attendance for select to authenticated using (is_supervisor());
revoke insert, update, delete on attendance from authenticated;

-- снимки и журнал: читают админ и менеджер; пишут только RPC
create policy pm_read  on payroll_months    for select to authenticated using (is_admin() or is_manager());
create policy pl_read  on payroll_lines     for select to authenticated using (is_admin() or is_manager());
create policy pml_read on payroll_month_log for select to authenticated using (is_admin() or is_manager());
revoke insert, update, delete on payroll_months, payroll_lines, payroll_month_log from authenticated;

-- аудит денежных и кадровых таблиц
do $$
declare t text;
begin
  foreach t in array array['payroll_settings', 'cleaning_bonus_rates', 'cleaning_bonus_coef',
                           'payroll_adjustments', 'attendance', 'payroll_months']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I
                    for each row execute function audit_row()', t);
  end loop;
end $$;

-- 5. Закрытый месяц не правится никем, в том числе админом напрямую
create or replace function _payroll_month_closed(p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from payroll_months
                  where month = date_trunc('month', p_day)::date and status = 'closed')
$$;

create or replace function trg_payroll_closed_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb; d date; rows jsonb[] := '{}';
begin
  if tg_op in ('UPDATE', 'DELETE') then rows := rows || to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then rows := rows || to_jsonb(new); end if;
  foreach j in array rows loop
    if tg_table_name = 'attendance' then
      d := (j->>'work_date')::date;
    elsif tg_table_name = 'payroll_adjustments' then
      d := (j->>'month')::date;
    elsif tg_table_name = 'cleaning_bonus_coef' then
      select (e.cleaned_at at time zone 'Africa/Cairo')::date into d
        from cleaning_events e where e.id = (j->>'event_id')::uuid;
    else
      d := null;
    end if;
    if d is not null and _payroll_month_closed(d) then
      raise exception 'Месяц закрыт, правка невозможна' using errcode = '42501';
    end if;
  end loop;
  return coalesce(new, old);
end $$;

create trigger payroll_guard_attendance before insert or update or delete on attendance
  for each row execute function trg_payroll_closed_guard();
create trigger payroll_guard_adjustments before insert or update or delete on payroll_adjustments
  for each row execute function trg_payroll_closed_guard();
create trigger payroll_guard_coef before insert or update or delete on cleaning_bonus_coef
  for each row execute function trg_payroll_closed_guard();

-- 6. Расчёт месяца (внутренний, без проверки роли: клиент вызывает payroll_report / payroll_close)
create or replace function _payroll_calc(p_month date)
returns table(staff_id int, full_name text, work_days int, hours numeric, overtime_hours numeric,
              base_pay numeric, overtime_pay numeric, pool_share numeric, cleaning_bonus numeric,
              personal_bonus numeric, total numeric)
language sql stable security definer set search_path = public as $$
with p as (
  select date_trunc('month', p_month)::date as m0,
         (date_trunc('month', p_month) + interval '1 month')::date as m1
), cfg as (
  select hourly_rate, norm_hours, overtime_coef from payroll_settings where id = 1
), ev as (
  select e.id,
         (e.cleaned_at at time zone 'Africa/Cairo')::date as d,
         coalesce(r.base_bonus, 0) * coalesce(c.coef, 1) as bonus
    from cleaning_events e
    join apartments a on a.id = e.apartment_id
    left join cleaning_bonus_rates r on r.apt_type = a.type
    left join cleaning_bonus_coef c on c.event_id = e.id
    cross join p
   where e.status <> 'reversed' and e.posting_status <> 'rejected'
     and (e.cleaned_at at time zone 'Africa/Cairo')::date >= p.m0
     and (e.cleaned_at at time zone 'Africa/Cairo')::date <  p.m1
), ev_staff as (
  select s.event_id, s.staff_id, count(*) over (partition by s.event_id) as n
    from cleaning_event_staff s
), personal as (
  select es.staff_id, sum(ev.bonus / es.n) as amt
    from ev join ev_staff es on es.event_id = ev.id
   group by es.staff_id
), pool_day as (
  select ev.d, sum(ev.bonus) as amt
    from ev
   where not exists (select 1 from cleaning_event_staff s where s.event_id = ev.id)
   group by ev.d
), att as (
  select a.* from attendance a cross join p where a.work_date >= p.m0 and a.work_date < p.m1
), elig as (
  select work_date, staff_id, count(*) over (partition by work_date) as n
    from att
   where kind in ('work', 'weekend') and hours > 0 and shares_pool
), pool as (
  select e.staff_id, sum(pd.amt / e.n) as amt
    from elig e join pool_day pd on pd.d = e.work_date
   group by e.staff_id
), hrs as (
  select a.staff_id,
         count(*) filter (where a.kind in ('work', 'weekend') and a.hours > 0) as days,
         coalesce(sum(a.hours) filter (where a.kind in ('work', 'weekend')), 0) as h,
         coalesce(sum(case a.kind when 'weekend' then a.hours
                                  when 'work' then greatest(a.hours - cfg.norm_hours, 0)
                                  else 0 end), 0) as ot
    from att a cross join cfg
   group by a.staff_id
), adj as (
  select pa.staff_id, sum(pa.amount) as amt
    from payroll_adjustments pa cross join p
   where pa.month = p.m0
   group by pa.staff_id
), ids as (
  select staff_id from hrs union select staff_id from personal
  union select staff_id from pool union select staff_id from adj
), x as (
  select ids.staff_id, st.full_name,
         coalesce(h.days, 0)::int as work_days,
         coalesce(h.h, 0) as hours,
         coalesce(h.ot, 0) as overtime_hours,
         round((coalesce(h.h, 0) - coalesce(h.ot, 0)) * cfg.hourly_rate, 2) as base_pay,
         round(coalesce(h.ot, 0) * cfg.overtime_coef * cfg.hourly_rate, 2) as overtime_pay,
         round(coalesce(pl.amt, 0), 2) as pool_share,
         round(coalesce(pe.amt, 0), 2) as cleaning_bonus,
         round(coalesce(ad.amt, 0), 2) as personal_bonus
    from ids
    join staff st on st.id = ids.staff_id
    cross join cfg
    left join hrs h      on h.staff_id  = ids.staff_id
    left join pool pl    on pl.staff_id = ids.staff_id
    left join personal pe on pe.staff_id = ids.staff_id
    left join adj ad     on ad.staff_id = ids.staff_id
)
select x.staff_id, x.full_name, x.work_days, x.hours, x.overtime_hours, x.base_pay, x.overtime_pay,
       x.pool_share, x.cleaning_bonus, x.personal_bonus,
       x.base_pay + x.overtime_pay + x.pool_share + x.cleaning_bonus + x.personal_bonus as total
  from x
 order by x.full_name, x.staff_id
$$;

-- контроль месяца: нераспределённый пул, уборщик без отметки в день уборки, тип квартиры без ставки
create or replace function _payroll_control(p_month date)
returns table(kind text, on_date date, staff_id int, amount numeric, detail text)
language sql stable security definer set search_path = public as $$
with p as (
  select date_trunc('month', p_month)::date as m0,
         (date_trunc('month', p_month) + interval '1 month')::date as m1
), ev as (
  select e.id, e.apartment_id, a.code, a.type,
         (e.cleaned_at at time zone 'Africa/Cairo')::date as d,
         coalesce(r.base_bonus, 0) * coalesce(c.coef, 1) as bonus,
         (r.id is null) as no_rate
    from cleaning_events e
    join apartments a on a.id = e.apartment_id
    left join cleaning_bonus_rates r on r.apt_type = a.type
    left join cleaning_bonus_coef c on c.event_id = e.id
    cross join p
   where e.status <> 'reversed' and e.posting_status <> 'rejected'
     and (e.cleaned_at at time zone 'Africa/Cairo')::date >= p.m0
     and (e.cleaned_at at time zone 'Africa/Cairo')::date <  p.m1
)
select 'unallocated_pool'::text, pd.d, null::int, pd.amt, null::text
  from (select ev.d, sum(ev.bonus) as amt from ev
         where not exists (select 1 from cleaning_event_staff s where s.event_id = ev.id)
         group by ev.d) pd
 where pd.amt > 0
   and not exists (select 1 from attendance a
                    where a.work_date = pd.d and a.kind in ('work', 'weekend') and a.hours > 0 and a.shares_pool)
union all
select 'cleaner_not_marked', ev.d, s.staff_id, null::numeric, ev.code
  from ev join cleaning_event_staff s on s.event_id = ev.id
 where not exists (select 1 from attendance a
                    where a.work_date = ev.d and a.staff_id = s.staff_id
                      and a.kind in ('work', 'weekend') and a.hours > 0)
union all
select 'no_rate', ev.d, null::int, null::numeric, ev.code
  from ev where ev.no_rate
union all
select 'no_hourly_rate', null::date, null::int, null::numeric, null::text
 where exists (select 1 from payroll_settings where id = 1 and hourly_rate = 0)
order by 1, 2
$$;

-- 7. Клиентские RPC
create or replace function payroll_report(p_month date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m0 date := date_trunc('month', p_month)::date; v_closed boolean; v_lines jsonb; v_control jsonb;
begin
  if not (is_admin() or is_manager()) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  v_closed := _payroll_month_closed(m0);
  if v_closed then
    select coalesce(jsonb_agg(to_jsonb(l) - 'id' - 'month' order by l.full_name, l.staff_id), '[]'::jsonb)
      into v_lines from payroll_lines l where l.month = m0;
    v_control := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(to_jsonb(c) order by c.full_name, c.staff_id), '[]'::jsonb)
      into v_lines from _payroll_calc(m0) c;
    select coalesce(jsonb_agg(to_jsonb(k)), '[]'::jsonb) into v_control from _payroll_control(m0) k;
  end if;
  return jsonb_build_object(
    'month', m0,
    'status', case when v_closed then 'closed' else 'open' end,
    'lines', v_lines,
    'control', v_control,
    'total', coalesce((select sum((x->>'total')::numeric) from jsonb_array_elements(v_lines) x), 0));
end $$;

-- супервайзеру: закрыт ли месяц (без сумм)
create or replace function payroll_month_is_closed(p_month date) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or is_supervisor()) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  return _payroll_month_closed(p_month);
end $$;

create or replace function payroll_close(p_month date, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m0 date := date_trunc('month', p_month)::date; v_today date; n int; v_total numeric;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  v_today := (now() at time zone 'Africa/Cairo')::date;
  if m0 > date_trunc('month', v_today)::date then
    raise exception 'Нельзя закрыть будущий месяц';
  end if;
  perform 1 from payroll_months where month = m0 for update;
  if _payroll_month_closed(m0) then raise exception 'Месяц уже закрыт'; end if;
  if exists (select 1 from payroll_settings where id = 1 and hourly_rate = 0) then
    raise exception 'Не задана почасовая ставка';
  end if;
  if not p_force and exists (select 1 from _payroll_control(m0) where kind in ('unallocated_pool', 'no_rate')) then
    raise exception 'Есть нераспределённая премия или тип квартиры без ставки: проверьте контроль месяца';
  end if;
  delete from payroll_lines where month = m0;
  insert into payroll_lines(month, staff_id, full_name, work_days, hours, overtime_hours, base_pay,
                            overtime_pay, pool_share, cleaning_bonus, personal_bonus, total)
  select m0, c.staff_id, c.full_name, c.work_days, c.hours, c.overtime_hours, c.base_pay,
         c.overtime_pay, c.pool_share, c.cleaning_bonus, c.personal_bonus, c.total
    from _payroll_calc(m0) c;
  get diagnostics n = row_count;
  select coalesce(sum(total), 0) into v_total from payroll_lines where month = m0;
  insert into payroll_months(month, status, closed_by, closed_at)
  values (m0, 'closed', auth.uid(), now())
  on conflict (month) do update
     set status = 'closed', closed_by = auth.uid(), closed_at = now();
  insert into payroll_month_log(month, action) values (m0, 'closed');
  return jsonb_build_object('status', 'closed', 'people', n, 'total', v_total);
end $$;

create or replace function payroll_reopen(p_month date, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m0 date := date_trunc('month', p_month)::date; v_snap jsonb;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Укажите причину'; end if;
  perform 1 from payroll_months where month = m0 for update;
  if not _payroll_month_closed(m0) then raise exception 'Месяц не закрыт'; end if;
  select coalesce(jsonb_agg(to_jsonb(l) - 'id' order by l.full_name, l.staff_id), '[]'::jsonb)
    into v_snap from payroll_lines l where l.month = m0;
  insert into payroll_month_log(month, action, reason, snapshot) values (m0, 'reopened', btrim(p_reason), v_snap);
  delete from payroll_lines where month = m0;
  update payroll_months
     set status = 'open', reopened_by = auth.uid(), reopened_at = now(), reopen_reason = btrim(p_reason)
   where month = m0;
  return jsonb_build_object('status', 'open');
end $$;

-- отметка посещаемости: супервайзер, менеджер или админ; чужую отметку правит только с подтверждением (p_force)
create or replace function attendance_mark(p_date date, p_staff int, p_kind text, p_hours numeric default 0,
                                           p_shares_pool boolean default true, p_note text default null,
                                           p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a attendance%rowtype; v_name text; v_today date;
begin
  if not (is_admin() or is_supervisor()) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  if p_kind not in ('work', 'weekend', 'leave') then raise exception 'Неверный вид отметки'; end if;
  if p_kind = 'leave' then
    p_hours := 0;
  elsif p_hours is null or p_hours <= 0 or p_hours > 24 then
    raise exception 'Часы должны быть больше 0 и не больше 24';
  end if;
  v_today := (now() at time zone 'Africa/Cairo')::date;
  if p_date is null or p_date > v_today then raise exception 'Нельзя отметить будущую дату'; end if;
  if not exists (select 1 from staff where id = p_staff and active) then
    raise exception 'Сотрудник не найден или неактивен';
  end if;
  if _payroll_month_closed(p_date) then
    raise exception 'Месяц закрыт, правка невозможна' using errcode = '42501';
  end if;
  select coalesce(full_name, login) into v_name from profiles where id = auth.uid();

  select * into a from attendance where work_date = p_date and staff_id = p_staff for update;
  if found and a.marked_by is distinct from auth.uid() and not p_force then
    return jsonb_build_object('status', 'conflict', 'marked_by_name', a.marked_by_name,
                              'marked_at', a.marked_at, 'kind', a.kind, 'hours', a.hours);
  end if;
  insert into attendance(work_date, staff_id, kind, hours, shares_pool, note, marked_by, marked_by_name, marked_at)
  values (p_date, p_staff, p_kind, p_hours, coalesce(p_shares_pool, true), p_note, auth.uid(), v_name, now())
  on conflict (work_date, staff_id) do update
     set kind = excluded.kind, hours = excluded.hours, shares_pool = excluded.shares_pool,
         note = excluded.note, marked_by = excluded.marked_by,
         marked_by_name = excluded.marked_by_name, marked_at = excluded.marked_at;
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function attendance_clear(p_date date, p_staff int, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a attendance%rowtype;
begin
  if not (is_admin() or is_supervisor()) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  if _payroll_month_closed(p_date) then
    raise exception 'Месяц закрыт, правка невозможна' using errcode = '42501';
  end if;
  select * into a from attendance where work_date = p_date and staff_id = p_staff for update;
  if not found then return jsonb_build_object('status', 'ok'); end if;
  if a.marked_by is distinct from auth.uid() and not p_force then
    return jsonb_build_object('status', 'conflict', 'marked_by_name', a.marked_by_name, 'marked_at', a.marked_at);
  end if;
  delete from attendance where id = a.id;
  return jsonb_build_object('status', 'ok');
end $$;

-- 8. Список сотрудников без телефона для супервайзера (таблица staff по-прежнему читается всеми активными: см. примечание)
create or replace view staff_directory with (security_invoker = false) as
  select id, full_name, role, active from staff where is_active_user();

-- 9. Права на функции: внутренние не выдаются, клиентские проверяют роль внутри
revoke all on function _payroll_month_closed(date), _payroll_calc(date), _payroll_control(date),
                       trg_payroll_closed_guard() from public, anon, authenticated;
revoke all on function payroll_report(date), payroll_month_is_closed(date), payroll_close(date, boolean),
                       payroll_reopen(date, text),
                       attendance_mark(date, int, text, numeric, boolean, text, boolean),
                       attendance_clear(date, int, boolean) from public, anon;
grant execute on function payroll_report(date), payroll_month_is_closed(date), payroll_close(date, boolean),
                          payroll_reopen(date, text),
                          attendance_mark(date, int, text, numeric, boolean, text, boolean),
                          attendance_clear(date, int, boolean) to authenticated;
revoke all on staff_directory from anon;
grant select on staff_directory to authenticated;