-- Откат этапа «Чек-листы и инспекции» (checklists.sql).
-- Внимание: данные чек-листов и инспекций удаляются безвозвратно. Задания «доработка» остаются, но становятся обычными («прочее»),
-- а проверенные задания возвращаются в «выполнено», иначе старые ограничения на тип и статус не вернуть.

drop function if exists inspection_delete(bigint);
drop function if exists inspection_recheck(bigint, boolean, text, text[]);
drop function if exists inspection_create(uuid, jsonb);
drop function if exists checklist_save(apt_type, jsonb);
drop function if exists _inspection_refresh(bigint);
drop function if exists _check_photo_paths(text[], int);

drop table if exists inspection_items;
drop table if exists inspections;
drop table if exists checklist_items;

update tasks set kind = 'other' where kind = 'rework';
update tasks set status = 'done' where status = 'verified';

alter table tasks
  drop constraint if exists tasks_kind_check,
  drop constraint if exists tasks_status_check,
  drop column if exists verified_by,
  drop column if exists verified_by_name,
  drop column if exists verified_at,
  drop column if exists return_note;
alter table tasks
  add constraint tasks_kind_check   check (kind in ('cleaning', 'inspection', 'other')),
  add constraint tasks_status_check check (status in ('new', 'accepted', 'done'));

-- прежняя версия task_set_status (из tasks.sql)
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
revoke all on function task_set_status(bigint, text) from public, anon;
grant execute on function task_set_status(bigint, text) to authenticated;
