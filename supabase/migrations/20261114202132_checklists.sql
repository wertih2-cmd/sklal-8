-- Этап «Чек-листы и инспекции».
-- Решения пользователя: инспекцию проводит супервайзер или менеджер (админ тоже может); фото по пункту необязательно и допустимо к любому пункту;
-- пункт «не ок» автоматически создаёт задание на доработку (тип «доработка»), а после повторной проверки задание получает статус «проверено».
-- Мои решения (можно поменять): шаблон правят менеджер и админ; один шаблон на тип квартиры; инспекция одна на уборку;
-- фото лежат в уже существующем бакете cleaning-media в папке <uid>/..., своих правил хранилища не добавляется;
-- у задания нет адресата, поэтому «для того, кто убирал» значит: имена убиравших записаны в текст задания.
-- Прямая запись в новые таблицы закрыта, всё через RPC. Таблица tasks получает тип «доработка», статус «проверено», причину возврата.

-- 1. Задания: тип «rework», статус «verified», отметка о проверке и причина возврата
do $$
declare c record;
begin
  for c in select conname, pg_get_constraintdef(oid) as def from pg_constraint
           where conrelid = 'public.tasks'::regclass and contype = 'c' loop
    if c.def like '%status%' or c.def like '%kind%' then
      execute format('alter table public.tasks drop constraint %I', c.conname);
    end if;
  end loop;
end $$;
alter table tasks
  add constraint tasks_kind_check   check (kind in ('cleaning', 'inspection', 'other', 'rework')),
  add constraint tasks_status_check check (status in ('new', 'accepted', 'done', 'verified')),
  add column verified_by      uuid,
  add column verified_by_name text,
  add column verified_at      timestamptz,
  add column return_note      text check (return_note is null or length(return_note) <= 500);

-- 2. Шаблон: пункты по типу квартиры
create table checklist_items (
  id       bigserial primary key,
  apt_type apt_type not null,
  position int not null,
  body     text not null check (length(btrim(body)) between 1 and 200)
);
create index checklist_items_type on checklist_items(apt_type, position);

-- 3. Инспекции и их пункты (текст пункта копируется на момент проверки)
create table inspections (
  id                bigserial primary key,
  cleaning_event_id uuid not null unique references cleaning_events(id) on delete cascade,
  apartment_id      int  not null references apartments(id),
  status            text not null default 'passed' check (status in ('passed', 'needs_rework')),
  inspector_id      uuid default auth.uid(),
  inspector_name    text,
  inspected_at      timestamptz not null default now()
);
create index inspections_apartment on inspections(apartment_id, inspected_at desc);
create index inspections_rework    on inspections(status) where status = 'needs_rework';

create table inspection_items (
  id                  bigserial primary key,
  inspection_id       bigint not null references inspections(id) on delete cascade,
  position            int  not null,
  body                text not null,
  ok                  boolean not null,
  note                text check (note is null or length(note) <= 500),
  photo_paths         text[] not null default '{}' check (cardinality(photo_paths) <= 6),
  task_id             bigint references tasks(id) on delete set null,
  resolved_at         timestamptz,
  resolved_by         uuid,
  resolved_by_name    text,
  recheck_note        text check (recheck_note is null or length(recheck_note) <= 500),
  recheck_count       int  not null default 0,
  recheck_photo_paths text[] not null default '{}' check (cardinality(recheck_photo_paths) <= 6)
);
create index inspection_items_inspection on inspection_items(inspection_id, position);
create unique index inspection_items_task on inspection_items(task_id) where task_id is not null;

alter table checklist_items  enable row level security;
alter table inspections      enable row level security;
alter table inspection_items enable row level security;
revoke all on checklist_items, inspections, inspection_items from anon;
revoke insert, update, delete on checklist_items, inspections, inspection_items from authenticated;
-- читают админ и все супервайзеры (is_supervisor() включает менеджера); пишут только RPC
create policy checklist_items_read  on checklist_items  for select to authenticated using (is_admin() or is_supervisor());
create policy inspections_read      on inspections      for select to authenticated using (is_admin() or is_supervisor());
create policy inspection_items_read on inspection_items for select to authenticated using (is_admin() or is_supervisor());

create trigger audit_checklist_items  after insert or update or delete on checklist_items  for each row execute function audit_row();
create trigger audit_inspections      after insert or update or delete on inspections      for each row execute function audit_row();
create trigger audit_inspection_items after insert or update or delete on inspection_items for each row execute function audit_row();

