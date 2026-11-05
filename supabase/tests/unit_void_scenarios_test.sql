-- Проверка void_document для документов с поштучными товарами (миграция 1b2b). Запускать на ТЕСТОВОЙ БД или в Bolt.
-- Скрипт сам откатывает все данные: в конце намеренно падает с ошибкой "ОТЧЁТ", в тексте — результаты.
create or replace function pg_temp.r(n text, c boolean) returns text language sql as
$$ select case when coalesce(c, false) then 'OK    ' else 'FAIL  ' end || n || E'\n' $$;

do $$
declare
  v_admin uuid; rep text := ''; v_msg text := ''; v_cnt int; v_rej boolean := false;
  v_bld int; v_apt int; v_own int; v_cat int;
  v_item int; v_plain int;
  v_wh int; v_apt_loc int; v_own_loc int; v_src int;
  v_doc jsonb; v_doc2 jsonb; v_id uuid; v_id2 uuid;
  v_u1 uuid; v_u2 uuid; v_u3 uuid; v_u4 uuid;
begin
  select id into v_admin from profiles where role = 'admin' and active limit 1;
  if v_admin is null then
    v_admin := gen_random_uuid();
    insert into auth.users(id, email) values (v_admin, 'zz-void-admin@example.invalid');
    insert into profiles(id, login, full_name, role) values (v_admin, 'zz-void-admin', 'ZZ Void Admin', 'admin');
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  insert into buildings(name) values ('ZZV') returning id into v_bld;
  insert into apartments(building_id, number, code, type) values (v_bld, '1', 'ZZV/1', 'studio') returning id into v_apt;
  insert into apartments(building_id, number, code, type, is_owner) values (v_bld, '2', 'ZZV/2', 'studio', true) returning id into v_own;
  insert into categories(name, kind) values ('ZZV актив', 'asset') returning id into v_cat;

  v_wh := _loc_singleton('warehouse');
  v_src := _loc_singleton('source');
  v_apt_loc := _loc_apartment(v_apt);
  v_own_loc := _loc_owner_stock(v_own);

  perform set_config('app.unit_tracking_enable', 'on', true);
  insert into items(category_id, name, track_units) values (v_cat, 'ZZV поштучный', true) returning id into v_item;
  perform set_config('app.unit_tracking_enable', 'off', true);
  insert into items(category_id, name) values (v_cat, 'ZZV обычный') returning id into v_plain;

  perform post_move(p_op => 'receipt', p_item => v_item, p_qty => 3, p_unit_cost => 10, p_serials => array['ZZV-1','ZZV-2','ZZV-3']);
  select id into v_u1 from item_units where code = 'ZZV-1';
  select id into v_u2 from item_units where code = 'ZZV-2';
  select id into v_u3 from item_units where code = 'ZZV-3';

  -- V1: отмена документа выдачи возвращает единицу на склад
  v_doc := post_document(p_op => 'issue_apartment',
    p_lines => jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'unit_ids', jsonb_build_array(v_u1))),
    p_apartment => v_apt);
  v_id := (v_doc->>'doc_id')::uuid;
  perform void_document(v_id, 'тест V1');
  select count(*) into v_cnt from item_units where id = v_u1 and location_id = v_wh and status = 'in_stock';
  rep := rep || pg_temp.r('V1 единица вернулась на склад in_stock', v_cnt = 1);
  rep := rep || pg_temp.r('V1 склад компании 3', (select qty from stock_balance where loc_id = v_wh and item_id = v_item) = 3);
  rep := rep || pg_temp.r('V1 в квартире 0', (select coalesce(qty, 0) from stock_balance where loc_id = v_apt_loc and item_id = v_item) = 0);
  select count(*) into v_cnt from unit_events where unit_id = v_u1 and event = 'void' and doc_id = v_id and move_id is not null and to_loc = v_wh;
  rep := rep || pg_temp.r('V1 событие void с doc_id и move_id', v_cnt = 1);
  rep := rep || pg_temp.r('V1 документ в статусе void', (select status from documents where id = v_id) = 'void');
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('V1 unit_balance_mismatch пуст', v_cnt = 0);

  -- V1b: повторная отмена отклонена
  v_msg := '';
  begin perform void_document(v_id, 'повтор'); exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('V1b повторная отмена отклонена', v_msg <> '');

  -- V2: единица уже участвовала в более поздней операции
  v_doc := post_document(p_op => 'issue_apartment',
    p_lines => jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'unit_ids', jsonb_build_array(v_u2))),
    p_apartment => v_apt);
  v_id := (v_doc->>'doc_id')::uuid;
  perform post_move(p_op => 'return_apartment', p_item => v_item, p_qty => 1, p_apartment => v_apt, p_unit_ids => array[v_u2]);
  v_msg := '';
  begin perform void_document(v_id, 'тест V2'); exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('V2 отмена отклонена: единица возвращена, остаток в квартире 0', v_msg like '%более поздней операции%' or v_msg like '%уже израсходован%');
  select count(*) into v_cnt from item_units where id = v_u2 and location_id = v_wh and status = 'in_stock';
  rep := rep || pg_temp.r('V2 после отказа единица на месте', v_cnt = 1);
  rep := rep || pg_temp.r('V2 документ остался posted', (select status from documents where id = v_id) = 'posted');

  -- V2b: остаток в квартире совпадает (1), но единица в документе уже другая: проверка по единицам
  perform post_move(p_op => 'issue_apartment', p_item => v_item, p_qty => 1, p_apartment => v_apt, p_unit_ids => array[v_u3]);
  v_msg := '';
  begin perform void_document(v_id, 'тест V2b'); exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('V2b отмена отклонена текстом про более позднюю операцию', v_msg like '%более поздней операции%');
  rep := rep || pg_temp.r('V2b документ остался posted', (select status from documents where id = v_id) = 'posted');
  perform post_move(p_op => 'return_apartment', p_item => v_item, p_qty => 1, p_apartment => v_apt, p_unit_ids => array[v_u3]);

  -- V3: отмена документа прихода списывает единицы
  v_doc2 := post_document(p_op => 'receipt',
    p_lines => jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 2, 'unit_cost', 12, 'serials', jsonb_build_array('ZZV-R1', 'ZZV-R2'))));
  v_id2 := (v_doc2->>'doc_id')::uuid;
  select count(*) into v_cnt from item_units where code in ('ZZV-R1', 'ZZV-R2') and status = 'in_stock' and location_id = v_wh;
  rep := rep || pg_temp.r('V3 приход создал 2 единицы', v_cnt = 2);
  perform void_document(v_id2, 'тест V3');
  select count(*) into v_cnt from item_units where code in ('ZZV-R1', 'ZZV-R2') and status = 'written_off' and location_id = v_src;
  rep := rep || pg_temp.r('V3 единицы списаны (written_off) в source', v_cnt = 2);
  rep := rep || pg_temp.r('V3 склад компании вернулся к 3', (select qty from stock_balance where loc_id = v_wh and item_id = v_item) = 3);
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('V3 unit_balance_mismatch пуст', v_cnt = 0);

  -- V4: приход нельзя отменить, если его единица уже выдана
  v_doc2 := post_document(p_op => 'receipt',
    p_lines => jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'unit_cost', 12, 'serials', jsonb_build_array('ZZV-R3'))));
  v_id2 := (v_doc2->>'doc_id')::uuid;
  select id into v_u4 from item_units where code = 'ZZV-R3';
  perform post_move(p_op => 'issue_apartment', p_item => v_item, p_qty => 1, p_apartment => v_apt, p_unit_ids => array[v_u4]);
  v_msg := '';
  begin perform void_document(v_id2, 'тест V4'); exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('V4 отмена прихода отклонена после выдачи единицы', v_msg <> '');
  select count(*) into v_cnt from item_units where id = v_u4 and location_id = v_apt_loc and status = 'issued';
  rep := rep || pg_temp.r('V4 единица осталась в квартире', v_cnt = 1);

  -- V5: owner-склад: отмена выдачи возвращает единицу на owner-полку с сохранением owner_apartment_id
  perform post_move(p_op => 'receipt', p_item => v_item, p_qty => 1, p_unit_cost => 20, p_owner_apartment => v_own, p_serials => array['ZZV-O1']);
  select id into v_u3 from item_units where code = 'ZZV-O1';
  v_doc := post_document(p_op => 'issue_apartment',
    p_lines => jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'unit_ids', jsonb_build_array(v_u3))),
    p_apartment => v_own);
  v_id := (v_doc->>'doc_id')::uuid;
  perform void_document(v_id, 'тест V5');
  select count(*) into v_cnt from item_units where id = v_u3 and location_id = v_own_loc and status = 'in_stock' and owner_apartment_id = v_own;
  rep := rep || pg_temp.r('V5 owner: единица вернулась на owner-полку', v_cnt = 1);

  -- V6: обычный товар отменяется как раньше
  perform post_move(p_op => 'receipt', p_item => v_plain, p_qty => 5, p_unit_cost => 3);
  v_doc := post_document(p_op => 'issue_apartment',
    p_lines => jsonb_build_array(jsonb_build_object('item_id', v_plain, 'qty', 2)), p_apartment => v_apt);
  v_id := (v_doc->>'doc_id')::uuid;
  perform void_document(v_id, 'тест V6');
  rep := rep || pg_temp.r('V6 обычный товар: склад 5', (select qty from stock_balance where loc_id = v_wh and item_id = v_plain) = 5);
  select count(*) into v_cnt from item_units where item_id = v_plain;
  rep := rep || pg_temp.r('V6 обычный товар: единицы не создаются', v_cnt = 0);

  raise exception using message = E'ОТЧЁТ\n' || rep;
end $$;
