-- My Sommelier: wine facts filled in automatically (enrichment stage 1).
--
-- Claude fills in what the spreadsheet never had: colour, body, producer,
-- grapes, and a starting drinking window per vintage. It only ever fills
-- blanks: anything the owner typed, or a real window from a critic or
-- CellarTracker, is never overwritten.
--
-- Windows written here are marked drink_window_source = 'estimate' so a later
-- source (CellarTracker, Vinous) can replace them, while a window from any
-- other source is left alone.

create type public.wine_body as enum ('light', 'medium', 'full');

alter table public.wines
  add column body          public.wine_body,
  add column enriched_at   timestamptz,
  add column enriched_by   text;

comment on column public.wines.body is
  'Light, medium or full bodied. Used by the Tonight filters.';
comment on column public.wines.enriched_at is
  'When the automatic fill-in last looked at this wine. Null = not yet.';
comment on column public.wines.enriched_by is
  'What filled in the blanks, e.g. "claude". Free text, for the record only.';

-- Wines the fill-in has not looked at yet, oldest first.
create index wines_not_enriched_idx on public.wines (account_id, created_at)
  where enriched_at is null;

-- Applies one batch of fill-ins. p_items is an array of
--   { wine_id, colour, body, producer, grapes: [..],
--     vintages: [ { vintage_id, drink_from, drink_to } ] }
-- Runs as the caller (SECURITY INVOKER), so row-level security decides which
-- wines may be changed. Every wine in the batch is marked as looked at, even
-- when nothing could be filled, so it is not asked about again.
create or replace function public.apply_wine_enrichment(
  p_items  jsonb,
  p_source text default 'claude'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item      jsonb;
  v_vin       jsonb;
  v_wine_id   uuid;
  v_colour    public.wine_colour;
  v_body      public.wine_body;
  v_grapes    text[];
  v_from      smallint;
  v_to        smallint;
  v_wines     integer := 0;
  v_windows   integer := 0;
  v_n         integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be an array' using errcode = 'invalid_parameter_value';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_wine_id := (v_item ->> 'wine_id')::uuid;

    -- Unknown words become null rather than failing the whole batch.
    v_colour := case when v_item ->> 'colour' in
                  ('red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'orange')
                then (v_item ->> 'colour')::public.wine_colour end;
    v_body   := case when v_item ->> 'body' in ('light', 'medium', 'full')
                then (v_item ->> 'body')::public.wine_body end;
    v_grapes := case when jsonb_typeof(v_item -> 'grapes') = 'array'
                then array(select trim(g) from jsonb_array_elements_text(v_item -> 'grapes') g
                           where length(trim(g)) > 0)
                else '{}' end;

    update public.wines w
    set colour      = coalesce(w.colour, v_colour),
        body        = coalesce(w.body, v_body),
        producer    = coalesce(w.producer, nullif(trim(v_item ->> 'producer'), '')),
        grapes      = case when cardinality(w.grapes) = 0 then v_grapes else w.grapes end,
        enriched_at = now(),
        enriched_by = p_source
    where w.id = v_wine_id;
    get diagnostics v_n = row_count;
    v_wines := v_wines + v_n;

    if jsonb_typeof(v_item -> 'vintages') = 'array' then
      for v_vin in select * from jsonb_array_elements(v_item -> 'vintages') loop
        v_from := (v_vin ->> 'drink_from')::smallint;
        v_to   := (v_vin ->> 'drink_to')::smallint;
        if v_from is null or v_to is null or v_to < v_from
           or v_from < 1800 or v_to > 2300 then
          continue;
        end if;
        update public.vintages v
        set drink_from = v_from,
            drink_to = v_to,
            drink_window_source = 'estimate'
        where v.id = (v_vin ->> 'vintage_id')::uuid
          and v.wine_id = v_wine_id
          and ((v.drink_from is null and v.drink_to is null)
               or v.drink_window_source = 'estimate');
        get diagnostics v_n = row_count;
        v_windows := v_windows + v_n;
      end loop;
    end if;
  end loop;

  return jsonb_build_object('wines', v_wines, 'windows', v_windows);
end;
$$;

revoke all on function public.apply_wine_enrichment(jsonb, text) from public, anon;
grant execute on function public.apply_wine_enrichment(jsonb, text) to authenticated, service_role;

-- The cellar view gains body and grapes (added at the end, so existing
-- columns keep their positions).
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
  v.drink_window_source
from public.holdings h
join public.cellars  c on c.id = h.cellar_id
join public.vintages v on v.id = h.vintage_id
join public.wines    w on w.id = v.wine_id;
