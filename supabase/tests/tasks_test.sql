-- Проверка этапа «Задания» (tasks.sql). Скрипт сам откатывает данные: в конце намеренно падает с ошибкой "ОТЧЁТ".
-- Ожидается 34 строки OK и ни одной FAIL. Метки: A 10, B 6, C 10, D 4, E 4.
create or replace function pg_temp.r(n text, c boolean) returns text language sql as
$$ select case when coalesce(c, false) then 'OK    ' else 'FAIL  ' end || n || E'\n' $$;
create or replace function pg_temp.as_user(u uuid) returns void language sql as
$$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true),
          set_config('request.jwt.claim.sub', u::text, true) $$;

do $$
declare
  v_admin uuid := gen_random_uuid(); v_mgr uuid := gen_random_uuid();
  v_sv1 uuid := gen_random_uuid(); v_sv2 uuid := gen_random_uuid(); v_off uuid := gen_random_uuid();
  rep text := ''; t text; j jsonb; n int; r tasks%rowtype;
  v_bld int; v_apt int; id1 bigint; id2 bigint; id3 bigint; id4 bigint;
begin
  insert into auth.users(id, email) values
    (v_admin, 'zz-tsk-admin@example.invalid'), (v_mgr, 'zz-tsk-mgr@example.invalid'),
    (v_sv1, 'zz-tsk-sv1@example.invalid'), (v_sv2, 'zz-tsk-sv2@example.invalid'), (v_off, 'zz-tsk-off@example.invalid');
  insert into profiles(id, login, full_name, role, active) values
    (v_admin, 'zz-tsk-admin', 'ZZ Tsk Admin', 'admin', true), (v_mgr, 'zz-tsk-mgr', 'ZZ Tsk Mgr', 'manager', true),
    (v_sv1, 'zz-tsk-sv1', 'ZZ Tsk Sv One', 'supervisor', true), (v_sv2, 'zz-tsk-sv2', 'ZZ Tsk Sv Two', 'supervisor', true),
    (v_off, 'zz-tsk-off', 'ZZ Tsk Off', 'supervisor', false);
  insert into buildings(name) values ('ZZTSK') returning id into v_bld;
  insert into apartments(building_id, number, code, type) values (v_bld, '1', 'ZZTSK/1', 'studio') returning id into v_apt;

  execute 'set local role authenticated';

  -- A: создание
  perform pg_temp.as_user(v_mgr);
  j := task_create(v_apt, '2001-04-10', 'cleaning', '  ZZ убрать до 12:00  ', '2001-04-12');
  id1 := (j->>'id')::bigint;
  rep := rep || pg_temp.r('A1 менеджер создаёт задание', j->>'status' = 'ok' and id1 is not null);
  select * into r from tasks where id = id1;
  rep := rep || pg_temp.r('A2 новое, текст без пробелов по краям, автор и тип записаны',
    r.status = 'new' and r.body = 'ZZ убрать до 12:00' and r.created_by_name = 'ZZ Tsk Mgr' and r.kind = 'cleaning'
    and r.task_date = '2001-04-10' and r.due_date = '2001-04-12' and r.apartment_id = v_apt);
  perform pg_temp.as_user(v_admin);
  j := task_create(null, '2001-04-10', 'other', 'ZZ без квартиры');
  id2 := (j->>'id')::bigint;
  rep := rep || pg_temp.r('A3 админ создаёт задание без квартиры', j->>'status' = 'ok' and exists (select 1 from tasks where id = id2 and apartment_id is null));
  perform pg_temp.as_user(v_sv1);
  t := null;
  begin perform task_create(null, '2001-04-10', 'other', 'ZZ'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('A4 супервайзер не создаёт', t is not null);
  perform pg_temp.as_user(v_mgr);
  t := null;
  begin perform task_create(null, '2001-04-10', 'other', '   '); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('A5 пустой текст отклонён', t is not null);
  t := null;
  begin perform task_create(null, '2001-04-10', 'other', repeat('x', 2001)); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('A6 текст длиннее 2000 отклонён', t is not null);
  t := null;
  begin perform task_create(null, '2001-04-10', 'photo', 'ZZ'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('A7 неверный тип отклонён', t is not null);
  t := null;
  begin perform task_create(null, '2001-04-10', 'other', 'ZZ', '2001-04-09'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('A8 срок раньше даты отклонён', t is not null);
  t := null;
  begin perform task_create(-1, '2001-04-10', 'other', 'ZZ'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('A9 несуществующая квартира отклонена', t is not null);
  j := task_create(null, null, 'inspection', 'ZZ дата по умолчанию');
  id3 := (j->>'id')::bigint;
  rep := rep || pg_temp.r('A10 дата по умолчанию: сегодня по Каиру',
    exists (select 1 from tasks where id = id3 and task_date = (now() at time zone 'Africa/Cairo')::date));

  -- B: видимость и закрытая прямая запись
  perform pg_temp.as_user(v_sv1);
  select count(*) into n from tasks where body like 'ZZ%';
  rep := rep || pg_temp.r('B1 супервайзер видит все задания', n = 3);
  perform pg_temp.as_user(v_mgr);
  select count(*) into n from tasks where body like 'ZZ%';
  rep := rep || pg_temp.r('B2 менеджер видит все задания', n = 3);
  perform pg_temp.as_user(v_off);
  select count(*) into n from tasks where body like 'ZZ%';
  rep := rep || pg_temp.r('B3 неактивный пользователь не видит заданий', n = 0);
  perform pg_temp.as_user(v_sv1);
  t := null;
  begin insert into tasks(task_date, kind, body) values ('2001-04-10', 'other', 'ZZ прямая'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('B4 прямая вставка запрещена', t is not null);
  t := null;
  begin update tasks set body = 'ZZ взлом' where id = id1; get diagnostics n = row_count; exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('B5 прямое обновление запрещено', t is not null);
  t := null;
  begin delete from tasks where id = id1; exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('B6 прямое удаление запрещено', t is not null);

  -- C: статусы
  perform pg_temp.as_user(v_sv1);
  j := task_set_status(id1, 'accepted');
  select * into r from tasks where id = id1;
  rep := rep || pg_temp.r('C1 супервайзер принимает: имя и время записаны',
    j->>'status' = 'ok' and r.status = 'accepted' and r.accepted_by_name = 'ZZ Tsk Sv One' and r.accepted_at is not null);
  perform pg_temp.as_user(v_sv2);
  j := task_set_status(id1, 'accepted');
  select * into r from tasks where id = id1;
  rep := rep || pg_temp.r('C2 повторное принятие вторым: без изменений, принявший прежний',
    j->>'unchanged' = 'true' and r.accepted_by_name = 'ZZ Tsk Sv One');
  j := task_set_status(id1, 'done');
  select * into r from tasks where id = id1;
  rep := rep || pg_temp.r('C3 второй супервайзер выполняет: имя записано',
    r.status = 'done' and r.done_by_name = 'ZZ Tsk Sv Two' and r.done_at is not null);
  t := null;
  begin perform task_set_status(id2, 'done'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C4 из «нового» сразу в «выполнено» нельзя', t is not null);
  t := null;
  begin perform task_set_status(id1, 'accepted'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C5 супервайзер не возвращает статус назад', t is not null);
  perform pg_temp.as_user(v_mgr);
  j := task_set_status(id1, 'accepted');
  select * into r from tasks where id = id1;
  rep := rep || pg_temp.r('C6 менеджер возвращает «выполнено» в «принято»: отметка о выполнении снята, о приёме осталась',
    r.status = 'accepted' and r.done_by is null and r.done_at is null and r.accepted_by_name = 'ZZ Tsk Sv One');
  perform pg_temp.as_user(v_admin);
  j := task_set_status(id1, 'new');
  select * into r from tasks where id = id1;
  rep := rep || pg_temp.r('C7 админ возвращает «принято» в «новое»: отметка о приёме снята',
    r.status = 'new' and r.accepted_by is null and r.accepted_at is null);
  t := null;
  begin perform task_set_status(id1, 'foo'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C8 неверный статус отклонён', t is not null);
  t := null;
  begin perform task_set_status(-1, 'accepted'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C9 несуществующее задание отклонено', t is not null);
  perform pg_temp.as_user(v_off);
  t := null;
  begin perform task_set_status(id1, 'accepted'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C10 неактивный пользователь не меняет статус', t is not null);

  -- D: удаление
  perform pg_temp.as_user(v_sv1);
  t := null;
  begin perform task_delete(id1); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('D1 супервайзер не удаляет', t is not null);
  perform pg_temp.as_user(v_mgr);
  j := task_delete(id1);
  rep := rep || pg_temp.r('D2 менеджер удаляет «новое»', j->>'status' = 'ok' and not exists (select 1 from tasks where id = id1));
  j := task_create(null, '2001-04-10', 'other', 'ZZ принятое');
  id4 := (j->>'id')::bigint;
  perform pg_temp.as_user(v_sv1);
  perform task_set_status(id4, 'accepted');
  perform pg_temp.as_user(v_mgr);
  t := null;
  begin perform task_delete(id4); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('D3 менеджер не удаляет принятое', t is not null and exists (select 1 from tasks where id = id4));
  perform pg_temp.as_user(v_admin);
  j := task_delete(id4);
  rep := rep || pg_temp.r('D4 админ удаляет принятое', j->>'status' = 'ok' and not exists (select 1 from tasks where id = id4));

  -- E: аудит, привилегии, живое обновление
  execute 'reset role';
  select count(*) into n from audit_log where table_name = 'tasks' and row_id = id1::text and action in ('INSERT', 'UPDATE', 'DELETE');
  rep := rep || pg_temp.r('E1 изменения задания попали в аудит (создание, статусы, удаление)', n >= 6);
  rep := rep || pg_temp.r('E2 task_create не выполняется anon',
    not has_function_privilege('anon', 'public.task_create(integer,date,text,text,date)', 'EXECUTE'));
  rep := rep || pg_temp.r('E3 task_set_status и task_delete выполняются authenticated',
    has_function_privilege('authenticated', 'public.task_set_status(bigint,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.task_delete(bigint)', 'EXECUTE'));
  rep := rep || pg_temp.r('E4 таблица в публикации realtime (если публикация есть)',
    not exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    or exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'));

  raise exception E'ОТЧЁТ (данные откатаны):\n%', rep;
end $$;
