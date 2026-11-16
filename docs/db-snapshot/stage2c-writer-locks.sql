-- Этап 2c. Блокировки писателей остатков: общий хелпер _lock_items и его вызов в писателях.
-- Откат: docs/db-snapshot/stage2c-writer-locks-rollback.sql
-- Что меняет (сигнатуры не меняются, права на функции сохраняются):
--  0) _lock_items(int[]): pg_advisory_xact_lock(7101, item_id) по возрастанию, без повторов (тот же ключ, что в post_move, этап 2b).
--  1) void_document: блокирует товары документа до проверки остатка для сторно.
--  2) inventory_close: блокирует товары инвентаризации; недостача не списывается в минус, если остаток после пересчёта уменьшился
--     (ошибка «Остаток ... изменился после пересчёта», позицию нужно пересчитать).
--  3) transfer_stock, transfer_company_owner: блокируют товары строк до проверки остатка источника.
--  4) issue_missing_to_apartment: блокирует позиции нормы квартиры до расчёта «сколько можно выдать».
--  5) approve_incident: заявка читается FOR UPDATE (два подтверждения не спишут товар дважды); товар блокируется до проверки остатка.
--  6) post_document: все товары документа блокируются заранее в одном порядке (иначе post_move в цикле мог дать deadlock
--     с писателями, которые берут блокировки списком).
--  7) enable_unit_tracking: блокирует товар до пересчёта остатков в поштучные единицы.
-- Не входят (осознанно): _post_cleaning_lines и _reverse_cleaning_moves (уборка допускает минус и пишет событие нехватки),
--  _insert_move (сам остаток не проверяет), po_receive (идёт через post_document).
-- Блокировка на товар общая для всех локаций: параллельные операции с одним товаром ждут друг друга до конца транзакции.
-- Идемпотентно: CREATE OR REPLACE, повторный запуск безопасен.

create or replace function public._lock_items(p_items int[]) returns void
language plpgsql set search_path = public as $$
declare v_id int;
begin
  -- Транзакционные advisory-блокировки (7101, item_id): один и тот же ключ у post_move и всех писателей ниже.
  -- Всегда по возрастанию item_id и без повторов: одинаковый порядок исключает взаимные блокировки.
  for v_id in select distinct x from unnest(p_items) x where x is not null order by 1 loop
    perform pg_advisory_xact_lock(7101, v_id);
  end loop;
end $$;

revoke all on function public._lock_items(int[]) from public, anon, authenticated;

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

  -- Этап 2c: сериализация по товару (общий ключ с post_move, 7101), порядок по возрастанию item_id.
  perform _lock_items(array(select x.item_id from stock_moves x where x.doc_id = p_doc and x.reverses_id is null));

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
  -- Этап 2c: сериализация по товару (общий ключ с post_move, 7101), порядок по возрастанию item_id.
  perform _lock_items(array(select l.item_id from inventory_lines l where l.inventory_id = p_inventory));
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
    -- Этап 2c: недостачу нельзя списать в минус, если остаток изменился после пересчёта.
    if v_delta < 0 and _bal(v_loc, r.item_id) < -v_delta then
      select name into v_name from items where id = r.item_id;
      raise exception 'Остаток «%» изменился после пересчёта: недостача %, на месте %. Пересчитайте позицию',
        v_name, -v_delta, _bal(v_loc, r.item_id);
    end if;
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
  -- Этап 2c: сериализация по товару (общий ключ с post_move, 7101), порядок по возрастанию item_id.
  perform _lock_items(array(select (e->>'item_id')::int from jsonb_array_elements(p_lines) e));
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

  -- Этап 2c: сериализация по товару (общий ключ с post_move, 7101), порядок по возрастанию item_id.
  perform _lock_items(array(select (e->>'item_id')::int from jsonb_array_elements(p_lines) e));
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

