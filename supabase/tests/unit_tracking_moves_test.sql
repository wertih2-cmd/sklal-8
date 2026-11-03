-- Проверка перемещений поштучных единиц (миграция 1b2a). Запускать в Supabase SQL Editor на ТЕСТОВОЙ БД.
-- Скрипт сам откатывает все данные: в конце намеренно падает с ошибкой "ОТЧЁТ", в тексте — результаты.
create or replace function pg_temp.r(n text, c boolean) returns text language sql as
$$ select case when coalesce(c, false) then 'OK    ' else 'FAIL  ' end || n || E'\n' $$;

do $$
declare
  v_admin uuid; rep text := ''; v_msg text := ''; v_rej boolean := false; v_cnt int; v_bal numeric;
  v_bld int; v_apt int; v_own int; v_cat int; v_plain_cat int; v_staff int;
  v_item int; v_plain int; v_other int;
  v_wh int; v_sink int; v_apt_loc int; v_own_loc int; v_h_loc int; v_other_loc int;
  v_mv bigint; v_doc jsonb; v_doc2 jsonb; v_doc_id uuid;
  v_u1 uuid; v_u2 uuid; v_u3 uuid; v_u4 uuid; v_u5 uuid; v_u6 uuid;
  v_u7 uuid; v_u8 uuid; v_u9 uuid; v_u10 uuid;
  v_units uuid[]; v_codes text[]; v_before int; v_bal_before numeric;
  v_ev_cnt int; v_set_val text;
  v_nonasset item_kind;
