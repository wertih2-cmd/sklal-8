/*
# Unit balance mismatch: ignore external locations

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
