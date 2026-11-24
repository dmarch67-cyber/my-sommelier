-- Sub-region: a fourth place level between region and appellation, laid out
-- like CellarTracker: USA > California > Napa Valley > Oakville,
-- France > Bordeaux > Médoc > Saint-Estèphe. Additive only: a new nullable
-- column, a view column added at the end, and add_bottles accepting
-- an optional 'sub_region' on new wines (old callers keep working).

alter table public.wines add column if not exists sub_region text;
comment on column public.wines.sub_region is
  'Area between region and appellation, e.g. Napa Valley, Médoc, Willamette Valley.';
comment on column public.wines.appellation is
  'Most specific named place, e.g. Pauillac, Oakville, Yamhill-Carlton.';

create or replace view public.cellar_inventory
with (security_invoker = true)
as
select
  h.id                                   as holding_id,
  h.account_id,
  c.id                                   as cellar_id,
  c.name                                 as cellar_name,
  w.id                                   as wine_id,
  w.name                                 as wine_name,
  w.producer,
  w.country,
  w.region,
  w.appellation,
  w.colour,
  v.id                                   as vintage_id,
  v.year                                 as vintage,
  v.drink_from,
  v.drink_to,
  h.bottle_size_ml,
  public.bottle_size_label(h.bottle_size_ml) as bottle_size_label,
  h.bottle_size_ml <> 750                as is_non_standard_size,
  h.quantity,
  h.quantity_on_order,
  h.unit_price,
  h.currency,
  w.body,
  w.grapes,
  v.drink_window_source,
  w.sub_region
from public.holdings h
join public.cellars  c on c.id = h.cellar_id
join public.vintages v on v.id = h.vintage_id
join public.wines    w on w.id = v.wine_id;

create or replace function public.add_bottles(
  p_cellar_id uuid,
  p_lines     jsonb,
  p_on_order  boolean default false,
  p_reason    text default 'Added in the app'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account_id  uuid;
  v_currency    char(3);
  v_line        jsonb;
  v_wine_id     uuid;
  v_vintage_id  uuid;
  v_holding_id  uuid;
  v_event_id    uuid;
  v_year        smallint;
  v_qty         integer;
  v_size        integer;
  v_events      uuid[] := '{}';
  v_new_wines   integer := 0;
begin
  select c.account_id, c.currency into v_account_id, v_currency
  from public.cellars c
  where c.id = p_cellar_id;
  if v_account_id is null then
    raise exception 'cellar not found' using errcode = 'no_data_found';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'nothing to add' using errcode = 'invalid_parameter_value';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty  := (v_line ->> 'quantity')::integer;
    v_size := coalesce((v_line ->> 'bottle_size_ml')::integer, 750);
    v_year := (v_line ->> 'vintage')::smallint;
    if v_qty is null or v_qty <= 0 then
      raise exception 'each line needs a quantity above 0' using errcode = 'invalid_parameter_value';
    end if;

    -- Wine: the one the app matched, one with the same name, or a new one.
    v_wine_id := (v_line ->> 'wine_id')::uuid;
    if v_wine_id is not null then
      perform 1 from public.wines w where w.id = v_wine_id and w.account_id = v_account_id;
      if not found then
        raise exception 'wine not found in this account' using errcode = 'no_data_found';
      end if;
    else
      if coalesce(trim(v_line ->> 'wine_name'), '') = '' then
        raise exception 'a new wine needs a name' using errcode = 'invalid_parameter_value';
      end if;
      -- Same name already in the account (or added by an earlier line): reuse it.
      select w.id into v_wine_id
      from public.wines w
      where w.account_id = v_account_id
        and lower(w.name) = lower(trim(v_line ->> 'wine_name'))
      order by w.created_at
      limit 1;
    end if;
    if v_wine_id is null then
      insert into public.wines (account_id, name, source_name, country, region, sub_region, appellation)
      values (
        v_account_id,
        trim(v_line ->> 'wine_name'),
        trim(v_line ->> 'wine_name'),
        nullif(trim(v_line ->> 'country'), ''),
        nullif(trim(v_line ->> 'region'), ''),
        nullif(trim(v_line ->> 'sub_region'), ''),
        nullif(trim(v_line ->> 'appellation'), '')
      )
      returning id into v_wine_id;
      v_new_wines := v_new_wines + 1;
    end if;

    -- Vintage: existing or new.
    select v.id into v_vintage_id
    from public.vintages v
    where v.wine_id = v_wine_id and v.year is not distinct from v_year;
    if v_vintage_id is null then
      insert into public.vintages (account_id, wine_id, year)
      values (v_account_id, v_wine_id, v_year)
      returning id into v_vintage_id;
    end if;

    -- Each purchase is its own lot (holding), with its price and date.
    insert into public.holdings (
      account_id, cellar_id, vintage_id, bottle_size_ml, unit_price, currency,
      purchase_date, merchant, notes
    ) values (
      v_account_id, p_cellar_id, v_vintage_id, v_size,
      (v_line ->> 'unit_price')::numeric,
      case when v_line ->> 'unit_price' is not null
           then coalesce(nullif(v_line ->> 'currency', ''), v_currency) end,
      current_date,
      nullif(trim(v_line ->> 'merchant'), ''),
      nullif(trim(v_line ->> 'notes'), '')
    )
    returning id into v_holding_id;

    insert into public.inventory_events (
      account_id, holding_id, event_type, quantity_delta, on_order_delta, occurred_at, reason
    ) values (
      v_account_id, v_holding_id,
      case when p_on_order then 'ordered' else 'purchased' end::public.inventory_event_type,
      case when p_on_order then 0 else v_qty end,
      case when p_on_order then v_qty else 0 end,
      now(),
      p_reason
    )
    returning id into v_event_id;
    v_events := v_events || v_event_id;

    -- Optional score that came with the line (e.g. a delivery sheet's score column).
    if coalesce(trim(v_line ->> 'score_raw'), '') <> '' then
      insert into public.scores (
        account_id, vintage_id, source, raw_value, value_low, value_high, is_plus,
        is_barrel_sample, entered_via
      )
      select v_account_id, v_vintage_id, 'unknown', trim(v_line ->> 'score_raw'),
             (v_line ->> 'score_low')::numeric, (v_line ->> 'score_high')::numeric,
             coalesce((v_line ->> 'score_plus')::boolean, false),
             (v_line ->> 'score_high') is not null, 'manual'
      where not exists (
        select 1 from public.scores s
        where s.vintage_id = v_vintage_id and s.raw_value = trim(v_line ->> 'score_raw')
      );
    end if;
  end loop;

  return jsonb_build_object('event_ids', to_jsonb(v_events), 'new_wines', v_new_wines);
end;
$$;

revoke all on function public.add_bottles(uuid, jsonb, boolean, text) from public, anon;
grant execute on function public.add_bottles(uuid, jsonb, boolean, text) to authenticated;
