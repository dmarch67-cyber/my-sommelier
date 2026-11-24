-- "What critics and drinkers say" on the Wine page.
--
-- The drinking-window review already wrote a short summary of recent notes for
-- each vintage, but it explains the window ("this window rests on..."). The
-- critics-say Edge Function rewrites it for the reader: what the wine tastes
-- like, how it is drinking now and who said so, plus a link to the full notes
-- on CellarTracker. Kept beside the review so both stay together.

alter table public.vintage_assessments
  add column if not exists critics_say     text,
  add column if not exists critics_url     text,
  add column if not exists critics_said_at timestamptz;

comment on column public.vintage_assessments.critics_say is
  'Two or three sentences for the Wine page on what recent critic and community notes say.';
comment on column public.vintage_assessments.critics_url is
  'Where to read the full notes (a CellarTracker page or search).';
comment on column public.vintage_assessments.critics_said_at is
  'When critics_say was written. Older than assessed_at means the review changed since.';

-- Saves rewritten summaries. p_items is an array of { vintage_id, text, url }.
-- Only the service role (the Edge Function) may call it.
create or replace function public.save_critics_say(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be an array' using errcode = 'invalid_parameter_value';
  end if;
  update public.vintage_assessments va
  set critics_say = left(nullif(trim(i ->> 'text'), ''), 1000),
      critics_url = case when i ->> 'url' ~ '^https://' then left(i ->> 'url', 500) end,
      critics_said_at = now()
  from jsonb_array_elements(p_items) i
  where (i ->> 'vintage_id') ~ '^[0-9a-f-]{36}$'
    and va.vintage_id = (i ->> 'vintage_id')::uuid;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.save_critics_say(jsonb) from public, anon, authenticated;
grant execute on function public.save_critics_say(jsonb) to service_role;

-- The function reads the reviews and the wine facts as the service role.
grant select on public.vintage_assessments, public.wine_assessments, public.wines,
  public.vintages, public.holdings, public.scores to service_role;
