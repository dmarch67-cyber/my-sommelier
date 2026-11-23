-- My Sommelier: writes from the app (build 2: Drink one, Add bottles).
--
-- Single-row changes (drinking a bottle, undo, marking an order delivered,
-- tasting notes) are plain inserts the app makes under row-level security.
-- Adding bottles can create a wine, a vintage, a holding and an event, and a
-- delivery spreadsheet adds many lines, so those go through add_bottles(),
-- which does everything in one transaction: all lines are added or none.
--
-- SECURITY INVOKER: the function runs as the signed-in user, so row-level
-- security decides what it may read and write, exactly as for direct inserts.

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
      insert into public.wines (account_id, name, source_name, country, region, appellation)
      values (
        v_account_id,
        trim(v_line ->> 'wine_name'),
        trim(v_line ->> 'wine_name'),
        nullif(trim(v_line ->> 'country'), ''),
        nullif(trim(v_line ->> 'region'), ''),
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

comment on function public.add_bottles(uuid, jsonb, boolean, text) is
  'Adds bottles (or orders) to a cellar, creating wines and vintages as needed. All lines or none.';

-- Undo: the ledger is append-only, so undoing adds the opposite "adjusted"
-- events. Only events that have not been undone already are reversed.
create or replace function public.undo_inventory_events(p_event_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  e record;
  n integer := 0;
begin
  for e in
    select ie.*
    from public.inventory_events ie
    where ie.id = any (p_event_ids)
      and not exists (
        select 1 from public.inventory_events u
        where u.account_id = ie.account_id
          and u.event_type = 'adjusted'
          and u.reason = 'undo:' || ie.id::text
      )
    order by ie.created_at desc
  loop
    insert into public.inventory_events (
      account_id, holding_id, event_type, quantity_delta, on_order_delta, occurred_at, reason
    ) values (
      e.account_id, e.holding_id, 'adjusted', -e.quantity_delta, -e.on_order_delta, now(),
      'undo:' || e.id::text
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;

comment on function public.undo_inventory_events(uuid[]) is
  'Reverses events with opposite "adjusted" events (reason undo:<id>). Safe to call twice.';

revoke all on function public.add_bottles(uuid, jsonb, boolean, text) from public, anon;
revoke all on function public.undo_inventory_events(uuid[]) from public, anon;
grant execute on function public.add_bottles(uuid, jsonb, boolean, text) to authenticated;
grant execute on function public.undo_inventory_events(uuid[]) to authenticated;
