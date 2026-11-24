-- My Sommelier: the palate profile.
--
-- The app works out the owner's taste from what is already there (what they
-- buy, what they drink fastest, their own scores and notes, including old
-- ones from CellarTracker) plus a short taste quiz, and uses it to rank
-- Tonight's suggestions.
--
-- Backward compatible: new nullable columns, a new table and a new view.
-- tasting_notes.tasted_on may now be empty, for an old CellarTracker score
-- with no date; nothing writes such a row until the new app is live.

-- Thumbs up or down after Drink one (stars stay optional).
alter table public.tasting_notes add column if not exists liked boolean;
comment on column public.tasting_notes.liked is
  'Thumbs up (true) or down (false) after drinking it. Empty when not given.';

-- Where a note came from: written in the app, or brought in from the
-- owner's own CellarTracker notes and scores (never other people's).
alter table public.tasting_notes add column if not exists source text not null default 'app'
  check (source in ('app', 'cellartracker'));
alter table public.tasting_notes add column if not exists source_ref text;
comment on column public.tasting_notes.source_ref is
  'For notes brought in from elsewhere: their id there (CellarTracker note id, or '
  '"score:<wine id>" for a score with no note), so a re-run updates instead of duplicating.';
create unique index if not exists tasting_notes_source_ref_key
  on public.tasting_notes (account_id, source_ref);

alter table public.tasting_notes alter column tasted_on drop not null;

-- How many bottles of each vintage were bought and drunk, for "what you
-- reach for". Bought = still here + on order + drunk.
create or replace view public.vintage_drinking
with (security_invoker = true)
as
select
  h.account_id,
  h.vintage_id,
  sum(h.quantity + h.quantity_on_order)::integer + coalesce(sum(d.drunk), 0)::integer as bought,
  coalesce(sum(d.drunk), 0)::integer as drunk,
  max(d.last_drunk_at) as last_drunk_at
from public.holdings h
left join lateral (
  select -sum(e.quantity_delta) as drunk, max(e.occurred_at) as last_drunk_at
  from public.inventory_events e
  where e.holding_id = h.id and e.event_type = 'consumed'
) d on true
group by h.account_id, h.vintage_id;
comment on view public.vintage_drinking is
  'Bottles bought and drunk per vintage, across all cellars. Feeds the palate profile.';
grant select on public.vintage_drinking to authenticated;

-- One profile per account: the quiz answers and the lines the owner said
-- "not really" to. Everything else is worked out from the cellar each time.
create table public.palate_profiles (
  account_id  uuid primary key references public.accounts (id) on delete cascade,
  quiz        jsonb not null default '{}' check (jsonb_typeof(quiz) = 'object'),
  not_really  jsonb not null default '[]' check (jsonb_typeof(not_really) = 'array'),
  updated_at  timestamptz not null default now()
);
comment on table public.palate_profiles is
  'The owner''s taste quiz answers ({question: answer}) and the profile lines they '
  'rejected (not_really, a list of keys like "grape:Merlot").';

create trigger palate_profiles_set_updated_at before update on public.palate_profiles
  for each row execute function private.set_updated_at();

alter table public.palate_profiles enable row level security;
grant select, insert, update, delete on public.palate_profiles to authenticated;
grant all on public.palate_profiles to service_role;
create policy "members read" on public.palate_profiles for select to authenticated
  using (account_id in (select private.readable_account_ids()));
create policy "writers insert" on public.palate_profiles for insert to authenticated
  with check (account_id in (select private.writable_account_ids()));
create policy "writers update" on public.palate_profiles for update to authenticated
  using (account_id in (select private.writable_account_ids()))
  with check (account_id in (select private.writable_account_ids()));
create policy "writers delete" on public.palate_profiles for delete to authenticated
  using (account_id in (select private.writable_account_ids()));

-- Saves the owner's own CellarTracker notes and scores as tasting notes.
-- p_notes: [{vintage_id, source_ref, tasted_on, rating, notes}]. Updates a
-- note already brought in (same source_ref); never touches notes written in
-- the app. Runs as the caller, so row-level security keeps it to their own
-- account.
create or replace function public.apply_ct_own_notes(p_notes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_note     jsonb;
  v_account  uuid;
  v_added    integer := 0;
  v_updated  integer := 0;
  v_rating   numeric;
  v_inserted boolean;
begin
  if p_notes is null or jsonb_typeof(p_notes) <> 'array' then
    return jsonb_build_object('added', 0, 'updated', 0);
  end if;
  for v_note in select * from jsonb_array_elements(p_notes) loop
    select v.account_id into v_account
    from public.vintages v where v.id = (v_note->>'vintage_id')::uuid;
    if v_account is null or coalesce(v_note->>'source_ref', '') = '' then
      continue;
    end if;
    v_rating := nullif(v_note->>'rating', '')::numeric;
    if v_rating is not null and (v_rating < 0 or v_rating > 100) then
      v_rating := null;
    end if;
    if v_rating is null and coalesce(trim(v_note->>'notes'), '') = '' then
      continue;
    end if;
    insert into public.tasting_notes
      (account_id, vintage_id, tasted_on, rating, notes, source, source_ref)
    values (
      v_account,
      (v_note->>'vintage_id')::uuid,
      nullif(v_note->>'tasted_on', '')::date,
      v_rating,
      nullif(trim(v_note->>'notes'), ''),
      'cellartracker',
      v_note->>'source_ref'
    )
    on conflict (account_id, source_ref) do update
      set vintage_id = excluded.vintage_id,
          tasted_on = excluded.tasted_on,
          rating = excluded.rating,
          notes = excluded.notes
      where public.tasting_notes.source = 'cellartracker'
    returning (xmax = 0) into v_inserted;
    if v_inserted then
      v_added := v_added + 1;
    elsif v_inserted is not null then
      v_updated := v_updated + 1;
    end if;
  end loop;
  return jsonb_build_object('added', v_added, 'updated', v_updated);
end;
$$;
revoke all on function public.apply_ct_own_notes(jsonb) from public, anon;
grant execute on function public.apply_ct_own_notes(jsonb) to authenticated, service_role;
