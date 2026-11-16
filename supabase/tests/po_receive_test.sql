-- Этап 2a: приёмка по заказу (po_receive). Приёмка сверх заказа РАЗРЕШЕНА (решение владельца).
-- Проверяет: приёмку сверх заказа, закрытие заказа, отклонение некорректных строк без частичных записей,
-- CHECK неотрицательной стоимости. Скрипт сам откатывает данные: в конце падает с ошибкой "ОТЧЁТ".
create or replace function pg_temp.r(n text, c boolean) returns text language sql as
$$ select case when coalesce(c, false) then 'OK    ' else 'FAIL  ' end || n || E'\n' $$;

do $$
declare
  v_admin uuid; rep text := ''; v_cat int; v_sup int; v_A int; v_B int;
  v_o1 uuid; v_o2 uuid; v_o3 uuid; j jsonb; v_msg text; v_state text; v_bal numeric; v_rec numeric; v_moves int;
  v_has boolean;
begin
  select id into v_admin from profiles where role = 'admin' and active limit 1;
  if v_admin is null then
    v_admin := gen_random_uuid();
    insert into auth.users(id, email) values (v_admin, 'zz-po-admin@example.invalid');
    insert into profiles(id, login, full_name, role) values (v_admin, 'zz-po-admin', 'ZZ PO Admin', 'admin');
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  insert into categories(name, kind) values ('ZZ PO актив', 'asset') returning id into v_cat;
  insert into suppliers(name) values ('ZZ PO поставщик') returning id into v_sup;
  insert into items(category_id, name) values (v_cat, 'ZZ PO-A') returning id into v_A;
  insert into items(category_id, name) values (v_cat, 'ZZ PO-B') returning id into v_B;

  select exists (select 1 from pg_constraint where conname = 'stock_moves_unit_cost_nonneg' and convalidated) into v_has;
  rep := rep || pg_temp.r('S0 CHECK stock_moves_unit_cost_nonneg есть и проверен (иначе миграция не применена)', v_has);
  if not v_has then raise exception E'ОТЧЁТ (миграция po-receive-validation.sql не применена):\n%', rep; end if;

  -- заказ 1: A 10 шт, B 4 шт
  insert into purchase_orders(number, supplier_id, status) values ('ZZ-PO-1', v_sup, 'draft') returning id into v_o1;
  perform po_set_line(v_o1, v_A, 10, 5);
  perform po_set_line(v_o1, v_B, 4, 7);
  perform po_set_status(v_o1, 'sent');

  -- T1: приёмка сверх заказа разрешена: A 12 при заказе 10
  j := po_receive(v_o1, jsonb_build_array(jsonb_build_object('item_id', v_A, 'qty', 12, 'unit_cost', 5)));
  select received_qty into v_rec from purchase_order_lines where order_id = v_o1 and item_id = v_A;
  rep := rep || pg_temp.r('T1 приёмка сверх заказа: received_qty A = 12 при заказе 10', v_rec = 12);
  rep := rep || pg_temp.r('T1 заказ остаётся отправленным (B ещё не принят)',
    (select status = 'sent' from purchase_orders where id = v_o1));
  select qty into v_bal from stock_balance where loc_id = _loc_singleton('warehouse') and item_id = v_A;
  rep := rep || pg_temp.r('T1 на складе A = 12', v_bal = 12);

  -- T2: дозакрытие B -> заказ получен (A уже >= заказанного)
  j := po_receive(v_o1, jsonb_build_array(jsonb_build_object('item_id', v_B, 'qty', 4)));
  rep := rep || pg_temp.r('T2 заказ получен: ' || j::text, j->>'order_status' = 'received');

  -- заказ 2 для негативных проверок: A 10 шт
  insert into purchase_orders(number, supplier_id, status) values ('ZZ-PO-2', v_sup, 'draft') returning id into v_o2;
  perform po_set_line(v_o2, v_A, 10, 5);
  perform po_set_status(v_o2, 'sent');
  select count(*) into v_moves from stock_moves where item_id = v_A;

  -- T3..T8: некорректные строки отклоняются
  v_msg := ''; begin perform po_receive(v_o2, jsonb_build_array(jsonb_build_object('item_id', v_A, 'qty', 0)));
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T3 qty = 0 отклонён: ' || v_msg, v_msg like 'Количество к приёмке%');

  v_msg := ''; begin perform po_receive(v_o2, jsonb_build_array(jsonb_build_object('item_id', v_A, 'qty', -3)));
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T4 qty < 0 отклонён: ' || v_msg, v_msg like 'Количество к приёмке%');

  v_msg := ''; begin perform po_receive(v_o2, jsonb_build_array(
      jsonb_build_object('item_id', v_A, 'qty', 10), jsonb_build_object('item_id', v_A, 'qty', -3)));
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T5 строка с минусом не гасится суммой: ' || v_msg, v_msg like 'Количество к приёмке%');

  v_msg := ''; begin perform po_receive(v_o2, jsonb_build_array(jsonb_build_object('item_id', v_A, 'qty', 5, 'unit_cost', -1)));
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T6 отрицательная стоимость отклонена: ' || v_msg, v_msg like 'Стоимость не может%');

  v_msg := ''; begin perform po_receive(v_o2, '{"item_id":1}'::jsonb);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T7 не массив отклонён: ' || v_msg, v_msg = 'Ожидается массив позиций');

  v_msg := ''; begin perform po_receive(v_o2, jsonb_build_array(jsonb_build_object('item_id', v_B, 'qty', 1)));
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('T8 позиция не из заказа отклонена: ' || v_msg, v_msg = 'Позиции нет в заказе');

  -- T9: после всех отказов ничего не записано
  select received_qty into v_rec from purchase_order_lines where order_id = v_o2 and item_id = v_A;
  rep := rep || pg_temp.r('T9 received_qty не изменился (0)', v_rec = 0);
  rep := rep || pg_temp.r('T9 новых движений по A нет', (select count(*) from stock_moves where item_id = v_A) = v_moves);

  -- T10: приёмка «всё остальное» (p_lines = null) проходит
  j := po_receive(v_o2);
  rep := rep || pg_temp.r('T10 приёмка без списка строк закрывает заказ: ' || j::text, j->>'order_status' = 'received');

  -- T11: CHECK: отрицательная стоимость в строке заказа
  insert into purchase_orders(number, supplier_id, status) values ('ZZ-PO-3', v_sup, 'draft') returning id into v_o3;
  v_state := '';
  begin perform po_set_line(v_o3, v_A, 5, -1);
  exception when others then v_state := sqlstate; end;
  rep := rep || pg_temp.r('T11 po_set_line с отрицательной ценой: нарушение CHECK (' || v_state || ')', v_state = '23514');

  -- T12: CHECK на движениях: приход с отрицательной стоимостью не проходит
  v_state := '';
  begin perform post_move(p_op => 'receipt', p_item => v_B, p_qty => 1, p_unit_cost => -5);
  exception when others then v_state := sqlstate; end;
  rep := rep || pg_temp.r('T12 приход с unit_cost < 0 отклонён (' || v_state || ')', v_state <> '');

  raise exception E'ОТЧЁТ (данные откатаны):\n%', rep;
end $$;
