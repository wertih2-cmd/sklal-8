-- Этап 2c: блокировки писателей остатков (_lock_items и его вызов в void_document, inventory_close,
-- transfer_stock, transfer_company_owner, issue_missing_to_apartment, approve_incident, post_document, enable_unit_tracking).
-- Запускать на ТЕСТОВОЙ БД. Скрипт сам откатывает данные: в конце падает с ошибкой "ОТЧЁТ".
-- Остатки засеваются через _insert_move (он блокировку не берёт), поэтому «блокировки до вызова нет» проверяемо.
-- Ограничение: в одной сессии нельзя показать, что второй писатель реально ждёт первого. Тест проверяет, что каждый писатель
-- ВЗЯЛ блокировку (pg_locks, ключ 7101 + item_id) и что прежняя логика не сломана. Параллельный прогон двух сессий не выполняется.
create or replace function pg_temp.r(n text, c boolean) returns text language sql as
$$ select case when coalesce(c, false) then 'OK    ' else 'FAIL  ' end || n || E'\n' $$;
create or replace function pg_temp.lk(p_item int) returns boolean language sql as
$$ select exists (select 1 from pg_locks where locktype = 'advisory' and classid = 7101::oid and objid = p_item::oid
                  and objsubid = 2 and pid = pg_backend_pid() and granted) $$;

do $$
declare
  v_admin uuid; rep text := ''; v_bld int; v_a1 int; v_a2 int; v_a3 int; v_ao int; v_cat int; v_cat_c int;
  v_wh int; v_src int; v_sink int; v_l1 int; v_l2 int; v_l3 int; v_los int;
  v_I int; v_G int; v_V int; v_T int; v_O int; v_A int; v_P1 int; v_P2 int; v_E int; v_M int; v_X1 int; v_X2 int;
  v_inv uuid; v_doc uuid; v_doc2 uuid; v_inc uuid; j jsonb; v_msg text; v_bal numeric; v_n int; v_ok int; v_fail int;
  v_has boolean; v_status text;
