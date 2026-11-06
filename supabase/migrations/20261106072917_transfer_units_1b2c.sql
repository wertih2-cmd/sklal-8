-- 1B-2c: переносы поштучных товаров (transfer_stock, transfer_company_owner) и защита отмены переносов.
-- Сигнатуры и права клиентских функций не меняются. Внутренняя функция _transfer_units недоступна authenticated.

create or replace function public._transfer_units(
  p_item int, p_unit_ids uuid[], p_qty numeric, p_from int, p_to int, p_event text,
  p_doc uuid, p_move bigint, p_set_owner boolean, p_new_owner int,
  p_check_owner boolean, p_from_owner int
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_type text;
  v_to_type text;
  v_exp text;
  v_new text;
  v_dup uuid;
  v_u record;
begin
  if p_unit_ids is null then
    raise exception 'ID единиц обязательны для товара с поштучным учётом';
  end if;
  if p_qty <> floor(p_qty) then
    raise exception 'Для поштучного учёта количество должно быть целым';
  end if;
  if cardinality(p_unit_ids) <> p_qty::int then
    raise exception 'Количество единиц должно совпадать с количеством товара';
  end if;
  select u into v_dup from unnest(p_unit_ids) u group by u having count(*) > 1 limit 1;
  if v_dup is not null then
    raise exception 'Повтор ID единицы: %', v_dup;
  end if;
  select l.type into v_from_type from locations l where l.id = p_from;
  select l.type into v_to_type from locations l where l.id = p_to;
  v_exp := case when v_from_type in ('warehouse', 'owner_stock') then 'in_stock'
                when v_from_type in ('apartment', 'holder') then 'issued'
                else null end;
  v_new := case when v_to_type in ('warehouse', 'owner_stock') then 'in_stock'
                when v_to_type in ('apartment', 'holder') then 'issued'
                else null end;
  if v_exp is null or v_new is null then
    raise exception 'Недопустимое направление переноса единиц';
  end if;
  for v_u in
    select id, item_id, status, location_id, owner_apartment_id
    from item_units
    where id = any(p_unit_ids)
    for update
  loop
    if v_u.item_id <> p_item then
      raise exception 'Единица % не принадлежит товару %', v_u.id, p_item;
    end if;
    if v_u.location_id <> p_from then
      raise exception 'Единица % не находится в источнике перемещения', v_u.id;
    end if;
    if v_u.status <> v_exp then
      raise exception 'Единица % имеет статус %, ожидается %', v_u.id, v_u.status, v_exp;
    end if;
    if p_check_owner and v_u.owner_apartment_id is distinct from p_from_owner then
      raise exception 'Единица % принадлежит другому владельцу', v_u.id;
    end if;
  end loop;
  if (select count(*) from item_units where id = any(p_unit_ids)) <> cardinality(p_unit_ids) then
    raise exception 'Не все ID единиц найдены';
  end if;
  update item_units
     set location_id = p_to,
         status = v_new,
         owner_apartment_id = case when p_set_owner then p_new_owner else owner_apartment_id end
   where id = any(p_unit_ids);
  insert into unit_events(unit_id, event, from_loc, to_loc, doc_id, move_id)
  select u, p_event, p_from, p_to, p_doc, p_move from unnest(p_unit_ids) u;
end $$;

revoke all on function public._transfer_units(int, uuid[], numeric, int, int, text, uuid, bigint, boolean, int, boolean, int) from public, anon, authenticated;

create or replace function public.transfer_stock(p_from_kind text, p_from_id int, p_to_apartment int, p_lines jsonb,
                                      p_note text default null, p_doc_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_from int; v_to int; v_doc uuid; v_number text; v_n int := 0; r record;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_date date; v_moved timestamptz; v_name text; v_msg text; v_staff int;
  v_tracked boolean; v_unit_ids uuid[]; v_mv bigint;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Нет позиций';
  end if;
  v_to := _loc_apartment(p_to_apartment);
  if v_to is null then raise exception 'Не указана квартира назначения'; end if;
  if p_from_kind = 'apartment' then
    if p_from_id is not distinct from p_to_apartment then
      raise exception 'Квартира-источник и квартира назначения совпадают';
    end if;
    v_from := _loc_apartment(p_from_id);
    if v_from is null then raise exception 'Не указана квартира-источник'; end if;
    v_msg := 'Нет в апартаменте';
  elsif p_from_kind = 'holder' then
    v_from := _loc_holder(p_from_id);
    if v_from is null then raise exception 'Не указан сотрудник'; end if;
    v_staff := p_from_id;
    v_msg := 'Нет у сотрудника';
  else
    raise exception 'Неизвестный источник %', p_from_kind;
  end if;
  v_date := coalesce(p_doc_date, v_today);
  if v_date > v_today then raise exception 'Дата документа не может быть в будущем'; end if;
  v_moved := case when v_date = v_today then now()
                  else (v_date::timestamp + interval '12 hours') at time zone 'Africa/Cairo' end;
  v_number := _next_doc_number('issue'::doc_type);
  insert into documents(doc_type, number, doc_date, note)
  values ('issue', v_number, v_date, coalesce(p_note, 'Перемещение'))
  returning id into v_doc;
  for r in
    select (e->>'item_id')::int as item_id, sum((e->>'qty')::numeric) as qty
    from jsonb_array_elements(p_lines) e
    group by 1 order by 1
  loop
    if r.qty is null or r.qty <= 0 then raise exception 'Количество должно быть больше 0'; end if;
    if _bal(v_from, r.item_id) < r.qty then
      select name into v_name from items where id = r.item_id;
      raise exception '%: %', v_msg, coalesce(v_name, r.item_id::text);
    end if;
    select i.track_units into v_tracked from items i where i.id = r.item_id;
    v_unit_ids := (
      select array_agg(x::uuid)
      from jsonb_array_elements(p_lines) e, jsonb_array_elements_text(e->'unit_ids') x
      where (e->>'item_id')::int = r.item_id
    );
    if not coalesce(v_tracked, false) and v_unit_ids is not null then
      raise exception 'ID единиц указаны для товара без поштучного учёта';
    end if;
    if coalesce(v_tracked, false) then
      begin
        perform set_config('app.unit_move_ok', 'on', true);
        v_mv := _insert_move(r.item_id, v_from, v_to, r.qty, null, 'manual', 'transfer',
                             p_to_apartment, v_staff, v_doc, p_note, v_moved, null);
        perform set_config('app.unit_move_ok', 'off', true);
      exception when others then
        perform set_config('app.unit_move_ok', 'off', true);
        raise;
      end;
      perform _transfer_units(r.item_id, v_unit_ids, r.qty, v_from, v_to, 'transfer', v_doc, v_mv,
                              false, null, false, null);
    else
      perform _insert_move(r.item_id, v_from, v_to, r.qty, null, 'manual', 'transfer',
                           p_to_apartment, v_staff, v_doc, p_note, v_moved, null);
    end if;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('doc_id', v_doc, 'doc_number', v_number, 'lines', v_n);
end $$;

revoke all on function public.transfer_stock(text, int, int, jsonb, text, date) from public, anon;
grant execute on function public.transfer_stock(text, int, int, jsonb, text, date) to authenticated;

create or replace function public.transfer_company_owner(
  p_direction text,
  p_owner_apartment int,
  p_lines jsonb,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_wh int := _loc_singleton('warehouse');
  v_os int;
  v_doc uuid; v_number text; v_n int := 0;
  r record; v_cost numeric; v_from int; v_to int; v_msg text;
  v_is_owner boolean;
  v_tracked boolean; v_unit_ids uuid[]; v_mv bigint;
begin
  if not is_admin() then
    raise exception 'Только администратор' using errcode = '42501';
  end if;

  if p_direction not in ('to_owner', 'to_company') then
    raise exception 'Направление должно быть to_owner или to_company';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Нет позиций';
  end if;

  select is_owner into v_is_owner from apartments where id = p_owner_apartment;
  if not found then
    raise exception 'Квартира не найдена';
  end if;
  if not v_is_owner then
    raise exception 'Квартира не является owner-квартирой' using errcode = '42501';
  end if;

  v_os := _loc_owner_stock(p_owner_apartment);
  if v_os is null then
    raise exception 'Owner-склад не найден';
  end if;

  if p_direction = 'to_owner' then
    v_from := v_wh;  v_to := v_os;  v_msg := 'Не хватает на складе компании';
  else
    v_from := v_os;  v_to := v_wh;  v_msg := 'Нет на складе owner';
  end if;

  v_number := _next_doc_number('issue'::doc_type);
  insert into documents(doc_type, number, doc_date, note)
  values ('issue', v_number, (now() at time zone 'Africa/Cairo')::date,
          coalesce(p_note, case when p_direction = 'to_owner'
                                then 'Перенос на owner-склад'
                                else 'Возврат с owner-склада' end))
  returning id into v_doc;

  for r in
    select (e->>'item_id')::int as item_id, sum((e->>'qty')::numeric) as qty
    from jsonb_array_elements(p_lines) e
    group by 1 order by 1
  loop
    if r.qty is null or r.qty <= 0 then
      raise exception 'Количество должно быть больше 0';
    end if;

    if _bal(v_from, r.item_id) < r.qty then
      raise exception '%', v_msg;
    end if;

    select i.track_units into v_tracked from items i where i.id = r.item_id;
    v_unit_ids := (
      select array_agg(x::uuid)
      from jsonb_array_elements(p_lines) e, jsonb_array_elements_text(e->'unit_ids') x
      where (e->>'item_id')::int = r.item_id
    );
    if not coalesce(v_tracked, false) and v_unit_ids is not null then
      raise exception 'ID единиц указаны для товара без поштучного учёта';
    end if;

    if p_direction = 'to_owner' then
      v_cost := avg_cost(r.item_id);
    else
      v_cost := owner_avg_cost(r.item_id, p_owner_apartment);
    end if;

    if coalesce(v_tracked, false) then
      begin
        perform set_config('app.unit_move_ok', 'on', true);
        v_mv := _insert_move(r.item_id, v_from, v_to, r.qty, v_cost,
                             'owner_transfer', v_doc::text, p_owner_apartment, null, v_doc,
                             p_note, now(), null);
        perform set_config('app.unit_move_ok', 'off', true);
      exception when others then
        perform set_config('app.unit_move_ok', 'off', true);
        raise;
      end;
      perform _transfer_units(r.item_id, v_unit_ids, r.qty, v_from, v_to, 'owner_transfer', v_doc, v_mv,
                              true,
                              case when p_direction = 'to_owner' then p_owner_apartment else null end,
                              true,
                              case when p_direction = 'to_owner' then null else p_owner_apartment end);
    else
      perform _insert_move(
        r.item_id, v_from, v_to, r.qty, v_cost,
        'owner_transfer', v_doc::text, p_owner_apartment, null, v_doc,
        p_note, now(), null
      );
    end if;
    v_n := v_n + 1;
  end loop;

  return v_doc;
end $$;

revoke all on function public.transfer_company_owner(text, int, jsonb, text) from public, anon;
grant execute on function public.transfer_company_owner(text, int, jsonb, text) to authenticated;

-- void_document: переносы поштучных товаров между складом компании и owner отменять пока нельзя
-- (при отмене пришлось бы восстанавливать владельца единицы). Остальное без изменений относительно 1B-2b.
create or replace function public.void_document(p_doc uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d documents%rowtype;
  m stock_moves%rowtype;
  r record;
  ev record;
  v_n int := 0;
  v_tracked boolean;
  v_rev bigint;
  v_from_type text;
begin
  if not is_admin() then
    raise exception 'Только администратор' using errcode = '42501';
  end if;
  select * into d from documents where id = p_doc for update;
  if not found then
    raise exception 'Документ не найден';
  end if;
  if d.status <> 'posted' then
    raise exception 'Отменить можно только проведённый документ';
  end if;
  if d.doc_type not in ('receipt', 'issue', 'writeoff') then
    raise exception 'Этот тип документа отменять нельзя';
  end if;

  for r in
    select x.item_id, x.to_loc, sum(x.qty) as qty, i.name
    from stock_moves x join items i on i.id = x.item_id
    where x.doc_id = p_doc and x.reverses_id is null
      and not exists (select 1 from stock_moves y where y.reverses_id = x.id)
    group by x.item_id, x.to_loc, i.name
  loop
    if _bal(r.to_loc, r.item_id) < r.qty then
      raise exception 'Нельзя отменить: «%» уже израсходован (нужно вернуть %, есть %)',
        r.name, r.qty, _bal(r.to_loc, r.item_id);
    end if;
  end loop;

  for m in
    select * from stock_moves x
    where x.doc_id = p_doc and x.reverses_id is null
      and not exists (select 1 from stock_moves y where y.reverses_id = x.id)
    order by x.id
  loop
    select i.track_units into v_tracked from items i where i.id = m.item_id;
    if coalesce(v_tracked, false) then
      if m.source_type = 'owner_transfer' then
        raise exception 'Нельзя отменить: перенос поштучных товаров между складом компании и owner отменять пока нельзя';
      end if;
      if (select count(*) from unit_events e where e.move_id = m.id) <> m.qty then
        raise exception 'Нельзя отменить: документ создан до включения поштучного учёта или число единиц не совпадает';
      end if;
      for ev in select e.id as ev_id, e.unit_id from unit_events e where e.move_id = m.id loop
        if (select max(e2.id) from unit_events e2 where e2.unit_id = ev.unit_id) <> ev.ev_id then
          raise exception 'Нельзя отменить: единица «%» уже участвовала в более поздней операции',
            (select u.code from item_units u where u.id = ev.unit_id);
        end if;
      end loop;
    end if;
  end loop;

  for m in
    select * from stock_moves x
    where x.doc_id = p_doc and x.reverses_id is null
      and not exists (select 1 from stock_moves y where y.reverses_id = x.id)
    order by x.id
  loop
    select i.track_units into v_tracked from items i where i.id = m.item_id;
    if coalesce(v_tracked, false) then
      begin
        perform set_config('app.unit_move_ok', 'on', true);
        v_rev := _insert_move(m.item_id, m.to_loc, m.from_loc, m.qty, m.unit_cost, 'doc_void',
                              p_doc::text, m.apartment_id, m.staff_id, p_doc, p_reason, m.moved_at, m.id);
        perform set_config('app.unit_move_ok', 'off', true);
      exception when others then
        perform set_config('app.unit_move_ok', 'off', true);
        raise;
      end;
      select l.type into v_from_type from locations l where l.id = m.from_loc;
      update item_units u
         set location_id = m.from_loc,
             status = case when v_from_type in ('warehouse', 'owner_stock') then 'in_stock'
                           when v_from_type in ('apartment', 'holder') then 'issued'
                           else 'written_off' end
       where u.id in (select e.unit_id from unit_events e where e.move_id = m.id);
      insert into unit_events(unit_id, event, from_loc, to_loc, doc_id, move_id, note)
      select e.unit_id, 'void', m.to_loc, m.from_loc, p_doc, v_rev, p_reason
      from unit_events e where e.move_id = m.id;
    else
      perform _insert_move(m.item_id, m.to_loc, m.from_loc, m.qty, m.unit_cost, 'doc_void',
                           p_doc::text, m.apartment_id, m.staff_id, p_doc, p_reason, m.moved_at, m.id);
    end if;
    v_n := v_n + 1;
  end loop;

  update documents
     set status = 'void',
         note = case when p_reason is null or btrim(p_reason) = '' then note
                     else coalesce(note || E'\n', '') || 'Отмена: ' || btrim(p_reason) end
   where id = p_doc;
  return jsonb_build_object('doc_id', p_doc, 'reversed', v_n);
end $$;

revoke all on function public.void_document(uuid, text) from public, anon;
grant execute on function public.void_document(uuid, text) to authenticated;
