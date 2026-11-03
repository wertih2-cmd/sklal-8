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