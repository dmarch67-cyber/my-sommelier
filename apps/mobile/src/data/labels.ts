import { supabase } from '../lib/supabase';

export type LabelSource = 'photo' | 'web';

export type WineLabel = {
  /** A signed address the app can show; valid for a day. */
  uri: string;
  path: string;
  source: LabelSource;
  pageUrl: string | null;
  /** 'vintage' = this vintage's own label; 'wine' = the wine's stand-in picture. */
  level: 'vintage' | 'wine';
};

/** Label pictures by wine id and by vintage id. */
export type Labels = { wines: Map<string, WineLabel>; vintages: Map<string, WineLabel> };

export const NO_LABELS: Labels = { wines: new Map(), vintages: new Map() };

/** The picture to show for a vintage: its own label, else the wine's stand-in. */
export function labelFor(
  labels: Labels,
  wineId: string | undefined,
  vintageId: string | undefined,
): WineLabel | undefined {
  return (
    (vintageId ? labels.vintages.get(vintageId) : undefined) ??
    (wineId ? labels.wines.get(wineId) : undefined)
  );
}

type Row = {
  id: string;
  label_path: string | null;
  label_source: LabelSource | null;
  label_page_url: string | null;
};

const BUCKET = 'labels';
const DAY = 60 * 60 * 24;

async function rowsWithPictures(table: 'wines' | 'vintages'): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select('id,label_path,label_source,label_page_url')
      .not('label_path', 'is', null)
      .order('id')
      .range(from, from + 999);
    if (error) return rows; // an older database without the columns: no pictures
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) return rows;
  }
}

/**
 * Every label picture of the account. On a database without label pictures
 * it quietly returns none, so the app shows the monogram tiles as before.
 */
export async function loadLabels(): Promise<Labels> {
  const out: Labels = { wines: new Map(), vintages: new Map() };
  try {
    const [wines, vintages] = await Promise.all([
      rowsWithPictures('wines'),
      rowsWithPictures('vintages'),
    ]);
    const paths = [...new Set([...wines, ...vintages].map((r) => r.label_path as string))];
    if (paths.length === 0) return out;
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
    const fill = (rows: Row[], into: Map<string, WineLabel>, level: WineLabel['level']) => {
      for (const r of rows) {
        const uri = byPath.get(r.label_path as string);
        if (!uri) continue;
        into.set(r.id, {
          uri,
          path: r.label_path as string,
          source: r.label_source ?? 'web',
          pageUrl: r.label_page_url,
          level,
        });
      }
    };
    fill(wines, out.wines, 'wine');
    fill(vintages, out.vintages, 'vintage');
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

const PHOTO_FIELDS = (path: string) => ({
  label_path: path,
  label_source: 'photo',
  label_page_url: null,
  label_image_url: null,
});

/**
 * Saves the owner's own photo as this vintage's label. If the wine has no
 * picture of its own yet (or only one found online and no vintage is set),
 * the photo also stands in for the wine's other vintages. The web finder
 * never replaces the owner's photos.
 */
export async function savePhotoLabel(
  accountId: string,
  wineId: string,
  vintageId: string | null,
  base64Jpeg: string,
  labels: Labels,
): Promise<void> {
  const path = `${accountId}/${wineId}-${Math.random().toString(36).slice(2, 10)}.jpg`;
  const { error: upError } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytesFromBase64(base64Jpeg), { contentType: 'image/jpeg', upsert: false });
  if (upError) throw new Error(`Couldn’t save the photo: ${upError.message}`);

  const oldPaths: string[] = [];
  const wineLabel = labels.wines.get(wineId);
  const setWine = !vintageId || !wineLabel;
  if (vintageId) {
    const { error } = await supabase
      .from('vintages')
      .update(PHOTO_FIELDS(path))
      .eq('id', vintageId);
    if (error) {
      await supabase.storage.from(BUCKET).remove([path]);
      throw new Error(`Couldn’t save the photo: ${error.message}`);
    }
    const old = labels.vintages.get(vintageId)?.path;
    if (old) oldPaths.push(old);
  }
  if (setWine) {
    const { error } = await supabase.from('wines').update(PHOTO_FIELDS(path)).eq('id', wineId);
    if (error && !vintageId) {
      await supabase.storage.from(BUCKET).remove([path]);
      throw new Error(`Couldn’t save the photo: ${error.message}`);
    }
    if (!error && wineLabel) oldPaths.push(wineLabel.path);
  }
  // Remove pictures nothing points at any more.
  const stillUsed = new Set(
    [...labels.wines.values(), ...labels.vintages.values()]
      .filter((l) => !oldPaths.includes(l.path))
      .map((l) => l.path),
  );
  const gone = oldPaths.filter((p) => p !== path && !stillUsed.has(p));
  if (gone.length) await supabase.storage.from(BUCKET).remove(gone);
}

/**
 * Takes the picture shown for a vintage off: its own label if it has one,
 * else the wine's stand-in. The wine is marked as searched, so the web finder
 * never puts a wrong picture back.
 */
export async function removeLabel(
  wineId: string,
  vintageId: string,
  labels: Labels,
): Promise<void> {
  const own = labels.vintages.get(vintageId);
  const target = own ?? labels.wines.get(wineId);
  if (!target) return;
  const cleared = {
    label_path: null,
    label_source: null,
    label_page_url: null,
    label_image_url: null,
  };
  const { error } = own
    ? await supabase.from('vintages').update(cleared).eq('id', vintageId)
    : await supabase.from('wines').update(cleared).eq('id', wineId);
  if (error) throw new Error(`Couldn’t remove the picture: ${error.message}`);
  await supabase
    .from('wines')
    .update({ label_searched_at: new Date().toISOString(), label_search_result: 'none' })
    .eq('id', wineId);
  const stillUsed = [...labels.wines.entries(), ...labels.vintages.entries()].some(
    ([id, l]) => l.path === target.path && id !== (own ? vintageId : wineId),
  );
  if (!stillUsed) await supabase.storage.from(BUCKET).remove([target.path]);
}
