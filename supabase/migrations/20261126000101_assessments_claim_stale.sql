-- A review cut off by the Edge Function time limit (started, never finished)
-- now counts as a failure, so a wine is tried at most twice.

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
    -- Failed, or started and never finished (cut off by the time limit).
    and (select count(*) from public.wine_assessments a
         where a.wine_id = w.id and not a.ok
           and (a.finished_at is not null or a.started_at <= now() - interval '15 minutes')) < 2
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
revoke all on function public.claim_next_assessment(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_next_assessment(uuid, integer) to service_role;
