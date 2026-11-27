-- My Sommelier: edit or delete your own tasting notes.
--
-- The app already lets members update and delete their account's
-- tasting_notes (row-level security, "writers update" / "writers delete").
-- This only makes those changes stick for notes brought in from the owner's
-- own CellarTracker account, which the daily sync would otherwise restore:
--
--   * An edited CellarTracker note is saved by the app as source 'app', and
--     apply_ct_own_notes never touches 'app' notes (unchanged behaviour).
--   * A deleted note that came from elsewhere (it has a source_ref) is
--     remembered in dismissed_notes, and apply_ct_own_notes skips it.
--
-- Backward compatible: a new table, a trigger, and the same function with
-- one extra check. The current app keeps working unchanged.

create table if not exists public.dismissed_notes (
  account_id    uuid not null references public.accounts (id) on delete cascade,
  source_ref    text not null,
  dismissed_at  timestamptz not null default now(),
  primary key (account_id, source_ref)
);
comment on table public.dismissed_notes is
  'Notes from elsewhere (e.g. CellarTracker) that the owner deleted in the app, '
  'so a later sync does not bring them back.';

alter table public.dismissed_notes enable row level security;
revoke all on public.dismissed_notes from anon, authenticated;
grant select on public.dismissed_notes to authenticated;
grant select, insert, delete on public.dismissed_notes to service_role;
drop policy if exists "members read" on public.dismissed_notes;
create policy "members read" on public.dismissed_notes
  for select to authenticated
  using (account_id in (select private.readable_account_ids()));

-- Row-level security has already allowed the delete when this runs, so it is
-- safe to record it with the owner's rights.
create or replace function private.remember_dismissed_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.source_ref is not null then
    -- Skipped when the whole account is being deleted.
    insert into public.dismissed_notes (account_id, source_ref)
    select old.account_id, old.source_ref
    where exists (select 1 from public.accounts a where a.id = old.account_id)
    on conflict do nothing;
  end if;
  return old;
end;
$$;
revoke all on function private.remember_dismissed_note() from public, anon, authenticated;

drop trigger if exists tasting_notes_remember_dismissed on public.tasting_notes;
create trigger tasting_notes_remember_dismissed after delete on public.tasting_notes
  for each row execute function private.remember_dismissed_note();

-- Same as in 20261130000100_palate_profile.sql, plus the dismissed check.
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
    -- Deleted in the app: leave it gone.
    if exists (
      select 1 from public.dismissed_notes d
      where d.account_id = v_account and d.source_ref = v_note->>'source_ref'
    ) then
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
