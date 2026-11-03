/*
# Unit receipts with serial codes and enabling piece-by-piece tracking

Lets the warehouse receive individual pieces of tracked assets and lets an admin switch an existing asset to piece-by-piece tracking. Items with track_units = false behave exactly as before.

1. Sequence
- New sequence `item_unit_code_seq` for automatic piece codes ('U-<item>-<n>'). No client role can use it.

2. post_move
- Signature gains a final parameter `p_serials text[] default null`. The old 10-argument version is dropped first, so there is no overload.
- Receipt of a tracked item: quantity must be whole; codes come from p_serials (count must equal quantity, no blanks, no duplicates, no codes already in item_units) or are generated automatically.
- For each piece one row in item_units (status in_stock, location = warehouse or owner shelf, owner apartment, unit cost) and one 'receipt' row in unit_events linked to the stock move and document.
- Serial codes for an untracked item, or for any operation other than receipt, are rejected.

3. post_document
- Each line may carry "serials": [...]; codes of the same item across lines are passed to post_move.
- Receipt into an owner shelf together with an issue to the same apartment is refused for tracked items.

4. enable_unit_tracking(p_item integer) returns jsonb (new)
- Admin only. Item must exist, be an asset, and not be tracked yet.
- Every warehouse, owner shelf, apartment and employee balance (source and sink excluded) must be a non-negative whole number; otherwise the function lists the locations and stops.
- Creates one piece per unit of stock: in_stock on the warehouse and owner shelves, issued in apartments and with employees; owner apartment and unit cost are set; one 'initial' event per location.
- Switches track_units on inside the same transaction and verifies unit_balance_mismatch is empty for the item.

5. Security
- post_move, post_document and enable_unit_tracking: security definer, search_path = public, first statement checks is_admin(); EXECUTE revoked from PUBLIC and anon, granted to authenticated.
- The sequence is revoked from PUBLIC, anon and authenticated.
- _insert_move and its grants are not changed.
- void_document is not changed; receipts of tracked items are still refused by the existing stock move guard.
*/

CREATE SEQUENCE IF NOT EXISTS item_unit_code_seq;
REVOKE ALL ON SEQUENCE item_unit_code_seq FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.post_move(text, integer, numeric, integer, integer, uuid, numeric, text, timestamptz, integer);

CREATE OR REPLACE FUNCTION public.post_move(p_op text, p_item integer, p_qty numeric, p_apartment integer DEFAULT NULL::integer, p_staff integer DEFAULT NULL::integer, p_doc uuid DEFAULT NULL::uuid, p_unit_cost numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text, p_moved_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_owner_apartment integer DEFAULT NULL::integer, p_serials text[] DEFAULT NULL::text[])
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
v_wh int := _loc_singleton('warehouse'); v_sink int := _loc_singleton('sink'); v_src int := _loc_singleton('source');
v_from int; v_to int; v_msg text; v_apt_loc int; v_h int;
v_is_asset boolean; v_is_owner boolean;
v_ow int;
v_tracked boolean;
v_codes text[];
v_dup text;
v_id bigint;
begin
if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
if p_qty is null or p_qty <= 0 then raise exception 'Количество должно быть больше 0'; end if;

select c.kind = 'asset' into v_is_asset
from items i join categories c on c.id = i.category_id where i.id = p_item;

select i.track_units into v_tracked from items i where i.id = p_item;

if p_op in ('issue_apartment','return_apartment','writeoff_apartment') then
v_apt_loc := _loc_apartment(p_apartment);
if v_apt_loc is null then raise exception 'Не указана квартира'; end if;
select is_owner into v_is_owner from apartments where id = p_apartment;
end if;
if p_op in ('issue_holder','return_holder','writeoff_holder') then
v_h := _loc_holder(p_staff);
if v_h is null then raise exception 'Не указан сотрудник'; end if;
end if;

