-- Этап «Задания»: менеджер ставит задание, супервайзеры видят все задания и берут их в работу.
-- Адресата у задания нет: его видят все супервайзеры, менеджеры и админ (решение пользователя: вариант «всем супервайзерам»).
-- Состав: квартира (необязательно), дата, тип (уборка / проверка / другое), текст без фото, срок, статус новое -> принято -> выполнено,
-- кто создал, кто принял, кто выполнил (имя пишется в строку: профили супервайзеру недоступны).
-- Создаёт и удаляет менеджер или админ; статус меняют супервайзер, менеджер, админ. Прямая запись в таблицу закрыта, всё через RPC.
-- Назад (выполнено -> принято -> новое) возвращают только менеджер и админ; переход через статус не допускается.
-- Удалить задание можно, пока оно «новое»; принятое и выполненное удаляет только админ.
-- Правки текста нет: ошибочное задание удаляют и создают заново. Рассылка в WhatsApp делается на клиенте, сервер ничего не отправляет.

create table tasks (
  id                bigserial primary key,
  apartment_id      int references apartments(id),
  task_date         date not null,
  kind              text not null check (kind in ('cleaning', 'inspection', 'other')),
  body              text not null check (length(btrim(body)) between 1 and 2000),
  due_date          date,
  status            text not null default 'new' check (status in ('new', 'accepted', 'done')),
  created_by        uuid default auth.uid(),
  created_by_name   text,
  created_at        timestamptz not null default now(),
  accepted_by       uuid,
  accepted_by_name  text,
  accepted_at       timestamptz,
  done_by           uuid,
  done_by_name      text,
  done_at           timestamptz,
  check (due_date is null or due_date >= task_date)
);
create index tasks_status_date on tasks(status, task_date desc);
create index tasks_apartment   on tasks(apartment_id);

alter table tasks enable row level security;
revoke all on tasks from anon;
revoke insert, update, delete on tasks from authenticated;
-- читают админ и все супервайзеры (is_supervisor() включает менеджера); пишут только RPC
create policy tasks_read on tasks for select to authenticated using (is_admin() or is_supervisor());

create trigger audit_tasks after insert or update or delete on tasks
  for each row execute function audit_row();

-- Создать задание: менеджер или админ
create or replace function task_create(p_apartment int, p_date date, p_kind text, p_body text, p_due date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; v_day date; v_id bigint; v_body text;
begin
  if not (is_admin() or is_manager()) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('cleaning', 'inspection', 'other') then
    raise exception 'Неверный тип задания';
  end if;
  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then raise exception 'Введите текст задания'; end if;
  if length(v_body) > 2000 then raise exception 'Текст задания не длиннее 2000 символов'; end if;
  v_day := coalesce(p_date, (now() at time zone 'Africa/Cairo')::date);
  if p_due is not null and p_due < v_day then raise exception 'Срок раньше даты задания'; end if;
  if p_apartment is not null and not exists (select 1 from apartments where id = p_apartment) then
    raise exception 'Квартира не найдена';
  end if;
  select coalesce(full_name, login) into v_name from profiles where id = auth.uid();
  insert into tasks(apartment_id, task_date, kind, body, due_date, created_by, created_by_name)
  values (p_apartment, v_day, p_kind, v_body, p_due, auth.uid(), v_name)
  returning id into v_id;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

-- Сменить статус: вперёд на один шаг может супервайзер, менеджер и админ; назад на один шаг только менеджер и админ
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

-- Удалить задание: менеджер или админ; менеджер только «новое»
create or replace function task_delete(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tasks%rowtype;
begin
  if not (is_admin() or is_manager()) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  select * into t from tasks where id = p_id for update;
  if not found then raise exception 'Задание не найдено'; end if;
  if t.status <> 'new' and not is_admin() then
    raise exception 'Принятое задание удаляет только админ' using errcode = '42501';
  end if;
  delete from tasks where id = p_id;
  return jsonb_build_object('status', 'ok');
end $$;

revoke all on function task_create(int, date, text, text, date), task_set_status(bigint, text), task_delete(bigint) from public, anon;
grant execute on function task_create(int, date, text, text, date), task_set_status(bigint, text), task_delete(bigint) to authenticated;

-- живое обновление списка у супервайзеров
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks') then
    alter publication supabase_realtime add table public.tasks;
  end if;
end $$;
