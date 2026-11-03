-- Проверка отчётов и защиты поштучного учёта (миграция 1b1b1). Запускать в Supabase SQL Editor на ТЕСТОВОЙ БД.
-- Скрипт сам откатывает все данные: в конце намеренно падает с ошибкой "ОТЧЁТ", в тексте — результаты.
create or replace function pg_temp.r(n text, c boolean) returns text language sql as
$$ select case when coalesce(c, false) then 'OK    ' else 'FAIL  ' end || n || E'\n' $$;

do $$
declare
  v_admin uuid; rep text := ''; v_rej boolean := false; v_cnt int; v_bld int; v_apt int; v_cat int;
  v_item int; v_u1 uuid; v_u2 uuid; v_u3 uuid; v_wh int; v_apt_loc int; v_h jsonb; v_o jsonb; v_priv boolean;
  v_err_code text := '';
begin
  select id into v_admin from profiles where role = 'admin' and active limit 1;
  if v_admin is null then
    v_admin := gen_random_uuid();
    insert into auth.users(id, email) values (v_admin, 'zz-test-admin@example.invalid');
    insert into profiles(id, login, full_name, role) values (v_admin, 'zz-test-admin', 'ZZ Test Admin', 'admin');
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  insert into buildings(name) values ('ZZR') returning id into v_bld;
  insert into apartments(building_id, number, code, type) values (v_bld, '1', 'ZZR/1', 'studio') returning id into v_apt;
  insert into categories(name, kind) values ('ZZ отчёты актив', 'asset') returning id into v_cat;
  v_wh := _loc_singleton('warehouse');
  v_apt_loc := _loc_apartment(v_apt);

  -- R1 новый товар с track_units=true без разрешения отклоняется
  begin
    insert into items(category_id, name, track_units) values (v_cat, 'ZZ R', true);
  exception when others then v_rej := true;
  end;
  rep := rep || pg_temp.r('R1 INSERT товара с track_units=true без настройки отклонён', v_rej);

  -- R2 тот же INSERT с разрешающей настройкой проходит
  perform set_config('app.unit_tracking_enable', 'on', true);
  insert into items(category_id, name, track_units) values (v_cat, 'ZZ R', true) returning id into v_item;
  perform set_config('app.unit_tracking_enable', 'off', true);
  rep := rep || pg_temp.r('R2 INSERT товара с track_units=true при app.unit_tracking_enable=on проходит', (select track_units from items where id = v_item));

  -- R3 единица без остатка даёт расхождение, приход его закрывает
  insert into item_units(item_id, code, status, location_id, unit_cost)
    values (v_item, 'ZZR-1', 'in_stock', v_wh, 10) returning id into v_u1;
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('R3a единица без остатка показана как расхождение', v_cnt = 1);
  delete from item_units where id = v_u1;
  perform post_move(p_op => 'receipt', p_item => v_item, p_qty => 1, p_unit_cost => 10, p_serials => array['ZZR-1']);
  select id into v_u1 from item_units where code = 'ZZR-1';
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('R3b после прихода с кодом ZZR-1 расхождения нет', v_cnt = 0);

  -- R4 статус issued считается как наличие на локации
  update item_units set status = 'issued' where id = v_u1;
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('R4 единица со статусом issued учитывается в балансе (расхождения нет)', v_cnt = 0);

  -- R5 лишняя in_stock единица создаёт расхождение; админ видит, не-админ нет
  insert into item_units(item_id, code, status, location_id, unit_cost)
    values (v_item, 'ZZR-2', 'in_stock', v_wh, 10) returning id into v_u2;
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('R5a админ видит расхождение по товару', v_cnt = 1);
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  execute 'set local role authenticated';
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  execute 'reset role';
  rep := rep || pg_temp.r('R5b не-админ не видит строк unit_balance_mismatch', v_cnt = 0);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- R6 история единицы: события по времени, без пересортировки
  insert into unit_events(unit_id, event, from_loc, to_loc, note, created_at)
    values (v_u1, 'receipt', null, v_wh, 'первый', '2026-01-01 10:00+00');
  insert into unit_events(unit_id, event, from_loc, to_loc, note, created_at)
    values (v_u1, 'issue', v_wh, v_apt_loc, 'второй', '2026-01-02 10:00+00');
  v_h := report_unit_history(v_u1);
  rep := rep || pg_temp.r('R6a история: код и статус единицы', v_h->'unit'->>'code' = 'ZZR-1' and v_h->'unit'->>'status' = 'issued' and v_h->'unit'->>'item_name' = 'ZZ R');
  rep := rep || pg_temp.r('R6b история: три события в порядке времени (включая приход с кодом)', jsonb_array_length(v_h->'events') = 3 and v_h->'events'->0->>'event' = 'receipt' and v_h->'events'->1->>'event' = 'issue' and v_h->'events'->1->>'note' = 'второй' and v_h->'events'->2->>'event' = 'receipt');
  rep := rep || pg_temp.r('R6c история: неизвестная единица дает null', report_unit_history(gen_random_uuid()) is null);

  -- R7 отчёт по собственным единицам владельца
  insert into item_units(item_id, code, status, location_id, unit_cost, owner_apartment_id)
    values (v_item, 'ZZR-3', 'in_stock', v_wh, 5, v_apt) returning id into v_u3;
  v_o := report_owner_units(v_apt);
  rep := rep || pg_temp.r('R7a отчёт владельца: одна единица этой квартиры', jsonb_array_length(v_o) = 1 and v_o->0->>'code' = 'ZZR-3' and v_o->0->>'apartment' = 'ZZR/1');
  rep := rep || pg_temp.r('R7b название товара в отчёте владельца', v_o->0->'item_name'->>'name' = 'ZZ R');
  rep := rep || pg_temp.r('R7c параметр без совпадений дает пустой массив', report_owner_units(-1) = '[]'::jsonb);
  rep := rep || pg_temp.r('R7d без параметра есть эта единица', report_owner_units(null) @> jsonb_build_array(jsonb_build_object('code', 'ZZR-3')));

  -- R8 не-админ получает отказ от обеих функций
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  execute 'set local role authenticated';
  v_rej := false;
  begin
    perform report_unit_history(v_u1);
  exception when sqlstate '42501' then v_rej := true;
  end;
  rep := rep || pg_temp.r('R8a не-админ: report_unit_history отказ 42501', v_rej);
  v_rej := false;
  begin
    perform report_owner_units(v_apt);
  exception when sqlstate '42501' then v_rej := true;
  end;
  execute 'reset role';
  rep := rep || pg_temp.r('R8b не-админ: report_owner_units отказ 42501', v_rej);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- R9 anon не может вызвать обе функции, authenticated может
  select bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE')) into v_priv
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('report_unit_history', 'report_owner_units');
  rep := rep || pg_temp.r('R9 anon не имеет EXECUTE, authenticated имеет (обе функции)', coalesce(v_priv, false));

  raise exception using message = E'ОТЧЁТ\n' || rep;
end $$;
