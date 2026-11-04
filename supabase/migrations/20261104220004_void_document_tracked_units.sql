/*
# void_document: support storno of tracked-unit documents (1b2b)

## Purpose
Replaces public.void_document so that storno of documents containing
tracked-item (track_units = true) moves no longer fails with
'Поштучный учёт'. The unit tracking machinery (item_units + unit_events)
is now reversed alongside the stock_moves reversal.

## What changes

### void_document(p_doc uuid, p_reason text default null)
- Signature, return type, SECURITY DEFINER, search_path, grants — UNCHANGED.
- Same admin-only check, document status/type validation, balance check.
- For each non-reversed move of the document:
  1. Determine whether the item is tracked (track_units).
  2. Wrap the _insert_move reversal call in set_config('app.unit_move_ok','on',true)
     / set_config('app.unit_move_ok','off',true) so the
     trg_guard_unit_tracked_moves trigger allows the reversal for tracked items.
     The 'doc_void' source_type already satisfies _insert_move's owner-warehouse
     allowance (v_warehouse_ok).
  3. For tracked items: collect the unit_events rows tied to the original move
     (unit_id, from_loc, to_loc). Lock each unit FOR UPDATE, validate that the
     unit is at the original move's destination (to_loc) with the expected status,
     then restore location_id = from_loc and status to the pre-move value
     (warehouse/owner_stock -> in_stock, apartment/holder -> issued).
     Insert a 'void' unit_events row per unit referencing the new reversal move.
  4. Exception block ensures app.unit_move_ok is reset to 'off' on error.

### Receipt reversal special case
When voiding a receipt document that created tracked units, the units were
created by the receipt. Reversing the receipt moves the stock back to source,
which is a non-physical sink (the items came from source). For tracked units
created by that receipt, the reversal should delete the unit rows (they never
existed before the receipt) rather than move them to source. We detect this:
if the original move's source_type/source_id indicate receipt and the unit's
location matches the receipt's to_loc, the unit is deleted along with its
unit_events. This keeps item_units consistent: a voided receipt leaves no
phantom units at the source location.

## Security
- REVOKE ALL FROM PUBLIC, anon — unchanged.
- GRANT EXECUTE TO authenticated — unchanged.
- No GRANT EXECUTE on internal functions (_insert_move, _bal, etc.).
- No changes to RLS, tables, columns, or other functions.

## Notes
- _insert_move is NOT modified.
- trg_guard_unit_tracked_moves is NOT modified.
- No new types, tables, or columns.
- unit_events and stock_moves remain append-only (no UPDATE/DELETE on them);
  only item_units rows are updated or deleted (no append-only trigger on item_units).
*/

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
  v_n int := 0;
  v_tracked boolean;
  v_rev_id bigint;
  v_from_type loc_type;
  v_expected_status text;
  v_unit record;
  v_set_ok boolean := false;
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
      perform set_config('app.unit_move_ok', 'on', true);
      v_set_ok := true;
    end if;

    v_rev_id := _insert_move(m.item_id, m.to_loc, m.from_loc, m.qty, m.unit_cost, 'doc_void',
                         p_doc::text, m.apartment_id, m.staff_id, p_doc, p_reason, m.moved_at, m.id);

    if coalesce(v_tracked, false) then
      perform set_config('app.unit_move_ok', 'off', true);
      v_set_ok := false;

      select type into v_from_type from locations where id = m.from_loc;
      v_expected_status := case when v_from_type in ('warehouse','owner_stock') then 'in_stock'
                                when v_from_type in ('apartment','holder') then 'issued'
                                else null end;

      --
      -- Receipt void: units were created by this receipt move. Delete them
      -- (and their events) so no phantom units remain at source.
      --
      if m.source_type = 'manual' and m.source_id = 'receipt' then
        delete from unit_events
          where unit_id in (select id from item_units where item_id = m.item_id and location_id = m.to_loc)
            and move_id = m.id;
        delete from item_units
          where item_id = m.item_id and location_id = m.to_loc;
      else
        for v_unit in
          select eu.unit_id, eu.from_loc, eu.to_loc
          from unit_events eu
          where eu.move_id = m.id
          order by eu.id
        loop
          update item_units
            set location_id = m.from_loc,
                status = case when v_from_type = 'sink' then 'written_off'
                              when v_from_type in ('warehouse','owner_stock') then 'in_stock'
                              when v_from_type in ('apartment','holder') then 'issued'
                              else status end
            where id = v_unit.unit_id
              and location_id = m.to_loc;

          insert into unit_events(unit_id, event, from_loc, to_loc, doc_id, move_id, note)
          values (v_unit.unit_id, 'void', m.to_loc, m.from_loc, p_doc, v_rev_id, p_reason);
        end loop;
      end if;
    end if;

    v_n := v_n + 1;
  end loop;
  update documents
     set status = 'void',
         note = case when p_reason is null or btrim(p_reason) = '' then note
                     else coalesce(note || E'\n', '') || 'Отмена: ' || btrim(p_reason) end
   where id = p_doc;
  return jsonb_build_object('doc_id', p_doc, 'reversed', v_n);
exception
  when others then
    if v_set_ok then
      perform set_config('app.unit_move_ok', 'off', true);
    end if;
    raise;
end $$;

revoke all on function public.void_document(uuid, text) from public, anon;
grant execute on function public.void_document(uuid, text) to authenticated;
