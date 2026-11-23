-- My Sommelier: facts from CellarTracker (enrichment stage 2).
--
-- The owner's CellarTracker export is matched to the app's vintages and used
-- only for facts about each wine: drinking window, critic and community
-- scores, colour and grapes. CellarTracker bottle counts are never used; the
-- app is the record of what is in the cellar.

-- A log of automatic fill-in runs, so a sync runs at most once a day and the
-- results (matched, unmatched) can be checked afterwards.
create table public.enrichment_runs (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts (id) on delete cascade,
  source       text not null check (length(trim(source)) > 0),
  started_at   timestamptz not null default now(),
  ok           boolean not null default false,
  summary      jsonb not null default '{}'
);
comment on table public.enrichment_runs is
  'One row per automatic fill-in run (e.g. a CellarTracker sync), with what it found.';
create index enrichment_runs_account_idx on public.enrichment_runs (account_id, source, started_at desc);

alter table public.enrichment_runs enable row level security;
grant select, insert on public.enrichment_runs to authenticated;
create policy "members read" on public.enrichment_runs for select to authenticated
  using (account_id in (select private.readable_account_ids()));
create policy "writers insert" on public.enrichment_runs for insert to authenticated
  with check (account_id in (select private.writable_account_ids()));

-- Applies matched CellarTracker facts. p_matches is an array of
--   { vintage_id, ct_id, colour, grapes: [..], drink_from, drink_to,
--     scores: [ { source, source_detail, raw_value, value_low, value_high, is_plus } ] }
-- Rules:
--  * window: replaces a blank, an automatic estimate, or an earlier
--    CellarTracker window; never one the owner or a critic score entered.
--  * colour and grapes: fill blanks, and replace Claude's guesses.
--  * scores: this sync's scores replace the previous sync's for that vintage;
--    scores from the spreadsheet or typed by the owner are untouched.
-- SECURITY INVOKER: row-level security decides what may change.
create or replace function public.apply_cellartracker(p_matches jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_m          jsonb;
  v_s          jsonb;
  v_vintage    public.vintages%rowtype;
  v_colour     public.wine_colour;
  v_grapes     text[];
  v_from       smallint;
  v_to         smallint;
  v_source     public.score_source;
  v_matched    integer := 0;
  v_windows    integer := 0;
  v_scores     integer := 0;
  v_n          integer;
begin
  if p_matches is null or jsonb_typeof(p_matches) <> 'array' then
    raise exception 'p_matches must be an array' using errcode = 'invalid_parameter_value';
  end if;

  for v_m in select * from jsonb_array_elements(p_matches) loop
    select * into v_vintage from public.vintages where id = (v_m ->> 'vintage_id')::uuid;
    if not found then
      continue;
    end if;
    v_matched := v_matched + 1;

    update public.vintages
    set cellartracker_id = coalesce(nullif(v_m ->> 'ct_id', ''), cellartracker_id)
    where id = v_vintage.id;

    v_from := (v_m ->> 'drink_from')::smallint;
    v_to   := (v_m ->> 'drink_to')::smallint;
    if v_from is not null and v_to is not null and v_to >= v_from
       and v_from >= 1800 and v_to <= 2300 then
      update public.vintages
      set drink_from = v_from, drink_to = v_to, drink_window_source = 'cellartracker'
      where id = v_vintage.id
        and ((drink_from is null and drink_to is null)
             or drink_window_source in ('estimate', 'cellartracker'));
      get diagnostics v_n = row_count;
      v_windows := v_windows + v_n;
    end if;

    v_colour := case when v_m ->> 'colour' in
                  ('red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'orange')
                then (v_m ->> 'colour')::public.wine_colour end;
    v_grapes := case when jsonb_typeof(v_m -> 'grapes') = 'array'
                then array(select trim(g) from jsonb_array_elements_text(v_m -> 'grapes') g
                           where length(trim(g)) > 0)
                else '{}' end;
    update public.wines w
    set colour = case when w.colour is null or w.enriched_by = 'claude'
                      then coalesce(v_colour, w.colour) else w.colour end,
        grapes = case when cardinality(v_grapes) > 0
                       and (cardinality(w.grapes) = 0 or w.enriched_by = 'claude')
                      then v_grapes else w.grapes end
    where w.id = v_vintage.wine_id;

    if jsonb_typeof(v_m -> 'scores') = 'array' then
      delete from public.scores
      where vintage_id = v_vintage.id
        and entered_via = 'enrichment'
        and source_detail like 'CellarTracker export:%';
      for v_s in select * from jsonb_array_elements(v_m -> 'scores') loop
        begin
          v_source := (v_s ->> 'source')::public.score_source;
        exception when invalid_text_representation then
          v_source := 'other';
        end;
        begin
          insert into public.scores (
            account_id, vintage_id, source, source_detail, raw_value,
            value_low, value_high, is_plus, entered_via)
          values (
            v_vintage.account_id, v_vintage.id, v_source,
            'CellarTracker export: ' || coalesce(v_s ->> 'source_detail', v_s ->> 'source'),
            v_s ->> 'raw_value',
            (v_s ->> 'value_low')::numeric, (v_s ->> 'value_high')::numeric,
            coalesce((v_s ->> 'is_plus')::boolean, false), 'enrichment');
          v_scores := v_scores + 1;
        exception when check_violation or not_null_violation then
          null; -- a malformed score is skipped, not fatal
        end;
      end loop;
    end if;
  end loop;

  return jsonb_build_object('matched', v_matched, 'windows', v_windows, 'scores', v_scores);
end;
$$;

revoke all on function public.apply_cellartracker(jsonb) from public, anon;
grant execute on function public.apply_cellartracker(jsonb) to authenticated, service_role;
