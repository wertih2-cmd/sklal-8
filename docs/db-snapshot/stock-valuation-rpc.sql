/*
# Stock valuation RPC function

1. New Functions
- `stock_valuation(p_scope text, p_owner_apartment int default null)` — SECURITY DEFINER, returns jsonb
  - Admin-only (is_admin() check, raises 42501)
  - Validates p_scope is 'company' or 'owner'
  - Returns jsonb array of rows from warehouse_valuation view
  - Filters by scope and optional owner_apartment_id
  - Sorted by item_id, owner_apartment_id nulls first
  - Empty result returns '[]'::jsonb
2. Security
  - SECURITY DEFINER with SET search_path = public
  - REVOKE ALL FROM PUBLIC, anon
  - GRANT EXECUTE TO authenticated
  - Does NOT modify warehouse_valuation view or avg_cost/owner_avg_cost functions
  - Does NOT grant EXECUTE on avg_cost/owner_avg_cost to authenticated
*/

CREATE OR REPLACE FUNCTION public.stock_valuation(p_scope text, p_owner_apartment int DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Только администратор' USING ERRCODE = '42501';
  END IF;

  IF p_scope NOT IN ('company', 'owner') THEN
    RAISE EXCEPTION 'Неверная область';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v.item_id, v.owner_apartment_id NULLS FIRST), '[]'::jsonb)
  INTO v_result
  FROM warehouse_valuation v
  WHERE v.scope = p_scope
    AND (p_owner_apartment IS NULL OR v.owner_apartment_id = p_owner_apartment);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.stock_valuation(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_valuation(text, int) TO authenticated;
