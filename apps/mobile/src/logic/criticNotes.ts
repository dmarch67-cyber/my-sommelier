// Pure helpers for the critic notes on the Wine page (no I/O, so tests can import them).

export type CriticNote = {
  id: string;
  author: string;
  kind: 'critic' | 'merchant' | 'winery' | 'community';
  score: string | null;
  noted_on: string | null;
  note: string;
  source_url: string;
  source_site: string | null;
};

const ORDER: Record<CriticNote['kind'], number> = {
  critic: 0,
  merchant: 1,
  community: 2,
  winery: 3,
};

function noteWords(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 20)
    .join(' ');
}

/**
 * Critics first, newest first; the winery's own note last. The same note
 * quoted by two shops is shown once (the dated copy, or the fuller name).
 */
export function sortNotes(notes: CriticNote[]): CriticNote[] {
  const best = new Map<string, CriticNote>();
  for (const n of notes) {
    const key = noteWords(n.note);
    const have = best.get(key);
    if (
      !have ||
      (n.noted_on && !have.noted_on) ||
      (!!n.noted_on === !!have.noted_on && n.author.length > have.author.length)
    )
      best.set(key, n);
  }
  return [...best.values()].sort(
    (a, b) =>
      ORDER[a.kind] - ORDER[b.kind] ||
      (b.noted_on ?? '').localeCompare(a.noted_on ?? '') ||
      a.author.localeCompare(b.author),
  );
}

/** "Wine Advocate · 2024 · shop.com" style caption under the author. */
export function noteCaption(n: CriticNote): string {
  const kind =
    n.kind === 'winery' ? "Winery's own note" : n.kind === 'merchant' ? 'Merchant' : null;
  return [kind, n.noted_on?.slice(0, 4) ?? null, n.source_site].filter(Boolean).join(' · ');
}
