-- Этап 1a. Инвентаризация: фиксация остатка на момент пересчёта.
-- Откат: docs/db-snapshot/inventory-fix-rollback.sql
-- Что меняет:
--  1) inventory_lines: counted, counted_at, system_qty_at_count (+ CHECK).
--  2) inventory_start: поштучные товары (track_units) в инвентаризацию не попадают.
--  3) inventory_set_actual_bulk (новая): атомарное сохранение факта; пишет counted и остаток системы на момент пересчёта.
--  4) inventory_set_actual (та же сигнатура): делегирует в bulk.
--  5) inventory_close: ошибка, если есть непросчитанные позиции; дельта = actual - system_qty_at_count;
--     строки поштучных товаров (из ранее открытых инвентаризаций) помечаются rejected, движений по ним нет.
-- Уже открытые инвентаризации: их строки получают counted = false, перед закрытием нужно пересчитать
-- позиции или отметить «Не применять».
-- Идемпотентно: повторный запуск безопасен.

alter table public.inventory_lines
  add column if not exists counted boolean not null default false,
  add column if not exists counted_at timestamptz,
  add column if not exists system_qty_at_count numeric(14,3);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_lines_counted_chk') then
    alter table public.inventory_lines add constraint inventory_lines_counted_chk
      check (counted = (counted_at is not null) and (not counted or system_qty_at_count is not null));
  end if;
end $$;

