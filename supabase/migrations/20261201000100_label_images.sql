-- Label pictures for wines.
--
-- One picture per wine, saved in the private Storage bucket "labels" at
-- <account_id>/<wine_id>-<random>.<ext>. Two kinds:
--   * 'photo': the owner's own photo (Snap the label, or Replace picture on
--     the Wine page). Always wins; the web finder never replaces it.
--   * 'web':   found by the find-labels Edge Function on the winery, importer
--     or a shop's page, and checked by Claude looking at the picture.
-- Backward-compatible: only new nullable columns, a bucket and policies.

alter table public.wines
  add column if not exists label_path text,
  add column if not exists label_source text,
  add column if not exists label_page_url text,
  add column if not exists label_image_url text,
  add column if not exists label_searched_at timestamptz,
  add column if not exists label_search_result text,
  add column if not exists label_search_usage jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wines_label_source_check') then
    alter table public.wines add constraint wines_label_source_check
      check (label_source is null or label_source in ('photo', 'web'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wines_label_search_result_check') then
    alter table public.wines add constraint wines_label_search_result_check
      check (label_search_result is null or label_search_result in ('found', 'none', 'failed'));
  end if;
end;
$$;

comment on column public.wines.label_path is
  'Path of the wine''s label picture in the "labels" Storage bucket, or null for the monogram tile.';
comment on column public.wines.label_source is
  '''photo'' = the owner''s own photo (never replaced automatically); ''web'' = found online.';
comment on column public.wines.label_page_url is 'For a web picture: the page it came from.';
comment on column public.wines.label_image_url is 'For a web picture: the original image address.';
comment on column public.wines.label_searched_at is 'When find-labels last looked for a picture.';
comment on column public.wines.label_search_result is 'found | none | failed, from the last search.';

-- The bucket: private, images only, at most 10 MB each.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('labels', 'labels', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- Members of an account see its pictures; owners and editors add and change
-- them. The first folder of the path is the account id.
drop policy if exists "labels: members read" on storage.objects;
create policy "labels: members read" on storage.objects
  for select to authenticated
  using (bucket_id = 'labels'
         and (storage.foldername(name))[1] in (select private.readable_account_ids()::text));

drop policy if exists "labels: writers insert" on storage.objects;
create policy "labels: writers insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'labels'
              and (storage.foldername(name))[1] in (select private.writable_account_ids()::text));

drop policy if exists "labels: writers update" on storage.objects;
create policy "labels: writers update" on storage.objects
  for update to authenticated
  using (bucket_id = 'labels'
         and (storage.foldername(name))[1] in (select private.writable_account_ids()::text))
  with check (bucket_id = 'labels'
              and (storage.foldername(name))[1] in (select private.writable_account_ids()::text));

drop policy if exists "labels: writers delete" on storage.objects;
create policy "labels: writers delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'labels'
         and (storage.foldername(name))[1] in (select private.writable_account_ids()::text));

-- The next wine to look for a picture for: held wines with most bottles
-- first, no picture yet, never searched (or a failed search over a day ago).
-- Marks it as being searched, so parallel calls never take the same wine.
-- p_max caps how many wines may have been searched in total (for test runs).
create or replace function public.claim_label_search(p_account_id uuid, p_max integer default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_wine uuid;
begin
  if p_max is not null and (select count(*) from public.wines
                            where account_id = p_account_id
                              and label_searched_at is not null) >= p_max then
    return null;
  end if;

  select w.id into v_wine
  from public.wines w
  join lateral (
    select coalesce(sum(h.quantity + h.quantity_on_order), 0) as n
    from public.vintages v join public.holdings h on h.vintage_id = v.id
    where v.wine_id = w.id
  ) held on true
  where w.account_id = p_account_id
    and w.label_path is null
    and held.n > 0
    and (w.label_searched_at is null
         or (w.label_search_result = 'failed' and w.label_searched_at < now() - interval '1 day')
         or (w.label_search_result is null and w.label_searched_at < now() - interval '15 minutes'))
  order by held.n desc, w.id
  limit 1
  for update of w skip locked;

  if v_wine is null then
    return null;
  end if;
  update public.wines
     set label_searched_at = now(), label_search_result = null
   where id = v_wine;
  return v_wine;
end;
$$;

revoke all on function public.claim_label_search(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_label_search(uuid, integer) to service_role;

-- find-labels works as the service role: read the wine, write only the
-- picture columns.
grant update (label_path, label_source, label_page_url, label_image_url, label_searched_at,
              label_search_result, label_search_usage) on public.wines to service_role;
