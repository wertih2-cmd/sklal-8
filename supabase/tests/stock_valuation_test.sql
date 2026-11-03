-- Проверка stock_valuation RPC.
-- Скрипт сам откатывает все данные: в конце намеренно падает с ошибкой "ОТЧЁТ", в тексте — результаты.
create or replace function pg_temp.r(n text, c boolean) returns text language sql as
$$ select case when coalesce(c, false) then 'OK    ' else 'FAIL  ' end || n || E'\n' $$;

do $$
declare
  v_admin uuid; rep text := ''; t text; j jsonb;
  v_bld int; v_O int; v_R int; v_ca int; v_A int; v_B int;
  l_wh int; l_os int;
  v_elem jsonb; v_keys text[];
  v_active_company int; v_active_owner int;
begin
  select id into v_admin from profiles where role = 'admin' and active limit 1;
  if v_admin is null then
    v_admin := gen_random_uuid();
    insert into auth.users(id, email) values (v_admin, 'zz-sv-admin@example.invalid');
    insert into profiles(id, login, full_name, role) values (v_admin, 'zz-sv-admin', 'ZZ SV Admin', 'admin');
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- данные (под postgres — _loc_singleton, post_move, transfer_company_owner требуют привилегий)
  insert into buildings(name) values ('ZZSV') returning id into v_bld;
  insert into apartments(building_id, number, code, type) values (v_bld, '1', 'ZZSV/1', 'studio') returning id into v_O;
  insert into apartments(building_id, number, code, type) values (v_bld, '2', 'ZZSV/2', 'studio') returning id into v_R;
  update apartments set is_owner = true where id = v_O;
  insert into categories(name, kind) values ('ZZ SV актив', 'asset') returning id into v_ca;
  insert into items(category_id, name) values (v_ca, 'ZZ SV-A') returning id into v_A;
  insert into items(category_id, name) values (v_ca, 'ZZ SV-B') returning id into v_B;

  l_wh := _loc_singleton('warehouse');
  l_os := _loc_owner_stock(v_O);

  perform post_move(p_op => 'receipt', p_item => v_A, p_qty => 5, p_unit_cost => 100);
  perform post_move(p_op => 'receipt', p_item => v_B, p_qty => 2, p_unit_cost => 50);
  insert into item_prices(item_id, guest_price) values (v_A, 200) on conflict do nothing;
  insert into item_prices(item_id, guest_price) values (v_B, 75) on conflict do nothing;

  perform transfer_company_owner('to_owner', v_O, jsonb_build_array(
    jsonb_build_object('item_id', v_A, 'qty', 2)
  ), 'ZZSV test transfer');

  -- контрольные суммы под postgres (warehouse_valuation доступен postgres'у)
  select count(*) into v_active_company from warehouse_valuation where scope = 'company';
  select count(*) into v_active_owner from warehouse_valuation where scope = 'owner';

  -- переходим под authenticated для проверок RPC
  execute 'set local role authenticated';

  -- S1: admin вызывает stock_valuation('company') без ошибки, массив
  t := null;
  begin
    j := stock_valuation('company');
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('S1 нет ошибки company', t is null);
  rep := rep || pg_temp.r('S1 jsonb array', t is null and jsonb_typeof(j) = 'array');
  rep := rep || pg_temp.r('S1 число элементов = активные товары company',
    t is null and jsonb_array_length(j) = v_active_company);

  -- S2: stock_valuation('owner')
  t := null;
  begin
    j := stock_valuation('owner');
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('S2 нет ошибки owner', t is null);
  rep := rep || pg_temp.r('S2 jsonb array', t is null and jsonb_typeof(j) = 'array');
  rep := rep || pg_temp.r('S2 число элементов > 0', t is null and jsonb_array_length(j) > 0);

  -- S3: в элементе есть нужные ключи
  t := null;
  begin
    select into v_elem e from jsonb_array_elements(stock_valuation('company')) e limit 1;
  exception when others then t := sqlerrm; end;
  if t is null then
    v_keys := array_remove(ARRAY[
      (v_elem ? 'scope')::text,
      (v_elem ? 'item_id')::text,
      (v_elem ? 'on_hand')::text,
      (v_elem ? 'avg_cost')::text,
      (v_elem ? 'guest_price')::text,
      (v_elem ? 'stock_value')::text,
      (v_elem ? 'potential_revenue')::text,
      (v_elem ? 'markup_pct')::text,
      (v_elem ? 'margin_pct')::text
    ], 'true');
    rep := rep || pg_temp.r('S3 есть все ключи', array_length(v_keys, 1) is null or array_length(v_keys, 1) = 0);
  else
    rep := rep || pg_temp.r('S3 есть все ключи', false);
  end if;

  -- S4: фильтр p_owner_apartment возвращает только эту квартиру
  t := null;
  begin
    j := stock_valuation('owner', v_O);
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('S4 фильтр по квартире: все элементы имеют owner_apartment_id = v_O',
    t is null and (select count(*) from jsonb_array_elements(j) e where (e->>'owner_apartment_id')::int = v_O) = jsonb_array_length(j));
  rep := rep || pg_temp.r('S4 фильтр по квартире: содержит наш товар A',
    t is null and (select count(*) > 0 from jsonb_array_elements(j) e where (e->>'item_id')::int = v_A));

  -- S5: неверный scope отклонён
  t := null;
  begin
    perform stock_valuation('invalid');
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('S5 неверный scope отклонён', t is not null and t like '%Неверная область%');

  -- S6: не-админ отклонён
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-000000000000', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  t := null;
  begin
    perform stock_valuation('company');
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('S6 не-админ отклонён', t is not null and t like '%Только администратор%');
  -- возвращаем admin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- S7: anon не имеет EXECUTE, authenticated имеет
  rep := rep || pg_temp.r('S7 anon не имеет EXECUTE',
    not has_function_privilege('anon', 'public.stock_valuation(text,int)', 'EXECUTE'));
  rep := rep || pg_temp.r('S7 authenticated имеет EXECUTE',
    has_function_privilege('authenticated', 'public.stock_valuation(text,int)', 'EXECUTE'));

  -- S8: avg_cost и owner_avg_cost по-прежнему НЕ выполняются authenticated
  rep := rep || pg_temp.r('S8 avg_cost не выполняется authenticated',
    not has_function_privilege('authenticated', 'public.avg_cost(integer)', 'EXECUTE'));
  rep := rep || pg_temp.r('S8 owner_avg_cost не выполняется authenticated',
    not has_function_privilege('authenticated', 'public.owner_avg_cost(integer,integer)', 'EXECUTE'));

  raise exception E'ОТЧЁТ (данные откатаны):\n%', rep;
end $$;
