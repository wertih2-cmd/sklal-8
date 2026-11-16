-- Fix: rename table alias e -> el in post_document to resolve ambiguity with local variable e jsonb.
-- The stage2b migration added a local variable `e jsonb` for per-line validation, but the
-- aggregate queries below still used `e` as a table alias from jsonb_array_elements, causing
-- "column reference e is ambiguous" at runtime. Only table aliases are renamed; logic unchanged.

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
  e jsonb; v_item_n numeric;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Нет позиций';
  end if;
  -- Этап 2b: каждая исходная строка проверяется ДО агрегации по товару
  -- (иначе строка с минусом гасится плюсовой, а пропущенное qty молча выпадает из суммы).
  for e in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(e) is distinct from 'object'
       or jsonb_typeof(e->'item_id') is distinct from 'number'
       or jsonb_typeof(e->'qty') is distinct from 'number' then
      raise exception 'Некорректная строка документа';
    end if;
    v_item_n := (e->>'item_id')::numeric;
    if v_item_n <> trunc(v_item_n) then raise exception 'Некорректная строка документа'; end if;
    if (e->>'qty')::numeric <= 0 then raise exception 'Количество в строке должно быть больше нуля'; end if;
    if jsonb_typeof(e->'unit_cost') is not null and jsonb_typeof(e->'unit_cost') <> 'null' then
      if jsonb_typeof(e->'unit_cost') <> 'number' or (e->>'unit_cost')::numeric < 0 then
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
  v_number := _next_doc_number(v_type);
  insert into documents(doc_type, number, doc_date, supplier_id, note)
  values (v_type, v_number, v_date, case when p_op = 'receipt' then p_supplier end, p_note)
  returning id into v_doc;

  for r in
  select (el->>'item_id')::int as item_id,
    sum((el->>'qty')::numeric) as qty,
    sum((el->>'qty')::numeric * (el->>'unit_cost')::numeric) filter (where el->>'unit_cost' is not null)
      / nullif(sum((el->>'qty')::numeric) filter (where el->>'unit_cost' is not null), 0) as cost
  from jsonb_array_elements(p_lines) el
  group by 1 order by 1
  loop
    -- collect serials per item (receipt only, unchanged)
    select array_agg(s) into v_serials
    from jsonb_array_elements(p_lines) el,
         jsonb_array_elements_text(coalesce(el->'serials', '[]'::jsonb)) s
    where (el->>'item_id')::int = r.item_id;

    -- collect unit_ids per item
    select array_agg(u::uuid) into v_unit_ids
    from jsonb_array_elements(p_lines) el,
         jsonb_array_elements_text(coalesce(el->'unit_ids', '[]'::jsonb)) u
    where (el->>'item_id')::int = r.item_id;

    perform post_move(p_op, r.item_id, r.qty, p_apartment, p_staff, v_doc, r.cost, p_note, v_moved, p_owner_apartment, v_serials, v_unit_ids);
    v_total := v_total + r.qty * coalesce(case when p_op = 'receipt' then r.cost end, 0);
    v_n := v_n + 1;
  end loop;
  if p_op = 'receipt' then update documents set total_cost = v_total where id = v_doc; end if;

  if p_op = 'receipt' and p_owner_apartment is not null and p_apartment is not null then
    if p_owner_apartment <> p_apartment then
      raise exception 'owner-квартира и квартира выдачи должны совпадать';
    end if;
    if exists (select 1 from items i where i.track_units and i.id in (select (el->>'item_id')::int from jsonb_array_elements(p_lines) el)) then
      raise exception 'Для поштучного учёта выдача в квартиру в одном документе с приходом пока недоступна';
    end if;
    v_apt_loc := _loc_apartment(p_apartment);
    for r in
    select (el->>'item_id')::int as item_id,
      sum((el->>'qty')::numeric) as qty
    from jsonb_array_elements(p_lines) el
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
GRANT EXECUTE ON FUNCTION public.post_document(text, jsonb, integer, integer, integer, text, date, integer) TO authenticated, service_role;