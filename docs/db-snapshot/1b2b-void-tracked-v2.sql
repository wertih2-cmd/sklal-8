-- 1B-2b: void_document для документов с поштучными товарами.
-- Сигнатура и права не меняются. Поведение для обычных товаров прежнее.
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

  -- Поштучный учёт: проверка до любых изменений.
  for m in
    select * from stock_moves x
    where x.doc_id = p_doc and x.reverses_id is null
      and not exists (select 1 from stock_moves y where y.reverses_id = x.id)
    order by x.id
  loop
    select i.track_units into v_tracked from items i where i.id = m.item_id;
    if coalesce(v_tracked, false) then
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
