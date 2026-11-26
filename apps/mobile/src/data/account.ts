import { supabase } from '../lib/supabase';

/**
 * Sign-in details and the admin screen.
 *
 * Your own name and password change straight through Supabase Auth. Anything
 * that touches someone else's sign-in (or anyone's email) goes through the
 * admin-users Edge Function, which checks that the caller is an admin and
 * holds the service key on the server.
 */

export const MIN_PASSWORD = 8;

export type AdminUser = {
  user_id: string;
  email: string;
  name: string;
  created_at: string;
  last_sign_in_at: string | null;
  is_admin: boolean;
  account_id: string | null;
  account_name: string | null;
  research_enabled: boolean;
  cellars: number;
  bottles: number;
};

/** True when the signed-in user may open the admin screen (false on an older database). */
export async function amIAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin');
  return !error && data === true;
}

export async function listUsers(): Promise<AdminUser[]> {
  const { data, error } = await supabase.rpc('admin_list_users');
  if (error) throw new Error(error.message);
  return (data ?? []).map((u: AdminUser) => ({
    ...u,
    cellars: Number(u.cellars),
    bottles: Number(u.bottles),
  }));
}

export async function setResearch(accountId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_research', {
    p_account_id: accountId,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message);
}

async function callAdmin(body: Record<string, unknown>): Promise<{ user_id?: string }> {
  const { data, error } = await supabase.functions.invoke<{ user_id?: string }>('admin-users', {
    body,
  });
  if (error) {
    let message = 'That didn’t save. Please try again.';
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const reply = await ctx.json().catch(() => null);
      if (reply?.error) message = String(reply.error);
      else if (ctx.status === 404) message = 'The admin tools aren’t switched on yet.';
    }
    throw new Error(message);
  }
  return data ?? {};
}

/** Adds a person with a starting password; they get their own empty account. */
export async function createUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<string | undefined> {
  return (await callAdmin({ action: 'create', ...input })).user_id;
}

/** Changes any user's name, email and/or password (admins only). */
export async function updateUser(
  userId: string,
  changes: { name?: string; email?: string; password?: string },
): Promise<void> {
  await callAdmin({ action: 'update', user_id: userId, ...changes });
}

/** Your own name. */
export async function updateMyName(name: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ data: { full_name: name.trim() } });
  if (error) throw new Error(error.message);
}

/** Your own password: checks the current one first, so a borrowed phone can't change it. */
export async function changeMyPassword(
  email: string,
  current: string,
  next: string,
): Promise<void> {
  if (next.length < MIN_PASSWORD) {
    throw new Error(`Use a longer password (at least ${MIN_PASSWORD} characters).`);
  }
  const { error: checkError } = await supabase.auth.signInWithPassword({
    email,
    password: current,
  });
  if (checkError) throw new Error('Your current password isn’t right.');
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    if (/different from the old/i.test(error.message)) {
      throw new Error('The new password must be different from the old one.');
    }
    throw new Error(error.message);
  }
}

/** A new user's first cellar (or another one later). */
export async function createCellar(
  accountId: string,
  input: { name: string; location?: string; currency: string; sortOrder?: number },
): Promise<void> {
  const { error } = await supabase.from('cellars').insert({
    account_id: accountId,
    name: input.name.trim(),
    location: input.location?.trim() || null,
    currency: input.currency,
    sort_order: input.sortOrder ?? 0,
  });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      throw new Error('You already have a cellar with that name.');
    }
    throw new Error(error.message);
  }
}
