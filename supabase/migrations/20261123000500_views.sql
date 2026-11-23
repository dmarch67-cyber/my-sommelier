-- My Sommelier: read-only conveniences.

-- Human label for a bottle size. 750 ml is "standard"; everything else is
-- shown to the user (magnums are flagged, as Dan asked).
create or replace function public.bottle_size_label(size_ml integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case size_ml
    when 187  then 'Piccolo'
    when 375  then 'Half bottle'
    when 500  then '50 cl'
    when 750  then 'Standard'
    when 1500 then 'Magnum'
    when 3000 then 'Double magnum'
    when 4500 then 'Rehoboam'
    when 6000 then 'Imperial'
    else (size_ml::numeric / 1000)::text || ' L'
  end;
$$;
grant execute on function public.bottle_size_label(integer) to authenticated, service_role;

-- One row per holding with its wine, vintage and cellar. security_invoker
-- makes the view obey the caller's row-level security.
create view public.cellar_inventory
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
  h.currency
from public.holdings h
join public.cellars  c on c.id = h.cellar_id
join public.vintages v on v.id = h.vintage_id
join public.wines    w on w.id = v.wine_id;

comment on view public.cellar_inventory is
  'Holdings with wine, vintage and cellar names. Obeys row-level security.';
grant select on public.cellar_inventory to authenticated;
