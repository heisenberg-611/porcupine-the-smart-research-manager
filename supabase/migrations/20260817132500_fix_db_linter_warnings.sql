-- ═══════════════════════════════════════════════════════════════════════════
-- Fix Supabase Database Linter Warnings
--
-- This migration addresses two classes of warnings from the Supabase linter:
-- 1. function_search_path_mutable: Explicitly setting `search_path = ''` on
--    functions that did not have it set, preventing search_path hijacking.
-- 2. anon_security_definer_function_executable: Revoking `EXECUTE` from `PUBLIC`
--    for trigger functions and helpers that should not be publicly accessible
--    via the REST API.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Fix: function_search_path_mutable
ALTER FUNCTION public.touch_updated_at() SET search_path = '';
ALTER FUNCTION public.current_claims() SET search_path = '';
ALTER FUNCTION public.current_user_id() SET search_path = '';
ALTER FUNCTION public.build_tsvector(text, text) SET search_path = '';
ALTER FUNCTION public.text_search_config(text) SET search_path = '';
ALTER FUNCTION public.freeze_submitted_extraction() SET search_path = '';
ALTER FUNCTION public.freeze_submitted_extraction_values() SET search_path = '';
ALTER FUNCTION public.freeze_referenced_field_key() SET search_path = '';
ALTER FUNCTION public.enforce_field_options() SET search_path = '';
ALTER FUNCTION public.protect_answered_field() SET search_path = '';
ALTER FUNCTION public.enforce_value_anchor() SET search_path = '';
ALTER FUNCTION public.agreement_norm(jsonb) SET search_path = '';
ALTER FUNCTION public.agreement_number(jsonb) SET search_path = '';
ALTER FUNCTION public.agreement_boolean(jsonb) SET search_path = '';
ALTER FUNCTION public.values_agree("FieldType", jsonb, jsonb) SET search_path = '';

-- 2. Fix: anon_security_definer_function_executable
-- By default, Postgres grants EXECUTE on new functions to PUBLIC.
-- We revoke it here for trigger functions and explicitly-granted RPCs.
REVOKE EXECUTE ON FUNCTION public.enforce_dual_extraction_capability() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_exclusion_reason() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_reconciliation_provenance() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_auth_user_email_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;

-- These helpers are used by authenticated users, so we revoke them from PUBLIC
-- and ensure they are only granted to authenticated (and the app role).
REVOKE EXECUTE ON FUNCTION public.upsert_work(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_project_role(uuid, public."AccessRole"[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_project_member(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rate_limit_take(text, double precision, double precision, double precision) FROM PUBLIC;

-- Note: is_project_member, is_org_member, and has_project_role were already revoked
-- from PUBLIC in the baseline migration, but we ensure it here for consistency
-- alongside the others.
