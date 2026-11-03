-- Migration: item_cost_corrections table and avg_cost/owner_avg_cost enhancement
-- Applied via mcp__supabase__apply_migration as 20261101150000_item_cost_corrections.sql

CREATE TABLE IF NOT EXISTS item_cost_corrections (
  id bigserial PRIMARY KEY,
  item_id int NOT NULL REFERENCES items(id),
  owner_apartment_id int NULL REFERENCES apartments(id),
  unit_cost numeric(16,6) NOT NULL CHECK (unit_cost >= 0),
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_cost_corrections_lookup
  ON item_cost_corrections (item_id, owner_apartment_id, id DESC);

ALTER TABLE item_cost_corrections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON item_cost_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON item_cost_corrections TO authenticated;

DROP POLICY IF EXISTS "select_item_cost_corrections" ON item_cost_corrections;
CREATE POLICY "select_item_cost_corrections"
  ON item_cost_corrections FOR SELECT
  TO authenticated
  USING (is_admin());

CREATE OR REPLACE FUNCTION public.forbid_item_cost_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'item_cost_corrections is append-only';
END;
$function$;

DROP TRIGGER IF EXISTS trg_forbid_mutation ON item_cost_corrections;
CREATE TRIGGER trg_forbid_mutation
  BEFORE UPDATE OR DELETE ON item_cost_corrections
  FOR EACH ROW EXECUTE FUNCTION public.forbid_item_cost_mutation();

REVOKE ALL ON FUNCTION public.forbid_item_cost_mutation() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.avg_cost(p_item integer)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
with correction as (
  select c.unit_cost
  from item_cost_corrections c
  where c.item_id = p_item and c.owner_apartment_id is null
  order by c.id desc
  limit 1
)
select sum(m.qty * coalesce(m.unit_cost, (select unit_cost from correction))) / nullif(sum(m.qty), 0)
from stock_moves m join locations l on l.id = m.to_loc
where m.item_id = p_item and l.type = 'warehouse' and m.reverses_id is null
and not exists (select 1 from stock_moves r where r.reverses_id = m.id)
and (
  m.unit_cost is not null
  or (m.unit_cost is null and exists (select 1 from correction))
)
$function$;

CREATE OR REPLACE FUNCTION public.owner_avg_cost(p_item integer, p_apartment integer)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
with correction as (
  select c.unit_cost
  from item_cost_corrections c
  where c.item_id = p_item and c.owner_apartment_id = p_apartment
  order by c.id desc
  limit 1
)
select sum(m.qty * coalesce(m.unit_cost, (select unit_cost from correction))) / nullif(sum(m.qty), 0)
from stock_moves m join locations l on l.id = m.to_loc
where m.item_id = p_item
and m.reverses_id is null
and not exists (select 1 from stock_moves r where r.reverses_id = m.id)
and (
  (l.type = 'owner_stock' and l.owner_apartment_id = p_apartment)
  or
  (l.type = 'apartment' and l.apartment_id = p_apartment)
)
and (
  m.unit_cost is not null
  or (m.unit_cost is null and exists (select 1 from correction))
)
$function$;

CREATE OR REPLACE FUNCTION public.set_item_cost(
  p_item int,
  p_cost numeric,
  p_note text DEFAULT null,
  p_owner_apartment int DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_active boolean;
  v_is_owner boolean;
  v_avg_after numeric;
  v_uncosted numeric;
begin
  if not is_admin() then
    raise exception 'Только администратор' using errcode = '42501';
  end if;

  if p_cost is null or p_cost < 0 then
    raise exception 'Цена должна быть неотрицательной' using errcode = '23514';
  end if;

  select active into v_active from items where id = p_item;
  if not found or not v_active then
    raise exception 'Товар не найден или неактивен' using errcode = '42501';
  end if;

  if p_owner_apartment is not null then
    select is_owner into v_is_owner from apartments where id = p_owner_apartment;
    if not found or not v_is_owner then
      raise exception 'Квартира не является owner-квартирой' using errcode = '42501';
    end if;
  end if;

  insert into item_cost_corrections (item_id, owner_apartment_id, unit_cost, note)
  values (p_item, p_owner_apartment, p_cost, p_note);

  if p_owner_apartment is not null then
    select owner_avg_cost(p_item, p_owner_apartment) into v_avg_after;
  else
    select avg_cost(p_item) into v_avg_after;
  end if;

  with uncosted as (
    select m.qty
    from stock_moves m join locations l on l.id = m.to_loc
    where m.item_id = p_item and m.unit_cost is null and m.reverses_id is null
    and not exists (select 1 from stock_moves r where r.reverses_id = m.id)
    and (
      (p_owner_apartment is null and l.type = 'warehouse')
      or
      (p_owner_apartment is not null and (
        (l.type = 'owner_stock' and l.owner_apartment_id = p_owner_apartment)
        or
        (l.type = 'apartment' and l.apartment_id = p_owner_apartment)
      ))
    )
  )
  select coalesce(sum(qty), 0) into v_uncosted from uncosted;

  return jsonb_build_object(
    'item_id', p_item,
    'owner_apartment_id', p_owner_apartment,
    'unit_cost', p_cost,
    'avg_cost_after', v_avg_after,
    'uncosted_qty', v_uncosted
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.set_item_cost(int, numeric, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_item_cost(int, numeric, text, int) TO authenticated;
