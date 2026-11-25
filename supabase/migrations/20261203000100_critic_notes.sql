-- Third-party tasting notes found on the public web.
--
-- The gather-notes Edge Function searches for each wine the owner holds and
-- reads public pages that quote critics' and other tasters' notes: winery tech
-- sheets and press pages, importers, shops and critics' free pages. Each note
-- is kept with who wrote it, the score, when, and the page it was found on.
-- CellarTracker, Vinous, WineBerserkers and Vivino are never read (their terms
-- forbid automated reading, or we chose not to use them).
--
-- The Wine page lists them under "What critics and drinkers say", and they
-- feed the critics summary (critics-say) and the drinking-window review
-- (assess-wines). Backward-compatible: a new table, new nullable columns,
-- new functions.

create table if not exists public.critic_notes (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null,
  vintage_id  uuid not null,
  -- Who wrote it: a critic or publication ("Antonio Galloni, Vinous"), a shop's
  -- or importer's buyer, the winery, or a community taster.
  author      text not null check (length(author) between 1 and 120),
  kind        text not null check (kind in ('critic', 'merchant', 'winery', 'community')),
  score       text check (score is null or length(score) <= 20),
  -- When the note was written: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD' (null if the page does not say).
  noted_on    text check (noted_on is null or noted_on ~ '^\d{4}(-\d{2}(-\d{2})?)?$'),
  note        text not null check (length(note) between 1 and 2000),
  source_url  text not null check (source_url ~ '^https?://'),
  source_site text,
  found_at    timestamptz not null default now(),
  foreign key (vintage_id, account_id) references public.vintages (id, account_id) on delete cascade,
  foreign key (account_id) references public.accounts (id) on delete cascade
);
comment on table public.critic_notes is
  'Tasting notes by critics and other tasters, as quoted on public web pages, with the page link.';
create index if not exists critic_notes_vintage_idx on public.critic_notes (vintage_id);
create index if not exists critic_notes_account_idx on public.critic_notes (account_id);
-- The same note found twice (on two shops' pages) is kept once.
create unique index if not exists critic_notes_same_note
  on public.critic_notes (vintage_id, lower(author), md5(lower(left(note, 200))));

alter table public.critic_notes enable row level security;
grant select on public.critic_notes to authenticated;
drop policy if exists "members read" on public.critic_notes;
create policy "members read" on public.critic_notes for select to authenticated
  using (account_id in (select private.readable_account_ids()));
grant all on public.critic_notes to service_role;

-- Per wine: when its notes were last gathered, and what that cost.
alter table public.wines
  add column if not exists notes_searched_at timestamptz,
  add column if not exists notes_search_result text,
  add column if not exists notes_search_usage jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wines_notes_search_result_check') then
    alter table public.wines add constraint wines_notes_search_result_check
      check (notes_search_result is null or notes_search_result in ('found', 'none', 'failed'));
  end if;
end;
$$;
comment on column public.wines.notes_searched_at is 'When gather-notes last looked for critic notes.';
grant update (notes_searched_at, notes_search_result, notes_search_usage)
  on public.wines to service_role;

-- The next wine to gather notes for: held wines with most bottles first,
-- never searched (or a failed search over a day ago, or one stuck for 15
-- minutes). Marks it, so parallel calls never take the same wine. p_max caps
-- how many wines may have been searched in total (for test runs).
create or replace function public.claim_notes_search(p_account_id uuid, p_max integer default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_wine uuid;
begin
  if p_max is not null and (select count(*) from public.wines
                            where account_id = p_account_id
                              and notes_searched_at is not null) >= p_max then
    return null;
  end if;

  select w.id into v_wine
  from public.wines w
  join lateral (
    select coalesce(sum(h.quantity + h.quantity_on_order), 0) as n
    from public.vintages v join public.holdings h on h.vintage_id = v.id
    where v.wine_id = w.id
  ) held on true
  where w.account_id = p_account_id
    and held.n > 0
    and (w.notes_searched_at is null
         or (w.notes_search_result = 'failed' and w.notes_searched_at < now() - interval '1 day')
         or (w.notes_search_result is null and w.notes_searched_at < now() - interval '15 minutes'))
  order by held.n desc, w.id
  limit 1
  for update of w skip locked;

  if v_wine is null then
    return null;
  end if;
  update public.wines
     set notes_searched_at = now(), notes_search_result = null
   where id = v_wine;
  return v_wine;
end;
$$;
revoke all on function public.claim_notes_search(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_notes_search(uuid, integer) to service_role;

-- Saves the notes found for one wine. p_notes is an array of
-- { vintage_id, author, kind, score, noted_on, note, source_url, source_site }.
-- Notes already saved are skipped. Returns how many were added.
create or replace function public.save_critic_notes(p_wine_id uuid, p_notes jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_notes is null or jsonb_typeof(p_notes) <> 'array' then
    raise exception 'p_notes must be an array' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.critic_notes
    (account_id, vintage_id, author, kind, score, noted_on, note, source_url, source_site)
  select v.account_id, v.id,
         left(trim(n ->> 'author'), 120),
         n ->> 'kind',
         nullif(left(trim(coalesce(n ->> 'score', '')), 20), ''),
         case when n ->> 'noted_on' ~ '^\d{4}(-\d{2}(-\d{2})?)?$' then n ->> 'noted_on' end,
         left(trim(n ->> 'note'), 2000),
         left(n ->> 'source_url', 500),
         left(n ->> 'source_site', 120)
  from jsonb_array_elements(p_notes) n
  join public.vintages v
    on v.id = case when (n ->> 'vintage_id') ~ '^[0-9a-f-]{36}$' then (n ->> 'vintage_id')::uuid end
   and v.wine_id = p_wine_id
  where coalesce(trim(n ->> 'author'), '') <> ''
    and coalesce(trim(n ->> 'note'), '') <> ''
    and n ->> 'kind' in ('critic', 'merchant', 'winery', 'community')
    and n ->> 'source_url' ~ '^https?://'
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.save_critic_notes(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_critic_notes(uuid, jsonb) to service_role;
