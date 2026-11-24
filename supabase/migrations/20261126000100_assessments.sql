-- My Sommelier: blended drinking windows (enrichment stage 3).
--
-- For each wine, Claude reads what is out there now (recent community and
-- forum tasting notes found by web search, critic windows and scores, the
-- CellarTracker window, the owner's own notes) and settles on ONE window per
-- vintage. Recent notes weigh most: several "past its peak" notes pull the
-- end of a critic's window in. The window is written to vintages with
-- drink_window_source = 'blended'; the reasoning behind it is kept here,
-- for the backend only.

-- One row per wine per review run.
create table public.wine_assessments (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null,
  wine_id      uuid not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean not null default false,
  model        text,
  sources      jsonb not null default '[]',
  usage        jsonb,
  error        text,
  foreign key (wine_id, account_id) references public.wines (id, account_id) on delete cascade,
  foreign key (account_id) references public.accounts (id) on delete cascade
);
comment on table public.wine_assessments is
  'One blended-window review of a wine (web search + critic + CellarTracker + own notes).';
create index wine_assessments_wine_idx on public.wine_assessments (wine_id, started_at desc);
create index wine_assessments_account_idx on public.wine_assessments (account_id, started_at desc);

-- The latest view of each vintage from those reviews.
create table public.vintage_assessments (
  vintage_id       uuid primary key,
  account_id       uuid not null,
  assessment_id    uuid references public.wine_assessments (id) on delete set null,
  drink_from       smallint check (drink_from between 1800 and 2300),
  drink_to         smallint check (drink_to between 1800 and 2300),
  maturity         public.maturity_opinion,
  confidence       text check (confidence in ('low', 'medium', 'high')),
  summary          text,
  recent_notes     integer not null default 0 check (recent_notes >= 0),
  latest_note_year smallint,
  assessed_at      timestamptz not null default now(),
  foreign key (vintage_id, account_id) references public.vintages (id, account_id) on delete cascade,
  foreign key (account_id) references public.accounts (id) on delete cascade,
  check (drink_to is null or drink_from is null or drink_to >= drink_from)
);
comment on table public.vintage_assessments is
  'Backend only: the blended window for a vintage, how mature recent notes say it is, and a '
  'short summary of those notes.';
create index vintage_assessments_account_idx on public.vintage_assessments (account_id);

alter table public.wine_assessments enable row level security;
alter table public.vintage_assessments enable row level security;
grant select on public.wine_assessments, public.vintage_assessments to authenticated;
create policy "members read" on public.wine_assessments for select to authenticated
  using (account_id in (select private.readable_account_ids()));
create policy "members read" on public.vintage_assessments for select to authenticated
  using (account_id in (select private.readable_account_ids()));
-- Writes happen only through the service-role reviewer below.
grant all on public.wine_assessments, public.vintage_assessments to service_role;

-- Picks the next wine to review and marks it started, so two runs never take
-- the same wine. Most bottles first. Stops once p_max wines have a finished
-- review (the test run is 50). A wine that failed twice is skipped.
create or replace function public.claim_next_assessment(p_account_id uuid, p_max integer)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_wine uuid;
  v_done integer;
begin
  select count(distinct wine_id) into v_done
  from public.wine_assessments
  where account_id = p_account_id and ok;
  if v_done >= p_max then
    return null;
  end if;

  -- One claim at a time per account.
  perform pg_advisory_xact_lock(hashtext('claim_next_assessment:' || p_account_id::text));

  select w.id into v_wine
  from public.wines w
  join public.vintages v on v.wine_id = w.id
  join public.holdings h on h.vintage_id = v.id
  where w.account_id = p_account_id
    and not exists (
      select 1 from public.wine_assessments a
      where a.wine_id = w.id
        and (a.ok
             or (a.finished_at is null and a.started_at > now() - interval '15 minutes')))
    and (select count(*) from public.wine_assessments a
         where a.wine_id = w.id and not a.ok and a.finished_at is not null) < 2
  group by w.id
  having sum(h.quantity + h.quantity_on_order) > 0
  order by sum(h.quantity + h.quantity_on_order) desc, w.id
  limit 1;

  if v_wine is null then
    return null;
  end if;
  insert into public.wine_assessments (account_id, wine_id) values (p_account_id, v_wine)
  returning id into v_wine;
  return v_wine; -- the assessment id
end;
$$;

-- Saves a finished review. p_vintages is an array of
--   { vintage_id, drink_from, drink_to, maturity, confidence, summary,
--     recent_notes, latest_note_year }
-- The window replaces a blank, an estimate, a CellarTracker window or an
-- earlier blended one; never a window the owner typed.
create or replace function public.apply_assessment(
  p_assessment_id uuid, p_vintages jsonb, p_sources jsonb, p_usage jsonb, p_model text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_a        public.wine_assessments%rowtype;
  v_item     jsonb;
  v_vid      uuid;
  v_from     smallint;
  v_to       smallint;
  v_maturity public.maturity_opinion;
  v_conf     text;
  v_saved    integer := 0;
  v_windows  integer := 0;
  v_n        integer;
begin
  select * into v_a from public.wine_assessments where id = p_assessment_id;
  if not found then
    raise exception 'unknown assessment' using errcode = 'no_data_found';
  end if;
  if p_vintages is null or jsonb_typeof(p_vintages) <> 'array' then
    raise exception 'p_vintages must be an array' using errcode = 'invalid_parameter_value';
  end if;

  for v_item in select * from jsonb_array_elements(p_vintages) loop
    begin
      v_vid := (v_item ->> 'vintage_id')::uuid;
    exception when invalid_text_representation then
      continue;
    end;
    -- Only vintages of this wine.
    if not exists (select 1 from public.vintages
                   where id = v_vid and wine_id = v_a.wine_id) then
      continue;
    end if;
    v_from := (v_item ->> 'drink_from')::smallint;
    v_to := (v_item ->> 'drink_to')::smallint;
    if v_from is null or v_to is null or v_to < v_from or v_from < 1800 or v_to > 2300 then
      v_from := null;
      v_to := null;
    end if;
    v_maturity := case when v_item ->> 'maturity' in
                    ('too_young', 'approaching', 'ready', 'peak', 'declining', 'past_it')
                  then (v_item ->> 'maturity')::public.maturity_opinion end;
    v_conf := case when v_item ->> 'confidence' in ('low', 'medium', 'high')
              then v_item ->> 'confidence' end;

    insert into public.vintage_assessments as va (
      vintage_id, account_id, assessment_id, drink_from, drink_to, maturity, confidence,
      summary, recent_notes, latest_note_year, assessed_at)
    values (
      v_vid, v_a.account_id, v_a.id, v_from, v_to, v_maturity, v_conf,
      nullif(trim(v_item ->> 'summary'), ''),
      greatest(coalesce((v_item ->> 'recent_notes')::integer, 0), 0),
      case when (v_item ->> 'latest_note_year')::integer between 1800 and 2300
           then (v_item ->> 'latest_note_year')::smallint end,
      now())
    on conflict (vintage_id) do update set
      assessment_id = excluded.assessment_id, drink_from = excluded.drink_from,
      drink_to = excluded.drink_to, maturity = excluded.maturity,
      confidence = excluded.confidence, summary = excluded.summary,
      recent_notes = excluded.recent_notes, latest_note_year = excluded.latest_note_year,
      assessed_at = excluded.assessed_at;
    v_saved := v_saved + 1;

    if v_from is not null then
      update public.vintages
      set drink_from = v_from, drink_to = v_to, drink_window_source = 'blended'
      where id = v_vid
        and (drink_window_source is null
             or drink_window_source in ('estimate', 'cellartracker', 'blended'));
      get diagnostics v_n = row_count;
      v_windows := v_windows + v_n;
    end if;
  end loop;

  update public.wine_assessments
  set ok = true, finished_at = now(), model = p_model,
      sources = coalesce(p_sources, '[]'), usage = p_usage, error = null
  where id = v_a.id;

  return jsonb_build_object('vintages', v_saved, 'windows', v_windows);
end;
$$;

-- Marks a review that failed, so the wine is retried once later.
create or replace function public.fail_assessment(p_assessment_id uuid, p_error text, p_usage jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.wine_assessments
  set ok = false, finished_at = now(), error = left(p_error, 500), usage = p_usage
  where id = p_assessment_id;
$$;

revoke all on function public.claim_next_assessment(uuid, integer) from public, anon, authenticated;
revoke all on function public.apply_assessment(uuid, jsonb, jsonb, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.fail_assessment(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_next_assessment(uuid, integer) to service_role;
grant execute on function public.apply_assessment(uuid, jsonb, jsonb, jsonb, text) to service_role;
grant execute on function public.fail_assessment(uuid, text, jsonb) to service_role;

-- The reviewer is started by a database schedule (pg_cron + pg_net) that
-- sends a random secret kept in Supabase Vault as 'assess_secret'. The
-- function checks the header against it here, so the secret never has to be
-- typed anywhere. Only the service role can ask.
create or replace function public.assess_secret_ok(p_secret text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return p_secret is not null and length(p_secret) >= 32 and exists (
    select 1 from vault.decrypted_secrets
    where name = 'assess_secret' and decrypted_secret = p_secret);
end;
$$;
revoke all on function public.assess_secret_ok(text) from public, anon, authenticated;
grant execute on function public.assess_secret_ok(text) to service_role;
