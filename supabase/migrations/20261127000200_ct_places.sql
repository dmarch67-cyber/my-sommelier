-- Places from CellarTracker. Its Country > Region > Sub-region > Appellation
-- is exact (e.g. USA > California > Napa Valley > Oakville), so for every
-- wine matched to the owner's CellarTracker export it replaces what came from
-- the spreadsheet. Blank parts keep what is there. As a guard against a
-- wrong name match, nothing changes when the two disagree on the country.
--
-- p_matches: [{ vintage_id, country, region, sub_region, appellation }]
-- SECURITY INVOKER: row-level security decides what may change.

create or replace function public.apply_ct_places(p_matches jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_m        jsonb;
  v_wine     public.wines%rowtype;
  v_country  text;
  v_changed  integer := 0;
  v_skipped  integer := 0;
  v_n        integer;
begin
  if p_matches is null or jsonb_typeof(p_matches) <> 'array' then
    raise exception 'p_matches must be an array' using errcode = 'invalid_parameter_value';
  end if;

  for v_m in select * from jsonb_array_elements(p_matches) loop
    select w.* into v_wine
    from public.wines w
    join public.vintages v on v.wine_id = w.id
    where v.id = (v_m ->> 'vintage_id')::uuid;
    if not found then
      continue;
    end if;

    v_country := nullif(trim(v_m ->> 'country'), '');
    if v_country is not null and v_wine.country is not null
       and lower(v_country) <> lower(v_wine.country)
       and not (lower(v_wine.country) in ('us', 'united states', 'california', 'oregon', 'washington')
                and lower(v_country) = 'usa') then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    update public.wines
    set country     = coalesce(v_country, country),
        region      = coalesce(nullif(trim(v_m ->> 'region'), ''), region),
        sub_region  = coalesce(nullif(trim(v_m ->> 'sub_region'), ''), sub_region),
        appellation = coalesce(nullif(trim(v_m ->> 'appellation'), ''), appellation)
    where id = v_wine.id
      and (country, region, sub_region, appellation) is distinct from (
        coalesce(v_country, country),
        coalesce(nullif(trim(v_m ->> 'region'), ''), region),
        coalesce(nullif(trim(v_m ->> 'sub_region'), ''), sub_region),
        coalesce(nullif(trim(v_m ->> 'appellation'), ''), appellation));
    get diagnostics v_n = row_count;
    v_changed := v_changed + v_n;
  end loop;

  return jsonb_build_object('wines_changed', v_changed, 'skipped_country_differs', v_skipped);
end;
$$;

revoke all on function public.apply_ct_places(jsonb) from public, anon;
grant execute on function public.apply_ct_places(jsonb) to authenticated, service_role;
