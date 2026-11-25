-- My Sommelier: move bottles from one cellar to another.
--
-- A move is a pair of ledger events that share one transfer_id: transfer_out
-- from the lot (holding) in the old cellar and transfer_in to a lot in the new
-- cellar. The new lot keeps the purchase details (price, currency, date,
-- merchant), so a bottle bought in dollars for LA still shows what was paid
-- after it moves to Paris. Moving bottles back later reuses that same lot.
--
-- Bottles are taken from the biggest lots first. Everything happens in one
-- transaction: all of the bottles move, or none do. Undo works with the
-- existing undo_inventory_events() on the returned event ids.
--
-- New function only; nothing existing changes, so it is safe to apply before
-- the app that uses it is deployed.

create or replace function public.move_bottles(
  p_vintage_id     uuid,
  p_from_cellar_id uuid,
  p_to_cellar_id   uuid,
  p_bottle_size_ml integer,
  p_quantity       integer,
  p_note           text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account_id  uuid;
  v_to_account  uuid;
  v_to_name     text;
  v_from_name   text;
  v_available   integer;
  v_left        integer := p_quantity;
  v_take        integer;
  v_transfer_id uuid := gen_random_uuid();
  v_dest_id     uuid;
  v_event_id    uuid;
  v_events      uuid[] := '{}';
  h             record;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'choose how many bottles to move' using errcode = 'invalid_parameter_value';
  end if;
  if p_from_cellar_id = p_to_cellar_id then
    raise exception 'the bottles are already in that cellar' using errcode = 'invalid_parameter_value';
  end if;

  select c.account_id, c.name into v_account_id, v_from_name
  from public.cellars c where c.id = p_from_cellar_id;
  select c.account_id, c.name into v_to_account, v_to_name
  from public.cellars c where c.id = p_to_cellar_id;
  if v_account_id is null or v_to_account is null then
    raise exception 'cellar not found' using errcode = 'no_data_found';
  end if;
  if v_account_id <> v_to_account then
    raise exception 'bottles can only move between cellars of the same account'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Lock the lots so two moves at once cannot take the same bottles.
  select coalesce(sum(x.quantity), 0) into v_available
  from (
    select hh.quantity from public.holdings hh
    where hh.cellar_id = p_from_cellar_id
      and hh.vintage_id = p_vintage_id
      and hh.bottle_size_ml = coalesce(p_bottle_size_ml, 750)
      and hh.quantity > 0
    for update
  ) x;
  if v_available < p_quantity then
    raise exception 'only % bottles of that wine and size are in %', v_available, v_from_name
      using errcode = 'invalid_parameter_value';
  end if;

  for h in
    select hh.*
    from public.holdings hh
    where hh.cellar_id = p_from_cellar_id
      and hh.vintage_id = p_vintage_id
      and hh.bottle_size_ml = coalesce(p_bottle_size_ml, 750)
      and hh.quantity > 0
    order by hh.quantity desc, hh.created_at, hh.id
  loop
    exit when v_left = 0;
    v_take := least(v_left, h.quantity);

    -- The matching lot in the new cellar: same wine, size and purchase details.
    select d.id into v_dest_id
    from public.holdings d
    where d.account_id = h.account_id
      and d.cellar_id = p_to_cellar_id
      and d.vintage_id = h.vintage_id
      and d.bottle_size_ml = h.bottle_size_ml
      and d.unit_price is not distinct from h.unit_price
      and d.currency is not distinct from h.currency
      and d.purchase_date is not distinct from h.purchase_date
      and d.merchant is not distinct from h.merchant
    order by d.created_at, d.id
    limit 1;
    if v_dest_id is null then
      insert into public.holdings (
        account_id, cellar_id, vintage_id, bottle_size_ml, unit_price, currency,
        purchase_date, merchant, notes
      ) values (
        h.account_id, p_to_cellar_id, h.vintage_id, h.bottle_size_ml, h.unit_price, h.currency,
        h.purchase_date, h.merchant, h.notes
      )
      returning id into v_dest_id;
    end if;

    insert into public.inventory_events (
      account_id, holding_id, event_type, quantity_delta, occurred_at, transfer_id, reason, note
    ) values (
      h.account_id, h.id, 'transfer_out', -v_take, now(), v_transfer_id,
      'Moved to ' || v_to_name, nullif(trim(p_note), '')
    )
    returning id into v_event_id;
    v_events := v_events || v_event_id;

    insert into public.inventory_events (
      account_id, holding_id, event_type, quantity_delta, occurred_at, transfer_id, reason, note
    ) values (
      h.account_id, v_dest_id, 'transfer_in', v_take, now(), v_transfer_id,
      'Moved from ' || v_from_name, nullif(trim(p_note), '')
    )
    returning id into v_event_id;
    v_events := v_events || v_event_id;

    v_left := v_left - v_take;
  end loop;

  return jsonb_build_object(
    'transfer_id', v_transfer_id,
    'event_ids', to_jsonb(v_events),
    'moved', p_quantity
  );
end;
$$;

comment on function public.move_bottles(uuid, uuid, uuid, integer, integer, text) is
  'Moves bottles of one vintage and size between two cellars (paired transfer events). All or none.';

revoke all on function public.move_bottles(uuid, uuid, uuid, integer, integer, text) from public, anon;
grant execute on function public.move_bottles(uuid, uuid, uuid, integer, integer, text) to authenticated;
