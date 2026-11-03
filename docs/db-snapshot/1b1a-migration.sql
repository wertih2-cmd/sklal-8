/*
# Unit tracking foundation (piece-by-piece inventory)

Adds the database groundwork for tracking individual physical pieces of selected items. No screens change in this migration.

1. Items
- New column `items.track_units` (boolean, not null, default false). Every existing item keeps false, so current behaviour is unchanged.
- Switching it on is allowed only when the session setting `app.unit_tracking_enable` is 'on', which the future enable procedure sets inside its own transaction.
- Switching it off is refused while the item still has individual pieces.

2. New tables
- `item_units`: one row per physical piece (unique code, status in_stock / issued / written_off / lost, current location, owner apartment, unit cost).
- `unit_events`: append-only history of each piece (event, from/to location, related document, related stock move, who and when). UPDATE and DELETE are rejected by the existing journal guard.

3. Security
- Both tables have row level security enabled with a single admin-only SELECT policy. Anonymous users get nothing; no client write grants are given, so writes will come only from server-side functions.
- Table and view grants are revoked from anon, authenticated and PUBLIC, then SELECT is granted to authenticated only.
- `unit_balance_mismatch` view runs with the caller's rights and also filters on is_admin().
- The two new trigger functions have a fixed search_path and EXECUTE revoked from PUBLIC, anon and authenticated.
- `_insert_move` signature and privileges are not changed.

4. Temporary guard on stock moves
- For items with track_units = true, stock moves are allowed only for receipts (source 'manual' / 'receipt') and opening balances (source 'opening'). Issues, transfers and write-offs are rejected with a message until per-piece operations ship.
- Items with track_units = false are not affected.

5. Notes
- "In stock" count for the mismatch view uses units with status in_stock at each location, compared with the stock balance of that location.
*/

ALTER TABLE items ADD COLUMN IF NOT EXISTS track_units boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS item_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id integer NOT NULL REFERENCES items(id),
  code text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('in_stock', 'issued', 'written_off', 'lost')),
  location_id integer NOT NULL REFERENCES locations(id),
  owner_apartment_id integer REFERENCES apartments(id),
  unit_cost numeric(16,6),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS item_units_item_id_idx ON item_units (item_id);
CREATE INDEX IF NOT EXISTS item_units_location_id_idx ON item_units (location_id);

CREATE TABLE IF NOT EXISTS unit_events (
  id bigserial PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES item_units(id),
  event text NOT NULL,
  from_loc integer,
  to_loc integer,
  doc_id uuid REFERENCES documents(id),
  move_id bigint REFERENCES stock_moves(id),
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS unit_events_unit_id_idx ON unit_events (unit_id);

CREATE OR REPLACE FUNCTION trg_guard_track_units()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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

REVOKE EXECUTE ON FUNCTION trg_guard_track_units() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS items_guard_track_units ON items;
CREATE TRIGGER items_guard_track_units
  BEFORE UPDATE OF track_units ON items
  FOR EACH ROW EXECUTE FUNCTION trg_guard_track_units();

DROP TRIGGER IF EXISTS unit_events_append_only ON unit_events;
CREATE TRIGGER unit_events_append_only
  BEFORE UPDATE OR DELETE ON unit_events
  FOR EACH ROW EXECUTE FUNCTION trg_forbid_mutation();

CREATE OR REPLACE FUNCTION trg_guard_unit_tracked_moves()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.source_type = 'manual' AND NEW.source_id = 'receipt') OR NEW.source_type = 'opening' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM items WHERE id = NEW.item_id AND track_units) THEN
    RAISE EXCEPTION 'Поштучный учёт: операция будет доступна после обновления';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION trg_guard_unit_tracked_moves() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS stock_moves_guard_unit_tracked ON stock_moves;
CREATE TRIGGER stock_moves_guard_unit_tracked
  BEFORE INSERT ON stock_moves
  FOR EACH ROW EXECUTE FUNCTION trg_guard_unit_tracked_moves();

CREATE OR REPLACE VIEW unit_balance_mismatch
WITH (security_invoker = true) AS
WITH balances AS (
  SELECT item_id, loc_id, SUM(qty) AS balance_qty
  FROM stock_balance
  GROUP BY item_id, loc_id
),
unit_counts AS (
  SELECT item_id, location_id AS loc_id, COUNT(*) AS unit_count
  FROM item_units
  WHERE status = 'in_stock'
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
LEFT JOIN balances b ON b.item_id = k.item_id AND b.loc_id = k.loc_id
LEFT JOIN unit_counts u ON u.item_id = k.item_id AND u.loc_id = k.loc_id
WHERE is_admin()
  AND COALESCE(b.balance_qty, 0) <> COALESCE(u.unit_count, 0);

ALTER TABLE item_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON item_units, unit_events, unit_balance_mismatch FROM PUBLIC, anon, authenticated;
GRANT SELECT ON item_units, unit_events, unit_balance_mismatch TO authenticated;

DROP POLICY IF EXISTS "admin_select_item_units" ON item_units;
CREATE POLICY "admin_select_item_units" ON item_units
  FOR SELECT TO authenticated USING (is_admin());

DROP POLICY IF EXISTS "admin_select_unit_events" ON unit_events;
CREATE POLICY "admin_select_unit_events" ON unit_events
  FOR SELECT TO authenticated USING (is_admin());

/*
# Unit balance mismatch: ignore external locations (applied as unit_balance_mismatch_skip_external)

1. Changed view
- `unit_balance_mismatch` now skips locations of type `source` (supplier) and `sink` (write-off/expense).
- Those locations are external: their stock_balance is negative or accumulates consumption by design, so they never hold item units.

2. Security
- No change: view stays security_invoker and still filters on is_admin().
*/

CREATE OR REPLACE VIEW unit_balance_mismatch WITH (security_invoker = true) AS
WITH balances AS (
  SELECT item_id, loc_id, sum(qty) AS balance_qty
  FROM stock_balance
  GROUP BY item_id, loc_id
),
unit_counts AS (
  SELECT item_id, location_id AS loc_id, count(*) AS unit_count
  FROM item_units
  WHERE status = 'in_stock'
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
  AND COALESCE(b.balance_qty, 0) <> COALESCE(u.unit_count, 0)::numeric;
