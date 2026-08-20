-- File storage, stage 3: the text layer of an uploaded PDF.
--
-- docs/12-file-storage-build-plan.md §6. `file_objects` has carried
-- `text_status` and `page_count` since Phase 1, but there has never been
-- anywhere to put the words themselves — which is why the reader has shown
-- abstracts since Phase 1 too.
--
-- One row per page, not one blob per file, because the anchoring engine has
-- always taken a page number (`AnchorSelector.page`) and a quote resolved
-- against the whole document would report "page 1 of 1" for a forty-page
-- paper. A page is also the unit a reader actually cites.

create table public.file_pages (
  id           uuid primary key,
  project_id   uuid not null references public.projects(id) on update cascade on delete cascade,
  file_id      uuid not null references public.file_objects(id) on update cascade on delete cascade,
  -- 1-based, matching AnchorSelector.page and every citation convention.
  page_number  integer not null,
  text         text not null,
  created_at   timestamptz(3) not null default now(),

  constraint file_pages_page_number_positive check (page_number >= 1),
  constraint file_pages_file_id_page_number_key unique (file_id, page_number)
);

comment on table public.file_pages is
  'Extracted text of one page of one uploaded PDF. Written once at upload; never edited.';

-- `project_id` is denormalised from file_objects on purpose: it is what every
-- policy below reads, and a policy that has to join to find its own subject is
-- a policy that gets slower with every row and harder to reason about.
create index file_pages_project_id_idx on public.file_pages (project_id);

alter table public.file_pages enable row level security;
alter table public.file_pages force row level security;

-- Reading is membership, exactly as it is for the object the text came from.
-- Anything narrower would mean a paper whose PDF a member can download but
-- whose text they cannot read, which is not a distinction anyone could defend.
create policy file_pages_select_member on public.file_pages
  for select
  using (public.is_project_member(project_id));

/*
 * Writing is the same OWNER/ADMIN/CONTRIBUTOR rule as the object and the
 * metadata row — the third place that rule appears, and deliberately the same
 * words in all three. Stage 2 already found what happens when two of them
 * disagree by a single role.
 *
 * There is no UPDATE policy. Page text is written once, by whoever uploaded
 * the file, and is a fact about the bytes rather than an opinion about them.
 * If a re-extraction ever produces different text, that is a NEW extraction of
 * a new file — and every anchor resolved against the old text would need to
 * drift-check against the new, which is precisely what the anchoring engine
 * reports rather than silently repointing. Making that an UPDATE would hide it.
 */
create policy file_pages_insert_contributor on public.file_pages
  for insert
  with check (
    public.has_project_role(
      project_id,
      array['OWNER', 'ADMIN', 'CONTRIBUTOR']::"AccessRole"[]
    )
  );

create policy file_pages_delete_contributor on public.file_pages
  for delete
  using (
    public.has_project_role(
      project_id,
      array['OWNER', 'ADMIN', 'CONTRIBUTOR']::"AccessRole"[]
    )
  );

grant select, insert, delete on public.file_pages to Porcupine_app;
grant select, insert, delete on public.file_pages to authenticated;
