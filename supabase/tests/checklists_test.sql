-- Проверка этапа «Чек-листы и инспекции» (checklists.sql). Скрипт сам откатывает данные: в конце намеренно падает с ошибкой "ОТЧЁТ".
-- Ожидается 55 строк OK и ни одной FAIL.
-- Метки в успешном прогоне: A 10, B 18, C 13, D 6, E 8 = 55 строк OK. Ещё две проверки (B18b, D6b) добавляют строку только при сбое, она будет FAIL.
create or replace function pg_temp.r(n text, c boolean) returns text language sql as
$$ select case when coalesce(c, false) then 'OK    ' else 'FAIL  ' end || n || E'\n' $$;
create or replace function pg_temp.as_user(u uuid) returns void language sql as
$$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true),
          set_config('request.jwt.claim.sub', u::text, true) $$;

do $$
declare
  v_admin uuid := gen_random_uuid(); v_mgr uuid := gen_random_uuid();
  v_sv1 uuid := gen_random_uuid(); v_sv2 uuid := gen_random_uuid(); v_off uuid := gen_random_uuid();
  rep text := ''; t text; tb text; j jsonb; n int;
  v_bld int; v_apt1 int; v_apt2 int; v_sa int; v_sb int;
  e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); e3 uuid := gen_random_uuid(); e4 uuid := gen_random_uuid();
  e5 uuid := gen_random_uuid(); e6 uuid := gen_random_uuid(); e7 uuid := gen_random_uuid(); e8 uuid := gen_random_uuid();
  ids bigint[]; ids2 bigint[]; v_foreign bigint; v_ok jsonb; v_mix jsonb;
  insp1 bigint; insp2 bigint; insp3 bigint; insp4 bigint; insp5 bigint;
  iA bigint; iB bigint; tA bigint; taskB bigint; i3 bigint; t3 bigint; t4 bigint; i5 bigint; t5 bigint; i4 bigint;
