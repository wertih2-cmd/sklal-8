-- Откат manager-rights-2.sql: возвращает approve_incident из manager-rights.sql.

create or replace function public.approve_incident(p_incident uuid, p_decision text, p_note text default null,
                                        p_force boolean default false, p_charge jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  i incidents%rowtype; v_move bigint; v_apt int;
  v_base numeric; v_coef numeric; v_amount numeric;
  v_base_source text; v_coef_source text;
  v_owner int; v_move_rec stock_moves%rowtype;
  v_item_tenant numeric; v_cat_tenant numeric;
  v_mgr boolean := not is_admin();
begin
  if not (is_admin() or is_manager()) then raise exception 'Только администратор или менеджер' using errcode = '42501'; end if;
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

  -- менеджер: подтверждение без списания склада и без начисления
  if v_mgr then
    if p_charge is not null or p_force then
      raise exception 'Списание и начисление доступны только администратору' using errcode = '42501';
    end if;
    update incidents set status = 'confirmed', resolved_by = auth.uid(), resolved_at = now(), resolution_note = p_note
     where id = p_incident;
    return jsonb_build_object('status', 'confirmed', 'move_id', null);
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
