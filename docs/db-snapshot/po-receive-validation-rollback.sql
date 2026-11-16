-- Откат Этапа 2a: возвращает po_receive из миграции 005 и удаляет CHECK-ограничения стоимости.
create or replace function po_receive(p_order uuid, p_lines jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o purchase_orders%rowtype; v_lines jsonb; v_res jsonb; e jsonb;
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
  if jsonb_array_length(v_lines) = 0 then raise exception 'Нечего принимать'; end if;
  for e in select * from jsonb_array_elements(v_lines) loop
    if not exists (select 1 from purchase_order_lines where order_id = p_order and item_id = (e->>'item_id')::int) then
      raise exception 'Позиции нет в заказе';
    end if;
  end loop;
  v_res := post_document('receipt', v_lines, null, null, o.supplier_id, 'Заказ ' || o.number);
  for e in select * from jsonb_array_elements(v_lines) loop
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
alter table public.stock_moves drop constraint if exists stock_moves_unit_cost_nonneg;
alter table public.purchase_order_lines drop constraint if exists purchase_order_lines_unit_cost_nonneg;