case p_op
when 'receipt' then
if p_owner_apartment is not null then
v_from := v_src;
v_to   := _loc_owner_stock(p_owner_apartment);
if v_to is null then raise exception 'Не указана owner-квартира'; end if;
if not v_is_asset then
raise exception 'Имущество собственника нельзя перемещать между собственниками или в имущество компании';
end if;
else
v_from := v_src; v_to := v_wh;
end if;

when 'issue_apartment' then
if v_is_owner and v_is_asset then
v_from := _loc_owner_stock(p_apartment);
v_to   := v_apt_loc;
v_msg  := 'Нет на складе owner';
else
v_from := v_wh; v_to := v_apt_loc; v_msg := 'Не хватает на складе';
end if;

when 'return_apartment' then
if v_is_owner and v_is_asset then
v_from := v_apt_loc;
v_to   := _loc_owner_stock(p_apartment);
v_msg  := 'Нет в апартаменте';
else
v_from := v_apt_loc; v_to := v_wh; v_msg := 'Нет в апартаменте';
end if;

when 'writeoff_apartment' then
v_from := v_apt_loc; v_to := v_sink; v_msg := 'Нет в апартаменте';

when 'writeoff_warehouse' then
if p_owner_apartment is not null then
v_from := _loc_owner_stock(p_owner_apartment);
v_to   := v_sink;
v_msg  := 'Нет на складе owner';
if v_from is null then raise exception 'Не указана owner-квартира'; end if;
else
v_from := v_wh; v_to := v_sink; v_msg := 'Не хватает на складе';
end if;

when 'issue_holder' then
v_from := v_wh; v_to := v_h; v_msg := 'Не хватает на складе';
when 'return_holder' then
v_from := v_h; v_to := v_wh; v_msg := 'Нет у сотрудника';
when 'writeoff_holder' then
v_from := v_h; v_to := v_sink; v_msg := 'Нет у сотрудника';
else raise exception 'Неизвестная операция %', p_op;
end case;

if v_msg is not null and _bal(v_from, p_item) < p_qty then raise exception '%', v_msg; end if;

v_ow := coalesce(p_owner_apartment,
case when p_op in ('issue_apartment','return_apartment','writeoff_apartment')
and v_is_owner and v_is_asset then p_apartment end);

if p_serials is not null and not coalesce(v_tracked, false) then
raise exception 'Коды указаны для товара без поштучного учёта';
end if;
if p_serials is not null and p_op <> 'receipt' then
raise exception 'Серийные коды указываются только при приходе';
end if;
if p_op = 'receipt' and coalesce(v_tracked, false) then
if p_qty <> floor(p_qty) then raise exception 'Для поштучного учёта количество должно быть целым'; end if;
if p_serials is null then
v_codes := array(select 'U-' || p_item || '-' || nextval('item_unit_code_seq') from generate_series(1, p_qty::int));
else
v_codes := array(select btrim(s) from unnest(p_serials) s);
if cardinality(v_codes) <> p_qty then
raise exception 'Количество серийных кодов должно совпадать с количеством товара';
end if;
if exists (select 1 from unnest(v_codes) s where coalesce(s, '') = '') then
raise exception 'Серийный код не может быть пустым';
end if;
select s into v_dup from unnest(v_codes) s group by s having count(*) > 1 limit 1;
if v_dup is not null then raise exception 'Серийный код повторяется: %', v_dup; end if;
select u.code into v_dup from item_units u where u.code = any(v_codes) limit 1;
if v_dup is not null then raise exception 'Серийный код уже существует: %', v_dup; end if;
end if;
end if;

v_id := _insert_move(p_item, v_from, v_to, p_qty,
case when p_op = 'receipt' then p_unit_cost end,
'manual', p_op, p_apartment, p_staff, p_doc, p_note, coalesce(p_moved_at, now()), null);

