-- Проверка переносов поштучных товаров (миграция 1b2c): transfer_stock, transfer_company_owner, отмена переносов.
-- Запускать на ТЕСТОВОЙ БД или в Bolt. Скрипт сам откатывает все данные: в конце намеренно падает с ошибкой "ОТЧЁТ".
create or replace function pg_temp.r(n text, c boolean) returns text language sql as
$$ select case when coalesce(c, false) then 'OK    ' else 'FAIL  ' end || n || E'\n' $$;

do $$
declare
  v_admin uuid; rep text := ''; v_msg text; v_cnt int;
  v_bld int; v_apt int; v_apt2 int; v_own int; v_cat int; v_staff int;
  v_item int; v_plain int;
  v_wh int; v_a_loc int; v_b_loc int; v_own_loc int; v_h_loc int;
  v_doc jsonb; v_id uuid; v_id2 uuid;
  v_u1 uuid; v_u2 uuid; v_u3 uuid; v_u4 uuid;
begin
  select id into v_admin from profiles where role = 'admin' and active limit 1;
  if v_admin is null then
    v_admin := gen_random_uuid();
    insert into auth.users(id, email) values (v_admin, 'zz-tr2-admin@example.invalid');
    insert into profiles(id, login, full_name, role) values (v_admin, 'zz-tr2-admin', 'ZZ Tr2 Admin', 'admin');
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  insert into buildings(name) values ('ZZP') returning id into v_bld;
  insert into apartments(building_id, number, code, type) values (v_bld, '1', 'ZZP/1', 'studio') returning id into v_apt;
  insert into apartments(building_id, number, code, type) values (v_bld, '2', 'ZZP/2', 'studio') returning id into v_apt2;
  insert into apartments(building_id, number, code, type, is_owner) values (v_bld, '3', 'ZZP/3', 'studio', true) returning id into v_own;
  insert into categories(name, kind) values ('ZZP актив', 'asset') returning id into v_cat;
  insert into staff(full_name) values ('ZZP сотрудник') returning id into v_staff;

  v_wh := _loc_singleton('warehouse');
  v_a_loc := _loc_apartment(v_apt);
  v_b_loc := _loc_apartment(v_apt2);
  v_own_loc := _loc_owner_stock(v_own);
  v_h_loc := _loc_holder(v_staff);

  perform set_config('app.unit_tracking_enable', 'on', true);
  insert into items(category_id, name, track_units) values (v_cat, 'ZZP поштучный', true) returning id into v_item;
  perform set_config('app.unit_tracking_enable', 'off', true);
  insert into items(category_id, name) values (v_cat, 'ZZP обычный') returning id into v_plain;

  perform post_move(p_op => 'receipt', p_item => v_item, p_qty => 4, p_unit_cost => 10, p_serials => array['ZZP-1','ZZP-2','ZZP-3','ZZP-4']);
  select id into v_u1 from item_units where code = 'ZZP-1';
  select id into v_u2 from item_units where code = 'ZZP-2';
  select id into v_u3 from item_units where code = 'ZZP-3';
  select id into v_u4 from item_units where code = 'ZZP-4';
  perform post_move(p_op => 'issue_apartment', p_item => v_item, p_qty => 2, p_apartment => v_apt, p_unit_ids => array[v_u1, v_u2]);

  -- T1: перенос квартира -> квартира
  v_doc := transfer_stock('apartment', v_apt, v_apt2,
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'unit_ids', jsonb_build_array(v_u1))), 'тест T1');
  v_id := (v_doc->>'doc_id')::uuid;
  select count(*) into v_cnt from item_units where id = v_u1 and location_id = v_b_loc and status = 'issued';
  rep := rep || pg_temp.r('T1 единица перенесена в квартиру назначения (issued)', v_cnt = 1);
  select count(*) into v_cnt from item_units where id = v_u2 and location_id = v_a_loc and status = 'issued';
  rep := rep || pg_temp.r('T1 вторая единица осталась в квартире-источнике', v_cnt = 1);
  rep := rep || pg_temp.r('T1 остатки: источник 1, назначение 1',
    (select qty from stock_balance where loc_id = v_a_loc and item_id = v_item) = 1
    and (select qty from stock_balance where loc_id = v_b_loc and item_id = v_item) = 1);
  select count(*) into v_cnt from unit_events where unit_id = v_u1 and event = 'transfer' and doc_id = v_id and move_id is not null and from_loc = v_a_loc and to_loc = v_b_loc;
  rep := rep || pg_temp.r('T1 событие transfer с doc_id и move_id', v_cnt = 1);
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('T1 unit_balance_mismatch пуст', v_cnt = 0);

  -- T2: перенос от сотрудника в квартиру
  perform post_move(p_op => 'issue_holder', p_item => v_item, p_qty => 1, p_staff => v_staff, p_unit_ids => array[v_u3]);
  perform transfer_stock('holder', v_staff, v_apt,
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'unit_ids', jsonb_build_array(v_u3))), 'тест T2');
  select count(*) into v_cnt from item_units where id = v_u3 and location_id = v_a_loc and status = 'issued';
  rep := rep || pg_temp.r('T2 единица от сотрудника в квартире (issued)', v_cnt = 1);
  rep := rep || pg_temp.r('T2 у сотрудника 0', coalesce((select qty from stock_balance where loc_id = v_h_loc and item_id = v_item), 0) = 0);

  -- T3: отказы
  v_msg := '';
  begin perform transfer_stock('apartment', v_apt2, v_apt,
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'unit_ids', jsonb_build_array(v_u2))));
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T3a единица не из источника отклонена', v_msg like '%не находится в источнике%');
  v_msg := '';
  begin perform transfer_stock('apartment', v_apt2, v_apt, jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1)));
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T3b без unit_ids отклонено', v_msg like '%обязательны%');
  v_msg := '';
  begin perform transfer_stock('apartment', v_apt, v_apt2,
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 2, 'unit_ids', jsonb_build_array(v_u2))));
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T3c число единиц не совпадает с qty отклонено', v_msg like '%должно совпадать%');
  v_msg := '';
  begin perform transfer_stock('apartment', v_apt, v_apt2,
    jsonb_build_array(jsonb_build_object('item_id', v_plain, 'qty', 1, 'unit_ids', jsonb_build_array(v_u2))));
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T3d unit_ids у обычного товара отклонено', v_msg <> '');
  select count(*) into v_cnt from item_units where id = v_u1 and location_id = v_b_loc and status = 'issued';
  rep := rep || pg_temp.r('T3e после отказов единицы на местах', v_cnt = 1);

  -- T4: склад компании -> owner-склад
  v_id2 := transfer_company_owner('to_owner', v_own,
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'unit_ids', jsonb_build_array(v_u4))), 'тест T4');
  select count(*) into v_cnt from item_units where id = v_u4 and location_id = v_own_loc and status = 'in_stock' and owner_apartment_id = v_own;
  rep := rep || pg_temp.r('T4 единица на owner-полке с owner_apartment_id', v_cnt = 1);
  rep := rep || pg_temp.r('T4 склад компании 0, owner-полка 1',
    coalesce((select qty from stock_balance where loc_id = v_wh and item_id = v_item), 0) = 0
    and (select qty from stock_balance where loc_id = v_own_loc and item_id = v_item) = 1);
  select count(*) into v_cnt from unit_events where unit_id = v_u4 and event = 'owner_transfer' and doc_id = v_id2 and move_id is not null;
  rep := rep || pg_temp.r('T4 событие owner_transfer с doc_id и move_id', v_cnt = 1);
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('T4 unit_balance_mismatch пуст', v_cnt = 0);

  -- T7b: отмена переноса на owner-склад для поштучного товара отклонена
  v_msg := '';
  begin perform void_document(v_id2, 'тест T7b'); exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T7b отмена owner-переноса отклонена', v_msg like '%отменять пока нельзя%');
  select count(*) into v_cnt from item_units where id = v_u4 and location_id = v_own_loc and owner_apartment_id = v_own;
  rep := rep || pg_temp.r('T7b единица осталась на owner-полке', v_cnt = 1);

  -- T6: отказы owner-переноса
  v_msg := '';
  begin perform transfer_company_owner('to_owner', v_own,
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'unit_ids', jsonb_build_array(v_u1))));
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T6 единица не со склада компании отклонена', v_msg <> '');

  -- T5: owner-склад -> компания
  perform transfer_company_owner('to_company', v_own,
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'unit_ids', jsonb_build_array(v_u4))), 'тест T5');
  select count(*) into v_cnt from item_units where id = v_u4 and location_id = v_wh and status = 'in_stock' and owner_apartment_id is null;
  rep := rep || pg_temp.r('T5 единица вернулась на склад компании без владельца', v_cnt = 1);
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('T5 unit_balance_mismatch пуст', v_cnt = 0);

  -- T7: отмена переноса между квартирами возвращает единицу
  perform void_document(v_id, 'тест T7');
  select count(*) into v_cnt from item_units where id = v_u1 and location_id = v_a_loc and status = 'issued';
  rep := rep || pg_temp.r('T7 отмена переноса: единица вернулась в квартиру-источник', v_cnt = 1);
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('T7 unit_balance_mismatch пуст', v_cnt = 0);

  -- T8: обычный товар переносится как раньше
  perform post_move(p_op => 'receipt', p_item => v_plain, p_qty => 5, p_unit_cost => 3);
  perform post_move(p_op => 'issue_apartment', p_item => v_plain, p_qty => 2, p_apartment => v_apt);
  perform transfer_stock('apartment', v_apt, v_apt2, jsonb_build_array(jsonb_build_object('item_id', v_plain, 'qty', 1)));
  rep := rep || pg_temp.r('T8 обычный товар: у источника 1, у назначения 1',
    (select qty from stock_balance where loc_id = v_a_loc and item_id = v_plain) = 1
    and (select qty from stock_balance where loc_id = v_b_loc and item_id = v_plain) = 1);
  select count(*) into v_cnt from item_units where item_id = v_plain;
  rep := rep || pg_temp.r('T8 обычный товар: единицы не создаются', v_cnt = 0);

  -- T9: права
  rep := rep || pg_temp.r('T9 _transfer_units не выполняется authenticated',
    not has_function_privilege('authenticated', 'public._transfer_units(integer,uuid[],numeric,integer,integer,text,uuid,bigint,boolean,integer,boolean,integer)', 'EXECUTE'));
  rep := rep || pg_temp.r('T9 _transfer_units не выполняется anon',
    not has_function_privilege('anon', 'public._transfer_units(integer,uuid[],numeric,integer,integer,text,uuid,bigint,boolean,integer,boolean,integer)', 'EXECUTE'));
  rep := rep || pg_temp.r('T9 transfer_stock выполняется authenticated, но не anon',
    has_function_privilege('authenticated', 'public.transfer_stock(text,integer,integer,jsonb,text,date)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.transfer_stock(text,integer,integer,jsonb,text,date)', 'EXECUTE'));

  raise exception using message = E'ОТЧЁТ\n' || rep;
end $$;
