-- Title-normalization parity between SQL and TypeScript.
--
-- `upsert_work()` computes `title_norm` in SQL and is the authority.
-- `normalizeTitle()` in packages/discovery does the same thing in TypeScript,
-- as a pre-pass that collapses five providers' results in memory before any
-- of them reach the database.
--
-- The inputs below are the same list as TITLE_PAIRS in
-- packages/discovery/test/normalize.spec.ts. If someone changes one
-- implementation, this file fails and points at the other.
--
-- Divergence is not catastrophic — the SQL dedupes again, so the worst case
-- is two upsert calls resolving to one row — but it is not free either, and a
-- silent drift in a dedupe key is the kind of thing that is noticed months
-- later as "why do I have four copies of this paper".
--
-- The whitespace-first ordering being asserted here is load-bearing: arXiv's
-- Atom feed wraps titles across lines, so stripping punctuation before
-- collapsing whitespace would delete the newline and turn "Deep\n Learning"
-- into "deeplearning", which would never match OpenAlex's "deep learning".

begin;
select plan(8);

set local role postgres;

insert into users (id, email, display_name, created_at, updated_at) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev', 'Alice', now(), now());

set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);

-- upsert_work() is the only way to reach title_norm, so parity is checked by
-- inserting through it and reading back what it stored.
-- plpgsql, not sql: as a single SELECT with the call in the WHERE clause,
-- Postgres evaluates upsert_work() per candidate ROW, and `works` starts
-- empty — so it scans nothing, calls nothing, and returns NULL. The insert
-- has to happen before the read, in that order, explicitly.
create or replace function pg_temp.norm(p_title text) returns text
language plpgsql as $$
declare
  v_id   uuid;
  v_norm text;
begin
  v_id := public.upsert_work(jsonb_build_object('title', p_title));
  select w.title_norm into v_norm from public.works w where w.id = v_id;
  return v_norm;
end;
$$;

select is(pg_temp.norm('The Immune Response of Mice'), 'the immune response of mice',
  'lowercases and keeps word boundaries');

select is(pg_temp.norm('  Leading   and trailing  '), 'leading and trailing',
  'trims and collapses runs of spaces');

select is(pg_temp.norm('Hyphenated-Words and (Parentheses)'), 'hyphenatedwords and parentheses',
  'strips punctuation without inserting a space');

select is(pg_temp.norm('CRISPR/Cas9: A Review'), 'crisprcas9 a review',
  'slashes and colons vanish rather than splitting the word');

select is(pg_temp.norm('Effects of β-carotene'), 'effects of carotene',
  'non-ASCII letters are dropped, consistently with the TypeScript side');

select is(pg_temp.norm(E'Multi\nline\ttitle'), 'multi line title',
  'newlines and tabs become spaces — arXiv wraps titles, so this decides '
  'whether arXiv and OpenAlex dedupe against each other');

select is(pg_temp.norm('100% Reproducible?'), '100 reproducible',
  'digits survive, symbols do not');

-- And the point of all of it: two spellings of one paper collapse to one row.
select is(
  public.upsert_work(jsonb_build_object('title', E'Deep\n  Learning for Genomics')),
  public.upsert_work(jsonb_build_object('title', 'Deep Learning for Genomics')),
  'a line-wrapped title and a flat one resolve to the SAME work'
);

select * from finish();
rollback;
