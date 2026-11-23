// Supabase Edge Function: reads a photo of a wine label with Claude.
// Only signed-in users can call it: the function checks the user's token with
// Supabase Auth before doing anything. The Anthropic key lives in the
// project's Edge Function secrets as ANTHROPIC_API_KEY and never reaches the app.

import Anthropic from 'npm:@anthropic-ai/sdk@1.13.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

import { cleanReading, MODEL, READING_SCHEMA, SYSTEM, userText, type KnownWine } from './prompt.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type MediaType = (typeof MEDIA_TYPES)[number];
const MAX_BASE64 = 7_000_000; // about 5 MB of image

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });

  // Checked first, so a quick unsigned call shows whether the reader is set up.
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return reply(503, {
      error: 'The label reader isn’t set up yet: the ANTHROPIC_API_KEY secret is missing.',
      code: 'no_key',
    });
  }

  // Signed-in users only.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!token || !supabaseUrl || !anonKey) return reply(401, { error: 'Sign in first.' });
  const { data: who, error: authError } = await createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.getUser(token);
  if (authError || !who?.user) return reply(401, { error: 'Sign in first.' });

  let body: { image?: unknown; media_type?: unknown; known?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'Send JSON.' });
  }
  const image = typeof body.image === 'string' ? body.image.replace(/^data:[^,]*,/, '') : '';
  const mediaType = MEDIA_TYPES.includes(body.media_type as MediaType)
    ? (body.media_type as MediaType)
    : null;
  if (!image || !mediaType) return reply(400, { error: 'Send a photo (JPEG or PNG).' });
  if (image.length > MAX_BASE64) return reply(413, { error: 'That photo is too large.' });
  const known: KnownWine[] = (Array.isArray(body.known) ? body.known : [])
    .filter(
      (w): w is KnownWine =>
        !!w && typeof w.id === 'string' && typeof w.name === 'string' && w.name.length < 300,
    )
    .slice(0, 3000)
    .map((w) => ({ id: w.id, name: w.name, place: typeof w.place === 'string' ? w.place : '' }));

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: READING_SCHEMA },
      },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: userText(known) },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      return reply(422, { error: 'The label reader couldn’t read this photo. Try another one.' });
    }
    const textBlock = response.content.find((b) => b.type === 'text');
    let parsed: unknown = null;
    try {
      parsed = textBlock && textBlock.type === 'text' ? JSON.parse(textBlock.text) : null;
    } catch {
      parsed = null;
    }
    const reading = cleanReading(parsed, known);
    if (!reading)
      return reply(502, { error: 'The label reader gave an unclear answer. Try again.' });
    return reply(200, { reading, usage: response.usage });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return reply(503, {
        error: 'The label reader’s key was refused. Check the ANTHROPIC_API_KEY secret.',
        code: 'bad_key',
      });
    }
    if (e instanceof Anthropic.RateLimitError) {
      return reply(429, { error: 'Too many labels at once. Wait a moment and try again.' });
    }
    if (e instanceof Anthropic.APIError) {
      // 402-style billing problems arrive as 400 with a credit message.
      const msg = /credit|billing/i.test(e.message)
        ? 'The label reader is out of credit. Add credit at platform.claude.com.'
        : 'The label reader is unavailable right now. Try again shortly.';
      console.error('anthropic error', e.status, e.message);
      return reply(502, { error: msg });
    }
    console.error('read-label failed', e);
    return reply(500, { error: 'Something went wrong reading the label.' });
  }
});
