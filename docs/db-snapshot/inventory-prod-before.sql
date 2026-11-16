-- Снимок функций инвентаризации из prod (Этап 0, шаг 1 — только чтение).
-- Источник: pg_get_functiondef(oid), 2026-11-16.

-- inventory_cancel
CREATE OR REPLACE FUNCTION public.inventory_cancel(p_inventory uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
update inventories set status = 'void', closed_by = auth.uid(), closed_at = now()
where id = p_inventory and status = 'open';
if not found then raise exception 'Открытая инвентаризация не найдена'; end if;
end $function$

-- inventory_close
CREATE OR REPLACE FUNCTION public.inventory_close(p_inventory uuid, p_reject_items integer[] DEFAULT '{}'::integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
v_inv inventories; v_loc int; v_wh int := _loc_singleton('warehouse');
v_sink int := _loc_singleton('sink'); v_src int := _loc_singleton('source');
v_doc uuid; v_number text; v_move bigint; v_delta numeric; v_name text;
r inventory_lines%rowtype; v_short jsonb := '[]'; v_surplus jsonb := '[]'; v_adj int := 0;
begin
if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
select * into v_inv from inventories where id = p_inventory for update;
if not found then raise exception 'Инвентаризация не найдена'; end if;
if v_inv.status <> 'open' then raise exception 'Инвентаризация уже закрыта'; end if;
v_loc := _inv_loc(v_inv);
for r in select * from inventory_lines where inventory_id = p_inventory order by item_id loop
if r.item_id = any(coalesce(p_reject_items, '{}')) then
update inventory_lines set decision = 'rejected' where id = r.id;
continue;
end if;
v_delta := r.actual - _bal(v_loc, r.item_id);
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
'shortages', v_short, 'surpluses', v_surplus);
end $function$

-- inventory_set_actual
CREATE OR REPLACE FUNCTION public.inventory_set_actual(p_inventory uuid, p_item integer, p_actual numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_inv inventories;
begin
if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
if p_actual is null or p_actual < 0 then raise exception 'Факт не может быть отрицательным'; end if;
select * into v_inv from inventories where id = p_inventory for update;
if not found then raise exception 'Инвентаризация не найдена'; end if;
if v_inv.status <> 'open' then raise exception 'Инвентаризация закрыта'; end if;
insert into inventory_lines(inventory_id, item_id, expected, actual)
values (p_inventory, p_item, _bal(_inv_loc(v_inv), p_item), p_actual)
on conflict (inventory_id, item_id) do update set actual = excluded.actual, decision = 'pending';
end $function$

-- inventory_start
CREATE OR REPLACE FUNCTION public.inventory_start(p_scope text, p_apartment integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
where b.loc_id = v_loc and b.qty > 0 and i.active;
return v_inv.id;
end $function$
