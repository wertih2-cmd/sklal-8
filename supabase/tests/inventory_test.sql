-- Этап 1a: инвентаризация (фиксация остатка на момент пересчёта, запрет закрытия без пересчёта,
-- исключение поштучных товаров, атомарное сохранение факта).
-- Запускать на ТЕСТОВОЙ БД. Скрипт сам откатывает данные: в конце падает с ошибкой "ОТЧЁТ".
-- Тест не требует отсутствия открытых инвентаризаций квартир: использует собственную квартиру.
create or replace function pg_temp.r(n text, c boolean) returns text language sql as
$$ select case when coalesce(c, false) then 'OK    ' else 'FAIL  ' end || n || E'\n' $$;

do $$
declare
  v_admin uuid; rep text := ''; v_bld int; v_apt int; v_cat int;
  v_A int; v_B int; v_T int; v_inv uuid; v_inv2 uuid; v_apt_loc int;
  v_msg text; j jsonb; v_cnt int; v_bal numeric; v_lines int;
  v_new_cols boolean; v_has_bulk boolean;
begin
  select id into v_admin from profiles where role = 'admin' and active limit 1;
  if v_admin is null then
    v_admin := gen_random_uuid();
    insert into auth.users(id, email) values (v_admin, 'zz-inv-admin@example.invalid');
    insert into profiles(id, login, full_name, role) values (v_admin, 'zz-inv-admin', 'ZZ INV Admin', 'admin');
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  insert into buildings(name) values ('ZZINV') returning id into v_bld;
  insert into apartments(building_id, number, code, type) values (v_bld, '1', 'ZZINV/1', 'studio') returning id into v_apt;
  insert into categories(name, kind) values ('ZZ INV актив', 'asset') returning id into v_cat;
  insert into items(category_id, name) values (v_cat, 'ZZ INV-A') returning id into v_A;
  insert into items(category_id, name) values (v_cat, 'ZZ INV-B') returning id into v_B;
  insert into items(category_id, name) values (v_cat, 'ZZ INV-T') returning id into v_T;
  v_apt_loc := _loc_apartment(v_apt);

  perform post_move(p_op => 'receipt', p_item => v_A, p_qty => 20, p_unit_cost => 10);
  perform post_move(p_op => 'receipt', p_item => v_B, p_qty => 20, p_unit_cost => 10);
  perform post_move(p_op => 'receipt', p_item => v_T, p_qty => 20, p_unit_cost => 10);
  perform post_move(p_op => 'issue_apartment', p_item => v_A, p_qty => 10, p_apartment => v_apt);
  perform post_move(p_op => 'issue_apartment', p_item => v_B, p_qty => 10, p_apartment => v_apt);
  perform post_move(p_op => 'issue_apartment', p_item => v_T, p_qty => 10, p_apartment => v_apt);
  -- товар T становится поштучным (как это делает отдельная процедура включения)
  perform set_config('app.unit_tracking_enable', 'on', true);
  update items set track_units = true where id = v_T;
  perform set_config('app.unit_tracking_enable', 'off', true);

  select exists (select 1 from information_schema.columns where table_name = 'inventory_lines' and column_name = 'counted') into v_new_cols;
  select exists (select 1 from pg_proc where proname = 'inventory_set_actual_bulk') into v_has_bulk;
  rep := rep || pg_temp.r('S0 колонка counted и функция inventory_set_actual_bulk есть (иначе миграция не применена)', v_new_cols and v_has_bulk);
  if not (v_new_cols and v_has_bulk) then
    raise exception E'ОТЧЁТ (миграция inventory-fix.sql не применена):\n%', rep;
  end if;

  -- T1: старт квартирной инвентаризации исключает поштучный товар
  v_inv := inventory_start('apartment', v_apt, 'ZZ INV');
  select count(*) into v_cnt from inventory_lines where inventory_id = v_inv and item_id = v_T;
  rep := rep || pg_temp.r('T1 поштучный товар не попал в инвентаризацию', v_cnt = 0);
  select count(*) into v_lines from inventory_lines where inventory_id = v_inv and item_id in (v_A, v_B);
  rep := rep || pg_temp.r('T1 обычные товары попали (2 строки)', v_lines = 2);
  select count(*) into v_cnt from inventory_lines where inventory_id = v_inv and counted;
  rep := rep || pg_temp.r('T1 после старта ни одна строка не помечена пересчитанной', v_cnt = 0);

  -- T2: закрытие без пересчёта даёт ошибку и ничего не пишет
  v_msg := '';
  begin perform inventory_close(v_inv, '{}');
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T2 закрытие без пересчёта: ошибка (' || v_msg || ')', v_msg like 'Не пересчитан%');
  rep := rep || pg_temp.r('T2 инвентаризация осталась открытой, движений нет',
    (select status = 'open' from inventories where id = v_inv)
    and not exists (select 1 from stock_moves where source_type = 'inventory_adjust' and source_id = v_inv::text));

  -- T3: поштучный товар нельзя записать вручную
  v_msg := '';
  begin perform inventory_set_actual(v_inv, v_T, 5);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T3 факт по поштучному товару отклонён', v_msg <> '');

  -- T4: пересчитали A=10 при остатке 10, потом выдали 3 -> закрытие НЕ создаёт излишек/недостачу
  perform inventory_set_actual(v_inv, v_A, 10);
  perform inventory_set_actual(v_inv, v_B, 10);
  perform post_move(p_op => 'issue_apartment', p_item => v_A, p_qty => 3, p_apartment => v_apt);
  select qty into v_bal from stock_balance where loc_id = v_apt_loc and item_id = v_A;
  rep := rep || pg_temp.r('T4 остаток A после выдачи = 13 (10 + 3)', v_bal = 13);
  j := inventory_close(v_inv, '{}');
  rep := rep || pg_temp.r('T4 закрытие без корректировок (adjusted = 0): ' || j::text, (j->>'adjusted')::int = 0);
  select qty into v_bal from stock_balance where loc_id = v_apt_loc and item_id = v_A;
  rep := rep || pg_temp.r('T4 остаток A после закрытия остался 13', v_bal = 13);

  -- T5: настоящая недостача: B пересчитан как 7 при остатке 10 -> списание 3
  v_inv2 := inventory_start('apartment', v_apt, 'ZZ INV 2');
  perform inventory_set_actual(v_inv2, v_A, 13);
  perform inventory_set_actual(v_inv2, v_B, 7);
  j := inventory_close(v_inv2, '{}');
  select qty into v_bal from stock_balance where loc_id = v_apt_loc and item_id = v_B;
  rep := rep || pg_temp.r('T5 недостача B = 3, остаток B = 7: ' || j::text, (j->>'adjusted')::int = 1 and v_bal = 7);

  -- T6: атомарность bulk: вторая позиция некорректна -> первая не сохранена
  v_inv := inventory_start('apartment', v_apt, 'ZZ INV 3');
  v_msg := '';
  begin
    perform inventory_set_actual_bulk(v_inv, jsonb_build_array(
      jsonb_build_object('item_id', v_A, 'actual', 99),
      jsonb_build_object('item_id', v_B, 'actual', -1)));
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T6 bulk с отрицательным фактом отклонён: ' || v_msg, v_msg <> '');
  rep := rep || pg_temp.r('T6 частичной записи нет (A не пересчитан)',
    not exists (select 1 from inventory_lines where inventory_id = v_inv and item_id = v_A and counted));
  v_msg := '';
  begin perform inventory_set_actual_bulk(v_inv, '{"item_id":1}'::jsonb);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T6 bulk не массив отклонён', v_msg <> '');
  v_msg := '';
  begin perform inventory_set_actual_bulk(v_inv, jsonb_build_array(jsonb_build_object('item_id', v_T, 'actual', 1)));
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T6 bulk с поштучным товаром отклонён', v_msg <> '');

  -- T7: пропуск позиции («Не применять») допускает закрытие без пересчёта этой позиции
  perform inventory_set_actual(v_inv, v_A, 13);
  j := inventory_close(v_inv, array[v_B]);
  rep := rep || pg_temp.r('T7 закрытие с пропуском непросчитанной B: ' || j::text,
    (select decision = 'rejected' from inventory_lines where inventory_id = v_inv and item_id = v_B));

  -- T8: старая открытая инвентаризация со строкой поштучного товара: строка пропускается, не падает
  v_inv := inventory_start('apartment', v_apt, 'ZZ INV 4');
  insert into inventory_lines(inventory_id, item_id, expected, actual, counted, counted_at, system_qty_at_count)
  values (v_inv, v_T, 10, 2, true, now(), 10);
  perform inventory_set_actual(v_inv, v_A, 13);
  perform inventory_set_actual(v_inv, v_B, 7);
  v_msg := '';
  begin j := inventory_close(v_inv, '{}');
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T8 закрытие со строкой поштучного товара без ошибки (' || v_msg || ')', v_msg = '');
  rep := rep || pg_temp.r('T8 строка T помечена rejected, движения по T нет',
    (select decision = 'rejected' from inventory_lines where inventory_id = v_inv and item_id = v_T)
    and not exists (select 1 from stock_moves where item_id = v_T and source_type = 'inventory_adjust'));

  -- T9: права: anon вызывать bulk не может, authenticated может
  rep := rep || pg_temp.r('T9 anon не имеет EXECUTE на bulk',
    not has_function_privilege('anon', 'inventory_set_actual_bulk(uuid,jsonb)', 'EXECUTE'));
  rep := rep || pg_temp.r('T9 authenticated имеет EXECUTE на bulk',
    has_function_privilege('authenticated', 'inventory_set_actual_bulk(uuid,jsonb)', 'EXECUTE'));

  raise exception E'ОТЧЁТ (данные откатаны):\n%', rep;
end $$;
