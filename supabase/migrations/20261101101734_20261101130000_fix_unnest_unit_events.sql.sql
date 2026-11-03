/*
# Fix: unnest uuid[] returns scalar column, not record

Fixes the unit_events insert in post_move: `unnest(p_unit_ids) u` gives `u` as a
scalar uuid value, so `u.id` is invalid — use `u` directly.
*/

CREATE OR REPLACE FUNCTION public.post_move(
  p_op text,
  p_item integer,
  p_qty numeric,
  p_apartment integer DEFAULT NULL,
  p_staff integer DEFAULT NULL,
  p_doc uuid DEFAULT NULL,
  p_unit_cost numeric DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_moved_at timestamptz DEFAULT NULL,
  p_owner_apartment integer DEFAULT NULL,
  p_serials text[] DEFAULT NULL,
  p_unit_ids uuid[] DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_wh int := _loc_singleton('warehouse');
  v_sink int := _loc_singleton('sink');
  v_src int := _loc_singleton('source');
  v_from int; v_to int; v_msg text; v_apt_loc int; v_h int;
  v_is_asset boolean; v_is_owner boolean;
  v_ow int;
  v_tracked boolean;
  v_codes text[];
  v_dup text;
  v_id bigint;
  v_from_type loc_type; v_to_type loc_type;
  v_u record;
  v_expected_status text;
  v_dup_id uuid;
  v_set_ok boolean := false;
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

  -- serials: unchanged receipt-only logic
  if p_serials is not null and not coalesce(v_tracked, false) then
    raise exception 'Коды указаны для товара без поштучного учёта';
  end if;
  if p_serials is not null and p_op <> 'receipt' then
    raise exception 'Серийные коды указываются только при приходе';
  end if;

  -- receipt + tracked: serials validation (unchanged)
  if p_op = 'receipt' and coalesce(v_tracked, false) then
    if p_qty <> floor(p_qty) then raise exception 'Для поштучного учёта количество должно быть целым'; end if;
    if p_unit_ids is not null then
      raise exception 'ID единиц нельзя указывать при приходе';
    end if;
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

  -- unit_ids validation for tracked items, non-receipt ops
  if coalesce(v_tracked, false) and p_op <> 'receipt' then
    if p_unit_ids is null then
      raise exception 'ID единиц обязательны для товара с поштучным учётом';
    end if;
    if p_qty <> floor(p_qty) then
      raise exception 'Для поштучного учёта количество должно быть целым';
    end if;
    if cardinality(p_unit_ids) <> p_qty::int then
      raise exception 'Количество единиц должно совпадать с количеством товара';
    end if;
    -- no duplicates
    select u into v_dup_id from unnest(p_unit_ids) u group by u having count(*) > 1 limit 1;
    if v_dup_id is not null then
      raise exception 'Повтор ID единицы: %', v_dup_id;
    end if;

    select type into v_from_type from locations where id = v_from;
    v_expected_status := case when v_from_type in ('warehouse','owner_stock') then 'in_stock'
                              when v_from_type in ('apartment','holder') then 'issued'
                              else null end;

    for v_u in
      select id, item_id, status, location_id
      from item_units
      where id = any(p_unit_ids)
      for update
    loop
      if v_u.item_id <> p_item then
        raise exception 'Единица % не принадлежит товару %', v_u.id, p_item;
      end if;
      if v_u.location_id <> v_from then
        raise exception 'Единица % не находится в источнике перемещения', v_u.id;
      end if;
      if v_expected_status is not null and v_u.status <> v_expected_status then
        raise exception 'Единица % имеет статус %, ожидается %', v_u.id, v_u.status, v_expected_status;
      end if;
    end loop;
    -- ensure all IDs exist (count check)
    if (select count(*) from item_units where id = any(p_unit_ids)) <> cardinality(p_unit_ids) then
      raise exception 'Не все ID единиц найдены';
    end if;

  elsif not coalesce(v_tracked, false) then
    if p_unit_ids is not null then
      raise exception 'ID единиц указаны для товара без поштучного учёта';
    end if;
  end if;

  -- call _insert_move with app.unit_move_ok = on so the trigger allows tracked moves
  perform set_config('app.unit_move_ok', 'on', true);
  v_set_ok := true;

  v_id := _insert_move(p_item, v_from, v_to, p_qty,
    case when p_op = 'receipt' then p_unit_cost end,
    'manual', p_op, p_apartment, p_staff, p_doc, p_note, coalesce(p_moved_at, now()), null);

  perform set_config('app.unit_move_ok', 'off', true);
  v_set_ok := false;

  -- receipt + tracked: create units (unchanged)
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

  -- non-receipt + tracked: update units and insert events
  if coalesce(v_tracked, false) and p_op <> 'receipt' then
    select type into v_to_type from locations where id = v_to;

    update item_units
      set location_id = v_to,
          status = case when v_to_type = 'sink' then 'written_off'
                        when v_to_type in ('warehouse','owner_stock') then 'in_stock'
                        when v_to_type in ('apartment','holder') then 'issued'
                        else status end
      where id = any(p_unit_ids);

    insert into unit_events(unit_id, event, from_loc, to_loc, doc_id, move_id, note)
    select u, p_op, v_from, v_to, p_doc, v_id, p_note
    from unnest(p_unit_ids) u;
  end if;

  return v_id;

exception
  when others then
    if v_set_ok then
      perform set_config('app.unit_move_ok', 'off', true);
    end if;
    raise;
end $function$;

REVOKE ALL ON FUNCTION public.post_move(text, integer, numeric, integer, integer, uuid, numeric, text, timestamptz, integer, text[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_move(text, integer, numeric, integer, integer, uuid, numeric, text, timestamptz, integer, text[], uuid[]) TO authenticated, service_role;