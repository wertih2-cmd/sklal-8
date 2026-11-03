REVOKE EXECUTE ON FUNCTION audit_row() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION trg_apartment_location() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION trg_forbid_mutation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION trg_guard_archive_item() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION trg_staff_location() FROM PUBLIC, anon, authenticated;