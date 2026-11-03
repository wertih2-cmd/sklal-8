-- Проверка item_cost_corrections и модифицированных avg_cost/owner_avg_cost.
-- Скрипт сам откатывает все данные: в конце падает с ошибкой "ОТЧЁТ".
create or replace function pg_temp.r(n text, c boolean) returns text language sql as
$$ select case when coalesce(c, false) then 'OK    ' else 'FAIL  ' end || n || E'\n' $$;

do $$
declare
  v_admin uuid; rep text := ''; t text; j jsonb;
  v_bld int; v_O1 int; v_O2 int; v_R int;
  v_ca int; v_cc int; v_A int; v_B int; v_C int; v_D int; v_E int; v_F int;
  l_wh int; l_os1 int; l_os2 int; l_R int;
  v_moves_before int; v_on_hand_before numeric;
  v_avg_company numeric;
  v_corr_count int;
  v_issue_cost numeric;
begin
  select id into v_admin from profiles where role = 'admin' and active limit 1;
  if v_admin is null then
    v_admin := gen_random_uuid();
    insert into auth.users(id, email) values (v_admin, 'zz-icc-admin@example.invalid');
    insert into profiles(id, login, full_name, role) values (v_admin, 'zz-icc-admin', 'ZZ ICC Admin', 'admin');
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- данные под postgres
  insert into buildings(name) values ('ZZICC') returning id into v_bld;
  insert into apartments(building_id, number, code, type) values (v_bld, '1', 'ZZICC/1', 'studio') returning id into v_O1;
  insert into apartments(building_id, number, code, type) values (v_bld, '2', 'ZZICC/2', 'studio') returning id into v_O2;
  insert into apartments(building_id, number, code, type) values (v_bld, '3', 'ZZICC/3', 'studio') returning id into v_R;
  update apartments set is_owner = true where id in (v_O1, v_O2);
  insert into categories(name, kind) values ('ZZ ICC актив', 'asset') returning id into v_ca;
  insert into categories(name, kind) values ('ZZ ICC расход', 'consumable') returning id into v_cc;
  insert into items(category_id, name) values (v_ca, 'ZZ ICC-A') returning id into v_A;
  insert into items(category_id, name) values (v_ca, 'ZZ ICC-B') returning id into v_B;
  insert into items(category_id, name) values (v_cc, 'ZZ ICC-C') returning id into v_C;
  insert into items(category_id, name) values (v_ca, 'ZZ ICC-D') returning id into v_D;
  insert into items(category_id, name) values (v_ca, 'ZZ ICC-E') returning id into v_E;
  insert into items(category_id, name) values (v_ca, 'ZZ ICC-F') returning id into v_F;
  insert into item_prices(item_id, guest_price) values (v_A, 200) on conflict do nothing;

  l_wh := _loc_singleton('warehouse');
  l_os1 := _loc_owner_stock(v_O1);
  l_os2 := _loc_owner_stock(v_O2);
  l_R := _loc_apartment(v_R);

  -- COMPANY setup
  perform post_move(p_op => 'receipt', p_item => v_A, p_qty => 10);                       -- 10 uncosted
  perform post_move(p_op => 'receipt', p_item => v_B, p_qty => 4, p_unit_cost => 50);      -- 4 priced
  perform post_move(p_op => 'receipt', p_item => v_B, p_qty => 6);                         -- 6 uncosted
  perform post_move(p_op => 'receipt', p_item => v_D, p_qty => 5, p_unit_cost => 30);      -- priced, no correction
  perform post_move(p_op => 'receipt', p_item => v_C, p_qty => 8, p_unit_cost => 10);      -- consumable priced

  -- OWNER setup: v_E — only uncosted receipts, so avg_cost null, transfer carries null unit_cost
  perform post_move(p_op => 'receipt', p_item => v_E, p_qty => 5);
  perform post_move(p_op => 'receipt', p_item => v_F, p_qty => 3);
  perform transfer_company_owner('to_owner', v_O1, jsonb_build_array(
    jsonb_build_object('item_id', v_E, 'qty', 2)
  ), 'ZZICC O1 transfer uncosted');

  select count(*) into v_moves_before from stock_moves where item_id = v_A;

  -- === ВСЕ проверки под authenticated ===
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- C1: avg_cost null без коррекции
  begin
    j := stock_valuation('company');
    rep := rep || pg_temp.r('C1 stock_valuation avg_cost null',
      (select (e->>'avg_cost') is null from jsonb_array_elements(j) e where (e->>'item_id')::int = v_A));
  exception when others then rep := rep || pg_temp.r('C1 stock_valuation avg_cost null', false);
  end;

  -- C2: set_item_cost(v_A, 100) → avg_cost = 100, stock_value = 1000
  j := set_item_cost(v_A, 100);
  rep := rep || pg_temp.r('C2 avg_cost_after = 100', (j->>'avg_cost_after')::numeric = 100);
  begin
    j := stock_valuation('company');
    rep := rep || pg_temp.r('C2 stock_value = 1000',
      (select (e->>'stock_value')::numeric = 1000 from jsonb_array_elements(j) e where (e->>'item_id')::int = v_A));
  exception when others then rep := rep || pg_temp.r('C2 stock_value = 1000', false);
  end;

  -- C3: set_item_cost(v_B, 100) → avg_cost = 80
  j := set_item_cost(v_B, 100);
  begin
    j := stock_valuation('company');
    rep := rep || pg_temp.r('C3 avg_cost = 80',
      (select (e->>'avg_cost')::numeric = 80 from jsonb_array_elements(j) e where (e->>'item_id')::int = v_B));
  exception when others then rep := rep || pg_temp.r('C3 avg_cost = 80', false);
  end;

  -- C4: повторная коррекция 120 → avg_cost = 92, обе строки
  select count(*) into v_corr_count from item_cost_corrections where item_id = v_B and owner_apartment_id is null;
  j := set_item_cost(v_B, 120);
  begin
    j := stock_valuation('company');
    rep := rep || pg_temp.r('C4 avg_cost = 92',
      (select (e->>'avg_cost')::numeric = 92 from jsonb_array_elements(j) e where (e->>'item_id')::int = v_B));
  exception when others then rep := rep || pg_temp.r('C4 avg_cost = 92', false);
  end;
  rep := rep || pg_temp.r('C4 обе строки в таблице',
    (select count(*) from item_cost_corrections where item_id = v_B and owner_apartment_id is null) = v_corr_count + 1);

  -- C5: update и delete отклонены (RLS/permissions блокируют до триггера)
  t := null;
  begin
    update item_cost_corrections set unit_cost = 999 where item_id = v_A;
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C5 update отклонён', t is not null);
  t := null;
  begin
    delete from item_cost_corrections where item_id = v_A;
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C5 delete отклонён', t is not null);

  -- C6: не-админ → 42501
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-000000000000', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  t := null;
  begin
    perform set_item_cost(v_A, 50);
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C6 не-админ отклонён', t is not null and t like '%Только администратор%');
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- C7: anon/authenticated EXECUTE
  rep := rep || pg_temp.r('C7 anon без EXECUTE set_item_cost',
    not has_function_privilege('anon', 'public.set_item_cost(integer,numeric,text,integer)', 'EXECUTE'));
  rep := rep || pg_temp.r('C7 authenticated с EXECUTE set_item_cost',
    has_function_privilege('authenticated', 'public.set_item_cost(integer,numeric,text,integer)', 'EXECUTE'));

  -- C8: authenticated без EXECUTE на avg_cost, owner_avg_cost, _insert_move
  rep := rep || pg_temp.r('C8 avg_cost без EXECUTE',
    not has_function_privilege('authenticated', 'public.avg_cost(integer)', 'EXECUTE'));
  rep := rep || pg_temp.r('C8 owner_avg_cost без EXECUTE',
    not has_function_privilege('authenticated', 'public.owner_avg_cost(integer,integer)', 'EXECUTE'));
  rep := rep || pg_temp.r('C8 _insert_move без EXECUTE',
    not has_function_privilege('authenticated',
      'public._insert_move(integer,integer,integer,numeric,numeric,text,text,integer,integer,uuid,text,timestamp with time zone,bigint)', 'EXECUTE'));

  -- C9: отрицательная и null цена
  t := null;
  begin
    perform set_item_cost(v_A, -1);
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C9 отрицательная цена отклонена', t is not null and t like '%отрицательн%');
  t := null;
  begin
    perform set_item_cost(v_A, null);
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C9 null цена отклонена', t is not null);

  -- C10: коррекция не меняет число движений и остаток
  begin
    j := stock_valuation('company');
    select coalesce((e->>'on_hand')::numeric, 0) into v_on_hand_before from jsonb_array_elements(j) e where (e->>'item_id')::int = v_A limit 1;
  exception when others then v_on_hand_before := 0;
  end;
  perform set_item_cost(v_A, 150);
  rep := rep || pg_temp.r('C10 число движений не изменилось',
    (select count(*) from stock_moves where item_id = v_A) = v_moves_before);
  begin
    j := stock_valuation('company');
    rep := rep || pg_temp.r('C10 on_hand не изменился',
      v_on_hand_before > 0 and (select (e->>'on_hand')::numeric from jsonb_array_elements(j) e where (e->>'item_id')::int = v_A limit 1) = v_on_hand_before);
  exception when others then rep := rep || pg_temp.r('C10 on_hand не изменился', false);
  end;

  -- C11: transfer to_owner берёт unit_cost = avg_cost (150 после коррекции)
  begin
    j := stock_valuation('company');
    select (e->>'avg_cost')::numeric into v_avg_company from jsonb_array_elements(j) e where (e->>'item_id')::int = v_A limit 1;
  exception when others then v_avg_company := null;
  end;
  perform transfer_company_owner('to_owner', v_O1, jsonb_build_array(
    jsonb_build_object('item_id', v_A, 'qty', 3)
  ), 'ZZICC C11 issue test');
  select unit_cost into v_issue_cost from stock_moves where item_id = v_A and source_type = 'owner_transfer' order by id desc limit 1;
  rep := rep || pg_temp.r('C11 выдача unit_cost = avg_cost (150)', v_issue_cost = v_avg_company and v_avg_company = 150);

  -- C12: товар с ценой без коррекции и расходник считаются как раньше
  begin
    j := stock_valuation('company');
    rep := rep || pg_temp.r('C12 товар с ценой без коррекции: avg_cost = 30',
      (select (e->>'avg_cost')::numeric = 30 from jsonb_array_elements(j) e where (e->>'item_id')::int = v_D limit 1));
    rep := rep || pg_temp.r('C12 расходник с ценой: avg_cost = 10',
      (select (e->>'avg_cost')::numeric = 10 from jsonb_array_elements(j) e where (e->>'item_id')::int = v_C limit 1));
  exception when others then
    rep := rep || pg_temp.r('C12 товар с ценой без коррекции: avg_cost = 30', false);
    rep := rep || pg_temp.r('C12 расходник с ценой: avg_cost = 10', false);
  end;

  -- === OWNER TESTS (v_E: только uncosted приходы) ===

  -- O1: owner avg_cost null без коррекции
  begin
    j := stock_valuation('owner', v_O1);
    rep := rep || pg_temp.r('O1 owner avg_cost null без коррекции',
      (select (e->>'avg_cost') is null from jsonb_array_elements(j) e where (e->>'item_id')::int = v_E limit 1));
  exception when others then rep := rep || pg_temp.r('O1 owner avg_cost null без коррекции', false);
  end;

  -- O2: set_item_cost с p_owner_apartment → owner avg_cost = 40, stock_value = 80
  j := set_item_cost(v_E, 40, null, v_O1);
  begin
    j := stock_valuation('owner', v_O1);
    rep := rep || pg_temp.r('O2 owner avg_cost = 40',
      (select (e->>'avg_cost')::numeric = 40 from jsonb_array_elements(j) e where (e->>'item_id')::int = v_E limit 1));
    rep := rep || pg_temp.r('O2 owner stock_value = 80 (2x40)',
      (select (e->>'stock_value')::numeric = 80 from jsonb_array_elements(j) e where (e->>'item_id')::int = v_E limit 1));
  exception when others then
    rep := rep || pg_temp.r('O2 owner avg_cost = 40', false);
    rep := rep || pg_temp.r('O2 owner stock_value = 80 (2x40)', false);
  end;

  -- O3: коррекция owner не меняет company avg_cost и наоборот
  begin
    j := stock_valuation('company');
    rep := rep || pg_temp.r('O3 company avg_cost E null (не изменился от owner коррекции)',
      (select (e->>'avg_cost') is null from jsonb_array_elements(j) e where (e->>'item_id')::int = v_E limit 1));
  exception when others then rep := rep || pg_temp.r('O3 company avg_cost E null (не изменился от owner коррекции)', false);
  end;
  perform set_item_cost(v_E, 99);
  begin
    j := stock_valuation('owner', v_O1);
    rep := rep || pg_temp.r('O3 owner avg_cost E = 40 (не изменился от company коррекции)',
      (select (e->>'avg_cost')::numeric = 40 from jsonb_array_elements(j) e where (e->>'item_id')::int = v_E limit 1));
  exception when others then rep := rep || pg_temp.r('O3 owner avg_cost E = 40 (не изменился от company коррекции)', false);
  end;

  -- O4: не-owner квартира отклонена
  t := null;
  begin
    perform set_item_cost(v_E, 50, null, v_R);
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('O4 не-owner квартира отклонена', t is not null and t like '%не является owner-квартирой%');

  -- O5: две owner-квартиры с разными коррекциями не влияют друг на друга
  -- v_F: uncosted receipt (setup above), no company correction → transfer carries null unit_cost
  perform transfer_company_owner('to_owner', v_O2, jsonb_build_array(
    jsonb_build_object('item_id', v_F, 'qty', 1)
  ), 'ZZICC O5 owner2 transfer');
  perform set_item_cost(v_F, 70, null, v_O2);
  begin
    j := stock_valuation('owner', v_O1);
    rep := rep || pg_temp.r('O5 O1 avg_cost = 40 (не изменился от O2)',
      (select (e->>'avg_cost')::numeric = 40 from jsonb_array_elements(j) e where (e->>'item_id')::int = v_E limit 1));
  exception when others then rep := rep || pg_temp.r('O5 O1 avg_cost = 40 (не изменился от O2)', false);
  end;
  begin
    j := stock_valuation('owner', v_O2);
    rep := rep || pg_temp.r('O5 O2 avg_cost = 70',
      (select (e->>'avg_cost')::numeric = 70 from jsonb_array_elements(j) e where (e->>'item_id')::int = v_F limit 1));
  exception when others then rep := rep || pg_temp.r('O5 O2 avg_cost = 70', false);
  end;

  -- O6: markup/margin по-прежнему работают (v_A: avg_cost=150, guest_price=200)
  begin
    j := stock_valuation('company');
    rep := rep || pg_temp.r('O6 company markup_pct для A = 33.33',
      (select (e->>'markup_pct')::numeric = 33.33 from jsonb_array_elements(j) e where (e->>'item_id')::int = v_A limit 1));
    rep := rep || pg_temp.r('O6 company margin_pct для A = 25',
      (select (e->>'margin_pct')::numeric = 25 from jsonb_array_elements(j) e where (e->>'item_id')::int = v_A limit 1));
  exception when others then
    rep := rep || pg_temp.r('O6 company markup_pct для A = 33.33', false);
    rep := rep || pg_temp.r('O6 company margin_pct для A = 25', false);
  end;

  raise exception E'ОТЧЁТ (данные откатаны):\n%', rep;
end $$;
