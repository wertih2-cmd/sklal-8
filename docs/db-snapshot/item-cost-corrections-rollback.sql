-- Rollback for item_cost_corrections migration.
-- НЕ ВЫПОЛНЯТЬ. Содержит текущие определения avg_cost и owner_avg_cost
-- (до миграции) и SQL отката всех изменений.

-- Текущее определение avg_cost(integer):
-- CREATE OR REPLACE FUNCTION public.avg_cost(p_item integer)
--  RETURNS numeric
--  LANGUAGE sql
--  STABLE
--  SET search_path TO 'public'
-- AS $function$
-- select sum(m.qty * m.unit_cost) / nullif(sum(m.qty), 0)
-- from stock_moves m join locations l on l.id = m.to_loc
-- where m.item_id = p_item and l.type = 'warehouse' and m.unit_cost is not null and m.reverses_id is null
-- and not exists (select 1 from stock_moves r where r.reverses_id = m.id)
-- $function$

-- Текущее определение owner_avg_cost(integer,integer):
-- CREATE OR REPLACE FUNCTION public.owner_avg_cost(p_item integer, p_apartment integer)
--  RETURNS numeric
--  LANGUAGE sql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- select sum(m.qty * m.unit_cost) / nullif(sum(m.qty), 0)
-- from stock_moves m join locations l on l.id = m.to_loc
-- where m.item_id = p_item
-- and m.unit_cost is not null
-- and m.reverses_id is null
-- and not exists (select 1 from stock_moves r where r.reverses_id = m.id)
-- and (
-- (l.type = 'owner_stock' and l.owner_apartment_id = p_apartment)
-- or
-- (l.type = 'apartment' and l.apartment_id = p_apartment)
-- )
-- $function$

-- === SQL ОТКАТА ===

-- 1. Восстановить avg_cost в исходный вид (без коррекций)
CREATE OR REPLACE FUNCTION public.avg_cost(p_item integer)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
select sum(m.qty * m.unit_cost) / nullif(sum(m.qty), 0)
from stock_moves m join locations l on l.id = m.to_loc
where m.item_id = p_item and l.type = 'warehouse' and m.unit_cost is not null and m.reverses_id is null
and not exists (select 1 from stock_moves r where r.reverses_id = m.id)
$function$;

-- 2. Восстановить owner_avg_cost в исходный вид (без коррекций)
CREATE OR REPLACE FUNCTION public.owner_avg_cost(p_item integer, p_apartment integer)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
select sum(m.qty * m.unit_cost) / nullif(sum(m.qty), 0)
from stock_moves m join locations l on l.id = m.to_loc
where m.item_id = p_item
and m.unit_cost is not null
and m.reverses_id is null
and not exists (select 1 from stock_moves r where r.reverses_id = m.id)
and (
(l.type = 'owner_stock' and l.owner_apartment_id = p_apartment)
or
(l.type = 'apartment' and l.apartment_id = p_apartment)
)
$function$;

-- 3. Удалить RPC set_item_cost
DROP FUNCTION IF EXISTS public.set_item_cost(integer, numeric, text, integer);

-- 4. Удалить триггер и функцию запрета мутаций
DROP TRIGGER IF EXISTS trg_forbid_mutation ON item_cost_corrections;
DROP FUNCTION IF EXISTS public.forbid_item_cost_mutation();

-- 5. Удалить RLS-политики и саму таблицу
DROP POLICY IF EXISTS "select_item_cost_corrections" ON item_cost_corrections;
DROP TABLE IF EXISTS item_cost_corrections;
