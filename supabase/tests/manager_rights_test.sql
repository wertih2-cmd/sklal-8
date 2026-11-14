-- Проверка manager-rights.sql: права менеджера по заявкам и уборкам, apartment_completeness().
-- Скрипт сам откатывает все данные: в конце намеренно падает с ошибкой "ОТЧЁТ", в тексте — результаты.
-- Данные теста: здание ZZMGR, 2 квартиры, 2 актива, свои нормы asset_standing на квартире.
create or replace function pg_temp.r(n text, c boolean) returns text language sql as
$$ select case when coalesce(c, false) then 'OK    ' else 'FAIL  ' end || n || E'\n' $$;
create or replace function pg_temp.as_user(u uuid) returns void language sql as
$$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true),
          set_config('request.jwt.claim.sub', u::text, true) $$;

do $$
declare
  v_admin uuid := gen_random_uuid(); v_mgr uuid := gen_random_uuid(); v_sv uuid := gen_random_uuid();
  rep text := ''; t text; j jsonb; n1 int; n2 int;
  v_bld int; v_apt int; v_apt2 int; v_cat int; v_A int; v_B int;
  v_st int;
  i1 uuid; i2 uuid; i3 uuid; i4 uuid; i5 uuid; i6 uuid; i7 uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid;
  rec record;