create or replace function public.inventory_start(p_scope text, p_apartment int default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_inv inventories; v_loc int;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if p_scope not in ('apartment','warehouse') then raise exception 'Неизвестная область инвентаризации'; end if;
  if p_scope = 'apartment' and (p_apartment is null or _loc_apartment(p_apartment) is null) then
    raise exception 'Квартира не найдена';
  end if;
  if exists (select 1 from inventories where status = 'open' and scope = p_scope
             and coalesce(apartment_id, 0) = coalesce(p_apartment, 0)) then
    raise exception 'Инвентаризация уже открыта';
  end if;
  insert into inventories(scope, apartment_id, note)
  values (p_scope, case when p_scope = 'apartment' then p_apartment end, p_note) returning * into v_inv;
  v_loc := _inv_loc(v_inv);
  insert into inventory_lines(inventory_id, item_id, expected, actual)
  select v_inv.id, b.item_id, b.qty, b.qty
  from stock_balance b join items i on i.id = b.item_id
  where b.loc_id = v_loc and b.qty > 0 and i.active and not i.track_units;
  return v_inv.id;
end $$;

create or replace function public.inventory_set_actual_bulk(p_inventory uuid, p_lines jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_inv inventories; v_loc int; e jsonb; v_item_n numeric; v_item int; v_act numeric; v_bal numeric; v_n int := 0;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Ожидается массив позиций';
  end if;
  if jsonb_array_length(p_lines) > 2000 then raise exception 'Слишком много позиций за один запрос'; end if;
  select * into v_inv from inventories where id = p_inventory for update;
  if not found then raise exception 'Инвентаризация не найдена'; end if;
  if v_inv.status <> 'open' then raise exception 'Инвентаризация закрыта'; end if;
  v_loc := _inv_loc(v_inv);
  for e in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'item_id') <> 'number' or jsonb_typeof(e->'actual') <> 'number' then
      raise exception 'Некорректная позиция инвентаризации';
    end if;
    v_item_n := (e->>'item_id')::numeric;
    v_act := (e->>'actual')::numeric;
    if v_item_n <> trunc(v_item_n) then raise exception 'Некорректная позиция инвентаризации'; end if;
    if v_act < 0 then raise exception 'Факт не может быть отрицательным'; end if;
    v_item := v_item_n::int;
    if not exists (select 1 from items where id = v_item) then raise exception 'Позиция не найдена'; end if;
    if exists (select 1 from items where id = v_item and track_units) then
      raise exception 'Поштучный товар не инвентаризируется этим способом';
    end if;
    v_bal := _bal(v_loc, v_item);
    insert into inventory_lines(inventory_id, item_id, expected, actual, counted, counted_at, system_qty_at_count)
    values (p_inventory, v_item, v_bal, v_act, true, now(), v_bal)
    on conflict (inventory_id, item_id) do update
      set actual = excluded.actual, counted = true, counted_at = now(),
          system_qty_at_count = excluded.system_qty_at_count, decision = 'pending';
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.inventory_set_actual(p_inventory uuid, p_item int, p_actual numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if p_actual is null or p_actual < 0 then raise exception 'Факт не может быть отрицательным'; end if;
  perform inventory_set_actual_bulk(p_inventory,
    jsonb_build_array(jsonb_build_object('item_id', p_item, 'actual', p_actual)));
end $$;

create or replace function public.inventory_close(p_inventory uuid, p_reject_items int[] default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_inv inventories; v_loc int;
  v_sink int := _loc_singleton('sink'); v_src int := _loc_singleton('source');
  v_doc uuid; v_number text; v_move bigint; v_delta numeric; v_name text;
  r inventory_lines%rowtype; v_short jsonb := '[]'; v_surplus jsonb := '[]'; v_adj int := 0;
  v_uncounted int; v_tracked int := 0;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  select * into v_inv from inventories where id = p_inventory for update;
  if not found then raise exception 'Инвентаризация не найдена'; end if;
  if v_inv.status <> 'open' then raise exception 'Инвентаризация уже закрыта'; end if;
  v_loc := _inv_loc(v_inv);
  select count(*) into v_uncounted
  from inventory_lines l join items i on i.id = l.item_id
  where l.inventory_id = p_inventory and not l.counted and not i.track_units
    and not (l.item_id = any(coalesce(p_reject_items, '{}')));
  if v_uncounted > 0 then
    raise exception 'Не пересчитано позиций: %. Введите факт или отметьте «Не применять»', v_uncounted;
  end if;
  for r in select * from inventory_lines where inventory_id = p_inventory order by item_id loop
    if r.item_id = any(coalesce(p_reject_items, '{}')) then
      update inventory_lines set decision = 'rejected' where id = r.id;
      continue;
    end if;
    if exists (select 1 from items where id = r.item_id and track_units) then
      update inventory_lines set decision = 'rejected' where id = r.id;
      v_tracked := v_tracked + 1;
      continue;
    end if;
    v_delta := r.actual - r.system_qty_at_count;
    v_move := null;
    if v_delta <> 0 then
      if v_doc is null then
        v_number := _next_doc_number('inventory');
        insert into documents(doc_type, number, note)
        values ('inventory', v_number,
                case when v_inv.scope = 'warehouse' then 'Инвентаризация склада'
                     else 'Инвентаризация ' || (select code from apartments where id = v_inv.apartment_id) end)
        returning id into v_doc;
      end if;
      select name into v_name from items where id = r.item_id;
      if v_delta < 0 then
        v_move := _insert_move(r.item_id, v_loc, v_sink, -v_delta, null, 'inventory_adjust', p_inventory::text,
                               v_inv.apartment_id, null, v_doc, 'Недостача по инвентаризации', now(), null);
        v_short := v_short || jsonb_build_object('item_id', r.item_id, 'name', v_name, 'qty', -v_delta);
      else
        v_move := _insert_move(r.item_id, v_src, v_loc, v_delta, null, 'inventory_adjust', p_inventory::text,
                               v_inv.apartment_id, null, v_doc, 'Излишек по инвентаризации', now(), null);
        v_surplus := v_surplus || jsonb_build_object('item_id', r.item_id, 'name', v_name, 'qty', v_delta);
      end if;
      v_adj := v_adj + 1;
    end if;
    update inventory_lines set decision = 'accepted', move_id = v_move where id = r.id;
  end loop;
  update inventories set status = 'closed', closed_by = auth.uid(), closed_at = now(), doc_id = v_doc
  where id = p_inventory;
  if jsonb_array_length(v_short) > 0 then
    insert into events(type, payload)
    values ('inventory_shortage', jsonb_build_object('inventory_id', p_inventory, 'scope', v_inv.scope,
                                                     'apartment_id', v_inv.apartment_id, 'items', v_short));
  end if;
  return jsonb_build_object('doc_id', v_doc, 'doc_number', v_number, 'adjusted', v_adj,
                            'shortages', v_short, 'surpluses', v_surplus, 'skipped_tracked', v_tracked);
end $$;

revoke all on function public.inventory_set_actual_bulk(uuid, jsonb) from public, anon;
grant execute on function public.inventory_set_actual_bulk(uuid, jsonb) to authenticated;
