-- Этап 0. Аудит prod: ТОЛЬКО ЧТЕНИЕ (один SELECT, ничего не меняет). Rollback не нужен.
-- Результат: таблица (chk, n, detail). Пришлите весь результат целиком.
-- detail ограничен 20 строками; n - полное число.
select * from (

select 'A01_track_units_items' as chk,
  (select count(*) from items where track_units) as n,
  (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select id, name, active from items where track_units order by id limit 20) x) as detail

union all select 'A02_open_inventories',
  (select count(*) from inventories where status = 'open'),
  (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select id, scope, apartment_id, created_at from inventories where status = 'open' order by created_at limit 20) x)

union all select 'A03_open_inventory_lines_with_tracked_items',
  (select count(*) from inventory_lines l join inventories v on v.id = l.inventory_id join items i on i.id = l.item_id where v.status = 'open' and i.track_units),
  (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select l.inventory_id, l.item_id, l.expected, l.actual from inventory_lines l join inventories v on v.id = l.inventory_id join items i on i.id = l.item_id where v.status = 'open' and i.track_units limit 20) x)

union all select 'A04_negative_stock_balance',
  (select count(*) from stock_balance where qty < 0),
  (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select loc_id, item_id, qty from stock_balance where qty < 0 order by qty limit 20) x)

union all select 'A05_stock_moves_negative_unit_cost',
  (select count(*) from stock_moves where unit_cost < 0),
  (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select id, item_id, qty, unit_cost, source_type from stock_moves where unit_cost < 0 order by id limit 20) x)

union all select 'A06_po_lines_received_gt_qty',
  (select count(*) from purchase_order_lines where received_qty > qty),
  (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select order_id, item_id, qty, received_qty from purchase_order_lines where received_qty > qty limit 20) x)

union all select 'A07_secdef_functions_total',
  (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prosecdef),
  '[]'::jsonb

union all select 'A07_secdef_executable_by_anon',
  (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')),
  (select coalesce(jsonb_agg(x.sig), '[]') from (select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1 limit 20) x)

union all select 'A07_secdef_without_search_path',
  (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  (select coalesce(jsonb_agg(x.sig), '[]') from (select p.proname as sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') order by 1 limit 20) x)

union all select 'A08_key_function_md5',
  (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('inventory_start','inventory_set_actual','inventory_close','inventory_cancel','po_receive','po_set_line','post_move','post_document','_insert_move','_bal','trg_guard_unit_tracked_moves')),
  (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select p.proname, pg_get_function_identity_arguments(p.oid) as args, md5(pg_get_functiondef(p.oid)) as md5 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('inventory_start','inventory_set_actual','inventory_close','inventory_cancel','po_receive','po_set_line','post_move','post_document','_insert_move','_bal','trg_guard_unit_tracked_moves') order by 1, 2) x)

union all select 'A09_public_tables_without_rls',
  (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  (select coalesce(jsonb_agg(x.relname), '[]') from (select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1 limit 20) x)

union all select 'A09_policies_using_true',
  (select count(*) from pg_policies where schemaname = 'public' and (qual = 'true' or with_check = 'true')),
  (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public' and (qual = 'true' or with_check = 'true') order by 1, 2 limit 20) x)

union all select 'A10_policies_total_and_tables_without_policy',
  (select count(*) from pg_policies where schemaname = 'public'),
  (select coalesce(jsonb_agg(x.relname), '[]') from (select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) order by 1 limit 20) x)

union all select 'A11_stock_moves_rows',
  (select count(*) from stock_moves), '[]'::jsonb

) r order by chk;
