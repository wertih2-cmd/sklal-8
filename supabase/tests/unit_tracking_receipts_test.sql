-- Проверка поштучного прихода и включения учёта (миграция 1b1b2). Запускать в Supabase SQL Editor на ТЕСТОВОЙ БД.
-- Скрипт сам откатывает все данные: в конце намеренно падает с ошибкой "ОТЧЁТ", в тексте — результаты.
create or replace function pg_temp.r(n text, c boolean) returns text language sql as
$$ select case when coalesce(c, false) then 'OK    ' else 'FAIL  ' end || n || E'\n' $$;

do $$
declare
  v_admin uuid; rep text := ''; v_rej boolean := false; v_msg text := ''; v_cnt int; v_cnt2 int; v_bal numeric;
  v_bld int; v_apt int; v_own int; v_cat int; v_cons_cat int; v_nonasset item_kind;
  v_item int; v_plain int; v_it6 int; v_it7 int; v_it8 int; v_cons int;
  v_wh int; v_own_loc int; v_apt_loc int; v_mv bigint; v_mv2 bigint; v_mv3 bigint; v_mv11 bigint;
  v_doc jsonb; v_res jsonb; v_codes text[]; v_before int; v_bal_before numeric; v_staff int;
  v_u uuid; v_unit_row record; v_loc int;
