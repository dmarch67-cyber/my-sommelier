-- The reviewer works as the service role, which on the hosted project has no
-- table rights unless granted. Read what a review needs; write only the window.
grant select on public.wines, public.vintages, public.holdings, public.scores,
  public.tasting_notes to service_role;
grant update (drink_from, drink_to, drink_window_source) on public.vintages to service_role;
