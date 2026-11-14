-- Проверка этапа «посещаемость и зарплата» (payroll-attendance.sql).
-- Скрипт сам откатывает все данные: в конце намеренно падает с ошибкой "ОТЧЁТ", в тексте — результаты.
-- Тестовый месяц 2001-03 (в рабочей базе данных за него нет), апрель 2001 для проверок отметок.
-- Ожидаемые числа посчитаны вручную по правилу округления «итог человека = сумма округлённых составляющих».
-- Это синтетический набор на трёх людях, НЕ данные из Excel.
create or replace function pg_temp.r(n text, c boolean) returns text language sql as
$$ select case when coalesce(c, false) then 'OK    ' else 'FAIL  ' end || n || E'\\n' $$;
create or replace function pg_temp.as_user(u uuid) returns void language sql as
$$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true),
          set_config('request.jwt.claim.sub', u::text, true) $$;
create or replace function pg_temp.line(j jsonb, nm text) returns jsonb language sql as
$$ select x from jsonb_array_elements(j->'lines') x where x->>'full_name' = nm $$;

do $$
declare
  v_admin uuid := gen_random_uuid(); v_sv1 uuid := gen_random_uuid(); v_sv2 uuid := gen_random_uuid();
  v_mgr uuid := gen_random_uuid();
  rep text := ''; t text; j jsonb; k jsonb; n int; h numeric;
  v_bld int; v_st int; v_o1 int; v_t2 int;
  sA int; sB int; sC int;
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; e6 uuid; e7 uuid;
begin
  insert into auth.users(id, email) values
    (v_admin, 'zz-pay-admin@example.invalid'), (v_sv1, 'zz-pay-sv1@example.invalid'),
    (v_sv2, 'zz-pay-sv2@example.invalid'), (v_mgr, 'zz-pay-mgr@example.invalid');
  insert into profiles(id, login, full_name, role) values
    (v_admin, 'zz-pay-admin', 'ZZ Pay Admin', 'admin'), (v_sv1, 'zz-pay-sv1', 'ZZ Pay Sv One', 'supervisor'),
    (v_sv2, 'zz-pay-sv2', 'ZZ Pay Sv Two', 'supervisor'), (v_mgr, 'zz-pay-mgr', 'ZZ Pay Mgr', 'manager');
  perform pg_temp.as_user(v_admin);

  insert into buildings(name) values ('ZZPAY') returning id into v_bld;
  insert into apartments(building_id, number, code, type) values (v_bld, '1', 'ZZPAY/1', 'studio') returning id into v_st;
  insert into apartments(building_id, number, code, type) values (v_bld, '2', 'ZZPAY/2', '1br') returning id into v_o1;
  insert into apartments(building_id, number, code, type) values (v_bld, '3', 'ZZPAY/3', '2br') returning id into v_t2;
  insert into staff(full_name) values ('ZZ PAY A') returning id into sA;
  insert into staff(full_name) values ('ZZ PAY B') returning id into sB;
  insert into staff(full_name) values ('ZZ PAY C') returning id into sC;

  -- ставки теста: 40 EGP/ч, норма 8 ч, переработка x1,5; премии 30/40/50
  update payroll_settings set hourly_rate = 40, norm_hours = 8, overtime_coef = 1.5 where id = 1;
  insert into cleaning_bonus_rates(apt_type, base_bonus) values ('studio', 30), ('1br', 40), ('2br', 50)
    on conflict (apt_type) do update set base_bonus = excluded.base_bonus;

  -- 05.03: студия 30 на A и B (по 15); 2br 50 без хаускиперов (пул дня)
  insert into cleaning_events(client_op_id, apartment_id, cleaned_at) values
    (gen_random_uuid(), v_st, '2001-03-05 12:00:00'::timestamp at time zone 'Africa/Cairo') returning id into e1;
  insert into cleaning_event_staff(event_id, staff_id) values (e1, sA), (e1, sB);
  insert into cleaning_events(client_op_id, apartment_id, cleaned_at) values
    (gen_random_uuid(), v_t2, '2001-03-05 13:00:00'::timestamp at time zone 'Africa/Cairo') returning id into e2;
  -- 06.03: 1br 40 x коэффициент 1,5 = 60 на C
  insert into cleaning_events(client_op_id, apartment_id, cleaned_at) values
    (gen_random_uuid(), v_o1, '2001-03-06 12:00:00'::timestamp at time zone 'Africa/Cairo') returning id into e3;
  insert into cleaning_event_staff(event_id, staff_id) values (e3, sC);
  insert into cleaning_bonus_coef(event_id, coef) values (e3, 1.5);
  -- 07.03: студия 30 без хаускиперов, в этот день никто не отмечен: нераспределённая премия
  insert into cleaning_events(client_op_id, apartment_id, cleaned_at) values
    (gen_random_uuid(), v_st, '2001-03-07 12:00:00'::timestamp at time zone 'Africa/Cairo') returning id into e4;
  -- 08.03: отклонённая и отменённая уборки с A: премии нет
  insert into cleaning_events(client_op_id, apartment_id, cleaned_at, status, posting_status) values
    (gen_random_uuid(), v_st, '2001-03-08 12:00:00'::timestamp at time zone 'Africa/Cairo', 'reversed', 'rejected') returning id into e5;
  insert into cleaning_event_staff(event_id, staff_id) values (e5, sA);
  insert into cleaning_events(client_op_id, apartment_id, cleaned_at, status) values
    (gen_random_uuid(), v_st, '2001-03-08 13:00:00'::timestamp at time zone 'Africa/Cairo', 'reversed') returning id into e6;
  insert into cleaning_event_staff(event_id, staff_id) values (e6, sA);
  -- 09.03: студия 30 без хаускиперов; делят только те, у кого shares_pool (A)
  insert into cleaning_events(client_op_id, apartment_id, cleaned_at) values
    (gen_random_uuid(), v_st, '2001-03-09 12:00:00'::timestamp at time zone 'Africa/Cairo') returning id into e7;

  insert into attendance(work_date, staff_id, kind, hours, shares_pool) values
    ('2001-03-05', sA, 'work', 8, true), ('2001-03-05', sB, 'work', 10, true), ('2001-03-05', sC, 'work', 6, true),
    ('2001-03-06', sC, 'weekend', 9, true), ('2001-03-06', sA, 'leave', 0, true),
    ('2001-03-09', sA, 'work', 8, true), ('2001-03-09', sB, 'work', 8, false);
  insert into payroll_adjustments(month, staff_id, amount, note) values ('2001-03-01', sB, 100, 'ZZ');

  execute 'set local role authenticated';

  -- A1: расчёт админом
  t := null;
  begin j := payroll_report('2001-03-15'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('A1 payroll_report без ошибки', t is null);
  rep := rep || pg_temp.r('A1 месяц открыт, дата в середине месяца приводится к началу', j->>'status' = 'open' and j->>'month' = '2001-03-01');
  rep := rep || pg_temp.r('A1 три человека', jsonb_array_length(j->'lines') = 3);

  -- A2: A = 640 + 0 + 46,67 (пул 16,67 + 30) + 15 = 701,67
  k := pg_temp.line(j, 'ZZ PAY A');
  rep := rep || pg_temp.r('A2 A часы 16, переработка 0, дни 2', (k->>'hours')::numeric = 16 and (k->>'overtime_hours')::numeric = 0 and (k->>'work_days')::int = 2);
  rep := rep || pg_temp.r('A2 A база 640', (k->>'base_pay')::numeric = 640);
  rep := rep || pg_temp.r('A2 A пул 46,67 (shares_pool=false у B исключает B из 09.03)', (k->>'pool_share')::numeric = 46.67);
  rep := rep || pg_temp.r('A2 A личная премия за уборки 15 (отклонённая и отменённая не считаются)', (k->>'cleaning_bonus')::numeric = 15);
  rep := rep || pg_temp.r('A2 A итог 701,67', (k->>'total')::numeric = 701.67);

  -- A3: B = 640 + 120 + 16,67 + 15 + 100 = 891,67
  k := pg_temp.line(j, 'ZZ PAY B');
  rep := rep || pg_temp.r('A3 B переработка 2 ч, оплата 120', (k->>'overtime_hours')::numeric = 2 and (k->>'overtime_pay')::numeric = 120);
  rep := rep || pg_temp.r('A3 B пул 16,67', (k->>'pool_share')::numeric = 16.67);
  rep := rep || pg_temp.r('A3 B личная премия (корректировка) 100', (k->>'personal_bonus')::numeric = 100);
  rep := rep || pg_temp.r('A3 B итог 891,67', (k->>'total')::numeric = 891.67);

  -- A4: C = 240 + 540 + 16,67 + 60 = 856,67 (выходной: все 9 ч переработка; коэффициент уборки 1,5)
  k := pg_temp.line(j, 'ZZ PAY C');
  rep := rep || pg_temp.r('A4 C выходной: переработка 9 ч, оплата 540, база 240', (k->>'overtime_hours')::numeric = 9 and (k->>'overtime_pay')::numeric = 540 and (k->>'base_pay')::numeric = 240);
  rep := rep || pg_temp.r('A4 C премия за уборку с коэффициентом 60', (k->>'cleaning_bonus')::numeric = 60);
  rep := rep || pg_temp.r('A4 C итог 856,67', (k->>'total')::numeric = 856.67);
  rep := rep || pg_temp.r('A4 итог команды 2450,01 = сумма итогов людей', (j->>'total')::numeric = 2450.01);

  -- A5: контроль
  rep := rep || pg_temp.r('A5 нераспределённая премия 07.03 на 30',
    exists (select 1 from jsonb_array_elements(j->'control') c
             where c->>'kind' = 'unallocated_pool' and c->>'on_date' = '2001-03-07' and (c->>'amount')::numeric = 30));
  rep := rep || pg_temp.r('A5 других замечаний нет', jsonb_array_length(j->'control') = 1);

  -- B: права
  perform pg_temp.as_user(v_mgr);
  t := null;
  begin j := payroll_report('2001-03-01'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('B1 менеджер читает расчёт', t is null and jsonb_array_length(j->'lines') = 3);
  select count(*) into n from payroll_settings;
  rep := rep || pg_temp.r('B2 менеджер читает настройки', n = 1);
  t := null;
  begin perform payroll_close('2001-03-01', true); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('B3 менеджер не закрывает месяц', t is not null);
  t := null;
  begin update payroll_settings set hourly_rate = 1 where id = 1; get diagnostics n = row_count; exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('B4 менеджер не меняет ставки', t is not null or n = 0);

  perform pg_temp.as_user(v_sv1);
  t := null;
  begin perform payroll_report('2001-03-01'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('B5 супервайзер не получает расчёт', t is not null);
  select count(*) into n from payroll_settings;
  rep := rep || pg_temp.r('B6 супервайзер не видит ставки', n = 0);
  select count(*) into n from cleaning_bonus_rates;
  rep := rep || pg_temp.r('B7 супервайзер не видит премии за квартиры', n = 0);
  select count(*) into n from payroll_lines;
  rep := rep || pg_temp.r('B8 супервайзер не видит снимки', n = 0);
  select count(*) into n from attendance where work_date between '2001-03-01' and '2001-03-31';
  rep := rep || pg_temp.r('B9 супервайзер видит все отметки', n = 7);
  t := null;
  begin insert into attendance(work_date, staff_id, kind, hours) values ('2001-04-01', sA, 'work', 8); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('B10 прямая вставка в attendance запрещена', t is not null);
  rep := rep || pg_temp.r('B11 staff_directory без телефона', not exists (
    select 1 from information_schema.columns where table_name = 'staff_directory' and column_name = 'phone'));

  -- C: отметки (апрель 2001)
  t := null;
  begin j := attendance_mark('2001-04-10', sA, 'work', 8); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C1 супервайзер отмечает', t is null and j->>'status' = 'ok');
  perform pg_temp.as_user(v_sv2);
  t := null;
  begin j := attendance_mark('2001-04-10', sA, 'work', 6); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C2 чужая отметка: конфликт с именем', t is null and j->>'status' = 'conflict' and j->>'marked_by_name' = 'ZZ Pay Sv One');
  select hours into n from attendance where work_date = '2001-04-10' and staff_id = sA;
  rep := rep || pg_temp.r('C2 при конфликте отметка не изменилась', n = 8);
  t := null;
  begin j := attendance_mark('2001-04-10', sA, 'work', 6, true, null, true); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C3 с подтверждением правит', t is null and j->>'status' = 'ok');
  rep := rep || pg_temp.r('C3 имя второго в строке', exists (
    select 1 from attendance where work_date = '2001-04-10' and staff_id = sA and hours = 6 and marked_by_name = 'ZZ Pay Sv Two'));
  t := null;
  begin perform attendance_mark('2001-04-11', sA, 'work', 0); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C4 работа с нулём часов отклонена', t is not null);
  t := null;
  begin perform attendance_mark('2001-04-11', sA, 'work', 25); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C4 больше 24 ч отклонено', t is not null);
  t := null;
  begin perform attendance_mark('2001-04-11', sA, 'leave', 5); exception when others then t := sqlerrm; end;
  select hours into h from attendance where work_date = '2001-04-11' and staff_id = sA;
  rep := rep || pg_temp.r('C5 отпуск сохраняется с 0 часов', t is null and h = 0);
  t := null;
  begin perform attendance_mark('2999-01-01', sA, 'work', 8); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C6 будущая дата отклонена', t is not null);
  perform pg_temp.as_user(v_sv1);
  t := null;
  begin j := attendance_clear('2001-04-10', sA); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C7 очистка чужой отметки: конфликт', t is null and j->>'status' = 'conflict');
  t := null;
  begin j := attendance_clear('2001-04-10', sA, true); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C7 очистка с подтверждением', t is null and j->>'status' = 'ok'
    and not exists (select 1 from attendance where work_date = '2001-04-10' and staff_id = sA));
  perform pg_temp.as_user(v_mgr);
  t := null;
  begin j := attendance_mark('2001-04-12', sB, 'work', 8); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C8 менеджер отмечает', t is null and j->>'status' = 'ok');

  -- D: закрытие месяца
  perform pg_temp.as_user(v_admin);
  update payroll_settings set hourly_rate = 0 where id = 1;
  j := payroll_report('2001-03-01');
  rep := rep || pg_temp.r('D0 ставка 0 попадает в контроль', exists (select 1 from jsonb_array_elements(j->'control') c where c->>'kind' = 'no_hourly_rate'));
  t := null;
  begin perform payroll_close('2001-03-01', true); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('D0 при ставке 0 закрытие блокируется даже с p_force', t is not null);
  update payroll_settings set hourly_rate = 40 where id = 1;
  t := null;
  begin perform payroll_close('2001-03-01'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('D1 нераспределённая премия блокирует закрытие без p_force', t is not null);
  t := null;
  begin perform payroll_close('2999-01-01', true); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('D2 будущий месяц не закрывается', t is not null);
  t := null;
  begin j := payroll_close('2001-03-01', true); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('D3 админ закрывает с p_force', t is null and j->>'status' = 'closed'
    and (j->>'people')::int = 3 and (j->>'total')::numeric = 2450.01);
  t := null;
  begin perform payroll_close('2001-03-01', true); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('D4 повторное закрытие отклонено', t is not null);
  perform pg_temp.as_user(v_mgr);
  j := payroll_report('2001-03-01');
  rep := rep || pg_temp.r('D5 закрытый месяц читается из снимка', j->>'status' = 'closed'
    and jsonb_array_length(j->'lines') = 3 and (j->>'total')::numeric = 2450.01);
  perform pg_temp.as_user(v_sv1);
  t := null;
  begin perform attendance_mark('2001-03-10', sA, 'work', 8); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('D6 закрытый месяц: отметка отклонена', t is not null);
  t := null;
  begin perform attendance_clear('2001-03-05', sA, true); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('D7 закрытый месяц: очистка отклонена', t is not null);
  rep := rep || pg_temp.r('D8 супервайзер узнаёт, что месяц закрыт', payroll_month_is_closed('2001-03-01'));

  execute 'reset role';
  t := null;
  begin update attendance set hours = 9 where work_date = '2001-03-05' and staff_id = sA; exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('D9 триггер защищает закрытый месяц даже от прямой правки', t is not null);
  t := null;
  begin insert into payroll_adjustments(month, staff_id, amount) values ('2001-03-01', sA, 5); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('D10 личные премии закрытого месяца не правятся', t is not null);
  t := null;
  begin delete from cleaning_bonus_coef where event_id = e3; exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('D11 коэффициент уборки закрытого месяца не правится', t is not null);
  execute 'set local role authenticated';

  -- E: повторное открытие
  perform pg_temp.as_user(v_admin);
  t := null;
  begin perform payroll_reopen('2001-03-01', '  '); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('E1 без причины не открывается', t is not null);
  perform pg_temp.as_user(v_mgr);
  t := null;
  begin perform payroll_reopen('2001-03-01', 'нужно'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('E2 менеджер не открывает', t is not null);
  perform pg_temp.as_user(v_admin);
  t := null;
  begin j := payroll_reopen('2001-03-01', 'ZZ проверка'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('E3 админ открывает с причиной', t is null and j->>'status' = 'open');
  j := payroll_report('2001-03-01');
  rep := rep || pg_temp.r('E4 после открытия расчёт снова живой', j->>'status' = 'open' and (j->>'total')::numeric = 2450.01);
  select count(*) into n from payroll_month_log where month = '2001-03-01';
  rep := rep || pg_temp.r('E5 в журнале две записи (закрыто, открыто)', n = 2);
  rep := rep || pg_temp.r('E5 снимок сохранён в журнале', exists (
    select 1 from payroll_month_log where month = '2001-03-01' and action = 'reopened'
       and jsonb_array_length(snapshot) = 3 and reason = 'ZZ проверка'));
  select count(*) into n from payroll_lines where month = '2001-03-01';
  rep := rep || pg_temp.r('E6 снимок строк удалён при открытии', n = 0);
  perform pg_temp.as_user(v_sv1);
  rep := rep || pg_temp.r('E7 месяц снова правится', not payroll_month_is_closed('2001-03-01'));

  -- F: привилегии функций
  rep := rep || pg_temp.r('F1 _payroll_calc не выполняется authenticated',
    not has_function_privilege('authenticated', 'public._payroll_calc(date)', 'EXECUTE'));
  rep := rep || pg_temp.r('F2 _payroll_control не выполняется authenticated',
    not has_function_privilege('authenticated', 'public._payroll_control(date)', 'EXECUTE'));
  rep := rep || pg_temp.r('F3 payroll_report не выполняется anon',
    not has_function_privilege('anon', 'public.payroll_report(date)', 'EXECUTE'));
  rep := rep || pg_temp.r('F4 attendance_mark не выполняется anon',
    not has_function_privilege('anon', 'public.attendance_mark(date,integer,text,numeric,boolean,text,boolean)', 'EXECUTE'));
  rep := rep || pg_temp.r('F5 attendance_mark выполняется authenticated',
    has_function_privilege('authenticated', 'public.attendance_mark(date,integer,text,numeric,boolean,text,boolean)', 'EXECUTE'));

  raise exception E'ОТЧЁТ (данные откатаны):\n%', rep;
end $$;