create or replace function public.issue_missing_to_apartment(p_apartment int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record; v_doc uuid; v_number text; v_give numeric; v_avail numeric;
  v_wh int := _loc_singleton('warehouse'); v_apt int := _loc_apartment(p_apartment);
  v_issued jsonb := '[]'; v_short jsonb := '[]';
  v_is_owner boolean; v_is_asset boolean; v_src int;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if v_apt is null then raise exception 'Квартира не найдена'; end if;
  select is_owner into v_is_owner from apartments where id = p_apartment;
  -- Этап 2c: сериализация по товару (общий ключ с post_move, 7101), порядок по возрастанию item_id.
  -- Берём все позиции нормы квартиры (не только с gap > 0): набор нехватки мог измениться при ожидании.
  perform _lock_items(array(select g.item_id from apartment_gap g where g.apartment_id = p_apartment));
  for r in select g.item_id, g.name, g.gap from apartment_gap g
           where g.apartment_id = p_apartment and g.gap > 0 order by g.name
  loop
    select c.kind = 'asset' into v_is_asset
      from items i join categories c on c.id = i.category_id where i.id = r.item_id;
    if v_is_owner and v_is_asset then
      v_src := _loc_owner_stock(p_apartment);
    else
      v_src := v_wh;
    end if;
    v_avail := greatest(_bal(v_src, r.item_id), 0);
    v_give  := least(r.gap, v_avail);
    if v_give > 0 then
      if v_doc is null then
        v_number := _next_doc_number('issue');
        insert into documents(doc_type, number, note)
        values ('issue', v_number, 'Выдача в апартамент ' || (select code from apartments where id = p_apartment))
        returning id into v_doc;
      end if;
      perform _insert_move(r.item_id, v_src, v_apt, v_give, null, 'manual', 'issue_missing',
                           p_apartment, null, v_doc, null, now(), null);
      v_issued := v_issued || jsonb_build_object('item_id', r.item_id, 'name', r.name, 'qty', v_give);
    end if;
    if v_give < r.gap then
      v_short := v_short || jsonb_build_object('item_id', r.item_id, 'name', r.name,
                                               'need', r.gap, 'issued', v_give);
    end if;
  end loop;
  return jsonb_build_object('doc_id', v_doc, 'doc_number', v_number, 'issued', v_issued, 'short', v_short);
end $$;

create or replace function public.approve_incident(p_incident uuid, p_decision text, p_note text default null,
                                        p_force boolean default false, p_charge jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  i incidents%rowtype; v_move bigint; v_apt int;
  v_base numeric; v_coef numeric; v_amount numeric;
  v_base_source text; v_coef_source text;
  v_owner int; v_move_rec stock_moves%rowtype;
  v_item_tenant numeric; v_cat_tenant numeric;
  v_mgr boolean := not is_admin();
begin
  if not (is_admin() or is_manager()) then raise exception 'Только администратор или менеджер' using errcode = '42501'; end if;
  -- Этап 2c: строка заявки блокируется, чтобы два параллельных подтверждения не списали товар дважды.
  select * into i from incidents where id = p_incident for update;
  if not found or i.status not in ('new','in_progress') then
    raise exception 'Заявка не найдена или уже обработана';
  end if;

  if p_decision = 'reject' then
    update incidents set status = 'rejected', resolved_by = auth.uid(), resolved_at = now(), resolution_note = p_note
     where id = p_incident;
    return jsonb_build_object('status', 'rejected');
  elsif p_decision <> 'confirm' then
    raise exception 'Решение должно быть confirm или reject';
  end if;

  -- менеджер: подтверждает только заявки без позиции, без списания и без начисления
  if v_mgr then
    if p_charge is not null or p_force then
      raise exception 'Списание и начисление доступны только администратору' using errcode = '42501';
    end if;
    if i.item_id is not null then
      raise exception 'Заявку с позицией подтверждает администратор' using errcode = '42501';
    end if;
    update incidents set status = 'confirmed', resolved_by = auth.uid(), resolved_at = now(), resolution_note = p_note
     where id = p_incident;
    return jsonb_build_object('status', 'confirmed', 'move_id', null);
  end if;

  if i.item_id is not null then
    v_apt := _loc_apartment(i.apartment_id);
  -- Этап 2c: сериализация по товару (общий ключ с post_move, 7101), порядок по возрастанию item_id.
    perform _lock_items(array[i.item_id]);
    if not p_force and _bal(v_apt, i.item_id) < i.qty then raise exception 'Нет в апартаменте'; end if;
    v_move := _insert_move(i.item_id, v_apt, _loc_singleton('sink'), i.qty, null, 'incident', i.id::text,
                           i.apartment_id, null, null, i.kind::text || ': ' || coalesce(i.comment, ''), now(), null);
  end if;

  update incidents set status = 'confirmed', resolved_by = auth.uid(), resolved_at = now(),
                       resolution_note = p_note, writeoff_move_id = v_move where id = p_incident;

  -- charge
  if p_charge is not null then
    -- base_cost
    if p_charge ? 'base_cost' and (p_charge->>'base_cost') is not null then
      v_base := (p_charge->>'base_cost')::numeric;
      v_base_source := 'manual';
    elsif v_move is not null then
      select * into v_move_rec from stock_moves where id = v_move;
      if v_move_rec.unit_cost is null then
        raise exception 'Укажите закупочную цену';
      end if;
      v_base := v_move_rec.unit_cost;
      if v_move_rec.owner_apartment_id is not null then
        v_base_source := 'owner';
      else
        v_base_source := 'company';
      end if;
    else
      raise exception 'Укажите закупочную цену';
    end if;

    -- coef: explicit → items → categories
    if p_charge ? 'coef' and (p_charge->>'coef') is not null then
      v_coef := (p_charge->>'coef')::numeric;
      v_coef_source := 'manual';
    else
      select coef into v_item_tenant from tenant_coefs where item_id = i.item_id;
      if v_item_tenant is not null then
        v_coef := v_item_tenant;
        v_coef_source := 'item';
      else
        select tc.coef into v_cat_tenant
          from items i2 join tenant_coefs tc on tc.category_id = i2.category_id where i2.id = i.item_id;
        if v_cat_tenant is not null then
          v_coef := v_cat_tenant;
          v_coef_source := 'category';
        else
          raise exception 'Не задан коэффициент для жильцов: укажите его в заявке или в каталоге';
        end if;
      end if;
    end if;

    if v_coef is null or v_coef <= 0 then
      raise exception 'Не задан коэффициент для жильцов: укажите его в заявке или в каталоге';
    end if;

    v_amount := round(i.qty * v_base * v_coef, 2);

    insert into incident_charges(incident_id, tenant_note, base_cost, base_source, coef, amount, status, created_by)
    values (p_incident, p_charge->>'tenant_note', v_base, v_base_source, v_coef, v_amount, 'pending', auth.uid())
    on conflict (incident_id) do nothing;
  end if;

  return jsonb_build_object('status', 'confirmed', 'move_id', v_move);
end $$;

CREATE OR REPLACE FUNCTION public.post_document(
  p_op text,
  p_lines jsonb,
  p_apartment integer DEFAULT NULL,
  p_staff integer DEFAULT NULL,
  p_supplier integer DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_doc_date date DEFAULT NULL,
  p_owner_apartment integer DEFAULT NULL
)
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
  v_unit_ids uuid[];
  v_line jsonb; v_item_n numeric;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Нет позиций';
  end if;
  -- Этап 2b: каждая исходная строка проверяется ДО агрегации по товару
  -- (иначе строка с минусом гасится плюсовой, а пропущенное qty молча выпадает из суммы).
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) is distinct from 'object'
       or jsonb_typeof(v_line->'item_id') is distinct from 'number'
       or jsonb_typeof(v_line->'qty') is distinct from 'number' then
      raise exception 'Некорректная строка документа';
    end if;
    v_item_n := (v_line->>'item_id')::numeric;
    if v_item_n <> trunc(v_item_n) then raise exception 'Некорректная строка документа'; end if;
    if (v_line->>'qty')::numeric <= 0 then raise exception 'Количество в строке должно быть больше нуля'; end if;
    if jsonb_typeof(v_line->'unit_cost') is not null and jsonb_typeof(v_line->'unit_cost') <> 'null' then
      if jsonb_typeof(v_line->'unit_cost') <> 'number' or (v_line->>'unit_cost')::numeric < 0 then
        raise exception 'Стоимость не может быть отрицательной';
      end if;
    end if;
  end loop;
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
  -- Этап 2c: сериализация по товару (общий ключ с post_move, 7101), порядок по возрастанию item_id.
  -- Все товары документа берутся заранее в одном порядке: иначе post_move в цикле мог бы дать взаимную блокировку.
  perform _lock_items(array(select (e->>'item_id')::int from jsonb_array_elements(p_lines) e));
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
    -- collect serials per item (receipt only, unchanged)
    select array_agg(s) into v_serials
    from jsonb_array_elements(p_lines) e,
         jsonb_array_elements_text(coalesce(e->'serials', '[]'::jsonb)) s
    where (e->>'item_id')::int = r.item_id;

    -- collect unit_ids per item
    select array_agg(u::uuid) into v_unit_ids
    from jsonb_array_elements(p_lines) e,
         jsonb_array_elements_text(coalesce(e->'unit_ids', '[]'::jsonb)) u
    where (e->>'item_id')::int = r.item_id;

    perform post_move(p_op, r.item_id, r.qty, p_apartment, p_staff, v_doc, r.cost, p_note, v_moved, p_owner_apartment, v_serials, v_unit_ids);
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

-- Этап 2c: параллельные движения по товару не должны менять остатки между расчётом единиц и включением.
perform _lock_items(array[p_item]);
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