begin
  insert into auth.users(id, email) values
    (v_admin, 'zz-chk-admin@example.invalid'), (v_mgr, 'zz-chk-mgr@example.invalid'),
    (v_sv1, 'zz-chk-sv1@example.invalid'), (v_sv2, 'zz-chk-sv2@example.invalid'), (v_off, 'zz-chk-off@example.invalid');
  insert into profiles(id, login, full_name, role, active) values
    (v_admin, 'zz-chk-admin', 'ZZ Chk Admin', 'admin', true), (v_mgr, 'zz-chk-mgr', 'ZZ Chk Mgr', 'manager', true),
    (v_sv1, 'zz-chk-sv1', 'ZZ Chk Sv One', 'supervisor', true), (v_sv2, 'zz-chk-sv2', 'ZZ Chk Sv Two', 'supervisor', true),
    (v_off, 'zz-chk-off', 'ZZ Chk Off', 'supervisor', false);
  -- в рабочей базе шаблоны могут уже существовать: в этой (откатываемой) транзакции начинаем с чистого листа
  delete from checklist_items;
  insert into buildings(name) values ('ZZCHK') returning id into v_bld;
  insert into apartments(building_id, number, code, type) values (v_bld, '1', 'ZZCHK/1', 'studio') returning id into v_apt1;
  insert into apartments(building_id, number, code, type) values (v_bld, '2', 'ZZCHK/2', '2br') returning id into v_apt2;
  insert into staff(full_name) values ('ZZ Chk Staff A') returning id into v_sa;
  insert into staff(full_name) values ('ZZ Chk Staff B') returning id into v_sb;
  -- события: e1, e5 с двумя убиравшими; e2 отменена; e3 отклонена; e4 в квартире без шаблона; e6, e7, e8 без убиравших
  insert into cleaning_events(id, client_op_id, apartment_id, status, posting_status) values
    (e1, gen_random_uuid(), v_apt1, 'done', 'pending'),
    (e2, gen_random_uuid(), v_apt1, 'reversed', 'pending'),
    (e3, gen_random_uuid(), v_apt1, 'done', 'rejected'),
    (e4, gen_random_uuid(), v_apt2, 'done', 'pending'),
    (e5, gen_random_uuid(), v_apt1, 'done', 'pending'),
    (e6, gen_random_uuid(), v_apt1, 'done', 'pending'),
    (e7, gen_random_uuid(), v_apt1, 'done', 'pending'),
    (e8, gen_random_uuid(), v_apt1, 'done', 'pending');
  insert into cleaning_event_staff(event_id, staff_id) values (e1, v_sa), (e1, v_sb), (e5, v_sa), (e5, v_sb);

  execute 'set local role authenticated';

  -- A: шаблон
  perform pg_temp.as_user(v_mgr);
  j := checklist_save('studio', jsonb_build_array(
    jsonb_build_object('text', '  ZZ окна чистые  '), jsonb_build_object('text', 'ZZ пол вымыт'), jsonb_build_object('text', 'ZZ бельё свежее')));
  rep := rep || pg_temp.r('A1 менеджер сохраняет шаблон из трёх пунктов', j->>'status' = 'ok' and (j->>'count')::int = 3);
  select array_agg(id order by position) into ids from checklist_items where apt_type = 'studio';
  rep := rep || pg_temp.r('A2 текст без пробелов по краям, порядок 1-2-3',
    cardinality(ids) = 3 and (select body from checklist_items where id = ids[1]) = 'ZZ окна чистые'
    and (select array_agg(position order by position) from checklist_items where apt_type = 'studio') = array[1, 2, 3]);
  perform pg_temp.as_user(v_admin);
  j := checklist_save('studio', jsonb_build_array(
    jsonb_build_object('id', ids[1], 'text', 'ZZ окна и зеркала'), jsonb_build_object('id', ids[3], 'text', 'ZZ бельё свежее'),
    jsonb_build_object('text', 'ZZ ванная сухая')));
  select array_agg(id order by position) into ids2 from checklist_items where apt_type = 'studio';
  rep := rep || pg_temp.r('A3 админ правит: id сохраняются, второй пункт удалён, новый добавлен',
    ids2[1] = ids[1] and ids2[2] = ids[3] and not (ids2[3] = any(ids)) and not exists (select 1 from checklist_items where id = ids[2])
    and (select body from checklist_items where id = ids[1]) = 'ZZ окна и зеркала');
  perform pg_temp.as_user(v_sv1);
  t := null;
  begin perform checklist_save('studio', '[]'::jsonb); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('A4 супервайзер не правит шаблон', t is not null and (select count(*) from checklist_items where apt_type = 'studio') = 3);
  perform pg_temp.as_user(v_mgr);
  t := null;
  begin perform checklist_save('studio', jsonb_build_array(jsonb_build_object('text', '   '))); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('A5 пустой пункт отклонён', t is not null);
  t := null;
  begin perform checklist_save('studio', jsonb_build_array(jsonb_build_object('text', repeat('x', 201)))); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('A6 пункт длиннее 200 отклонён', t is not null);
  t := null;
  begin
    perform checklist_save('studio', (select jsonb_agg(jsonb_build_object('text', 'ZZ' || g)) from generate_series(1, 61) g));
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('A7 больше 60 пунктов отклонено', t is not null);
  j := checklist_save('1br', jsonb_build_array(jsonb_build_object('text', 'ZZ пункт однушки')));
  select id into v_foreign from checklist_items where apt_type = '1br';
  t := null;
  begin perform checklist_save('studio', jsonb_build_array(jsonb_build_object('id', v_foreign, 'text', 'ZZ чужой'))); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('A8 id пункта другого типа отклонён, шаблон студии цел',
    t is not null and (select count(*) from checklist_items where apt_type = 'studio') = 3);
  t := null;
  begin
    perform checklist_save('studio', jsonb_build_array(jsonb_build_object('id', ids2[1], 'text', 'ZZ а'), jsonb_build_object('id', ids2[1], 'text', 'ZZ б')));
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('A9 один id дважды отклонён', t is not null);
  t := null;
  begin perform checklist_save('studio', '{}'::jsonb); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('A10 не список отклонён', t is not null);

  -- B: проведение инспекции
  perform pg_temp.as_user(v_sv1);
  select jsonb_agg(jsonb_build_object('item_id', id, 'ok', true) order by position) into v_ok from checklist_items where apt_type = 'studio';
  j := inspection_create(e1, v_ok);
  insp1 := (j->>'id')::bigint;
  rep := rep || pg_temp.r('B1 супервайзер проводит инспекцию без замечаний', j->>'status' = 'ok' and (j->>'failed')::int = 0 and (j->>'passed')::boolean);
  rep := rep || pg_temp.r('B2 инспекция «проверено», имя инспектора, три пункта с копией текста',
    (select status from inspections where id = insp1) = 'passed' and (select inspector_name from inspections where id = insp1) = 'ZZ Chk Sv One'
    and (select count(*) from inspection_items where inspection_id = insp1 and ok) = 3
    and (select body from inspection_items where inspection_id = insp1 and position = 1) = 'ZZ окна и зеркала'
    and not exists (select 1 from tasks where kind = 'rework' and apartment_id = v_apt1));
  t := null;
  begin perform inspection_create(e1, v_ok); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('B3 вторая инспекция той же уборки отклонена', t is not null);
  perform pg_temp.as_user(v_sv2);
  select jsonb_agg(jsonb_build_object('item_id', id, 'ok', position = 2, 'note', case when position = 1 then 'ZZ нет пыли' end) order by position)
    into v_mix from checklist_items where apt_type = 'studio';
  j := inspection_create(e5, v_mix);
  insp2 := (j->>'id')::bigint;
  rep := rep || pg_temp.r('B4 два пункта «не ок»: failed = 2, passed = false', j->>'status' = 'ok' and (j->>'failed')::int = 2 and not (j->>'passed')::boolean);
  rep := rep || pg_temp.r('B5 по каждому пункту «не ок» создано задание «доработка» (новое, квартира)',
    (select count(*) from inspection_items ii join tasks k on k.id = ii.task_id
      where ii.inspection_id = insp2 and k.kind = 'rework' and k.status = 'new' and k.apartment_id = v_apt1) = 2);
  select k.body into tb from inspection_items ii join tasks k on k.id = ii.task_id where ii.inspection_id = insp2 and ii.position = 1;
  rep := rep || pg_temp.r('B6 текст задания: пункт, комментарий и имена убиравших; автор = инспектор',
    position('ZZ окна и зеркала' in tb) > 0 and position('ZZ нет пыли' in tb) > 0 and position('ZZ Chk Staff A' in tb) > 0
    and position('ZZ Chk Staff B' in tb) > 0
    and (select k.created_by_name from inspection_items ii join tasks k on k.id = ii.task_id where ii.inspection_id = insp2 and ii.position = 1) = 'ZZ Chk Sv Two');
  rep := rep || pg_temp.r('B7 инспекция с замечаниями: «нужна доработка»', (select status from inspections where id = insp2) = 'needs_rework');
  t := null;
  begin perform inspection_create(e2, v_ok); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('B8 отменённую уборку проверять нельзя', t is not null);
  t := null;
  begin perform inspection_create(e3, v_ok); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('B9 отклонённую уборку проверять нельзя', t is not null);
  t := null;
  begin perform inspection_create(e4, v_ok); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('B10 для типа квартиры без шаблона инспекции нет', t is not null);
  t := null;
  begin perform inspection_create(e6, v_ok - 0); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('B11 ответ не на все пункты отклонён', t is not null);
  t := null;
  begin perform inspection_create(e6, jsonb_set(v_ok, '{0,item_id}', to_jsonb(v_foreign))); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('B12 пункт не из шаблона отклонён', t is not null);
  t := null;
  begin perform inspection_create(e6, jsonb_set(v_ok, '{1,item_id}', v_ok->0->'item_id')); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('B13 один пункт дважды отклонён', t is not null);
  t := null;
  begin perform inspection_create(e6, jsonb_set(v_ok, '{0,ok}', '"yes"'::jsonb)); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('B14 ответ не «ок/не ок» отклонён', t is not null);
  t := null;
  begin perform inspection_create(e6, jsonb_set(v_ok, '{0,photos}', to_jsonb(array['someone-else/a.jpg']))); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('B15 фото чужой папки отклонено', t is not null);
  t := null;
  begin
    perform inspection_create(e6, jsonb_set(v_ok, '{0,photos}', to_jsonb(array(select v_sv2::text || '/p' || g || '.jpg' from generate_series(1, 7) g))));
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('B16 больше шести фото на пункт отклонено', t is not null);
  perform pg_temp.as_user(v_mgr);
  select jsonb_agg(jsonb_build_object('item_id', id, 'ok', position <> 1,
      'photos', case when position = 1 then jsonb_build_array(v_mgr::text || '/zz.jpg') end) order by position)
    into v_mix from checklist_items where apt_type = 'studio';
  j := inspection_create(e6, v_mix);
  insp3 := (j->>'id')::bigint;
  select ii.id, ii.task_id into i3, t3 from inspection_items ii where ii.inspection_id = insp3 and ii.position = 1;
  rep := rep || pg_temp.r('B17 менеджер проводит инспекцию, фото пункта сохранено, событие «на подтверждении» тоже можно',
    j->>'status' = 'ok' and (select photo_paths from inspection_items where id = i3) = array[v_mgr::text || '/zz.jpg']);
  rep := rep || pg_temp.r('B18 без убиравших в тексте задания «не указано»', position('не указано' in (select body from tasks where id = t3)) > 0);
  perform pg_temp.as_user(v_off);
  t := null;
  begin perform inspection_create(e7, v_ok); exception when others then t := sqlerrm; end;
  if t is null then rep := rep || pg_temp.r('B18b неактивный пользователь не проводит инспекцию', false); end if;

  -- C: повторная проверка
  perform pg_temp.as_user(v_sv1);
  select id, task_id into iA, tA from inspection_items where inspection_id = insp2 and position = 1;
  select id, task_id into iB, taskB from inspection_items where inspection_id = insp2 and position = 3;
  t := null;
  begin perform inspection_recheck(iA, true); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C1 пока доработка не выполнена, повторная проверка отклонена', t is not null);
  perform task_set_status(tA, 'accepted');
  perform pg_temp.as_user(v_sv2);
  perform task_set_status(tA, 'done');
  perform pg_temp.as_user(v_sv1);
  t := null;
  begin perform inspection_recheck(iA, false, null); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C2 возврат без причины отклонён', t is not null);
  j := inspection_recheck(iA, false, 'ZZ пыль осталась');
  rep := rep || pg_temp.r('C3 возврат: задание снова «принято» с причиной, пункт открыт, инспекция всё ещё «нужна доработка»',
    (select status from tasks where id = tA) = 'accepted' and (select return_note from tasks where id = tA) = 'ZZ пыль осталась'
    and (select done_by from tasks where id = tA) is null
    and (select recheck_count from inspection_items where id = iA) = 1 and (select resolved_at from inspection_items where id = iA) is null
    and (select status from inspections where id = insp2) = 'needs_rework');
  perform pg_temp.as_user(v_sv2);
  perform task_set_status(tA, 'done');
  perform pg_temp.as_user(v_sv1);
  j := inspection_recheck(iA, true, 'ZZ теперь чисто', array[v_sv1::text || '/r.jpg']);
  rep := rep || pg_temp.r('C4 успех: задание «проверено» с именем, причина возврата снята, пункт закрыт, фото повторной проверки сохранено',
    (select status from tasks where id = tA) = 'verified' and (select verified_by_name from tasks where id = tA) = 'ZZ Chk Sv One'
    and (select verified_at from tasks where id = tA) is not null and (select return_note from tasks where id = tA) is null
    and (select resolved_at from inspection_items where id = iA) is not null
    and (select resolved_by_name from inspection_items where id = iA) = 'ZZ Chk Sv One'
    and (select recheck_count from inspection_items where id = iA) = 2
    and cardinality((select recheck_photo_paths from inspection_items where id = iA)) = 1);
  rep := rep || pg_temp.r('C5 второй пункт ещё открыт: инспекция «нужна доработка»', (select status from inspections where id = insp2) = 'needs_rework');
  perform task_set_status(taskB, 'accepted');
  perform task_set_status(taskB, 'done');
  j := inspection_recheck(iB, true);
  rep := rep || pg_temp.r('C6 оба пункта закрыты: инспекция «проверено»', (select status from inspections where id = insp2) = 'passed');
  t := null;
  begin perform inspection_recheck((select id from inspection_items where inspection_id = insp1 limit 1), true); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C7 пункт «ок» повторно не проверяется', t is not null);
  t := null;
  begin perform inspection_recheck(iA, true); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C8 уже закрытый пункт не проверяется снова', t is not null);
  perform pg_temp.as_user(v_mgr);
  t := null;
  begin perform task_set_status(tA, 'accepted'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C9 проверенное задание не меняется даже менеджером', t is not null and (select status from tasks where id = tA) = 'verified');
  t := null;
  begin perform task_set_status(taskB, 'verified'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C10 статус «проверено» вручную не ставится', t is not null);
  t := null;
  begin perform task_create(v_apt1, null, 'rework', 'ZZ вручную'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C11 тип «доработка» вручную не создаётся', t is not null);
  -- C12: фото повторной проверки из чужой папки
  select jsonb_agg(jsonb_build_object('item_id', id, 'ok', position <> 1) order by position) into v_mix from checklist_items where apt_type = 'studio';
  j := inspection_create(e7, v_mix);
  insp4 := (j->>'id')::bigint;
  select id, task_id into i4, t4 from inspection_items where inspection_id = insp4 and position = 1;
  perform pg_temp.as_user(v_sv1);
  perform task_set_status(t4, 'accepted');
  perform task_set_status(t4, 'done');
  t := null;
  begin perform inspection_recheck(i4, true, null, array['someone-else/x.jpg']); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('C12 фото повторной проверки из чужой папки отклонено, пункт остался открытым',
    t is not null and (select resolved_at from inspection_items where id = i4) is null);
  -- C13: задание удалено, пункт можно закрыть без него
  perform pg_temp.as_user(v_mgr);
  j := inspection_create(e8, v_mix);
  insp5 := (j->>'id')::bigint;
  select id, task_id into i5, t5 from inspection_items where inspection_id = insp5 and position = 1;
  perform task_delete(t5);
  perform pg_temp.as_user(v_sv1);
  j := inspection_recheck(i5, true);
  rep := rep || pg_temp.r('C13 задание удалено: пункт закрывается без него, инспекция «проверено»',
    (select task_id from inspection_items where id = i5) is null and (select resolved_at from inspection_items where id = i5) is not null
    and (select status from inspections where id = insp5) = 'passed');

  -- D: удаление инспекции, прямая запись
  t := null;
  begin perform inspection_delete(insp3); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('D1 супервайзер не удаляет инспекцию', t is not null and exists (select 1 from inspections where id = insp3));
  perform pg_temp.as_user(v_mgr);
  j := inspection_delete(insp3);
  rep := rep || pg_temp.r('D2 менеджер удаляет инспекцию: пункты и новое задание на доработку удалены',
    j->>'status' = 'ok' and (j->>'tasks_deleted')::int = 1 and not exists (select 1 from inspections where id = insp3)
    and not exists (select 1 from inspection_items where inspection_id = insp3) and not exists (select 1 from tasks where id = t3));
  j := inspection_create(e6, v_ok);
  rep := rep || pg_temp.r('D3 после удаления уборку можно проверить заново', j->>'status' = 'ok');
  perform pg_temp.as_user(v_admin);
  j := inspection_delete(insp4);
  rep := rep || pg_temp.r('D4 принятое и выполненное задание при удалении инспекции остаётся',
    (j->>'tasks_deleted')::int = 0 and exists (select 1 from tasks where id = t4 and status = 'done') and not exists (select 1 from inspections where id = insp4));
  perform pg_temp.as_user(v_sv1);
  t := null;
  begin insert into inspections(cleaning_event_id, apartment_id) values (e2, v_apt1); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('D5 прямая вставка в инспекции запрещена', t is not null);
  t := null;
  begin insert into checklist_items(apt_type, position, body) values ('studio', 9, 'ZZ прямой'); exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('D6 прямая вставка в шаблон запрещена', t is not null);
  t := null;
  begin update inspection_items set ok = true where id = iB; exception when others then t := sqlerrm; end;
  if t is null then rep := rep || pg_temp.r('D6b прямое обновление пунктов запрещено', false); end if;

  -- E: видимость, аудит, привилегии
  select count(*) into n from inspections where apartment_id = v_apt1;
  rep := rep || pg_temp.r('E1 супервайзер видит инспекции', n >= 2);
  perform pg_temp.as_user(v_mgr);
  select count(*) into n from checklist_items where body like 'ZZ%';
  rep := rep || pg_temp.r('E2 менеджер видит шаблон', n >= 3);
  perform pg_temp.as_user(v_off);
  select count(*) into n from inspections;
  rep := rep || pg_temp.r('E3 неактивный пользователь не видит инспекций', n = 0);
  select count(*) into n from checklist_items;
  rep := rep || pg_temp.r('E4 неактивный пользователь не видит шаблона', n = 0);
  execute 'reset role';
  select count(*) into n from audit_log where table_name = 'inspections' and row_id = insp1::text and action = 'INSERT';
  rep := rep || pg_temp.r('E5 создание инспекции попало в аудит', n >= 1);
  rep := rep || pg_temp.r('E6 клиентские функции не выполняются anon',
    not has_function_privilege('anon', 'public.checklist_save(public.apt_type,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.inspection_create(uuid,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.inspection_recheck(bigint,boolean,text,text[])', 'EXECUTE')
    and not has_function_privilege('anon', 'public.inspection_delete(bigint)', 'EXECUTE'));
  rep := rep || pg_temp.r('E7 клиентские функции выполняются authenticated, внутренние нет',
    has_function_privilege('authenticated', 'public.checklist_save(public.apt_type,jsonb)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.inspection_create(uuid,jsonb)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.inspection_recheck(bigint,boolean,text,text[])', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.inspection_delete(bigint)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public._inspection_refresh(bigint)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public._check_photo_paths(text[],integer)', 'EXECUTE'));
  rep := rep || pg_temp.r('E8 таблицы в публикации realtime (если публикация есть)',
    not exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    or (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename in ('inspections', 'inspection_items')) = 2);

  raise exception E'ОТЧЁТ (данные откатаны):\n%', rep;
end $$;
