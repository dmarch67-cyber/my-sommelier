// Supabase Edge Function: the admin screen's changes to other people's sign-in.
//
// Adding a person and changing anyone's name, email or password need the Auth
// admin API, which only the service role key can use. That key lives in this
// function's environment and never reaches the app. Every call first checks
// the caller's own token and that they are listed in private.admins (through
// public.is_admin(), run as the caller).
//
// Deploy with verify_jwt = false: the function checks the token itself.
//
// POST { action: 'create', email, password, name }
// POST { action: 'update', user_id, email?, password?, name? }

import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MIN_PASSWORD = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** Plain-words versions of Supabase Auth's errors. */
function friendly(message: string): string {
  if (/already (been )?registered|already exists|email_exists/i.test(message)) {
    return 'Someone already signs in with that email.';
  }
  if (/password/i.test(message) && /(weak|short|least)/i.test(message)) {
    return `Use a longer password (at least ${MIN_PASSWORD} characters).`;
  }
  return message;
}

type Body = {
  action?: unknown;
  user_id?: unknown;
  email?: unknown;
  password?: unknown;
  name?: unknown;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return reply(503, { error: 'Not set up.' });

  // The caller: signed in, and an admin.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return reply(401, { error: 'Sign in first.' });
  const asCaller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: who, error: authError } = await asCaller.auth.getUser(token);
  if (authError || !who?.user) return reply(401, { error: 'Sign in first.' });
  const { data: isAdmin, error: adminError } = await asCaller.rpc('is_admin');
  if (adminError) return reply(500, { error: adminError.message });
  if (isAdmin !== true) return reply(403, { error: 'Only an admin can do this.' });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'Send JSON.' });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined;
  const password = typeof body.password === 'string' ? body.password : undefined;
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : undefined;
  if (email !== undefined && !EMAIL.test(email)) {
    return reply(400, { error: 'That doesn’t look like an email address.' });
  }
  if (password !== undefined && password.length < MIN_PASSWORD) {
    return reply(400, { error: `Use a longer password (at least ${MIN_PASSWORD} characters).` });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (body.action === 'create') {
    if (!email || !password) {
      return reply(400, { error: 'Enter an email and a starting password.' });
    }
    // The database makes their own empty account (named after them) on creation.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: name ? { full_name: name } : {},
    });
    if (error || !data?.user) return reply(400, { error: friendly(error?.message ?? 'Failed.') });
    return reply(200, { user_id: data.user.id });
  }

  if (body.action === 'update') {
    const userId =
      typeof body.user_id === 'string' && UUID.test(body.user_id) ? body.user_id : null;
    if (!userId) return reply(400, { error: 'Which user?' });
    if (email === undefined && password === undefined && name === undefined) {
      return reply(400, { error: 'Nothing to change.' });
    }
    const { data: current, error: findError } = await admin.auth.admin.getUserById(userId);
    if (findError || !current?.user) return reply(404, { error: 'That user wasn’t found.' });

    const changes: {
      email?: string;
      email_confirm?: boolean;
      password?: string;
      user_metadata?: Record<string, unknown>;
    } = {};
    if (email !== undefined && email !== current.user.email) {
      changes.email = email;
      changes.email_confirm = true;
    }
    if (password !== undefined) changes.password = password;
    if (name !== undefined) {
      changes.user_metadata = { ...(current.user.user_metadata ?? {}), full_name: name };
    }
    if (Object.keys(changes).length > 0) {
      const { error } = await admin.auth.admin.updateUserById(userId, changes);
      if (error) return reply(400, { error: friendly(error.message) });
    }
    // Keep the name of the account they own in step with their name.
    if (name) {
      const { data: owned } = await admin
        .from('account_members')
        .select('account_id')
        .eq('user_id', userId)
        .eq('role', 'owner');
      const ids = (owned ?? []).map((r: { account_id: string }) => r.account_id);
      if (ids.length > 0) await admin.from('accounts').update({ name }).in('id', ids);
    }
    return reply(200, { ok: true });
  }

  return reply(400, { error: 'Unknown action.' });
});
