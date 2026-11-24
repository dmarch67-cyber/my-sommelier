-- Monthly refresh of drinking windows and "What critics say".
--
-- CellarTracker blocks automated reading of its pages, so the app cannot read
-- new community notes directly. What it can see is the owner's own
-- CellarTracker export, synced daily, whose community score is an average to
-- many decimal places: any new scored note moves it. So a wine is reviewed
-- again when:
--   * it has never been reviewed (a new delivery), or
--   * its CellarTracker community score has moved and the last review is at
--     least 28 days old, or
--   * the last review is more than 90 days old (catches critic reviews and
--     wines CellarTracker's export does not cover).
-- At most p_month_cap re-reviews start in any 30 days, to keep the cost
-- bounded. New wines are always reviewed.

alter table public.wine_assessments add column if not exists ct_fingerprint text;
comment on column public.wine_assessments.ct_fingerprint is
  'The CellarTracker community scores of the wine''s vintages when the review started.';

-- The CellarTracker community score of each vintage of a wine, as one string.
create or replace function public.ct_fingerprint(p_wine uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(string_agg(v.id::text || '=' || coalesce(s.raw_value, ''), ',' order by v.id), '')
  from public.vintages v
  left join public.scores s
    on s.vintage_id = v.id and s.source = 'cellartracker'
   and s.source_detail like 'CellarTracker export:%'
  where v.wine_id = p_wine and v.cellartracker_id is not null;
$$;

create or replace function public.claim_refresh_assessment(p_account_id uuid, p_month_cap integer)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_wine   uuid;
  v_new    boolean;
  v_recent integer;
  v_id     uuid;
begin
  -- One claim at a time per account (same lock as claim_next_assessment).
  perform pg_advisory_xact_lock(hashtext('claim_next_assessment:' || p_account_id::text));

  with held as (
    select w.id, sum(h.quantity + h.quantity_on_order) as n,
           bool_or(v.cellartracker_id is not null) as has_ct
    from public.wines w
    join public.vintages v on v.wine_id = w.id
    join public.holdings h on h.vintage_id = v.id
    where w.account_id = p_account_id
    group by w.id
    having sum(h.quantity + h.quantity_on_order) > 0
  ), last_ok as (
    select distinct on (wine_id) wine_id, finished_at, ct_fingerprint
    from public.wine_assessments
    where account_id = p_account_id and ok
    order by wine_id, finished_at desc
  )
  select held.id, l.wine_id is null into v_wine, v_new
  from held
  left join last_ok l on l.wine_id = held.id
  where not exists (
      select 1 from public.wine_assessments a
      where a.wine_id = held.id and a.finished_at is null
        and a.started_at > now() - interval '15 minutes')
    -- At most two failed tries since the last good review.
    and (select count(*) from public.wine_assessments a
         where a.wine_id = held.id and not a.ok
           and (a.finished_at is not null or a.started_at <= now() - interval '15 minutes')
           and a.started_at > coalesce(l.finished_at, '-infinity'::timestamptz)) < 2
    and (l.wine_id is null
         or l.finished_at < now() - interval '90 days'
         or (held.has_ct
             and l.finished_at < now() - interval '28 days'
             and l.ct_fingerprint is distinct from public.ct_fingerprint(held.id)))
  order by (l.wine_id is null) desc, held.n desc, held.id
  limit 1;

  if v_wine is null then
    return null;
  end if;
  if not v_new then
    select count(*) into v_recent
    from public.wine_assessments
    where account_id = p_account_id and started_at > now() - interval '30 days'
      and (ok or finished_at is null);
    if v_recent >= coalesce(p_month_cap, 150) then
      return null;
    end if;
  end if;
  insert into public.wine_assessments (account_id, wine_id, ct_fingerprint)
  values (p_account_id, v_wine, public.ct_fingerprint(v_wine))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.ct_fingerprint(uuid) from public, anon, authenticated;
revoke all on function public.claim_refresh_assessment(uuid, integer) from public, anon, authenticated;
grant execute on function public.ct_fingerprint(uuid) to service_role;
grant execute on function public.claim_refresh_assessment(uuid, integer) to service_role;

-- The reviews already done count as seeing today's scores.
update public.wine_assessments a
set ct_fingerprint = public.ct_fingerprint(a.wine_id)
where a.ok and a.ct_fingerprint is null
  and a.finished_at = (select max(b.finished_at) from public.wine_assessments b
                       where b.wine_id = a.wine_id and b.ok);
