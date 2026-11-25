import { supabase } from '../lib/supabase';

export type LabelSource = 'photo' | 'web';

export type WineLabel = {
  /** A signed address the app can show; valid for a day. */
  uri: string;
  path: string;
  source: LabelSource;
  pageUrl: string | null;
};

type Row = {
  id: string;
  label_path: string | null;
  label_source: LabelSource | null;
  label_page_url: string | null;
};

const BUCKET = 'labels';
const DAY = 60 * 60 * 24;

/**
 * The label picture of every wine that has one, by wine id. On a database
 * without label pictures yet it quietly returns an empty map, so the app shows
 * the monogram tiles as before.
 */
export async function loadLabels(): Promise<Map<string, WineLabel>> {
  const out = new Map<string, WineLabel>();
  try {
    const rows: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('wines')
        .select('id,label_path,label_source,label_page_url')
        .not('label_path', 'is', null)
        .order('id')
        .range(from, from + 999);
      if (error) return out;
      rows.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) break;
    }
    if (rows.length === 0) return out;
    const paths = rows.map((r) => r.label_path as string);
    const signed: { path: string | null; signedUrl: string }[] = [];
    for (let i = 0; i < paths.length; i += 500) {
      const { data } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(paths.slice(i, i + 500), DAY);
      signed.push(...((data ?? []) as { path: string | null; signedUrl: string }[]));
    }
    const byPath = new Map(
      signed.filter((s) => s.path && s.signedUrl).map((s) => [s.path, s.signedUrl]),
    );
    for (const r of rows) {
      const uri = byPath.get(r.label_path as string);
      if (!uri) continue;
      out.set(r.id, {
        uri,
        path: r.label_path as string,
        source: r.label_source ?? 'web',
        pageUrl: r.label_page_url,
      });
    }
  } catch {
    // Pictures are a nice-to-have: never stop the cellar loading.
  }
  return out;
}

function bytesFromBase64(base64: string): Uint8Array {
  const bin = atob(base64.replace(/^data:[^,]*,/, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Saves the owner's own photo as the wine's picture. It replaces any picture
 * the wine had (a web one or an older photo), and the web finder never
 * replaces it.
 */
export async function savePhotoLabel(
  accountId: string,
  wineId: string,
  base64Jpeg: string,
  previousPath: string | null,
): Promise<void> {
  const path = `${accountId}/${wineId}-${Math.random().toString(36).slice(2, 10)}.jpg`;
  const { error: upError } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytesFromBase64(base64Jpeg), { contentType: 'image/jpeg', upsert: false });
  if (upError) throw new Error(`Couldn’t save the photo: ${upError.message}`);
  const { error } = await supabase
    .from('wines')
    .update({
      label_path: path,
      label_source: 'photo',
      label_page_url: null,
      label_image_url: null,
    })
    .eq('id', wineId);
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(`Couldn’t save the photo: ${error.message}`);
  }
  if (previousPath && previousPath !== path) {
    await supabase.storage.from(BUCKET).remove([previousPath]);
  }
}

/** Takes the picture off a wine, so it shows the monogram tile again. */
export async function removeLabel(wineId: string, path: string): Promise<void> {
  // Marked as searched, so the web finder never puts a wrong picture back.
  const { error } = await supabase
    .from('wines')
    .update({
      label_path: null,
      label_source: null,
      label_page_url: null,
      label_image_url: null,
      label_searched_at: new Date().toISOString(),
      label_search_result: 'none',
    })
    .eq('id', wineId);
  if (error) throw new Error(`Couldn’t remove the picture: ${error.message}`);
  await supabase.storage.from(BUCKET).remove([path]);
}
