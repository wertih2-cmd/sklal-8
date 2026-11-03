-- Проверка поштучного учёта (миграция 1b1a). Запускать в Supabase SQL Editor на ТЕСТОВОЙ БД.
-- Скрипт сам откатывает все данные: в конце намеренно падает с ошибкой "ОТЧЁТ", в тексте — результаты.
create or replace function pg_temp.r(n text, c boolean) returns text language sql as
$$ select case when coalesce(c, false) then 'OK    ' else 'FAIL  ' end || n || E'\n' $$;

do $$
declare
  v_admin uuid; rep text := ''; v_msg text := ''; v_rej boolean; v_cnt int; v_bld int; v_apt int; v_cat int;
  v_item int; v_unit uuid; v_wh int; v_apt_loc int; v_priv boolean;
begin
  select id into v_admin from profiles where role = 'admin' and active limit 1;
  if v_admin is null then
    v_admin := gen_random_uuid();
    insert into auth.users(id, email) values (v_admin, 'zz-test-admin@example.invalid');
    insert into profiles(id, login, full_name, role) values (v_admin, 'zz-test-admin', 'ZZ Test Admin', 'admin');
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  insert into buildings(name) values ('ZZU') returning id into v_bld;
  insert into apartments(building_id, number, code, type) values (v_bld, '1', 'ZZU/1', 'studio') returning id into v_apt;
  insert into categories(name, kind) values ('ZZ поштучный актив', 'asset') returning id into v_cat;
  insert into items(category_id, name) values (v_cat, 'ZZ U') returning id into v_item;
  v_wh := _loc_singleton('warehouse');
  v_apt_loc := _loc_apartment(v_apt);

  -- U1 прямое включение учёта отклонено
  v_rej := false;
  begin
    update items set track_units = true where id = v_item;
  exception when others then v_rej := true;
  end;
  rep := rep || pg_temp.r('U1 прямое включение track_units отклонено', v_rej);

  -- U2 включение с разрешающей настройкой проходит
  perform set_config('app.unit_tracking_enable', 'on', true);
  update items set track_units = true where id = v_item;
  perform set_config('app.unit_tracking_enable', 'off', true);
  rep := rep || pg_temp.r('U2 включение при app.unit_tracking_enable=on проходит', (select track_units from items where id = v_item));

  -- U3 выключение при наличии единиц отклонено
  perform post_move(p_op => 'receipt', p_item => v_item, p_qty => 1, p_unit_cost => 10, p_serials => array['ZZU-1']);
  select id into v_unit from item_units where code = 'ZZU-1';
  v_rej := false;
  begin
    update items set track_units = false where id = v_item;
  exception when others then v_rej := true;
  end;
  rep := rep || pg_temp.r('U3 true->false при наличии единиц отклонено', v_rej);

  -- U4 приход без кодов проходит и создаёт единицу; выдача и списание без ID единиц отклоняются (после 1b2a), прямое перемещение блокируется защитным триггером
  perform post_move(p_op => 'receipt', p_item => v_item, p_qty => 1, p_unit_cost => 10);
  rep := rep || pg_temp.r('U4 приход (receipt) проходит', (select qty from stock_balance where loc_id = v_wh and item_id = v_item) = 2);

  v_msg := '';
  begin
    perform post_move(p_op => 'issue_apartment', p_item => v_item, p_qty => 1, p_apartment => v_apt);
  exception when others then v_msg := sqlerrm;
  end;
  rep := rep || pg_temp.r('U5 выдача (issue) без ID единиц отклонена текстом "ID единиц обязательны"', v_msg like '%ID единиц обязательны%');

  v_msg := '';
  begin
    perform post_move(p_op => 'writeoff_warehouse', p_item => v_item, p_qty => 1);
  exception when others then v_msg := sqlerrm;
  end;
  rep := rep || pg_temp.r('U6 списание (writeoff) без ID единиц отклонено текстом "ID единиц обязательны"', v_msg like '%ID единиц обязательны%');

  v_msg := '';
  begin
    insert into stock_moves(item_id, from_loc, to_loc, qty, source_type)
      values (v_item, v_wh, v_apt_loc, 1, 'owner_transfer');
  exception when others then v_msg := sqlerrm;
  end;
  rep := rep || pg_temp.r('U7 перемещение (transfer) блокируется текстом "Поштучный учёт"', v_msg like '%Поштучный учёт%');

  -- U8 не-админ не видит таблицы учёта
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  execute 'set local role authenticated';
  select count(*) into v_cnt from item_units;
  rep := rep || pg_temp.r('U8 не-админ не видит item_units', v_cnt = 0);
  select count(*) into v_cnt from unit_events;
  rep := rep || pg_temp.r('U9 не-админ не видит unit_events', v_cnt = 0);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- U10 _insert_move не выдан клиентским ролям
  select bool_and(not has_function_privilege(r::name, p.oid, 'EXECUTE')) into v_priv
    from pg_proc p, unnest(array['authenticated', 'anon']) r
    where p.proname = '_insert_move' and p.pronamespace = 'public'::regnamespace;
  rep := rep || pg_temp.r('U10 _insert_move не выдан authenticated и anon', coalesce(v_priv, false));

  -- U11 представление расхождений доступно админу
  select count(*) into v_cnt from unit_balance_mismatch where item_id = v_item;
  rep := rep || pg_temp.r('U11 unit_balance_mismatch читается админом и не показывает расхождений по товару', v_cnt = 0);

  raise exception using message = E'ОТЧЁТ\n' || rep;
end $$;
