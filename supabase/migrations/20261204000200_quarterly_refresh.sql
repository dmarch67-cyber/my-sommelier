-- Quarterly refresh instead of monthly (Dan, 2026-11-26), to cut the
-- background research cost to about a third for every cellar.
--
-- A wine already reviewed is reviewed again only when:
--   * its CellarTracker community score has moved and the last review is at
--     least 90 days old (was 28), or
--   * the last review is more than a year old (was 90 days).
-- At most p_month_cap re-reviews start in any 90 days (was 30), per account.
-- The parameter keeps its old name so the schedule's call is unchanged.
-- New wines (new bottles, deliveries) are still reviewed straight away.
--
-- Backward compatible: same function and signature, new body.

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
         or l.finished_at < now() - interval '365 days'
         or (held.has_ct
             and l.finished_at < now() - interval '90 days'
             and l.ct_fingerprint is distinct from public.ct_fingerprint(held.id)))
  order by (l.wine_id is null) desc, held.n desc, held.id
  limit 1;

  if v_wine is null then
    return null;
  end if;
  if not v_new then
    select count(*) into v_recent
    from public.wine_assessments
    where account_id = p_account_id and started_at > now() - interval '90 days'
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

revoke all on function public.claim_refresh_assessment(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_refresh_assessment(uuid, integer) to service_role;