-- 4. Внутренние функции (клиенту не выдаются)
-- Пути фото: только в своей папке <uid>/, не больше p_max штук
create or replace function _check_photo_paths(p_paths text[], p_max int)
returns text[] language plpgsql set search_path = public as $$
declare v_path text; v_prefix text;
begin
  if p_paths is null then return '{}'::text[]; end if;
  if cardinality(p_paths) > p_max then raise exception 'Не больше % фото на пункт', p_max; end if;
  v_prefix := auth.uid()::text || '/';
  foreach v_path in array p_paths loop
    if v_path is null or position(v_prefix in v_path) <> 1 or length(v_path) > 300 then
      raise exception 'Недопустимый путь фото';
    end if;
  end loop;
  return p_paths;
end $$;

-- Статус инспекции: «проверено», пока нет ни одного пункта «не ок» без успешной повторной проверки
create or replace function _inspection_refresh(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update inspections set status = case
    when exists (select 1 from inspection_items where inspection_id = p_id and not ok and resolved_at is null) then 'needs_rework'
    else 'passed' end
  where id = p_id;
end $$;

-- 5. Сохранить шаблон типа квартиры: менеджер или админ. p_items: [{"id": 12, "text": "..."}, {"text": "..."}], порядок массива = порядок пунктов.
-- Пункты с id сохраняются (меняется текст и место), без id добавляются, не названные удаляются. Уже проведённые инспекции не меняются.
create or replace function checklist_save(p_type apt_type, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare el jsonb; v_text text; v_id bigint; v_pos int := 0; v_keep bigint[] := '{}';
begin
  if not (is_admin() or is_manager()) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  if p_type is null then raise exception 'Не указан тип квартиры'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Нужен список пунктов'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'Не больше 60 пунктов'; end if;
  perform pg_advisory_xact_lock(hashtext('checklist_save:' || p_type::text));
  for el in select value from jsonb_array_elements(p_items) loop
    v_pos := v_pos + 1;
    if jsonb_typeof(el) <> 'object' then raise exception 'Неверный формат пункта %', v_pos; end if;
    v_text := btrim(coalesce(el->>'text', ''));
    if v_text = '' then raise exception 'Пункт % пустой', v_pos; end if;
    if length(v_text) > 200 then raise exception 'Пункт % длиннее 200 символов', v_pos; end if;
    if el->>'id' is not null then
      v_id := (el->>'id')::bigint;
      if v_id = any(v_keep) then raise exception 'Пункт указан дважды'; end if;
      update checklist_items set body = v_text, position = v_pos where id = v_id and apt_type = p_type;
      if not found then raise exception 'Пункт не найден: %', v_id; end if;
    else
      insert into checklist_items(apt_type, position, body) values (p_type, v_pos, v_text) returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;
  delete from checklist_items where apt_type = p_type and not (id = any(v_keep));
  return jsonb_build_object('status', 'ok', 'count', v_pos);
end $$;

-- 6. Провести инспекцию уборки: супервайзер, менеджер или админ.
-- p_results: [{"item_id": 12, "ok": true|false, "note": "...", "photos": ["<uid>/..."]}], ответ нужен на каждый пункт шаблона.
-- Каждый пункт «не ок» создаёт задание на доработку (тип «rework», новое) с текстом пункта и именами убиравших.
create or replace function inspection_create(p_event uuid, p_results jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ev cleaning_events%rowtype; r record; el jsonb;
  v_type apt_type; v_name text; v_cleaners text; v_insp bigint; v_item bigint; v_task bigint;
  v_total int; v_failed int := 0; v_ok boolean; v_note text; v_photos text[]; v_day date; v_body text;
begin
  if not (is_admin() or is_supervisor()) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  select * into ev from cleaning_events where id = p_event for update;
  if not found then raise exception 'Уборка не найдена'; end if;
  if ev.status <> 'done' or ev.posting_status = 'rejected' then
    raise exception 'Проверять можно только действующую уборку';
  end if;
  if exists (select 1 from inspections where cleaning_event_id = p_event) then
    raise exception 'Эта уборка уже проверена';
  end if;
  select type into v_type from apartments where id = ev.apartment_id;
  select count(*) into v_total from checklist_items where apt_type = v_type;
  if v_total = 0 then raise exception 'Для этого типа квартиры нет шаблона чек-листа'; end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' then raise exception 'Нужен список ответов'; end if;
  if jsonb_array_length(p_results) <> v_total then raise exception 'Нужно ответить на все пункты: %', v_total; end if;
  if exists (select 1 from jsonb_array_elements(p_results) as t(x) where jsonb_typeof(x) <> 'object') then
    raise exception 'Неверный формат ответа';
  end if;
  if (select count(distinct x->>'item_id') from jsonb_array_elements(p_results) as t(x)) <> v_total then
    raise exception 'Пункты повторяются';
  end if;
  if exists (select 1 from jsonb_array_elements(p_results) as t(x)
             where not exists (select 1 from checklist_items ci where ci.apt_type = v_type and ci.id::text = x->>'item_id')) then
    raise exception 'Шаблон изменился, обновите чек-лист';
  end if;
  if exists (select 1 from jsonb_array_elements(p_results) as t(x) where jsonb_typeof(x->'ok') is distinct from 'boolean') then
    raise exception 'Для каждого пункта нужен ответ: ок или не ок';
  end if;
  select coalesce(full_name, login) into v_name from profiles where id = auth.uid();
  select string_agg(s.full_name, ', ' order by s.full_name) into v_cleaners
    from cleaning_event_staff ces join staff s on s.id = ces.staff_id where ces.event_id = p_event;
  if v_cleaners is null and ev.lead_staff_id is not null then
    select full_name into v_cleaners from staff where id = ev.lead_staff_id;
  end if;
  v_day := (now() at time zone 'Africa/Cairo')::date;
  insert into inspections(cleaning_event_id, apartment_id, inspector_id, inspector_name)
  values (p_event, ev.apartment_id, auth.uid(), v_name) returning id into v_insp;
  for r in select id, position, body from checklist_items where apt_type = v_type order by position, id loop
    select x into el from jsonb_array_elements(p_results) as t(x) where x->>'item_id' = r.id::text;
    v_ok := (el->>'ok')::boolean;
    v_note := nullif(btrim(coalesce(el->>'note', '')), '');
    if v_note is not null and length(v_note) > 500 then raise exception 'Комментарий длиннее 500 символов'; end if;
    if el->'photos' is null or jsonb_typeof(el->'photos') = 'null' then
      v_photos := '{}'::text[];
    elsif jsonb_typeof(el->'photos') <> 'array' then
      raise exception 'Фото нужно передать списком';
    else
      select coalesce(array_agg(v), '{}'::text[]) into v_photos from jsonb_array_elements_text(el->'photos') as p(v);
    end if;
    v_photos := _check_photo_paths(v_photos, 6);
    insert into inspection_items(inspection_id, position, body, ok, note, photo_paths)
    values (v_insp, r.position, r.body, v_ok, v_note, v_photos) returning id into v_item;
    if not v_ok then
      v_failed := v_failed + 1;
      v_body := left('Доработка после уборки ' || to_char(ev.cleaned_at at time zone 'Africa/Cairo', 'DD.MM.YYYY')
                     || ': ' || r.body || coalesce(' (' || v_note || ')', '')
                     || '. Убирали: ' || coalesce(v_cleaners, 'не указано'), 2000);
      insert into tasks(apartment_id, task_date, kind, body, created_by, created_by_name)
      values (ev.apartment_id, v_day, 'rework', v_body, auth.uid(), v_name) returning id into v_task;
      update inspection_items set task_id = v_task where id = v_item;
    end if;
  end loop;
  perform _inspection_refresh(v_insp);
  return jsonb_build_object('status', 'ok', 'id', v_insp, 'failed', v_failed, 'passed', v_failed = 0);
end $$;

-- 7. Повторная проверка пункта «не ок»: супервайзер, менеджер или админ.
-- ok = true: задание становится «проверено», пункт закрыт. ok = false: задание возвращается в «принято» с причиной, пункт остаётся открытым.
-- Доработка должна быть выполнена (задание «выполнено»); если задание удалено, пункт можно закрыть без него.
create or replace function inspection_recheck(p_item bigint, p_ok boolean, p_note text default null, p_photos text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare it inspection_items%rowtype; t tasks%rowtype; v_has_task boolean := false; v_name text; v_note text; v_photos text[];
begin
  if not (is_admin() or is_supervisor()) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  if p_ok is null then raise exception 'Нужен ответ: ок или не ок'; end if;
  select * into it from inspection_items where id = p_item for update;
  if not found then raise exception 'Пункт не найден'; end if;
  if it.ok then raise exception 'Пункт отмечен как ок, повторная проверка не нужна'; end if;
  if it.resolved_at is not null then raise exception 'Пункт уже проверен повторно'; end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and length(v_note) > 500 then raise exception 'Комментарий длиннее 500 символов'; end if;
  if not p_ok and v_note is null then raise exception 'Укажите, что не так'; end if;
  v_photos := _check_photo_paths(p_photos, 6);
  if it.task_id is not null then
    select * into t from tasks where id = it.task_id for update;
    v_has_task := found;
    if v_has_task and t.status <> 'done' then
      raise exception 'Доработка ещё не выполнена';
    end if;
  end if;
  select coalesce(full_name, login) into v_name from profiles where id = auth.uid();
  if p_ok then
    update inspection_items set resolved_at = now(), resolved_by = auth.uid(), resolved_by_name = v_name,
      recheck_note = v_note, recheck_count = recheck_count + 1, recheck_photo_paths = v_photos where id = p_item;
    if v_has_task then
      update tasks set status = 'verified', verified_by = auth.uid(), verified_by_name = v_name, verified_at = now(), return_note = null
      where id = t.id;
    end if;
  else
    update inspection_items set recheck_note = v_note, recheck_count = recheck_count + 1, recheck_photo_paths = v_photos where id = p_item;
    if v_has_task then
      update tasks set status = 'accepted', done_by = null, done_by_name = null, done_at = null, return_note = v_note
      where id = t.id;
    end if;
  end if;
  perform _inspection_refresh(it.inspection_id);
  return jsonb_build_object('status', 'ok', 'verified', p_ok);
end $$;

-- 8. Удалить инспекцию (ошибочную): менеджер или админ. Новые задания на доработку удаляются, принятые и выполненные остаются.
create or replace function inspection_delete(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tasks int;
begin
  if not (is_admin() or is_manager()) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  perform 1 from inspections where id = p_id for update;
  if not found then raise exception 'Инспекция не найдена'; end if;
  delete from tasks where kind = 'rework' and status = 'new'
    and id in (select task_id from inspection_items where inspection_id = p_id and task_id is not null);
  get diagnostics v_tasks = row_count;
  delete from inspections where id = p_id;
  return jsonb_build_object('status', 'ok', 'tasks_deleted', v_tasks);
end $$;

-- 9. task_set_status: проверенное задание не меняется (статус «проверено» ставит только inspection_recheck)
create or replace function task_set_status(p_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tasks%rowtype; v_name text; v_back boolean;
begin
  if not (is_admin() or is_supervisor()) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('new', 'accepted', 'done') then
    raise exception 'Неверный статус';
  end if;
  select * into t from tasks where id = p_id for update;
  if not found then raise exception 'Задание не найдено'; end if;
  if t.status = 'verified' then raise exception 'Проверенное задание не меняется'; end if;
  if t.status = p_status then
    return jsonb_build_object('status', 'ok', 'unchanged', true);
  end if;
  v_back := (t.status = 'done' and p_status = 'accepted') or (t.status = 'accepted' and p_status = 'new');
  if not (v_back or (t.status = 'new' and p_status = 'accepted') or (t.status = 'accepted' and p_status = 'done')) then
    raise exception 'Недопустимый переход статуса';
  end if;
  if v_back and not (is_admin() or is_manager()) then
    raise exception 'Вернуть статус назад может менеджер или админ' using errcode = '42501';
  end if;
  select coalesce(full_name, login) into v_name from profiles where id = auth.uid();
  if p_status = 'accepted' and not v_back then
    update tasks set status = 'accepted', accepted_by = auth.uid(), accepted_by_name = v_name, accepted_at = now() where id = p_id;
  elsif p_status = 'done' then
    update tasks set status = 'done', done_by = auth.uid(), done_by_name = v_name, done_at = now() where id = p_id;
  elsif p_status = 'accepted' then   -- назад из «выполнено»: отметка о приёме остаётся, отметка о выполнении снимается
    update tasks set status = 'accepted', done_by = null, done_by_name = null, done_at = null where id = p_id;
  else                               -- назад из «принято»
    update tasks set status = 'new', accepted_by = null, accepted_by_name = null, accepted_at = null where id = p_id;
  end if;
  return jsonb_build_object('status', 'ok');
end $$;

-- 10. Права: внутренние функции клиенту не выдаются
revoke all on function _check_photo_paths(text[], int), _inspection_refresh(bigint) from public, anon, authenticated;
revoke all on function checklist_save(apt_type, jsonb), inspection_create(uuid, jsonb), inspection_recheck(bigint, boolean, text, text[]),
  inspection_delete(bigint), task_set_status(bigint, text) from public, anon;
grant execute on function checklist_save(apt_type, jsonb), inspection_create(uuid, jsonb), inspection_recheck(bigint, boolean, text, text[]),
  inspection_delete(bigint), task_set_status(bigint, text) to authenticated;

-- 11. Живое обновление
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['inspections', 'inspection_items'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;