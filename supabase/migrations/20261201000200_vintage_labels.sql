-- Label pictures per vintage. Many wines change their label art from year to
-- year, so each vintage can have its own picture. The wine-level picture
-- (wines.label_*) stays as the stand-in for vintages without their own.
-- Backward-compatible: only new nullable columns and grants.

alter table public.vintages
  add column if not exists label_path text,
  add column if not exists label_source text,
  add column if not exists label_page_url text,
  add column if not exists label_image_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vintages_label_source_check') then
    alter table public.vintages add constraint vintages_label_source_check
      check (label_source is null or label_source in ('photo', 'web'));
  end if;
end;
$$;

comment on column public.vintages.label_path is
  'This vintage''s own label picture in the "labels" bucket; null = use the wine''s picture.';
comment on column public.vintages.label_source is
  '''photo'' = the owner''s own photo (never replaced automatically); ''web'' = found online.';

-- find-labels (service role) writes only the picture columns.
grant update (label_path, label_source, label_page_url, label_image_url)
  on public.vintages to service_role;
