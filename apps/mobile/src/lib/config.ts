/**
 * Where the app finds its Supabase project.
 *
 * The publishable key is designed to ship inside apps and web pages: it can
 * only do what row-level security allows, and every table refuses anonymous
 * visitors. It is NOT the secret (service role) key, which must never appear
 * in this repo or in the app.
 *
 * Both values can be overridden with EXPO_PUBLIC_SUPABASE_URL and
 * EXPO_PUBLIC_SUPABASE_KEY (for example to point at a local Supabase).
 */
export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://fhvwihqcctgekuejxzzv.supabase.co';

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_KEY ?? 'sb_publishable_569WVZo4DxWMqeRPP8eXDw_PHyqe0QX';
