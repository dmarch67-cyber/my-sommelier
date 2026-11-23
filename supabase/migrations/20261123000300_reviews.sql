-- My Sommelier: scores, accolades and tasting notes.

create type public.score_source as enum (
  'unknown',          -- e.g. the spreadsheet RP column, a generic score
  'wine_advocate',    -- Robert Parker / Wine Advocate
  'vinous',
  'cellartracker',    -- community average
  'wine_spectator',
  'jancis_robinson',
  'james_suckling',
  'jeb_dunnuck',
  'decanter',
  'burghound',
  'other'             -- name it in source_detail
);

create table public.scores (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null,
  vintage_id        uuid not null,
  source            public.score_source not null default 'unknown',
  source_detail     text,
  raw_value         text not null check (length(trim(raw_value)) > 0),
  value_low         numeric(5, 2),
  value_high        numeric(5, 2),
  is_plus           boolean not null default false,
  is_barrel_sample  boolean not null default false,
  scale_max         smallint not null default 100 check (scale_max > 0),
  reviewed_on       date,
  drink_from        smallint check (drink_from between 1800 and 2300),
  drink_to          smallint check (drink_to between 1800 and 2300),
  review_text       text,
  url               text,
  entered_via       text not null default 'manual'
                    check (entered_via in ('manual', 'spreadsheet_import', 'enrichment')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (vintage_id, account_id) references public.vintages (id, account_id) on delete cascade,
  foreign key (account_id) references public.accounts (id) on delete cascade,
  check (value_low is null or (value_low >= 0 and value_low <= scale_max)),
  check (value_high is null or (value_high >= 0 and value_high <= scale_max)),
  check (value_high is null or value_low is not null),
  check (value_high is null or value_high >= value_low),
  check (drink_to is null or drink_from is null or drink_to >= drink_from)
);
comment on table public.scores is
  'Critic or community scores, many per vintage. raw_value keeps the text as written ("94+", "92-94").';
comment on column public.scores.value_low is 'Numeric score, or the low end of a range.';
comment on column public.scores.value_high is 'High end of a range ("92-94"); null for a single score.';
comment on column public.scores.is_plus is 'True for "94+".';
comment on column public.scores.is_barrel_sample is 'Pre-release / barrel score, usually a range.';
create index scores_account_id_idx on public.scores (account_id);
create index scores_vintage_id_idx on public.scores (vintage_id);

create table public.accolades (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null,
  vintage_id   uuid not null,
  raw_text     text not null check (length(trim(raw_text)) > 0),
  publication  text,
  title        text,
  rank         integer check (rank > 0),
  year         smallint check (year between 1800 and 2300),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (vintage_id, account_id) references public.vintages (id, account_id) on delete cascade,
  foreign key (account_id) references public.accounts (id) on delete cascade
);
comment on table public.accolades is
  'Lists and awards, e.g. "VINOUS #37 WOY 2025" = Vinous, Wine of the Year, rank 37, 2025.';
create index accolades_account_id_idx on public.accolades (account_id);
create index accolades_vintage_id_idx on public.accolades (vintage_id);

create type public.maturity_opinion as enum (
  'too_young', 'approaching', 'ready', 'peak', 'declining', 'past_it'
);

create table public.tasting_notes (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null,
  vintage_id          uuid not null,
  inventory_event_id  uuid,
  tasted_on           date not null default current_date,
  rating              numeric(5, 2) check (rating >= 0 and rating <= 100),
  maturity            public.maturity_opinion,
  notes               text,
  food_pairing        text,
  occasion            text,
  would_buy_again     boolean,
  created_by          uuid default auth.uid() references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (vintage_id, account_id) references public.vintages (id, account_id) on delete cascade,
  foreign key (inventory_event_id, account_id)
    references public.inventory_events (id, account_id) on delete set null (inventory_event_id),
  foreign key (account_id) references public.accounts (id) on delete cascade
);
comment on table public.tasting_notes is
  'The user''s own notes. Linked to the bottle drunk (a consumed event) when there is one; '
  'a note from a restaurant or tasting has no event.';
comment on column public.tasting_notes.rating is 'The user''s own score out of 100.';
comment on column public.tasting_notes.maturity is
  'How ready the wine seemed. Feeds drink-now advice for remaining bottles of the vintage.';
create index tasting_notes_account_id_idx on public.tasting_notes (account_id);
create index tasting_notes_vintage_id_idx on public.tasting_notes (vintage_id);

create trigger scores_set_updated_at before update on public.scores
  for each row execute function private.set_updated_at();
create trigger accolades_set_updated_at before update on public.accolades
  for each row execute function private.set_updated_at();
create trigger tasting_notes_set_updated_at before update on public.tasting_notes
  for each row execute function private.set_updated_at();
