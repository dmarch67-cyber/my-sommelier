-- My Sommelier: cellars, wines, vintages, holdings and the inventory ledger.
--
-- Shape:  account -> cellars
--         account -> wines -> vintages
--         holding = bottles of one vintage, in one cellar, in one bottle size
--         inventory_events = every change to a holding's counts (append-only)
--
-- Child tables carry account_id and reference their parent by
-- (id, account_id), so a row can never point at another account's data even
-- though foreign-key checks bypass row-level security.

-- Cellars ------------------------------------------------------------------

create table public.cellars (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts (id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  location      text,
  country_code  char(2) check (country_code ~ '^[A-Z]{2}$'),
  currency      char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  timezone      text,
  notes         text,
  sort_order    integer not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (account_id, name),
  unique (id, account_id)
);
comment on table public.cellars is
  'A physical place where bottles are kept (Dan: LA home, Oregon, Paris). No bins or racks.';
comment on column public.cellars.currency is
  'ISO 4217 code used by default for prices of bottles bought into this cellar.';

-- Wines and vintages -------------------------------------------------------

create type public.wine_colour as enum (
  'red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'orange'
);

create table public.wines (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.accounts (id) on delete cascade,
  name                   text not null check (length(trim(name)) > 0),
  producer               text,
  cuvee                  text,
  source_name            text,
  country                text,
  region                 text,
  appellation            text,
  colour                 public.wine_colour,
  grapes                 text[] not null default '{}',
  cellartracker_wine_id  text,
  vinous_wine_id         text,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (id, account_id)
);
comment on table public.wines is
  'A wine as the account knows it (producer + cuvee), independent of vintage. Per account in v1.';
comment on column public.wines.name is 'Display name, e.g. "Bergstrom Sigrid Chardonnay".';
comment on column public.wines.source_name is
  'The name exactly as first entered or imported (e.g. the spreadsheet string), kept for matching.';
comment on column public.wines.region is
  'Broad region or US state, e.g. Bordeaux, Rhone, California, Oregon.';
comment on column public.wines.appellation is 'Appellation or sub-region, e.g. Pauillac, Yamhill-Carlton.';
create index wines_account_id_idx on public.wines (account_id);

create table public.vintages (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null,
  wine_id              uuid not null,
  year                 smallint check (year between 1800 and 2200),
  drink_from           smallint check (drink_from between 1800 and 2300),
  drink_to             smallint check (drink_to between 1800 and 2300),
  drink_window_source  text,
  cellartracker_id     text,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  foreign key (wine_id, account_id) references public.wines (id, account_id) on delete cascade,
  foreign key (account_id) references public.accounts (id) on delete cascade,
  unique nulls not distinct (wine_id, year),
  unique (id, account_id),
  check (drink_to is null or drink_from is null or drink_to >= drink_from)
);
comment on table public.vintages is
  'One vintage of a wine. year is null for non-vintage. drink_from/drink_to is the window the app uses.';
create index vintages_account_id_idx on public.vintages (account_id);

-- Holdings -----------------------------------------------------------------

create table public.holdings (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null,
  cellar_id          uuid not null,
  vintage_id         uuid not null,
  bottle_size_ml     integer not null default 750 check (bottle_size_ml > 0),
  quantity           integer not null default 0 check (quantity >= 0),
  quantity_on_order  integer not null default 0 check (quantity_on_order >= 0),
  unit_price         numeric(12, 2) check (unit_price >= 0),
  currency           char(3) check (currency ~ '^[A-Z]{3}$'),
  purchase_date      date,
  merchant           text,
  notes              text,
  import_ref         jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (cellar_id, account_id) references public.cellars (id, account_id) on delete cascade,
  foreign key (vintage_id, account_id) references public.vintages (id, account_id) on delete cascade,
  foreign key (account_id) references public.accounts (id) on delete cascade,
  unique (id, account_id),
  check (unit_price is null or currency is not null)
);
comment on table public.holdings is
  'Physical bottles of one vintage in one cellar in one bottle size, from one purchase lot. '
  'quantity and quantity_on_order are kept by inventory_events and cannot be set directly.';
comment on column public.holdings.bottle_size_ml is
  '750 = standard. Anything else (375 half, 1500 magnum, 3000 double magnum...) is flagged in the app.';
comment on column public.holdings.quantity is 'Physical bottles in the cellar now.';
comment on column public.holdings.quantity_on_order is
  'Bottles paid for but not yet delivered (the spreadsheet FUTURE column).';
comment on column public.holdings.unit_price is 'Cost per bottle. Null means unknown (not free).';
comment on column public.holdings.import_ref is
  'Where an imported holding came from (sheet, row, raw cells), for reconciliation. Null for app entries.';
create index holdings_account_id_idx on public.holdings (account_id);
create index holdings_cellar_id_idx on public.holdings (cellar_id);
create index holdings_vintage_id_idx on public.holdings (vintage_id);

-- Default a holding's currency to its cellar's currency.
create or replace function private.holdings_default_currency()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.currency is null and new.unit_price is not null then
    select c.currency into new.currency
    from public.cellars c
    where c.id = new.cellar_id and c.account_id = new.account_id;
  end if;
  return new;
end;
$$;

create trigger holdings_default_currency
  before insert or update of unit_price, currency, cellar_id on public.holdings
  for each row execute function private.holdings_default_currency();

-- Counts only change through the ledger. The ledger trigger sets a
-- transaction-local flag while it updates them.
create or replace function private.holdings_guard_counts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('my_sommelier.ledger', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.quantity <> 0 or new.quantity_on_order <> 0 then
      raise exception 'holding counts start at 0; add an inventory_event instead'
        using errcode = 'check_violation';
    end if;
  elsif new.quantity is distinct from old.quantity
     or new.quantity_on_order is distinct from old.quantity_on_order then
    raise exception 'holding counts change only through inventory_events'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger holdings_guard_counts
  before insert or update on public.holdings
  for each row execute function private.holdings_guard_counts();

-- Inventory ledger ---------------------------------------------------------

create type public.inventory_event_type as enum (
  'imported',         -- opening balance from the spreadsheet
  'purchased',        -- bottles arrived in the cellar
  'ordered',          -- paid for, not yet delivered
  'delivered',        -- on order -> in the cellar
  'order_cancelled',  -- on order, will not arrive
  'consumed',         -- drunk
  'removed',          -- gifted, sold, broken, lost (see reason)
  'transfer_out',     -- moved to another cellar (paired with transfer_in)
  'transfer_in',      -- moved from another cellar
  'adjusted'          -- stock-take correction
);

create table public.inventory_events (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null,
  holding_id      uuid not null,
  event_type      public.inventory_event_type not null,
  quantity_delta  integer not null default 0,
  on_order_delta  integer not null default 0,
  occurred_at     timestamptz,
  transfer_id     uuid,
  reason          text,
  note            text,
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (holding_id, account_id) references public.holdings (id, account_id) on delete cascade,
  foreign key (account_id) references public.accounts (id) on delete cascade,
  unique (id, account_id),
  check (quantity_delta <> 0 or on_order_delta <> 0),
  check (case event_type
    when 'imported'        then quantity_delta >= 0 and on_order_delta >= 0
    when 'purchased'       then quantity_delta > 0 and on_order_delta = 0
    when 'ordered'         then quantity_delta = 0 and on_order_delta > 0
    when 'delivered'       then quantity_delta > 0 and on_order_delta = -quantity_delta
    when 'order_cancelled' then quantity_delta = 0 and on_order_delta < 0
    when 'consumed'        then quantity_delta < 0 and on_order_delta = 0
    when 'removed'         then quantity_delta < 0 and on_order_delta = 0
    when 'transfer_out'    then quantity_delta < 0 and on_order_delta = 0
    when 'transfer_in'     then quantity_delta > 0 and on_order_delta = 0
    when 'adjusted'        then true
  end),
  check ((event_type in ('transfer_out', 'transfer_in')) = (transfer_id is not null))
);
comment on table public.inventory_events is
  'Append-only history of every change to a holding. Corrections are new "adjusted" events.';
comment on column public.inventory_events.occurred_at is
  'When it happened. Null when unknown (e.g. bottles marked GONE in the spreadsheet).';
comment on column public.inventory_events.transfer_id is
  'Shared by the transfer_out and transfer_in rows of one move between cellars.';
create index inventory_events_account_id_idx on public.inventory_events (account_id);
create index inventory_events_holding_id_idx on public.inventory_events (holding_id);
create index inventory_events_transfer_id_idx on public.inventory_events (transfer_id)
  where transfer_id is not null;

-- Apply each new event to its holding. A count going below zero fails the
-- holding's check constraint, which rejects the event.
create or replace function private.inventory_events_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('my_sommelier.ledger', 'on', true);
  update public.holdings h
     set quantity = h.quantity + new.quantity_delta,
         quantity_on_order = h.quantity_on_order + new.on_order_delta
   where h.id = new.holding_id
     and h.account_id = new.account_id;
  perform set_config('my_sommelier.ledger', 'off', true);
  return new;
end;
$$;

create trigger inventory_events_apply
  after insert on public.inventory_events
  for each row execute function private.inventory_events_apply();

-- Only the description of an event (when, why, note) can be edited.
create or replace function private.inventory_events_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.holding_id is distinct from old.holding_id
     or new.account_id is distinct from old.account_id
     or new.event_type is distinct from old.event_type
     or new.quantity_delta is distinct from old.quantity_delta
     or new.on_order_delta is distinct from old.on_order_delta
     or new.transfer_id is distinct from old.transfer_id then
    raise exception 'inventory events are append-only; add an "adjusted" event instead'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger inventory_events_guard_update
  before update on public.inventory_events
  for each row execute function private.inventory_events_guard_update();

-- updated_at triggers
create trigger cellars_set_updated_at before update on public.cellars
  for each row execute function private.set_updated_at();
create trigger wines_set_updated_at before update on public.wines
  for each row execute function private.set_updated_at();
create trigger vintages_set_updated_at before update on public.vintages
  for each row execute function private.set_updated_at();
create trigger holdings_set_updated_at before update on public.holdings
  for each row execute function private.set_updated_at();
create trigger inventory_events_set_updated_at before update on public.inventory_events
  for each row execute function private.set_updated_at();
