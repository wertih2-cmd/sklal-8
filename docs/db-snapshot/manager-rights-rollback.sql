-- Откат manager-rights.sql: возвращает прежние тела (только администратор) и удаляет apartment_completeness.

create or replace function take_incident(
  p_incident uuid, p_assignee uuid default null, p_due timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_assignee uuid := coalesce(p_assignee, auth.uid());
begin
  if not is_admin() then
    raise exception 'Только администратор' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles
                 where id = v_assignee and active
                   and role::text in ('admin','manager')) then
    raise exception 'Исполнитель не найден или неактивен';
  end if;
  update incidents
     set status = 'in_progress', assigned_to = v_assignee,
         due_at = p_due, taken_at = coalesce(taken_at, now())
   where id = p_incident and status in ('new','in_progress');
  if not found then raise exception 'Заявка не найдена или уже закрыта'; end if;
  return jsonb_build_object('status','in_progress','assigned_to',v_assignee,'due_at',p_due);
end $$;
revoke execute on function take_incident(uuid,uuid,timestamptz) from public, anon;
grant  execute on function take_incident(uuid,uuid,timestamptz) to authenticated;

create or replace function public.approve_incident(p_incident uuid, p_decision text, p_note text default null,
                                        p_force boolean default false, p_charge jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  i incidents%rowtype; v_move bigint; v_apt int;
  v_base numeric; v_coef numeric; v_amount numeric;
  v_base_source text; v_coef_source text;
  v_owner int; v_move_rec stock_moves%rowtype;
  v_item_tenant numeric; v_cat_tenant numeric;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  select * into i from incidents where id = p_incident;
  if not found or i.status not in ('new','in_progress') then
    raise exception 'Заявка не найдена или уже обработана';
  end if;

  if p_decision = 'reject' then
    update incidents set status = 'rejected', resolved_by = auth.uid(), resolved_at = now(), resolution_note = p_note
     where id = p_incident;
    return jsonb_build_object('status', 'rejected');
  elsif p_decision <> 'confirm' then
    raise exception 'Решение должно быть confirm или reject';
  end if;

  if i.item_id is not null then
    v_apt := _loc_apartment(i.apartment_id);
    if not p_force and _bal(v_apt, i.item_id) < i.qty then raise exception 'Нет в апартаменте'; end if;
    v_move := _insert_move(i.item_id, v_apt, _loc_singleton('sink'), i.qty, null, 'incident', i.id::text,
                           i.apartment_id, null, null, i.kind::text || ': ' || coalesce(i.comment, ''), now(), null);
  end if;

  update incidents set status = 'confirmed', resolved_by = auth.uid(), resolved_at = now(),
                       resolution_note = p_note, writeoff_move_id = v_move where id = p_incident;

  -- charge
  if p_charge is not null then
    -- base_cost
    if p_charge ? 'base_cost' and (p_charge->>'base_cost') is not null then
      v_base := (p_charge->>'base_cost')::numeric;
      v_base_source := 'manual';
    elsif v_move is not null then
      select * into v_move_rec from stock_moves where id = v_move;
      if v_move_rec.unit_cost is null then
        raise exception 'Укажите закупочную цену';
      end if;
      v_base := v_move_rec.unit_cost;
      if v_move_rec.owner_apartment_id is not null then
        v_base_source := 'owner';
      else
        v_base_source := 'company';
      end if;
    else
      raise exception 'Укажите закупочную цену';
    end if;

    -- coef: explicit → items → categories
    if p_charge ? 'coef' and (p_charge->>'coef') is not null then
      v_coef := (p_charge->>'coef')::numeric;
      v_coef_source := 'manual';
    else
      select coef into v_item_tenant from tenant_coefs where item_id = i.item_id;
      if v_item_tenant is not null then
        v_coef := v_item_tenant;
        v_coef_source := 'item';
      else
        select tc.coef into v_cat_tenant
          from items i2 join tenant_coefs tc on tc.category_id = i2.category_id where i2.id = i.item_id;
        if v_cat_tenant is not null then
          v_coef := v_cat_tenant;
          v_coef_source := 'category';
        else
          raise exception 'Не задан коэффициент для жильцов: укажите его в заявке или в каталоге';
        end if;
      end if;
    end if;

    if v_coef is null or v_coef <= 0 then
      raise exception 'Не задан коэффициент для жильцов: укажите его в заявке или в каталоге';
    end if;

    v_amount := round(i.qty * v_base * v_coef, 2);

    insert into incident_charges(incident_id, tenant_note, base_cost, base_source, coef, amount, status, created_by)
    values (p_incident, p_charge->>'tenant_note', v_base, v_base_source, v_coef, v_amount, 'pending', auth.uid())
    on conflict (incident_id) do nothing;
  end if;

  return jsonb_build_object('status', 'confirmed', 'move_id', v_move);
end $$;
revoke all on function public.approve_incident(uuid, text, text, boolean, jsonb) from public, anon;
grant execute on function public.approve_incident(uuid, text, text, boolean, jsonb) to authenticated;

create or replace function approve_cleaning(p_event uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e cleaning_events%rowtype; v_res jsonb;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  select * into e from cleaning_events where id = p_event for update;
  if not found or e.posting_status <> 'pending' or e.status <> 'done' then
    raise exception 'Уборка не найдена или уже обработана';
  end if;
  if p_decision = 'reject' then
    update cleaning_events
       set posting_status = 'rejected', status = 'reversed',
           reversed_by = auth.uid(), reversed_at = now(),
           reverse_reason = coalesce(p_note, 'Отклонено администратором'),
           approved_by = auth.uid(), approved_at = now(), approval_note = p_note
     where id = p_event;
    insert into events(type, payload)
    values ('cleaning_rejected', jsonb_build_object('event_id', p_event, 'apartment_id', e.apartment_id));
    return jsonb_build_object('status', 'rejected');
  elsif p_decision <> 'confirm' then
    raise exception 'Решение должно быть confirm или reject';
  end if;
  v_res := _post_cleaning_lines(p_event, e.revision);
  update cleaning_events
     set posting_status = 'posted', approved_by = auth.uid(), approved_at = now(), approval_note = p_note
   where id = p_event;
  insert into events(type, payload)
  values ('cleaning_done', jsonb_build_object('event_id', p_event, 'apartment_id', e.apartment_id));
  return _cleaning_summary(p_event) || jsonb_build_object('status', 'confirmed', 'shortages', v_res->'shortages');
end $$;
revoke all on function approve_cleaning(uuid,text,text) from public, anon;
grant execute on function approve_cleaning(uuid,text,text) to authenticated;

drop function if exists apartment_completeness();
