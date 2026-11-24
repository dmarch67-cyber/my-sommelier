-- My Sommelier: food matches on the Wine page.
--
-- One list of dishes per wine (not per vintage: the same wine suits the same
-- food year to year). Claude writes them from what the app already knows
-- about the wine (grapes, place, colour, body); no web search. Each list has
-- 4 to 6 dishes with a one-line reason, one line on what to avoid, and one
-- line on what suits the wine once it is mature.
--
-- Backward compatible: a new table and a new function only.

create table public.wine_food_matches (
  wine_id     uuid primary key,
  account_id  uuid not null,
  dishes      jsonb not null default '[]'
              check (jsonb_typeof(dishes) = 'array'),
  avoid       text,
  older       text,
  model       text,
  made_at     timestamptz not null default now(),
  foreign key (wine_id, account_id) references public.wines (id, account_id) on delete cascade,
  foreign key (account_id) references public.accounts (id) on delete cascade
);
comment on table public.wine_food_matches is
  'Dishes that suit a wine, for the Wine page: dishes = [{dish, why}], plus what to avoid and '
  'what suits it once mature. Written by the match-food Edge Function.';
create index wine_food_matches_account_idx on public.wine_food_matches (account_id);

alter table public.wine_food_matches enable row level security;
grant select, insert, update, delete on public.wine_food_matches to authenticated;
grant all on public.wine_food_matches to service_role;
create policy "members read" on public.wine_food_matches for select to authenticated
  using (account_id in (select private.readable_account_ids()));
create policy "writers insert" on public.wine_food_matches for insert to authenticated
  with check (account_id in (select private.writable_account_ids()));
create policy "writers update" on public.wine_food_matches for update to authenticated
  using (account_id in (select private.writable_account_ids()))
  with check (account_id in (select private.writable_account_ids()));
create policy "writers delete" on public.wine_food_matches for delete to authenticated
  using (account_id in (select private.writable_account_ids()));

-- The next wines that have no food matches yet, oldest first, with the facts
-- Claude needs. Only wines the fill-in has already looked at (so grapes and
-- style are known), unless p_wine_id names one wine. Runs as the caller, so
-- row-level security limits it to their own wines.
create or replace function public.wines_needing_food_matches(
  p_limit   integer default 12,
  p_wine_id uuid default null
)
returns table (
  id          uuid,
  account_id  uuid,
  name        text,
  producer    text,
  country     text,
  region      text,
  sub_region  text,
  appellation text,
  colour      text,
  body        text,
  grapes      text[],
  remaining   bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with todo as (
    select w.*
    from public.wines w
    where not exists (select 1 from public.wine_food_matches m where m.wine_id = w.id)
      and (case when p_wine_id is null then w.enriched_at is not null else w.id = p_wine_id end)
  )
  select t.id, t.account_id, t.name, t.producer, t.country, t.region, t.sub_region,
         t.appellation, t.colour::text, t.body::text, t.grapes,
         (select count(*) from todo)
  from todo t
  order by t.created_at, t.id
  limit greatest(1, least(coalesce(p_limit, 12), 25));
$$;

revoke all on function public.wines_needing_food_matches(integer, uuid) from public, anon;
grant execute on function public.wines_needing_food_matches(integer, uuid)
  to authenticated, service_role;
