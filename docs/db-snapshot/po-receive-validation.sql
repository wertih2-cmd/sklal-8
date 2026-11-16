-- Этап 2a. Закупки: проверка строк приёмки и неотрицательная стоимость.
-- Откат: docs/db-snapshot/po-receive-validation-rollback.sql
-- Решение владельца: приёмка сверх заказа РАЗРЕШЕНА, лимит received <= qty не вводится.
-- Что меняет:
--  1) po_receive: до проведения проверяются строки p_lines (массив объектов, item_id целое,
--     qty > 0, unit_cost пусто или >= 0). Остальная логика без изменений.
--  2) CHECK (unit_cost >= 0) на stock_moves и purchase_order_lines. Добавляются как NOT VALID
--     (действуют для новых строк сразу) и валидируются только если нарушений в данных нет.
-- Идемпотентно: повторный запуск безопасен.

create or replace function public.po_receive(p_order uuid, p_lines jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o purchase_orders%rowtype; v_lines jsonb; v_res jsonb; e jsonb; v_item_n numeric;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  select * into o from purchase_orders where id = p_order for update;
  if not found then raise exception 'Заказ не найден'; end if;
  if o.status <> 'sent' then raise exception 'Принимать можно только отправленный заказ'; end if;
  if p_lines is null then
    select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'qty', qty - received_qty,
                                                 'unit_cost', unit_cost)), '[]')
    into v_lines from purchase_order_lines where order_id = p_order and qty - received_qty > 0;
  else
    v_lines := p_lines;
  end if;
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'Ожидается массив позиций'; end if;
  if jsonb_array_length(v_lines) = 0 then raise exception 'Нечего принимать'; end if;
  for e in select value from jsonb_array_elements(v_lines) loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'item_id') <> 'number' or jsonb_typeof(e->'qty') <> 'number' then
      raise exception 'Некорректная строка приёмки';
    end if;
    v_item_n := (e->>'item_id')::numeric;
    if v_item_n <> trunc(v_item_n) then raise exception 'Некорректная строка приёмки'; end if;
    if (e->>'qty')::numeric <= 0 then raise exception 'Количество к приёмке должно быть больше нуля'; end if;
    if jsonb_typeof(e->'unit_cost') is not null and jsonb_typeof(e->'unit_cost') <> 'null' then
      if jsonb_typeof(e->'unit_cost') <> 'number' or (e->>'unit_cost')::numeric < 0 then
        raise exception 'Стоимость не может быть отрицательной';
      end if;
    end if;
    if not exists (select 1 from purchase_order_lines where order_id = p_order and item_id = (e->>'item_id')::int) then
      raise exception 'Позиции нет в заказе';
    end if;
  end loop;
  v_res := post_document('receipt', v_lines, null, null, o.supplier_id, 'Заказ ' || o.number);
  for e in select value from jsonb_array_elements(v_lines) loop
    update purchase_order_lines
    set received_qty = received_qty + (e->>'qty')::numeric,
        unit_cost = coalesce((e->>'unit_cost')::numeric, unit_cost)
    where order_id = p_order and item_id = (e->>'item_id')::int;
  end loop;
  if not exists (select 1 from purchase_order_lines where order_id = p_order and received_qty < qty) then
    update purchase_orders set status = 'received', received_at = now() where id = p_order;
  end if;
  return v_res || jsonb_build_object('order_status', (select status from purchase_orders where id = p_order));
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_moves_unit_cost_nonneg') then
    alter table public.stock_moves add constraint stock_moves_unit_cost_nonneg
      check (unit_cost is null or unit_cost >= 0) not valid;
  end if;
  if not exists (select 1 from public.stock_moves where unit_cost < 0) then
    alter table public.stock_moves validate constraint stock_moves_unit_cost_nonneg;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'purchase_order_lines_unit_cost_nonneg') then
    alter table public.purchase_order_lines add constraint purchase_order_lines_unit_cost_nonneg
      check (unit_cost is null or unit_cost >= 0) not valid;
  end if;
  if not exists (select 1 from public.purchase_order_lines where unit_cost < 0) then
    alter table public.purchase_order_lines validate constraint purchase_order_lines_unit_cost_nonneg;
  end if;
end $$;