begin
  select id into v_admin from profiles where role = 'admin' and active limit 1;
  if v_admin is null then
    v_admin := gen_random_uuid();
    insert into auth.users(id, email) values (v_admin, 'zz-test-admin@example.invalid');
    insert into profiles(id, login, full_name, role) values (v_admin, 'zz-test-admin', 'ZZ Test Admin', 'admin');
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  insert into buildings(name) values ('ZZM') returning id into v_bld;
  insert into apartments(building_id, number, code, type) values (v_bld, '1', 'ZZM/1', 'studio') returning id into v_apt;
  insert into apartments(building_id, number, code, type, is_owner) values (v_bld, '2', 'ZZM/2', 'studio', true) returning id into v_own;
  insert into categories(name, kind) values ('ZZM актив', 'asset') returning id into v_cat;
  select e into v_nonasset from unnest(enum_range(null::item_kind)) e where e <> 'asset'::item_kind limit 1;
  insert into categories(name, kind) values ('ZZM расходник', v_nonasset) returning id into v_plain_cat;
  insert into staff(full_name) values ('ZZM сотрудник') returning id into v_staff;

  v_wh := _loc_singleton('warehouse');
  v_sink := _loc_singleton('sink');
  v_apt_loc := _loc_apartment(v_apt);
  v_own_loc := _loc_owner_stock(v_own);
  v_h_loc := _loc_holder(v_staff);

  -- товар с поштучным учётом
  perform set_config('app.unit_tracking_enable', 'on', true);
  insert into items(category_id, name, track_units) values (v_cat, 'ZZM поштучный', true) returning id into v_item;
  perform set_config('app.unit_tracking_enable', 'off', true);

  -- обычный товар
  insert into items(category_id, name) values (v_cat, 'ZZM обычный') returning id into v_plain;

  -- другой поштучный товар (для проверки "чужой товар")
  perform set_config('app.unit_tracking_enable', 'on', true);
  insert into items(category_id, name, track_units) values (v_cat, 'ZZM другой', true) returning id into v_other;
  perform set_config('app.unit_tracking_enable', 'off', true);
  perform post_move(p_op => 'receipt', p_item => v_other, p_qty => 1, p_unit_cost => 1, p_serials => array['ZZM-OTH1']);
  v_other_loc := v_wh;

  -- =========================================================
  -- W1 выдача 2 единиц в квартиру
  -- =========================================================
  perform post_move(p_op => 'receipt', p_item => v_item, p_qty => 4, p_unit_cost => 10, p_serials => array['ZZM-1','ZZM-2','ZZM-3','ZZM-4']);
  select id into v_u1 from item_units where code = 'ZZM-1';
  select id into v_u2 from item_units where code = 'ZZM-2';
  select id into v_u3 from item_units where code = 'ZZM-3';
  select id into v_u4 from item_units where code = 'ZZM-4';

  v_mv := post_move(p_op => 'issue_apartment', p_item => v_item, p_qty => 2, p_apartment => v_apt, p_unit_ids => array[v_u1, v_u2]);
  rep := rep || pg_temp.r('W1 выдача 2 ед. в квартиру: склад -2', (select qty from stock_balance where loc_id = v_wh and item_id = v_item) = 2);
  rep := rep || pg_temp.r('W1 выдача: в квартире +2', (select qty from stock_balance where loc_id = v_apt_loc and item_id = v_item) = 2);
  select count(*) into v_cnt from item_units where id = any(array[v_u1,v_u2]) and location_id = v_apt_loc and status = 'issued';
  rep := rep || pg_temp.r('W1 единицы в квартире со статусом issued', v_cnt = 2);
  select count(*) into v_cnt from unit_events where move_id = v_mv and event = 'issue_apartment' and from_loc = v_wh and to_loc = v_apt_loc;
  rep := rep || pg_temp.r('W1 события issue_apartment с move_id', v_cnt = 2);
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('W1 unit_balance_mismatch пуст', v_cnt = 0);

  -- =========================================================
  -- W2 возврат из квартиры
  -- =========================================================
  v_mv := post_move(p_op => 'return_apartment', p_item => v_item, p_qty => 1, p_apartment => v_apt, p_unit_ids => array[v_u1]);
  rep := rep || pg_temp.r('W2 возврат: склад +1', (select qty from stock_balance where loc_id = v_wh and item_id = v_item) = 3);
  rep := rep || pg_temp.r('W2 возврат: в квартире -1', (select qty from stock_balance where loc_id = v_apt_loc and item_id = v_item) = 1);
  select count(*) into v_cnt from item_units where id = v_u1 and location_id = v_wh and status = 'in_stock';
  rep := rep || pg_temp.r('W2 единица на складе in_stock', v_cnt = 1);
  select count(*) into v_cnt from unit_events where move_id = v_mv and event = 'return_apartment' and from_loc = v_apt_loc and to_loc = v_wh;
  rep := rep || pg_temp.r('W2 событие return_apartment', v_cnt = 1);
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('W2 unit_balance_mismatch пуст', v_cnt = 0);

  -- =========================================================
  -- W3 списание из квартиры (written_off в sink)
  -- =========================================================
  v_mv := post_move(p_op => 'writeoff_apartment', p_item => v_item, p_qty => 1, p_apartment => v_apt, p_unit_ids => array[v_u2]);
  rep := rep || pg_temp.r('W3 списание из квартиры: в квартире 0', (select coalesce(qty,0) from stock_balance where loc_id = v_apt_loc and item_id = v_item) = 0);
  select count(*) into v_cnt from item_units where id = v_u2 and location_id = v_sink and status = 'written_off';
  rep := rep || pg_temp.r('W3 единица в sink со статусом written_off', v_cnt = 1);
  select count(*) into v_cnt from unit_events where move_id = v_mv and event = 'writeoff_apartment' and to_loc = v_sink;
  rep := rep || pg_temp.r('W3 событие writeoff_apartment', v_cnt = 1);
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('W3 unit_balance_mismatch пуст', v_cnt = 0);

  -- =========================================================
  -- W4 списание со склада
  -- =========================================================
  v_mv := post_move(p_op => 'writeoff_warehouse', p_item => v_item, p_qty => 1, p_unit_ids => array[v_u3]);
  rep := rep || pg_temp.r('W4 списание со склада: склад -1', (select qty from stock_balance where loc_id = v_wh and item_id = v_item) = 2);
  select count(*) into v_cnt from item_units where id = v_u3 and location_id = v_sink and status = 'written_off';
  rep := rep || pg_temp.r('W4 единица в sink written_off', v_cnt = 1);
  select count(*) into v_cnt from unit_events where move_id = v_mv and event = 'writeoff_warehouse';
  rep := rep || pg_temp.r('W4 событие writeoff_warehouse', v_cnt = 1);
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('W4 unit_balance_mismatch пуст', v_cnt = 0);

  -- =========================================================
  -- W5 цикл у сотрудника
  -- =========================================================
  v_mv := post_move(p_op => 'issue_holder', p_item => v_item, p_qty => 1, p_staff => v_staff, p_unit_ids => array[v_u4]);
  rep := rep || pg_temp.r('W5 выдача сотруднику: склад -1', (select qty from stock_balance where loc_id = v_wh and item_id = v_item) = 1);
  select count(*) into v_cnt from item_units where id = v_u4 and location_id = v_h_loc and status = 'issued';
  rep := rep || pg_temp.r('W5 единица у сотрудника issued', v_cnt = 1);

  v_mv := post_move(p_op => 'return_holder', p_item => v_item, p_qty => 1, p_staff => v_staff, p_unit_ids => array[v_u4]);
  rep := rep || pg_temp.r('W5 возврат от сотрудника: склад +1', (select qty from stock_balance where loc_id = v_wh and item_id = v_item) = 2);
  select count(*) into v_cnt from item_units where id = v_u4 and location_id = v_wh and status = 'in_stock';
  rep := rep || pg_temp.r('W5 единица на складе in_stock', v_cnt = 1);
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('W5 unit_balance_mismatch пуст', v_cnt = 0);

  -- =========================================================
  -- W6 owner: выдача с owner-полки в owner-квартиру, возврат
  -- =========================================================
  perform post_move(p_op => 'receipt', p_item => v_item, p_qty => 2, p_unit_cost => 7, p_owner_apartment => v_own, p_serials => array['ZZM-O1','ZZM-O2']);
  select id into v_u5 from item_units where code = 'ZZM-O1';
  select id into v_u6 from item_units where code = 'ZZM-O2';

  v_mv := post_move(p_op => 'issue_apartment', p_item => v_item, p_qty => 1, p_apartment => v_own, p_unit_ids => array[v_u5]);
  rep := rep || pg_temp.r('W6 owner выдача: полка -1', (select coalesce(qty,0) from stock_balance where loc_id = v_own_loc and item_id = v_item) = 1);
  rep := rep || pg_temp.r('W6 owner выдача: в квартире +1', (select coalesce(qty,0) from stock_balance where loc_id = _loc_apartment(v_own) and item_id = v_item) = 1);
  select count(*) into v_cnt from item_units where id = v_u5 and location_id = _loc_apartment(v_own) and status = 'issued' and owner_apartment_id = v_own;
  rep := rep || pg_temp.r('W6 owner_apartment_id сохраняется', v_cnt = 1);

  v_mv := post_move(p_op => 'return_apartment', p_item => v_item, p_qty => 1, p_apartment => v_own, p_unit_ids => array[v_u5]);
  select count(*) into v_cnt from item_units where id = v_u5 and location_id = v_own_loc and status = 'in_stock' and owner_apartment_id = v_own;
  rep := rep || pg_temp.r('W6 возврат на полку: in_stock, owner_apartment_id сохранён', v_cnt = 1);
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('W6 unit_balance_mismatch пуст', v_cnt = 0);

  -- =========================================================
  -- W7 отказы без изменений данных
  -- =========================================================
  -- чужой товар: единица v_item, но указываем v_other как товар
  v_msg := '';
  begin perform post_move(p_op => 'issue_apartment', p_item => v_other, p_qty => 1, p_apartment => v_apt, p_unit_ids => array[v_u1]);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('W7a чужой товар отклонён (единица v_item, товар v_other)', v_msg <> '');

  -- чужой товар: даём ID единицы другого товара
  select id into v_u7 from item_units where code = 'ZZM-O1' and item_id = v_item limit 1;
  v_msg := '';
  begin
    -- v_u7 - единица v_item на owner-полке, пробуем выдать как обычный товар со склада
    perform post_move(p_op => 'issue_apartment', p_item => v_item, p_qty => 1, p_apartment => v_apt, p_unit_ids => array[v_u7]);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('W7b не та локация (единица на owner-полке, исходный склад) отклонён', v_msg <> '');

  -- не тот статус: пытаемся выдать единицу со статусом issued со склада
  -- v_u1 сейчас на складе in_stock - попробуем "вернуть" её от сотрудника (не та локация)
  v_msg := '';
  begin perform post_move(p_op => 'return_holder', p_item => v_item, p_qty => 1, p_staff => v_staff, p_unit_ids => array[v_u1]);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('W7c не тот статус/локация (возврат от сотрудника единицы со склада) отклонён', v_msg <> '');

  -- повтор ID
  v_msg := '';
  begin perform post_move(p_op => 'issue_apartment', p_item => v_item, p_qty => 2, p_apartment => v_apt, p_unit_ids => array[v_u1, v_u1]);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('W7d повтор ID отклонён', v_msg like '%Повтор ID%');

  -- число не совпадает
  v_msg := '';
  begin perform post_move(p_op => 'issue_apartment', p_item => v_item, p_qty => 2, p_apartment => v_apt, p_unit_ids => array[v_u1]);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('W7e число единиц не совпадает с qty отклонено', v_msg like '%должно совпадать%');

  -- нет unit_ids у поштучного
  v_msg := '';
  begin perform post_move(p_op => 'issue_apartment', p_item => v_item, p_qty => 1, p_apartment => v_apt);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('W7f нет unit_ids у поштучного товара отклонено', v_msg like '%ID единиц обязательны%');

  -- unit_ids у обычного товара: получаем 2 шт, 1 выдаём, на складе остаётся 1
  perform post_move(p_op => 'receipt', p_item => v_plain, p_qty => 2, p_unit_cost => 1);
  perform post_move(p_op => 'issue_apartment', p_item => v_plain, p_qty => 1, p_apartment => v_apt);
  v_msg := '';
  begin perform post_move(p_op => 'writeoff_warehouse', p_item => v_plain, p_qty => 1, p_unit_ids => array[v_u1]);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('W7g unit_ids у обычного товара отклонено', v_msg like '%ID единиц указаны для товара без поштучного учёта%');

  -- проверка что данные не изменились после отказов
  select count(*) into v_cnt from item_units where id = v_u1 and location_id = v_wh and status = 'in_stock';
  rep := rep || pg_temp.r('W7h после отказов v_u1 осталась на складе', v_cnt = 1);
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('W7i unit_balance_mismatch пуст после отказов', v_cnt = 0);

  -- =========================================================
  -- W8 то же через post_document
  -- =========================================================
  -- выдача через документ
  v_doc := post_document(
    p_op => 'issue_apartment',
    p_lines => jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'unit_ids', jsonb_build_array(v_u1))),
    p_apartment => v_apt
  );
  v_doc_id := (v_doc->>'doc_id')::uuid;
  select count(*) into v_cnt from item_units where id = v_u1 and location_id = v_apt_loc and status = 'issued';
  rep := rep || pg_temp.r('W8a post_document выдача: единица в квартире issued', v_cnt = 1);
  select count(*) into v_cnt from unit_events where doc_id = v_doc_id and event = 'issue_apartment' and move_id is not null;
  rep := rep || pg_temp.r('W8b post_document: события с doc_id и move_id', v_cnt = 1);

  -- возврат через документ
  v_doc2 := post_document(
    p_op => 'return_apartment',
    p_lines => jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'unit_ids', jsonb_build_array(v_u1))),
    p_apartment => v_apt
  );
  select count(*) into v_cnt from item_units where id = v_u1 and location_id = v_wh and status = 'in_stock';
  rep := rep || pg_temp.r('W8c post_document возврат: единица на складе in_stock', v_cnt = 1);
  select count(*) into v_cnt from unit_events where doc_id = (v_doc2->>'doc_id')::uuid and event = 'return_apartment';
  rep := rep || pg_temp.r('W8d post_document: событие return_apartment с doc_id', v_cnt = 1);
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('W8e unit_balance_mismatch пуст после post_document', v_cnt = 0);

  -- =========================================================
  -- W9 unit_balance_mismatch пуст после каждой операции (проверено в W1-W8)

  -- =========================================================
  -- W10 прямой _insert_move / insert в stock_moves для поштучного товара отклонён
  --      и после post_move current_setting('app.unit_move_ok') = 'off'
  -- =========================================================
  v_msg := '';
  begin perform _insert_move(v_item, v_wh, v_apt_loc, 1, null, 'manual', 'issue_apartment', v_apt, null, null, null, now(), null);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('W10a прямой _insert_move поштучного товара отклонён триггером', v_msg like '%Поштучный учёт%');

  v_msg := '';
  begin
    insert into stock_moves(item_id, from_loc, to_loc, qty, source_type, source_id)
      values (v_item, v_wh, v_apt_loc, 1, 'manual', 'issue_apartment');
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('W10b прямой insert в stock_moves поштучного товара отклонён', v_msg like '%Поштучный учёт%');

  -- после post_move настройка должна быть 'off'
  perform post_move(p_op => 'issue_apartment', p_item => v_item, p_qty => 1, p_apartment => v_apt, p_unit_ids => array[v_u1]);
  perform post_move(p_op => 'return_apartment', p_item => v_item, p_qty => 1, p_apartment => v_apt, p_unit_ids => array[v_u1]);
  select current_setting('app.unit_move_ok', true) into v_set_val;
  rep := rep || pg_temp.r('W10c после post_move app.unit_move_ok = off', v_set_val = 'off');

  -- =========================================================
  -- W11 void документа с поштучным товаром отклонён
  -- =========================================================
  -- Создаём отдельный документ: выдача единицы, которая остаётся в квартире
  perform post_move(p_op => 'issue_apartment', p_item => v_item, p_qty => 1, p_apartment => v_apt, p_unit_ids => array[v_u1]);
  perform post_move(p_op => 'return_apartment', p_item => v_item, p_qty => 1, p_apartment => v_apt, p_unit_ids => array[v_u1]);
  v_doc := post_document(
    p_op => 'issue_apartment',
    p_lines => jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'unit_ids', jsonb_build_array(v_u1))),
    p_apartment => v_apt
  );
  v_msg := '';
  begin perform void_document((v_doc->>'doc_id')::uuid, 'тест');
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('W11 void документа с поштучным товаром отклонён текстом «Поштучный учёт»', v_msg like '%Поштучный учёт%');

  -- =========================================================
  -- W12 обычный товар работает как раньше
  -- =========================================================
  -- W12 обычный товар: дополнительно получаем 3, выдаём 1, списываем 1
  -- (в W7g уже получено 2 и выдано 1: на складе 1, в квартире 1)
  perform post_move(p_op => 'receipt', p_item => v_plain, p_qty => 3, p_unit_cost => 2);
  perform post_move(p_op => 'issue_apartment', p_item => v_plain, p_qty => 1, p_apartment => v_apt);
  perform post_move(p_op => 'writeoff_warehouse', p_item => v_plain, p_qty => 1);
  rep := rep || pg_temp.r('W12 обычный товар: склад 2', (select qty from stock_balance where loc_id = v_wh and item_id = v_plain) = 2);
  rep := rep || pg_temp.r('W12 обычный товар: в квартире 2', (select coalesce(qty,0) from stock_balance where loc_id = v_apt_loc and item_id = v_plain) = 2);
  select count(*) into v_cnt from item_units where item_id = v_plain;
  rep := rep || pg_temp.r('W12 обычный товар: единицы не создаются', v_cnt = 0);
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_plain;
  rep := rep || pg_temp.r('W12 обычный товар: unit_balance_mismatch пуст', v_cnt = 0);

  -- =========================================================
  -- W13 не-админ отклонён
  -- =========================================================
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  execute 'set local role authenticated';
  v_rej := false;
  begin perform post_move(p_op => 'issue_apartment', p_item => v_item, p_qty => 1, p_apartment => v_apt, p_unit_ids => array[v_u1]);
  exception when sqlstate '42501' then v_rej := true; end;
  rep := rep || pg_temp.r('W13a не-админ: post_move отказ 42501', v_rej);

  v_rej := false;
  begin perform post_document(p_op => 'issue_apartment', p_lines => jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1, 'unit_ids', jsonb_build_array(v_u1))), p_apartment => v_apt);
  exception when sqlstate '42501' then v_rej := true; end;
  rep := rep || pg_temp.r('W13b не-админ: post_document отказ 42501', v_rej);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  raise exception using message = E'ОТЧЁТ\n' || rep;
end $$;
