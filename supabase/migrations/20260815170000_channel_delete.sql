-- ── channels delete policy ──────────────────────────────────────────────────

create policy channels_delete_admin on public.channels
  for delete
  using (public.has_project_role(project_id, array['ADMIN', 'OWNER']::"AccessRole"[]));