begin
  select id into v_admin from profiles where role = 'admin' and active limit 1;
  if v_admin is null then
    v_admin := gen_random_uuid();
    insert into auth.users(id, email) values (v_admin, 'zz-2c-admin@example.invalid');
    insert into profiles(id, login, full_name, role) values (v_admin, 'zz-2c-admin', 'ZZ 2C Admin', 'admin');
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  select exists (select 1 from pg_proc where proname = '_lock_items')
     and (select count(distinct proname) from pg_proc
          where proname in ('void_document','inventory_close','transfer_stock','transfer_company_owner',
                            'issue_missing_to_apartment','approve_incident','post_document','enable_unit_tracking')
            and prosrc like '%_lock_items(%') = 8
  into v_has;
  rep := rep || pg_temp.r('S0 stage2c-writer-locks.sql применён: _lock_items есть и вызывается в 8 писателях', v_has);
  if not v_has then raise exception E'ОТЧЁТ (миграция stage2c-writer-locks.sql не применена):\n%', rep; end if;

  v_wh := _loc_singleton('warehouse'); v_src := _loc_singleton('source'); v_sink := _loc_singleton('sink');
  insert into buildings(name) values ('ZZ2C') returning id into v_bld;
  insert into apartments(building_id, number, code, type) values (v_bld, '1', 'ZZ2C/1', 'studio') returning id into v_a1;
  insert into apartments(building_id, number, code, type) values (v_bld, '2', 'ZZ2C/2', 'studio') returning id into v_a2;
  insert into apartments(building_id, number, code, type) values (v_bld, '3', 'ZZ2C/3', 'studio') returning id into v_a3;
  insert into apartments(building_id, number, code, type) values (v_bld, '4', 'ZZ2C/4', 'studio') returning id into v_ao;
  update apartments set is_owner = true where id = v_ao;
  v_l1 := _loc_apartment(v_a1); v_l2 := _loc_apartment(v_a2); v_l3 := _loc_apartment(v_a3); v_los := _loc_owner_stock(v_ao);
  insert into categories(name, kind) values ('ZZ 2C актив', 'asset') returning id into v_cat;
  insert into items(category_id, name) values (v_cat, 'ZZ2C-I') returning id into v_I;
  insert into items(category_id, name) values (v_cat, 'ZZ2C-G') returning id into v_G;
  insert into items(category_id, name) values (v_cat, 'ZZ2C-V') returning id into v_V;
  insert into items(category_id, name) values (v_cat, 'ZZ2C-T') returning id into v_T;
  insert into items(category_id, name) values (v_cat, 'ZZ2C-O') returning id into v_O;
  insert into items(category_id, name) values (v_cat, 'ZZ2C-A') returning id into v_A;
  insert into items(category_id, name) values (v_cat, 'ZZ2C-P1') returning id into v_P1;
  insert into items(category_id, name) values (v_cat, 'ZZ2C-P2') returning id into v_P2;
  insert into items(category_id, name) values (v_cat, 'ZZ2C-E') returning id into v_E;
  insert into items(category_id, name) values (v_cat, 'ZZ2C-M') returning id into v_M;
  insert into items(category_id, name) values (v_cat, 'ZZ2C-X1') returning id into v_X1;
  insert into items(category_id, name) values (v_cat, 'ZZ2C-X2') returning id into v_X2;

  -- H1: хелпер: порядок, повторы, null, пустой массив
  perform _lock_items(array[v_X2, v_X1, v_X1, null]::int[]);
  rep := rep || pg_temp.r('H1 _lock_items берёт обе блокировки (повтор и null игнорируются)', pg_temp.lk(v_X1) and pg_temp.lk(v_X2));
  select count(*) into v_n from pg_locks where locktype = 'advisory' and classid = 7101::oid
    and objid in (v_X1::oid, v_X2::oid) and pid = pg_backend_pid() and granted;
  rep := rep || pg_temp.r('H1 ровно 2 блокировки на 2 товара (без дублей): ' || v_n, v_n = 2);
  v_msg := '';
  begin perform _lock_items(null); perform _lock_items('{}'::int[]); exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('H1 null и пустой массив без ошибки: ' || v_msg, v_msg = '');
  rep := rep || pg_temp.r('H1 _lock_items недоступна anon и authenticated',
    not has_function_privilege('authenticated', 'public._lock_items(int[])', 'execute')
    and not has_function_privilege('anon', 'public._lock_items(int[])', 'execute'));

  -- V1: void_document
  insert into documents(doc_type, number) values ('receipt', _next_doc_number('receipt'::doc_type)) returning id into v_doc;
  perform _insert_move(v_V, v_src, v_wh, 5, 10, 'manual', 'receipt', null, null, v_doc, null, now(), null);
  rep := rep || pg_temp.r('V1 до вызова блокировки товара нет (изоляция теста)', not pg_temp.lk(v_V));
  j := void_document(v_doc, 'ZZ 2C');
  rep := rep || pg_temp.r('V1 void_document взял блокировку товара', pg_temp.lk(v_V));
  rep := rep || pg_temp.r('V1 документ отменён, остаток склада 0: ' || j::text,
    (select status::text from documents where id = v_doc) = 'void' and _bal(v_wh, v_V) = 0);
  insert into documents(doc_type, number) values ('receipt', _next_doc_number('receipt'::doc_type)) returning id into v_doc2;
  perform _insert_move(v_V, v_src, v_wh, 5, 10, 'manual', 'receipt', null, null, v_doc2, null, now(), null);
  perform _insert_move(v_V, v_wh, v_sink, 3, null, 'manual', 'writeoff', null, null, null, null, now(), null);
  v_msg := ''; begin perform void_document(v_doc2, 'ZZ 2C'); exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('V2 уже израсходованный приход не отменяется: ' || v_msg, v_msg like 'Нельзя отменить%');
  rep := rep || pg_temp.r('V2 документ остался проведённым, остаток 2',
    (select status::text from documents where id = v_doc2) = 'posted' and _bal(v_wh, v_V) = 2);

  -- I1: inventory_close: блокировка и обычная корректировка
  perform _insert_move(v_I, v_src, v_l1, 10, 10, 'manual', 'zz2c', v_a1, null, null, null, now(), null);
  v_inv := inventory_start('apartment', v_a1, 'ZZ2C I');
  perform inventory_set_actual(v_inv, v_I, 8);
  rep := rep || pg_temp.r('I1 до закрытия блокировки товара нет (изоляция теста)', not pg_temp.lk(v_I));
  j := inventory_close(v_inv, '{}');
  rep := rep || pg_temp.r('I1 inventory_close взял блокировку товара', pg_temp.lk(v_I));
  rep := rep || pg_temp.r('I1 недостача 2 списана, остаток 8: ' || j::text, (j->>'adjusted')::int = 1 and _bal(v_l1, v_I) = 8);

  -- I2: остаток уменьшился после пересчёта: недостача в минус не списывается
  perform _insert_move(v_G, v_src, v_l2, 10, 10, 'manual', 'zz2c', v_a2, null, null, null, now(), null);
  v_inv := inventory_start('apartment', v_a2, 'ZZ2C G');
  perform inventory_set_actual(v_inv, v_G, 2);
  perform _insert_move(v_G, v_l2, v_sink, 5, null, 'manual', 'zz2c', v_a2, null, null, null, now(), null);
  v_msg := ''; begin perform inventory_close(v_inv, '{}'); exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('I2 закрытие отклонено: ' || v_msg, v_msg like 'Остаток%изменился после пересчёта%');
  rep := rep || pg_temp.r('I2 инвентаризация открыта, движений корректировки нет, остаток 5',
    (select status::text from inventories where id = v_inv) = 'open'
    and not exists (select 1 from stock_moves where source_type = 'inventory_adjust' and source_id = v_inv::text)
    and _bal(v_l2, v_G) = 5);
  perform inventory_set_actual(v_inv, v_G, 2);
  j := inventory_close(v_inv, '{}');
  rep := rep || pg_temp.r('I2 после пересчёта закрытие проходит, остаток 2: ' || j::text, (j->>'adjusted')::int = 1 and _bal(v_l2, v_G) = 2);

  -- T1: transfer_stock
  perform _insert_move(v_T, v_src, v_l3, 5, 10, 'manual', 'zz2c', v_a3, null, null, null, now(), null);
  rep := rep || pg_temp.r('T1 до вызова блокировки товара нет (изоляция теста)', not pg_temp.lk(v_T));
  v_msg := ''; begin perform transfer_stock(p_from_kind => 'apartment', p_from_id => v_a3, p_to_apartment => v_a1,
      p_lines => jsonb_build_array(jsonb_build_object('item_id', v_T, 'qty', 99)));
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T1 перенос больше остатка отклонён: ' || v_msg, v_msg like 'Нет в апартаменте%');
  j := transfer_stock(p_from_kind => 'apartment', p_from_id => v_a3, p_to_apartment => v_a1,
      p_lines => jsonb_build_array(jsonb_build_object('item_id', v_T, 'qty', 2)));
  rep := rep || pg_temp.r('T1 transfer_stock взял блокировку товара', pg_temp.lk(v_T));
  rep := rep || pg_temp.r('T1 остатки: источник 3, получатель 2', _bal(v_l3, v_T) = 3 and _bal(v_l1, v_T) = 2);

  -- O1: transfer_company_owner
  perform _insert_move(v_O, v_src, v_wh, 5, 10, 'manual', 'zz2c', null, null, null, null, now(), null);
  rep := rep || pg_temp.r('O1 до вызова блокировки товара нет (изоляция теста)', not pg_temp.lk(v_O));
  perform transfer_company_owner(p_direction => 'to_owner', p_owner_apartment => v_ao,
      p_lines => jsonb_build_array(jsonb_build_object('item_id', v_O, 'qty', 2)));
  rep := rep || pg_temp.r('O1 transfer_company_owner взял блокировку товара', pg_temp.lk(v_O));
  rep := rep || pg_temp.r('O1 остатки: склад 3, owner-полка 2', _bal(v_wh, v_O) = 3 and _bal(v_los, v_O) = 2);

  -- A1: approve_incident
  perform _insert_move(v_A, v_src, v_l2, 3, 10, 'manual', 'zz2c', v_a2, null, null, null, now(), null);
  insert into incidents(apartment_id, item_id, kind, qty) values (v_a2, v_A, 'broken', 1) returning id into v_inc;
  rep := rep || pg_temp.r('A1 до вызова блокировки товара нет (изоляция теста)', not pg_temp.lk(v_A));
  j := approve_incident(v_inc, 'confirm');
  rep := rep || pg_temp.r('A1 approve_incident взял блокировку товара', pg_temp.lk(v_A));
  rep := rep || pg_temp.r('A1 списано 1, остаток 2: ' || j::text, j->>'status' = 'confirmed' and _bal(v_l2, v_A) = 2);
  v_msg := ''; begin perform approve_incident(v_inc, 'confirm'); exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('A1 повторное подтверждение отклонено: ' || v_msg, v_msg like 'Заявка не найдена или уже обработана%');
  rep := rep || pg_temp.r('A1 списание по заявке ровно одно',
    (select count(*) from stock_moves where source_type = 'incident' and source_id = v_inc::text) = 1);

  -- M1: issue_missing_to_apartment
  insert into norm_rules(norm_type, apartment_id, item_id, qty) values ('asset_standing', v_a1, v_M, 3);
  perform _insert_move(v_M, v_src, v_wh, 2, 10, 'manual', 'zz2c', null, null, null, null, now(), null);
  rep := rep || pg_temp.r('M1 до вызова блокировки товара нет (изоляция теста)', not pg_temp.lk(v_M));
  j := issue_missing_to_apartment(v_a1);
  rep := rep || pg_temp.r('M1 issue_missing_to_apartment взял блокировку товара', pg_temp.lk(v_M));
  rep := rep || pg_temp.r('M1 выдано 2 из 3, остаток квартиры 2',
    exists (select 1 from jsonb_array_elements(j->'issued') e where (e->>'item_id')::int = v_M and (e->>'qty')::numeric = 2)
    and _bal(v_l1, v_M) = 2 and _bal(v_wh, v_M) = 0);

  -- P1: post_document: блокировки по всем товарам документа
  j := post_document(p_op => 'receipt', p_lines => jsonb_build_array(
      jsonb_build_object('item_id', v_P2, 'qty', 3, 'unit_cost', 10), jsonb_build_object('item_id', v_P1, 'qty', 2, 'unit_cost', 10)));
  rep := rep || pg_temp.r('P1 post_document: блокировки обоих товаров', pg_temp.lk(v_P1) and pg_temp.lk(v_P2));
  rep := rep || pg_temp.r('P1 приход проведён: ' || j::text, (j->>'lines')::int = 2 and _bal(v_wh, v_P1) = 2 and _bal(v_wh, v_P2) = 3);

  -- E1: enable_unit_tracking
  perform _insert_move(v_E, v_src, v_wh, 3, 10, 'manual', 'zz2c', null, null, null, null, now(), null);
  rep := rep || pg_temp.r('E1 до вызова блокировки товара нет (изоляция теста)', not pg_temp.lk(v_E));
  j := enable_unit_tracking(v_E);
  rep := rep || pg_temp.r('E1 enable_unit_tracking взял блокировку товара', pg_temp.lk(v_E));
  rep := rep || pg_temp.r('E1 поштучный учёт включён, единиц 3: ' || j::text,
    (j->>'units_created')::int = 3 and (select track_units from items where id = v_E));

  select count(*) filter (where l like 'OK%'), count(*) filter (where l like 'FAIL%')
  into v_ok, v_fail from unnest(string_to_array(rep, E'\n')) l;
  raise exception E'ОТЧЁТ (данные откатаны): OK %, FAIL %\n%', v_ok, v_fail, rep;
end $$;
