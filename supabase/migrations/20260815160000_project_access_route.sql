-- A project's route to papers it cannot open.
--
-- Researchers hit paywalls constantly, and the answer is institutional: almost
-- every university publishes an OpenURL link resolver, a proxy prefix, or an
-- interlibrary-loan form, and almost nobody remembers the URL. So the project
-- carries it, and every paper offers it next to the DOI.
--
-- Two columns rather than one: a link without a label reads as a mystery
-- button, and the label is what tells a new team member whether they are about
-- to reach their own library or somebody else's.
--
-- Set by the project's owner or admin, and shown to every member. No default —
-- a wrong resolver is worse than none, because it fails silently and looks
-- like the paper is unavailable.

alter table public.projects
  add column if not exists access_help_url text,
  add column if not exists access_help_label text;

-- Length caps only. The shape of a resolver URL varies enough between
-- institutions (OpenURL query strings, EZproxy prefixes, bare ILL forms) that
-- validating the format here would reject working configurations; the
-- application checks the scheme, which is the part that matters for safety.
alter table public.projects
  add constraint projects_access_help_url_len
    check (access_help_url is null or char_length(access_help_url) <= 500),
  add constraint projects_access_help_label_len
    check (access_help_label is null or char_length(access_help_label) <= 80);

comment on column public.projects.access_help_url is
  'Where members should go for a paper the DOI will not open: the institution''s '
  'link resolver, proxy, or interlibrary-loan form. Set per project by an owner '
  'or admin; there is no default because a wrong resolver fails silently.';
