-- ═══════════════════════════════════════════════════════════════════════════
-- Fix Supabase Database Linter Warnings
--
-- This migration addresses two classes of warnings from the Supabase linter:
-- 1. function_search_path_mutable: pinning `search_path` on
--    functions that did not have it set, preventing search_path hijacking.
-- 2. anon_security_definer_function_executable: Revoking `EXECUTE` from `PUBLIC`
--    for trigger functions and helpers that should not be publicly accessible
--    via the REST API.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Fix: function_search_path_mutable
--
-- `pg_catalog, public`, not `''`.
--
-- The empty search_path is the stricter form and it is the one the Supabase
-- documentation shows — but it only works on a function whose body schema-
-- qualifies EVERY name it uses, and these do not. Applied as `''`, this block
-- broke the database: `freeze_submitted_extraction_values` names the type
-- `"ExtractionStatus"` unqualified, so with nothing on the path the trigger
-- raised `type "ExtractionStatus" does not exist` on any insert into
-- `extraction_values`, and eleven assertions in the RLS suite died with it.
--
-- What the linter is actually checking is that the path is PINNED rather than
-- inherited from the caller, and an explicit `pg_catalog, public` is pinned.
-- `pg_catalog` is named first so a built-in cannot be shadowed by something
-- created in `public`, and `pg_temp` is deliberately absent so a temporary
-- table cannot shadow a real one — which is the attack the warning is about.
--
-- Tightening these to `''` is still worth doing. It is a per-function job:
-- qualify the body, then change the path, then watch the suite. Doing it in
-- one sweep across sixteen functions is how this arrived broken.
ALTER FUNCTION public.touch_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.current_claims() SET search_path = pg_catalog, public;
ALTER FUNCTION public.current_user_id() SET search_path = pg_catalog, public;
ALTER FUNCTION public.build_tsvector(text, text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.text_search_config(text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.freeze_submitted_extraction() SET search_path = pg_catalog, public;
ALTER FUNCTION public.freeze_submitted_extraction_values() SET search_path = pg_catalog, public;
ALTER FUNCTION public.freeze_referenced_field_key() SET search_path = pg_catalog, public;
ALTER FUNCTION public.enforce_field_options() SET search_path = pg_catalog, public;
ALTER FUNCTION public.protect_answered_field() SET search_path = pg_catalog, public;
ALTER FUNCTION public.enforce_value_anchor() SET search_path = pg_catalog, public;
ALTER FUNCTION public.agreement_norm(jsonb) SET search_path = pg_catalog, public;
ALTER FUNCTION public.agreement_number(jsonb) SET search_path = pg_catalog, public;
ALTER FUNCTION public.agreement_boolean(jsonb) SET search_path = pg_catalog, public;
ALTER FUNCTION public.values_agree("FieldType", jsonb, jsonb) SET search_path = pg_catalog, public;

-- 2. Fix: anon_security_definer_function_executable
-- By default, Postgres grants EXECUTE on new functions to PUBLIC.
-- We revoke it here for trigger functions and explicitly-granted RPCs.
REVOKE EXECUTE ON FUNCTION public.enforce_dual_extraction_capability() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_exclusion_reason() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_reconciliation_provenance() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_auth_user_email_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC;
-- `public.rls_auto_enable()` is deliberately absent from this list.
--
-- It has never existed. No migration in this repository creates it, and the
-- name appears nowhere else in the project — it came from a linter report read
-- against a database that had one, or from a guess. Postgres raises
-- `function public.rls_auto_enable() does not exist` on the REVOKE, which
-- aborts the whole migration, which aborts `supabase db reset`, which is the
-- first step of `pnpm verify --e2e`. So this one line took out the migrations,
-- the RLS suite and the browser suite together, on a clean checkout, from the
-- commit that introduced it.
--
-- If a function by that name is added later, revoke it in the migration that
-- creates it rather than here. A REVOKE separated from its CREATE is a
-- statement that can only be wrong in this exact way.

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