begin
  insert into auth.users(id, email) values
    (v_admin, 'zz-mgr-admin@example.invalid'), (v_mgr, 'zz-mgr-mgr@example.invalid'), (v_sv, 'zz-mgr-sv@example.invalid');
  insert into profiles(id, login, full_name, role) values
    (v_admin, 'zz-mgr-admin', 'ZZ Mgr Admin', 'admin'), (v_mgr, 'zz-mgr-mgr', 'ZZ Mgr Manager', 'manager'),
    (v_sv, 'zz-mgr-sv', 'ZZ Mgr Sv', 'supervisor');
  perform pg_temp.as_user(v_admin);

  insert into buildings(name) values ('ZZMGR') returning id into v_bld;
  insert into apartments(building_id, number, code, type) values (v_bld, '1', 'ZZMGR/1', 'studio') returning id into v_apt;
  insert into apartments(building_id, number, code, type) values (v_bld, '2', 'ZZMGR/2', 'studio') returning id into v_apt2;
  insert into categories(name, kind) values ('ZZ MGR актив', 'asset') returning id into v_cat;
  insert into items(category_id, name) values (v_cat, 'ZZ MGR A') returning id into v_A;
  insert into items(category_id, name) values (v_cat, 'ZZ MGR B') returning id into v_B;
  insert into norm_rules(norm_type, apartment_id, item_id, qty) values
    ('asset_standing', v_apt, v_A, 2), ('asset_standing', v_apt, v_B, 1);
  perform post_move(p_op => 'receipt', p_item => v_A, p_qty => 5, p_unit_cost => 10);
  perform post_move(p_op => 'issue_apartment', p_item => v_A, p_qty => 3, p_apartment => v_apt);

  insert into staff(full_name) values ('ZZ MGR staff') returning id into v_st;
  insert into incidents(apartment_id, item_id, kind, qty, created_by) values (v_apt, v_A, 'lost', 1, v_admin) returning id into i1;
  insert into incidents(apartment_id, kind, qty, created_by) values (v_apt, 'other', 1, v_admin) returning id into i2;
  insert into incidents(apartment_id, item_id, kind, qty, created_by) values (v_apt, v_A, 'lost', 1, v_admin) returning id into i3;
  insert into incidents(apartment_id, item_id, kind, qty, created_by) values (v_apt, v_A, 'lost', 1, v_admin) returning id into i4;
  insert into incidents(apartment_id, item_id, kind, qty, created_by) values (v_apt, v_A, 'lost', 1, v_admin) returning id into i5;
  insert into incidents(apartment_id, kind, qty, created_by) values (v_apt, 'other', 1, v_admin) returning id into i6;
  insert into incidents(apartment_id, kind, qty, created_by) values (v_apt, 'other', 1, v_admin) returning id into i7;

  insert into cleaning_events(client_op_id, apartment_id, lead_staff_id, posting_status) values (gen_random_uuid(), v_apt, v_st, 'pending') returning id into c1;
  insert into cleaning_events(client_op_id, apartment_id, lead_staff_id, posting_status) values (gen_random_uuid(), v_apt, v_st, 'pending') returning id into c2;
  insert into cleaning_events(client_op_id, apartment_id, lead_staff_id, posting_status) values (gen_random_uuid(), v_apt, v_st, 'pending') returning id into c3;
  insert into cleaning_events(client_op_id, apartment_id, lead_staff_id, posting_status) values (gen_random_uuid(), v_apt, v_st, 'pending') returning id into c4;

  execute 'set local role authenticated';

  -- I: заявки, менеджер
  perform pg_temp.as_user(v_mgr);
  t := null;
  begin j := take_incident(i1); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('I1 менеджер берёт заявку в работу', t is null and j->>'status' = 'in_progress');
  rep := rep || pg_temp.r('I1 исполнитель = менеджер', (select assigned_to from incidents where id = i1) = v_mgr);

  t := null;
  begin j := approve_incident(i2, 'reject', 'ZZ нет'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('I2 менеджер отклоняет заявку', t is null and j->>'status' = 'rejected'
    and (select status::text from incidents where id = i2) = 'rejected' and (select resolved_by from incidents where id = i2) = v_mgr);

  execute 'reset role';
  select count(*) into n1 from stock_moves;
  execute 'set local role authenticated';
  perform pg_temp.as_user(v_mgr);
  t := null;
  begin j := approve_incident(i3, 'confirm', 'ZZ ok'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('I3 менеджер: подтверждение заявки с позицией запрещено', t like '%с позицией подтверждает администратор%'
    and (select status::text from incidents where id = i3) = 'new');
  rep := rep || pg_temp.r('I3 списания нет: writeoff_move_id пуст', (select writeoff_move_id from incidents where id = i3) is null);
  execute 'reset role';
  select count(*) into n2 from stock_moves;
  execute 'set local role authenticated';
  perform pg_temp.as_user(v_mgr);
  rep := rep || pg_temp.r('I3 число движений склада не изменилось', n1 = n2);

  t := null;
  begin perform approve_incident(i4, 'confirm', null, false, '{"coef":2}'::jsonb); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('I4 менеджер с p_charge получает отказ', t like '%только администратору%');
  t := null;
  begin perform approve_incident(i4, 'confirm', null, true, null); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('I5 менеджер с p_force получает отказ', t like '%только администратору%');
  rep := rep || pg_temp.r('I5 заявка осталась новой', (select status::text from incidents where id = i4) = 'new');

  t := null;
  begin j := approve_incident(i6, 'confirm', 'ZZ без позиции'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('I6 менеджер подтверждает заявку без позиции', t is null and j->>'status' = 'confirmed');

  -- I: супервайзер
  perform pg_temp.as_user(v_sv);
  t := null;
  begin perform take_incident(i5); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('I7 супервайзер: take_incident запрещён', t like '%администратор или менеджер%');
  t := null;
  begin perform approve_incident(i5, 'reject'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('I8 супервайзер: approve_incident запрещён', t like '%администратор или менеджер%');

  -- I: админ сохраняет полный путь
  perform pg_temp.as_user(v_admin);
  t := null;
  begin j := approve_incident(i5, 'confirm', null, false, '{"coef":2}'::jsonb); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('I9 админ подтверждает со списанием', t is null and j->>'status' = 'confirmed'
    and (select writeoff_move_id from incidents where id = i5) is not null);
  rep := rep || pg_temp.r('I9 админ: начисление создано (10 x 2 = 20)',
    (select amount from incident_charges where incident_id = i5) = 20);
  t := null;
  begin j := approve_incident(i7, 'reject'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('I10 админ отклоняет', t is null and j->>'status' = 'rejected');

  -- C: уборки
  perform pg_temp.as_user(v_mgr);
  t := null;
  begin j := approve_cleaning(c1, 'confirm', 'ZZ ok'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C1 менеджер подтверждает уборку', t is null and j->>'status' = 'confirmed');
  rep := rep || pg_temp.r('C1 уборка проведена, approved_by = менеджер',
    (select posting_status from cleaning_events where id = c1) = 'posted' and (select approved_by from cleaning_events where id = c1) = v_mgr);
  rep := rep || pg_temp.r('C1 нехватки менеджеру не возвращаются', j->'shortages' = '[]'::jsonb);
  t := null;
  begin j := approve_cleaning(c2, 'reject', 'ZZ нет'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C2 менеджер отклоняет уборку', t is null and j->>'status' = 'rejected'
    and (select posting_status from cleaning_events where id = c2) = 'rejected' and (select status::text from cleaning_events where id = c2) = 'reversed');
  t := null;
  begin perform reverse_cleaning(c1, 'ZZ'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C3 менеджер: reverse_cleaning по-прежнему запрещён', t like '%Только администратор%');
  t := null;
  begin perform recalculate_cleaning(c1); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C3 менеджер: recalculate_cleaning по-прежнему запрещён', t like '%Только администратор%');
  t := null;
  begin perform cleaning_preview(c3); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C3 менеджер: cleaning_preview по-прежнему запрещён', t like '%Только администратор%');

  perform pg_temp.as_user(v_sv);
  t := null;
  begin perform approve_cleaning(c3, 'confirm'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C4 супервайзер: approve_cleaning запрещён', t like '%администратор или менеджер%');

  perform pg_temp.as_user(v_admin);
  t := null;
  begin j := approve_cleaning(c4, 'confirm'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C5 админ подтверждает уборку', t is null and j->>'status' = 'confirmed' and j ? 'shortages');

  -- K: укомплектованность без количеств
  perform pg_temp.as_user(v_mgr);
  select * into rec from apartment_completeness() where apartment_id = v_apt;
  rep := rep || pg_temp.r('K1 менеджер получает строку квартиры', rec.apartment_id = v_apt);
  perform pg_temp.as_user(v_admin);
  select count(*) filter (where norm > 0) as tot, count(*) filter (where gap > 0) as mis into n1, n2
    from apartment_gap where apartment_id = v_apt;
  perform pg_temp.as_user(v_mgr);
  rep := rep || pg_temp.r('K2 всего строк нормы = как в apartment_gap (' || n1 || ')', rec.norm_total = n1);
  rep := rep || pg_temp.r('K2 не хватает = как в apartment_gap (' || n2 || ')', rec.norm_missing = n2);
  perform pg_temp.as_user(v_admin);
  rep := rep || pg_temp.r('K3 позиция A (2 из 2) не в нехватке, B (0 из 1) в нехватке',
    not exists (select 1 from apartment_gap where apartment_id = v_apt and item_id = v_A and gap > 0)
    and exists (select 1 from apartment_gap where apartment_id = v_apt and item_id = v_B and gap > 0));
  rep := rep || 'DBG A norm/actual/gap: ' || coalesce((select norm || '/' || actual || '/' || gap from apartment_gap where apartment_id = v_apt and item_id = v_A), 'нет строки')
    || E' | B norm/actual/gap: ' || coalesce((select norm || '/' || actual || '/' || gap from apartment_gap where apartment_id = v_apt and item_id = v_B), 'нет строки')
    || E' | выдача A: ' || coalesce((select sum(qty)::text from stock_moves where item_id = v_A and to_loc = (select id from locations where apartment_id = v_apt)), '0')
    || E' | A на полке: ' || coalesce((select sum(qty)::text from stock_balance where item_id = v_A and loc_id = (select id from locations where apartment_id = v_apt)), '0')
    || E'\n';
  perform pg_temp.as_user(v_mgr);
  rep := rep || pg_temp.r('K4 менеджер не видит остатки напрямую (stock_balance пуст)', (select count(*) from stock_balance) = 0);
  rep := rep || pg_temp.r('K4 менеджер: apartment_gap пуст по остаткам (actual = 0 у всех строк)',
    not exists (select 1 from apartment_gap where actual <> 0));

  perform pg_temp.as_user(v_sv);
  t := null;
  begin perform * from apartment_completeness(); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('K5 супервайзер: apartment_completeness запрещена', t like '%Нет доступа%');
  perform pg_temp.as_user(v_admin);
  t := null;
  begin perform * from apartment_completeness(); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('K6 админ вызывает apartment_completeness', t is null);

  -- G: права на функции
  rep := rep || pg_temp.r('G1 apartment_completeness не выполняется anon',
    not has_function_privilege('anon', 'public.apartment_completeness()', 'EXECUTE'));
  rep := rep || pg_temp.r('G2 apartment_completeness выполняется authenticated',
    has_function_privilege('authenticated', 'public.apartment_completeness()', 'EXECUTE'));
  rep := rep || pg_temp.r('G3 approve_incident не выполняется anon',
    not has_function_privilege('anon', 'public.approve_incident(uuid,text,text,boolean,jsonb)', 'EXECUTE'));
  rep := rep || pg_temp.r('G4 approve_cleaning не выполняется anon',
    not has_function_privilege('anon', 'public.approve_cleaning(uuid,text,text)', 'EXECUTE'));
  rep := rep || pg_temp.r('G5 take_incident не выполняется anon',
    not has_function_privilege('anon', 'public.take_incident(uuid,uuid,timestamptz)', 'EXECUTE'));

  raise exception E'ОТЧЁТ (данные откатаны):\n%', rep;
end $$;
