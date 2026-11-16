-- Этап 2b: проверка строк post_document до агрегации и блокировка по товару в post_move.
-- Негативные проверки первыми, после ошибок проверяется отсутствие частичных записей.
-- Скрипт сам откатывает данные: в конце падает с ошибкой "ОТЧЁТ".
create or replace function pg_temp.r(n text, c boolean) returns text language sql as
$$ select case when coalesce(c, false) then 'OK    ' else 'FAIL  ' end || n || E'\n' $$;

do $$
declare
  v_admin uuid; rep text := ''; v_cat int; v_sup int; v_A int;
  j jsonb; v_msg text; v_bal numeric; v_moves int; v_docs int; v_has boolean; v_locks int;
begin
  select id into v_admin from profiles where role = 'admin' and active limit 1;
  if v_admin is null then
    v_admin := gen_random_uuid();
    insert into auth.users(id, email) values (v_admin, 'zz-pd-admin@example.invalid');
    insert into profiles(id, login, full_name, role) values (v_admin, 'zz-pd-admin', 'ZZ PD Admin', 'admin');
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  insert into categories(name, kind) values ('ZZ PD актив', 'asset') returning id into v_cat;
  insert into suppliers(name) values ('ZZ PD поставщик') returning id into v_sup;
  insert into items(category_id, name) values (v_cat, 'ZZ PD-A') returning id into v_A;

  select exists (select 1 from pg_proc where proname = 'post_document' and prosrc like '%Некорректная строка документа%')
     and exists (select 1 from pg_proc where proname = 'post_move' and prosrc like '%pg_advisory_xact_lock(7101%')
  into v_has;
  rep := rep || pg_temp.r('S0 stage2b-post-validation.sql применён (иначе тест не имеет смысла)', v_has);
  if not v_has then raise exception E'ОТЧЁТ (миграция stage2b-post-validation.sql не применена):\n%', rep; end if;

  select count(*) into v_moves from stock_moves where item_id = v_A;
  select count(*) into v_docs from documents;

  -- N1: строка с минусом не гасится плюсовой
  v_msg := ''; begin perform post_document(p_op => 'receipt', p_lines => jsonb_build_array(
      jsonb_build_object('item_id', v_A, 'qty', 10), jsonb_build_object('item_id', v_A, 'qty', -3)), p_supplier => v_sup);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('N1 строка с минусом отклонена: ' || v_msg, v_msg like 'Количество в строке%');

  -- N2: qty = 0
  v_msg := ''; begin perform post_document(p_op => 'receipt', p_lines => jsonb_build_array(
      jsonb_build_object('item_id', v_A, 'qty', 0)), p_supplier => v_sup);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('N2 qty = 0 отклонён: ' || v_msg, v_msg like 'Количество в строке%');

  -- N3: строка без qty не выпадает молча
  v_msg := ''; begin perform post_document(p_op => 'receipt', p_lines => jsonb_build_array(
      jsonb_build_object('item_id', v_A, 'qty', 5), jsonb_build_object('item_id', v_A)), p_supplier => v_sup);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('N3 строка без qty отклонена: ' || v_msg, v_msg = 'Некорректная строка документа');

  -- N4: отрицательная стоимость
  v_msg := ''; begin perform post_document(p_op => 'receipt', p_lines => jsonb_build_array(
      jsonb_build_object('item_id', v_A, 'qty', 5, 'unit_cost', -1)), p_supplier => v_sup);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('N4 отрицательная стоимость отклонена: ' || v_msg, v_msg like 'Стоимость не может%');

  -- N5: минус в стоимости не компенсируется дорогой строкой (средняя была бы >= 0)
  v_msg := ''; begin perform post_document(p_op => 'receipt', p_lines => jsonb_build_array(
      jsonb_build_object('item_id', v_A, 'qty', 5, 'unit_cost', -2),
      jsonb_build_object('item_id', v_A, 'qty', 5, 'unit_cost', 20)), p_supplier => v_sup);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('N5 минус в цене не гасится средним: ' || v_msg, v_msg like 'Стоимость не может%');

  -- N6: дробный item_id
  v_msg := ''; begin perform post_document(p_op => 'receipt', p_lines => jsonb_build_array(
      jsonb_build_object('item_id', 1.5, 'qty', 1)), p_supplier => v_sup);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('N6 дробный item_id отклонён: ' || v_msg, v_msg = 'Некорректная строка документа');

  -- N7: элемент не объект
  v_msg := ''; begin perform post_document(p_op => 'receipt', p_lines => jsonb_build_array(5), p_supplier => v_sup);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('N7 элемент не объект отклонён: ' || v_msg, v_msg = 'Некорректная строка документа');

  -- N8: не массив
  v_msg := ''; begin perform post_document(p_op => 'receipt', p_lines => '{"item_id":1}'::jsonb, p_supplier => v_sup);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('N8 не массив отклонён: ' || v_msg, v_msg = 'Нет позиций');

  -- N9: post_move без товара
  v_msg := ''; begin perform post_move(p_op => 'receipt', p_item => null, p_qty => 1);
  exception when others then v_msg := sqlerrm; end;
  rep := rep || pg_temp.r('N9 post_move без товара отклонён: ' || v_msg, v_msg = 'Не указан товар');

  -- N10: после всех отказов ничего не записано
  rep := rep || pg_temp.r('N10 новых движений по A нет', (select count(*) from stock_moves where item_id = v_A) = v_moves);
  rep := rep || pg_temp.r('N10 новых документов нет', (select count(*) from documents) = v_docs);

  -- P1: корректный приход проходит
  j := post_document(p_op => 'receipt', p_lines => jsonb_build_array(
      jsonb_build_object('item_id', v_A, 'qty', 6, 'unit_cost', 5), jsonb_build_object('item_id', v_A, 'qty', 4, 'unit_cost', 10)),
      p_supplier => v_sup);
  select qty into v_bal from stock_balance where loc_id = _loc_singleton('warehouse') and item_id = v_A;
  rep := rep || pg_temp.r('P1 корректный приход: ' || j::text, (j->>'lines')::int = 1 and v_bal = 10);

  -- P2: корректное списание проходит, превышение остатка по-прежнему отклоняется
  j := post_document(p_op => 'writeoff_warehouse', p_lines => jsonb_build_array(jsonb_build_object('item_id', v_A, 'qty', 4)));
  select qty into v_bal from stock_balance where loc_id = _loc_singleton('warehouse') and item_id = v_A;
  rep := rep || pg_temp.r('P2 списание 4: остаток 6', v_bal = 6);
  v_msg := ''; begin perform post_document(p_op => 'writeoff_warehouse', p_lines => jsonb_build_array(
      jsonb_build_object('item_id', v_A, 'qty', 7)));
  exception when others then v_msg := sqlerrm; end;
  select qty into v_bal from stock_balance where loc_id = _loc_singleton('warehouse') and item_id = v_A;
  rep := rep || pg_temp.r('P2 списание сверх остатка отклонено: ' || v_msg, v_msg = 'Не хватает на складе' and v_bal = 6);

  -- L1: блокировка по товару взята и держится до конца транзакции (вызовы P1/P2 выполнены вне подтранзакции)
  select count(*) into v_locks from pg_locks
  where locktype = 'advisory' and classid = 7101 and objid = v_A and pid = pg_backend_pid() and granted;
  rep := rep || pg_temp.r('L1 advisory-блокировка (7101, item) удерживается', v_locks = 1);

  raise exception E'ОТЧЁТ (данные откатаны):\n%', rep;
end $$;