begin
  select id into v_admin from profiles where role = 'admin' and active limit 1;
  if v_admin is null then
    v_admin := gen_random_uuid();
    insert into auth.users(id, email) values (v_admin, 'zz-test-admin@example.invalid');
    insert into profiles(id, login, full_name, role) values (v_admin, 'zz-test-admin', 'ZZ Test Admin', 'admin');
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  insert into buildings(name) values ('ZZS') returning id into v_bld;
  insert into apartments(building_id, number, code, type) values (v_bld, '1', 'ZZS/1', 'studio') returning id into v_apt;
  insert into apartments(building_id, number, code, type, is_owner) values (v_bld, '2', 'ZZS/2', 'studio', true) returning id into v_own;
  insert into categories(name, kind) values ('ZZ S актив', 'asset') returning id into v_cat;
  select e into v_nonasset from unnest(enum_range(null::item_kind)) e where e <> 'asset'::item_kind limit 1;
  insert into categories(name, kind) values ('ZZ S расходник', v_nonasset) returning id into v_cons_cat;
  v_wh := _loc_singleton('warehouse');
  v_apt_loc := _loc_apartment(v_apt);
  v_own_loc := _loc_owner_stock(v_own);

  -- Товар с поштучным учётом (включён через разрешающую настройку)
  perform set_config('app.unit_tracking_enable', 'on', true);
  insert into items(category_id, name, track_units) values (v_cat, 'ZZ S поштучный', true) returning id into v_item;
  perform set_config('app.unit_tracking_enable', 'off', true);

  -- V1 приход 2 шт с кодами
  v_mv := post_move(p_op => 'receipt', p_item => v_item, p_qty => 2, p_unit_cost => 10, p_serials => array['ZZS-1', 'ZZS-2']);
  select count(*) into v_cnt from item_units
    where code in ('ZZS-1', 'ZZS-2') and item_id = v_item and location_id = v_wh and status = 'in_stock' and unit_cost = 10;
  select count(*) into v_cnt2 from unit_events e join item_units u on u.id = e.unit_id
    where e.move_id = v_mv and e.event = 'receipt' and u.code in ('ZZS-1', 'ZZS-2');
  rep := rep || pg_temp.r('V1 приход 2 шт с кодами: 2 единицы на складе компании с ценой 10', v_cnt = 2);
  rep := rep || pg_temp.r('V1 приход 2 шт с кодами: по событию receipt с move_id на каждую', v_cnt2 = 2);

  -- V2 приход без кодов: уникальные автокоды
  v_mv2 := post_move(p_op => 'receipt', p_item => v_item, p_qty => 2, p_unit_cost => 10);
  select array_agg(u.code) into v_codes from unit_events e join item_units u on u.id = e.unit_id where e.move_id = v_mv2;
  rep := rep || pg_temp.r('V2 приход без кодов создаёт 2 единицы', cardinality(v_codes) = 2);
  rep := rep || pg_temp.r('V2 автокоды уникальны и имеют вид U-<товар>-<номер>',
    (select count(distinct c) from unnest(v_codes) c) = 2
    and (select bool_and(c like 'U-' || v_item || '-%') from unnest(v_codes) c));

  -- V3 приход на полку owner ставит owner_apartment_id
  v_mv3 := post_move(p_op => 'receipt', p_item => v_item, p_qty => 1, p_unit_cost => 7, p_owner_apartment => v_own);
  select count(*) into v_cnt from unit_events e join item_units u on u.id = e.unit_id
    where e.move_id = v_mv3 and u.owner_apartment_id = v_own and u.location_id = v_own_loc and u.status = 'in_stock';
  rep := rep || pg_temp.r('V3 приход на owner-полку: owner_apartment_id и локация полки', v_cnt = 1);

  -- V4 неверные коды отклоняются, ничего не создаётся
  select count(*) into v_before from item_units where item_id = v_item;
  select qty into v_bal_before from stock_balance where loc_id = v_wh and item_id = v_item;
  v_msg := '';
  begin perform post_move(p_op => 'receipt', p_item => v_item, p_qty => 2, p_unit_cost => 10, p_serials => array['ZZS-X1']);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('V4a количество кодов не совпадает с количеством', v_msg like '%должно совпадать%');
  v_msg := '';
  begin perform post_move(p_op => 'receipt', p_item => v_item, p_qty => 1.5, p_unit_cost => 10);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('V4b нецелое количество отклонено', v_msg like '%должно быть целым%');
  v_msg := '';
  begin perform post_move(p_op => 'receipt', p_item => v_item, p_qty => 2, p_unit_cost => 10, p_serials => array['ZZS-X2', 'ZZS-X2']);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('V4c повтор кода в одном приходе отклонён', v_msg like '%повторяется%');
  v_msg := '';
  begin perform post_move(p_op => 'receipt', p_item => v_item, p_qty => 2, p_unit_cost => 10, p_serials => array['ZZS-1', 'ZZS-9']);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('V4d существующий код отклонён текстом «Серийный код уже существует»', v_msg like '%Серийный код уже существует: ZZS-1%');
  v_msg := '';
  begin perform post_move(p_op => 'receipt', p_item => v_item, p_qty => 2, p_unit_cost => 10, p_serials => array['  ', 'ZZS-8']);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('V4e пустой код отклонён', v_msg like '%не может быть пустым%');
  select count(*) into v_cnt from item_units where item_id = v_item;
  rep := rep || pg_temp.r('V4f после отказов ни одна единица не создана', v_cnt = v_before);
  rep := rep || pg_temp.r('V4g остаток склада не изменился', (select qty from stock_balance where loc_id = v_wh and item_id = v_item) = v_bal_before);

  -- V5 приход через документ с кодами
  v_doc := post_document(p_op => 'receipt', p_lines => jsonb_build_array(
    jsonb_build_object('item_id', v_item, 'qty', 2, 'unit_cost', 10, 'serials', jsonb_build_array('ZZS-D1', 'ZZS-D2'))));
  select count(*) into v_cnt from unit_events e join item_units u on u.id = e.unit_id
    where e.doc_id = (v_doc->>'doc_id')::uuid and e.event = 'receipt' and u.code in ('ZZS-D1', 'ZZS-D2');
  rep := rep || pg_temp.r('V5 приход через документ с кодами: 2 единицы с doc_id документа', v_cnt = 2);

  -- V10 отмена прихода товара с поштучным учётом отклонена
  v_doc := post_document(p_op => 'receipt', p_lines => jsonb_build_array(
    jsonb_build_object('item_id', v_item, 'qty', 1, 'unit_cost', 5)));
  v_msg := '';
  begin perform void_document((v_doc->>'doc_id')::uuid, 'тест');
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('V10 отмена прихода поштучного товара отклонена текстом «Поштучный учёт»', v_msg like '%Поштучный учёт%');

  -- Товар без поштучного учёта
  insert into items(category_id, name) values (v_cat, 'ZZ S обычный') returning id into v_plain;

  -- V11 приход и выдача товара без поштучного учёта работают как раньше
  v_mv11 := post_move(p_op => 'receipt', p_item => v_plain, p_qty => 2, p_unit_cost => 4);
  perform post_move(p_op => 'issue_apartment', p_item => v_plain, p_qty => 1, p_apartment => v_apt);
  select qty into v_bal from stock_balance where loc_id = v_wh and item_id = v_plain;
  rep := rep || pg_temp.r('V11 приход 2 шт и выдача 1 шт товара без учёта: на складе 1', v_bal = 1);
  select count(*) into v_cnt from stock_balance where loc_id = v_apt_loc and item_id = v_plain and qty = 1;
  rep := rep || pg_temp.r('V11 выданная шт. учтена в квартире', v_cnt = 1);
  select count(*) into v_cnt from item_units where item_id = v_plain;
  rep := rep || pg_temp.r('V11 для товара без учёта единицы не создаются', v_cnt = 0);
  v_msg := '';
  begin perform post_move(p_op => 'receipt', p_item => v_plain, p_qty => 1, p_unit_cost => 4, p_serials => array['ZZS-P1']);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('V11 коды для товара без учёта отклонены', v_msg like '%Коды указаны для товара без поштучного учёта%');

  -- V6 включение учёта на имуществе с остатком 3 на складе
  insert into items(category_id, name) values (v_cat, 'ZZ S включить') returning id into v_it6;
  perform post_move(p_op => 'receipt', p_item => v_it6, p_qty => 3, p_unit_cost => 6);
  v_res := enable_unit_tracking(v_it6);
  rep := rep || pg_temp.r('V6 включение создаёт 3 единицы (units_created = 3)', (v_res->>'units_created')::int = 3);
  select count(*) into v_cnt from item_units where item_id = v_it6 and location_id = v_wh and status = 'in_stock' and unit_cost = 6;
  rep := rep || pg_temp.r('V6 три единицы in_stock на складе с ценой 6', v_cnt = 3);
  rep := rep || pg_temp.r('V6 учёт включён (track_units = true)', (select track_units from items where id = v_it6));
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_it6;
  rep := rep || pg_temp.r('V6 расхождений по товару нет', v_cnt = 0);

  -- V7 отказы включения
  insert into items(category_id, name) values (v_cat, 'ZZ S дробный') returning id into v_it7;
  perform post_move(p_op => 'receipt', p_item => v_it7, p_qty => 1.5, p_unit_cost => 6);
  v_msg := '';
  begin perform enable_unit_tracking(v_it7);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('V7a нецелый остаток отклоняет включение', v_msg like '%нецелый%');

  insert into items(category_id, name) values (v_cons_cat, 'ZZ S расходник') returning id into v_cons;
  perform post_move(p_op => 'receipt', p_item => v_cons, p_qty => 2, p_unit_cost => 1);
  v_msg := '';
  begin perform enable_unit_tracking(v_cons);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('V7b расходник: «Поштучный учёт только для имущества»', v_msg like '%Поштучный учёт только для имущества%');

  v_msg := '';
  begin perform enable_unit_tracking(v_it6);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('V7c повторное включение отклонено', v_msg like '%уже включён%');

  -- V8 единица в квартире получает статус issued
  insert into items(category_id, name) values (v_cat, 'ZZ S в квартире') returning id into v_it8;
  perform post_move(p_op => 'receipt', p_item => v_it8, p_qty => 1, p_unit_cost => 9);
  perform post_move(p_op => 'issue_apartment', p_item => v_it8, p_qty => 1, p_apartment => v_apt);
  v_res := enable_unit_tracking(v_it8);
  select count(*) into v_cnt from item_units
    where item_id = v_it8 and location_id = v_apt_loc and status = 'issued';
  rep := rep || pg_temp.r('V8 единица в квартире создана со статусом issued', v_cnt = 1);
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_it8;
  rep := rep || pg_temp.r('V8 расхождений по товару нет', v_cnt = 0);

  -- V9 не-админ и анонимный доступ
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  execute 'set local role authenticated';
  v_rej := false;
  begin perform enable_unit_tracking(v_it6);
  exception when sqlstate '42501' then v_rej := true; end;
  rep := rep || pg_temp.r('V9a не-админ: enable_unit_tracking отказ 42501', v_rej);
  v_rej := false;
  begin perform post_move(p_op => 'receipt', p_item => v_item, p_qty => 1, p_unit_cost => 10, p_serials => array['ZZS-N1']);
  exception when sqlstate '42501' then v_rej := true; end;
  execute 'reset role';
  rep := rep || pg_temp.r('V9b не-админ: post_move с кодами отказ 42501', v_rej);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE')) into v_rej
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('enable_unit_tracking', 'post_move', 'post_document');
  rep := rep || pg_temp.r('V9c anon не имеет EXECUTE на enable_unit_tracking, post_move, post_document', coalesce(v_rej, false));

  -- Регрессия триггеров: квартира и сотрудник получают локации
  insert into apartments(building_id, number, code, type) values (v_bld, '3', 'ZZS/3', 'studio') returning id into v_loc;
  rep := rep || pg_temp.r('T1 новая квартира получает локацию', _loc_apartment(v_loc) is not null);
  insert into staff(full_name) values ('ZZ сотрудник') returning id into v_staff;
  rep := rep || pg_temp.r('T2 новый сотрудник получает локацию', _loc_holder(v_staff) is not null);

  -- Регрессия триггеров: аудит товара
  update items set name = 'ZZ S обычный 2' where id = v_plain;
  select count(*) into v_cnt from audit_log where table_name = 'items' and row_id = v_plain::text;
  rep := rep || pg_temp.r('T3 изменение товара записано в журнал аудита', v_cnt > 0);

  -- Регрессия триггеров: журнал движений неизменяем
  v_msg := '';
  begin update stock_moves set qty = qty where id = v_mv11;
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T4 update в stock_moves отклонён', v_msg <> '');
  v_msg := '';
  begin delete from stock_moves where id = v_mv11;
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T5 delete в stock_moves отклонён', v_msg <> '');

  raise exception using message = E'ОТЧЁТ\n' || rep;
end $$;