if p_op = 'receipt' and coalesce(v_tracked, false) then
with ins as (
insert into item_units(item_id, code, status, location_id, owner_apartment_id, unit_cost)
select p_item, c, 'in_stock', v_to, p_owner_apartment, p_unit_cost
from unnest(v_codes) c
returning id
)
insert into unit_events(unit_id, event, to_loc, doc_id, move_id)
select id, 'receipt', v_to, p_doc, v_id from ins;
end if;

return v_id;
end $function$;

REVOKE ALL ON FUNCTION public.post_move(text, integer, numeric, integer, integer, uuid, numeric, text, timestamptz, integer, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_move(text, integer, numeric, integer, integer, uuid, numeric, text, timestamptz, integer, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.post_document(p_op text, p_lines jsonb, p_apartment integer DEFAULT NULL::integer, p_staff integer DEFAULT NULL::integer, p_supplier integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text, p_doc_date date DEFAULT NULL::date, p_owner_apartment integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
v_type doc_type; v_doc uuid; v_number text; v_total numeric := 0; v_n int := 0; r record;
v_today date := (now() at time zone 'Africa/Cairo')::date;
v_date date; v_moved timestamptz;
v_is_asset boolean; v_is_owner boolean;
v_ow_stk int; v_apt_loc int;
v_serials text[];
begin
if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
raise exception 'Нет позиций';
end if;
v_date := coalesce(p_doc_date, v_today);
if v_date > v_today then raise exception 'Дата документа не может быть в будущем'; end if;
v_moved := case when v_date = v_today then now()
else (v_date::timestamp + interval '12 hours') at time zone 'Africa/Cairo' end;
v_type := case
when p_op = 'receipt' then 'receipt'::doc_type
when p_op in ('issue_apartment','return_apartment','issue_holder','return_holder') then 'issue'::doc_type
when p_op in ('writeoff_apartment','writeoff_warehouse','writeoff_holder') then 'writeoff'::doc_type
else null end;
if v_type is null then raise exception 'Неизвестная операция %', p_op; end if;
v_number := _next_doc_number(v_type);
insert into documents(doc_type, number, doc_date, supplier_id, note)
values (v_type, v_number, v_date, case when p_op = 'receipt' then p_supplier end, p_note)
returning id into v_doc;

for r in
select (e->>'item_id')::int as item_id,
sum((e->>'qty')::numeric) as qty,
sum((e->>'qty')::numeric * (e->>'unit_cost')::numeric) filter (where e->>'unit_cost' is not null)
/ nullif(sum((e->>'qty')::numeric) filter (where e->>'unit_cost' is not null), 0) as cost
from jsonb_array_elements(p_lines) e
group by 1 order by 1
loop
select array_agg(s) into v_serials
from jsonb_array_elements(p_lines) e,
jsonb_array_elements_text(coalesce(e->'serials', '[]'::jsonb)) s
where (e->>'item_id')::int = r.item_id;
perform post_move(p_op, r.item_id, r.qty, p_apartment, p_staff, v_doc, r.cost, p_note, v_moved, p_owner_apartment, v_serials);
v_total := v_total + r.qty * coalesce(case when p_op = 'receipt' then r.cost end, 0);
v_n := v_n + 1;
end loop;
if p_op = 'receipt' then update documents set total_cost = v_total where id = v_doc; end if;

if p_op = 'receipt' and p_owner_apartment is not null and p_apartment is not null then
if p_owner_apartment <> p_apartment then
raise exception 'owner-квартира и квартира выдачи должны совпадать';
end if;
if exists (select 1 from items i where i.track_units and i.id in (select (e->>'item_id')::int from jsonb_array_elements(p_lines) e)) then
raise exception 'Для поштучного учёта выдача в квартиру в одном документе с приходом пока недоступна';
end if;
v_apt_loc := _loc_apartment(p_apartment);
for r in
select (e->>'item_id')::int as item_id,
sum((e->>'qty')::numeric) as qty
from jsonb_array_elements(p_lines) e
group by 1 order by 1
loop
select c.kind = 'asset' into v_is_asset
from items i join categories c on c.id = i.category_id where i.id = r.item_id;
if v_is_asset then
perform _insert_move(r.item_id, _loc_owner_stock(p_apartment), v_apt_loc, r.qty,
null, 'manual', 'issue_apartment', p_apartment, null, v_doc, p_note, v_moved, null);
v_n := v_n + 1;
end if;
end loop;
end if;

return jsonb_build_object('doc_id', v_doc, 'doc_number', v_number, 'lines', v_n);
end $function$;

REVOKE ALL ON FUNCTION public.post_document(text, jsonb, integer, integer, integer, text, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_document(text, jsonb, integer, integer, integer, text, date, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.enable_unit_tracking(p_item integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
v_tracked boolean; v_kind item_kind; v_bad text; v_row record; v_codes text[]; v_units int := 0; v_by jsonb;
begin
if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;

select i.track_units, c.kind into v_tracked, v_kind
from items i join categories c on c.id = i.category_id
where i.id = p_item for update of i;
if not found then raise exception 'Товар не найден'; end if;
if v_kind <> 'asset' then raise exception 'Поштучный учёт только для имущества'; end if;
if v_tracked then raise exception 'Поштучный учёт уже включён'; end if;

select string_agg(l.name || ' (' || b.qty || ')', ', ') into v_bad
from stock_balance b join locations l on l.id = b.loc_id
where b.item_id = p_item and l.type not in ('source', 'sink')
and (b.qty < 0 or b.qty <> floor(b.qty));
if v_bad is not null then
raise exception 'Нельзя включить: отрицательный или нецелый остаток в локациях: %', v_bad;
end if;

for v_row in
select b.loc_id as loc, l.name as loc_name, l.type as loc_type, b.qty::int as qty,
case
when l.type = 'owner_stock' then l.owner_apartment_id
when l.type = 'apartment' and a.is_owner then l.apartment_id
end as owner_apt
from stock_balance b
join locations l on l.id = b.loc_id
left join apartments a on a.id = l.apartment_id
where b.item_id = p_item and b.qty > 0 and l.type not in ('source', 'sink')
loop
v_codes := array(select 'U-' || p_item || '-' || nextval('item_unit_code_seq') from generate_series(1, v_row.qty));
with ins as (
insert into item_units(item_id, code, status, location_id, owner_apartment_id, unit_cost)
select p_item, c,
case when v_row.loc_type in ('warehouse', 'owner_stock') then 'in_stock' else 'issued' end,
v_row.loc, v_row.owner_apt,
case when v_row.owner_apt is not null then owner_avg_cost(p_item, v_row.owner_apt) else avg_cost(p_item) end
from unnest(v_codes) c
returning id
)
insert into unit_events(unit_id, event, to_loc, note)
select id, 'initial', v_row.loc, 'Включение поштучного учёта' from ins;
v_units := v_units + v_row.qty;
end loop;

perform set_config('app.unit_tracking_enable', 'on', true);
update items set track_units = true where id = p_item;
perform set_config('app.unit_tracking_enable', 'off', true);

if exists (select 1 from unit_balance_mismatch where item_id = p_item) then
raise exception 'Остатки и единицы не сходятся, включение отменено';
end if;

select coalesce(jsonb_agg(jsonb_build_object('location', x.name, 'qty', x.qty) order by x.name), '[]'::jsonb)
into v_by
from (
select l.name, count(*) as qty
from item_units u join locations l on l.id = u.location_id
where u.item_id = p_item
group by l.id, l.name
) x;

return jsonb_build_object('item_id', p_item, 'units_created', v_units, 'by_location', v_by);
end $function$;

REVOKE ALL ON FUNCTION public.enable_unit_tracking(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enable_unit_tracking(integer) TO authenticated;
