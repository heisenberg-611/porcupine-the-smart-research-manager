-- Fix R-14: `text_search_config` returned NULL for an unknown language.
--
-- The function was declared STRICT, which short-circuits to NULL before the
-- body runs. The `coalesce(lang, '')` inside it — the thing that was supposed
-- to deliver the documented `simple` default — was therefore dead code for
-- exactly the case it existed to handle:
--
--   build_tsvector(null, 'the immune response of mice')  ->  NULL
--   build_tsvector('',   'the immune response of mice')  ->  'immune':2 …
--
-- `Work.language` comes from provider metadata and is frequently absent, so
-- most rows would have taken the NULL path. A generated `search_tsv` column
-- built on this would have left those works permanently unfindable, with no
-- error anywhere — the search would simply return fewer results than it
-- should. Caught while building the Phase 1 corpus schema, before any row
-- existed. See docs/05-resolution-plan.md R-14.
--
-- Dropping STRICT is safe: the body already handles NULL correctly, and
-- CREATE OR REPLACE may change strictness as long as the signature is
-- unchanged. IMMUTABLE is retained — generated columns require it.

create or replace function public.text_search_config(lang text)
returns regconfig
language sql
immutable
parallel safe
as $$
  select case lower(coalesce(lang, ''))
    when 'en' then 'english'::regconfig
    when 'fr' then 'french'::regconfig
    when 'de' then 'german'::regconfig
    when 'es' then 'spanish'::regconfig
    when 'pt' then 'portuguese'::regconfig
    when 'it' then 'italian'::regconfig
    when 'nl' then 'dutch'::regconfig
    when 'ru' then 'russian'::regconfig
    when 'da' then 'danish'::regconfig
    when 'fi' then 'finnish'::regconfig
    when 'hu' then 'hungarian'::regconfig
    when 'no' then 'norwegian'::regconfig
    when 'sv' then 'swedish'::regconfig
    when 'tr' then 'turkish'::regconfig
    else 'simple'::regconfig
  end;
$$;

comment on function public.text_search_config(text) is
  'R-14: maps a language code to a text search configuration, defaulting to '
  '`simple` — including when the code is NULL, which is the common case. '
  'IMMUTABLE so generated tsvector columns can call it. Never NULL-returning: '
  'a NULL here silently removes a row from search.';
