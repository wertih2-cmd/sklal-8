/*
# Unit tracking: stricter guard, issued units in balance check, unit reports

1. Guard on new items
- The track_units guard now also runs when an item is inserted. A new item cannot start with unit tracking on unless the session setting app.unit_tracking_enable is 'on'. Turning it off and other UPDATE rules are unchanged.

2. Balance mismatch view
- unit_balance_mismatch now counts units with status 'in_stock' or 'issued' at their location. 'in_stock' is stock on the warehouse or owner shelf, 'issued' is units in an apartment or with an employee.
- External locations (source, sink) are still excluded. The view keeps security_invoker and is_admin() filtering.

3. New admin reports
- report_unit_history(p_unit uuid): one unit with its full event history, ordered by time. Returns null if the unit does not exist.
- report_owner_units(p_owner_apartment integer default null): units held by owner apartments, optionally filtered to one apartment, sorted by apartment code and unit code.

4. Security
- Both report functions are SECURITY DEFINER with search_path = public. The first statement checks is_admin() and raises 42501 'Только администратор' otherwise.
- EXECUTE is revoked from PUBLIC and anon and granted to authenticated only.
- _insert_move and its grants are not changed.
*/

CREATE OR REPLACE FUNCTION trg_guard_track_units()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.track_units AND current_setting('app.unit_tracking_enable', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Поштучный учёт включается только отдельной процедурой';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.track_units IS DISTINCT FROM OLD.track_units THEN
    IF NEW.track_units AND current_setting('app.unit_tracking_enable', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Поштучный учёт включается только отдельной процедурой';
    END IF;
    IF OLD.track_units AND NOT NEW.track_units
       AND EXISTS (SELECT 1 FROM item_units WHERE item_id = NEW.id) THEN
      RAISE EXCEPTION 'Нельзя выключить поштучный учёт: у товара есть отдельные единицы';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS items_guard_track_units ON items;
CREATE TRIGGER items_guard_track_units
  BEFORE INSERT OR UPDATE OF track_units ON items
  FOR EACH ROW EXECUTE FUNCTION trg_guard_track_units();

CREATE OR REPLACE VIEW unit_balance_mismatch
WITH (security_invoker = true)
AS
WITH balances AS (
  SELECT item_id, loc_id, sum(qty) AS balance_qty
  FROM stock_balance
  GROUP BY item_id, loc_id
),
unit_counts AS (
  SELECT item_id, location_id AS loc_id, count(*) AS unit_count
  FROM item_units
  WHERE status IN ('in_stock', 'issued')
  GROUP BY item_id, location_id
),
keys AS (
  SELECT item_id, loc_id FROM balances
  UNION
  SELECT item_id, loc_id FROM unit_counts
)
SELECT k.item_id,
       k.loc_id,
       COALESCE(b.balance_qty, 0) AS balance_qty,
       COALESCE(u.unit_count, 0) AS unit_count
FROM keys k
JOIN items i ON i.id = k.item_id AND i.track_units
JOIN locations l ON l.id = k.loc_id AND l.type NOT IN ('source', 'sink')
LEFT JOIN balances b ON b.item_id = k.item_id AND b.loc_id = k.loc_id
LEFT JOIN unit_counts u ON u.item_id = k.item_id AND u.loc_id = k.loc_id
WHERE is_admin()
  AND COALESCE(b.balance_qty, 0) <> COALESCE(u.unit_count, 0);

CREATE OR REPLACE FUNCTION report_unit_history(p_unit uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unit jsonb;
  v_events jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Только администратор' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id', u.id,
    'code', u.code,
    'item_id', u.item_id,
    'item_name', i.name,
    'status', u.status,
    'location', l.name,
    'owner_apartment', a.code,
    'unit_cost', u.unit_cost,
    'created_at', u.created_at
  )
  INTO v_unit
  FROM item_units u
  JOIN items i ON i.id = u.item_id
  JOIN locations l ON l.id = u.location_id
  LEFT JOIN apartments a ON a.id = u.owner_apartment_id
  WHERE u.id = p_unit;

  IF v_unit IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'at', e.created_at,
    'event', e.event,
    'from_location', fl.name,
    'to_location', tl.name,
    'doc_number', d.number,
    'move_id', e.move_id,
    'note', e.note
  ) ORDER BY e.created_at, e.id), '[]'::jsonb)
  INTO v_events
  FROM unit_events e
  LEFT JOIN locations fl ON fl.id = e.from_loc
  LEFT JOIN locations tl ON tl.id = e.to_loc
  LEFT JOIN documents d ON d.id = e.doc_id
  WHERE e.unit_id = p_unit;

  RETURN jsonb_build_object('unit', v_unit, 'events', v_events);
END;
$$;

CREATE OR REPLACE FUNCTION report_owner_units(p_owner_apartment integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Только администратор' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'unit_id', u.id,
      'code', u.code,
      'item_id', u.item_id,
      'item_name', jsonb_build_object('name', i.name, 'name_en', i.name_en, 'name_ar', i.name_ar),
      'status', u.status,
      'location', l.name,
      'apartment', a.code,
      'unit_cost', u.unit_cost,
      'created_at', u.created_at,
      'last_event_at', le.last_event_at
    ) ORDER BY a.code, u.code)
    FROM item_units u
    JOIN items i ON i.id = u.item_id
    JOIN locations l ON l.id = u.location_id
    JOIN apartments a ON a.id = u.owner_apartment_id
    LEFT JOIN LATERAL (
      SELECT max(e.created_at) AS last_event_at FROM unit_events e WHERE e.unit_id = u.id
    ) le ON true
    WHERE u.owner_apartment_id IS NOT NULL
      AND (p_owner_apartment IS NULL OR u.owner_apartment_id = p_owner_apartment)
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION report_unit_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION report_unit_history(uuid) TO authenticated;

REVOKE ALL ON FUNCTION report_owner_units(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION report_owner_units(integer) TO authenticated;
